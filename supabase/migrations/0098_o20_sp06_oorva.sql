create or replace function public.get_sports_venue(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  select jsonb_build_object(
    'id', v.id,
    'name', v.name,
    'description', v.description,
    'address_line', case when current_setting('request.jwt.claim.role', true) = 'anon' then '' else v.address_line end,
    'city', v.city,
    'area', v.area,
    'lat', case when current_setting('request.jwt.claim.role', true) = 'anon' then null else v.lat end,
    'lng', case when current_setting('request.jwt.claim.role', true) = 'anon' then null else v.lng end,
    'amenities', v.amenities,
    'photos', v.photos,
    'payment_modes', v.payment_modes,
    'online_payment_ready', coalesce(
      public._sports_feature('sports_online_payments')
      and 'online' = any(v.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts as pa
         where pa.provider_id = v.owner_id and pa.activation_status = 'activated'
      ),
      false
    ),
    'cancellation_policy', jsonb_build_object(
      'full_refund_hours', coalesce(
        nullif(v.cancellation_rules ->> 'full_refund_hours', '')::int,
        nullif(public._sports_rule('full_refund_hours'), '')::int
      ),
      'partial_refund_hours', coalesce(
        nullif(v.cancellation_rules ->> 'partial_refund_hours', '')::int,
        nullif(public._sports_rule('partial_refund_hours'), '')::int
      ),
      'partial_refund_bp', coalesce(
        nullif(v.cancellation_rules ->> 'partial_refund_bp', '')::int,
        nullif(public._sports_rule('partial_refund_bp'), '')::int
      )
    ),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'activity_id', a.id, 'activity_slug', a.slug,
        'activity_name', a.name, 'slot_minutes', r.slot_minutes,
        'booking_mode', r.booking_mode, 'capacity', r.capacity
      ) order by r.created_at)
        from public.sports_resources as r
        join public.sports_activities as a on a.id = r.activity_id
       where r.venue_id = v.id and r.active and a.active
    ), '[]'::jsonb)
  ) into v_result
    from public.sports_venues as v
   where v.id = p_id and v.status = 'verified';
  return v_result;
end;
$$;

create or replace function public.get_sports_slots(p_resource_id uuid, p_date date)
returns table (starts_at timestamptz, ends_at timestamptz, state text, price_paise int, remaining int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min_lead_minutes int;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(
    p_date is not null
    and p_date between (now() at time zone 'Asia/Kolkata')::date
      and (now() at time zone 'Asia/Kolkata')::date + 30,
    'date must be within the next 30 days'
  );
  v_min_lead_minutes := coalesce(nullif(public._sports_rule('min_lead_minutes'), '')::int, -1);
  perform public._assert(v_min_lead_minutes between 0 and 43200,
                         'sports booking window rules are unavailable');
  return query
    with scope as (
      select r.id as resource_id, r.slot_minutes, r.capacity, h.opens, h.closes,
             extract(dow from p_date)::smallint as weekday
        from public.sports_resources as r
        join public.sports_venues as v on v.id = r.venue_id
        join public.sports_activities as a on a.id = r.activity_id
        join public.sports_hours as h
          on h.venue_id = v.id and h.weekday = extract(dow from p_date)::smallint
       where r.id = p_resource_id and r.active and a.active and v.status = 'verified'
    ),
    slots as (
      select s.resource_id, s.capacity, s.slot_minutes, s.weekday, gs as slot_start,
             gs + make_interval(mins => s.slot_minutes) as slot_end,
             (gs at time zone 'Asia/Kolkata')::time as local_start,
             ((gs + make_interval(mins => s.slot_minutes)) at time zone 'Asia/Kolkata')::time as local_end
        from scope as s
        cross join lateral generate_series(
          (p_date + s.opens) at time zone 'Asia/Kolkata',
          (p_date + s.closes) at time zone 'Asia/Kolkata' - make_interval(mins => s.slot_minutes),
          make_interval(mins => s.slot_minutes)
        ) as gs
    )
    select s.slot_start, s.slot_end,
           case
             when s.slot_start <= now() then 'past'
             when s.slot_start <= now() + make_interval(mins => v_min_lead_minutes)
               or s.slot_start > now() + interval '30 days' then 'blocked'
             when exists (
               select 1 from public.sports_blocks as b
                where b.resource_id = s.resource_id and b.starts_at < s.slot_end and b.ends_at > s.slot_start
             ) then 'blocked'
             when used.participants >= s.capacity then 'taken'
             when price.price_paise is null then 'blocked'
             else 'free'
           end,
           price.price_paise,
           greatest(s.capacity - used.participants, 0)::int
      from slots as s
      left join lateral (
        select coalesce(sum(b.participants), 0)::int as participants
          from public.sports_bookings as b
         where b.resource_id = s.resource_id
           and b.starts_at < s.slot_end and b.ends_at > s.slot_start
           and (
             b.status = 'accepted'
             or (b.status = 'requested' and b.expires_at > now())
             or (b.status = 'awaiting_payment' and b.pay_by > now())
             or (b.status = 'pending_payment' and b.hold_expires_at > now())
           )
      ) as used on true
      left join lateral (
        select pr.price_paise::int as price_paise
          from public.sports_price_rules as pr
         where pr.resource_id = s.resource_id
           and (pr.weekday = s.weekday or pr.weekday is null)
           and pr.starts <= s.local_start and pr.ends >= s.local_end
         order by (pr.weekday is null), pr.starts
         limit 1
      ) as price on true
     order by s.slot_start;
end;
$$;

create or replace function public.request_sports_slot(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_slots int default 1,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_resource record;
  v_start_local timestamp;
  v_end_local timestamp;
  v_day smallint;
  v_hours public.sports_hours;
  v_end_at timestamptz;
  v_expires_at timestamptz;
  v_price int;
  v_total bigint := 0;
  v_used int;
  v_slot_used int;
  v_slot_start timestamptz;
  v_slot_local time;
  v_slot_end_local time;
  v_booking_id uuid;
  v_response_minutes int;
  v_min_lead_minutes int;
  v_max_active_holds int;
  v_active_holds int;
  i int;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  perform pg_advisory_xact_lock(hashtext(p_resource_id::text));
  perform pg_advisory_xact_lock(hashtext('sports-customer:' || v_uid::text));
  select r.id, r.venue_id, r.slot_minutes, r.capacity, v.owner_id, v.name venue_name,
         v.status, v.payment_modes, a.active
    into v_resource
    from public.sports_resources r
    join public.sports_venues v on v.id = r.venue_id
    join public.sports_activities a on a.id = r.activity_id
   where r.id = p_resource_id and r.active;
  perform public._assert(found and v_resource.status = 'verified' and v_resource.active, 'resource is unavailable');
  perform public._assert('pay_at_venue' = any(v_resource.payment_modes),
                         'This venue does not accept pay-at-venue booking yet');
  perform public._assert(v_resource.owner_id <> v_uid, 'venue owners cannot book their own venue');
  v_max_active_holds := coalesce(nullif(public._sports_rule('max_active_holds_per_customer'), '')::int, -1);
  perform public._assert(v_max_active_holds between 1 and 100,
                         'sports booking limit is unavailable');
  select count(*)::int into v_active_holds
    from public.sports_bookings b
   where b.customer_id = v_uid
     and (
       (b.status = 'requested' and b.expires_at > now())
       or (b.status = 'pending_payment' and b.hold_expires_at > now())
       or (b.status = 'awaiting_payment' and b.pay_by > now())
       or (b.status = 'accepted' and b.starts_at > now() and b.payment_mode = 'pay_at_venue')
     );
  perform public._assert(v_active_holds < v_max_active_holds,
                         'You have too many pending sports bookings.');
  perform public._assert(p_starts_at > now() and p_starts_at <= now() + interval '30 days',
                         'start time must be within the next 30 days');
  perform public._assert(p_slots between 1 and 4, 'slot count must be between 1 and 4');
  perform public._assert(p_slots = 1 or public._sports_feature('sports_multi_slot'),
                         'Sports multi-slot booking is turned off right now.');
  perform public._assert(char_length(coalesce(p_note, '')) <= 500, 'request note is too long');
  perform public._assert(extract(second from (p_starts_at at time zone 'Asia/Kolkata')) = 0,
                         'start time must align to a slot boundary');

  v_response_minutes := coalesce(nullif(public._sports_rule('request_response_minutes'), '')::int, -1);
  v_min_lead_minutes := coalesce(nullif(public._sports_rule('min_lead_minutes'), '')::int, -1);
  perform public._assert(v_response_minutes between 5 and 1440
                         and v_min_lead_minutes between 0 and 43200,
                         'sports booking window rules are unavailable');
  perform public._assert(p_starts_at > now() + make_interval(mins => v_min_lead_minutes),
                         'slot must start beyond the configured lead time');

  v_start_local := p_starts_at at time zone 'Asia/Kolkata';
  v_end_at := p_starts_at + make_interval(mins => v_resource.slot_minutes * p_slots);
  v_end_local := v_end_at at time zone 'Asia/Kolkata';
  v_day := extract(dow from v_start_local)::smallint;
  select * into v_hours from public.sports_hours h
   where h.venue_id = v_resource.venue_id and h.weekday = v_day;
  perform public._assert(found, 'venue is closed on that day');
  perform public._assert(v_start_local::date = v_end_local::date
                         and v_start_local::time >= v_hours.opens
                         and v_end_local::time <= v_hours.closes,
                         'requested time is outside opening hours');
  perform public._assert(
    mod(extract(epoch from (v_start_local::time - v_hours.opens))::int, v_resource.slot_minutes * 60) = 0,
    'start time is not aligned to the venue slot schedule'
  );
  v_expires_at := least(
    p_starts_at - make_interval(mins => v_min_lead_minutes),
    now() + make_interval(mins => v_response_minutes)
  );
  perform public._assert(v_expires_at > now(), 'slot is inside the configured lead time');
  perform public._assert(not exists (
    select 1 from public.sports_blocks b
     where b.resource_id = p_resource_id and b.starts_at < v_end_at and b.ends_at > p_starts_at
  ), 'slot is blocked by the venue');
  v_used := 0;
  for i in 0 .. p_slots - 1 loop
    v_slot_start := p_starts_at + make_interval(mins => v_resource.slot_minutes * i);
    select coalesce(sum(b.participants), 0)::int into v_slot_used
      from public.sports_bookings b
     where b.resource_id = p_resource_id
       and b.starts_at < v_slot_start + make_interval(mins => v_resource.slot_minutes)
       and b.ends_at > v_slot_start
       and (
         b.status = 'accepted'
         or (b.status = 'requested' and b.expires_at > now())
         or (b.status = 'awaiting_payment' and b.pay_by > now())
         or (b.status = 'pending_payment' and b.hold_expires_at > now())
       );
    v_used := greatest(v_used, v_slot_used);
  end loop;
  perform public._assert(v_used + 1 <= v_resource.capacity, 'slot is no longer available');

  for i in 0 .. p_slots - 1 loop
    v_slot_start := p_starts_at + make_interval(mins => v_resource.slot_minutes * i);
    v_slot_local := (v_slot_start at time zone 'Asia/Kolkata')::time;
    v_slot_end_local := ((v_slot_start + make_interval(mins => v_resource.slot_minutes)) at time zone 'Asia/Kolkata')::time;
    select r.price_paise into v_price
      from public.sports_price_rules r
     where r.resource_id = p_resource_id
       and (r.weekday = v_day or r.weekday is null)
       and r.starts <= v_slot_local and r.ends >= v_slot_end_local
     order by (r.weekday is null), r.starts
     limit 1;
    perform public._assert(v_price is not null, 'no price rule covers every requested slot');
    v_total := v_total + v_price;
  end loop;
  perform public._assert(v_total <= 2147483647, 'total price is too large');

  insert into public.sports_bookings
    (customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise, note, expires_at,
     payment_mode, participants, total_paise, commission_bp)
  values
    (v_uid, v_resource.venue_id, p_resource_id, p_starts_at, v_end_at, 'requested', v_total::int,
     coalesce(p_note, ''), v_expires_at, 'pay_at_venue', 1, v_total::int,
     nullif(public._sports_rule('commission_bp'), '')::int)
  returning id into v_booking_id;

  begin
    perform public._queue_notification(
      v_resource.owner_id, 'sports_booking_requested', null, 'New sports venue request',
      v_resource.venue_name || ' has a new booking request.',
      jsonb_build_object('sports_booking_id', v_booking_id, 'url', '/sports-booking/' || v_booking_id::text),
      'sports-booking-request:' || v_booking_id::text
    );
  exception when others then
    raise warning 'sports notification skipped: %', sqlerrm;
  end;
  return v_booking_id;
end;
$$;

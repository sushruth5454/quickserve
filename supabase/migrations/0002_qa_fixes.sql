-- QA fixes found in end-to-end testing against the dev project.
-- 1. search_providers no longer lists the signed-in user's own provider profile (they cannot book themselves).
-- 2. A change order that lowers the approved total refunds the overpayment automatically instead of leaving it
--    for a manual refund. Amounts owed are computed net of queued/processed partial refunds (_net_paid).

-- Paid amount still held for the booking: paid payments minus their non-failed (partial) refunds.
create or replace function public._net_paid(p_booking_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (coalesce(sum(p.amount), 0)
          - coalesce(sum((select sum(r.amount) from public.refunds r where r.payment_id = p.id and r.status <> 'failed')), 0))::int
    from public.payments p
   where p.booking_id = p_booking_id and p.status = 'paid';
$$;
revoke execute on function public._net_paid(uuid) from public, anon, authenticated;

create or replace function public.search_providers(
  p_category_slug text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_sort text default 'recommended',
  p_min_rating numeric default null,
  p_skill_level public.skill_level default null,
  p_max_visit_fee int default null,
  p_online_only boolean default false,
  p_limit int default 50
)
returns table (
  provider_id uuid,
  provider_service_id uuid,
  full_name text,
  avatar_url text,
  city text,
  skill_level public.skill_level,
  visit_fee int,
  labour_rate int,
  rate_unit public.rate_unit,
  rating_avg numeric,
  rating_count int,
  jobs_completed int,
  years_experience int,
  is_online boolean,
  distance_km double precision,
  score double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with origin as (
    select case when p_lat is not null and p_lng is not null
                then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
           end as g
  ),
  city_avg as (
    select p.city, avg(r.rating)::numeric as m
      from public.reviews r join public.providers p on p.id = r.provider_id
     group by p.city
  ),
  stats as (
    select b.provider_id,
           count(*) filter (where b.status in ('completed', 'closed'))::numeric as done,
           count(*) filter (where b.accepted_at is not null)::numeric as accepted,
           avg(extract(epoch from (b.accepted_at - b.created_at)) / 60.0)
             filter (where b.accepted_at is not null) as avg_response_min
      from public.bookings b
     group by b.provider_id
  ),
  base as (
    select pr.id as provider_id,
           ps.id as provider_service_id,
           pf.full_name,
           pf.avatar_url,
           pr.city,
           ps.skill_level,
           ps.visit_fee,
           ps.labour_rate,
           ps.rate_unit,
           pr.rating_avg,
           pr.rating_count,
           pr.jobs_completed,
           pr.years_experience,
           pr.is_online,
           case when o.g is not null and pr.base_location is not null
                then extensions.st_distance(pr.base_location, o.g) / 1000.0 end as distance_km,
           ((10 * coalesce(ca.m, 4.0) + pr.rating_avg * pr.rating_count) / (10 + pr.rating_count))::double precision as bayes,
           coalesce(s.done / nullif(s.accepted, 0), 0.8)::double precision as completion_rate,
           (case when s.avg_response_min is null then 0.5
                 else 1 - least(s.avg_response_min, 15) / 15.0 end)::double precision as response_speed
      from public.provider_services ps
      join public.categories c on c.id = ps.category_id and c.slug = p_category_slug and c.active
      join public.providers pr on pr.id = ps.provider_id
      join public.profiles pf on pf.id = pr.id
      cross join origin o
      left join city_avg ca on ca.city = pr.city
      left join stats s on s.provider_id = pr.id
     where pr.kyc_status = 'verified'
       and not pr.suspended
       and pr.id is distinct from auth.uid()
       and ps.active
       and (o.g is null or pr.base_location is null
            or extensions.st_dwithin(pr.base_location, o.g, pr.service_radius_km * 1000.0))
       and (p_min_rating is null or pr.rating_avg >= p_min_rating)
       and (p_skill_level is null or ps.skill_level = p_skill_level)
       and (p_max_visit_fee is null or ps.visit_fee <= p_max_visit_fee)
       and (not coalesce(p_online_only, false) or pr.is_online)
  ),
  scored as (
    select b.*,
           0.60 * greatest(least((b.bayes - 1) / 4.0, 1), 0)
         + 0.15 * b.completion_rate
         + 0.15 * (case when b.distance_km is null then 0.5
                        else 1 - b.distance_km / greatest(max(b.distance_km) over (), 1) end)
         + 0.10 * b.response_speed as score
      from base b
  )
  select s.provider_id, s.provider_service_id, s.full_name, s.avatar_url, s.city, s.skill_level,
         s.visit_fee, s.labour_rate, s.rate_unit, s.rating_avg, s.rating_count, s.jobs_completed,
         s.years_experience, s.is_online, s.distance_km, s.score
    from scored s
   order by
     case when p_sort = 'rating' then s.rating_avg end desc nulls last,
     case when p_sort = 'rating' then s.rating_count end desc nulls last,
     case when p_sort = 'price' then s.visit_fee end asc nulls last,
     case when p_sort = 'distance' then s.distance_km end asc nulls last,
     case when p_sort = 'experience' then s.years_experience end desc nulls last,
     s.score desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.approve_quote(p_booking_id uuid, p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  v_initial boolean;
  v_due int;
  v_refunded int;
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can approve');
  select * into q from public.quotes where id = p_quote_id and booking_id = b.id for update;
  perform public._assert(found and q.status = 'sent', 'quote is not open');
  v_initial := b.status = 'quote_sent' and b.approved_quote_id is null;
  perform public._assert(v_initial or (b.status = 'in_progress' and b.approved_quote_id is not null),
                         'quote cannot be approved in this state');

  v_due := public._required_total(q.total, b.visit_fee, b.platform_fee) - public._net_paid(b.id);
  if v_due > 0 then
    update public.quotes set status = 'approved_pending_payment' where id = q.id;
    if v_initial then
      perform public._set_status(b.id, 'awaiting_payment', v_uid, 'quote v' || q.version || ' approved, due ' || v_due);
    else
      perform public._log_event(b.id, v_uid, 'change order v' || q.version || ' approved, due ' || v_due);
    end if;
  else
    perform public._activate_quote(b.id, q.id);
    if v_initial then
      perform public._set_status(b.id, 'in_progress', v_uid, 'quote v' || q.version || ' approved');
    else
      v_refunded := 0;
      if v_due < 0 then
        v_refunded := public._refund_partial(b.id, -v_due, 'change order reduced the total');
        update public.bookings set refund_amount = refund_amount + v_refunded where id = b.id;
      end if;
      perform public._log_event(b.id, v_uid, 'change order v' || q.version || ' approved'
        || case when v_refunded > 0 then ', refund ' || v_refunded else '' end);
    end if;
  end if;
  return jsonb_build_object('amount_due', greatest(v_due, 0));
end;
$$;

create or replace function public.prepare_payment(p_booking_id uuid, p_user_id uuid)
returns table (payment_id uuid, amount int, purpose public.payment_purpose, short_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  v_purpose public.payment_purpose;
  v_amount int;
  v_quote uuid;
  p public.payments;
begin
  perform public._assert(b.customer_id = p_user_id, 'only the customer can pay');
  if b.status = 'pending_payment' then
    v_purpose := 'visit_fee';
    v_amount := b.visit_fee;
  elsif b.status in ('awaiting_payment', 'in_progress') then
    select * into q from public.quotes x
     where x.booking_id = b.id and x.status = 'approved_pending_payment'
     order by x.version desc limit 1;
    perform public._assert(q.id is not null, 'nothing to pay');
    v_purpose := 'balance';
    v_quote := q.id;
    v_amount := public._required_total(q.total, b.visit_fee, b.platform_fee) - public._net_paid(b.id);
  else
    raise exception 'nothing to pay in this state' using errcode = 'P0001';
  end if;
  perform public._assert(v_amount > 0, 'nothing to pay');

  select * into p from public.payments x
   where x.booking_id = b.id and x.status = 'created' and x.purpose = v_purpose
     and x.amount = v_amount and x.quote_id is not distinct from v_quote and x.short_url is not null
   order by x.created_at desc limit 1;
  if found then
    return query select p.id, p.amount, p.purpose, p.short_url;
    return;
  end if;

  update public.payments x set status = 'failed', cancel_link_pending = true where x.booking_id = b.id and x.status = 'created';
  insert into public.payments (booking_id, quote_id, purpose, amount)
  values (b.id, v_quote, v_purpose, v_amount)
  returning * into p;
  return query select p.id, p.amount, p.purpose, null::text;
end;
$$;

create or replace function public.record_payment_paid(p_link_id text, p_payment_id text, p_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  b public.bookings;
  q public.quotes;
  v_required int;
  v_accept boolean;
begin
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into p from public.payments where razorpay_link_id = p_link_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown link');
  end if;
  if p.amount <> p_amount then
    return jsonb_build_object('ok', false, 'error', 'amount mismatch');
  end if;

  b := public._lock_booking(p.booking_id);

  -- Only a live ('created') link for a still-open obligation may count towards the booking.
  if p.status = 'created' then
    if p.purpose = 'visit_fee' and b.status = 'pending_payment' then
      v_required := b.visit_fee;
    elsif p.purpose = 'balance' and p.quote_id is not null then
      select * into q from public.quotes where id = p.quote_id for update;
      if q.status = 'approved_pending_payment' then
        v_required := public._required_total(q.total, b.visit_fee, b.platform_fee);
      end if;
    end if;
  end if;
  v_accept := v_required is not null and public._net_paid(b.id) + p.amount <= v_required;

  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
   where id = p.id;

  if not v_accept then
    perform public._queue_refund(p.id, p.amount, 'stale or excess payment');
    perform public._log_event(b.id, null, 'payment ' || p_payment_id || ' not owed; queued for refund');
    return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund', true);
  end if;

  if p.purpose = 'visit_fee' then
    perform public._set_status(b.id, 'requested', null, 'visit fee paid');
  elsif public._net_paid(b.id) >= v_required then
    perform public._activate_quote(b.id, q.id);
    if b.status = 'awaiting_payment' then
      perform public._set_status(b.id, 'in_progress', null, 'balance paid');
    else
      perform public._log_event(b.id, null, 'change order v' || q.version || ' paid');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'booking_id', b.id);
end;
$$;


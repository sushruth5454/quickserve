-- WP H2a; owns: record_payment_paid, record_session_payment_paid, expire_stale_requests,
-- _create_session_booking, create_recurring_plan, _create_fixed_occurrence,
-- respond_recurring_plan, _cancel_recurring_occurrence, pause_recurring_plan,
-- materialize_recurring_schedule, expire_pending_recurring_plans;
-- sources: WS2-T02, WS2-T05, WS2-T10

alter table public.recurring_schedules
  add column if not exists per_visit_paise int,
  add column if not exists platform_fee_paise int;

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
  v_ids uuid[];
  v_required int;
  v_accept boolean;
  v_all_due boolean;
  v_any_at_booking boolean;
  v_all_base boolean;
  v_all_addon boolean;
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

  select array_agg(o.schedule_id) into v_ids
    from public.payment_obligations o where o.payment_id = p.id;
  if v_ids is null and p.schedule_id is not null then
    v_ids := array[p.schedule_id];
  end if;

  if v_ids is not null and b.archetype in ('proposal', 'fixed') then
    perform 1 from public.payment_schedule ps where ps.id = any (v_ids) for update;
    select coalesce(bool_and(ps.status = 'due'), false),
           coalesce(bool_or(ps.due_rule = 'at_booking'), false),
           coalesce(bool_and(ps.obligation_type in ('service', 'platform_fee')), false),
           coalesce(bool_and(ps.obligation_type = 'addon'), false)
      into v_all_due, v_any_at_booking, v_all_base, v_all_addon
      from public.payment_schedule ps
     where ps.id = any (v_ids);
    v_all_due := v_all_due
      and (select coalesce(sum(ps.amount), 0) from public.payment_schedule ps where ps.id = any (v_ids)) = p.amount;

    if b.archetype = 'proposal' then
      v_accept := p.status = 'created' and v_all_due
        and b.status not in ('expired', 'cancelled', 'declined')
        and (not v_any_at_booking or coalesce(b.payment_hold_expires_at, '-infinity') > now());
    else
      select * into q from public.quotes where id = p.quote_id for update;
      v_accept := p.status = 'created' and v_all_due and q.id is not null
        and ((b.status = 'pending_payment' and q.status = 'approved_pending_payment' and v_all_base)
          or (b.status = 'in_progress' and q.status = 'approved_pending_payment' and v_all_addon));
    end if;

    update public.payments
       set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
     where id = p.id;
    if not v_accept then
      perform public._queue_refund(p.id, p.amount, 'stale, expired or excess scheduled payment');
      perform public._log_event(b.id, null, 'payment ' || p_payment_id || ' not owed; refund queued');
      return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund', true);
    end if;

    update public.payment_schedule
       set status = 'paid', payment_id = p.id, paid_at = now(), updated_at = now()
     where id = any (v_ids);

    if b.archetype = 'proposal' then
      update public.bookings set payment_hold_expires_at = null
       where id = b.id
         and not exists (
           select 1 from public.payment_schedule
            where booking_id = b.id and due_rule = 'at_booking' and status <> 'paid'
         );
      if b.status = 'pending_payment' and not exists (
        select 1 from public.payment_schedule
         where booking_id = b.id and due_rule = 'at_booking' and status <> 'paid'
      ) then
        perform 1 from public.service_requests where id = b.service_request_id for update;
        update public.quotes set status = 'approved' where id = b.approved_quote_id;
        update public.service_requests set status = 'booked', updated_at = now() where id = b.service_request_id;
        update public.proposals set status = 'rejected', updated_at = now()
         where request_id = b.service_request_id and status = 'sent' and id <> b.proposal_id;
        update public.bookings set accepted_at = now(), payment_hold_expires_at = null where id = b.id;
        perform public._set_status(b.id, 'confirmed', null, 'advance and platform fee paid');
        perform public._queue_notification(
          b.customer_id, 'proposal_booked', b.id, 'Booking confirmed',
          'Your advance is paid and the provider is confirmed.',
          jsonb_build_object('booking_id', b.id, 'proposal_id', b.proposal_id), 'proposal-booked:' || b.id::text
        );
        perform public._queue_notification(
          b.provider_id, 'proposal_booked', b.id, 'You have a confirmed booking',
          'The customer paid the booking advance.',
          jsonb_build_object('booking_id', b.id, 'proposal_id', b.proposal_id), 'proposal-booked:' || b.id::text
        );
      end if;
    elsif not exists (
      select 1 from public.payment_schedule x
       where x.booking_id = b.id and x.quote_id = q.id and x.status <> 'paid'
    ) then
      perform public._activate_quote(b.id, q.id);
      if b.status = 'pending_payment' then
        perform public._set_status(b.id, 'requested', null, 'fixed package fully paid');
        if b.recurring_schedule_id is not null and exists (
          select 1 from public.recurring_schedules r
           where r.id = b.recurring_schedule_id
             and r.acceptance_mode = 'plan'
             and r.provider_acceptance = 'accepted'
        ) then
          update public.bookings set accepted_at = now() where id = b.id;
          perform public._set_status(b.id, 'accepted', null, 'recurring plan pre-accepted');
        end if;
      else
        perform public._log_event(b.id, null, 'fixed add-on v' || q.version || ' paid');
      end if;
    end if;
    return jsonb_build_object('ok', true, 'booking_id', b.id, 'schedule_ids', to_jsonb(v_ids));
  end if;

  if p.status = 'created' then
    if p.purpose = 'fixed' and b.booking_origin = 'byo' and b.status = 'pending_payment' then
      select * into q from public.quotes where id = p.quote_id for update;
      if q.status = 'approved' then
        v_required := b.total_amount;
      end if;
    elsif p.purpose = 'visit_fee' and b.status = 'pending_payment' then
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
  if p.purpose = 'fixed' then
    update public.bookings set accepted_at = now() where id = b.id;
    perform public._set_status(b.id, 'accepted', null, 'BYO fixed payment received');
  elsif p.purpose = 'visit_fee' then
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

create or replace function public.record_session_payment_paid(
  p_link_id text, p_payment_id text, p_amount int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  b public.bookings;
  v_ids uuid[];
  v_ok boolean;
begin
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into p from public.payments where razorpay_link_id = p_link_id for update;
  if not found or p.booking_id is null then
    return jsonb_build_object('ok', false, 'error', 'not a session payment');
  end if;
  if p.amount <> p_amount then
    return jsonb_build_object('ok', false, 'error', 'amount mismatch');
  end if;
  select array_agg(o.schedule_id) into v_ids from public.payment_obligations o where o.payment_id = p.id;
  if v_ids is null and p.schedule_id is not null then
    v_ids := array[p.schedule_id];
  end if;
  if v_ids is null then
    return jsonb_build_object('ok', false, 'error', 'not a session payment');
  end if;
  b := public._lock_booking(p.booking_id);
  perform 1 from public.payment_schedule x where x.id = any (v_ids) for update;
  select coalesce(bool_and(x.status = 'due'), false) and coalesce(sum(x.amount), 0) = p.amount
    into v_ok
    from public.payment_schedule x
   where x.id = any (v_ids);

  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
   where id = p.id;
  if p.status <> 'created' or b.archetype <> 'time_based' or not v_ok then
    perform public._queue_refund(p.id, p.amount, 'stale or excess session payment');
    return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund', true);
  end if;
  update public.payment_schedule
     set status = 'paid', payment_id = p.id, paid_at = now(), updated_at = now()
   where id = any (v_ids);

  if not exists (
    select 1 from public.payment_schedule x
     where x.booking_id = b.id and x.status in ('upcoming', 'due')
  ) and b.status = 'pending_payment' then
    perform public._set_status(b.id, 'requested', null, 'session paid');
    if b.recurring_schedule_id is not null and exists (
      select 1 from public.recurring_schedules r
       where r.id = b.recurring_schedule_id
         and r.acceptance_mode = 'plan'
         and r.provider_acceptance = 'accepted'
    ) then
      update public.bookings set accepted_at = now() where id = b.id;
      perform public._set_status(b.id, 'accepted', null, 'recurring plan pre-accepted');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'booking_id', b.id, 'schedule_ids', to_jsonb(v_ids));
end;
$$;

create or replace function public.expire_stale_requests()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in select id from public.bookings
            where status = 'requested'
              and recurring_schedule_id is null
              and updated_at < now() - interval '15 minutes'
            for update skip locked loop
    perform public._refund_booking_payments(r.id, 'request expired');
    perform public._set_status(r.id, 'expired', null, 'not accepted within 15 minutes');
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public._create_session_booking(
  p_customer_id uuid,
  p_provider_service_id uuid,
  p_service_package_id uuid,
  p_scheduled_at timestamptz,
  p_duration_min int,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision,
  p_description text,
  p_pack_id uuid default null,
  p_recurring_schedule_id uuid default null,
  p_service_amount_override int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ps public.provider_services;
  sp public.service_packages;
  k public.pack_purchases;
  s public.pack_sessions;
  v_address uuid;
  v_booking uuid;
  v_problem text;
  v_service_amount int;
  v_platform_fee int;
  v_platform_fee_override int;
  v_duration int;
  v_initial_status public.booking_status := 'pending_payment';
begin
  select * into ps from public.provider_services where id = p_provider_service_id and active for update;
  perform public._assert(found, 'service not available');
  perform public._assert(public._provider_is_live(ps.provider_id), 'provider is not available');
  perform public._assert(public._category_docs_ok(ps.provider_id, ps.category_id), 'provider verification is incomplete');
  perform public._assert(ps.provider_id <> p_customer_id, 'cannot book yourself');
  perform public._assert(p_scheduled_at > now() + interval '30 minutes', 'session must be scheduled at least 30 minutes ahead');
  perform public._assert(coalesce(trim(p_address_line), '') <> '' and coalesce(trim(p_city), '') <> '', 'address is required');
  perform public._assert(p_lat between -90 and 90 and p_lng between -180 and 180, 'location is invalid');

  perform pg_advisory_xact_lock(hashtext(ps.provider_id::text));
  v_problem := public._provider_slot_problem(ps.provider_id, p_scheduled_at, false);
  perform public._assert(v_problem is null, coalesce('provider_unavailable: ' || v_problem, 'provider_unavailable'));

  if p_service_package_id is not null then
    sp := public._assert_session_package(ps.id, p_service_package_id);
    v_service_amount := sp.price;
    v_duration := coalesce(sp.duration_min, p_duration_min);
  else
    perform public._assert(p_duration_min between 15 and 480, 'session duration must be between 15 and 480 minutes');
    v_duration := p_duration_min;
    v_service_amount := greatest(round(ps.labour_rate::numeric * v_duration / 60.0), 1);
  end if;
  if p_service_amount_override is not null then
    perform public._assert(p_service_amount_override > 0, 'invalid recurring per-visit amount');
    v_service_amount := p_service_amount_override;
  end if;
  v_platform_fee := 2900;

  if p_pack_id is not null then
    select * into k from public.pack_purchases where id = p_pack_id for update;
    perform public._assert(
      found and k.customer_id = p_customer_id and k.provider_service_id = ps.id and k.status = 'active',
      'pack is not available for this session'
    );
    perform public._assert(k.expires_at > now(), 'pack has expired');
    select * into s
      from public.pack_sessions
     where pack_id = k.id and status = 'available'
     order by seq
     limit 1
     for update;
    perform public._assert(found, 'pack has no unused sessions');
    v_service_amount := s.allocated_amount;
    v_platform_fee := 0;
    v_initial_status := 'requested';
  elsif p_recurring_schedule_id is not null then
    select r.platform_fee_paise into v_platform_fee_override
      from public.recurring_schedules r
     where r.id = p_recurring_schedule_id
       and r.customer_id = p_customer_id
       and r.payment_mode = 'per_session';
    perform public._assert(found, 'recurring schedule does not allow per-session payment');
    if v_platform_fee_override is not null then
      v_platform_fee := v_platform_fee_override;
    end if;
  end if;

  insert into public.addresses (user_id, label, line1, city, lat, lng)
  values (p_customer_id, 'Booking', trim(p_address_line), trim(p_city), p_lat, p_lng)
  returning id into v_address;

  insert into public.bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id,
    description, scheduled_at, status, visit_fee, platform_fee, total_amount,
    archetype, service_window, exclusive, session_duration_min, service_package_id,
    pack_purchase_id, pack_session_id, recurring_schedule_id
  )
  values (
    p_customer_id, ps.provider_id, ps.category_id, ps.id, v_address,
    coalesce(p_description, ''), p_scheduled_at, v_initial_status, 0, v_platform_fee,
    v_service_amount + v_platform_fee, 'time_based',
    tstzrange(p_scheduled_at, p_scheduled_at + (v_duration || ' minutes')::interval, '[)'),
    true, v_duration, p_service_package_id, p_pack_id, s.id, p_recurring_schedule_id
  )
  returning id into v_booking;

  insert into public.booking_secrets (booking_id, start_otp) values (v_booking, public._gen_otp());
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (v_booking, p_customer_id, null, v_initial_status,
    case when p_pack_id is null then 'session payment due' else 'pack session allocated' end);

  if p_pack_id is not null then
    update public.pack_sessions
       set booking_id = v_booking, status = 'allocated', allocated_at = now()
     where id = s.id;
  else
    insert into public.payment_schedule (
      booking_id, seq, obligation_type, label, amount, due_rule, due_at, status, purpose, obligation_kind
    )
    values
      (v_booking, 1, 'service', 'Session service', v_service_amount, 'at_booking', now(), 'due', 'session', 'service'),
      (v_booking, 2, 'platform_fee', 'Platform fee', v_platform_fee, 'at_booking', now(), 'due', 'platform_fee', 'platform_fee');
  end if;
  return v_booking;
end;
$$;

revoke all on function public._create_session_booking(
  uuid, uuid, uuid, timestamptz, int, text, text, double precision, double precision, text, uuid, uuid, int
) from public, anon, authenticated;
grant execute on function public._create_session_booking(
  uuid, uuid, uuid, timestamptz, int, text, text, double precision, double precision, text, uuid, uuid, int
) to service_role;

create or replace function public.create_recurring_plan(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_internal jsonb;
  v_quote jsonb;
  v_id uuid;
  v_acceptance_mode text;
  v_provider_acceptance text;
  v_horizon int := coalesce(nullif(public._recurring_rule('horizon_days'), '')::int, 28);
begin
  perform public._assert(public._recurring_feature('recurring_bookings'), 'Recurring bookings are turned off right now.');
  v_quote := public._recurring_plan_quote(p, v_uid);
  v_internal := v_quote -> 'internal';
  v_acceptance_mode := case
    when public._recurring_feature('recurring_plan_acceptance') then 'plan'
    else 'occurrence'
  end;
  v_provider_acceptance := case
    when v_acceptance_mode = 'plan' then 'pending'
    else 'accepted'
  end;

  insert into public.recurring_schedules (
    customer_id, provider_id, provider_service_id, service_package_id, pack_purchase_id,
    frequency, interval_count, weekdays, month_day, custom_dates, start_time, timezone,
    session_duration_min, payment_mode, billing_frequency, archetype, package_qty,
    per_visit_paise, platform_fee_paise, address_line, city, lat, lng, description,
    starts_on, ends_on, max_occurrences, plan_version, provider_acceptance, acceptance_mode, decided_at
  ) values (
    v_uid, (v_internal ->> 'provider_id')::uuid,
    (v_internal ->> 'provider_service_id')::uuid,
    nullif(v_internal ->> 'service_package_id', '')::uuid,
    null,
    v_internal ->> 'frequency',
    (v_internal ->> 'interval_count')::int,
    array(select value::smallint from jsonb_array_elements_text(v_internal -> 'weekdays') x(value)),
    nullif(v_internal ->> 'month_day', '')::int,
    array(select value::date from jsonb_array_elements_text(v_internal -> 'custom_dates') x(value)),
    (v_internal ->> 'start_time')::time,
    v_internal ->> 'timezone',
    (v_internal ->> 'duration_min')::int,
    'per_session',
    v_internal ->> 'billing_frequency',
    v_internal ->> 'archetype',
    nullif(v_internal ->> 'package_qty', '')::numeric,
    (v_quote -> 'quote' ->> 'per_visit_paise')::int,
    (v_quote -> 'quote' ->> 'platform_fee_paise')::int,
    v_internal ->> 'address_line',
    v_internal ->> 'city',
    (v_internal ->> 'lat')::double precision,
    (v_internal ->> 'lng')::double precision,
    v_internal ->> 'description',
    (v_internal ->> 'starts_on')::date,
    nullif(v_internal ->> 'ends_on', '')::date,
    nullif(v_internal ->> 'max_occurrences', '')::int,
    'v2',
    v_provider_acceptance,
    v_acceptance_mode,
    case when v_provider_acceptance = 'accepted' then now() else null end
  ) returning id into v_id;

  if v_provider_acceptance = 'pending' then
    perform public._queue_notification(
      (v_internal ->> 'provider_id')::uuid,
      'recurring_plan_requested',
      null,
      'Recurring plan request',
      'A customer requested a recurring service plan.',
      jsonb_build_object('recurring_schedule_id', v_id),
      'recurring-plan-request:' || v_id
    );
  else
    perform public.materialize_recurring_schedule(v_id, current_date + v_horizon);
  end if;
  return v_id;
end;
$$;

create or replace function public._create_fixed_occurrence(
  p_schedule_id uuid,
  p_scheduled_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.recurring_schedules;
  v_package public.service_packages;
  v_service public.provider_services;
  v_category public.categories;
  v_address_id uuid;
  v_booking_id uuid;
  v_quote_id uuid;
  v_window tstzrange;
  v_quantity numeric(10,2);
  v_service_total int;
  v_platform_fee int;
  v_duration int;
  v_snapshot jsonb;
begin
  select * into r from public.recurring_schedules where id = p_schedule_id;
  perform public._assert(found and r.archetype = 'fixed', 'fixed recurring plan not found');
  select * into v_service from public.provider_services where id = r.provider_service_id and active for share;
  perform public._assert(found, 'service not available');
  select * into v_category from public.categories where id = v_service.category_id;
  perform public._assert(found and v_category.archetype = 'fixed', 'category must use the fixed archetype');
  select * into v_package
    from public.service_packages
   where id = r.service_package_id and provider_service_id = v_service.id and active and price_type = 'fixed'
   for share;
  perform public._assert(found, 'active fixed package not found');
  v_quantity := coalesce(r.package_qty, v_package.qty_min);
  perform public._assert(
    v_quantity between v_package.qty_min and v_package.qty_max
    and (v_quantity = trunc(v_quantity) or v_package.qty_max > 1),
    'quantity is outside the package bounds'
  );
  perform public._assert(
    v_quantity <= coalesce((public._fixed_booking_config() ->> 'max_quantity')::numeric, 100),
    'quantity exceeds the configured maximum'
  );
  perform public._assert(public._provider_is_live(v_service.provider_id), 'provider is not available');
  perform public._assert_provider_not_paused(v_service.provider_id);
  perform public._assert(public._category_docs_ok(v_service.provider_id, v_category.id), 'provider verification is incomplete');
  v_duration := case
    when v_package.qty_min = 1 and v_package.qty_max = 1 then coalesce(v_package.duration_min, 60)
    else coalesce(v_package.duration_min, 60) * ceil(v_quantity)::int
  end;
  perform public._assert(
    v_duration between 15 and 480,
    'fixed recurring duration must be between 15 and 480 minutes'
  );
  v_service_total := round(v_package.price::numeric * v_quantity)::int;
  if r.per_visit_paise is not null then
    if v_service_total <> r.per_visit_paise then
      raise exception 'price changed – needs customer approval';
    end if;
    v_service_total := r.per_visit_paise;
  end if;
  v_platform_fee := coalesce(
    r.platform_fee_paise,
    greatest(coalesce((public._fixed_booking_config() ->> 'platform_fee_paise')::int, 2900), 0)
  );
  v_window := tstzrange(p_scheduled_at, p_scheduled_at + make_interval(mins => v_duration), '[)');
  perform public._assert(p_scheduled_at > now() + interval '30 minutes', 'session must be scheduled at least 30 minutes ahead');
  perform public._assert_bookable(v_category.id, v_service.provider_id, r.city, 'fixed', v_window);
  perform public._assert_recurring_provider_window(v_service.provider_id, v_window);
  perform public._assert_provider_window_free(v_service.provider_id, v_window, null, true);

  insert into public.addresses (user_id, label, line1, city, lat, lng)
  values (r.customer_id, 'Booking', r.address_line, r.city, r.lat, r.lng)
  returning id into v_address_id;

  v_snapshot := jsonb_build_object(
    'id', v_package.id,
    'title', v_package.title,
    'description', v_package.description,
    'price_type', v_package.price_type,
    'unit', v_package.unit,
    'quantity', v_quantity,
    'unit_price', v_service_total / v_quantity,
    'duration_min', v_package.duration_min,
    'service_duration_min', v_duration,
    'inclusions', to_jsonb(v_package.inclusions),
    'exclusions', to_jsonb(v_package.exclusions),
    'deliverables', v_package.deliverables,
    'usage_rights', v_package.usage_rights,
    'intake', jsonb_build_object('description', r.description)
  );

  insert into public.bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id,
    description, scheduled_at, service_window, status, visit_fee, platform_fee,
    total_amount, archetype, location_mode, booking_origin, service_package_id,
    recurring_schedule_id
  ) values (
    r.customer_id, v_service.provider_id, v_category.id, v_service.id, v_address_id,
    coalesce(nullif(r.description, ''), v_package.title), p_scheduled_at, v_window, 'pending_payment',
    0, v_platform_fee, v_service_total + v_platform_fee, 'fixed', 'at_customer', 'marketplace',
    v_package.id, r.id
  ) returning id into v_booking_id;

  insert into public.booking_secrets (booking_id, start_otp)
  values (v_booking_id, public._gen_otp());

  insert into public.quotes (
    booking_id, version, status, is_change_order, subtotal_labour, subtotal_parts,
    subtotal_other, total, note, quote_type, source_package_id, package_snapshot
  ) values (
    v_booking_id, 1, 'approved_pending_payment', false, 0, 0,
    v_service_total, v_service_total, 'Fixed recurring package quote', 'package',
    v_package.id, v_snapshot
  ) returning id into v_quote_id;

  insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price)
  values (v_quote_id, 'other', v_package.title, v_quantity, v_package.unit, v_service_total / v_quantity);

  insert into public.payment_schedule (
    booking_id, quote_id, seq, obligation_type, label, amount, due_rule, due_at, status
  ) values
    (v_booking_id, v_quote_id, 1, 'service', 'Package payment', v_service_total, 'at_booking', now(), 'due'),
    (v_booking_id, v_quote_id, 2, 'platform_fee', 'Platform fee', v_platform_fee, 'at_booking', now(), 'due');

  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (v_booking_id, r.customer_id, null, 'pending_payment', 'fixed recurring occurrence created');
  return v_booking_id;
end;
$$;

revoke all on function public._create_fixed_occurrence(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.respond_recurring_plan(
  p_id uuid,
  p_accept boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  r public.recurring_schedules;
  v_horizon int := coalesce(nullif(public._recurring_rule('horizon_days'), '')::int, 28);
begin
  perform public._assert(public._recurring_feature('recurring_bookings'), 'Recurring bookings are turned off right now.');
  select * into r from public.recurring_schedules where id = p_id for update;
  perform public._assert(found and public._acts_for(r.provider_id, 'manager'), 'only the provider manager can respond');
  perform public._assert(r.provider_acceptance = 'pending' and r.status = 'active', 'recurring plan is not pending');
  perform public._assert(
    public._recurring_feature('recurring_plan_acceptance'),
    'Plan acceptance is turned off.'
  );

  if p_accept then
    update public.recurring_schedules
       set provider_acceptance = 'accepted', decided_at = now(), decline_reason = null, updated_at = now()
     where id = r.id;
    perform public.materialize_recurring_schedule(r.id, current_date + v_horizon);
    perform public._queue_notification(
      r.customer_id, 'recurring_plan_accepted', null, 'Recurring plan accepted',
      'The provider accepted your recurring plan.',
      jsonb_build_object('recurring_schedule_id', r.id),
      'recurring-plan-accepted:' || r.id
    );
  else
    perform public._assert(char_length(trim(coalesce(p_reason, ''))) between 1 and 300, 'decline reason is required');
    update public.recurring_schedules
       set provider_acceptance = 'declined', decided_at = now(), decline_reason = trim(p_reason),
           status = 'cancelled', cancelled_at = now(), updated_at = now()
     where id = r.id;
    perform public._queue_notification(
      r.customer_id, 'recurring_plan_declined', null, 'Recurring plan declined',
      left(trim(p_reason), 300),
      jsonb_build_object('recurring_schedule_id', r.id, 'reason', trim(p_reason)),
      'recurring-plan-declined:' || r.id
    );
  end if;
end;
$$;

create or replace function public._cancel_recurring_occurrence(
  p_booking_id uuid,
  p_actor_id uuid,
  p_provider_fault boolean,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_outcome jsonb;
begin
  b := public._lock_booking(p_booking_id);
  if b.status::text = 'pending_payment' then
    update public.payments
       set status = 'failed', cancel_link_pending = true
     where booking_id = b.id and status = 'created';
    update public.payment_schedule
       set status = 'waived', updated_at = now()
     where booking_id = b.id and status in ('upcoming', 'due');
    update public.bookings set cancelled_reason = p_reason where id = b.id;
    perform public._set_status(b.id, 'cancelled', p_actor_id, p_reason);
    return 0;
  end if;

  if b.archetype = 'time_based'
     and b.status::text in ('requested', 'accepted') then
    return public._cancel_session_booking(
      b.id, p_actor_id, p_provider_fault and p_actor_id = b.provider_id, p_reason
    );
  end if;

  if p_provider_fault and p_actor_id = b.provider_id then
    v_outcome := public._cancel_booking_by_policy(
      b.id, 'provider', 'provider_cancellation', p_reason, now()
    );
  else
    v_outcome := public._cancel_booking_by_policy(
      b.id, 'customer', 'customer_choice', p_reason, now()
    );
  end if;
  return coalesce((v_outcome ->> 'refund_amount')::int, 0);
end;
$$;

create or replace function public.pause_recurring_plan(
  p_id uuid,
  p_until date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  r public.recurring_schedules;
  b record;
  v_cutoff int := coalesce(nullif(public._recurring_rule('skip_cutoff_hours'), '')::int, 12);
begin
  perform public._assert(public._recurring_feature('recurring_skip_pause'), 'Recurring skip and pause are turned off right now.');
  perform public._assert(p_until is null or p_until >= current_date, 'pause end date must be today or later');
  select * into r from public.recurring_schedules where id = p_id for update;
  perform public._assert(found and r.customer_id = v_uid, 'recurring plan not found');
  if r.status = 'paused' then
    return;
  end if;
  perform public._assert(r.status = 'active', 'recurring plan is not active');
  perform public._assert(r.provider_acceptance = 'accepted', 'pending plan cannot be paused');

  update public.recurring_schedules
     set status = 'paused', paused_at = now(), pause_until = p_until, updated_at = now()
   where id = r.id;

  for b in
    select bk.id, bk.scheduled_at, bk.service_window
      from public.bookings bk
     where bk.recurring_schedule_id = r.id
       and bk.status::text = 'pending_payment'
       and bk.scheduled_at > now() + make_interval(hours => v_cutoff)
       and not exists (
         select 1 from public.payments p where p.booking_id = bk.id and p.status = 'paid'
       )
       and not exists (
         select 1 from public.payment_schedule ps where ps.booking_id = bk.id and ps.status = 'paid'
       )
     for update
  loop
    perform public._cancel_recurring_occurrence(b.id, v_uid, false, 'recurring plan paused');
    insert into public.recurring_occurrence_changes (
      schedule_id, booking_id, occurrence_date, original_at, kind, actor_id, reason
    ) values (
      r.id, b.id, (b.scheduled_at at time zone r.timezone)::date, b.scheduled_at,
      'cancelled', v_uid, 'recurring plan paused'
    );
  end loop;

  perform public._queue_notification(
    r.provider_id, 'recurring_plan_paused', null, 'Recurring plan paused',
    'The customer paused a recurring service plan.',
    jsonb_build_object('recurring_schedule_id', r.id, 'pause_until', p_until),
    'recurring-plan-paused:' || r.id
  );
end;
$$;

create or replace function public.materialize_recurring_schedule(
  p_schedule_id uuid,
  p_through_date date default (current_date + 28)::date
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.recurring_schedules;
  d date;
  v_at timestamptz;
  v_window tstzrange;
  v_duration int;
  v_created int := 0;
  v_occurrences_created int;
  v_horizon_limit date;
  v_reason text;
  v_booking_id uuid;
  v_provider_paused boolean;
  v_current_service_amount int;
begin
  if not public._recurring_feature('recurring_bookings') then
    return 0;
  end if;
  select * into r from public.recurring_schedules where id = p_schedule_id for update;
  perform public._assert(found and r.status = 'active', 'recurring schedule is not active');
  perform public._assert(r.provider_acceptance = 'accepted', 'recurring plan has not been accepted');
  if r.acceptance_mode = 'plan' and not public._recurring_feature('recurring_plan_acceptance') then
    update public.recurring_schedules set acceptance_mode = 'occurrence', updated_at = now() where id = r.id;
    r.acceptance_mode := 'occurrence';
  end if;
  v_horizon_limit := r.starts_on + coalesce(nullif(public._recurring_rule('max_plan_days'), '')::int, 365);
  p_through_date := least(
    p_through_date,
    v_horizon_limit,
    coalesce(r.ends_on, p_through_date)
  );
  d := greatest(r.starts_on, coalesce(r.generated_through + 1, current_date));
  v_occurrences_created := greatest(
    r.occurrences_created,
    (select count(*)::int from public.bookings b where b.recurring_schedule_id = r.id)
  );

  while d <= p_through_date loop
    if r.max_occurrences is not null and v_occurrences_created >= r.max_occurrences then
      exit;
    end if;
    if not exists (
      select 1
        from public._recurrence_dates(r, d, d) occurrence_date
    ) then
      d := d + 1;
      continue;
    end if;
    if exists (
      select 1 from public.recurring_occurrence_changes c
       where c.schedule_id = r.id
         and c.occurrence_date = d
         and c.kind in ('skipped', 'provider_unavailable', 'cancelled', 'provider_absent')
    ) then
      d := d + 1;
      continue;
    end if;
    v_at := make_timestamptz(
      extract(year from d)::int,
      extract(month from d)::int,
      extract(day from d)::int,
      extract(hour from r.start_time)::int,
      extract(minute from r.start_time)::int,
      extract(second from r.start_time),
      r.timezone
    );
    if exists (
      select 1 from public.bookings b
       where b.recurring_schedule_id = r.id and b.scheduled_at = v_at
    ) then
      d := d + 1;
      continue;
    end if;
    if exists (
      select 1 from public.recurring_occurrence_changes c
       where c.schedule_id = r.id
         and c.occurrence_date = d
         and c.kind = 'rescheduled'
    ) then
      d := d + 1;
      continue;
    end if;
    if r.plan_version = 'v2' and not exists (
      select 1
        from public.provider_services ps
        join public.categories c on c.id = ps.category_id
       where ps.id = r.provider_service_id
         and ps.active
         and c.active
         and c.recurrence_allowed
         and c.archetype = r.archetype
         and r.frequency = any(c.allowed_frequencies)
    ) then
      perform public._record_recurring_unavailable(
        r.id, d, v_at, 'recurring service/category is no longer eligible'
      );
      d := d + 1;
      continue;
    end if;

    v_duration := case
      when r.archetype = 'fixed' then coalesce((
        select case
          when sp.qty_min = 1 and sp.qty_max = 1 then coalesce(sp.duration_min, 60)
          else coalesce(sp.duration_min, 60) * ceil(coalesce(r.package_qty, sp.qty_min))::int
        end
        from public.service_packages sp where sp.id = r.service_package_id
      ), 60)
      else coalesce(r.session_duration_min, 60)
    end;
    v_window := tstzrange(v_at, v_at + make_interval(mins => v_duration), '[)');
    if v_at < now() + interval '60 minutes' then
      perform public._record_recurring_unavailable(r.id, d, v_at, 'planned time is less than 60 minutes away');
      d := d + 1;
      continue;
    end if;
    select coalesce(p.paused, false) into v_provider_paused
      from public.providers p where p.id = r.provider_id;
    if coalesce(v_provider_paused, false) then
      perform public._record_recurring_unavailable(r.id, d, v_at, 'provider is paused');
      d := d + 1;
      continue;
    end if;
    if exists (
      select 1 from public.provider_time_off t
       where t.provider_id = r.provider_id and t.period && v_window
    ) then
      perform public._record_recurring_unavailable(r.id, d, v_at, 'provider time off');
      d := d + 1;
      continue;
    end if;

    begin
      perform public._assert_recurring_provider_window(r.provider_id, v_window);
      perform public._assert_provider_window_free(r.provider_id, v_window, null, true);
      if r.archetype = 'time_based' then
        if r.per_visit_paise is not null then
          if r.service_package_id is not null then
            select sp.price into v_current_service_amount
              from public.service_packages sp
             where sp.id = r.service_package_id and sp.provider_service_id = r.provider_service_id
             for share;
          else
            select greatest(round(ps.labour_rate::numeric * r.session_duration_min / 60.0), 1)::int
              into v_current_service_amount
              from public.provider_services ps where ps.id = r.provider_service_id
             for share;
          end if;
          if v_current_service_amount is not null
             and v_current_service_amount <> r.per_visit_paise then
            perform public._record_recurring_unavailable(
              r.id, d, v_at, 'price changed – needs customer approval'
            );
            d := d + 1;
            continue;
          end if;
        end if;
        v_booking_id := public._create_session_booking(
          r.customer_id, r.provider_service_id, r.service_package_id, v_at,
          r.session_duration_min, r.address_line, r.city, r.lat, r.lng, r.description,
          case when r.payment_mode in ('pack_prepaid', 'monthly_prepaid') then r.pack_purchase_id else null end,
          r.id,
          r.per_visit_paise
        );
      else
        v_booking_id := public._create_fixed_occurrence(r.id, v_at);
      end if;
      v_created := v_created + 1;
      v_occurrences_created := v_occurrences_created + 1;
    exception
      when unique_violation then
        null;
      when others then
        v_reason := sqlerrm;
        if v_reason ilike 'provider_unavailable%'
           or v_reason ilike '%provider_on_leave%'
           or v_reason ilike '%outside_working_hours%'
           or v_reason ilike '%fully_booked%'
           or v_reason ilike '%provider is not available%'
           or v_reason ilike '%provider is paused%'
           or v_reason ilike '%category_not_bookable%'
           or v_reason ilike '%recurring service/category is no longer eligible%'
           or (r.plan_version = 'legacy' and v_reason = 'service not available')
           or v_reason = 'address is required'
           or v_reason ilike '%provider verification is incomplete%'
           or v_reason ilike '%session package is unavailable%'
           or v_reason ilike '%package does not belong to this service%'
           or v_reason ilike '%session package must be fixed-price%'
           or v_reason ilike '%session package price is required%'
           or v_reason ilike '%active fixed package not found%'
           or v_reason ilike '%category must use the fixed archetype%'
           or v_reason ilike '%quantity is outside the package bounds%'
           or v_reason ilike '%quantity exceeds the configured maximum%'
           or v_reason = 'fixed recurring duration must be between 15 and 480 minutes'
           or v_reason = 'price changed – needs customer approval'
           or v_reason ilike '%pack is not available for this session%'
           or v_reason ilike '%pack has expired%'
           or v_reason ilike '%pack has no unused sessions%' then
          perform public._record_recurring_unavailable(r.id, d, v_at, v_reason);
        else
          raise;
        end if;
    end;
    d := d + 1;
  end loop;

  update public.recurring_schedules
     set generated_through = greatest(coalesce(generated_through, p_through_date), p_through_date),
         occurrences_created = v_occurrences_created,
         status = case
           when (
             (ends_on is not null and ends_on <= p_through_date)
             or (max_occurrences is not null and v_occurrences_created >= max_occurrences)
           ) and not exists (
               select 1
                 from public.bookings future
                where future.recurring_schedule_id = r.id
                  and future.scheduled_at > now()
                  and future.status::text in (
                    'pending_payment', 'requested', 'accepted', 'confirmed', 'en_route',
                    'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress',
                    'completion_requested'
                  )
             )
             then 'completed'
           else status
         end,
         updated_at = now()
   where id = r.id;
  return v_created;
end;
$$;

create or replace function public.expire_pending_recurring_plans()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id, customer_id
      from public.recurring_schedules
     where status = 'active'
       and provider_acceptance = 'pending'
       and created_at <= now() - interval '72 hours'
     order by created_at, id
     for update skip locked
  loop
    update public.recurring_schedules
       set provider_acceptance = 'declined',
           decided_at = now(),
           decline_reason = 'Provider did not respond within 72 hours',
           status = 'cancelled',
           cancelled_at = now(),
           updated_at = now()
     where id = r.id;
    perform public._queue_notification(
      r.customer_id, 'recurring_plan_declined', null, 'Plan request expired',
      'The provider did not respond to your recurring plan request within 72 hours.',
      jsonb_build_object('recurring_schedule_id', r.id, 'reason', 'provider_timeout'),
      'recurring-plan-expired:' || r.id
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.expire_pending_recurring_plans() from public, anon, authenticated;
grant execute on function public.expire_pending_recurring_plans() to service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'expire-pending-recurring-plans';
    perform cron.schedule(
      'expire-pending-recurring-plans',
      '0 * * * *',
      'select public.expire_pending_recurring_plans()'
    );
  end if;
end;
$$;

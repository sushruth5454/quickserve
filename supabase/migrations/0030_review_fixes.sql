-- Final-review fixes (code review + design review of d26ca3f..0029). Every copied function below is the
-- exact latest body with a minimal, commented edit; new functions follow at the end.
--
--  1. Time-based sessions could not be created (payment_schedule.obligation_type NOT NULL) and had no
--     state machine beyond cancellation, so paying/starting/completing a session failed.
--  2. Session cancellation recorded refunds twice and a charged late cancellation tried completed -> cancelled.
--  3. Cancellation refunds: refunds on already fully-refunded payments reduced later refunds; date rules could
--     make a provider-caused cancellation pay the provider and refund nothing.
--  4. An expired proposal hold kept any obligation already paid.
--  5. One session awaiting auto-confirm aborted the whole auto-confirm job.
--  6. Provider links: platform host checks; label-only edits no longer re-approve a rejected destination.
--  7. Proposals without deliverables could not be completed; fixed/proposal lacked expiry/dispute/close rows.
--  8. Sessions pay service + platform fee in one payment (as 0029 does for proposal/fixed).
--  9. prepare_schedule_payment pays every due obligation together (no fee-only link beside a combined one).
-- 10. Proposal payment default now settles (refund / provider compensation) through the policy engine.
-- 11. Checkout preparation functions trust a p_user_id argument: service role only.
-- 12. Demo builds settle demo-provider bookings server-side instead of only simulating success.

-- 1. Session bookings: classify payment_schedule rows (obligation_type is NOT NULL since 0019).
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
  p_recurring_schedule_id uuid default null
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
    perform public._assert(
      exists (
        select 1 from public.recurring_schedules r
         where r.id = p_recurring_schedule_id
           and r.customer_id = p_customer_id
           and r.payment_mode = 'per_session'
      ),
      'recurring schedule does not allow per-session payment'
    );
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
  values (v_booking, p_customer_id, null, v_initial_status, case when p_pack_id is null then 'session payment due' else 'pack session allocated' end);

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

-- 2. Session cancellation: refund recorded once; a charged late cancellation stays completed.
create or replace function public._cancel_session_booking(
  p_booking_id uuid, p_actor uuid, p_provider_fault boolean, p_reason text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  v_hours numeric;
  v_refund int := 0;
begin
  perform public._assert(
    b.archetype = 'time_based'
    and b.status in ('pending_payment', 'requested', 'accepted'),
    'session can no longer be cancelled'
  );
  v_hours := extract(epoch from (b.scheduled_at - now())) / 3600.0;

  update public.payments
     set status = 'failed', cancel_link_pending = true
   where booking_id = b.id and status = 'created';
  update public.bookings set cancelled_reason = p_reason where id = b.id;

  if b.pack_session_id is not null then
    update public.pack_sessions
       set booking_id = null,
           status = case when p_provider_fault or v_hours >= 12 then 'available' else 'consumed' end,
           allocated_at = null
     where id = b.pack_session_id;
    if not p_provider_fault and v_hours < 12 then
      perform public._finalize_session_completion(b.id, p_actor);
      update public.pack_sessions
         set status = 'consumed', booking_id = b.id
       where id = b.pack_session_id;
      return 0;
    end if;
  elsif p_provider_fault or v_hours >= 12 then
    v_refund := public._refund_booking_payments(b.id, coalesce(p_reason, 'session cancelled'));
  else
    perform public._finalize_session_completion(b.id, p_actor);
  end if;

  -- Re-read: the late-cancellation branch above completes (charges) the session.
  if (select x.status from public.bookings x where x.id = b.id) <> 'completed' then
    perform public._set_status(b.id, 'cancelled', p_actor, p_reason);
  end if;
  update public.bookings set refund_amount = refund_amount + v_refund where id = b.id;
  return v_refund;
end;
$$;

-- 3. Cancellation evaluator: prior refunds counted only on paid payments (as _net_paid does);
--    provider/platform-caused cancellations always refund the customer in full.
create or replace function public._cancellation_outcome(
  p_booking_id uuid,
  p_actor text,
  p_reason text,
  p_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_rule jsonb;
  v_result jsonb;
  v_paid int;
  v_explicit_platform int;
  v_platform int := 0;
  v_principal int;
  v_advance int;
  v_milestones int;
  v_prior_refunds int;
  v_service_refund int := 0;
  v_platform_refund int := 0;
  v_refundable int;
  v_hours_before numeric;
  v_hours_since numeric;
  v_retained int;
begin
  select * into b from public.bookings where id = p_booking_id;
  perform public._assert(found, 'booking not found');
  perform public._assert(p_actor in ('customer', 'provider', 'platform', 'system'), 'invalid cancellation actor');
  perform public._assert(
    p_reason in ('customer_choice', 'provider_fault', 'provider_cancellation', 'provider_no_show',
                 'customer_payment_default', 'customer_no_show', 'platform'),
    'invalid cancellation reason'
  );

  select coalesce(sum(p.amount) filter (where p.status = 'paid'), 0)::int,
         coalesce(sum(p.amount) filter (
           where p.status = 'paid' and p.purpose::text = 'platform_fee'
         ), 0)::int,
         coalesce(sum(p.amount) filter (
           where p.status = 'paid' and p.purpose::text = 'advance'
         ), 0)::int
    into v_paid, v_explicit_platform, v_advance
    from public.payments p
   where p.booking_id = b.id;

  -- Schedule rows are the source of truth for the fee/advance split: one payment may cover several
  -- obligations (0029), so payments.purpose alone no longer identifies the platform fee or advance.
  if exists (select 1 from public.payment_schedule ps where ps.booking_id = b.id and ps.payment_id is not null) then
    select coalesce(sum(ps.amount) filter (
             where ps.obligation_type = 'platform_fee' or ps.obligation_kind = 'platform_fee'
           ), 0)::int,
           coalesce(sum(ps.amount) filter (where ps.purpose = 'advance'), 0)::int
      into v_explicit_platform, v_advance
      from public.payment_schedule ps
     where ps.booking_id = b.id and ps.payment_id is not null and ps.status in ('paid', 'refunded');
  end if;
  if v_explicit_platform > 0 then
    v_platform := least(b.platform_fee, v_explicit_platform);
  elsif b.platform_fee > 0 and b.total_amount is not null then
    v_platform := least(
      b.platform_fee,
      greatest(v_paid - greatest(b.total_amount - b.platform_fee, b.visit_fee, 0), 0)
    );
  end if;
  v_principal := greatest(v_paid - v_platform, 0);
  v_advance := least(v_advance, v_principal);
  v_milestones := greatest(v_principal - v_advance, 0);

  select coalesce(sum(r.amount) filter (where r.status <> 'failed'), 0)::int
    into v_prior_refunds
    from public.refunds r
    join public.payments p on p.id = r.payment_id
   where p.booking_id = b.id and p.status = 'paid';

  v_hours_before := extract(epoch from (b.scheduled_at - p_at)) / 3600.0;
  v_hours_since := greatest(extract(epoch from (p_at - b.created_at)) / 3600.0, 0);

  if p_reason in ('provider_fault', 'provider_cancellation', 'provider_no_show', 'platform') then
    -- The customer is never charged for a cancellation they did not cause, whatever the snapshot's
    -- date-based rules say (those describe customer cancellations).
    v_rule := jsonb_build_object('name', 'not_customer_caused_full_refund',
      'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000));
  else
    select x
      into v_rule
      from jsonb_array_elements(coalesce(b.cancellation_snapshot -> 'rules', '[]'::jsonb)) x
     where public._rule_matches_cancellation(x, p_actor, p_reason, b.status, v_hours_before, v_hours_since)
     order by coalesce((x ->> 'priority')::int, 0) desc
     limit 1;
    perform public._assert(found, 'cancellation policy does not define this outcome');
  end if;
  v_result := v_rule -> 'result';

  if v_result ? 'advance_bp' or v_result ? 'milestone_bp' then
    v_service_refund :=
      floor(v_advance * coalesce((v_result ->> 'advance_bp')::numeric, 0) / 10000)
      + floor(v_milestones * coalesce((v_result ->> 'milestone_bp')::numeric, 0) / 10000);
  else
    v_service_refund :=
      floor(v_principal * coalesce((v_result ->> 'principal_bp')::numeric, 0) / 10000);
  end if;
  v_platform_refund :=
    floor(v_platform * coalesce((v_result ->> 'platform_bp')::numeric, 0) / 10000);

  if v_result ? 'retained_principal_bp' then
    v_retained := floor(v_principal * (v_result ->> 'retained_principal_bp')::numeric / 10000);
    if v_result ? 'retained_paise_max' then
      v_retained := least(v_retained, (v_result ->> 'retained_paise_max')::int);
    end if;
    v_service_refund := least(v_service_refund, greatest(v_principal - v_retained, 0));
  end if;

  -- A cancellation refund can never refund an amount already queued/refunded before this evaluation.
  v_refundable := greatest(v_paid - v_prior_refunds, 0);
  v_service_refund := greatest(least(v_service_refund, v_refundable), 0);
  v_platform_refund := greatest(
    least(v_platform_refund, greatest(v_refundable - v_service_refund, 0)),
    0
  );
  v_principal := greatest(v_principal - least(v_prior_refunds, v_principal), 0);

  return jsonb_build_object(
    'policy_key', b.cancellation_snapshot ->> 'key',
    'policy_version', (b.cancellation_snapshot ->> 'version')::int,
    'rule', v_rule ->> 'name',
    'actor', p_actor,
    'reason', p_reason,
    'evaluated_at', p_at,
    'service_principal_paid', v_principal,
    'platform_fee_paid', v_platform,
    'prior_refunds', v_prior_refunds,
    'service_refund', v_service_refund,
    'platform_refund', v_platform_refund,
    'refund_amount', v_service_refund + v_platform_refund,
    'provider_compensation', greatest(v_principal - v_service_refund, 0),
    'customer_credit', coalesce((v_result ->> 'credit_paise')::int, 0),
    'release_after', p_at + interval '24 hours'
  );
end;
$$;

-- 4. Proposal hold expiry refunds any obligation already paid.
create or replace function public.expire_proposal_flows()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_booking record;
  v_count int := 0;
begin
  for expired_booking in
    select * from public.bookings
     where archetype = 'proposal' and status = 'pending_payment'
       and payment_hold_expires_at <= now()
     for update skip locked
  loop
    update public.payments
       set status = 'failed', cancel_link_pending = true
     where booking_id = expired_booking.id and status = 'created';
    update public.payment_schedule set status = 'waived'
     where booking_id = expired_booking.id and status in ('due', 'upcoming');
    update public.quotes set status = 'superseded'
     where id = expired_booking.approved_quote_id and status in ('sent', 'approved_pending_payment');
    perform public._refund_booking_payments(expired_booking.id, 'proposal payment hold expired');
    perform public._set_status(expired_booking.id, 'expired', null, 'proposal payment hold expired');
    update public.proposals
       set status = case when valid_until > now() then 'sent' else 'expired' end, updated_at = now()
     where id = expired_booking.proposal_id;
    update public.service_requests
       set status = case when expires_at > now() then 'open' else 'expired' end, updated_at = now()
     where id = expired_booking.service_request_id and status = 'closed';
    perform public._queue_notification(
      expired_booking.customer_id, 'proposal_hold_expired', expired_booking.id, 'Proposal hold expired',
      'The payment window closed. Your request is available again.',
      jsonb_build_object('booking_id', expired_booking.id, 'request_id', expired_booking.service_request_id),
      'proposal-hold:' || expired_booking.id::text
    );
    v_count := v_count + 1;
  end loop;

  update public.proposals
     set status = 'expired', updated_at = now()
   where status = 'sent' and valid_until <= now();
  update public.service_requests r
     set status = 'expired', updated_at = now()
   where r.status in ('open', 'closed')
     and r.expires_at <= now()
     and not exists (
       select 1 from public.bookings b
        where b.service_request_id = r.id
          and b.status in ('confirmed', 'accepted', 'en_route', 'in_progress', 'delivery_pending',
                           'completion_requested', 'disputed')
     );
  return v_count;
end;
$$;

-- 5. Auto-confirm dispatches sessions to their own settlement and isolates per-booking failures.
create or replace function public.auto_confirm_completions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_count int := 0;
  v_hours int;
begin
  for b in
    select * from public.bookings where status = 'completion_requested' for update skip locked
  loop
    v_hours := case when b.archetype = 'proposal' and b.delivery_status <> 'not_applicable' then 168 else 24 end;
    if b.completion_requested_at <= now() - make_interval(hours => v_hours)
       and (b.archetype <> 'proposal' or not exists (
         select 1 from public.payment_schedule where booking_id = b.id and status <> 'paid'
       )) then
      begin
        if b.delivery_status = 'submitted' then
          update public.bookings set delivery_status = 'accepted', delivery_accepted_at = now() where id = b.id;
        end if;
        if b.archetype = 'time_based' then
          perform public._finalize_session_completion(b.id, null);
        else
          perform public._finalize_completion(b.id, null, 'auto-confirmed after acceptance window');
        end if;
        v_count := v_count + 1;
      exception when others then
        raise warning 'auto_confirm_completions: booking % skipped: %', b.id, sqlerrm;
      end;
    end if;
  end loop;
  return v_count;
end;
$$;

-- 6a. Provider links must point at the platform they claim to be.
create or replace function public._validate_provider_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host text;
begin
  new.url := trim(coalesce(new.url, ''));
  new.handle := nullif(trim(coalesce(new.handle, '')), '');
  perform public._assert(new.url ~ '^https://' and char_length(new.url) <= 2048, 'link must be a full https URL');
  perform public._assert(
    new.url !~* '(wa\.me|whatsapp\.com/send|t\.me|telegram\.me|upi://|linktr\.ee|bit\.ly|tinyurl\.com)',
    'contact and URL-shortener links are not allowed'
  );
  perform public._assert(
    coalesce(new.handle, '') !~* '([6-9][0-9][[:space:]().-]*[0-9][[:space:]().-]*){4}|@[^[:space:]]+|https?://',
    'contact details are not allowed in a link label'
  );
  v_host := lower(substring(new.url from '^https://([^/:?#]+)'));
  perform public._assert(
    case new.kind
      when 'instagram' then v_host ~ '(^|\.)instagram\.com$'
      when 'youtube' then v_host ~ '(^|\.)(youtube\.com|youtu\.be)$'
      when 'facebook' then v_host ~ '(^|\.)(facebook\.com|fb\.com)$'
      when 'behance' then v_host ~ '(^|\.)behance\.net$'
      when 'google_business' then v_host ~ '^(g\.page|maps\.app\.goo\.gl|business\.google\.com|maps\.google\.com|(www\.)?google\.com)$'
      else true
    end,
    'link does not match the selected platform'
  );
  return new;
end;
$$;

-- 6b. A rejected link is re-approved only when its destination changes (not a label-only edit).
create or replace function public.save_provider_link(p_kind text, p_url text, p_handle text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_id uuid;
begin
  insert into public.provider_links (provider_id, kind, url, handle, status, reviewed_at)
  values (v_uid, p_kind, p_url, p_handle, 'approved', now())
  on conflict (provider_id, kind) do update
    set url = excluded.url,
        handle = excluded.handle,
        status = case
          when public.provider_links.url is distinct from excluded.url then 'approved'
          else public.provider_links.status
        end,
        review_reason = case
          when public.provider_links.url is distinct from excluded.url
            or public.provider_links.handle is distinct from excluded.handle then null
          else public.provider_links.review_reason
        end,
        reviewed_by = case
          when public.provider_links.url is distinct from excluded.url
            or public.provider_links.handle is distinct from excluded.handle then null
          else public.provider_links.reviewed_by
        end,
        reviewed_at = case
          when public.provider_links.url is distinct from excluded.url
            or public.provider_links.handle is distinct from excluded.handle then now()
          else public.provider_links.reviewed_at
        end
  returning id into v_id;
  return v_id;
end;
$$;

-- 7. Lifecycle transitions missing for non-inspect archetypes (0018 only seeded inspect_quote fully).
insert into public.archetype_transitions (archetype, from_status, to_status, actor)
select v.archetype, v.from_status::public.booking_status, v.to_status::public.booking_status, v.actor
  from (values
    -- time_based: pay -> accept -> (travel) -> session -> completion, plus charged late cancellation
    ('time_based', 'pending_payment', 'requested', 'system'),
    ('time_based', 'pending_payment', 'expired', 'system'),
    ('time_based', 'requested', 'accepted', 'provider'),
    ('time_based', 'requested', 'declined', 'provider'),
    ('time_based', 'requested', 'expired', 'system'),
    ('time_based', 'accepted', 'en_route', 'provider'),
    ('time_based', 'accepted', 'in_progress', 'provider'),
    ('time_based', 'en_route', 'in_progress', 'provider'),
    ('time_based', 'in_progress', 'completion_requested', 'provider'),
    ('time_based', 'in_progress', 'disputed', 'customer'),
    ('time_based', 'requested', 'completed', 'customer'),
    ('time_based', 'requested', 'completed', 'provider'),
    ('time_based', 'requested', 'completed', 'system'),
    ('time_based', 'accepted', 'completed', 'customer'),
    ('time_based', 'accepted', 'completed', 'provider'),
    ('time_based', 'accepted', 'completed', 'system'),
    ('time_based', 'completion_requested', 'completed', 'customer'),
    ('time_based', 'completion_requested', 'completed', 'provider'),
    ('time_based', 'completion_requested', 'completed', 'system'),
    ('time_based', 'completion_requested', 'disputed', 'customer'),
    ('time_based', 'completed', 'closed', 'system'),
    ('time_based', 'completed', 'disputed', 'customer'),
    ('time_based', 'disputed', 'refunded', 'admin'),
    ('time_based', 'disputed', 'completed', 'admin'),
    -- fixed: request expiry, auto/provider completion, disputes
    ('fixed', 'requested', 'expired', 'system'),
    ('fixed', 'completion_requested', 'completed', 'provider'),
    ('fixed', 'completion_requested', 'completed', 'system'),
    ('fixed', 'in_progress', 'disputed', 'customer'),
    ('fixed', 'completion_requested', 'disputed', 'customer'),
    ('fixed', 'completed', 'disputed', 'customer'),
    ('fixed', 'disputed', 'refunded', 'admin'),
    ('fixed', 'disputed', 'completed', 'admin'),
    -- proposal: completion without deliverables, close, disputes
    ('proposal', 'in_progress', 'completion_requested', 'provider'),
    ('proposal', 'in_progress', 'disputed', 'customer'),
    ('proposal', 'delivery_pending', 'disputed', 'customer'),
    ('proposal', 'completion_requested', 'disputed', 'customer'),
    ('proposal', 'completed', 'closed', 'system'),
    ('proposal', 'completed', 'disputed', 'customer'),
    ('proposal', 'disputed', 'refunded', 'admin'),
    ('proposal', 'disputed', 'completed', 'admin')
  ) v(archetype, from_status, to_status, actor)
on conflict do nothing;

-- 8. Sessions: one payment for every obligation due now (service + platform fee).
create or replace function public.prepare_session_payment(
  p_booking_id uuid, p_user_id uuid, p_schedule_id uuid default null
)
returns table (payment_id uuid, amount int, purpose public.payment_purpose, short_url text, schedule_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  v_ids uuid[];
  v_sorted uuid[];
  v_total int;
  p public.payments;
begin
  perform public._assert(b.customer_id = p_user_id, 'only the customer can pay');
  perform public._assert(b.archetype = 'time_based', 'not a session booking');
  perform public._assert(b.pack_purchase_id is null, 'prepaid pack sessions do not require payment');
  perform public._assert(b.status = 'pending_payment', 'session is not awaiting payment');

  perform 1 from public.payment_schedule x where x.booking_id = b.id and x.status = 'due' for update;
  select array_agg(x.id order by x.seq), sum(x.amount)::int
    into v_ids, v_total
    from public.payment_schedule x
   where x.booking_id = b.id and x.status = 'due';
  perform public._assert(v_ids is not null and v_total > 0, 'selected payment obligation is not due');
  select array_agg(i order by i) into v_sorted from unnest(v_ids) i;

  select * into p
    from public.payments pay
   where pay.booking_id = b.id and pay.status = 'created' and pay.short_url is not null and pay.amount = v_total
     and (select array_agg(o.schedule_id order by o.schedule_id) from public.payment_obligations o where o.payment_id = pay.id) = v_sorted
   order by pay.created_at desc
   limit 1;
  if found then
    return query select p.id, p.amount, p.purpose, p.short_url, p.schedule_id;
    return;
  end if;

  update public.payments pay
     set status = 'failed', cancel_link_pending = true
   where pay.booking_id = b.id and pay.status = 'created' and pay.pack_purchase_id is null;
  insert into public.payments (booking_id, schedule_id, purpose, amount)
  values (b.id, v_ids[1], 'session', v_total)
  returning * into p;
  insert into public.payment_obligations (payment_id, schedule_id, amount)
  select p.id, x.id, x.amount from public.payment_schedule x where x.id = any (v_ids);
  return query select p.id, p.amount, p.purpose, null::text, p.schedule_id;
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
  end if;
  return jsonb_build_object('ok', true, 'booking_id', b.id, 'schedule_ids', to_jsonb(v_ids));
end;
$$;

-- 9. The per-obligation entry point pays every due obligation together, so a fee-only link can never
--    coexist with (and invalidate) a combined one.
create or replace function public.prepare_schedule_payment(
  p_booking_id uuid, p_user_id uuid, p_schedule_id uuid
)
returns table (payment_id uuid, amount int, purpose public.payment_purpose, short_url text, schedule_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
begin
  select x.payment_id, x.amount, x.purpose, x.short_url
    into d
    from public.prepare_due_payment(p_booking_id, p_user_id) x;
  return query select d.payment_id, d.amount, d.purpose, d.short_url,
                      (select pay.schedule_id from public.payments pay where pay.id = d.payment_id);
end;
$$;

-- 10. Proposal payment default: same overdue checks, settled by the cancellation policy engine.
create or replace function public.cancel_proposal_payment_default(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can report payment default');
  perform public._assert(b.archetype = 'proposal' and b.status in ('confirmed', 'in_progress'),
                         'proposal is not active');
  perform public._assert(exists (
    select 1 from public.payment_schedule ps
     where ps.booking_id = b.id and ps.status = 'due'
       and ps.due_at <= now() - interval '48 hours'
       and ps.reminded_at is not null
  ), 'the milestone is not overdue past the grace period');
  perform public._cancel_booking_by_policy(
    b.id, 'provider', 'customer_payment_default', 'customer payment default', now()
  );
end;
$$;

-- 12. Demo settlement. Only when app_config.demo_payments.enabled, only for the booking's customer, and only
--     for demo providers (auth metadata demo_only) or explicitly listed test providers. Runs the real
--     preparation + webhook settlement with synthetic ids (plink_demo_/pay_demo_), which the refund and
--     link-cancellation jobs skip.
insert into public.app_config (key, value)
values ('demo_payments', '{"enabled": false, "provider_ids": []}'::jsonb)
on conflict (key) do nothing;

create or replace function public.demo_settle_payment(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_cfg jsonb;
  b public.bookings;
  d record;
  v_key text;
  v_result jsonb;
begin
  select value into v_cfg from public.app_config where key = 'demo_payments';
  perform public._assert(coalesce((v_cfg ->> 'enabled')::boolean, false), 'demo payments are disabled');
  select * into b from public.bookings where id = p_booking_id;
  perform public._assert(found and b.customer_id = v_uid, 'only the customer can pay');
  perform public._assert(
    exists (select 1 from auth.users u where u.id = b.provider_id and u.raw_user_meta_data ->> 'demo_only' = 'true')
    or b.provider_id::text in (select jsonb_array_elements_text(coalesce(v_cfg -> 'provider_ids', '[]'::jsonb))),
    'demo payments only work with demo providers'
  );
  if b.archetype = 'time_based' then
    select x.payment_id, x.amount into d from public.prepare_session_payment(b.id, v_uid, null) x;
  else
    select x.payment_id, x.amount into d from public.prepare_payment(b.id, v_uid) x;
  end if;
  v_key := replace(d.payment_id::text, '-', '');
  update public.payments
     set razorpay_link_id = 'plink_demo_' || v_key, short_url = 'demo://payment'
   where id = d.payment_id and status = 'created';
  if b.archetype = 'time_based' then
    v_result := public.record_time_payment_paid('plink_demo_' || v_key, 'pay_demo_' || v_key, d.amount);
  else
    v_result := public.record_payment_paid('plink_demo_' || v_key, 'pay_demo_' || v_key, d.amount);
  end if;
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('amount', d.amount);
end;
$$;
revoke execute on function public.demo_settle_payment(uuid) from public, anon;
grant execute on function public.demo_settle_payment(uuid) to authenticated, service_role;

-- 11. Functions that trust caller-supplied ids or expose other users' money are service-role only.
revoke execute on function
  public.prepare_payment(uuid, uuid),
  public.prepare_fixed_payment(uuid, uuid, uuid),
  public.prepare_schedule_payment(uuid, uuid, uuid),
  public.prepare_session_payment(uuid, uuid, uuid),
  public.prepare_pack_payment(uuid, uuid),
  public.prepare_due_payment(uuid, uuid),
  public._create_session_booking(uuid, uuid, uuid, timestamptz, int, text, text, double precision, double precision, text, uuid, uuid),
  public._cancel_session_booking(uuid, uuid, boolean, text),
  public._finalize_session_completion(uuid, uuid),
  public._cancellation_outcome(uuid, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function
  public.prepare_payment(uuid, uuid),
  public.prepare_fixed_payment(uuid, uuid, uuid),
  public.prepare_schedule_payment(uuid, uuid, uuid),
  public.prepare_session_payment(uuid, uuid, uuid),
  public.prepare_pack_payment(uuid, uuid),
  public.prepare_due_payment(uuid, uuid),
  public._create_session_booking(uuid, uuid, uuid, timestamptz, int, text, text, double precision, double precision, text, uuid, uuid),
  public._cancel_session_booking(uuid, uuid, boolean, text),
  public._finalize_session_completion(uuid, uuid),
  public._cancellation_outcome(uuid, text, text, timestamptz)
to service_role;

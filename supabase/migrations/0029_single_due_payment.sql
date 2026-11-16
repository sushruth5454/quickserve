-- One payment for everything due now (proposal and fixed bookings).
--
-- Obligations stay separate rows in payment_schedule (advance, platform fee, milestones, add-ons), so
-- refunds and payouts are still settled per obligation. What changes is how the customer pays: one
-- Razorpay payment covers every row that is due at that moment (e.g. booking advance + platform fee),
-- recorded in payment_obligations. Before this, a proposal booking needed two separate payments inside
-- the 30-minute hold, and the app's per-row button called an RPC that never existed.
--
-- Also restores the fixed-package settlement that 0023 dropped from record_payment_paid (real fixed
-- payments were being queued for refund instead of confirming the booking), and makes the cancellation
-- evaluator read the platform fee / advance split from the paid schedule rows, so a combined payment
-- refunds exactly like separately paid rows.

create table if not exists public.payment_obligations (
  payment_id uuid not null references public.payments (id) on delete cascade,
  schedule_id uuid not null references public.payment_schedule (id) on delete cascade,
  amount int not null check (amount > 0),
  primary key (payment_id, schedule_id)
);
create index if not exists payment_obligations_schedule_idx on public.payment_obligations (schedule_id);
alter table public.payment_obligations enable row level security;
revoke all on public.payment_obligations from public, anon, authenticated;
grant select, insert, update, delete on public.payment_obligations to service_role;

create or replace function public.prepare_due_payment(p_booking_id uuid, p_user_id uuid)
returns table (payment_id uuid, amount int, purpose public.payment_purpose, short_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  v_ids uuid[];
  v_sorted uuid[];
  v_total int;
  v_first public.payment_schedule;
  v_purpose public.payment_purpose;
  p public.payments;
begin
  perform public._assert(b.customer_id = p_user_id, 'only the customer can pay');
  perform public._assert(b.archetype in ('proposal', 'fixed'), 'not a scheduled booking');
  perform public._assert(b.status not in ('expired', 'cancelled', 'declined', 'refunded'), 'nothing to pay in this state');
  if b.archetype = 'fixed' then
    perform public._assert(b.status in ('pending_payment', 'in_progress'), 'nothing to pay in this state');
  end if;

  perform 1 from public.payment_schedule ps where ps.booking_id = b.id and ps.status = 'due' for update;
  select array_agg(ps.id order by ps.seq), sum(ps.amount)::int
    into v_ids, v_total
    from public.payment_schedule ps
   where ps.booking_id = b.id and ps.status = 'due';
  perform public._assert(v_ids is not null and v_total > 0, 'nothing to pay');

  if b.archetype = 'proposal' and exists (
    select 1 from public.payment_schedule ps where ps.id = any (v_ids) and ps.due_rule = 'at_booking'
  ) then
    perform public._assert(coalesce(b.payment_hold_expires_at, '-infinity') > now(), 'payment hold expired');
  end if;

  select * into v_first from public.payment_schedule ps where ps.id = v_ids[1];
  if b.archetype = 'fixed' then
    v_purpose := 'fixed';
  else
    select ps.purpose::public.payment_purpose into v_purpose
      from public.payment_schedule ps
     where ps.id = any (v_ids) and ps.obligation_type <> 'platform_fee' and ps.obligation_kind <> 'platform_fee'
     order by ps.seq limit 1;
    v_purpose := coalesce(v_purpose, 'platform_fee'::public.payment_purpose);
  end if;

  -- Reuse the live link if it already covers exactly these obligations.
  select array_agg(x order by x) into v_sorted from unnest(v_ids) x;
  select * into p
    from public.payments pay
   where pay.booking_id = b.id and pay.status = 'created' and pay.short_url is not null and pay.amount = v_total
     and (select array_agg(o.schedule_id order by o.schedule_id) from public.payment_obligations o where o.payment_id = pay.id) = v_sorted
   order by pay.created_at desc
   limit 1;
  if found then
    return query select p.id, p.amount, p.purpose, p.short_url;
    return;
  end if;

  -- Retire other live attempts for any of these obligations (single-row or combined).
  update public.payments pay
     set status = 'failed', cancel_link_pending = true
   where pay.booking_id = b.id and pay.status = 'created'
     and (pay.schedule_id = any (v_ids)
          or exists (select 1 from public.payment_obligations o where o.payment_id = pay.id and o.schedule_id = any (v_ids)));

  insert into public.payments (booking_id, quote_id, purpose, amount, schedule_id)
  values (b.id, coalesce(v_first.quote_id, b.approved_quote_id), v_purpose, v_total, v_ids[1])
  returning * into p;
  insert into public.payment_obligations (payment_id, schedule_id, amount)
  select p.id, ps.id, ps.amount from public.payment_schedule ps where ps.id = any (v_ids);
  return query select p.id, p.amount, p.purpose, null::text;
end;
$$;
revoke execute on function public.prepare_due_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_due_payment(uuid, uuid) to service_role;

-- prepare_payment (0027 body): proposal and fixed bookings now pay everything due in one payment.
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
  d record;
begin
  perform public._assert(b.customer_id = p_user_id, 'only the customer can pay');
  if b.archetype in ('fixed', 'proposal') and b.booking_origin is distinct from 'byo' then
    select x.payment_id, x.amount, x.purpose, x.short_url into d
      from public.prepare_due_payment(b.id, p_user_id) x;
    return query select d.payment_id, d.amount, d.purpose, d.short_url;
    return;
  end if;

  if b.booking_origin = 'byo' and b.status = 'pending_payment' then
    select * into q from public.quotes where id = b.approved_quote_id;
    perform public._assert(q.id is not null and q.status = 'approved', 'BYO agreement is missing');
    v_purpose := 'fixed';
    v_quote := q.id;
    v_amount := b.total_amount - public._net_paid(b.id);
  elsif b.status = 'pending_payment' then
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
  update public.payments x set status = 'failed', cancel_link_pending = true
   where x.booking_id = b.id and x.status = 'created';
  insert into public.payments (booking_id, quote_id, purpose, amount)
  values (b.id, v_quote, v_purpose, v_amount)
  returning * into p;
  return query select p.id, p.amount, p.purpose, null::text;
end;
$$;

-- Webhook settlement. Scheduled (proposal/fixed) payments settle every obligation they cover; the
-- legacy visit-fee / balance / BYO path is unchanged from 0023.
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

  select array_agg(o.schedule_id) into v_ids from public.payment_obligations o where o.payment_id = p.id;
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

-- Cancellation evaluator (0021 body) with the schedule-based fee/advance split.
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
   where p.booking_id = b.id;

  v_hours_before := extract(epoch from (b.scheduled_at - p_at)) / 3600.0;
  v_hours_since := greatest(extract(epoch from (p_at - b.created_at)) / 3600.0, 0);

  select x
    into v_rule
    from jsonb_array_elements(coalesce(b.cancellation_snapshot -> 'rules', '[]'::jsonb)) x
   where public._rule_matches_cancellation(x, p_actor, p_reason, b.status, v_hours_before, v_hours_since)
   order by coalesce((x ->> 'priority')::int, 0) desc
   limit 1;
  perform public._assert(found, 'cancellation policy does not define this outcome');
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


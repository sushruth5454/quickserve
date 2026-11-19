-- WP F4; owns: _cancellation_outcome, resolve_dispute, dispute_booking, refund retry and terminal handling;
-- sources: WS6-T06, WS6-T08, WS6-T10, WS6-T17.

alter table public.refunds
  add column if not exists processing_started_at timestamptz;

update public.refunds
   set processing_started_at = now() - interval '30 minutes'
 where status = 'processing'
   and processing_started_at is null;

create index if not exists refunds_stale_processing_idx
  on public.refunds (processing_started_at, next_attempt_at)
  where status = 'processing';

insert into public.archetype_transitions (archetype, from_status, to_status, actor)
values
  ('inspect_quote', 'closed', 'disputed', 'customer'),
  ('fixed', 'closed', 'disputed', 'customer'),
  ('proposal', 'closed', 'disputed', 'customer'),
  ('time_based', 'closed', 'disputed', 'customer'),
  ('remote', 'closed', 'disputed', 'customer')
on conflict do nothing;

create or replace function public.admin_set_dispute_rules(p_max_days_after_close int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_rules jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(
    p_max_days_after_close between 1 and 3650,
    'closed-booking dispute window must be between 1 and 3650 days'
  );
  v_rules := jsonb_build_object('max_days_after_close', p_max_days_after_close);
  insert into public.app_config (key, value, updated_at, updated_by)
  values ('dispute_rules', v_rules, now(), v_uid)
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  insert into public.admin_audit_log (admin_id, action, details)
  values (v_uid, 'set_dispute_rules', jsonb_build_object('max_days_after_close', p_max_days_after_close));
  return v_rules;
end;
$$;

create or replace function public.admin_get_dispute_rules()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rules jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  select c.value into v_rules from public.app_config c where c.key = 'dispute_rules';
  return coalesce(v_rules, jsonb_build_object('max_days_after_close', null));
end;
$$;

create or replace function public.admin_retry_refund(p_refund_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  r public.refunds;
begin
  perform public._assert(public._is_admin(), 'admin only');
  select * into r from public.refunds where id = p_refund_id for update;
  perform public._assert(found and r.status = 'failed', 'only a failed refund can be retried');
  update public.refunds
     set status = 'pending', attempts = 0, next_attempt_at = null,
         processing_started_at = null, last_error = null
   where id = r.id;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (
    v_uid, 'admin_retry_refund', r.id,
    jsonb_build_object('payment_id', r.payment_id, 'amount_paise', r.amount)
  );
  return jsonb_build_object('refund_id', r.id, 'status', 'pending', 'attempts', 0);
end;
$$;

create or replace function public.admin_list_stuck_money()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_refunds jsonb;
  v_transfers jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'refund_id', r.id, 'payment_id', r.payment_id, 'booking_id', p.booking_id,
             'amount', r.amount, 'status', r.status, 'attempts', r.attempts,
             'last_error', r.last_error, 'created_at', r.created_at,
             'processing_started_at', r.processing_started_at
           ) order by r.created_at desc
         ), '[]'::jsonb)
    into v_refunds
    from public.refunds r
    join public.payments p on p.id = r.payment_id
   where r.status = 'failed'
      or (r.status = 'processing'
          and r.processing_started_at <= now() - interval '30 minutes');

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'transfer_id', t.id, 'payout_id', t.payout_id, 'booking_id', po.booking_id,
             'amount', t.amount, 'status', t.status, 'attempts', t.attempts,
             'last_error', t.last_error, 'created_at', t.created_at
           ) order by t.created_at desc
         ), '[]'::jsonb)
    into v_transfers
    from public.payout_transfers t
    join public.payouts po on po.id = t.payout_id
   where t.status in ('failed', 'processing');
  return jsonb_build_object('refunds', v_refunds, 'transfers', v_transfers);
end;
$$;

create or replace function public.claim_due_refunds(p_limit int default 20)
returns table (
  refund_id uuid, payment_id uuid, booking_id uuid, razorpay_payment_id text, amount int, is_full boolean, attempts int
)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update public.refunds r
       set status = 'processing',
           processing_started_at = now(),
           next_attempt_at = null
     where r.id in (
       select x.id
         from public.refunds x
        where x.status = 'pending' and (x.next_attempt_at is null or x.next_attempt_at <= now())
        order by x.created_at
        limit p_limit
        for update skip locked
     )
    returning r.*
  ),
  flagged as (
    update public.payments p
       set status = 'refund_processing'
      from claimed c
     where p.id = c.payment_id and p.status = 'refund_pending'
    returning p.id
  )
  select c.id, c.payment_id, p.booking_id, p.razorpay_payment_id,
         c.amount, c.amount = p.amount, c.attempts
    from claimed c
    join public.payments p on p.id = c.payment_id;
$$;

create or replace function public.claim_stale_processing_refunds(p_older_than interval)
returns table (
  refund_id uuid, payment_id uuid, booking_id uuid, razorpay_payment_id text, amount int, is_full boolean, attempts int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert(
    p_older_than is not null
      and p_older_than >= interval '30 minutes'
      and p_older_than <= interval '24 hours',
    'stale refund age must be between 30 minutes and 24 hours'
  );
  return query
  with claimed as (
    update public.refunds r
       set next_attempt_at = now() + p_older_than
     where r.id in (
       select x.id
         from public.refunds x
        where x.status = 'processing'
          and x.processing_started_at <= now() - p_older_than
          and (x.next_attempt_at is null or x.next_attempt_at <= now())
        order by x.processing_started_at
        limit 50
        for update skip locked
     )
    returning r.*
  )
  select c.id, c.payment_id, p.booking_id, p.razorpay_payment_id,
         c.amount, c.amount = p.amount, c.attempts
    from claimed c
    join public.payments p on p.id = c.payment_id;
end;
$$;

create or replace function public.requeue_stale_processing_refund(p_refund_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._assert(
    exists (
      select 1 from public.refunds r
       where r.id = p_refund_id
         and r.status = 'processing'
         and r.next_attempt_at > now()
    ),
    'stale refund claim is no longer active'
  );
  update public.refunds
     set status = 'pending',
         next_attempt_at = now(),
         processing_started_at = null
   where id = p_refund_id
     and status = 'processing'
     and next_attempt_at > now()
  returning id into v_id;
  perform public._assert(v_id is not null, 'stale refund claim is no longer active');
  update public.payments p
     set status = 'refund_pending'
    from public.refunds r
   where r.id = v_id
     and p.id = r.payment_id
     and p.status = 'refund_processing';
end;
$$;

create or replace function public.complete_refund(p_refund_id uuid, p_razorpay_refund_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment uuid;
begin
  update public.refunds
     set status = 'refunded',
         razorpay_refund_id = p_razorpay_refund_id,
         processed_at = now(),
         processing_started_at = null,
         next_attempt_at = null,
         last_error = null
   where id = p_refund_id and status = 'processing'
  returning payment_id into v_payment;
  if v_payment is null then
    return;
  end if;
  update public.payments p
     set status = 'refunded'
   where p.id = v_payment
     and p.status in ('refund_pending', 'refund_processing')
     and (select coalesce(sum(r.amount), 0)
            from public.refunds r
           where r.payment_id = p.id and r.status = 'refunded') >= p.amount;
end;
$$;

create or replace function public.fail_refund(p_refund_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment uuid;
begin
  update public.refunds
     set attempts = attempts + 1,
         last_error = left(p_error, 2000),
         status = case when attempts + 1 >= 5 then 'failed'::public.refund_status else 'pending'::public.refund_status end,
         next_attempt_at = case when attempts + 1 >= 5 then null
                                else now() + interval '5 minutes' * power(2, attempts) end,
         processing_started_at = null
   where id = p_refund_id and status = 'processing'
  returning payment_id into v_payment;
  update public.payments
     set status = 'refund_pending'
   where id = v_payment and status = 'refund_processing';
end;
$$;

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
   where p.booking_id = b.id
     and p.funding_source is distinct from 'coins';

  if exists (select 1 from public.payment_schedule ps where ps.booking_id = b.id and ps.payment_id is not null) then
    select coalesce(sum(ps.amount) filter (
             where ps.obligation_type = 'platform_fee' or ps.obligation_kind = 'platform_fee'
           ), 0)::int,
           coalesce(sum(ps.amount) filter (where ps.purpose = 'advance'), 0)::int
      into v_explicit_platform, v_advance
      from public.payment_schedule ps
      join public.payments p on p.id = ps.payment_id
     where ps.booking_id = b.id
       and ps.status in ('paid', 'refunded')
       and p.funding_source is distinct from 'coins';
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
   where p.booking_id = b.id
     and p.status = 'paid'
     and p.funding_source is distinct from 'coins';

  v_hours_before := extract(epoch from (b.scheduled_at - p_at)) / 3600.0;
  v_hours_since := greatest(extract(epoch from (p_at - b.created_at)) / 3600.0, 0);

  if p_reason in ('provider_fault', 'provider_cancellation', 'provider_no_show', 'platform') then
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

create or replace function public.dispute_booking(p_booking_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_max_days int;
  v_closed_at timestamptz;
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can raise a dispute');
  perform public._assert(
    b.status::text in ('in_progress', 'completion_requested', 'completed', 'closed'),
    'dispute not allowed in this state'
  );
  if b.status = 'closed' then
    select case
             when c.value ->> 'max_days_after_close' ~ '^[0-9]+$'
             then (c.value ->> 'max_days_after_close')::int
           end
      into v_max_days
      from public.app_config c
     where c.key = 'dispute_rules';
    perform public._assert(
      v_max_days between 1 and 3650,
      'closed-booking dispute window is not configured'
    );
    select max(e.at)
      into v_closed_at
      from public.booking_events e
     where e.booking_id = b.id and e.to_status = 'closed';
    perform public._assert(
      v_closed_at is not null
        and v_closed_at > now() - make_interval(days => v_max_days),
      'dispute window has expired'
    );
  end if;
  perform public._assert(coalesce(trim(p_reason), '') <> '', 'reason is required');
  perform 1 from public.payouts where booking_id = b.id for update;
  perform 1 from public.payout_transfers t
   where t.payout_id in (select id from public.payouts where booking_id = b.id) for update;
  update public.payouts set status = 'frozen' where booking_id = b.id and status = 'pending';
  update public.payout_transfers
     set status = 'failed', last_error = 'dispute: release frozen'
   where status = 'pending'
     and payout_id in (select id from public.payouts where booking_id = b.id);
  perform public._set_status(b.id, 'disputed', v_uid, p_reason);
end;
$$;

create or replace function public.resolve_dispute(
  p_booking_id uuid,
  p_outcome public.dispute_outcome,
  p_refund_amount int default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  po public.payouts;
  v_cash_payment record;
  v_refund int := 0;
  v_refunded int := 0;
  v_cash_net int := 0;
  v_recovery_key text;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(b.status = 'disputed', 'booking is not disputed');
  select * into po from public.payouts where booking_id = b.id for update;

  if p_outcome = 'full_refund' then
    perform public._restore_coins_for_terminal_booking(b.id);
    select coalesce(sum(greatest(p.amount - coalesce(refunds.amount, 0), 0)), 0)::int
      into v_refund
      from public.payments p
      left join lateral (
        select coalesce(sum(rf.amount) filter (where rf.status <> 'failed'), 0)::int as amount
          from public.refunds rf
         where rf.payment_id = p.id
      ) refunds on true
     where p.booking_id = b.id
       and p.razorpay_payment_id is not null
       and p.status in ('paid', 'refund_pending', 'refund_processing', 'refunded');
  elsif p_outcome = 'partial_refund' then
    v_refund := p_refund_amount;
    if po.id is null then
      select coalesce(sum(greatest(p.amount - coalesce(refunds.amount, 0), 0)), 0)::int
        into v_cash_net
        from public.payments p
        left join lateral (
          select coalesce(sum(rf.amount) filter (where rf.status <> 'failed'), 0)::int as amount
            from public.refunds rf
           where rf.payment_id = p.id
        ) refunds on true
       where p.booking_id = b.id
         and p.status = 'paid'
         and p.funding_source is distinct from 'coins'
         and p.razorpay_payment_id is not null;
      perform public._assert(v_refund > 0 and v_refund <= v_cash_net, 'invalid refund amount');
    else
      perform public._assert(v_refund > 0 and v_refund <= po.amount, 'invalid refund amount');
    end if;
  else
    v_refund := 0;
  end if;

  if v_refund > 0 then
    if p_outcome = 'full_refund' then
      for v_cash_payment in
        select p.id,
               greatest(p.amount - coalesce(refunds.amount, 0), 0)::int as amount
          from public.payments p
          left join lateral (
            select coalesce(sum(rf.amount) filter (where rf.status <> 'failed'), 0)::int as amount
              from public.refunds rf
             where rf.payment_id = p.id
          ) refunds on true
         where p.booking_id = b.id
           and p.razorpay_payment_id is not null
           and p.status in ('paid', 'refund_pending', 'refund_processing', 'refunded')
         order by p.paid_at nulls first, p.id
      loop
        if v_cash_payment.amount > 0 then
          v_refunded := v_refunded
            + public._queue_refund(v_cash_payment.id, v_cash_payment.amount, 'dispute: full refund');
        end if;
      end loop;
    else
      v_refunded := public._refund_partial(b.id, v_refund, 'dispute: partial refund');
    end if;
    perform public._assert(v_refunded = v_refund, 'refund exceeds refundable payments');
    update public.bookings set refund_amount = refund_amount + v_refunded where id = b.id;
    v_recovery_key := 'dispute:' || b.id::text || ':' || (b.refund_amount + v_refunded)::text;
    perform public._queue_transfer_reversals(b.id, v_refund, 'dispute: ' || p_outcome::text, v_recovery_key);
  end if;

  if p_outcome = 'full_refund' then
    update public.payout_transfers
       set status = 'failed', last_error = 'dispute: full refund'
     where status::text in ('pending', 'failed')
       and payout_id in (select id from public.payouts where booking_id = b.id);
    update public.payouts set amount = 0 where id = po.id;
    update public.payouts
       set status = case
         when exists (select 1 from public.payout_transfer_reversals x
                       join public.payout_transfers t on t.id = x.payout_transfer_id
                      where t.payout_id = po.id and x.status in ('pending', 'processing')) then 'frozen'::public.payout_status
         when exists (select 1 from public.provider_receivables r
                      where r.booking_id = b.id and r.status = 'open') then 'partially_reversed'::public.payout_status
         else 'reversed'::public.payout_status
       end
     where id = po.id;
    perform public._set_status(b.id, 'refunded', v_uid, coalesce(p_note, 'dispute: full refund'));
  elsif po.id is null then
    if b.archetype = 'time_based' then
      perform public._finalize_session_completion(b.id, v_uid);
    else
      perform public._finalize_completion(b.id, v_uid, 'dispute resolved before completion');
    end if;
  else
    update public.payouts
       set amount = greatest(amount - v_refund, 0),
           status = case when exists (
             select 1 from public.payout_transfer_reversals x
              join public.payout_transfers t on t.id = x.payout_transfer_id
              where t.payout_id = po.id and x.status in ('pending', 'processing')
           ) then 'frozen'::public.payout_status else 'pending'::public.payout_status end,
           release_after = greatest(release_after, now())
     where id = po.id;
    delete from public.payout_transfers
     where payout_id = po.id and status::text = 'failed' and attempts = 0 and reversed_amount = 0;
    perform public._allocate_payout(po.id);
    perform public._set_status(b.id, 'completed', v_uid, 'dispute resolved');
  end if;

  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'resolve_dispute', b.id,
          jsonb_build_object('outcome', p_outcome, 'refund_amount', v_refund, 'note', p_note));
end;
$$;

revoke all on function public.admin_set_dispute_rules(int),
  public.admin_get_dispute_rules(), public.admin_list_stuck_money(), public.admin_retry_refund(uuid)
from public, anon;
grant execute on function public.admin_set_dispute_rules(int),
  public.admin_get_dispute_rules(), public.admin_list_stuck_money(), public.admin_retry_refund(uuid)
to authenticated;

revoke all on function public.claim_stale_processing_refunds(interval),
  public.requeue_stale_processing_refund(uuid)
from public, anon, authenticated;
grant execute on function public.claim_stale_processing_refunds(interval),
  public.requeue_stale_processing_refund(uuid)
to service_role;
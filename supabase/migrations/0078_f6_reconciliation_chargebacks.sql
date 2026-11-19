-- WP F6; owns: claim_stale_processing_transfers, reset_stale_processing_transfer, record_payment_dispute,
-- queue_lost_dispute_reversals, record_refund_status, list_stuck_money_ops, reconciliation_issues,
-- save_reconciliation_report, admin_list_reconciliation_issues; sources: WS6-T07, WS6-T15,
-- WS6-T16, WS8-T09, WS8-T11.

alter table public.payout_transfers
  add column if not exists processing_started_at timestamptz,
  add column if not exists reconciliation_checked_at timestamptz;

update public.payout_transfers
   set processing_started_at = created_at
 where status = 'processing'
   and processing_started_at is null;

create or replace function public._track_transfer_processing_started()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'processing' then
    if tg_op = 'INSERT' then
      new.processing_started_at := coalesce(new.processing_started_at, new.created_at, now());
      new.reconciliation_checked_at := null;
    elsif old.status is distinct from 'processing' then
      new.processing_started_at := now();
      new.reconciliation_checked_at := null;
    else
      new.processing_started_at := coalesce(new.processing_started_at, new.created_at, now());
    end if;
  else
    new.processing_started_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public._track_transfer_processing_started() from public, anon, authenticated, service_role;

drop trigger if exists payout_transfers_processing_started on public.payout_transfers;
create trigger payout_transfers_processing_started
before insert or update of status on public.payout_transfers
for each row execute function public._track_transfer_processing_started();

create index payout_transfers_stale_processing_idx
  on public.payout_transfers (processing_started_at)
  where status = 'processing';

create table public.payment_disputes (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments (id) on delete restrict,
  booking_id uuid references public.bookings (id) on delete restrict,
  sports_booking_id uuid references public.sports_bookings (id) on delete restrict,
  pack_purchase_id uuid references public.pack_purchases (id) on delete restrict,
  amount int not null check (amount > 0),
  status text not null check (status in ('created', 'lost', 'won')),
  prior_booking_status public.booking_status,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(booking_id, sports_booking_id, pack_purchase_id) = 1)
);
alter table public.payment_disputes enable row level security;
revoke all on public.payment_disputes from public, anon, authenticated, service_role;
grant select on public.payment_disputes to authenticated;
grant select, insert, update on public.payment_disputes to service_role;
create policy payment_disputes_admin_read
  on public.payment_disputes for select to authenticated
  using (public._is_admin());
create policy payment_disputes_service_write
  on public.payment_disputes for all to service_role
  using (true) with check (true);

create table public.payment_dispute_payouts (
  payment_id uuid not null references public.payment_disputes (payment_id) on delete restrict,
  payout_id uuid not null references public.payouts (id) on delete restrict,
  prior_status public.payout_status not null,
  created_at timestamptz not null default now(),
  primary key (payment_id, payout_id)
);
alter table public.payment_dispute_payouts enable row level security;
revoke all on public.payment_dispute_payouts from public, anon, authenticated, service_role;
grant select on public.payment_dispute_payouts to authenticated;
create policy payment_dispute_payouts_admin_read
  on public.payment_dispute_payouts for select to authenticated
  using (public._is_admin());

grant select on public.payout_transfer_reversals to authenticated;
create policy payout_transfer_reversals_admin_read
  on public.payout_transfer_reversals for select to authenticated
  using (public._is_admin());

create or replace function public._freeze_new_disputed_payment_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dispute_id uuid;
  has_dispute boolean := false;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  for dispute_id in
    select d.payment_id
     from public.payment_disputes d
     join public.payouts po on po.id = new.payout_id
    where d.status in ('created', 'lost')
      and (
        d.payment_id = new.source_payment_id
        or po.booking_id = d.booking_id
        or po.sports_booking_id = d.sports_booking_id
      )
  loop
    has_dispute := true;
    insert into public.payment_dispute_payouts (payment_id, payout_id, prior_status)
    select dispute_id, po.id, po.status
     from public.payouts po
    where po.id = new.payout_id
      and po.status in ('pending', 'frozen')
    on conflict (payment_id, payout_id) do nothing;
    update public.payouts
      set status = 'frozen'
    where id = new.payout_id and status = 'pending';
  end loop;

  if has_dispute then
    update public.payout_transfers
      set status = 'failed',
          last_error = 'chargeback: release frozen'
    where id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;
revoke all on function public._freeze_new_disputed_payment_transfer() from public, anon, authenticated, service_role;

drop trigger if exists payout_transfers_freeze_disputed_payment on public.payout_transfers;
create trigger payout_transfers_freeze_disputed_payment
after insert on public.payout_transfers
for each row execute function public._freeze_new_disputed_payment_transfer();

create table public.reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  issue_key text not null unique,
  entity_type text not null check (entity_type in ('payment', 'refund', 'payout')),
  issue_code text not null check (issue_code in ('missing_local', 'missing_gateway', 'amount_mismatch')),
  local_id text,
  gateway_id text,
  expected_amount int,
  actual_amount int,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index reconciliation_issues_date_status_idx
  on public.reconciliation_issues (run_date desc, status);
alter table public.reconciliation_issues enable row level security;
revoke all on public.reconciliation_issues from public, anon, authenticated, service_role;
grant select on public.reconciliation_issues to authenticated;
grant select, insert, update on public.reconciliation_issues to service_role;
create policy reconciliation_issues_admin_read
  on public.reconciliation_issues for select to authenticated
  using (public._is_admin());
create policy reconciliation_issues_service_write
  on public.reconciliation_issues for all to service_role
  using (true) with check (true);

create or replace function public.claim_stale_processing_transfers()
returns table (
  transfer_id uuid,
  payout_id uuid,
  source_payment_id uuid,
  razorpay_payment_id text,
  amount int,
  rail text,
  attempts int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    update public.payout_transfers pt
       set reconciliation_checked_at = now()
     where pt.id in (
       select t.id
         from public.payout_transfers t
        where t.status = 'processing'
          and t.processing_started_at <= now() - interval '30 minutes'
          and (t.reconciliation_checked_at is null
            or t.reconciliation_checked_at <= now() - interval '5 minutes')
        order by t.processing_started_at
        limit 50
        for update skip locked
     )
    returning pt.id, pt.payout_id, pt.source_payment_id, pt.amount, pt.rail, pt.attempts
  )
  select c.id, c.payout_id, c.source_payment_id, p.razorpay_payment_id,
         c.amount, coalesce(c.rail, 'route'), c.attempts
    from claimed c
    join public.payments p on p.id = c.source_payment_id;
end;
$$;

create or replace function public.reset_stale_processing_transfer(p_transfer_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reset boolean;
begin
  update public.payout_transfers
     set status = 'pending',
         attempts = attempts + 1,
         next_attempt_at = now() + interval '5 minutes',
         reconciliation_checked_at = null,
         last_error = 'gateway transfer not found during reconciliation'
   where id = p_transfer_id
     and status = 'processing'
     and processing_started_at <= now() - interval '30 minutes'
  returning true into v_reset;
  return coalesce(v_reset, false);
end;
$$;

create or replace function public.record_payment_dispute(
  p_payment_id text,
  p_status text,
  p_amount int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  b public.bookings;
  d public.payment_disputes;
  v_existing boolean := false;
  v_from public.booking_status;
  v_prior_booking_status public.booking_status;
begin
  perform public._assert(coalesce(p_status in ('created', 'lost', 'won'), false), 'invalid payment dispute status');
  perform public._assert(coalesce(p_amount > 0, false), 'dispute amount must be positive');

  select * into p
    from public.payments
   where razorpay_payment_id = p_payment_id
   for update;
  perform public._assert(found, 'payment not found for dispute');
  perform public._assert(p.status in ('paid', 'refund_pending', 'refund_processing', 'refunded'), 'payment is not captured');
  perform public._assert(coalesce(p_amount <= p.amount, false), 'dispute amount exceeds captured payment');
  perform public._assert(
    num_nonnulls(p.booking_id, p.sports_booking_id, p.pack_purchase_id) = 1,
    'payment has no supported dispute parent'
  );
  if p.booking_id is not null then
    select * into b
      from public.bookings
     where id = p.booking_id
     for update;
    perform public._assert(found, 'booking not found for dispute payment');
    v_prior_booking_status := b.status;
  elsif p.sports_booking_id is not null then
    perform 1 from public.sports_bookings where id = p.sports_booking_id for update;
    perform public._assert(found, 'sports booking not found for dispute payment');
  else
    perform 1 from public.pack_purchases where id = p.pack_purchase_id for update;
    perform public._assert(found, 'pack purchase not found for dispute payment');
  end if;

  select * into d
    from public.payment_disputes
   where payment_id = p.id
   for update;
  v_existing := found;

  if v_existing then
    if d.status = p_status or d.status in ('lost', 'won') or d.status <> 'created' then
      return;
    end if;
    if p_status not in ('lost', 'won') then
      return;
    end if;
  end if;

  if not v_existing then
    insert into public.payment_disputes (
      payment_id, booking_id, sports_booking_id, pack_purchase_id,
      amount, status, prior_booking_status
    ) values (
      p.id, p.booking_id, p.sports_booking_id, p.pack_purchase_id,
      p_amount, p_status, v_prior_booking_status
    )
    returning * into d;
  else
    update public.payment_disputes
       set amount = p_amount, status = p_status, updated_at = now()
     where id = d.id
    returning * into d;
  end if;

  if p_status in ('created', 'lost') then
    if p.booking_id is not null and b.status <> 'disputed' then
      v_from := b.status;
      update public.bookings
         set status = 'disputed', updated_at = now()
       where id = b.id;
      insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
      values (b.id, null, v_from, 'disputed', 'Razorpay payment dispute ' || p_status);
    end if;
    insert into public.payment_dispute_payouts (payment_id, payout_id, prior_status)
    select p.id, po.id, po.status
      from public.payouts po
     where po.status in ('pending', 'frozen')
       and (
         po.booking_id = p.booking_id
         or po.sports_booking_id = p.sports_booking_id
         or exists (
           select 1 from public.payout_transfers t
            where t.payout_id = po.id and t.source_payment_id = p.id
         )
       )
    on conflict (payment_id, payout_id) do nothing;
    update public.payouts po
       set status = 'frozen'
      from public.payment_dispute_payouts dp
     where dp.payment_id = p.id and dp.payout_id = po.id and po.status = 'pending';
    update public.payout_transfers
       set status = 'failed',
           last_error = 'chargeback: release frozen'
     where payout_id in (
       select dp.payout_id from public.payment_dispute_payouts dp where dp.payment_id = p.id
     )
       and status = 'pending';
  end if;

  if p_status = 'lost' then
    perform public.queue_lost_dispute_reversals();
  elsif p_status = 'won' and v_existing then
    if p.booking_id is not null and d.prior_booking_status is distinct from 'disputed' then
      if b.status = 'disputed' then
        update public.bookings
           set status = d.prior_booking_status, updated_at = now()
         where id = b.id;
        insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
        values (b.id, null, 'disputed', d.prior_booking_status, 'Razorpay payment dispute won');
      end if;
    end if;
    if p.booking_id is null or d.prior_booking_status is distinct from 'disputed' then
      update public.payouts po
         set status = 'pending',
             release_after = greatest(po.release_after, now())
       where po.status = 'frozen'
         and exists (
           select 1
             from public.payment_dispute_payouts restore_dp
            where restore_dp.payout_id = po.id
              and restore_dp.prior_status = 'pending'
         )
         and not exists (
           select 1
             from public.payment_dispute_payouts other_dp
             join public.payment_disputes other_d on other_d.payment_id = other_dp.payment_id
            where other_dp.payout_id = po.id
              and other_d.status in ('created', 'lost')
         );
      update public.payout_transfers t
         set status = 'pending',
             last_error = null
       where t.status = 'failed'
         and t.last_error = 'chargeback: release frozen'
         and exists (
           select 1
             from public.payment_dispute_payouts restore_dp
            where restore_dp.payout_id = t.payout_id
              and restore_dp.prior_status = 'pending'
         )
         and not exists (
           select 1
             from public.payment_dispute_payouts other_dp
             join public.payment_disputes other_d on other_d.payment_id = other_dp.payment_id
            where other_dp.payout_id = t.payout_id
              and other_d.status in ('created', 'lost')
         );
    end if;
  end if;

  insert into public.financial_events (
    kind, booking_id, sports_booking_id, payment_id, amount_paise, gateway_ref, payload
  ) values (
    'payment_dispute_' || p_status,
    p.booking_id,
    p.sports_booking_id,
    p.id,
    p_amount,
    p_payment_id,
    jsonb_build_object('status', p_status, 'amount_paise', p_amount)
  );
end;
$$;

create or replace function public.queue_lost_dispute_reversals()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  dispute record;
  transfer record;
  v_queued int := 0;
  v_remaining int;
  v_available int;
  v_take int;
  v_recovery_key text;
begin
  for dispute in
    select payment_id, booking_id, amount
      from public.payment_disputes
     where status = 'lost'
     order by created_at
  loop
    if dispute.booking_id is not null then
      v_queued := v_queued + public._queue_transfer_reversals(
        dispute.booking_id,
        dispute.amount,
        'Razorpay payment dispute lost',
        'chargeback:' || dispute.payment_id::text || ':lost'
      );
    else
      v_remaining := dispute.amount;
      for transfer in
        select t.*, po.booking_id, po.provider_id
          from public.payout_transfers t
          join public.payouts po on po.id = t.payout_id
         where t.source_payment_id = dispute.payment_id
           and t.status::text in ('transferred', 'partially_reversed')
         order by t.transferred_at nulls last, t.created_at
         for update of t
      loop
        exit when v_remaining <= 0;
        v_available := transfer.amount - transfer.reversed_amount
          - coalesce((
              select sum(r.amount)
                from public.payout_transfer_reversals r
               where r.payout_transfer_id = transfer.id
                 and r.status in ('pending', 'processing')
            ), 0);
        v_take := least(greatest(v_available, 0), v_remaining);
        if v_take <= 0 then
          continue;
        end if;
        v_recovery_key := 'chargeback:' || dispute.payment_id::text || ':lost:' || transfer.id::text;

        if coalesce(transfer.rail, 'route') = 'route' then
          insert into public.payout_transfer_reversals (
            payout_transfer_id, recovery_key, amount, rail, status
          ) values (
            transfer.id, v_recovery_key, v_take, 'route', 'pending'
          ) on conflict (recovery_key) do nothing;
        else
          insert into public.payout_transfer_reversals (
            payout_transfer_id, recovery_key, amount, rail, status, completed_at, last_error
          ) values (
            transfer.id, v_recovery_key, v_take, 'payouts', 'debt_recorded', now(),
            case when transfer.provider_id is null
                 then 'RazorpayX venue payout cannot be reversed; payee recovery requires operator action'
                 else 'RazorpayX payout cannot be reversed; provider receivable recorded' end
          ) on conflict (recovery_key) do nothing;
          if transfer.provider_id is not null then
            perform public._record_provider_receivable(
              transfer.provider_id,
              transfer.booking_id,
              v_take,
              'Razorpay payment dispute lost',
              v_recovery_key
            );
          end if;
        end if;
        v_remaining := v_remaining - v_take;
        v_queued := v_queued + v_take;
      end loop;
    end if;
  end loop;
  return v_queued;
end;
$$;

create table public.refund_gateway_status_events (
  razorpay_refund_id text not null,
  status text not null check (status in ('processed', 'failed')),
  refund_id uuid not null references public.refunds (id) on delete restrict,
  recorded_at timestamptz not null default now(),
  primary key (razorpay_refund_id, status)
);
alter table public.refund_gateway_status_events enable row level security;
revoke all on public.refund_gateway_status_events from public, anon, authenticated, service_role;

create or replace function public.record_refund_status(
  p_razorpay_refund_id text,
  p_status text,
  p_refund_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.refunds;
  v_refund_id uuid;
  v_event_id text;
  v_attempts int;
begin
  perform public._assert(coalesce(p_status in ('processed', 'failed'), false), 'invalid Razorpay refund status');
  perform public._assert(coalesce(p_razorpay_refund_id, '') <> '', 'Razorpay refund id is required');

  select e.refund_id
    into v_refund_id
    from public.refund_gateway_status_events e
   where e.razorpay_refund_id = p_razorpay_refund_id
   order by e.recorded_at
   limit 1;
  if v_refund_id is null then
    if p_refund_id is not null then
      v_refund_id := p_refund_id;
    else
      select x.id
        into v_refund_id
        from public.refunds x
       where x.razorpay_refund_id = p_razorpay_refund_id;
    end if;
  end if;
  perform public._assert(v_refund_id is not null, 'refund not found for Razorpay refund id');

  select * into r
    from public.refunds x
   where x.id = v_refund_id
   for update;
  perform public._assert(found, 'refund not found for Razorpay refund id');
  if p_refund_id is not null then
    perform public._assert(p_refund_id = r.id, 'refund id does not match gateway refund');
  end if;
  if r.razorpay_refund_id is not null
     and r.razorpay_refund_id <> p_razorpay_refund_id then
    return;
  end if;

  insert into public.refund_gateway_status_events (razorpay_refund_id, status, refund_id)
  values (p_razorpay_refund_id, p_status, r.id)
  on conflict do nothing
  returning razorpay_refund_id into v_event_id;
  if v_event_id is null then
    return;
  end if;

  if p_status = 'processed' then
    update public.refunds
       set status = 'refunded',
           razorpay_refund_id = p_razorpay_refund_id,
           processed_at = coalesce(processed_at, now()),
           next_attempt_at = null,
           last_error = null
     where id = r.id;
    update public.payments p
       set status = 'refunded'
     where p.id = r.payment_id
       and p.status in ('refund_pending', 'refund_processing', 'refunded')
       and (select coalesce(sum(x.amount), 0)
              from public.refunds x
             where x.payment_id = p.id and x.status = 'refunded') >= p.amount;
    insert into public.financial_events (
      kind, booking_id, payment_id, refund_id, amount_paise, gateway_ref, payload
    )
    select 'refund_processed', p.booking_id, p.id, r.id, r.amount, p_razorpay_refund_id,
           jsonb_build_object('status', 'processed')
      from public.payments p
     where p.id = r.payment_id;
  else
    v_attempts := r.attempts + 1;
    update public.refunds
       set attempts = v_attempts,
           razorpay_refund_id = p_razorpay_refund_id,
           status = case when v_attempts >= 5
                         then 'failed'::public.refund_status
                         else 'pending'::public.refund_status end,
           next_attempt_at = case when v_attempts >= 5 then null
                                  else now() + interval '5 minutes' * power(2, r.attempts) end,
           processed_at = null,
           last_error = 'Razorpay reported refund failed'
     where id = r.id;
    update public.payments
       set status = 'refund_pending'
     where id = r.payment_id and status in ('refund_pending', 'refund_processing', 'refunded');
    insert into public.financial_events (
      kind, booking_id, payment_id, refund_id, amount_paise, gateway_ref, payload
    )
    select 'refund_failed', p.booking_id, p.id, r.id, r.amount, p_razorpay_refund_id,
           jsonb_build_object('status', 'failed', 'attempts', v_attempts)
      from public.payments p
     where p.id = r.payment_id;
  end if;
end;
$$;

create or replace function public.list_stuck_money_ops()
returns table (
  operation_type text,
  operation_id uuid,
  booking_id uuid,
  amount int,
  status text,
  age_minutes int,
  last_error text
)
language sql
stable
security definer
set search_path = public
as $$
  select 'transfer'::text,
         t.id,
         coalesce(po.booking_id, po.sports_booking_id),
         t.amount,
         t.status::text,
         floor(extract(epoch from now() - t.processing_started_at) / 60)::int,
         t.last_error
    from public.payout_transfers t
    join public.payouts po on po.id = t.payout_id
   where t.status = 'processing'
     and t.processing_started_at <= now() - interval '30 minutes'
  union all
  select 'refund'::text,
         r.id,
         p.booking_id,
         r.amount,
         r.status::text,
         floor(extract(epoch from now() - r.created_at) / 60)::int,
         r.last_error
    from public.refunds r
    join public.payments p on p.id = r.payment_id
   where r.status = 'failed'
     and r.attempts >= 3;
$$;

create or replace function public.save_reconciliation_report(p_run_date date, p_issues jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved int;
begin
  perform public._assert(
    coalesce(p_run_date is not null and jsonb_typeof(p_issues) = 'array', false),
    'reconciliation date and JSON array are required'
  );
  perform public._assert(jsonb_array_length(p_issues) <= 1000, 'too many reconciliation issues');

  update public.reconciliation_issues
     set status = 'resolved', resolved_at = now()
   where run_date = p_run_date and status = 'open';

  insert into public.reconciliation_issues (
    run_date, issue_key, entity_type, issue_code, local_id, gateway_id,
    expected_amount, actual_amount, details, status, resolved_at
  )
  select p_run_date, i.issue_key, i.entity_type, i.issue_code, i.local_id, i.gateway_id,
         i.expected_amount, i.actual_amount, coalesce(i.details, '{}'::jsonb), 'open', null
    from jsonb_to_recordset(p_issues) as i(
      issue_key text,
      entity_type text,
      issue_code text,
      local_id text,
      gateway_id text,
      expected_amount int,
      actual_amount int,
      details jsonb
    )
  on conflict (issue_key) do update
    set entity_type = excluded.entity_type,
        issue_code = excluded.issue_code,
        local_id = excluded.local_id,
        gateway_id = excluded.gateway_id,
        expected_amount = excluded.expected_amount,
        actual_amount = excluded.actual_amount,
        details = excluded.details,
        status = 'open',
        resolved_at = null;
  get diagnostics v_saved = row_count;
  return v_saved;
end;
$$;

create or replace function public.admin_list_reconciliation_issues(p_run_date date default null)
returns table (
  id uuid,
  run_date date,
  issue_key text,
  entity_type text,
  issue_code text,
  local_id text,
  gateway_id text,
  expected_amount int,
  actual_amount int,
  details jsonb,
  status text,
  created_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return query
  select r.id, r.run_date, r.issue_key, r.entity_type, r.issue_code, r.local_id, r.gateway_id,
         r.expected_amount, r.actual_amount, r.details, r.status, r.created_at, r.resolved_at
    from public.reconciliation_issues r
   where p_run_date is null or r.run_date = p_run_date
   order by r.run_date desc, r.created_at desc, r.id;
end;
$$;

revoke all on function public.claim_stale_processing_transfers(),
  public.reset_stale_processing_transfer(uuid),
  public.record_payment_dispute(text, text, int),
  public.queue_lost_dispute_reversals(),
  public.record_refund_status(text, text, uuid),
  public.list_stuck_money_ops(),
  public.save_reconciliation_report(date, jsonb),
  public.admin_list_reconciliation_issues(date)
from public, anon, authenticated, service_role;
grant execute on function public.claim_stale_processing_transfers(),
  public.reset_stale_processing_transfer(uuid),
  public.record_payment_dispute(text, text, int),
  public.queue_lost_dispute_reversals(),
  public.record_refund_status(text, text, uuid),
  public.list_stuck_money_ops(),
  public.save_reconciliation_report(date, jsonb)
to service_role;
grant execute on function public.admin_list_reconciliation_issues(date) to authenticated;

do $$
declare
  v_has_secrets boolean := false;
begin
  if to_regnamespace('cron') is null
     or to_regnamespace('net') is null
     or to_regclass('cron.job') is null
     or to_regclass('vault.decrypted_secrets') is null then
    v_has_secrets := false;
  else
    execute $query$
      select count(distinct name) = 2
        from vault.decrypted_secrets
       where name in ('project_url', 'cron_secret')
    $query$ into v_has_secrets;
  end if;

  if v_has_secrets then
    perform cron.unschedule(jobid)
      from cron.job
     where jobname = 'daily-payment-reconciliation';
    perform cron.schedule(
      'daily-payment-reconciliation',
      '30 0 * * *',
      $job$
        select net.http_post(
          url := rtrim(
            (select decrypted_secret from vault.decrypted_secrets where name = 'project_url'),
            '/'
          ) || '/functions/v1/reconcile-payments',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
          )
        );
      $job$
    );
  end if;
end;
$$;

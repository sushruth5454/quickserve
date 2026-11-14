-- Payout rails (docs/03-Pricing-Payments-Commission.md §5.1, docs/08-Provider-Onboarding.md §6).
--  * app_config.payout_rail ∈ {'route','payouts'} (default 'payouts' until Razorpay enables Route for the account).
--  * payout_transfers.rail is snapshotted when the row is created; in-flight rows finish on their rail.
--    razorpay_transfer_id holds the gateway reference for either rail (trf_... Route transfer, pout_... RazorpayX payout).
--  * Provider receivables (debt) are netted from future releases on BOTH rails at claim time, exactly once per row.
--  * record_payout_gateway_event: RazorpayX payout.* webhooks (processed / failed / reversed / rejected / cancelled).
-- Requires 0009.

create table public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
insert into public.app_config (key, value) values ('payout_rail', '"payouts"'::jsonb) on conflict (key) do nothing;

create or replace function public.get_payout_rail()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value #>> '{}' from public.app_config where key = 'payout_rail'), 'payouts');
$$;

create or replace function public.admin_set_payout_rail(p_rail text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._require_uid();
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(p_rail in ('route', 'payouts'), 'rail must be route or payouts');
  insert into public.app_config (key, value, updated_at, updated_by) values ('payout_rail', to_jsonb(p_rail), now(), v_admin)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = v_admin;
  insert into public.admin_audit_log (admin_id, action, details) values (v_admin, 'set_payout_rail', jsonb_build_object('rail', p_rail));
end;
$$;

alter table public.payout_transfers
  add column if not exists rail text check (rail in ('route', 'payouts')),
  add column if not exists recovered_amount int not null default 0 check (recovered_amount >= 0),
  add column if not exists gateway_status text,
  add column if not exists utr text,
  add column if not exists processed_at timestamptz,
  -- RazorpayX idempotency key = "<transfer id>:<idempotency_seq>"; bumped only by an admin retry after a definitive
  -- gateway failure, so automatic retries (timeouts) can never create a second payout.
  add column if not exists idempotency_seq int not null default 0;
update public.payout_transfers set rail = 'route' where rail is null;
alter table public.payout_transfers add constraint payout_transfers_recovered_le_amount check (recovered_amount <= amount);

create or replace function public._payout_transfer_set_rail()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.rail := coalesce(new.rail, public.get_payout_rail());
  return new;
end;
$$;
create trigger payout_transfers_set_rail before insert on public.payout_transfers
  for each row execute function public._payout_transfer_set_rail();

-- ---------------------------------------------------------------------------
-- Provider receivables (money a provider owes the platform, e.g. a refund granted after their payout was released)
-- ---------------------------------------------------------------------------
create table public.provider_receivables (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  booking_id uuid references public.bookings (id),
  amount int not null check (amount > 0),
  recovered int not null default 0 check (recovered >= 0),
  reason text not null check (char_length(reason) between 3 and 300),
  status text not null default 'open' check (status in ('open', 'recovered', 'written_off')),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (recovered <= amount)
);
create index provider_receivables_open_idx on public.provider_receivables (provider_id, created_at) where status = 'open';

create table public.provider_receivable_recoveries (
  id bigint generated always as identity primary key,
  receivable_id uuid not null references public.provider_receivables (id) on delete cascade,
  payout_transfer_id uuid not null references public.payout_transfers (id) on delete cascade,
  amount int not null check (amount > 0),
  at timestamptz not null default now(),
  unique (receivable_id, payout_transfer_id)
);

alter table public.provider_receivables enable row level security;
alter table public.provider_receivable_recoveries enable row level security;
revoke all on public.provider_receivables, public.provider_receivable_recoveries from anon, authenticated;
grant select on public.provider_receivables to authenticated;
create policy provider_receivables_own on public.provider_receivables for select to authenticated
  using (provider_id = auth.uid() or public._is_admin());

create or replace function public.admin_add_provider_receivable(p_provider_id uuid, p_booking_id uuid, p_amount int, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._require_uid();
  v_id uuid;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(p_amount > 0, 'amount must be positive');
  perform public._assert(p_booking_id is null or exists (select 1 from public.bookings where id = p_booking_id and provider_id = p_provider_id),
                         'booking does not belong to this provider');
  insert into public.provider_receivables (provider_id, booking_id, amount, reason, created_by)
  values (p_provider_id, p_booking_id, p_amount, trim(p_reason), v_admin)
  returning id into v_id;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_admin, 'add_provider_receivable', p_provider_id,
          jsonb_build_object('receivable_id', v_id, 'booking_id', p_booking_id, 'amount', p_amount, 'reason', p_reason));
  return v_id;
end;
$$;

-- Recovers open receivables (oldest first) from one transfer that has never been attempted. Keeps the net payout
-- either 0 or >= ₹1 (Razorpay minimum). Returns the amount recovered.
create or replace function public._net_receivables(p_transfer_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.payout_transfers;
  v_provider uuid;
  v_out int;
  v_take int;
  v_left int;
  v_x int;
  r record;
begin
  select * into t from public.payout_transfers where id = p_transfer_id for update;
  if t.attempts > 0 or t.recovered_amount > 0 then
    return t.recovered_amount;
  end if;
  select provider_id into v_provider from public.payouts where id = t.payout_id;
  select coalesce(sum(amount - recovered), 0) into v_out
    from public.provider_receivables where provider_id = v_provider and status = 'open';
  if v_out <= 0 then
    return 0;
  end if;
  v_take := least(v_out, t.amount);
  if t.amount - v_take between 1 and 99 then
    v_take := greatest(t.amount - 100, 0);
  end if;
  if v_take <= 0 then
    return 0;
  end if;
  v_left := v_take;
  for r in select id, amount - recovered as due from public.provider_receivables
            where provider_id = v_provider and status = 'open' order by created_at, id for update
  loop
    exit when v_left <= 0;
    v_x := least(r.due, v_left);
    insert into public.provider_receivable_recoveries (receivable_id, payout_transfer_id, amount) values (r.id, t.id, v_x);
    update public.provider_receivables
       set recovered = recovered + v_x, status = case when recovered + v_x >= amount then 'recovered' else status end
     where id = r.id;
    v_left := v_left - v_x;
  end loop;
  update public.payout_transfers set recovered_amount = v_take where id = t.id;
  return v_take;
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim: rail-aware, nets receivables, returns the destination for the row's rail.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_due_transfers(int);
create function public.claim_due_transfers(p_limit int default 20)
returns table (
  transfer_id uuid, payout_id uuid, booking_id uuid, provider_id uuid, amount int, gross_amount int, rail text,
  razorpay_payment_id text, account_id text, fund_account_id text, attempts int, idempotency_key text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  c record;
  v_net int;
  v_ids uuid[];
begin
  with claimed as (
    update public.payout_transfers pt
       set status = 'processing'
     where pt.id in (
       select t.id
         from public.payout_transfers t
         join public.payouts po on po.id = t.payout_id
         join public.bookings b on b.id = po.booking_id
         join public.providers pr on pr.id = po.provider_id
         left join public.provider_payout_accounts pa on pa.provider_id = pr.id
        where t.status = 'pending'
          and (t.next_attempt_at is null or t.next_attempt_at <= now())
          and po.status = 'pending'
          and po.release_after <= now()
          and b.status <> 'disputed'
          and ((coalesce(t.rail, 'route') = 'route' and pr.razorpay_account_id is not null)
               or (t.rail = 'payouts' and pa.fund_account_id is not null and pr.kyc_status = 'verified'))
        order by po.release_after
        limit p_limit
        for update of t, po skip locked
     )
    returning pt.id
  )
  select array_agg(claimed.id) into v_ids from claimed;

  for c in
    select cl.id, cl.payout_id, po.booking_id, po.provider_id, cl.amount, coalesce(cl.rail, 'route') as rail,
           pm.razorpay_payment_id, pr.razorpay_account_id, pa.fund_account_id, cl.attempts, cl.idempotency_seq
      from public.payout_transfers cl
      join public.payouts po on po.id = cl.payout_id
      join public.providers pr on pr.id = po.provider_id
      left join public.provider_payout_accounts pa on pa.provider_id = pr.id
      join public.payments pm on pm.id = cl.source_payment_id
     where cl.id = any (coalesce(v_ids, '{}'))
  loop
    v_net := c.amount - public._net_receivables(c.id);
    if v_net <= 0 then
      -- Fully recovered: nothing to send to the gateway.
      perform public.complete_transfer(c.id, 'netted_' || c.id::text);
      continue;
    end if;
    transfer_id := c.id; payout_id := c.payout_id; booking_id := c.booking_id; provider_id := c.provider_id;
    amount := v_net; gross_amount := c.amount; rail := c.rail; razorpay_payment_id := c.razorpay_payment_id;
    account_id := c.razorpay_account_id; fund_account_id := c.fund_account_id; attempts := c.attempts;
    idempotency_key := c.id::text || ':' || c.idempotency_seq::text;
    return next;
  end loop;
end;
$$;

-- RazorpayX payout lifecycle (webhooks payout.processed / failed / reversed / rejected / cancelled).
-- Idempotent; failure after release flags the payout for an admin (retry_payout) and keeps the reason.
create or replace function public.record_payout_gateway_event(
  p_external_id text, p_status text, p_utr text default null, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.payout_transfers;
begin
  select * into t from public.payout_transfers where razorpay_transfer_id = p_external_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_payout');
  end if;
  if p_status = 'processed' then
    update public.payout_transfers set gateway_status = 'processed', utr = coalesce(p_utr, utr), processed_at = coalesce(processed_at, now())
     where id = t.id;
  elsif p_status in ('failed', 'reversed', 'rejected', 'cancelled') then
    if t.gateway_status in ('failed', 'reversed', 'rejected', 'cancelled') then
      return jsonb_build_object('ok', true, 'duplicate', true);
    end if;
    update public.payout_transfers
       set gateway_status = p_status, status = 'failed', last_error = left(coalesce(p_reason, 'payout ' || p_status), 2000),
           next_attempt_at = null
     where id = t.id;
    update public.payouts set status = 'failed' where id = t.payout_id and status in ('pending', 'transferred');
  else
    update public.payout_transfers set gateway_status = p_status where id = t.id;
  end if;
  return jsonb_build_object('ok', true, 'transfer_id', t.id, 'status', p_status);
end;
$$;

-- A failed RazorpayX payout already has a gateway id; an admin retry clears it and bumps the idempotency sequence so a
-- new payout can be created (the old one is definitively failed/reversed at the gateway).
create or replace function public.retry_payout(p_payout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payout_transfers
     set status = 'pending', next_attempt_at = null,
         razorpay_transfer_id = case when rail = 'payouts' and gateway_status in ('failed', 'reversed', 'rejected', 'cancelled')
                                     then null else razorpay_transfer_id end,
         idempotency_seq = case when rail = 'payouts' and gateway_status in ('failed', 'reversed', 'rejected', 'cancelled')
                                then idempotency_seq + 1 else idempotency_seq end,
         gateway_status = case when rail = 'payouts' then null else gateway_status end
   where payout_id = p_payout_id and status = 'failed';
  update public.payouts set status = 'pending' where id = p_payout_id and status = 'failed';
end;
$$;

revoke execute on function
  public._payout_transfer_set_rail(),
  public._net_receivables(uuid),
  public.claim_due_transfers(int),
  public.record_payout_gateway_event(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.claim_due_transfers(int), public.record_payout_gateway_event(text, text, text, text) to service_role;
revoke execute on function public.get_payout_rail() from public, anon;
grant execute on function public.get_payout_rail() to authenticated, service_role;
revoke execute on function public.admin_set_payout_rail(text), public.admin_add_provider_receivable(uuid, uuid, int, text) from public, anon;
grant execute on function public.admin_set_payout_rail(text), public.admin_add_provider_receivable(uuid, uuid, int, text) to authenticated;

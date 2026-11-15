-- Seva Coins (docs/09, M4). All money, including ledger amounts, is integer paise.
-- One coin is 100 paise. Ledger credits expire after six calendar months and are consumed FIFO.

alter table public.bookings
  add column if not exists coin_discount int not null default 0 check (coin_discount >= 0);

alter table public.quotes
  add column if not exists coin_discount int not null default 0 check (coin_discount >= 0),
  add column if not exists coin_discount_funder text
    check (coin_discount_funder is null or coin_discount_funder = 'platform');

alter table public.payments
  add column if not exists funding_source text not null default 'customer'
    check (funding_source in ('customer', 'coins'));
create unique index if not exists payments_one_coin_payment_idx
  on public.payments (booking_id) where funding_source = 'coins';

create table public.coin_accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  clawback_due int not null default 0 check (clawback_due >= 0),
  updated_at timestamptz not null default now()
);

create table public.coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta int not null check (delta <> 0 and delta % 100 = 0),
  kind text not null check (kind in ('earn', 'bonus', 'redeem', 'expire', 'clawback', 'admin')),
  booking_id uuid references public.bookings (id) on delete set null,
  source_ledger_id uuid references public.coin_ledger (id),
  expires_at timestamptz,
  ref text not null unique check (char_length(ref) between 3 and 300),
  reason text check (reason is null or char_length(reason) <= 500),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((delta > 0 and kind in ('earn', 'bonus', 'admin'))
      or (delta < 0 and kind in ('redeem', 'expire', 'clawback', 'admin'))),
  check (source_ledger_id is null or delta < 0),
  check ((delta > 0 and expires_at is not null) or (delta < 0 and expires_at is null))
);
create index coin_ledger_user_created_idx on public.coin_ledger (user_id, created_at, id);
create index coin_ledger_source_idx on public.coin_ledger (source_ledger_id) where source_ledger_id is not null;
create index coin_ledger_expiry_idx on public.coin_ledger (expires_at) where delta > 0;

create table public.coin_clawback_tracking (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  required_paise int not null default 0 check (required_paise >= 0),
  spent_paise int not null default 0 check (spent_paise >= 0),
  debt_added_paise int not null default 0 check (debt_added_paise >= 0),
  updated_at timestamptz not null default now()
);

alter table public.coin_accounts enable row level security;
alter table public.coin_ledger enable row level security;
alter table public.coin_clawback_tracking enable row level security;
revoke all on public.coin_accounts, public.coin_ledger, public.coin_clawback_tracking from anon, authenticated;
grant select on public.coin_ledger to authenticated;

create policy coin_ledger_own_history on public.coin_ledger
  for select to authenticated using (user_id = auth.uid());

create or replace function public._lock_coin_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.coin_accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  perform 1 from public.coin_accounts where user_id = p_user_id for update;
end;
$$;

create or replace function public._coin_lots(p_user_id uuid, p_include_expired boolean default false)
returns table (
  lot_id uuid, expires_at timestamptz, remaining_paise int, earned_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.expires_at,
         (c.delta + coalesce(sum(d.delta), 0))::int as remaining_paise,
         c.created_at
    from public.coin_ledger c
    left join public.coin_ledger d on d.source_ledger_id = c.id and d.delta < 0
   where c.user_id = p_user_id
     and c.delta > 0
     and (p_include_expired or c.expires_at > now())
   group by c.id, c.expires_at, c.delta, c.created_at
  having c.delta + coalesce(sum(d.delta), 0) > 0
   order by c.created_at, c.id;
$$;

create or replace function public._coin_balance(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(remaining_paise), 0)::int from public._coin_lots(p_user_id, false);
$$;

-- The view is additionally filtered by auth.uid() so even callers with view access cannot read another balance.
create or replace view public.coin_balances as
select a.user_id,
       public._coin_balance(a.user_id) as balance_paise,
       coalesce(sum(x.remaining_paise) filter (where x.expires_at <= now() + interval '15 days'), 0)::int as expiring_soon_paise
  from public.coin_accounts a
  left join lateral public._coin_lots(a.user_id, false) x on true
 where a.user_id = auth.uid()
 group by a.user_id;
revoke all on public.coin_balances from public, anon, authenticated;
grant select on public.coin_balances to authenticated;

create or replace function public.get_my_coin_balance()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._lock_coin_account(v_uid);
  return public._coin_balance(v_uid);
end;
$$;

-- Consumes whole available lots oldest-first. Returns less than requested when there is a shortfall.
-- The caller's per-user lock makes the lot calculation and inserts atomic.
create or replace function public._spend_coin_lots(
  p_user_id uuid, p_amount int, p_kind text, p_booking_id uuid, p_ref_prefix text, p_reason text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing int;
  v_balance int;
  v_left int := p_amount;
  v_take int;
  lot record;
begin
  perform public._assert(p_amount >= 0, 'coin amount must not be negative');
  perform public._assert(p_kind in ('redeem', 'expire', 'clawback', 'admin'), 'invalid coin spend kind');
  if p_amount = 0 then
    return 0;
  end if;
  select coalesce(-sum(delta), 0)::int into v_existing
    from public.coin_ledger
   where user_id = p_user_id and kind = p_kind and ref like p_ref_prefix || ':%';
  if v_existing > 0 then
    return least(v_existing, p_amount);
  end if;

  for lot in
    select * from public._coin_lots(p_user_id, false)
  loop
    exit when v_left <= 0;
    v_take := least(lot.remaining_paise, v_left);
    insert into public.coin_ledger (
      user_id, delta, kind, booking_id, source_ledger_id, expires_at, ref, reason
    ) values (
      p_user_id, -v_take, p_kind, p_booking_id, lot.lot_id, null, p_ref_prefix || ':' || lot.lot_id::text, p_reason
    );
    v_left := v_left - v_take;
  end loop;
  return p_amount - v_left;
end;
$$;

create or replace function public._coin_platform_cap(p_booking_id uuid, p_quote_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.bookings;
  q public.quotes;
  v_commission int;
  v_gst int;
begin
  select * into b from public.bookings where id = p_booking_id;
  select * into q from public.quotes where id = p_quote_id and booking_id = p_booking_id;
  perform public._assert(found and b.id is not null, 'booking or quote not found');
  v_commission := round(q.subtotal_labour::numeric * public._commission_bp(b.provider_id, now()) / 10000);
  v_gst := round(v_commission::numeric * 18 / 100);
  return greatest(v_commission + b.platform_fee - v_gst, 0);
end;
$$;

create or replace function public.get_coin_redemption_preview(p_booking_id uuid, p_quote_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings;
  q public.quotes;
  v_balance int;
  v_service_cap int;
  v_platform_cap int;
  v_cap int;
  v_existing int;
begin
  select * into b from public.bookings where id = p_booking_id;
  perform public._assert(found and b.customer_id = v_uid, 'only the customer can view this quote');
  select * into q from public.quotes where id = p_quote_id and booking_id = b.id;
  perform public._assert(found and q.status = 'sent', 'quote is not open');
  v_balance := public._coin_balance(v_uid);
  v_service_cap := floor(greatest(q.total, b.visit_fee)::numeric * 10 / 100)::int;
  v_platform_cap := public._coin_platform_cap(b.id, q.id);
  v_existing := coalesce(b.coin_discount, 0);
  v_cap := floor(least(v_balance, v_service_cap, v_platform_cap)::numeric / 100)::int * 100;
  return jsonb_build_object(
    'balance_paise', v_balance,
    'service_cap_paise', v_service_cap,
    'platform_cap_paise', v_platform_cap,
    'maximum_paise', v_cap,
    'applied_paise', least(v_existing, v_service_cap, v_platform_cap)
  );
end;
$$;

-- Applies the one booking-level redemption to a quote. A later lower change order restores the difference;
-- a larger quote never redeems a second time.
create or replace function public._apply_quote_coins(
  p_booking_id uuid, p_quote_id uuid, p_use_coins boolean
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  q public.quotes;
  v_uid uuid := public._require_uid();
  v_existing int;
  v_service_cap int;
  v_platform_cap int;
  v_allowed int;
  v_new int;
  v_restore int;
  v_spent int;
  v_balance int;
  v_restore_id uuid;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  perform public._assert(found and b.customer_id = v_uid, 'only the customer can redeem');
  select * into q from public.quotes where id = p_quote_id and booking_id = b.id for update;
  perform public._assert(found and q.status = 'sent', 'quote is not open');
  if q.coin_discount > 0 or q.coin_discount_funder = 'platform' then
    return q.coin_discount;
  end if;

  perform public._lock_coin_account(v_uid);
  v_existing := b.coin_discount;
  v_service_cap := floor(greatest(q.total, b.visit_fee)::numeric * 10 / 100)::int;
  v_platform_cap := public._coin_platform_cap(b.id, q.id);

  if v_existing > 0 then
    v_new := least(v_existing, v_service_cap, v_platform_cap);
    v_restore := v_existing - v_new;
    if v_restore > 0 then
      v_restore_id := gen_random_uuid();
      insert into public.coin_ledger (
        user_id, delta, kind, booking_id, expires_at, ref, reason, created_by
      ) values (
        v_uid, v_restore, 'admin', b.id, now() + interval '6 months',
        'restore:' || b.id::text || ':' || q.id::text, 'coins restored because a lower change order reduced the redemption cap', null
      )
      on conflict (ref) do nothing
      returning id into v_restore_id;
      if v_new > 0 then
        update public.payments
           set amount = v_new
         where booking_id = b.id and funding_source = 'coins' and status = 'paid';
      else
        update public.payments
           set status = 'failed'
         where booking_id = b.id and funding_source = 'coins' and status = 'paid';
      end if;
    end if;
  elsif p_use_coins then
    v_balance := public._coin_balance(v_uid);
    v_allowed := floor(least(v_balance, v_service_cap, v_platform_cap)::numeric / 100)::int * 100;
    v_spent := public._spend_coin_lots(
      v_uid, v_allowed, 'redeem', b.id, 'redeem:' || b.id::text,
      'Seva Coins redeemed on a QuickServe booking'
    );
    v_new := v_spent;
  else
    v_new := 0;
  end if;

  perform public._assert(v_new <= v_service_cap, 'coin redemption exceeds 10% of service value');
  perform public._assert(v_new <= v_platform_cap, 'coin redemption exceeds platform revenue');
  update public.quotes
     set coin_discount = v_new,
         coin_discount_funder = case when v_new > 0 then 'platform' else null end
   where id = q.id;
  update public.bookings set coin_discount = v_new where id = b.id;
  if v_new > 0 and v_existing = 0 then
    insert into public.payments (
      booking_id, quote_id, purpose, amount, status, funding_source, paid_at
    ) values (
      b.id, q.id, 'balance', v_new, 'paid', 'coins', now()
    );
  elsif v_existing > 0 and v_new > 0 then
    update public.payments
       set quote_id = q.id, amount = v_new
     where booking_id = b.id and funding_source = 'coins' and status = 'paid';
  end if;

  if v_new > 0 and v_existing = 0 then
    if to_regclass('public.analytics_events') is not null then
      execute 'insert into public.analytics_events (user_id, event, props) values ($1, ''coins_redeemed'', jsonb_build_object(''amount_paise'', $2, ''booking_id'', $3))'
        using v_uid, v_new, b.id;
    end if;
  end if;
  return v_new;
end;
$$;

-- Compose on top of the current approve_quote implementation so travel or other quote approval rules remain intact.
create or replace function public.approve_quote_with_coins(
  p_booking_id uuid, p_quote_id uuid, p_use_coins boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coins int;
  v_result jsonb;
begin
  v_coins := public._apply_quote_coins(p_booking_id, p_quote_id, coalesce(p_use_coins, false));
  v_result := public.approve_quote(p_booking_id, p_quote_id);
  return v_result || jsonb_build_object('coins_redeemed_paise', v_coins);
end;
$$;

create or replace function public._credit_booking_coins(p_booking_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  q public.quotes;
  v_ref text := 'earn:' || p_booking_id::text;
  v_eligible int;
  v_amount int;
  v_month_earned int;
  v_credit_id uuid;
  v_account public.coin_accounts;
  v_recover int;
begin
  select * into b from public.bookings where id = p_booking_id;
  select * into q from public.quotes where id = b.approved_quote_id;
  perform public._assert(found and b.status in ('completed', 'closed'), 'coins are earned after a booking closes');
  if exists (select 1 from public.coin_ledger where ref = v_ref) then
    select delta::int into v_amount from public.coin_ledger where ref = v_ref;
    return v_amount;
  end if;

  perform public._lock_coin_account(b.customer_id);
  -- Count service value once, then remove the platform-funded coin portion and refunded amount.
  v_eligible := greatest(greatest(q.total, b.visit_fee) - b.coin_discount - b.refund_amount, 0);
  -- floor to whole coins: 2% of paise, then floor to 100-paise units.
  v_amount := floor(v_eligible::numeric / 5000)::int * 100;
  select coalesce(sum(delta), 0)::int into v_month_earned
    from public.coin_ledger
   where user_id = b.customer_id
     and kind in ('earn', 'bonus')
     and delta > 0
     and created_at >= date_trunc('month', now());
  v_amount := least(v_amount, greatest(100000 - v_month_earned, 0));
  if v_amount <= 0 then
    return 0;
  end if;

  insert into public.coin_ledger (
    user_id, delta, kind, booking_id, expires_at, ref, reason
  ) values (
    b.customer_id, v_amount, 'earn', b.id, now() + interval '6 months', v_ref,
    '2% of eligible in-app paid service value'
  ) returning id into v_credit_id;

  select * into v_account from public.coin_accounts where user_id = b.customer_id for update;
  v_recover := least(v_account.clawback_due, v_amount);
  if v_recover > 0 then
    insert into public.coin_ledger (
      user_id, delta, kind, booking_id, source_ledger_id, expires_at, ref, reason
    ) values (
      b.customer_id, -v_recover, 'clawback', b.id, v_credit_id, null,
      'clawback-debt:' || b.id::text, 'recovered a previous refund clawback from a new earn'
    );
    update public.coin_accounts set clawback_due = clawback_due - v_recover, updated_at = now()
     where user_id = b.customer_id;
  end if;

  if to_regclass('public.analytics_events') is not null then
    execute 'insert into public.analytics_events (user_id, event, props) values ($1, ''coins_earned'', jsonb_build_object(''amount_paise'', $2, ''booking_id'', $3))'
      using b.customer_id, v_amount, b.id;
  end if;
  return v_amount;
end;
$$;

create or replace function public._coins_earned_after_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'completed' and new.status = 'closed' then
    perform public._credit_booking_coins(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_credit_seva_coins on public.bookings;
create trigger bookings_credit_seva_coins
  after update of status on public.bookings
  for each row execute function public._coins_earned_after_close();

create or replace function public._clawback_booking_coins(p_booking_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  q public.quotes;
  v_original int;
  v_target int;
  v_required int;
  v_extra int;
  v_spent int;
  v_short int;
  track public.coin_clawback_tracking;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  select * into q from public.quotes where id = b.approved_quote_id;
  if not found or b.refund_amount <= 0 then
    return 0;
  end if;
  select coalesce(sum(delta), 0)::int into v_original
    from public.coin_ledger where booking_id = b.id and kind = 'earn' and delta > 0 and ref = 'earn:' || b.id::text;
  if v_original = 0 then
    return 0;
  end if;
  v_target := least(
    v_original,
    floor(greatest(greatest(q.total, b.visit_fee) - b.coin_discount - b.refund_amount, 0)::numeric / 5000)::int * 100
  );
  v_required := greatest(v_original - v_target, 0);

  select * into track from public.coin_clawback_tracking where booking_id = b.id for update;
  if not found then
    insert into public.coin_clawback_tracking (booking_id) values (b.id) returning * into track;
  end if;
  v_extra := greatest(v_required - track.required_paise, 0);
  if v_extra = 0 then
    return 0;
  end if;

  perform public._lock_coin_account(b.customer_id);
  v_spent := public._spend_coin_lots(
    b.customer_id, v_extra, 'clawback', b.id,
    'clawback:' || b.id::text || ':' || v_required::text,
    'coins reversed because this booking was refunded'
  );
  v_short := v_extra - v_spent;
  update public.coin_accounts set clawback_due = clawback_due + v_short, updated_at = now()
   where user_id = b.customer_id;
  update public.coin_clawback_tracking
     set required_paise = v_required,
         spent_paise = spent_paise + v_spent,
         debt_added_paise = debt_added_paise + v_short,
         updated_at = now()
   where booking_id = b.id;
  return v_extra;
end;
$$;

create or replace function public._coins_refunded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.refund_amount > old.refund_amount then
    perform public._clawback_booking_coins(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_clawback_seva_coins on public.bookings;
create trigger bookings_clawback_seva_coins
  after update of refund_amount on public.bookings
  for each row execute function public._coins_refunded();

-- Terminal bookings that never received (or fully refunded) the service must not strand a redeemed amount.
create or replace function public._restore_coins_for_terminal_booking(p_booking_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  p public.payments;
  v_amount int := 0;
begin
  select * into b from public.bookings where id = p_booking_id;
  select * into p from public.payments
   where booking_id = b.id and funding_source = 'coins'
   order by created_at desc limit 1 for update;
  if not found then
    return 0;
  end if;
  if exists (select 1 from public.coin_ledger where ref = 'restore-terminal:' || b.id::text) then
    return 0;
  end if;
  v_amount := p.amount;
  perform public._lock_coin_account(b.customer_id);
  update public.payments set status = 'failed' where id = p.id;
  insert into public.coin_ledger (
    user_id, delta, kind, booking_id, expires_at, ref, reason
  ) values (
    b.customer_id, v_amount, 'admin', b.id, now() + interval '6 months',
    'restore-terminal:' || b.id::text, 'redeemed coins restored after cancellation or full refund'
  ) on conflict (ref) do nothing;
  update public.bookings set coin_discount = 0 where id = b.id;
  return v_amount;
end;
$$;

create or replace function public._coins_booking_terminal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status
     and new.status in ('declined', 'expired', 'cancelled', 'closed_no_work', 'refunded') then
    perform public._restore_coins_for_terminal_booking(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_restore_seva_coins on public.bookings;
create trigger bookings_restore_seva_coins
  after update of status on public.bookings
  for each row execute function public._coins_booking_terminal();

create or replace function public.expire_coins(p_limit int default 1000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lot record;
  v_lots int := 0;
  v_amount int := 0;
  v_take int;
begin
  for lot in
    select c.user_id, c.id, c.delta, c.expires_at,
           c.delta + coalesce((
             select sum(d.delta) from public.coin_ledger d
              where d.source_ledger_id = c.id and d.delta < 0
           ), 0) as remaining
      from public.coin_ledger c
     where c.delta > 0
       and c.expires_at <= now()
       and c.delta + coalesce((
         select sum(d.delta) from public.coin_ledger d
          where d.source_ledger_id = c.id and d.delta < 0
       ), 0) > 0
     order by c.expires_at, c.id
     limit greatest(1, least(coalesce(p_limit, 1000), 5000))
     for update of c skip locked
  loop
    perform public._lock_coin_account(lot.user_id);
    v_take := lot.remaining;
    insert into public.coin_ledger (
      user_id, delta, kind, source_ledger_id, expires_at, ref, reason
    ) values (
      lot.user_id, -v_take, 'expire', lot.id, null,
      'expire:' || lot.id::text, 'Seva Coins expired six months after credit'
    ) on conflict (ref) do nothing;
    if found then
      v_lots := v_lots + 1;
      v_amount := v_amount + v_take;
    end if;
  end loop;
  return jsonb_build_object('lots', v_lots, 'amount_paise', v_amount);
end;
$$;

create or replace function public.admin_adjust_coins(p_user_id uuid, p_delta int, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._require_uid();
  v_id uuid := gen_random_uuid();
  v_ref text := 'admin:' || v_id::text;
  v_spent int;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(p_delta <> 0 and p_delta % 100 = 0 and abs(p_delta) <= 10000000, 'adjustment is out of range');
  perform public._assert(char_length(trim(coalesce(p_reason, ''))) >= 3, 'reason is required');
  perform public._lock_coin_account(p_user_id);

  if p_delta > 0 then
    insert into public.coin_ledger (
      id, user_id, delta, kind, expires_at, ref, reason, created_by
    ) values (
      v_id, p_user_id, p_delta, 'admin', now() + interval '6 months', v_ref, trim(p_reason), v_admin
    );
  else
    v_spent := public._spend_coin_lots(
      p_user_id, -p_delta, 'admin', null, v_ref, trim(p_reason)
    );
    perform public._assert(v_spent = -p_delta, 'coin balance is insufficient');
  end if;

  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (
    v_admin, 'adjust_coins', p_user_id,
    jsonb_build_object('delta_paise', p_delta, 'reason', trim(p_reason), 'ledger_ref', v_ref)
  );
  return v_id;
end;
$$;

revoke execute on function
  public._lock_coin_account(uuid),
  public._coin_lots(uuid, boolean),
  public._coin_balance(uuid),
  public.get_my_coin_balance(),
  public._spend_coin_lots(uuid, int, text, uuid, text, text),
  public._coin_platform_cap(uuid, uuid),
  public.get_coin_redemption_preview(uuid, uuid),
  public._apply_quote_coins(uuid, uuid, boolean),
  public.approve_quote_with_coins(uuid, uuid, boolean),
  public._credit_booking_coins(uuid),
  public._coins_earned_after_close(),
  public._clawback_booking_coins(uuid),
  public._coins_refunded(),
  public._restore_coins_for_terminal_booking(uuid),
  public._coins_booking_terminal(),
  public.expire_coins(int),
  public.admin_adjust_coins(uuid, int, text)
from public, anon, authenticated;

grant execute on function
  public.get_my_coin_balance(),
  public.get_coin_redemption_preview(uuid, uuid),
  public.approve_quote_with_coins(uuid, uuid, boolean),
  public.admin_adjust_coins(uuid, int, text)
to authenticated;
grant execute on function public.expire_coins(int) to service_role;

-- Extend the analytics allow-list when the AI analytics migration is present.
do $$
begin
  if to_regclass('public.analytics_events') is not null then
    execute 'alter table public.analytics_events drop constraint if exists analytics_events_event_check';
    execute $sql$
      alter table public.analytics_events
      add constraint analytics_events_event_check check (event in (
        'assistant_opened', 'voice_used', 'photo_attached', 'stage_latency', 'draft_created',
        'draft_to_booking_conversion', 'fallback_model_used', 'assistant_feedback', 'assistant_stopped',
        'support_handoff', 'coins_earned', 'coins_redeemed'
      ))
    $sql$;
  end if;
end;
$$;

-- pg_cron is configured outside migrations in Supabase; schedule only when the schema is present.
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule(
      'expire-seva-coins',
      '15 2 * * *',
      'select public.expire_coins()'
    );
  end if;
end;
$$;

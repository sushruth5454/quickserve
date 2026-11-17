-- Owner-approved PRD v2 Phase 2 defaults: 10 paise per coin, 1% earn, ₹20
-- per-booking cap, ₹10 first-booking bonus, ₹1,000 monthly cap, 10% redemption,
-- six-month expiry, and ₹10,000 pilot budget. Existing wallet values remain paise;
-- this migration intentionally does not rewrite balances.
insert into public.app_config (key, value)
values ('coins', '{
  "coin_paise": 10,
  "earn_rate_bp": 100,
  "per_txn_cap_paise": 2000,
  "first_txn_bonus_paise": 1000,
  "monthly_cap_paise": 100000,
  "redeem_cap_bp": 1000,
  "expiry_months": 6,
  "pilot_budget_paise": 1000000
}'::jsonb)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values
  ('coins_earning', true, 'Coins: earning', 'Customers earn coins on completed in-app bookings.', 'Coins', 10),
  ('coins_redemption', true, 'Coins: redemption', 'Customers can use coins as a discount.', 'Coins', 20)
on conflict (key) do nothing;

-- Existing credits are paise and remain untouched. Remove the former ₹1-unit
-- constraint so future 10-paise awards and redemptions can be recorded.
alter table public.coin_ledger drop constraint if exists coin_ledger_delta_check;
alter table public.coin_ledger
  add constraint coin_ledger_delta_check check (delta <> 0);

create or replace function public._coins_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select c.value from public.app_config c where c.key = 'coins'),
    '{
      "coin_paise": 10,
      "earn_rate_bp": 100,
      "per_txn_cap_paise": 2000,
      "first_txn_bonus_paise": 1000,
      "monthly_cap_paise": 100000,
      "redeem_cap_bp": 1000,
      "expiry_months": 6,
      "pilot_budget_paise": 1000000
    }'::jsonb
  );
$$;

create or replace function public.get_coins_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public._coins_config()
      || jsonb_build_object(
           'coins_earning_enabled', public._feature_enabled('coins_earning'),
           'coins_redemption_enabled', public._feature_enabled('coins_redemption')
         );
$$;

create or replace function public.admin_get_coins_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return public.get_coins_config();
end;
$$;

create or replace function public.admin_set_coins_config(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_coin_paise int;
  v_earn_bp int;
  v_per_txn int;
  v_bonus int;
  v_monthly int;
  v_redeem_bp int;
  v_expiry int;
  v_budget int;
  v_config jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(coalesce(jsonb_typeof(p_config) = 'object', false), 'coins config must be an object');
  perform public._assert(coalesce(p_config ->> 'coin_paise', '') ~ '^[0-9]+$', 'coin_paise must be a whole number');
  perform public._assert(coalesce(p_config ->> 'earn_rate_bp', '') ~ '^[0-9]+$', 'earn_rate_bp must be a whole number');
  perform public._assert(coalesce(p_config ->> 'first_txn_bonus_paise', '') ~ '^[0-9]+$', 'first_txn_bonus_paise must be a whole number');
  perform public._assert(coalesce(p_config ->> 'monthly_cap_paise', '') ~ '^[0-9]+$', 'monthly_cap_paise must be a whole number');
  perform public._assert(coalesce(p_config ->> 'redeem_cap_bp', '') ~ '^[0-9]+$', 'redeem_cap_bp must be a whole number');
  perform public._assert(coalesce(p_config ->> 'expiry_months', '') ~ '^[0-9]+$', 'expiry_months must be a whole number');
  perform public._assert(p_config ? 'per_txn_cap_paise', 'per_txn_cap_paise is required');
  perform public._assert(p_config ? 'pilot_budget_paise', 'pilot_budget_paise is required');

  v_coin_paise := (p_config ->> 'coin_paise')::int;
  v_earn_bp := (p_config ->> 'earn_rate_bp')::int;
  v_bonus := (p_config ->> 'first_txn_bonus_paise')::int;
  v_monthly := (p_config ->> 'monthly_cap_paise')::int;
  v_redeem_bp := (p_config ->> 'redeem_cap_bp')::int;
  v_expiry := (p_config ->> 'expiry_months')::int;

  perform public._assert(v_coin_paise in (1, 10, 100), 'coin_paise must be 1, 10, or 100');
  perform public._assert(v_earn_bp between 0 and 10000, 'earn_rate_bp must be between 0 and 10000');
  perform public._assert(v_redeem_bp between 0 and 10000, 'redeem_cap_bp must be between 0 and 10000');

  if jsonb_typeof(p_config -> 'per_txn_cap_paise') = 'null' then
    v_per_txn := null;
  else
    perform public._assert(coalesce(p_config ->> 'per_txn_cap_paise', '') ~ '^[0-9]+$', 'per_txn_cap_paise must be null or a non-negative whole number');
    v_per_txn := (p_config ->> 'per_txn_cap_paise')::int;
  end if;
  if jsonb_typeof(p_config -> 'pilot_budget_paise') = 'null' then
    v_budget := null;
  else
    perform public._assert(coalesce(p_config ->> 'pilot_budget_paise', '') ~ '^[0-9]+$', 'pilot_budget_paise must be null or a non-negative whole number');
    v_budget := (p_config ->> 'pilot_budget_paise')::int;
  end if;

  v_config := jsonb_build_object(
    'coin_paise', v_coin_paise,
    'earn_rate_bp', v_earn_bp,
    'per_txn_cap_paise', v_per_txn,
    'first_txn_bonus_paise', v_bonus,
    'monthly_cap_paise', v_monthly,
    'redeem_cap_bp', v_redeem_bp,
    'expiry_months', v_expiry,
    'pilot_budget_paise', v_budget
  );
  insert into public.app_config (key, value, updated_at, updated_by)
  values ('coins', v_config, now(), v_uid)
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  insert into public.admin_audit_log (admin_id, action, details)
  values (v_uid, 'set_coins_config', v_config);
  return public.get_coins_config();
end;
$$;

-- Admin summary helper is intentionally not exposed; unlike _coin_lots it
-- includes all customers and excludes expired lots from current liability.
create or replace function public._coin_lots_for_summary()
returns table (remaining_paise bigint)
language sql
stable
security definer
set search_path = public
as $$
  select (c.delta + coalesce(sum(d.delta), 0))::bigint
    from public.coin_ledger c
    left join public.coin_ledger d on d.source_ledger_id = c.id and d.delta < 0
   where c.delta > 0 and c.expires_at > now()
   group by c.id, c.delta
  having c.delta + coalesce(sum(d.delta), 0) > 0;
$$;

create or replace function public.admin_coin_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_budget int;
  v_issued bigint;
  v_redeemed bigint;
  v_expired bigint;
  v_outstanding bigint;
begin
  perform public._assert(public._is_admin(), 'admin only');
  v_config := public._coins_config();
  v_budget := nullif(v_config ->> 'pilot_budget_paise', '')::int;

  select coalesce(sum(delta), 0)::bigint into v_issued
    from public.coin_ledger
   where kind in ('earn', 'bonus') and delta > 0;
  select coalesce(-sum(delta), 0)::bigint into v_redeemed
    from public.coin_ledger where kind = 'redeem' and delta < 0;
  select coalesce(-sum(delta), 0)::bigint into v_expired
    from public.coin_ledger where kind = 'expire' and delta < 0;
  select coalesce(sum(l.remaining_paise), 0)::bigint into v_outstanding
    from public._coin_lots_for_summary() l;

  return jsonb_build_object(
    'issued_paise', v_issued,
    'redeemed_paise', v_redeemed,
    'expired_paise', v_expired,
    'outstanding_paise', v_outstanding,
    'budget_paise', v_budget,
    'budget_left_paise', case when v_budget is null then null else greatest(v_budget::bigint - v_issued, 0) end
  );
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
  v_config jsonb := public._coins_config();
  v_unit int := (v_config ->> 'coin_paise')::int;
  v_balance int;
  v_service_cap int;
  v_platform_cap int;
  v_cap int;
  v_existing int;
  v_enabled boolean := public._feature_enabled('coins_redemption');
begin
  select * into b from public.bookings where id = p_booking_id;
  perform public._assert(found and b.customer_id = v_uid, 'only the customer can view this quote');
  select * into q from public.quotes where id = p_quote_id and booking_id = b.id;
  perform public._assert(found and q.status = 'sent', 'quote is not open');
  v_balance := public._coin_balance(v_uid);
  v_service_cap := floor(greatest(q.total, b.visit_fee)::numeric * (v_config ->> 'redeem_cap_bp')::int / 10000)::int;
  v_platform_cap := public._coin_platform_cap(b.id, q.id);
  v_existing := coalesce(b.coin_discount, 0);
  v_cap := case when v_enabled
    then floor(least(v_balance, v_service_cap, v_platform_cap)::numeric / v_unit)::int * v_unit
    else 0
  end;
  return jsonb_build_object(
    'balance_paise', v_balance,
    'coin_paise', v_unit,
    'service_cap_paise', v_service_cap,
    'platform_cap_paise', v_platform_cap,
    'maximum_paise', v_cap,
    'applied_paise', case when v_enabled then least(v_existing, v_service_cap, v_platform_cap) else 0 end
  );
end;
$$;

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
  v_config jsonb := public._coins_config();
  v_unit int := (v_config ->> 'coin_paise')::int;
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
  if coalesce(p_use_coins, false) then
    perform public._assert(public._feature_enabled('coins_redemption'), 'Coins can''t be used right now.');
  end if;
  select * into b from public.bookings where id = p_booking_id for update;
  perform public._assert(found and b.customer_id = v_uid, 'only the customer can redeem');
  select * into q from public.quotes where id = p_quote_id and booking_id = b.id for update;
  perform public._assert(found and q.status = 'sent', 'quote is not open');
  if q.coin_discount > 0 or q.coin_discount_funder = 'platform' then
    return q.coin_discount;
  end if;

  perform public._lock_coin_account(v_uid);
  v_existing := b.coin_discount;
  v_service_cap := floor(greatest(q.total, b.visit_fee)::numeric * (v_config ->> 'redeem_cap_bp')::int / 10000)::int;
  v_platform_cap := public._coin_platform_cap(b.id, q.id);

  if v_existing > 0 then
    v_new := floor(least(v_existing, v_service_cap, v_platform_cap)::numeric / v_unit)::int * v_unit;
    v_restore := v_existing - v_new;
    if v_restore > 0 then
      v_restore_id := gen_random_uuid();
      insert into public.coin_ledger (
        user_id, delta, kind, booking_id, expires_at, ref, reason, created_by
      ) values (
        v_uid, v_restore, 'admin', b.id,
        now() + make_interval(months => (v_config ->> 'expiry_months')::int),
        'restore:' || b.id::text || ':' || q.id::text,
        'coins restored because a lower change order reduced the redemption cap', null
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
    v_allowed := floor(least(v_balance, v_service_cap, v_platform_cap)::numeric / v_unit)::int * v_unit;
    v_spent := public._spend_coin_lots(
      v_uid, v_allowed, 'redeem', b.id, 'redeem:' || b.id::text,
      'Seva Coins redeemed on a QuickServe booking'
    );
    v_new := v_spent;
  else
    v_new := 0;
  end if;

  perform public._assert(v_new <= v_service_cap, 'coin redemption exceeds configured service-value cap');
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

  if v_new > 0 and v_existing = 0 and to_regclass('public.analytics_events') is not null then
    execute 'insert into public.analytics_events (user_id, event, props) values ($1, ''coins_redeemed'', jsonb_build_object(''amount_paise'', $2, ''booking_id'', $3))'
      using v_uid, v_new, b.id;
  end if;
  return v_new;
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
  v_config jsonb := public._coins_config();
  v_unit int := (v_config ->> 'coin_paise')::int;
  v_eligible int;
  v_base int;
  v_bonus int := 0;
  v_amount int;
  v_month_earned bigint;
  v_issued bigint;
  v_budget int;
  v_base_credit int;
  v_bonus_credit int;
  v_base_id uuid;
  v_bonus_id uuid;
  v_account public.coin_accounts;
  v_recover int;
  v_take int;
begin
  select * into b from public.bookings where id = p_booking_id;
  select * into q from public.quotes where id = b.approved_quote_id;
  perform public._assert(found and b.status in ('completed', 'closed'), 'coins are earned after a booking closes');
  if exists (
    select 1 from public.coin_ledger
     where booking_id = b.id and kind in ('earn', 'bonus')
       and ref in (v_ref, 'bonus:' || b.id::text)
  ) then
    select coalesce(sum(delta), 0)::int into v_amount
      from public.coin_ledger
     where booking_id = b.id and kind in ('earn', 'bonus') and delta > 0;
    return v_amount;
  end if;
  if not public._feature_enabled('coins_earning') then
    return 0;
  end if;

  perform public._lock_coin_account(b.customer_id);
  v_eligible := greatest(greatest(q.total, b.visit_fee) - b.coin_discount - b.refund_amount, 0);
  v_base := floor((v_eligible::numeric * (v_config ->> 'earn_rate_bp')::int / 10000) / v_unit)::int * v_unit;
  if jsonb_typeof(v_config -> 'per_txn_cap_paise') <> 'null' then
    v_base := least(v_base, floor((v_config ->> 'per_txn_cap_paise')::numeric / v_unit)::int * v_unit);
  end if;

  if not exists (
    select 1 from public.coin_ledger
     where user_id = b.customer_id and kind in ('earn', 'bonus') and delta > 0
  ) then
    v_bonus := floor((v_config ->> 'first_txn_bonus_paise')::numeric / v_unit)::int * v_unit;
  end if;

  select coalesce(sum(delta), 0)::bigint into v_month_earned
    from public.coin_ledger
   where user_id = b.customer_id
     and kind in ('earn', 'bonus')
     and delta > 0
     and created_at >= date_trunc('month', now());
  v_amount := floor(least(
    v_base::bigint + v_bonus,
    greatest((v_config ->> 'monthly_cap_paise')::bigint - v_month_earned, 0)
  ) / v_unit)::int * v_unit;

  v_budget := nullif(v_config ->> 'pilot_budget_paise', '')::int;
  if v_budget is not null then
    select coalesce(sum(delta), 0)::bigint into v_issued
      from public.coin_ledger
     where kind in ('earn', 'bonus') and delta > 0;
    v_amount := floor(least(v_amount, greatest(v_budget::bigint - v_issued, 0)) / v_unit)::int * v_unit;
  end if;
  if v_amount <= 0 then
    return 0;
  end if;

  v_base_credit := least(v_base, v_amount);
  v_bonus_credit := v_amount - v_base_credit;
  if v_base_credit > 0 then
    insert into public.coin_ledger (
      user_id, delta, kind, booking_id, expires_at, ref, reason
    ) values (
      b.customer_id, v_base_credit, 'earn', b.id,
      now() + make_interval(months => (v_config ->> 'expiry_months')::int),
      v_ref, 'configured rate applied to eligible in-app paid service value'
    ) returning id into v_base_id;
  end if;
  if v_bonus_credit > 0 then
    insert into public.coin_ledger (
      user_id, delta, kind, booking_id, expires_at, ref, reason
    ) values (
      b.customer_id, v_bonus_credit, 'bonus', b.id,
      now() + make_interval(months => (v_config ->> 'expiry_months')::int),
      'bonus:' || b.id::text, 'configured first completed booking bonus'
    ) returning id into v_bonus_id;
  end if;

  select * into v_account from public.coin_accounts where user_id = b.customer_id for update;
  v_recover := least(v_account.clawback_due, v_amount);
  v_take := least(v_base_credit, v_recover);
  if v_take > 0 then
    insert into public.coin_ledger (
      user_id, delta, kind, booking_id, source_ledger_id, expires_at, ref, reason
    ) values (
      b.customer_id, -v_take, 'clawback', b.id, v_base_id, null,
      'clawback-debt:' || b.id::text || ':earn',
      'recovered a previous refund clawback from a new earn'
    );
  end if;
  if v_recover > v_take then
    insert into public.coin_ledger (
      user_id, delta, kind, booking_id, source_ledger_id, expires_at, ref, reason
    ) values (
      b.customer_id, -(v_recover - v_take), 'clawback', b.id, v_bonus_id, null,
      'clawback-debt:' || b.id::text || ':bonus',
      'recovered a previous refund clawback from a new booking bonus'
    );
  end if;
  if v_recover > 0 then
    update public.coin_accounts
       set clawback_due = clawback_due - v_recover, updated_at = now()
     where user_id = b.customer_id;
  end if;

  if to_regclass('public.analytics_events') is not null then
    execute 'insert into public.analytics_events (user_id, event, props) values ($1, ''coins_earned'', jsonb_build_object(''amount_paise'', $2, ''booking_id'', $3))'
      using b.customer_id, v_amount, b.id;
  end if;
  return v_amount;
end;
$$;

create or replace function public._clawback_booking_coins(p_booking_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  q public.quotes;
  v_config jsonb := public._coins_config();
  v_unit int := (v_config ->> 'coin_paise')::int;
  v_base_original int;
  v_bonus_original int;
  v_original int;
  v_target bigint;
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
  select coalesce(sum(delta), 0)::int into v_base_original
    from public.coin_ledger where booking_id = b.id and kind = 'earn' and delta > 0 and ref = 'earn:' || b.id::text;
  select coalesce(sum(delta), 0)::int into v_bonus_original
    from public.coin_ledger where booking_id = b.id and kind = 'bonus' and delta > 0 and ref = 'bonus:' || b.id::text;
  v_original := v_base_original + v_bonus_original;
  if v_original = 0 then
    return 0;
  end if;
  v_target := floor((
    greatest(greatest(q.total, b.visit_fee) - b.coin_discount - b.refund_amount, 0)::numeric
      * (v_config ->> 'earn_rate_bp')::int / 10000
  ) / v_unit)::int * v_unit;
  if jsonb_typeof(v_config -> 'per_txn_cap_paise') <> 'null' then
    v_target := least(v_target, floor((v_config ->> 'per_txn_cap_paise')::numeric / v_unit)::int * v_unit);
  end if;
  if greatest(greatest(q.total, b.visit_fee) - b.coin_discount - b.refund_amount, 0) > 0 then
    v_target := v_target + v_bonus_original;
  end if;
  v_target := least(v_original, v_target);
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
  v_config jsonb := public._coins_config();
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
    b.customer_id, v_amount, 'admin', b.id,
    now() + make_interval(months => (v_config ->> 'expiry_months')::int),
    'restore-terminal:' || b.id::text, 'redeemed coins restored after cancellation or full refund'
  ) on conflict (ref) do nothing;
  update public.bookings set coin_discount = 0 where id = b.id;
  return v_amount;
end;
$$;

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
  v_months int := (public._coins_config() ->> 'expiry_months')::int;
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
      'expire:' || lot.id::text,
      'Seva Coins expired after ' || v_months::text || ' configured months'
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
  v_config jsonb := public._coins_config();
  v_unit int := (v_config ->> 'coin_paise')::int;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(
    p_delta <> 0 and p_delta between -10000000 and 10000000 and mod(p_delta, v_unit) = 0,
    'adjustment must be a non-zero whole-coin amount within range'
  );
  perform public._assert(char_length(trim(coalesce(p_reason, ''))) >= 3, 'reason is required');
  perform public._lock_coin_account(p_user_id);

  if p_delta > 0 then
    insert into public.coin_ledger (
      id, user_id, delta, kind, expires_at, ref, reason, created_by
    ) values (
      v_id, p_user_id, p_delta, 'admin',
      now() + make_interval(months => (v_config ->> 'expiry_months')::int),
      v_ref, trim(p_reason), v_admin
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
  public._coins_config(),
  public._coin_lots_for_summary(),
  public.get_coins_config(),
  public.admin_get_coins_config(),
  public.admin_set_coins_config(jsonb),
  public.admin_coin_summary(),
  public.get_coin_redemption_preview(uuid, uuid),
  public._apply_quote_coins(uuid, uuid, boolean),
  public._credit_booking_coins(uuid),
  public._clawback_booking_coins(uuid),
  public._restore_coins_for_terminal_booking(uuid),
  public.expire_coins(int),
  public.admin_adjust_coins(uuid, int, text)
from public, anon, authenticated;

grant execute on function public.get_coins_config() to authenticated;
grant execute on function public.admin_get_coins_config(),
  public.admin_set_coins_config(jsonb),
  public.admin_coin_summary(),
  public.get_coin_redemption_preview(uuid, uuid),
  public.admin_adjust_coins(uuid, int, text)
to authenticated;
grant execute on function public.expire_coins(int) to service_role;

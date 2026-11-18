-- WP F3; owns: _apply_quote_coins, _restore_coins_for_terminal_booking, get_coin_redemption_preview, _credit_booking_coins; sources: WS9-T01, WS9-T03, WS9-T04, WS9-T16

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
  if v_existing > 0 then
    v_cap := floor(least(v_existing, v_service_cap, v_platform_cap)::numeric / v_unit)::int * v_unit;
  end if;
  return jsonb_build_object(
    'balance_paise', v_balance,
    'coin_paise', v_unit,
    'service_cap_paise', v_service_cap,
    'platform_cap_paise', v_platform_cap,
    'maximum_paise', v_cap,
    'applied_paise', case when v_enabled then least(v_existing, v_service_cap, v_platform_cap) else 0 end,
    'can_redeem', (v_enabled and v_existing = 0)
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
  v_use boolean := coalesce(p_use_coins, false);
begin
  if v_use and not public._feature_enabled('coins_redemption') then
    v_use := false;
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
        delete from public.payments
         where booking_id = b.id and funding_source = 'coins' and status = 'paid';
      end if;
    end if;
  elsif v_use then
    v_balance := public._coin_balance(v_uid);
    v_allowed := floor(least(v_balance, v_service_cap, v_platform_cap)::numeric / v_unit)::int * v_unit;
    v_spent := public._spend_coin_lots(
      v_uid, v_allowed, 'redeem', b.id, 'redeem:' || b.id::text || ':' || q.id::text,
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
   where booking_id = b.id and funding_source = 'coins' and status = 'paid'
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
  if q.id is null or b.status not in ('completed', 'closed') then
    return 0;
  end if;
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

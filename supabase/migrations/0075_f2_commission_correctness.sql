-- WP F2; owns: commissionable quote writers, _commission_bp, admin_set_commission,
-- snapshot helpers, _create_payout, _finalize_completion, _finalize_session_completion,
-- _create_fixed_occurrence,
-- get_quote_settlement_preview; sources: WS6-T03, WS6-T11, WS6-T12, WS6-T21, WS5-T03

alter table public.quotes
  add column if not exists subtotal_commissionable int not null default 0
    check (subtotal_commissionable >= 0);

alter table public.bookings
  add column if not exists commission_bp_snapshot int
    check (commission_bp_snapshot between 0 and 10000);

create or replace function public._commissionable(p_kind public.quote_item_kind)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_kind in ('labour', 'package', 'per_unit', 'addon', 'travel')
$$;

update public.app_config
   set value = value || jsonb_build_object(
     'fixed', coalesce(value -> 'fixed',
       '{"tiers":[{"min_jobs":200,"bp":1200},{"min_jobs":50,"bp":1300},{"min_jobs":0,"bp":1500}]}'::jsonb),
     'proposal', coalesce(value -> 'proposal', '{"bp":800,"cap_paise":500000}'::jsonb)
   )
 where key = 'commission';

create or replace function public._commission_bp(
  p_provider_id uuid,
  p_customer_id uuid,
  p_booking_id uuid,
  p_at timestamptz
)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.bookings;
  p public.providers;
  v_bp int;
  v_override int;
  v_repeat boolean;
  v_config jsonb;
begin
  select * into b
    from public.bookings
   where id = p_booking_id
     and provider_id = p_provider_id
     and customer_id = p_customer_id;
  if not found then return 0; end if;

  select * into p from public.providers where id = p_provider_id;
  if not found then return null; end if;
  select value into v_config from public.app_config where key = 'commission';
  v_config := coalesce(v_config, '{}'::jsonb);
  if p_at < p.created_at + make_interval(days => coalesce((v_config ->> 'founding_days')::int, 30)) then
    return 0;
  end if;

  case b.archetype
    when 'fixed' then
      select (tier ->> 'bp')::int into v_bp
        from jsonb_array_elements(coalesce(
          v_config -> 'fixed' -> 'tiers',
          '[{"min_jobs":200,"bp":1200},{"min_jobs":50,"bp":1300},{"min_jobs":0,"bp":1500}]'::jsonb
        )) as item(tier)
       where p.jobs_completed >= (tier ->> 'min_jobs')::int
       order by (tier ->> 'min_jobs')::int desc
       limit 1;
      v_bp := coalesce(v_bp, 1500);
    when 'proposal' then
      v_bp := coalesce((v_config -> 'proposal' ->> 'bp')::int, 800);
    else
      v_bp := public._commission_bp(p_provider_id, p_at);
  end case;

  select c.commission_bp into v_override
    from public.categories c
   where c.id = b.category_id;
  if v_override is not null then v_bp := v_override; end if;

  select exists (
    select 1
      from public.bookings prior
     where prior.provider_id = p_provider_id
       and prior.customer_id = p_customer_id
       and prior.id <> p_booking_id
       and prior.completed_at is not null
       and prior.completed_at >= p_at - interval '12 months'
       and prior.completed_at <= p_at
       and prior.status in ('completed', 'closed')
  ) into v_repeat;
  if v_repeat and v_bp > 0 then
    return greatest(
      v_bp - coalesce((v_config ->> 'repeat_discount_bp')::int, 400),
      coalesce((v_config ->> 'repeat_floor_bp')::int, 500)
    );
  end if;
  return v_bp;
end;
$$;

create or replace function public._booking_commission_bp(p_booking_id uuid, p_at timestamptz)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found then return null; end if;
  if b.booking_origin = 'byo' then return 0; end if;
  if b.archetype = 'time_based' then
    return public._time_based_commission_bp(b.id, p_at);
  end if;
  return public._commission_bp(b.provider_id, b.customer_id, b.id, p_at);
end;
$$;

revoke all on function public._commissionable(public.quote_item_kind),
  public._booking_commission_bp(uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public._legacy_fixed_commissionable(p_quote_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q public.quotes;
  v_line_total int;
  v_noncommissionable int;
  v_has_package_line boolean;
  v_package_base int;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found then return 0; end if;
  if q.is_change_order then
    select coalesce(sum(round(qi.qty * qi.unit_price)::int), 0)::int
      into v_noncommissionable
      from public.quote_items qi
     where qi.quote_id = q.id
       and qi.kind <> 'other'
       and not public._commissionable(qi.kind);
    return greatest(q.total - coalesce(v_noncommissionable, 0), 0);
  end if;
  select coalesce(sum(round(qi.qty * qi.unit_price)::int), 0)::int,
         coalesce(bool_or(qi.kind = 'package'), false)
    into v_line_total, v_has_package_line
    from public.quote_items qi
   where qi.quote_id = q.id
     and public._commissionable(qi.kind);
  if v_has_package_line then
    return v_line_total;
  end if;
  v_package_base := coalesce(
    round((q.package_snapshot ->> 'unit_price')::numeric
      * (q.package_snapshot ->> 'quantity')::numeric)::int,
    coalesce(q.subtotal_labour, 0) + coalesce(q.subtotal_travel, 0)
  );
  return coalesce(v_package_base, 0) + coalesce(v_line_total, 0);
end;
$$;

revoke all on function public._legacy_fixed_commissionable(uuid)
  from public, anon, authenticated;

create or replace function public.admin_set_commission(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_days int;
  v_discount int;
  v_floor int;
  v_one_off int;
  v_recurring int;
  v_count int;
  v_zero_tiers int;
  v_config jsonb;
  v_tiers jsonb;
  v_time_based jsonb;
  v_fixed jsonb;
  v_fixed_tiers jsonb;
  v_proposal jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(coalesce(jsonb_typeof(p_config) = 'object', false), 'commission config must be an object');
  perform public._assert(coalesce(p_config ->> 'founding_days', '') ~ '^[0-9]+$', 'founding days must be an integer');
  v_days := (p_config ->> 'founding_days')::int;
  perform public._assert(v_days between 0 and 365, 'founding days must be between 0 and 365');
  perform public._assert(
    case
      when jsonb_typeof(p_config -> 'tiers') = 'array'
        then jsonb_array_length(p_config -> 'tiers') between 1 and 10
      else false
    end,
    'commission requires 1 to 10 tiers'
  );
  perform public._assert(coalesce(p_config ->> 'repeat_discount_bp', '') ~ '^[0-9]+$', 'repeat discount must be an integer');
  perform public._assert(coalesce(p_config ->> 'repeat_floor_bp', '') ~ '^[0-9]+$', 'repeat floor must be an integer');
  v_discount := (p_config ->> 'repeat_discount_bp')::int;
  v_floor := (p_config ->> 'repeat_floor_bp')::int;
  perform public._assert(v_discount between 0 and 3000 and v_floor between 0 and 3000,
    'repeat discount and floor must be between 0 and 3000 basis points');

  select value -> 'time_based', value -> 'fixed', value -> 'proposal'
    into v_time_based, v_fixed, v_proposal
    from public.app_config where key = 'commission';
  v_time_based := coalesce(p_config -> 'time_based', v_time_based, '{"one_off_bp":1000,"recurring_bp":800}'::jsonb);
  v_fixed := coalesce(p_config -> 'fixed', v_fixed,
    '{"tiers":[{"min_jobs":200,"bp":1200},{"min_jobs":50,"bp":1300},{"min_jobs":0,"bp":1500}]}'::jsonb);
  v_proposal := coalesce(p_config -> 'proposal', v_proposal, '{"bp":800,"cap_paise":500000}'::jsonb);
  perform public._assert(coalesce(jsonb_typeof(v_time_based) = 'object', false),
    'time-based commission must be an object');
  perform public._assert(coalesce(v_time_based ->> 'one_off_bp', '') ~ '^[0-9]+$'
    and coalesce(v_time_based ->> 'recurring_bp', '') ~ '^[0-9]+$',
    'time-based commission rates must be integers');
  v_one_off := (v_time_based ->> 'one_off_bp')::int;
  v_recurring := (v_time_based ->> 'recurring_bp')::int;
  perform public._assert(v_one_off between 0 and 3000 and v_recurring between 0 and 3000,
    'time-based commission rates must be between 0 and 3000 basis points');

  select count(*), count(*) filter (where (tier ->> 'min_jobs')::int = 0)
    into v_count, v_zero_tiers
    from jsonb_array_elements(p_config -> 'tiers') as item(tier)
   where jsonb_typeof(tier) = 'object'
     and coalesce(tier ->> 'min_jobs', '') ~ '^[0-9]+$'
     and coalesce(tier ->> 'bp', '') ~ '^[0-9]+$';
  perform public._assert(v_count = jsonb_array_length(p_config -> 'tiers'), 'every tier requires integer min_jobs and bp');
  perform public._assert(v_zero_tiers = 1, 'commission tiers require exactly one zero-job tier');
  perform public._assert(not exists (
    select 1 from jsonb_array_elements(p_config -> 'tiers') as item(tier)
     where (tier ->> 'bp')::int not between 0 and 3000
  ), 'tier rates must be between 0 and 3000 basis points');
  perform public._assert((
    select count(distinct (tier ->> 'min_jobs')::int) = jsonb_array_length(p_config -> 'tiers')
      from jsonb_array_elements(p_config -> 'tiers') as item(tier)
  ), 'commission tier job thresholds must be unique');
  select jsonb_agg(tier order by (tier ->> 'min_jobs')::int desc)
    into v_tiers
    from jsonb_array_elements(p_config -> 'tiers') as item(tier);

  perform public._assert(coalesce(jsonb_typeof(v_fixed) = 'object', false)
    and jsonb_typeof(v_fixed -> 'tiers') = 'array'
    and jsonb_array_length(v_fixed -> 'tiers') between 1 and 10,
    'fixed commission requires 1 to 10 tiers');
  select count(*), count(*) filter (where (tier ->> 'min_jobs')::int = 0)
    into v_count, v_zero_tiers
    from jsonb_array_elements(v_fixed -> 'tiers') as item(tier)
   where jsonb_typeof(tier) = 'object'
     and coalesce(tier ->> 'min_jobs', '') ~ '^[0-9]+$'
     and coalesce(tier ->> 'bp', '') ~ '^[0-9]+$';
  perform public._assert(v_count = jsonb_array_length(v_fixed -> 'tiers')
    and v_zero_tiers = 1, 'fixed tiers require integer fields and one zero-job tier');
  perform public._assert(not exists (
    select 1 from jsonb_array_elements(v_fixed -> 'tiers') as item(tier)
     where (tier ->> 'bp')::int not between 0 and 3000
  ), 'fixed tier rates must be between 0 and 3000 basis points');
  perform public._assert((
    select count(distinct (tier ->> 'min_jobs')::int) = jsonb_array_length(v_fixed -> 'tiers')
      from jsonb_array_elements(v_fixed -> 'tiers') as item(tier)
  ), 'fixed tier job thresholds must be unique');
  select jsonb_agg(tier order by (tier ->> 'min_jobs')::int desc)
    into v_fixed_tiers
    from jsonb_array_elements(v_fixed -> 'tiers') as item(tier);
  v_fixed := jsonb_build_object('tiers', v_fixed_tiers);

  perform public._assert(coalesce(jsonb_typeof(v_proposal) = 'object', false)
    and coalesce(v_proposal ->> 'bp', '') ~ '^[0-9]+$'
    and coalesce(v_proposal ->> 'cap_paise', '') ~ '^[0-9]+$',
    'proposal commission requires integer bp and cap_paise');
  perform public._assert((v_proposal ->> 'bp')::int between 0 and 3000
    and (v_proposal ->> 'cap_paise')::int between 1 and 100000000,
    'proposal rate or cap is outside supported bounds');

  v_config := jsonb_build_object(
    'founding_days', v_days,
    'tiers', v_tiers,
    'repeat_discount_bp', v_discount,
    'repeat_floor_bp', v_floor,
    'time_based', jsonb_build_object('one_off_bp', v_one_off, 'recurring_bp', v_recurring),
    'fixed', v_fixed,
    'proposal', jsonb_build_object(
      'bp', (v_proposal ->> 'bp')::int,
      'cap_paise', (v_proposal ->> 'cap_paise')::int
    )
  );
  insert into public.app_config (key, value, updated_at, updated_by)
  values ('commission', v_config, now(), v_uid)
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  insert into public.admin_audit_log (admin_id, action, details)
  values (v_uid, 'set_commission_config', v_config);
  return v_config;
end;
$$;

update public.quotes q
   set subtotal_commissionable = case
     when b.archetype = 'fixed' then public._legacy_fixed_commissionable(q.id)
     when b.archetype = 'proposal' then coalesce((
       select sum(round(pi.qty * pi.unit_price)::int)::int
         from public.proposal_items pi
        where pi.proposal_id = b.proposal_id
          and public._commissionable(pi.kind)
     ), 0)
     else coalesce((
       select sum(round(qi.qty * qi.unit_price)::int)::int
         from public.quote_items qi
        where qi.quote_id = q.id
          and public._commissionable(qi.kind)
     ), coalesce(q.subtotal_labour, 0)) + coalesce(q.subtotal_travel, 0)
   end
  from public.bookings b
 where b.id = q.booking_id
   and q.status in ('sent', 'approved_pending_payment', 'approved')
   and q.subtotal_commissionable = 0;

update public.bookings b
   set commission_bp_snapshot = public._booking_commission_bp(
     b.id,
     coalesce(
       (select q.created_at from public.quotes q where q.id = b.approved_quote_id),
       (select max(q.created_at) from public.quotes q where q.booking_id = b.id),
       b.created_at
     )
   )
 where b.commission_bp_snapshot is null
   and b.status not in ('completed', 'closed', 'cancelled', 'declined', 'expired', 'refunded');

create or replace function public._snapshot_booking_commission_on_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' and new.booking_id is not null and new.purpose <> 'visit_fee' then
    update public.bookings b
       set commission_bp_snapshot = public._booking_commission_bp(
         b.id, coalesce(new.paid_at, now())
       )
     where b.id = new.booking_id
       and b.commission_bp_snapshot is null;
  end if;
  return new;
end;
$$;

revoke all on function public._snapshot_booking_commission_on_payment() from public, anon, authenticated;
drop trigger if exists payments_snapshot_booking_commission on public.payments;
create trigger payments_snapshot_booking_commission
after insert or update on public.payments
for each row execute function public._snapshot_booking_commission_on_payment();

create or replace function public._snapshot_booking_commission_on_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('approved_pending_payment', 'approved') then
    update public.bookings b
       set commission_bp_snapshot = public._booking_commission_bp(b.id, now())
     where b.id = new.booking_id
       and b.commission_bp_snapshot is null;
  end if;
  return new;
end;
$$;

revoke all on function public._snapshot_booking_commission_on_quote() from public, anon, authenticated;
drop trigger if exists quotes_snapshot_booking_commission on public.quotes;
create trigger quotes_snapshot_booking_commission
after insert or update on public.quotes
for each row execute function public._snapshot_booking_commission_on_quote();

create or replace function public._create_payout(
  p_booking_id uuid,
  p_gross int,
  p_commissionable int,
  p_release_after timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_bp int;
  v_commission int;
  v_gst int;
  v_payout uuid;
  v_is_demo boolean;
begin
  select * into b from public.bookings where id = p_booking_id;
  perform public._assert(found, 'booking not found');
  v_is_demo := exists (
    select 1
      from public.payments p
     where p.booking_id = b.id
       and p.status = 'paid'
       and p.razorpay_payment_id is not null
       and left(p.razorpay_payment_id, 9) = 'pay_demo_'
  );
  v_bp := coalesce(
    b.commission_bp_snapshot,
    case
      when b.booking_origin = 'byo' then 0
      else public._booking_commission_bp(b.id, now())
    end
  );
  v_commission := round(p_commissionable::numeric * v_bp / 10000)::int;
  v_gst := round(v_commission::numeric * 18 / 100)::int;

  insert into public.payouts (
    booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
  )
  values (
    b.id, b.provider_id, p_gross, v_commission, v_gst,
    greatest(p_gross - v_commission - v_gst, 0),
    case when v_is_demo then 'demo'::public.payout_status else 'pending'::public.payout_status end,
    p_release_after
  )
  on conflict (booking_id) do nothing
  returning id into v_payout;

  if v_payout is not null then
    update public.bookings set commission = v_commission, gst_on_commission = v_gst where id = b.id;
    if v_is_demo then
      return;
    end if;
    perform public._allocate_payout(v_payout);
  end if;
end;
$$;

create or replace function public._finalize_completion(p_booking_id uuid, p_actor uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  q public.quotes;
  v_completed timestamptz := now();
  v_commissionable int;
  v_commission_bp int;
  v_cap_paise int;
  v_config jsonb;
begin
  select * into b from public.bookings where id = p_booking_id;
  select * into q from public.quotes where id = b.approved_quote_id;
  perform public._assert(q.id is not null, 'no approved quote');
  v_commissionable := coalesce(
    nullif(q.subtotal_commissionable, 0),
    coalesce(q.subtotal_labour, 0) + coalesce(q.subtotal_travel, 0)
  );
  if b.archetype = 'proposal' then
    v_commission_bp := coalesce(
      b.commission_bp_snapshot,
      public._booking_commission_bp(b.id, v_completed)
    );
    select value into v_config from public.app_config where key = 'commission';
    v_cap_paise := coalesce((v_config -> 'proposal' ->> 'cap_paise')::int, 500000);
    if v_commission_bp > 0 then
      v_commissionable := least(
        v_commissionable,
        floor(v_cap_paise::numeric * 10000 / v_commission_bp)::int
      );
    end if;
  end if;
  perform public._close_open_quotes(b.id);
  update public.bookings set completed_at = v_completed where id = b.id;
  perform public._create_payout(
    b.id, greatest(q.total, b.visit_fee), v_commissionable, v_completed + interval '24 hours'
  );
  update public.providers set jobs_completed = jobs_completed + 1 where id = b.provider_id;
  update public.providers set commission_tier = public._commission_bp(id, now()) / 100 where id = b.provider_id;
  perform public._set_status(b.id, 'completed', p_actor, p_note);
end;
$$;

create or replace function public._finalize_session_completion(p_booking_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  ps public.pack_sessions;
  k public.pack_purchases;
  p public.payments;
  v_payout uuid;
  v_bp int;
  v_commission int;
  v_gst int;
  v_net int;
  v_capacity int;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.pack_session_id is not null then
    select * into ps from public.pack_sessions where id = b.pack_session_id for update;
    select * into k from public.pack_purchases where id = b.pack_purchase_id for update;
    perform public._assert(k.payment_id is not null, 'pack payment is missing');
    select * into p from public.payments where id = k.payment_id and status = 'paid' for update;
  else
    select pm.* into p
      from public.payments pm
      join public.payment_schedule o on o.id = pm.schedule_id
     where pm.booking_id = b.id
       and pm.status = 'paid'
       and o.label = 'Session service'
     order by pm.paid_at
     limit 1
     for update of pm;
  end if;
  perform public._assert(p.id is not null, 'session payment is missing');

  v_bp := coalesce(b.commission_bp_snapshot, public._time_based_commission_bp(b.id, now()));
  v_commission := round((b.total_amount - coalesce(b.platform_fee, 0))::numeric * v_bp / 10000)::int;
  v_gst := round(v_commission::numeric * 18 / 100)::int;
  v_net := greatest((b.total_amount - b.platform_fee) - v_commission - v_gst, 0);
  v_capacity := p.amount
    - coalesce((select sum(t.amount) from public.payout_transfers t where t.source_payment_id = p.id), 0)
    - coalesce((select sum(r.amount) from public.refunds r where r.payment_id = p.id and r.status <> 'failed'), 0);
  perform public._assert(v_capacity >= v_net, 'pack payment does not cover provider payout');

  insert into public.payouts (
    booking_id, provider_id, gross, commission, gst_on_commission, amount, release_after
  )
  values (
    b.id, b.provider_id, b.total_amount - b.platform_fee,
    v_commission, v_gst, v_net, now() + interval '24 hours'
  )
  on conflict (booking_id) do nothing
  returning id into v_payout;
  if v_payout is not null then
    insert into public.payout_transfers (payout_id, source_payment_id, amount) values (v_payout, p.id, v_net);
    update public.bookings
       set completed_at = now(), commission = v_commission, gst_on_commission = v_gst
     where id = b.id;
    update public.providers
       set jobs_completed = jobs_completed + 1
     where id = b.provider_id;
    update public.pack_sessions
       set status = 'completed', completed_at = now()
     where id = b.pack_session_id;
    perform public._set_status(b.id, 'completed', p_actor, 'session completed');
  end if;
end;
$$;

create or replace function public.get_quote_settlement_preview(p_quote_id uuid)
returns table (
  commissionable int,
  commission_bp int,
  commission int,
  gst_on_commission int,
  payout int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q public.quotes;
  b public.bookings;
  p public.payouts;
  v_commissionable int;
  v_commission_base int;
  v_commission_bp int;
  v_commission int;
  v_gst int;
  v_payout int;
  v_gross int;
  v_cap_paise int;
  v_config jsonb;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found then return; end if;
  select * into b from public.bookings where id = q.booking_id;
  if not found or not public._acts_for(b.provider_id, 'manager') then return; end if;

  v_commissionable := coalesce(
    nullif(q.subtotal_commissionable, 0),
    coalesce(q.subtotal_labour, 0) + coalesce(q.subtotal_travel, 0)
  );
  v_commission_bp := coalesce(
    b.commission_bp_snapshot,
    public._booking_commission_bp(b.id, now())
  );
  if b.archetype = 'proposal' then
    select value into v_config from public.app_config where key = 'commission';
    v_cap_paise := coalesce((v_config -> 'proposal' ->> 'cap_paise')::int, 500000);
    if v_commission_bp > 0 then
      v_commission_base := least(
        v_commissionable,
        floor(v_cap_paise::numeric * 10000 / v_commission_bp)::int
      );
    else
      v_commission_base := v_commissionable;
    end if;
  else
    v_commission_base := v_commissionable;
  end if;
  v_gross := greatest(q.total, b.visit_fee);
  select * into p from public.payouts where booking_id = b.id;
  if found and b.approved_quote_id = q.id then
    return query select
      v_commissionable, v_commission_bp, p.commission, p.gst_on_commission, p.amount;
    return;
  end if;
  v_commission := round(v_commission_base::numeric * v_commission_bp / 10000)::int;
  v_gst := round(v_commission::numeric * 18 / 100)::int;
  v_payout := greatest(v_gross - v_commission - v_gst, 0);
  return query select v_commissionable, v_commission_bp, v_commission, v_gst, v_payout;
end;
$$;

revoke all on function public.get_quote_settlement_preview(uuid) from public, anon;
grant execute on function public.get_quote_settlement_preview(uuid) to authenticated, service_role;

create or replace function public.send_quote(p_booking_id uuid, p_items jsonb, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_request public.travel_requests;
  v_item jsonb;
  v_kind public.quote_item_kind;
  v_qty numeric;
  v_price int;
  v_line int;
  v_labour int := 0;
  v_parts int := 0;
  v_other int := 0;
  v_travel int := 0;
  v_commissionable int := 0;
  v_version int;
  v_quote uuid;
begin
  perform public._assert(public._acts_for(b.provider_id, 'manager'), 'manager role required to send quotes');
  perform public._assert(b.status in ('inspecting', 'quote_sent', 'in_progress'), 'quote not allowed in this state');
  perform public._assert(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 30,
                         'quote needs 1 to 30 items');
  perform public._assert(not exists (
    select 1 from jsonb_array_elements(p_items) item
    where coalesce(item ->> 'travel_request_id', '') <> ''
  ), 'travel fee lines are managed automatically');

  if b.travel_request_id is not null then
    select r.* into v_request from public.travel_requests r where r.id = b.travel_request_id;
    perform public._assert(found and v_request.status = 'used', 'travel request is not attached to this booking');
    v_travel := v_request.quoted_fee;
    v_other := v_travel;
    v_commissionable := v_travel;
  end if;

  perform public._close_open_quotes(b.id);
  select coalesce(max(version), 0) + 1 into v_version from public.quotes where booking_id = b.id;
  insert into public.quotes (booking_id, version, total, note, is_change_order)
  values (b.id, v_version, 0, p_note, b.status = 'in_progress')
  returning id into v_quote;

  if b.travel_request_id is not null then
    insert into public.quote_items (quote_id, kind, title, qty, unit_price, travel_request_id)
    values (v_quote, 'travel', 'Travel fee (' || v_request.distance_km || ' km)', 1, v_travel, v_request.id);
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind := (v_item ->> 'kind')::public.quote_item_kind;
    perform public._assert(v_kind in ('labour', 'part', 'other'), 'quote item kind is not allowed');
    v_qty := (v_item ->> 'qty')::numeric;
    v_price := (v_item ->> 'unit_price')::int;
    perform public._assert(coalesce(trim(v_item ->> 'title'), '') <> '', 'item title is required');
    perform public._assert(v_qty > 0 and v_qty <= 1000, 'invalid quantity');
    perform public._assert(v_price >= 0 and v_price <= 10000000, 'invalid unit price');
    v_line := round(v_qty * v_price);
    case v_kind
      when 'labour' then v_labour := v_labour + v_line;
      when 'part' then v_parts := v_parts + v_line;
      else v_other := v_other + v_line;
    end case;
    if public._commissionable(v_kind) then
      v_commissionable := v_commissionable + v_line;
    end if;
    insert into public.quote_items (quote_id, kind, title, qty, unit_price, bill_photo_url)
    values (v_quote, v_kind, trim(v_item ->> 'title'), v_qty, v_price, nullif(v_item ->> 'bill_photo_url', ''));
  end loop;

  update public.quotes
     set subtotal_labour = v_labour, subtotal_parts = v_parts, subtotal_other = v_other,
         subtotal_travel = v_travel, subtotal_commissionable = v_commissionable,
         total = v_labour + v_parts + v_other
   where id = v_quote;

  if b.status = 'inspecting' then
    perform public._set_status(b.id, 'quote_sent', v_uid, 'quote v' || v_version);
  else
    perform public._log_event(b.id, v_uid,
      case when b.status = 'in_progress' then 'change order v' else 'quote v' end || v_version);
  end if;
  return v_quote;
end;
$$;

create or replace function public.send_fixed_addons(
  p_booking_id uuid,
  p_addons jsonb,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  qi record;
  v_item jsonb;
  v_quote uuid;
  v_version int;
  v_addon_total int := 0;
  v_commissionable int;
begin
  perform public._assert(public._acts_for(b.provider_id, 'manager'), 'manager role required to send quotes');
  perform public._assert(b.archetype = 'fixed' and b.status = 'in_progress', 'add-ons are allowed only during fixed service');
  perform public._assert(jsonb_typeof(p_addons) = 'array' and jsonb_array_length(p_addons) between 1 and 20, '1 to 20 add-ons are required');
  select * into q from public.quotes where id = b.approved_quote_id for update;
  perform public._assert(q.id is not null and q.status = 'approved' and q.quote_type = 'package', 'approved package quote not found');

  for v_item in select value from jsonb_array_elements(p_addons) loop
    perform public._assert(
      char_length(trim(coalesce(v_item ->> 'title', ''))) between 2 and 160,
      'add-on title is required'
    );
    perform public._assert(
      coalesce((v_item ->> 'qty')::numeric, 0) > 0
      and coalesce((v_item ->> 'qty')::numeric, 0) <= 100
      and coalesce((v_item ->> 'unit_price')::int, -1) > 0
      and coalesce((v_item ->> 'unit_price')::int, 0) <= 10000000,
      'invalid add-on quantity or price'
    );
    v_addon_total := v_addon_total
      + round((v_item ->> 'qty')::numeric * (v_item ->> 'unit_price')::int)::int;
  end loop;

  v_commissionable := case
    when q.subtotal_commissionable > 0 then q.subtotal_commissionable
    else public._legacy_fixed_commissionable(q.id)
  end + v_addon_total;
  update public.bookings
     set commission_bp_snapshot = coalesce(
       commission_bp_snapshot, public._booking_commission_bp(b.id, now())
     )
   where id = b.id;
  perform public._close_open_quotes(b.id);
  select coalesce(max(version), 0) + 1 into v_version from public.quotes where booking_id = b.id;
  insert into public.quotes (
    booking_id, version, status, is_change_order, subtotal_labour, subtotal_parts,
    subtotal_other, subtotal_commissionable, total, note, quote_type, source_package_id, package_snapshot
  ) values (
    b.id, v_version, 'sent', true, q.subtotal_labour, q.subtotal_parts,
    q.subtotal_other + v_addon_total, v_commissionable, q.total + v_addon_total,
    nullif(trim(p_note), ''), 'package', q.source_package_id, q.package_snapshot
  ) returning id into v_quote;

  for qi in select * from public.quote_items where quote_id = q.id order by id loop
    insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price, bill_photo_url)
    values (
      v_quote,
      case
        when qi.kind = 'other'
         and q.quote_type = 'package'
         and qi.title = q.package_snapshot ->> 'title'
         and round(qi.qty * qi.unit_price)::int =
           round((q.package_snapshot ->> 'unit_price')::numeric
             * (q.package_snapshot ->> 'quantity')::numeric)::int
        then 'package'::public.quote_item_kind else qi.kind end,
      qi.title, qi.qty, qi.unit, qi.unit_price, qi.bill_photo_url
    );
  end loop;
  for v_item in select value from jsonb_array_elements(p_addons) loop
    insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price)
    values (
      v_quote, 'addon', trim(v_item ->> 'title'), (v_item ->> 'qty')::numeric,
      nullif(trim(v_item ->> 'unit'), ''), (v_item ->> 'unit_price')::int
    );
  end loop;
  perform public._log_event(b.id, v_uid, 'fixed add-on change order v' || v_version);
  return v_quote;
end;
$$;

create or replace function public.create_fixed_booking(
  p_package_id uuid,
  p_quantity numeric,
  p_window tstzrange,
  p_location jsonb,
  p_intake jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_config jsonb := public._fixed_booking_config();
  v_package public.service_packages;
  v_service public.provider_services;
  v_provider public.providers;
  v_category public.categories;
  v_address public.addresses;
  v_address_id uuid;
  v_booking uuid;
  v_quote uuid;
  v_mode text;
  v_city text;
  v_lat double precision;
  v_lng double precision;
  v_quantity numeric;
  v_service_total int;
  v_duration int;
  v_platform_fee int;
  v_snapshot jsonb;
begin
  perform public._assert(coalesce((v_config ->> 'enabled')::boolean, false), 'fixed booking is disabled');
  perform public._assert(jsonb_typeof(coalesce(p_location, '{}'::jsonb)) = 'object', 'location must be an object');
  perform public._assert(jsonb_typeof(coalesce(p_intake, '{}'::jsonb)) = 'object', 'intake must be an object');
  perform public._assert(p_window is not null and lower_inc(p_window) and not isempty(p_window), 'service window is required');
  perform public._assert(lower(p_window) > now(), 'service window must be in the future');
  perform public._assert(p_quantity is not null and p_quantity > 0, 'quantity must be greater than zero');

  select * into v_package
    from public.service_packages
   where id = p_package_id
     and active
     and price_type = 'fixed'
   for share;
  perform public._assert(found, 'active fixed package not found');
  perform public._assert(
    p_quantity between v_package.qty_min and v_package.qty_max
    and (p_quantity = trunc(p_quantity) or v_package.qty_max > 1),
    'quantity is outside the package bounds'
  );
  perform public._assert(p_quantity <= coalesce((v_config ->> 'max_quantity')::numeric, 100), 'quantity exceeds the configured maximum');

  select * into v_service
    from public.provider_services
   where id = v_package.provider_service_id and active
   for share;
  perform public._assert(found, 'provider service is not available');
  select * into v_provider from public.providers where id = v_service.provider_id for share;
  select * into v_category from public.categories where id = v_service.category_id;
  perform public._assert(found and v_category.archetype = 'fixed', 'category must use the fixed archetype');
  perform public._assert(v_provider.id <> v_uid, 'cannot book yourself');

  v_mode := lower(trim(coalesce(p_location ->> 'mode', 'at_customer')));
  perform public._assert(v_mode = any (v_category.location_modes), 'location mode is not enabled for this category');
  perform public._assert(v_mode = 'at_customer', 'fixed package booking currently supports at_customer only');

  if coalesce(p_location ->> 'address_id', '') <> '' then
    select * into v_address
      from public.addresses
     where id = (p_location ->> 'address_id')::uuid
       and user_id = v_uid;
    perform public._assert(found, 'saved address not found');
    v_city := v_address.city;
    v_lat := v_address.lat;
    v_lng := v_address.lng;
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values (v_uid, 'Booking', v_address.line1, v_address.city, v_address.lat, v_address.lng)
    returning id into v_address_id;
  else
    v_city := trim(coalesce(p_location ->> 'city', ''));
    v_lat := (p_location ->> 'lat')::double precision;
    v_lng := (p_location ->> 'lng')::double precision;
    perform public._assert(
      char_length(trim(coalesce(p_location ->> 'address_line', ''))) between 3 and 1000
      and char_length(v_city) between 2 and 120
      and v_lat between -90 and 90
      and v_lng between -180 and 180,
      'complete customer address is required'
    );
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values (v_uid, 'Booking', trim(p_location ->> 'address_line'), v_city, v_lat, v_lng)
    returning id into v_address_id;
  end if;

  perform public._assert_bookable(v_category.id, v_provider.id, v_city, 'fixed', p_window);
  v_quantity := p_quantity;
  v_service_total := round((v_package.price::numeric * v_quantity))::int;
  v_platform_fee := greatest(coalesce((v_config ->> 'platform_fee_paise')::int, 2900), 0);
  v_duration := case
    when v_package.qty_min = 1 and v_package.qty_max = 1 then coalesce(v_package.duration_min, 60)
    else coalesce(v_package.duration_min, 60) * ceil(v_quantity)::int
  end;
  perform public._assert(
    upper(p_window) - lower(p_window) >= make_interval(mins => v_duration),
    format('service window must be at least %s minutes', v_duration)
  );
  perform public._assert(v_service_total > 0 and v_service_total <= 100000000, 'invalid package total');

  v_snapshot := jsonb_build_object(
    'id', v_package.id,
    'title', v_package.title,
    'description', v_package.description,
    'price_type', v_package.price_type,
    'unit', v_package.unit,
    'quantity', v_quantity,
    'unit_price', v_package.price,
    'duration_min', v_package.duration_min,
    'service_duration_min', v_duration,
    'inclusions', to_jsonb(v_package.inclusions),
    'exclusions', to_jsonb(v_package.exclusions),
    'deliverables', v_package.deliverables,
    'usage_rights', v_package.usage_rights,
    'intake', coalesce(p_intake, '{}'::jsonb)
  );

  perform pg_advisory_xact_lock(hashtext(v_provider.id::text));
  perform public._assert(
    not exists (
      select 1
        from public.bookings b
       where b.provider_id = v_provider.id
         and b.service_window && p_window
         and b.status in ('requested', 'accepted', 'en_route', 'in_progress', 'completion_requested', 'pending_payment')
    ),
    'provider_unavailable: service window overlaps another booking'
  );

  insert into public.bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id,
    description, scheduled_at, service_window, status, visit_fee, platform_fee,
    total_amount, archetype, location_mode, booking_origin
  ) values (
    v_uid, v_provider.id, v_category.id, v_service.id, v_address_id,
    coalesce(trim(p_intake ->> 'description'), v_package.title),
    lower(p_window), p_window, 'pending_payment', 0, v_platform_fee,
    v_service_total + v_platform_fee, 'fixed', v_mode, 'marketplace'
  ) returning id into v_booking;

  update public.bookings
     set commission_bp_snapshot = public._booking_commission_bp(v_booking, now())
   where id = v_booking;
  insert into public.booking_secrets (booking_id, start_otp)
  values (v_booking, public._gen_otp());

  insert into public.quotes (
    booking_id, version, status, is_change_order, subtotal_labour, subtotal_parts,
    subtotal_other, subtotal_commissionable, total, note, quote_type, source_package_id, package_snapshot
  ) values (
    v_booking, 1, 'approved_pending_payment', false, 0, 0,
    v_service_total, v_service_total, v_service_total, 'Fixed package quote',
    'package', v_package.id, v_snapshot
  ) returning id into v_quote;

  insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price)
  values (v_quote, 'package', v_package.title, v_quantity, v_package.unit, v_package.price);

  insert into public.payment_schedule (
    booking_id, quote_id, seq, obligation_type, label, amount, due_rule, due_at, status
  ) values
    (v_booking, v_quote, 1, 'service', 'Package payment', v_service_total, 'at_booking', now(), 'due'),
    (v_booking, v_quote, 2, 'platform_fee', 'Platform fee', v_platform_fee, 'at_booking', now(), 'due');

  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (v_booking, v_uid, null, 'pending_payment', 'fixed package booking created');
  return v_booking;
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
  perform public._assert(v_duration between 15 and 480, 'fixed recurring duration must be between 15 and 480 minutes');
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

  update public.bookings
     set commission_bp_snapshot = public._booking_commission_bp(v_booking_id, now())
   where id = v_booking_id;
  insert into public.booking_secrets (booking_id, start_otp)
  values (v_booking_id, public._gen_otp());

  insert into public.quotes (
    booking_id, version, status, is_change_order, subtotal_labour, subtotal_parts,
    subtotal_other, subtotal_commissionable, total, note, quote_type, source_package_id, package_snapshot
  ) values (
    v_booking_id, 1, 'approved_pending_payment', false, 0, 0,
    v_service_total, v_service_total, v_service_total,
    'Fixed recurring package quote', 'package', v_package.id, v_snapshot
  ) returning id into v_quote_id;

  insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price)
  values (v_quote_id, 'package', v_package.title, v_quantity, v_package.unit, v_service_total / v_quantity);

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
grant execute on function public._create_fixed_occurrence(uuid, timestamptz) to service_role;

create or replace function public.accept_proposal(p_proposal_id uuid, p_address_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_proposal public.proposals;
  v_request public.service_requests;
  v_private public.request_private;
  v_address public.addresses;
  v_category public.categories;
  v_booking uuid;
  v_existing uuid;
  v_quote uuid;
  v_address_id uuid;
  v_window tstzrange;
  v_platform_fee int;
  v_cancel_snapshot jsonb := '{}'::jsonb;
  v_fee_snapshot jsonb;
  v_commissionable int;
  v_seq int;
begin
  select * into v_proposal from public.proposals where id = p_proposal_id for update;
  perform public._assert(found, 'proposal not found');
  select * into v_request from public.service_requests where id = v_proposal.request_id for update;
  perform public._assert(v_request.customer_id = v_uid, 'only the customer can accept this proposal');
  select b.id into v_existing
    from public.bookings b
   where b.service_request_id = v_request.id
     and b.status in ('pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
                      'delivery_pending', 'completion_requested', 'disputed')
   limit 1;
  if v_existing is not null then
    perform public._assert(
      exists (select 1 from public.bookings where id = v_existing and proposal_id = p_proposal_id),
      'this request already has an active booking'
    );
    return v_existing;
  end if;
  perform public._assert(v_request.status = 'open', 'request is not open');
  perform public._assert(v_proposal.status = 'sent' and v_proposal.valid_until > now(), 'proposal is no longer valid');

  perform pg_advisory_xact_lock(hashtext(v_proposal.provider_id::text));
  select * into v_category from public.categories where id = v_request.category_id;
  perform public._assert(v_category.active and v_category.archetype = 'proposal', 'category is unavailable');
  select * into v_private from public.request_private where request_id = v_request.id;
  v_address_id := coalesce(p_address_id, v_private.address_id);
  if v_address_id is not null then
    select * into v_address from public.addresses where id = v_address_id;
    perform public._assert(found and v_address.user_id = v_uid, 'address belongs to another customer');
  elsif v_private.lat is not null and v_private.lng is not null then
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values (v_uid, 'Event venue', coalesce(v_private.venue_text, v_request.area), v_request.city,
            v_private.lat, v_private.lng)
    returning id into v_address_id;
  else
    raise exception 'address is required for booking' using errcode = 'P0001';
  end if;

  v_window := tstzrange(v_request.event_start, v_request.event_end, '[)');
  perform public._assert(not exists (
    select 1 from public.bookings b
     where b.provider_id = v_proposal.provider_id
       and b.service_window && v_window
       and b.status in ('pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
                        'delivery_pending', 'completion_requested')
       and (b.status <> 'pending_payment' or coalesce(b.payment_hold_expires_at, '-infinity') > now())
  ), 'provider is no longer available for this event');

  v_platform_fee := least(49900, greatest(9900, round(v_proposal.total * 0.01)));
  v_fee_snapshot := jsonb_build_object(
    'archetype', 'proposal', 'rate_bp', 100, 'minimum', 9900, 'maximum', 49900, 'amount', v_platform_fee
  );
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'cancellation_policies') then
    execute $sql$
      select rules from public.cancellation_policies
       where key = 'event_moderate' limit 1
    $sql$ into v_cancel_snapshot;
  end if;

  insert into public.bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id, description,
    scheduled_at, status, visit_fee, platform_fee, total_amount, service_window,
    service_request_id, proposal_id, archetype, category_config_version,
    pricing_snapshot, payment_template_snapshot, cancellation_snapshot, platform_fee_rule_snapshot,
    payment_hold_expires_at, delivery_status, delivery_snapshot
  ) values (
    v_uid, v_proposal.provider_id, v_request.category_id, v_proposal.provider_service_id, v_address_id,
    'Proposal request ' || left(v_request.id::text, 8), v_request.event_start, 'pending_payment',
    0, v_platform_fee, v_proposal.total + v_platform_fee, v_window,
    v_request.id, v_proposal.id, 'proposal', v_category.config_version,
    v_proposal.pricing_snapshot, v_proposal.payment_snapshot, coalesce(v_cancel_snapshot, '{}'::jsonb),
    v_fee_snapshot, now() + interval '30 minutes',
    case when jsonb_array_length(v_proposal.deliverables) > 0 then 'pending' else 'not_applicable' end,
    v_proposal.deliverables
  ) returning id into v_booking;

  update public.bookings
     set commission_bp_snapshot = public._booking_commission_bp(v_booking, now())
   where id = v_booking;
  select coalesce(sum(round(pi.qty * pi.unit_price)::int), 0)::int
    into v_commissionable
    from public.proposal_items pi
   where pi.proposal_id = v_proposal.id
     and public._commissionable(pi.kind);
  insert into public.quotes (
    booking_id, version, status, is_change_order, subtotal_other,
    subtotal_commissionable, total, note
  ) values (
    v_booking, 1, 'approved_pending_payment', false, v_proposal.total,
    v_commissionable, v_proposal.total, v_proposal.note
  ) returning id into v_quote;

  insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price, bill_photo_url)
  select v_quote, pi.kind, pi.title, pi.qty, pi.unit, pi.unit_price, pi.bill_photo_url
    from public.proposal_items pi
   where pi.proposal_id = v_proposal.id
   order by pi.seq;

  update public.bookings set approved_quote_id = v_quote where id = v_booking;
  insert into public.booking_secrets (booking_id, start_otp) values (v_booking, public._gen_otp());
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (v_booking, v_uid, null, 'pending_payment', 'proposal accepted; 30 minute payment hold');

  insert into public.payment_schedule (
    booking_id, quote_id, seq, obligation_type, label, amount, due_rule, due_at,
    status, purpose, obligation_kind, proposal_schedule_id
  )
  select v_booking, v_quote, ps.seq, 'service', ps.label, ps.amount, ps.due_rule, ps.due_at,
         case when ps.due_rule = 'at_booking' or ps.due_at <= now() then 'due' else 'upcoming' end,
         case
           when ps.due_rule = 'at_booking' then 'advance'::public.payment_purpose
           when ps.due_rule in ('on_completion', 'on_delivery') then 'final'::public.payment_purpose
           else 'milestone'::public.payment_purpose
         end,
         'service', ps.id
    from public.proposal_schedule ps
   where ps.proposal_id = v_proposal.id
   order by ps.seq;

  select coalesce(max(seq), 0) + 1 into v_seq from public.payment_schedule where booking_id = v_booking;
  insert into public.payment_schedule (
    booking_id, quote_id, seq, obligation_type, label, amount, due_rule, due_at,
    status, purpose, obligation_kind
  ) values (
    v_booking, v_quote, v_seq, 'platform_fee', 'QuickServe platform fee', v_platform_fee, 'at_booking', now(),
    'due', 'platform_fee', 'platform_fee'
  );

  update public.proposals set status = 'accepted', updated_at = now() where id = v_proposal.id;
  update public.service_requests set status = 'closed', updated_at = now() where id = v_request.id;
  return v_booking;
end;
$$;

create or replace function public.send_proposal(
  p_request_id uuid,
  p_items jsonb,
  p_schedule jsonb,
  p_valid_until timestamptz,
  p_note text default null,
  p_deliverables jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_request public.service_requests;
  v_recipient public.request_recipients;
  v_item jsonb;
  v_row jsonb;
  v_kind public.quote_item_kind;
  v_seq int;
  v_total int := 0;
  v_schedule_total int := 0;
  v_version int;
  v_proposal uuid;
  v_due timestamptz;
  v_cancel jsonb := '{}'::jsonb;
  v_recipient_count int;
begin
  select * into v_request from public.service_requests where id = p_request_id for update;
  perform public._assert(found and v_request.status = 'open', 'request is not open');
  perform public._assert(v_request.expires_at > now(), 'request expired');
  perform public._assert(
    v_request.event_start >= now() + public._proposal_notice(v_request) - interval '5 minutes',
    'This event is too soon to be booked, so a proposal can''t be accepted. Ask the customer for a later date.');
  select count(*) into v_recipient_count
    from public.request_recipients rr
   where rr.request_id = p_request_id and public._acts_for(rr.provider_id, 'manager');
  perform public._assert(v_recipient_count = 1, 'request must be routed to exactly one business you manage');
  select * into v_recipient from public.request_recipients
   where request_id = p_request_id and public._acts_for(provider_id, 'manager');
  perform public._assert(found, 'provider was not routed this request');
  p_valid_until := least(coalesce(p_valid_until, v_request.expires_at), v_request.expires_at);
  perform public._assert(p_valid_until > now() + interval '15 minutes', 'this request expires too soon for a new proposal');
  perform public._assert(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 30,
                         'proposal needs 1 to 30 items');
  perform public._assert(jsonb_typeof(p_schedule) = 'array' and jsonb_array_length(p_schedule) between 1 and 8,
                         'proposal needs 1 to 8 payment milestones');
  perform public._assert(jsonb_typeof(coalesce(p_deliverables, '[]'::jsonb)) = 'array', 'deliverables must be an array');

  update public.proposals set status = 'withdrawn', updated_at = now()
   where request_id = p_request_id and provider_id = v_recipient.provider_id and status = 'sent';
  select coalesce(max(version), 0) + 1 into v_version from public.proposals
   where request_id = p_request_id and provider_id = v_recipient.provider_id;

  insert into public.proposals (
    request_id, provider_id, provider_service_id, version, total, valid_until, note, deliverables,
    cancellation_snapshot
  ) values (
    p_request_id, v_recipient.provider_id, v_recipient.provider_service_id, v_version, 1, p_valid_until,
    nullif(trim(coalesce(p_note, '')), ''), coalesce(p_deliverables, '[]'::jsonb), v_cancel
  ) returning id into v_proposal;

  for v_item, v_seq in
    select value, ordinality::int from jsonb_array_elements(p_items) with ordinality
  loop
    v_kind := (v_item ->> 'kind')::public.quote_item_kind;
    perform public._assert(v_kind <> 'discount', 'discount proposal items are not allowed');
    perform public._assert(coalesce(trim(v_item ->> 'title'), '') <> '', 'proposal item title is required');
    perform public._assert((v_item ->> 'qty')::numeric > 0 and (v_item ->> 'qty')::numeric <= 1000,
                           'proposal item quantity is invalid');
    perform public._assert((v_item ->> 'unit_price')::int >= 0 and (v_item ->> 'unit_price')::int <= 100000000,
                           'proposal item price is invalid');
    v_total := v_total + round((v_item ->> 'qty')::numeric * (v_item ->> 'unit_price')::int);
    insert into public.proposal_items (
      proposal_id, seq, kind, title, qty, unit, unit_price, bill_photo_url, metadata
    ) values (
      v_proposal, v_seq, v_kind, trim(v_item ->> 'title'), (v_item ->> 'qty')::numeric,
      nullif(trim(coalesce(v_item ->> 'unit', '')), ''), (v_item ->> 'unit_price')::int,
      nullif(v_item ->> 'bill_photo_url', ''), coalesce(v_item -> 'metadata', '{}'::jsonb)
    );
  end loop;
  perform public._assert(v_total > 0, 'proposal total must be positive');

  for v_row, v_seq in
    select value, ordinality::int from jsonb_array_elements(p_schedule) with ordinality
  loop
    perform public._assert(coalesce(trim(v_row ->> 'label'), '') <> '', 'milestone label is required');
    perform public._assert((v_row ->> 'amount')::int > 0, 'milestone amount must be positive');
    perform public._assert(v_row ->> 'due_rule' in (
      'at_booking', 'days_before_start:7', 'days_before_start:1', 'on_completion', 'on_delivery'
    ), 'milestone due rule is invalid');
    v_due := case v_row ->> 'due_rule'
      when 'at_booking' then now()
      when 'days_before_start:7' then v_request.event_start - interval '7 days'
      when 'days_before_start:1' then v_request.event_start - interval '1 day'
      else null
    end;
    v_schedule_total := v_schedule_total + (v_row ->> 'amount')::int;
    insert into public.proposal_schedule (proposal_id, seq, label, amount, due_rule, due_at)
    values (v_proposal, v_seq, trim(v_row ->> 'label'), (v_row ->> 'amount')::int, v_row ->> 'due_rule', v_due);
  end loop;
  perform public._assert(v_schedule_total = v_total, 'milestones must sum exactly to the proposal total');

  update public.proposals
     set total = v_total,
         pricing_snapshot = jsonb_build_object(
           'version', v_version, 'total', v_total,
           'items', (select jsonb_agg(row_to_json(x)) from (
             select seq, kind, title, qty, unit, unit_price, metadata
               from public.proposal_items where proposal_id = v_proposal order by seq
           ) x),
           'deliverables', coalesce(p_deliverables, '[]'::jsonb)
         ),
         payment_snapshot = jsonb_build_object(
           'schedule', (select jsonb_agg(row_to_json(x)) from (
             select seq, label, amount, due_rule, due_at
               from public.proposal_schedule where proposal_id = v_proposal order by seq
           ) x)
         ),
         updated_at = now()
   where id = v_proposal;

  perform public._queue_notification(
    v_request.customer_id, 'proposal_received', null, 'New proposal received',
    'A verified provider sent a proposal for your request.',
    jsonb_build_object('request_id', v_request.id, 'proposal_id', v_proposal),
    'proposal-received:' || v_request.id::text
  );
  return v_proposal;
end;
$$;

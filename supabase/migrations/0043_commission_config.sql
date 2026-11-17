-- 0043: configurable commission policy. Defaults preserve global and time-based rates.
-- Category overrides remain inactive unless an administrator explicitly sets them.

insert into public.app_config (key, value)
values ('commission', '{
  "founding_days": 30,
  "tiers": [{"min_jobs": 200, "bp": 800}, {"min_jobs": 50, "bp": 1000}, {"min_jobs": 0, "bp": 1200}],
  "repeat_discount_bp": 400,
  "repeat_floor_bp": 500,
  "time_based": {"one_off_bp": 1000, "recurring_bp": 800}
}'::jsonb)
on conflict (key) do nothing;

create or replace function public._commission_bp(p_provider_id uuid, p_at timestamptz)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.providers;
  v_config jsonb;
  v_rate int;
begin
  select * into p from public.providers where id = p_provider_id;
  if not found then return null; end if;
  select value into v_config from public.app_config where key = 'commission';
  v_config := coalesce(v_config, '{
    "founding_days": 30,
    "tiers": [{"min_jobs": 200, "bp": 800}, {"min_jobs": 50, "bp": 1000}, {"min_jobs": 0, "bp": 1200}],
    "repeat_discount_bp": 400,
    "repeat_floor_bp": 500,
    "time_based": {"one_off_bp": 1000, "recurring_bp": 800}
  }'::jsonb);
  if p_at < p.created_at + make_interval(days => (v_config ->> 'founding_days')::int) then
    return 0;
  end if;
  select (tier ->> 'bp')::int into v_rate
    from jsonb_array_elements(v_config -> 'tiers') as item(tier)
   where p.jobs_completed >= (tier ->> 'min_jobs')::int
   order by (tier ->> 'min_jobs')::int desc
   limit 1;
  return coalesce(v_rate, 1200);
end;
$$;

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
  v_bp int := public._commission_bp(p_provider_id, p_at);
  v_override int;
  v_repeat boolean;
  v_config jsonb;
begin
  if v_bp is null or v_bp = 0 then return coalesce(v_bp, 0); end if;

  select c.commission_bp into v_override
    from public.bookings b
    join public.categories c on c.id = b.category_id
   where b.id = p_booking_id
     and b.provider_id = p_provider_id
     and b.customer_id = p_customer_id;
  if v_override is not null then v_bp := v_override; end if;

  select coalesce((select value from public.app_config where key = 'commission'), '{
    "repeat_discount_bp": 400,
    "repeat_floor_bp": 500
  }'::jsonb) into v_config;

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
    return greatest(v_bp - (v_config ->> 'repeat_discount_bp')::int, (v_config ->> 'repeat_floor_bp')::int);
  end if;
  return v_bp;
end;
$$;

create or replace function public._time_based_commission_bp(p_booking_id uuid, p_at timestamptz)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_provider_created_at timestamptz;
  v_override int;
  v_config jsonb;
begin
  select * into b
    from public.bookings
   where id = p_booking_id
     and archetype = 'time_based';
  if not found then return null; end if;
  select p.created_at, c.commission_bp
    into v_provider_created_at, v_override
    from public.providers p
    left join public.categories c on c.id = b.category_id
   where p.id = b.provider_id;
  if not found then return null; end if;

  select value into v_config from public.app_config where key = 'commission';
  v_config := coalesce(v_config, '{
    "founding_days": 30,
    "time_based": {"one_off_bp": 1000, "recurring_bp": 800}
  }'::jsonb);
  v_config := v_config || jsonb_build_object(
    'time_based',
    case when jsonb_typeof(v_config -> 'time_based') = 'object'
      then v_config -> 'time_based'
      else '{"one_off_bp":1000,"recurring_bp":800}'::jsonb
    end
  );
  if p_at < v_provider_created_at + make_interval(days => (v_config ->> 'founding_days')::int) then
    return 0;
  end if;
  if v_override is not null then return v_override; end if;
  if b.recurring_schedule_id is not null then
    return (v_config -> 'time_based' ->> 'recurring_bp')::int;
  end if;
  return (v_config -> 'time_based' ->> 'one_off_bp')::int;
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

  v_bp := public._time_based_commission_bp(b.id, now());
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
  v_commission := round(q.subtotal_labour::numeric * case
    when b.booking_origin = 'byo' then 0
    when b.archetype = 'time_based' then public._time_based_commission_bp(b.id, now())
    else public._commission_bp(b.provider_id, b.customer_id, b.id, now())
  end / 10000);
  v_gst := round(v_commission::numeric * 18 / 100);
  return greatest(v_commission + b.platform_fee - v_gst, 0);
end;
$$;

create or replace function public.get_commission_terms()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_config jsonb;
  p public.providers;
  v_bp int;
  v_free_until timestamptz;
begin
  select value into v_config from public.app_config where key = 'commission';
  v_config := coalesce(v_config, '{
    "founding_days": 30,
    "tiers": [{"min_jobs": 200, "bp": 800}, {"min_jobs": 50, "bp": 1000}, {"min_jobs": 0, "bp": 1200}],
    "repeat_discount_bp": 400,
    "repeat_floor_bp": 500,
    "time_based": {"one_off_bp": 1000, "recurring_bp": 800}
  }'::jsonb);
  v_config := v_config || jsonb_build_object(
    'time_based',
    case when jsonb_typeof(v_config -> 'time_based') = 'object'
      then v_config -> 'time_based'
      else '{"one_off_bp":1000,"recurring_bp":800}'::jsonb
    end
  );
  select * into p from public.providers where id = v_uid;
  if found then
    v_bp := public._commission_bp(v_uid, now());
    if v_bp = 0 then
      v_free_until := p.created_at + make_interval(days => (v_config ->> 'founding_days')::int);
    end if;
  end if;
  return v_config || jsonb_build_object('my_bp', v_bp, 'my_free_until', v_free_until);
end;
$$;

create or replace function public.get_booking_commission_rate(p_booking_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id;
  perform public._assert(found and b.provider_id = v_uid, 'booking not found');
  if b.booking_origin = 'byo' then return 0; end if;
  if b.archetype = 'time_based' then return public._time_based_commission_bp(b.id, now()); end if;
  return public._commission_bp(b.provider_id, b.customer_id, b.id, now());
end;
$$;

create or replace function public.admin_get_commission_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_config jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  select value into v_config from public.app_config where key = 'commission';
  v_config := coalesce(v_config, '{
    "founding_days": 30,
    "tiers": [{"min_jobs": 200, "bp": 800}, {"min_jobs": 50, "bp": 1000}, {"min_jobs": 0, "bp": 1200}],
    "repeat_discount_bp": 400,
    "repeat_floor_bp": 500,
    "time_based": {"one_off_bp": 1000, "recurring_bp": 800}
  }'::jsonb);
  return v_config || jsonb_build_object(
    'time_based',
    case when jsonb_typeof(v_config -> 'time_based') = 'object'
      then v_config -> 'time_based'
      else '{"one_off_bp":1000,"recurring_bp":800}'::jsonb
    end
  );
end;
$$;

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
  select value -> 'time_based' into v_time_based
    from public.app_config where key = 'commission';
  v_time_based := coalesce(p_config -> 'time_based', v_time_based, '{"one_off_bp":1000,"recurring_bp":800}'::jsonb);
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
  v_config := jsonb_build_object(
    'founding_days', v_days,
    'tiers', v_tiers,
    'repeat_discount_bp', v_discount,
    'repeat_floor_bp', v_floor,
    'time_based', jsonb_build_object('one_off_bp', v_one_off, 'recurring_bp', v_recurring)
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

create or replace function public.admin_list_commission_categories()
returns table (id uuid, name text, archetype text, active boolean, commission_bp int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return query
    select c.id, c.name, c.archetype, c.active, c.commission_bp
      from public.categories c
     order by c.archetype, c.sort_order, c.name;
end;
$$;

create or replace function public.admin_set_category_commission(p_category_id uuid, p_bp int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(p_bp is null or p_bp between 0 and 3000, 'category commission must be null or between 0 and 3000 basis points');
  update public.categories set commission_bp = p_bp where id = p_category_id;
  perform public._assert(found, 'category not found');
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_category_commission', p_category_id, jsonb_build_object('commission_bp', p_bp));
end;
$$;

revoke execute on function public._commission_bp(uuid, timestamptz),
  public._commission_bp(uuid, uuid, uuid, timestamptz),
  public._time_based_commission_bp(uuid, timestamptz),
  public._coin_platform_cap(uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.get_commission_terms(), public.get_booking_commission_rate(uuid) from public, anon;
grant execute on function public.get_commission_terms(), public.get_booking_commission_rate(uuid) to authenticated;
revoke execute on function public.admin_get_commission_config(), public.admin_set_commission(jsonb),
  public.admin_list_commission_categories(), public.admin_set_category_commission(uuid, int)
from public, anon;
grant execute on function public.admin_get_commission_config(), public.admin_set_commission(jsonb),
  public.admin_list_commission_categories(), public.admin_set_category_commission(uuid, int)
to authenticated;

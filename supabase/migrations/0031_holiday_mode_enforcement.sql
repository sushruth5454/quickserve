-- Holiday mode (providers.paused) must block every customer-initiated booking path.
-- Search, create_booking, create_travel_request, fixed packages (_is_bookable) and proposal routing already check it;
-- session bookings, recurring schedules and session-pack purchases only checked _provider_is_live, which ignores paused.
-- Recurring materialisation calls _create_session_booking directly and is deliberately unchanged here.

create or replace function public._assert_provider_not_paused(p_provider_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(
    not coalesce((select p.paused from public.providers p where p.id = p_provider_id), false),
    'provider_unavailable: the provider is on holiday'
  );
end;
$$;

revoke execute on function public._assert_provider_not_paused(uuid) from public, anon, authenticated;

create or replace function public.create_session_booking(
  p_provider_service_id uuid,
  p_service_package_id uuid,
  p_scheduled_at timestamptz,
  p_duration_min int,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision,
  p_description text default '',
  p_pack_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert_provider_not_paused(
    (select ps.provider_id from public.provider_services ps where ps.id = p_provider_service_id)
  );
  return public._create_session_booking(
    v_uid, p_provider_service_id, p_service_package_id, p_scheduled_at, p_duration_min,
    p_address_line, p_city, p_lat, p_lng, p_description, p_pack_id, null
  );
end;
$$;

create or replace function public.purchase_session_pack(p_service_package_id uuid, p_sessions int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  sp public.service_packages;
  ps public.provider_services;
  v_pack uuid;
  v_count int := p_sessions;
  v_base int;
  v_remainder int;
begin
  select * into sp from public.service_packages where id = p_service_package_id and active for update;
  perform public._assert(found, 'session package is unavailable');
  select * into ps from public.provider_services where id = sp.provider_service_id and active for update;
  perform public._assert(found, 'provider service is unavailable');
  perform public._assert(public._provider_is_live(ps.provider_id), 'provider is not available');
  perform public._assert_provider_not_paused(ps.provider_id);
  perform public._assert(public._category_docs_ok(ps.provider_id, ps.category_id), 'provider verification is incomplete');
  perform public._assert(ps.provider_id <> v_uid, 'cannot buy your own pack');
  perform public._assert(sp.unit = 'session' and sp.price_type = 'fixed' and sp.price > 0, 'pack must be a fixed session package');
  perform public._assert(sp.qty_min = trunc(sp.qty_min) and sp.qty_max = trunc(sp.qty_max), 'pack size must be a whole number');
  perform public._assert(v_count between sp.qty_min::int and sp.qty_max::int and v_count > 1, 'invalid pack session count');

  insert into public.pack_purchases (
    customer_id, provider_id, provider_service_id, service_package_id,
    sessions_total, price, platform_fee, expires_at
  )
  values (
    v_uid, ps.provider_id, ps.id, sp.id,
    v_count, sp.price * v_count, 4900, now() + interval '90 days'
  )
  returning id into v_pack;

  v_base := (sp.price * v_count) / v_count;
  v_remainder := (sp.price * v_count) % v_count;
  insert into public.pack_sessions (pack_id, seq, allocated_amount)
  select v_pack, s, v_base + case when s <= v_remainder then 1 else 0 end
    from generate_series(1, v_count) s;

  return v_pack;
end;
$$;

create or replace function public.create_recurring_schedule(
  p_provider_service_id uuid,
  p_service_package_id uuid,
  p_pack_id uuid,
  p_payment_mode text,
  p_weekdays smallint[],
  p_start_time time,
  p_timezone text,
  p_duration_min int,
  p_starts_on date,
  p_ends_on date,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision,
  p_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  ps public.provider_services;
  k public.pack_purchases;
  v_id uuid;
begin
  select * into ps from public.provider_services where id = p_provider_service_id and active;
  perform public._assert(found, 'service not available');
  perform public._assert(public._provider_is_live(ps.provider_id), 'provider is not available');
  perform public._assert_provider_not_paused(ps.provider_id);
  perform public._assert(ps.provider_id <> v_uid, 'cannot schedule your own service');
  perform public._assert(p_payment_mode in ('per_session', 'pack_prepaid', 'monthly_prepaid'), 'invalid recurring payment mode');
  perform public._assert(
    coalesce(cardinality(p_weekdays), 0) between 1 and 7
      and p_weekdays <@ array[1,2,3,4,5,6,7]::smallint[],
    'weekdays must be ISO days 1 through 7'
  );
  perform public._assert(p_duration_min between 15 and 480, 'invalid session duration');
  perform public._assert(p_starts_on >= current_date, 'recurring start date is in the past');
  perform public._assert(p_ends_on is null or p_ends_on <= p_starts_on + interval '366 days', 'recurring schedule may span at most one year');
  if p_service_package_id is not null then
    perform public._assert_session_package(ps.id, p_service_package_id);
  end if;
  if p_payment_mode in ('pack_prepaid', 'monthly_prepaid') then
    select * into k from public.pack_purchases where id = p_pack_id and status = 'active' for update;
    perform public._assert(
      found and k.customer_id = v_uid and k.provider_service_id = ps.id and k.expires_at > now(),
      'an active matching pack is required for prepaid recurrence'
    );
  end if;

  insert into public.recurring_schedules (
    customer_id, provider_id, provider_service_id, service_package_id, pack_purchase_id,
    weekdays, start_time, timezone, session_duration_min, payment_mode,
    address_line, city, lat, lng, description, starts_on, ends_on
  )
  values (
    v_uid, ps.provider_id, ps.id, p_service_package_id, p_pack_id,
    array(select distinct x from unnest(p_weekdays) x order by x),
    p_start_time, coalesce(nullif(trim(p_timezone), ''), 'Asia/Kolkata'), p_duration_min,
    p_payment_mode, trim(p_address_line), trim(p_city), p_lat, p_lng,
    coalesce(p_description, ''), p_starts_on, p_ends_on
  )
  returning id into v_id;
  return v_id;
end;
$$;

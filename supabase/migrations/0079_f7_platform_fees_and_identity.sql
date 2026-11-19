-- WP F7; owns: create_booking, _create_session_booking, purchase_session_pack, accept_proposal, send_quote;
-- admin_get_platform_fees, admin_set_platform_fees, _platform_fee_config;
-- sources: WS6-T13, WS6-T18, WS9-T12, WS9-T11, WS7-T10.

insert into public.app_config (key, value)
values (
  'platform_fees',
  '{"inspect_quote":2900,"time_based_session":2900,"pack":4900,"proposal":{"bp":100,"min":9900,"max":49900}}'::jsonb
)
on conflict (key) do nothing;

-- D4 tax decisions remain deferred. These fields are inert placeholders; this WP does not issue tax documents
-- or change the existing payout tax calculations.
insert into public.app_config (key, value)
values ('tax', '{"gst_on_commission_bp":0,"tds_bp":0,"tcs_bp":0}'::jsonb)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values (
  'business_payout_identity',
  false,
  'Business payout identity',
  'When off, providers can submit individual payout details; business PAN and GSTIN fields are unavailable.',
  'Provider onboarding',
  60
)
on conflict (key) do nothing;

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values (
  'platform_fee_settings',
  true,
  'Platform fee settings',
  'When off, admins cannot edit fee settings; current fees continue to apply to new bookings.',
  'Billing',
  30
)
on conflict (key) do nothing;

alter table public.pack_purchases
  drop constraint if exists pack_purchases_platform_fee_check,
  add constraint pack_purchases_platform_fee_check
    check (platform_fee between 0 and 100000000);

alter table public.provider_payout_accounts
  add column if not exists account_type text not null default 'individual',
  add column if not exists gstin text,
  add column if not exists registered_address jsonb;

alter table public.provider_payout_accounts
  drop constraint if exists provider_payout_accounts_account_type_check,
  add constraint provider_payout_accounts_account_type_check
    check (account_type in ('individual', 'business')),
  drop constraint if exists provider_payout_accounts_gstin_format_check,
  add constraint provider_payout_accounts_gstin_format_check
    check (
      gstin is null
      or (
        gstin ~ '^(0[1-9]|[12][0-9]|3[0-8]|97)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
        and account_type = 'business'
      )
    ),
  drop constraint if exists provider_payout_accounts_registered_address_check,
  add constraint provider_payout_accounts_registered_address_check
    check (registered_address is null or jsonb_typeof(registered_address) = 'object');

create or replace function public._platform_fee_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_config jsonb;
begin
  select value into v_config from public.app_config where key = 'platform_fees';
  v_config := coalesce(v_config,
    '{"inspect_quote":2900,"time_based_session":2900,"pack":4900,"proposal":{"bp":100,"min":9900,"max":49900}}'::jsonb);

  perform public._assert(
    coalesce(jsonb_typeof(v_config) = 'object', false)
      and coalesce((v_config ->> 'inspect_quote') ~ '^(0|[1-9][0-9]*)$', false)
      and coalesce((v_config ->> 'time_based_session') ~ '^(0|[1-9][0-9]*)$', false)
      and coalesce((v_config ->> 'pack') ~ '^(0|[1-9][0-9]*)$', false)
      and coalesce(jsonb_typeof(v_config -> 'proposal') = 'object', false)
      and coalesce((v_config #>> '{proposal,bp}') ~ '^(0|[1-9][0-9]*)$', false)
      and coalesce((v_config #>> '{proposal,min}') ~ '^(0|[1-9][0-9]*)$', false)
      and coalesce((v_config #>> '{proposal,max}') ~ '^(0|[1-9][0-9]*)$', false),
    'platform fee configuration is invalid'
  );
  perform public._assert(
    (v_config ->> 'inspect_quote')::bigint between 0 and 100000000
      and (v_config ->> 'time_based_session')::bigint between 0 and 100000000
      and (v_config ->> 'pack')::bigint between 0 and 100000000
      and (v_config #>> '{proposal,bp}')::int between 0 and 10000
      and (v_config #>> '{proposal,min}')::bigint between 0 and 100000000
      and (v_config #>> '{proposal,max}')::bigint between 0 and 100000000
      and (v_config #>> '{proposal,min}')::bigint <= (v_config #>> '{proposal,max}')::bigint,
    'platform fee configuration is out of range'
  );
  return v_config;
end;
$$;

revoke all on function public._platform_fee_config() from public, anon, authenticated;

create or replace function public.admin_get_platform_fees()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(public._feature_enabled('platform_fee_settings'), 'platform fee settings are turned off');
  return public._platform_fee_config();
end;
$$;

create or replace function public.admin_set_platform_fees(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_inspect text;
  v_session text;
  v_pack text;
  v_bp text;
  v_min text;
  v_max text;
  v_config jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(public._feature_enabled('platform_fee_settings'), 'platform fee settings are turned off');
  perform public._assert(coalesce(jsonb_typeof(p_config) = 'object', false), 'platform fees must be an object');
  perform public._assert(
    p_config ?& array['inspect_quote', 'time_based_session', 'pack', 'proposal']
      and (p_config - array['inspect_quote', 'time_based_session', 'pack', 'proposal']) = '{}'::jsonb
      and jsonb_typeof(p_config -> 'proposal') = 'object'
      and (p_config -> 'proposal') ?& array['bp', 'min', 'max']
      and ((p_config -> 'proposal') - array['bp', 'min', 'max']) = '{}'::jsonb,
    'platform fee fields are invalid'
  );

  v_inspect := p_config ->> 'inspect_quote';
  v_session := p_config ->> 'time_based_session';
  v_pack := p_config ->> 'pack';
  v_bp := p_config #>> '{proposal,bp}';
  v_min := p_config #>> '{proposal,min}';
  v_max := p_config #>> '{proposal,max}';
  perform public._assert(
    coalesce(v_inspect ~ '^(0|[1-9][0-9]*)$', false)
      and coalesce(v_session ~ '^(0|[1-9][0-9]*)$', false)
      and coalesce(v_pack ~ '^(0|[1-9][0-9]*)$', false)
      and coalesce(v_bp ~ '^(0|[1-9][0-9]*)$', false)
      and coalesce(v_min ~ '^(0|[1-9][0-9]*)$', false)
      and coalesce(v_max ~ '^(0|[1-9][0-9]*)$', false),
    'platform fee values must be non-negative whole numbers'
  );
  perform public._assert(
    v_inspect::bigint between 0 and 100000000
      and v_session::bigint between 0 and 100000000
      and v_pack::bigint between 0 and 100000000
      and v_bp::int between 0 and 10000
      and v_min::bigint between 0 and 100000000
      and v_max::bigint between 0 and 100000000
      and v_min::bigint <= v_max::bigint,
    'platform fee values are out of range'
  );

  v_config := jsonb_build_object(
    'inspect_quote', v_inspect::int,
    'time_based_session', v_session::int,
    'pack', v_pack::int,
    'proposal', jsonb_build_object('bp', v_bp::int, 'min', v_min::int, 'max', v_max::int)
  );
  insert into public.app_config (key, value, updated_at, updated_by)
  values ('platform_fees', v_config, now(), v_uid)
  on conflict (key) do update
    set value = excluded.value, updated_at = now(), updated_by = v_uid;
  insert into public.admin_audit_log (admin_id, action, details)
  values (v_uid, 'set_platform_fees', jsonb_build_object('config', v_config));
  return v_config;
end;
$$;

revoke all on function public.admin_get_platform_fees(), public.admin_set_platform_fees(jsonb) from public, anon;
grant execute on function public.admin_get_platform_fees(), public.admin_set_platform_fees(jsonb) to authenticated;

create or replace function public.create_booking(
  p_provider_service_id uuid,
  p_description text,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision,
  p_scheduled_at timestamptz default null,
  p_photos text[] default '{}',
  p_travel_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_ps record;
  c public.categories;
  v_address uuid;
  v_booking uuid;
  v_problem text;
  v_window tstzrange;
  v_fee_config jsonb := public._platform_fee_config();
  v_platform_fee int;
begin
  select ps.id, ps.provider_id, ps.category_id, ps.visit_fee
    into v_ps
    from public.provider_services ps
    join public.providers pr on pr.id = ps.provider_id
   where ps.id = p_provider_service_id
     and ps.active
     and public._provider_is_live(pr.id)
     and not pr.paused
     and public._category_docs_ok(pr.id, ps.category_id);
  perform public._assert(found, 'service not available');
  select * into c from public.categories where id = v_ps.category_id;
  perform public._assert(c.archetype = 'inspect_quote', 'upgrade_required');
  perform public._assert(v_ps.provider_id <> v_uid, 'cannot book yourself');
  perform public._assert(
    coalesce(trim(p_address_line), '') <> '' and coalesce(trim(p_city), '') <> '',
    'address is required'
  );
  perform public._assert(p_lat is not null and p_lng is not null, 'location is required');
  perform public._assert(
    p_scheduled_at is null or p_scheduled_at > now() - interval '5 minutes',
    'scheduled time is in the past'
  );
  perform public._assert(coalesce(array_length(p_photos, 1), 0) <= 4, 'at most 4 photos');
  perform public._assert(
    not exists (
      select 1 from unnest(coalesce(p_photos, '{}')) ph
       where ph not like v_uid::text || '/%'
    ),
    'invalid photo path'
  );

  perform pg_advisory_xact_lock(hashtext(v_ps.provider_id::text));
  v_problem := public._provider_slot_problem(
    v_ps.provider_id, coalesce(p_scheduled_at, now()), p_scheduled_at is null
  );
  perform public._assert(
    v_problem is null,
    case v_problem
      when 'provider_on_leave' then 'provider_unavailable: the provider is on leave at that time'
      when 'outside_working_hours' then 'provider_unavailable: that time is outside the provider''s working hours'
      when 'fully_booked' then 'provider_unavailable: the provider is fully booked that day'
      else 'provider_unavailable'
    end
  );
  v_window := case
    when p_scheduled_at is null then null
    else tstzrange(p_scheduled_at, p_scheduled_at + interval '2 hours', '[)')
  end;
  perform public._assert_bookable(
    v_ps.category_id, v_ps.provider_id, trim(p_city), 'inspect_quote', v_window
  );

  v_platform_fee := (v_fee_config ->> 'inspect_quote')::int;
  insert into public.addresses (user_id, label, line1, city, lat, lng)
  values (v_uid, 'Booking', trim(p_address_line), trim(p_city), p_lat, p_lng)
  returning id into v_address;

  insert into public.bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id,
    description, photos, scheduled_at, visit_fee, platform_fee, travel_request_id, service_window,
    archetype, category_config_version, location_mode, pricing_snapshot,
    payment_template_snapshot, cancellation_snapshot, platform_fee_rule_snapshot
  ) values (
    v_uid, v_ps.provider_id, v_ps.category_id, v_ps.id, v_address,
    coalesce(p_description, ''), coalesce(p_photos, '{}'), p_scheduled_at,
    v_ps.visit_fee, v_platform_fee, p_travel_request_id, v_window,
    c.archetype, c.config_version, c.location_modes[1],
    jsonb_build_object(
      'key', 'category:' || c.id::text || ':v' || c.config_version::text,
      'pricing_mode', c.pricing_mode,
      'pricing_units', to_jsonb(c.pricing_units),
      'visit_fee_paise', v_ps.visit_fee,
      'platform_fee_paise', v_platform_fee
    ),
    jsonb_build_object('key', c.payment_template, 'version', c.config_version),
    jsonb_build_object(
      'key', c.cancellation_policy,
      'version', c.config_version,
      'legacy', c.cancellation_policy = 'standard_visit'
    ),
    jsonb_build_object('key', 'legacy_flat', 'amount_paise', v_platform_fee)
  ) returning id into v_booking;

  insert into public.booking_secrets (booking_id, start_otp)
  values (v_booking, public._gen_otp());
  insert into public.booking_events (booking_id, actor_id, from_status, to_status)
  values (v_booking, v_uid, null, 'pending_payment');
  return v_booking;
end;
$$;

create or replace function public._create_session_booking(
  p_customer_id uuid,
  p_provider_service_id uuid,
  p_service_package_id uuid,
  p_scheduled_at timestamptz,
  p_duration_min int,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision,
  p_description text,
  p_pack_id uuid default null,
  p_recurring_schedule_id uuid default null,
  p_service_amount_override int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ps public.provider_services;
  sp public.service_packages;
  k public.pack_purchases;
  s public.pack_sessions;
  v_address uuid;
  v_booking uuid;
  v_problem text;
  v_service_amount int;
  v_platform_fee int;
  v_platform_fee_override int;
  v_duration int;
  v_fee_config jsonb := public._platform_fee_config();
  v_initial_status public.booking_status := 'pending_payment';
begin
  select * into ps from public.provider_services where id = p_provider_service_id and active for update;
  perform public._assert(found, 'service not available');
  perform public._assert(public._provider_is_live(ps.provider_id), 'provider is not available');
  perform public._assert(public._category_docs_ok(ps.provider_id, ps.category_id), 'provider verification is incomplete');
  perform public._assert(ps.provider_id <> p_customer_id, 'cannot book yourself');
  perform public._assert(p_scheduled_at > now() + interval '30 minutes', 'session must be scheduled at least 30 minutes ahead');
  perform public._assert(coalesce(trim(p_address_line), '') <> '' and coalesce(trim(p_city), '') <> '', 'address is required');
  perform public._assert(p_lat between -90 and 90 and p_lng between -180 and 180, 'location is invalid');

  perform pg_advisory_xact_lock(hashtext(ps.provider_id::text));
  v_problem := public._provider_slot_problem(ps.provider_id, p_scheduled_at, false);
  perform public._assert(v_problem is null, coalesce('provider_unavailable: ' || v_problem, 'provider_unavailable'));

  if p_service_package_id is not null then
    sp := public._assert_session_package(ps.id, p_service_package_id);
    v_service_amount := sp.price;
    v_duration := coalesce(sp.duration_min, p_duration_min);
  else
    perform public._assert(p_duration_min between 15 and 480, 'session duration must be between 15 and 480 minutes');
    v_duration := p_duration_min;
    v_service_amount := greatest(round(ps.labour_rate::numeric * v_duration / 60.0), 1);
  end if;
  if p_service_amount_override is not null then
    perform public._assert(p_service_amount_override > 0, 'invalid recurring per-visit amount');
    v_service_amount := p_service_amount_override;
  end if;
  v_platform_fee := (v_fee_config ->> 'time_based_session')::int;

  if p_pack_id is not null then
    select * into k from public.pack_purchases where id = p_pack_id for update;
    perform public._assert(
      found and k.customer_id = p_customer_id and k.provider_service_id = ps.id and k.status = 'active',
      'pack is not available for this session'
    );
    perform public._assert(k.expires_at > now(), 'pack has expired');
    select * into s
      from public.pack_sessions
     where pack_id = k.id and status = 'available'
     order by seq
     limit 1
     for update;
    perform public._assert(found, 'pack has no unused sessions');
    v_service_amount := s.allocated_amount;
    v_platform_fee := 0;
    v_initial_status := 'requested';
  elsif p_recurring_schedule_id is not null then
    select r.platform_fee_paise into v_platform_fee_override
      from public.recurring_schedules r
     where r.id = p_recurring_schedule_id
       and r.customer_id = p_customer_id
       and r.payment_mode = 'per_session';
    perform public._assert(found, 'recurring schedule does not allow per-session payment');
    if v_platform_fee_override is not null then
      v_platform_fee := v_platform_fee_override;
    end if;
  end if;

  insert into public.addresses (user_id, label, line1, city, lat, lng)
  values (p_customer_id, 'Booking', trim(p_address_line), trim(p_city), p_lat, p_lng)
  returning id into v_address;

  insert into public.bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id,
    description, scheduled_at, status, visit_fee, platform_fee, total_amount,
    archetype, service_window, exclusive, session_duration_min, service_package_id,
    pack_purchase_id, pack_session_id, recurring_schedule_id
  )
  values (
    p_customer_id, ps.provider_id, ps.category_id, ps.id, v_address,
    coalesce(p_description, ''), p_scheduled_at, v_initial_status, 0, v_platform_fee,
    v_service_amount + v_platform_fee, 'time_based',
    tstzrange(p_scheduled_at, p_scheduled_at + (v_duration || ' minutes')::interval, '[)'),
    true, v_duration, p_service_package_id, p_pack_id, s.id, p_recurring_schedule_id
  )
  returning id into v_booking;

  insert into public.booking_secrets (booking_id, start_otp) values (v_booking, public._gen_otp());
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (v_booking, p_customer_id, null, v_initial_status,
    case when p_pack_id is null then 'session payment due' else 'pack session allocated' end);

  if p_pack_id is not null then
    update public.pack_sessions
       set booking_id = v_booking, status = 'allocated', allocated_at = now()
     where id = s.id;
  else
    insert into public.payment_schedule (
      booking_id, seq, obligation_type, label, amount, due_rule, due_at, status, purpose, obligation_kind
    )
    values
      (v_booking, 1, 'service', 'Session service', v_service_amount, 'at_booking', now(), 'due', 'session', 'service'),
      (v_booking, 2, 'platform_fee', 'Platform fee', v_platform_fee, 'at_booking', now(), 'due', 'platform_fee', 'platform_fee');
  end if;
  return v_booking;
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
  v_fee_config jsonb := public._platform_fee_config();
  v_platform_fee int;
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

  v_platform_fee := (v_fee_config ->> 'pack')::int;
  insert into public.pack_purchases (
    customer_id, provider_id, provider_service_id, service_package_id,
    sessions_total, price, platform_fee, expires_at
  )
  values (
    v_uid, ps.provider_id, ps.id, sp.id,
    v_count, sp.price * v_count, v_platform_fee, now() + interval '90 days'
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
  v_fee_config jsonb := public._platform_fee_config();
  v_proposal_bp int;
  v_proposal_min int;
  v_proposal_max int;
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

  v_proposal_bp := (v_fee_config #>> '{proposal,bp}')::int;
  v_proposal_min := (v_fee_config #>> '{proposal,min}')::int;
  v_proposal_max := (v_fee_config #>> '{proposal,max}')::int;
  v_platform_fee := least(
    v_proposal_max,
    greatest(v_proposal_min, round(v_proposal.total::numeric * v_proposal_bp / 10000)::int)
  );
  v_fee_snapshot := jsonb_build_object(
    'archetype', 'proposal', 'rate_bp', v_proposal_bp,
    'minimum', v_proposal_min, 'maximum', v_proposal_max, 'amount', v_platform_fee
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
    if v_kind = 'part' and v_line > 50000 then
      perform public._assert(
        nullif(trim(v_item ->> 'bill_photo_url'), '') is not null,
        'parts above ₹500 need a bill photo'
      );
    end if;
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

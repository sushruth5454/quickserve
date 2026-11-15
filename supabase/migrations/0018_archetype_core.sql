-- Phase 0 booking foundations (docs/07 T0.1-T0.4).
-- All future archetypes remain data/config driven; this migration preserves the inspect_quote flow.

-- ---------------------------------------------------------------------------
-- Category configuration and per-city launch state
-- ---------------------------------------------------------------------------
alter table public.categories
  add column if not exists vertical text not null default 'home-repairs',
  add column if not exists parent_id uuid references public.categories (id),
  add column if not exists archetype text not null default 'inspect_quote',
  add column if not exists location_modes text[] not null default '{at_customer}',
  add column if not exists pricing_units text[] not null default '{job}',
  add column if not exists intake_schema jsonb not null default '{"type":"object","properties":{}}'::jsonb,
  add column if not exists payment_template text not null default 'visit_then_balance',
  add column if not exists cancellation_policy text not null default 'standard_visit',
  add column if not exists commission_bp int,
  add column if not exists min_lead_hours int not null default 1,
  add column if not exists max_lead_days int not null default 7,
  add column if not exists restricted boolean not null default false,
  add column if not exists config_version int not null default 1;

alter table public.categories
  drop constraint if exists categories_archetype_check,
  drop constraint if exists categories_location_modes_check,
  drop constraint if exists categories_pricing_units_check,
  drop constraint if exists categories_commission_bp_check,
  drop constraint if exists categories_lead_check,
  drop constraint if exists categories_config_version_check;
alter table public.categories
  add constraint categories_archetype_check
    check (archetype in ('fixed', 'inspect_quote', 'proposal', 'time_based', 'remote')),
  add constraint categories_location_modes_check
    check (
      cardinality(location_modes) between 1 and 4
      and location_modes <@ array['at_customer', 'at_provider', 'at_venue', 'remote']::text[]
    ),
  add constraint categories_pricing_units_check
    check (
      cardinality(pricing_units) between 1 and 12
      and pricing_units <@ array[
        'job', 'hour', 'day', 'session', 'person', 'plate',
        'sqft', 'bhk', 'seat', 'litre', 'event', 'month'
      ]::text[]
    ),
  add constraint categories_commission_bp_check check (commission_bp is null or commission_bp between 0 and 10000),
  add constraint categories_lead_check check (
    min_lead_hours between 0 and 8760 and max_lead_days between 0 and 365
  ),
  add constraint categories_config_version_check check (config_version > 0);

update public.categories
set
  vertical = case
    when slug in ('house-cleaning', 'water-tank-cleaning', 'pest-control') then 'cleaning'
    when slug in ('car-mechanic', 'bike-mechanic') then 'auto'
    when slug in ('instagram-influencer', 'youtube-creator', 'ugc-creator', 'reel-maker') then 'creators'
    when slug in (
      'wedding-photographer', 'candid-photographer', 'pre-wedding-shoot', 'maternity-newborn',
      'product-photographer', 'event-videographer', 'drone-operator', 'photo-booth'
    ) then 'photo-video'
    when slug in (
      'caterer', 'decorator', 'bridal-makeup', 'mehendi-artist', 'dj',
      'live-band', 'wedding-planner'
    ) then 'weddings-events'
    else 'home-repairs'
  end,
  archetype = case
    when slug in (
      'instagram-influencer', 'youtube-creator', 'ugc-creator', 'reel-maker',
      'wedding-photographer', 'candid-photographer', 'pre-wedding-shoot', 'maternity-newborn',
      'product-photographer', 'event-videographer', 'drone-operator', 'photo-booth',
      'caterer', 'decorator', 'bridal-makeup', 'mehendi-artist', 'dj',
      'live-band', 'wedding-planner'
    ) then 'proposal'
    else 'inspect_quote'
  end,
  location_modes = case
    when slug in ('instagram-influencer', 'youtube-creator', 'ugc-creator', 'reel-maker') then array['remote']
    when slug in (
      'wedding-photographer', 'candid-photographer', 'pre-wedding-shoot', 'maternity-newborn',
      'product-photographer', 'event-videographer', 'drone-operator', 'photo-booth',
      'caterer', 'decorator', 'dj', 'live-band', 'wedding-planner'
    ) then array['at_venue']
    when slug in ('bridal-makeup', 'mehendi-artist') then array['at_customer', 'at_provider', 'at_venue']
    when slug in ('car-mechanic', 'bike-mechanic') then array['at_customer', 'at_provider']
    else array['at_customer']
  end,
  pricing_units = case
    when slug in ('caterer') then array['person', 'plate']
    when slug in ('decorator', 'bridal-makeup', 'mehendi-artist', 'wedding-planner') then array['event']
    when slug in ('dj', 'live-band', 'drone-operator', 'photo-booth') then array['hour']
    when slug in ('wedding-photographer', 'candid-photographer', 'event-videographer') then array['day', 'event']
    when slug in ('pre-wedding-shoot', 'maternity-newborn') then array['session']
    when slug in ('house-cleaning', 'water-tank-cleaning') then array['job', 'bhk', 'litre']
    else array['job']
  end,
  payment_template = case
    when slug in ('instagram-influencer', 'ugc-creator', 'reel-maker', 'wedding-photographer', 'candid-photographer',
                  'pre-wedding-shoot', 'maternity-newborn', 'product-photographer', 'event-videographer')
      then 'creative_delivery'
    when slug in (
      'youtube-creator', 'drone-operator', 'photo-booth', 'caterer', 'decorator',
      'bridal-makeup', 'mehendi-artist', 'dj', 'live-band', 'wedding-planner'
    ) then 'event_standard'
    else 'visit_then_balance'
  end,
  cancellation_policy = case
    when slug in (
      'instagram-influencer', 'youtube-creator', 'ugc-creator', 'reel-maker',
      'wedding-photographer', 'candid-photographer', 'pre-wedding-shoot', 'maternity-newborn',
      'product-photographer', 'event-videographer', 'drone-operator', 'photo-booth',
      'caterer', 'decorator', 'bridal-makeup', 'mehendi-artist', 'dj',
      'live-band', 'wedding-planner'
    ) then 'event_moderate'
    else 'standard_visit'
  end,
  min_lead_hours = case
    when slug in (
      'instagram-influencer', 'youtube-creator', 'ugc-creator', 'reel-maker',
      'wedding-photographer', 'candid-photographer', 'pre-wedding-shoot', 'maternity-newborn',
      'product-photographer', 'event-videographer', 'drone-operator', 'photo-booth',
      'caterer', 'decorator', 'bridal-makeup', 'mehendi-artist', 'dj',
      'live-band', 'wedding-planner'
    ) then 24
    else 0
  end,
  max_lead_days = case
    when slug in (
      'instagram-influencer', 'youtube-creator', 'ugc-creator', 'reel-maker',
      'wedding-photographer', 'candid-photographer', 'pre-wedding-shoot', 'maternity-newborn',
      'product-photographer', 'event-videographer', 'drone-operator', 'photo-booth',
      'caterer', 'decorator', 'bridal-makeup', 'mehendi-artist', 'dj',
      'live-band', 'wedding-planner'
    ) then 365
    else 7
  end,
  pricing_mode = case
    when slug in (
      'instagram-influencer', 'youtube-creator', 'ugc-creator', 'reel-maker',
      'wedding-photographer', 'candid-photographer', 'pre-wedding-shoot', 'maternity-newborn',
      'product-photographer', 'event-videographer', 'drone-operator', 'photo-booth',
      'caterer', 'decorator', 'bridal-makeup', 'mehendi-artist', 'dj',
      'live-band', 'wedding-planner'
    ) then 'quote'::public.pricing_mode
    else 'quote'::public.pricing_mode
  end;

create or replace function public._sync_category_pricing_mode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.pricing_mode := case
    when new.archetype = 'fixed' then 'fixed'::public.pricing_mode
    else 'quote'::public.pricing_mode
  end;
  return new;
end;
$$;
create trigger categories_sync_pricing_mode
  before insert or update of archetype, pricing_mode on public.categories
  for each row execute function public._sync_category_pricing_mode();

-- Feature flags and the launch city live beside the existing payout/matching config.
insert into public.app_config (key, value)
values (
  'archetype_flags',
  '{"fixed":false,"inspect_quote":true,"proposal":false,"time_based":false,"remote":false}'::jsonb
)
on conflict (key) do nothing;

-- Backfill launch_city from the most-used current provider city. No environment-specific city is embedded here.
insert into public.app_config (key, value)
select 'launch_city', to_jsonb(x.city)
  from (
    select trim(city) as city, count(*) as n
      from public.providers
     where nullif(trim(city), '') is not null
     group by trim(city)
     order by n desc, lower(trim(city))
     limit 1
  ) x
on conflict (key) do nothing;

create table public.category_cities (
  category_id uuid not null references public.categories (id) on delete cascade,
  city text not null check (char_length(trim(city)) between 2 and 120),
  live boolean not null default false,
  launched_at timestamptz,
  primary key (category_id, city),
  check (not live or launched_at is not null)
);
create unique index category_cities_normalized_city_idx
  on public.category_cities (category_id, lower(trim(city)));

insert into public.category_cities (category_id, city, live, launched_at)
select c.id, trim(config.value #>> '{}'), true, now()
  from public.categories c
  cross join public.app_config config
 where config.key = 'launch_city'
   and c.active
   and nullif(trim(config.value #>> '{}'), '') is not null
on conflict do nothing;

alter table public.category_cities enable row level security;
revoke all on public.category_cities from anon, authenticated;
grant select on public.category_cities to anon, authenticated, service_role;
grant all on public.category_cities to service_role;
create policy category_cities_live_read on public.category_cities
  for select to anon, authenticated
  using (live);

drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories
  for select using (
    active and exists (
      select 1 from public.category_cities cc
       where cc.category_id = categories.id and cc.live
    )
  );

-- ---------------------------------------------------------------------------
-- Eligibility and server catalog
-- ---------------------------------------------------------------------------
create or replace function public._archetype_enabled(p_archetype text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (value ->> p_archetype)::boolean from public.app_config where key = 'archetype_flags'),
    false
  );
$$;

create or replace function public._is_bookable(
  p_category_id uuid,
  p_provider_id uuid,
  p_city text,
  p_archetype text,
  p_window tstzrange default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.categories c
      join public.providers p on p.id = p_provider_id
     where c.id = p_category_id
       and c.active
       and not c.restricted
       and c.archetype = p_archetype
       and public._archetype_enabled(c.archetype)
       and exists (
         select 1 from public.category_cities cc
          where cc.category_id = c.id
            and cc.live
            and lower(trim(cc.city)) = lower(trim(coalesce(p_city, '')))
       )
       and public._provider_is_live(p.id)
       and not p.paused
       and public._category_docs_ok(p.id, c.id)
       and exists (
         select 1 from public.provider_services ps
          where ps.provider_id = p.id and ps.category_id = c.id and ps.active
       )
       and (
         p_window is null
         or (
           lower(p_window) >= now() + make_interval(hours => c.min_lead_hours) - interval '5 minutes'
           and lower(p_window) <= now() + make_interval(days => c.max_lead_days)
         )
       )
  );
$$;

create or replace function public._assert_bookable(
  p_category_id uuid,
  p_provider_id uuid,
  p_city text,
  p_archetype text,
  p_window tstzrange default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert(
    public._is_bookable(p_category_id, p_provider_id, p_city, p_archetype, p_window),
    'category_not_bookable'
  );
end;
$$;

create or replace function public.get_catalog(p_city text default null)
returns table (
  id uuid,
  slug text,
  name text,
  icon text,
  vertical text,
  parent_id uuid,
  archetype text,
  location_modes text[],
  pricing_units text[],
  intake_schema jsonb,
  payment_template text,
  cancellation_policy text,
  commission_bp int,
  min_lead_hours int,
  max_lead_days int,
  requires_docs text[],
  recommended_docs text[],
  restricted boolean,
  config_version int,
  pricing_mode public.pricing_mode,
  sort_order int,
  profile_schema jsonb,
  review_tags text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select coalesce(
      nullif(trim(p_city), ''),
      (select value #>> '{}' from public.app_config where key = 'launch_city')
    ) as city
  )
  select c.id, c.slug, c.name, c.icon, c.vertical, c.parent_id, c.archetype,
         c.location_modes, c.pricing_units, c.intake_schema, c.payment_template,
         c.cancellation_policy, c.commission_bp, c.min_lead_hours, c.max_lead_days,
         c.requires_docs, c.recommended_docs, c.restricted, c.config_version,
         c.pricing_mode, c.sort_order, c.profile_schema, c.review_tags
    from public.categories c
    join public.category_cities cc
      on cc.category_id = c.id and cc.live
    cross join target t
   where c.active
     and not c.restricted
     and lower(trim(cc.city)) = lower(trim(coalesce(t.city, '')))
     and public._archetype_enabled(c.archetype)
   order by c.sort_order, c.name;
$$;

-- Discovery calls remain outwardly unchanged, but only return launch-city/bookable providers.
alter function public.search_providers(
  text, double precision, double precision, text, numeric, public.skill_level, int, boolean, int
) rename to _search_providers_phase0;

create or replace function public.search_providers(
  p_category_slug text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_sort text default 'recommended',
  p_min_rating numeric default null,
  p_skill_level public.skill_level default null,
  p_max_visit_fee int default null,
  p_online_only boolean default false,
  p_limit int default 50
)
returns table (
  provider_id uuid,
  provider_service_id uuid,
  full_name text,
  avatar_url text,
  city text,
  skill_level public.skill_level,
  visit_fee int,
  labour_rate int,
  rate_unit public.rate_unit,
  rating_avg numeric,
  rating_count int,
  jobs_completed int,
  years_experience int,
  is_online boolean,
  distance_km double precision,
  score double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select r.*
    from public._search_providers_phase0(
      p_category_slug, p_lat, p_lng, p_sort, p_min_rating, p_skill_level,
      p_max_visit_fee, p_online_only, p_limit
    ) r
    join public.provider_services ps on ps.id = r.provider_service_id
    join public.categories c on c.id = ps.category_id
   where public._is_bookable(c.id, r.provider_id, r.city, c.archetype, null);
$$;

alter function public.match_providers(
  text, double precision, double precision, jsonb, timestamptz, int, int
) rename to _match_providers_phase0;

create or replace function public.match_providers(
  p_category_slug text,
  p_lat double precision,
  p_lng double precision,
  p_needs jsonb default '{}'::jsonb,
  p_scheduled_at timestamptz default null,
  p_max_visit_fee int default null,
  p_limit int default 6
)
returns table (
  provider_id uuid,
  provider_service_id uuid,
  full_name text,
  avatar_url text,
  city text,
  skill_level public.skill_level,
  visit_fee int,
  labour_rate int,
  rate_unit public.rate_unit,
  rating_avg numeric,
  rating_count int,
  jobs_completed int,
  years_experience int,
  is_online boolean,
  distance_km double precision,
  score double precision,
  tier text,
  score_components jsonb,
  matched_needs text[],
  evidence_quotes jsonb,
  is_new_pro boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select r.*
    from public._match_providers_phase0(
      p_category_slug, p_lat, p_lng, p_needs, p_scheduled_at, p_max_visit_fee, p_limit
    ) r
    join public.provider_services ps on ps.id = r.provider_service_id
    join public.categories c on c.id = ps.category_id
   where public._is_bookable(
     c.id,
     r.provider_id,
     r.city,
     c.archetype,
     case when p_scheduled_at is null then null
          else tstzrange(p_scheduled_at, p_scheduled_at + interval '2 hours', '[)') end
   );
$$;

-- ---------------------------------------------------------------------------
-- Booking snapshots
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists archetype text,
  add column if not exists category_config_version int,
  add column if not exists location_mode text,
  add column if not exists pricing_snapshot jsonb,
  add column if not exists payment_template_snapshot jsonb,
  add column if not exists cancellation_snapshot jsonb,
  add column if not exists platform_fee_rule_snapshot jsonb;

alter table public.bookings
  drop constraint if exists bookings_archetype_check,
  drop constraint if exists bookings_location_mode_check,
  drop constraint if exists bookings_category_config_version_check;
alter table public.bookings
  add constraint bookings_archetype_check
    check (archetype in ('fixed', 'inspect_quote', 'proposal', 'time_based', 'remote')),
  add constraint bookings_location_mode_check
    check (location_mode in ('at_customer', 'at_provider', 'at_venue', 'remote')),
  add constraint bookings_category_config_version_check check (category_config_version > 0);

-- Existing bookings retain the exact legacy runtime behaviour and amounts.
update public.bookings b
set
  archetype = 'inspect_quote',
  category_config_version = 1,
  location_mode = 'at_customer',
  pricing_snapshot = jsonb_build_object(
    'key', 'legacy_inspect_quote',
    'pricing_mode', 'quote',
    'visit_fee_paise', b.visit_fee,
    'platform_fee_paise', b.platform_fee
  ),
  payment_template_snapshot = jsonb_build_object(
    'key', 'visit_then_balance',
    'version', 1
  ),
  cancellation_snapshot = jsonb_build_object(
    'key', 'standard_visit',
    'version', 1,
    'legacy', true
  ),
  platform_fee_rule_snapshot = jsonb_build_object(
    'key', 'legacy_flat',
    'amount_paise', b.platform_fee
  )
where b.archetype is null
   or b.category_config_version is null
   or b.location_mode is null
   or b.pricing_snapshot is null
   or b.payment_template_snapshot is null
   or b.cancellation_snapshot is null
   or b.platform_fee_rule_snapshot is null;

alter table public.bookings
  alter column archetype set not null,
  alter column category_config_version set not null,
  alter column location_mode set not null,
  alter column pricing_snapshot set not null,
  alter column payment_template_snapshot set not null,
  alter column cancellation_snapshot set not null,
  alter column platform_fee_rule_snapshot set not null;

create or replace function public._apply_booking_core_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.categories;
  v_city text;
  v_window tstzrange;
begin
  if tg_op = 'UPDATE' then
    perform public._assert(
      new.archetype is not distinct from old.archetype
      and new.category_config_version is not distinct from old.category_config_version
      and new.location_mode is not distinct from old.location_mode
      and new.pricing_snapshot is not distinct from old.pricing_snapshot
      and new.payment_template_snapshot is not distinct from old.payment_template_snapshot
      and new.cancellation_snapshot is not distinct from old.cancellation_snapshot
      and new.platform_fee_rule_snapshot is not distinct from old.platform_fee_rule_snapshot,
      'booking core snapshot is immutable'
    );
    return new;
  end if;

  select * into c from public.categories where id = new.category_id;
  perform public._assert(found, 'category not found');
  select a.city into v_city from public.addresses a where a.id = new.address_id;
  perform public._assert(coalesce(trim(v_city), '') <> '', 'booking city not found');
  v_window := coalesce(
    new.service_window,
    case when new.scheduled_at is null then null
         else tstzrange(new.scheduled_at, new.scheduled_at + interval '2 hours', '[)') end
  );
  perform public._assert_bookable(c.id, new.provider_id, v_city, c.archetype, v_window);
  perform public._assert(
    new.location_mode is null or new.location_mode = any(c.location_modes),
    'location mode is not available for this category'
  );

  new.archetype := c.archetype;
  new.category_config_version := c.config_version;
  new.location_mode := coalesce(new.location_mode, c.location_modes[1]);
  new.pricing_snapshot := coalesce(new.pricing_snapshot, jsonb_build_object(
    'key', 'category:' || c.id::text || ':v' || c.config_version::text,
    'pricing_mode', c.pricing_mode,
    'pricing_units', to_jsonb(c.pricing_units),
    'visit_fee_paise', new.visit_fee,
    'platform_fee_paise', new.platform_fee
  ));
  new.payment_template_snapshot := coalesce(new.payment_template_snapshot, jsonb_build_object(
    'key', c.payment_template,
    'version', c.config_version
  ));
  new.cancellation_snapshot := coalesce(new.cancellation_snapshot, jsonb_build_object(
    'key', c.cancellation_policy,
    'version', c.config_version,
    'legacy', c.cancellation_policy = 'standard_visit'
  ));
  new.platform_fee_rule_snapshot := coalesce(new.platform_fee_rule_snapshot, jsonb_build_object(
    'key', case when c.archetype = 'inspect_quote' then 'legacy_flat' else 'archetype:' || c.archetype end,
    'amount_paise', new.platform_fee
  ));
  return new;
end;
$$;
create trigger bookings_apply_core_contract
  before insert or update of archetype, category_config_version, location_mode,
    pricing_snapshot, payment_template_snapshot, cancellation_snapshot, platform_fee_rule_snapshot
  on public.bookings
  for each row execute function public._apply_booking_core_contract();

-- Latest booking RPC keeps its public signature and inspect_quote behaviour.
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
  c_platform_fee constant int := 2900;
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
    v_ps.visit_fee, c_platform_fee, p_travel_request_id, v_window,
    c.archetype, c.config_version, c.location_modes[1],
    jsonb_build_object(
      'key', 'category:' || c.id::text || ':v' || c.config_version::text,
      'pricing_mode', c.pricing_mode,
      'pricing_units', to_jsonb(c.pricing_units),
      'visit_fee_paise', v_ps.visit_fee,
      'platform_fee_paise', c_platform_fee
    ),
    jsonb_build_object('key', c.payment_template, 'version', c.config_version),
    jsonb_build_object(
      'key', c.cancellation_policy,
      'version', c.config_version,
      'legacy', c.cancellation_policy = 'standard_visit'
    ),
    jsonb_build_object('key', 'legacy_flat', 'amount_paise', c_platform_fee)
  ) returning id into v_booking;

  insert into public.booking_secrets (booking_id, start_otp)
  values (v_booking, public._gen_otp());
  insert into public.booking_events (booking_id, actor_id, from_status, to_status)
  values (v_booking, v_uid, null, 'pending_payment');
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reconciled transition contract
-- ---------------------------------------------------------------------------
create table public.archetype_transitions (
  archetype text not null
    check (archetype in ('fixed', 'inspect_quote', 'proposal', 'time_based', 'remote')),
  from_status public.booking_status not null,
  to_status public.booking_status not null,
  actor text not null check (actor in ('customer', 'provider', 'system', 'admin')),
  primary key (archetype, from_status, to_status, actor)
);

insert into public.archetype_transitions (archetype, from_status, to_status, actor) values
  -- Payment and request acceptance / expiry
  ('inspect_quote', 'pending_payment', 'requested', 'system'),
  ('inspect_quote', 'pending_payment', 'accepted', 'system'),
  ('inspect_quote', 'pending_payment', 'cancelled', 'customer'),
  ('inspect_quote', 'requested', 'accepted', 'provider'),
  ('inspect_quote', 'requested', 'declined', 'provider'),
  ('inspect_quote', 'requested', 'expired', 'system'),
  ('inspect_quote', 'requested', 'cancelled', 'customer'),
  -- Travel, inspect and quote
  ('inspect_quote', 'accepted', 'en_route', 'provider'),
  ('inspect_quote', 'accepted', 'cancelled', 'customer'),
  ('inspect_quote', 'en_route', 'inspecting', 'provider'),
  ('inspect_quote', 'en_route', 'in_progress', 'provider'),
  ('inspect_quote', 'en_route', 'cancelled', 'customer'),
  ('inspect_quote', 'inspecting', 'quote_sent', 'provider'),
  ('inspect_quote', 'quote_sent', 'awaiting_payment', 'customer'),
  ('inspect_quote', 'quote_sent', 'in_progress', 'customer'),
  ('inspect_quote', 'quote_sent', 'closed_no_work', 'customer'),
  ('inspect_quote', 'awaiting_payment', 'in_progress', 'system'),
  ('inspect_quote', 'awaiting_payment', 'cancelled', 'customer'),
  -- Completion, close, dispute and resolution
  ('inspect_quote', 'in_progress', 'completion_requested', 'provider'),
  ('inspect_quote', 'in_progress', 'disputed', 'customer'),
  ('inspect_quote', 'completion_requested', 'completed', 'provider'),
  ('inspect_quote', 'completion_requested', 'completed', 'customer'),
  ('inspect_quote', 'completion_requested', 'completed', 'system'),
  ('inspect_quote', 'completion_requested', 'disputed', 'customer'),
  ('inspect_quote', 'completed', 'closed', 'system'),
  ('inspect_quote', 'completed', 'disputed', 'customer'),
  ('inspect_quote', 'disputed', 'refunded', 'admin'),
  ('inspect_quote', 'disputed', 'completed', 'admin')
on conflict do nothing;

alter table public.archetype_transitions enable row level security;
revoke all on public.archetype_transitions from anon, authenticated;
grant select on public.archetype_transitions to anon, authenticated, service_role;
grant all on public.archetype_transitions to service_role;
create policy archetype_transitions_read on public.archetype_transitions
  for select using (true);

create or replace function public._transition_actor(p_booking_id uuid, p_actor uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when b.id is null then null
           when p_actor is null then 'system'
           when p_actor = b.customer_id then 'customer'
           when p_actor = b.provider_id then 'provider'
           when exists (select 1 from public.admins a where a.user_id = p_actor) then 'admin'
           else null
         end
    from public.bookings b
   where b.id = p_booking_id;
$$;

create or replace function public._set_status(
  p_booking_id uuid,
  p_to public.booking_status,
  p_actor uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_actor text;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  perform public._assert(found, 'booking not found');
  v_actor := public._transition_actor(b.id, p_actor);
  perform public._assert(v_actor is not null, 'transition actor is not authorised');
  perform public._assert(
    exists (
      select 1 from public.archetype_transitions t
       where t.archetype = b.archetype
         and t.from_status = b.status
         and t.to_status = p_to
         and t.actor = v_actor
    ),
    format('invalid transition: %s %s -> %s by %s', b.archetype, b.status, p_to, v_actor)
  );
  update public.bookings
     set status = p_to, updated_at = now()
   where id = b.id;
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (b.id, p_actor, b.status, p_to, p_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public._sync_category_pricing_mode(),
  public._archetype_enabled(text),
  public._is_bookable(uuid, uuid, text, text, tstzrange),
  public._assert_bookable(uuid, uuid, text, text, tstzrange),
  public._apply_booking_core_contract(),
  public._transition_actor(uuid, uuid)
from public, anon, authenticated;

revoke execute on function
  public._search_providers_phase0(
    text, double precision, double precision, text, numeric, public.skill_level, int, boolean, int
  ),
  public._match_providers_phase0(text, double precision, double precision, jsonb, timestamptz, int, int)
from public, anon, authenticated;

revoke execute on function
  public.get_catalog(text),
  public.search_providers(
    text, double precision, double precision, text, numeric, public.skill_level, int, boolean, int
  ),
  public.match_providers(text, double precision, double precision, jsonb, timestamptz, int, int)
from public;
grant execute on function public.get_catalog(text) to anon, authenticated, service_role;
grant execute on function public.search_providers(
  text, double precision, double precision, text, numeric, public.skill_level, int, boolean, int
) to anon, authenticated, service_role;
grant execute on function public.match_providers(
  text, double precision, double precision, jsonb, timestamptz, int, int
) to anon, authenticated, service_role;

revoke execute on function
  public.create_booking(
    uuid, text, text, text, double precision, double precision, timestamptz, text[], uuid
  )
from public, anon;
grant execute on function
  public.create_booking(
    uuid, text, text, text, double precision, double precision, timestamptz, text[], uuid
  )
to authenticated;

-- ==================================================================================================
-- QUICKServe ALL-SERVICE DEMO DATA — CI / MANUAL TEST ENVIRONMENTS ONLY
--
-- NEVER run this file in a production project, and never include it in deploy-backend.yml.
-- It creates synthetic users, providers, packages, requests and bookings prefixed with DEMO metadata.
-- When migrations 0048-0050 are present, it also seeds verified sports and tile-marketplace fixtures.
-- Legacy seed tests without those migrations keep the original service fixtures and skip marketplace rows.
-- Creator/event category activation is migration-managed (0024); this seed does not change their
-- global active state. Demo data is reachable only with an explicit app build using
-- EXPO_PUBLIC_DEMO_CITY="Vijayawada Demo", or by authenticated demo-participant routes.
--
-- The caller MUST mark the transaction as a demo seed:
--   select set_config('quickserve.demo_seed', '1', true);
-- This guard intentionally prevents accidental inclusion in normal migrations.
--
-- Reset behaviour: every run removes only rows created by this file, then recreates them. IDs and
-- content are deterministic. Existing app-created data and the founder account are not deleted.
-- All payment/link/transfer identifiers below are fake; use EXPO_PUBLIC_DEMO_PAYMENT=1 in CI.
-- ==================================================================================================

begin;

do $$
begin
  if coalesce(current_setting('quickserve.demo_seed', true), '') <> '1' then
    raise exception 'seed-all-services.sql is DEMO ONLY; set quickserve.demo_seed=1 in the same transaction';
  end if;
  if to_regclass('public.service_packages') is null
     or to_regclass('public.category_cities') is null
     or to_regclass('public.service_requests') is null then
    raise exception '0018-0020 must be applied before seed-all-services.sql';
  end if;
end;
$$;

create or replace function pg_temp.demo_sid(p_key text) returns uuid
language sql immutable as $$
  select (substr(h, 1, 8) || '-5eed-de00-' || substr(h, 17, 4) || '-' || substr(h, 21, 12))::uuid
    from (select md5('quickserve-demo-all-services:' || p_key) as h) x
$$;

-- Reset rows owned by this script. Order matters because 0022 pack/session rows have restrictive FKs.
delete from public.bookings
 where description like '[DEMO ONLY]%'
    or exists (
      select 1 from auth.users u
       where u.id = public.bookings.provider_id
         and coalesce(u.raw_user_meta_data ->> 'demo_only', '') = 'true'
    );

do $$
begin
  if to_regclass('public.pack_sessions') is not null then
    execute $sql$
      delete from public.pack_sessions
       where exists (
         select 1 from public.pack_purchases k
          where k.id = pack_sessions.pack_id and k.cancellation_reason = '[DEMO ONLY] seed reset'
       )
    $sql$;
  end if;
  if to_regclass('public.recurring_schedules') is not null then
    execute 'delete from public.recurring_schedules where description like ''[DEMO ONLY]%''';
  end if;
  if to_regclass('public.pack_purchases') is not null then
    execute $sql$
      update public.pack_purchases
         set payment_id = null
       where cancellation_reason = '[DEMO ONLY] seed reset'
    $sql$;
  end if;
  delete from public.payments
   where coalesce(razorpay_link_id, '') like 'plink_demo_all_%'
      or coalesce(razorpay_payment_id, '') like 'pay_demo_all_%';
  if to_regclass('public.pack_purchases') is not null then
    execute 'delete from public.pack_purchases where cancellation_reason = ''[DEMO ONLY] seed reset''';
  end if;
end;
$$;

delete from public.service_requests
 where coalesce(intake ->> 'demo_only', '') = 'true';
delete from public.provider_links
 where url like 'https://demo.example/%';
delete from public.category_cities
 where city = 'Vijayawada Demo';
delete from auth.users
 where id = any(array[
   pg_temp.demo_sid('provider:demo-home-tutor'),
   pg_temp.demo_sid('customer:demo-founder-address')
 ])
    or coalesce(raw_user_meta_data ->> 'demo_only', '') = 'true';

insert into public.categories (
  slug, name, icon, pricing_mode, sort_order, active,
  vertical, archetype, location_modes, pricing_units, intake_schema,
  payment_template, cancellation_policy, min_lead_hours, max_lead_days,
  profile_schema, review_tags, restricted, config_version
)
values (
  'demo-home-tutor', 'Demo Home Tutor', 'school', 'fixed', 160, true,
  'learning', 'time_based', array['at_customer', 'remote'], array['session', 'month'],
  '{"type":"object","properties":{"subject":{"type":"string","enum":["Mathematics","Science","English","Telugu"]},"student_grade":{"type":"integer","minimum":1,"maximum":12}},"required":["subject","student_grade"]}'::jsonb,
  'session_prepaid', 'session_standard', 24, 90,
  '{"type":"object","properties":{"subjects":{"type":"array","items":{"type":"string"},"maxItems":6},"teaching_language":{"type":"string"}}}'::jsonb,
  array['clear_explanation','patient','on_time','improved_confidence'], false, 1
)
on conflict (slug) do update
set name = excluded.name,
    active = true,
    archetype = excluded.archetype,
    vertical = excluded.vertical,
    location_modes = excluded.location_modes,
    pricing_units = excluded.pricing_units,
    intake_schema = excluded.intake_schema,
    payment_template = excluded.payment_template,
    cancellation_policy = excluded.cancellation_policy,
    pricing_mode = 'fixed',
    config_version = public.categories.config_version + 1;

-- The three launch-intended fixed categories from 0019. 0019 only flips categories that already had
-- fixed packages, and this seed creates packages afterwards, so convert first; package price types
-- below are derived from the archetype.
update public.categories
set archetype = 'fixed',
    pricing_units = array['job']::text[],
    payment_template = 'full_upfront',
    cancellation_policy = 'fixed_flexible',
    config_version = config_version + 1
where slug in ('house-cleaning', 'water-tank-cleaning', 'pest-control')
  and archetype <> 'fixed';

-- Demo Home Tutor is the only time-based category, so enabling the archetype exposes nothing else.
update public.app_config
   set value = jsonb_set(value, '{time_based}', 'true'::jsonb, true)
 where key = 'archetype_flags';

-- Demo checkout settles server-side only for providers with service-controlled app_metadata.demo_only,
-- and only after this guarded seed marks the project as a demo deployment.
insert into public.app_config (key, value)
values ('demo_payments', '{"enabled": true, "provider_ids": []}'::jsonb)
on conflict (key) do update set value = excluded.value;

-- The legacy E2E checkout provider is seeded by seed.sql rather than demo_specs.
-- Mark only its service-controlled app metadata so demo settlement accepts the E2E flow.
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"demo_only":"true"}'::jsonb
 where id = '11111111-1111-1111-1111-111111111111'::uuid;
update public.providers p
   set admin_review_status = 'approved'
 where p.id = '11111111-1111-1111-1111-111111111111'::uuid
   and exists (
     select 1 from auth.users u
      where u.id = p.id and u.raw_app_meta_data->>'demo_only' = 'true'
   );

insert into public.app_config (key, value)
values ('deployment', '{"is_demo_project": true}'::jsonb)
on conflict (key) do update
  set value = jsonb_set(public.app_config.value, '{is_demo_project}', 'true'::jsonb, true);

-- Phase 6/7a marketplace capabilities are enabled only by this guarded demo seed.
do $$
begin
  if to_regclass('public.feature_flags') is not null
     and to_regclass('public.sports_activities') is not null
     and to_regclass('public.sports_venues') is not null
     and to_regclass('public.sports_resources') is not null
     and to_regclass('public.sports_hours') is not null
     and to_regclass('public.sports_price_rules') is not null
     and to_regclass('public.shops') is not null
     and to_regclass('public.shop_categories') is not null
     and to_regclass('public.product_categories') is not null
     and to_regclass('public.products') is not null
     and to_regclass('public.product_enquiries') is not null
     and to_regclass('public.product_enquiry_messages') is not null
     and to_regclass('public.rfqs') is not null then
    insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
    values
      ('sports', true, 'Sports & venues', 'Venue discovery and booking requests.', 'Marketplace', 30),
      ('products', true, 'Products & shops', 'Shop catalogues and product search.', 'Marketplace', 40),
      ('product_enquiries', true, 'Product enquiries', 'Customers message shops about products.', 'Marketplace', 41),
      ('product_rfq', true, 'Bulk quotations (RFQ)', 'Customers request quotes from several shops.', 'Marketplace', 42)
    on conflict (key) do update set enabled = true;
    -- E2E assertions use English copy; Telugu remains off until its translations are reviewed.
    update public.feature_flags set enabled = false where key = 'telugu_language';
  else
    raise notice 'Phase 6/7a demo feature flags skipped; apply migrations 0048-0050 before marketplace E2E.';
  end if;
end;
$$;

create temp table demo_specs (
  slug text primary key,
  provider_name text not null,
  provider_bio text not null,
  phone text not null,
  attributes jsonb not null
) on commit drop;

insert into demo_specs values
  ('ac-repair', 'Ravi Demo Kumar', '[DEMO ONLY] Split/window AC specialist with transparent parts bills.', '919000004101', '{"equipment":["split","inverter"],"expertise":["gas_refill","deep_service"]}'),
  ('electrician', 'Lakshmi Demo Electricals', '[DEMO ONLY] Licensed home wiring and inverter specialist.', '919000004102', '{"expertise":["wiring","mcb_db","inverter_ups"]}'),
  ('plumber', 'Suresh Demo Plumbing', '[DEMO ONLY] Leak repair, concealed piping and bathroom fittings.', '919000004103', '{"expertise":["leaks","pipeline","bathroom"]}'),
  ('house-cleaning', 'Durga Demo Home Care', '[DEMO ONLY] Four-person deep-cleaning team with supplied consumables.', '919000004104', '{"specialties":["full_home","bathroom","kitchen"],"supplies_mode":"included"}'),
  ('water-tank-cleaning', 'Nagaraju Demo Tank Care', '[DEMO ONLY] Mechanised sump and overhead tank cleaning with disinfection.', '919000004105', '{"tank_types":["overhead","sump"]}'),
  ('car-mechanic', 'Satish Demo Auto Works', '[DEMO ONLY] Multi-brand doorstep diagnostics and scheduled service.', '919000004106', '{}'),
  ('bike-mechanic', 'Shaik Demo Bike Point', '[DEMO ONLY] Two-wheeler service, electricals and puncture support.', '919000004107', '{}'),
  ('appliance-repair', 'Madhavi Demo Appliance Lab', '[DEMO ONLY] Washing machine, fridge, microwave and RO repairs.', '919000004108', '{}'),
  ('pest-control', 'Eswar Demo Pest Guard', '[DEMO ONLY] Odour-controlled home pest treatment with follow-up.', '919000004109', '{"pests":["cockroaches","termites","bed_bugs"]}'),
  ('carpenter', 'Yesu Demo Woodworks', '[DEMO ONLY] Furniture assembly, locks, wardrobes and repair work.', '919000004110', '{}'),
  ('painter', 'Naresh Demo Colour Craft', '[DEMO ONLY] Interior, exterior and waterproofing applicator.', '919000004111', '{}'),
  ('instagram-influencer', 'Ananya Demo', '[DEMO ONLY] Telugu lifestyle creator with disclosed brand collaborations.', '919000004112', '{"niches":["fashion","food"],"languages":["Telugu","English"]}'),
  ('youtube-creator', 'Karthik Demo Frames', '[DEMO ONLY] Product and local-business YouTube creator.', '919000004113', '{"niches":["tech","reviews"],"formats":["integration","shorts"]}'),
  ('ugc-creator', 'Isha Demo Studio', '[DEMO ONLY] Short-form UGC demos and founder testimonials.', '919000004114', '{"styles":["talking-head","product-demo"]}'),
  ('reel-maker', 'Arjun Demo Edits', '[DEMO ONLY] Short-form edit and motion design specialist.', '919000004115', '{"styles":["cinematic","fast-cut"]}'),
  ('wedding-photographer', 'Kavya Demo Weddings', '[DEMO ONLY] Candid wedding coverage with an agreed shot list.', '919000004116', '{"styles":["candid","documentary"],"events_covered":["haldi","wedding","reception"]}'),
  ('candid-photographer', 'Rohan Demo Moments', '[DEMO ONLY] Natural candid photography for private events.', '919000004117', '{"styles":["candid","documentary"]}'),
  ('pre-wedding-shoot', 'Nisha Demo Stories', '[DEMO ONLY] Location-led pre-wedding photo sessions.', '919000004118', '{"styles":["cinematic","candid"]}'),
  ('maternity-newborn', 'Asha Demo Portraits', '[DEMO ONLY] Safe maternity and newborn lifestyle sessions.', '919000004119', '{"styles":["maternity","newborn"],"shoot_locations":["home","studio"]}'),
  ('product-photographer', 'Varun Demo Products', '[DEMO ONLY] E-commerce and food product photography studio.', '919000004120', '{"styles":["ecommerce","flat-lay","food"]}'),
  ('event-videographer', 'Pranav Demo Films', '[DEMO ONLY] Multi-camera event films and same-day teaser delivery.', '919000004121', '{"formats":["highlight-film","teaser"]}'),
  ('drone-operator', 'Vikram Demo Aerials', '[DEMO ONLY] Location-permission-aware aerial coverage.', '919000004122', '{"services":["wedding","event"],"pilot_licence_number":"DEMO-DGCA-0001"}'),
  ('photo-booth', 'Pallavi Demo Booth Co', '[DEMO ONLY] Open-air and 360 photo booth experiences.', '919000004123', '{"booth_styles":["open-air","360-video"]}'),
  ('caterer', 'Raju Demo Caterers', '[DEMO ONLY] Hyderabadi and South Indian event catering.', '919000004124', '{"cuisines":["south-indian","hyderabadi"],"dietary_options":["veg","non-veg"],"min_guests":50,"max_guests":1200}'),
  ('decorator', 'Sana Demo Decor', '[DEMO ONLY] Floral, pastel and traditional event decor.', '919000004125', '{"themes":["floral","pastel","traditional"]}'),
  ('bridal-makeup', 'Priya Demo Bridal', '[DEMO ONLY] HD and airbrush bridal looks with a trial option.', '919000004126', '{"skin_types_expert":["oily","dry","sensitive"],"techniques":["hd","airbrush"]}'),
  ('mehendi-artist', 'Farida Demo Mehendi', '[DEMO ONLY] Bridal and guest mehendi with natural cones.', '919000004127', '{"styles":["bridal","arabic","minimal"],"natural_henna":true}'),
  ('dj', 'Nikhil Demo DJ', '[DEMO ONLY] Bollywood, Tollywood and EDM event sets.', '919000004128', '{"genres":["bollywood","tollywood","edm"]}'),
  ('live-band', 'The Demo Raga Band', '[DEMO ONLY] Acoustic, folk and fusion live performances.', '919000004129', '{"genres":["acoustic","folk","fusion"],"members":5}'),
  ('wedding-planner', 'Divya Demo Weddings', '[DEMO ONLY] Full, partial and day-of wedding planning.', '919000004130', '{"planning_modes":["full-planning","partial-planning","day-coordination"]}'),
  ('demo-home-tutor', 'Sravani Demo Learning', '[DEMO ONLY] Maths and science tutor for classes 6-12.', '919000004131', '{"subjects":["Mathematics","Science"],"teaching_language":"Telugu"}');

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000',
  pg_temp.demo_sid('provider:' || s.slug),
  'authenticated', 'authenticated', s.phone, now(),
  '{"provider":"phone","providers":["phone"],"demo_only":"true"}'::jsonb,
  jsonb_build_object('full_name', s.provider_name, 'demo_only', 'true'),
  now() - interval '180 days', now()
from demo_specs s
on conflict (id) do update
set phone = excluded.phone,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    phone_confirmed_at = excluded.phone_confirmed_at,
    updated_at = now();

insert into public.profiles (id, full_name, role_customer, role_provider, created_at)
select pg_temp.demo_sid('provider:' || slug), provider_name, false, true, now() - interval '180 days'
  from demo_specs
on conflict (id) do update
set full_name = excluded.full_name, role_customer = false, role_provider = true;

insert into public.private_user_accounts (user_id, phone, updated_at)
select pg_temp.demo_sid('provider:' || slug), phone, now()
  from demo_specs
on conflict (user_id) do update set phone = excluded.phone, updated_at = now();

insert into public.providers (
  id, bio, city, service_radius_km, base_location, years_experience, languages, kyc_status, admin_review_status,
  suspended, is_online, rating_avg, rating_count, jobs_completed, commission_tier, razorpay_account_id,
  created_at, timezone, base_area, max_jobs_per_day, paused, onboarding_step, submitted_at,
  terms_version, terms_accepted_at, kyc_updated_at
)
select
  pg_temp.demo_sid('provider:' || s.slug),
  s.provider_bio,
  'Vijayawada Demo',
  25,
  extensions.st_setsrid(extensions.st_makepoint(80.650 + ((row_number() over (order by s.slug)) % 9) * 0.002,
                                               16.500 + ((row_number() over (order by s.slug)) % 7) * 0.002), 4326)::extensions.geography,
  6,
  array['Telugu','English','Hindi'],
  'verified'::public.kyc_status,
  'approved',
  false, true, (4.6 + ((row_number() over (order by s.slug)) % 4) * 0.1)::numeric(3,2),
  40 + ((row_number() over (order by s.slug)) % 80), 60 + ((row_number() over (order by s.slug)) % 180),
  10, 'acc_demo_only_never_payout_' || substr(md5(s.slug), 1, 12),
  now() - interval '180 days', 'Asia/Kolkata', 'Benz Circle', 6, false, 7,
  now() - interval '170 days', 'demo-only-v1', now() - interval '170 days', now() - interval '170 days'
from demo_specs s
on conflict (id) do update
set bio = excluded.bio,
    city = excluded.city,
    service_radius_km = excluded.service_radius_km,
    base_location = excluded.base_location,
    kyc_status = excluded.kyc_status,
    admin_review_status = 'approved',
    suspended = false,
    is_online = true,
    rating_avg = excluded.rating_avg,
    rating_count = excluded.rating_count,
    jobs_completed = excluded.jobs_completed,
    razorpay_account_id = excluded.razorpay_account_id,
    paused = false,
    submitted_at = excluded.submitted_at,
    onboarding_step = 7,
    terms_version = excluded.terms_version,
    terms_accepted_at = excluded.terms_accepted_at;

insert into public.category_cities (category_id, city, live, launched_at)
select c.id, 'Vijayawada Demo', true, now()
  from public.categories c
  join demo_specs s on s.slug = c.slug
on conflict (category_id, city) do update
set live = true, launched_at = excluded.launched_at;

insert into public.provider_services (
  id, provider_id, category_id, skill_level, visit_fee, labour_rate, rate_unit, active,
  attributes, max_travel_km, travel_fee_mode, travel_fee_flat, travel_fee_per_km
)
select
  pg_temp.demo_sid('service:' || s.slug),
  pg_temp.demo_sid('provider:' || s.slug),
  c.id,
  case when c.archetype in ('proposal','time_based') then 'expert'::public.skill_level else 'certified'::public.skill_level end,
  case when c.archetype = 'inspect_quote' then 14900 else 0 end,
  case when c.archetype = 'time_based' then 60000 when c.archetype = 'proposal' then 250000 else 50000 end,
  'job'::public.rate_unit,
  true,
  s.attributes,
  35,
  case when (row_number() over (order by s.slug)) % 2 = 0 then 'flat' else 'per_km' end,
  25000,
  1200
from demo_specs s
join public.categories c on c.slug = s.slug
on conflict (provider_id, category_id) do update
set id = excluded.id,
    skill_level = excluded.skill_level,
    visit_fee = excluded.visit_fee,
    labour_rate = excluded.labour_rate,
    active = true,
    attributes = excluded.attributes,
    max_travel_km = excluded.max_travel_km,
    travel_fee_mode = excluded.travel_fee_mode,
    travel_fee_flat = excluded.travel_fee_flat,
    travel_fee_per_km = excluded.travel_fee_per_km;

insert into public.provider_availability (id, provider_id, weekday, start_time, end_time)
select pg_temp.demo_sid('availability:' || s.slug || ':' || d), pg_temp.demo_sid('provider:' || s.slug), d,
       time '08:00', time '20:00'
  from demo_specs s cross join generate_series(1, 6) d
on conflict (id) do update
set start_time = excluded.start_time, end_time = excluded.end_time;

insert into public.provider_documents (
  id, provider_id, doc_type, category_id, status, expires_on, file_path, reviewed_at, created_at
)
select
  pg_temp.demo_sid('document:' || s.slug || ':' || d.doc_type),
  pg_temp.demo_sid('provider:' || s.slug),
  d.doc_type, c.id, 'approved', current_date + interval '365 days',
  'demo-only/' || s.slug || '/' || d.doc_type || '.pdf', now(), now() - interval '30 days'
from demo_specs s
join public.categories c on c.slug = s.slug
cross join lateral unnest(c.requires_docs) d(doc_type)
on conflict (id) do update
set status = excluded.status, expires_on = excluded.expires_on, reviewed_at = excluded.reviewed_at;

insert into public.provider_payout_accounts (
  provider_id, rail, razorpay_account_id, beneficiary_name, bank_last4, ifsc, email,
  activation_status, requirements, created_at, updated_at
)
select
  pg_temp.demo_sid('provider:' || s.slug),
  'route',
  'acc_demo_only_' || substr(md5(s.slug), 1, 12),
  s.provider_name,
  '4242',
  'HDFC0001234',
  lower(replace(s.slug, '-', '.')) || '@demo.example',
  'active',
  '[]'::jsonb,
  now() - interval '170 days', now()
from demo_specs s
on conflict (provider_id) do update
set activation_status = 'active',
    requirements = '[]'::jsonb,
    razorpay_account_id = excluded.razorpay_account_id,
    updated_at = now();

insert into public.provider_links (
  id, provider_id, kind, url, handle, verified_method, stats, stats_synced_at, status, reviewed_at, created_at
)
select
  pg_temp.demo_sid('social:' || s.slug),
  pg_temp.demo_sid('provider:' || s.slug),
  case when c.vertical = 'creators' then 'instagram' when c.vertical = 'photo-video' then 'instagram' else 'website' end,
  -- Links must match their platform's host (0030); demo handles are clearly synthetic.
  case when c.vertical in ('creators', 'photo-video') then 'https://www.instagram.com/demo_' || replace(s.slug, '-', '_')
       else 'https://demo.example/providers/' || s.slug end,
  'demo_' || replace(s.slug, '-', '_'),
  'manual',
  jsonb_build_object('demo_only', true, 'followers', 12000 + (length(s.slug) * 137)),
  now(), 'approved', now(), now() - interval '90 days'
from demo_specs s
join public.categories c on c.slug = s.slug
on conflict (provider_id, kind) do update
set url = excluded.url, handle = excluded.handle, status = 'approved', stats = excluded.stats;

insert into public.rate_card_items (id, provider_service_id, title, price)
select pg_temp.demo_sid('rate:' || s.slug), pg_temp.demo_sid('service:' || s.slug),
       case when c.archetype = 'time_based' then '60 minute demo session'
            when c.archetype = 'proposal' then 'Custom scope consultation'
            else 'Demo standard service' end,
       case when c.archetype = 'time_based' then 60000 when c.archetype = 'proposal' then 0 else 49900 end
from demo_specs s
join public.categories c on c.slug = s.slug
on conflict (id) do update set title = excluded.title, price = excluded.price;

insert into public.service_packages (
  id, provider_service_id, title, description, price_type, price, price_min, price_max,
  unit, qty_min, qty_max, duration_min, inclusions, exclusions, deliverables,
  turnaround_days, revisions_included, raw_files_included, usage_rights, travel_included_km,
  active, sort_order
)
select
  pg_temp.demo_sid('package:' || s.slug),
  pg_temp.demo_sid('service:' || s.slug),
  case when c.archetype = 'time_based' then 'Demo 60-minute session'
       when s.slug = 'house-cleaning' then 'Demo 2 BHK deep clean'
       else 'Demo ' || c.name || ' package' end,
  '[DEMO ONLY] Production-shaped package for CI browsing and booking; no real service will be delivered.',
  case when c.archetype in ('fixed','time_based') then 'fixed' else 'quote' end,
  case when c.archetype = 'fixed' then 249900 when c.archetype = 'time_based' then 60000 else null end,
  case when c.archetype = 'fixed' then 249900 when c.archetype = 'time_based' then 60000 else null end,
  case when c.archetype = 'fixed' then 249900 when c.archetype = 'time_based' then 60000 else null end,
  case when c.archetype = 'time_based' then 'session'
       when c.archetype = 'proposal' then coalesce((c.pricing_units)[1], 'event')
       else 'job' end,
  1,
  case when c.archetype = 'time_based' then 12 else 1 end,
  case when c.archetype = 'time_based' then 60 when c.archetype = 'fixed' then 180 else null end,
  array['DEMO scope confirmed before payment','Synthetic provider rating and portfolio'],
  array['No real appointment','No real payment or payout'],
  jsonb_build_array(jsonb_build_object(
    'type', case when c.archetype = 'proposal' then 'demo_deliverable' else 'demo_service' end,
    'qty', 1,
    'spec', 'DEMO ONLY. ' || c.name || ' output with fixed test evidence.'
  )),
  case when c.archetype = 'proposal' then 7 else 0 end,
  case when c.archetype = 'proposal' then 2 else 0 end,
  false,
  case when c.vertical = 'creators' then '{"organic_posting":true,"paid_ads_days":0,"exclusivity_days":0}'::jsonb else '{}'::jsonb end,
  25, true, 1
from demo_specs s
join public.categories c on c.slug = s.slug
on conflict (id) do update
set title = excluded.title,
    description = excluded.description,
    price_type = excluded.price_type,
    price = excluded.price,
    price_min = excluded.price_min,
    price_max = excluded.price_max,
    unit = excluded.unit,
    qty_max = excluded.qty_max,
    duration_min = excluded.duration_min,
    deliverables = excluded.deliverables,
    active = true;

-- Founder account reused. A deterministic saved address gives booking UIs a real address_id
-- without changing the production location model.
insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', 'f0000000-5eed-5eed-8000-000000000000',
       'authenticated', 'authenticated', '919999999999', now(),
       '{"provider":"phone","providers":["phone"]}'::jsonb,
       '{"full_name":"QuickServe Founder"}'::jsonb,
       now() - interval '200 days', now()
where not exists (select 1 from auth.users where phone in ('919999999999', '+919999999999'))
on conflict do nothing;

create temp table demo_founder on commit drop as
select id from auth.users
 where phone in ('919999999999', '+919999999999')
 order by created_at limit 1;

insert into public.profiles (id, full_name, role_customer, role_provider)
select id, 'QuickServe Founder', true, true from demo_founder
on conflict (id) do update set role_customer = true;

insert into public.addresses (id, user_id, label, line1, city, lat, lng, is_default, created_at)
select pg_temp.demo_sid('founder:demo-home'), id, 'Demo home',
       'Flat 302, Sai Residency, Benz Circle', 'Vijayawada Demo', 16.4995, 80.656, false, now()
from demo_founder
on conflict (id) do update
set line1 = excluded.line1, city = excluded.city, lat = excluded.lat, lng = excluded.lng, is_default = false;

-- Phase 6 sports and Phase 7a tile marketplace fixtures. Owners are existing synthetic demo
-- providers, so the established demo-user reset cascades these rows without touching real accounts.
do $$
begin
  if to_regclass('public.sports_activities') is not null
     and to_regclass('public.feature_flags') is not null
     and to_regclass('public.sports_venues') is not null
     and to_regclass('public.sports_resources') is not null
     and to_regclass('public.sports_hours') is not null
     and to_regclass('public.sports_price_rules') is not null
     and to_regclass('public.shops') is not null
     and to_regclass('public.shop_categories') is not null
     and to_regclass('public.product_categories') is not null
     and to_regclass('public.products') is not null
     and to_regclass('public.product_enquiries') is not null
     and to_regclass('public.product_enquiry_messages') is not null
     and to_regclass('public.rfqs') is not null then
insert into public.sports_venues (
  id, owner_id, name, description, address_line, city, area, lat, lng, amenities, photos,
  status, status_reason, created_at, updated_at
)
values (
  pg_temp.demo_sid('sports-venue:benz-circle-badminton'),
  pg_temp.demo_sid('provider:plumber'),
  'Benz Circle Demo Badminton Courts',
  '[DEMO ONLY] Synthetic badminton venue for customer discovery and booking-request checks.',
  '12 Demo Sports Lane, Benz Circle',
  'Vijayawada Demo', 'Benz Circle', 16.4997, 80.6562,
  array['Parking', 'Changing rooms'], '{}'::text[],
  'verified', '[DEMO ONLY] Seeded CI venue', now() - interval '30 days', now()
)
on conflict (id) do update
set owner_id = excluded.owner_id,
    name = excluded.name,
    description = excluded.description,
    address_line = excluded.address_line,
    city = excluded.city,
    area = excluded.area,
    lat = excluded.lat,
    lng = excluded.lng,
    amenities = excluded.amenities,
    photos = excluded.photos,
    status = 'verified',
    status_reason = excluded.status_reason,
    updated_at = now();

insert into public.sports_resources (id, venue_id, activity_id, name, slot_minutes, active)
select pg_temp.demo_sid('sports-resource:benz-circle-court-1'),
       pg_temp.demo_sid('sports-venue:benz-circle-badminton'),
       a.id, 'Demo Court 1', 60, true
  from public.sports_activities a
 where a.slug = 'badminton'
on conflict (id) do update
set venue_id = excluded.venue_id,
    activity_id = excluded.activity_id,
    name = excluded.name,
    slot_minutes = excluded.slot_minutes,
    active = true;

insert into public.sports_hours (venue_id, weekday, opens, closes)
select pg_temp.demo_sid('sports-venue:benz-circle-badminton'), d, time '06:00', time '22:00'
  from generate_series(0, 6) d
on conflict (venue_id, weekday) do update
set opens = excluded.opens, closes = excluded.closes;

insert into public.sports_price_rules (id, resource_id, weekday, starts, ends, price_paise, label)
values (
  pg_temp.demo_sid('sports-price:benz-circle-court-1'),
  pg_temp.demo_sid('sports-resource:benz-circle-court-1'),
  null, time '06:00', time '22:00', 30000, 'DEMO standard hourly rate'
)
on conflict (id) do update
set resource_id = excluded.resource_id,
    weekday = excluded.weekday,
    starts = excluded.starts,
    ends = excluded.ends,
    price_paise = excluded.price_paise,
    label = excluded.label;

insert into public.shops (
  id, owner_id, name, description, address_line, city, area, lat, lng,
  delivery_radius_km, offers_delivery, offers_pickup, whatsapp_contact, status, status_reason,
  created_at, updated_at
)
values
  (
    pg_temp.demo_sid('shop:benz-circle-tile-house'),
    pg_temp.demo_sid('provider:carpenter'),
    'Benz Circle Demo Tile House',
    '[DEMO ONLY] Synthetic local tile catalogue for browsing and supplier quote requests.',
    '18 Demo Market Road, Benz Circle', 'Vijayawada Demo', 'Benz Circle', 16.4998, 80.6560,
    25, true, true, false, 'verified', '[DEMO ONLY] Seeded CI shop', now() - interval '30 days', now()
  ),
  (
    pg_temp.demo_sid('shop:labbipet-tile-mart'),
    pg_temp.demo_sid('provider:painter'),
    'Labbipet Demo Tile Mart',
    '[DEMO ONLY] Synthetic neighbourhood tile supplier for multi-shop RFQ routing.',
    '7 Demo Plaza, Labbipet', 'Vijayawada Demo', 'Labbipet', 16.5020, 80.6530,
    25, true, true, false, 'verified', '[DEMO ONLY] Seeded CI shop', now() - interval '30 days', now()
  )
on conflict (id) do update
set owner_id = excluded.owner_id,
    name = excluded.name,
    description = excluded.description,
    address_line = excluded.address_line,
    city = excluded.city,
    area = excluded.area,
    lat = excluded.lat,
    lng = excluded.lng,
    delivery_radius_km = excluded.delivery_radius_km,
    offers_delivery = excluded.offers_delivery,
    offers_pickup = excluded.offers_pickup,
    whatsapp_contact = excluded.whatsapp_contact,
    status = 'verified',
    status_reason = excluded.status_reason,
    updated_at = now();

insert into public.shop_categories (shop_id, category_id)
select s.id, c.id
  from (values
    (pg_temp.demo_sid('shop:benz-circle-tile-house')),
    (pg_temp.demo_sid('shop:labbipet-tile-mart'))
  ) s(id)
  join public.product_categories c on c.slug = 'tiles'
on conflict (shop_id, category_id) do nothing;

insert into public.products (
  id, shop_id, category_id, name, brand, model, description, specs, unit,
  indicative_price_paise, price_updated_at, in_stock, active, updated_at
)
select
  f.id, f.shop_id, c.id, f.name, f.brand, f.model, f.description, f.specs::jsonb, 'sqft',
  f.price_paise, now(), true, true, now()
  from (values
    (
      pg_temp.demo_sid('product:demo-anti-skid-floor-tile'),
      pg_temp.demo_sid('shop:benz-circle-tile-house'),
      'Demo Sandstone Anti-Skid Floor Tile',
      'Demo Ceramics', 'QS-SAND-600',
      '[DEMO ONLY] Synthetic 600 mm anti-skid floor tile; no real stock or sale.',
      '{"size":"600x600 mm","finish":"matte anti-skid","material":"ceramic"}',
      85000
    ),
    (
      pg_temp.demo_sid('product:demo-ivory-wall-tile'),
      pg_temp.demo_sid('shop:labbipet-tile-mart'),
      'Demo Ivory Ceramic Wall Tile',
      'Demo Surfaces', 'QS-IVORY-300',
      '[DEMO ONLY] Synthetic ivory wall tile; no real stock or sale.',
      '{"size":"300x600 mm","finish":"gloss","material":"ceramic"}',
      72000
    )
  ) f(id, shop_id, name, brand, model, description, specs, price_paise)
  join public.product_categories c on c.slug = 'tiles'
on conflict (id) do update
set shop_id = excluded.shop_id,
    category_id = excluded.category_id,
    name = excluded.name,
    brand = excluded.brand,
    model = excluded.model,
    description = excluded.description,
    specs = excluded.specs,
    unit = excluded.unit,
    indicative_price_paise = excluded.indicative_price_paise,
    price_updated_at = now(),
    in_stock = true,
    active = true,
    updated_at = now();
  else
    raise notice 'Phase 6/7a demo fixtures skipped; apply migrations 0048-0050 before marketplace E2E.';
  end if;
end;
$$;

-- Proposal paths for every creator/event category. Participant RLS exposes these only to the founder.
insert into public.service_requests (
  id, customer_id, category_id, city, area, event_start, event_end, intake,
  budget_min, budget_max, status, expires_at, created_at, updated_at
)
select
  pg_temp.demo_sid('request:' || s.slug),
  f.id, c.id, 'Vijayawada Demo', 'Benz Circle',
  now() + interval '35 days', now() + interval '35 days 6 hours',
  jsonb_build_object('demo_only', 'true', 'notes', '[DEMO ONLY] Compare scoped proposals without real bookings.'),
  100000, 400000, case when s.slug = 'wedding-photographer' then 'closed' else 'open' end,
  now() + interval '14 days', now() - interval '2 days', now()
from demo_specs s
join public.categories c on c.slug = s.slug
cross join demo_founder f
where c.archetype = 'proposal'
on conflict (id) do update
set status = excluded.status, expires_at = excluded.expires_at, updated_at = now();

insert into public.request_private (request_id, address_id, venue_text, contact_name, lat, lng)
select pg_temp.demo_sid('request:' || s.slug), pg_temp.demo_sid('founder:demo-home'),
       'DEMO venue at Benz Circle, Vijayawada', 'QuickServe Founder', 16.4995, 80.656
from demo_specs s
join public.categories c on c.slug = s.slug
where c.archetype = 'proposal'
on conflict (request_id) do update
set venue_text = excluded.venue_text, lat = excluded.lat, lng = excluded.lng;

insert into public.request_recipients (request_id, provider_id, provider_service_id, routed_at)
select pg_temp.demo_sid('request:' || s.slug), pg_temp.demo_sid('provider:' || s.slug),
       pg_temp.demo_sid('service:' || s.slug), now() - interval '1 day'
from demo_specs s
join public.categories c on c.slug = s.slug
where c.archetype = 'proposal'
on conflict (request_id, provider_id) do nothing;

insert into public.proposals (
  id, request_id, provider_id, provider_service_id, version, status, total, valid_until, note,
  deliverables, pricing_snapshot, payment_snapshot, cancellation_snapshot, created_at, updated_at
)
select
  pg_temp.demo_sid('proposal:' || s.slug),
  pg_temp.demo_sid('request:' || s.slug),
  pg_temp.demo_sid('provider:' || s.slug),
  pg_temp.demo_sid('service:' || s.slug),
  1,
  case when s.slug = 'wedding-photographer' then 'accepted' else 'sent' end,
  250000,
  now() + interval '7 days',
  '[DEMO ONLY] Fixed test scope, deliverables and payment milestones. No real service or charge.',
  jsonb_build_array(jsonb_build_object('type', 'demo_deliverable', 'qty', 1, 'spec', 'Synthetic final output for ' || c.name)),
  jsonb_build_object('currency','INR','demo_only',true,'archetype','proposal'),
  jsonb_build_object('template','event_standard','platform_fee_paise',9900,'demo_only',true),
  jsonb_build_object('key','event_moderate','demo_only',true),
  now() - interval '18 hours', now()
from demo_specs s
join public.categories c on c.slug = s.slug
where c.archetype = 'proposal'
on conflict (request_id, provider_id, version) do update
set status = excluded.status,
    total = excluded.total,
    valid_until = excluded.valid_until,
    note = excluded.note,
    deliverables = excluded.deliverables,
    updated_at = now();

insert into public.proposal_items (
  id, proposal_id, seq, kind, title, qty, unit, unit_price, metadata
)
select pg_temp.demo_sid('proposal-item:' || s.slug), pg_temp.demo_sid('proposal:' || s.slug),
       1, 'package'::public.quote_item_kind, '[DEMO ONLY] ' || c.name || ' scope',
       1, coalesce((c.pricing_units)[1], 'event'), 250000,
       '{"demo_only":true}'::jsonb
from demo_specs s
join public.categories c on c.slug = s.slug
where c.archetype = 'proposal'
on conflict (proposal_id, seq) do update
set title = excluded.title, unit_price = excluded.unit_price, metadata = excluded.metadata;

insert into public.proposal_schedule (id, proposal_id, seq, label, amount, due_rule, due_at)
select pg_temp.demo_sid('proposal-schedule:' || s.slug || ':' || p.seq),
       pg_temp.demo_sid('proposal:' || s.slug), p.seq, p.label, p.amount, p.due_rule,
       case when p.seq = 1 then now() else now() + interval '28 days' end
from demo_specs s
join public.categories c on c.slug = s.slug
cross join lateral (values
  (1, 'Demo booking advance', 75000, 'at_booking'),
  (2, 'Demo delivery milestone', 175000, 'on_delivery')
) p(seq, label, amount, due_rule)
where c.archetype = 'proposal'
on conflict (proposal_id, seq) do update
set amount = excluded.amount, due_at = excluded.due_at;

-- Four production-shaped review paths: inspect_quote, fixed, proposal and time_based (when 0022 lands).
create temp table demo_review_specs (key text, slug text, status public.booking_status, archetype text, comment text) on commit drop;
insert into demo_review_specs values
  ('inspect-review', 'ac-repair', 'closed', 'inspect_quote', 'DEMO: explained the diagnosis and showed the synthetic part bill.'),
  ('fixed-review', 'house-cleaning', 'closed', 'fixed', 'DEMO: supplies, scope and fixed-package duration matched the brief.'),
  ('proposal-review', 'wedding-photographer', 'closed', 'proposal', 'DEMO: deliverables and milestones were shown clearly before acceptance.');

-- Historical rows intentionally predate current lead-time gates, and proposal history belongs to an
-- inactive global category. Bypass the insert-time eligibility trigger only inside this transaction;
-- all immutable snapshot/update triggers stay enabled and the eligibility trigger is restored below.
alter table public.bookings disable trigger bookings_apply_core_contract;
insert into public.bookings (
  id, customer_id, provider_id, category_id, provider_service_id, address_id, description,
  scheduled_at, status, visit_fee, platform_fee, approved_quote_id, total_amount,
  refund_amount, archetype, category_config_version, location_mode, pricing_snapshot, payment_template_snapshot,
  cancellation_snapshot, platform_fee_rule_snapshot, created_at, updated_at, accepted_at, completed_at,
  delivery_status, delivery_snapshot, delivery_accepted_at
)
select
  pg_temp.demo_sid('booking:' || r.key), f.id, pg_temp.demo_sid('provider:' || r.slug), c.id,
  pg_temp.demo_sid('service:' || r.slug), pg_temp.demo_sid('founder:demo-home'),
  '[DEMO ONLY] Historical ' || c.name || ' review fixture.',
  now() - interval '10 days', r.status, case when r.archetype = 'inspect_quote' then 14900 else 0 end,
  2900, null, 250000, 0, r.archetype, c.config_version, c.location_modes[1],
  jsonb_build_object('demo_only',true,'archetype',r.archetype),
  jsonb_build_object('demo_only',true),
  jsonb_build_object('demo_only',true),
  jsonb_build_object('demo_only',true,'amount',2900),
  now() - interval '20 days', now() - interval '9 days', now() - interval '19 days', now() - interval '9 days',
  case when r.archetype = 'proposal' then 'accepted' else 'not_applicable' end,
  case when r.archetype = 'proposal' then '[{"type":"demo_deliverable","qty":1,"spec":"Accepted synthetic output"}]'::jsonb else '[]'::jsonb end,
  case when r.archetype = 'proposal' then now() - interval '10 days' else null end
from demo_review_specs r
join public.categories c on c.slug = r.slug
cross join demo_founder f
on conflict (id) do update
set status = excluded.status, description = excluded.description, completed_at = excluded.completed_at;
alter table public.bookings enable trigger bookings_apply_core_contract;

insert into public.booking_secrets (booking_id, start_otp, end_otp)
select pg_temp.demo_sid('booking:' || key), '4242', '2424'
  from demo_review_specs
on conflict (booking_id) do update set start_otp = excluded.start_otp, end_otp = excluded.end_otp;

insert into public.reviews (
  id, booking_id, customer_id, provider_id, rating, punctuality, quality, behaviour, pricing, comment, created_at
)
select
  pg_temp.demo_sid('review:' || r.key), pg_temp.demo_sid('booking:' || r.key), f.id,
  pg_temp.demo_sid('provider:' || r.slug), 5, 5, 5, 5, 5, r.comment, now() - interval '8 days'
from demo_review_specs r
cross join demo_founder f
on conflict (booking_id) do update
set comment = excluded.comment, created_at = excluded.created_at;

-- ---------------------------------------------------------------------------------------------
-- Review-aware matching demo (AI assistant + match_providers). AC Repair, Plumber and Bridal
-- Makeup each get competing providers whose reviews prove DIFFERENT strengths, so asking for
-- e.g. "explains clearly" vs "quick diagnosis" vs "clean work" ranks a different pro first and
-- shows that pro's review quotes. Reviews come from synthetic demo customers (not the founder),
-- and insights are pre-extracted (insights_processed_at set) so the AI worker never rewrites them.
-- An aspect counts as proven at >= 3 positive reviews and positive >= 3 x negative (0013).
-- ---------------------------------------------------------------------------------------------
create temp table demo_match_extras (key text, slug text, provider_name text, provider_bio text, phone text, attributes jsonb, visit_fee int) on commit drop;
insert into demo_match_extras values
  ('ac-repair-kiran', 'ac-repair', 'Kiran Demo Cool Tech', '[DEMO ONLY] Inverter and PCB fault specialist; fast diagnosis.', '919000004132', '{"equipment":["inverter","cassette"],"expertise":["pcb_repair","installation"]}', 19900),
  ('ac-repair-mahesh', 'ac-repair', 'Mahesh Demo AC Care', '[DEMO ONLY] Deep-service and gas-refill team; covers furniture before work.', '919000004133', '{"equipment":["split","window"],"expertise":["deep_service","gas_refill"]}', 9900),
  ('plumber-venkat', 'plumber', 'Venkat Demo Pipes', '[DEMO ONLY] Fully stocked van; motor and bathroom fittings.', '919000004134', '{"expertise":["leaks","motor","bathroom"]}', 12900),
  ('bridal-makeup-meera', 'bridal-makeup', 'Meera Demo Glam', '[DEMO ONLY] Long-wear bridal looks with a sanitised kit.', '919000004135', '{"skin_types_expert":["dry","combination","mature"],"techniques":["hd","airbrush"]}', 0);

create temp table demo_match_customers (key text, full_name text, phone text) on commit drop;
insert into demo_match_customers values
  ('1', 'Demo Customer Anil', '919000004201'),
  ('2', 'Demo Customer Bhavana', '919000004202'),
  ('3', 'Demo Customer Chaitanya', '919000004203'),
  ('4', 'Demo Customer Deepika', '919000004204');

insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000'::uuid, pg_temp.demo_sid('provider:' || e.key), 'authenticated', 'authenticated', e.phone, now(),
       '{"provider":"phone","providers":["phone"],"demo_only":"true"}'::jsonb,
       jsonb_build_object('full_name', e.provider_name, 'demo_only', 'true'), now() - interval '180 days', now()
  from demo_match_extras e
union all
select '00000000-0000-0000-0000-000000000000'::uuid, pg_temp.demo_sid('match-customer:' || m.key), 'authenticated', 'authenticated', m.phone, now(),
       '{"provider":"phone","providers":["phone"],"demo_only":"true"}'::jsonb,
       jsonb_build_object('full_name', m.full_name, 'demo_only', 'true'), now() - interval '120 days', now()
  from demo_match_customers m
on conflict (id) do update
set phone = excluded.phone, raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data, updated_at = now();

insert into public.profiles (id, full_name, role_customer, role_provider, created_at)
select pg_temp.demo_sid('provider:' || key), provider_name, false, true, now() - interval '180 days' from demo_match_extras
union all
select pg_temp.demo_sid('match-customer:' || key), full_name, true, false, now() - interval '120 days' from demo_match_customers
on conflict (id) do update
set full_name = excluded.full_name, role_customer = excluded.role_customer, role_provider = excluded.role_provider;

insert into public.private_user_accounts (user_id, phone, updated_at)
select pg_temp.demo_sid('provider:' || key), phone, now() from demo_match_extras
union all
select pg_temp.demo_sid('match-customer:' || key), phone, now() from demo_match_customers
on conflict (user_id) do update set phone = excluded.phone, updated_at = now();

insert into public.addresses (id, user_id, label, line1, city, lat, lng, is_default, created_at)
select pg_temp.demo_sid('match-customer-home:' || key), pg_temp.demo_sid('match-customer:' || key), 'Home',
       '[DEMO ONLY] ' || key || '-12, Labbipet', 'Vijayawada Demo', 16.503, 80.645, true, now() - interval '120 days'
  from demo_match_customers
on conflict (id) do update set line1 = excluded.line1, city = excluded.city, lat = excluded.lat, lng = excluded.lng;

insert into public.providers (
  id, bio, city, service_radius_km, base_location, years_experience, languages, kyc_status, admin_review_status,
  suspended, is_online, rating_avg, rating_count, jobs_completed, commission_tier, razorpay_account_id,
  created_at, timezone, base_area, max_jobs_per_day, paused, onboarding_step, submitted_at,
  terms_version, terms_accepted_at, kyc_updated_at
)
select
  pg_temp.demo_sid('provider:' || e.key), e.provider_bio, 'Vijayawada Demo', 25,
  extensions.st_setsrid(extensions.st_makepoint(80.648 + (row_number() over (order by e.key)) * 0.003,
                                               16.503 + (row_number() over (order by e.key)) * 0.002), 4326)::extensions.geography,
  5, array['Telugu','English'], 'verified'::public.kyc_status, 'approved', false, true, 0, 0, 30, 10,
  'acc_demo_only_never_payout_' || substr(md5(e.key), 1, 12),
  now() - interval '180 days', 'Asia/Kolkata', 'Labbipet', 6, false, 7,
  now() - interval '170 days', 'demo-only-v1', now() - interval '170 days', now() - interval '170 days'
from demo_match_extras e
on conflict (id) do update
set bio = excluded.bio, city = excluded.city, base_location = excluded.base_location, kyc_status = excluded.kyc_status,
    admin_review_status = 'approved',
    suspended = false, is_online = true, paused = false, submitted_at = excluded.submitted_at, onboarding_step = 7;

-- Same service shape as the category's primary demo provider; only attributes and visit fee differ.
insert into public.provider_services (
  id, provider_id, category_id, skill_level, visit_fee, labour_rate, rate_unit, active,
  attributes, max_travel_km, travel_fee_mode, travel_fee_flat, travel_fee_per_km
)
select pg_temp.demo_sid('service:' || e.key), pg_temp.demo_sid('provider:' || e.key), ps.category_id, ps.skill_level,
       case when ps.visit_fee > 0 then e.visit_fee else 0 end, ps.labour_rate, ps.rate_unit, true,
       e.attributes, ps.max_travel_km, ps.travel_fee_mode, ps.travel_fee_flat, ps.travel_fee_per_km
  from demo_match_extras e
  join public.provider_services ps on ps.id = pg_temp.demo_sid('service:' || e.slug)
on conflict (provider_id, category_id) do update
set id = excluded.id, visit_fee = excluded.visit_fee, active = true, attributes = excluded.attributes;

insert into public.provider_availability (id, provider_id, weekday, start_time, end_time)
select pg_temp.demo_sid('availability:' || e.key || ':' || d), pg_temp.demo_sid('provider:' || e.key), d, time '08:00', time '20:00'
  from demo_match_extras e cross join generate_series(1, 6) d
on conflict (id) do update set start_time = excluded.start_time, end_time = excluded.end_time;

insert into public.provider_documents (id, provider_id, doc_type, category_id, status, expires_on, file_path, reviewed_at, created_at)
select pg_temp.demo_sid('document:' || e.key || ':' || d.doc_type), pg_temp.demo_sid('provider:' || e.key),
       d.doc_type, c.id, 'approved', current_date + interval '365 days',
       'demo-only/' || e.key || '/' || d.doc_type || '.pdf', now(), now() - interval '30 days'
  from demo_match_extras e
  join public.categories c on c.slug = e.slug
  cross join lateral unnest(c.requires_docs) d(doc_type)
on conflict (id) do update set status = excluded.status, expires_on = excluded.expires_on, reviewed_at = excluded.reviewed_at;

insert into public.provider_payout_accounts (
  provider_id, rail, razorpay_account_id, beneficiary_name, bank_last4, ifsc, email,
  activation_status, requirements, created_at, updated_at
)
select pg_temp.demo_sid('provider:' || e.key), 'route', 'acc_demo_only_' || substr(md5(e.key), 1, 12), e.provider_name,
       '4242', 'HDFC0001234', replace(e.key, '-', '.') || '@demo.example', 'active', '[]'::jsonb, now() - interval '170 days', now()
  from demo_match_extras e
on conflict (provider_id) do update set activation_status = 'active', requirements = '[]'::jsonb, updated_at = now();

-- provider key (primary demo provider = category slug), review #, rating, comment, extracted insights.
create temp table demo_match_reviews (provider_key text, n int, rating int, comment text, insights jsonb) on commit drop;
insert into demo_match_reviews values
  ('ac-repair', 1, 5, 'Ravi explained the gas leak clearly and showed me the old part.', '[["explained_well","positive","Explained the gas leak clearly and showed the old part"],["clean_work","positive","Cleaned up the balcony after the job"]]'),
  ('ac-repair', 2, 5, 'Every charge was explained before he started. Very neat.', '[["explained_well","positive","Every charge was explained before he started"],["clean_work","positive","Very neat work"]]'),
  ('ac-repair', 3, 4, 'Good explanation of why the inverter AC tripped, but finding the fault took long.', '[["explained_well","positive","Good explanation of why the inverter AC tripped"],["quick_diagnosis","negative",null]]'),
  ('ac-repair', 4, 5, 'Walked me through the service checklist step by step.', '[["explained_well","positive","Walked me through the service checklist step by step"]]'),
  ('ac-repair', 5, 4, 'Explains everything patiently, though diagnosis needed a second visit.', '[["explained_well","positive","Explains everything patiently"],["quick_diagnosis","negative",null]]'),
  ('ac-repair-kiran', 1, 5, 'Found the PCB fault in ten minutes flat.', '[["quick_diagnosis","positive","Found the PCB fault in ten minutes"],["long_lasting","positive","Cooling has been perfect since"]]'),
  ('ac-repair-kiran', 2, 5, 'Diagnosed the cooling problem straight away; still ice cold two months later.', '[["quick_diagnosis","positive","Diagnosed the cooling problem straight away"],["long_lasting","positive","Still ice cold two months later"]]'),
  ('ac-repair-kiran', 3, 5, 'Fast diagnosis and fixed the same afternoon.', '[["quick_diagnosis","positive","Fast diagnosis and fixed the same afternoon"]]'),
  ('ac-repair-kiran', 4, 4, 'Quick fix that has lasted, but left some dust behind.', '[["quick_diagnosis","positive","Quick fix"],["long_lasting","positive","The repair has lasted"],["clean_work","negative",null]]'),
  ('ac-repair-mahesh', 1, 5, 'Spotless deep service, covered all the furniture first.', '[["clean_work","positive","Spotless deep service, covered all the furniture"],["long_lasting","positive","AC runs like new"]]'),
  ('ac-repair-mahesh', 2, 5, 'Very clean work and the AC has been perfect since.', '[["clean_work","positive","Very clean work"],["long_lasting","positive","The AC has been perfect since"]]'),
  ('ac-repair-mahesh', 3, 4, 'Clean job and still cooling well, but he did not explain what was replaced.', '[["clean_work","positive","Clean job"],["long_lasting","positive","Still cooling well"],["explained_well","negative",null]]'),
  ('ac-repair-mahesh', 4, 4, 'Neat work. The bill was not explained.', '[["clean_work","positive","Neat work"],["explained_well","negative",null]]'),
  ('plumber', 1, 5, 'Leak under the kitchen sink fixed for good.', '[["leak_fixed","positive","Leak under the kitchen sink fixed for good"]]'),
  ('plumber', 2, 5, 'Found the hidden leak behind the tiles and explained the repair.', '[["leak_fixed","positive","Found the hidden leak behind the tiles"],["explained_well","positive","Explained the repair"]]'),
  ('plumber', 3, 4, 'Leak fixed, but he had to go out to buy a part.', '[["leak_fixed","positive","Leak fixed"],["came_prepared","negative",null]]'),
  ('plumber', 4, 4, 'Bathroom leak sorted; came without the right tools at first.', '[["leak_fixed","positive","Bathroom leak sorted"],["came_prepared","negative",null]]'),
  ('plumber-venkat', 1, 5, 'Brought every fitting needed and finished in one visit.', '[["came_prepared","positive","Brought every fitting needed, finished in one visit"],["clean_work","positive","Left no mess"]]'),
  ('plumber-venkat', 2, 5, 'Came prepared with spare taps and left the bathroom clean.', '[["came_prepared","positive","Came prepared with spare taps"],["clean_work","positive","Left the bathroom clean"]]'),
  ('plumber-venkat', 3, 5, 'Had all the parts in his van. Tidy work.', '[["came_prepared","positive","Had all the parts in his van"],["clean_work","positive","Tidy work"]]'),
  ('plumber-venkat', 4, 4, 'Prepared and tidy, but the leak came back after a week.', '[["came_prepared","positive","Prepared and tidy"],["leak_fixed","negative",null]]'),
  ('bridal-makeup', 1, 5, 'Natural look that still photographed beautifully.', '[["natural_look","positive","Natural look that photographed beautifully"],["beautiful_finishing","positive","Flawless finishing"]]'),
  ('bridal-makeup', 2, 5, 'My oily skin stayed matte all evening.', '[["oily_skin","positive","My oily skin stayed matte all evening"],["natural_look","positive","Looked like me, only better"]]'),
  ('bridal-makeup', 3, 5, 'Soft natural makeup and she handled my oily T-zone well.', '[["natural_look","positive","Soft natural makeup"],["oily_skin","positive","Handled my oily T-zone well"]]'),
  ('bridal-makeup', 4, 4, 'Lovely natural finish and great oily-skin prep. Arrived 30 minutes late.', '[["natural_look","positive","Lovely natural finish"],["oily_skin","positive","Great oily-skin prep"],["punctual","negative",null]]'),
  ('bridal-makeup-meera', 1, 5, 'Makeup lasted from muhurtham to reception, and she was on time.', '[["long_lasting","positive","Lasted from muhurtham to reception"],["punctual","positive","Was on time"]]'),
  ('bridal-makeup-meera', 2, 5, 'Fresh brushes for everyone; makeup stayed perfect for 12 hours.', '[["hygiene","positive","Fresh brushes for everyone"],["long_lasting","positive","Stayed perfect for 12 hours"]]'),
  ('bridal-makeup-meera', 3, 5, 'On time at 4am with a very hygienic kit. Lasted all day.', '[["punctual","positive","On time at 4am"],["hygiene","positive","Very hygienic kit"],["long_lasting","positive","Lasted all day"]]'),
  ('bridal-makeup-meera', 4, 4, 'Long-lasting, clean kit and punctual, but the look was a bit heavy.', '[["long_lasting","positive","Long-lasting"],["hygiene","positive","Clean kit"],["punctual","positive","Punctual"],["natural_look","negative",null]]');

create temp table demo_match_rows on commit drop as
select r.*, coalesce(e.slug, r.provider_key) as slug,
       pg_temp.demo_sid('match-booking:' || r.provider_key || ':' || r.n) as booking_id,
       pg_temp.demo_sid('match-review:' || r.provider_key || ':' || r.n) as review_id,
       pg_temp.demo_sid('match-customer:' || (((r.n - 1) % 4) + 1)) as customer_id,
       pg_temp.demo_sid('match-customer-home:' || (((r.n - 1) % 4) + 1)) as address_id,
       now() - make_interval(days => 12 + r.n * 6) as done_at
  from demo_match_reviews r
  left join demo_match_extras e on e.key = r.provider_key;

alter table public.bookings disable trigger bookings_apply_core_contract;
insert into public.bookings (
  id, customer_id, provider_id, category_id, provider_service_id, address_id, description,
  scheduled_at, status, visit_fee, platform_fee, approved_quote_id, total_amount,
  refund_amount, archetype, category_config_version, location_mode, pricing_snapshot, payment_template_snapshot,
  cancellation_snapshot, platform_fee_rule_snapshot, created_at, updated_at, accepted_at, completed_at,
  delivery_status, delivery_snapshot, delivery_accepted_at
)
select
  m.booking_id, m.customer_id, pg_temp.demo_sid('provider:' || m.provider_key), c.id,
  pg_temp.demo_sid('service:' || m.provider_key), m.address_id,
  '[DEMO ONLY] Past ' || c.name || ' job behind a matching-demo review.',
  m.done_at, 'closed', case when c.archetype = 'inspect_quote' then ps.visit_fee else 0 end,
  2900, null, 250000, 0, c.archetype, c.config_version, c.location_modes[1],
  jsonb_build_object('demo_only', true, 'archetype', c.archetype),
  jsonb_build_object('demo_only', true),
  jsonb_build_object('demo_only', true),
  jsonb_build_object('demo_only', true, 'amount', 2900),
  m.done_at - interval '2 days', m.done_at, m.done_at - interval '1 day', m.done_at,
  case when c.archetype = 'proposal' then 'accepted' else 'not_applicable' end,
  case when c.archetype = 'proposal' then '[{"type":"demo_deliverable","qty":1,"spec":"Accepted synthetic output"}]'::jsonb else '[]'::jsonb end,
  case when c.archetype = 'proposal' then m.done_at else null end
from demo_match_rows m
join public.categories c on c.slug = m.slug
join public.provider_services ps on ps.id = pg_temp.demo_sid('service:' || m.provider_key)
on conflict (id) do update
set status = excluded.status, description = excluded.description, completed_at = excluded.completed_at;
alter table public.bookings enable trigger bookings_apply_core_contract;

insert into public.reviews (
  id, booking_id, customer_id, provider_id, rating, punctuality, quality, behaviour, pricing, comment, tags,
  insights_processed_at, created_at
)
select m.review_id, m.booking_id, m.customer_id, pg_temp.demo_sid('provider:' || m.provider_key),
       m.rating, m.rating, m.rating, 5, m.rating, '[DEMO] ' || m.comment,
       array(select i ->> 0 from jsonb_array_elements(m.insights) i where i ->> 1 = 'positive' limit 5),
       m.done_at + interval '1 day', m.done_at + interval '1 day'
  from demo_match_rows m
on conflict (booking_id) do update
set rating = excluded.rating, comment = excluded.comment, tags = excluded.tags,
    insights_processed_at = excluded.insights_processed_at, created_at = excluded.created_at;

insert into public.review_insights (review_id, provider_service_id, aspect, sentiment, quote, model, policy_version, created_at)
select m.review_id, pg_temp.demo_sid('service:' || m.provider_key), i ->> 0, i ->> 1, i ->> 2,
       'demo-seed', 'demo-seed-v1', m.done_at + interval '1 day'
  from demo_match_rows m
  cross join lateral jsonb_array_elements(m.insights) i
on conflict (review_id, aspect) do update
set sentiment = excluded.sentiment, quote = excluded.quote, provider_service_id = excluded.provider_service_id;

-- Upserts above bypass the after-insert rating trigger on reloads; keep ratings equal to the real reviews.
update public.providers p
   set rating_avg = s.avg_rating, rating_count = s.cnt
  from (select r.provider_id, round(avg(r.rating)::numeric, 2) as avg_rating, count(*)::int as cnt
          from public.reviews r
         where r.provider_id in (select distinct pg_temp.demo_sid('provider:' || provider_key) from demo_match_reviews)
         group by r.provider_id) s
 where p.id = s.provider_id;

-- Inspect→quote customer path: quote already sent; founder can inspect an itemised estimate.
insert into public.bookings (
  id, customer_id, provider_id, category_id, provider_service_id, address_id, description,
  scheduled_at, status, visit_fee, platform_fee, total_amount, refund_amount,
  archetype, category_config_version, pricing_snapshot, payment_template_snapshot,
  cancellation_snapshot, platform_fee_rule_snapshot, created_at, updated_at, accepted_at
)
select
  pg_temp.demo_sid('booking:inspect-quote'), f.id, pg_temp.demo_sid('provider:ac-repair'), c.id,
  pg_temp.demo_sid('service:ac-repair'), pg_temp.demo_sid('founder:demo-home'),
  '[DEMO ONLY] Split AC is cooling weakly; inspect capacitor and gas pressure.',
  now() + interval '2 hours', 'quote_sent', 14900, 2900, 184900, 0,
  'inspect_quote', c.config_version,
  '{"visit_fee_paise":14900,"demo_only":true}'::jsonb,
  '{"key":"visit_then_balance","demo_only":true}'::jsonb,
  '{"key":"standard_visit","demo_only":true}'::jsonb,
  '{"key":"standard","demo_only":true}'::jsonb,
  now() - interval '30 minutes', now(), now() - interval '20 minutes'
from public.categories c cross join demo_founder f
where c.slug = 'ac-repair'
on conflict (id) do update
set status = excluded.status, total_amount = excluded.total_amount, description = excluded.description;

insert into public.booking_secrets (booking_id, start_otp)
values (pg_temp.demo_sid('booking:inspect-quote'), '4242')
on conflict (booking_id) do update set start_otp = excluded.start_otp;

insert into public.quotes (
  id, booking_id, version, status, is_change_order, subtotal_labour, subtotal_parts, subtotal_other,
  total, note, created_at
)
values (
  pg_temp.demo_sid('quote:inspect-quote'), pg_temp.demo_sid('booking:inspect-quote'), 1, 'sent', false,
  90000, 65000, 30000, 185000, '[DEMO ONLY] Synthetic itemised quote; no real Razorpay charge.', now()
)
on conflict (booking_id, version) do update
set subtotal_labour = excluded.subtotal_labour, subtotal_parts = excluded.subtotal_parts,
    subtotal_other = excluded.subtotal_other, total = excluded.total, note = excluded.note;

insert into public.quote_items (id, quote_id, kind, title, qty, unit_price)
values
  (pg_temp.demo_sid('quote-item:inspect-quote:labour'), pg_temp.demo_sid('quote:inspect-quote'), 'labour', 'AC diagnosis and repair labour', 1, 90000),
  (pg_temp.demo_sid('quote-item:inspect-quote:part'), pg_temp.demo_sid('quote:inspect-quote'), 'part', 'Synthetic capacitor', 1, 65000),
  (pg_temp.demo_sid('quote-item:inspect-quote:other'), pg_temp.demo_sid('quote:inspect-quote'), 'other', 'Protective cleaning consumables', 1, 30000)
on conflict (id) do update set title = excluded.title, unit_price = excluded.unit_price;

-- Fixed package path: seeded booking plus immutable package quote. The next UI payment is mocked by
-- EXPO_PUBLIC_DEMO_PAYMENT=1 and never calls Razorpay.
insert into public.bookings (
  id, customer_id, provider_id, category_id, provider_service_id, address_id, description,
  scheduled_at, service_window, status, visit_fee, platform_fee, total_amount, refund_amount,
  archetype, category_config_version, pricing_snapshot, payment_template_snapshot,
  cancellation_snapshot, platform_fee_rule_snapshot, created_at, updated_at
)
select
  pg_temp.demo_sid('booking:fixed-package'), f.id, pg_temp.demo_sid('provider:house-cleaning'), c.id,
  pg_temp.demo_sid('service:house-cleaning'), pg_temp.demo_sid('founder:demo-home'),
  '[DEMO ONLY] 2 BHK fixed package.', now() + interval '5 days',
  tstzrange(now() + interval '5 days', now() + interval '5 days 3 hours', '[)'),
  'pending_payment', 0, 2900, 252800, 0, 'fixed', c.config_version,
  '{"quantity":1,"unit":"job","price_paise":249900,"demo_only":true}'::jsonb,
  '{"template":"full_upfront","demo_only":true}'::jsonb,
  '{"key":"fixed_flexible","demo_only":true}'::jsonb,
  '{"amount":2900,"demo_only":true}'::jsonb, now(), now()
from public.categories c cross join demo_founder f
where c.slug = 'house-cleaning'
on conflict (id) do update
set status = excluded.status, service_window = excluded.service_window, total_amount = excluded.total_amount;

insert into public.booking_secrets (booking_id, start_otp)
values (pg_temp.demo_sid('booking:fixed-package'), '4242')
on conflict (booking_id) do update set start_otp = excluded.start_otp;

insert into public.quotes (
  id, booking_id, version, status, is_change_order, subtotal_other, total, quote_type,
  source_package_id, package_snapshot, note, created_at
)
values (
  pg_temp.demo_sid('quote:fixed-package'), pg_temp.demo_sid('booking:fixed-package'), 1,
  'approved_pending_payment', false, 249900, 249900, 'package',
  pg_temp.demo_sid('package:house-cleaning'),
  '{"title":"Demo 2 BHK deep clean","quantity":1,"inclusions":["DEMO scope confirmed before payment"]}'::jsonb,
  '[DEMO ONLY] Full package snapshot.', now()
)
on conflict (booking_id, version) do update
set total = excluded.total, package_snapshot = excluded.package_snapshot;

insert into public.quote_items (id, quote_id, kind, title, qty, unit, unit_price)
values (
  pg_temp.demo_sid('quote-item:fixed-package'), pg_temp.demo_sid('quote:fixed-package'),
  'other', 'Demo 2 BHK deep clean', 1, 'job', 249900
)
on conflict (id) do update set unit_price = excluded.unit_price;

update public.bookings
set approved_quote_id = pg_temp.demo_sid('quote:fixed-package')
where id = pg_temp.demo_sid('booking:fixed-package');

-- Same obligations create_fixed_booking writes, so "Pay" on the seeded booking can prepare a payment.
insert into public.payment_schedule (
  id, booking_id, quote_id, seq, obligation_type, label, amount, due_rule, due_at, status, purpose, obligation_kind
)
values
  (pg_temp.demo_sid('payment-schedule:fixed:service'), pg_temp.demo_sid('booking:fixed-package'),
   pg_temp.demo_sid('quote:fixed-package'), 1, 'service', 'Package payment', 249900, 'at_booking', now(), 'due',
   'package', 'service'),
  (pg_temp.demo_sid('payment-schedule:fixed:fee'), pg_temp.demo_sid('booking:fixed-package'),
   pg_temp.demo_sid('quote:fixed-package'), 2, 'platform_fee', 'Platform fee', 2900, 'at_booking', now(), 'due',
   'platform_fee', 'platform_fee')
on conflict (id) do update
set amount = excluded.amount, due_at = excluded.due_at, status = 'due';

-- Accepted proposal path: advance + platform fee paid together in one payment (0029), one future milestone.
alter table public.bookings disable trigger bookings_apply_core_contract;
insert into public.bookings (
  id, customer_id, provider_id, category_id, provider_service_id, address_id, description,
  scheduled_at, status, visit_fee, platform_fee, total_amount, service_window,
  service_request_id, proposal_id, archetype, category_config_version, location_mode,
  pricing_snapshot, payment_template_snapshot, cancellation_snapshot, platform_fee_rule_snapshot,
  delivery_status, delivery_snapshot, created_at, updated_at, accepted_at
)
select
  pg_temp.demo_sid('booking:proposal-milestones'), f.id,
  pg_temp.demo_sid('provider:wedding-photographer'), c.id,
  pg_temp.demo_sid('service:wedding-photographer'), pg_temp.demo_sid('founder:demo-home'),
  '[DEMO ONLY] Wedding photography with proposal milestones.',
  now() + interval '35 days', 'accepted', 0, 9900, 259900,
  tstzrange(now() + interval '35 days', now() + interval '35 days 8 hours', '[)'),
  pg_temp.demo_sid('request:wedding-photographer'),
  pg_temp.demo_sid('proposal:wedding-photographer'),
  'proposal', c.config_version, c.location_modes[1],
  '{"currency":"INR","demo_only":true}'::jsonb,
  '{"template":"event_standard","demo_only":true}'::jsonb,
  '{"key":"event_moderate","demo_only":true}'::jsonb,
  '{"rate_bp":100,"minimum":9900,"maximum":49900,"amount":9900,"demo_only":true}'::jsonb,
  'pending',
  '[{"type":"edited_photos","qty":100,"spec":"DEMO ONLY: synthetic wedding photo deliverables"}]'::jsonb,
  now() - interval '1 day', now(), now() - interval '1 day'
from public.categories c cross join demo_founder f
where c.slug = 'wedding-photographer'
on conflict (id) do update
set status = excluded.status, delivery_status = excluded.delivery_status;
alter table public.bookings enable trigger bookings_apply_core_contract;

insert into public.booking_secrets (booking_id, start_otp)
values (pg_temp.demo_sid('booking:proposal-milestones'), '4242')
on conflict (booking_id) do update set start_otp = excluded.start_otp;

insert into public.quotes (
  id, booking_id, version, status, is_change_order, subtotal_other, total, note, created_at
)
values (
  pg_temp.demo_sid('quote:proposal-milestones'), pg_temp.demo_sid('booking:proposal-milestones'),
  1, 'approved', false, 250000, 250000, '[DEMO ONLY] Accepted proposal snapshot.', now() - interval '1 day'
)
on conflict (booking_id, version) do update set status = 'approved', total = excluded.total;

insert into public.quote_items (id, quote_id, kind, title, qty, unit, unit_price)
values (
  pg_temp.demo_sid('quote-item:proposal-milestones'), pg_temp.demo_sid('quote:proposal-milestones'),
  'package', '[DEMO ONLY] Wedding photography scope', 1, 'day', 250000
)
on conflict (id) do update set title = excluded.title, unit_price = excluded.unit_price;

update public.bookings
set approved_quote_id = pg_temp.demo_sid('quote:proposal-milestones')
where id = pg_temp.demo_sid('booking:proposal-milestones');

insert into public.payment_schedule (
  id, booking_id, quote_id, seq, obligation_type, label, amount, due_rule, due_at, status,
  purpose, obligation_kind, proposal_schedule_id, paid_at, created_at
)
values
  (
    pg_temp.demo_sid('payment-schedule:proposal:advance'),
    pg_temp.demo_sid('booking:proposal-milestones'), pg_temp.demo_sid('quote:proposal-milestones'),
    1, 'service', 'Demo booking advance', 75000,
    'at_booking', now() - interval '1 day', 'paid', 'advance', 'service',
    pg_temp.demo_sid('proposal-schedule:wedding-photographer:1'), now() - interval '1 day', now() - interval '1 day'
  ),
  (
    pg_temp.demo_sid('payment-schedule:proposal:delivery'),
    pg_temp.demo_sid('booking:proposal-milestones'), pg_temp.demo_sid('quote:proposal-milestones'),
    2, 'service', 'Demo delivery milestone', 175000,
    'on_delivery', now() + interval '42 days', 'upcoming', 'final', 'service',
    pg_temp.demo_sid('proposal-schedule:wedding-photographer:2'), null, now() - interval '1 day'
  ),
  (
    pg_temp.demo_sid('payment-schedule:proposal:fee'),
    pg_temp.demo_sid('booking:proposal-milestones'), pg_temp.demo_sid('quote:proposal-milestones'),
    3, 'platform_fee', 'QuickServe platform fee', 9900,
    'at_booking', now() - interval '1 day', 'paid', 'platform_fee', 'platform_fee',
    null, now() - interval '1 day', now() - interval '1 day'
  )
on conflict (id) do update
set status = excluded.status, amount = excluded.amount, due_at = excluded.due_at, paid_at = excluded.paid_at;

insert into public.payments (
  id, booking_id, quote_id, purpose, amount, status, schedule_id,
  razorpay_link_id, razorpay_payment_id, short_url, created_at, paid_at
)
values (
  pg_temp.demo_sid('payment:proposal:advance'), pg_temp.demo_sid('booking:proposal-milestones'),
  pg_temp.demo_sid('quote:proposal-milestones'), 'advance', 84900, 'paid',
  pg_temp.demo_sid('payment-schedule:proposal:advance'),
  'plink_demo_all_proposal_advance', 'pay_demo_all_proposal_advance', 'demo://payment',
  now() - interval '1 day', now() - interval '1 day'
)
on conflict (id) do update
set amount = excluded.amount, status = 'paid', schedule_id = excluded.schedule_id;

update public.payment_schedule
set payment_id = pg_temp.demo_sid('payment:proposal:advance')
where id in (pg_temp.demo_sid('payment-schedule:proposal:advance'), pg_temp.demo_sid('payment-schedule:proposal:fee'));

do $$
begin
  if to_regclass('public.payment_obligations') is not null then
    insert into public.payment_obligations (payment_id, schedule_id, amount)
    values (pg_temp.demo_sid('payment:proposal:advance'), pg_temp.demo_sid('payment-schedule:proposal:advance'), 75000),
           (pg_temp.demo_sid('payment:proposal:advance'), pg_temp.demo_sid('payment-schedule:proposal:fee'), 9900)
    on conflict (payment_id, schedule_id) do update set amount = excluded.amount;
  end if;
end;
$$;

-- 0022 compatibility: seed pack + recurring/session rows only when the pending migration has landed.
do $$
declare
  v_founder uuid;
  v_schedule uuid := pg_temp.demo_sid('recurring:demo-home-tutor');
  v_pack uuid := pg_temp.demo_sid('pack:demo-home-tutor');
  v_payment uuid := pg_temp.demo_sid('payment:pack:demo-home-tutor');
  v_booking uuid := pg_temp.demo_sid('booking:time-session');
begin
  if to_regclass('public.pack_purchases') is null
     or to_regclass('public.pack_sessions') is null
     or to_regclass('public.recurring_schedules') is null then
    return;
  end if;
  select id into v_founder from demo_founder;

  insert into public.pack_purchases (
    id, customer_id, provider_id, provider_service_id, service_package_id, sessions_total,
    price, platform_fee, status, expires_at, cancellation_reason, created_at, updated_at
  )
  values (
    v_pack, v_founder, pg_temp.demo_sid('provider:demo-home-tutor'),
    pg_temp.demo_sid('service:demo-home-tutor'), pg_temp.demo_sid('package:demo-home-tutor'),
    4, 240000, 4900, 'active', now() + interval '90 days',
    '[DEMO ONLY] seed reset', now() - interval '2 days', now()
  )
  on conflict (id) do update
  set sessions_total = excluded.sessions_total, price = excluded.price, status = 'active', expires_at = excluded.expires_at;

  insert into public.payments (
    id, booking_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, short_url,
    pack_purchase_id, created_at, paid_at
  )
  values (
    v_payment, null, 'package', 244900, 'paid', 'plink_demo_all_tutor_pack',
    'pay_demo_all_tutor_pack', 'demo://payment', v_pack, now() - interval '2 days', now() - interval '2 days'
  )
  on conflict (id) do update
  set status = 'paid', pack_purchase_id = excluded.pack_purchase_id, amount = excluded.amount;

  update public.pack_purchases set payment_id = v_payment where id = v_pack;

  insert into public.pack_sessions (id, pack_id, seq, allocated_amount, status, created_at)
  select pg_temp.demo_sid('pack-session:' || n), v_pack, n, 60000, 'available', now() - interval '2 days'
    from generate_series(1, 4) n
  on conflict (pack_id, seq) do update set allocated_amount = excluded.allocated_amount, status = 'available';

  insert into public.recurring_schedules (
    id, customer_id, provider_id, provider_service_id, service_package_id, frequency, weekdays,
    start_time, timezone, session_duration_min, payment_mode, address_line, city, lat, lng,
    description, starts_on, ends_on, generated_through, status, created_at, updated_at
  )
  values (
    v_schedule, v_founder, pg_temp.demo_sid('provider:demo-home-tutor'),
    pg_temp.demo_sid('service:demo-home-tutor'), pg_temp.demo_sid('package:demo-home-tutor'),
    'weekly', array[1,3,5]::smallint[], time '17:00', 'Asia/Kolkata', 60, 'per_session',
    'Flat 302, Sai Residency, Benz Circle', 'Vijayawada Demo', 16.4995, 80.656,
    '[DEMO ONLY] Monday/Wednesday/Friday class series.', current_date + 1, current_date + 90,
    current_date, 'active', now() - interval '1 day', now()
  )
  on conflict (id) do update
  set status = 'active', description = excluded.description, generated_through = excluded.generated_through;

  execute 'alter table public.bookings disable trigger bookings_apply_core_contract';
  insert into public.bookings (
    id, customer_id, provider_id, category_id, provider_service_id, address_id, description,
    scheduled_at, status, visit_fee, platform_fee, total_amount, refund_amount,
    archetype, category_config_version, location_mode, pricing_snapshot, payment_template_snapshot,
    cancellation_snapshot, platform_fee_rule_snapshot, service_window, exclusive,
    session_duration_min, service_package_id, recurring_schedule_id, created_at, updated_at
  )
  select
    v_booking, v_founder, pg_temp.demo_sid('provider:demo-home-tutor'), c.id,
    pg_temp.demo_sid('service:demo-home-tutor'), pg_temp.demo_sid('founder:demo-home'),
    '[DEMO ONLY] Recurring Mathematics class session.',
    now() + interval '2 days', 'requested', 0, 2900, 62900, 0,
    'time_based', c.config_version, c.location_modes[1],
    '{"unit":"session","quantity":1,"price_paise":60000,"demo_only":true}'::jsonb,
    '{"key":"session_prepaid","demo_only":true}'::jsonb,
    '{"key":"session_standard","demo_only":true}'::jsonb,
    '{"amount":2900,"demo_only":true}'::jsonb,
    tstzrange(now() + interval '2 days', now() + interval '2 days 1 hour', '[)'),
    true, 60, pg_temp.demo_sid('package:demo-home-tutor'), v_schedule, now(), now()
  from public.categories c where c.slug = 'demo-home-tutor'
  on conflict (id) do update
  set status = 'requested', service_window = excluded.service_window, recurring_schedule_id = excluded.recurring_schedule_id;
  execute 'alter table public.bookings enable trigger bookings_apply_core_contract';

  insert into public.booking_secrets (booking_id, start_otp)
  values (v_booking, '4242')
  on conflict (booking_id) do update set start_otp = excluded.start_otp;

  insert into public.payment_schedule (
    id, booking_id, seq, obligation_type, label, amount, due_rule, due_at, status,
    purpose, obligation_kind, created_at
  )
  values
    (pg_temp.demo_sid('payment-schedule:session:service'), v_booking, 1, 'service', 'Demo tutor session', 60000,
     'at_booking', now(), 'due', 'session', 'service', now()),
    (pg_temp.demo_sid('payment-schedule:session:fee'), v_booking, 2, 'platform_fee', 'QuickServe platform fee', 2900,
     'at_booking', now(), 'due', 'platform_fee', 'platform_fee', now())
  on conflict (id) do update
  set amount = excluded.amount, due_at = excluded.due_at, status = 'due';
end;
$$;

-- A final deterministic verification query. It is safe to show in CI logs because every row is demo data.
select
  'DEMO ONLY' as dataset,
  (select count(*) from demo_specs) as providers,
  (select count(*) from public.service_packages sp
    join public.provider_services ps on ps.id = sp.provider_service_id
    join demo_specs d on d.slug = (select slug from public.categories c where c.id = ps.category_id)) as packages,
  (select count(*) from public.proposals p
    where p.note like '[DEMO ONLY]%') as proposals,
  (select count(*) from public.bookings b
    where b.description like '[DEMO ONLY]%') as bookings;

commit;

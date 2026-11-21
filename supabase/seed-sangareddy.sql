-- ==================================================================================================
-- QUICKServe SANGAREDDY DEMO PROVIDERS — CI / MANUAL TEST ENVIRONMENTS ONLY (never production)
-- --------------------------------------------------------------------------------------------------
-- Adds verified, online demo providers around Sangareddy (Telangana) so the app can be tested there.
-- Each provider copies the service settings and packages of the matching seed-all-services.sql demo provider,
-- so run that seed first (it also deletes every demo_only user; re-run this file after it).
-- Idempotent: each run deletes and recreates only the providers created here (raw_user_meta_data.demo_city).
--
-- The caller MUST mark the transaction as a demo seed:
--   select set_config('quickserve.demo_seed', '1', true);
-- Customers find these pros by distance from their selected location; booking checks the address city, so
-- category_cities is launched for 'Sangareddy' and the 'Sangareddi' spelling, and the founder gets a saved
-- "Sangareddy (demo)" address to pick in the location screen.
-- ==================================================================================================

begin;

do $$
begin
  if coalesce(current_setting('quickserve.demo_seed', true), '') <> '1' then
    raise exception 'seed-sangareddy.sql is DEMO ONLY; set quickserve.demo_seed=1 in the same transaction';
  end if;
end;
$$;

-- Same UUID scheme as seed-all-services.sql (source rows) and a separate namespace for this file.
create or replace function pg_temp.src_sid(p_key text) returns uuid
language sql immutable as $$
  select (substr(h, 1, 8) || '-5eed-de00-' || substr(h, 17, 4) || '-' || substr(h, 21, 12))::uuid
    from (select md5('quickserve-demo-all-services:' || p_key) as h) x
$$;
create or replace function pg_temp.sg_sid(p_key text) returns uuid
language sql immutable as $$
  select (substr(h, 1, 8) || '-5eed-5a6d-' || substr(h, 17, 4) || '-' || substr(h, 21, 12))::uuid
    from (select md5('quickserve-demo-sangareddy:' || p_key) as h) x
$$;

do $$
begin
  if not exists (select 1 from public.provider_services where id = pg_temp.src_sid('service:ac-repair')) then
    raise exception 'run seed-all-services.sql first: the Vijayawada demo services are the templates';
  end if;
end;
$$;

create temp table sg_specs (
  key text primary key,
  slug text not null,
  full_name text not null,
  bio text not null,
  phone text not null,
  area text not null,
  lat double precision not null,
  lng double precision not null,
  visit_fee int not null,
  rating numeric(3,2) not null,
  rating_count int not null,
  jobs int not null,
  years int not null
) on commit drop;

insert into sg_specs values
  ('ac-1', 'ac-repair', 'Srinivas Cool Care', '[DEMO ONLY] Split and window AC servicing, gas refill and installation in Sangareddy.', '919000005201', 'Pothireddypally', 17.6248, 78.0867, 14900, 4.8, 64, 210, 9),
  ('ac-2', 'ac-repair', 'Mahesh AC Point', '[DEMO ONLY] Inverter AC specialist; same-day visits around Sangareddy and Kandi.', '919000005202', 'Kandi', 17.6020, 78.1120, 19900, 4.5, 31, 96, 5),
  ('el-1', 'electrician', 'Ramesh Electricals', '[DEMO ONLY] House wiring, MCB boards, fans and inverter connections.', '919000005203', 'Sangareddy Town', 17.6195, 78.0821, 9900, 4.7, 52, 180, 11),
  ('el-2', 'electrician', 'Venkatesh Power Works', '[DEMO ONLY] Licensed electrician for new homes and repairs.', '919000005204', 'Fasalwadi', 17.6390, 78.0710, 12900, 4.4, 18, 47, 4),
  ('pl-1', 'plumber', 'Anjaiah Plumbing Services', '[DEMO ONLY] Leaks, motor fitting, bathroom and kitchen plumbing.', '919000005205', 'Sanjeeva Nagar', 17.6280, 78.0930, 9900, 4.6, 40, 150, 12),
  ('ap-1', 'appliance-repair', 'Swathi Appliance Care', '[DEMO ONLY] Washing machine, fridge, geyser and RO repairs.', '919000005206', 'Rajampet', 17.6150, 78.0960, 14900, 4.7, 37, 120, 7),
  ('cp-1', 'carpenter', 'Yadagiri Woodworks', '[DEMO ONLY] Furniture repair, wardrobes, doors and locks.', '919000005207', 'Pothireddypally', 17.6305, 78.0790, 9900, 4.5, 22, 85, 15),
  ('pt-1', 'painter', 'Krishna Colour Works', '[DEMO ONLY] Interior and exterior painting with waterproofing.', '919000005208', 'Kandi', 17.6080, 78.1040, 0, 4.6, 29, 70, 10),
  ('bm-1', 'bike-mechanic', 'Shankar Bike Clinic', '[DEMO ONLY] Doorstep two-wheeler service and puncture repair.', '919000005209', 'Sangareddy Town', 17.6210, 78.0880, 9900, 4.4, 26, 140, 8),
  ('cm-1', 'car-mechanic', 'Raghu Auto Care', '[DEMO ONLY] Multi-brand car diagnostics and periodic service.', '919000005210', 'Patancheru Road', 17.5950, 78.1180, 19900, 4.5, 19, 60, 9),
  ('hc-1', 'house-cleaning', 'Laxmi Home Cleaning', '[DEMO ONLY] Deep cleaning team with machines and supplies.', '919000005211', 'Sanjeeva Nagar', 17.6260, 78.0950, 0, 4.7, 44, 130, 6),
  ('wt-1', 'water-tank-cleaning', 'Balraj Tank Cleaners', '[DEMO ONLY] Sump and overhead tank cleaning with disinfection.', '919000005212', 'Fasalwadi', 17.6350, 78.0750, 0, 4.6, 21, 75, 5),
  ('pc-1', 'pest-control', 'Sangareddy Pest Shield', '[DEMO ONLY] Cockroach, termite and bed-bug treatments.', '919000005213', 'Rajampet', 17.6130, 78.0990, 0, 4.5, 27, 90, 7),
  ('wp-1', 'wedding-photographer', 'Sai Teja Weddings', '[DEMO ONLY] Candid and traditional wedding photography.', '919000005214', 'Sangareddy Town', 17.6230, 78.0850, 0, 4.9, 33, 55, 8),
  ('bm-2', 'bridal-makeup', 'Keerthi Bridal Studio', '[DEMO ONLY] HD and airbrush bridal makeup with trial.', '919000005215', 'Pothireddypally', 17.6270, 78.0800, 0, 4.8, 28, 64, 6),
  ('ig-1', 'instagram-influencer', 'Sneha Sangareddy Vlogs', '[DEMO ONLY] Telugu food and lifestyle creator for local businesses.', '919000005216', 'Kandi', 17.6050, 78.1090, 0, 4.6, 12, 25, 3),
  ('ht-1', 'demo-home-tutor', 'Sravya Tutions', '[DEMO ONLY] Maths and science home tutor for classes 6-10.', '919000005217', 'Sanjeeva Nagar', 17.6290, 78.0910, 0, 4.8, 15, 40, 6);

create temp table sg_ids on commit drop as
select id from auth.users where coalesce(raw_user_meta_data ->> 'demo_city', '') = 'Sangareddy';

do $$
begin
  -- B2 (0084) receipts reference bookings without cascade; remove these demo providers' receipts first.
  if to_regclass('public.payment_receipts') is not null then
    execute $sql$
      delete from public.payment_receipts r
       using public.bookings b
       where b.id = r.booking_id and b.provider_id in (select id from sg_ids)
    $sql$;
  end if;
end;
$$;
delete from public.bookings where provider_id in (select id from sg_ids);
delete from auth.users where id in (select id from sg_ids);

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', pg_temp.sg_sid('provider:' || s.key),
       'authenticated', 'authenticated', s.phone, now(),
       '{"provider":"phone","providers":["phone"],"demo_only":"true"}'::jsonb,
       jsonb_build_object('full_name', s.full_name, 'demo_only', 'true', 'demo_city', 'Sangareddy'),
       now() - interval '150 days', now()
  from sg_specs s;

insert into public.profiles (id, full_name, role_customer, role_provider, created_at)
select pg_temp.sg_sid('provider:' || key), full_name, false, true, now() - interval '150 days'
  from sg_specs
on conflict (id) do update set full_name = excluded.full_name, role_customer = false, role_provider = true;

insert into public.private_user_accounts (user_id, phone, updated_at)
select pg_temp.sg_sid('provider:' || key), phone, now() from sg_specs
on conflict (user_id) do update set phone = excluded.phone, updated_at = now();

insert into public.providers (
  id, bio, city, service_radius_km, base_location, years_experience, languages, kyc_status, admin_review_status,
  suspended, is_online, rating_avg, rating_count, jobs_completed, commission_tier, razorpay_account_id,
  created_at, timezone, base_area, max_jobs_per_day, paused, onboarding_step, submitted_at,
  terms_version, terms_accepted_at, kyc_updated_at
)
select pg_temp.sg_sid('provider:' || s.key), s.bio, 'Sangareddy', 25,
       extensions.st_setsrid(extensions.st_makepoint(s.lng, s.lat), 4326)::extensions.geography,
s.years, array['Telugu','Hindi','English'], 'verified'::public.kyc_status, 'approved',
       false, true, s.rating, s.rating_count, s.jobs, 10, 'acc_demo_only_never_payout_sg_' || s.key,
       now() - interval '150 days', 'Asia/Kolkata', s.area, 6, false, 7,
       now() - interval '140 days', 'demo-only-v1', now() - interval '140 days', now() - interval '140 days'
  from sg_specs s
on conflict (id) do update
set bio = excluded.bio, city = excluded.city, base_location = excluded.base_location, base_area = excluded.base_area,
    kyc_status = excluded.kyc_status, admin_review_status = 'approved',
    suspended = false, is_online = true, paused = false,
    rating_avg = excluded.rating_avg, rating_count = excluded.rating_count, jobs_completed = excluded.jobs_completed;

insert into public.category_cities (category_id, city, live, launched_at)
select c.id, x.city, true, now()
  from public.categories c
  join (select distinct slug from sg_specs) s on s.slug = c.slug
  cross join (values ('Sangareddy'), ('Sangareddi')) x(city)
on conflict (category_id, city) do update set live = true;

insert into public.provider_services (
  id, provider_id, category_id, skill_level, visit_fee, labour_rate, rate_unit, active,
  attributes, max_travel_km, travel_fee_mode, travel_fee_flat, travel_fee_per_km
)
select pg_temp.sg_sid('service:' || s.key), pg_temp.sg_sid('provider:' || s.key), src.category_id,
       src.skill_level, case when c.archetype = 'inspect_quote' then s.visit_fee else src.visit_fee end,
       src.labour_rate, src.rate_unit, true, src.attributes, src.max_travel_km,
       src.travel_fee_mode, src.travel_fee_flat, src.travel_fee_per_km
  from sg_specs s
  join public.provider_services src on src.id = pg_temp.src_sid('service:' || s.slug)
  join public.categories c on c.id = src.category_id;

insert into public.provider_availability (id, provider_id, weekday, start_time, end_time)
select pg_temp.sg_sid('availability:' || s.key || ':' || d), pg_temp.sg_sid('provider:' || s.key), d, time '07:00', time '21:00'
  from sg_specs s cross join generate_series(0, 6) d;

insert into public.provider_documents (id, provider_id, doc_type, category_id, status, expires_on, file_path, reviewed_at, created_at)
select pg_temp.sg_sid('document:' || s.key || ':' || d.doc_type), pg_temp.sg_sid('provider:' || s.key),
       d.doc_type, c.id, 'approved', current_date + interval '365 days',
       'demo-only/sangareddy/' || s.key || '/' || d.doc_type || '.pdf', now(), now() - interval '30 days'
  from sg_specs s
  join public.categories c on c.slug = s.slug
  cross join lateral unnest(c.requires_docs) d(doc_type);

insert into public.provider_payout_accounts (
  provider_id, rail, razorpay_account_id, beneficiary_name, bank_last4, ifsc, email,
  activation_status, requirements, created_at, updated_at
)
select pg_temp.sg_sid('provider:' || s.key), 'route', 'acc_demo_only_sg_' || s.key, s.full_name, '4242', 'HDFC0001234',
       'sangareddy.' || s.key || '@demo.example', 'active', '[]'::jsonb, now() - interval '140 days', now()
  from sg_specs s;

insert into public.rate_card_items (id, provider_service_id, title, price)
select pg_temp.sg_sid('rate:' || s.key || ':' || r.id), pg_temp.sg_sid('service:' || s.key), r.title, r.price
  from sg_specs s
  join public.rate_card_items r on r.provider_service_id = pg_temp.src_sid('service:' || s.slug);

insert into public.service_packages (
  id, provider_service_id, package_template_id, title, description, price_type, price, price_min, price_max,
  unit, qty_min, qty_max, duration_min, inclusions, exclusions, deliverables, turnaround_days,
  revisions_included, raw_files_included, usage_rights, travel_included_km, active, sort_order
)
select pg_temp.sg_sid('package:' || s.key || ':' || p.id), pg_temp.sg_sid('service:' || s.key), p.package_template_id,
       p.title, p.description, p.price_type, p.price, p.price_min, p.price_max,
       p.unit, p.qty_min, p.qty_max, p.duration_min, p.inclusions, p.exclusions, p.deliverables, p.turnaround_days,
       p.revisions_included, p.raw_files_included, p.usage_rights, p.travel_included_km, true, p.sort_order
  from sg_specs s
  join public.service_packages p on p.provider_service_id = pg_temp.src_sid('service:' || s.slug) and p.active;

-- Founder: a saved Sangareddy address to pick in "Select location".
insert into public.addresses (id, user_id, label, line1, city, lat, lng, is_default, created_at)
select pg_temp.sg_sid('founder:sangareddy-home'), u.id, 'Sangareddy (demo)',
       'H.No 4-12, Sanjeeva Nagar', 'Sangareddy', 17.6255, 78.0890, false, now()
  from (select id from auth.users where phone in ('919999999999', '+919999999999') order by created_at limit 1) u
on conflict (id) do update set line1 = excluded.line1, city = excluded.city, lat = excluded.lat, lng = excluded.lng;

do $$
begin
  if not public._provider_is_live(pg_temp.sg_sid('provider:hc-1')) then
    raise exception 'Sangareddy demo Laxmi Home Cleaning must be live for public package reads';
  end if;
end;
$$;

select 'DEMO ONLY' as dataset,
       (select count(*) from sg_specs) as specs,
       (select count(*) from public.providers where city = 'Sangareddy') as providers,
       (select count(*) from public.provider_services ps join public.providers p on p.id = ps.provider_id where p.city = 'Sangareddy') as services,
       (select count(*) from public.service_packages sp join public.provider_services ps on ps.id = sp.provider_service_id
          join public.providers p on p.id = ps.provider_id where p.city = 'Sangareddy') as packages;

commit;

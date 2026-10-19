-- Demo data for local/dev projects only. Creates three verified providers in Vijayawada.
-- Sign in with these test phone numbers after adding them under Auth > Providers > Phone > Test OTPs.

insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   '919000000101', now(), '{"provider":"phone","providers":["phone"]}', '{"full_name":"Ravi Kumar"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   '919000000102', now(), '{"provider":"phone","providers":["phone"]}', '{"full_name":"Lakshmi Electricals"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated',
   '919000000103', now(), '{"provider":"phone","providers":["phone"]}', '{"full_name":"Suresh Plumbing"}', now(), now())
on conflict (id) do nothing;

update public.profiles set role_provider = true
 where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');

-- Seeds bypass the "KYC comes from the payment partner" rule on purpose (demo data only).
insert into public.providers (id, bio, city, service_radius_km, base_location, years_experience, languages,
                              kyc_status, kyc_reference, razorpay_account_id, is_online, created_at)
values
  ('11111111-1111-1111-1111-111111111111', 'Split & window AC specialist. Gas refill, PCB repair.', 'Vijayawada', 15,
   extensions.st_setsrid(extensions.st_makepoint(80.6480, 16.5062), 4326)::extensions.geography, 8, '{Telugu,Hindi}',
   'verified', 'acc_demo_ravi', 'acc_demo_ravi', true, now() - interval '120 days'),
  ('22222222-2222-2222-2222-222222222222', 'House wiring, MCB, inverter installation.', 'Vijayawada', 10,
   extensions.st_setsrid(extensions.st_makepoint(80.6300, 16.5150), 4326)::extensions.geography, 5, '{Telugu,English}',
   'verified', 'acc_demo_lakshmi', 'acc_demo_lakshmi', true, now() - interval '60 days'),
  ('33333333-3333-3333-3333-333333333333', 'Leak fixing, bathroom fittings, tank connections.', 'Vijayawada', 12,
   extensions.st_setsrid(extensions.st_makepoint(80.6600, 16.4990), 4326)::extensions.geography, 3, '{Telugu}',
   'verified', 'acc_demo_suresh', 'acc_demo_suresh', false, now() - interval '10 days')
on conflict (id) do nothing;

insert into public.provider_services (provider_id, category_id, skill_level, visit_fee, labour_rate, rate_unit)
select v.provider_id, c.id, v.skill_level::public.skill_level, v.visit_fee, v.labour_rate, v.rate_unit::public.rate_unit
  from (values
    ('11111111-1111-1111-1111-111111111111'::uuid, 'ac-repair', 'expert', 19900, 50000, 'job'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'appliance-repair', 'skilled', 14900, 40000, 'job'),
    ('22222222-2222-2222-2222-222222222222'::uuid, 'electrician', 'certified', 14900, 30000, 'hour'),
    ('33333333-3333-3333-3333-333333333333'::uuid, 'plumber', 'skilled', 9900, 25000, 'hour')
  ) as v(provider_id, slug, skill_level, visit_fee, labour_rate, rate_unit)
  join public.categories c on c.slug = v.slug
on conflict (provider_id, category_id) do nothing;

insert into public.rate_card_items (provider_service_id, title, price)
select ps.id, v.title, v.price
  from (values
    ('ac-repair', 'Gas refill (split AC)', 250000),
    ('ac-repair', 'Jet service / deep clean', 59900),
    ('electrician', 'MCB replacement', 35000),
    ('plumber', 'Tap replacement (labour)', 20000)
  ) as v(slug, title, price)
  join public.categories c on c.slug = v.slug
  join public.provider_services ps on ps.category_id = c.id
 where not exists (select 1 from public.rate_card_items r where r.provider_service_id = ps.id and r.title = v.title);

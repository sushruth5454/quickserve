-- Mirrors the hosted DEMO project's admin-managed settings that the web smoke test relies on.
-- CI E2E against a local Supabase stack only (scripts/ci/local-supabase.sh); never run in production.
-- Snapshot of the hosted demo project taken with scripts/ci/state-dump.sql. When an admin changes these
-- there, re-run that dump against both stacks and update this file.
begin;

update public.feature_flags set enabled = true where key in (
  'ai_product_search',
  'ai_quote_extract',
  'business_payout_identity',
  'home_services_catalogue_v2',
  'merchant_calendar',
  'merchant_staff',
  'recurring_billing',
  'recurring_bookings',
  'recurring_plan_acceptance',
  'recurring_prepaid_packages',
  'recurring_reminders',
  'recurring_reschedule',
  'recurring_skip_pause',
  'sports_capacity_slots',
  'sports_instant_booking',
  'sports_multi_slot',
  'sports_online_payments'
);

update public.categories set active = true where slug in (
  'ac-servicing',
  'appliance-installation',
  'babysitting',
  'bathroom-cleaning',
  'cooking-meal-prep',
  'daily-cook',
  'deep-cleaning',
  'dishwashing',
  'elderly-assistance',
  'fridge-washing-machine-repair',
  'full-house-cleaning',
  'full-time-cook',
  'gardening',
  'home-other',
  'home-repairs',
  'home-sanitisation',
  'household-help',
  'kitchen-cleaning',
  'laundry-ironing',
  'maid-household-helper',
  'packers-movers',
  'part-time-cook',
  'ro-water-purifier-service',
  'sofa-carpet-cleaning'
);

insert into public.category_cities (category_id, city, live, launched_at)
select c.id, v.city, true, now()
  from (values
  ('appliance-repair', 'Sangareddi'),
  ('appliance-repair', 'Sangareddy'),
  ('bike-mechanic', 'Sangareddi'),
  ('bike-mechanic', 'Sangareddy'),
  ('bridal-makeup', 'Sangareddi'),
  ('bridal-makeup', 'Sangareddy'),
  ('car-mechanic', 'Sangareddi'),
  ('car-mechanic', 'Sangareddy'),
  ('carpenter', 'Sangareddi'),
  ('carpenter', 'Sangareddy'),
  ('demo-home-tutor', 'Sangareddi'),
  ('demo-home-tutor', 'Sangareddy'),
  ('electrician', 'Sangareddi'),
  ('electrician', 'Sangareddy'),
  ('house-cleaning', 'Sangareddi'),
  ('house-cleaning', 'Sangareddy'),
  ('instagram-influencer', 'Sangareddi'),
  ('instagram-influencer', 'Sangareddy'),
  ('kitchen-cleaning', 'Sangareddy'),
  ('packers-movers', 'Sangareddy'),
  ('packers-movers', 'Vijayawada'),
  ('painter', 'Sangareddi'),
  ('painter', 'Sangareddy'),
  ('pest-control', 'Sangareddi'),
  ('pest-control', 'Sangareddy'),
  ('plumber', 'Sangareddi'),
  ('plumber', 'Sangareddy'),
  ('water-tank-cleaning', 'Sangareddi'),
  ('water-tank-cleaning', 'Sangareddy'),
  ('wedding-photographer', 'Sangareddi'),
  ('wedding-photographer', 'Sangareddy')
  ) as v(slug, city)
  join public.categories c on c.slug = v.slug
on conflict (category_id, city) do update set live = true, launched_at = coalesce(public.category_cities.launched_at, now());

update public.app_config
   set value = '{"fixed": {"tiers": [{"bp": 1200, "min_jobs": 200}, {"bp": 1300, "min_jobs": 50}, {"bp": 1500, "min_jobs": 0}]}, "tiers": [{"bp": 1000, "min_jobs": 200}, {"bp": 1000, "min_jobs": 50}, {"bp": 1000, "min_jobs": 0}], "proposal": {"bp": 800, "cap_paise": 500000}, "time_based": {"one_off_bp": 1000, "recurring_bp": 800}, "founding_days": 30, "repeat_floor_bp": 500, "repeat_discount_bp": 400}'::jsonb
 where key = 'commission';

-- Admin test numbers exist as returning customers on the hosted project (automation admin 9000000901 and
-- the owner's manual admin 9000000902), so their login skips the role screen there. Mirror that here.
insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
                        email_change, email_change_token_new, email_change_token_current, phone_change,
                        phone_change_token, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000', 'e2e00000-0000-4000-8000-000000000901', 'authenticated', 'authenticated',
   '919000000901', now(), '{"provider":"phone","providers":["phone"]}', '{"full_name":"E2E Admin"}', now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'e2e00000-0000-4000-8000-000000000902', 'authenticated', 'authenticated',
   '919000000902', now(), '{"provider":"phone","providers":["phone"]}', '{"full_name":"Owner Admin"}', now(), now(), '', '', '', '', '', '', '', '')
on conflict (id) do nothing;
insert into public.profiles (id, full_name, role_customer, role_provider)
values ('e2e00000-0000-4000-8000-000000000901', 'E2E Admin', true, false),
       ('e2e00000-0000-4000-8000-000000000902', 'Owner Admin', true, false)
on conflict (id) do update set full_name = excluded.full_name, role_customer = true;
insert into public.admins (user_id)
values ('e2e00000-0000-4000-8000-000000000901'), ('e2e00000-0000-4000-8000-000000000902')
on conflict (user_id) do nothing;

commit;

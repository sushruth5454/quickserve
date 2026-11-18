// RP-mapped B1 runtime checks on the full real migration chain.
// Migration 0056 is intentionally included before 0057; B1 integration follows A1.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = (file) =>
  fs.readFileSync(path.join(here, '..', 'migrations', file), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');

const prelude = `
create schema if not exists extensions;
create type extensions.geography as (lng float8, lat float8);
create type extensions.geometry as (lng float8, lat float8);
create function extensions.st_makepoint(x float8, y float8) returns extensions.geography language sql immutable as $$ select row(x, y)::extensions.geography $$;
create function extensions.st_setsrid(g extensions.geography, srid int) returns extensions.geography language sql immutable as $$ select g $$;
create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8 language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(b.lat - a.lat) / 2), 2) + cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - a.lng) / 2), 2))) $$;
create function extensions.st_dwithin(a extensions.geography, b extensions.geography, d float8) returns boolean language sql immutable as $$ select extensions.st_distance(a, b) <= d $$;
create function extensions.geog_to_geom(g extensions.geography) returns extensions.geometry language sql immutable as $$ select row(g.lng, g.lat)::extensions.geometry $$;
create cast (extensions.geography as extensions.geometry) with function extensions.geog_to_geom(extensions.geography);
create function extensions.st_x(g extensions.geometry) returns float8 language sql immutable as $$ select g.lng $$;
create function extensions.st_y(g extensions.geometry) returns float8 language sql immutable as $$ select g.lat $$;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public, extensions to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (instance_id uuid, id uuid primary key, aud text, role text, phone text, phone_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}', created_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated, anon, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(prelude);
for (const file of [
  '0001_init.sql', '0002_qa_fixes.sql', '0003_payout_transfer_payment_cascade.sql',
  '0007_chat_unread_notifications.sql', '0008_provider_kyc_status_values.sql',
  '0009_provider_onboarding.sql', '0010_notification_freshness.sql',
  '0011_payout_rails.sql', '0012_matching_foundations.sql', '0013_review_matching.sql',
  '0014_travel_requests.sql', '0015_seva_coins.sql', '0016_leakage_programme.sql',
  '0017_creator_config.sql', '0018_archetype_core.sql', '0019_fixed_package_booking.sql',
  '0020_proposal_enum_values.sql', '0021_cancellation_availability_payouts.sql',
  '0022_time_based_booking.sql', '0023_proposal_milestone_booking.sql',
  '0024_activate_creator_event_categories.sql', '0025_targeted_proposal_requests.sql',
  '0026_fix_proposal_prepare_payment.sql', '0027_restore_fixed_prepare_payment.sql',
  '0028_auto_approve_provider_links.sql', '0029_single_due_payment.sql', '0030_review_fixes.sql',
  '0031_holiday_mode_enforcement.sql', '0032_notification_centre.sql', '0033_city_waitlist.sql',
  '0034_targeted_request_radius.sql', '0035_request_coordinates.sql', '0036_provider_service_city.sql',
  '0037_proposal_validity_cap.sql', '0038_proposal_lead_time.sql', '0039_proposal_start_code.sql',
  '0040_urgent_proposals.sql', '0041_admin_support.sql', '0042_feature_registry.sql',
  '0043_commission_config.sql', '0044_creator_revisions.sql', '0045_preferred_language.sql',
  '0046_managed_geography.sql', '0047_coins_config.sql', '0048_sports.sql',
  '0049_shops_catalogue.sql', '0050_rfq.sql', '0051_ai_usage_v3.sql',
  '0052_merchant_staff.sql', '0053_activity_contracts.sql', '0054_addendum_foundations.sql',
  '0055_addendum_foundation_hardening.sql', '0056_home_services_catalogue.sql',
  '0057_recurring_plans_v2.sql',
]) {
  if (file === '0051_ai_usage_v3.sql') {
    await db.exec(`
      create table public.ai_usage (
        id bigint generated always as identity primary key,
        user_id uuid not null references public.profiles (id) on delete cascade,
        kind text not null constraint ai_usage_kind_check check (kind in ('transcribe', 'voice_chat', 'photo')),
        request_id uuid,
        created_at timestamptz not null default now()
      )
    `);
  }
  await db.exec(migration(file));
}

await db.exec("set timezone = 'UTC'");
let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log(`ok  : ${message}`);
  else { failures++; console.error(`FAIL: ${message}`); }
};
async function as(uid, role, query, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return (await db.query(query, params)).rows; }
  finally { await db.exec('reset role;'); }
}
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const seededRecurringRules = (await one(`
  select value from app_config where key='recurring_rules'`)).value;
ok(seededRecurringRules.payment_due_hours_before === 48
  && seededRecurringRules.billing_grace_hours === 24,
  '[RP-29] recurring rules seed a 48-hour due lead and 24-hour grace period');
const dateOffset = (days) => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const isoDow = (date) => new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;
const indiaSlot = (minutesAhead, durationMin = 15) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + minutesAhead * 60_000))
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  let date = `${parts.year}-${parts.month}-${parts.day}`;
  let time = `${parts.hour}:${parts.minute}`;
  let at = new Date(`${date}T${time}:00+05:30`);
  const [hour, minute] = time.split(':').map(Number);
  if (hour * 60 + minute + durationMin >= 24 * 60) {
    date = addDays(date, 1);
    time = '00:15';
    at = new Date(`${date}T${time}:00+05:30`);
  }
  return { date, time, at };
};

const customer = '00000000-0000-0000-0000-0000000000c1';
const otherCustomer = '00000000-0000-0000-0000-0000000000c2';
const provider = '00000000-0000-0000-0000-0000000000a1';
const manager = '00000000-0000-0000-0000-0000000000a2';
const staff = '00000000-0000-0000-0000-0000000000a3';
const syncProvider = '00000000-0000-0000-0000-0000000000a4';
const autoProvider = '00000000-0000-0000-0000-0000000000a5';
const legacyProvider = '00000000-0000-0000-0000-0000000000a6';
const admin = '00000000-0000-0000-0000-0000000000b1';

await db.exec(`
  insert into auth.users (id, phone, raw_user_meta_data) values
    ('${customer}', '+919999000001', '{}'), ('${otherCustomer}', '+919999000002', '{}'),
    ('${provider}', '+919999000003', '{}'), ('${manager}', '+919999000004', '{}'),
    ('${staff}', '+919999000005', '{}'), ('${syncProvider}', '+919999000006', '{}'),
    ('${autoProvider}', '+919999000007', '{}'), ('${legacyProvider}', '+919999000008', '{}'),
    ('${admin}', '+918888888888', '{}');
  update profiles set full_name = 'Person';
  insert into admins (user_id) values ('${admin}');
  insert into providers (id, city, base_location, kyc_status, submitted_at, is_online, paused, suspended)
  values
    ('${provider}', 'Recurring City', extensions.st_setsrid(extensions.st_makepoint(80.60,16.50),4326),
     'verified', now(), true, false, false),
    ('${syncProvider}', 'Recurring City', extensions.st_setsrid(extensions.st_makepoint(80.62,16.50),4326),
     'verified', now(), true, false, false),
    ('${autoProvider}', 'Recurring City', extensions.st_setsrid(extensions.st_makepoint(80.63,16.50),4326),
     'verified', now(), true, false, false),
    ('${legacyProvider}', 'Recurring City', extensions.st_setsrid(extensions.st_makepoint(80.64,16.50),4326),
     'verified', now(), true, false, false);
  update app_config
     set value = value || '{"time_based":true,"fixed":true}'::jsonb
   where key = 'archetype_flags';
  update feature_flags set enabled = true
   where key in ('recurring_bookings', 'recurring_skip_pause', 'recurring_reschedule',
                 'recurring_plan_acceptance', 'recurring_reminders', 'recurring_prepaid_packages',
                 'recurring_billing', 'merchant_calendar', 'merchant_staff');
  insert into business_members (owner_id, member_id, role, active) values
    ('${provider}', '${manager}', 'manager', true), ('${provider}', '${staff}', 'staff', true);
  insert into provider_availability (provider_id, weekday, start_time, end_time)
  select '${provider}', d, time '00:00', time '23:59' from generate_series(0, 6) d;
  insert into provider_availability (provider_id, weekday, start_time, end_time)
  select '${syncProvider}', d, time '00:00', time '23:59' from generate_series(0, 6) d;
  insert into provider_availability (provider_id, weekday, start_time, end_time)
  select '${autoProvider}', d, time '00:00', time '23:59' from generate_series(0, 6) d;
  insert into provider_availability (provider_id, weekday, start_time, end_time)
  select '${legacyProvider}', d, time '00:00', time '23:59' from generate_series(0, 6) d;
  insert into addresses (user_id, label, line1, city, lat, lng) values
    ('${customer}', 'Home', 'Gate 2', 'Recurring City', 16.50, 80.60),
    ('${otherCustomer}', 'Home', 'Gate 3', 'Recurring City', 16.50, 80.61);
`);
const address = (await one(`select id from addresses where user_id = $1`, [customer])).id;
const otherAddress = (await one(`select id from addresses where user_id = $1`, [otherCustomer])).id;
const invalidRecurringRules = {
  ...(await one(`select value from app_config where key='recurring_rules'`)).value,
  payment_due_hours_before: 24,
  billing_grace_hours: 24,
};
const adminRuleWindowError = await fails(() => as(
  admin, 'authenticated',
  `select admin_set_rules('recurring_rules', $1::jsonb)`,
  [JSON.stringify(invalidRecurringRules)]
));
const directRuleWindowError = await fails(() => db.query(`
  update app_config
     set value=jsonb_set(jsonb_set(value, '{payment_due_hours_before}', '24'::jsonb),
                         '{billing_grace_hours}', '24'::jsonb)
   where key='recurring_rules'`));
ok(/payment_due_hours_before must be greater than billing_grace_hours/i.test(adminRuleWindowError ?? '')
  && /payment_due_hours_before must be greater than billing_grace_hours/i.test(directRuleWindowError ?? ''),
  '[RP-29] admin and direct app_config writes reject due hours less than or equal to grace hours');

const timeCategory = (await one(`
  insert into categories (
    slug, name, pricing_mode, active, archetype, intake_schema, config_version, max_lead_days,
    recurrence_allowed, allowed_frequencies, recurring_discount_bp
  ) values (
    'recurring-time', 'Recurring time service', 'quote', true, 'time_based', '{}'::jsonb, 1, 365,
    true, array['daily','alternate_days','weekly','monthly','custom']::text[], 0
  ) returning id
`)).id;
const fixedCategory = (await one(`
  insert into categories (
    slug, name, pricing_mode, active, archetype, intake_schema, config_version, max_lead_days,
    recurrence_allowed, allowed_frequencies, recurring_discount_bp
  ) values (
    'recurring-fixed', 'Recurring fixed service', 'quote', true, 'fixed', '{}'::jsonb, 1, 365,
    true, array['daily','alternate_days','weekly','monthly','custom']::text[], 0
  ) returning id
`)).id;
await db.query(`
  insert into category_cities (category_id, city, live, launched_at)
  values ($1, 'Recurring City', true, now()), ($2, 'Recurring City', true, now())`,
  [timeCategory, fixedCategory]);
await db.query(`
  insert into provider_services (provider_id, category_id, visit_fee, labour_rate, active)
  values
    ($1, $2, 0, 60000, true), ($1, $3, 0, 0, true),
    ($4, $2, 0, 60000, true), ($5, $2, 0, 60000, true), ($6, $2, 0, 60000, true)`,
  [provider, timeCategory, fixedCategory, syncProvider, autoProvider, legacyProvider]);
const timeService = (await one(
  `select id from provider_services where provider_id=$1 and category_id=$2`,
  [provider, timeCategory])).id;
const fixedService = (await one(
  `select id from provider_services where provider_id=$1 and category_id=$2`,
  [provider, fixedCategory])).id;
const syncService = (await one(
  `select id from provider_services where provider_id=$1 and category_id=$2`,
  [syncProvider, timeCategory])).id;
const autoService = (await one(
  `select id from provider_services where provider_id=$1 and category_id=$2`,
  [autoProvider, timeCategory])).id;
const legacyService = (await one(
  `select id from provider_services where provider_id=$1 and category_id=$2`,
  [legacyProvider, timeCategory])).id;
const sessionPackage = (await one(`
  insert into service_packages (
    provider_service_id, title, description, price_type, price, price_min, price_max,
    unit, qty_min, qty_max, duration_min, active
  ) values ($1, 'Recurring session pack', '', 'fixed', 50000, 50000, 50000,
            'session', 1, 1, 60, true)
  returning id`, [timeService])).id;
const fixedPackage = (await one(`
  insert into service_packages (
    provider_service_id, title, description, price_type, price, price_min, price_max,
    unit, qty_min, qty_max, duration_min, active
  ) values ($1, 'Recurring package', '', 'fixed', 120000, 120000, 120000,
            'visit', 1, 1, 60, true)
  returning id`, [fixedService])).id;
const createPackFixture = async ({ expired = false, sessionStatus = 'available' } = {}) => {
  const packId = (await one(`
    insert into pack_purchases (
      customer_id, provider_id, provider_service_id, service_package_id,
      sessions_total, price, platform_fee, status, expires_at
    ) values (
      $1, $2, $3, $4, 2, 100000, 4900, 'active',
      case when $5::boolean then now()-interval '1 day' else now()+interval '30 days' end
    ) returning id`,
  [customer, provider, timeService, sessionPackage, expired])).id;
  await db.query(`
    insert into pack_sessions (pack_id, seq, allocated_amount, status)
    values ($1, 1, 50000, $2), ($1, 2, 50000, $2)`,
  [packId, sessionStatus]);
  return packId;
};

const input = (overrides = {}) => ({
  provider_service_id: timeService,
  package_id: null,
  archetype: 'time_based',
  frequency: 'daily',
  interval_count: 1,
  weekdays: [],
  month_day: null,
  custom_dates: [],
  start_date: dateOffset(3),
  end_date: addDays(dateOffset(3), 2),
  max_occurrences: null,
  start_time: '10:00',
  duration_min: 60,
  package_qty: null,
  billing_frequency: 'per_visit',
  address_id: address,
  description: 'Recurring test',
  ...overrides,
});
const nearTermPlanInput = (serviceId, slot) => input({
  provider_service_id: serviceId,
  frequency: 'custom',
  custom_dates: [slot.date],
  start_date: slot.date,
  end_date: null,
  start_time: slot.time,
  duration_min: 15,
});
const createPlan = async (value, uid = customer) => (await as(
  uid, 'authenticated', `select create_recurring_plan($1::jsonb) id`, [JSON.stringify(value)]
))[0].id;
const createLegacySchedule = async (serviceId, start, end = start, startTime = '10:00', duration = 60) => (await as(
  customer,
  'authenticated',
  `select create_recurring_schedule(
    $1, null, null, 'per_session', array[$2]::smallint[], $5::time,
    'Asia/Kolkata', $6, $3::date, $4::date, 'Gate 2', 'Recurring City', 16.5, 80.6, 'legacy test'
  ) id`,
  [serviceId, isoDow(start), start, end, startTime, duration]
))[0].id;
const setFlag = (key, enabled) =>
  db.query(`update feature_flags set enabled=$2 where key=$1`, [key, enabled]);

const insertSchedule = async (overrides = {}) => {
  const values = {
    customer_id: customer,
    provider_id: provider,
    provider_service_id: timeService,
    service_package_id: null,
    pack_purchase_id: null,
    frequency: 'weekly',
    interval_count: 1,
    weekdays: [1],
    month_day: null,
    custom_dates: [],
    start_time: '10:00',
    timezone: 'Asia/Kolkata',
    session_duration_min: 60,
    payment_mode: 'per_session',
    billing_frequency: 'per_visit',
    archetype: 'time_based',
    package_qty: null,
    address_line: 'Gate 2',
    city: 'Recurring City',
    lat: 16.5,
    lng: 80.6,
    description: 'Recurring fixture',
    starts_on: dateOffset(3),
    ends_on: null,
    status: 'completed',
    provider_acceptance: 'accepted',
    acceptance_mode: 'occurrence',
    max_occurrences: null,
    ...overrides,
  };
  return (await one(`
    insert into recurring_schedules (
      customer_id, provider_id, provider_service_id, service_package_id, pack_purchase_id,
      frequency, interval_count,
      weekdays, month_day, custom_dates, start_time, timezone, session_duration_min, payment_mode,
      billing_frequency, archetype, package_qty, address_line, city, lat, lng, description,
      starts_on, ends_on, status, provider_acceptance, acceptance_mode, max_occurrences
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8::smallint[],$9,$10::date[],$11::time,$12,$13,$14,$15,$16,$17,
      $18,$19,$20,$21,$22,$23::date,$24::date,$25,$26,$27,$28
    ) returning id`, [
    values.customer_id, values.provider_id, values.provider_service_id, values.service_package_id,
    values.pack_purchase_id, values.frequency, values.interval_count, values.weekdays,
    values.month_day, values.custom_dates,
    values.start_time, values.timezone, values.session_duration_min, values.payment_mode,
    values.billing_frequency, values.archetype, values.package_qty, values.address_line, values.city,
    values.lat, values.lng, values.description, values.starts_on, values.ends_on, values.status,
    values.provider_acceptance, values.acceptance_mode, values.max_occurrences,
  ])).id;
};
const recurrenceDates = async (id, from, to) => (await one(`
  select coalesce(array_agg(d::text order by d), '{}'::text[]) dates
    from public._recurrence_dates(
      (select r from public.recurring_schedules r where id=$1), $2::date, $3::date
    ) d`, [id, from, to])).dates;
const generatedBookings = async (id) => (await one(
  `select count(*)::int n from bookings where recurring_schedule_id=$1`, [id])).n;
const prepareSessionPayment = async (bookingId, linkId) => {
  const amount = (await one(`
    select sum(amount)::int amount from payment_schedule
     where booking_id=$1 and status='due'`, [bookingId])).amount;
  const paymentId = (await one(`
    insert into payments (booking_id, purpose, amount, status, razorpay_link_id)
    values ($1, 'session', $2, 'created', $3) returning id`,
  [bookingId, amount, linkId])).id;
  await db.query(`
    insert into payment_obligations (payment_id, schedule_id, amount)
    select $1, id, amount from payment_schedule where booking_id=$2 and status='due'`,
  [paymentId, bookingId]);
  return { amount, paymentId };
};

// RP-07/RP-08: common SQL and TS date vectors use the implementation plan's exact examples.
for (const fixture of [
  { frequency: 'weekly', weekdays: [1, 2, 3, 4, 5, 6], starts_on: '2026-12-07', through: '2026-12-14',
    expected: ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-14'] },
  { frequency: 'alternate_days', weekdays: [], starts_on: '2026-12-07', through: '2026-12-13',
    expected: ['2026-12-07', '2026-12-09', '2026-12-11', '2026-12-13'] },
  { frequency: 'weekly', weekdays: [7], starts_on: '2026-12-07', through: '2026-12-27',
    expected: ['2026-12-13', '2026-12-20', '2026-12-27'] },
  { frequency: 'monthly', weekdays: [], month_day: 7, interval_count: 6, starts_on: '2026-12-07', through: '2027-12-07',
    expected: ['2026-12-07', '2027-06-07', '2027-12-07'] },
  { frequency: 'daily', weekdays: [], starts_on: '2026-12-30', ends_on: '2027-01-02', through: '2027-01-10',
    expected: ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'] },
  { frequency: 'custom', weekdays: [], starts_on: '2026-12-25', custom_dates: ['2026-12-25', '2026-12-31'],
    through: '2027-01-05', expected: ['2026-12-25', '2026-12-31'] },
]) {
  const id = await insertSchedule(fixture);
  const dates = await recurrenceDates(id, fixture.starts_on, fixture.through);
  ok(JSON.stringify(dates) === JSON.stringify(fixture.expected),
    `[RP-07/RP-08] ${fixture.frequency} returns the shared date vector (${JSON.stringify(dates)})`);
}

// RP-01/RP-03/RP-04: quote is read-only, server-priced, and validates eligibility and feature state.
const quoteInput = input({ price_paise: 1, discount_bp: 10000 });
const beforeQuote = await one(`select count(*)::int n from recurring_schedules where customer_id=$1`, [customer]);
const quoteError = await fails(async () => as(customer, 'authenticated',
  `select quote_recurring_plan($1::jsonb) quote`, [JSON.stringify(quoteInput)]));
const quote = quoteError ? null : (await as(customer, 'authenticated',
  `select quote_recurring_plan($1::jsonb) quote`, [JSON.stringify(quoteInput)]))[0].quote;
const afterQuote = await one(`select count(*)::int n from recurring_schedules where customer_id=$1`, [customer]);
ok(!quoteError && quote?.per_visit_paise === 60000 && quote?.first_dates?.length === 3
  && quote?.visits_in_first_cycle === 1 && quote?.visits_total === 3
  && quote?.discount_bp === 0 && quote?.discount_paise === 0
  && quote?.platform_fee_paise === 2900 && quote?.gst_paise === 0
  && quote?.total_paise_per_cycle === 62900
  && beforeQuote.n === afterQuote.n,
  `[RP-03] quote uses server prices, returns first dates, and creates no plan (${quoteError ?? 'ok'})`);
const badFrequency = await fails(() => as(customer, 'authenticated',
  `select quote_recurring_plan($1::jsonb)`, [JSON.stringify(input({ frequency: 'yearly' }))]));
const badInterval = await fails(() => as(customer, 'authenticated',
  `select quote_recurring_plan($1::jsonb)`, [JSON.stringify(input({ interval_count: 13 }))]));
await db.query(`update categories set recurrence_allowed=false where id=$1`, [timeCategory]);
const ineligibleCategory = await fails(() => as(customer, 'authenticated',
  `select quote_recurring_plan($1::jsonb)`, [JSON.stringify(quoteInput)]));
await db.query(`update categories set recurrence_allowed=true where id=$1`, [timeCategory]);
ok(!!badFrequency && !!badInterval && !!ineligibleCategory,
  '[RP-04] unsupported frequencies, invalid intervals, and ineligible categories are rejected');

const fixedQuoteInput = input({
  provider_service_id: fixedService, package_id: fixedPackage, archetype: 'fixed',
  package_qty: 1, duration_min: null,
});
const plansBeforeDiscountChecks = await one(`select count(*)::int n from recurring_schedules where customer_id=$1`, [customer]);
await db.query(`update categories set recurring_discount_bp=500 where id=$1`, [timeCategory]);
const categoryTimeDiscountQuote = await fails(() => as(customer, 'authenticated',
  `select quote_recurring_plan($1::jsonb)`, [JSON.stringify(input())]));
const categoryTimeDiscountCreate = await fails(() => as(customer, 'authenticated',
  `select create_recurring_plan($1::jsonb)`, [JSON.stringify(input())]));
await db.query(`update categories set recurring_discount_bp=500 where id=$1`, [fixedCategory]);
const categoryFixedDiscountQuote = await fails(() => as(customer, 'authenticated',
  `select quote_recurring_plan($1::jsonb)`, [JSON.stringify(fixedQuoteInput)]));
const categoryFixedDiscountCreate = await fails(() => as(customer, 'authenticated',
  `select create_recurring_plan($1::jsonb)`, [JSON.stringify(fixedQuoteInput)]));
await db.query(`update categories set recurring_discount_bp=0 where id in ($1, $2)`,
  [timeCategory, fixedCategory]);
await db.query(`update app_config
  set value=jsonb_set(value, '{recurring_discount_bp}', '500'::jsonb)
  where key='recurring_rules'`);
const globalTimeDiscountQuote = await fails(() => as(customer, 'authenticated',
  `select quote_recurring_plan($1::jsonb)`, [JSON.stringify(input())]));
const globalFixedDiscountCreate = await fails(() => as(customer, 'authenticated',
  `select create_recurring_plan($1::jsonb)`, [JSON.stringify(fixedQuoteInput)]));
await db.query(`update app_config
  set value=jsonb_set(value, '{recurring_discount_bp}', '0'::jsonb)
  where key='recurring_rules'`);
const plansAfterDiscountChecks = await one(
  `select count(*)::int n from recurring_schedules where customer_id=$1`, [customer]);
ok(!!categoryTimeDiscountQuote && !!categoryTimeDiscountCreate
  && !!categoryFixedDiscountQuote && !!categoryFixedDiscountCreate
  && !!globalTimeDiscountQuote && !!globalFixedDiscountCreate
  && plansBeforeDiscountChecks.n === plansAfterDiscountChecks.n,
  '[RP-03] configured category/global discounts are rejected until both archetype occurrence charges apply them');

const existingPlanForSafety = await createPlan(input({
  start_date: dateOffset(15), end_date: dateOffset(15), start_time: '08:00',
}));
await as(manager, 'authenticated', `select respond_recurring_plan($1, true, null)`, [existingPlanForSafety]);
const existingBookingForSafety = (await one(
  `select id from bookings where recurring_schedule_id=$1`, [existingPlanForSafety])).id;
const existingPaymentAmount = (await one(
  `select sum(amount)::int amount from payment_schedule where booking_id=$1`, [existingBookingForSafety])).amount;
const existingPayment = (await one(`
  insert into payments (booking_id, purpose, amount, status, razorpay_payment_id)
  values ($1, 'session', $2, 'paid', 'rp-paid-master-off-cancel')
  returning id`, [existingBookingForSafety, existingPaymentAmount])).id;
await db.query(`update payment_schedule set status='paid', payment_id=$2 where booking_id=$1`,
  [existingBookingForSafety, existingPayment]);
const pendingPlanForGate = await createPlan(input({
  start_date: dateOffset(16), end_date: dateOffset(16), start_time: '09:00',
}));

await setFlag('recurring_bookings', false);
const featureOff = await fails(() => as(customer, 'authenticated',
  `select create_recurring_plan($1::jsonb)`, [JSON.stringify(quoteInput)]));
const quoteFeatureOff = await fails(() => as(customer, 'authenticated',
  `select quote_recurring_plan($1::jsonb)`, [JSON.stringify(quoteInput)]));
const respondFeatureOff = await fails(() => as(manager, 'authenticated',
  `select respond_recurring_plan($1, true, null)`, [pendingPlanForGate]));
ok(!!featureOff && /turned off/i.test(featureOff) && !!quoteFeatureOff && !!respondFeatureOff,
  '[RP-01] quotes, new plans, and plan responses are refused while the master flag is off');
const flagOffPlan = await insertSchedule({
  status: 'active', provider_acceptance: 'accepted', frequency: 'daily', weekdays: [],
  starts_on: dateOffset(12), ends_on: addDays(dateOffset(12), 1),
});
const skippedGeneration = await as(null, 'service_role', `select generate_recurring_occurrences(100) n`);
await as(customer, 'authenticated',
  `select cancel_recurring_plan($1, 'cleanup after flag-off check')`, [flagOffPlan]);
const childWithParentOff = await fails(() => as(customer, 'authenticated',
  `select pause_recurring_plan($1, null)`, [flagOffPlan]));
const skipWithParentOff = await fails(() => as(customer, 'authenticated',
  `select skip_recurring_visit($1, 'parent disabled')`, [existingBookingForSafety]));
const rescheduleWithParentOff = await fails(() => as(customer, 'authenticated',
  `select request_visit_reschedule($1, $2::timestamptz, 'parent disabled')`,
  [existingBookingForSafety, `${addDays(dateOffset(15), 1)}T08:00:00+05:30`]));
const remindersWithParentOff = await as(null, 'service_role', `select queue_recurring_reminders() n`);
const existingPlanReadWhileOff = (await as(customer, 'authenticated',
  `select get_recurring_plan($1) plan`, [existingPlanForSafety]))[0].plan;
const cancelWhileOff = await fails(() => as(customer, 'authenticated',
  `select cancel_recurring_plan($1, 'flag disabled')`, [existingPlanForSafety]));
const cancelledWhileOff = await one(`
  select r.status plan_status, b.status::text booking_status
    from recurring_schedules r join bookings b on b.recurring_schedule_id=r.id
   where r.id=$1`, [existingPlanForSafety]);
const refundWhileOff = await one(
  `select coalesce(sum(amount),0)::int amount from refunds where payment_id=$1`, [existingPayment]);
ok(Number(skippedGeneration[0].n) === 0 && (await generatedBookings(flagOffPlan)) === 0
  && !!childWithParentOff && !!skipWithParentOff && !!rescheduleWithParentOff
  && Number(remindersWithParentOff[0].n) === 0 && !cancelWhileOff
  && existingPlanReadWhileOff?.plan?.provider_acceptance === 'accepted'
  && cancelledWhileOff.plan_status === 'cancelled' && cancelledWhileOff.booking_status === 'cancelled'
  && refundWhileOff.amount === existingPaymentAmount,
  '[RP-01/RP-02/RP-14/RP-23] parent-off blocks new child actions but existing cancellation/refund remains available');
await setFlag('recurring_bookings', true);
await setFlag('recurring_billing', true);
await setFlag('recurring_prepaid_packages', true);
const plansBeforeUnsupportedBilling = await one(
  `select count(*)::int n from recurring_schedules where customer_id=$1`, [customer]);
const unsupportedBillingResults = [];
for (const billingFrequency of ['weekly', 'monthly', 'prepaid_package']) {
  const billingInput = billingFrequency === 'prepaid_package'
    ? { ...fixedQuoteInput, billing_frequency: billingFrequency }
    : input({ billing_frequency: billingFrequency });
  unsupportedBillingResults.push(await fails(() => as(customer, 'authenticated',
    `select quote_recurring_plan($1::jsonb)`, [JSON.stringify(billingInput)])));
  unsupportedBillingResults.push(await fails(() => as(customer, 'authenticated',
    `select create_recurring_plan($1::jsonb)`, [JSON.stringify(billingInput)])));
}
const plansAfterUnsupportedBilling = await one(
  `select count(*)::int n from recurring_schedules where customer_id=$1`, [customer]);
ok(unsupportedBillingResults.every(Boolean)
  && plansBeforeUnsupportedBilling.n === plansAfterUnsupportedBilling.n,
  '[RP-03/RP-23] weekly, monthly, and prepaid billing remain rejected even when all recurring flags are on');
await setFlag('recurring_prepaid_packages', false);
const prepaidOff = await fails(() => as(customer, 'authenticated',
  `select create_recurring_plan($1::jsonb)`,
  [JSON.stringify(input({ billing_frequency: 'prepaid_package', package_id: fixedPackage, archetype: 'fixed',
    provider_service_id: fixedService, package_qty: 1 }))]));
ok(!!prepaidOff, '[RP-23] prepaid package option is refused when its child flag is off');
await setFlag('recurring_prepaid_packages', true);
await setFlag('recurring_billing', false);
const billingOff = await fails(() => as(customer, 'authenticated',
  `select create_recurring_plan($1::jsonb)`,
  [JSON.stringify(input({ billing_frequency: 'weekly' }))]));
ok(!!billingOff, '[RP-23] weekly billing is refused when recurring billing is disabled');
await setFlag('recurring_billing', true);

// RP-05/RP-06/RP-09/RP-20: new plans wait for acceptance; authorized provider decisions generate once.
const planInput = input({ start_date: dateOffset(3), end_date: addDays(dateOffset(3), 2) });
const planId = await createPlan(planInput);
const pending = await one(`select provider_acceptance, acceptance_mode, status from recurring_schedules where id=$1`, [planId]);
ok(pending.provider_acceptance === 'pending' && pending.acceptance_mode === 'plan'
  && (await generatedBookings(planId)) === 0,
  '[RP-05] created plan is pending and has no occurrences');
const planRequestNotification = await one(`
  select count(*)::int n from notifications
   where user_id=$1 and kind='recurring_plan_requested'
     and data ->> 'recurring_schedule_id'=$2::text`, [provider, planId]);
ok(planRequestNotification.n > 0, '[RP-05] creating a plan notifies the provider');
await setFlag('recurring_plan_acceptance', false);
const occurrenceAcceptancePlan = await createPlan(input({
  start_date: dateOffset(13), end_date: dateOffset(13), start_time: '10:00',
}));
await as(null, 'service_role', `select generate_recurring_occurrences(100)`);
const occurrenceAcceptance = await one(`
  select r.acceptance_mode, r.provider_acceptance, count(b.id)::int visits,
         count(b.id) filter (where b.status::text='pending_payment')::int pending_payment
    from recurring_schedules r
    left join bookings b on b.recurring_schedule_id=r.id
   where r.id=$1 group by r.id`, [occurrenceAcceptancePlan]);
ok(occurrenceAcceptance.acceptance_mode === 'occurrence'
  && occurrenceAcceptance.provider_acceptance === 'accepted'
  && occurrenceAcceptance.visits === 1 && occurrenceAcceptance.pending_payment === 1,
  '[RP-11] disabling plan acceptance creates visits in the existing per-occurrence lifecycle');
const occurrenceBooking = (await one(`
  select id from bookings where recurring_schedule_id=$1`, [occurrenceAcceptancePlan])).id;
const occurrencePaymentAmount = (await one(`
  select sum(amount)::int amount from payment_schedule where booking_id=$1 and status='due'`,
  [occurrenceBooking])).amount;
const occurrencePayment = (await one(`
  insert into payments (booking_id, purpose, amount, status, razorpay_link_id)
  values ($1, 'session', $2, 'created', 'rp-occurrence-link') returning id`,
  [occurrenceBooking, occurrencePaymentAmount])).id;
await db.query(`
  insert into payment_obligations (payment_id, schedule_id, amount)
  select $1, id, amount from payment_schedule where booking_id=$2 and status='due'`,
  [occurrencePayment, occurrenceBooking]);
await as(null, 'service_role',
  `select record_session_payment_paid($1, $2, $3)`,
  ['rp-occurrence-link', 'rp-occurrence-paid', occurrencePaymentAmount]);
const paidOccurrenceStatus = await one(
  `select status::text status from bookings where id=$1`, [occurrenceBooking]);
await as(provider, 'authenticated', `select accept_booking($1)`, [occurrenceBooking]);
const acceptedOccurrenceStatus = await one(
  `select status::text status from bookings where id=$1`, [occurrenceBooking]);
ok(paidOccurrenceStatus.status === 'requested' && acceptedOccurrenceStatus.status === 'accepted',
  '[RP-11] a paid occurrence still follows the existing provider decision transition');
await setFlag('recurring_plan_acceptance', true);
const declinePlan = await createPlan(input({ start_date: dateOffset(14), end_date: dateOffset(14), start_time: '10:00' }));
const declineWithoutReason = await fails(() => as(manager, 'authenticated',
  `select respond_recurring_plan($1, false, null)`, [declinePlan]));
const declineWithReason = await fails(() => as(manager, 'authenticated',
  `select respond_recurring_plan($1, false, 'schedule full')`, [declinePlan]));
const declined = await one(`select status, provider_acceptance from recurring_schedules where id=$1`, [declinePlan]);
ok(!!declineWithoutReason && !declineWithReason && declined.status === 'cancelled'
  && declined.provider_acceptance === 'declined',
  '[RP-06] decline requires a reason and closes the pending plan');
const staffDecision = await fails(() => as(staff, 'authenticated',
  `select respond_recurring_plan($1, true, null)`, [planId]));
const unrelatedDecision = await fails(() => as(otherCustomer, 'authenticated',
  `select respond_recurring_plan($1, true, null)`, [planId]));
ok(!!staffDecision && !!unrelatedDecision,
  '[RP-20] non-manager staff and unrelated customers cannot decide a recurring plan');
const acceptError = await fails(() => as(manager, 'authenticated',
  `select respond_recurring_plan($1, true, null)`, [planId]));
const acceptedCount = await generatedBookings(planId);
const occurrenceLifecycle = await one(`
  select count(distinct b.id)::int visits,
         count(distinct b.id) filter (where b.status::text='pending_payment')::int pending_payment,
         count(ps.id)::int payment_obligations
    from bookings b
    left join payment_schedule ps on ps.booking_id=b.id
   where b.recurring_schedule_id=$1`, [planId]);
const firstRun = await as(null, 'service_role', `select generate_recurring_occurrences(100)`);
const secondRun = await as(null, 'service_role', `select generate_recurring_occurrences(100)`);
const finalCount = await generatedBookings(planId);
ok(!acceptError && acceptedCount === 3 && finalCount === 3
  && occurrenceLifecycle.visits === 3 && occurrenceLifecycle.pending_payment === 3
  && occurrenceLifecycle.payment_obligations === 6
  && Number(firstRun[0].generate_recurring_occurrences) >= 0
  && Number(secondRun[0].generate_recurring_occurrences) >= 0,
  `[RP-06/RP-09] manager acceptance creates individual payable visits and repeat generation is idempotent (${acceptError ?? 'ok'})`);

// RP-07/RP-09: the generator must create only dates selected by the recurrence rule.
const weeklyStart = dateOffset(3);
const weeklyPlan = await createPlan(input({
  frequency: 'weekly',
  weekdays: [isoDow(weeklyStart)],
  start_date: weeklyStart,
  end_date: addDays(weeklyStart, 60),
  start_time: '11:00',
}));
await as(manager, 'authenticated', `select respond_recurring_plan($1, true, null)`, [weeklyPlan]);
const weeklyOccurrences = await db.query(`
  select (scheduled_at at time zone 'Asia/Kolkata')::date::text date
    from bookings where recurring_schedule_id=$1 order by scheduled_at`, [weeklyPlan]);
const weeklyFirstRun = await generatedBookings(weeklyPlan);
await db.query(`update recurring_schedules set generated_through=$2::date, occurrences_created=0 where id=$1`,
  [weeklyPlan, addDays(weeklyStart, -1)]);
const weeklyRetry = await as(null, 'service_role',
  `select materialize_recurring_schedule($1, $2::date) created`,
  [weeklyPlan, dateOffset(28)]);
ok(JSON.stringify(weeklyOccurrences.rows.map((row) => row.date)) === JSON.stringify([
  weeklyStart, addDays(weeklyStart, 7), addDays(weeklyStart, 14), addDays(weeklyStart, 21),
]) && weeklyFirstRun === 4 && Number(weeklyRetry[0].created) === 0
  && (await generatedBookings(weeklyPlan)) === 4,
  '[RP-07/RP-09] weekly generation follows recurrence dates and remains idempotent on retry');

// RP-09/RP-10: fixed occurrences use their own package creator and stop at max_occurrences.
const fixedPlan = await createPlan(input({
  provider_service_id: fixedService, package_id: fixedPackage, archetype: 'fixed', package_qty: 1,
  frequency: 'daily', start_date: dateOffset(4), end_date: addDays(dateOffset(4), 3),
  max_occurrences: 2, duration_min: null, start_time: '12:00',
}));
await as(provider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [fixedPlan]);
const fixedRows = await db.query(
  `select archetype::text archetype, status::text status from bookings where recurring_schedule_id=$1 order by scheduled_at`,
  [fixedPlan]);
const fixedState = await one(`select status, occurrences_created from recurring_schedules where id=$1`, [fixedPlan]);
ok(fixedRows.rows.length === 2 && fixedRows.rows.every((row) => row.archetype === 'fixed')
  && fixedRows.rows.every((row) => row.status === 'pending_payment')
  && fixedState.status === 'completed' && fixedState.occurrences_created === 2,
  '[RP-09/RP-10] fixed generation creates package bookings and stops at max_occurrences');

// RP-12/RP-13: skip uses the existing cancellation/refund path, records once, and enforces the cutoff.
const skipPlan = await createPlan(input({ start_date: dateOffset(3), end_date: addDays(dateOffset(3), 1), start_time: '14:00' }));
await as(provider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [skipPlan]);
const skipBooking = (await one(
  `select id from bookings where recurring_schedule_id=$1 order by scheduled_at limit 1`, [skipPlan])).id;
await setFlag('recurring_skip_pause', false);
const skipOff = await fails(() => as(customer, 'authenticated',
  `select skip_recurring_visit($1, 'RP skip')`, [skipBooking]));
await setFlag('recurring_skip_pause', true);
const skipError = await fails(() => as(customer, 'authenticated',
  `select skip_recurring_visit($1, 'RP skip')`, [skipBooking]));
await as(customer, 'authenticated', `select skip_recurring_visit($1, 'RP skip')`, [skipBooking]);
const skipState = await one(`
  select b.status::text status, count(c.id)::int changes
    from bookings b left join recurring_occurrence_changes c
      on c.booking_id=b.id and c.kind='skipped'
   where b.id=$1 group by b.id`, [skipBooking]);
const skippedDate = (await one(`select (scheduled_at at time zone 'Asia/Kolkata')::date date from bookings where id=$1`, [skipBooking])).date;
const skipSchedule = await one(`select id from recurring_schedules where id=$1`, [skipPlan]);
await as(null, 'service_role', `select generate_recurring_occurrences(100)`);
const skippedDateBookings = await one(`
  select count(*)::int total,
         count(*) filter (where status::text <> 'cancelled')::int active
    from bookings
   where recurring_schedule_id=$1
     and (scheduled_at at time zone 'Asia/Kolkata')::date=$2::date`,
  [skipSchedule.id, skippedDate]);
ok(!!skipOff && !skipError && skipState.status === 'cancelled' && skipState.changes === 1
  && skippedDateBookings.total === 1 && skippedDateBookings.active === 0
  && (await generatedBookings(skipPlan)) === 2,
  '[RP-12] skip is idempotently recorded and remains excluded from occurrence generation');
const latePlan = await createPlan(input({ start_date: dateOffset(3), end_date: addDays(dateOffset(3), 1), start_time: '16:00' }));
await as(provider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [latePlan]);
const lateBooking = (await one(`select id from bookings where recurring_schedule_id=$1 order by scheduled_at limit 1`, [latePlan])).id;
await db.query(`update bookings set scheduled_at=now()+interval '2 hours',
  service_window=tstzrange(now()+interval '2 hours', now()+interval '3 hours','[)') where id=$1`, [lateBooking]);
const lateSkip = await fails(() => as(customer, 'authenticated',
  `select skip_recurring_visit($1, '')`, [lateBooking]));
ok(!!lateSkip, '[RP-13] skip after the configured cutoff is refused');

// RP-14: pause cancels only eligible unpaid future visits, and resume fills the schedule again.
const pausePlan = await createPlan(input({ start_date: dateOffset(3), end_date: null, start_time: '18:00' }));
await as(provider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [pausePlan]);
const pauseBefore = await generatedBookings(pausePlan);
await setFlag('recurring_skip_pause', false);
const pauseOff = await fails(() => as(customer, 'authenticated',
  `select pause_recurring_plan($1, null)`, [pausePlan]));
await setFlag('recurring_skip_pause', true);
const pauseError = await fails(() => as(customer, 'authenticated',
  `select pause_recurring_plan($1, null)`, [pausePlan]));
const paused = await one(`select status from recurring_schedules where id=$1`, [pausePlan]);
const cancelledDuringPause = await one(`
  select count(*)::int n from recurring_occurrence_changes
   where schedule_id=$1 and kind='cancelled'`, [pausePlan]);
await db.query(`update recurring_schedules set generated_through=$2::date where id=$1`,
  [pausePlan, dateOffset(27)]);
await as(customer, 'authenticated', `select resume_recurring_plan($1)`, [pausePlan]);
const resumed = await one(`select status from recurring_schedules where id=$1`, [pausePlan]);
ok(!!pauseOff && !pauseError && pauseBefore > 0 && cancelledDuringPause.n === pauseBefore
  && paused.status === 'paused' && resumed.status === 'active'
  && (await generatedBookings(pausePlan)) === pauseBefore + 1,
  '[RP-14/RP-23] pause cancels unpaid visits, child-off refuses pause, and resume materializes the next date');

// RP-15/RP-16: provider holiday/time off and occupied windows affect only the unavailable date.
const existingVisitPlan = await createPlan(input({
  start_date: dateOffset(15), end_date: dateOffset(16), start_time: '14:00',
}));
await as(provider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [existingVisitPlan]);
const existingVisitStatuses = (await db.query(
  `select status::text status from bookings where recurring_schedule_id=$1 order by scheduled_at`, [existingVisitPlan]))
  .rows.map((row) => row.status);
const holidayPlan = await insertSchedule({
  status: 'active', provider_acceptance: 'accepted', frequency: 'daily', weekdays: [],
  starts_on: dateOffset(17), ends_on: dateOffset(17), start_time: '10:00',
});
await db.query(`update providers set paused=true where id=$1`, [provider]);
await as(null, 'service_role', `select generate_recurring_occurrences(100)`);
const holidayState = await one(`
  select count(*)::int changes from recurring_occurrence_changes
   where schedule_id=$1 and kind='provider_unavailable'`, [holidayPlan]);
ok(holidayState.changes === 1 && (await generatedBookings(holidayPlan)) === 0,
  '[RP-15] provider holiday records one unavailable date and creates no booking');
const existingAfterHoliday = (await db.query(
  `select status::text status from bookings where recurring_schedule_id=$1 order by scheduled_at`, [existingVisitPlan]))
  .rows.map((row) => row.status);
ok(JSON.stringify(existingAfterHoliday) === JSON.stringify(existingVisitStatuses),
  '[RP-17] enabling provider holiday does not cancel already-created future visits');
await db.query(`update providers set paused=false where id=$1`, [provider]);
const timeOffDate = dateOffset(16);
const timeOffPlan = await insertSchedule({
  status: 'active', provider_acceptance: 'accepted', frequency: 'daily', weekdays: [],
  starts_on: timeOffDate, ends_on: timeOffDate, start_time: '10:00',
});
await db.query(`
  insert into provider_time_off (provider_id, period, reason)
  values ($1, tstzrange($2::date + time '04:30', $2::date + time '06:00', '[)'), 'RP time off')`,
  [provider, timeOffDate]);
await as(null, 'service_role', `select generate_recurring_occurrences(100)`);
const timeOffState = await one(`
  select count(*)::int n from recurring_occurrence_changes
   where schedule_id=$1 and kind='provider_unavailable'`, [timeOffPlan]);
ok(timeOffState.n === 1 && (await generatedBookings(timeOffPlan)) === 0,
  '[RP-15] provider time off records an unavailable date without a booking');

const overlapDate = dateOffset(18);
const blockerId = (await one(`
  select _create_session_booking(
    $1, $2, null, make_timestamptz(extract(year from $3::date)::int, extract(month from $3::date)::int,
      extract(day from $3::date)::int, 10, 0, 0, 'Asia/Kolkata'),
    60, 'Gate 3', 'Recurring City', 16.5, 80.61, 'blocking visit'
  ) id`, [otherCustomer, timeService, overlapDate])).id;
const partialPlan = await createPlan(input({
  frequency: 'daily', start_date: overlapDate, end_date: addDays(overlapDate, 1), start_time: '10:00',
}));
await as(provider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [partialPlan]);
const partialState = await one(`
  select count(*) filter (where kind='provider_unavailable')::int unavailable
    from recurring_occurrence_changes where schedule_id=$1`, [partialPlan]);
ok(partialState.unavailable === 1 && (await generatedBookings(partialPlan)) === 1,
  `[RP-16] an overlapping booking excludes only its occurrence (${blockerId})`);

// RP-18: rescheduling is consensual, checks availability, and updates the service window atomically.
const reschedulePlan = await createPlan(input({ start_date: dateOffset(20), end_date: dateOffset(20), start_time: '12:00' }));
await as(provider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [reschedulePlan]);
const rescheduleBooking = (await one(
  `select id, scheduled_at from bookings where recurring_schedule_id=$1`, [reschedulePlan])).id;
const newAt = `${addDays(dateOffset(20), 1)}T12:00:00+05:30`;
const changeId = (await as(customer, 'authenticated',
  `select request_visit_reschedule($1, $2::timestamptz, 'RP reschedule') id`,
  [rescheduleBooking, newAt]))[0].id;
const responseError = await fails(() => as(provider, 'authenticated',
  `select respond_visit_reschedule($1, true)`, [changeId]));
const moved = await one(`select scheduled_at from bookings where id=$1`, [rescheduleBooking]);
ok(!responseError && new Date(moved.scheduled_at).toISOString() === new Date(newAt).toISOString(),
  '[RP-18] the other party can accept and move a visit to an available window');
const declineAt = `${addDays(dateOffset(20), 2)}T12:00:00+05:30`;
const declineChange = (await as(customer, 'authenticated',
  `select request_visit_reschedule($1, $2::timestamptz, 'decline test') id`,
  [rescheduleBooking, declineAt]))[0].id;
await as(provider, 'authenticated', `select respond_visit_reschedule($1, false)`, [declineChange]);
const declinedChange = await one(`
  select count(*)::int n from recurring_occurrence_changes
   where booking_id=$1 and kind='reschedule_declined' and new_at=$2::timestamptz`,
  [rescheduleBooking, declineAt]);
const unchangedTime = await one(`select scheduled_at from bookings where id=$1`, [rescheduleBooking]);
ok(declinedChange.n === 1 && new Date(unchangedTime.scheduled_at).toISOString() === new Date(newAt).toISOString(),
  '[RP-18] declining a reschedule records the decision and leaves the visit time unchanged');
const rescheduleBlockerDate = addDays(dateOffset(20), 3);
await one(`
  select _create_session_booking(
    $1, $2, null, make_timestamptz(extract(year from $3::date)::int, extract(month from $3::date)::int,
      extract(day from $3::date)::int, 11, 0, 0, 'Asia/Kolkata'),
    60, 'Gate 3', 'Recurring City', 16.5, 80.61, 'reschedule blocker'
  ) id`, [otherCustomer, timeService, rescheduleBlockerDate]);
const blockedRequest = await fails(() => as(customer, 'authenticated',
  `select request_visit_reschedule($1, $2::timestamptz, 'occupied')`,
  [rescheduleBooking, `${rescheduleBlockerDate}T11:00:00+05:30`]));
ok(!!blockedRequest, '[RP-18] reschedule request into an occupied provider window is refused');
await db.query(`update bookings set scheduled_at=now()+interval '2 hours',
  service_window=tstzrange(now()+interval '2 hours', now()+interval '3 hours','[)') where id=$1`,
  [rescheduleBooking]);
const cutoffRequest = await fails(() => as(customer, 'authenticated',
  `select request_visit_reschedule($1, now()+interval '4 hours', 'late')`, [rescheduleBooking]));
ok(!!cutoffRequest, '[RP-18] reschedule requests after the configured cutoff are refused');
await setFlag('recurring_reschedule', false);
const rescheduleOff = await fails(() => as(customer, 'authenticated',
  `select request_visit_reschedule($1, $2::timestamptz, 'off')`,
  [rescheduleBooking, `${addDays(dateOffset(8), 1)}T10:00:00+05:30`]));
ok(!!rescheduleOff, '[RP-23] reschedule child flag off refuses a new request');
await setFlag('recurring_reschedule', true);

// RP-19: provider absence uses the provider-fault cancellation/refund path.
const absencePlan = await createPlan(input({ start_date: dateOffset(22), end_date: dateOffset(22), start_time: '16:00' }));
await as(provider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [absencePlan]);
const absenceBooking = (await one(
  `select id from bookings where recurring_schedule_id=$1`, [absencePlan])).id;
const paidAmount = (await one(`select amount from payment_schedule where booking_id=$1 and seq=1`, [absenceBooking])).amount;
const paidId = (await one(`
  insert into payments (booking_id, purpose, amount, status, razorpay_payment_id)
  values ($1, 'session', $2, 'paid', 'rp-paid-absence') returning id`,
  [absenceBooking, paidAmount])).id;
await db.query(`update payment_schedule set status='paid', payment_id=$2
  where booking_id=$1 and seq=1`, [absenceBooking, paidId]);
await setFlag('recurring_bookings', false);
const absenceError = await fails(() => as(provider, 'authenticated',
  `select report_provider_absence($1, 'provider unavailable')`, [absenceBooking]));
await setFlag('recurring_bookings', true);
const refundState = await one(`select status::text status, refund_amount from bookings where id=$1`, [absenceBooking]);
const refundTotal = await one(`select coalesce(sum(amount),0)::int amount from refunds where payment_id=$1`, [paidId]);
ok(!absenceError && refundState.status === 'cancelled' && refundTotal.amount === paidAmount,
  `[RP-19] provider absence cancels and fully refunds a paid visit with recurring disabled (${absenceError ?? 'ok'})`);

// RP-20: participants may read a plan; unrelated customers cannot inspect or mutate it.
const privatePlan = await createPlan(input({ start_date: dateOffset(23), end_date: dateOffset(23), start_time: '18:00' }));
await as(provider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [privatePlan]);
const otherRead = await fails(() => as(otherCustomer, 'authenticated',
  `select get_recurring_plan($1)`, [privatePlan]));
const otherSkip = await fails(() => as(otherCustomer, 'authenticated',
  `select skip_recurring_visit($1, '')`,
  [(await one(`select id from bookings where recurring_schedule_id=$1 limit 1`, [privatePlan])).id]));
const customerList = await as(customer, 'authenticated', `select list_my_recurring_plans() plans`);
const visiblePlan = (await as(customer, 'authenticated',
  `select get_recurring_plan($1) plan`, [privatePlan]))[0].plan;
const leakedChanges = await as(otherCustomer, 'authenticated',
  `select count(*)::int n from recurring_occurrence_changes`);
const providerChanges = await as(manager, 'authenticated',
  `select count(*)::int n from recurring_occurrence_changes where schedule_id=$1`, [skipPlan]);
ok(!!otherRead && !!otherSkip && Array.isArray(customerList[0].plans),
  '[RP-20] recurring-plan reads and mutations are participant-authorized');
ok(leakedChanges[0].n === 0, '[RP-20] occurrence change rows are hidden from unrelated customers by RLS');
ok(providerChanges[0].n === 1, '[RP-20] provider staff can read occurrence changes for their business');
ok(visiblePlan?.plan?.provider_acceptance === 'accepted'
  && Array.isArray(visiblePlan.occurrences) && Array.isArray(visiblePlan.changes)
  && visiblePlan.occurrences[0]?.id && visiblePlan.occurrences[0]?.scheduled_at
  && visiblePlan.occurrences[0]?.status,
  '[RP-20] plan JSON exposes provider decision, occurrence id/time/status, and change history');
const providerCalendar = await as(manager, 'authenticated',
  `select list_provider_recurring_schedule($1, $2::date, $3::date) rows`,
  [provider, dateOffset(23), dateOffset(23)]);
ok(Array.isArray(providerCalendar[0].rows) && providerCalendar[0].rows.some((row) => row.id),
  '[RP-20] an authorized provider manager can read recurring calendar rows');

// RP-21: the legacy RPC remains callable and still creates accepted weekly schedules.
const legacyStart = dateOffset(24);
const legacyId = await createLegacySchedule(timeService, legacyStart);
const legacy = await one(`select frequency, provider_acceptance, acceptance_mode from recurring_schedules where id=$1`, [legacyId]);
const legacyGen = await as(null, 'service_role', `select generate_recurring_sessions(100) n`);
ok(legacy.frequency === 'weekly' && legacy.provider_acceptance === 'accepted'
  && legacy.acceptance_mode === 'occurrence'
  && (await generatedBookings(legacyId)) === 1
  && Number(legacyGen[0].n) >= 1,
  '[RP-21] legacy weekly schedules retain accepted provider and per-occurrence behavior');

await db.query(`update categories set recurrence_allowed=false where id=$1`, [timeCategory]);
const legacyCategoryOff = await fails(() => createLegacySchedule(timeService, dateOffset(26)));
await db.query(`update categories set recurrence_allowed=true where id=$1`, [timeCategory]);
await db.query(`update categories set allowed_frequencies=array['daily']::text[] where id=$1`, [timeCategory]);
const legacyWeeklyOff = await fails(() => createLegacySchedule(timeService, dateOffset(27)));
await db.query(`update categories set allowed_frequencies=
  array['daily','alternate_days','weekly','monthly','custom']::text[] where id=$1`, [timeCategory]);

const legacyOpenStart = dateOffset(26);
const legacyOpenId = await createLegacySchedule(
  timeService, legacyOpenStart, addDays(legacyOpenStart, 30));
await as(null, 'service_role', `select generate_recurring_occurrences(100)`);
const legacyOpenBookingsBeforeCancel = await generatedBookings(legacyOpenId);
await setFlag('recurring_bookings', false);
const legacyCreateOff = await fails(() => createLegacySchedule(timeService, dateOffset(61)));
const legacyReadWhileOff = (await as(customer, 'authenticated',
  `select get_recurring_plan($1) plan`, [legacyOpenId]))[0].plan;
const legacyCancelWhileOff = await fails(() => as(customer, 'authenticated',
  `select cancel_recurring_schedule($1, true)`, [legacyOpenId]));
const legacyAfterCancel = await one(`
  select r.status, r.frequency, r.provider_acceptance, r.acceptance_mode,
         count(b.id) filter (where b.status::text='cancelled')::int cancelled_visits
    from recurring_schedules r left join bookings b on b.recurring_schedule_id=r.id
   where r.id=$1 group by r.id`, [legacyOpenId]);
ok(!!legacyCategoryOff && !!legacyWeeklyOff && legacyOpenBookingsBeforeCancel === 1 && !!legacyCreateOff
  && /turned off/i.test(legacyCreateOff) && !legacyCancelWhileOff
  && legacyReadWhileOff?.plan?.provider_acceptance === 'accepted'
  && legacyAfterCancel.status === 'cancelled'
  && legacyAfterCancel.frequency === 'weekly'
  && legacyAfterCancel.provider_acceptance === 'accepted'
  && legacyAfterCancel.acceptance_mode === 'occurrence'
  && legacyAfterCancel.cancelled_visits === 1,
  '[RP-21] new legacy schedules obey master/category gates while existing legacy plans remain readable and cancellable');
await setFlag('recurring_bookings', true);

// RP-22: reminder gating and collapse-key deduplication do not affect occurrence generation.
await db.query(`update app_config set value=jsonb_set(value, '{reminder_hours_before}', '720'::jsonb) where key='recurring_rules'`);
const reminderPlan = await createPlan(input({ start_date: dateOffset(25), end_date: dateOffset(25), start_time: '14:00' }));
await as(provider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [reminderPlan]);
const reminderOne = await as(null, 'service_role', `select queue_recurring_reminders() n`);
const reminderTwo = await as(null, 'service_role', `select queue_recurring_reminders() n`);
const reminderRows = await one(`
  select count(*)::int n from notifications
   where kind='recurring_visit_upcoming'
     and booking_id in (select id from bookings where recurring_schedule_id=$1)`, [reminderPlan]);
ok(Number(reminderOne[0].n) >= 0 && Number(reminderTwo[0].n) >= 0
  && reminderRows.n === 1,
  '[RP-22] reminder queue is idempotent for each upcoming visit');
await setFlag('recurring_reminders', false);
const reminderOff = await as(null, 'service_role', `select queue_recurring_reminders() n`);
const remindersOffPlan = await createPlan(input({
  start_date: dateOffset(26), end_date: dateOffset(26), start_time: '16:00',
}));
await as(provider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [remindersOffPlan]);
ok(Number(reminderOff[0].n) === 0 && (await generatedBookings(remindersOffPlan)) === 1,
  '[RP-22] reminders-off returns zero without stopping recurring generation');
await setFlag('recurring_reminders', true);

// RP-24: expected v2 category invalidation is recorded per date while the batch continues.
const invalidatedPlan = await insertSchedule({
  provider_service_id: fixedService,
  service_package_id: fixedPackage,
  archetype: 'fixed',
  package_qty: 1,
  status: 'active',
  provider_acceptance: 'accepted',
  frequency: 'daily',
  weekdays: [],
  starts_on: dateOffset(27),
  ends_on: dateOffset(60),
  start_time: '20:00',
});
const validBatchPlan = await insertSchedule({
  status: 'active',
  provider_acceptance: 'accepted',
  frequency: 'daily',
  weekdays: [],
  starts_on: dateOffset(28),
  ends_on: dateOffset(28),
  start_time: '21:00',
});
await db.query(`update recurring_schedules set plan_version='v2' where id in ($1, $2)`,
  [invalidatedPlan, validBatchPlan]);
await db.query(`update categories set recurrence_allowed=false where id=$1`, [fixedCategory]);
await setFlag('recurring_skip_pause', false);
const isolatedGeneration = await as(null, 'service_role',
  `select generate_recurring_occurrences(500) generated`);
const invalidatedState = await one(`
  select status, generated_through, paused_at from recurring_schedules where id=$1`, [invalidatedPlan]);
const invalidatedChanges = await one(`
  select count(*)::int n,
         count(*) filter (where reason='recurring service/category is no longer eligible')::int reasons
    from recurring_occurrence_changes
   where schedule_id=$1 and kind='provider_unavailable'`, [invalidatedPlan]);
const invalidatedNotices = await one(`
  select count(*)::int n from notifications
   where user_id=$1 and kind='recurring_visit_unavailable'
     and data ->> 'recurring_schedule_id'=$2::text`, [customer, invalidatedPlan]);
await db.query(`update recurring_schedules set generated_through=$2::date where id=$1`,
  [invalidatedPlan, dateOffset(26)]);
await as(null, 'service_role',
  `select materialize_recurring_schedule($1, $2::date)`,
  [invalidatedPlan, dateOffset(28)]);
const invalidatedRetry = await one(`
  select count(*)::int changes from recurring_occurrence_changes
   where schedule_id=$1 and kind='provider_unavailable'`, [invalidatedPlan]);
const noticesAfterRetry = await one(`
  select count(*)::int n from notifications
   where user_id=$1 and kind='recurring_visit_unavailable'
     and data ->> 'recurring_schedule_id'=$2::text`, [customer, invalidatedPlan]);
await db.query(`update categories set recurrence_allowed=true where id=$1`, [fixedCategory]);
await setFlag('recurring_skip_pause', true);
ok(invalidatedState.status === 'active' && invalidatedState.paused_at === null
  && invalidatedState.generated_through === dateOffset(28)
  && invalidatedChanges.n === 2 && invalidatedChanges.reasons === 2
  && invalidatedNotices.n === 2 && invalidatedRetry.changes === 2
  && noticesAfterRetry.n === 2
  && (await generatedBookings(validBatchPlan)) === 1
  && Number(isolatedGeneration[0].generated) >= 1,
  '[RP-24] category invalidation is per-date, notified/deduped, does not system-pause with skip/pause off, and does not starve a valid plan');

const verificationPlan = await insertSchedule({
  status: 'active',
  provider_acceptance: 'accepted',
  frequency: 'daily',
  weekdays: [],
  starts_on: dateOffset(27),
  ends_on: dateOffset(60),
  start_time: '17:00',
});
const verificationValidPlan = await insertSchedule({
  provider_service_id: fixedService,
  service_package_id: fixedPackage,
  archetype: 'fixed',
  package_qty: 1,
  status: 'active',
  provider_acceptance: 'accepted',
  frequency: 'daily',
  weekdays: [],
  starts_on: dateOffset(28),
  ends_on: dateOffset(28),
  start_time: '20:00',
});
await db.query(`update recurring_schedules set plan_version='v2' where id in ($1, $2)`,
  [verificationPlan, verificationValidPlan]);
await db.query(`update categories set requires_docs=array['police_verification']::text[] where id=$1`,
  [timeCategory]);
await db.query(`
  insert into provider_documents (provider_id, doc_type, category_id, status, expires_on, file_path)
  values ($1, 'police_verification', $2, 'approved', $3::date, 'expired-verification.pdf')`,
  [provider, timeCategory, dateOffset(-1)]);
await setFlag('recurring_skip_pause', false);
const verificationGeneration = await as(null, 'service_role',
  `select generate_recurring_occurrences(500) generated`);
const verificationState = await one(`
  select status, generated_through, paused_at from recurring_schedules where id=$1`, [verificationPlan]);
const verificationChanges = await one(`
  select count(*)::int n,
         count(*) filter (where reason='provider verification is incomplete')::int reasons
    from recurring_occurrence_changes
   where schedule_id=$1 and kind='provider_unavailable'`, [verificationPlan]);
const verificationNotices = await one(`
  select count(*)::int n from notifications
   where user_id=$1 and kind='recurring_visit_unavailable'
     and data ->> 'recurring_schedule_id'=$2::text`, [customer, verificationPlan]);
await db.query(`update recurring_schedules set generated_through=$2::date where id=$1`,
  [verificationPlan, dateOffset(26)]);
await as(null, 'service_role',
  `select materialize_recurring_schedule($1, $2::date)`,
  [verificationPlan, dateOffset(28)]);
const verificationRetry = await one(`
  select count(*)::int n from recurring_occurrence_changes
   where schedule_id=$1 and kind='provider_unavailable'`, [verificationPlan]);
const verificationNoticesAfterRetry = await one(`
  select count(*)::int n from notifications
   where user_id=$1 and kind='recurring_visit_unavailable'
     and data ->> 'recurring_schedule_id'=$2::text`, [customer, verificationPlan]);
await db.query(`update categories set requires_docs='{}'::text[] where id=$1`, [timeCategory]);
await setFlag('recurring_skip_pause', true);
ok(verificationState.status === 'active' && verificationState.paused_at === null
  && verificationState.generated_through === dateOffset(28)
  && verificationChanges.n === 2 && verificationChanges.reasons === 2
  && verificationNotices.n === 2 && verificationRetry.n === 2
  && verificationNoticesAfterRetry.n === 2
  && (await generatedBookings(verificationPlan)) === 0
  && (await generatedBookings(verificationValidPlan)) === 1
  && Number(verificationGeneration[0].generated) >= 1,
  '[RP-24] a verification lapse records/notifies unavailable dates without system pause and does not starve a valid plan');

const expiredPackId = await createPackFixture({ expired: true });
const depletedPackId = await createPackFixture({ sessionStatus: 'consumed' });
const expiredPackPlan = await insertSchedule({
  service_package_id: sessionPackage,
  pack_purchase_id: expiredPackId,
  payment_mode: 'pack_prepaid',
  billing_frequency: 'prepaid_package',
  status: 'active',
  provider_acceptance: 'accepted',
  frequency: 'daily',
  weekdays: [],
  starts_on: dateOffset(27),
  ends_on: dateOffset(60),
  start_time: '14:00',
});
const depletedPackPlan = await insertSchedule({
  service_package_id: sessionPackage,
  pack_purchase_id: depletedPackId,
  payment_mode: 'pack_prepaid',
  billing_frequency: 'prepaid_package',
  status: 'active',
  provider_acceptance: 'accepted',
  frequency: 'daily',
  weekdays: [],
  starts_on: dateOffset(27),
  ends_on: dateOffset(60),
  start_time: '15:00',
});
const packBatchValidPlan = await insertSchedule({
  provider_service_id: fixedService,
  service_package_id: fixedPackage,
  archetype: 'fixed',
  package_qty: 1,
  status: 'active',
  provider_acceptance: 'accepted',
  frequency: 'daily',
  weekdays: [],
  starts_on: dateOffset(28),
  ends_on: dateOffset(28),
  start_time: '22:00',
});
await setFlag('recurring_skip_pause', false);
const packGeneration = await as(null, 'service_role',
  `select generate_recurring_occurrences(500) generated`);
const packFailures = await db.query(`
  select schedule_id, occurrence_date::text occurrence_date, reason
    from recurring_occurrence_changes
   where schedule_id in ($1, $2) and kind='provider_unavailable'
   order by schedule_id, occurrence_date`, [expiredPackPlan, depletedPackPlan]);
const expiredPackState = await one(
  `select status, generated_through, paused_at from recurring_schedules where id=$1`, [expiredPackPlan]);
const depletedPackState = await one(
  `select status, generated_through, paused_at from recurring_schedules where id=$1`, [depletedPackPlan]);
const packNotices = await one(`
  select count(*)::int n from notifications
   where user_id=$1 and kind='recurring_visit_unavailable'
     and data ->> 'recurring_schedule_id' in ($2::text, $3::text)`,
  [customer, expiredPackPlan, depletedPackPlan]);
await db.query(`update recurring_schedules set generated_through=$2::date where id=$1`,
  [expiredPackPlan, dateOffset(26)]);
await as(null, 'service_role',
  `select materialize_recurring_schedule($1, $2::date)`,
  [expiredPackPlan, dateOffset(28)]);
const expiredPackRetry = await one(`
  select count(*)::int n from recurring_occurrence_changes
   where schedule_id=$1 and kind='provider_unavailable'`, [expiredPackPlan]);
const expiredPackNoticesAfterRetry = await one(`
  select count(*)::int n from notifications
   where user_id=$1 and kind='recurring_visit_unavailable'
     and data ->> 'recurring_schedule_id'=$2::text`, [customer, expiredPackPlan]);
await setFlag('recurring_skip_pause', true);
ok(packFailures.rows.length === 4
  && packFailures.rows.filter((row) => row.schedule_id === expiredPackPlan && /pack has expired/i.test(row.reason)).length === 2
  && packFailures.rows.filter((row) => row.schedule_id === depletedPackPlan && /pack has no unused sessions/i.test(row.reason)).length === 2
  && expiredPackState.status === 'active' && expiredPackState.paused_at === null
  && expiredPackState.generated_through === dateOffset(28)
  && depletedPackState.status === 'active' && depletedPackState.paused_at === null
  && depletedPackState.generated_through === dateOffset(28)
  && packNotices.n === 4 && expiredPackRetry.n === 2
  && expiredPackNoticesAfterRetry.n === 2
  && (await generatedBookings(expiredPackPlan)) === 0
  && (await generatedBookings(depletedPackPlan)) === 0
  && (await generatedBookings(packBatchValidPlan)) === 1
  && Number(packGeneration[0].generated) >= 1,
  '[RP-24] expired/exhausted packs are per-date unavailable, deduped/notified, and do not starve a valid plan');

// RP-26: unexpected database errors still fail the batch loudly.
const unexpectedPlan = await insertSchedule({
  status: 'active',
  provider_acceptance: 'accepted',
  frequency: 'daily',
  weekdays: [],
  starts_on: dateOffset(1),
  ends_on: dateOffset(1),
  timezone: 'not/a-timezone',
});
await db.query(`update recurring_schedules set plan_version='v2' where id=$1`, [unexpectedPlan]);
const unexpectedGenerationError = await fails(() => as(null, 'service_role',
  `select generate_recurring_occurrences(1)`));
ok(!!unexpectedGenerationError && /time zone/i.test(unexpectedGenerationError),
  '[RP-26] unclassified database errors propagate instead of being silently discarded');
await as(customer, 'authenticated',
  `select cancel_recurring_plan($1, 'cleanup after unexpected error assertion')`, [unexpectedPlan]);

// RP-25: recurring pending-payment visits keep their provider reservation beyond 30 minutes.
const reservationPlan = await createPlan(input({
  start_date: dateOffset(28), end_date: dateOffset(28), start_time: '07:00',
}));
await as(manager, 'authenticated', `select respond_recurring_plan($1, true, null)`, [reservationPlan]);
const reservedOccurrence = await one(`
  select id, scheduled_at from bookings where recurring_schedule_id=$1`, [reservationPlan]);
await db.query(`update bookings set created_at=now()-interval '31 minutes' where id=$1`,
  [reservedOccurrence.id]);
const staleWindowOverlap = await fails(() => one(`
  select _create_session_booking(
    $1, $2, null, $3::timestamptz, 60,
    'Gate 3', 'Recurring City', 16.5, 80.61, 'overlap after generic hold'
  ) id`, [otherCustomer, timeService, reservedOccurrence.scheduled_at]));
const reservationState = await one(`
  select b.status::text status, count(overlap.id)::int overlapping_rows
    from bookings b
    left join bookings overlap
      on overlap.provider_id=b.provider_id
     and overlap.scheduled_at=b.scheduled_at
     and overlap.id<>b.id
   where b.id=$1 group by b.id`, [reservedOccurrence.id]);
const reservationPaymentAmount = (await one(`
  select sum(amount)::int amount from payment_schedule where booking_id=$1 and status='due'`,
  [reservedOccurrence.id])).amount;
const reservationPayment = (await one(`
  insert into payments (booking_id, purpose, amount, status, razorpay_link_id)
  values ($1, 'session', $2, 'created', 'rp-stale-window-link') returning id`,
  [reservedOccurrence.id, reservationPaymentAmount])).id;
await db.query(`
  insert into payment_obligations (payment_id, schedule_id, amount)
  select $1, id, amount from payment_schedule where booking_id=$2 and status='due'`,
  [reservationPayment, reservedOccurrence.id]);
await as(null, 'service_role',
  `select record_session_payment_paid($1, $2, $3)`,
  ['rp-stale-window-link', 'rp-stale-window-paid', reservationPaymentAmount]);
const reservationAfterPayment = await one(
  `select status::text status from bookings where id=$1`, [reservedOccurrence.id]);
ok(!!staleWindowOverlap && reservationState.status === 'pending_payment'
  && reservationState.overlapping_rows === 0 && reservationAfterPayment.status === 'requested',
  '[RP-25] a stale pending recurring occurrence blocks overlaps and still follows its payment lifecycle');

const oneTimeSlot = indiaSlot(60, 15);
const oneTimePending = (await one(`
  select _create_session_booking(
    $1, $2, null, $3::timestamptz, 15,
    'Gate 3', 'Recurring City', 16.5, 80.61, 'one-time pending before recurring'
  ) id`, [otherCustomer, timeService, oneTimeSlot.at.toISOString()])).id;
await db.query(`update bookings set created_at=now()-interval '31 minutes' where id=$1`,
  [oneTimePending]);
const overlapPlan = await createPlan(nearTermPlanInput(timeService, oneTimeSlot));
await as(manager, 'authenticated', `select respond_recurring_plan($1, true, null)`, [overlapPlan]);
const overlapOccurrencesBeforePayment = await generatedBookings(overlapPlan);
const oneTimeRecurringOverlap = await one(`
  select count(*)::int n
    from bookings one_time
    join bookings recurring on recurring.recurring_schedule_id=$2
   where one_time.id=$1 and one_time.service_window && recurring.service_window`,
  [oneTimePending, overlapPlan]);
const oneTimeAmount = (await one(`
  select sum(amount)::int amount from payment_schedule where booking_id=$1 and status='due'`,
  [oneTimePending])).amount;
const oneTimePayment = (await one(`
  insert into payments (booking_id, purpose, amount, status, razorpay_link_id)
  values ($1, 'session', $2, 'created', 'rp-status-only-link') returning id`,
  [oneTimePending, oneTimeAmount])).id;
await db.query(`
  insert into payment_obligations (payment_id, schedule_id, amount)
  select $1, id, amount from payment_schedule where booking_id=$2 and status='due'`,
  [oneTimePayment, oneTimePending]);
const oneTimePaymentError = await fails(() => as(null, 'service_role',
  `select record_session_payment_paid($1, $2, $3)`,
  ['rp-status-only-link', 'rp-status-only-paid', oneTimeAmount]));
const oneTimePaymentState = await one(`
  select b.status::text booking_status, p.status payment_status
    from bookings b join payments p on p.booking_id=b.id
   where b.id=$1`, [oneTimePending]);
ok(!oneTimePaymentError && oneTimePaymentState.booking_status === 'requested'
  && oneTimePaymentState.payment_status === 'paid' && overlapOccurrencesBeforePayment === 1
  && oneTimeRecurringOverlap.n === 1
  && (await generatedBookings(overlapPlan)) === 1,
  '[RP-25] a status-only webhook transition succeeds despite an existing recurring overlap and creates no duplicate');

// RP-27: provider acceptance, auto-accept, and legacy creation synchronously materialize near-term visits.
const respondSlot = indiaSlot(35, 15);
const respondPlan = await createPlan(nearTermPlanInput(syncService, respondSlot));
const respondCountBefore = await generatedBookings(respondPlan);
await as(syncProvider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [respondPlan]);
const respondOccurrencesBeforeCron = await generatedBookings(respondPlan);
const respondFirstAt = (await one(
  `select min(scheduled_at) at from bookings where recurring_schedule_id=$1`, [respondPlan])).at;
const respondLeadMinutes = (new Date(respondFirstAt).getTime() - Date.now()) / 60_000;

const autoSlot = indiaSlot(55, 15);
await setFlag('recurring_plan_acceptance', false);
const autoPlan = await createPlan(nearTermPlanInput(autoService, autoSlot));
const autoState = await one(`
  select provider_acceptance, acceptance_mode from recurring_schedules where id=$1`, [autoPlan]);
const autoOccurrencesBeforeCron = await generatedBookings(autoPlan);
const autoFirstAt = (await one(
  `select min(scheduled_at) at from bookings where recurring_schedule_id=$1`, [autoPlan])).at;
const autoLeadMinutes = (new Date(autoFirstAt).getTime() - Date.now()) / 60_000;
await setFlag('recurring_plan_acceptance', true);

const legacySlot = indiaSlot(75, 15);
const legacySoonPlan = await createLegacySchedule(
  legacyService, legacySlot.date, addDays(legacySlot.date, 60), legacySlot.time, 15);
const legacyOccurrencesBeforeCron = await generatedBookings(legacySoonPlan);
const legacyFirstAt = (await one(
  `select min(scheduled_at) at from bookings where recurring_schedule_id=$1`, [legacySoonPlan])).at;
const legacyLeadMinutes = (new Date(legacyFirstAt).getTime() - Date.now()) / 60_000;

await as(null, 'service_role', `select generate_recurring_occurrences(500)`);
ok(respondCountBefore === 0 && respondOccurrencesBeforeCron === 1
  && respondLeadMinutes >= 30 && respondLeadMinutes <= 90
  && autoState.provider_acceptance === 'accepted' && autoState.acceptance_mode === 'occurrence'
  && autoOccurrencesBeforeCron === 1 && autoLeadMinutes >= 30 && autoLeadMinutes <= 90
  && legacyOccurrencesBeforeCron > 0 && legacyLeadMinutes >= 30 && legacyLeadMinutes <= 90
  && (await generatedBookings(respondPlan)) === respondOccurrencesBeforeCron
  && (await generatedBookings(autoPlan)) === autoOccurrencesBeforeCron
  && (await generatedBookings(legacySoonPlan)) === legacyOccurrencesBeforeCron,
  '[RP-27] all acceptance paths materialize 30–90-minute first visits synchronously and cron remains idempotent');

// RP-28: per-visit due/grace rules expire only unpaid occurrences and release their windows.
await db.query(`update app_config
  set value=jsonb_set(jsonb_set(value, '{payment_due_hours_before}', '4'::jsonb),
                      '{billing_grace_hours}', '3'::jsonb)
  where key='recurring_rules'`);
await db.query(`
  update payment_schedule ps
     set due_at=now()+interval '10 days'
    from bookings b
   where ps.booking_id=b.id
     and b.recurring_schedule_id is not null
     and b.status::text='pending_payment'
     and ps.status in ('due','upcoming')`);

const expiryDay = dateOffset(27);
const unexpiredPlan = await createPlan(input({
  provider_service_id: syncService, frequency: 'custom', custom_dates: [expiryDay],
  start_date: expiryDay, end_date: null, start_time: '08:00', duration_min: 60,
}));
await as(syncProvider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [unexpiredPlan]);
const unexpiredOccurrence = await one(`
  select id, scheduled_at from bookings where recurring_schedule_id=$1`, [unexpiredPlan]);
const timeDueAt = await one(`
  select count(*)::int n,
         bool_and(ps.due_at=b.scheduled_at-interval '4 hours') correct
    from bookings b join payment_schedule ps on ps.booking_id=b.id
   where b.recurring_schedule_id=$1`, [unexpiredPlan]);

const overdueTimePlan = await createPlan(input({
  provider_service_id: autoService, frequency: 'custom', custom_dates: [expiryDay],
  start_date: expiryDay, end_date: null, start_time: '09:00', duration_min: 60,
}));
await as(autoProvider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [overdueTimePlan]);
const overdueTimeOccurrence = await one(`
  select id, scheduled_at from bookings where recurring_schedule_id=$1`, [overdueTimePlan]);
const overdueTimePayment = await prepareSessionPayment(overdueTimeOccurrence.id, 'rp-expiring-time-link');

const paidTimePlan = await createPlan(input({
  provider_service_id: legacyService, frequency: 'custom', custom_dates: [expiryDay],
  start_date: expiryDay, end_date: null, start_time: '10:00', duration_min: 60,
}));
await as(legacyProvider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [paidTimePlan]);
const paidTimeOccurrence = await one(`
  select id from bookings where recurring_schedule_id=$1`, [paidTimePlan]);
const paidTimePayment = await prepareSessionPayment(paidTimeOccurrence.id, 'rp-paid-before-expiry-link');
await as(null, 'service_role',
  `select record_session_payment_paid($1, $2, $3)`,
  ['rp-paid-before-expiry-link', 'rp-paid-before-expiry', paidTimePayment.amount]);

const overdueFixedPlan = await createPlan(input({
  provider_service_id: fixedService, package_id: fixedPackage, archetype: 'fixed',
  package_qty: 1, frequency: 'custom', custom_dates: [expiryDay],
  start_date: expiryDay, end_date: null, start_time: '12:00', duration_min: null,
}));
await as(manager, 'authenticated', `select respond_recurring_plan($1, true, null)`, [overdueFixedPlan]);
const overdueFixedOccurrence = await one(`
  select id, scheduled_at from bookings where recurring_schedule_id=$1`, [overdueFixedPlan]);
const partialFixedPayment = (await as(null, 'service_role',
  `select payment_id, amount from prepare_fixed_payment($1, $2, null)`,
  [overdueFixedOccurrence.id, customer]))[0];
await db.query(`update payments set razorpay_link_id='rp-partially-paid-fixed-link' where id=$1`,
  [partialFixedPayment.payment_id]);
const partialFixedSettlement = (await as(null, 'service_role',
  `select record_payment_paid($1, $2, $3) result`,
  ['rp-partially-paid-fixed-link', 'rp-partially-paid-fixed', partialFixedPayment.amount]))[0].result;
const overdueFixedPayment = (await as(null, 'service_role',
  `select payment_id, amount from prepare_fixed_payment($1, $2, null)`,
  [overdueFixedOccurrence.id, customer]))[0];
await db.query(`update payments set razorpay_link_id='rp-expiring-fixed-link' where id=$1`,
  [overdueFixedPayment.payment_id]);
const fixedDueAt = await one(`
  select count(*)::int n,
         bool_and(ps.due_at=b.scheduled_at-interval '4 hours') correct
    from bookings b join payment_schedule ps on ps.booking_id=b.id
   where b.recurring_schedule_id=$1`, [overdueFixedPlan]);
ok(timeDueAt.n === 2 && timeDueAt.correct && fixedDueAt.n === 2 && fixedDueAt.correct,
  '[RP-28] time-based and fixed occurrences set due_at from payment_due_hours_before');

await db.query(`update bookings set created_at=now()-interval '31 minutes' where id=$1`,
  [unexpiredOccurrence.id]);
await db.query(`update payment_schedule set due_at=now()-interval '2 hours' where booking_id=$1 and status in ('due','upcoming')`,
  [unexpiredOccurrence.id]);
const graceProtectedOverlap = await fails(() => one(`
  select _create_session_booking(
    $1, $2, null, $3::timestamptz, 60,
    'Gate 3', 'Recurring City', 16.5, 80.61, 'inside recurring payment grace'
  ) id`, [otherCustomer, syncService, unexpiredOccurrence.scheduled_at]));

await db.query(`update payment_schedule set due_at=now()-interval '4 hours'
  where booking_id=$1 and status in ('due','upcoming')`, [overdueTimeOccurrence.id]);
await db.query(`update payment_schedule set due_at=now()-interval '4 hours'
  where booking_id=$1 and status in ('due','upcoming')`, [overdueFixedOccurrence.id]);
await db.query(`update payment_schedule set due_at=now()-interval '4 hours'
  where booking_id=$1`, [paidTimeOccurrence.id]);

const expiryRun = await as(null, 'service_role',
  `select expire_recurring_occurrences(500) n`);
const secondExpiryRun = await as(null, 'service_role',
  `select expire_recurring_occurrences(500) n`);
const expiryClientAccess = await fails(() =>
  as(customer, 'authenticated', `select expire_recurring_occurrences(1) n`));
const unexpiredState = await one(`
  select b.status::text status, count(ps.id) filter (where ps.status='waived')::int waived
    from bookings b left join payment_schedule ps on ps.booking_id=b.id
   where b.id=$1 group by b.id`, [unexpiredOccurrence.id]);
const overdueTimeState = await one(`
  select b.status::text status,
         count(ps.id) filter (where ps.status='waived')::int waived,
         p.status payment_status, p.cancel_link_pending
    from bookings b
    join payments p on p.booking_id=b.id
    left join payment_schedule ps on ps.booking_id=b.id
   where b.id=$1 group by b.id, p.status, p.cancel_link_pending`, [overdueTimeOccurrence.id]);
const overdueFixedState = await one(`
  select b.status::text status,
         count(ps.id) filter (where ps.status='waived')::int waived,
         count(ps.id) filter (where ps.status='paid')::int paid_obligations
    from bookings b left join payment_schedule ps on ps.booking_id=b.id
   where b.id=$1 group by b.id`, [overdueFixedOccurrence.id]);
const paidBeforeExpiryState = await one(`
  select b.status::text status,
         count(ps.id) filter (where ps.status='paid')::int paid_obligations
    from bookings b left join payment_schedule ps on ps.booking_id=b.id
   where b.id=$1 group by b.id`, [paidTimeOccurrence.id]);
const expiryNoticeCount = await one(`
  select count(*)::int n from notifications
   where kind='recurring_visit_unavailable'
     and data ->> 'booking_id' in ($1::text, $2::text)`,
  [overdueTimeOccurrence.id, overdueFixedOccurrence.id]);
ok(!!graceProtectedOverlap && unexpiredState.status === 'pending_payment'
  && unexpiredState.waived === 0 && overdueTimeState.status === 'expired'
  && overdueTimeState.waived === 2 && overdueTimeState.payment_status === 'failed'
  && overdueTimeState.cancel_link_pending === true
  && partialFixedSettlement?.ok === true && partialFixedSettlement?.refund !== true
  && overdueFixedState.status === 'expired' && overdueFixedState.waived === 1
  && overdueFixedState.paid_obligations === 1
  && paidBeforeExpiryState.status === 'requested' && paidBeforeExpiryState.paid_obligations === 2
  && Number(expiryRun[0].n) >= 2 && Number(secondExpiryRun[0].n) === 0
  && !!expiryClientAccess
  && expiryNoticeCount.n === 4,
  '[RP-28] service-role due-plus-grace expiry releases unpaid time/fixed holds, preserves unexpired and paid visits, and notifies once');

const lateWebhookResult = (await as(null, 'service_role',
  `select record_session_payment_paid($1, $2, $3) result`,
  ['rp-expiring-time-link', 'rp-expiring-time-paid', overdueTimePayment.amount]))[0].result;
const lateFixedWebhookResult = (await as(null, 'service_role',
  `select record_payment_paid($1, $2, $3) result`,
  ['rp-expiring-fixed-link', 'rp-expiring-fixed-paid', overdueFixedPayment.amount]))[0].result;
const lateWebhookState = await one(`
  select b.status::text booking_status,
         coalesce(sum(r.amount),0)::int refunded
    from bookings b
    left join payments p on p.booking_id=b.id
    left join refunds r on r.payment_id=p.id
   where b.id=$1 group by b.id`, [overdueTimeOccurrence.id]);
const lateFixedWebhookState = await one(`
  select b.status::text booking_status,
          coalesce(sum(r.amount),0)::int refunded
     from bookings b
     left join payments p on p.booking_id=b.id
     left join refunds r on r.payment_id=p.id
    where b.id=$1 group by b.id`, [overdueFixedOccurrence.id]);
const replacementBooking = await one(`
  select _create_session_booking(
    $1, $2, null, $3::timestamptz, 15,
    'Gate 3', 'Recurring City', 16.5, 80.61, 'replacement after recurring expiry'
  ) id`, [otherCustomer, timeService, overdueFixedOccurrence.scheduled_at]);
await db.query(`update bookings set recurring_schedule_id=null where id=$1`, [overdueTimeOccurrence.id]);
await db.query(`update recurring_schedules set generated_through=$2::date, occurrences_created=0 where id=$1`,
  [overdueTimePlan, addDays(expiryDay, -1)]);
const expiryRetry = await as(null, 'service_role',
  `select materialize_recurring_schedule($1, $2::date) created`,
  [overdueTimePlan, addDays(expiryDay, 1)]);
await db.query(`update app_config
  set value=jsonb_set(jsonb_set(value, '{payment_due_hours_before}', '48'::jsonb),
                      '{billing_grace_hours}', '24'::jsonb)
  where key='recurring_rules'`);
ok(lateWebhookResult?.refund === true
  && lateWebhookState.booking_status === 'expired'
  && lateWebhookState.refunded === overdueTimePayment.amount
  && lateFixedWebhookResult?.refund === true
  && lateFixedWebhookState.booking_status === 'expired'
  && lateFixedWebhookState.refunded === partialFixedPayment.amount + overdueFixedPayment.amount
  && replacementBooking.id
  && Number(expiryRetry[0].created) === 0
  && (await generatedBookings(overdueTimePlan)) === 0,
  '[RP-28] late time-based and fixed webhooks refund rather than resurrecting expired visits, and generation does not recreate them');

// RP-29: the 48/24 default lets the expiry job free a still-future service window.
const preServiceSlot = indiaSlot(20 * 60, 60);
const preServicePlan = await createPlan(input({
  provider_service_id: syncService,
  frequency: 'custom',
  custom_dates: [preServiceSlot.date],
  start_date: preServiceSlot.date,
  end_date: null,
  start_time: preServiceSlot.time,
  duration_min: 60,
}));
await as(syncProvider, 'authenticated', `select respond_recurring_plan($1, true, null)`, [preServicePlan]);
const preServiceOccurrence = await one(`
  select id, scheduled_at from bookings where recurring_schedule_id=$1`, [preServicePlan]);
const defaultDueWindow = await one(`
  select count(*)::int n,
         bool_and(ps.due_at=b.scheduled_at-interval '48 hours') due_matches,
         bool_and(ps.due_at+interval '24 hours' < b.scheduled_at) expires_before_start,
         bool_and(b.scheduled_at > now()) service_future
    from bookings b join payment_schedule ps on ps.booking_id=b.id
   where b.recurring_schedule_id=$1`, [preServicePlan]);
await db.query(`update app_config
  set value=jsonb_set(jsonb_set(value, '{payment_due_hours_before}', '72'::jsonb),
                      '{billing_grace_hours}', '24'::jsonb)
  where key='recurring_rules'`);
const dueAfterRuleChange = await one(`
  select count(*)::int n,
         bool_and(ps.due_at=b.scheduled_at-interval '72 hours') correct
    from bookings b join payment_schedule ps on ps.booking_id=b.id
   where b.recurring_schedule_id=$1`, [preServicePlan]);
await db.query(`update app_config
  set value=jsonb_set(jsonb_set(value, '{payment_due_hours_before}', '48'::jsonb),
                      '{billing_grace_hours}', '24'::jsonb)
  where key='recurring_rules'`);
const dueAfterDefaultRestore = await one(`
  select count(*)::int n,
         bool_and(ps.due_at=b.scheduled_at-interval '48 hours') correct
    from bookings b join payment_schedule ps on ps.booking_id=b.id
   where b.recurring_schedule_id=$1`, [preServicePlan]);
const preServiceExpiryRun = await as(null, 'service_role',
  `select expire_recurring_occurrences(500) n`);
const preServiceState = await one(`
  select b.status::text status, b.scheduled_at > now() service_future,
         count(ps.id) filter (where ps.status='waived')::int waived
    from bookings b left join payment_schedule ps on ps.booking_id=b.id
   where b.id=$1 group by b.id`, [preServiceOccurrence.id]);
let releasedFutureSlot;
const releasedFutureSlotError = await fails(async () => {
  releasedFutureSlot = await one(`
    select _create_session_booking(
      $1, $2, null, $3::timestamptz, 60,
      'Gate 3', 'Recurring City', 16.5, 80.61, 'slot released before recurring service'
    ) id`, [otherCustomer, syncService, preServiceOccurrence.scheduled_at]);
});
ok(defaultDueWindow.n === 2 && defaultDueWindow.due_matches
  && defaultDueWindow.expires_before_start && defaultDueWindow.service_future
  && dueAfterRuleChange.n === 2 && dueAfterRuleChange.correct
  && dueAfterDefaultRestore.n === 2 && dueAfterDefaultRestore.correct
  && preServiceState.status === 'expired' && preServiceState.service_future
  && preServiceState.waived === 2 && Number(preServiceExpiryRun[0].n) >= 1
  && !releasedFutureSlotError && !!releasedFutureSlot?.id,
  '[RP-29] 48/24 rules release an overdue unpaid visit and its provider window before the future service time');

// RP-30: one deactivated legacy service is recorded per date and does not starve a valid plan.
const inactiveLegacyDate = dateOffset(27);
const inactiveLegacyPlan = await insertSchedule({
  provider_id: legacyProvider,
  provider_service_id: legacyService,
  frequency: 'custom',
  weekdays: [],
  custom_dates: [inactiveLegacyDate],
  starts_on: inactiveLegacyDate,
  ends_on: null,
  start_time: '11:00',
  status: 'active',
  provider_acceptance: 'accepted',
  acceptance_mode: 'occurrence',
});
const sameBatchValidPlan = await insertSchedule({
  customer_id: otherCustomer,
  provider_id: syncProvider,
  provider_service_id: syncService,
  frequency: 'custom',
  weekdays: [],
  custom_dates: [inactiveLegacyDate],
  starts_on: inactiveLegacyDate,
  ends_on: null,
  start_time: '13:00',
  address_line: 'Gate 3',
  lat: 16.5,
  lng: 80.61,
  status: 'active',
  provider_acceptance: 'accepted',
  acceptance_mode: 'occurrence',
});
await db.query(`update recurring_schedules set generated_through=$2::date where id in ($1,$3)`,
  [inactiveLegacyPlan, addDays(inactiveLegacyDate, -1), sameBatchValidPlan]);
await db.query(`update provider_services set active=false where id=$1`, [legacyService]);
await setFlag('recurring_skip_pause', false);
let legacyServiceBatch;
const legacyServiceBatchError = await fails(async () => {
  legacyServiceBatch = await as(null, 'service_role',
    `select generate_recurring_occurrences(500) generated`);
});
const inactiveLegacyState = await one(`
  select plan_version, status, generated_through from recurring_schedules where id=$1`,
  [inactiveLegacyPlan]);
const inactiveLegacyChanges = await one(`
  select count(*)::int n, bool_and(reason='service not available') exact_reason
    from recurring_occurrence_changes
   where schedule_id=$1 and occurrence_date=$2::date and kind='provider_unavailable'`,
  [inactiveLegacyPlan, inactiveLegacyDate]);
const inactiveLegacyNotices = await one(`
  select count(*)::int n from notifications
   where user_id=$1 and kind='recurring_visit_unavailable'
     and data ->> 'recurring_schedule_id'=$2::text`,
  [customer, inactiveLegacyPlan]);
await db.query(`update recurring_schedules set generated_through=$2::date where id=$1`,
  [inactiveLegacyPlan, addDays(inactiveLegacyDate, -1)]);
await as(null, 'service_role',
  `select materialize_recurring_schedule($1, $2::date)`,
  [inactiveLegacyPlan, inactiveLegacyDate]);
const inactiveLegacyChangesAfterRetry = await one(`
  select count(*)::int n from recurring_occurrence_changes
   where schedule_id=$1 and occurrence_date=$2::date and kind='provider_unavailable'`,
  [inactiveLegacyPlan, inactiveLegacyDate]);
const inactiveLegacyNoticesAfterRetry = await one(`
  select count(*)::int n from notifications
   where user_id=$1 and kind='recurring_visit_unavailable'
     and data ->> 'recurring_schedule_id'=$2::text`,
  [customer, inactiveLegacyPlan]);
await db.query(`update provider_services set active=true where id=$1`, [legacyService]);
await setFlag('recurring_skip_pause', true);
ok(inactiveLegacyState.plan_version === 'legacy' && inactiveLegacyState.status === 'active'
  && inactiveLegacyState.generated_through === dateOffset(28)
  && inactiveLegacyChanges.n === 1 && inactiveLegacyChanges.exact_reason
  && inactiveLegacyNotices.n === 1 && inactiveLegacyChangesAfterRetry.n === 1
  && inactiveLegacyNoticesAfterRetry.n === 1
  && (await generatedBookings(inactiveLegacyPlan)) === 0
  && (await generatedBookings(sameBatchValidPlan)) === 1
  && !legacyServiceBatchError
  && Number(legacyServiceBatch?.[0]?.generated ?? 0) >= 1,
  '[RP-30] inactive legacy service errors become deduped per-date unavailability without starving a valid batch plan');

if (failures > 0) process.exitCode = 1;

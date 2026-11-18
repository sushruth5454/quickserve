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
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, phone text, phone_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}', created_at timestamptz, updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const migrationFiles = [
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
  '0057_recurring_plans_v2.sql', '0058_sports_payments.sql',
];

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(prelude);
for (const file of migrationFiles) {
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
await db.exec(`update app_config set value = value || '{"inspect_quote":true}'::jsonb where key = 'archetype_flags'`);

let failures = 0;
const assert = (condition, name, actual) => {
  if (!condition) throw new Error(`${name}: ${JSON.stringify(actual)}`);
};
async function scenario(name, run) {
  try {
    await run();
    console.log(`ok  : ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL: ${name}: ${error.stack ?? error.message}`);
  }
}
async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const CITY = 'T2 Lifecycle City';
const ADMIN = '00000000-0000-0000-0000-000000000901';

async function createFixture(label, customer, provider, customerPhone, providerPhone) {
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data) values
      ($1::uuid, $2::text, '{}'::jsonb), ($3::uuid, $4::text, '{}'::jsonb)
  `, [customer, customerPhone, provider, providerPhone]);
  await db.query(`update profiles set full_name = $1::text where id in ($2::uuid, $3::uuid)`,
    [`${label} user`, customer, provider]);
  await as(provider, 'authenticated', `
    select upsert_provider_profile(
      $1::text, $2::text, $3::text, $4::int, $5::double precision,
      $6::double precision, $7::int, $8::text[]
    )
  `, [`${label} provider`, 'Lifecycle test provider', CITY, 15, 16.5, 80.6, 5, ['en']]);
  await as(null, 'service_role', `select sync_provider_kyc($1::uuid, $2::text, $3::text)`,
    [provider, `acc_${label}`, 'activated']);
  await as(null, 'service_role', `
    update providers
       set submitted_at = now(), created_at = now() - interval '90 days',
           is_online = true, paused = false, suspended = false
     where id = $1::uuid
  `, [provider]);

  const categoryId = (await one(`
    insert into categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      min_lead_hours, max_lead_days, restricted, requires_docs, cancellation_policy
    ) values (
      $1::text, $2::text, 'quote', true, 'inspect_quote', '{}'::jsonb, 1,
      0, 365, false, '{}'::text[], 'standard_visit'
    ) returning id
  `, [label, `${label} service`])).id;
  await db.query(`
    insert into category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [categoryId, CITY]);
  const serviceId = (await db.query(`
    insert into provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 19900, 50000, true)
    returning id
  `, [provider, categoryId])).rows[0].id;
  await db.query(`
    insert into provider_availability (provider_id, weekday, start_time, end_time)
    select $1::uuid, day::smallint, time '00:00', time '23:59'
      from generate_series(0, 6) day
  `, [provider]);
  return { label, customer, provider, categoryId, serviceId };
}

async function createBooking(fixture, scheduledAt, description = `${fixture.label} visit`) {
  return (await as(fixture.customer, 'authenticated', `
    select create_booking(
      $1::uuid, $2::text, $3::text, $4::text,
      $5::double precision, $6::double precision, $7::timestamptz
    ) booking_id
  `, [
    fixture.serviceId, description, `${fixture.label} address`, CITY, 16.5, 80.6, scheduledAt,
  ]))[0].booking_id;
}

async function status(bookingId) {
  return (await one(`select status::text status from bookings where id = $1::uuid`, [bookingId])).status;
}

async function pay(bookingId, customer) {
  const prepared = (await as(null, 'service_role', `
    select * from prepare_payment($1::uuid, $2::uuid)
  `, [bookingId, customer]))[0];
  assert(prepared?.payment_id && prepared.amount > 0, 'payment is prepared', prepared);
  const link = `link_${bookingId.replaceAll('-', '').slice(0, 20)}`;
  const gatewayPaymentId = `pay_${bookingId.replaceAll('-', '').slice(0, 20)}`;
  await as(null, 'service_role', `
    update payments set razorpay_link_id = $1::text, short_url = $2::text
     where id = $3::uuid
  `, [link, 'https://pay.test/ws2', prepared.payment_id]);
  const result = (await as(null, 'service_role', `
    select record_payment_paid($1::text, $2::text, $3::int) result
  `, [link, gatewayPaymentId, prepared.amount]))[0].result;
  return { ...prepared, link, gatewayPaymentId, result };
}

const quoteItems = JSON.stringify([
  { kind: 'labour', title: 'Repair', qty: 1, unit_price: 150000 },
  { kind: 'part', title: 'Part', qty: 1, unit_price: 65000 },
]);

async function completeInspectQuote(fixture, scheduledAt) {
  const bookingId = await createBooking(fixture, scheduledAt);
  assert(await status(bookingId) === 'pending_payment', 'booking starts pending payment',
    { bookingId, status: await status(bookingId) });
  const visit = await pay(bookingId, fixture.customer);
  assert(visit.amount === 19900 && visit.purpose === 'visit_fee', 'visit fee is exact', visit);
  assert(await status(bookingId) === 'requested', 'visit payment creates provider request',
    { bookingId, status: await status(bookingId) });
  await as(fixture.provider, 'authenticated', `select accept_booking($1::uuid)`, [bookingId]);
  await as(fixture.provider, 'authenticated', `select start_trip($1::uuid)`, [bookingId]);
  const startOtp = (await as(fixture.customer, 'authenticated', `
    select start_otp from get_booking_otps($1::uuid)
  `, [bookingId]))[0].start_otp;
  const arrival = (await as(fixture.provider, 'authenticated', `
    select arrive($1::uuid, $2::text) result
  `, [bookingId, startOtp]))[0].result;
  assert(arrival.ok && await status(bookingId) === 'inspecting', 'provider arrival verifies start OTP',
    { arrival, status: await status(bookingId) });
  const quoteId = (await as(fixture.provider, 'authenticated', `
    select send_quote($1::uuid, $2::jsonb) quote_id
  `, [bookingId, quoteItems]))[0].quote_id;
  const approval = (await as(fixture.customer, 'authenticated', `
    select approve_quote($1::uuid, $2::uuid) result
  `, [bookingId, quoteId]))[0].result;
  assert(approval.amount_due === 198000, 'balance due is exact', approval);
  const balance = await pay(bookingId, fixture.customer);
  assert(balance.amount === 198000 && balance.purpose === 'balance', 'balance payment is exact', balance);
  assert(await status(bookingId) === 'in_progress', 'balance payment starts work',
    { bookingId, status: await status(bookingId) });
  await as(fixture.provider, 'authenticated', `select request_completion($1::uuid)`, [bookingId]);
  const endOtp = (await as(fixture.customer, 'authenticated', `
    select end_otp from get_booking_otps($1::uuid)
  `, [bookingId]))[0].end_otp;
  const completion = (await as(fixture.provider, 'authenticated', `
    select complete_booking($1::uuid, $2::text) result
  `, [bookingId, endOtp]))[0].result;
  assert(completion.ok && await status(bookingId) === 'completed', 'end OTP completes booking',
    { completion, status: await status(bookingId) });
  const payout = await one(`
    select gross, commission, gst_on_commission, amount, status::text status
      from payouts where booking_id = $1::uuid
  `, [bookingId]);
  assert(
    payout?.gross === 215000 && payout.commission === 18000
      && payout.gst_on_commission === 3240 && payout.amount === 193760,
    'completion creates the expected payout in paise',
    payout,
  );
  return { bookingId, quoteId, payout };
}

await db.query(`insert into auth.users (id, phone, raw_user_meta_data)
  values ($1::uuid, $2::text, '{}'::jsonb)`, [ADMIN, '+919700009901']);
await db.query(`insert into admins (user_id) values ($1::uuid)`, [ADMIN]);

await scenario('WS2-T12 inspect_quote lifecycle, payout and review', async () => {
  const fixture = await createFixture(
    'ws2-t12-happy', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201',
    '+919700001101', '+919700002101',
  );
  const { bookingId } = await completeInspectQuote(fixture, '2027-06-15T10:00:00+05:30');
  await as(fixture.customer, 'authenticated', `
    select submit_review(
      $1::uuid, 5::int, 5::int, 5::int, 4::int, 5::int, $2::text, '{}'::text[]
    )
  `, [bookingId, 'Excellent service']);
  const ratings = await one(`
    select rating_avg, rating_count, jobs_completed
      from providers where id = $1::uuid
  `, [fixture.provider]);
  assert(Number(ratings.rating_avg) === 5 && ratings.rating_count === 1 && ratings.jobs_completed === 1,
    'completed booking accepts one review and updates provider totals', ratings);
});

await scenario('WS2-T12 customer cancellation while accepted', async () => {
  const fixture = await createFixture(
    'ws2-t12-cancel-accepted', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000202',
    '+919700001102', '+919700002102',
  );
  const bookingId = await createBooking(fixture, '2027-06-17T10:00:00+05:30');
  await pay(bookingId, fixture.customer);
  await as(fixture.provider, 'authenticated', `select accept_booking($1::uuid)`, [bookingId]);
  assert(await status(bookingId) === 'accepted', 'fixture reaches accepted state',
    { bookingId, status: await status(bookingId) });
  await as(fixture.customer, 'authenticated', `
    select cancel_booking($1::uuid, $2::text)
  `, [bookingId, 'Customer changed plans']);
  const cancelled = await one(`
    select status::text status, refund_amount
      from bookings where id = $1::uuid
  `, [bookingId]);
  assert(cancelled.status === 'cancelled' && cancelled.refund_amount === 19900,
    'accepted customer cancellation refunds the visit fee exactly', cancelled);
});

await scenario('WS2-T12 customer cancellation while en_route', async () => {
  const fixture = await createFixture(
    'ws2-t12-cancel-enroute', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000203',
    '+919700001103', '+919700002103',
  );
  const bookingId = await createBooking(fixture, '2027-06-19T10:00:00+05:30');
  await pay(bookingId, fixture.customer);
  await as(fixture.provider, 'authenticated', `select accept_booking($1::uuid)`, [bookingId]);
  await as(fixture.provider, 'authenticated', `select start_trip($1::uuid)`, [bookingId]);
  assert(await status(bookingId) === 'en_route', 'fixture reaches en_route state',
    { bookingId, status: await status(bookingId) });
  await as(fixture.customer, 'authenticated', `
    select cancel_booking($1::uuid, $2::text)
  `, [bookingId, 'Customer changed plans']);
  const cancelled = await one(`
    select status::text status, refund_amount
      from bookings where id = $1::uuid
  `, [bookingId]);
  assert(cancelled.status === 'cancelled' && cancelled.refund_amount === 0,
    'en_route customer cancellation applies the no-refund policy exactly', cancelled);
});

await scenario('WS2-T12 completed dispute with valid partial refund', async () => {
  const fixture = await createFixture(
    'ws2-t12-dispute', '00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000204',
    '+919700001104', '+919700002104',
  );
  const { bookingId, payout } = await completeInspectQuote(fixture, '2027-06-22T10:00:00+05:30');
  await as(fixture.customer, 'authenticated', `
    select dispute_booking($1::uuid, $2::text)
  `, [bookingId, 'The repair did not hold']);
  const refundAmount = Math.min(10000, payout.amount);
  assert(refundAmount > 0 && refundAmount <= payout.amount,
    'partial refund is within the current payout', { refundAmount, payout });
  await as(ADMIN, 'authenticated', `
    select resolve_dispute(
      $1::uuid, $2::public.dispute_outcome, $3::int, $4::text
    )
  `, [bookingId, 'partial_refund', refundAmount, 'Partial refund approved']);
  const result = await one(`
    select b.status::text status, b.refund_amount, p.amount payout_amount, p.status::text payout_status
      from bookings b join payouts p on p.booking_id = b.id
     where b.id = $1::uuid
  `, [bookingId]);
  assert(result.status === 'completed' && result.refund_amount === refundAmount
    && result.payout_amount === payout.amount - refundAmount && result.payout_status === 'pending',
  'partial dispute refund reduces the payout by the exact paise amount',
  { result, initialPayout: payout, refundAmount });
});

if (failures) process.exitCode = 1;

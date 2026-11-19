import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const targetMigration = '0068_u2_booking_cancellation_preview.sql';
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((file) => /^\d{4}[a-z]?_.+\.sql$/.test(file) && Number(file.slice(0, 4)) <= 68)
  .sort();
if (!migrationFiles.includes(targetMigration)) {
  throw new Error(`missing reserved U2 migration: ${targetMigration}`);
}

const migration = (file) =>
  fs.readFileSync(path.join(migrationsDir, file), 'utf8')
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
  raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
  created_at timestamptz, updated_at timestamptz
);
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
for (const file of migrationFiles) {
  await db.exec(migration(file));
}
await db.exec("set timezone = 'UTC'");
await db.exec(`
  update public.app_config
     set value = value || '{"fixed":true,"inspect_quote":true,"proposal":true,"time_based":true}'::jsonb
   where key = 'archetype_flags'
`);

let fixtureNumber = 0;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
async function slotWithinMinutes(minutesAhead) {
  return (await one(`
    select (transaction_timestamp() + $1::int * interval '1 minute')::text as scheduled_at
  `, [minutesAhead])).scheduled_at;
}

async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

async function failureOf(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error.message;
  }
}

async function createFixture(archetype, policy, status, scheduledAt, amount) {
  const suffix = String(++fixtureNumber).padStart(12, '0');
  const customer = `10000000-0000-4000-8000-${suffix}`;
  const provider = `20000000-0000-4000-8000-${suffix}`;
  const other = `30000000-0000-4000-8000-${suffix}`;
  const city = `U2 Preview City ${fixtureNumber}`;
  const slug = `u2-preview-${fixtureNumber}`;
  await db.query(
    `insert into auth.users (id) values ($1::uuid), ($2::uuid), ($3::uuid)`,
    [customer, provider, other],
  );
  await db.query(`update public.profiles set role_provider=true where id=$1::uuid`, [provider]);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, admin_review_status, submitted_at, is_online, paused, suspended
    )
    values ($1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.60,16.50),4326),
            'verified', 'approved', now(), true, false, false)
  `, [provider, city]);
  const categoryId = (await one(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, cancellation_policy, min_lead_hours, max_lead_days
    ) values ($1::text, $2::text, 'quote', true, $3::text, $4::text, 0, 365)
    returning id
  `, [slug, `U2 preview ${fixtureNumber}`, archetype, policy])).id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [categoryId, city]);
  const serviceId = (await one(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, $3::int, 0, true)
    returning id
  `, [provider, categoryId, amount])).id;
  const addressId = (await one(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Home', $2::text, $3::text, 16.50, 80.60)
    returning id
  `, [customer, `U2 road ${fixtureNumber}`, city])).id;
  const bookingId = (await one(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, status, visit_fee, platform_fee, total_amount, service_window
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'U2 preview fixture',
      $6::timestamptz, $7::public.booking_status, $8::int, 0, $8::int,
      tstzrange($6::timestamptz, $6::timestamptz + interval '2 hours', '[)')
    ) returning id
  `, [customer, provider, categoryId, serviceId, addressId, FUTURE_SLOT, status, amount])).id;
  if (scheduledAt !== FUTURE_SLOT) {
    await db.query(`
      update public.bookings
         set scheduled_at=$2::timestamptz,
             service_window=tstzrange($2::timestamptz, $2::timestamptz + interval '2 hours', '[)')
       where id=$1::uuid
    `, [bookingId, scheduledAt]);
  }
  return { bookingId, customer, provider, other, amount };
}

async function addPaidAmount(bookingId, amount) {
  return (await one(`
    insert into public.payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
    values ($1::uuid, 'visit_fee', $2::int, 'paid', $3::text, now())
    returning id
  `, [bookingId, amount, `u2-preview-payment-${++fixtureNumber}`])).id;
}

async function addPaidSessionSchedule(bookingId, amount, scheduledAt) {
  const scheduleId = (await one(`
    insert into public.payment_schedule (
      booking_id, seq, obligation_type, label, amount, due_rule, due_at, status, purpose, obligation_kind
    ) values ($1::uuid, 1, 'service', 'Session service', $2::int, 'at_booking', $3::timestamptz,
              'paid', 'session', 'service')
    returning id
  `, [bookingId, amount, scheduledAt])).id;
  const paymentId = (await one(`
    insert into public.payments (
      booking_id, schedule_id, purpose, amount, status, razorpay_payment_id, paid_at
    ) values ($1::uuid, $2::uuid, 'visit_fee', $3::int, 'paid', $4::text, now())
    returning id
  `, [bookingId, scheduleId, amount, `u2-preview-session-${++fixtureNumber}`])).id;
  await db.query(
    `update public.payment_schedule set payment_id=$1::uuid, paid_at=now() where id=$2::uuid`,
    [paymentId, scheduleId],
  );
  return paymentId;
}

const FUTURE_SLOT = '2027-01-15T10:00:00+05:30';

await scenario('fixed late preview matches cancellation outcome in exact paise', async () => {
  const scheduledAt = await slotWithinMinutes(110);
  const fixture = await createFixture('fixed', 'fixed', 'accepted', scheduledAt, 10000);
  await addPaidAmount(fixture.bookingId, 10000);
  const before = await one(`
    select status::text as status, refund_amount, cancellation_outcome
      from public.bookings
     where id=$1::uuid
  `, [fixture.bookingId]);
  const preview = (await as(fixture.customer, 'authenticated',
    `select public.preview_cancellation($1::uuid) as preview`, [fixture.bookingId]))[0].preview;
  const afterPreview = await one(`
    select status::text as status, refund_amount, cancellation_outcome
      from public.bookings
     where id=$1::uuid
  `, [fixture.bookingId]);
  await as(fixture.customer, 'authenticated',
    `select public.cancel_booking($1::uuid, $2::text)`, [fixture.bookingId, 'U2 fixed late test']);
  const actual = await one(`
    select b.cancellation_outcome, b.refund_amount, b.status::text as status
      from public.bookings b
     where b.id=$1::uuid
  `, [fixture.bookingId]);
  ok(preview.refund_amount === 7500
    && preview.charged_amount === 2500
    && before.status === afterPreview.status
    && before.refund_amount === afterPreview.refund_amount
    && before.cancellation_outcome === afterPreview.cancellation_outcome
    && actual.cancellation_outcome.refund_amount === preview.refund_amount
    && actual.refund_amount === preview.refund_amount
    && actual.status === 'cancelled',
  `fixed late preview equals cancellation: ${JSON.stringify({ preview, actual })}`);
});

await scenario('time-based late preview matches the existing session cancellation without writes', async () => {
  const scheduledAt = await slotWithinMinutes(240);
  const fixture = await createFixture('time_based', 'standard_visit', 'accepted', scheduledAt, 20000);
  await addPaidSessionSchedule(fixture.bookingId, 20000, scheduledAt);
  const before = await one(`
    select status::text as status, refund_amount, cancellation_outcome
      from public.bookings
     where id=$1::uuid
  `, [fixture.bookingId]);
  const preview = (await as(fixture.customer, 'authenticated',
    `select public.preview_cancellation($1::uuid) as preview`, [fixture.bookingId]))[0].preview;
  const afterPreview = await one(`
    select status::text as status, refund_amount, cancellation_outcome
      from public.bookings
     where id=$1::uuid
  `, [fixture.bookingId]);
  await as(fixture.customer, 'authenticated',
    `select public.cancel_session_booking($1::uuid, $2::text)`, [fixture.bookingId, 'U2 session late test']);
  const actual = await one(`
    select status::text as status, refund_amount
      from public.bookings
     where id=$1::uuid
  `, [fixture.bookingId]);
  ok(preview.refund_amount === 0
    && preview.charged_amount === 20000
    && before.status === 'accepted'
    && before.refund_amount === 0
    && before.cancellation_outcome === null
    && before.status === afterPreview.status
    && before.refund_amount === afterPreview.refund_amount
    && before.cancellation_outcome === afterPreview.cancellation_outcome
    && actual.status === 'completed'
    && actual.refund_amount === preview.refund_amount,
  `time-based preview is read-only and matches late cancellation: ${JSON.stringify({ preview, before, actual })}`);
});

await scenario('time-based more-than-12-hour preview matches the full refund in exact paise', async () => {
  const fixture = await createFixture('time_based', 'standard_visit', 'accepted', FUTURE_SLOT, 20000);
  await addPaidSessionSchedule(fixture.bookingId, 20000, FUTURE_SLOT);
  const before = await one(`
    select status::text as status, refund_amount, cancellation_outcome
      from public.bookings
     where id=$1::uuid
  `, [fixture.bookingId]);
  const preview = (await as(fixture.customer, 'authenticated',
    `select public.preview_cancellation($1::uuid) as preview`, [fixture.bookingId]))[0].preview;
  const afterPreview = await one(`
    select status::text as status, refund_amount, cancellation_outcome
      from public.bookings
     where id=$1::uuid
  `, [fixture.bookingId]);
  const actualRefund = (await as(fixture.customer, 'authenticated',
    `select public.cancel_session_booking($1::uuid, $2::text) as refund_amount`,
    [fixture.bookingId, 'U2 session early-cancel test']))[0].refund_amount;
  const actual = await one(`
    select status::text as status, refund_amount
      from public.bookings
     where id=$1::uuid
  `, [fixture.bookingId]);
  ok(preview.refund_amount === 20000
    && preview.charged_amount === 0
    && before.status === 'accepted'
    && before.status === afterPreview.status
    && before.refund_amount === afterPreview.refund_amount
    && before.cancellation_outcome === afterPreview.cancellation_outcome
    && actualRefund === 20000
    && actual.status === 'cancelled'
    && actual.refund_amount === preview.refund_amount,
  `time-based more-than-12-hour preview equals cancellation: ${JSON.stringify({ preview, before, afterPreview, actualRefund, actual })}`);
});

await scenario('inspect en_route preview matches cancellation outcome in exact paise', async () => {
  const fixture = await createFixture('inspect_quote', 'standard_visit', 'en_route', FUTURE_SLOT, 10000);
  await addPaidAmount(fixture.bookingId, 10000);
  const before = await one(`
    select status::text as status, refund_amount, cancellation_outcome
      from public.bookings
     where id=$1::uuid
  `, [fixture.bookingId]);
  const preview = (await as(fixture.customer, 'authenticated',
    `select public.preview_cancellation($1::uuid) as preview`, [fixture.bookingId]))[0].preview;
  const afterPreview = await one(`
    select status::text as status, refund_amount, cancellation_outcome
      from public.bookings
     where id=$1::uuid
  `, [fixture.bookingId]);
  await as(fixture.customer, 'authenticated',
    `select public.cancel_booking($1::uuid, $2::text)`, [fixture.bookingId, 'U2 en route test']);
  const actual = await one(`
    select b.cancellation_outcome, b.refund_amount, b.status::text as status
      from public.bookings b
     where b.id=$1::uuid
  `, [fixture.bookingId]);
  ok(preview.refund_amount === 0
    && preview.charged_amount === 10000
    && before.status === afterPreview.status
    && before.refund_amount === afterPreview.refund_amount
    && before.cancellation_outcome === afterPreview.cancellation_outcome
    && actual.cancellation_outcome.refund_amount === preview.refund_amount
    && actual.refund_amount === preview.refund_amount
    && actual.status === 'cancelled',
  `inspect en_route preview equals cancellation: ${JSON.stringify({ preview, actual })}`);
});

await scenario('unpaid time-based preview returns zero paise and is owner-only', async () => {
  const fixture = await createFixture('time_based', 'standard_visit', 'pending_payment', FUTURE_SLOT, 20000);
  const before = await one(`
    select status::text as status, refund_amount, cancellation_outcome
      from public.bookings
     where id=$1::uuid
  `, [fixture.bookingId]);
  const preview = (await as(fixture.customer, 'authenticated',
    `select public.preview_cancellation($1::uuid) as preview`, [fixture.bookingId]))[0].preview;
  const otherError = await failureOf(() => as(fixture.other, 'authenticated',
    `select public.preview_cancellation($1::uuid)`, [fixture.bookingId]));
  const anonError = await failureOf(() => as(null, 'anon',
    `select public.preview_cancellation($1::uuid)`, [fixture.bookingId]));
  const after = await one(`
    select status::text as status, refund_amount, cancellation_outcome
      from public.bookings
     where id=$1::uuid
  `, [fixture.bookingId]);
  ok(preview.refund_amount === 0
    && preview.charged_amount === 0
    && before.status === after.status
    && before.refund_amount === after.refund_amount
    && before.cancellation_outcome === after.cancellation_outcome
    && /only the booking customer can preview cancellation/i.test(otherError ?? '')
    && /permission denied/i.test(anonError ?? ''),
  `unpaid preview is zero-paise, read-only, and owner-only: ${JSON.stringify({ preview, before, after, otherError, anonError })}`);
});

finish();

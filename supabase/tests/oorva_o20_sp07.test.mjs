import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.join(here, '..', 'migrations');
const migration = (file) =>
  fs.readFileSync(path.join(migrationDir, file), 'utf8')
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
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
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

const migrationFiles = fs.readdirSync(migrationDir)
  .filter((file) => /^\d{4}[a-z]?_.+\.sql$/.test(file))
  .sort();
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(prelude);
for (const file of migrationFiles) await db.exec(migration(file));
await db.exec("set timezone = 'UTC'");
await db.query(`
  update public.app_config
     set value = value || $1::jsonb
   where key = 'sports_rules'::text
`, [JSON.stringify({
  customer_fee_paise: 500,
  commission_bp: 1000,
  payment_hold_minutes: 10,
  approval_pay_window_minutes: 60,
  max_active_holds_per_customer: 3,
  request_response_minutes: 120,
  min_lead_minutes: 30,
})]);

async function as(uid, role, sql, params = []) {
  await db.exec(`
    reset role;
    select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);
    select set_config('request.jwt.claim.role', '${role}', false);
    set role ${role};
  `);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const json = (value) => typeof value === 'string' ? JSON.parse(value) : value;
const FIXED_DAYS = {
  parentOff: '2026-12-15',
  onlineOff: '2026-12-16',
};
let phoneSequence = 0;

async function setSportsFlags({ sports, online }) {
  await db.query(`
    update public.feature_flags
       set enabled = case key
         when 'sports' then $1::boolean
         when 'sports_online_payments' then $2::boolean
         when 'sports_instant_booking' then true
         when 'sports_capacity_slots' then true
         when 'sports_multi_slot' then true
       end
     where key = any(array[
       'sports', 'sports_online_payments', 'sports_instant_booking',
       'sports_capacity_slots', 'sports_multi_slot'
     ]::text[])
  `, [sports, online]);
}

async function createFixture(label) {
  const ownerId = randomUUID();
  const customerId = randomUUID();
  for (const [index, userId] of [ownerId, customerId].entries()) {
    phoneSequence += 1;
    await db.query(`
      insert into auth.users (id, phone, raw_user_meta_data)
      values ($1::uuid, $2::text, '{}'::jsonb)
    `, [userId, `+9198${String(phoneSequence).padStart(8, '0')}`]);
    await db.query(`
      update public.profiles
         set full_name = $1::text
       where id = $2::uuid
    `, [`O20-SP07 ${label} user ${index}`, userId]);
  }

  const activityId = (await one(`
    select id from public.sports_activities where slug = 'badminton'::text
  `)).id;
  const venueId = (await one(`
    insert into public.sports_venues
      (owner_id, name, address_line, city, area, lat, lng, status, payment_modes)
    values ($1::uuid, $2::text, '1 Test Road'::text, 'Sangareddy'::text,
      'Center'::text, 16.5::double precision, 80.6::double precision,
      'verified'::text, array['online', 'pay_at_venue']::text[])
    returning id
  `, [ownerId, `O20-SP07 ${label}`])).id;
  await db.query(`
    insert into public.provider_payout_accounts
      (provider_id, rail, activation_status, razorpay_account_id, fund_account_id)
    values ($1::uuid, 'payouts'::text, 'activated'::text, $2::text, $3::text)
  `, [ownerId, `acc_${label}`, `fa_${label}`]);
  await db.query(`
    insert into public.sports_hours (venue_id, weekday, opens, closes)
    select $1::uuid, day::smallint, time '08:00', time '20:00'
      from generate_series(0, 6) day
  `, [venueId]);
  const resourceId = (await one(`
    insert into public.sports_resources
      (venue_id, activity_id, name, slot_minutes, active, booking_mode, capacity)
    values ($1::uuid, $2::uuid, $3::text, 60::int, true, 'instant'::text, 1::int)
    returning id
  `, [venueId, activityId, `O20-SP07 ${label} court`])).id;
  await db.query(`
    insert into public.sports_price_rules (resource_id, weekday, starts, ends, price_paise)
    values ($1::uuid, null::smallint, time '08:00', time '20:00', 20000::int)
  `, [resourceId]);
  return { ownerId, customerId, venueId, resourceId };
}

async function startsAt(day, time) {
  return (await one(`
    select ($1::date + $2::time) at time zone 'Asia/Kolkata' starts_at
  `, [day, time])).starts_at;
}

async function book(fixture, day, time, key) {
  const start = await startsAt(day, time);
  const result = (await as(fixture.customerId, 'authenticated', `
    select public.book_sports_slot(
      $1::uuid, $2::timestamptz, $3::int, $4::int,
      $5::text, $6::text, $7::text
    ) result
  `, [fixture.resourceId, start, 1, 1, 'online', '', key]))[0].result;
  return { ...json(result), start };
}

async function prepare(bookingId, customerId) {
  return (await as(null, 'service_role', `
    select * from public.prepare_sports_payment($1::uuid, $2::uuid)
  `, [bookingId, customerId]))[0];
}

async function failureOf(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error?.message ?? String(error);
  }
}

async function verifyFlagsOff({ label, sports, online, day, existingTime, freshTime }) {
  const fixture = await createFixture(label);
  await setSportsFlags({ sports: true, online: true });
  const idempotencyKey = `o20-sp07-existing-${randomUUID()}`;
  const booking = await book(fixture, day, existingTime, idempotencyKey);
  const stored = await one(`
    select status, payment_mode, price_paise, customer_fee_paise, total_paise,
           hold_expires_at > now() as live_deadline
      from public.sports_bookings
     where id = $1::uuid
  `, [booking.booking_id]);
  await setSportsFlags({ sports, online });

  const prepared = await prepare(booking.booking_id, fixture.customerId);
  const attempt = await one(`
    select count(*)::int as count, max(amount)::int as amount,
           count(*) filter (where status::text = 'created'::text)::int as created_count
      from public.payments
     where sports_booking_id = $1::uuid
  `, [booking.booking_id]);
  const freshKey = `o20-sp07-fresh-${randomUUID()}`;
  const creationError = await failureOf(() => book(fixture, day, freshTime, freshKey));
  const expectedCreationDenial = sports
    ? 'Sports online payments are turned off right now.'
    : 'Sports & venues are turned off right now.';
  const freshCount = await one(`
    select count(*)::int as count
      from public.sports_bookings
     where customer_id = $1::uuid and idempotency_key = $2::text
  `, [fixture.customerId, freshKey]);

  const diagnostics = {
    flags: { sports, sports_online_payments: online },
    booking,
    stored,
    prepared,
    attempt,
    creationError,
    expectedCreationDenial,
    freshCount,
  };
  ok(booking.status === 'pending_payment'
    && stored?.status === 'pending_payment'
    && stored.payment_mode === 'online'
    && stored.live_deadline === true
    && stored.price_paise === 20000
    && stored.customer_fee_paise === 500
    && stored.total_paise === 20500
    && prepared?.amount === stored.total_paise
    && prepared.purpose === 'fixed'
    && attempt.count === 1
    && attempt.amount === stored.total_paise
    && attempt.created_count === 1
    && creationError?.includes(expectedCreationDenial)
    && freshCount.count === 0,
  `[SP-OFF-PREPARE-VS-NEW-CREATION] ${label}: ${JSON.stringify(diagnostics)}`);
}

await scenario('SP-OFF-PREPARE-VS-NEW-CREATION: parent OFF preserves existing due preparation and blocks new creation', async () => {
  await verifyFlagsOff({
    label: 'parent-off',
    sports: false,
    online: true,
    day: FIXED_DAYS.parentOff,
    existingTime: '10:00',
    freshTime: '12:00',
  });
});

await scenario('SP-OFF-PREPARE-VS-NEW-CREATION: online child OFF preserves existing due preparation and blocks new creation', async () => {
  await verifyFlagsOff({
    label: 'online-child-off',
    sports: true,
    online: false,
    day: FIXED_DAYS.onlineOff,
    existingTime: '10:00',
    freshTime: '12:00',
  });
});

finish();

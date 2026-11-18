import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const targetMigration = '0061_h1_provider_cancellation_and_recurring_privacy.sql';
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file) && Number(file.slice(0, 4)) <= 61)
  .sort();
if (!migrationFiles.includes(targetMigration)) {
  throw new Error(`missing reserved H1 migration: ${targetMigration}`);
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
const actors = [
  { customer: '00000000-0000-0000-0000-000000000101', provider: '00000000-0000-0000-0000-000000000102' },
  { customer: '00000000-0000-0000-0000-000000000103', provider: '00000000-0000-0000-0000-000000000104' },
  { customer: '00000000-0000-0000-0000-000000000105', provider: '00000000-0000-0000-0000-000000000106' },
  { customer: '00000000-0000-0000-0000-000000000107', provider: '00000000-0000-0000-0000-000000000108' },
];
let fixtures;

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const failMessage = async (fn) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return error.message;
  }
};

async function prepareFixtures() {
  const userIds = actors.flatMap(({ customer, provider }) => [customer, provider]);
  await db.query(
    `insert into auth.users (id)
     values ($1::uuid), ($2::uuid), ($3::uuid), ($4::uuid),
            ($5::uuid), ($6::uuid), ($7::uuid), ($8::uuid)`,
    userIds,
  );
  await db.query(`update profiles set role_provider=true where id=any($1::uuid[])`,
    [actors.map(({ provider }) => provider)]);
  await db.query(`
    insert into providers (id, city, base_location, kyc_status, submitted_at, is_online, paused, suspended)
    values
      ($1::uuid, 'Vijayawada', extensions.st_setsrid(extensions.st_makepoint(80.60,16.50),4326), 'verified', now(), true, false, false),
      ($2::uuid, 'Vijayawada', extensions.st_setsrid(extensions.st_makepoint(80.61,16.50),4326), 'verified', now(), true, false, false),
      ($3::uuid, 'Vijayawada', extensions.st_setsrid(extensions.st_makepoint(80.62,16.50),4326), 'verified', now(), true, false, false),
      ($4::uuid, 'Vijayawada', extensions.st_setsrid(extensions.st_makepoint(80.63,16.50),4326), 'verified', now(), true, false, false)`,
  actors.map(({ provider }) => provider));
  const categoryId = (await one(`
    insert into categories (
      slug, name, pricing_mode, active, archetype, cancellation_policy, min_lead_hours, max_lead_days
    ) values ($1::text, $2::text, 'quote', true, 'inspect_quote', 'standard_visit', 0, 365)
    returning id`,
  ['h1-booking-safety', 'H1 booking safety'])).id;
  await db.query(`
    update app_config
       set value=jsonb_set(value, '{inspect_quote}', 'true'::jsonb, true)
     where key='archetype_flags'`);
  await db.query(`
    insert into category_cities (category_id, city, live, launched_at)
    values ($1::uuid, 'Vijayawada', true, now())
    on conflict (category_id, city) do update set live=true, launched_at=excluded.launched_at`,
  [categoryId]);
  const serviceIds = [];
  const addresses = [];
  for (const [index, actor] of actors.entries()) {
    serviceIds.push((await one(`
      insert into provider_services (provider_id, category_id, visit_fee, labour_rate, active)
      values ($1::uuid, $2::uuid, 10000, 0, true)
      returning id`,
    [actor.provider, categoryId])).id);
    addresses.push((await one(`
      insert into addresses (user_id, label, line1, city, lat, lng)
      values ($1::uuid, 'Home', $2::text, 'Vijayawada', 16.50, 80.60 + $3::int * 0.01)
      returning id`,
    [actor.customer, `H1 road ${index + 1}`, index])).id);
  }
  fixtures = actors.map((actor, index) => ({
    ...actor,
    categoryId,
    serviceId: serviceIds[index],
    addressId: addresses[index],
  }));
  return fixtures;
}

async function insertBooking(fixture, status, date) {
  const scheduledAt = `${date}T10:00:00+05:30`;
  return (await one(`
    insert into bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, status, visit_fee, platform_fee, total_amount, service_window
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'H1 test',
      $6::timestamptz, $7::public.booking_status, 10000, 0, 10000,
      tstzrange($6::timestamptz, $6::timestamptz + interval '2 hours', '[)')
    ) returning id`,
  [fixture.customer, fixture.provider, fixture.categoryId, fixture.serviceId,
    fixture.addressId, scheduledAt, status])).id;
}

for (const file of migrationFiles) {
  if (file === targetMigration) {
    fixtures = await prepareFixtures();
    await insertBooking(fixtures[0], 'requested', '2027-02-01');
  }
  await db.exec(migration(file));
}

await db.exec(`set timezone='UTC'`);
await scenario('legacy cancellation snapshots gain actor guards', async () => {
  const snapshot = (await one(`
    select cancellation_snapshot
      from bookings
     where customer_id=$1::uuid and provider_id=$2::uuid`,
  [fixtures[0].customer, fixtures[0].provider])).cancellation_snapshot;
  const rule = snapshot.rules.find((entry) => entry.name === 'customer_after_trip_or_no_show');
  const policies = (await db.query(`
    select key, rules
      from cancellation_policies
     where key=any($1::text[])`,
  [['standard_visit', 'fixed', 'fixed_flexible']])).rows;
  const policyRules = Object.fromEntries(policies.map(({ key, rules }) => [
    key,
    rules.rules.find((entry) => entry.name ===
      (key === 'standard_visit' ? 'customer_after_trip_or_no_show' : 'half_refund_after_arrival_or_no_show'))
      ?.match?.actors ?? null,
  ]));
  const actual = {
    policyCount: policies.length,
    snapshotActors: rule?.match?.actors ?? null,
    policyActors: policyRules,
  };
  ok(actual.policyCount === 3
    && JSON.stringify(actual.snapshotActors) === JSON.stringify(['customer', 'system'])
    && Object.values(actual.policyActors).every((actorsForRule) =>
      JSON.stringify(actorsForRule) === JSON.stringify(['customer', 'system'])),
  `H1 migrates existing and future standard-visit rules: ${JSON.stringify(actual)}`);
});

await scenario('provider cannot claim customer_payment_default', async () => {
  const bookingId = await insertBooking(fixtures[1], 'accepted', '2027-02-02');
  const error = await failMessage(() => as(fixtures[1].provider, 'authenticated',
    `select provider_cancel_booking($1::uuid, $2::text, null)`,
    [bookingId, 'customer_payment_default']));
  const state = await one(`select status::text status from bookings where id=$1::uuid`, [bookingId]);
  ok(/invalid provider cancellation reason/i.test(error ?? '') && state.status === 'accepted',
    `direct payment-default claim is rejected without changing booking: ${JSON.stringify({ error, state })}`);
});

await scenario('provider cannot cancel in_progress', async () => {
  const bookingId = await insertBooking(fixtures[2], 'in_progress', '2027-02-03');
  const error = await failMessage(() => as(fixtures[2].provider, 'authenticated',
    `select provider_cancel_booking($1::uuid, $2::text, null)`,
    [bookingId, 'provider_cancellation']));
  const state = await one(`select status::text status from bookings where id=$1::uuid`, [bookingId]);
  ok(/booking can no longer be cancelled/i.test(error ?? '') && state.status === 'in_progress',
    `in-progress cancellation is rejected without changing booking: ${JSON.stringify({ error, state })}`);
});

await scenario('provider cancellation in accepted refunds the customer in full', async () => {
  const bookingId = await insertBooking(fixtures[3], 'accepted', '2027-02-04');
  const paymentId = (await one(`
    insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
    values ($1::uuid, 'visit_fee', 10000, 'paid', 'h1-provider-cancel-paid', now())
    returning id`,
  [bookingId])).id;
  const outcome = (await as(fixtures[3].provider, 'authenticated',
    `select provider_cancel_booking($1::uuid, $2::text, null) outcome`,
    [bookingId, 'provider_cancellation']))[0].outcome;
  const refund = await one(`
    select coalesce(sum(amount), 0)::int amount
      from refunds
     where payment_id=$1::uuid and status <> 'failed'`,
  [paymentId]);
  const state = await one(`
    select status::text status, refund_amount
      from bookings
     where id=$1::uuid`,
  [bookingId]);
  ok(outcome.refund_amount === 10000 && refund.amount === 10000
    && state.status === 'cancelled' && state.refund_amount === 10000,
  `accepted provider cancellation refunds all paid principal: ${JSON.stringify({ outcome, refund, state })}`);
});

finish();

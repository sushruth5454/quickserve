import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';
import { buildBooking, buildCategory, buildPaymentSchedule } from './_fixtures.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((file) => /^\d{4}[a-z]?_.+\.sql$/.test(file))
  .sort();
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
  raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}', created_at timestamptz, updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated, anon, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(prelude);
for (const file of migrationFiles) {
  try {
    await db.exec(migration(file));
  } catch (error) {
    throw new Error(`migration ${file} failed: ${error.message}`, { cause: error });
  }
}
await db.exec("set timezone = 'UTC'");

const FIXED_AT = '2026-12-15T10:00:00.000Z';

async function insertFixture(table, fixture) {
  const result = await db.query(
    `insert into public.${table}
       select * from jsonb_populate_record(null::public.${table}, $1::jsonb)
     returning *`,
    [JSON.stringify(fixture)],
  );
  return result.rows[0];
}

async function assertRequiredColumnsPresent(table, fixture, row) {
  const required = (await db.query(`
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name = $1::text
       and is_nullable = 'NO'
     order by ordinal_position
  `, [table])).rows.map(({ column_name }) => column_name);
  const missingFromFixture = required.filter((column) =>
    !Object.hasOwn(fixture, column) || fixture[column] === null);
  const nullFromRow = required.filter((column) =>
    !Object.hasOwn(row, column) || row[column] === null);
  ok(
    missingFromFixture.length === 0 && nullFromRow.length === 0,
    `${table} fixture covers every NOT NULL column: ${JSON.stringify({
      required,
      missingFromFixture,
      nullFromRow,
      returned: Object.fromEntries(required.map((column) => [column, row[column]])),
    })}`,
  );
}

async function createBookingGraph(label) {
  const customerId = randomUUID();
  const providerId = randomUUID();
  const city = `Fixture ${label} City`;
  const phone = (id) => `+1555${id.replaceAll('-', '').slice(0, 10)}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb), ($3::uuid, $4::text, '{}'::jsonb)
  `, [customerId, phone(customerId), providerId, phone(providerId)]);
  await db.query(`update public.profiles set role_provider = true where id = $1::uuid`, [providerId]);

  const category = await insertFixture('categories', buildCategory({
    slug: `fixture-${label}-${randomUUID()}`,
    name: `Fixture ${label} category`,
  }));
  await db.query(`
    insert into public.providers (
      id, city, kyc_status, submitted_at, admin_review_status, is_online, paused, suspended
    ) values (
      $1::uuid, $2::text, 'verified', $3::timestamptz, 'approved', true, false, false
    )
  `, [providerId, city, FIXED_AT]);
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, $3::timestamptz)
  `, [category.id, city, FIXED_AT]);
  const providerServiceId = (await db.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, $3::int, $4::int, true)
    returning id
  `, [providerId, category.id, 19900, 50000])).rows[0].id;
  const addressId = (await db.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, $2::text, $3::text, $4::text, $5::double precision, $6::double precision)
    returning id
  `, [customerId, `Fixture ${label}`, '1 Fixture Road', city, 16.5, 80.6])).rows[0].id;

  const bookingFixture = buildBooking({
    customer_id: customerId,
    provider_id: providerId,
    category_id: category.id,
    provider_service_id: providerServiceId,
    address_id: addressId,
    scheduled_at: null,
    created_at: FIXED_AT,
    updated_at: FIXED_AT,
  });
  const booking = await insertFixture('bookings', bookingFixture);
  return { bookingFixture, booking };
}

await scenario('category builder covers the full-chain schema', async () => {
  const fixture = buildCategory({
    slug: `fixture-category-${randomUUID()}`,
    name: 'Fixture category',
  });
  const row = await insertFixture('categories', fixture);
  await assertRequiredColumnsPresent('categories', fixture, row);
});

await scenario('booking builder covers the full-chain schema', async () => {
  const { bookingFixture, booking } = await createBookingGraph('booking');
  await assertRequiredColumnsPresent('bookings', bookingFixture, booking);
});

await scenario('payment schedule builder covers the full-chain schema', async () => {
  const { booking } = await createBookingGraph('schedule');
  const fixture = buildPaymentSchedule({
    booking_id: booking.id,
    due_at: FIXED_AT,
    created_at: FIXED_AT,
    updated_at: FIXED_AT,
  });
  const row = await insertFixture('payment_schedule', fixture);
  await assertRequiredColumnsPresent('payment_schedule', fixture, row);
});

finish();

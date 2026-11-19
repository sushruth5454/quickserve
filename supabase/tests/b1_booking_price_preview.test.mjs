import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const targetMigration = '0073_b1_server_pricing.sql';
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((file) => /^\d{4}[a-z]?_.+\.sql$/.test(file) && file <= targetMigration)
  .sort();
if (!migrationFiles.includes(targetMigration)) {
  throw new Error(`missing reserved B1 migration: ${targetMigration}`);
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
create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8 language sql immutable as $$ select 1000 $$;
create function extensions.st_dwithin(a extensions.geography, b extensions.geography, d float8) returns boolean language sql immutable as $$ select true $$;
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
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to anon, authenticated, service_role;
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
  const sql = migration(file);
  try {
    if (file === '0023_proposal_milestone_booking.sql') {
      const split = sql.indexOf('alter table public.categories');
      await db.exec(sql.slice(0, split));
      await db.exec('drop policy if exists payment_schedule_participants on public.payment_schedule;');
      await db.exec(sql.slice(split)
        .replaceAll("'confirmed'::public.booking_status", "'accepted'::public.booking_status")
        .replaceAll("'delivery_pending'::public.booking_status", "'accepted'::public.booking_status"));
    } else {
      await db.exec(sql);
    }
  } catch (error) {
    throw new Error(`migration ${file} failed: ${error.message}`, { cause: error });
  }
}
await db.exec("set timezone = 'UTC'");

async function one(query, params = []) {
  return (await db.query(query, params)).rows[0];
}

async function as(uid, role, query, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

async function createServiceFixture({ customer, provider, slug, archetype, visitFee }) {
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb), ($3::uuid, $4::text, '{}'::jsonb)
  `, [customer, `+910${slug.length}1`, provider, `+910${slug.length}2`]);
  await db.query(`update profiles set role_provider = true where id = $1::uuid`, [provider]);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, admin_review_status, submitted_at, is_online, paused, suspended
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', 'approved', now(), true, false, false
    )
  `, [provider, 'B1 Fixture City']);
  const categoryId = (await one(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, cancellation_policy, location_modes,
      min_lead_hours, max_lead_days, restricted, requires_docs
    ) values (
      $1::text, $2::text, $3::public.pricing_mode, true, $4::text, $5::text,
      array['at_customer']::text[], 0, 365, false, '{}'::text[]
    ) returning id
  `, [
    slug,
    `${slug} category`,
    archetype === 'fixed' ? 'fixed' : 'quote',
    archetype,
    archetype === 'fixed' ? 'fixed_flexible' : 'standard_visit',
  ])).id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [categoryId, 'B1 Fixture City']);
  const serviceId = (await one(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, $3::int, 0, true)
    returning id
  `, [provider, categoryId, visitFee])).id;
  return { customer, provider, categoryId, serviceId };
}

await scenario('inspect booking preview returns exact server paise', async () => {
  const fixture = await createServiceFixture({
    customer: '00000000-0000-0000-0000-000000000731',
    provider: '00000000-0000-0000-0000-000000000732',
    slug: 'b1-inspect-price-preview',
    archetype: 'inspect_quote',
    visitFee: 19900,
  });
  const preview = (await as(fixture.customer, 'authenticated', `
    select public.get_booking_price_preview($1::uuid, $2::int) as preview
  `, [fixture.serviceId, 1]))[0].preview;
  const actual = {
    visit_fee: Number(preview.visit_fee),
    platform_fee: Number(preview.platform_fee),
    package_total: Number(preview.package_total),
    total: Number(preview.total),
    pay_now: Number(preview.pay_now),
  };
  ok(JSON.stringify(actual) === JSON.stringify({
    visit_fee: 19900,
    platform_fee: 2900,
    package_total: 0,
    total: 22800,
    pay_now: 19900,
  }), `inspect preview uses server visit and platform fees: ${JSON.stringify(actual)}`);
});

await scenario('default fixed fee produces the exact ₹1,028 checkout schedule', async () => {
  const fixture = await createServiceFixture({
    customer: '00000000-0000-0000-0000-000000000751',
    provider: '00000000-0000-0000-0000-000000000752',
    slug: 'b1-fixed-default-fee',
    archetype: 'fixed',
    visitFee: 0,
  });
  const packageId = (await one(`
    insert into public.service_packages (
      provider_service_id, title, price_type, price, price_min, price_max,
      unit, qty_min, qty_max, duration_min, active
    ) values (
      $1::uuid, 'B1 default-fee package', 'fixed', 99900, 99900, 99900,
      'job', 1, 1, 60, true
    ) returning id
  `, [fixture.serviceId])).id;
  const fee = (await as(fixture.customer, 'authenticated', `
    select public.get_fixed_booking_fee() as fee
  `))[0].fee;
  const start = '2026-12-16T10:00:00+05:30';
  const end = '2026-12-16T12:00:00+05:30';
  const bookingId = (await as(fixture.customer, 'authenticated', `
    select public.create_fixed_booking(
      $1::uuid,
      $2::numeric,
      tstzrange($3::timestamptz, $4::timestamptz, '[)'),
      $5::jsonb,
      '{}'::jsonb
    ) as booking_id
  `, [
    packageId,
    1,
    start,
    end,
    JSON.stringify({
      mode: 'at_customer',
      address_line: 'B1 default-fee address',
      city: 'B1 Fixture City',
      lat: 16.5,
      lng: 80.6,
    }),
  ]))[0].booking_id;
  const charged = await one(`
    select b.platform_fee, b.total_amount, q.total as package_total,
           array_agg(ps.amount order by ps.seq) as scheduled_amounts
      from public.bookings b
      join public.quotes q on q.booking_id = b.id
      join public.payment_schedule ps on ps.booking_id = b.id
     where b.id = $1::uuid
     group by b.id, q.total
  `, [bookingId]);
  const amounts = {
    fee: Number(fee),
    platform_fee: Number(charged.platform_fee),
    package_total: Number(charged.package_total),
    total_amount: Number(charged.total_amount),
    scheduled_amounts: charged.scheduled_amounts.map(Number),
  };
  ok(JSON.stringify(amounts) === JSON.stringify({
    fee: 2900,
    platform_fee: 2900,
    package_total: 99900,
    total_amount: 102800,
    scheduled_amounts: [99900, 2900],
  }), `default fixed checkout matches the ₹999 + ₹29 sample: ${JSON.stringify({
    bookingId,
    customerId: fixture.customer,
    providerId: fixture.provider,
    serviceId: fixture.serviceId,
    packageId,
    amounts,
  })}`);
});

await scenario('fixed fee follows app_config and matches the booking charge', async () => {
  const fixture = await createServiceFixture({
    customer: '00000000-0000-0000-0000-000000000741',
    provider: '00000000-0000-0000-0000-000000000742',
    slug: 'b1-fixed-price-preview',
    archetype: 'fixed',
    visitFee: 0,
  });
  await db.query(`
    update public.app_config
       set value = jsonb_set(value, '{fixed}', 'true'::jsonb, true)
     where key = 'archetype_flags'
  `);
  await db.query(`
    update public.app_config
       set value = jsonb_set(value, '{platform_fee_paise}', '4321'::jsonb, true)
     where key = 'fixed_booking'
  `);
  const packageId = (await one(`
    insert into public.service_packages (
      provider_service_id, title, price_type, price, price_min, price_max,
      unit, qty_min, qty_max, duration_min, active
    ) values (
      $1::uuid, 'B1 fixed package', 'fixed', 99900, 99900, 99900,
      'job', 1, 1, 60, true
    ) returning id
  `, [fixture.serviceId])).id;
  const fee = (await as(fixture.customer, 'authenticated', `
    select public.get_fixed_booking_fee() as fee
  `))[0].fee;
  const start = '2026-12-15T10:00:00+05:30';
  const end = '2026-12-15T12:00:00+05:30';
  const bookingId = (await as(fixture.customer, 'authenticated', `
    select public.create_fixed_booking(
      $1::uuid,
      $2::numeric,
      tstzrange($3::timestamptz, $4::timestamptz, '[)'),
      $5::jsonb,
      '{}'::jsonb
    ) as booking_id
  `, [
    packageId,
    1,
    start,
    end,
    JSON.stringify({
      mode: 'at_customer',
      address_line: 'B1 fixed address',
      city: 'B1 Fixture City',
      lat: 16.5,
      lng: 80.6,
    }),
  ]))[0].booking_id;
  const charged = await one(`
    select b.platform_fee, b.total_amount, q.total as package_total,
           array_agg(ps.amount order by ps.seq) as scheduled_amounts
      from public.bookings b
      join public.quotes q on q.booking_id = b.id
      join public.payment_schedule ps on ps.booking_id = b.id
     where b.id = $1::uuid
     group by b.id, q.total
  `, [bookingId]);
  const actual = {
    fee: Number(fee),
    platform_fee: Number(charged.platform_fee),
    total_amount: Number(charged.total_amount),
    package_total: Number(charged.package_total),
    scheduled_amounts: charged.scheduled_amounts.map(Number),
  };
  ok(JSON.stringify(actual) === JSON.stringify({
    fee: 4321,
    platform_fee: 4321,
    total_amount: 104221,
    package_total: 99900,
    scheduled_amounts: [99900, 4321],
  }), `fixed preview fee matches the server package charge: ${JSON.stringify(actual)}`);
});

finish();

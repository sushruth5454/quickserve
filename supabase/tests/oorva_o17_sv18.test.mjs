import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const migration = (file) =>
  fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create schema if not exists extensions;
  create type extensions.geography as (lng float8, lat float8);
  create type extensions.geometry as (lng float8, lat float8);
  create function extensions.st_makepoint(x float8, y float8) returns extensions.geography
    language sql immutable as $$ select row(x, y)::extensions.geography $$;
  create function extensions.st_setsrid(g extensions.geography, srid int) returns extensions.geography
    language sql immutable as $$ select g $$;
  create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8
    language sql immutable as $$
      select 2 * 6371000 * asin(sqrt(power(sin(radians(b.lat - a.lat) / 2), 2)
        + cos(radians(a.lat)) * cos(radians(b.lat))
        * power(sin(radians(b.lng - a.lng) / 2), 2)))
    $$;
  create function extensions.st_dwithin(a extensions.geography, b extensions.geography, d float8)
    returns boolean language sql immutable as $$ select extensions.st_distance(a, b) <= d $$;
  create function extensions.geog_to_geom(g extensions.geography) returns extensions.geometry
    language sql immutable as $$ select row(g.lng, g.lat)::extensions.geometry $$;
  create cast (extensions.geography as extensions.geometry)
    with function extensions.geog_to_geom(extensions.geography);
  create function extensions.st_x(g extensions.geometry) returns float8
    language sql immutable as $$ select g.lng $$;
  create function extensions.st_y(g extensions.geometry) returns float8
    language sql immutable as $$ select g.lat $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, extensions to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    instance_id uuid, id uuid primary key, aud text, role text, phone text,
    phone_confirmed_at timestamptz, raw_app_meta_data jsonb default '{}',
    raw_user_meta_data jsonb default '{}', created_at timestamptz, updated_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text
  );
  alter table storage.objects enable row level security;
  grant select, insert, delete on storage.objects to authenticated, anon, service_role;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

for (const file of fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}[a-z]?_.*\.sql$/.test(name))
  .sort()) {
  await db.exec(migration(file));
}
await db.exec("set timezone = 'UTC'");

const { ok, scenario, finish } = createHarness();
let fixtureNumber = 0;
const uuid = (prefix, number) => `${prefix}-0000-0000-0000-${String(number).padStart(12, '0')}`;

async function as(uid, role, query, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [uid]);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function failureOf(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error?.message ?? String(error);
  }
}

async function createFixture(label) {
  const index = ++fixtureNumber;
  const customer = uuid('10000000', index);
  const provider = uuid('20000000', index);
  const city = `SV18 ${label} ${index}`;
  await db.query(`
    insert into auth.users (id) values ($1::uuid), ($2::uuid)
  `, [customer, provider]);
  await db.query(`
    update public.profiles
       set full_name=$1::text
     where id in ($2::uuid, $3::uuid)
  `, [`SV18 ${label} ${index}`, customer, provider]);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', now(), 'approved', true, false, false
    )
  `, [provider, city]);
  await db.query(`
    update public.feature_flags set enabled=true where key='recurring_bookings'
  `);
  await db.query(`
    update public.app_config
       set value=value || '{"fixed":true,"time_based":true}'::jsonb
     where key='archetype_flags'
  `);
  const category = (await db.query(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::text, $2::text, 'quote', true, 'fixed', '{}'::jsonb, 1, 365,
      true, array['custom']::text[], 0
    ) returning id
  `, [`sv18-${label}-${index}`, `SV18 ${label} ${index}`])).rows[0].id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [category, city]);
  const service = (await db.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0, 0, true)
    returning id
  `, [provider, category])).rows[0].id;
  const otherService = (await db.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0, 0, true)
    returning id
  `, [provider, category])).rows[0].id;
  const ownPackage = (await db.query(`
    insert into public.service_packages (
      provider_service_id, title, description, price_type, price, price_min, price_max,
      unit, qty_min, qty_max, duration_min, active
    ) values (
      $1::uuid, $2::text, ''::text, 'fixed', 1000, 1000, 1000, 'job', 2, 5, 60, true
    ) returning id
  `, [service, `SV18 own ${index}`])).rows[0].id;
  const foreignPackage = (await db.query(`
    insert into public.service_packages (
      provider_service_id, title, description, price_type, price, price_min, price_max,
      unit, qty_min, qty_max, duration_min, active
    ) values (
      $1::uuid, $2::text, ''::text, 'fixed', 2000, 2000, 2000, 'job', 2, 5, 60, true
    ) returning id
  `, [otherService, `SV18 foreign ${index}`])).rows[0].id;
  const inactivePackage = (await db.query(`
    insert into public.service_packages (
      provider_service_id, title, description, price_type, price, price_min, price_max,
      unit, qty_min, qty_max, duration_min, active
    ) values (
      $1::uuid, $2::text, ''::text, 'fixed', 3000, 3000, 3000, 'job', 2, 5, 60, false
    ) returning id
  `, [service, `SV18 inactive ${index}`])).rows[0].id;
  const address = (await db.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Home', $2::text, $3::text, 16.50, 80.60)
    returning id
  `, [customer, `SV18 address ${index}`, city])).rows[0].id;
  const input = {
    provider_service_id: service,
    package_id: ownPackage,
    archetype: 'fixed',
    frequency: 'custom',
    interval_count: 1,
    weekdays: [],
    month_day: null,
    custom_dates: ['2027-10-15'],
    start_date: '2027-10-15',
    end_date: null,
    max_occurrences: 1,
    start_time: '10:00',
    duration_min: null,
    package_qty: 2.5,
    billing_frequency: 'per_visit',
    address_id: address,
    description: `SV18 isolated test ${index}`,
  };
  return { customer, service, ownPackage, foreignPackage, inactivePackage, input };
}

async function rejectedDirectRpc(fixture, packageId) {
  const input = { ...fixture.input, package_id: packageId };
  const before = (await db.query(`
    select count(*)::int as count
      from public.recurring_schedules
     where customer_id=$1::uuid
  `, [fixture.customer])).rows[0].count;
  const quoteError = await failureOf(() => as(
    fixture.customer,
    'authenticated',
    `select public.quote_recurring_plan($1::jsonb) as value`,
    [JSON.stringify(input)],
  ));
  const createError = await failureOf(() => as(
    fixture.customer,
    'authenticated',
    `select public.create_recurring_plan($1::jsonb) as id`,
    [JSON.stringify(input)],
  ));
  const after = (await db.query(`
    select count(*)::int as count
      from public.recurring_schedules
     where customer_id=$1::uuid
  `, [fixture.customer])).rows[0].count;
  return { input, quoteError, createError, before, after };
}

await scenario('SV-RECURRING-PACKAGE-03 foreign package', async () => {
  const fixture = await createFixture('foreign-package');
  const actual = await rejectedDirectRpc(fixture, fixture.foreignPackage);
  ok(
    /active fixed package not found/i.test(actual.quoteError ?? '') &&
      /active fixed package not found/i.test(actual.createError ?? '') &&
      actual.before === actual.after,
    `[SV-RECURRING-PACKAGE-03] direct quote/create reject another service's package: ${JSON.stringify(actual)}`,
  );
});

await scenario('SV-RECURRING-PACKAGE-03 inactive package', async () => {
  const fixture = await createFixture('inactive-package');
  const actual = await rejectedDirectRpc(fixture, fixture.inactivePackage);
  ok(
    /active fixed package not found/i.test(actual.quoteError ?? '') &&
      /active fixed package not found/i.test(actual.createError ?? '') &&
      actual.before === actual.after,
    `[SV-RECURRING-PACKAGE-03] direct quote/create reject an inactive package: ${JSON.stringify(actual)}`,
  );
});

await scenario('SV-RECURRING-PACKAGE-03 quantity bounds', async () => {
  const fixture = await createFixture('quantity-bounds');
  const validInput = { ...fixture.input, package_id: fixture.ownPackage, package_qty: 2.5 };
  const validQuoteError = await failureOf(() => as(
    fixture.customer,
    'authenticated',
    `select public.quote_recurring_plan($1::jsonb) as value`,
    [JSON.stringify(validInput)],
  ));
  const validQuote = validQuoteError
    ? null
    : (await as(
        fixture.customer,
        'authenticated',
        `select public.quote_recurring_plan($1::jsonb) as value`,
        [JSON.stringify(validInput)],
      ))[0].value;
  const invalidInput = { ...fixture.input, package_qty: 6 };
  const before = (await db.query(`
    select count(*)::int as count
      from public.recurring_schedules
     where customer_id=$1::uuid
  `, [fixture.customer])).rows[0].count;
  const invalidQuoteError = await failureOf(() => as(
    fixture.customer,
    'authenticated',
    `select public.quote_recurring_plan($1::jsonb) as value`,
    [JSON.stringify(invalidInput)],
  ));
  const invalidCreateError = await failureOf(() => as(
    fixture.customer,
    'authenticated',
    `select public.create_recurring_plan($1::jsonb) as id`,
    [JSON.stringify(invalidInput)],
  ));
  const after = (await db.query(`
    select count(*)::int as count
      from public.recurring_schedules
     where customer_id=$1::uuid
  `, [fixture.customer])).rows[0].count;
  const actual = {
    validInput,
    validQuoteError,
    validQuote,
    invalidInput,
    invalidQuoteError,
    invalidCreateError,
    invalidFixtureCounts: { before, after },
  };
  ok(
    !validQuoteError &&
      validQuote?.per_visit_paise > 0 &&
      /quantity is outside the package bounds/i.test(invalidQuoteError ?? '') &&
      /quantity is outside the package bounds/i.test(invalidCreateError ?? '') &&
      before === after,
    `[SV-RECURRING-PACKAGE-03] server accepts in-bound fractional quantity and rejects above maximum: ${JSON.stringify(actual)}`,
  );
});

finish();

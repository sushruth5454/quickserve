import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const targetMigration = '0079_f7_platform_fees_and_identity.sql';
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}[a-z]?_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 79)
  .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
if (!migrationFiles.includes(targetMigration)) {
  throw new Error(`missing reserved F7 migration: ${targetMigration}`);
}

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
  grant select, insert, delete on storage.objects to authenticated, anon, service_role;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

for (const file of migrationFiles) {
  try {
    await db.exec(migration(file));
  } catch (error) {
    throw new Error(`migration ${file} failed: ${error.message}`, { cause: error });
  }
}
await db.exec("set timezone = 'UTC'");

async function one(query, params = []) {
  return (await db.query(query, params)).rows[0];
}

async function as(uid, role, query, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [uid ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function fails(query, params = [], uid, role = 'authenticated') {
  try {
    await as(uid, role, query, params);
    return '';
  } catch (error) {
    return error.message;
  }
}

function uuid(n) {
  return `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
}

async function createFixture(index, archetype = 'inspect_quote') {
  const customer = uuid(index * 10 + 1);
  const provider = uuid(index * 10 + 2);
  const admin = uuid(index * 10 + 3);
  const city = `F7 Fees City ${index}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $4::text, '{}'::jsonb), ($2::uuid, $5::text, '{}'::jsonb),
           ($3::uuid, $6::text, '{}'::jsonb)`,
  [customer, provider, admin, `+9191000${String(index).padStart(4, '0')}`,
    `+9191001${String(index).padStart(4, '0')}`, `+9191002${String(index).padStart(4, '0')}`]);
  await db.query(`insert into public.admins (user_id) values ($1::uuid)`, [admin]);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended, created_at
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', now(), 'approved', true, false, false, '2026-01-01T00:00:00Z'::timestamptz
    )`, [provider, city]);
  const categoryId = (await one(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, cancellation_policy, location_modes,
      min_lead_hours, max_lead_days, restricted, requires_docs
    ) values (
      $1::text, $2::text, 'quote', true, $3::text, 'standard_visit',
      array['at_customer']::text[], 0, 365, false, '{}'::text[]
    ) returning id`, [`f7-fees-${index}`, `F7 fee category ${index}`, archetype])).id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())`, [categoryId, city]);
  const serviceId = (await one(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 19900, 60000, true) returning id`,
  [provider, categoryId])).id;
  await db.query(`
    insert into public.provider_availability (provider_id, weekday, start_time, end_time)
    select $1::uuid, day, time '00:00', time '23:59' from generate_series(0, 6) day`,
  [provider]);
  const addressId = (await one(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Home', 'F7 test address', $2::text, 16.50, 80.60) returning id`,
  [customer, city])).id;
  return { customer, provider, admin, city, categoryId, serviceId, addressId };
}

async function createInspectBooking(fixture, scheduledAt) {
  return (await as(fixture.customer, 'authenticated', `
    select public.create_booking(
      $1::uuid, 'F7 test', 'F7 customer address', $2::text, 16.50::float8, 80.60::float8,
      $3::timestamptz, '{}'::text[]
    ) as id
  `, [fixture.serviceId, fixture.city, scheduledAt]))[0].id;
}

async function createInspectingBooking(fixture, scheduledAt) {
  return (await one(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, visit_fee, platform_fee, status, archetype, scheduled_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      'F7 quote fixture', 19900, 2900, 'inspecting', 'inspect_quote', $6::timestamptz
    ) returning id
  `, [fixture.customer, fixture.provider, fixture.categoryId, fixture.serviceId, fixture.addressId, scheduledAt])).id;
}

await scenario('admin fee config is validated and affects only new inspect bookings', async () => {
  const fixture = await createFixture(7901);
  const defaults = (await as(fixture.admin, 'authenticated', `
    select public.admin_get_platform_fees() as config
  `))[0].config;
  const businessFlag = await one(`
    select enabled from public.feature_flags where key = $1::text
  `, ['business_payout_identity']);
  const feeSettingsFlag = await one(`
    select enabled from public.feature_flags where key = $1::text
  `, ['platform_fee_settings']);
  const tax = await one(`select value from public.app_config where key = $1::text`, ['tax']);
  const defaultActual = {
    inspect_quote: Number(defaults.inspect_quote),
    time_based_session: Number(defaults.time_based_session),
    pack: Number(defaults.pack),
    proposal_bp: Number(defaults.proposal.bp),
    proposal_min: Number(defaults.proposal.min),
    proposal_max: Number(defaults.proposal.max),
  };
  ok(JSON.stringify(defaultActual) === JSON.stringify({
    inspect_quote: 2900,
    time_based_session: 2900,
    pack: 4900,
    proposal_bp: 100,
    proposal_min: 9900,
    proposal_max: 49900,
  }), `fee defaults preserve the current server charges: ${JSON.stringify(defaults)}`);
  ok(businessFlag.enabled === false,
    `business payout identity starts disabled: ${JSON.stringify({ enabled: businessFlag.enabled })}`);
  ok(feeSettingsFlag.enabled === true,
    `admin fee settings are enabled: ${JSON.stringify({ enabled: feeSettingsFlag.enabled })}`);
  await as(fixture.admin, 'authenticated', `
    select public.admin_set_feature($1::text, true::boolean)
  `, ['business_payout_identity']);
  const businessEnabled = await one(`
    select enabled from public.feature_flags where key = $1::text
  `, ['business_payout_identity']);
  ok(businessEnabled.enabled === true,
    `admin can enable business payout identity: ${JSON.stringify({ enabled: businessEnabled.enabled })}`);
  await as(fixture.admin, 'authenticated', `
    select public.admin_set_feature($1::text, false::boolean)
  `, ['business_payout_identity']);
  ok(Number(tax.value.gst_on_commission_bp) === 0
    && Number(tax.value.tds_bp) === 0
    && Number(tax.value.tcs_bp) === 0,
  `tax values remain zero placeholders: ${JSON.stringify(tax.value)}`);

  const before = await createInspectBooking(fixture, '2027-02-03T10:00:00+05:30');
  const updated = {
    inspect_quote: 3500,
    time_based_session: 3600,
    pack: 5900,
    proposal: { bp: 125, min: 10000, max: 55000 },
  };
  await as(fixture.admin, 'authenticated', `
    select public.admin_set_platform_fees($1::jsonb)
  `, [JSON.stringify(updated)]);
  const after = await createInspectBooking(fixture, '2027-02-03T14:00:00+05:30');
  const amounts = await db.query(`
    select id::text, platform_fee from public.bookings
     where id = any($1::uuid[]) order by created_at, id
  `, [[before, after]]);
  const actual = amounts.rows.map((row) => ({ id: row.id, paise: Number(row.platform_fee) }));
  ok(actual.length === 2
    && actual.find((row) => row.id === before)?.paise === 2900
    && actual.find((row) => row.id === after)?.paise === 3500,
  `existing booking keeps its fee and next booking uses admin config: ${JSON.stringify(actual)}`);

  const invalid = await fails('select public.admin_set_platform_fees($1::jsonb)', [
    JSON.stringify({ ...updated, proposal: { bp: 10001, min: 10000, max: 55000 } }),
  ], fixture.admin);
  ok(invalid.includes('platform fee values are out of range'), `invalid rate rejected: ${JSON.stringify({ invalid })}`);
  const denied = await fails('select public.admin_set_platform_fees($1::jsonb)', [
    JSON.stringify(updated),
  ], fixture.customer);
  ok(denied.includes('admin only'), `non-admin cannot change fees: ${JSON.stringify({ denied })}`);

  await as(fixture.admin, 'authenticated', `
    select public.admin_set_feature($1::text, false::boolean)
  `, ['platform_fee_settings']);
  const disabled = await fails('select public.admin_set_platform_fees($1::jsonb)', [
    JSON.stringify(updated),
  ], fixture.admin);
  ok(disabled.includes('platform fee settings are turned off'),
    `feature-off rejects admin edits: ${JSON.stringify({ disabled })}`);
  const stillBooking = await createInspectBooking(fixture, '2027-02-04T10:00:00+05:30');
  const stillCharged = await one(`
    select platform_fee from public.bookings where id = $1::uuid
  `, [stillBooking]);
  ok(Number(stillCharged.platform_fee) === 3500,
    `turning off admin controls leaves booking fee path active: ${JSON.stringify({ paise: Number(stillCharged.platform_fee) })}`);
});

await scenario('admin fee reader uses validated values for sessions and packs', async () => {
  const fixture = await createFixture(7902, 'time_based');
  await as(fixture.admin, 'authenticated', `
    select public.admin_set_feature($1::text, true::boolean)
  `, ['platform_fee_settings']);
  const fees = {
    inspect_quote: 3100,
    time_based_session: 4100,
    pack: 6100,
    proposal: { bp: 150, min: 11000, max: 60000 },
  };
  await as(fixture.admin, 'authenticated', `
    select public.admin_set_platform_fees($1::jsonb)
  `, [JSON.stringify(fees)]);
  const sessionId = (await as(null, 'service_role', `
    select public._create_session_booking(
      $1::uuid, $2::uuid, null::uuid, $3::timestamptz, 60::int,
      'F7 session address', $4::text, 16.50::float8, 80.60::float8,
      'F7 session fee', null::uuid, null::uuid, null::int
    ) as id
  `, [fixture.customer, fixture.serviceId, '2027-02-04T10:00:00+05:30', fixture.city]))[0].id;
  const session = await one(`select platform_fee from public.bookings where id = $1::uuid`, [sessionId]);
  ok(Number(session.platform_fee) === 4100,
    `new time-based session uses configured fee: ${JSON.stringify({ actual: Number(session.platform_fee), expected: 4100 })}`);

  const packageId = (await one(`
    insert into public.service_packages (
      provider_service_id, title, description, price_type, price, price_min, price_max,
      unit, qty_min, qty_max, duration_min, active
    ) values ($1::uuid, 'F7 pack', '', 'fixed', 60000, 60000, 60000, 'session', 2, 10, 60, true)
    returning id
  `, [fixture.serviceId])).id;
  await as(fixture.customer, 'authenticated', `
    select public.purchase_session_pack($1::uuid, $2::int)
  `, [packageId, 3]);
  const pack = await one(`
    select platform_fee from public.pack_purchases where customer_id = $1::uuid
  `, [fixture.customer]);
  ok(Number(pack.platform_fee) === 6100,
    `new pack uses configured fee: ${JSON.stringify({ actual: Number(pack.platform_fee), expected: 6100 })}`);
});

await scenario('proposal acceptance applies the configured rate once', async () => {
  const fixture = await createFixture(7904, 'proposal');
  await db.query(`
    update public.app_config
       set value = value || '{"proposal":true}'::jsonb
     where key = 'archetype_flags'
  `);
  const fees = {
    inspect_quote: 3100,
    time_based_session: 4100,
    pack: 6100,
    proposal: { bp: 150, min: 11000, max: 55000 },
  };
  await as(fixture.admin, 'authenticated', `
    select public.admin_set_platform_fees($1::jsonb)
  `, [JSON.stringify(fees)]);
  const requestId = (await as(fixture.customer, 'authenticated', `
    select public.create_service_request(
      $1::uuid, $2::text, 'F7 event area', $3::timestamptz, $4::timestamptz,
      '{"brief":"F7 proposal"}'::jsonb, $5::int, $6::int, $7::uuid, null::text, null::uuid, null::float8, null::float8
    ) as id
  `, [
    fixture.categoryId,
    fixture.city,
    '2027-02-20T10:00:00+05:30',
    '2027-02-20T14:00:00+05:30',
    1000000,
    1000000,
    fixture.addressId,
  ]))[0].id;
  const proposalId = (await as(fixture.provider, 'authenticated', `
    select public.send_proposal(
      $1::uuid,
      '[{"kind":"package","title":"F7 event package","qty":1,"unit":"event","unit_price":1000000}]'::jsonb,
      '[{"label":"Booking","amount":1000000,"due_rule":"at_booking"}]'::jsonb,
      $2::timestamptz,
      'F7 fee test',
      '[]'::jsonb
    ) as id
  `, [requestId, '2027-02-19T10:00:00+05:30']))[0].id;
  const bookingId = (await as(fixture.customer, 'authenticated', `
    select public.accept_proposal($1::uuid, $2::uuid) as id
  `, [proposalId, fixture.addressId]))[0].id;
  const actual = await one(`
    select b.platform_fee, b.total_amount, ps.amount as scheduled_fee
      from public.bookings b
      join public.payment_schedule ps on ps.booking_id = b.id and ps.obligation_type = 'platform_fee'
     where b.id = $1::uuid
  `, [bookingId]);
  ok(Number(actual.platform_fee) === 15000
    && Number(actual.scheduled_fee) === 15000
    && Number(actual.total_amount) === 1015000,
  `proposal fee uses configured 150 bp and is charged once: ${JSON.stringify({
    platform_fee: Number(actual.platform_fee),
    scheduled_fee: Number(actual.scheduled_fee),
    total_amount: Number(actual.total_amount),
  })}`);
});

await scenario('send_quote rejects disallowed kinds and requires bill photo over ₹500 parts', async () => {
  const disallowedFixture = await createFixture(7905);
  const disallowedBooking = await createInspectingBooking(disallowedFixture, '2027-02-05T10:00:00+05:30');
  const disallowed = await fails(`
    select public.send_quote($1::uuid, $2::jsonb, null::text)
  `, [disallowedBooking, JSON.stringify([{ kind: 'discount', title: 'Discount', qty: 1, unit_price: 100 }])],
  disallowedFixture.provider);
  ok(disallowed.includes('quote item kind is not allowed'),
    `disallowed item kind rejected: ${JSON.stringify({ disallowed })}`);

  const missingPhotoFixture = await createFixture(7906);
  const missingPhotoBooking = await createInspectingBooking(missingPhotoFixture, '2027-02-06T10:00:00+05:30');
  const missingPhoto = await fails(`
    select public.send_quote($1::uuid, $2::jsonb, null::text)
  `, [missingPhotoBooking, JSON.stringify([{ kind: 'part', title: 'Part', qty: 1, unit_price: 60000 }])],
  missingPhotoFixture.provider);
  ok(missingPhoto.includes('parts above ₹500 need a bill photo'),
    `over-₹500 part without bill photo rejected: ${JSON.stringify({ missingPhoto })}`);

  const withPhotoFixture = await createFixture(7907);
  const withPhotoBooking = await createInspectingBooking(withPhotoFixture, '2027-02-07T10:00:00+05:30');
  const accepted = await as(withPhotoFixture.provider, 'authenticated', `
    select public.send_quote($1::uuid, $2::jsonb, null::text) as id
  `, [withPhotoBooking, JSON.stringify([{
    kind: 'part', title: 'Part', qty: 1, unit_price: 60000, bill_photo_url: `${withPhotoFixture.provider}/bill.jpg`,
  }])]);
  const stored = await one(`
    select qi.bill_photo_url, q.subtotal_parts
      from public.quote_items qi join public.quotes q on q.id = qi.quote_id
     where qi.quote_id = $1::uuid
  `, [accepted[0].id]);
  ok(stored.bill_photo_url === `${withPhotoFixture.provider}/bill.jpg` && Number(stored.subtotal_parts) === 60000,
    `bill-backed over-₹500 part is accepted and stored: ${JSON.stringify(stored)}`);
});

finish();

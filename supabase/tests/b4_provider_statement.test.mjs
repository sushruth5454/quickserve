import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const migration = (file) =>
  fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}[a-z]?_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 85)
  .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
assert(
  migrationFiles.includes('0085_b4_provider_statement.sql'),
  `B4 migration must be present; actual migrations loaded=${JSON.stringify(migrationFiles)}`,
);

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

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const check = (condition, label, actual) => ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const fails = async (fn) => {
  try { await fn(); return null; } catch (error) { return error.message; }
};

async function as(uid, role, sql, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [uid ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function createUsers(index, entries) {
  const date = '2030-11-01T00:00:00Z';
  await db.query(
    `insert into auth.users (id, phone, raw_user_meta_data, created_at, updated_at)
     values ${entries.map((_, i) => `($${i * 2 + 1}::uuid, $${i * 2 + 2}::text, '{}'::jsonb, $${entries.length * 2 + 1}::timestamptz, $${entries.length * 2 + 1}::timestamptz)`).join(', ')}`,
    [...entries.flatMap((entry) => [entry.id, `+919900${String(index * 10 + entry.offset).padStart(6, '0')}`]), date],
  );
  await db.query(
    `insert into public.profiles (id, full_name)
     values ${entries.map((_, i) => `($${i + 1}::uuid, $${entries.length + i + 1}::text)`).join(', ')}
     on conflict (id) do update set full_name = excluded.full_name`,
    [...entries.map((entry) => entry.id), ...entries.map((entry) => entry.name)],
  );
}

async function createProviderPayout(index, { status = 'pending', createdAt = '2030-11-05T12:00:00Z', transferStatus = 'pending', reversedAmount = 0 } = {}) {
  const customer = uuid(index * 10 + 1);
  const provider = uuid(index * 10 + 2);
  const category = uuid(index * 10 + 3);
  const address = uuid(index * 10 + 4);
  const service = uuid(index * 10 + 5);
  const booking = uuid(index * 10 + 6);
  const payment = uuid(index * 10 + 7);
  const payout = uuid(index * 10 + 8);
  const transfer = uuid(index * 10 + 9);
  await createUsers(index, [
    { id: customer, offset: 1, name: `B4 customer ${index}` },
    { id: provider, offset: 2, name: `B4 provider ${index}` },
  ]);
  await db.query('insert into public.providers (id, city) values ($1::uuid, $2::text)', [provider, `B4 City ${index}`]);
  await db.query(
    `insert into public.categories (id, slug, name) values ($1::uuid, $2::text, $3::text)`,
    [category, `b4-category-${index}`, `B4 category ${index}`],
  );
  await db.query(
    `insert into public.addresses (id, user_id, label, line1, city, lat, lng)
     values ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::float8, $7::float8)`,
    [address, customer, 'Home', `B4 Street ${index}`, `B4 City ${index}`, 12.9, 77.6],
  );
  await db.query(
    `insert into public.provider_services (id, provider_id, category_id, visit_fee, labour_rate)
     values ($1::uuid, $2::uuid, $3::uuid, $4::int, $5::int)`,
    [service, provider, category, 19900, 215000],
  );
  await db.query(
    `insert into public.bookings (id, customer_id, provider_id, category_id, provider_service_id, address_id, visit_fee, platform_fee, scheduled_at, created_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::int, $8::int, $9::timestamptz, $10::timestamptz)`,
    [booking, customer, provider, category, service, address, 19900, 2900, `2030-11-${String(20 + index).padStart(2, '0')}T04:30:00Z`, createdAt],
  );
  await db.query(
    `insert into public.payments (id, booking_id, amount, purpose, status, paid_at)
     values ($1::uuid, $2::uuid, $3::int, $4::public.payment_purpose, $5::public.payment_status, $6::timestamptz)`,
    [payment, booking, 215000, 'balance', 'paid', createdAt],
  );
  await db.query(
    `insert into public.payouts (id, booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after, created_at, transferred_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4::int, $5::int, $6::int, $7::int, $8::public.payout_status, $9::timestamptz, $10::timestamptz, $11::timestamptz)`,
    [payout, booking, provider, 215000, 18000, 3240, 193760, status, '2030-11-06T12:00:00Z', createdAt, status === 'transferred' || status === 'partially_reversed' ? createdAt : null],
  );
  await db.query(
    `insert into public.payout_transfers (id, payout_id, source_payment_id, amount, status, razorpay_transfer_id, utr, reversed_amount, transferred_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4::int, $5::public.transfer_status, $6::text, $7::text, $8::int, $9::timestamptz)`,
    [transfer, payout, payment, 193760, transferStatus, `trf_b4_${index}`, status === 'transferred' ? `utr_b4_${index}` : null, reversedAmount, status === 'transferred' ? createdAt : null],
  );
  return { customer, provider, booking, payout, transfer };
}

async function createVenuePayout(index, { status = 'partially_reversed', createdAt = '2030-11-08T12:00:00Z' } = {}) {
  const owner = uuid(index * 10 + 1);
  const customer = uuid(index * 10 + 2);
  const venue = uuid(index * 10 + 3);
  const activity = uuid(index * 10 + 4);
  const resource = uuid(index * 10 + 5);
  const booking = uuid(index * 10 + 6);
  const payment = uuid(index * 10 + 7);
  const payout = uuid(index * 10 + 8);
  const transfer = uuid(index * 10 + 9);
  await createUsers(index, [
    { id: owner, offset: 1, name: `B4 venue owner ${index}` },
    { id: customer, offset: 2, name: `B4 sports customer ${index}` },
  ]);
  await db.query(
    `insert into public.sports_venues (id, owner_id, name, address_line, city, area, lat, lng, status)
     values ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::float8, $8::float8, $9::text)`,
    [venue, owner, `B4 venue ${index}`, '1 B4 Road', `B4 City ${index}`, `Area ${index}`, 12.9, 77.6, 'verified'],
  );
  await db.query(
    `insert into public.sports_activities (id, slug, name) values ($1::uuid, $2::text, $3::text)`,
    [activity, `b4-activity-${index}`, `B4 activity ${index}`],
  );
  await db.query(
    `insert into public.sports_resources (id, venue_id, activity_id, name)
     values ($1::uuid, $2::uuid, $3::uuid, $4::text)`,
    [resource, venue, activity, `B4 resource ${index}`],
  );
  await db.query(
    `insert into public.sports_bookings (id, customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise, expires_at, created_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $6::timestamptz, $7::text, $8::int, $9::timestamptz, $10::timestamptz)`,
    [booking, customer, venue, resource, `2030-11-${String(20 + index).padStart(2, '0')}T04:30:00Z`, `2030-11-${String(20 + index).padStart(2, '0')}T05:30:00Z`, 'completed', 20000, `2030-11-${String(19 + index).padStart(2, '0')}T04:30:00Z`, createdAt],
  );
  await db.query(
    `insert into public.payments (id, sports_booking_id, amount, purpose, status, razorpay_payment_id, paid_at)
     values ($1::uuid, $2::uuid, $3::int, $4::public.payment_purpose, $5::public.payment_status, $6::text, $7::timestamptz)`,
    [payment, booking, 20000, 'fixed', 'paid', `pay_b4_${index}`, createdAt],
  );
  await db.query(
    `insert into public.payouts (id, sports_booking_id, payee_id, gross, commission, gst_on_commission, amount, status, release_after, created_at, transferred_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4::int, $5::int, $6::int, $7::int, $8::public.payout_status, $9::timestamptz, $10::timestamptz, $11::timestamptz)`,
    [payout, booking, owner, 20000, 2000, 360, 17640, status, '2030-11-09T12:00:00Z', createdAt, status === 'transferred' || status === 'partially_reversed' ? createdAt : null],
  );
  await db.query(
    `insert into public.payout_transfers (id, payout_id, source_payment_id, amount, status, razorpay_transfer_id, utr, reversed_amount, transferred_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4::int, $5::public.transfer_status, $6::text, $7::text, $8::int, $9::timestamptz)`,
    [transfer, payout, payment, 17640, 'transferred', `trf_b4_venue_${index}`, `utr_b4_venue_${index}`, 1000, createdAt],
  );
  return { owner, customer, booking, payout, transfer };
}

const statement = (from = '2030-11-01', to = '2030-11-30') =>
  `select * from public.get_provider_statement($1::date, $2::date) order by payout_id`;

await scenario('statement is disabled by default and venue payout rows stay hidden', async () => {
  const provider = await createProviderPayout(1);
  const venue = await createVenuePayout(2);
  const flag = await one(`select enabled from public.feature_flags where key = $1::text`, ['provider_earnings_statement']);
  const providerRows = await as(provider.provider, 'authenticated', 'select id from public.payouts where id = $1::uuid', [provider.payout]);
  const venueRows = await as(venue.owner, 'authenticated', 'select id from public.payouts where id = $1::uuid', [venue.payout]);
  const disabled = await fails(() => as(provider.provider, 'authenticated', statement(), ['2030-11-01', '2030-11-30']));
  check(flag.enabled === false, 'provider earnings statement defaults OFF', flag);
  check(providerRows.length === 1, 'existing provider payout rows remain readable while the statement is OFF', providerRows);
  check(venueRows.length === 0, 'venue owner cannot read payout row while flag is OFF', venueRows);
  check(disabled?.toLowerCase().includes('disabled'), 'statement RPC rejects access while flag is OFF', disabled);
});

await scenario('provider and venue owners see their own rows but a stranger sees neither', async () => {
  const provider = await createProviderPayout(3);
  const venue = await createVenuePayout(4);
  const stranger = uuid(999);
  await createUsers(10, [{ id: stranger, offset: 1, name: 'B4 stranger' }]);
  await db.query(`update public.feature_flags set enabled = $1::boolean where key = $2::text`, [true, 'provider_earnings_statement']);

  const providerRows = await as(provider.provider, 'authenticated', statement(), ['2030-11-01', '2030-11-30']);
  const venueRows = await as(venue.owner, 'authenticated', statement(), ['2030-11-01', '2030-11-30']);
  const strangerRows = await as(stranger, 'authenticated', statement(), ['2030-11-01', '2030-11-30']);
  const providerRls = await as(provider.provider, 'authenticated', 'select id from public.payouts where id = $1::uuid', [provider.payout]);
  const venueRls = await as(venue.owner, 'authenticated', 'select id from public.payouts where id = $1::uuid', [venue.payout]);
  const providerOnVenueRls = await as(provider.provider, 'authenticated', 'select id from public.payouts where id = $1::uuid', [venue.payout]);
  const venueOnProviderRls = await as(venue.owner, 'authenticated', 'select id from public.payouts where id = $1::uuid', [provider.payout]);
  const strangerRls = await as(stranger, 'authenticated', 'select id from public.payouts where id in ($1::uuid, $2::uuid)', [provider.payout, venue.payout]);
  const unauthenticated = await fails(() => as(null, 'anon', statement(), ['2030-11-01', '2030-11-30']));

  check(providerRows.length === 1 && providerRows[0].payout_id === provider.payout, 'provider statement includes only owned provider payout', providerRows);
  check(venueRows.length === 1 && venueRows[0].sports_booking_id === venue.booking, 'venue owner statement includes sports payout', venueRows);
  check(strangerRows.length === 0, 'authenticated stranger receives no statement rows', strangerRows);
  check(providerRls.length === 1 && venueRls.length === 1 && providerOnVenueRls.length === 0
    && venueOnProviderRls.length === 0 && strangerRls.length === 0,
  'RLS allows each payee and denies other owners and unrelated users', { providerRls, venueRls, providerOnVenueRls, venueOnProviderRls, strangerRls });
  check(Boolean(unauthenticated), 'anonymous statement call is rejected', unauthenticated);
});

await scenario('statement uses stored paise, reversals, transfer references, and the inclusive period', async () => {
  const owner = await createProviderPayout(5, { status: 'partially_reversed', transferStatus: 'transferred', reversedAmount: 125 });
  const outsidePeriod = await createProviderPayout(6, { createdAt: '2030-12-01T00:00:00Z' });
  const rows = await as(owner.provider, 'authenticated', statement(), ['2030-11-01', '2030-11-30']);
  const row = rows.find((item) => item.payout_id === owner.payout);
  const stored = await one(
    `select po.gross, po.commission, po.gst_on_commission, po.amount,
            coalesce(sum(pt.reversed_amount), 0)::int as reversed_amount
       from public.payouts po
       left join public.payout_transfers pt on pt.payout_id = po.id
      where po.id = $1::uuid
      group by po.id`,
    [owner.payout],
  );
  check(rows.length === 1 && !rows.some((item) => item.payout_id === outsidePeriod.payout), 'period includes matching payout dates only', rows);
  check(row?.gross === stored.gross && row?.commission === stored.commission
    && row?.gst_on_commission === stored.gst_on_commission && row?.net === stored.amount
    && row?.reversed_amount === stored.reversed_amount,
  'statement amounts exactly match stored payout and transfer rows in paise', { row, stored });
  check(row?.razorpay_transfer_id === `trf_b4_5` && row?.utr === `utr_b4_5`, 'statement includes stored transfer reference and UTR', row);
});

await scenario('statement preserves pending, frozen, and failed payout states', async () => {
  const pending = await createProviderPayout(7, { status: 'pending', transferStatus: 'processing' });
  const frozen = await createProviderPayout(8, { status: 'frozen', transferStatus: 'pending' });
  const failed = await createProviderPayout(9, { status: 'failed', transferStatus: 'failed' });
  const results = [];
  for (const payout of [pending, frozen, failed]) {
    results.push(await as(payout.provider, 'authenticated', statement(), ['2030-11-01', '2030-11-30']));
  }
  const statuses = results.map((rows) => rows[0]?.status);
  check(statuses.join(',') === 'pending,frozen,failed', 'statement preserves payout states without marking failed transfers paid', statuses);
});

finish();

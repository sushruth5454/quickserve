import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const migration = (name) =>
  fs.readFileSync(path.join(migrationsDir, name), 'utf8')
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
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}[a-z]?_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 73)
  .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
for (const name of migrationFiles) await db.exec(migration(name));
await db.exec("set timezone = 'UTC'");
const [{ id: acRepairCategoryId }] = (await db.query(
  `select id from public.categories where slug = 'ac-repair'`,
)).rows;
await db.query(
  `insert into public.category_cities (category_id, city, live, launched_at)
   values ($1::uuid, $2::text, true, now())
   on conflict (category_id, city) do update
     set live = true, launched_at = coalesce(public.category_cities.launched_at, excluded.launched_at)`,
  [acRepairCategoryId, 'Vijayawada'],
);

const { ok, scenario, finish } = createHarness();
const check = (condition, label, actual) => ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const uuid = async () => (await one(`select gen_random_uuid()::text as id`)).id;
const gatewayId = async () => `pay_${(await uuid()).replaceAll('-', '')}`;
let nextPhone = 7000000000;

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

const service = (sql, params = []) => as(null, 'service_role', sql, params);
const json = (value) => typeof value === 'string' ? JSON.parse(value) : value;

async function createActors() {
  const customer = await uuid();
  const provider = await uuid();
  await db.query(
    `insert into auth.users (id, phone) values
      ($1::uuid, $2::text), ($3::uuid, $4::text)`,
    [customer, `+91${nextPhone++}`, provider, `+91${nextPhone++}`],
  );
  await db.query(
    `insert into public.providers (
       id, bio, city, years_experience, kyc_status, razorpay_account_id, created_at,
       submitted_at, is_online, suspended, paused
     ) values (
       $1::uuid, 'F1 payment test provider', 'Vijayawada', 5, 'verified', $2::text,
       now() - interval '90 days', now(), true, false, false
     )`,
    [provider, `acc_${provider.slice(0, 8)}`],
  );
  const [{ id: serviceId }] = (await db.query(
    `insert into public.provider_services (provider_id, category_id, skill_level, visit_fee, labour_rate, active)
     values ($1::uuid, $2::uuid, 'expert', 19900, 60000, true) returning id`,
    [provider, acRepairCategoryId],
  )).rows;
  return { customer, provider, serviceId };
}

async function createHomePayment() {
  const actors = await createActors();
  const [{ booking_id: bookingId }] = await as(
    actors.customer,
    'authenticated',
    `select public.create_booking(
       $1::uuid, $2::text, $3::text, $4::text, $5::numeric, $6::numeric
     ) as booking_id`,
    [actors.serviceId, `F1 visit ${await uuid()}`, '12 MG Road', 'Vijayawada', 16.51, 80.64],
  );
  const [payment] = await service(
    `select * from public.prepare_payment($1::uuid, $2::uuid)`,
    [bookingId, actors.customer],
  );
  const link = `f1-home-${payment.payment_id}`;
  await db.query(
    `update public.payments
        set razorpay_link_id = $1::text, short_url = $2::text
      where id = $3::uuid`,
    [link, 'https://pay.test/f1-home', payment.payment_id],
  );
  return { ...actors, bookingId, payment, link };
}

async function createTimeService() {
  const actors = await createActors();
  const suffix = actors.provider.replaceAll('-', '').slice(0, 12);
  await db.query(
    `update public.app_config
        set value = value || '{"time_based":true}'::jsonb
      where key = 'archetype_flags'`,
  );
  const [{ id: categoryId }] = (await db.query(
    `insert into public.categories (
       slug, name, pricing_mode, active, archetype, intake_schema, config_version, max_lead_days,
       recurrence_allowed, allowed_frequencies, recurring_discount_bp
     ) values (
       $1::text, $2::text, 'quote', true, 'time_based', '{}'::jsonb, 1, 365,
       true, array['daily','alternate_days','weekly','monthly','custom']::text[], 0
     ) returning id`,
    [`f1-time-${suffix}`, `F1 time service ${suffix}`],
  )).rows;
  await db.query(
    `insert into public.category_cities (category_id, city, live, launched_at)
     values ($1::uuid, $2::text, true, now())`,
    [categoryId, 'Vijayawada'],
  );
  const [{ id: timeServiceId }] = (await db.query(
    `insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
     values ($1::uuid, $2::uuid, 0, 60000, true) returning id`,
    [actors.provider, categoryId],
  )).rows;
  await db.query(
    `insert into public.provider_availability (provider_id, weekday, start_time, end_time)
     select $1::uuid, day::smallint, time '08:00', time '20:00'
       from generate_series(0, 6) day`,
    [actors.provider],
  );
  const [{ id: packageId }] = (await db.query(
    `insert into public.service_packages (
       provider_service_id, title, description, price_type, price, price_min, price_max,
       unit, qty_min, qty_max, duration_min, active
     ) values (
       $1::uuid, $2::text, ''::text, 'fixed', 60000, 60000, 60000,
       'session', 2, 5, 60, true
     ) returning id`,
    [timeServiceId, `F1 package ${suffix}`],
  )).rows;
  return { ...actors, timeServiceId, packageId };
}

async function createSessionPayment() {
  const fixture = await createTimeService();
  const [{ booking_id: bookingId }] = await service(
    `select public._create_session_booking(
       $1::uuid, $2::uuid, null::uuid,
       make_timestamptz(2027, 1, 11, 10, 0, 0, 'Asia/Kolkata'),
       60::int, $3::text, $4::text, 16.51::double precision, 80.64::double precision,
       $5::text, null::uuid, null::uuid
     ) as booking_id`,
    [fixture.customer, fixture.timeServiceId, '1 F1 Road', 'Vijayawada', 'F1 session payment'],
  );
  await db.query(
    `delete from public.payment_schedule
      where booking_id = $1::uuid and seq = 2::int`,
    [bookingId],
  );
  const [payment] = await service(
    `select * from public.prepare_session_payment($1::uuid, $2::uuid, null::uuid)`,
    [bookingId, fixture.customer],
  );
  const link = `f1-session-${payment.payment_id}`;
  await db.query(
    `update public.payments
        set razorpay_link_id = $1::text, short_url = $2::text
      where id = $3::uuid`,
    [link, 'https://pay.test/f1-session', payment.payment_id],
  );
  return { ...fixture, bookingId, payment, link };
}

async function createPackPayment() {
  const fixture = await createTimeService();
  const [{ pack_id: packId }] = await as(
    fixture.customer,
    'authenticated',
    `select public.purchase_session_pack($1::uuid, $2::int) as pack_id`,
    [fixture.packageId, 3],
  );
  const [payment] = await service(
    `select * from public.prepare_pack_payment($1::uuid, $2::uuid)`,
    [packId, fixture.customer],
  );
  const link = `f1-pack-${payment.payment_id}`;
  await db.query(
    `update public.payments
        set razorpay_link_id = $1::text, short_url = $2::text
      where id = $3::uuid`,
    [link, 'https://pay.test/f1-pack', payment.payment_id],
  );
  return { ...fixture, packId, payment, link };
}

async function record(fn, link, paymentId, amount) {
  const [row] = await service(
    `select public.${fn}($1::text, $2::text, $3::int) as result`,
    [link, paymentId, amount],
  );
  return json(row.result);
}

async function concurrentRecord(fn, link, paymentId, amount) {
  const calls = await Promise.all([0, 1].map(() =>
    db.query(
      `select public.${fn}($1::text, $2::text, $3::int) as result`,
      [link, paymentId, amount],
    )));
  return calls.map((result) => json(result.rows[0].result));
}

await scenario('WS6-T01 every recorder locks a payment id before checking duplicates', async () => {
  const recorders = [
    'record_payment_paid',
    'record_session_payment_paid',
    'record_pack_payment_paid',
    'record_time_payment_paid',
  ];
  const definitions = [];
  for (const fn of recorders) {
    const [{ prosrc }] = await db.query(
      `select p.prosrc from pg_proc p
        where p.oid = $1::regprocedure`,
      [`public.${fn}(text,text,int)`],
    ).then((result) => result.rows);
    const lockPosition = prosrc.indexOf('perform pg_advisory_xact_lock(hashtext(p_payment_id))');
    const duplicatePosition = prosrc.indexOf(
      'if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id)',
    );
    definitions.push({ fn, lockPosition, duplicatePosition });
  }
  check(
    definitions.every(({ lockPosition, duplicatePosition }) =>
      lockPosition >= 0 && duplicatePosition > lockPosition),
    'all payment-id advisory locks precede the duplicate check',
    definitions,
  );
});

await scenario('WS6-T01 home recorder does not refund a duplicate capture', async () => {
  const fixture = await createHomePayment();
  const paymentId = await gatewayId();
  const results = await concurrentRecord('record_payment_paid', fixture.link, paymentId, fixture.payment.amount);
  const payment = await one(
    `select status, razorpay_payment_id from public.payments where id = $1::uuid`,
    [fixture.payment.payment_id],
  );
  const [{ refunds }] = await db.query(
    `select count(*)::int as refunds from public.refunds r
      join public.payments p on p.id = r.payment_id
     where p.booking_id = $1::uuid`,
    [fixture.bookingId],
  ).then((result) => result.rows);
  const [{ requested_events: requestedEvents }] = await db.query(
    `select count(*)::int as requested_events from public.booking_events
      where booking_id = $1::uuid and to_status = 'requested'`,
    [fixture.bookingId],
  ).then((result) => result.rows);
  check(
    results.filter((result) => result.ok && !result.duplicate).length === 1
      && results.filter((result) => result.duplicate === true).length === 1
      && payment.status === 'paid' && payment.razorpay_payment_id === paymentId
      && refunds === 0 && requestedEvents === 1,
    'same capture is applied once with no refund and one booking advance',
    { results, payment, refunds, requestedEvents },
  );
});

await scenario('WS6-T01 session recorder does not refund a duplicate capture', async () => {
  const fixture = await createSessionPayment();
  const paymentId = await gatewayId();
  const results = await concurrentRecord('record_session_payment_paid', fixture.link, paymentId, fixture.payment.amount);
  const payment = await one(
    `select status, razorpay_payment_id from public.payments where id = $1::uuid`,
    [fixture.payment.payment_id],
  );
  const [{ status: bookingStatus }] = await db.query(
    `select status from public.bookings where id = $1::uuid`,
    [fixture.bookingId],
  ).then((result) => result.rows);
  const [{ refunds }] = await db.query(
    `select count(*)::int as refunds from public.refunds r
      join public.payments p on p.id = r.payment_id
     where p.booking_id = $1::uuid`,
    [fixture.bookingId],
  ).then((result) => result.rows);
  const [{ requested_events: requestedEvents }] = await db.query(
    `select count(*)::int as requested_events from public.booking_events
      where booking_id = $1::uuid and to_status = 'requested'`,
    [fixture.bookingId],
  ).then((result) => result.rows);
  check(
    results.filter((result) => result.ok && !result.duplicate).length === 1
      && results.filter((result) => result.duplicate === true).length === 1
      && payment.status === 'paid' && payment.razorpay_payment_id === paymentId
      && bookingStatus === 'requested' && refunds === 0 && requestedEvents === 1,
    'same session capture is applied once with no refund and one booking advance',
    { results, payment, bookingStatus, refunds, requestedEvents },
  );
});

await scenario('WS6-T01 pack recorder does not refund a duplicate capture', async () => {
  const fixture = await createPackPayment();
  const paymentId = await gatewayId();
  const results = await concurrentRecord('record_pack_payment_paid', fixture.link, paymentId, fixture.payment.amount);
  const payment = await one(
    `select status, razorpay_payment_id from public.payments where id = $1::uuid`,
    [fixture.payment.payment_id],
  );
  const [{ pack_status: packStatus }] = await db.query(
    `select status as pack_status from public.pack_purchases where id = $1::uuid`,
    [fixture.packId],
  ).then((result) => result.rows);
  const [{ refunds }] = await db.query(
    `select count(*)::int as refunds from public.refunds r
      join public.payments p on p.id = r.payment_id
     where p.pack_purchase_id = $1::uuid`,
    [fixture.packId],
  ).then((result) => result.rows);
  check(
    results.filter((result) => result.activated === true).length === 1
      && results.filter((result) => result.duplicate === true).length === 1
      && payment.status === 'paid' && payment.razorpay_payment_id === paymentId
      && packStatus === 'active' && refunds === 0,
    'same pack capture is applied once with no refund and one pack activation',
    { results, payment, packStatus, refunds },
  );
});

await scenario('WS6-T02 home extra capture refunds a new row without reducing net paid', async () => {
  const fixture = await createHomePayment();
  const originalGatewayId = await gatewayId();
  const extraGatewayId = await gatewayId();
  await record('record_payment_paid', fixture.link, originalGatewayId, fixture.payment.amount);
  const [{ net_before: before }] = await service(
    `select public._net_paid($1::uuid) as net_before`,
    [fixture.bookingId],
  );
  const result = await record('record_payment_paid', fixture.link, extraGatewayId, fixture.payment.amount);
  const original = await one(
    `select id, status, razorpay_payment_id from public.payments where id = $1::uuid`,
    [fixture.payment.payment_id],
  );
  const extra = await one(
    `select id, status, amount, razorpay_link_id from public.payments
      where booking_id = $1::uuid and razorpay_payment_id = $2::text`,
    [fixture.bookingId, extraGatewayId],
  );
  const refund = await one(
    `select amount, status, reason from public.refunds where payment_id = $1::uuid`,
    [extra?.id],
  );
  const [{ net_after: after }] = await service(
    `select public._net_paid($1::uuid) as net_after`,
    [fixture.bookingId],
  );
  const [{ booking_status: bookingStatus }] = await db.query(
    `select status as booking_status from public.bookings where id = $1::uuid`,
    [fixture.bookingId],
  ).then((query) => query.rows);
  check(
    result.duplicate_capture === true && result.refund === true
      && original.status === 'paid' && original.razorpay_payment_id === originalGatewayId
      && extra?.amount === fixture.payment.amount && extra.razorpay_link_id === `extra-capture:${extraGatewayId}`
      && refund?.amount === fixture.payment.amount && refund.status === 'pending'
      && refund.reason === 'duplicate capture' && before === after && bookingStatus === 'requested',
    'second capture keeps the original paid row and exact net paid while refunding its own full-amount row',
    { result, original, extra, refund, before, after, bookingStatus },
  );
});

await scenario('WS8-T03 time recorder extra capture preserves the original session row', async () => {
  const fixture = await createSessionPayment();
  const originalGatewayId = await gatewayId();
  const extraGatewayId = await gatewayId();
  await record('record_time_payment_paid', fixture.link, originalGatewayId, fixture.payment.amount);
  const result = await record('record_time_payment_paid', fixture.link, extraGatewayId, fixture.payment.amount);
  const original = await one(
    `select status, razorpay_payment_id from public.payments where id = $1::uuid`,
    [fixture.payment.payment_id],
  );
  const extra = await one(
    `select id, amount, razorpay_link_id from public.payments
      where booking_id = $1::uuid and razorpay_payment_id = $2::text`,
    [fixture.bookingId, extraGatewayId],
  );
  const refund = await one(
    `select amount, status from public.refunds where payment_id = $1::uuid`,
    [extra?.id],
  );
  check(
    result.duplicate_capture === true && original.status === 'paid'
      && original.razorpay_payment_id === originalGatewayId
      && extra?.amount === fixture.payment.amount
      && extra.razorpay_link_id === `extra-capture:${extraGatewayId}`
      && refund?.amount === fixture.payment.amount && refund.status === 'pending',
    'time-based duplicate capture is refunded on a separate row',
    { result, original, extra, refund },
  );
});

await scenario('WS6-T02 pack extra capture refunds a new row without deactivating the pack', async () => {
  const fixture = await createPackPayment();
  const originalGatewayId = await gatewayId();
  const extraGatewayId = await gatewayId();
  await record('record_pack_payment_paid', fixture.link, originalGatewayId, fixture.payment.amount);
  const result = await record('record_pack_payment_paid', fixture.link, extraGatewayId, fixture.payment.amount);
  const original = await one(
    `select status, razorpay_payment_id from public.payments where id = $1::uuid`,
    [fixture.payment.payment_id],
  );
  const extra = await one(
    `select id, amount, razorpay_link_id from public.payments
      where pack_purchase_id = $1::uuid and razorpay_payment_id = $2::text`,
    [fixture.packId, extraGatewayId],
  );
  const refund = await one(
    `select amount, status from public.refunds where payment_id = $1::uuid`,
    [extra?.id],
  );
  const [{ pack_status: packStatus }] = await db.query(
    `select status as pack_status from public.pack_purchases where id = $1::uuid`,
    [fixture.packId],
  ).then((query) => query.rows);
  check(
    result.duplicate_capture === true && original.status === 'paid'
      && original.razorpay_payment_id === originalGatewayId
      && extra?.amount === fixture.payment.amount
      && extra.razorpay_link_id === `extra-capture:${extraGatewayId}`
      && refund?.amount === fixture.payment.amount && refund.status === 'pending'
      && packStatus === 'active',
    'pack duplicate capture is refunded separately while the original pack remains active',
    { result, original, extra, refund, packStatus },
  );
});

await scenario('WS6-T05 home amount mismatch fails the attempt and refunds captured paise', async () => {
  const fixture = await createHomePayment();
  const capturedAmount = fixture.payment.amount + 1234;
  const paymentId = await gatewayId();
  const result = await record('record_payment_paid', fixture.link, paymentId, capturedAmount);
  const original = await one(
    `select status, razorpay_payment_id from public.payments where id = $1::uuid`,
    [fixture.payment.payment_id],
  );
  const capture = await one(
    `select id, amount, razorpay_link_id from public.payments
      where booking_id = $1::uuid and razorpay_payment_id = $2::text`,
    [fixture.bookingId, paymentId],
  );
  const refund = await one(
    `select amount, status from public.refunds where payment_id = $1::uuid`,
    [capture?.id],
  );
  const exception = await one(
    `select reference, razorpay_payment_id, amount, reason
       from public.payment_exceptions where razorpay_payment_id = $1::text`,
    [paymentId],
  );
  check(
    result.ok === true && result.amount_mismatch === true && result.refund === true
      && original.status === 'failed' && original.razorpay_payment_id === null
      && capture?.amount === capturedAmount && capture.razorpay_link_id === `capture:${paymentId}`
      && refund?.amount === capturedAmount && refund.status === 'pending'
      && exception?.amount === capturedAmount && exception.reason === 'amount mismatch',
    'mismatched capture is durably recorded and fully refunded without changing the original attempt',
    { result, original, capture, refund, exception },
  );
});

await scenario('WS6-T05 session amount mismatch fails the attempt and refunds captured paise', async () => {
  const fixture = await createSessionPayment();
  const capturedAmount = fixture.payment.amount + 1234;
  const paymentId = await gatewayId();
  const result = await record('record_time_payment_paid', fixture.link, paymentId, capturedAmount);
  const original = await one(
    `select status, razorpay_payment_id from public.payments where id = $1::uuid`,
    [fixture.payment.payment_id],
  );
  const capture = await one(
    `select id, amount, razorpay_link_id from public.payments
      where booking_id = $1::uuid and razorpay_payment_id = $2::text`,
    [fixture.bookingId, paymentId],
  );
  const refund = await one(
    `select amount, status from public.refunds where payment_id = $1::uuid`,
    [capture?.id],
  );
  const exception = await one(
    `select amount, reason from public.payment_exceptions where razorpay_payment_id = $1::text`,
    [paymentId],
  );
  check(
    result.ok === true && result.amount_mismatch === true && result.refund === true
      && original.status === 'failed' && original.razorpay_payment_id === null
      && capture?.amount === capturedAmount && refund?.amount === capturedAmount
      && refund.status === 'pending'
      && exception?.amount === capturedAmount && exception.reason === 'amount mismatch',
    'mismatched session capture is durably recorded and refunded in exact paise',
    { result, original, capture, refund, exception },
  );
});

await scenario('WS6-T05 pack amount mismatch fails the attempt and refunds captured paise', async () => {
  const fixture = await createPackPayment();
  const capturedAmount = fixture.payment.amount + 1234;
  const paymentId = await gatewayId();
  const result = await record('record_pack_payment_paid', fixture.link, paymentId, capturedAmount);
  const original = await one(
    `select status, razorpay_payment_id from public.payments where id = $1::uuid`,
    [fixture.payment.payment_id],
  );
  const capture = await one(
    `select id, amount, razorpay_link_id from public.payments
      where pack_purchase_id = $1::uuid and razorpay_payment_id = $2::text`,
    [fixture.packId, paymentId],
  );
  const refund = await one(
    `select amount, status from public.refunds where payment_id = $1::uuid`,
    [capture?.id],
  );
  const exception = await one(
    `select amount, reason from public.payment_exceptions where razorpay_payment_id = $1::text`,
    [paymentId],
  );
  check(
    result.ok === true && result.amount_mismatch === true && result.refund === true
      && original.status === 'failed' && original.razorpay_payment_id === null
      && capture?.amount === capturedAmount && refund?.amount === capturedAmount
      && refund.status === 'pending'
      && exception?.amount === capturedAmount && exception.reason === 'amount mismatch',
    'mismatched pack capture is durably recorded and refunded in exact paise',
    { result, original, capture, refund, exception },
  );
});

await scenario('WS8-T04 unknown home/session/pack links are durably recorded as exceptions', async () => {
  const results = [];
  for (const fn of [
    'record_payment_paid',
    'record_session_payment_paid',
    'record_pack_payment_paid',
    'record_time_payment_paid',
  ]) {
    const paymentId = await gatewayId();
    const reference = `unknown-${fn}-${await uuid()}`;
    const result = await record(fn, reference, paymentId, 5000);
    const exception = await one(
      `select reference, razorpay_payment_id, amount, reason
         from public.payment_exceptions where razorpay_payment_id = $1::text`,
      [paymentId],
    );
    results.push({ fn, result, exception, paymentId, reference });
  }
  check(
    results.every(({ result, exception, paymentId, reference }) =>
      result.ok === false && result.exception === true && result.error === 'unknown link'
      && exception?.reference === reference && exception.razorpay_payment_id === paymentId
      && exception.amount === 5000 && exception.reason === 'unknown link'),
    'unknown captures for every home/session/pack entry point have durable exception records',
    results,
  );
});

await scenario('WS8-T04 payment exception table is unavailable to client roles', async () => {
  const hasAnon = await db.query(
    `select has_table_privilege('anon', 'public.payment_exceptions', 'select') as allowed`,
  ).then((result) => result.rows[0].allowed);
  const hasAuthenticated = await db.query(
    `select has_table_privilege('authenticated', 'public.payment_exceptions', 'select') as allowed`,
  ).then((result) => result.rows[0].allowed);
  check(!hasAnon && !hasAuthenticated, 'payment exception records are not readable by client roles', { hasAnon, hasAuthenticated });
});

assert.ok(migrationFiles.includes('0073_f1_payment_recorder_safety.sql'), 'the full migration chain includes the reserved F1 migration');
finish();

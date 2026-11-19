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
  .filter((name) => /^\d{4}[a-z]?_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 78)
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
       submitted_at, admin_review_status, is_online, suspended, paused
     ) values (
       $1::uuid, 'F1 payment test provider', 'Vijayawada', 5, 'verified', $2::text,
       now() - interval '90 days', now(), 'approved', true, false, false
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

async function createSessionPayment({ recurringPlan = false } = {}) {
  const fixture = await createTimeService();
  let recurringScheduleId = null;
  if (recurringPlan) {
    recurringScheduleId = (await one(
      `insert into public.recurring_schedules (
         customer_id, provider_id, provider_service_id, frequency, weekdays,
         start_time, timezone, session_duration_min, payment_mode, address_line,
         city, lat, lng, starts_on, custom_dates, archetype, provider_acceptance,
         acceptance_mode, billing_frequency
       ) values (
         $1::uuid, $2::uuid, $3::uuid, 'custom', array[]::smallint[],
         time '10:00', 'Asia/Kolkata', 60, 'per_session', '1 F1 Road',
         'Vijayawada', 16.51::double precision, 80.64::double precision,
         $4::date, array[$4::date]::date[], 'time_based', 'accepted', 'plan', 'per_visit'
       ) returning id`,
      [fixture.customer, fixture.provider, fixture.timeServiceId, '2027-01-11'],
    )).id;
  }
  const [{ booking_id: bookingId }] = await service(
    `select public._create_session_booking(
       $1::uuid, $2::uuid, null::uuid,
       make_timestamptz(2027, 1, 11, 10, 0, 0, 'Asia/Kolkata'),
       60::int, $3::text, $4::text, 16.51::double precision, 80.64::double precision,
       $5::text, null::uuid, $6::uuid, null::int
     ) as booking_id`,
    [fixture.customer, fixture.timeServiceId, '1 F1 Road', 'Vijayawada', 'F1 session payment', recurringScheduleId],
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
  return { ...fixture, bookingId, payment, link, recurringScheduleId };
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

async function createF6Transfer({
  transferStatus = 'processing',
  payoutStatus = 'pending',
  rail = 'route',
  createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(),
} = {}) {
  const fixture = await createHomePayment();
  const gatewayPaymentId = await gatewayId();
  const captured = await record('record_payment_paid', fixture.link, gatewayPaymentId, fixture.payment.amount);
  if (!captured.ok) throw new Error(`F6 fixture capture failed; actual=${JSON.stringify({ captured, fixture })}`);
  const payout = await one(
    `insert into public.payouts (
       booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
     ) values (
       $1::uuid, $2::uuid, 10000::int, 0::int, 0::int, 10000::int, $3::public.payout_status,
       now() - interval '1 hour'
     ) returning id`,
    [fixture.bookingId, fixture.provider, payoutStatus],
  );
  const transfer = await one(
    `insert into public.payout_transfers (
       payout_id, source_payment_id, amount, status, rail, created_at, razorpay_transfer_id, transferred_at
     ) values (
       $1::uuid, $2::uuid, 10000::int, $3::public.transfer_status, $4::text, $5::timestamptz,
       case when $3::text = 'transferred' then $6::text else null end,
       case when $3::text = 'transferred' then now() - interval '1 hour' else null end
     ) returning id`,
    [payout.id, fixture.payment.payment_id, transferStatus, rail, createdAt, `trf_${await uuid()}`],
  );
  return {
    ...fixture,
    gatewayPaymentId,
    payoutId: payout.id,
    transferId: transfer.id,
    createdAt,
  };
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

await scenario('H2a plan-mode payment remains pre-accepted after F1 recorder overrides', async () => {
  const fixture = await createSessionPayment({ recurringPlan: true });
  const paymentId = await gatewayId();
  const result = await record('record_session_payment_paid', fixture.link, paymentId, fixture.payment.amount);
  const actual = await one(
    `select b.status::text as status, b.accepted_at is not null as accepted_at_set,
            r.acceptance_mode, r.provider_acceptance
       from public.bookings b
       join public.recurring_schedules r on r.id = b.recurring_schedule_id
      where b.id = $1::uuid`,
    [fixture.bookingId],
  );
  const [{ fixed_prosrc: fixedProsrc }] = await db.query(
    `select p.prosrc as fixed_prosrc from pg_proc p
      where p.oid = $1::regprocedure`,
    ['public.record_payment_paid(text,text,int)'],
  ).then((query) => query.rows);
  const fixedPlanBranchPreserved = fixedProsrc.includes('recurring plan pre-accepted')
    && fixedProsrc.includes("r.acceptance_mode = 'plan'")
    && fixedProsrc.includes("r.provider_acceptance = 'accepted'");
  check(
    result.ok === true && actual.status === 'accepted' && actual.accepted_at_set
      && actual.acceptance_mode === 'plan' && actual.provider_acceptance === 'accepted'
      && fixedPlanBranchPreserved,
    'paid plan-mode session is automatically accepted and fixed-recorder plan logic remains present',
    { result, actual, fixedPlanBranchPreserved },
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

await scenario('F5 journals home, session, and pack captures in exact paise', async () => {
  const cases = [
    { name: 'home', create: createHomePayment, recorder: 'record_payment_paid', expectedPaise: 19900 },
    { name: 'session', create: createSessionPayment, recorder: 'record_time_payment_paid', expectedPaise: 60000 },
    { name: 'pack', create: createPackPayment, recorder: 'record_time_payment_paid', expectedPaise: 184900 },
  ];
  const results = [];
  for (const testCase of cases) {
    const fixture = await testCase.create();
    const paymentId = await gatewayId();
    const result = await record(testCase.recorder, fixture.link, paymentId, fixture.payment.amount);
    const replay = await record(testCase.recorder, fixture.link, paymentId, fixture.payment.amount);
    const financialEvent = await one(
      `select id, kind, booking_id, payment_id, amount_paise, gateway_ref
         from public.financial_events
        where payment_id = $1::uuid`,
      [fixture.payment.payment_id],
    );
    const [{ journalRows }] = await db.query(
      `select count(*)::int as "journalRows"
         from public.financial_events
        where gateway_ref = $1::text`,
      [paymentId],
    ).then((result) => result.rows);
    const payment = await one(
      `select status, amount, razorpay_payment_id
         from public.payments
        where id = $1::uuid`,
      [fixture.payment.payment_id],
    );
    results.push({
      name: testCase.name,
      expectedPaise: testCase.expectedPaise,
      actualPaise: fixture.payment.amount,
      result: { ok: result.ok, duplicate: result.duplicate, refund: result.refund },
      replay: { duplicate: replay.duplicate },
      financialEvent: {
        kind: financialEvent?.kind,
        amount_paise: financialEvent?.amount_paise,
        payment_id: financialEvent?.payment_id,
        gateway_ref: financialEvent?.gateway_ref,
      },
      journalRows,
      payment: {
        status: payment.status,
        amount: payment.amount,
        razorpay_payment_id: payment.razorpay_payment_id,
      },
      paymentId,
      expectedPaymentId: fixture.payment.payment_id,
    });
  }
  check(
    results.every(({ expectedPaise, actualPaise, result, replay, financialEvent, journalRows, payment, paymentId, expectedPaymentId }) =>
      actualPaise === expectedPaise
      && result.ok === true
      && replay.duplicate === true
      && journalRows === 1
      && payment.status === 'paid'
      && payment.razorpay_payment_id === paymentId
      && financialEvent?.kind === 'payment_captured'
      && financialEvent.amount_paise === expectedPaise
      && financialEvent.payment_id === expectedPaymentId
      && financialEvent.gateway_ref === paymentId),
    'each F1 recorder writes one server-derived capture journal row without changing payment state',
    results,
  );
});

await scenario('F5 journals an extra capture without changing F1 refund semantics', async () => {
  const fixture = await createHomePayment();
  const originalCaptureId = await gatewayId();
  const extraCaptureId = await gatewayId();
  const originalResult = await record('record_payment_paid', fixture.link, originalCaptureId, 19900);
  const extraResult = await record('record_payment_paid', fixture.link, extraCaptureId, 19900);
  const extraEvent = await one(
    `select payment_id, amount_paise, gateway_ref
       from public.financial_events
      where gateway_ref = $1::text`,
    [extraCaptureId],
  );
  const extraPayment = await one(
    `select p.status, p.amount, p.razorpay_payment_id, r.amount as refund_amount, r.status as refund_status
       from public.payments p
       left join public.refunds r on r.payment_id = p.id
      where p.razorpay_payment_id = $1::text`,
    [extraCaptureId],
  );
  const originalPayment = await one(
    `select status, amount, razorpay_payment_id
       from public.payments
      where id = $1::uuid`,
    [fixture.payment.payment_id],
  );
  check(
    originalResult.ok === true
      && extraResult.duplicate_capture === true
      && extraEvent?.amount_paise === 19900
      && extraEvent.gateway_ref === extraCaptureId
      && extraPayment?.status === 'refund_pending'
      && extraPayment.amount === 19900
      && extraPayment.refund_amount === 19900
      && extraPayment.refund_status === 'pending'
      && originalPayment.status === 'paid'
      && originalPayment.amount === 19900
      && originalPayment.razorpay_payment_id === originalCaptureId,
    'F5 journals the extra 19900-paise capture on its refund row, preserving the original paid row',
    {
      expectedExtraPaise: 19900,
      actual: {
        originalResult: { ok: originalResult.ok },
        extraResult: { duplicate_capture: extraResult.duplicate_capture, refund_amount: extraResult.refund_amount },
        extraEvent: { amount_paise: extraEvent?.amount_paise, gateway_ref: extraEvent?.gateway_ref },
        extraPayment: {
          status: extraPayment?.status,
          amount: extraPayment?.amount,
          refund_amount: extraPayment?.refund_amount,
          refund_status: extraPayment?.refund_status,
        },
        originalPayment: {
          status: originalPayment.status,
          amount: originalPayment.amount,
          razorpay_payment_id: originalPayment.razorpay_payment_id,
        },
      },
    },
  );
});

await scenario('F5 journals a mismatched capture while preserving its exact refund', async () => {
  const fixture = await createHomePayment();
  const paymentId = await gatewayId();
  const capturedPaise = 20000;
  const result = await record('record_payment_paid', fixture.link, paymentId, capturedPaise);
  const financialEvent = await one(
    `select payment_id, amount_paise, gateway_ref
       from public.financial_events
      where gateway_ref = $1::text`,
    [paymentId],
  );
  const capture = await one(
    `select p.status, p.amount, p.razorpay_payment_id, r.amount as refund_amount, r.status as refund_status
       from public.payments p
       left join public.refunds r on r.payment_id = p.id
      where p.razorpay_payment_id = $1::text`,
    [paymentId],
  );
  const original = await one(
    `select status, amount, razorpay_payment_id
       from public.payments
      where id = $1::uuid`,
    [fixture.payment.payment_id],
  );
  check(
    result.amount_mismatch === true
      && financialEvent?.amount_paise === capturedPaise
      && financialEvent.gateway_ref === paymentId
      && capture?.status === 'refund_pending'
      && capture.amount === capturedPaise
      && capture.refund_amount === capturedPaise
      && capture.refund_status === 'pending'
      && original.status === 'failed'
      && original.amount === 19900
      && original.razorpay_payment_id === null,
    'F5 journals the captured 20000 paise without changing F1 mismatch/refund behavior',
    {
      expectedCapturedPaise: capturedPaise,
      actual: {
        result: {
          amount_mismatch: result.amount_mismatch,
          refund: result.refund,
          refund_amount: result.refund_amount,
        },
        financialEvent: { amount_paise: financialEvent?.amount_paise, gateway_ref: financialEvent?.gateway_ref },
        capture: {
          status: capture?.status,
          amount: capture?.amount,
          refund_amount: capture?.refund_amount,
          refund_status: capture?.refund_status,
        },
        original: {
          status: original.status,
          amount: original.amount,
          razorpay_payment_id: original.razorpay_payment_id,
        },
      },
    },
  );
});

await scenario('F5 journal and webhook log allow inserts but reject mutation', async () => {
  const eventId = `evt_${(await uuid()).replaceAll('-', '')}`;
  const payload = { event: 'order.paid', payload: { order: { id: 'order_f5' } } };
  await service(
    `insert into public.gateway_webhook_log (event_id, event, payload)
     values ($1::text, $2::text, $3::jsonb)`,
    [eventId, 'order.paid', JSON.stringify(payload)],
  );
  await service(
    `insert into public.financial_events (
       kind, payment_id, amount_paise, gateway_ref, payload
     ) values (
       $1::text, $2::uuid, $3::int, $4::text, $5::jsonb
     )`,
    ['payment_captured', await uuid(), 193760, 'pay_f5_append_only', JSON.stringify(payload)],
  );
  const webhook = await one(
    `select id, event_id, event, payload
       from public.gateway_webhook_log
      where event_id = $1::text`,
    [eventId],
  );
  const journal = await one(
    `select id, kind, payment_id, amount_paise, gateway_ref, payload
       from public.financial_events
      where gateway_ref = $1::text`,
    ['pay_f5_append_only'],
  );
  let webhookUpdateError = '';
  let webhookDeleteError = '';
  let journalUpdateError = '';
  let journalDeleteError = '';
  let journalTruncateError = '';
  try {
    await db.query(
      `update public.gateway_webhook_log
          set payload = $2::jsonb
        where id = $1::bigint`,
      [webhook.id, JSON.stringify({ altered: true })],
    );
  } catch (error) {
    webhookUpdateError = error.message;
  }
  try {
    await db.query(
      `delete from public.gateway_webhook_log where id = $1::bigint`,
      [webhook.id],
    );
  } catch (error) {
    webhookDeleteError = error.message;
  }
  try {
    await db.query(
      `update public.financial_events
          set payload = $2::jsonb
        where id = $1::bigint`,
      [journal.id, JSON.stringify({ altered: true })],
    );
  } catch (error) {
    journalUpdateError = error.message;
  }
  try {
    await db.query(
      `delete from public.financial_events where id = $1::bigint`,
      [journal.id],
    );
  } catch (error) {
    journalDeleteError = error.message;
  }
  try {
    await db.exec('truncate table public.financial_events');
  } catch (error) {
    journalTruncateError = error.message;
  }
  const finalWebhook = await one(
    `select event_id, event, payload from public.gateway_webhook_log where id = $1::bigint`,
    [webhook.id],
  );
  const finalJournal = await one(
    `select kind, amount_paise, gateway_ref from public.financial_events where id = $1::bigint`,
    [journal.id],
  );
  const privileges = await one(`
    select has_table_privilege('anon', 'public.gateway_webhook_log', 'select') as anon_webhook_read,
           has_table_privilege('authenticated', 'public.financial_events', 'select') as authenticated_journal_read,
           has_table_privilege('service_role', 'public.gateway_webhook_log', 'select') as service_webhook_read,
           has_table_privilege('service_role', 'public.financial_events', 'select') as service_journal_read,
           has_table_privilege('service_role', 'public.gateway_webhook_log', 'insert') as service_webhook_insert,
           has_table_privilege('service_role', 'public.financial_events', 'insert') as service_journal_insert,
           has_table_privilege('service_role', 'public.financial_events', 'update') as service_journal_update,
           has_table_privilege('service_role', 'public.gateway_webhook_log', 'delete') as service_webhook_delete
  `);
  check(
    webhook.event_id === eventId
      && finalWebhook?.event_id === eventId
      && finalWebhook.event === 'order.paid'
      && finalWebhook.payload.event === 'order.paid'
      && journal.amount_paise === 193760
      && finalJournal?.amount_paise === 193760
      && finalJournal.gateway_ref === 'pay_f5_append_only'
      && webhookUpdateError.includes('append-only')
      && webhookDeleteError.includes('append-only')
      && journalUpdateError.includes('append-only')
      && journalDeleteError.includes('append-only')
      && journalTruncateError.includes('append-only')
      && privileges.anon_webhook_read === false
      && privileges.authenticated_journal_read === false
      && privileges.service_webhook_read === true
      && privileges.service_journal_read === false
      && privileges.service_webhook_insert === true
      && privileges.service_journal_insert === true
      && privileges.service_journal_update === false
      && privileges.service_webhook_delete === false,
    'F5 audit rows are service-role-only and immutable',
    {
      webhook,
      finalWebhook,
      journal,
      finalJournal,
      webhookUpdateError,
      webhookDeleteError,
      journalUpdateError,
      journalDeleteError,
      journalTruncateError,
      privileges,
    },
  );
});

await scenario('F6 claims only stale processing transfers for reconciliation', async () => {
  const stale = await createF6Transfer();
  const fresh = await createF6Transfer({ createdAt: new Date().toISOString() });
  const claimed = await service(`select * from public.claim_stale_processing_transfers()`);
  const staleRow = claimed.find((row) => row.transfer_id === stale.transferId);
  const freshRow = claimed.find((row) => row.transfer_id === fresh.transferId);
  check(
    Boolean(staleRow)
      && !freshRow
      && staleRow.razorpay_payment_id === stale.gatewayPaymentId
      && staleRow.amount === 10000
      && staleRow.rail === 'route',
    'F6 stale reconciliation claims the old transfer with its gateway lookup context only',
    {
      expected: { transferId: stale.transferId, gatewayPaymentId: stale.gatewayPaymentId, amount: 10000, rail: 'route' },
      actual: { staleRow, freshRow },
    },
  );
  const privileges = await one(`
    select has_function_privilege('service_role', 'public.claim_stale_processing_transfers()', 'execute') as service_role,
           has_function_privilege('authenticated', 'public.claim_stale_processing_transfers()', 'execute') as authenticated,
           has_function_privilege('anon', 'public.claim_stale_processing_transfers()', 'execute') as anon
  `);
  check(
    privileges.service_role === true && privileges.authenticated === false && privileges.anon === false,
    'F6 transfer reconciliation is service-role only',
    privileges,
  );
  const resetFixture = await createF6Transfer();
  const reset = await one(
    `select public.reset_stale_processing_transfer($1::uuid) as reset`,
    [resetFixture.transferId],
  );
  const resetRow = await one(
    `select status::text as status, attempts, next_attempt_at > now() as delayed
       from public.payout_transfers
      where id = $1::uuid`,
    [resetFixture.transferId],
  );
  check(
    reset.reset === true && resetRow.status === 'pending'
      && resetRow.attempts === 1 && resetRow.delayed === true,
    'absent gateway transfer resets with a bounded retry delay and increments the attempt',
    { transferId: resetFixture.transferId, reset, resetRow },
  );
});

await scenario('F6 money reconciliation write RPCs are service-role only', async () => {
  const privileges = await one(`
    select has_function_privilege('service_role', 'public.reset_stale_processing_transfer(uuid)', 'execute') as service_reset,
           has_function_privilege('authenticated', 'public.reset_stale_processing_transfer(uuid)', 'execute') as user_reset,
           has_function_privilege('anon', 'public.reset_stale_processing_transfer(uuid)', 'execute') as anon_reset,
           has_function_privilege('service_role', 'public.record_payment_dispute(text,text,int)', 'execute') as service_dispute,
           has_function_privilege('authenticated', 'public.record_payment_dispute(text,text,int)', 'execute') as user_dispute,
           has_function_privilege('service_role', 'public.record_refund_status(text,text,uuid)', 'execute') as service_refund,
           has_function_privilege('authenticated', 'public.record_refund_status(text,text,uuid)', 'execute') as user_refund,
           has_function_privilege('service_role', 'public.save_reconciliation_report(date,jsonb)', 'execute') as service_report,
           has_function_privilege('authenticated', 'public.save_reconciliation_report(date,jsonb)', 'execute') as user_report,
           has_function_privilege('service_role', 'public.queue_lost_dispute_reversals()', 'execute') as service_reversals,
           has_function_privilege('authenticated', 'public.queue_lost_dispute_reversals()', 'execute') as user_reversals,
           has_function_privilege('service_role', 'public.list_stuck_money_ops()', 'execute') as service_alert,
           has_function_privilege('authenticated', 'public.list_stuck_money_ops()', 'execute') as user_alert
  `);
  check(
    privileges.service_reset && privileges.service_dispute && privileges.service_refund
      && privileges.service_report && privileges.service_reversals
      && privileges.service_alert && !privileges.user_alert
      && !privileges.user_reset && !privileges.anon_reset && !privileges.user_dispute
      && !privileges.user_refund && !privileges.user_report && !privileges.user_reversals,
    'F6 reconciliation and money-state RPCs reject client execution',
    privileges,
  );
});

await scenario('F6 dispute created freezes, won restores, and lost queues transfer recovery', async () => {
  const pending = await createF6Transfer({ transferStatus: 'pending' });
  await db.query(
    `update public.payout_transfers
        set attempts = 2, next_attempt_at = now() + interval '20 minutes'
      where id = $1::uuid`,
    [pending.transferId],
  );
  const before = await one(
    `select status::text as status from public.bookings where id = $1::uuid`,
    [pending.bookingId],
  );
  await service(
    `select public.record_payment_dispute($1::text, $2::text, $3::int)`,
    [pending.gatewayPaymentId, 'created', pending.payment.amount],
  );
  const frozen = await one(
    `select po.status::text as payout_status, b.status::text as booking_status, pt.status::text as transfer_status
       from public.payouts po
       join public.bookings b on b.id = po.booking_id
       join public.payout_transfers pt on pt.payout_id = po.id
      where po.id = $1::uuid`,
    [pending.payoutId],
  );
  const blockedClaim = await service(`select * from public.claim_due_transfers($1::int)`, [10]);
  await service(
    `select public.record_payment_dispute($1::text, $2::text, $3::int)`,
    [pending.gatewayPaymentId, 'won', pending.payment.amount],
  );
  const restored = await one(
    `select po.status::text as payout_status, b.status::text as booking_status,
            pt.status::text as transfer_status, pt.attempts,
            pt.next_attempt_at > now() as retry_delay_preserved
       from public.payouts po
       join public.bookings b on b.id = po.booking_id
       join public.payout_transfers pt on pt.payout_id = po.id
      where po.id = $1::uuid`,
    [pending.payoutId],
  );

  const transferred = await createF6Transfer({ transferStatus: 'transferred', payoutStatus: 'transferred' });
  await service(
    `select public.record_payment_dispute($1::text, $2::text, $3::int)`,
    [transferred.gatewayPaymentId, 'created', 10000],
  );
  await service(
    `select public.record_payment_dispute($1::text, $2::text, $3::int)`,
    [transferred.gatewayPaymentId, 'lost', 10000],
  );
  const reversal = await one(
    `select r.status, r.amount, r.rail, r.recovery_key
       from public.payout_transfer_reversals r
      where r.payout_transfer_id = $1::uuid`,
    [transferred.transferId],
  );
  const inFlight = await createF6Transfer({ transferStatus: 'processing', payoutStatus: 'pending' });
  await service(
    `select public.record_payment_dispute($1::text, $2::text, $3::int)`,
    [inFlight.gatewayPaymentId, 'created', 10000],
  );
  await service(
    `select public.record_payment_dispute($1::text, $2::text, $3::int)`,
    [inFlight.gatewayPaymentId, 'lost', 10000],
  );
  const beforeLateCompletion = await one(
    `select count(*)::int as count
       from public.payout_transfer_reversals
      where payout_transfer_id = $1::uuid`,
    [inFlight.transferId],
  );
  await service(
    `select public.complete_transfer($1::uuid, $2::text)`,
    [inFlight.transferId, `trf_${await uuid()}`],
  );
  await service(`select public.queue_lost_dispute_reversals()`);
  const lateReversal = await one(
    `select status, amount
       from public.payout_transfer_reversals
      where payout_transfer_id = $1::uuid`,
    [inFlight.transferId],
  );
  check(
    frozen?.payout_status === 'frozen'
      && frozen?.booking_status === 'disputed'
      && frozen?.transfer_status === 'failed'
      && blockedClaim.length === 0
      && restored?.payout_status === 'pending'
      && restored?.booking_status === before?.status
      && restored?.transfer_status === 'pending'
      && restored?.attempts === 2
      && restored?.retry_delay_preserved === true
      && reversal?.status === 'pending'
      && reversal?.amount === 10000
      && reversal?.rail === 'route'
      && beforeLateCompletion.count === 0
      && lateReversal?.status === 'pending'
      && lateReversal?.amount === 10000,
    'F6 dispute lifecycle freezes the claim, restores a won dispute, and queues recovery after a loss',
    {
      expectedPriorBookingStatus: before?.status,
      actual: { frozen, blockedClaim, restored, reversal, beforeLateCompletion, lateReversal },
    },
  );
});

await scenario('F6 refund webhooks complete processed refunds and requeue failed refunds', async () => {
  const failedFixture = await createHomePayment();
  const failedPaymentId = await gatewayId();
  await record('record_payment_paid', failedFixture.link, failedPaymentId, failedFixture.payment.amount);
  const failedRefundId = `rfnd_${(await uuid()).replaceAll('-', '')}`;
  const failedRefund = await one(
    `insert into public.refunds (
       payment_id, amount, reason, status, razorpay_refund_id, created_at
     ) values (
       $1::uuid, $2::int, $3::text, 'processing'::public.refund_status, $4::text, now()
     ) returning id`,
    [failedFixture.payment.payment_id, failedFixture.payment.amount, 'F6 failed webhook', failedRefundId],
  );
  await db.query(
    `update public.payments set status = 'refund_processing'::public.payment_status where id = $1::uuid`,
    [failedFixture.payment.payment_id],
  );
  await service(
    `select public.record_refund_status($1::text, $2::text)`,
    [failedRefundId, 'failed'],
  );
  await service(
    `select public.record_refund_status($1::text, $2::text)`,
    [failedRefundId, 'failed'],
  );
  const failed = await one(
    `select r.status::text as refund_status, r.attempts, r.last_error, r.next_attempt_at,
            p.status::text as payment_status
       from public.refunds r
       join public.payments p on p.id = r.payment_id
      where r.id = $1::uuid`,
    [failedRefund.id],
  );

  const processedFixture = await createHomePayment();
  const processedPaymentId = await gatewayId();
  await record('record_payment_paid', processedFixture.link, processedPaymentId, processedFixture.payment.amount);
  const processedRefundId = `rfnd_${(await uuid()).replaceAll('-', '')}`;
  const processedRefund = await one(
    `insert into public.refunds (
       payment_id, amount, reason, status, razorpay_refund_id, created_at
     ) values (
       $1::uuid, $2::int, $3::text, 'processing'::public.refund_status, $4::text, now()
     ) returning id`,
    [processedFixture.payment.payment_id, processedFixture.payment.amount, 'F6 processed webhook', processedRefundId],
  );
  await db.query(
    `update public.payments set status = 'refund_processing'::public.payment_status where id = $1::uuid`,
    [processedFixture.payment.payment_id],
  );
  await service(
    `select public.record_refund_status($1::text, $2::text)`,
    [processedRefundId, 'processed'],
  );
  const processed = await one(
    `select r.status::text as refund_status, p.status::text as payment_status
       from public.refunds r
       join public.payments p on p.id = r.payment_id
      where r.id = $1::uuid`,
    [processedRefund.id],
  );
  check(
    failed?.refund_status === 'pending'
      && failed?.attempts === 1
      && Boolean(failed?.last_error)
      && failed?.next_attempt_at !== null
      && failed?.payment_status === 'refund_pending'
      && processed?.refund_status === 'refunded'
      && processed?.payment_status === 'refunded',
    'F6 refund webhooks requeue gateway failures and complete processed refunds',
    { failed, processed },
  );
});

await scenario('WS8-T09 F6 records chargebacks for a captured pack payment', async () => {
  const fixture = await createPackPayment();
  const paymentId = await gatewayId();
  const capture = await record('record_pack_payment_paid', fixture.link, paymentId, fixture.payment.amount);
  await service(
    `select public.record_payment_dispute($1::text, $2::text, $3::int)`,
    [paymentId, 'created', fixture.payment.amount],
  );
  const dependentBooking = await createHomePayment();
  const payout = await one(
    `insert into public.payouts (
       booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
     ) values (
       $1::uuid, $2::uuid, 1000::int, 0::int, 0::int, 1000::int,
       'pending'::public.payout_status, now() - interval '1 hour'
     ) returning id`,
    [dependentBooking.bookingId, dependentBooking.provider],
  );
  const transfer = await one(
    `insert into public.payout_transfers (payout_id, source_payment_id, amount, rail)
     values ($1::uuid, $2::uuid, 1000::int, 'payouts'::text) returning id`,
    [payout.id, fixture.payment.payment_id],
  );
  const frozen = await one(
    `select po.status::text as payout_status, t.status::text as transfer_status
       from public.payouts po
       join public.payout_transfers t on t.payout_id = po.id
      where t.id = $1::uuid`,
    [transfer.id],
  );
  await service(
    `select public.record_payment_dispute($1::text, $2::text, $3::int)`,
    [paymentId, 'lost', fixture.payment.amount],
  );
  const dispute = await one(
    `select booking_id, sports_booking_id, pack_purchase_id, status, amount
       from public.payment_disputes
      where payment_id = $1::uuid`,
    [fixture.payment.payment_id],
  );
  check(
    capture.ok === true
      && dispute.booking_id === null
      && dispute.sports_booking_id === null
      && dispute.pack_purchase_id === fixture.packId
      && dispute.status === 'lost'
      && dispute.amount === fixture.payment.amount
      && frozen.payout_status === 'frozen'
      && frozen.transfer_status === 'failed',
    'pack purchase disputes persist without a home-booking foreign key',
    { capture, expectedPackId: fixture.packId, dispute, frozen },
  );
});

await scenario('WS8-T09 F6 queues a Route reversal for a sports payment dispute', async () => {
  const actors = await createActors();
  await db.query(
    `insert into public.profiles (id) values
      ($1::uuid), ($2::uuid)
     on conflict (id) do nothing`,
    [actors.customer, actors.provider],
  );
  const activity = await one(`select id from public.sports_activities order by id limit 1`);
  const venue = await one(
    `insert into public.sports_venues (
       owner_id, name, address_line, city, area, lat, lng, status
     ) values (
       $1::uuid, $2::text, '1 F6 Road', 'Vijayawada', 'Benz Circle',
       16.51::double precision, 80.64::double precision, 'verified'
     ) returning id`,
    [actors.provider, `F6 venue ${actors.provider.slice(0, 8)}`],
  );
  const resource = await one(
    `insert into public.sports_resources (venue_id, activity_id, name)
     values ($1::uuid, $2::uuid, $3::text) returning id`,
    [venue.id, activity.id, `F6 court ${actors.provider.slice(0, 8)}`],
  );
  const sportsBooking = await one(
    `insert into public.sports_bookings (
       customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise,
       expires_at, payment_mode, total_paise, paid_at
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $5::timestamptz, 'completed',
       10000::int, $6::timestamptz, 'online', 10000::int, now()
     ) returning id`,
    [
      actors.customer,
      venue.id,
      resource.id,
      '2027-01-11T10:00:00Z',
      '2027-01-11T11:00:00Z',
      '2027-01-11T09:45:00Z',
    ],
  );
  const paymentId = await gatewayId();
  const payment = await one(
    `insert into public.payments (
       sports_booking_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at
     ) values (
       $1::uuid, 'fixed'::public.payment_purpose, 10000::int, 'paid'::public.payment_status,
       $2::text, $3::text, now()
     ) returning id`,
    [sportsBooking.id, `f6-sports-${sportsBooking.id}`, paymentId],
  );
  const payout = await one(
    `insert into public.payouts (
       sports_booking_id, payee_id, gross, commission, gst_on_commission, amount,
       status, release_after
     ) values (
       $1::uuid, $2::uuid, 10000::int, 0::int, 0::int, 10000::int,
       'transferred'::public.payout_status, now() - interval '1 hour'
     ) returning id`,
    [sportsBooking.id, actors.provider],
  );
  const routeTransfer = await one(
    `insert into public.payout_transfers (
       payout_id, source_payment_id, amount, status, rail, razorpay_transfer_id, transferred_at
     ) values (
       $1::uuid, $2::uuid, 5000::int, 'transferred'::public.transfer_status, 'route'::text,
       $3::text, now() - interval '1 hour'
     ) returning id`,
    [payout.id, payment.id, `trf_${await uuid()}`],
  );
  const payoutsTransfer = await one(
    `insert into public.payout_transfers (
       payout_id, source_payment_id, amount, status, rail, razorpay_transfer_id, transferred_at
     ) values (
       $1::uuid, $2::uuid, 5000::int, 'transferred'::public.transfer_status, 'payouts'::text,
       $3::text, now() - interval '1 hour'
     ) returning id`,
    [payout.id, payment.id, `pout_${await uuid()}`],
  );
  await service(
    `select public.record_payment_dispute($1::text, $2::text, $3::int)`,
    [paymentId, 'created', 10000],
  );
  await service(
    `select public.record_payment_dispute($1::text, $2::text, $3::int)`,
    [paymentId, 'lost', 10000],
  );
  const dispute = await one(
    `select booking_id, sports_booking_id, status
       from public.payment_disputes
      where payment_id = $1::uuid`,
    [payment.id],
  );
  const routeReversal = await one(
    `select status, amount, rail
       from public.payout_transfer_reversals
      where payout_transfer_id = $1::uuid`,
    [routeTransfer.id],
  );
  const payoutReversal = await one(
    `select status, amount, rail, last_error
       from public.payout_transfer_reversals
      where payout_transfer_id = $1::uuid`,
    [payoutsTransfer.id],
  );
  check(
    dispute.booking_id === null
      && dispute.sports_booking_id === sportsBooking.id
      && dispute.status === 'lost'
      && routeReversal.status === 'pending'
      && routeReversal.amount === 5000
      && routeReversal.rail === 'route'
      && payoutReversal.status === 'debt_recorded'
      && payoutReversal.amount === 5000
      && payoutReversal.rail === 'payouts'
      && Boolean(payoutReversal.last_error),
    'sports chargeback queues Route reversal and records an operator-visible X payout debt',
    { dispute, routeReversal, payoutReversal, paymentId, sportsBookingId: sportsBooking.id },
  );
});

await scenario('WS6-T16 reconciliation issues are admin-listed and resolved by a clean rerun', async () => {
  const runDate = '2026-11-18';
  const gatewayId = `pay_f6_${(await uuid()).replaceAll('-', '')}`;
  const issue = {
    issue_key: `${runDate}:payment:amount_mismatch:${gatewayId}:payment_local`,
    entity_type: 'payment',
    issue_code: 'amount_mismatch',
    local_id: 'payment_local',
    gateway_id: gatewayId,
    expected_amount: 19900,
    actual_amount: 20000,
    details: { gateway_status: 'captured' },
  };
  await service(
    `select public.save_reconciliation_report($1::date, $2::jsonb)`,
    [runDate, JSON.stringify([issue])],
  );

  const adminId = await uuid();
  const customerId = await uuid();
  await db.query(
    `insert into auth.users (id, phone) values
      ($1::uuid, $2::text), ($3::uuid, $4::text)`,
    [adminId, `+91${nextPhone++}`, customerId, `+91${nextPhone++}`],
  );
  await service(`insert into public.admins (user_id) values ($1::uuid)`, [adminId]);
  let denied = '';
  try {
    await as(
      customerId,
      'authenticated',
      `select * from public.admin_list_reconciliation_issues($1::date)`,
      [runDate],
    );
  } catch (error) {
    denied = error.message;
  }
  const listed = await as(
    adminId,
    'authenticated',
    `select * from public.admin_list_reconciliation_issues($1::date)`,
    [runDate],
  );
  await service(
    `select public.save_reconciliation_report($1::date, '[]'::jsonb)`,
    [runDate],
  );
  const resolved = await one(
    `select status, resolved_at is not null as has_resolved_at
       from public.reconciliation_issues
      where run_date = $1::date and gateway_id = $2::text`,
    [runDate, gatewayId],
  );
  check(
    denied.includes('admin only')
      && listed.length === 1
      && listed[0].expected_amount === 19900
      && listed[0].actual_amount === 20000
      && resolved.status === 'resolved'
      && resolved.has_resolved_at,
    'mismatch is visible only to admins and an empty rerun resolves it',
    { denied, listed, resolved },
  );
});

await scenario('WS8-T11 F6 alert query lists old processing transfers and repeatedly failed refunds', async () => {
  const transfer = await createF6Transfer();
  const refundFixture = await createHomePayment();
  const refundPaymentId = await gatewayId();
  await record('record_payment_paid', refundFixture.link, refundPaymentId, refundFixture.payment.amount);
  const refund = await one(
    `insert into public.refunds (
       payment_id, amount, reason, status, attempts, last_error, created_at
     ) values (
       $1::uuid, 1000::int, $2::text, 'failed'::public.refund_status, 3::int, $3::text,
       now() - interval '1 hour'
     ) returning id`,
    [refundFixture.payment.payment_id, 'F6 alert refund', 'gateway refused after retries'],
  );
  const stuck = await service(`select * from public.list_stuck_money_ops()`);
  const transferAlert = stuck.find((row) => row.operation_type === 'transfer' && row.operation_id === transfer.transferId);
  const refundAlert = stuck.find((row) => row.operation_type === 'refund' && row.operation_id === refund.id);
  check(
    transferAlert?.status === 'processing'
      && transferAlert?.amount === 10000
      && refundAlert?.status === 'failed'
      && refundAlert?.amount === 1000
      && refundAlert?.last_error === 'gateway refused after retries',
    'WS8-T11 alert query returns stale transfer and retry-exhausted refund details',
    { expected: { transferId: transfer.transferId, refundId: refund.id }, actual: { transferAlert, refundAlert } },
  );
});

assert.ok(migrationFiles.includes('0071_f1_payment_recorder_safety.sql'), 'the full migration chain includes the reserved F1 migration');
assert.ok(migrationFiles.includes('0077_f5_webhook_log_financial_journal.sql'), 'the full migration chain includes the reserved F5 migration');
assert.ok(migrationFiles.includes('0078_f6_reconciliation_chargebacks.sql'), 'the full migration chain includes the reserved F6 migration');
finish();

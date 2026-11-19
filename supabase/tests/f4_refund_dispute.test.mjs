import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}[a-z]?_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 76)
  .sort();
const targetMigration = '0076_f4_refund_dispute_engine.sql';
if (!migrationFiles.includes(targetMigration)) {
  throw new Error(`missing reserved F4 migration: ${targetMigration}`);
}

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
for (const name of migrationFiles) await db.exec(migration(name));
await db.exec("set timezone = 'UTC'");
await db.exec(`
  update public.app_config
     set value = value || '{"fixed":true,"inspect_quote":true,"proposal":true,"time_based":true}'::jsonb
   where key = 'archetype_flags'
`);

const { ok, scenario, finish } = createHarness();
const check = (condition, label, actual) =>
  ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const uuid = async () => (await one('select gen_random_uuid() as id')).id;
let nextPhone = 7300000000;
let slotNumber = 0;

async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

const service = (sql, params = []) => as(null, 'service_role', sql, params);

async function createActors({ policy = 'standard_visit', archetype = 'inspect_quote' } = {}) {
  const customer = await uuid();
  const provider = await uuid();
  const admin = await uuid();
  await db.query(
    `insert into auth.users (id, phone) values
      ($1::uuid, $2::text), ($3::uuid, $4::text), ($5::uuid, $6::text)`,
    [customer, `+91${nextPhone++}`, provider, `+91${nextPhone++}`, admin, `+91${nextPhone++}`],
  );
  await db.query(`insert into public.admins (user_id) values ($1::uuid)`, [admin]);
  await db.query(
    `insert into public.providers (
       id, bio, city, years_experience, kyc_status, admin_review_status, razorpay_account_id, created_at,
       submitted_at, is_online, suspended, paused
     ) values (
       $1::uuid, 'F4 test provider', 'Vijayawada', 5, 'verified', 'approved', $2::text,
       now() - interval '90 days', now(), true, false, false
     )`,
    [provider, `acc_${provider.slice(0, 8)}`],
  );
  const { id: categoryId } = await one(
    `select id from public.categories where slug = 'ac-repair'`,
  );
  await service(
    `update public.categories
        set cancellation_policy = $1::text, archetype = $2::text
      where id = $3::uuid`,
    [policy, archetype, categoryId],
  );
  await service(
    `insert into public.category_cities (category_id, city, live, launched_at)
     values ($1::uuid, 'Vijayawada', true, now())
     on conflict (category_id, city) do update
       set live = true, launched_at = excluded.launched_at`,
    [categoryId],
  );
  const { id: serviceId } = await one(
    `insert into public.provider_services (
       provider_id, category_id, skill_level, visit_fee, labour_rate, active
     ) values ($1::uuid, $2::uuid, 'expert', 19900, 50000, true)
     returning id`,
    [provider, categoryId],
  );
  await service(
    `insert into public.provider_payout_accounts (
       provider_id, rail, razorpay_account_id, activation_status
     ) values ($1::uuid, 'route', $2::text, 'activated')`,
    [provider, `acc_${provider.slice(0, 8)}`],
  );
  return { customer, provider, admin, categoryId, serviceId };
}

async function createVisit(actors) {
  const [{ create_booking: bookingId }] = await as(
    actors.customer,
    'authenticated',
    `select public.create_booking(
       $1::uuid, $2::text, $3::text, $4::text, $5::numeric, $6::numeric
     ) as create_booking`,
    [actors.serviceId, `F4 booking ${await uuid()}`, '12 MG Road', 'Vijayawada', 16.51, 80.64],
  );
  const [payment] = await service(
    `select * from public.prepare_payment($1::uuid, $2::uuid)`,
    [bookingId, actors.customer],
  );
  const link = `f4-link-${payment.payment_id}`;
  await service(
    `update public.payments
        set razorpay_link_id = $1::text, short_url = $2::text
      where id = $3::uuid`,
    [link, 'https://pay.test/f4', payment.payment_id],
  );
  await service(
    `select public.record_payment_paid($1::text, $2::text, $3::int)`,
    [link, `gateway-${payment.payment_id}`, payment.amount],
  );
  await as(actors.provider, 'authenticated', `select public.accept_booking($1::uuid)`, [bookingId]);
  await as(actors.provider, 'authenticated', `select public.start_trip($1::uuid)`, [bookingId]);
  const [{ start_otp: startOtp }] = await as(
    actors.customer,
    'authenticated',
    `select * from public.get_booking_otps($1::uuid)`,
    [bookingId],
  );
  await as(
    actors.provider,
    'authenticated',
    `select public.arrive($1::uuid, $2::text)`,
    [bookingId, startOtp],
  );
  slotNumber += 1;
  const slotStart = new Date(Date.now() + (slotNumber + 2) * 86400_000).toISOString();
  await service(
    `update public.bookings
        set scheduled_at = $1::timestamptz,
            service_window = tstzrange($1::timestamptz, $1::timestamptz + interval '2 hours', '[)')
      where id = $2::uuid`,
    [slotStart, bookingId],
  );
  return bookingId;
}

async function sendQuote(actors, bookingId) {
  return (await as(
    actors.provider,
    'authenticated',
    `select public.send_quote($1::uuid, $2::jsonb) as quote_id`,
    [bookingId, JSON.stringify([
      { kind: 'labour', title: 'Gas refill', qty: 1, unit_price: 150000 },
      { kind: 'part', title: 'Capacitor', qty: 1, unit_price: 65000 },
    ])],
  ))[0].quote_id;
}

const coinsConfig = {
  coin_paise: 10,
  earn_rate_bp: 100,
  per_txn_cap_paise: 2000,
  first_txn_bonus_paise: 1000,
  monthly_cap_paise: 100000,
  redeem_cap_bp: 1000,
  expiry_months: 6,
  pilot_budget_paise: null,
};

async function enableCoins(actors) {
  await as(
    actors.admin,
    'authenticated',
    `select public.admin_set_coins_config($1::jsonb)`,
    [JSON.stringify(coinsConfig)],
  );
  await as(
    actors.admin,
    'authenticated',
    `select public.admin_set_feature($1::text, $2::boolean)`,
    ['coins_redemption', true],
  );
  await as(
    actors.admin,
    'authenticated',
    `select public.admin_adjust_coins($1::uuid, $2::int, $3::text)`,
    [actors.customer, 5000, 'F4 isolated test wallet'],
  );
}

async function sendAndApproveCoins(actors, bookingId, settleBalance = true) {
  const quoteId = await sendQuote(actors, bookingId);
  const [{ approval }] = await as(
    actors.customer,
    'authenticated',
    `select public.approve_quote_with_coins(
       $1::uuid, $2::uuid, $3::boolean
     ) as approval`,
    [bookingId, quoteId, true],
  );
  if (!settleBalance) return { quoteId, approval };
  const [payment] = await service(
    `select * from public.prepare_payment($1::uuid, $2::uuid)`,
    [bookingId, actors.customer],
  );
  const link = `f4-balance-${payment.payment_id}`;
  await service(
    `update public.payments
        set razorpay_link_id = $1::text, short_url = $2::text
      where id = $3::uuid`,
    [link, 'https://pay.test/f4-balance', payment.payment_id],
  );
  await service(
    `select public.record_payment_paid($1::text, $2::text, $3::int)`,
    [link, `gateway-${payment.payment_id}`, payment.amount],
  );
  return { quoteId, approval };
}

async function addCashBalance(actors, bookingId) {
  const quoteId = await sendQuote(actors, bookingId);
  const [{ approval }] = await as(
    actors.customer,
    'authenticated',
    `select public.approve_quote_with_coins(
       $1::uuid, $2::uuid, $3::boolean
     ) as approval`,
    [bookingId, quoteId, false],
  );
  const [payment] = await service(
    `select * from public.prepare_payment($1::uuid, $2::uuid)`,
    [bookingId, actors.customer],
  );
  const link = `f4-balance-${payment.payment_id}`;
  await service(
    `update public.payments
        set razorpay_link_id = $1::text, short_url = $2::text
      where id = $3::uuid`,
    [link, 'https://pay.test/f4-balance', payment.payment_id],
  );
  await service(
    `select public.record_payment_paid($1::text, $2::text, $3::int)`,
    [link, `gateway-${payment.payment_id}`, payment.amount],
  );
  return approval;
}

async function cashPaid(bookingId) {
  return (await one(
    `select coalesce(sum(p.amount), 0)::int as amount
       from public.payments p
      where p.booking_id = $1::uuid
        and p.status = 'paid'
        and p.funding_source is distinct from 'coins'
        and p.razorpay_payment_id is not null`,
    [bookingId],
  )).amount;
}

async function createTimeBasedDispute(actors) {
  const addressId = (await one(
    `insert into public.addresses (user_id, label, line1, city, lat, lng)
     values ($1::uuid, 'Home', '1 Road', 'Vijayawada', 16.51, 80.64)
     returning id`,
    [actors.customer],
  )).id;
  const startsAt = new Date(Date.now() + 4 * 86400_000).toISOString();
  const bookingId = (await service(
    `insert into public.bookings (
       customer_id, provider_id, category_id, provider_service_id, address_id,
       description, scheduled_at, status, visit_fee, platform_fee, total_amount,
       archetype, service_window, session_duration_min
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'time-based dispute',
       $6::timestamptz, 'in_progress', 0, 0, 60000, 'time_based',
       tstzrange($6::timestamptz, $6::timestamptz + interval '60 minutes', '[)'), 60
     ) returning id`,
    [actors.customer, actors.provider, actors.categoryId, actors.serviceId, addressId, startsAt],
  ))[0].id;
  const scheduleId = (await service(
    `insert into public.payment_schedule (
       booking_id, seq, obligation_type, label, amount, due_rule, status
     ) values ($1::uuid, 1, 'service', 'Session service', 60000, 'at_booking', 'paid')
     returning id`,
    [bookingId],
  ))[0].id;
  const paymentId = (await service(
    `insert into public.payments (
       booking_id, schedule_id, purpose, amount, status, razorpay_payment_id, paid_at
     ) values (
       $1::uuid, $2::uuid, 'session', 60000, 'paid', $3::text, now()
     ) returning id`,
    [bookingId, scheduleId, `f4-session-${bookingId}`],
  ))[0].id;
  await service(
    `update public.payment_schedule set payment_id = $1::uuid where id = $2::uuid`,
    [paymentId, scheduleId],
  );
  return bookingId;
}

async function createClosedBooking(actors, closedAt) {
  const addressId = (await one(
    `insert into public.addresses (user_id, label, line1, city, lat, lng)
     values ($1::uuid, 'Home', '1 Road', 'Vijayawada', 16.51, 80.64)
     returning id`,
    [actors.customer],
  )).id;
  const bookingId = (await service(
    `insert into public.bookings (
       customer_id, provider_id, category_id, provider_service_id, address_id,
       description, scheduled_at, status, visit_fee, platform_fee, total_amount
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'closed dispute window',
       now(), 'closed', 0, 0, 0
     ) returning id`,
    [actors.customer, actors.provider, actors.categoryId, actors.serviceId, addressId],
  ))[0].id;
  await service(
    `insert into public.booking_events (booking_id, from_status, to_status, note, at)
     values ($1::uuid, 'completed', 'closed', 'test close', $2::timestamptz)`,
    [bookingId, closedAt],
  );
  return bookingId;
}

await scenario('WS6-T08 customer cancellation refunds cash only and restores redeemed coins once', async () => {
  const actors = await createActors({ policy: 'fixed' });
  await enableCoins(actors);
  const bookingId = await createVisit(actors);
  const { approval } = await sendAndApproveCoins(actors, bookingId, false);
  const expectedCash = await cashPaid(bookingId);
  const before = await one(
    `select
       (select count(*)::int from public.refunds r join public.payments p on p.id = r.payment_id where p.booking_id = $1::uuid) as refunds,
       (select count(*)::int from public.coin_ledger l where l.booking_id = $1::uuid) as ledger,
       (select b.status::text from public.bookings b where b.id = $1::uuid) as status`,
    [bookingId],
  );
  const [{ preview }] = await as(
    actors.customer,
    'authenticated',
    `select public.preview_cancellation($1::uuid) as preview`,
    [bookingId],
  );
  const after = await one(
    `select
       (select count(*)::int from public.refunds r join public.payments p on p.id = r.payment_id where p.booking_id = $1::uuid) as refunds,
       (select count(*)::int from public.coin_ledger l where l.booking_id = $1::uuid) as ledger,
       (select b.status::text from public.bookings b where b.id = $1::uuid) as status`,
    [bookingId],
  );
  await as(
    actors.customer,
    'authenticated',
    `select public.cancel_booking($1::uuid, $2::text)`,
    [bookingId, null],
  );
  const refund = await one(
    `select
       coalesce(sum(r.amount) filter (where r.status <> 'failed'), 0)::int as amount,
       count(*) filter (where p.funding_source = 'coins')::int as coin_refunds
     from public.refunds r
     join public.payments p on p.id = r.payment_id
     where p.booking_id = $1::uuid`,
    [bookingId],
  );
  const restore = await one(
    `select count(*)::int as rows, coalesce(sum(l.delta), 0)::int as amount
       from public.coin_ledger l
      where l.booking_id = $1::uuid and l.ref = 'restore-terminal:' || $1::text`,
    [bookingId],
  );
  const [{ balance }] = await as(
    actors.customer,
    'authenticated',
    `select public.get_my_coin_balance() as balance`,
  );
  check(
    approval.coins_redeemed_paise === 5000
      && expectedCash > 0
      && preview.refund_amount === expectedCash
      && JSON.stringify(after) === JSON.stringify(before)
      && refund.amount === expectedCash
      && refund.coin_refunds === 0
      && restore.rows === 1
      && restore.amount === 5000
      && balance === 5000,
    'cancellation previews remain read-only, refund exact gateway paise, and restore the 5,000-coin redemption once',
    { approval, expectedCash, preview, before, after, refund, restore, balance },
  );
});

await scenario('WS6-T08 full dispute refund excludes coin rows and restores coins before cash queueing', async () => {
  const actors = await createActors();
  await enableCoins(actors);
  const bookingId = await createVisit(actors);
  const { approval } = await sendAndApproveCoins(actors, bookingId);
  const expectedCash = await cashPaid(bookingId);
  await as(
    actors.customer,
    'authenticated',
    `select public.dispute_booking($1::uuid, $2::text)`,
    [bookingId, 'F4 full-refund dispute'],
  );
  await as(
    actors.admin,
    'authenticated',
    `select public.resolve_dispute($1::uuid, $2::public.dispute_outcome, $3::int, $4::text)`,
    [bookingId, 'full_refund', null, 'F4 full refund'],
  );
  const refund = await one(
    `select
       coalesce(sum(r.amount) filter (where r.status <> 'failed'), 0)::int as amount,
       count(*) filter (where p.funding_source = 'coins')::int as coin_refunds
     from public.refunds r
     join public.payments p on p.id = r.payment_id
     where p.booking_id = $1::uuid`,
    [bookingId],
  );
  const restore = await one(
    `select count(*)::int as rows, coalesce(sum(l.delta), 0)::int as amount
       from public.coin_ledger l
      where l.booking_id = $1::uuid and l.ref = 'restore-terminal:' || $1::text`,
    [bookingId],
  );
  const [{ repeated_restore }] = await service(
    `select public._restore_coins_for_terminal_booking($1::uuid) as repeated_restore`,
    [bookingId],
  );
  const [{ status }] = await service(
    `select b.status::text as status from public.bookings b where b.id = $1::uuid`,
    [bookingId],
  );
  check(
    approval.coins_redeemed_paise === 5000
      && expectedCash > 0
      && refund.amount === expectedCash
      && refund.coin_refunds === 0
      && restore.rows === 1
      && restore.amount === 5000
      && repeated_restore === 0
      && status === 'refunded',
    'full dispute resolution queues only remaining gateway paise and restores redeemed coins exactly once',
    { approval, expectedCash, refund, restore, repeated_restore, status },
  );
});

await scenario('WS6-T10 partial pre-completion dispute uses net cash without a payout', async () => {
  const actors = await createActors();
  const bookingId = await createVisit(actors);
  await addCashBalance(actors, bookingId);
  const before = await one(
    `select count(*)::int as payouts from public.payouts po where po.booking_id = $1::uuid`,
    [bookingId],
  );
  await as(
    actors.customer,
    'authenticated',
    `select public.dispute_booking($1::uuid, $2::text)`,
    [bookingId, 'F4 partial-refund dispute'],
  );
  await as(
    actors.admin,
    'authenticated',
    `select public.resolve_dispute($1::uuid, $2::public.dispute_outcome, $3::int, $4::text)`,
    [bookingId, 'partial_refund', 25000, 'F4 partial refund'],
  );
  const actual = await one(
    `select
       b.status::text as booking_status,
       b.refund_amount::int as refund_amount,
       coalesce(sum(r.amount) filter (where r.status <> 'failed'), 0)::int as queued_refund,
       count(po.id)::int as payouts
     from public.bookings b
     left join public.refunds r on r.payment_id in (select p.id from public.payments p where p.booking_id = b.id)
     left join public.payouts po on po.booking_id = b.id
     where b.id = $1::uuid
     group by b.id`,
    [bookingId],
  );
  check(
    before.payouts === 0
      && actual.booking_status === 'completed'
      && actual.refund_amount === 25000
      && actual.queued_refund === 25000
      && actual.payouts === 1,
    'partial dispute with no payout caps to net cash, queues 25,000 paise, and finalizes once',
    { before, actual },
  );
});

await scenario('WS6-T10 denied time-based dispute before completion uses the session finalizer', async () => {
  const actors = await createActors({ policy: 'time_based', archetype: 'time_based' });
  const bookingId = await createTimeBasedDispute(actors);
  await as(
    actors.customer,
    'authenticated',
    `select public.dispute_booking($1::uuid, $2::text)`,
    [bookingId, 'F4 time-based denied dispute'],
  );
  await as(
    actors.admin,
    'authenticated',
    `select public.resolve_dispute($1::uuid, $2::public.dispute_outcome, $3::int, $4::text)`,
    [bookingId, 'denied', null, 'F4 deny time-based dispute'],
  );
  const actual = await one(
    `select
       b.status::text as booking_status,
       b.completed_at is not null as completed,
       count(po.id)::int as payouts
     from public.bookings b
     left join public.payouts po on po.booking_id = b.id
     where b.id = $1::uuid
     group by b.id`,
    [bookingId],
  );
  check(
    actual.booking_status === 'completed' && actual.completed && actual.payouts === 1,
    'denied pre-completion time-based dispute completes through the session payout path',
    actual,
  );
});

await scenario('WS6-T17 closed booking dispute window allows a recent closure', async () => {
  const actors = await createActors();
  await as(
    actors.admin,
    'authenticated',
    `select public.admin_set_dispute_rules($1::int)`,
    [30],
  );
  const bookingId = await createClosedBooking(
    actors,
    new Date(Date.now() - 7 * 86400_000).toISOString(),
  );
  await as(
    actors.customer,
    'authenticated',
    `select public.dispute_booking($1::uuid, $2::text)`,
    [bookingId, 'recent closed booking dispute'],
  );
  const [{ status }] = await service(
    `select b.status::text as status from public.bookings b where b.id = $1::uuid`,
    [bookingId],
  );
  check(status === 'disputed', 'a closed booking inside the configured 30-day window can be disputed', { status });
});

await scenario('WS6-T17 dispute-window configuration is admin-only and validated', async () => {
  const actors = await createActors();
  await service(`delete from public.app_config where key = $1::text`, ['dispute_rules']);
  const unconfiguredBooking = await createClosedBooking(
    actors,
    new Date(Date.now() - 1 * 86400_000).toISOString(),
  );
  let unconfigured = '';
  try {
    await as(
      actors.customer,
      'authenticated',
      `select public.dispute_booking($1::uuid, $2::text)`,
      [unconfiguredBooking, 'closed dispute without configured window'],
    );
  } catch (error) {
    unconfigured = error.message;
  }
  let unauthorized = '';
  let invalid = '';
  try {
    await as(
      actors.customer,
      'authenticated',
      `select public.admin_set_dispute_rules($1::int)`,
      [30],
    );
  } catch (error) {
    unauthorized = error.message;
  }
  try {
    await as(
      actors.admin,
      'authenticated',
      `select public.admin_set_dispute_rules($1::int)`,
      [0],
    );
  } catch (error) {
    invalid = error.message;
  }
  await as(
    actors.admin,
    'authenticated',
    `select public.admin_set_dispute_rules($1::int)`,
    [30],
  );
  const [{ rules }] = await as(
    actors.admin,
    'authenticated',
    `select public.admin_get_dispute_rules() as rules`,
  );
  check(
    unconfigured.includes('dispute window is not configured')
      && unauthorized.includes('admin only')
      && invalid.includes('between 1 and 3650')
      && rules.max_days_after_close === 30,
    'dispute window requires an admin and rejects out-of-range days',
    { unauthorized, invalid, rules },
  );
});

await scenario('WS6-T17 closed booking dispute window rejects an old closure', async () => {
  const actors = await createActors();
  await as(
    actors.admin,
    'authenticated',
    `select public.admin_set_dispute_rules($1::int)`,
    [30],
  );
  const bookingId = await createClosedBooking(
    actors,
    new Date(Date.now() - 31 * 86400_000).toISOString(),
  );
  let actualError = '';
  try {
    await as(
      actors.customer,
      'authenticated',
      `select public.dispute_booking($1::uuid, $2::text)`,
      [bookingId, 'old closed booking dispute'],
    );
  } catch (error) {
    actualError = error.message;
  }
  const [{ status }] = await service(
    `select b.status::text as status from public.bookings b where b.id = $1::uuid`,
    [bookingId],
  );
  check(
    actualError.includes('dispute window has expired') && status === 'closed',
    'a closed booking older than the configured window is rejected without changing its state',
    { actualError, status },
  );
});

await scenario('WS6-T06 refund retry authorization, terminal recovery, stale claim and stuck-money listing', async () => {
  const actors = await createActors();
  const bookingId = await createVisit(actors);
  const failedPaymentId = (await service(
    `insert into public.payments (
       booking_id, purpose, amount, status, razorpay_payment_id, paid_at
     ) values ($1::uuid, 'balance', 5000, 'refund_processing', $2::text, now())
     returning id`,
    [bookingId, `f4-failed-${bookingId}`],
  ))[0].id;
  const failedRefundId = (await service(
    `insert into public.refunds (
       payment_id, amount, status, attempts, processing_started_at
     ) values ($1::uuid, 5000, 'processing', 4, now() - interval '20 minutes')
     returning id`,
    [failedPaymentId],
  ))[0].id;
  await service(
    `select public.fail_refund($1::uuid, $2::text)`,
    [failedRefundId, 'fifth terminal failure'],
  );
  const terminal = await one(
    `select r.status::text as status, r.attempts, r.last_error
       from public.refunds r where r.id = $1::uuid`,
    [failedRefundId],
  );
  const stalePaymentId = (await service(
    `insert into public.payments (
       booking_id, purpose, amount, status, razorpay_payment_id, paid_at
     ) values ($1::uuid, 'balance', 7000, 'refund_processing', $2::text, now())
     returning id`,
    [bookingId, `f4-stale-${bookingId}`],
  ))[0].id;
  const staleRefundId = (await service(
    `insert into public.refunds (
       payment_id, amount, status, attempts, processing_started_at
     ) values ($1::uuid, 7000, 'processing', 1, now() - interval '45 minutes')
     returning id`,
    [stalePaymentId],
  ))[0].id;
  const payoutId = (await service(
    `insert into public.payouts (
       booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
     ) values ($1::uuid, $2::uuid, 5000, 0, 0, 5000, 'failed', now())
     returning id`,
    [bookingId, actors.provider],
  ))[0].id;
  await service(
    `insert into public.payout_transfers (
       payout_id, source_payment_id, amount, status, attempts, last_error
     ) values ($1::uuid, $2::uuid, 5000, 'failed', 5, 'transfer terminal failure')`,
    [payoutId, failedPaymentId],
  );

  let unauthorized = '';
  try {
    await as(
      actors.customer,
      'authenticated',
      `select public.admin_retry_refund($1::uuid)`,
      [failedRefundId],
    );
  } catch (error) {
    unauthorized = error.message;
  }
  const listed = await as(
    actors.admin,
    'authenticated',
    `select public.admin_list_stuck_money() as data`,
  );
  let listUnauthorized = '';
  try {
    await as(actors.customer, 'authenticated', `select public.admin_list_stuck_money()`);
  } catch (error) {
    listUnauthorized = error.message;
  }
  await as(
    actors.admin,
    'authenticated',
    `select public.admin_retry_refund($1::uuid)`,
    [failedRefundId],
  );
  const retried = await one(
    `select r.status::text as status, r.attempts, r.last_error, r.next_attempt_at
       from public.refunds r where r.id = $1::uuid`,
    [failedRefundId],
  );
  const failedTransferCount = (listed[0].data.transfers ?? []).length;
  const listedFailedRefund = (listed[0].data.refunds ?? [])
    .some((row) => row.refund_id === failedRefundId);

  const [{ processing_at }] = await service(
    `select r.processing_started_at::text as processing_at
       from public.refunds r where r.id = $1::uuid`,
    [staleRefundId],
  );
  const stale = await service(
    `select * from public.claim_stale_processing_refunds($1::interval)`,
    ['30 minutes'],
  );
  let claimUnauthorized = '';
  try {
    await as(
      actors.customer,
      'authenticated',
      `select * from public.claim_stale_processing_refunds($1::interval)`,
      ['30 minutes'],
    );
  } catch (error) {
    claimUnauthorized = error.message;
  }
  await service(
    `select public.requeue_stale_processing_refund($1::uuid)`,
    [staleRefundId],
  );
  const requeued = await one(
    `select r.status::text as status, r.processing_started_at, r.next_attempt_at
       from public.refunds r where r.id = $1::uuid`,
    [staleRefundId],
  );
  const due = await service(`select * from public.claim_due_refunds($1::int)`, [10]);
  const reclaimed = await one(
    `select r.status::text as status, r.processing_started_at::text as processing_at
       from public.refunds r where r.id = $1::uuid`,
    [staleRefundId],
  );
  const actual = {
    unauthorized,
    listUnauthorized,
    claimUnauthorized,
    terminal,
    listedFailedRefund,
    failedTransferCount,
    retried,
    processing_at,
    staleIds: stale.map((row) => row.refund_id),
    requeued,
    dueIds: due.map((row) => row.refund_id),
    reclaimed,
  };
  check(
    unauthorized.includes('admin only')
      && listUnauthorized.includes('admin only')
      && claimUnauthorized.toLowerCase().includes('permission denied')
      && terminal.status === 'failed'
      && terminal.attempts === 5
      && listedFailedRefund
      && failedTransferCount === 1
      && retried.status === 'pending'
      && retried.attempts === 0
      && retried.last_error === null
      && stale.some((row) => row.refund_id === staleRefundId)
      && requeued.status === 'pending'
      && reclaimed.status === 'processing'
      && reclaimed.processing_at !== processing_at,
    'failed refund retry is admin-only and stale processing rows can be re-polled and reclaimed',
    actual,
  );
});

finish();

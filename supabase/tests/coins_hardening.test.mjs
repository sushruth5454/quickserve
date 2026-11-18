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
  .filter((name) => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) < 62)
  .sort();
for (const name of migrationFiles) await db.exec(migration(name));
await db.exec(migration('0062_coins_hardening.sql'));
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
const check = (condition, label, actual) =>
  ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const uuid = async () => (await db.query('select gen_random_uuid() as id')).rows[0].id;
let nextPhone = 7000000000;

async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

const service = (sql, params = []) => as(null, 'service_role', sql, params);

async function createActors() {
  const customer = await uuid();
  const provider = await uuid();
  const admin = await uuid();
  await db.query(
    `insert into auth.users (id, phone) values
      ($1::uuid, $2::text), ($3::uuid, $4::text), ($5::uuid, $6::text)`,
    [
      customer, `+91${nextPhone++}`,
      provider, `+91${nextPhone++}`,
      admin, `+91${nextPhone++}`,
    ],
  );
  await db.query(`insert into public.admins (user_id) values ($1::uuid)`, [admin]);
  await db.query(
    `insert into public.providers (
       id, bio, city, years_experience, kyc_status, razorpay_account_id, created_at,
       submitted_at, is_online, suspended, paused
     ) values (
       $1::uuid, 'F3 test provider', 'Vijayawada', 5, 'verified', $2::text,
       now() - interval '90 days', now(), true, false, false
     )`,
    [provider, `acc_${provider.slice(0, 8)}`],
  );
  const [{ id: categoryId }] = (await db.query(
    `select id from public.categories where slug = 'ac-repair'`,
  )).rows;
  const [{ id: serviceId }] = (await db.query(
    `insert into public.provider_services (provider_id, category_id, skill_level, visit_fee, labour_rate, active)
     values ($1::uuid, $2::uuid, 'expert', 19900, 50000, true) returning id`,
    [provider, categoryId],
  )).rows;
  return { customer, provider, admin, serviceId };
}

async function createVisit(actors) {
  const [{ create_booking: bookingId }] = await as(
    actors.customer,
    'authenticated',
    `select public.create_booking($1::uuid, $2::text, $3::text, $4::text, $5::numeric, $6::numeric) as create_booking`,
    [actors.serviceId, `F3 booking ${await uuid()}`, '12 MG Road', 'Vijayawada', 16.51, 80.64],
  );
  const [payment] = await service(
    `select * from public.prepare_payment($1::uuid, $2::uuid)`,
    [bookingId, actors.customer],
  );
  const link = `f3-link-${payment.payment_id}`;
  await service(
    `update public.payments set razorpay_link_id = $1::text, short_url = $2::text where id = $3::uuid`,
    [link, 'https://pay.test/f3', payment.payment_id],
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
  return bookingId;
}

async function sendQuote(actors, bookingId) {
  const items = JSON.stringify([
    { kind: 'labour', title: 'Gas refill', qty: 1, unit_price: 150000 },
    { kind: 'part', title: 'Capacitor', qty: 1, unit_price: 65000 },
  ]);
  const [{ send_quote: quoteId }] = await as(
    actors.provider,
    'authenticated',
    `select public.send_quote($1::uuid, $2::jsonb) as send_quote`,
    [bookingId, items],
  );
  return quoteId;
}

async function approve(actors, bookingId, quoteId, useCoins = true) {
  const [{ approval }] = await as(
    actors.customer,
    'authenticated',
    `select public.approve_quote_with_coins($1::uuid, $2::uuid, $3::boolean) as approval`,
    [bookingId, quoteId, useCoins],
  );
  return approval;
}

const baseConfig = {
  coin_paise: 10,
  earn_rate_bp: 100,
  per_txn_cap_paise: 2000,
  first_txn_bonus_paise: 1000,
  monthly_cap_paise: 100000,
  redeem_cap_bp: 1000,
  expiry_months: 6,
  pilot_budget_paise: null,
};

async function setConfig(actors, overrides = {}) {
  await as(
    actors.admin,
    'authenticated',
    `select public.admin_set_coins_config($1::jsonb)`,
    [JSON.stringify({ ...baseConfig, ...overrides })],
  );
  await as(
    actors.admin,
    'authenticated',
    `select public.admin_set_feature($1::text, $2::boolean)`,
    ['coins_redemption', true],
  );
}

async function addCoins(actors, amountPaise = 5000) {
  await as(
    actors.admin,
    'authenticated',
    `select public.admin_adjust_coins($1::uuid, $2::int, $3::text)`,
    [actors.customer, amountPaise, 'F3 isolated test wallet'],
  );
}

await scenario('WS9-T01 approval succeeds with redemption off and use_coins=true', async () => {
  const actors = await createActors();
  await setConfig(actors);
  await addCoins(actors);
  const bookingId = await createVisit(actors);
  const quoteId = await sendQuote(actors, bookingId);
  await as(actors.admin, 'authenticated', `select public.admin_set_feature($1::text, $2::boolean)`, ['coins_redemption', false]);
  const approval = await approve(actors, bookingId, quoteId, true);
  const [{ balance }] = await as(actors.customer, 'authenticated', `select public.get_my_coin_balance() as balance`);
  check(
    approval.coins_redeemed_paise === 0 && approval.amount_due === 198000 && balance === 5000,
    'switch-off approval returns zero coins, exact cash due, and preserves integer-paise balance',
    { approval, balance },
  );
  await as(actors.admin, 'authenticated', `select public.admin_set_feature($1::text, $2::boolean)`, ['coins_redemption', true]);
});

await scenario('WS9-T03 change-order restore plus cancellation restores the original amount once', async () => {
  const actors = await createActors();
  await setConfig(actors);
  await addCoins(actors);
  const bookingId = await createVisit(actors);
  const firstQuote = await sendQuote(actors, bookingId);
  const firstApproval = await approve(actors, bookingId, firstQuote, true);
  const changeQuote = await sendQuote(actors, bookingId);
  await setConfig(actors, { redeem_cap_bp: 0 });
  const changeApproval = await approve(actors, bookingId, changeQuote, false);
  await db.query(`update public.bookings set status = 'cancelled' where id = $1::uuid`, [bookingId]);
  const restores = (await db.query(
    `select delta, ref from public.coin_ledger
      where booking_id = $1::uuid and (ref like 'restore:%' or ref = 'restore-terminal:' || $1::text)
      order by ref`,
    [bookingId],
  )).rows;
  const [{ balance }] = await as(actors.customer, 'authenticated', `select public.get_my_coin_balance() as balance`);
  const coinPayments = (await db.query(
    `select count(*)::int as count from public.payments
      where booking_id = $1::uuid and funding_source = 'coins'`,
    [bookingId],
  )).rows[0].count;
  check(
    firstApproval.coins_redeemed_paise === 5000
      && changeApproval.coins_redeemed_paise === 0
      && changeApproval.amount_due === 198000
      && restores.length === 1
      && restores[0].delta === 5000
      && restores[0].ref === `restore:${bookingId}:${changeQuote}`
      && balance === 5000
      && coinPayments === 0,
    'zero-cap change order deletes the paid coin row and restores the original 5,000 paise only once after cancellation',
    { firstApproval, changeApproval, restores, balance, coinPayments },
  );
});

await scenario('WS9-T03 a later redemption spends restored paise under a new quote reference', async () => {
  const actors = await createActors();
  await setConfig(actors);
  await addCoins(actors);
  const bookingId = await createVisit(actors);
  const firstQuote = await sendQuote(actors, bookingId);
  const firstApproval = await approve(actors, bookingId, firstQuote, true);
  const zeroCapQuote = await sendQuote(actors, bookingId);
  await setConfig(actors, { redeem_cap_bp: 0 });
  const zeroCapApproval = await approve(actors, bookingId, zeroCapQuote, false);
  await setConfig(actors);
  const nextQuote = await sendQuote(actors, bookingId);
  const nextApproval = await approve(actors, bookingId, nextQuote, true);
  const redemptions = (await db.query(
    `select delta, ref from public.coin_ledger
      where booking_id = $1::uuid and kind = 'redeem'
      order by ref`,
    [bookingId],
  )).rows;
  const nextPayment = (await db.query(
    `select amount, status, quote_id from public.payments
      where booking_id = $1::uuid and funding_source = 'coins'`,
    [bookingId],
  )).rows;
  const [{ balance }] = await as(actors.customer, 'authenticated', `select public.get_my_coin_balance() as balance`);
  const firstCycle = redemptions.filter((row) => row.ref.startsWith(`redeem:${bookingId}:${firstQuote}:`));
  const nextCycle = redemptions.filter((row) => row.ref.startsWith(`redeem:${bookingId}:${nextQuote}:`));
  check(
    firstApproval.coins_redeemed_paise === 5000
      && zeroCapApproval.amount_due === 198000
      && nextApproval.coins_redeemed_paise === 5000
      && nextApproval.amount_due === 193000
      && firstCycle.length === 1
      && firstCycle[0].delta === -5000
      && nextCycle.length === 1
      && nextCycle[0].delta === -5000
      && nextPayment.length === 1
      && nextPayment[0].amount === 5000
      && nextPayment[0].status === 'paid'
      && nextPayment[0].quote_id === nextQuote
      && balance === 0,
    'a later quote spends the restored 5,000 paise once instead of reusing the original debit reference',
    { firstApproval, zeroCapApproval, nextApproval, firstCycle, nextCycle, nextPayment, balance },
  );
});

await scenario('WS9-T03 terminal restore is exact and one-time on a repeated call', async () => {
  const actors = await createActors();
  await setConfig(actors);
  await addCoins(actors);
  const bookingId = await createVisit(actors);
  const quoteId = await sendQuote(actors, bookingId);
  const approval = await approve(actors, bookingId, quoteId, true);
  await db.query(`update public.bookings set status = 'cancelled' where id = $1::uuid`, [bookingId]);
  const [secondRestore] = await service(
    `select public._restore_coins_for_terminal_booking($1::uuid) as amount`,
    [bookingId],
  );
  const [thirdRestore] = await service(
    `select public._restore_coins_for_terminal_booking($1::uuid) as amount`,
    [bookingId],
  );
  const rows = (await db.query(
    `select delta, ref from public.coin_ledger where booking_id = $1::uuid and ref = $2::text`,
    [bookingId, `restore-terminal:${bookingId}`],
  )).rows;
  const [{ balance }] = await as(actors.customer, 'authenticated', `select public.get_my_coin_balance() as balance`);
  check(
    approval.coins_redeemed_paise === 5000
      && secondRestore.amount === 0
      && thirdRestore.amount === 0
      && rows.length === 1
      && rows[0].delta === 5000
      && balance === 5000,
    'terminal restoration credits exactly 5,000 paise once and repeated restores are no-ops',
    { approval, secondRestore, thirdRestore, rows, balance },
  );
});

await scenario('WS9-T04 already-redeemed preview disables redemption and caps at applied paise', async () => {
  const actors = await createActors();
  await setConfig(actors);
  await addCoins(actors);
  const bookingId = await createVisit(actors);
  const firstQuote = await sendQuote(actors, bookingId);
  const approval = await approve(actors, bookingId, firstQuote, true);
  const changeQuote = await sendQuote(actors, bookingId);
  const [{ preview }] = await as(
    actors.customer,
    'authenticated',
    `select public.get_coin_redemption_preview($1::uuid, $2::uuid) as preview`,
    [bookingId, changeQuote],
  );
  const changeApproval = await approve(actors, bookingId, changeQuote, true);
  check(
    approval.coins_redeemed_paise === 5000
      && preview.can_redeem === false
      && preview.maximum_paise === 5000
      && preview.applied_paise === 5000
      && changeApproval.amount_due === 193000
      && changeApproval.coins_redeemed_paise === 5000,
    'change-order preview is non-redeemable, reports 5,000 applied paise, and approval due matches the server',
    { approval, preview, changeApproval },
  );
});

await scenario('WS9-T16 closing without an approved quote does not block payout close', async () => {
  const actors = await createActors();
  await setConfig(actors);
  const bookingId = await createVisit(actors);
  await db.query(
    `update public.bookings
        set approved_quote_id = null, status = 'completed'
      where id = $1::uuid`,
    [bookingId],
  );
  await db.query(`update public.bookings set status = 'closed' where id = $1::uuid`, [bookingId]);
  const [{ status }] = (await db.query(
    `select status from public.bookings where id = $1::uuid`,
    [bookingId],
  )).rows;
  const earns = (await db.query(
    `select count(*)::int as count from public.coin_ledger
      where booking_id = $1::uuid and kind in ('earn', 'bonus')`,
    [bookingId],
  )).rows[0].count;
  check(
    status === 'closed' && earns === 0,
    'closing the time-based booking succeeds without an approved quote and creates no earn rows',
    { status, earns },
  );
});

finish();

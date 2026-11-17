import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = (name) =>
  fs.readFileSync(path.join(here, '..', 'migrations', name), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');

const prelude = `
create schema if not exists extensions;
create type extensions.geography as (lng float8, lat float8);
create function extensions.st_makepoint(x float8, y float8) returns extensions.geography language sql immutable as $$ select row(x, y)::extensions.geography $$;
create function extensions.st_setsrid(g extensions.geography, srid int) returns extensions.geography language sql immutable as $$ select g $$;
create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8 language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(b.lat - a.lat) / 2), 2) + cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians(a.lng - b.lng) / 2), 2))) $$;
create function extensions.st_dwithin(a extensions.geography, b extensions.geography, d float8) returns boolean language sql immutable as $$ select extensions.st_distance(a, b) <= d $$;
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
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(prelude);
await db.exec(migration('0001_init.sql'));
await db.exec(migration('0002_qa_fixes.sql'));
await db.exec(`
  create table public.app_config (
    key text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now(),
    updated_by uuid references public.profiles (id)
  );
  alter table public.app_config enable row level security;
  revoke all on public.app_config from anon, authenticated;
  -- Minimal 0018/0022/0023 schema required to install 0043's time-based
  -- commission resolver and replaced session-finalization function.
  alter table public.categories
    add column archetype text not null default 'inspect_quote',
    add column commission_bp int;
  alter table public.bookings
    add column booking_origin text not null default 'app',
    add column archetype text not null default 'inspect_quote',
    add column recurring_schedule_id uuid,
    add column pack_purchase_id uuid,
    add column pack_session_id uuid;
  alter table public.payments add column schedule_id uuid;
  create table public.payment_schedule (
    id uuid primary key default gen_random_uuid(),
    booking_id uuid,
    label text
  );
  create table public.pack_purchases (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid
  );
  create table public.pack_sessions (
    id uuid primary key default gen_random_uuid(),
    status text,
    completed_at timestamptz
  );
`);
await db.exec(migration('0015_seva_coins.sql'));

async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

const uuid = async () => (await db.query('select gen_random_uuid() id')).rows[0].id;
const [customer, provider, admin] = [await uuid(), await uuid(), await uuid()];
await db.exec(`
  insert into auth.users (id, phone) values
    ('${customer}', '+919200001001'), ('${provider}', '+919200001002'), ('${admin}', '+919200001003');
  insert into admins (user_id) values ('${admin}');
  insert into providers (id, bio, city, years_experience, kyc_status, razorpay_account_id, created_at)
  values ('${provider}', 'Test pro', 'Vijayawada', 5, 'verified', 'acc_coins_test', now() - interval '90 days');
`);

const asCustomer = (sql, params = []) => as(customer, 'authenticated', sql, params);
const asAdmin = (sql, params = []) => as(admin, 'authenticated', sql, params);
const service = (sql, params = []) => as(null, 'service_role', sql, params);

// This wallet predates the new denomination. The migration must preserve its paise value.
await asAdmin(`select admin_adjust_coins($1, 5000, 'pre-migration balance')`, [customer]);
await db.exec(migration('0042_feature_registry.sql'));
await db.exec(migration('0043_commission_config.sql'));
await db.exec(migration('0047_coins_config.sql'));

let failures = 0;
const ok = (condition, message) => {
  if (!condition) {
    failures += 1;
    console.log('FAIL:', message);
  } else {
    console.log('ok  :', message);
  }
};

const [{ balance: migratedBalance }] = await asCustomer(`select get_my_coin_balance() as balance`);
const [{ config: initialConfig }] = await asCustomer(`select get_coins_config() as config`);
ok(migratedBalance === 5000, 'migration leaves existing wallet paise unchanged');
ok(initialConfig.coin_paise === 10 && Math.floor(migratedBalance / initialConfig.coin_paise) === 500,
  '10-paise denomination displays the old ₹50 balance as 500 coins');
ok(initialConfig.earn_rate_bp === 100 && initialConfig.per_txn_cap_paise === 2000
    && initialConfig.first_txn_bonus_paise === 1000 && initialConfig.monthly_cap_paise === 100000
    && initialConfig.redeem_cap_bp === 1000 && initialConfig.expiry_months === 6
    && initialConfig.pilot_budget_paise === 1000000,
  'migration defaults match the owner-approved PRD earning, bonus, cap, expiry, and pilot budget');
ok(initialConfig.coins_earning_enabled && initialConfig.coins_redemption_enabled,
  'both owner-approved coin feature switches default to enabled');

const [{ summary: initialSummary }] = await asAdmin(`select admin_coin_summary() as summary`);
ok(initialSummary.outstanding_paise === migratedBalance && initialSummary.budget_paise === 1000000
    && initialSummary.budget_left_paise === 1000000,
  'admin summary reports wallet liability and the ₹10,000 pilot budget');

try {
  await asCustomer(`select admin_set_coins_config('{}'::jsonb)`);
  ok(false, 'non-admin updated the coins configuration');
} catch (error) {
  ok(/admin only/.test(error.message), 'coins configuration changes require an admin');
}
try {
  await asAdmin(`select admin_set_coins_config($1::jsonb)`, [JSON.stringify({
    coin_paise: 10, earn_rate_bp: 10001, per_txn_cap_paise: null, first_txn_bonus_paise: 0,
    monthly_cap_paise: 100000, redeem_cap_bp: 1000, expiry_months: 6, pilot_budget_paise: null,
  })]);
  ok(false, 'invalid basis-point rate was accepted');
} catch (error) {
  ok(/earn_rate_bp must be between/.test(error.message), 'admin config RPC rejects rates above 10000 basis points');
}

const categoryId = (await db.query(`select id from categories where slug = 'ac-repair'`)).rows[0].id;
const serviceId = (await db.query(
  `insert into provider_services (provider_id, category_id, visit_fee, labour_rate)
   values ($1, $2, 19900, 50000) returning id`,
  [provider, categoryId],
)).rows[0].id;

async function createAndPayVisit() {
  const [{ create_booking: bookingId }] = await asCustomer(
    `select create_booking($1, 'AC not cooling', '12 MG Road', 'Vijayawada', 16.51, 80.64)`,
    [serviceId],
  );
  const [payment] = await service(`select * from prepare_payment($1, $2)`, [bookingId, customer]);
  await service(`update payments set razorpay_link_id = $1, short_url = 'https://pay.test' where id = $2`,
    [`link:${payment.payment_id}`, payment.payment_id]);
  await service(`select record_payment_paid($1, $2, $3)`,
    [`link:${payment.payment_id}`, `gateway:${payment.payment_id}`, payment.amount]);
  await as(provider, 'authenticated', `select accept_booking($1)`, [bookingId]);
  await as(provider, 'authenticated', `select start_trip($1)`, [bookingId]);
  const [{ start_otp: startOtp }] = await asCustomer(`select * from get_booking_otps($1)`, [bookingId]);
  await as(provider, 'authenticated', `select arrive($1, $2)`, [bookingId, startOtp]);
  return bookingId;
}

async function createQuote(bookingId) {
  const items = JSON.stringify([
    { kind: 'labour', title: 'Gas refill', qty: 1, unit_price: 150000 },
    { kind: 'part', title: 'Capacitor', qty: 1, unit_price: 65000 },
  ]);
  const [{ send_quote: quoteId }] = await as(provider, 'authenticated',
    `select send_quote($1, $2::jsonb)`, [bookingId, items]);
  return quoteId;
}

async function settleBooking(bookingId, amountDue) {
  if (amountDue > 0) {
    const [payment] = await service(`select * from prepare_payment($1, $2)`, [bookingId, customer]);
    await service(`update payments set razorpay_link_id = $1, short_url = 'https://pay.test' where id = $2`,
      [`link:${payment.payment_id}`, payment.payment_id]);
    await service(`select record_payment_paid($1, $2, $3)`,
      [`link:${payment.payment_id}`, `gateway:${payment.payment_id}`, payment.amount]);
  }
  await as(provider, 'authenticated', `select request_completion($1)`, [bookingId]);
  const [{ end_otp: endOtp }] = await asCustomer(`select * from get_booking_otps($1)`, [bookingId]);
  await as(provider, 'authenticated', `select complete_booking($1, $2)`, [bookingId, endOtp]);
  await service(`update payouts set release_after = now() - interval '1 minute' where booking_id = $1`, [bookingId]);
  const transfers = await service(`select * from claim_due_transfers()`);
  for (const transfer of transfers) {
    await service(`select complete_transfer($1, $2)`, [transfer.transfer_id, `transfer:${transfer.transfer_id}`]);
  }
}

async function closeBooking(bookingId, quoteId) {
  const [{ result }] = await asCustomer(
    `select approve_quote_with_coins($1, $2, false) as result`, [bookingId, quoteId],
  );
  await settleBooking(bookingId, result.amount_due);
}

const testConfig = {
  coin_paise: 10,
  earn_rate_bp: 100,
  per_txn_cap_paise: 2000,
  first_txn_bonus_paise: 1000,
  monthly_cap_paise: 100000,
  redeem_cap_bp: 1000,
  expiry_months: 6,
  pilot_budget_paise: 1000000,
};
await asAdmin(`select admin_set_coins_config($1::jsonb)`, [JSON.stringify(testConfig)]);

const firstBooking = await createAndPayVisit();
const firstQuote = await createQuote(firstBooking);
await closeBooking(firstBooking, firstQuote);
const firstCredits = (await db.query(
  `select kind, delta from coin_ledger where booking_id = $1 and kind in ('earn', 'bonus') order by kind`,
  [firstBooking],
)).rows;
ok(firstCredits.length === 2
    && firstCredits.find((row) => row.kind === 'earn')?.delta === 2000
    && firstCredits.find((row) => row.kind === 'bonus')?.delta === 1000,
  'configured 1% earning is capped at ₹20 and adds the first-booking ₹10 bonus');

await asAdmin(`select admin_set_coins_config($1::jsonb)`, [JSON.stringify({ ...testConfig, pilot_budget_paise: 3000 })]);
const budgetBooking = await createAndPayVisit();
const budgetQuote = await createQuote(budgetBooking);
await closeBooking(budgetBooking, budgetQuote);
ok((await db.query(`select count(*)::int n from coin_ledger where booking_id = $1 and kind in ('earn', 'bonus')`, [budgetBooking])).rows[0].n === 0,
  'exhausted issuance budget leaves the booking with no earn or bonus ledger rows');

await asAdmin(`select admin_set_coins_config($1::jsonb)`, [JSON.stringify({ ...testConfig, pilot_budget_paise: null })]);
await asAdmin(`select admin_set_feature('coins_earning', false)`);
const pausedBooking = await createAndPayVisit();
const pausedQuote = await createQuote(pausedBooking);
await closeBooking(pausedBooking, pausedQuote);
ok((await db.query(`select count(*)::int n from coin_ledger where booking_id = $1 and kind in ('earn', 'bonus')`, [pausedBooking])).rows[0].n === 0,
  'coins_earning off suppresses server-side credits');
await asAdmin(`select admin_set_feature('coins_earning', true)`);

await asAdmin(`select admin_adjust_coins($1, 100000, 'redemption cap test')`, [customer]);
const redemptionBooking = await createAndPayVisit();
const redemptionQuote = await createQuote(redemptionBooking);
const [{ preview }] = await asCustomer(
  `select get_coin_redemption_preview($1, $2) as preview`, [redemptionBooking, redemptionQuote],
);
const [{ rate }] = await as(provider, 'authenticated',
  `select get_booking_commission_rate($1) as rate`, [redemptionBooking]);
const capInputs = (await db.query(`
  select q.total, q.subtotal_labour, b.visit_fee, b.platform_fee
    from public.bookings b join public.quotes q on q.id = $2 and q.booking_id = b.id
   where b.id = $1
`, [redemptionBooking, redemptionQuote])).rows[0];
const commission = Math.round(capInputs.subtotal_labour * rate / 10000);
const expectedPlatformCap = Math.max(commission + capInputs.platform_fee - Math.round(commission * 18 / 100), 0);
const expectedServiceCap = Math.floor(Math.max(capInputs.total, capInputs.visit_fee) * testConfig.redeem_cap_bp / 10000);
const expectedMaximum = Math.floor(
  Math.min(preview.balance_paise, expectedServiceCap, expectedPlatformCap) / testConfig.coin_paise,
) * testConfig.coin_paise;
ok(preview.coin_paise === testConfig.coin_paise
    && preview.service_cap_paise === expectedServiceCap
    && preview.platform_cap_paise === expectedPlatformCap
    && preview.maximum_paise === expectedMaximum,
  'preview caps redemption at the lesser of configured service cap and platform revenue');
const [{ approved }] = await asCustomer(
  `select approve_quote_with_coins($1, $2, true) as approved`, [redemptionBooking, redemptionQuote],
);
ok(approved.coins_redeemed_paise === expectedMaximum,
  'quote approval applies the server-computed redemption cap');

await asAdmin(`select admin_set_feature('coins_earning', false)`);
await settleBooking(redemptionBooking, approved.amount_due);
ok((await db.query(`select count(*)::int n from coin_ledger where booking_id = $1 and kind in ('earn', 'bonus')`, [redemptionBooking])).rows[0].n === 0,
  'coins_earning off suppresses credits when a redeemed booking settles');
await asAdmin(`select admin_set_feature('coins_earning', true)`);

await asAdmin(`select admin_set_feature('coins_redemption', false)`);
const disabledBooking = await createAndPayVisit();
const disabledQuote = await createQuote(disabledBooking);
const [{ disabled_preview: disabledPreview }] = await asCustomer(
  `select get_coin_redemption_preview($1, $2) as disabled_preview`, [disabledBooking, disabledQuote],
);
ok(disabledPreview.maximum_paise === 0, 'redemption preview returns zero while redemption is disabled');
try {
  await asCustomer(`select approve_quote_with_coins($1, $2, true)`, [disabledBooking, disabledQuote]);
  ok(false, 'redemption succeeded while coins_redemption was off');
} catch (error) {
  ok(/Coins can't be used right now/.test(error.message), 'server refuses redemption while coins_redemption is off');
}
await asAdmin(`select admin_set_feature('coins_redemption', true)`);

await asAdmin(`select admin_set_coins_config($1::jsonb)`, [JSON.stringify({ ...testConfig, expiry_months: 2, pilot_budget_paise: null })]);
const [{ admin_adjust_coins: expiryLot }] = await asAdmin(
  `select admin_adjust_coins($1, 10, 'configured expiry test')`, [customer],
);
const [expiry] = (await db.query(`select expires_at from coin_ledger where id = $1`, [expiryLot])).rows;
ok(new Date(expiry.expires_at).getTime() > Date.now() + 55 * 24 * 60 * 60 * 1000,
  'new coin lots use the configured two-month expiry');
await db.exec(`update coin_ledger set expires_at = now() - interval '1 minute' where id = '${expiryLot}'`);
const [{ expiry_result: expiryResult }] = await service(`select expire_coins() as expiry_result`);
ok(expiryResult.lots === 1 && expiryResult.amount_paise === 10,
  'expiry processing writes a balancing ledger entry for the configured-denomination lot');

const [{ final_summary: finalSummary }] = await asAdmin(`select admin_coin_summary() as final_summary`);
const [{ finalBalance }] = await asCustomer(`select get_my_coin_balance() as "finalBalance"`);
ok(finalSummary.issued_paise === 3000 && finalSummary.budget_paise === null
    && finalSummary.outstanding_paise === finalBalance,
  'admin summary reports issued totals, uncapped budget and current liability');

if (failures) throw new Error(`${failures} coins config SQL assertion(s) failed`);
console.log('Coins config SQL checks passed');

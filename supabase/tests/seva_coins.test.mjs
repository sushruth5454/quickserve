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
  select 2 * 6371000 * asin(sqrt(power(sin(radians(b.lat - a.lat) / 2), 2) + cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - a.lng) / 2), 2))) $$;
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
await db.exec(migration('0015_seva_coins.sql'));

let failures = 0;
const ok = (condition, message) => {
  if (!condition) {
    failures += 1;
    console.log('FAIL:', message);
  } else {
    console.log('ok  :', message);
  }
};
async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const uuid = async () => (await db.query('select gen_random_uuid() id')).rows[0].id;
const [C, P, A, X] = [await uuid(), await uuid(), await uuid(), await uuid()];
await db.exec(`
  insert into auth.users (id, phone) values
    ('${C}', '+919100001001'), ('${P}', '+919100001002'),
    ('${A}', '+919100001003'), ('${X}', '+919100001004');
  insert into admins (user_id) values ('${A}');
  insert into providers (id, bio, city, years_experience, kyc_status, razorpay_account_id, created_at)
  values ('${P}', 'Test pro', 'Vijayawada', 5, 'verified', 'acc_test', now() - interval '90 days');
`);

const [{ id: categoryId }] = (await db.query(`select id from categories where slug = 'ac-repair'`)).rows;
const [{ id: serviceId }] = (
  await db.query(
    `insert into provider_services (provider_id, category_id, visit_fee, labour_rate)
     values ($1, $2, 19900, 50000) returning id`,
    [P, categoryId],
  )
).rows;
const asC = (sql, params) => as(C, 'authenticated', sql, params);
const asP = (sql, params) => as(P, 'authenticated', sql, params);
const asA = (sql, params) => as(A, 'authenticated', sql, params);
const asX = (sql, params) => as(X, 'authenticated', sql, params);
const svc = (sql, params) => as(null, 'service_role', sql, params);

await asA(`select admin_adjust_coins('${C}', 2500, 'first FIFO lot')`);
await asA(`select admin_adjust_coins('${C}', 2500, 'second FIFO lot')`);
const balanceBefore = (await asC(`select get_my_coin_balance() as balance`))[0].balance;
ok(balanceBefore === 5000, 'coin balance is integer paise (₹50)');
ok((await asC(`select balance_paise from coin_balances`))[0].balance_paise === 5000, 'balance view is scoped to the caller');
ok((await db.query(`select count(*)::int n from admin_audit_log where action = 'adjust_coins'`)).rows[0].n === 2,
  'admin adjustments are audited');
ok((await asX(`select id from coin_ledger where user_id = '${C}'`)).length === 0, 'another customer cannot read coin history');
try {
  await asC(`insert into coin_ledger (user_id, delta, kind, expires_at, ref) values ('${C}', 100, 'earn', now(), 'forged')`);
  ok(false, 'client coin insertion unexpectedly succeeded');
} catch (error) {
  ok(/permission denied/.test(error.message), 'clients cannot insert ledger rows');
}

async function createAndPayVisit() {
  const [{ create_booking: id }] = await asC(
    `select create_booking($1, 'AC not cooling', '12 MG Road', 'Vijayawada', 16.51, 80.64)`,
    [serviceId],
  );
  const [payment] = await svc(`select * from prepare_payment($1, $2)`, [id, C]);
  await svc(`update payments set razorpay_link_id = $1, short_url = 'https://pay.test' where id = $2`, [`link:${payment.payment_id}`, payment.payment_id]);
  await svc(`select record_payment_paid($1, $2, $3)`, [`link:${payment.payment_id}`, `gateway:${payment.payment_id}`, payment.amount]);
  await asP(`select accept_booking('${id}')`);
  await asP(`select start_trip('${id}')`);
  const [{ start_otp: startOtp }] = await asC(`select * from get_booking_otps('${id}')`);
  await asP(`select arrive('${id}', '${startOtp}')`);
  return id;
}

async function quote(id) {
  const items = JSON.stringify([
    { kind: 'labour', title: 'Gas refill', qty: 1, unit_price: 150000 },
    { kind: 'part', title: 'Capacitor', qty: 1, unit_price: 65000 },
  ]);
  const [{ send_quote: quoteId }] = await asP(`select send_quote($1, $2::jsonb)`, [id, items]);
  return quoteId;
}

async function payBalance(id) {
  const [payment] = await svc(`select * from prepare_payment($1, $2)`, [id, C]);
  await svc(`update payments set razorpay_link_id = $1, short_url = 'https://pay.test' where id = $2`, [`link:${payment.payment_id}`, payment.payment_id]);
  await svc(`select record_payment_paid($1, $2, $3)`, [`link:${payment.payment_id}`, `gateway:${payment.payment_id}`, payment.amount]);
  return payment.amount;
}

const b1 = await createAndPayVisit();
const q1 = await quote(b1);
const [preview] = await asC(`select get_coin_redemption_preview($1, $2) as p`, [b1, q1]);
ok(preview.p.balance_paise === 5000 && preview.p.maximum_paise === 5000, 'preview respects wallet balance and whole-coin units');
const [approved] = await asC(`select approve_quote_with_coins($1, $2, true) as p`, [b1, q1]);
ok(approved.p.amount_due === 193000 && approved.p.coins_redeemed_paise === 5000, '₹50 redemption reduces the customer balance, not quote scope');
const fifo = (await db.query(`
  select l.created_at as lot_time
    from coin_ledger debit
    join coin_ledger l on l.id = debit.source_ledger_id
   where debit.kind = 'redeem' and debit.booking_id = $1
   order by debit.created_at, debit.id
`, [b1])).rows;
ok(
  fifo.length === 2 && new Date(fifo[0].lot_time).getTime() <= new Date(fifo[1].lot_time).getTime(),
  'redemption consumes positive lots FIFO',
);
ok(await payBalance(b1) === 193000, 'customer pays ₹1,930 after visit fee and ₹50 coins');

await asP(`select request_completion('${b1}')`);
const [{ end_otp: endOtp }] = await asC(`select * from get_booking_otps('${b1}')`);
await asP(`select complete_booking('${b1}', '${endOtp}')`);
const [payout] = (await db.query(`select * from payouts where booking_id = $1`, [b1])).rows;
ok(payout.gross === 215000 && payout.commission === 18000 && payout.gst_on_commission === 3240 && payout.amount === 193760,
  'worked example keeps provider payout at ₹1,937.60');
const transfers = (await db.query(`select t.amount, p.funding_source
  from payout_transfers t join payments p on p.id = t.source_payment_id where t.payout_id = $1`, [payout.id])).rows;
ok(transfers.length === 2 && transfers.every((t) => t.funding_source === 'customer'), 'provider payout allocation uses gateway cash only');

await db.exec(`update payouts set release_after = now() - interval '1 minute' where id = '${payout.id}'`);
const claimed = await svc(`select * from claim_due_transfers()`);
for (const transfer of claimed) await svc(`select complete_transfer($1, $2)`, [transfer.transfer_id, `transfer:${transfer.transfer_id}`]);
ok((await db.query(`select status from bookings where id = $1`, [b1])).rows[0].status === 'closed', 'payout finalisation closes booking');
const earned = (await db.query(`select delta from coin_ledger where ref = $1`, [`earn:${b1}`])).rows;
ok(earned.length === 1 && earned[0].delta === 4200, 'close earns 42 coins, excluding the ₹50 coin-funded portion');
await db.query(`select _credit_booking_coins($1)`, [b1]);
ok((await db.query(`select count(*)::int n from coin_ledger where ref = $1`, [`earn:${b1}`])).rows[0].n === 1,
  'earn ledger ref is idempotent');

await db.exec(`update bookings set refund_amount = 5000 where id = '${b1}'`);
const clawback = (await db.query(`select delta from coin_ledger where booking_id = $1 and kind = 'clawback'`, [b1])).rows;
ok(clawback.length === 1 && clawback[0].delta === -100, '₹50 refund removes 1 whole earned coin');
ok((await asC(`select get_my_coin_balance() as balance`))[0].balance === 4100, 'refund clawback never makes balance negative');

const b2 = await createAndPayVisit();
const q2 = await quote(b2);
await asA(`select admin_adjust_coins('${C}', 100000, 'cap test credit')`);
const [capped] = await asC(`select get_coin_redemption_preview($1, $2) as p`, [b2, q2]);
ok(capped.p.service_cap_paise === 21500 && capped.p.platform_cap_paise === 17660 && capped.p.maximum_paise === 17600,
  'redemption cap is the lower of 10% and net platform revenue, rounded to whole coins');
const [capApproval] = await asC(`select approve_quote_with_coins($1, $2, true) as p`, [b2, q2]);
ok(capApproval.p.coins_redeemed_paise === 17600, 'quote approval enforces the computed platform cap');

const beforeExpiry = (await asC(`select get_my_coin_balance() as balance`))[0].balance;
const [{ admin_adjust_coins: expiryLot }] = await asA(`select admin_adjust_coins('${C}', 1000, 'expiry test')`);
await db.exec(`update coin_ledger set expires_at = now() - interval '1 minute' where id = '${expiryLot}'`);
const expired = await svc(`select expire_coins() as r`);
ok(expired[0].r.lots === 1 && expired[0].r.amount_paise === 1000, 'daily expiry writes a balancing expire entry');
ok((await asC(`select get_my_coin_balance() as balance`))[0].balance === beforeExpiry,
  'expired coins disappear only once from available balance');

if (failures) throw new Error(`${failures} Seva Coins SQL assertion(s) failed`);
console.log('Seva Coins SQL checks passed');

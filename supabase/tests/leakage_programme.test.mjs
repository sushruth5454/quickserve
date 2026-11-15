import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raw = fs.readFileSync(path.join(here, '..', 'migrations', '0001_init.sql'), 'utf8');
const migration = raw
  .replace('create extension if not exists postgis with schema extensions;', '')
  .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
  .replaceAll('using gist', 'using btree');

const prelude = `
create schema if not exists extensions;
create type extensions.geography as (lng float8, lat float8);
create function extensions.st_makepoint(x float8, y float8) returns extensions.geography language sql immutable as $$ select row(x, y)::extensions.geography $$;
create function extensions.st_setsrid(g extensions.geography, srid int) returns extensions.geography language sql immutable as $$ select g $$;
create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8 language sql immutable as $$ select 0 $$;
create function extensions.st_dwithin(a extensions.geography, b extensions.geography, d float8) returns boolean language sql immutable as $$ select true $$;
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
`;

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(prelude);
await db.exec(migration);
await db.exec(fs.readFileSync(path.join(here, '..', 'migrations', '0002_qa_fixes.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(here, '..', 'migrations', '0016_leakage_programme.sql'), 'utf8'));
console.log('leakage programme migration applied');

const CUSTOMER = '00000000-0000-0000-0000-000000000001';
const PROVIDER = '00000000-0000-0000-0000-000000000002';
const ADMIN = '00000000-0000-0000-0000-000000000003';
let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('ok  :', message);
  else {
    failures += 1;
    console.log('FAIL:', message);
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
const asCustomer = (sql, params) => as(CUSTOMER, 'authenticated', sql, params);
const asProvider = (sql, params) => as(PROVIDER, 'authenticated', sql, params);
const asAdmin = (sql, params) => as(ADMIN, 'authenticated', sql, params);
const service = (sql, params) => as(null, 'service_role', sql, params);
async function expectError(fn, re, message) {
  try {
    await fn();
    ok(false, `${message} (no error)`);
  } catch (e) {
    ok(re.test(e.message), `${message} -> ${e.message}`);
  }
}

await db.exec(`
  insert into auth.users (id, phone) values
    ('${CUSTOMER}', '+919000000101'),
    ('${PROVIDER}', '+919000000202'),
    ('${ADMIN}', '+919000000303');
  insert into admins (user_id) values ('${ADMIN}');
`);
await asProvider(`select upsert_provider_profile('Ravi', 'AC expert', 'Vijayawada', 15, 16.5, 80.6, 8, '{te,en}')`);
await db.exec(`update providers set created_at = now() - interval '100 days', kyc_status = 'verified' where id = '${PROVIDER}'`);
const [{ id: categoryId }] = await db.query(`select id from categories where slug = 'ac-repair'`).then((r) => r.rows);
const [{ id: serviceId }] = await asProvider(
  `insert into provider_services (provider_id, category_id, skill_level, visit_fee, labour_rate)
   values ($1, $2, 'expert', 19900, 50000) returning id`,
  [PROVIDER, categoryId],
);

async function insertBooking(id, status, completedAt = null) {
  return db.query(
    `with addr as (
       insert into addresses (user_id, label, line1, city, lat, lng)
       values ($2, 'Booking', '12 MG Road', 'Vijayawada', 16.5, 80.6) returning id
     )
     insert into bookings (
       id, customer_id, provider_id, category_id, provider_service_id, address_id,
       description, status, visit_fee, platform_fee, total_amount, completed_at
     )
     select $1, $2, $3, $4, $5, addr.id, 'test job', $6, 10000, 0, 10000, $7
       from addr`,
    [id, CUSTOMER, PROVIDER, categoryId, serviceId, status, completedAt],
  );
}

// Repeat-client rate is 12% -> 8%; 8% tier discounts only to the 5% floor.
const prior = '10000000-0000-0000-0000-000000000001';
const repeat = '10000000-0000-0000-0000-000000000002';
await insertBooking(prior, 'completed', new Date(Date.now() - 2 * 86400000));
await insertBooking(repeat, 'completed');
const [{ bp: repeatBp }] = await service(
  `select _commission_bp($1, $2, $3, now()) as bp`,
  [PROVIDER, CUSTOMER, repeat],
);
ok(repeatBp === 800, 'repeat client receives 8% (12% less 4 points)');
await db.exec(`update providers set jobs_completed = 200 where id = '${PROVIDER}'`);
const [{ bp: floorBp }] = await service(
  `select _commission_bp($1, $2, $3, now()) as bp`,
  [PROVIDER, CUSTOMER, repeat],
);
ok(floorBp === 500, 'repeat discount is floored at 5% for the 8% tier');

await db.exec(`update bookings set completed_at = now() - interval '13 months' where id = '${prior}'`);
const [{ bp: expiredBp }] = await service(
  `select _commission_bp($1, $2, $3, now()) as bp`,
  [PROVIDER, CUSTOMER, repeat],
);
ok(expiredBp === 800, 'a completed booking older than 12 months does not discount');
await db.exec(`update bookings set completed_at = now() - interval '2 days' where id = '${prior}'`);

await db.exec(`update providers set jobs_completed = 0, created_at = now() - interval '100 days'`);
await service(
  `insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
   values ($1, 'fixed', 10000, 'paid', 'pay_repeat', now())`,
  [repeat],
);
await service(`select _create_payout($1, 10000, 10000, now() + interval '1 day')`, [repeat]);
await service(`select _create_payout($1, 10000, 10000, now() + interval '1 day')`, [repeat]);
const [repeatPayout] = await service(
  `select po.*, (select sum(amount) from payout_transfers where payout_id = po.id) transfer_total
     from payouts po where booking_id = $1`,
  [repeat],
);
ok(repeatPayout.commission === 800 && repeatPayout.gst_on_commission === 144, 'repeat payout computes commission and GST from the 8% rate');
ok(repeatPayout.amount === 9056 && repeatPayout.transfer_total === 9056, 'provider payout and transfer allocation are correct');
ok(
  (await service(`select count(*)::int n from payouts where booking_id = $1`, [repeat]))[0].n === 1
    && (await service(`select count(*)::int n from payout_transfers where payout_id = $1`, [repeatPayout.id]))[0].n === 1,
  'repeat payout creation is idempotent',
);

// Provider creates a bearer invite without supplying or exposing phone data.
const [{ invite_id: inviteId, token, share_url: shareUrl }] = await asProvider(
  `select * from create_byo_invite($1, 'Anjali', 'AC inspection and gas top-up', 100000, null)`,
  [serviceId],
);
ok(token.length >= 48 && shareUrl.endsWith(token), 'secure BYO token and share URL are returned once');
const invite = (await service(`select * from byo_invites where id = $1`, [inviteId]))[0];
ok(!('phone' in invite) && invite.token_hash !== token && !shareUrl.includes('+91'), 'invite stores no phone and no plaintext token');
await expectError(
  () => asProvider(`select * from create_byo_invite($1, 'Call 9876543210', 'Service', 10000)`, [serviceId]),
  /do not include phone/,
  'BYO text rejects phone numbers',
);
await expectError(
  () => asCustomer(`select * from byo_invites`),
  /permission denied/,
  'clients cannot read raw invite storage or token hashes',
);

const [preview] = await asCustomer(`select * from preview_byo_invite($1)`, [token]);
ok(preview.amount_paise === 100000 && preview.fee_paise === 3000 && preview.total_paise === 103000, 'BYO preview charges a 3% fee once');
await expectError(
  () => asProvider(`select claim_byo_invite($1, '1 Client Street', 'Vijayawada', 16.5, 80.6)`, [token]),
  /cannot claim/,
  'provider cannot claim their own invite',
);
const [{ claim_byo_invite: byoBooking }] = await asCustomer(
  `select claim_byo_invite($1, '1 Client Street', 'Vijayawada', 16.5, 80.6)`,
  [token],
);
await expectError(
  () => asCustomer(`select claim_byo_invite($1, 'Another', 'Vijayawada', 16.5, 80.6)`, [token]),
  /already been used/,
  'BYO token is single use',
);
const [byo] = await service(`select * from bookings where id = $1`, [byoBooking]);
ok(byo.booking_origin === 'byo' && byo.total_amount === 103000 && byo.platform_fee === 3000, 'claimed BYO booking stores the 3% fee path');

const [payment] = await service(`select * from prepare_payment($1, $2)`, [byoBooking, CUSTOMER]);
ok(payment.purpose === 'fixed' && payment.amount === 103000, 'BYO creates one full fixed-payment obligation');
const paymentLink = 'link_byo';
await service(`update payments set razorpay_link_id = $1, short_url = 'https://rzp.test/byo' where id = $2`, [paymentLink, payment.payment_id]);
await service(`select record_payment_paid($1, 'pay_byo', $2)`, [paymentLink, payment.amount]);
const duplicate = (await service(`select record_payment_paid($1, 'pay_byo', $2) as result`, [paymentLink, payment.amount]))[0].result;
ok(duplicate.duplicate === true, 'BYO webhook handling is idempotent');
ok((await service(`select status from bookings where id = $1`, [byoBooking]))[0].status === 'accepted', 'paid BYO booking starts accepted');

await asProvider(`select start_trip($1)`, [byoBooking]);
const [{ start_otp: startOtp }] = await asCustomer(`select * from get_booking_otps($1)`, [byoBooking]);
const arrival = (await asProvider(`select arrive($1, $2) as result`, [byoBooking, startOtp]))[0].result;
ok(arrival.ok === true && (await service(`select status from bookings where id = $1`, [byoBooking]))[0].status === 'in_progress',
  'BYO start OTP moves a pre-priced job directly to in progress');
await asProvider(`select request_completion($1)`, [byoBooking]);
const [{ end_otp: endOtp }] = await asCustomer(`select * from get_booking_otps($1)`, [byoBooking]);
await asProvider(`select complete_booking($1, $2)`, [byoBooking, endOtp]);
const [byoPayout] = await service(`select * from payouts where booking_id = $1`, [byoBooking]);
ok(byoPayout.commission === 0 && byoPayout.gst_on_commission === 0 && byoPayout.amount === 100000, 'BYO pays the provider the agreed amount with no commission');
ok(
  (await service(`select coalesce(sum(amount), 0)::int amount from payout_transfers where payout_id = $1`, [byoPayout.id]))[0].amount === 100000,
  'BYO transfer consumes only the provider amount from the captured fixed payment',
);

// Detection is soft: message delivered, nudge returned, admin-only evidence, no suspension.
const benign = (await asCustomer(`select send_booking_message($1, 'I will be home after lunch') as result`, [byoBooking]))[0].result;
const nudge = (await asCustomer(`select send_booking_message($1, 'Pay me directly on UPI 9988776655') as result`, [byoBooking]))[0].result;
ok(benign.nudge === false && nudge.nudge === true, 'chat returns an inline nudge only for obvious leakage phrases');
const adminSignals = await asAdmin(`select kind, details from leakage_signals order by id`);
ok(adminSignals.some((s) => s.kind === 'off_platform_payment') && adminSignals.some((s) => s.kind === 'contact_details'), 'admin can read classified leakage evidence');
ok(
  (await asCustomer(`select * from leakage_signals`)).length === 0,
  'non-admin cannot read leakage evidence',
);
ok((await service(`select suspended from providers where id = $1`, [PROVIDER]))[0].suspended === false, 'leakage never auto-suspends a provider');

if (failures) {
  console.error(`${failures} leakage programme test(s) failed`);
  process.exitCode = 1;
} else {
  console.log('leakage programme tests passed');
}

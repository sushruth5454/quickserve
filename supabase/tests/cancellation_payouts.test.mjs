// Cancellation policy snapshots, exclusive-window reservation and post-transfer payout recovery.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = (file) =>
  fs.readFileSync(path.join(here, '..', 'migrations', file), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');
const cases = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'cancellation-cases.json'), 'utf8'));

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
for (const file of [
  '0001_init.sql',
  '0002_qa_fixes.sql',
  '0003_payout_transfer_payment_cascade.sql',
  '0007_chat_unread_notifications.sql',
  '0008_provider_kyc_status_values.sql',
  '0009_provider_onboarding.sql',
  '0010_notification_freshness.sql',
  '0011_payout_rails.sql',
  '0012_matching_foundations.sql',
  '0013_review_matching.sql',
  '0014_travel_requests.sql',
  '0015_seva_coins.sql',
  '0016_leakage_programme.sql',
  '0017_creator_config.sql',
  '0018_archetype_core.sql',
  '0019_fixed_package_booking.sql',
  '0020_proposal_enum_values.sql',
  '0021_cancellation_availability_payouts.sql',
  '0022_time_based_booking.sql',
  '0023_proposal_milestone_booking.sql',
]) {
  await db.exec(migration(file));
}

let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('ok  :', message);
  else {
    failures++;
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
async function expectError(fn, pattern, message) {
  try {
    await fn();
    ok(false, `${message} (no error)`);
  } catch (error) {
    ok(pattern.test(error.message), `${message} -> ${error.message}`);
  }
}

const customer = '00000000-0000-0000-0000-000000000101';
const provider = '00000000-0000-0000-0000-000000000102';
const other = '00000000-0000-0000-0000-000000000103';
const admin = '00000000-0000-0000-0000-000000000104';
await db.exec(`
  insert into auth.users (id) values ('${customer}'), ('${provider}'), ('${other}'), ('${admin}');
  insert into admins (user_id) values ('${admin}');
  update profiles set role_provider = true where id = '${provider}';
  insert into providers (
    id, bio, city, kyc_status, razorpay_account_id, submitted_at, terms_version, onboarding_step, created_at
  ) values (
    '${provider}', 'Test provider', 'Vijayawada', 'verified', 'acc_route',
    now() - interval '90 days', 'legacy', 7, now() - interval '90 days'
  );
  insert into provider_payout_accounts (
    provider_id, rail, razorpay_account_id, activation_status
  ) values (
    '${provider}', 'route', 'acc_route', 'activated'
  );
  insert into app_config (key, value)
  values ('archetype_flags', '{"fixed":true,"inspect_quote":true,"proposal":true,"time_based":true,"remote":true}'::jsonb)
  on conflict (key) do update set value = excluded.value;
  insert into category_cities (category_id, city, live, launched_at)
  select id, 'Vijayawada', true, now() from categories
  on conflict (category_id, city) do update set live = true, launched_at = excluded.launched_at;
`);
const asCustomer = (sql, params) => as(customer, 'authenticated', sql, params);
const asProvider = (sql, params) => as(provider, 'authenticated', sql, params);
const asAdmin = (sql, params) => as(admin, 'authenticated', sql, params);
const service = (sql, params) => as(null, 'service_role', sql, params);

const [{ id: categoryId }] = await service(`select id from categories where slug = 'ac-repair'`);
const [{ id: serviceId }] = await service(
  `insert into provider_services (provider_id, category_id, visit_fee, labour_rate)
   values ($1, $2, 19900, 50000) returning id`,
  [provider, categoryId],
);
const [{ id: addressId }] = await service(
  `insert into addresses (user_id, label, line1, city, lat, lng)
   values ($1, 'Test', '1 Road', 'Vijayawada', 16.5, 80.6) returning id`,
  [customer],
);

async function fixtureBooking(fx, sequence) {
  await service(
    `update categories
        set cancellation_policy = $1, exclusive = false, min_lead_hours = 0, max_lead_days = 365
      where id = $2`,
    [fx.policy, categoryId],
  );
  const since = fx.hoursSinceBooking ?? 0;
  const created = new Date();
  const at = new Date(created.getTime() + since * 3600_000);
  const start = new Date(at.getTime() + (fx.hoursBefore ?? 24) * 3600_000);
  const bookingRows = await service(
    `insert into bookings (
       customer_id, provider_id, category_id, provider_service_id, address_id,
       description, scheduled_at, status, visit_fee, platform_fee, service_window, total_amount,
       created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
     returning *`,
    [
      customer, provider, categoryId, serviceId, addressId, fx.name,
      start.toISOString(), fx.status, fx.principal, fx.platform,
      `[${start.toISOString()},${new Date(start.getTime() + 7200_000).toISOString()})`,
      fx.principal + fx.platform,
      created.toISOString(),
    ],
  );
  const booking = bookingRows[0];
  if (fx.advance > 0) {
    await service(
      `insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
       values ($1, 'advance', $2, 'paid', $3, $4)`,
      [booking.id, fx.advance, `pay_adv_${sequence}`, at.toISOString()],
    );
  }
  if (fx.principal > fx.advance) {
    await service(
      `insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
       values ($1, 'balance', $2, 'paid', $3, $4)`,
      [booking.id, fx.principal - fx.advance, `pay_principal_${sequence}`, at.toISOString()],
    );
  }
  if (fx.platform > 0) {
    const currentPaid = (await service(
      `select coalesce(sum(amount), 0)::int n from payments where booking_id = $1 and status = 'paid'`,
      [booking.id],
    ))[0].n;
    if (currentPaid + fx.platform > fx.principal) {
      await service(
        `insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
         values ($1, 'fixed', $2, 'paid', $3, $4)`,
        [booking.id, fx.platform, `pay_platform_${sequence}`, at.toISOString()],
      );
    }
  }
  return { booking, at };
}

for (let i = 0; i < cases.length; i++) {
  const fx = cases[i];
  const { booking, at } = await fixtureBooking(fx, i);
  const [{ outcome }] = await service(
    `select _cancellation_outcome($1, $2, $3, $4) outcome`,
    [booking.id, fx.actor, fx.reason, at.toISOString()],
  );
  ok(
    outcome.refund_amount === fx.refund
      && outcome.provider_compensation === fx.provider
      && (outcome.customer_credit ?? 0) === (fx.credit ?? 0),
    `${fx.name}: ${JSON.stringify(outcome)}`,
  );
}

const [{ id: immutableBooking }] = await service(`select id from bookings order by created_at limit 1`);
await expectError(
  () => service(`update bookings set cancellation_snapshot = '{}'::jsonb where id = '${immutableBooking}'`),
  /snapshot is immutable/,
  'cancellation snapshot is immutable',
);

// Standard-visit exact parity: customer after en_route loses the visit fee; 0016 still computes provider commission/GST.
await service(`update categories set cancellation_policy = 'standard_visit' where id = '${categoryId}'`);
const chargeStart = new Date(Date.now() + 3600_000);
const [{ id: chargeBooking }] = await service(
  `insert into bookings (
     customer_id, provider_id, category_id, provider_service_id, address_id, description,
     scheduled_at, status, visit_fee, platform_fee, service_window
   ) values ($1, $2, $3, $4, $5, 'charge', $6, 'en_route', 19900, 2900,
             tstzrange($6::timestamptz, $6::timestamptz + interval '2 hours', '[)')) returning id`,
  [customer, provider, categoryId, serviceId, addressId, chargeStart.toISOString()],
);
await service(
  `insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
   values ($1, 'visit_fee', 19900, 'paid', 'pay_charge', now())`,
  [chargeBooking],
);
await asCustomer(`select cancel_booking($1, 'late')`, [chargeBooking]);
const [{ amount, commission, gst_on_commission: gst }] = await service(
  `select amount, commission, gst_on_commission from payouts where booking_id = $1`,
  [chargeBooking],
);
ok(amount === 17082 && commission === 2388 && gst === 430, '0016 commission math preserved for standard_visit cancellation');

// Any exclusive overlap blocks; two non-exclusive jobs can coexist.
await service(`update categories set exclusive = false where id = '${categoryId}'`);
const overlapStart = new Date(Date.now() + 48 * 3600_000);
const insertWindow = (exclusive, name) =>
  service(
    `insert into bookings (
       customer_id, provider_id, category_id, provider_service_id, address_id, description,
       scheduled_at, status, visit_fee, platform_fee, service_window, exclusive
     ) values ($1, $2, $3, $4, $5, $6, $7, 'requested', 100, 0,
               tstzrange($7::timestamptz, $7::timestamptz + interval '2 hours', '[)'), $8) returning id`,
    [customer, provider, categoryId, serviceId, addressId, name, overlapStart.toISOString(), exclusive],
  );
await service(`update categories set exclusive = false where id = '${categoryId}'`);
await insertWindow(false, 'parallel-a');
await insertWindow(false, 'parallel-b');
ok(true, 'overlapping non-exclusive bookings allowed');
await service(`update categories set exclusive = true where id = '${categoryId}'`);
await expectError(
  () => insertWindow(true, 'exclusive'),
  /service window overlaps/,
  'exclusive booking rejects overlap with a non-exclusive occupant',
);

// A future tranche remains blocked even when the booking-level payout is due.
const [{ id: duePayout }] = await service(
  `update payouts set release_after = now() - interval '1 day' where booking_id = $1 returning id`,
  [chargeBooking],
);
const [{ id: transfer }] = await service(
  `update payout_transfers set release_after = now() + interval '1 day', rail = 'route'
    where payout_id = $1 returning id`,
  [duePayout],
);
ok((await service(`select * from claim_due_transfers()`)).length === 0, 'transfer release_after gates the tranche independently');
await service(`update payout_transfers set release_after = now() - interval '1 minute' where id = '${transfer}'`);
ok((await service(`select * from claim_due_transfers()`)).length === 1, 'due tranche becomes claimable');

// A post-transfer RazorpayX dispute refunds now and immediately records provider debt.
const disputeStart = new Date(Date.now() + 72 * 3600_000);
const [{ id: disputeBooking }] = await service(
  `insert into bookings (
     customer_id, provider_id, category_id, provider_service_id, address_id, description,
     scheduled_at, status, visit_fee, platform_fee, service_window
   ) values ($1, $2, $3, $4, $5, 'post transfer dispute', $6, 'completed', 10000, 0,
             tstzrange($6::timestamptz, $6::timestamptz + interval '2 hours', '[)')) returning id`,
  [customer, provider, categoryId, serviceId, addressId, disputeStart.toISOString()],
);
const [{ id: disputePayment }] = await service(
  `insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
   values ($1, 'balance', 10000, 'paid', 'pay_dispute', now()) returning id`,
  [disputeBooking],
);
const [{ id: disputePayout }] = await service(
  `insert into payouts (booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after, transferred_at)
   values ($1, $2, 10000, 0, 0, 10000, 'transferred', now() - interval '1 day', now() - interval '1 day') returning id`,
  [disputeBooking, provider],
);
await service(
  `insert into payout_transfers (
     payout_id, source_payment_id, amount, rail, status, razorpay_transfer_id, release_after, transferred_at
   ) values ($1, $2, 10000, 'payouts', 'transferred', 'pout_dispute', now() - interval '1 day', now() - interval '1 day')`,
  [disputePayout, disputePayment],
);
await asCustomer(`select dispute_booking($1, 'not delivered')`, [disputeBooking]);
await asAdmin(`select resolve_dispute($1, 'partial_refund', 4000, 'reviewed')`, [disputeBooking]);
const debt = await service(
  `select amount, recovery_key, status from provider_receivables where booking_id = $1`,
  [disputeBooking],
);
const refunds = await service(
  `select sum(amount)::int amount from refunds where payment_id = $1 and status <> 'failed'`,
  [disputePayment],
);
ok(debt.length === 1 && debt[0].amount === 4000, 'unreversible RazorpayX amount becomes provider debt');
ok(refunds[0].amount === 4000, 'customer refund is queued before provider recovery');

if (failures) process.exitCode = 1;

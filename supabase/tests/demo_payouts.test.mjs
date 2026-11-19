import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const migration = (file) =>
  fs.readFileSync(path.join(migrationsDir, file), 'utf8')
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
  .filter((file) => /^\d{4}[a-z]?_.*\.sql$/.test(file))
  .sort();
for (const file of migrationFiles) {
  const sql = migration(file);
  if (file === '0023_proposal_milestone_booking.sql') {
    const split = sql.indexOf('alter table public.categories');
    await db.exec(sql.slice(0, split));
    await db.exec('drop policy if exists payment_schedule_participants on public.payment_schedule;');
    await db.exec(sql.slice(split)
      .replaceAll("'confirmed'::public.booking_status", "'accepted'::public.booking_status")
      .replaceAll("'delivery_pending'::public.booking_status", "'accepted'::public.booking_status"));
  } else {
    await db.exec(sql);
  }
}
await db.exec("set timezone = 'UTC'");

const { ok, scenario, finish } = createHarness();
const uuid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const one = async (query, params = []) => (await db.query(query, params)).rows[0];
const fails = async (fn) => {
  try { await fn(); return null; } catch (error) { return error.message; }
};
async function as(uid, role, query, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return (await db.query(query, params)).rows; }
  finally { await db.exec('reset role;'); }
}

async function homeFixture(n, { appMeta = {}, userMeta = {} } = {}) {
  const customer = uuid(1000 + n);
  const provider = uuid(2000 + n);
  const category = uuid(3000 + n);
  const service = uuid(4000 + n);
  const address = uuid(5000 + n);
  const booking = uuid(6000 + n);
  await db.query(`
    insert into auth.users (id, phone, raw_app_meta_data, raw_user_meta_data)
    values ($1::uuid, $2::text, $3::jsonb, $4::jsonb)
  `, [customer, `+91990000${String(n).padStart(4, '0')}`, '{}', '{}']);
  await db.query(`
    insert into auth.users (id, phone, raw_app_meta_data, raw_user_meta_data)
    values ($1::uuid, $2::text, $3::jsonb, $4::jsonb)
  `, [provider, `+91880000${String(n).padStart(4, '0')}`, JSON.stringify(appMeta), JSON.stringify(userMeta)]);
  await db.query(`update public.profiles set full_name='X3 test user' where id in ($1::uuid, $2::uuid)`,
    [customer, provider]);
  await db.query(`
    insert into public.providers (id, city, base_location, kyc_status, admin_review_status, submitted_at,
      is_online, paused, suspended, razorpay_account_id)
    values ($1::uuid, 'X3 City', extensions.st_setsrid(extensions.st_makepoint(80.6,16.5),4326),
      'verified', 'approved', now(), true, false, false, $2::text)
  `, [provider, `acc_x3_${n}`]);
  await db.query(`
    insert into public.categories
      (id, slug, name, pricing_mode, active, archetype, location_modes, pricing_units,
       max_lead_days, config_version)
    values ($1::uuid, $2::text, 'X3 test service', 'quote', true, 'inspect_quote',
      array['at_customer']::text[], array['job']::text[], 365, 1)
  `, [category, `x3-test-${n}`]);
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, 'X3 City', true, now())
  `, [category]);
  await db.query(`
    insert into public.provider_services (id, provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, $3::uuid, 1000, 1000, true)
  `, [service, provider, category]);
  await db.query(`
    insert into public.provider_availability (provider_id, weekday, start_time, end_time)
    select $1::uuid, d, time '00:00', time '23:59' from generate_series(0, 6) d
  `, [provider]);
  await db.query(`
    insert into public.addresses (id, user_id, label, line1, city, lat, lng)
    values ($1::uuid, $2::uuid, 'X3 test', '1 X3 Road', 'X3 City', 16.5, 80.6)
  `, [address, customer]);
  await db.query(`
    insert into public.bookings (
      id, customer_id, provider_id, category_id, provider_service_id, address_id,
      description, status, visit_fee, platform_fee
    ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
      'X3 demo payout test', 'pending_payment', 1000, 0)
  `, [booking, customer, provider, category, service, address]);
  return { customer, provider, category, service, address, booking };
}

async function paidHomePayment(booking, paymentId, amount) {
  return (await one(`
    insert into public.payments
      (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
    values ($1::uuid, 'visit_fee', $2::int, 'paid', $3::text, now())
    returning id
  `, [booking, amount, paymentId])).id;
}

async function sportsFixture(n, { demo = false } = {}) {
  const owner = uuid(7000 + n);
  const customer = uuid(8000 + n);
  const venue = uuid(9000 + n);
  const activity = uuid(10000 + n);
  const resource = uuid(11000 + n);
  const booking = uuid(12000 + n);
  const ownerMeta = demo ? { demo_only: 'true' } : {};
  await db.query(`
    insert into auth.users (id, phone, raw_app_meta_data, raw_user_meta_data)
    values ($1::uuid, $2::text, $3::jsonb, '{}'::jsonb), ($4::uuid, $5::text, '{}'::jsonb, '{}'::jsonb)
  `, [owner, `+91770000${String(n).padStart(4, '0')}`, JSON.stringify(ownerMeta),
    customer, `+91660000${String(n).padStart(4, '0')}`]);
  await db.query(`update public.profiles set full_name='X3 sports test user' where id in ($1::uuid,$2::uuid)`,
    [owner, customer]);
  await db.query(`
    insert into public.providers (id, city, kyc_status, submitted_at, is_online, paused, suspended, razorpay_account_id)
    values ($1::uuid, 'X3 City', 'verified', now(), true, false, false, $2::text)
  `, [owner, `acc_x3_sports_${n}`]);
  await db.query(`
    insert into public.provider_payout_accounts (provider_id, rail, fund_account_id, activation_status)
    values ($1::uuid, 'payouts', $2::text, 'activated')
  `, [owner, `fa_x3_${n}`]);
  await db.query(`
    insert into public.sports_activities (id, slug, name)
    values ($1::uuid, $2::text, 'X3 sport')
  `, [activity, `x3-sport-${n}`]);
  await db.query(`
    insert into public.sports_venues
      (id, owner_id, name, address_line, city, area, lat, lng, status)
    values ($1::uuid, $2::uuid, 'X3 test venue', '1 X3 Road', 'X3 City', 'Central', 16.5, 80.6, 'verified')
  `, [venue, owner]);
  await db.query(`
    insert into public.sports_resources (id, venue_id, activity_id, name)
    values ($1::uuid, $2::uuid, $3::uuid, 'X3 court')
  `, [resource, venue, activity]);
  await db.query(`
    insert into public.sports_bookings
      (id, customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise,
       expires_at, payment_mode, participants, customer_fee_paise, total_paise, commission_bp, paid_at)
    values ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
      '2030-01-15T10:00:00Z'::timestamptz + make_interval(mins => $5::int),
      '2030-01-15T11:00:00Z'::timestamptz + make_interval(mins => $5::int),
      'completed', 20000, now() + interval '1 day', 'online', 1, 500, 20500, 1000, now())
  `, [booking, customer, venue, resource, n]);
  const paymentId = (await one(`
    insert into public.payments
      (sports_booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
    values ($1::uuid, 'fixed', 20500, 'paid', $2::text, now())
    returning id
  `, [booking, `${demo ? 'pay_demo_x3_' : 'pay_x3_sports_'}${n}`])).id;
  return { owner, customer, venue, resource, booking, paymentId };
}

async function legacyPayoutTransfer({ booking = null, sportsBooking = null, provider = null, payee = null,
  paymentId, amount, rail, status = 'pending' }) {
  const payout = await one(`
    insert into public.payouts
      (booking_id, provider_id, sports_booking_id, payee_id, gross, commission,
       gst_on_commission, amount, status, release_after)
    values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::int, 0, 0, $5::int, $6::public.payout_status,
      now() - interval '1 minute')
    returning id
  `, [booking, provider, sportsBooking, payee, amount, status]);
  const transfer = await one(`
    insert into public.payout_transfers (payout_id, source_payment_id, amount, rail, release_after)
    values ($1::uuid, $2::uuid, $3::int, $4::text, now() - interval '1 minute')
    returning id
  `, [payout.id, paymentId, amount, rail]);
  return { payoutId: payout.id, transferId: transfer.id };
}

await scenario('user_metadata cannot self-flag a demo provider', async () => {
  const fx = await homeFixture(1, { userMeta: { demo_only: 'true' } });
  await db.exec(`
    update public.app_config set value='{"enabled":true,"provider_ids":[]}'::jsonb where key='demo_payments';
    update public.app_config set value='{"is_demo_project":true}'::jsonb where key='deployment'
  `);
  const error = await fails(() =>
    as(fx.customer, 'authenticated', 'select public.demo_settle_payment($1::uuid)', [fx.booking]));
  ok(/demo providers/.test(error ?? ''),
    `raw_user_meta_data spoof is rejected: ${JSON.stringify({ error })}`);
});

await scenario('deployment flag fails closed and demo home payout is excluded', async () => {
  const fx = await homeFixture(2, { appMeta: { demo_only: 'true' }, userMeta: { demo_only: 'true' } });
  await db.query(`
    update public.app_config set value='{"enabled":true,"provider_ids":[]}'::jsonb where key='demo_payments'
  `);
  await db.query(`
    update public.app_config set value='{"is_demo_project":false}'::jsonb where key='deployment'
  `);
  const defaultFlag = await one(`select value->>'is_demo_project' is_demo from public.app_config where key='deployment'`);
  const blocked = await fails(() =>
    as(fx.customer, 'authenticated', 'select public.demo_settle_payment($1::uuid)', [fx.booking]));
  ok(defaultFlag.is_demo === 'false' && /demo payments are disabled/.test(blocked ?? ''),
    `deployment defaults off: ${JSON.stringify({ defaultFlag, error: blocked })}`);

  await db.query(`update public.app_config set value='{"is_demo_project":true}'::jsonb where key='deployment'`);
  const demoPayment = await paidHomePayment(fx.booking, 'pay_demo_x3_home_payout_2', 1000);
  await paidHomePayment(fx.booking, 'pay_real_x3_mixed_2', 193760);
  await as(null, 'service_role', `
    select public._create_payout($1::uuid, $2::int, $3::int, $4::timestamptz)
  `, [fx.booking, 193760, 0, '2099-01-17T10:00:00Z']);
  const payout = await one(`
    select id, gross, commission, gst_on_commission, amount, status
      from public.payouts where booking_id=$1::uuid
  `, [fx.booking]);
  const transfers = await one(`
    select count(*)::int count from public.payout_transfers where payout_id=$1::uuid
  `, [payout.id]);
  ok(Boolean(demoPayment) && payout.status === 'demo' && payout.gross === 193760
    && payout.commission === 0 && payout.gst_on_commission === 0 && payout.amount === 193760
    && transfers.count === 0,
  `demo home payout keeps exact paise and creates no transfers: ${JSON.stringify({ demoPayment, payout, transfers })}`);
});

await scenario('home allocator excludes demo source payments and preserves the exact route amount', async () => {
  const fx = await homeFixture(3);
  const demoPayment = await paidHomePayment(fx.booking, 'pay_demo_x3_home_allocator', 193760);
  const realPayment = await paidHomePayment(fx.booking, 'pay_x3_home_allocator', 193760);
  await db.query(`update public.app_config set value='"route"'::jsonb where key='payout_rail'`);
  const payout = await one(`
    insert into public.payouts
      (booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after)
    values ($1::uuid, $2::uuid, 193760, 0, 0, 193760, 'pending', '2099-01-17T10:00:00Z')
    returning id
  `, [fx.booking, fx.provider]);
  await as(null, 'service_role', 'select public._allocate_payout($1::uuid)', [payout.id]);
  const allocated = await db.query(`
    select source_payment_id, amount, rail from public.payout_transfers where payout_id=$1::uuid
  `, [payout.id]);
  const actual = allocated.rows;
  ok(actual.length === 1 && actual[0].source_payment_id === realPayment
    && actual[0].source_payment_id !== demoPayment && actual[0].amount === 193760
    && actual[0].rail === 'route',
  `home allocation excludes pay_demo_ and allocates exact paise on Route: ${JSON.stringify({ actual, demoPayment, realPayment })}`);
});

await scenario('sports payouts exclude demo money and preserve the payouts rail amount', async () => {
  await db.query(`
    update public.app_config
       set value=value || '{"commission_bp":1000,"release_after_hours":24}'::jsonb
     where key='sports_rules'
  `);
  await db.query(`update public.app_config set value='"payouts"'::jsonb where key='payout_rail'`);
  const demo = await sportsFixture(4, { demo: true });
  await db.query(`
    insert into public.payments
      (sports_booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
    values ($1::uuid, 'fixed', 20500, 'paid', 'pay_x3_sports_mixed_4', now())
  `, [demo.booking]);
  await as(null, 'service_role', 'select public._create_sports_payout($1::uuid)', [demo.booking]);
  const demoPayout = await one(`
    select id, gross, commission, gst_on_commission, amount, status
      from public.payouts where sports_booking_id=$1::uuid
  `, [demo.booking]);
  const demoTransfers = await one(`
    select count(*)::int count from public.payout_transfers where payout_id=$1::uuid
  `, [demoPayout.id]);
  ok(demoPayout.status === 'demo' && demoPayout.gross === 20000 && demoPayout.commission === 2000
    && demoPayout.gst_on_commission === 360 && demoPayout.amount === 17640 && demoTransfers.count === 0,
  `demo sports payout has no transfers: ${JSON.stringify({ demoPayout, demoTransfers })}`);

  const real = await sportsFixture(5);
  await as(null, 'service_role', 'select public._create_sports_payout($1::uuid)', [real.booking]);
  const realPayout = await one(`
    select id, gross, commission, gst_on_commission, amount, status
      from public.payouts where sports_booking_id=$1::uuid
  `, [real.booking]);
  const realTransfer = await one(`
    select source_payment_id, amount, rail from public.payout_transfers where payout_id=$1::uuid
  `, [realPayout.id]);
  ok(realPayout.status === 'pending' && realPayout.gross === 20000 && realPayout.commission === 2000
    && realPayout.gst_on_commission === 360 && realPayout.amount === 17640
    && realTransfer.source_payment_id === real.paymentId && realTransfer.amount === 17640
    && realTransfer.rail === 'payouts',
  `real sports payout retains exact paise on RazorpayX: ${JSON.stringify({ realPayout, realTransfer, paymentId: real.paymentId })}`);
});

await scenario('claim_due_transfers excludes legacy demo rows on both rails', async () => {
  const homeDemo = await homeFixture(6);
  const homeReal = await homeFixture(7);
  const homeDemoPayment = await paidHomePayment(homeDemo.booking, 'pay_demo_x3_claim_home', 193760);
  const homeRealPayment = await paidHomePayment(homeReal.booking, 'pay_x3_claim_home', 193760);
  const homeDemoTransfer = await legacyPayoutTransfer({
    booking: homeDemo.booking, provider: homeDemo.provider, paymentId: homeDemoPayment,
    amount: 193760, rail: 'route',
  });
  const homeRealTransfer = await legacyPayoutTransfer({
    booking: homeReal.booking, provider: homeReal.provider, paymentId: homeRealPayment,
    amount: 193760, rail: 'route',
  });

  const sportsDemo = await sportsFixture(8, { demo: true });
  const sportsReal = await sportsFixture(9);
  const sportsDemoTransfer = await legacyPayoutTransfer({
    sportsBooking: sportsDemo.booking, payee: sportsDemo.owner, paymentId: sportsDemo.paymentId,
    amount: 17640, rail: 'payouts',
  });
  const sportsRealTransfer = await legacyPayoutTransfer({
    sportsBooking: sportsReal.booking, payee: sportsReal.owner, paymentId: sportsReal.paymentId,
    amount: 17640, rail: 'payouts',
  });

  const claimed = await as(null, 'service_role', 'select * from public.claim_due_transfers(20::int)');
  const ids = claimed.map((row) => row.transfer_id).sort();
  const expected = [homeRealTransfer.transferId, sportsRealTransfer.transferId].sort();
  const claimedAmounts = claimed.map(({ transfer_id, amount, rail }) => ({ transfer_id, amount, rail }))
    .sort((a, b) => a.transfer_id.localeCompare(b.transfer_id));
  const demoStates = await db.query(`
    select id, status from public.payout_transfers
     where id in ($1::uuid, $2::uuid)
     order by id
  `, [homeDemoTransfer.transferId, sportsDemoTransfer.transferId]);
  ok(JSON.stringify(ids) === JSON.stringify(expected)
    && JSON.stringify(claimedAmounts) === JSON.stringify([
      { transfer_id: homeRealTransfer.transferId, amount: 193760, rail: 'route' },
      { transfer_id: sportsRealTransfer.transferId, amount: 17640, rail: 'payouts' },
    ].sort((a, b) => a.transfer_id.localeCompare(b.transfer_id)))
    && demoStates.rows.every((row) => row.status === 'pending'),
  `claim returns only real home/sports payouts with exact paise: ${JSON.stringify({ ids, expected, claimedAmounts, demoStates: demoStates.rows })}`);
});

await db.close();
finish();

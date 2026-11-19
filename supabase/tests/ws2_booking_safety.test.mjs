import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const targetMigration = '0061_h1_provider_cancellation_and_recurring_privacy.sql';
const h3Migration = '0083_h3_home_booking_safety.sql';
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((file) => /^\d{4}[a-z]?_.+\.sql$/.test(file) && Number(file.slice(0, 4)) <= 83)
  .sort();
if (!migrationFiles.includes(targetMigration) || !migrationFiles.includes(h3Migration)) {
  throw new Error(`missing required booking-safety migration: ${targetMigration} or ${h3Migration}`);
}

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
const actors = [
  { customer: '00000000-0000-0000-0000-000000000101', provider: '00000000-0000-0000-0000-000000000102' },
  { customer: '00000000-0000-0000-0000-000000000103', provider: '00000000-0000-0000-0000-000000000104' },
  { customer: '00000000-0000-0000-0000-000000000105', provider: '00000000-0000-0000-0000-000000000106' },
  { customer: '00000000-0000-0000-0000-000000000107', provider: '00000000-0000-0000-0000-000000000108' },
  { customer: '00000000-0000-0000-0000-000000000109', provider: '00000000-0000-0000-0000-000000000110' },
  { customer: '00000000-0000-0000-0000-000000000111', provider: '00000000-0000-0000-0000-000000000112' },
  { customer: '00000000-0000-0000-0000-000000000113', provider: '00000000-0000-0000-0000-000000000114' },
  { customer: '00000000-0000-0000-0000-000000000115', provider: '00000000-0000-0000-0000-000000000116' },
  { customer: '00000000-0000-0000-0000-000000000117', provider: '00000000-0000-0000-0000-000000000118' },
  { customer: '00000000-0000-0000-0000-000000000119', provider: '00000000-0000-0000-0000-000000000120' },
  { customer: '00000000-0000-0000-0000-000000000121', provider: '00000000-0000-0000-0000-000000000122' },
  { customer: '00000000-0000-0000-0000-000000000123', provider: '00000000-0000-0000-0000-000000000124' },
];
const ADMIN = '00000000-0000-0000-0000-000000000901';
let fixtures;

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const failMessage = async (fn) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return error.message;
  }
};

async function prepareFixtures() {
  const userIds = actors.flatMap(({ customer, provider }) => [customer, provider]);
  await db.query(
    `insert into auth.users (id) values ${userIds.map((_, i) => `($${i + 1}::uuid)`).join(', ')}`,
    userIds,
  );
  await db.query(`update profiles set role_provider=true where id=any($1::uuid[])`,
    [actors.map(({ provider }) => provider)]);
  const providerValues = actors.map((_, i) => {
    const idParam = i * 2 + 1;
    const offsetParam = idParam + 1;
    return `($${idParam}::uuid, 'Vijayawada',
      extensions.st_setsrid(extensions.st_makepoint(80.60 + $${offsetParam}::int * 0.01, 16.50), 4326),
      'verified', now(), now() - interval '90 days', true, false, false)`;
  });
  await db.query(`
    insert into providers (id, city, base_location, kyc_status, submitted_at, created_at, is_online, paused, suspended)
    values ${providerValues.join(', ')}`,
  actors.flatMap(({ provider }, i) => [provider, i]));
  const categoryId = (await one(`
    insert into categories (
      slug, name, pricing_mode, active, archetype, cancellation_policy, min_lead_hours, max_lead_days,
      commission_bp
    ) values ($1::text, $2::text, 'quote', true, 'inspect_quote', 'standard_visit', 0, 365, 1200)
    returning id`,
  ['h1-booking-safety', 'H1 booking safety'])).id;
  await db.query(`
    update app_config
       set value=jsonb_set(value, '{inspect_quote}', 'true'::jsonb, true)
     where key='archetype_flags'`);
  await db.query(`
    insert into category_cities (category_id, city, live, launched_at)
    values ($1::uuid, 'Vijayawada', true, now())
    on conflict (category_id, city) do update set live=true, launched_at=excluded.launched_at`,
  [categoryId]);
  const serviceIds = [];
  const addresses = [];
  for (const [index, actor] of actors.entries()) {
    serviceIds.push((await one(`
      insert into provider_services (provider_id, category_id, visit_fee, labour_rate, active)
      values ($1::uuid, $2::uuid, 10000, 0, true)
      returning id`,
    [actor.provider, categoryId])).id);
    addresses.push((await one(`
      insert into addresses (user_id, label, line1, city, lat, lng)
      values ($1::uuid, 'Home', $2::text, 'Vijayawada', 16.50, 80.60 + $3::int * 0.01)
      returning id`,
    [actor.customer, `H1 road ${index + 1}`, index])).id);
  }
  fixtures = actors.map((actor, index) => ({
    ...actor,
    categoryId,
    serviceId: serviceIds[index],
    addressId: addresses[index],
  }));
  return fixtures;
}

async function insertBooking(fixture, status, date) {
  const scheduledAt = date.includes('T') ? date : `${date}T10:00:00+05:30`;
  return (await one(`
    insert into bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, status, visit_fee, platform_fee, total_amount, service_window
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'H1 test',
      $6::timestamptz, $7::public.booking_status, 10000, 0, 10000,
      tstzrange($6::timestamptz, $6::timestamptz + interval '2 hours', '[)')
    ) returning id`,
  [fixture.customer, fixture.provider, fixture.categoryId, fixture.serviceId,
    fixture.addressId, scheduledAt, status])).id;
}

async function setBookingScheduledAtInPast(bookingId, minutesAgo) {
  await db.query(`
    update public.bookings b
       set scheduled_at = now() - make_interval(mins => $1::int),
           service_window = tstzrange(
             now() - make_interval(mins => $1::int),
             now() - make_interval(mins => $1::int) + interval '2 hours',
             '[)'
           )
     where b.id = $2::uuid
  `, [minutesAgo, bookingId]);
}

for (const file of migrationFiles) {
  if (file === targetMigration) {
    fixtures = await prepareFixtures();
    await insertBooking(fixtures[0], 'requested', '2027-02-01');
  }
  await db.exec(migration(file));
}

await db.exec(`set timezone='UTC'`);
await scenario('legacy cancellation snapshots gain actor guards', async () => {
  const snapshot = (await one(`
    select cancellation_snapshot
      from bookings
     where customer_id=$1::uuid and provider_id=$2::uuid`,
  [fixtures[0].customer, fixtures[0].provider])).cancellation_snapshot;
  const rule = snapshot.rules.find((entry) => entry.name === 'customer_after_trip_or_no_show');
  const policies = (await db.query(`
    select key, rules
      from cancellation_policies
     where key=any($1::text[])`,
  [['standard_visit', 'fixed', 'fixed_flexible']])).rows;
  const policyRules = Object.fromEntries(policies.map(({ key, rules }) => [
    key,
    rules.rules.find((entry) => entry.name ===
      (key === 'standard_visit' ? 'customer_after_trip_or_no_show' : 'half_refund_after_arrival_or_no_show'))
      ?.match?.actors ?? null,
  ]));
  const actual = {
    policyCount: policies.length,
    snapshotActors: rule?.match?.actors ?? null,
    policyActors: policyRules,
  };
  ok(actual.policyCount === 3
    && JSON.stringify(actual.snapshotActors) === JSON.stringify(['customer', 'system'])
    && Object.values(actual.policyActors).every((actorsForRule) =>
      JSON.stringify(actorsForRule) === JSON.stringify(['customer', 'system'])),
  `H1 migrates existing and future standard-visit rules: ${JSON.stringify(actual)}`);
});

await scenario('provider cannot claim customer_payment_default', async () => {
  const bookingId = await insertBooking(fixtures[1], 'accepted', '2027-02-02');
  const error = await failMessage(() => as(fixtures[1].provider, 'authenticated',
    `select provider_cancel_booking($1::uuid, $2::text, null)`,
    [bookingId, 'customer_payment_default']));
  const state = await one(`select status::text status from bookings where id=$1::uuid`, [bookingId]);
  ok(/invalid provider cancellation reason/i.test(error ?? '') && state.status === 'accepted',
    `direct payment-default claim is rejected without changing booking: ${JSON.stringify({ error, state })}`);
});

await scenario('provider cannot cancel in_progress', async () => {
  const bookingId = await insertBooking(fixtures[2], 'in_progress', '2027-02-03');
  const error = await failMessage(() => as(fixtures[2].provider, 'authenticated',
    `select provider_cancel_booking($1::uuid, $2::text, null)`,
    [bookingId, 'provider_cancellation']));
  const state = await one(`select status::text status from bookings where id=$1::uuid`, [bookingId]);
  ok(/booking can no longer be cancelled/i.test(error ?? '') && state.status === 'in_progress',
    `in-progress cancellation is rejected without changing booking: ${JSON.stringify({ error, state })}`);
});

await scenario('provider cancellation in accepted refunds the customer in full', async () => {
  const bookingId = await insertBooking(fixtures[3], 'accepted', '2027-02-04');
  const paymentId = (await one(`
    insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
    values ($1::uuid, 'visit_fee', 10000, 'paid', 'h1-provider-cancel-paid', now())
    returning id`,
  [bookingId])).id;
  const outcome = (await as(fixtures[3].provider, 'authenticated',
    `select provider_cancel_booking($1::uuid, $2::text, null) outcome`,
    [bookingId, 'provider_cancellation']))[0].outcome;
  const refund = await one(`
    select coalesce(sum(amount), 0)::int amount
      from refunds
     where payment_id=$1::uuid and status <> 'failed'`,
  [paymentId]);
  const state = await one(`
    select status::text status, refund_amount
      from bookings
     where id=$1::uuid`,
  [bookingId]);
  ok(outcome.refund_amount === 10000 && refund.amount === 10000
    && state.status === 'cancelled' && state.refund_amount === 10000,
  `accepted provider cancellation refunds all paid principal: ${JSON.stringify({ outcome, refund, state })}`);
});

await db.query(`insert into auth.users (id) values ($1::uuid)`, [ADMIN]);
await db.query(`insert into admins (user_id) values ($1::uuid)`, [ADMIN]);

await scenario('home safety settings are admin-managed with safe defaults and validated ranges', async () => {
  const feature = await one(`
    select enabled, description
      from feature_flags
     where key = $1::text`,
  ['home_no_show_reporting']);
  const defaults = (await as(ADMIN, 'authenticated', `
    select admin_get_home_booking_safety_rules() rules
  `))[0].rules;
  const unauthorized = await failMessage(() => as(actors[0].customer, 'authenticated', `
    select admin_set_home_booking_safety_rules($1::int, $2::int)
  `, [48, 30]));
  const invalid = await failMessage(() => as(ADMIN, 'authenticated', `
    select admin_set_home_booking_safety_rules($1::int, $2::int)
  `, [0, 30]));
  const invalidGrace = await failMessage(() => as(ADMIN, 'authenticated', `
    select admin_set_home_booking_safety_rules($1::int, $2::int)
  `, [48, 0]));
  const configured = (await as(ADMIN, 'authenticated', `
    select admin_set_home_booking_safety_rules($1::int, $2::int) rules
  `, [48, 30]))[0].rules;
  const actual = { feature, defaults, unauthorized, invalid, invalidGrace, configured };
  ok(feature?.enabled === false
    && /Off:.*no-show reporting is hidden and rejected/i.test(feature.description)
    && defaults.stalled_timeout_hours === 48
    && defaults.no_show_grace_minutes === 30
    && /admin only/i.test(unauthorized ?? '')
    && /between/i.test(invalid ?? '')
    && /between/i.test(invalidGrace ?? '')
    && configured.stalled_timeout_hours === 48
    && configured.no_show_grace_minutes === 30,
  `home safety switch and timing config default safely and require validated admin updates: ${JSON.stringify(actual)}`);
});

await scenario('no-show reporting is rejected while its feature flag is off', async () => {
  await db.query(`update feature_flags set enabled=false where key=$1::text`, ['home_no_show_reporting']);
  const bookingId = await insertBooking(fixtures[9], 'accepted', '2027-02-10');
  const error = await failMessage(() => as(fixtures[9].customer, 'authenticated', `
    select report_no_show($1::uuid, $2::text)
  `, [bookingId, 'provider']));
  const state = await one(`select status::text status from bookings where id=$1::uuid`, [bookingId]);
  const threadCount = (await one(`
    select count(*)::int count from support_threads where booking_id=$1::uuid`,
  [bookingId])).count;
  const actual = { error, state, threadCount };
  ok(/turned off/i.test(error ?? '') && state.status === 'accepted' && threadCount === 0,
    `disabled no-show reporting leaves existing booking and support state unchanged: ${JSON.stringify(actual)}`);
});

await scenario('quote_sent and awaiting_payment expire after 48 hours with exact visit-fee payouts', async () => {
  const quoteSentId = await insertBooking(fixtures[4], 'quote_sent', '2027-02-11');
  const awaitingPaymentId = await insertBooking(fixtures[5], 'awaiting_payment', '2027-02-12');
  const unpaidId = await insertBooking(fixtures[11], 'quote_sent', '2027-02-14');
  for (const [bookingId, paymentKey] of [
    [quoteSentId, 'h3-quote-sent-visit-fee'],
    [awaitingPaymentId, 'h3-awaiting-payment-visit-fee'],
  ]) {
    await db.query(`
      insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
      values ($1::uuid, 'visit_fee', $2::int, 'paid', $3::text, now())
    `, [bookingId, 10000, `${paymentKey}-${bookingId}`]);
    await db.query(`
      update bookings set updated_at = now() - interval '49 hours'
       where id = $1::uuid
    `, [bookingId]);
  }
  await db.query(`
    update bookings set updated_at = now() - interval '49 hours'
     where id = $1::uuid
  `, [unpaidId]);
  const unauthorizedExpire = await failMessage(() => as(actors[0].customer, 'authenticated', `
    select expire_stalled_bookings()
  `));
  await as(ADMIN, 'authenticated', `
    select admin_set_home_booking_safety_rules($1::int, $2::int)
  `, [72, 30]);
  const heldCount = (await as(null, 'service_role', `select expire_stalled_bookings() expired`))[0].expired;
  const heldRows = await db.query(`
    select b.id, b.status::text status, p.id payout_id
       from bookings b
       left join payouts p on p.booking_id = b.id
     where b.id = any($1::uuid[])
     order by b.id
  `, [[quoteSentId, awaitingPaymentId, unpaidId]]);
  await as(ADMIN, 'authenticated', `
    select admin_set_home_booking_safety_rules($1::int, $2::int)
  `, [48, 30]);
  const expired = (await as(null, 'service_role', `select expire_stalled_bookings() expired`))[0].expired;
  const rows = await db.query(`
    select b.id, b.status::text status, p.gross, p.commission, p.gst_on_commission, p.amount,
           p.status::text payout_status
      from bookings b
      left join payouts p on p.booking_id = b.id
     where b.id = any($1::uuid[])
     order by b.id
  `, [[quoteSentId, awaitingPaymentId, unpaidId]]);
  const paidRows = rows.rows.filter((row) => row.id !== unpaidId);
  const unpaidRow = rows.rows.find((row) => row.id === unpaidId);
  const actual = { unauthorizedExpire, heldCount, heldRows: heldRows.rows, expired, rows: rows.rows };
  ok(/permission denied/i.test(unauthorizedExpire ?? '')
    && heldCount === 0
    && heldRows.rows.every((row) => row.status !== 'closed_no_work' && row.payout_id == null)
    && expired === 3
    && paidRows.length === 2
    && paidRows.every((row) => row.status === 'closed_no_work'
      && row.gross === 10000
      && row.commission === 1200
      && row.gst_on_commission === 216
      && row.amount === 8584
      && row.payout_status === 'pending'),
    `both paid stalled states close with exact visit-fee payouts: ${JSON.stringify(actual)}`);
  ok(unpaidRow?.status === 'closed_no_work' && unpaidRow.gross == null && unpaidRow.amount == null,
    `unpaid stale booking closes without creating a payout: ${JSON.stringify(actual)}`);
});

await scenario('no-show reporting freezes provider payout and opens support for the other party', async () => {
  await db.query(`update feature_flags set enabled=true where key=$1::text`, ['home_no_show_reporting']);
  const bookingId = await insertBooking(fixtures[6], 'en_route', '2027-02-14');
  await setBookingScheduledAtInPast(bookingId, 45);
  await db.query(`
    insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
    values ($1::uuid, 'visit_fee', $2::int, 'paid', $3::text, now())
  `, [bookingId, 10000, `h3-no-show-payment-${bookingId}`]);
  await as(null, 'service_role', `
    select public._create_payout($1::uuid, $2::int, $3::int, $4::timestamptz)
  `, [bookingId, 10000, 10000, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()]);
  await as(fixtures[6].customer, 'authenticated', `
    select report_no_show($1::uuid, $2::text)
  `, [bookingId, 'provider']);
  const booking = await one(`select status::text status from bookings where id=$1::uuid`, [bookingId]);
  const payout = await one(`
    select status::text status, gross, commission, gst_on_commission, amount
      from payouts where booking_id=$1::uuid`,
  [bookingId]);
  const transfers = (await db.query(`
    select t.status::text status, t.last_error
      from payout_transfers t
     where t.payout_id in (select p.id from payouts p where p.booking_id=$1::uuid)
  `, [bookingId])).rows;
  const support = await one(`
    select t.user_id, t.booking_id, t.status, t.last_message,
           (select count(*)::int from support_messages m where m.thread_id=t.id) message_count
      from support_threads t
     where t.booking_id=$1::uuid`,
  [bookingId]);
  const actual = { booking, payout, transfers, support };
  ok(booking.status === 'disputed'
    && payout.status === 'frozen'
    && payout.gross === 10000
    && payout.commission === 1200
    && payout.gst_on_commission === 216
    && payout.amount === 8584
    && transfers.every((row) => row.status === 'failed' && row.last_error === 'dispute: release frozen')
    && support.user_id === fixtures[6].customer
    && support.status === 'open'
    && /provider/i.test(support.last_message)
    && support.message_count === 1,
  `customer no-show report disputes the booking, freezes exact payout, and opens support: ${JSON.stringify(actual)}`);
});

await scenario('provider can report a customer no-show and unrelated users cannot report', async () => {
  const providerBookingId = await insertBooking(fixtures[7], 'accepted', '2027-02-15');
  await setBookingScheduledAtInPast(providerBookingId, 180);
  await as(fixtures[7].provider, 'authenticated', `
    select report_no_show($1::uuid, $2::text)
  `, [providerBookingId, 'customer']);
  const providerState = await one(`select status::text status from bookings where id=$1::uuid`, [providerBookingId]);
  const providerSupport = await one(`
    select user_id, last_message
      from support_threads
     where booking_id=$1::uuid`,
  [providerBookingId]);

  const unauthorizedBookingId = await insertBooking(fixtures[10], 'accepted', '2027-02-13');
  const unauthorized = await failMessage(() => as(actors[1].customer, 'authenticated', `
    select report_no_show($1::uuid, $2::text)
  `, [unauthorizedBookingId, 'provider']));
  const unauthorizedState = await one(`select status::text status from bookings where id=$1::uuid`, [unauthorizedBookingId]);
  const actual = { providerState, providerSupport, unauthorized, unauthorizedState };
  ok(providerState.status === 'disputed'
    && providerSupport.user_id === fixtures[7].provider
    && /customer/i.test(providerSupport.last_message)
    && /only the booking customer or provider/i.test(unauthorized ?? '')
    && unauthorizedState.status === 'accepted',
  `provider reports the absent customer; an unrelated user cannot change another booking: ${JSON.stringify(actual)}`);
});

await scenario('no-show is refused before the configured scheduled grace period', async () => {
  await db.query(`update feature_flags set enabled=true where key=$1::text`, ['home_no_show_reporting']);
  await as(ADMIN, 'authenticated', `
    select admin_set_home_booking_safety_rules($1::int, $2::int)
  `, [48, 60]);
  const bookingId = await insertBooking(fixtures[8], 'accepted', '2027-02-16');
  await setBookingScheduledAtInPast(bookingId, 45);
  const error = await failMessage(() => as(fixtures[8].customer, 'authenticated', `
    select report_no_show($1::uuid, $2::text)
  `, [bookingId, 'provider']));
  const state = await one(`select status::text status from bookings where id=$1::uuid`, [bookingId]);
  const rules = (await as(ADMIN, 'authenticated', `
    select admin_get_home_booking_safety_rules() rules
  `))[0].rules;
  await as(ADMIN, 'authenticated', `
    select admin_set_home_booking_safety_rules($1::int, $2::int)
  `, [48, 30]);
  const actual = { error, state, configuredGraceMinutes: rules.no_show_grace_minutes };
  ok(/scheduled time/i.test(error ?? '')
    && state.status === 'accepted'
    && rules.no_show_grace_minutes === 60,
  `no-show cutoff uses the admin-configured grace and leaves early booking unchanged: ${JSON.stringify(actual)}`);
});

finish();

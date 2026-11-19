import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const migration = (file) =>
  fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}[a-z]?_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 75)
  .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
if (!migrationFiles.includes('0075_f2_commission_correctness.sql')) {
  throw new Error('full migration chain is missing 0075_f2_commission_correctness.sql');
}

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create schema if not exists extensions;
  create type extensions.geography as (lng float8, lat float8);
  create type extensions.geometry as (lng float8, lat float8);
  create function extensions.st_makepoint(x float8, y float8) returns extensions.geography
    language sql immutable as $$ select row(x, y)::extensions.geography $$;
  create function extensions.st_setsrid(g extensions.geography, srid int) returns extensions.geography
    language sql immutable as $$ select g $$;
  create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8
    language sql immutable as $$
      select 2 * 6371000 * asin(sqrt(power(sin(radians(b.lat - a.lat) / 2), 2)
        + cos(radians(a.lat)) * cos(radians(b.lat))
        * power(sin(radians(b.lng - a.lng) / 2), 2)))
    $$;
  create function extensions.st_dwithin(a extensions.geography, b extensions.geography, d float8)
    returns boolean language sql immutable as $$ select extensions.st_distance(a, b) <= d $$;
  create function extensions.geog_to_geom(g extensions.geography) returns extensions.geometry
    language sql immutable as $$ select row(g.lng, g.lat)::extensions.geometry $$;
  create cast (extensions.geography as extensions.geometry)
    with function extensions.geog_to_geom(extensions.geography);
  create function extensions.st_x(g extensions.geometry) returns float8
    language sql immutable as $$ select g.lng $$;
  create function extensions.st_y(g extensions.geometry) returns float8
    language sql immutable as $$ select g.lat $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, extensions to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    instance_id uuid, id uuid primary key, aud text, role text, phone text,
    phone_confirmed_at timestamptz, raw_app_meta_data jsonb default '{}',
    raw_user_meta_data jsonb default '{}', created_at timestamptz, updated_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant select, insert, delete on storage.objects to authenticated, anon, service_role;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

for (const file of migrationFiles) await db.exec(migration(file));
await db.exec("set timezone = 'UTC'");

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const json = (value) => typeof value === 'string' ? JSON.parse(value) : value;
const check = (condition, label, actual) =>
  ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
async function fails(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error.message;
  }
}

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

async function createFixture(index, archetype, packagePrice) {
  const customer = uuid(index * 10 + 1);
  const provider = uuid(index * 10 + 2);
  const manager = uuid(index * 10 + 3);
  const city = `F2 Commission City ${index}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $4::text, '{}'::jsonb), ($2::uuid, $5::text, '{}'::jsonb),
           ($3::uuid, $6::text, '{}'::jsonb)`,
  [customer, provider, manager, `+9199100${String(index).padStart(4, '0')}`,
    `+9199101${String(index).padStart(4, '0')}`, `+9199102${String(index).padStart(4, '0')}`]);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended, created_at, jobs_completed
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', now(), 'approved', true, false, false, now() - interval '90 days', 0
    )`, [provider, city]);
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values ($1::uuid, $2::uuid, 'manager', true)`, [provider, manager]);
  const categoryId = (await one(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::text, $2::text, 'quote', true, $3::text, '{}'::jsonb, 1, 365,
      true, array['daily','alternate_days','weekly','monthly','custom']::text[], 0
    ) returning id`, [`f2-commission-${index}`, `F2 service ${index}`, archetype])).id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())`, [categoryId, city]);
  const serviceId = (await one(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0, $3::int, true) returning id`,
  [provider, categoryId, packagePrice])).id;
  const addressId = (await one(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Home', 'F2 test address', $2::text, 16.50, 80.60) returning id`,
  [customer, city])).id;
  await db.query(`
    insert into public.provider_availability (provider_id, weekday, start_time, end_time)
    select $1::uuid, day, time '00:00', time '23:59'
      from generate_series(0, 6) day`, [provider]);
  const packageId = (await one(`
    insert into public.service_packages (
      provider_service_id, title, description, price_type, price, price_min, price_max,
      unit, qty_min, qty_max, duration_min, active
    ) values (
      $1::uuid, $2::text, '', 'fixed', $3::int, $3::int, $3::int,
      'visit', 1, 1, 60, true
    ) returning id`, [serviceId, `F2 package ${index}`, packagePrice])).id;
  await db.query(`
    insert into public.app_config (key, value)
    values ('archetype_flags', '{"fixed":true,"time_based":true,"proposal":true}'::jsonb)
    on conflict (key) do update set value = public.app_config.value || excluded.value`);
  await db.query(`
    update public.feature_flags set enabled = true
     where key in (
       'recurring_bookings', 'recurring_skip_pause', 'recurring_reschedule',
       'recurring_plan_acceptance', 'recurring_reminders', 'recurring_prepaid_packages',
       'recurring_billing', 'merchant_staff'
     )`);
  return { customer, provider, manager, city, categoryId, serviceId, addressId, packageId, archetype };
}

function planInput(fixture, date) {
  return {
    provider_service_id: fixture.serviceId,
    package_id: fixture.packageId,
    archetype: fixture.archetype,
    frequency: 'custom',
    interval_count: 1,
    weekdays: [],
    month_day: null,
    custom_dates: [date],
    start_date: date,
    end_date: null,
    max_occurrences: 1,
    start_time: '10:00',
    duration_min: fixture.archetype === 'time_based' ? 60 : null,
    package_qty: 1,
    billing_frequency: 'per_visit',
    address_id: fixture.addressId,
    description: 'F2 commission regression',
  };
}

async function createOccurrence(fixture, date, tag) {
  const planId = (await as(fixture.customer, 'authenticated',
    `select public.create_recurring_plan($1::jsonb) id`, [JSON.stringify(planInput(fixture, date))]))[0].id;
  await as(fixture.manager, 'authenticated',
    `select public.respond_recurring_plan($1::uuid, true, null)`, [planId]);
  await as(null, 'service_role',
    `select public.materialize_recurring_schedule($1::uuid, $2::date) count`, [planId, date]);
  const booking = await one(`
    select id, approved_quote_id from public.bookings where recurring_schedule_id = $1::uuid`,
  [planId]);
  const quoteId = fixture.archetype === 'fixed'
    ? (await one(`select id from public.quotes where booking_id = $1::uuid`, [booking.id])).id
    : null;
  const sessionScheduleId = fixture.archetype === 'time_based'
    ? (await one(`
        select id from public.payment_schedule
         where booking_id = $1::uuid and label = 'Session service'`, [booking.id])).id
    : null;
  const amount = (await one(`
    select coalesce(sum(amount), 0)::int amount
      from public.payment_schedule
     where booking_id = $1::uuid and status = 'due'`, [booking.id])).amount;
  const linkId = `f2-link-${tag}`;
  await db.query(`
    insert into public.payments (booking_id, quote_id, schedule_id, purpose, amount, status, razorpay_link_id)
    values ($1::uuid, $2::uuid, $3::uuid, $4::public.payment_purpose, $5::int, 'created', $6::text)`,
  [booking.id, quoteId, sessionScheduleId, fixture.archetype === 'fixed' ? 'fixed' : 'session', amount, linkId]);
  const paymentId = (await one(`
    select id from public.payments where razorpay_link_id = $1::text`, [linkId])).id;
  await db.query(`
    insert into public.payment_obligations (payment_id, schedule_id, amount)
    select $1::uuid, ps.id, ps.amount
      from public.payment_schedule ps
     where ps.booking_id = $2::uuid and ps.status = 'due'`,
  [paymentId, booking.id]);
  if (fixture.archetype === 'fixed') {
    await as(null, 'service_role',
      `select public.record_payment_paid($1::text, $2::text, $3::int)`,
      [linkId, `pay_f2_fixed_${tag}`, amount]);
  } else {
    await as(null, 'service_role',
      `select public.record_session_payment_paid($1::text, $2::text, $3::int)`,
      [linkId, `pay_f2_session_${tag}`, amount]);
  }
  const currentBooking = await one(`
    select approved_quote_id from public.bookings where id = $1::uuid`, [booking.id]);
  return { id: booking.id, approvedQuoteId: currentBooking.approved_quote_id, paymentId, amount, planId };
}

async function moveToInProgress(fixture, bookingId) {
  let { status } = await one(`
    select status::text status from public.bookings where id = $1::uuid`, [bookingId]);
  if (status === 'requested') {
    await as(null, 'service_role',
      `select public._set_status($1::uuid, $2::public.booking_status, $3::uuid, $4::text)`,
      [bookingId, 'accepted', fixture.provider, 'F2 fixture acceptance']);
    status = 'accepted';
  }
  if (status === 'accepted' && fixture.archetype === 'fixed') {
    await as(null, 'service_role',
      `select public._set_status($1::uuid, $2::public.booking_status, $3::uuid, $4::text)`,
      [bookingId, 'en_route', fixture.provider, 'F2 fixture en route']);
    status = 'en_route';
  }
  if (status !== 'in_progress') {
    await as(null, 'service_role',
      `select public._set_status($1::uuid, $2::public.booking_status, $3::uuid, $4::text)`,
      [bookingId, 'in_progress', fixture.provider, 'F2 fixture started']);
  }
}

async function payFixedAddon(fixture, bookingId, quoteId, tag) {
  const amount = (await one(`
    select coalesce(sum(amount), 0)::int amount
      from public.payment_schedule
     where booking_id = $1::uuid and quote_id = $2::uuid and status = 'due'`,
  [bookingId, quoteId])).amount;
  const linkId = `f2-addon-link-${tag}`;
  await db.query(`
    insert into public.payments (booking_id, quote_id, purpose, amount, status, razorpay_link_id)
    values ($1::uuid, $2::uuid, 'fixed'::public.payment_purpose, $3::int, 'created', $4::text)`,
  [bookingId, quoteId, amount, linkId]);
  const paymentId = (await one(`
    select id from public.payments where razorpay_link_id = $1::text`, [linkId])).id;
  await db.query(`
    insert into public.payment_obligations (payment_id, schedule_id, amount)
    select $1::uuid, ps.id, ps.amount
      from public.payment_schedule ps
     where ps.booking_id = $2::uuid and ps.quote_id = $3::uuid and ps.status = 'due'`,
  [paymentId, bookingId, quoteId]);
  await as(null, 'service_role',
    `select public.record_payment_paid($1::text, $2::text, $3::int)`,
    [linkId, `pay_f2_addon_${tag}`, amount]);
  return amount;
}

async function requestCompletion(fixture, bookingId) {
  await as(null, 'service_role',
    `select public._set_status($1::uuid, $2::public.booking_status, $3::uuid, $4::text)`,
    [bookingId, 'completion_requested', fixture.provider, 'F2 fixture completion request']);
}

await scenario('WS6-T03 recurring fixed occurrence stores package subtotal and settles at its snapshot rate', async () => {
  const fixture = await createFixture(1, 'fixed', 99900);
  const occurrence = await createOccurrence(fixture, '2027-02-10', 'fixed');
  await moveToInProgress(fixture, occurrence.id);
  const addonQuoteId = (await as(fixture.manager, 'authenticated', `
    select public.send_fixed_addons(
      $1::uuid, $2::jsonb, $3::text
    ) id`, [
      occurrence.id,
      JSON.stringify([{ title: 'Extra polish', qty: 1, unit_price: 10000 }]),
      'F2 fixed add-on',
    ]))[0].id;
  const addon = await one(`
    select q.subtotal_commissionable, q.total, q.subtotal_other,
           array_agg(qi.kind::text order by qi.kind::text) item_kinds
      from public.quotes q
      join public.quote_items qi on qi.quote_id = q.id
     where q.id = $1::uuid
     group by q.id`, [addonQuoteId]);
  const approval = json((await as(fixture.customer, 'authenticated', `
    select public.approve_fixed_change_order($1::uuid, $2::uuid) result`,
  [occurrence.id, addonQuoteId]))[0].result);
  const addonPayment = await payFixedAddon(fixture, occurrence.id, addonQuoteId, 'fixed');
  const currentBooking = await one(`
    select approved_quote_id from public.bookings where id = $1::uuid`, [occurrence.id]);
  const before = await one(`
    select b.commission_bp_snapshot, q.subtotal_commissionable,
           q.total, q.subtotal_other
      from public.bookings b
      join public.quotes q on q.id = b.approved_quote_id
     where b.id = $1::uuid`, [occurrence.id]);
  await db.query(`
    update public.app_config
       set value = jsonb_set(
         value,
         '{fixed,tiers}',
         '[{"min_jobs":0,"bp":700}]'::jsonb,
         true
       )
     where key = 'commission'`);
  await requestCompletion(fixture, occurrence.id);
  await as(null, 'service_role',
    `select public._finalize_completion($1::uuid, $2::uuid, $3::text)`,
    [occurrence.id, fixture.customer, 'F2 fixed recurring test']);
  const payout = await one(`
    select p.gross, p.commission, p.gst_on_commission, p.amount,
           b.commission_bp_snapshot
      from public.payouts p
      join public.bookings b on b.id = p.booking_id
     where p.booking_id = $1::uuid`, [occurrence.id]);
  const preview = (await as(fixture.provider, 'authenticated', `
    select commissionable, commission_bp, commission, gst_on_commission, payout
      from public.get_quote_settlement_preview($1::uuid)`, [currentBooking.approved_quote_id]))[0];
  const customerPreview = await as(fixture.customer, 'authenticated', `
    select * from public.get_quote_settlement_preview($1::uuid)`, [currentBooking.approved_quote_id]);
  await db.query(`update public.providers set jobs_completed = 50 where id = $1::uuid`, [fixture.provider]);
  const tier50 = (await as(null, 'service_role', `
    select public._commission_bp($1::uuid, $2::uuid, $3::uuid, now()::timestamptz) rate`,
  [fixture.provider, fixture.customer, occurrence.id]))[0].rate;
  await db.query(`update public.providers set jobs_completed = 200 where id = $1::uuid`, [fixture.provider]);
  const tier200 = (await as(null, 'service_role', `
    select public._commission_bp($1::uuid, $2::uuid, $3::uuid, now()::timestamptz) rate`,
  [fixture.provider, fixture.customer, occurrence.id]))[0].rate;
  await db.query(`
    update public.app_config
       set value = jsonb_set(
         value,
         '{fixed,tiers}',
         '[{"min_jobs":200,"bp":1200},{"min_jobs":50,"bp":1300},{"min_jobs":0,"bp":1500}]'::jsonb,
         true
       )
     where key = 'commission'`);
  const actual = {
    addon, approval, addonPayment, before, payout, preview, customerPreview,
    tier50, tier200, basePayment: occurrence.amount,
  };
  check(before.commission_bp_snapshot === 1500
    && addon.subtotal_commissionable === 109900
    && addon.total === 109900
    && addon.subtotal_other === 109900
    && addon.item_kinds.includes('package')
    && addon.item_kinds.includes('addon')
    && Number(approval.amount_due) === 10000
    && addonPayment === 10000
    && before.subtotal_commissionable === 109900
    && before.total === 109900
    && before.subtotal_other === 109900
    && payout.gross === 109900
    && payout.commission === 16485
    && payout.gst_on_commission === 2967
    && payout.amount === 90448
    && payout.commission_bp_snapshot === 1500
    && preview.commissionable === 109900
    && preview.commission_bp === 1500
    && preview.commission === payout.commission
    && preview.gst_on_commission === payout.gst_on_commission
    && preview.payout === payout.amount
    && customerPreview.length === 0
    && tier50 === 1300
    && tier200 === 1200,
  'recurring fixed package and add-on commission, GST, payout, and snapshot use exact paise', actual);
});

await scenario('WS6-T11 session completion uses the stored commission snapshot after config changes', async () => {
  const fixture = await createFixture(2, 'time_based', 180000);
  const occurrence = await createOccurrence(fixture, '2027-02-11', 'session');
  const snapshot = await one(`
    select commission_bp_snapshot from public.bookings where id = $1::uuid`, [occurrence.id]);
  await db.query(`
    update public.app_config
       set value = jsonb_set(value, '{time_based,recurring_bp}', '200'::jsonb, true)
     where key = 'commission'`);
  await moveToInProgress(fixture, occurrence.id);
  await requestCompletion(fixture, occurrence.id);
  await as(null, 'service_role',
    `select public._finalize_session_completion($1::uuid, $2::uuid)`,
    [occurrence.id, fixture.customer]);
  const payout = await one(`
    select p.gross, p.commission, p.gst_on_commission, p.amount,
           b.commission_bp_snapshot
      from public.payouts p
      join public.bookings b on b.id = p.booking_id
     where p.booking_id = $1::uuid`, [occurrence.id]);
  const actual = { snapshot, payout };
  check(snapshot.commission_bp_snapshot === 800
    && payout.gross === 180000
    && payout.commission === 14400
    && payout.gst_on_commission === 2592
    && payout.amount === 163008
    && payout.commission_bp_snapshot === 800,
  'session payout uses the payment-time 800 bp snapshot after config changes; exact paise', actual);
});

await scenario('WS6-T03 inspect quote keeps the documented 193760 paise payout and rejects discount lines', async () => {
  const fixture = await createFixture(3, 'inspect_quote', 50000);
  const bookingId = (await one(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, service_window, status, visit_fee, platform_fee,
      total_amount, archetype, location_mode, booking_origin
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      'F2 inspect commission fixture', now() + interval '10 days',
      tstzrange(now() + interval '10 days', now() + interval '10 days 4 hours', '[)'),
      'inspecting', 19900, 2900, 19900, 'inspect_quote', 'at_customer', 'marketplace'
    ) returning id`,
  [fixture.customer, fixture.provider, fixture.categoryId, fixture.serviceId, fixture.addressId])).id;
  const discountError = await fails(() => as(fixture.manager, 'authenticated', `
    select public.send_quote($1::uuid, $2::jsonb, null::text)`,
  [bookingId, JSON.stringify([{ kind: 'discount', title: 'Discount', qty: 1, unit_price: 100 }])]));
  const quoteId = (await as(fixture.manager, 'authenticated', `
    select public.send_quote($1::uuid, $2::jsonb, null::text) id`,
  [bookingId, JSON.stringify([
    { kind: 'labour', title: 'Labour', qty: 1, unit_price: 150000 },
    { kind: 'part', title: 'Part', qty: 1, unit_price: 65000 },
  ])]))[0].id;
  await db.query(`update public.quotes set status = 'approved' where id = $1::uuid`, [quoteId]);
  await db.query(`
    update public.app_config
       set value = jsonb_set(
         value,
         '{tiers}',
         '[{"min_jobs":200,"bp":600},{"min_jobs":50,"bp":800},{"min_jobs":0,"bp":700}]'::jsonb,
         true
       )
     where key = 'commission'`);
  await db.query(`
    update public.bookings
       set approved_quote_id = $1::uuid, status = 'completion_requested', total_amount = 217900
     where id = $2::uuid`,
  [quoteId, bookingId]);
  await db.query(`
    insert into public.payments (
      booking_id, quote_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at
    ) values ($1::uuid, $2::uuid, 'balance', $3::int, 'paid', 'f2-inspect-link', 'pay_f2_inspect', now())`,
  [bookingId, quoteId, 217900]);
  await as(null, 'service_role',
    `select public._finalize_completion($1::uuid, $2::uuid, $3::text)`,
    [bookingId, fixture.customer, 'F2 inspect quote regression']);
  const actual = await one(`
    select q.subtotal_commissionable, p.gross, p.commission,
           p.gst_on_commission, p.amount, b.commission_bp_snapshot
      from public.quotes q
      join public.payouts p on p.booking_id = q.booking_id
      join public.bookings b on b.id = q.booking_id
     where q.id = $1::uuid`, [quoteId]);
  check(/quote item kind is not allowed/i.test(discountError ?? '')
    && actual.subtotal_commissionable === 150000
    && actual.gross === 215000
    && actual.commission === 18000
    && actual.gst_on_commission === 3240
    && actual.amount === 193760
    && actual.commission_bp_snapshot === 1200,
  'inspect quote commission and payout remain exact; discount is rejected', { discountError, actual });
});

await scenario('WS6-T03 create_fixed_booking snapshots and commissions the package at 1500 bp', async () => {
  const fixture = await createFixture(5, 'fixed', 99900);
  const bookingId = (await as(fixture.customer, 'authenticated', `
    select public.create_fixed_booking(
      $1::uuid,
      1::numeric,
      tstzrange($2::timestamptz, $3::timestamptz, '[)'),
      $4::jsonb,
      '{}'::jsonb
    ) id`,
  [fixture.packageId, '2027-03-26T10:00:00.000Z', '2027-03-26T12:00:00.000Z',
    JSON.stringify({ mode: 'at_customer', address_id: fixture.addressId })]))[0].id;
  const quoteId = (await one(`select id from public.quotes where booking_id = $1::uuid`, [bookingId])).id;
  const amount = (await one(`
    select coalesce(sum(amount), 0)::int amount
      from public.payment_schedule where booking_id = $1::uuid and status = 'due'`,
  [bookingId])).amount;
  const linkId = 'f2-create-fixed-link';
  await db.query(`
    insert into public.payments (booking_id, quote_id, purpose, amount, status, razorpay_link_id)
    values ($1::uuid, $2::uuid, 'fixed'::public.payment_purpose, $3::int, 'created', $4::text)`,
  [bookingId, quoteId, amount, linkId]);
  const paymentId = (await one(`
    select id from public.payments where razorpay_link_id = $1::text`, [linkId])).id;
  await db.query(`
    insert into public.payment_obligations (payment_id, schedule_id, amount)
    select $1::uuid, ps.id, ps.amount from public.payment_schedule ps
     where ps.booking_id = $2::uuid and ps.status = 'due'`,
  [paymentId, bookingId]);
  await as(null, 'service_role',
    `select public.record_payment_paid($1::text, $2::text, $3::int)`,
    [linkId, 'pay_f2_create_fixed', amount]);
  await moveToInProgress(fixture, bookingId);
  await requestCompletion(fixture, bookingId);
  await as(null, 'service_role',
    `select public._finalize_completion($1::uuid, $2::uuid, $3::text)`,
    [bookingId, fixture.customer, 'F2 fixed booking commission regression']);
  const actual = await one(`
    select q.subtotal_commissionable, qi.kind::text item_kind,
           b.commission_bp_snapshot, p.gross, p.commission,
           p.gst_on_commission, p.amount
      from public.quotes q
      join public.quote_items qi on qi.quote_id = q.id
      join public.bookings b on b.id = q.booking_id
      join public.payouts p on p.booking_id = b.id
     where q.id = $1::uuid`, [quoteId]);
  check(actual.subtotal_commissionable === 99900
    && actual.item_kind === 'package'
    && actual.commission_bp_snapshot === 1500
    && actual.gross === 99900
    && actual.commission === 14985
    && actual.gst_on_commission === 2697
    && actual.amount === 82218,
  'fixed booking package commission, GST, payout, and snapshot use exact paise', actual);
});

await scenario('WS5-T03 proposal commission uses commissionable items, the 500000 paise cap, and owner D1 rates', async () => {
  const fixture = await createFixture(4, 'proposal', 10000000);
  await db.query(`
    update public.categories
       set intake_schema = '{"type":"object","properties":{"brief":{"type":"string"}},"required":["brief"]}'::jsonb
     where id = $1::uuid`, [fixture.categoryId]);
  const eventStart = '2027-03-25T10:00:00.000Z';
  const eventEnd = '2027-03-25T14:00:00.000Z';
  const requestId = (await as(fixture.customer, 'authenticated', `
    select public.create_service_request(
      $1::uuid, $2::text, 'F2 event area', $3::timestamptz, $4::timestamptz,
      $5::jsonb, $6::int, $7::int, $8::uuid, null::uuid
    ) id`,
  [fixture.categoryId, fixture.city, eventStart, eventEnd, JSON.stringify({ brief: 'F2 commission project' }),
    10000000, 20000000, fixture.addressId]))[0].id;
  const badProposalError = await fails(() => as(fixture.provider, 'authenticated', `
    select public.send_proposal(
      $1::uuid, $2::jsonb, $3::jsonb, now() + interval '2 days', null::text, '[]'::jsonb
    )`,
  [requestId, JSON.stringify([{ kind: 'discount', title: 'Discount', qty: 1, unit_price: 100 }]),
    JSON.stringify([{ label: 'Advance', amount: 100, due_rule: 'at_booking' }])]));
  const proposalId = (await as(fixture.provider, 'authenticated', `
    select public.send_proposal(
      $1::uuid, $2::jsonb, $3::jsonb, now() + interval '2 days', null::text, '[]'::jsonb
    ) id`,
  [requestId, JSON.stringify([
    { kind: 'package', title: 'Project service', qty: 1, unit_price: 10000000 },
    { kind: 'material', title: 'Materials pass-through', qty: 1, unit_price: 2000000 },
  ]), JSON.stringify([{ label: 'Advance', amount: 12000000, due_rule: 'at_booking' }])]))[0].id;
  const bookingId = (await as(fixture.customer, 'authenticated', `
    select public.accept_proposal($1::uuid, $2::uuid) id`,
  [proposalId, fixture.addressId]))[0].id;
  const quote = await one(`
    select q.id, q.subtotal_commissionable, q.total, b.commission_bp_snapshot
      from public.quotes q
      join public.bookings b on b.approved_quote_id = q.id
     where b.id = $1::uuid`, [bookingId]);
  const due = (await one(`
    select coalesce(sum(amount), 0)::int amount
      from public.payment_schedule
     where booking_id = $1::uuid and status = 'due'`, [bookingId])).amount;
  const linkId = 'f2-proposal-link';
  await db.query(`
    insert into public.payments (booking_id, quote_id, purpose, amount, status, razorpay_link_id)
    values ($1::uuid, $2::uuid, 'advance'::public.payment_purpose, $3::int, 'created', $4::text)`,
  [bookingId, quote.id, due, linkId]);
  const paymentId = (await one(`
    select id from public.payments where razorpay_link_id = $1::text`, [linkId])).id;
  await db.query(`
    insert into public.payment_obligations (payment_id, schedule_id, amount)
    select $1::uuid, ps.id, ps.amount
      from public.payment_schedule ps
     where ps.booking_id = $2::uuid and ps.status = 'due'`,
  [paymentId, bookingId]);
  await as(null, 'service_role',
    `select public.record_payment_paid($1::text, $2::text, $3::int)`,
    [linkId, 'pay_f2_proposal', due]);
  await db.query(`
    update public.bookings set status = 'completion_requested' where id = $1::uuid`,
  [bookingId]);
  await as(null, 'service_role',
    `select public._finalize_completion($1::uuid, $2::uuid, $3::text)`,
    [bookingId, fixture.customer, 'F2 proposal commission regression']);
  const payout = await one(`
    select q.subtotal_commissionable, b.commission_bp_snapshot,
           p.gross, p.commission, p.gst_on_commission, p.amount
      from public.bookings b
      join public.quotes q on q.id = b.approved_quote_id
      join public.payouts p on p.booking_id = b.id
     where b.id = $1::uuid`, [bookingId]);
  const preview = (await as(fixture.provider, 'authenticated', `
    select commissionable, commission_bp, commission, gst_on_commission, payout
      from public.get_quote_settlement_preview($1::uuid)`, [quote.id]))[0];
  const priorBookingId = uuid(499);
  await db.query(`
    insert into public.bookings (
      id, customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, service_window, status, visit_fee, platform_fee,
      total_amount, archetype, location_mode, booking_origin, completed_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
      'F2 repeat booking fixture', now() - interval '31 days',
      tstzrange(now() - interval '31 days', now() - interval '30 days', '[)'),
      'completed', 0, 0, 1, 'proposal', 'remote', 'marketplace', now() - interval '30 days'
    )`,
  [priorBookingId, fixture.customer, fixture.provider, fixture.categoryId, fixture.serviceId, fixture.addressId]);
  const repeatRate = (await as(null, 'service_role', `
    select public._commission_bp($1::uuid, $2::uuid, $3::uuid, now()::timestamptz) rate`,
  [fixture.provider, fixture.customer, bookingId]))[0].rate;
  await db.query(`
    update public.providers set created_at = now() - interval '1 day' where id = $1::uuid`,
  [fixture.provider]);
  const foundingRate = (await as(null, 'service_role', `
    select public._commission_bp($1::uuid, $2::uuid, $3::uuid, now()::timestamptz) rate`,
  [fixture.provider, fixture.customer, bookingId]))[0].rate;
  const actual = { badProposalError, quote, due, payout, preview, repeatRate, foundingRate };
  check(/discount proposal items are not allowed/i.test(badProposalError ?? '')
    && quote.subtotal_commissionable === 10000000
    && quote.total === 12000000
    && quote.commission_bp_snapshot === 800
    && payout.gross === 12000000
    && payout.commission === 500000
    && payout.gst_on_commission === 90000
    && payout.amount === 11410000
    && preview.commissionable === 10000000
    && preview.commission_bp === 800
    && preview.commission === 500000
    && preview.gst_on_commission === 90000
    && preview.payout === 11410000
    && repeatRate === 500
    && foundingRate === 0,
  'proposal commission, cap, repeat discount, founding period, and preview use exact paise', actual);
});

await scenario('WS5-T03 a 1200000 paise proposal receives 96000 commission and 17280 GST', async () => {
  const fixture = await createFixture(7, 'proposal', 1200000);
  const bookingId = (await one(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, service_window, status, visit_fee, platform_fee,
      total_amount, archetype, location_mode, booking_origin
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      'F2 uncapped proposal fixture', '2027-04-15T10:00:00Z'::timestamptz,
      tstzrange('2027-04-15T10:00:00Z'::timestamptz, '2027-04-15T14:00:00Z'::timestamptz, '[)'),
      'completion_requested', 0, 12000, 1212000, 'proposal', 'remote', 'marketplace'
    ) returning id`,
  [fixture.customer, fixture.provider, fixture.categoryId, fixture.serviceId, fixture.addressId])).id;
  await db.query(`
    update public.bookings
       set commission_bp_snapshot = public._booking_commission_bp($1::uuid, now())
     where id = $1::uuid`, [bookingId]);
  const quoteId = (await one(`
    insert into public.quotes (
      booking_id, version, status, is_change_order, subtotal_other,
      subtotal_commissionable, total, note
    ) values (
      $1::uuid, 1, 'approved', false, 1200000, 1200000, 1200000, 'F2 proposal rate sample'
    ) returning id`, [bookingId])).id;
  await db.query(`
    update public.bookings set approved_quote_id = $1::uuid where id = $2::uuid`,
  [quoteId, bookingId]);
  await db.query(`
    insert into public.quote_items (quote_id, kind, title, qty, unit_price)
    values ($1::uuid, 'package', 'Proposal service', 1, 1200000)`, [quoteId]);
  await db.query(`
    insert into public.payments (
      booking_id, quote_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at
    ) values (
      $1::uuid, $2::uuid, 'advance'::public.payment_purpose, 1212000,
      'paid', 'f2-uncapped-proposal-link', 'pay_f2_uncapped_proposal', now()
    )`, [bookingId, quoteId]);
  await as(null, 'service_role',
    `select public._finalize_completion($1::uuid, $2::uuid, $3::text)`,
    [bookingId, fixture.customer, 'F2 uncapped proposal sample']);
  const actual = await one(`
    select b.commission_bp_snapshot, p.gross, p.commission,
           p.gst_on_commission, p.amount
      from public.bookings b
      join public.payouts p on p.booking_id = b.id
     where b.id = $1::uuid`, [bookingId]);
  check(actual.commission_bp_snapshot === 800
    && actual.gross === 1200000
    && actual.commission === 96000
    && actual.gst_on_commission === 17280
    && actual.amount === 1086720,
  'uncapped proposal settlement matches the 8 percent sample in exact paise', actual);
});

await scenario('WS5-T03 commission rates and proposal cap remain admin-managed and authorization-checked', async () => {
  const fixture = await createFixture(6, 'inspect_quote', 50000);
  await db.query(`
    insert into public.admins (user_id) values ($1::uuid) on conflict (user_id) do nothing`,
  [fixture.manager]);
  const current = json((await one(`select value from public.app_config where key = 'commission'`)).value);
  const next = {
    ...current,
    fixed: {
      tiers: [
        { min_jobs: 200, bp: 1200 },
        { min_jobs: 50, bp: 1300 },
        { min_jobs: 0, bp: 1500 },
      ],
    },
    proposal: { bp: 700, cap_paise: 400000 },
  };
  const updated = json((await as(fixture.manager, 'authenticated', `
    select public.admin_set_commission($1::jsonb) value`, [JSON.stringify(next)]))[0].value);
  const unauthorized = await fails(() => as(fixture.customer, 'authenticated', `
    select public.admin_set_commission($1::jsonb)`, [JSON.stringify(next)]));
  const actual = { fixed: updated.fixed, proposal: updated.proposal, unauthorized };
  check(updated.fixed.tiers[2].bp === 1500
    && updated.proposal.bp === 700
    && updated.proposal.cap_paise === 400000
    && /admin only/i.test(unauthorized ?? ''),
  'commission rates stay validated, admin-managed, and unauthorized writes are rejected', actual);
});

await db.close();
finish();

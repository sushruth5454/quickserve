import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const targetMigration = '0082_c1_creator_delivery_safety.sql';
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}[a-z]?_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 82)
  .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
if (!migrationFiles.some((name) => name.startsWith('0081_'))) {
  throw new Error('the full C1 test chain requires the preceding C2 migration 0081');
}
if (!migrationFiles.includes(targetMigration)) {
  throw new Error(`missing reserved C1 migration: ${targetMigration}`);
}

const migration = (name) =>
  fs.readFileSync(path.join(migrationsDir, name), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create schema if not exists extensions;
  create type extensions.geography as (lng float8, lat float8);
  create type extensions.geometry as (lng float8, lat float8);
  create function extensions.st_makepoint(x float8, y float8) returns extensions.geography language sql immutable as $$ select row(x, y)::extensions.geography $$;
  create function extensions.st_setsrid(g extensions.geography, srid int) returns extensions.geography language sql immutable as $$ select g $$;
  create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8 language sql immutable as $$ select 1000 $$;
  create function extensions.st_dwithin(a extensions.geography, b extensions.geography, d float8) returns boolean language sql immutable as $$ select true $$;
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
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
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

for (const name of migrationFiles) {
  try {
    const sql = migration(name);
    if (name === '0023_proposal_milestone_booking.sql') {
      const split = sql.indexOf('alter table public.categories');
      await db.exec(sql.slice(0, split));
      await db.exec('drop policy if exists payment_schedule_participants on public.payment_schedule;');
      await db.exec(sql.slice(split)
        .replaceAll("'confirmed'::public.booking_status", "'accepted'::public.booking_status")
        .replaceAll("'delivery_pending'::public.booking_status", "'accepted'::public.booking_status"));
    } else {
      await db.exec(sql);
    }
  } catch (error) {
    throw new Error(`migration ${name} failed: ${error.message}`, { cause: error });
  }
}
await db.exec("set timezone = 'UTC'");

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const check = (condition, label, actual) =>
  ok(condition, `${label}; actual=${JSON.stringify(actual)}`);

async function as(uid, role, sql, params = []) {
  await db.exec('reset role');
  await db.query('select set_config(\'request.jwt.claim.sub\', $1::text, false)', [uid ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

const service = (sql, params = []) => as(null, 'service_role', sql, params);
let fixtureIndex = 0;
let phoneIndex = 0;

async function createDeliveredBooking({
  acceptanceHours = 72,
  elapsedHours = 48,
  scheduleStatus = 'paid',
  bookingStatus = 'completion_requested',
  deliveryStatus = 'submitted',
  dueRule = 'on_delivery',
} = {}) {
  fixtureIndex += 1;
  const customer = (await one('select gen_random_uuid() as id')).id;
  const provider = (await one('select gen_random_uuid() as id')).id;
  const phoneA = `+91910${String(++phoneIndex).padStart(7, '0')}`;
  const phoneB = `+91910${String(++phoneIndex).padStart(7, '0')}`;
  await db.query(
    `insert into auth.users (id, phone) values ($1::uuid, $2::text), ($3::uuid, $4::text)`,
    [customer, phoneA, provider, phoneB],
  );
  await db.query(
    `insert into public.providers (
       id, bio, city, years_experience, kyc_status, admin_review_status, razorpay_account_id,
       created_at, submitted_at, is_online, suspended, paused
     ) values (
       $1::uuid, 'Creator delivery test', 'C1 Test City', 5, 'verified', 'approved', $2::text,
       now() - interval '90 days', now(), true, false, false
     )`,
    [provider, `c1_acc_${fixtureIndex}`],
  );
  const { id: categoryId } = await one(
    `select id from public.categories
      where archetype = 'proposal' and active and not restricted
      order by slug limit 1`,
  );
  if (!categoryId) throw new Error('no active proposal category is available');
  await db.query(
    `update public.categories set deliverable_acceptance_hours = $1::int where id = $2::uuid`,
    [acceptanceHours, categoryId],
  );
  const { id: serviceId } = await one(
    `insert into public.provider_services (
       provider_id, category_id, skill_level, visit_fee, labour_rate, active
     ) values ($1::uuid, $2::uuid, 'expert', 0, 1, true) returning id`,
    [provider, categoryId],
  );
  const { id: addressId } = await one(
    `insert into public.addresses (user_id, label, line1, city, lat, lng)
     values ($1::uuid, 'C1 test', '1 C1 Test Street', 'C1 Test City', 16.51, 80.61)
     returning id`,
    [customer],
  );
  await db.query(
    `insert into public.provider_payout_accounts (
       provider_id, rail, razorpay_account_id, activation_status
     ) values ($1::uuid, 'route', $2::text, 'activated')`,
    [provider, `c1_acc_${fixtureIndex}`],
  );
  const scheduledAt = new Date(Date.UTC(2031, 0, fixtureIndex, 4, 30)).toISOString();
  const { id: bookingId } = await one(
    `insert into public.bookings (
       customer_id, provider_id, category_id, provider_service_id, address_id,
       description, status, visit_fee, platform_fee, total_amount, archetype,
       delivery_status, delivery_links, delivery_submitted_at, completion_requested_at,
       scheduled_at, service_window
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
       'C1 delivery test', $6::public.booking_status, 0, 0, 12000, 'proposal',
       $7::text, '[{"title":"Final edit","url":"https://example.test/final-edit"}]'::jsonb,
       now() - ($8::int * interval '1 hour'),
       case when $9::public.booking_status = 'completion_requested'
         then now() - ($8::int * interval '1 hour') else null end,
       $10::timestamptz, tstzrange($10::timestamptz, $10::timestamptz + interval '2 hours', '[)')
     ) returning id`,
    [customer, provider, categoryId, serviceId, addressId, bookingStatus, deliveryStatus, elapsedHours, bookingStatus, scheduledAt],
  );
  await db.query(
    `insert into public.booking_secrets (booking_id, start_otp)
     values ($1::uuid, '1234') on conflict (booking_id) do nothing`,
    [bookingId],
  );
  const { id: quoteId } = await one(
    `insert into public.quotes (
       booking_id, version, status, total, subtotal_labour, subtotal_commissionable
     ) values ($1::uuid, 1, 'approved', 12000, 0, 12000) returning id`,
    [bookingId],
  );
  await db.query(
    `update public.bookings
        set approved_quote_id = $1::uuid, commission_bp_snapshot = 800
      where id = $2::uuid`,
    [quoteId, bookingId],
  );
  const { id: scheduleId } = await one(
    `insert into public.payment_schedule (
       booking_id, seq, label, amount, due_rule, due_at, status, purpose, reminded_at, paid_at
     ) values (
       $1::uuid, 0, 'Delivery balance', 12000, $4::text,
       now() - ($2::int * interval '1 hour'), $3::text, 'milestone',
       case when $3::text = 'paid' then now() else null end,
       case when $3::text = 'paid' then now() else null end
     ) returning id`,
    [bookingId, elapsedHours, scheduleStatus, dueRule],
  );
  if (scheduleStatus === 'paid') {
    const { id: paymentId } = await one(
      `insert into public.payments (
         booking_id, quote_id, purpose, amount, status, razorpay_payment_id, paid_at, schedule_id
       ) values (
         $1::uuid, $2::uuid, 'final', 12000, 'paid', $3::text, now(), $4::uuid
       ) returning id`,
      [bookingId, quoteId, `pay_demo_c1_${fixtureIndex}`, scheduleId],
    );
    await db.query(
      `update public.payment_schedule set payment_id = $2::uuid where id = $1::uuid`,
      [scheduleId, paymentId],
    );
  }
  return { bookingId, customer, provider, categoryId, scheduleId };
}

await scenario('proposal category defaults to the owner-approved 72-hour acceptance window', async () => {
  const { id: categoryId } = await one(
    `select id from public.categories where archetype = 'proposal' and active order by slug limit 1`,
  );
  const result = await one(
    `select deliverable_acceptance_hours from public.categories where id = $1::uuid`,
    [categoryId],
  );
  check(result.deliverable_acceptance_hours === 72, 'proposal acceptance defaults to 72 hours', result);
});

await scenario('request_completion marks the remaining milestone due and notifies the customer', async () => {
  const fixture = await createDeliveredBooking({
    elapsedHours: 0,
    scheduleStatus: 'upcoming',
    bookingStatus: 'in_progress',
    deliveryStatus: 'not_applicable',
    dueRule: 'on_completion',
  });
  await as(fixture.provider, 'authenticated',
    `select public.request_completion($1::uuid)`, [fixture.bookingId]);
  const schedule = await one(
    `select status, due_at is not null as has_due_at, reminded_at is not null as reminded
       from public.payment_schedule where id = $1::uuid`,
    [fixture.scheduleId],
  );
  const notification = await one(
    `select kind, user_id, collapse_key from public.notifications
      where booking_id = $1::uuid and kind = 'milestone_due'`,
    [fixture.bookingId],
  );
  check(schedule.status === 'due' && schedule.has_due_at && schedule.reminded,
    'completion request records the due milestone reminder state', schedule);
  check(notification?.user_id === fixture.customer
    && notification.collapse_key === `milestone:${fixture.scheduleId}`,
    'completion request notifies the customer once', notification);
});

await scenario('auto-confirm waits until the category acceptance window and releases payout after seven days', async () => {
  const fixture = await createDeliveredBooking({ acceptanceHours: 48, elapsedHours: 47 });
  const earlyCount = (await service('select public.auto_confirm_completions() as count'))[0].count;
  const earlyState = await one(
    `select status::text as status from public.bookings where id = $1::uuid`,
    [fixture.bookingId],
  );
  check(earlyCount === 0 && earlyState.status === 'completion_requested',
    'delivery is not auto-accepted before the configured 48-hour window', { earlyCount, earlyState });

  await db.query(
    `update public.bookings set completion_requested_at = now() - interval '48 hours'
      where id = $1::uuid`,
    [fixture.bookingId],
  );
  const acceptedCount = (await service('select public.auto_confirm_completions() as count'))[0].count;
  const payout = await one(
    `select p.gross, p.commission, p.gst_on_commission, p.amount, p.status::text as payout_status,
            p.release_after, b.completed_at,
            extract(epoch from (p.release_after - b.completed_at))::int as release_seconds,
            b.status::text as status, b.delivery_status
       from public.payouts p join public.bookings b on b.id = p.booking_id
      where p.booking_id = $1::uuid`,
    [fixture.bookingId],
  );
  check(acceptedCount === 1 && payout?.status === 'completed' && payout.delivery_status === 'accepted'
    && payout.gross === 12000 && payout.commission === 960 && payout.gst_on_commission === 173
    && payout.amount === 10867 && payout.payout_status === 'demo' && payout.release_seconds === 604800,
    'fully-paid delivery auto-accepts at 48 hours and holds payout for seven days',
    { acceptedCount, payout });
});

await scenario('unpaid delivery and a pending revision are not auto-confirmed', async () => {
  const unpaid = await createDeliveredBooking({ acceptanceHours: 48, elapsedHours: 49, scheduleStatus: 'due' });
  const revision = await createDeliveredBooking({
    acceptanceHours: 48,
    elapsedHours: 49,
    bookingStatus: 'delivery_pending',
    deliveryStatus: 'revision_requested',
  });
  const count = (await service('select public.auto_confirm_completions() as count'))[0].count;
  const states = await db.query(
    `select id, status::text as status, delivery_status
       from public.bookings where id in ($1::uuid, $2::uuid) order by id`,
    [unpaid.bookingId, revision.bookingId],
  );
  check(count === 0 && states.rows.every((row) => row.status !== 'completed'),
    'auto-confirm leaves unpaid deliveries and revision requests open', { count, rows: states.rows });
});

await scenario('delivery reminders fail closed by default and deduplicate the 72-hour reminder', async () => {
  const fixture = await createDeliveredBooking({ elapsedHours: 73, scheduleStatus: 'due' });
  const flag = await one(
    `select enabled from public.feature_flags where key = 'creator_delivery_reminders'`,
  );
  const disabledCount = (await service('select public.remind_delivery_acceptance() as count'))[0].count;
  const disabledNotifications = await one(
    `select count(*)::int as count from public.notifications where booking_id = $1::uuid`,
    [fixture.bookingId],
  );
  await db.query(
    `update public.feature_flags set enabled = true where key = 'creator_delivery_reminders'`,
  );
  const firstCount = (await service('select public.remind_delivery_acceptance() as count'))[0].count;
  const repeatedCount = (await service('select public.remind_delivery_acceptance() as count'))[0].count;
  const notification = await one(
    `select kind, collapse_key, user_id from public.notifications
      where booking_id = $1::uuid order by created_at desc limit 1`,
    [fixture.bookingId],
  );
  check(flag.enabled === false && disabledCount === 0 && disabledNotifications.count === 0
    && firstCount === 1 && repeatedCount === 0
    && notification?.kind === 'delivery_acceptance_reminder'
    && notification.collapse_key === `delivery-accept:${fixture.bookingId}:3`
    && notification.user_id === fixture.customer,
    '72-hour reminder is flag-gated, customer-scoped and idempotent',
    { flag, disabledCount, disabledNotifications, firstCount, repeatedCount, notification });
});

await scenario('the 144-hour delivery reminder has its own collapse key', async () => {
  const fixture = await createDeliveredBooking({ elapsedHours: 145, scheduleStatus: 'due' });
  await db.query(
    `update public.feature_flags set enabled = true where key = 'creator_delivery_reminders'`,
  );
  const count = (await service('select public.remind_delivery_acceptance() as count'))[0].count;
  const notifications = await db.query(
    `select collapse_key from public.notifications
      where booking_id = $1::uuid and kind = 'delivery_acceptance_reminder'
      order by collapse_key`,
    [fixture.bookingId],
  );
  check(count === 2 && notifications.rows.map((row) => row.collapse_key).sort().join(',')
    === [`delivery-accept:${fixture.bookingId}:3`, `delivery-accept:${fixture.bookingId}:6`].sort().join(','),
    'missed hourly runs catch up both day-three and day-six reminders', { count, rows: notifications.rows });
});

finish();
await db.close();

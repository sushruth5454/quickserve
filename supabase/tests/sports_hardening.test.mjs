import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migration = (file) =>
  fs.readFileSync(path.join(here, '..', 'migrations', file), 'utf8')
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
  raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}', created_at timestamptz, updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const migrationFiles = [
  '0001_init.sql', '0002_qa_fixes.sql', '0003_payout_transfer_payment_cascade.sql',
  '0007_chat_unread_notifications.sql', '0008_provider_kyc_status_values.sql',
  '0009_provider_onboarding.sql', '0010_notification_freshness.sql',
  '0011_payout_rails.sql', '0012_matching_foundations.sql', '0013_review_matching.sql',
  '0014_travel_requests.sql', '0015_seva_coins.sql', '0016_leakage_programme.sql',
  '0017_creator_config.sql', '0018_archetype_core.sql', '0019_fixed_package_booking.sql',
  '0020_proposal_enum_values.sql', '0021_cancellation_availability_payouts.sql',
  '0022_time_based_booking.sql', '0023_proposal_milestone_booking.sql',
  '0024_activate_creator_event_categories.sql', '0025_targeted_proposal_requests.sql',
  '0026_fix_proposal_prepare_payment.sql', '0027_restore_fixed_prepare_payment.sql',
  '0028_auto_approve_provider_links.sql', '0029_single_due_payment.sql',
  '0030_review_fixes.sql', '0031_holiday_mode_enforcement.sql',
  '0032_notification_centre.sql', '0033_city_waitlist.sql',
  '0034_targeted_request_radius.sql', '0035_request_coordinates.sql',
  '0036_provider_service_city.sql', '0037_proposal_validity_cap.sql',
  '0038_proposal_lead_time.sql', '0039_proposal_start_code.sql',
  '0040_urgent_proposals.sql', '0041_admin_support.sql', '0042_feature_registry.sql',
  '0043_commission_config.sql', '0044_creator_revisions.sql',
  '0045_preferred_language.sql', '0046_managed_geography.sql', '0047_coins_config.sql',
  '0048_sports.sql', '0049_shops_catalogue.sql', '0050_rfq.sql',
  '0051_ai_usage_v3.sql', '0052_merchant_staff.sql', '0053_activity_contracts.sql',
  '0054_addendum_foundations.sql', '0055_addendum_foundation_hardening.sql',
  '0056_home_services_catalogue.sql', '0057_recurring_plans_v2.sql',
  '0058_sports_payments.sql', '0059_admin_identity_hardening.sql',
  '0060a_demo_payout_status.sql', '0060b_demo_payout_isolation.sql',
  '0061_h1_provider_cancellation_and_recurring_privacy.sql',
  '0062_coins_hardening.sql', '0063_o1_notifications.sql',
  '0064_o2_provider_verification.sql', '0065_h2a_recurring_correctness.sql',
  '0066_h2b_recurring_ux.sql', '0067_u3_account_deletion.sql',
  '0068_u2_booking_cancellation_preview.sql', '0069_ws3_shop_product_remediation.sql',
  '0070_nearo_r1.sql', '0071_f1_payment_recorder_safety.sql',
  '0072_s1_sports_money_hardening.sql', '0073_b1_server_pricing.sql',
  '0074_p1b_rfq.sql', '0080_s2_sports_ops_ux.sql',
];

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(prelude);
for (const file of migrationFiles) {
  if (file === '0051_ai_usage_v3.sql') {
    await db.exec(`
      create table public.ai_usage (
        id bigint generated always as identity primary key,
        user_id uuid not null references public.profiles (id) on delete cascade,
        kind text not null constraint ai_usage_kind_check check (kind in ('transcribe', 'voice_chat', 'photo')),
        request_id uuid,
        created_at timestamptz not null default now()
      )
    `);
  }
  await db.exec(migration(file));
}
await db.exec("set timezone = 'UTC'");
await db.query(`
  update public.app_config
     set value = value || '{"customer_fee_paise":500,"commission_bp":1000,
       "payment_hold_minutes":10,"approval_pay_window_minutes":60,
       "full_refund_hours":24,"partial_refund_hours":6,
       "partial_refund_bp":5000,"release_after_hours":24}'::jsonb
   where key = 'sports_rules'
`);

async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const json = (value) => typeof value === 'string' ? JSON.parse(value) : value;
const FIXED_DAY = '2026-12-15';
let phoneSequence = 0;

async function setSportsFlags({
  sports = true,
  online = true,
  instant = true,
  capacity = true,
  multiSlot = true,
} = {}) {
  await db.query(`
    update public.feature_flags
       set enabled = case key
         when 'sports' then $1::boolean
         when 'sports_online_payments' then $2::boolean
         when 'sports_instant_booking' then $3::boolean
         when 'sports_capacity_slots' then $4::boolean
         when 'sports_multi_slot' then $5::boolean
       end
     where key = any(array[
       'sports', 'sports_online_payments', 'sports_instant_booking',
       'sports_capacity_slots', 'sports_multi_slot'
     ]::text[])
  `, [sports, online, instant, capacity, multiSlot]);
}

async function addResource(fixture, label, bookingMode = 'instant', capacity = 1) {
  const resourceId = (await one(`
    insert into public.sports_resources
      (venue_id, activity_id, name, slot_minutes, active, booking_mode, capacity)
    values ($1::uuid, $2::uuid, $3::text, 60, true, $4::text, $5::int)
    returning id
  `, [fixture.venueId, fixture.activityId, `S1 ${label}`, bookingMode, capacity])).id;
  await db.query(`
    insert into public.sports_price_rules (resource_id, weekday, starts, ends, price_paise)
    values ($1::uuid, null::smallint, time '08:00', time '20:00', 20000)
  `, [resourceId]);
  return resourceId;
}

async function createFixture(label, { capacity = 1, bookingMode = 'instant', rules = null, customers = 3 } = {}) {
  const ownerId = randomUUID();
  const customerIds = Array.from({ length: customers }, () => randomUUID());
  for (const [index, userId] of [ownerId, ...customerIds].entries()) {
    phoneSequence += 1;
    await db.query(`
      insert into auth.users (id, phone, raw_user_meta_data)
      values ($1::uuid, $2::text, '{}'::jsonb)
    `, [userId, `+9199${String(phoneSequence).padStart(8, '0')}`]);
    await db.query(`
      update public.profiles set full_name = $1::text where id = $2::uuid
    `, [`${label} user ${index}`, userId]);
  }
  const activityId = (await one(`
    select id from public.sports_activities where slug = 'badminton'
  `)).id;
  const venueId = (await one(`
    insert into public.sports_venues
      (owner_id, name, description, address_line, city, area, lat, lng, status,
       payment_modes, cancellation_rules)
    values ($1::uuid, $2::text, 'S1 test venue', '1 Test Road', 'Sangareddy',
      'Center', 16.5::double precision, 80.6::double precision, 'verified',
      array['online','pay_at_venue']::text[], $3::jsonb)
    returning id
  `, [ownerId, `S1 ${label}`, rules ? JSON.stringify(rules) : null])).id;
  await db.query(`
    insert into public.provider_payout_accounts
      (provider_id, rail, activation_status, razorpay_account_id, fund_account_id)
    values ($1::uuid, 'payouts', 'activated', $2::text, $3::text)
  `, [ownerId, `acc_${label}`, `fa_${label}`]);
  await db.query(`
    insert into public.sports_hours (venue_id, weekday, opens, closes)
    select $1::uuid, day::smallint, time '08:00', time '20:00'
      from generate_series(0, 6) day
  `, [venueId]);
  const fixture = { ownerId, customerIds, activityId, venueId, label };
  fixture.resourceId = await addResource(fixture, label, bookingMode, capacity);
  return fixture;
}

async function startsAt(time) {
  return (await one(`
    select ($1::date + $2::time) at time zone 'Asia/Kolkata' starts_at
  `, [FIXED_DAY, time])).starts_at;
}

async function book(fixture, customerId, resourceId, time, {
  mode = 'online',
  slots = 1,
  participants = 1,
  key = randomUUID(),
} = {}) {
  const start = await startsAt(time);
  const result = (await as(customerId, 'authenticated', `
    select public.book_sports_slot(
      $1::uuid, $2::timestamptz, $3::int, $4::int, $5::text, $6::text, $7::text
    ) result
  `, [resourceId, start, slots, participants, mode, '', key]))[0].result;
  return { ...json(result), start };
}

async function prepare(bookingId, customerId) {
  return (await as(null, 'service_role', `
    select * from public.prepare_sports_payment($1::uuid, $2::uuid)
  `, [bookingId, customerId]))[0];
}

async function attachOrder(paymentId, orderId) {
  await db.query(`
    update public.payments
       set razorpay_link_id = $1::text, short_url = 'https://pay.test'
     where id = $2::uuid
  `, [orderId, paymentId]);
}

async function recordPaid(orderId, paymentId, amount) {
  return json((await as(null, 'service_role', `
    select public.record_sports_payment_paid($1::text, $2::text, $3::int) result
  `, [orderId, paymentId, amount]))[0].result);
}

async function makePaidBooking(fixture, customerId, time, key) {
  const start = await startsAt(time);
  const bookingId = (await one(`
    insert into public.sports_bookings
      (customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise,
       note, expires_at, payment_mode, participants, customer_fee_paise, total_paise,
       commission_bp, paid_at)
    values ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz,
      $4::timestamptz + interval '1 hour', 'accepted', 20000, '',
      $4::timestamptz - interval '30 minutes', 'online', 1, 500, 20500, 1000,
      '2026-11-17 12:00:00+00'::timestamptz)
    returning id
  `, [customerId, fixture.venueId, fixture.resourceId, start])).id;
  const paymentId = (await one(`
    insert into public.payments
      (sports_booking_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at)
    values ($1::uuid, 'fixed', 20500, 'paid', $2::text, $3::text,
      '2026-11-17 12:00:00+00'::timestamptz)
    returning id
  `, [bookingId, `order_${key}`, `pay_${key}`])).id;
  return { bookingId, paymentId, start };
}

async function failureOf(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error?.message ?? String(error);
  }
}

async function setAdminSportsRules(adminId, patch) {
  await db.query(`
    update public.feature_flags set enabled = true where key = 'admin_rules_editor'
  `);
  await db.query(`
    insert into public.admins (user_id) values ($1::uuid)
    on conflict (user_id) do nothing
  `, [adminId]);
  const rows = await as(adminId, 'authenticated', `
    select public.admin_set_rules(
      'sports_rules'::text,
      (select value || $1::jsonb from public.app_config where key = 'sports_rules')
    ) value
  `, [JSON.stringify(patch)]);
  return json(rows[0].value);
}

await scenario('WS4-T02: customer list returns server payment fields after O1 payment notifications', async () => {
  await setSportsFlags();
  const fixture = await createFixture('list-fields');
  const hold = await book(fixture, fixture.customerIds[0], fixture.resourceId, '10:00');
  const attempt = await prepare(hold.booking_id, fixture.customerIds[0]);
  await attachOrder(attempt.payment_id, 's1-list-order');
  const capture = await recordPaid('s1-list-order', 'pay_s1_list', attempt.amount);
  const row = (await as(fixture.customerIds[0], 'authenticated', `
    select * from public.list_my_customer_sports_bookings() where id = $1::uuid
  `, [hold.booking_id]))[0];
  const notifications = await one(`
    select count(*)::int count
      from public.notifications
     where data ->> 'sports_booking_id' = $1::text
       and kind = 'sports_booking_confirmed'
  `, [hold.booking_id]);
  ok(capture.ok === true && row?.payment_mode === 'online'
    && row?.participants === 1 && row?.customer_fee_paise === 500
    && row?.total_paise === 20500 && row?.refund_paise === 0
    && row?.paid_at !== null && row?.hold_expires_at !== null
    && row?.pay_by === null && notifications.count === 2,
  `[WS4-T02/O1] list payment fields and notifications: ${JSON.stringify({ capture, row, notifications })}`);
});

async function assertCancellationPayout(label, rules, cancelBy, expected) {
  await setSportsFlags();
  const fixture = await createFixture(label, { rules });
  const booking = await makePaidBooking(fixture, fixture.customerIds[0], '10:00', label);
  if (expected.changeCommission) {
    await db.query(`
      update public.app_config
         set value = jsonb_set(value, '{commission_bp}', '2500'::jsonb)
       where key = 'sports_rules'
    `);
  }
  if (expected.disableSports) await setSportsFlags({ sports: false });
  await as(cancelBy === 'venue' ? fixture.ownerId : fixture.customerIds[0], 'authenticated', `
    select public.cancel_sports_booking($1::uuid, $2::text)
  `, [booking.bookingId, cancelBy === 'venue' ? 'venue maintenance' : 'customer cancellation']);
  await as(null, 'service_role', `
    select public._create_sports_payout($1::uuid)
  `, [booking.bookingId]);
  const state = await one(`
    select b.status, b.cancelled_by, b.refund_paise,
      (select coalesce(sum(r.amount), 0)::int
         from public.refunds r join public.payments p on p.id = r.payment_id
        where p.sports_booking_id = b.id) refund_total,
      (select count(*)::int from public.payouts po where po.sports_booking_id = b.id) payout_count
      from public.sports_bookings b
     where b.id = $1::uuid
  `, [booking.bookingId]);
  const payout = await one(`
    select gross, commission, gst_on_commission, amount, payee_id
      from public.payouts where sports_booking_id = $1::uuid
  `, [booking.bookingId]);
  ok(state.status === 'cancelled' && state.cancelled_by === cancelBy
    && state.refund_paise === expected.refund && state.refund_total === expected.refund
    && state.payout_count === expected.payoutCount
    && (!expected.payout || (
      payout.gross === expected.payout.gross
      && payout.commission === expected.payout.commission
      && payout.gst_on_commission === expected.payout.gst
      && payout.amount === expected.payout.amount
      && payout.payee_id === fixture.ownerId
    )),
  `[WS4-T03/D3] ${label}: ${JSON.stringify({ state, payout, expected, ownerId: fixture.ownerId })}`);
  if (expected.changeCommission) {
    await db.query(`
      update public.app_config
         set value = jsonb_set(value, '{commission_bp}', '1000'::jsonb)
       where key = 'sports_rules'
    `);
  }
}

await scenario('WS4-T03: a 50% customer refund pays the venue its retained share minus commission and GST', async () => {
  const rules = { full_refund_hours: 1000000, partial_refund_hours: 0, partial_refund_bp: 5000 };
  await assertCancellationPayout('partial-kept', rules, 'customer', {
    refund: 10000,
    payoutCount: 1,
    disableSports: true,
    changeCommission: true,
    payout: { gross: 10000, commission: 1000, gst: 180, amount: 8820 },
  });
});

await scenario('WS4-T03: a 0% customer refund pays the venue the full service value net of commission and GST', async () => {
  await assertCancellationPayout(
    'zero-refund',
    { full_refund_hours: 1000000, partial_refund_hours: 0, partial_refund_bp: 0 },
    'customer',
    { refund: 0, payoutCount: 1, payout: { gross: 20000, commission: 2000, gst: 360, amount: 17640 } },
  );
});

await scenario('WS4-T03: full customer refund does not create a zero-gross payout', async () => {
  await assertCancellationPayout(
    'full-refund',
    { full_refund_hours: 0, partial_refund_hours: 0, partial_refund_bp: 5000 },
    'customer',
    { refund: 20000, payoutCount: 0 },
  );
});

await scenario('WS4-T03/WS4-F17: venue cancellation refunds the full customer payment and creates no payout', async () => {
  await assertCancellationPayout(
    'venue-refund',
    { full_refund_hours: 24, partial_refund_hours: 6, partial_refund_bp: 5000 },
    'venue',
    { refund: 20500, payoutCount: 0 },
  );
});

await scenario('WS4-T06: blocks reject live pending and awaiting payment holds, then allow expired holds', async () => {
  await setSportsFlags();
  const fixture = await createFixture('block-holds');
  const pending = await book(fixture, fixture.customerIds[0], fixture.resourceId, '10:00');
  const pendingBlock = await failureOf(() => as(fixture.ownerId, 'authenticated', `
    select public.add_sports_block(
      $1::uuid, $2::timestamptz, $2::timestamptz + interval '1 hour', $3::text
    )
  `, [fixture.resourceId, pending.start, 'live payment hold']));
  await db.query(`
    update public.sports_bookings
       set hold_expires_at = '2025-01-01 00:00:00+00'::timestamptz
     where id = $1::uuid
  `, [pending.booking_id]);
  const expiredPendingBlock = await failureOf(() => as(fixture.ownerId, 'authenticated', `
    select public.add_sports_block(
      $1::uuid, $2::timestamptz, $2::timestamptz + interval '1 hour', $3::text
    )
  `, [fixture.resourceId, pending.start, 'expired payment hold']));

  const approvalResource = await addResource(fixture, 'approval block', 'approval', 1);
  const approval = await book(fixture, fixture.customerIds[1], approvalResource, '12:00');
  await as(fixture.ownerId, 'authenticated', `
    select public.decide_sports_booking($1::uuid, true, ''::text)
  `, [approval.booking_id]);
  const awaitingBlock = await failureOf(() => as(fixture.ownerId, 'authenticated', `
    select public.add_sports_block(
      $1::uuid, $2::timestamptz, $2::timestamptz + interval '1 hour', $3::text
    )
  `, [approvalResource, approval.start, 'live approval payment']));
  await db.query(`
    update public.sports_bookings
       set pay_by = '2025-01-01 00:00:00+00'::timestamptz
     where id = $1::uuid
  `, [approval.booking_id]);
  const expiredAwaitingBlock = await failureOf(() => as(fixture.ownerId, 'authenticated', `
    select public.add_sports_block(
      $1::uuid, $2::timestamptz, $2::timestamptz + interval '1 hour', $3::text
    )
  `, [approvalResource, approval.start, 'expired approval payment']));
  ok(/active booking/.test(pendingBlock ?? '')
    && expiredPendingBlock === null
    && /active booking/.test(awaitingBlock ?? '')
    && expiredAwaitingBlock === null,
  `[WS4-T06] hold/block results: ${JSON.stringify({ pendingBlock, expiredPendingBlock, awaitingBlock, expiredAwaitingBlock })}`);
});

await scenario('WS4-T10: legacy request keeps one-slot pay-at-venue, gates multi-slot, and removes stale overloads', async () => {
  await setSportsFlags({ multiSlot: false });
  const fixture = await createFixture('legacy-slots');
  const legacyStart = await startsAt('10:00');
  const legacyId = (await as(fixture.customerIds[0], 'authenticated', `
    select public.request_sports_slot($1::uuid, $2::timestamptz, $3::int, $4::text) id
  `, [fixture.resourceId, legacyStart, 1, '']))[0].id;
  const legacy = await one(`
    select status, payment_mode from public.sports_bookings where id = $1::uuid
  `, [legacyId]);
  const disabledMultiSlotStart = await startsAt('12:00');
  const disabledMultiSlotError = await failureOf(() => as(fixture.customerIds[1], 'authenticated', `
    select public.request_sports_slot($1::uuid, $2::timestamptz, $3::int, $4::text)
  `, [fixture.resourceId, disabledMultiSlotStart, 2, '']));
  await setSportsFlags({ multiSlot: true });
  const overLimitStart = await startsAt('14:00');
  const overLimitError = await failureOf(() => as(fixture.customerIds[1], 'authenticated', `
    select public.request_sports_slot($1::uuid, $2::timestamptz, $3::int, $4::text)
  `, [fixture.resourceId, overLimitStart, 5, '']));
  const oldVenueOverload = await one(`
    select to_regprocedure(
      'public.save_sports_venue(uuid,text,text,text,text,text,double precision,double precision,text[],text[])'
    ) is null missing
  `);
  const oldResourceOverload = await one(`
    select to_regprocedure('public.save_sports_resource(uuid,uuid,uuid,text,int,boolean)') is null missing
  `);
  const notification = await one(`
    select count(*)::int count from public.notifications
     where user_id = $1::uuid and data ->> 'sports_booking_id' = $2::text
       and kind = 'sports_booking_requested'
  `, [fixture.ownerId, legacyId]);
  ok(legacy.status === 'requested' && legacy.payment_mode === 'pay_at_venue'
    && /Sports multi-slot booking is turned off/.test(disabledMultiSlotError ?? '')
    && /slot count must be between 1 and 4/.test(overLimitError ?? '')
    && oldVenueOverload.missing && oldResourceOverload.missing
    && notification.count === 1,
  `[WS4-T10/O1] legacy slot results: ${JSON.stringify({ legacy, disabledMultiSlotError, overLimitError, oldVenueOverload, oldResourceOverload, notification })}`);
});

await scenario('WS4-T11: capacity uses the maximum per-slot occupancy, while capacity one still rejects overlap', async () => {
  await setSportsFlags({ online: false, capacity: true, multiSlot: true });
  const fixture = await createFixture('per-slot-capacity', { capacity: 4, customers: 4 });
  const first = await book(fixture, fixture.customerIds[0], fixture.resourceId, '10:00', {
    mode: 'pay_at_venue', participants: 3,
  });
  const second = await book(fixture, fixture.customerIds[1], fixture.resourceId, '11:00', {
    mode: 'pay_at_venue', participants: 3,
  });
  const acrossBothSlots = await book(fixture, fixture.customerIds[2], fixture.resourceId, '10:00', {
    mode: 'pay_at_venue', slots: 2, participants: 1,
  });
  const capacityOne = await addResource(fixture, 'capacity one', 'instant', 1);
  const oneSlotFirst = await book(fixture, fixture.customerIds[0], capacityOne, '14:00', {
    mode: 'pay_at_venue', participants: 1,
  });
  const overlapError = await failureOf(() => book(fixture, fixture.customerIds[1], capacityOne, '14:00', {
    mode: 'pay_at_venue', participants: 1,
  }));
  ok(first.status === 'accepted' && second.status === 'accepted'
    && acrossBothSlots.status === 'accepted' && oneSlotFirst.status === 'accepted'
    && /slot is no longer available/.test(overlapError ?? ''),
  `[WS4-T11] per-slot capacity results: ${JSON.stringify({ first, second, acrossBothSlots, oneSlotFirst, overlapError })}`);
});

await scenario('WS6-T09: late capture on a retired attempt refunds separately and does not reduce payout gross', async () => {
  await setSportsFlags();
  const fixture = await createFixture('late-capture');
  const hold = await book(fixture, fixture.customerIds[0], fixture.resourceId, '10:00');
  const retiredAttempt = await prepare(hold.booking_id, fixture.customerIds[0]);
  await attachOrder(retiredAttempt.payment_id, 's1-retired-order');
  await db.query(`
    update public.payments set status = 'failed', cancel_link_pending = true
     where id = $1::uuid and status = 'created'
  `, [retiredAttempt.payment_id]);
  const activeAttempt = await prepare(hold.booking_id, fixture.customerIds[0]);
  await attachOrder(activeAttempt.payment_id, 's1-active-order');
  const validCapture = await recordPaid('s1-active-order', 'pay_s1_active', activeAttempt.amount);
  const lateCapture = await recordPaid('s1-retired-order', 'pay_s1_retired_late', retiredAttempt.amount);
  const retiredRow = await one(`
    select status, razorpay_payment_id from public.payments where id = $1::uuid
  `, [retiredAttempt.payment_id]);
  const unmatchedCapture = await one(`
    select status, amount, razorpay_payment_id,
      (select coalesce(sum(r.amount), 0)::int
         from public.refunds r where r.payment_id = p.id) refunded
      from public.payments p
     where p.razorpay_payment_id = 'pay_s1_retired_late'
  `);
  await db.query(`
    update public.sports_bookings set status = 'completed' where id = $1::uuid
  `, [hold.booking_id]);
  await as(null, 'service_role', `
    select public._create_sports_payout($1::uuid)
  `, [hold.booking_id]);
  const payout = await one(`
    select gross, commission, gst_on_commission, amount
      from public.payouts where sports_booking_id = $1::uuid
  `, [hold.booking_id]);
  const refundBasis = await one(`
    select refund_paise from public.sports_bookings where id = $1::uuid
  `, [hold.booking_id]);
  ok(validCapture.ok === true && lateCapture.ok === true
    && retiredRow.status === 'failed' && retiredRow.razorpay_payment_id === null
    && unmatchedCapture.status === 'refund_pending'
    && unmatchedCapture.amount === retiredAttempt.amount
    && unmatchedCapture.refunded === retiredAttempt.amount
    && refundBasis.refund_paise === 0
    && payout.gross === 20000 && payout.commission === 2000
    && payout.gst_on_commission === 360 && payout.amount === 17640,
  `[WS6-T09] late-capture state: ${JSON.stringify({ validCapture, lateCapture, retiredRow, unmatchedCapture, refundBasis, payout })}`);
});

await scenario('WS4-T05/WS8-T08: own booking remains readable and cancellable with sports off; strangers see none', async () => {
  await setSportsFlags();
  const fixture = await createFixture('flag-off-readable', {
    rules: { full_refund_hours: 24, partial_refund_hours: 6, partial_refund_bp: 5000 },
  });
  const booking = await makePaidBooking(fixture, fixture.customerIds[0], '10:00', 'flag-off-readable');
  await setSportsFlags({ sports: false });

  const list = await as(fixture.customerIds[0], 'authenticated', `
    select * from public.list_my_customer_sports_bookings() where id = $1::uuid
  `, [booking.bookingId]);
  const detail = json((await as(fixture.customerIds[0], 'authenticated', `
    select public.get_business_sports_booking($1::uuid) value
  `, [booking.bookingId]))[0].value);
  const ownRows = await as(fixture.customerIds[0], 'authenticated', `
    select id from public.sports_bookings where id = $1::uuid
  `, [booking.bookingId]);
  const strangerRows = await as(fixture.customerIds[1], 'authenticated', `
    select id from public.sports_bookings where id = $1::uuid
  `, [booking.bookingId]);
  const preview = json((await as(fixture.customerIds[0], 'authenticated', `
    select public.preview_sports_cancellation($1::uuid) value
  `, [booking.bookingId]))[0].value);
  await as(fixture.customerIds[0], 'authenticated', `
    select public.cancel_sports_booking($1::uuid, ''::text)
  `, [booking.bookingId]);
  const state = await one(`
    select b.status, b.refund_paise,
      (select coalesce(sum(r.amount), 0)::int
         from public.refunds r join public.payments p on p.id = r.payment_id
        where p.sports_booking_id = b.id) refund_total
      from public.sports_bookings b where b.id = $1::uuid
  `, [booking.bookingId]);
  ok(list.length === 1 && detail?.id === booking.bookingId
    && ownRows.length === 1 && strangerRows.length === 0
    && preview.can_cancel === true && preview.refund_paise === 20000
    && state.status === 'cancelled' && state.refund_paise === 20000
    && state.refund_total === 20000,
  `[WS4-T05/WS8-T08] flag-off state: ${JSON.stringify({ list, detail, ownRows, strangerRows, preview, state })}`);
});

await scenario('WS4-T07: refund preview equals the queued refund for customer tiers and venue cancellation', async () => {
  const cases = [
    { label: 'preview-48h', hours: 48, cancelBy: 'customer', expected: 20000, retained: 0 },
    { label: 'preview-10h', hours: 10, cancelBy: 'customer', expected: 10000, retained: 10000 },
    { label: 'preview-2h', hours: 2, cancelBy: 'customer', expected: 0, retained: 20000 },
    { label: 'preview-venue', hours: 48, cancelBy: 'venue', expected: 20500, retained: 0 },
  ];
  const results = [];
  for (const testCase of cases) {
    await setSportsFlags();
    const fixture = await createFixture(testCase.label, {
      rules: { full_refund_hours: 24, partial_refund_hours: 6, partial_refund_bp: 5000 },
    });
    const booking = await makePaidBooking(fixture, fixture.customerIds[0], '10:00', testCase.label);
    await db.query(`
      update public.sports_bookings
         set starts_at = now() + $2::int * interval '1 hour',
             ends_at = now() + $2::int * interval '1 hour' + interval '1 hour'
       where id = $1::uuid
    `, [booking.bookingId, testCase.hours]);
    const actor = testCase.cancelBy === 'venue' ? fixture.ownerId : fixture.customerIds[0];
    const preview = json((await as(actor, 'authenticated', `
      select public.preview_sports_cancellation($1::uuid) value
    `, [booking.bookingId]))[0].value);
    await as(actor, 'authenticated', `
      select public.cancel_sports_booking($1::uuid, $2::text)
    `, [booking.bookingId, testCase.cancelBy === 'venue' ? 'Venue maintenance' : 'Customer cancellation']);
    const state = await one(`
      select b.status, b.cancelled_by, b.refund_paise,
        (select coalesce(sum(r.amount), 0)::int
           from public.refunds r join public.payments p on p.id = r.payment_id
          where p.sports_booking_id = b.id) refund_total
        from public.sports_bookings b where b.id = $1::uuid
    `, [booking.bookingId]);
    results.push({
      label: testCase.label,
      preview,
      state,
      expected: testCase.expected,
      expectedRetained: testCase.retained,
    });
    ok(preview.can_cancel === true && preview.refund_paise === testCase.expected
      && preview.retained_paise === testCase.retained
      && state.status === 'cancelled' && state.cancelled_by === testCase.cancelBy
      && state.refund_paise === testCase.expected && state.refund_total === testCase.expected,
    `[WS4-T07/D3] ${testCase.label}: ${JSON.stringify({ preview, state, expected: testCase.expected, expectedRetained: testCase.retained })}`);
  }
});

await scenario('WS4-T09: owner edits a price rule by id and only the owner can delete it', async () => {
  await setSportsFlags();
  const fixture = await createFixture('price-edit-delete');
  const existing = await one(`
    select id from public.sports_price_rules where resource_id = $1::uuid limit 1
  `, [fixture.resourceId]);
  const editedRows = await as(fixture.ownerId, 'authenticated', `
    select public.save_sports_price_rule(
      $1::uuid, $2::uuid, null::smallint, time '08:00', time '20:00', $3::int, $4::text
    ) id
  `, [fixture.resourceId, existing.id, 25000, 'Edited standard']);
  const editedId = editedRows[0].id;
  const edited = await one(`
    select price_paise, label from public.sports_price_rules where id = $1::uuid
  `, [existing.id]);
  const refused = await failureOf(() => as(fixture.customerIds[0], 'authenticated', `
    select public.delete_sports_price_rule($1::uuid)
  `, [existing.id]));
  await as(fixture.ownerId, 'authenticated', `
    select public.delete_sports_price_rule($1::uuid)
  `, [existing.id]);
  const remaining = await one(`
    select count(*)::int count from public.sports_price_rules where id = $1::uuid
  `, [existing.id]);
  ok(editedId === existing.id && edited.price_paise === 25000
    && edited.label === 'Edited standard' && /not found or not owned/.test(refused ?? '')
    && remaining.count === 0,
  `[WS4-T09] price-rule state: ${JSON.stringify({ editedId, edited, refused, remaining, ownerId: fixture.ownerId })}`);
});

await scenario('WS4-T13: active booking holds enforce the configurable customer limit', async () => {
  await setSportsFlags();
  const fixture = await createFixture('hoarding-limit');
  const statuses = ['requested', 'pending_payment', 'awaiting_payment'];
  for (const [index, status] of statuses.entries()) {
    const starts = await startsAt(['10:00', '12:00', '14:00'][index]);
    await db.query(`
      insert into public.sports_bookings
        (customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise,
         note, expires_at, payment_mode, participants, customer_fee_paise, total_paise,
         hold_expires_at, pay_by)
      values ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz,
        $4::timestamptz + interval '1 hour', $5::text, 20000, '',
        now() + interval '1 hour', 'online', 1, 500, 20500,
        case when $5::text = 'pending_payment' then now() + interval '1 hour' else null end,
        case when $5::text = 'awaiting_payment' then now() + interval '1 hour' else null end)
    `, [fixture.customerIds[0], fixture.venueId, fixture.resourceId, starts, status]);
  }
  const refused = await failureOf(() => book(fixture, fixture.customerIds[0], fixture.resourceId, '16:00'));
  const rules = await setAdminSportsRules(fixture.ownerId, { max_active_holds_per_customer: 4 });
  const afterChange = await book(fixture, fixture.customerIds[0], fixture.resourceId, '16:00');
  const count = await one(`
    select count(*)::int count from public.sports_bookings
     where customer_id = $1::uuid and status in ('requested','pending_payment','awaiting_payment','accepted')
  `, [fixture.customerIds[0]]);
  ok(/too many pending sports bookings/.test(refused ?? '')
    && rules.max_active_holds_per_customer === 4
    && afterChange.status === 'pending_payment' && count.count === 4,
  `[WS4-T13] hoarding state: ${JSON.stringify({ refused, rules, afterChange, count })}`);
});

await scenario('WS4-T13: accepted pay-at-venue bookings count against the customer limit', async () => {
  await setSportsFlags();
  const fixture = await createFixture('hoarding-pay-at-venue');
  for (const time of ['10:00', '12:00', '14:00']) {
    const starts = await startsAt(time);
    await db.query(`
      insert into public.sports_bookings
        (customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise,
         note, expires_at, payment_mode, participants, customer_fee_paise, total_paise)
      values ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz,
        $4::timestamptz + interval '1 hour', 'accepted', 20000, '',
        now() + interval '1 hour', 'pay_at_venue', 1, 0, 20000)
    `, [fixture.customerIds[0], fixture.venueId, fixture.resourceId, starts]);
  }
  const refused = await failureOf(() => book(fixture, fixture.customerIds[0], fixture.resourceId, '16:00'));
  ok(/too many pending sports bookings/.test(refused ?? ''),
    `[WS4-T13] pay-at-venue limit state: ${JSON.stringify({ refused, customerId: fixture.customerIds[0] })}`);
});

await scenario('WS4-T16: failed sports payment marks only the payment failed and notifies the customer', async () => {
  await setSportsFlags();
  const fixture = await createFixture('payment-failure');
  const hold = await book(fixture, fixture.customerIds[0], fixture.resourceId, '10:00');
  const attempt = await prepare(hold.booking_id, fixture.customerIds[0]);
  await attachOrder(attempt.payment_id, 's2-failed-order');
  const result = json((await as(null, 'service_role', `
    select public.record_sports_payment_failed($1::text) result
  `, ['s2-failed-order']))[0].result);
  const state = await one(`
    select p.status payment_status, b.status booking_status
      from public.payments p join public.sports_bookings b on b.id = p.sports_booking_id
     where p.id = $1::uuid
  `, [attempt.payment_id]);
  const notice = await one(`
    select count(*)::int count from public.notifications
     where user_id = $1::uuid and kind = 'sports_payment_failed'
       and data ->> 'sports_booking_id' = $2::text
  `, [fixture.customerIds[0], hold.booking_id]);
  ok(result.ok === true && state.payment_status === 'failed'
    && state.booking_status === 'pending_payment' && notice.count === 1,
  `[WS4-T16] payment-failure state: ${JSON.stringify({ result, state, notice })}`);
});

await scenario('WS4-T16: demo sports settlement refuses a non-demo venue owner', async () => {
  await setSportsFlags();
  const fixture = await createFixture('non-demo-settlement');
  const hold = await book(fixture, fixture.customerIds[0], fixture.resourceId, '10:00');
  await db.query(`
    update public.app_config set value = '{"is_demo_project":true}'::jsonb where key = 'deployment'
  `);
  await db.query(`
    update public.app_config set value = '{"enabled":true}'::jsonb where key = 'demo_payments'
  `);
  const refused = await failureOf(() => as(fixture.customerIds[0], 'authenticated', `
    select public.demo_settle_sports_payment($1::uuid)
  `, [hold.booking_id]));
  ok(/demo venue owners/.test(refused ?? ''),
    `[WS4-T16] demo guard state: ${JSON.stringify({ refused, bookingId: hold.booking_id })}`);
});

await scenario('WS4-T17: admin-configured response and lead windows govern new requests', async () => {
  await setSportsFlags({ instant: false });
  const fixture = await createFixture('configured-windows', { bookingMode: 'approval' });
  const rules = await setAdminSportsRules(fixture.ownerId, {
    request_response_minutes: 15,
    min_lead_minutes: 30,
  });
  const start = await startsAt('10:00');
  const bookingId = (await as(fixture.customerIds[0], 'authenticated', `
    select public.request_sports_slot(
      $1::uuid, $2::timestamptz, 1::int, ''::text
    ) id
  `, [fixture.resourceId, start]))[0].id;
  const timing = await one(`
    select extract(epoch from (expires_at - now()))::int response_seconds
      from public.sports_bookings where id = $1::uuid
  `, [bookingId]);
  const onlineRequest = await book(fixture, fixture.customerIds[0], fixture.resourceId, '12:00');
  await as(fixture.ownerId, 'authenticated', `
    select public.decide_sports_booking($1::uuid, true, ''::text)
  `, [onlineRequest.booking_id]);
  const paymentDeadline = await one(`
    select extract(epoch from (pay_by - now()))::int response_seconds
      from public.sports_bookings where id = $1::uuid
  `, [onlineRequest.booking_id]);
  await setAdminSportsRules(fixture.ownerId, { min_lead_minutes: 43200 });
  const tooSoon = await failureOf(() => book(fixture, fixture.customerIds[1], fixture.resourceId, '14:00'));
  ok(rules.request_response_minutes === 15 && rules.min_lead_minutes === 30
    && timing.response_seconds > 0 && timing.response_seconds <= 900
    && onlineRequest.status === 'requested'
    && paymentDeadline.response_seconds > 0 && paymentDeadline.response_seconds <= 900
    && /configured lead time/.test(tooSoon ?? ''),
  `[WS4-T17] configured-window state: ${JSON.stringify({ rules, timing, onlineRequest, paymentDeadline, tooSoon })}`);
});

finish();

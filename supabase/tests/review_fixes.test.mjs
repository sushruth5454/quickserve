// Runtime checks for 0030 (final-review fixes) on the REAL migration chain 0001..0030: real payment_schedule
// constraints and the real archetype_transitions state machine (no stubbed tables or _set_status).
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
for (const file of [
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
  '0028_auto_approve_provider_links.sql', '0029_single_due_payment.sql', '0030_review_fixes.sql',
  '0031_holiday_mode_enforcement.sql', '0032_notification_centre.sql', '0033_city_waitlist.sql', '0034_targeted_request_radius.sql', '0035_request_coordinates.sql', '0036_provider_service_city.sql', '0037_proposal_validity_cap.sql', '0038_proposal_lead_time.sql', '0039_proposal_start_code.sql', '0040_urgent_proposals.sql', '0041_admin_support.sql', '0042_feature_registry.sql', '0043_commission_config.sql', '0044_creator_revisions.sql', '0045_preferred_language.sql', '0046_managed_geography.sql', '0047_coins_config.sql', '0048_sports.sql', '0049_shops_catalogue.sql', '0050_rfq.sql', '0051_ai_usage_v3.sql', '0052_merchant_staff.sql', '0053_activity_contracts.sql', '0054_addendum_foundations.sql', '0055_addendum_foundation_hardening.sql', '0056_home_services_catalogue.sql',
]) {
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
let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log(`ok  : ${message}`);
  else { failures++; console.error(`FAIL: ${message}`); }
};
async function as(uid, role, query, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return (await db.query(query, params)).rows; }
  finally { await db.exec('reset role;'); }
}
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

const customer = '00000000-0000-0000-0000-0000000000c1';
const provider = '00000000-0000-0000-0000-0000000000a1';
const demoPro = '00000000-0000-0000-0000-0000000000d1';
const admin = '00000000-0000-0000-0000-0000000000b1';
const commissionCustomer = '00000000-0000-0000-0000-0000000000c3';
await db.exec(`
  insert into auth.users (id, phone, raw_user_meta_data) values
    ('${customer}', '+919999000001', '{}'), ('${provider}', '+919999000002', '{}'),
    ('${demoPro}', '+919999000003', '{"demo_only":"true"}'),
    ('${commissionCustomer}', '+919999000004', '{}'),
    ('${admin}', '+918888888888', '{}');
  update profiles set full_name = 'Person';
  insert into providers (id, city, base_location, kyc_status, submitted_at, is_online, paused, suspended)
  values
    ('${provider}', 'Review City', extensions.st_setsrid(extensions.st_makepoint(80.60,16.50),4326), 'verified', now(), true, false, false),
    ('${demoPro}', 'Review City', extensions.st_setsrid(extensions.st_makepoint(80.61,16.50),4326), 'verified', now(), true, false, false);
  update app_config set value = value || '{"proposal":true,"time_based":true}'::jsonb where key = 'archetype_flags';
  insert into provider_availability (provider_id, weekday, start_time, end_time)
  select p, d, time '00:00', time '23:59' from unnest(array['${provider}','${demoPro}']::uuid[]) p cross join generate_series(0, 6) d;
  insert into addresses (user_id, label, line1, city, lat, lng)
  values ('${customer}', 'Venue', 'Gate 2', 'Review City', 16.50, 80.60);
`);
const address = (await one(`select id from addresses where user_id = $1`, [customer])).id;
const commissionAddress = (await one(`
  insert into addresses (user_id, label, line1, city, lat, lng)
  values ($1, 'Commission test', 'Gate 3', 'Review City', 16.50, 80.60) returning id
`, [commissionCustomer])).id;

const category = async (slug, archetype) => {
  const id = (await one(`
    insert into categories (slug, name, pricing_mode, active, archetype, intake_schema, config_version, max_lead_days)
    values ($1, $1, 'quote', true, $2, '{"type":"object","properties":{"brief":{"type":"string"}}}', 1, 365)
    returning id`, [slug, archetype])).id;
  await db.query(`insert into category_cities (category_id, city, live, launched_at) values ($1, 'Review City', true, now())`, [id]);
  return id;
};
const sessionCat = await category('review-session', 'time_based');
const proposalCat = await category('review-proposal', 'proposal');
// Event policy: its date rules don't look at who cancelled (the design-review reproduction).
await db.query(`update categories set cancellation_policy = 'event_moderate' where id = $1`, [proposalCat]);
await db.query(`
  insert into provider_services (provider_id, category_id, visit_fee, labour_rate, active)
  values ($1, $3, 0, 60000, true), ($1, $4, 0, 0, true), ($2, $4, 0, 0, true)`, [provider, demoPro, sessionCat, proposalCat]);
const sessionService = (await one(`select id from provider_services where provider_id = $1 and category_id = $2`, [provider, sessionCat])).id;

const payLink = async (paymentId, amount, rpc = 'record_payment_paid') => {
  const link = `link_${paymentId}`;
  await db.query(`update payments set razorpay_link_id = $1, short_url = 'https://pay.test' where id = $2`, [link, paymentId]);
  return (await one(`select ${rpc}($1, $2, $3) r`, [link, `gw_${paymentId}`, amount])).r;
};

// ---------- 1, 5, 7, 8: a pay-per-session booking runs end to end ----------
const sessionProviderBefore = await one(`select created_at, jobs_completed from providers where id = $1`, [provider]);
const sessionCommissionDefaults = (await as(admin, 'authenticated',
  `select admin_get_commission_config() config`))[0].config;
await db.query(`update providers set created_at = now() - interval '60 days', jobs_completed = 0 where id = $1`, [provider]);
await as(admin, 'authenticated', `select admin_set_commission($1::jsonb)`, [JSON.stringify({
  ...sessionCommissionDefaults,
  time_based: { one_off_bp: 1100, recurring_bp: 900 },
})]);
const createSession = async (dayOffset = 3) => (await one(`
  select _create_session_booking(
    $1, $2, null, date_trunc('day', now()) + make_interval(days => $3, hours => 6, mins => 30),
    60, 'Gate 2', 'Review City', 16.5, 80.6, 'session'
  ) id`, [customer, sessionService, dayOffset])).id;
let session = null;
const createError = await fails(async () => { session = await createSession(); });
ok(!createError && session, `session booking is created with classified schedule rows (${createError ?? 'ok'})`);
if (session) {
  const rows = (await db.query(`select obligation_type, purpose, obligation_kind, amount from payment_schedule where booking_id = $1 order by seq`, [session])).rows;
  ok(rows.length === 2 && rows[1].obligation_type === 'platform_fee' && rows[1].obligation_kind === 'platform_fee' && rows[0].purpose === 'session',
    'session schedule rows carry obligation type, purpose and kind');
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const prep = (await db.query(`select * from prepare_session_payment($1, $2, null)`, [session, customer])).rows[0];
  ok(prep.amount === total, 'one session payment covers the service and the platform fee');
  await payLink(prep.payment_id, prep.amount, 'record_time_payment_paid');
  ok((await one(`select status from bookings where id = $1`, [session])).status === 'requested', 'paying the session sends the request');
  await as(provider, 'authenticated', `select accept_booking($1)`, [session]);
  const otp = (await one(`select start_otp from booking_secrets where booking_id = $1`, [session])).start_otp;
  await db.query(`update bookings set scheduled_at = now(), service_window = tstzrange(now(), now() + interval '1 hour') where id = $1`, [session]);
  const startError = await fails(() => as(provider, 'authenticated', `select start_session_booking($1, $2)`, [session, otp]));
  const requestError = await fails(() => as(provider, 'authenticated', `select request_session_completion($1)`, [session]));
  ok(!startError && !requestError && (await one(`select status from bookings where id = $1`, [session])).status === 'completion_requested',
    `provider can start and finish a session (${startError ?? requestError ?? 'ok'})`);
  await db.query(`update bookings set completion_requested_at = now() - interval '2 days' where id = $1`, [session]);
  const autoError = await fails(() => db.query(`select auto_confirm_completions()`));
  ok(!autoError && (await one(`select status from bookings where id = $1`, [session])).status === 'completed',
    `auto-confirm completes sessions through their own settlement (${autoError ?? 'ok'})`);
  const settlement = await one(`select commission, gst_on_commission, total_amount, platform_fee from bookings where id = $1`, [session]);
  const expectedCommission = Math.round((settlement.total_amount - settlement.platform_fee) * 1100 / 10000);
  ok(settlement.commission === expectedCommission && settlement.gst_on_commission === Math.round(expectedCommission * 18 / 100),
    'one-off session payout uses the separately configured commission rate');
  const oneOffRate = (await as(provider, 'authenticated',
    `select get_booking_commission_rate($1) rate`, [session]))[0]?.rate;
  ok(oneOffRate === 1100, 'booking-rate RPC reports the configured one-off session rate');

  const repeatSession = await createSession(4);
  const repeatRate = (await as(provider, 'authenticated',
    `select get_booking_commission_rate($1) rate`, [repeatSession]))[0]?.rate;
  ok(repeatRate === 1100, 'time-based repeat customers do not receive the marketplace repeat discount');

  const recurringSchedule = (await one(`
    insert into recurring_schedules (
      customer_id, provider_id, provider_service_id, frequency, weekdays, start_time, timezone,
      session_duration_min, payment_mode, address_line, city, lat, lng, description, starts_on
    ) values (
      $1, $2, $3, 'weekly', array[1]::smallint[], time '10:00', 'Asia/Kolkata',
      60, 'per_session', 'Gate 2', 'Review City', 16.5, 80.6, '', current_date + 5
    ) returning id`, [customer, provider, sessionService])).id;
  const recurringSession = await createSession(5);
  await db.query(`update bookings set recurring_schedule_id = $2 where id = $1`, [recurringSession, recurringSchedule]);
  const recurringRate = (await as(provider, 'authenticated',
    `select get_booking_commission_rate($1) rate`, [recurringSession]))[0]?.rate;
  ok(recurringRate === 900, 'recurring session rate is independently configurable');
}
await as(admin, 'authenticated', `select admin_set_commission($1::jsonb)`, [JSON.stringify(sessionCommissionDefaults)]);
await db.query(`update providers set created_at = $2, jobs_completed = $3 where id = $1`, [
  provider, sessionProviderBefore.created_at, sessionProviderBefore.jobs_completed,
]);

// ---------- 2: an early cancellation records the refund once ----------
const session2 = await createSession().catch(() => null);
if (session2) {
  const prep = (await db.query(`select * from prepare_session_payment($1, $2, null)`, [session2, customer])).rows[0];
  await payLink(prep.payment_id, prep.amount, 'record_time_payment_paid');
  await as(customer, 'authenticated', `select cancel_session_booking($1, 'changed plans')`, [session2]).catch(async () =>
    db.query(`select _cancel_session_booking($1, $2, false, 'changed plans')`, [session2, customer]));
  const b = await one(`select status, refund_amount from bookings where id = $1`, [session2]);
  ok(b.status === 'cancelled' && b.refund_amount === prep.amount, `early session cancellation refunds once (${JSON.stringify(b)} vs ${prep.amount})`);
}

// ---------- proposal helpers ----------
let eventDay = 10;
const proposalBooking = async (
  pro, deliverables = '[]', advance = 300000, final = 700000,
  requester = customer, requesterAddress = address,
) => {
  eventDay += 3;
  const request = (await as(requester, 'authenticated', `
    select create_service_request($1, 'Review City', 'Area', now() + make_interval(days => $4), now() + make_interval(days => $4, hours => 4),
      '{"brief":"Coverage"}', 800000, 1200000, $2, null, $3) id`, [proposalCat, requesterAddress, pro, eventDay]))[0].id;
  const proposal = (await as(pro, 'authenticated', `
    select send_proposal($1, $2::jsonb, $3::jsonb, now()+interval '1 day', 'Proposal', $4::jsonb) id`, [request,
    JSON.stringify([{ kind: 'package', title: 'Coverage', qty: 1, unit: 'event', unit_price: advance + final }]),
    JSON.stringify([{ label: 'Advance', amount: advance, due_rule: 'at_booking' }, { label: 'Final', amount: final, due_rule: 'on_completion' }]),
    deliverables]))[0].id;
  return (await as(requester, 'authenticated', `select accept_proposal($1, $2) id`, [proposal, requesterAddress]))[0].id;
};
const payDue = async (booking) => {
  const prep = (await db.query(`select * from prepare_payment($1, $2)`, [booking, customer])).rows[0];
  await payLink(prep.payment_id, prep.amount);
  return prep.amount;
};

// ---------- 7: a proposal without deliverables can request completion ----------
const noDeliverables = await proposalBooking(provider);
const holdState = await one(`
  select b.status booking_status, p.status proposal_status, b.payment_hold_expires_at > now() hold_active
    from bookings b join proposals p on p.id = b.proposal_id where b.id = $1`, [noDeliverables]);
ok(holdState.booking_status === 'pending_payment' && holdState.proposal_status === 'accepted' && holdState.hold_active,
  'customer approval creates a 30-minute payment hold, not a confirmed job');
await payDue(noDeliverables);
ok((await one(`select status from bookings where id = $1`, [noDeliverables])).status === 'confirmed',
  'the creator job is confirmed for the provider only after the advance is paid');
await db.query(`update bookings set status = 'in_progress' where id = $1`, [noDeliverables]);
const completionError = await fails(() => as(provider, 'authenticated', `select request_completion($1)`, [noDeliverables]));
ok(!completionError && (await one(`select status from bookings where id = $1`, [noDeliverables])).status === 'completion_requested',
  `a proposal without deliverables can request completion (${completionError ?? 'ok'})`);

// ---------- 3: provider-caused cancellations refund in full; refunded payments don't reduce later refunds ----------
const paidBooking = await proposalBooking(provider);
const paidTotal = await payDue(paidBooking);
const providerCancel = (await one(`select _cancellation_outcome($1, 'provider', 'provider_cancellation', now()) o`, [paidBooking])).o;
ok(providerCancel.refund_amount === paidTotal && providerCancel.provider_compensation === 0,
  `provider cancellation two days before the event refunds the customer in full (${providerCancel.rule}, ${providerCancel.refund_amount}/${paidTotal})`);
const customerCancel = (await one(`select _cancellation_outcome($1, 'customer', 'customer_choice', now()) o`, [paidBooking])).o;
ok(customerCancel.rule !== 'not_customer_caused_full_refund', 'customer cancellations still follow the booking policy rules');
const stale = (await one(`
  insert into payments (booking_id, purpose, amount, status, razorpay_payment_id) values ($1, 'advance', 5000, 'refund_pending', 'gw_stale')
  returning id`, [paidBooking])).id;
await db.query(`insert into refunds (payment_id, amount, reason) values ($1, 5000, 'stale link')`, [stale]);
const afterStale = (await one(`select _cancellation_outcome($1, 'provider', 'provider_fault', now()) o`, [paidBooking])).o;
ok(afterStale.refund_amount === paidTotal, `a fully refunded stale payment does not reduce the cancellation refund (${afterStale.refund_amount}/${paidTotal})`);

// ---------- 10: payment default settles through the policy engine ----------
const defaulted = await proposalBooking(provider);
await payDue(defaulted);
await db.query(`
  update payment_schedule set status = 'due', due_at = now() - interval '3 days', reminded_at = now() - interval '2 days'
   where booking_id = $1 and status = 'upcoming'`, [defaulted]);
const defaultError = await fails(() => as(provider, 'authenticated', `select cancel_proposal_payment_default($1)`, [defaulted]));
const defaultedRow = await one(`select status, cancellation_outcome is not null as settled from bookings where id = $1`, [defaulted]);
ok(!defaultError && defaultedRow.status === 'cancelled' && defaultedRow.settled,
  `payment default cancels with a recorded refund/compensation outcome (${defaultError ?? 'ok'})`);

// ---------- 4: an expired hold refunds an obligation already paid ----------
const expiring = await proposalBooking(provider);
const feeRow = (await one(`select id, amount from payment_schedule where booking_id = $1 and obligation_kind = 'platform_fee'`, [expiring]));
const feeOnly = (await one(`insert into payments (booking_id, purpose, amount, schedule_id) values ($1, 'platform_fee', $2, $3) returning id`,
  [expiring, feeRow.amount, feeRow.id])).id;
await payLink(feeOnly, feeRow.amount);
await db.query(`update bookings set payment_hold_expires_at = now() - interval '1 minute' where id = $1`, [expiring]);
await db.query(`select expire_proposal_flows()`);
const expired = await one(`
  select b.status, (select coalesce(sum(r.amount), 0)::int from refunds r join payments p on p.id = r.payment_id where p.booking_id = b.id) refunded
    from bookings b where b.id = $1`, [expiring]);
ok(expired.status === 'expired' && expired.refunded === feeRow.amount, `expired hold refunds the fee already paid (${JSON.stringify(expired)})`);

// ---------- 6: provider links ----------
const linkError = await fails(() => as(provider, 'authenticated', `select save_provider_link('instagram', 'https://example.com/me', 'me')`));
ok(/does not match/.test(linkError ?? ''), 'an Instagram link must point at instagram.com');
await as(provider, 'authenticated', `select save_provider_link('instagram', 'https://www.instagram.com/me', 'me')`);
await db.query(`update provider_links set status = 'rejected' where provider_id = $1 and kind = 'instagram'`, [provider]);
await as(provider, 'authenticated', `select save_provider_link('instagram', 'https://www.instagram.com/me', 'new label')`);
ok((await one(`select status from provider_links where provider_id = $1 and kind = 'instagram'`, [provider])).status === 'rejected',
  'a label-only edit does not re-approve a rejected link');

// ---------- 12: demo settlement ----------
const demoBooking = await proposalBooking(demoPro);
const disabled = await fails(() => as(customer, 'authenticated', `select demo_settle_payment($1)`, [demoBooking]));
ok(/disabled/.test(disabled ?? ''), 'demo settlement is off unless enabled');
await db.exec(`update app_config set value = '{"enabled": true, "provider_ids": []}' where key = 'demo_payments'`);
await as(customer, 'authenticated', `select demo_settle_payment($1)`, [demoBooking]);
ok((await one(`select status from bookings where id = $1`, [demoBooking])).status === 'confirmed', 'demo settlement confirms a demo-provider booking');
const realBooking = await proposalBooking(provider);
const notDemo = await fails(() => as(customer, 'authenticated', `select demo_settle_payment($1)`, [realBooking]));
ok(/demo providers/.test(notDemo ?? ''), 'demo settlement never settles a real provider booking');

// ---------- 11: caller-supplied user ids are service-role only ----------
const denied = await fails(() => as(provider, 'authenticated', `select * from prepare_payment($1, $2)`, [realBooking, customer]));
ok(/permission denied/.test(denied ?? ''), 'signed-in users cannot call prepare_payment with another user id');

// ---------- 13: in-app notification centre (0032) ----------
if (session) {
  await db.query(`insert into messages (booking_id, sender_id, body) values ($1, $2, 'Reaching in 10 min')`, [session, provider]);
  await db.query(`select _queue_notification($1, 'booking_accepted', $2::uuid, 'Booking accepted', 'Accepted', jsonb_build_object('url', '/booking/' || $2::uuid::text, 'booking_id', $2::uuid))`, [customer, session]);
  const mine = await as(customer, 'authenticated', `select * from list_my_notifications(50)`);
  const chat = mine.find((n) => n.kind === 'chat_message' && n.booking_id === session);
  ok(chat && chat.title === 'Person' && chat.category_name === 'review-session' && chat.data.url === `/chat/${session}`,
    'chat notification lists sender, service name and chat link');
  ok(mine.every((n) => n.at), 'every notification has a timestamp');
  const unread = (await as(customer, 'authenticated', `select count_unread_notifications() n`))[0].n;
  ok(unread >= 1 && unread === mine.filter((n) => n.kind !== 'chat_message' && !n.read_at).length, `unread count excludes chats (${unread})`);
  ok((await as(provider, 'authenticated', `select mark_notifications_read($1::uuid[]) n`, [mine.map((n) => n.id)]))[0].n === 0,
    "a user cannot mark someone else's notifications read");
  ok(!(await as(provider, 'authenticated', `select * from list_my_notifications(50)`)).some((n) => mine.some((m) => m.id === n.id)),
    "a user never lists someone else's notifications");
  ok((await as(customer, 'authenticated', `select mark_notifications_read(null) n`))[0].n >= 1
    && (await as(customer, 'authenticated', `select count_unread_notifications() n`))[0].n === 0, 'mark all read clears the count');
  const heading = (await as(customer, 'authenticated', `select get_chat_heading($1) h`, [session]))[0].h;
  ok(heading?.name === 'Person' && heading?.category === 'review-session', 'chat heading gives the other person and the service');
  ok((await as(demoPro, 'authenticated', `select get_chat_heading($1) h`, [session]))[0].h === null, 'non-participants get no chat heading');
  ok(/permission denied/.test(await fails(() => as(null, 'anon', `select * from list_my_notifications(5)`)) ?? ''), 'anon cannot list notifications');
} else {
  ok(false, 'notification centre checks need the session booking');
}

// ---------- 14: no-services-nearby (0033) ----------
const live = await as(customer, 'authenticated', `select * from list_live_cities()`);
const reviewCity = live.find((c) => c.city === 'Review City');
ok(reviewCity && reviewCity.providers >= 1 && Math.abs(reviewCity.lat - 16.5) < 0.1 && Math.abs(reviewCity.lng - 80.6) < 0.1,
  `live cities list the launched city with a centre point (${JSON.stringify(reviewCity)})`);
ok((await as(customer, 'authenticated', `select join_city_waitlist('Hyderabad', 17.4, 78.4) j`))[0].j === true
  && (await as(customer, 'authenticated', `select join_city_waitlist(' hyderabad ', null, null) j`))[0].j === false,
  'joining a city waitlist is idempotent per user and case-insensitive');
ok((await as(customer, 'authenticated', `select on_city_waitlist('HYDERABAD') w`))[0].w === true
  && (await as(provider, 'authenticated', `select on_city_waitlist('Hyderabad') w`))[0].w === false, 'waitlist status is per user');
ok(/permission denied/.test(await fails(() => as(customer, 'authenticated', `select * from city_waitlist`)) ?? ''), 'customers cannot read the waitlist table');
ok(/permission denied/.test(await fails(() => as(null, 'anon', `select join_city_waitlist('Pune')`)) ?? ''), 'anon cannot join a waitlist');
const resolve = async (lat, lng, city = null) => (await as(customer, 'authenticated', `select resolve_service_city($1, $2, $3) c`, [lat, lng, city]))[0].c;
ok(await resolve(16.505, 80.605, 'Some Village') === 'Review City', 'a suburb inside a live provider radius resolves to the live city');
ok(await resolve(16.505, 80.605, 'review city') === 'review city', 'an already-live city name is kept');
ok(await resolve(17.4, 78.4, 'Hyderabad') === null, 'an area no live provider covers resolves to nothing');

// ---------- 15: targeted proposal requests route by the pro's radius (0034) ----------
{
  const near = (await one(`
    insert into addresses (user_id, label, line1, city, lat, lng)
    values ($1, 'Near', '1 Test St', 'Review City Demo', 16.505, 80.605) returning id`, [customer])).id;
  const req = (address) => as(customer, 'authenticated', `select create_service_request(
    p_category_id => $1, p_city => 'Review City Demo', p_area => 'A', p_event_start => now() + interval '40 days',
    p_event_end => now() + interval '40 days 2 hours', p_intake => '{}'::jsonb, p_budget_min => null, p_budget_max => null,
    p_address_id => $2, p_venue_text => 'Venue', p_provider_id => $3) r`, [proposalCat, address, provider]);
  ok(!(await fails(() => req(near))), 'a targeted request reaches a pro whose radius covers the address despite a different city name');
  ok(/not available in your city/.test(await fails(() => req(null)) ?? ''), 'without coordinates a targeted request still needs the same city');
  ok(!(await fails(() => as(customer, 'authenticated', `select create_service_request(
    p_category_id => $1, p_city => 'Review City Demo', p_area => 'A', p_event_start => now() + interval '50 days',
    p_event_end => now() + interval '50 days 2 hours', p_intake => '{}'::jsonb, p_budget_min => null, p_budget_max => null,
    p_address_id => null, p_venue_text => 'Venue', p_provider_id => $2, p_lat => 16.505, p_lng => 80.605) r`, [proposalCat, provider]))),
    'a targeted request from a GPS/default location (no saved address) is routed by its coordinates');
  const open = (await as(customer, 'authenticated', `select create_service_request(
    p_category_id => $1, p_city => 'Review City Demo', p_area => 'A', p_event_start => now() + interval '70 days',
    p_event_end => now() + interval '70 days 2 hours', p_intake => '{}'::jsonb, p_budget_min => null, p_budget_max => null,
    p_venue_text => 'Venue', p_lat => 16.505, p_lng => 80.605) r`, [proposalCat]))[0].r;
  ok((await one(`select count(*)::int n from request_recipients where request_id = $1 and provider_id = $2`, [open, provider])).n === 1,
    'an open request with coordinates reaches pros whose radius covers it despite a different city label');
  // 0037: the app sends now + 7 days, past the request's 7-day expiry.
  const capped = (await as(provider, 'authenticated', `
    select send_proposal($1, $2::jsonb, $3::jsonb, now() + interval '7 days', 'Proposal', '[]'::jsonb) id`, [open,
    JSON.stringify([{ kind: 'package', title: 'Reel', qty: 1, unit: 'event', unit_price: 1000000 }]),
    JSON.stringify([{ label: 'Advance', amount: 300000, due_rule: 'at_booking' }, { label: 'Final', amount: 700000, due_rule: 'on_completion' }])]))[0].id;
  ok((await one(`select (p.valid_until = r.expires_at) eq from proposals p join service_requests r on r.id = p.request_id where p.id = $1`, [capped])).eq,
    'a proposal valid past its request expiry is capped at the expiry instead of rejected');
  ok(/location is invalid/.test(await fails(() => as(customer, 'authenticated', `select create_service_request(
    p_category_id => $1, p_city => 'Review City', p_area => 'A', p_event_start => now() + interval '60 days',
    p_event_end => now() + interval '60 days 2 hours', p_intake => '{}'::jsonb, p_budget_min => null, p_budget_max => null,
    p_venue_text => 'Venue', p_lat => 95, p_lng => 80.6) r`, [proposalCat])) ?? ''), 'out-of-range coordinates are rejected');
}

// ---------- 16: provider city is the live service city around their base (0036) ----------
await db.query(`update providers set city = 'Some Village' where id = $1`, [demoPro]);
ok((await one(`select city from providers where id = $1`, [demoPro])).city === 'Review City', 'a provider saved with a village name inside a live area gets the live city');
await db.query(`update providers set city = 'Hyderabad', base_location = extensions.st_setsrid(extensions.st_makepoint(78.4, 17.4), 4326) where id = $1`, [demoPro]);
ok((await one(`select city from providers where id = $1`, [demoPro])).city === 'Hyderabad', 'a provider outside every live area keeps their own city');

// ---------- 17: proposal events respect the category notice period (0038) ----------
{
  const lead = (await one(`select min_lead_hours h from categories where id = $1`, [proposalCat])).h;
  await db.query(`update categories set min_lead_hours = 24 where id = $1`, [proposalCat]);
  const soon = await fails(() => as(customer, 'authenticated', `select create_service_request(
    p_category_id => $1, p_city => 'Review City', p_area => 'A', p_event_start => now() + interval '17 hours',
    p_event_end => now() + interval '20 hours', p_intake => '{}'::jsonb, p_budget_min => null, p_budget_max => null,
    p_venue_text => 'Venue') r`, [proposalCat]));
  ok(/needs at least 24 hours' notice/.test(soon ?? ''), 'a request inside the notice period is refused with a clear message');
  await db.query(`update categories set min_lead_hours = $2 where id = $1`, [proposalCat, lead]);
}

// ---------- 18: the customer gets a start code for a confirmed proposal booking (0039) ----------
{
  const booking = await proposalBooking(provider);
  await payDue(booking);
  ok((await one(`select status from bookings where id = $1`, [booking])).status === 'confirmed', 'a paid proposal booking is confirmed');
  const code = (await as(customer, 'authenticated', `select start_otp from get_booking_otps($1)`, [booking]))[0]?.start_otp;
  ok(/^\d{4}$/.test(code ?? ''), `the customer sees the start code once the advance is paid (${code})`);
  const regen = await fails(() => as(customer, 'authenticated', `select regenerate_otp($1, 'start')`, [booking]));
  const fresh = (await as(customer, 'authenticated', `select start_otp from get_booking_otps($1)`, [booking]))[0]?.start_otp;
  ok(!regen && /^\d{4}$/.test(fresh ?? ''), `the customer can regenerate the start code (${regen ?? 'ok'})`);
  await db.query(`update bookings set scheduled_at = now() where id = $1`, [booking]);
  const started = (await as(provider, 'authenticated', `select start_proposal_booking($1, $2) r`, [booking, fresh]))[0].r;
  ok(started.ok === true && (await one(`select status from bookings where id = $1`, [booking])).status === 'in_progress',
    `the provider starts work with the customer's code (${JSON.stringify(started)})`);
}

// ---------- 19: urgent proposal requests (0040) ----------
{
  const lead = (await one(`select min_lead_hours h from categories where id = $1`, [proposalCat])).h;
  await db.query(`update categories set min_lead_hours = 24 where id = $1`, [proposalCat]);
  const req = (hours, urgent) => as(customer, 'authenticated', `select create_service_request(
    p_category_id => $1, p_city => 'Review City', p_area => 'A', p_event_start => now() + make_interval(hours => $2),
    p_event_end => now() + make_interval(hours => $2 + 3), p_intake => '{}'::jsonb, p_budget_min => null, p_budget_max => null,
    p_address_id => $3, p_venue_text => null, p_provider_id => $4, p_urgent => $5) id`, [proposalCat, hours, address, provider, urgent]);
  const notUrgent = await fails(() => req(4, false));
  ok(/mark it urgent/.test(notUrgent ?? ''), 'a 4-hour event without urgent is refused and suggests urgent');
  const tooSoon = await fails(() => req(1, true));
  ok(/at least 2 hours/.test(tooSoon ?? ''), 'an urgent request still needs 2 hours');
  const request = (await req(4, true))[0].id;
  const r = await one(`select urgent, expires_at < event_start as expires_first from service_requests where id = $1`, [request]);
  ok(r.urgent && r.expires_first, 'an urgent request is flagged and expires before the event');
  const seen = (await as(provider, 'authenticated', `select urgent from service_request_provider_view where id = $1`, [request]))[0];
  ok(seen?.urgent === true, 'the pro sees the request as urgent');
  const note = await one(`select title from notifications where user_id = $1 and data->>'request_id' = $2::text`, [provider, request]);
  ok(note?.title === 'Urgent proposal request', `the pro is notified it is urgent (${note?.title})`);
  const proposal = (await as(provider, 'authenticated', `
    select send_proposal($1, $2::jsonb, $3::jsonb, now()+interval '1 day', 'Today', '[]'::jsonb) id`, [request,
    JSON.stringify([{ kind: 'package', title: 'Shoot', qty: 1, unit: 'event', unit_price: 500000 }]),
    JSON.stringify([{ label: 'Advance', amount: 200000, due_rule: 'at_booking' }, { label: 'Final', amount: 300000, due_rule: 'on_completion' }])]))[0].id;
  const acceptError = await fails(async () => {
    const booking = (await as(customer, 'authenticated', `select accept_proposal($1, $2) id`, [proposal, address]))[0].id;
    await payDue(booking);
    ok((await one(`select status from bookings where id = $1`, [booking])).status === 'confirmed', 'an urgent proposal is booked and confirmed');
  });
  ok(!acceptError, `an urgent proposal can be accepted inside the notice period (${acceptError ?? 'ok'})`);
  await db.query(`update categories set min_lead_hours = $2 where id = $1`, [proposalCat, lead]);
}

// ---------- 20: admin access, controls and support are end to end (0041) ----------
{
  ok((await as(customer, 'authenticated', `select am_i_admin() v`))[0].v === false, 'a normal user is not an admin');
  ok((await as(admin, 'authenticated', `select am_i_admin() v`))[0].v === true, 'the configured 8888888888 phone is an admin');
  const denied = await fails(() => as(customer, 'authenticated', `select admin_dashboard(30)`));
  ok(/admin only/.test(denied ?? ''), 'admin data is denied to a normal user');

  const dashboard = (await as(admin, 'authenticated', `select admin_dashboard(30) v`))[0]?.v;
  ok(typeof dashboard?.totals?.providers === 'number' && Array.isArray(dashboard?.daily), 'the admin dashboard returns totals and daily trends');

  const disabled = (await as(admin, 'authenticated', `select admin_set_feature('ai_assistant', false) v`))[0]?.v;
  ok(disabled.ai_assistant === false, 'the admin can disable AI globally');
  await as(admin, 'authenticated', `select admin_set_feature('ai_assistant', true)`);
  const gate = (await as(customer, 'authenticated', `select get_app_features()->>'ai_assistant' v`))[0]?.v;
  ok(gate === 'true', 'feature flags are readable by app users and the admin can re-enable AI');

  await db.query(`update categories set min_lead_hours = 24 where id = $1`, [proposalCat]);
  await as(admin, 'authenticated', `select admin_set_feature('urgent_requests', false)`);
  const urgentOff = await fails(() => as(customer, 'authenticated', `select create_service_request(
    p_category_id => $1, p_city => 'Review City', p_area => 'A', p_event_start => now() + interval '4 hours',
    p_event_end => now() + interval '7 hours', p_intake => '{}'::jsonb, p_budget_min => null, p_budget_max => null,
    p_address_id => $2, p_venue_text => null, p_provider_id => $3, p_urgent => true) id`,
    [proposalCat, address, provider]));
  ok(/turned off/.test(urgentOff ?? ''), 'turning urgent requests off is enforced in the database');
  await as(admin, 'authenticated', `select admin_set_feature('urgent_requests', true)`);
  await db.query(`update categories set min_lead_hours = 1 where id = $1`, [proposalCat]);

  await as(admin, 'authenticated', `select admin_set_category_active($1, false)`, [proposalCat]);
  ok((await one(`select active from categories where id = $1`, [proposalCat])).active === false, 'the admin can disable a service category');
  await as(admin, 'authenticated', `select admin_set_category_active($1, true)`, [proposalCat]);

  const supportId = (await as(customer, 'authenticated',
    `select support_start('Please help with my booking', null, 'Payment question') id`))[0].id;
  const inbox = (await as(admin, 'authenticated', `select * from admin_list_support_threads('open')`))
    .find((row) => row.id === supportId);
  ok(inbox?.admin_unread === 1 && inbox.subject === 'Payment question', 'the user message appears in the admin support inbox');
  const adminNotice = await one(`select count(*) n from notifications where user_id = $1 and kind = 'support_message'`, [admin]);
  ok(Number(adminNotice.n) >= 1, 'a support message notifies the admin');
  await as(admin, 'authenticated', `select support_send($1, 'I am checking this now')`, [supportId]);
  const reply = (await as(customer, 'authenticated',
    `select body, from_admin from support_messages where thread_id = $1 order by created_at desc limit 1`, [supportId]))[0];
  ok(reply?.from_admin === true && reply.body === 'I am checking this now', 'the admin reply is readable by the customer');
  await as(customer, 'authenticated', `select support_mark_read($1)`, [supportId]);
  ok((await one(`select user_unread from support_threads where id = $1`, [supportId])).user_unread === 0,
    'the customer can mark the support reply read');
  await as(admin, 'authenticated', `select support_set_status($1, 'closed')`, [supportId]);
  ok((await one(`select status from support_threads where id = $1`, [supportId])).status === 'closed', 'the admin can close the thread');
}

// ---------- 21: booking commission and coin cap use configurable policy (0043) ----------
{
  const commissionProviderBefore = await one(`select created_at, jobs_completed from providers where id = $1`, [provider]);
  await db.query(`
    update providers
       set city = 'Review City',
           base_location = extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
           kyc_status = 'verified',
           submitted_at = coalesce(submitted_at, now()),
           is_online = true,
           paused = false,
           suspended = false,
           created_at = now() - interval '60 days',
           jobs_completed = 0
     where id = $1`, [provider]);
  await db.query(`update categories set commission_bp = null where id = $1`, [proposalCat]);
  const booking = await proposalBooking(provider, '[]', 300000, 700000, commissionCustomer, commissionAddress);
  const baseRate = (await as(provider, 'authenticated',
    `select get_booking_commission_rate($1) rate`, [booking]))[0]?.rate;
  ok(baseRate === 1200, `booking rate preserves the existing 12% default (${baseRate})`);

  await as(admin, 'authenticated', `select admin_set_category_commission($1, 2000)`, [proposalCat]);
  const overrideRate = (await as(provider, 'authenticated',
    `select get_booking_commission_rate($1) rate`, [booking]))[0]?.rate;
  ok(overrideRate === 2000, `admin category override is applied to the booking (${overrideRate})`);

  const priorBooking = await proposalBooking(provider, '[]', 300000, 700000, commissionCustomer, commissionAddress);
  await db.query(`update bookings set status = 'completed', completed_at = now() where id = $1`, [priorBooking]);
  const repeatRate = (await as(provider, 'authenticated',
    `select get_booking_commission_rate($1) rate`, [booking]))[0]?.rate;
  ok(repeatRate === 1600, `repeat discount applies after category override (${repeatRate})`);

  await as(admin, 'authenticated', `select admin_set_category_commission($1, 500)`, [proposalCat]);
  const floorRate = (await as(provider, 'authenticated',
    `select get_booking_commission_rate($1) rate`, [booking]))[0]?.rate;
  ok(floorRate === 500, `repeat discount respects the configured minimum floor (${floorRate})`);
  const coinCap = await one(`
    select public._coin_platform_cap(b.id, b.approved_quote_id) cap,
           public._commission_bp(b.provider_id, b.customer_id, b.id, now()) as resolved_rate,
           q.subtotal_labour, b.platform_fee,
           greatest(
             round(q.subtotal_labour::numeric * $2 / 10000)
             + b.platform_fee
             - round(round(q.subtotal_labour::numeric * $2 / 10000) * 18 / 100),
             0
           )::int expected
      from bookings b join quotes q on q.id = b.approved_quote_id
     where b.id = $1`, [booking, floorRate]);
  ok(coinCap.resolved_rate === floorRate && coinCap.cap === coinCap.expected,
    `coin redemption platform cap matches the booking-aware payout rate (${JSON.stringify(coinCap)}, rate=${floorRate})`);
  await db.query(`update bookings set booking_origin = 'byo' where id = $1`, [booking]);
  const byoRate = (await as(provider, 'authenticated',
    `select get_booking_commission_rate($1) rate`, [booking]))[0]?.rate;
  const byoCoinCap = await one(`select public._coin_platform_cap($1, $2) cap`, [booking,
    (await one(`select approved_quote_id from bookings where id = $1`, [booking])).approved_quote_id]);
  ok(byoRate === 0 && byoCoinCap.cap === (await one(
    `select platform_fee from bookings where id = $1`, [booking])).platform_fee,
  'BYO bookings keep zero provider commission and cap coin redemption at the customer platform fee');
  await db.query(`update bookings set booking_origin = 'marketplace' where id = $1`, [booking]);
  const otherUserRate = await fails(() => as(customer, 'authenticated',
    `select get_booking_commission_rate($1)`, [booking]));
  ok(/booking not found/.test(otherUserRate ?? ''), 'another customer cannot read the provider booking commission');

  await as(admin, 'authenticated', `select admin_set_category_commission($1, null)`, [proposalCat]);
  await db.query(`update providers set created_at = $2, jobs_completed = $3 where id = $1`, [
    provider, commissionProviderBefore.created_at, commissionProviderBefore.jobs_completed,
  ]);
}

if (failures) process.exit(1);

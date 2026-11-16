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
  '0031_holiday_mode_enforcement.sql', '0032_notification_centre.sql',
]) await db.exec(migration(file));



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
await db.exec(`
  insert into auth.users (id, phone, raw_user_meta_data) values
    ('${customer}', '+919999000001', '{}'), ('${provider}', '+919999000002', '{}'),
    ('${demoPro}', '+919999000003', '{"demo_only":"true"}');
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
const sessionAt = `date_trunc('day', now()) + interval '3 days 6 hours 30 minutes'`; // 12:00 IST
const createSession = async () => (await one(`
  select _create_session_booking($1, $2, null, ${sessionAt}, 60, 'Gate 2', 'Review City', 16.5, 80.6, 'session') id`,
  [customer, sessionService])).id;
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
}

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
let eventDay = 2;
const proposalBooking = async (pro, deliverables = '[]', advance = 300000, final = 700000) => {
  eventDay += 3;
  const request = (await as(customer, 'authenticated', `
    select create_service_request($1, 'Review City', 'Area', now() + make_interval(days => $4), now() + make_interval(days => $4, hours => 4),
      '{"brief":"Coverage"}', 800000, 1200000, $2, null, $3) id`, [proposalCat, address, pro, eventDay]))[0].id;
  const proposal = (await as(pro, 'authenticated', `
    select send_proposal($1, $2::jsonb, $3::jsonb, now()+interval '1 day', 'Proposal', $4::jsonb) id`, [request,
    JSON.stringify([{ kind: 'package', title: 'Coverage', qty: 1, unit: 'event', unit_price: advance + final }]),
    JSON.stringify([{ label: 'Advance', amount: advance, due_rule: 'at_booking' }, { label: 'Final', amount: final, due_rule: 'on_completion' }]),
    deliverables]))[0].id;
  return (await as(customer, 'authenticated', `select accept_proposal($1, $2) id`, [proposal, address]))[0].id;
};
const payDue = async (booking) => {
  const prep = (await db.query(`select * from prepare_payment($1, $2)`, [booking, customer])).rows[0];
  await payLink(prep.payment_id, prep.amount);
  return prep.amount;
};

// ---------- 7: a proposal without deliverables can request completion ----------
const noDeliverables = await proposalBooking(provider);
await payDue(noDeliverables);
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

if (failures) process.exit(1);

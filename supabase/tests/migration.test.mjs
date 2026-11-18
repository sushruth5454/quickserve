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
const seed = fs.readFileSync(path.join(here, '..', 'seed.sql'), 'utf8');

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
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

// AI-assistant migrations 0004-0006 remain covered by their Deno tests, matching the PGlite chain.
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
  '0028_auto_approve_provider_links.sql', '0029_single_due_payment.sql', '0030_review_fixes.sql',
  '0031_holiday_mode_enforcement.sql', '0032_notification_centre.sql', '0033_city_waitlist.sql',
  '0034_targeted_request_radius.sql', '0035_request_coordinates.sql', '0036_provider_service_city.sql',
  '0037_proposal_validity_cap.sql', '0038_proposal_lead_time.sql', '0039_proposal_start_code.sql',
  '0040_urgent_proposals.sql', '0041_admin_support.sql', '0042_feature_registry.sql',
  '0043_commission_config.sql', '0044_creator_revisions.sql', '0045_preferred_language.sql',
  '0046_managed_geography.sql', '0047_coins_config.sql', '0048_sports.sql',
  '0049_shops_catalogue.sql', '0050_rfq.sql', '0051_ai_usage_v3.sql',
  '0052_merchant_staff.sql', '0053_activity_contracts.sql', '0054_addendum_foundations.sql',
  '0055_addendum_foundation_hardening.sql', '0056_home_services_catalogue.sql',
  '0057_recurring_plans_v2.sql', '0058_sports_payments.sql',
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
await db.exec(`update app_config set value = '"route"'::jsonb where key = 'payout_rail'`);
console.log('migration applied');

const C = '00000000-0000-0000-0000-00000000000c';
const P = '00000000-0000-0000-0000-00000000000a';
const X = '00000000-0000-0000-0000-00000000000e';
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log('FAIL:', msg); } else console.log('ok  :', msg); };

async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role;'); }
}
const asC = (s, p) => as(C, 'authenticated', s, p);
const asP = (s, p) => as(P, 'authenticated', s, p);
const asX = (s, p) => as(X, 'authenticated', s, p);
const svc = (s, p) => as(null, 'service_role', s, p);
async function expectError(fn, re, msg) {
  try { await fn(); ok(false, msg + ' (no error)'); } catch (e) { ok(re.test(e.message), `${msg} -> ${e.message}`); }
}

await db.exec(`insert into auth.users (id, phone) values ('${C}', '+919000000001'), ('${P}', '+919000000002'), ('${X}', '+919000000003');`);
await asP(`select upsert_provider_profile('Ravi', 'AC expert', 'Vijayawada', 15, 16.5062, 80.6480, 6, '{te,hi}')`);
await db.exec(`update providers set created_at = now() - interval '90 days', submitted_at = now() where id = '${P}'`);
await svc(`select sync_provider_kyc('${P}', 'acc_test123', 'activated')`);
const [{ id: catId }] = await db.query(`select id from categories where slug = 'ac-repair'`).then(r => r.rows);
const [{ id: psId }] = await asP(`insert into provider_services (provider_id, category_id, skill_level, visit_fee, labour_rate) values ($1, $2, 'expert', 19900, 50000) returning id`, [P, catId]);
await db.exec(`
  update categories
     set active = true, restricted = false, archetype = 'inspect_quote', requires_docs = '{}'
   where id = '${catId}';
  insert into app_config (key, value) values ('launch_city', '"Vijayawada"')
  on conflict (key) do update set value = excluded.value;
  update app_config set value = value || '{"inspect_quote":true}'::jsonb where key = 'archetype_flags';
  insert into category_cities (category_id, city, live, launched_at)
  values ('${catId}', 'Vijayawada', true, now())
  on conflict (category_id, city) do update set live = true, launched_at = excluded.launched_at;
`);

const search = await as(null, 'anon', `select * from search_providers('ac-repair', 16.51, 80.65)`);
ok(search.length === 1 && search[0]?.visit_fee === 19900, 'anon search finds verified provider: ' + JSON.stringify(search));
ok((search[0]?.score ?? 0) > 0, 'recommended score computed: ' + JSON.stringify(search[0] ?? null));
await expectError(() => asC(`select phone from private_user_accounts where user_id = '${P}'`).then(r => { if (r.length) throw new Error('leak'); throw new Error('no rows'); }), /no rows/, 'customer cannot read provider phone');
await expectError(() => asP(`update providers set kyc_status = 'verified' where id = '${P}'`), /permission denied/, 'provider cannot self-verify');

async function pay(bookingId, uid = C) {
  const [pp] = await svc(`select * from prepare_payment($1, $2)`, [bookingId, uid]);
  const link = 'plink_' + pp.payment_id.slice(0, 8);
  await svc(`update payments set razorpay_link_id = $1, short_url = 'https://rzp.io/x' where id = $2`, [link, pp.payment_id]);
  const [r] = await svc(`select record_payment_paid($1, $2, $3) as r`, [link, 'pay_' + pp.payment_id.slice(0, 8), pp.amount]);
  return { amount: pp.amount, purpose: pp.purpose, result: r.r, link, paymentId: 'pay_' + pp.payment_id.slice(0, 8) };
}
const status = async (id) => (await db.query(`select status from bookings where id = $1`, [id])).rows[0].status;

// ---- Happy path: worked example from doc 03 ----
const [{ create_booking: b1 }] = await asC(`select create_booking($1, 'AC not cooling', '12 MG Road', 'Vijayawada', 16.51, 80.64)`, [psId]);
ok(await status(b1) === 'pending_payment', 'booking starts pending_payment');
const v = await pay(b1);
ok(v.amount === 19900 && v.purpose === 'visit_fee', 'visit fee charged 199');
ok(await status(b1) === 'requested', 'webhook moves to requested');
const dup = await svc(`select record_payment_paid($1, $2, 19900) as r`, [v.link, v.paymentId]);
ok(dup[0].r.duplicate === true, 'webhook is idempotent by payment id');

const inbox = await asP(`select * from get_provider_jobs()`);
ok(inbox[0].address_line === null && inbox[0].area === 'Vijayawada' && inbox[0].distance_km !== null, 'provider sees only area+distance before accept');
await expectError(() => asP(`select * from booking_secrets`), /permission denied/, 'provider cannot read booking_secrets');
await expectError(() => asC(`select * from booking_secrets`), /permission denied/, 'customer cannot read booking_secrets directly');
await expectError(() => asP(`update bookings set status = 'completed' where id = '${b1}'`), /permission denied/, 'no direct booking update');
await expectError(() => asC(`select accept_booking('${b1}')`), /only the provider/, 'customer cannot accept');
await asP(`select accept_booking('${b1}')`);
ok((await asP(`select * from get_provider_jobs()`))[0].address_line === '12 MG Road', 'address visible after accept');
await asP(`select start_trip('${b1}')`);
const [otps] = await asC(`select * from get_booking_otps('${b1}')`);
ok(/^\d{4}$/.test(otps.start_otp) && otps.end_otp === null, 'customer sees start OTP only');
ok((await asP(`select * from get_booking_otps('${b1}')`)).length === 0, 'provider gets no OTPs from RPC');
const wrong = otps.start_otp === '0000' ? '1111' : '0000';
const [bad] = await asP(`select arrive($1, $2) as r`, [b1, wrong]);
ok(bad.r.ok === false && bad.r.attempts_left === 4, 'wrong OTP counted (attempt persisted)');
const [good] = await asP(`select arrive($1, $2) as r`, [b1, otps.start_otp]);
ok(good.r.ok === true && await status(b1) === 'inspecting', 'arrive with OTP -> inspecting');

const items = JSON.stringify([
  { kind: 'labour', title: 'Gas refill', qty: 1, unit_price: 150000 },
  { kind: 'part', title: 'Capacitor 45uF', qty: 1, unit_price: 65000 },
]);
const [{ send_quote: q1 }] = await asP(`select send_quote($1, $2::jsonb)`, [b1, items]);
ok(await status(b1) === 'quote_sent', 'quote_sent');
const [ap] = await asC(`select approve_quote($1, $2) as r`, [b1, q1]);
ok(ap.r.amount_due === 198000, 'balance due before work = 1980');
ok(await status(b1) === 'awaiting_payment', 'awaiting_payment');
await expectError(() => asP(`select request_completion('${b1}')`), /not in progress/, 'cannot complete before payment');
const bal = await pay(b1);
ok(bal.amount === 198000 && bal.purpose === 'balance', 'balance link amount 1980');
ok(await status(b1) === 'in_progress', 'balance webhook -> in_progress');
const [bk] = await db.query(`select total_amount, approved_quote_id from bookings where id = $1`, [b1]).then(r => r.rows);
ok(bk.total_amount === 217900 && bk.approved_quote_id === q1, 'customer total 2179, quote activated');

await asP(`select request_completion('${b1}')`);
const [otp2] = await asC(`select * from get_booking_otps('${b1}')`);
ok(/^\d{4}$/.test(otp2.end_otp) && otp2.start_otp === null, 'end OTP visible only after completion requested');
const [done] = await asP(`select complete_booking($1, $2) as r`, [b1, otp2.end_otp]);
ok(done.r.ok && await status(b1) === 'completed', 'completed with end OTP');
const [po] = await db.query(`select * from payouts where booking_id = $1`, [b1]).then(r => r.rows);
ok(po.gross === 215000 && po.commission === 18000 && po.gst_on_commission === 3240 && po.amount === 193760, 'payout 1937.60 (commission 180, GST 32.40)');
const tr = await db.query(`select t.amount, p.purpose from payout_transfers t join payments p on p.id = t.source_payment_id where t.payout_id = $1 order by t.created_at`, [po.id]).then(r => r.rows);
ok(tr.length === 2 && tr[0].purpose === 'visit_fee' && tr[0].amount === 19900 && tr[1].amount === 173860, 'transfers allocated visit fee first then balance');

await asC(`select submit_review($1::uuid, 5::int, 5::int, 5::int, 4::int, 5::int, 'Great'::text, '{}'::text[])`, [b1]);
const [prov] = await db.query(`select rating_avg, rating_count, jobs_completed from providers where id = $1`, [P]).then(r => r.rows);
ok(Number(prov.rating_avg) === 5 && prov.rating_count === 1 && prov.jobs_completed === 1, 'rating aggregate + jobs_completed updated');
await expectError(
  () => asC(`select submit_review($1::uuid, 4::int, null::int, null::int, null::int, null::int, null::text, '{}'::text[])`, [b1]),
  /already reviewed/,
  'one review per booking',
);

ok((await svc(`select * from claim_due_transfers()`)).length === 0, 'nothing released before 24h window');
await db.exec(`update payouts set release_after = now() - interval '1 minute' where id = '${po.id}'`);
const claimed = await svc(`select * from claim_due_transfers()`);
ok(claimed.length === 2 && claimed.every(c => c.account_id === 'acc_test123' && c.razorpay_payment_id), 'due transfers claimed with source payment ids');
for (const c of claimed) await svc(`select complete_transfer($1, $2)`, [c.transfer_id, 'trf_' + c.transfer_id.slice(0, 6)]);
ok(await status(b1) === 'closed', 'all transfers done -> closed');

// ---- Change orders ----
const [{ create_booking: b2 }] = await asC(`select create_booking($1, 'Wiring', '5 Ring Rd', 'Vijayawada', 16.52, 80.63)`, [psId]);
await pay(b2);
await asP(`select accept_booking('${b2}')`); await asP(`select start_trip('${b2}')`);
const [o2] = await asC(`select * from get_booking_otps('${b2}')`);
await asP(`select arrive($1, $2)`, [b2, o2.start_otp]);
const [{ send_quote: q2 }] = await asP(`select send_quote($1, $2::jsonb)`, [b2, items]);
await asC(`select approve_quote($1, $2)`, [b2, q2]);
await pay(b2);
const coItems = JSON.stringify([
  { kind: 'labour', title: 'Gas refill', qty: 1, unit_price: 150000 },
  { kind: 'labour', title: 'Coil cleaning', qty: 1, unit_price: 50000 },
  { kind: 'part', title: 'Capacitor 45uF', qty: 1, unit_price: 65000 },
]);
const [{ send_quote: q3 }] = await asP(`select send_quote($1, $2::jsonb)`, [b2, coItems]);
ok(await status(b2) === 'in_progress', 'change order keeps booking in_progress');
const [{ send_quote: q3b }] = await asP(`select send_quote($1, $2::jsonb)`, [b2, coItems]);
await asC(`select reject_quote($1, $2)`, [b2, q3b]);
ok(await status(b2) === 'in_progress', 'rejected change order: booking unchanged');
const [{ status: q3s }] = await db.query(`select status from quotes where id = $1`, [q3]).then(r => r.rows);
ok(q3s === 'superseded', 'older open change order superseded by newer one');
const [{ send_quote: q4 }] = await asP(`select send_quote($1, $2::jsonb)`, [b2, coItems]);
const [ap4] = await asC(`select approve_quote($1, $2) as r`, [b2, q4]);
ok(ap4.r.amount_due === 50000, 'change order charges only the increment (500)');
ok((await db.query(`select status from quotes where id = $1`, [q4])).rows[0].status === 'approved_pending_payment', 'quote approved_pending_payment');
await expectError(() => asP(`select request_completion('${b2}')`), /pending change order/, 'completion blocked while change order unpaid');
const inc = await pay(b2);
ok(inc.amount === 50000, 'increment link amount');
const [bk2] = await db.query(`select approved_quote_id, total_amount from bookings where id = $1`, [b2]).then(r => r.rows);
ok(bk2.approved_quote_id === q4 && bk2.total_amount === 267900, 'webhook activates change order');
ok((await db.query(`select status from quotes where id = $1`, [q2])).rows[0].status === 'superseded', 'previous approved quote superseded');
const cheaper = JSON.stringify([{ kind: 'labour', title: 'Gas refill', qty: 1, unit_price: 150000 }]);
const [{ send_quote: q5 }] = await asP(`select send_quote($1, $2::jsonb)`, [b2, cheaper]);
const [ap5] = await asC(`select approve_quote($1, $2) as r`, [b2, q5]);
ok(ap5.r.amount_due === 0 && (await db.query(`select approved_quote_id from bookings where id = $1`, [b2])).rows[0].approved_quote_id === q5, 'decrease approved immediately (overpay recorded)');
await asP(`select request_completion('${b2}')`);
await expectError(() => asP(`select dispute_booking('${b2}', 'x')`), /only the customer/, 'provider cannot dispute');
await asC(`select dispute_booking('${b2}', 'Not fixed')`);
ok(await status(b2) === 'disputed', 'disputed');
await expectError(() => asC(`select resolve_dispute('${b2}', 'denied')`), /admin only/, 'non-admin cannot resolve');
await db.exec(`insert into admins (user_id) values ('${X}')`);
await asX(`select resolve_dispute('${b2}', 'partial_refund', 10000, 'partial')`);
const [po2] = await db.query(`select * from payouts where booking_id = $1`, [b2]).then(r => r.rows);
ok(await status(b2) === 'completed' && po2.status === 'pending', 'partial refund -> completed, payout pending');
const sum2 = (await db.query(`select sum(amount)::int s from payout_transfers where payout_id = $1`, [po2.id])).rows[0].s;
ok(sum2 === po2.amount, 'transfers re-allocated to reduced payout');

// ---- Initial quote rejected -> closed_no_work + visit fee payout ----
const [{ create_booking: b3 }] = await asC(`select create_booking($1, 'Noise', '9 Canal Rd', 'Vijayawada', 16.50, 80.62)`, [psId]);
await pay(b3);
await asP(`select accept_booking('${b3}')`); await asP(`select start_trip('${b3}')`);
const [o3] = await asC(`select * from get_booking_otps('${b3}')`);
await asP(`select arrive($1, $2)`, [b3, o3.start_otp]);
const [{ send_quote: q6 }] = await asP(`select send_quote($1, $2::jsonb)`, [b3, items]);
await asC(`select reject_quote($1, $2)`, [b3, q6]);
const [po3] = await db.query(`select * from payouts where booking_id = $1`, [b3]).then(r => r.rows);
ok(await status(b3) === 'closed_no_work' && po3.gross === 19900 && po3.commission === 2388 && po3.gst_on_commission === 430 && po3.amount === 17082, 'closed_no_work visit-fee payout 170.82');

// ---- Cancellation / expiry / OTP lockout / auto-confirm ----
const [{ create_booking: b4 }] = await asC(`select create_booking($1, 'x', '1 St', 'Vijayawada', 16.5, 80.6)`, [psId]);
await pay(b4);
await asC(`select cancel_booking('${b4}', 'changed mind')`);
ok((await db.query(`select status from payments where booking_id = $1`, [b4])).rows[0].status === 'refund_pending', 'cancel before accept -> refund pending');
const [{ create_booking: b5 }] = await asC(`select create_booking($1, 'x', '1 St', 'Vijayawada', 16.5, 80.6)`, [psId]);
await pay(b5);
await db.exec(`update bookings set updated_at = now() - interval '20 minutes' where id = '${b5}'`);
const [{ expire_stale_requests: n }] = await svc(`select expire_stale_requests()`);
ok(n === 1 && await status(b5) === 'expired', 'stale request expired');
const [{ create_booking: b6 }] = await asC(`select create_booking($1, 'x', '1 St', 'Vijayawada', 16.5, 80.6)`, [psId]);
await pay(b6);
await asP(`select accept_booking('${b6}')`); await asP(`select start_trip('${b6}')`);
for (let i = 0; i < 5; i++) await asP(`select arrive($1, 'abcd')`, [b6]);
const [o6] = await asC(`select * from get_booking_otps('${b6}')`);
const [locked] = await asP(`select arrive($1, $2) as r`, [b6, o6.start_otp]);
ok(locked.r.error === 'locked' && o6.start_locked === true, 'OTP locked after 5 attempts');
await asC(`select regenerate_otp('${b6}', 'start')`);
const [o6b] = await asC(`select * from get_booking_otps('${b6}')`);
ok((await asP(`select arrive($1, $2) as r`, [b6, o6b.start_otp]))[0].r.ok === true, 'regenerated OTP works');
const [{ send_quote: q7 }] = await asP(`select send_quote($1, $2::jsonb)`, [b6, items]);
await asC(`select approve_quote($1, $2)`, [b6, q7]); await pay(b6);
await asP(`select request_completion('${b6}')`);
await db.exec(`update bookings set completion_requested_at = now() - interval '25 hours' where id = '${b6}'`);
await svc(`select auto_confirm_completions()`);
ok(await status(b6) === 'completed', 'auto-confirm after 24h');
const [{ create_booking: b7 }] = await asC(`select create_booking($1, 'x', '1 St', 'Vijayawada', 16.5, 80.6)`, [psId]);
await pay(b7);
await asP(`select accept_booking('${b7}')`); await asP(`select start_trip('${b7}')`);
await asC(`select cancel_booking('${b7}', 'late')`);
ok((await db.query(`select amount from payouts where booking_id = $1`, [b7])).rows[0]?.amount === 17082, 'cancel after en_route -> visit fee payout');

// ---- Regression tests for code-review findings ----
async function section(name, fn) {
  try { await fn(); } catch (e) { failures++; console.log(`FAIL: [${name}] threw: ${e.message}`); }
}
const labour = (paise) => JSON.stringify([{ kind: 'labour', title: 'Work', qty: 1, unit_price: paise }]);
async function driveToInProgress(quotePaise) {
  const [{ create_booking: id }] = await asC(`select create_booking($1, 'x', '1 St', 'Vijayawada', 16.5, 80.6)`, [psId]);
  await pay(id);
  await asP(`select accept_booking('${id}')`); await asP(`select start_trip('${id}')`);
  const [o] = await asC(`select * from get_booking_otps('${id}')`);
  await asP(`select arrive($1, $2)`, [id, o.start_otp]);
  const [{ send_quote: q }] = await asP(`select send_quote($1, $2::jsonb)`, [id, labour(quotePaise)]);
  await asC(`select approve_quote($1, $2)`, [id, q]);
  await pay(id);
  return id;
}
async function driveToCompleted(quotePaise) {
  const id = await driveToInProgress(quotePaise);
  await asP(`select request_completion('${id}')`);
  await asC(`select confirm_completion('${id}')`);
  return id;
}
const paidTotal = async (id) => (await db.query(`select coalesce(sum(amount), 0)::int s from payments where booking_id = $1 and status = 'paid'`, [id])).rows[0].s;

await section('bug1 stale link', async () => {
  const s1 = await driveToInProgress(100000);
  ok(await paidTotal(s1) === 102900, 'bug1: initial ₹1,029 collected');
  const [{ send_quote: co1 }] = await asP(`select send_quote($1, $2::jsonb)`, [s1, labour(150000)]);
  await asC(`select approve_quote($1, $2)`, [s1, co1]);
  const [l1] = await svc(`select * from prepare_payment($1, $2)`, [s1, C]);
  ok(l1.amount === 50000, 'bug1: CO1 increment link ₹500');
  await svc(`update payments set razorpay_link_id = 'plink_L1', short_url = 'https://rzp.io/L1' where id = $1`, [l1.payment_id]);
  const [{ send_quote: co2 }] = await asP(`select send_quote($1, $2::jsonb)`, [s1, labour(120000)]);
  const [retired] = (await db.query(`select status from payments where id = $1`, [l1.payment_id])).rows;
  ok(retired.status === 'failed', 'bug1: superseded change-order link retired');
  const queued = await svc(`select * from claim_link_cancellations($1)`, [s1]);
  ok(queued.some((x) => x.razorpay_link_id === 'plink_L1'), 'bug1: retired link queued for cancellation at Razorpay');
  const [r] = await svc(`select record_payment_paid('plink_L1', 'pay_L1', 50000) as r`);
  ok(r.r.ok === true, 'bug1: late payment acknowledged');
  const [after] = (await db.query(`select status from payments where id = $1`, [l1.payment_id])).rows;
  ok(after.status === 'refund_pending', 'bug1: stale link payment -> refund_pending, not paid');
  ok(await paidTotal(s1) === 102900, 'bug1: paid total unchanged at ₹1,029');
  await asC(`select reject_quote($1, $2)`, [s1, co2]);
  await asP(`select request_completion('${s1}')`); await asC(`select confirm_completion('${s1}')`);
  const refunds = (await db.query(`select r.amount from refunds r join payments p on p.id = r.payment_id where p.booking_id = $1`, [s1])).rows;
  ok(refunds.length === 1 && refunds[0].amount === 50000, 'bug1: refund row queued for the stale ₹500');
  const links = await svc(`select * from claim_link_cancellations()`);
  ok(links.some((x) => x.razorpay_link_id === 'plink_L1') === false, 'bug1: paid link not re-cancelled');
});

await section('bug1 overpay guard', async () => {
  const s = await driveToInProgress(100000);
  const [{ send_quote: co }] = await asP(`select send_quote($1, $2::jsonb)`, [s, labour(150000)]);
  await asC(`select approve_quote($1, $2)`, [s, co]);
  const [l] = await svc(`select * from prepare_payment($1, $2)`, [s, C]);
  await svc(`update payments set razorpay_link_id = 'plink_OP', short_url = 'x' where id = $1`, [l.payment_id]);
  // Simulate an out-of-band payment that already covered the increment.
  await db.exec(`insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at) values ('${s}', 'balance', 50000, 'paid', 'pay_manual', now())`);
  await svc(`select record_payment_paid('plink_OP', 'pay_OP', 50000)`);
  ok((await db.query(`select status from payments where id = $1`, [l.payment_id])).rows[0].status === 'refund_pending', 'bug1: payment exceeding required total -> refund_pending');
});

await section('bug2 full refund amount', async () => {
  const s = await driveToCompleted(100000);
  await asC(`select dispute_booking('${s}', 'bad')`);
  await asX(`select resolve_dispute('${s}', 'full_refund')`);
  const [bk] = (await db.query(`select refund_amount, status from bookings where id = $1`, [s])).rows;
  ok(bk.status === 'refunded' && bk.refund_amount === 102900, 'bug2: full refund records ₹1,029 refund_amount');
  const sum = (await db.query(`select coalesce(sum(r.amount), 0)::int s from refunds r join payments p on p.id = r.payment_id where p.booking_id = $1`, [s])).rows[0].s;
  ok(sum === 102900, 'bug2: refund rows cover every paid payment');
});

await section('bug3 transient transfer failure', async () => {
  const s = await driveToCompleted(100000);
  const [po] = (await db.query(`select id from payouts where booking_id = $1`, [s])).rows;
  await db.exec(`update payouts set release_after = now() - interval '1 minute' where id = '${po.id}'`);
  const first = (await svc(`select * from claim_due_transfers()`)).filter((t) => t.payout_id === po.id);
  ok(first.length === 2, 'bug3: two transfers claimed');
  await svc(`select fail_transfer($1, 'timeout')`, [first[0].transfer_id]);
  const [pst] = (await db.query(`select status from payouts where id = $1`, [po.id])).rows;
  ok(pst.status === 'pending', 'bug3: one transfer failure keeps payout pending');
  const [tst] = (await db.query(`select status, attempts, next_attempt_at > now() as later from payout_transfers where id = $1`, [first[0].transfer_id])).rows;
  ok(tst.status === 'pending' && tst.attempts === 1 && tst.later, 'bug3: transfer retried with backoff');
  await svc(`select complete_transfer($1, 'trf_ok')`, [first[1].transfer_id]);
  ok((await svc(`select * from claim_due_transfers()`)).every((t) => t.transfer_id !== first[0].transfer_id), 'bug3: not retried before backoff');
  await db.exec(`update payout_transfers set next_attempt_at = now() - interval '1 second' where id = '${first[0].transfer_id}'`);
  const again = (await svc(`select * from claim_due_transfers()`)).filter((t) => t.transfer_id === first[0].transfer_id);
  ok(again.length === 1 && again[0].attempts === 1, 'bug3: retried after backoff with attempt count');
  for (let i = 0; i < 4; i++) {
    await svc(`select fail_transfer($1, 'boom')`, [first[0].transfer_id]);
    await db.exec(`update payout_transfers set next_attempt_at = now() - interval '1 second' where id = '${first[0].transfer_id}'`);
    if (i < 3) await svc(`select * from claim_due_transfers()`);
  }
  const [t5] = (await db.query(`select status from payout_transfers where id = $1`, [first[0].transfer_id])).rows;
  const [p5] = (await db.query(`select status from payouts where id = $1`, [po.id])).rows;
  ok(t5.status === 'failed' && p5.status === 'failed', 'bug3: after 5 attempts transfer failed and payout flagged');
  await svc(`select retry_payout($1)`, [po.id]);
  const retried = (await svc(`select * from claim_due_transfers()`)).filter((t) => t.payout_id === po.id);
  ok(retried.length === 1, 'bug3: retry_payout makes the failed transfer claimable again');
  await svc(`select complete_transfer($1, 'trf_ok2')`, [retried[0].transfer_id]);
  ok(await status(s) === 'closed', 'bug3: payout completes after retry');
});

await section('bug4 frozen payout not overwritten', async () => {
  const s = await driveToCompleted(100000);
  const [po] = (await db.query(`select id from payouts where booking_id = $1`, [s])).rows;
  await db.exec(`update payouts set release_after = now() - interval '1 minute' where id = '${po.id}'`);
  const claimed = (await svc(`select * from claim_due_transfers()`)).filter((t) => t.payout_id === po.id);
  await db.exec(`update payouts set status = 'frozen' where id = '${po.id}'`);
  for (const t of claimed) await svc(`select complete_transfer($1, $2)`, [t.transfer_id, 'trf_' + t.transfer_id.slice(0, 6)]);
  ok((await db.query(`select status from payouts where id = $1`, [po.id])).rows[0].status === 'frozen', 'bug4: complete_transfer keeps a frozen payout frozen');
  ok(await status(s) === 'completed', 'bug4: frozen payout does not close booking');
  const s2 = await driveToCompleted(100000);
  const [po2] = (await db.query(`select id from payouts where booking_id = $1`, [s2])).rows;
  await db.exec(`update payouts set release_after = now() - interval '1 minute', status = 'frozen' where id = '${po2.id}'`);
  ok((await svc(`select * from claim_due_transfers()`)).every((t) => t.payout_id !== po2.id), 'bug4: claim skips non-pending payouts');
});

await section('bug5 refunds processed', async () => {
  const [{ create_booking: d }] = await asC(`select create_booking($1, 'x', '1 St', 'Vijayawada', 16.5, 80.6)`, [psId]);
  await pay(d);
  await db.exec(`insert into payments (booking_id, purpose, amount, status) values ('${d}', 'balance', 1000, 'paid')`);
  await asP(`select decline_booking('${d}')`);
  const rows = (await db.query(`select purpose, status, razorpay_payment_id from payments where booking_id = $1 order by amount`, [d])).rows;
  ok(rows[0].status === 'failed', 'bug5: payment without razorpay_payment_id marked failed, not refunded');
  const claimed = (await svc(`select * from claim_due_refunds()`)).filter((r) => r.booking_id === d);
  ok(claimed.length === 1 && claimed[0].amount === 19900 && claimed[0].razorpay_payment_id, 'bug5: visit-fee refund claimed');
  ok((await db.query(`select status from payments where razorpay_payment_id = $1`, [claimed[0].razorpay_payment_id])).rows[0].status === 'refund_processing', 'bug5: payment refund_processing while in flight');
  ok((await svc(`select * from claim_due_refunds()`)).every((r) => r.refund_id !== claimed[0].refund_id), 'bug5: claimed refund not double-claimed');
  await svc(`select complete_refund($1, 'rfnd_1')`, [claimed[0].refund_id]);
  ok((await db.query(`select status from payments where razorpay_payment_id = $1`, [claimed[0].razorpay_payment_id])).rows[0].status === 'refunded', 'bug5: payment refunded');

  const s = await driveToCompleted(100000);
  await asC(`select dispute_booking('${s}', 'partly bad')`);
  await asX(`select resolve_dispute('${s}', 'partial_refund', 10000, 'partial')`);
  const pr = (await db.query(`select r.amount, r.status from refunds r join payments p on p.id = r.payment_id where p.booking_id = $1`, [s])).rows;
  ok(pr.length === 1 && pr[0].amount === 10000 && pr[0].status === 'pending', 'bug5: partial dispute creates ₹100 refund row');
  const pc = (await svc(`select * from claim_due_refunds()`)).filter((r) => r.booking_id === s);
  await svc(`select fail_refund($1, 'gateway down')`, [pc[0].refund_id]);
  const [rf] = (await db.query(`select status, attempts from refunds where id = $1`, [pc[0].refund_id])).rows;
  ok(rf.status === 'pending' && rf.attempts === 1, 'bug5: failed refund is retried with backoff');
  ok((await db.query(`select status from payments where razorpay_payment_id = $1`, [pc[0].razorpay_payment_id])).rows[0].status === 'paid', 'bug5: partially refunded payment stays paid');
});

await section('chat unread, read state and notifications outbox', async () => {
  const pending = async (uid, kind) => (await db.query(
    `select * from notifications where user_id = $1 and kind = $2 order by created_at desc`, [uid, kind])).rows;
  const unreadFor = async (fn, id) => (await fn(`select * from get_unread_counts()`)).find((r) => r.booking_id === id);
  const send = (fn, uid, id, body) => fn(`insert into messages (booking_id, sender_id, body) values ($1, $2, $3)`, [id, uid, body]);

  const [{ create_booking: n1 }] = await asC(`select create_booking($1, 'x', '1 St', 'Vijayawada', 16.5, 80.6)`, [psId]);
  await pay(n1);
  const req = (await pending(P, 'booking_requested')).find((r) => r.booking_id === n1);
  ok(req && req.status === 'pending' && req.data.url === `/booking/${n1}`, 'outbox: provider notified of new request with deep link');
  await asP(`select accept_booking('${n1}')`);
  ok((await pending(C, 'booking_accepted')).some((r) => r.booking_id === n1), 'outbox: customer notified of acceptance');
  ok(!(await pending(P, 'booking_accepted')).some((r) => r.booking_id === n1), 'outbox: actor is never notified');

  await send(asC, C, n1, 'Call me on +91 98765 43210 or see https://example.com/x');
  const u1 = await unreadFor(asP, n1);
  ok(u1 && u1.unread === 1 && u1.role === 'provider', 'unread: message counts for the other participant');
  ok(!(await unreadFor(asC, n1)), 'unread: sender\'s own message never counts');
  let [chat] = (await pending(P, 'chat_message')).filter((r) => r.booking_id === n1 && r.status === 'pending');
  ok(chat && chat.body.includes('[number]') && chat.body.includes('[link]') && !/98765/.test(chat.body), 'outbox: chat preview masks phone and link: ' + chat?.body);
  ok(chat && chat.data.url === `/chat/${n1}`, 'outbox: chat push deep-links to the chat');
  await send(asC, C, n1, 'second');
  [chat] = (await pending(P, 'chat_message')).filter((r) => r.booking_id === n1 && r.status === 'pending');
  ok((await pending(P, 'chat_message')).filter((r) => r.booking_id === n1).length === 1 && chat.count === 2 && chat.body === 'second',
    'outbox: pending chat pushes collapse into one row (count 2, latest text)');
  ok((await unreadFor(asP, n1)).unread === 2, 'unread: two messages');

  // Outsiders
  ok((await asX(`select * from booking_chat_reads`)).length === 0, 'rls: outsider sees no read state');
  ok((await asX(`select * from get_chat_read_state('${n1}')`)).length === 0, 'rls: outsider gets no chat read state');
  ok((await asX(`select * from notifications`)).length === 0, 'rls: outsider sees no notifications');
  await expectError(() => asX(`select mark_chat_read('${n1}')`), /not a participant/, 'rls: outsider cannot mark read');
  await expectError(() => asP(`insert into booking_chat_reads (booking_id, user_id) values ('${n1}', '${P}')`), /permission denied/, 'rls: no direct read-state writes');
  await expectError(() => asP(`update notifications set status = 'sent'`), /permission denied/, 'rls: no direct outbox writes');
  await expectError(() => asP(`select * from claim_due_notifications()`), /permission denied/, 'rls: clients cannot claim the outbox');
  ok((await asP(`select * from booking_chat_reads`)).every((r) => r.user_id === P), 'rls: read state is owner-only');

  await asP(`select mark_chat_read('${n1}')`);
  await asP(`select mark_chat_read('${n1}')`);
  ok(!(await unreadFor(asP, n1)), 'mark_chat_read clears unread (idempotent)');
  ok((await pending(P, 'chat_message')).find((r) => r.booking_id === n1).status === 'skipped', 'mark_chat_read drops the pending chat push');
  const [rs] = await asC(`select * from get_chat_read_state('${n1}')`);
  ok(rs.other_last_read_at !== null && rs.my_last_read_at !== null, 'read state: sender sees when the other side read (Seen)');

  await asP(`select mark_chat_read('${n1}', true)`);
  await send(asC, C, n1, 'while viewing');
  ok(!(await pending(P, 'chat_message')).some((r) => r.booking_id === n1 && r.status === 'pending'), 'presence: no push while the chat is open');
  await asP(`select mark_chat_read('${n1}', false)`);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await send(asC, C, n1, 'after leaving');
  ok((await pending(P, 'chat_message')).some((r) => r.booking_id === n1 && r.status === 'pending'), 'presence: push again after leaving the chat');

  // Delivery: no device -> skipped; with device -> claimed, sent, ticket stored, receipts resolved, dead tokens removed.
  // Isolate this assertion from unrelated request/acceptance notifications for the same booking.
  await db.exec(`update notifications set status = 'skipped' where status = 'pending'
    and not (booking_id = '${n1}' and kind = 'chat_message')`);
  let claimed = await svc(`select * from claim_due_notifications()`);
  ok(claimed.length === 0 && (await pending(P, 'chat_message')).find((r) => r.booking_id === n1 && r.body === 'after leaving').last_error === 'no_device',
    'delivery: users without devices are skipped');
  await expectError(() => asP(`select register_push_device('not-a-token', 'ios')`), /invalid push token/, 'devices: token format validated');
  const tok = 'ExponentPushToken[test-device-0001]';
  await asP(`select register_push_device($1, 'android')`, [tok]);
  await asP(`select register_push_device($1, 'android')`, [tok]);
  ok((await asP(`select * from push_devices`)).length === 1 && (await asC(`select * from push_devices`)).length === 0, 'devices: idempotent, owner-only');
  await send(asC, C, n1, 'are you coming?');
  claimed = await svc(`select * from claim_due_notifications()`);
  const c1 = claimed.find((r) => r.booking_id === n1);
  ok(c1 && c1.tokens.length === 1 && c1.tokens[0] === tok && c1.unread === 2 && c1.badge >= 2 && c1.title.length > 0,
    'delivery: claim returns tokens, fresh unread and badge');
  ok((await svc(`select * from claim_due_notifications()`)).length === 0, 'delivery: claimed rows are not claimed twice');
  await svc(`select finish_notification($1, true, null, $2::jsonb, '{}')`, [c1.id, JSON.stringify([{ id: 'tk-1', token: tok }])]);
  ok((await db.query(`select status, sent_at from notifications where id = $1`, [c1.id])).rows[0].status === 'sent', 'delivery: sent');
  await send(asC, C, n1, 'retry me');
  const [c2] = await svc(`select * from claim_due_notifications()`);
  await svc(`select finish_notification($1, false, 'expo 503')`, [c2.id]);
  const [r2] = (await db.query(`select status, attempts, next_attempt_at > now() as later from notifications where id = $1`, [c2.id])).rows;
  ok(r2.status === 'pending' && r2.attempts === 1 && r2.later, 'delivery: failures retry with backoff');
  await db.exec(`update push_tickets set created_at = now() - interval '20 minutes'`);
  const due = await svc(`select * from claim_push_receipts()`);
  ok(due.length === 1 && due[0].ticket_id === 'tk-1', 'receipts: due after 15 minutes');
  await svc(`select resolve_push_receipts(array['tk-1'], array[$1])`, [tok]);
  ok((await db.query(`select count(*)::int c from push_tickets`)).rows[0].c === 0 && (await asP(`select * from push_devices`)).length === 0,
    'receipts: resolved tickets dropped and DeviceNotRegistered token removed');
  await asP(`select register_push_device($1, 'ios')`, [tok]);
  await asC(`select register_push_device($1, 'ios')`, [tok]);
  ok((await asP(`select * from push_devices`)).length === 0 && (await asC(`select * from push_devices`)).length === 1, 'devices: token moves to the user signed in on the device');
  await asC(`select unregister_push_device($1)`, [tok]);
  ok((await asC(`select * from push_devices`)).length === 0, 'devices: removed on logout');

  // Seeds/imports/backfills insert back-dated rows: read state updates, but nothing is pushed.
  const before = (await db.query(`select count(*)::int c from notifications`)).rows[0].c;
  await db.query(`insert into booking_events (booking_id, actor_id, from_status, to_status, at) values ($1, $2, 'accepted', 'en_route', now() - interval '1 day')`, [n1, P]);
  await db.query(`insert into messages (booking_id, sender_id, body, created_at) values ($1, $2, 'old import', now() - interval '1 day')`, [n1, P]);
  ok((await db.query(`select count(*)::int c from notifications`)).rows[0].c === before, 'freshness: back-dated events and messages queue no push');
});

// ---- RLS spot checks ----
ok((await asX(`select * from bookings`)).length === 0, 'stranger sees no bookings');
ok((await asC(`select * from payouts`)).length === 0, 'customer sees no payouts');
await expectError(() => asX(`insert into messages (booking_id, sender_id, body) values ('${b1}', '${X}', 'hi')`), /row-level security/, 'stranger cannot post chat');
await asC(`insert into messages (booking_id, sender_id, body) values ('${b1}', '${C}', 'hello')`);
ok((await asP(`select body from messages where booking_id = '${b1}'`)).length === 1, 'participant reads chat');
await asX(`select set_provider_suspended('${P}', true, 'test')`);
ok((await as(null, 'anon', `select * from search_providers('ac-repair')`)).length === 0, 'suspended provider hidden');

// ---- Seed applies cleanly ----
await db.exec(seed);
ok((await as(null, 'anon', `select * from search_providers('ac-repair', 16.51, 80.65)`)).length === 1, 'seed: demo AC provider searchable');
ok((await as(null, 'anon', `select * from search_providers('plumber', 16.51, 80.65, 'distance')`)).length === 1, 'seed: demo plumber searchable');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);

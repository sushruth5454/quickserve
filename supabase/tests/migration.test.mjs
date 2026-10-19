import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const raw = fs.readFileSync(path.join(here, '..', 'migrations', '0001_init.sql'), 'utf8');
const seed = fs.readFileSync(path.join(here, '..', 'seed.sql'), 'utf8');
const migration = raw
  .replace('create extension if not exists postgis with schema extensions;', '')
  .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
  .replaceAll('using gist', 'using btree');

const prelude = `
create schema if not exists extensions;
create type extensions.geography as (lng float8, lat float8);
create function extensions.st_makepoint(x float8, y float8) returns extensions.geography language sql immutable as $$ select row(x, y)::extensions.geography $$;
create function extensions.st_setsrid(g extensions.geography, srid int) returns extensions.geography language sql immutable as $$ select g $$;
create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8 language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(b.lat - a.lat) / 2), 2) + cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - a.lng) / 2), 2))) $$;
create function extensions.st_dwithin(a extensions.geography, b extensions.geography, d float8) returns boolean language sql immutable as $$ select extensions.st_distance(a, b) <= d $$;
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
await db.exec(`update providers set created_at = now() - interval '90 days' where id = '${P}'`);
await svc(`select sync_provider_kyc('${P}', 'acc_test123', 'activated')`);
const [{ id: catId }] = await db.query(`select id from categories where slug = 'ac-repair'`).then(r => r.rows);
const [{ id: psId }] = await asP(`insert into provider_services (provider_id, category_id, skill_level, visit_fee, labour_rate) values ($1, $2, 'expert', 19900, 50000) returning id`, [P, catId]);

const search = await as(null, 'anon', `select * from search_providers('ac-repair', 16.51, 80.65)`);
ok(search.length === 1 && search[0].visit_fee === 19900, 'anon search finds verified provider');
ok(search[0].score > 0, 'recommended score computed: ' + search[0].score);
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

await asC(`select submit_review($1, 5, 5, 5, 4, 5, 'Great')`, [b1]);
const [prov] = await db.query(`select rating_avg, rating_count, jobs_completed from providers where id = $1`, [P]).then(r => r.rows);
ok(Number(prov.rating_avg) === 5 && prov.rating_count === 1 && prov.jobs_completed === 1, 'rating aggregate + jobs_completed updated');
await expectError(() => asC(`select submit_review($1, 4)`, [b1]), /already reviewed/, 'one review per booking');

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

// ---- RLS spot checks ----
ok((await asX(`select * from bookings`)).length === 0, 'stranger sees no bookings');
ok((await asC(`select * from payouts`)).length === 0, 'customer sees no payouts');
await expectError(() => asX(`insert into messages (booking_id, sender_id, body) values ('${b1}', '${X}', 'hi')`), /row-level security/, 'stranger cannot post chat');
await asC(`insert into messages (booking_id, sender_id, body) values ('${b1}', '${C}', 'hello')`);
ok((await asP(`select body from messages`)).length === 1, 'participant reads chat');
await asX(`select set_provider_suspended('${P}', true, 'test')`);
ok((await as(null, 'anon', `select * from search_providers('ac-repair')`)).length === 0, 'suspended provider hidden');

// ---- Seed applies cleanly ----
await db.exec(seed);
ok((await as(null, 'anon', `select * from search_providers('ac-repair', 16.51, 80.65)`)).length === 1, 'seed: demo AC provider searchable');
ok((await as(null, 'anon', `select * from search_providers('plumber', 16.51, 80.65, 'distance')`)).length === 1, 'seed: demo plumber searchable');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);

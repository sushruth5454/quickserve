// Provider onboarding v2 + payout rails on PGlite (migrations 0008, 0009, 0011 on top of 0001-0007/0010).
// Production-shaped: every user and row is created here; no seed ids. Run: npm test (supabase/tests).
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';
import { as as chainAs, db as chainDb } from './r1-test-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mig = (f) =>
  fs.readFileSync(path.join(here, '..', 'migrations', f), 'utf8')
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
const b6Harness = createHarness();
const { ok: b6Ok, scenario: b6Scenario, finish: b6Finish } = b6Harness;
const b6Uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const b6One = async (sql, params = []) => (await chainDb.query(sql, params)).rows[0];

async function b6CreateProvider(seed) {
  const provider = b6Uuid(seed * 10 + 1);
  const admin = b6Uuid(seed * 10 + 2);
  await chainDb.query(`
    insert into auth.users (id) values ($1::uuid), ($2::uuid)
  `, [provider, admin]);
  await chainDb.query(`
    update public.profiles
       set full_name = $1::text, role_provider = true
     where id = $2::uuid
  `, [`B6 Provider ${seed}`, provider]);
  await chainDb.query(`insert into public.admins (user_id) values ($1::uuid)`, [admin]);
  await chainDb.query(`
    insert into public.providers (
      id, city, kyc_status, admin_review_status, submitted_at, is_online, paused, suspended
    ) values ($1::uuid, $2::text, 'pending', 'pending', now(), false, false, false)
  `, [provider, `B6 Provider City ${seed}`]);
  return { provider, admin };
}
await db.exec(prelude);
for (const f of ['0001_init.sql', '0002_qa_fixes.sql', '0003_payout_transfer_payment_cascade.sql', '0007_chat_unread_notifications.sql']) {
  await db.exec(mig(f));
}

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log('FAIL:', msg); } else console.log('ok  :', msg); };
async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role;'); }
}
const svc = (s, p) => as(null, 'service_role', s, p);
const anon = (s, p) => as(null, 'anon', s, p);
async function expectError(fn, re, msg) {
  try { await fn(); ok(false, msg + ' (no error)'); } catch (e) { ok(re.test(e.message), `${msg} -> ${e.message}`); }
}
const uuid = async () => (await db.query('select gen_random_uuid() as id')).rows[0].id;

const [L, P, C, X, A] = [await uuid(), await uuid(), await uuid(), await uuid(), await uuid()];
await db.exec(`insert into auth.users (id, phone) values ('${L}', '+919100000001'), ('${P}', '+919100000002'),
  ('${C}', '+919100000003'), ('${X}', '+919100000004'), ('${A}', '+919100000005');
  insert into admins (user_id) values ('${A}');`);
const asL = (s, p) => as(L, 'authenticated', s, p);
const asP = (s, p) => as(P, 'authenticated', s, p);
const asC = (s, p) => as(C, 'authenticated', s, p);
const asX = (s, p) => as(X, 'authenticated', s, p);
const asA = (s, p) => as(A, 'authenticated', s, p);

// ---- A provider verified under the old rules (before 0009) must stay live and bookable after the migration ----
await asL(`select upsert_provider_profile('Legacy Pro', 'Plumbing for 10 years', 'Testcity', 20, 17.0, 78.0, 10, '{en}')`);
await svc(`select sync_provider_kyc('${L}', 'acc_legacy', 'activated')`);
const [{ id: plumbId }] = (await db.query(`select id from categories where slug = 'plumber'`)).rows;
const [{ id: acId }] = (await db.query(`select id from categories where slug = 'ac-repair'`)).rows;
const [{ id: lps }] = await asL(`insert into provider_services (provider_id, category_id, visit_fee, labour_rate) values ($1, $2, 14900, 30000) returning id`, [L, plumbId]);

for (const f of ['0008_provider_kyc_status_values.sql', '0009_provider_onboarding.sql', '0010_notification_freshness.sql', '0011_payout_rails.sql', '0012_matching_foundations.sql']) {
  await db.exec(mig(f));
}
console.log('migrations 0008-0011 applied');

ok((await anon(`select * from search_providers('plumber', 17.0, 78.0)`)).some((r) => r.provider_id === L), 'backfill: legacy verified provider still searchable');
const [{ create_booking: lb }] = await asC(`select create_booking($1, 'Leaking tap', '1 Test Street', 'Testcity', 17.0, 78.0)`, [lps]);
ok(!!lb, 'backfill: legacy provider (no weekly hours) still bookable ASAP');

// ---- Brand-new provider: draft is invisible ----
await asP(`select save_provider_basics('Priya Sharma', null, 'female', '{English,Telugu}', 4, 'Short bio')`);
ok((await asX(`select id from providers where id = '${P}'`)).length === 0, 'draft provider not readable by others');
ok((await asX(`select id from profiles where id = '${P}'`)).length === 0, 'draft provider profile not readable by others');
const [{ get_my_provider_onboarding: ob0 }] = await asP(`select get_my_provider_onboarding()`);
ok(ob0.go_live.state === 'draft', 'new provider state = draft');
await expectError(() => asP(`select submit_provider_profile(_provider_terms_version())`), /permission denied|profile incomplete/, 'cannot submit incomplete profile');
await expectError(() => asP(`select submit_provider_profile('provider-agreement-v1-2026-11-14')`), /profile incomplete: .*photo.*bio.*services.*area.*hours/, 'submit lists missing items');
await expectError(() => asP(`select submit_provider_profile('old-terms')`), /latest provider agreement/, 'old terms version rejected');
await expectError(() => asP(`select save_provider_basics('Priya Sharma', 'https://evil.example/x.jpg', null, '{English}', 4, 'x')`), /avatars folder/, 'avatar must be in own avatars folder');
const bio = 'AC technician with 4 years of experience in split and window ACs.';
await asP(`select save_provider_basics('Priya Sharma', $1, 'female', '{English,Telugu}', 4, $2)`,
  [`https://proj.supabase.co/storage/v1/object/public/avatars/${P}/a.jpg`, bio]);
await expectError(() => asP(`insert into provider_services (provider_id, category_id, visit_fee, labour_rate, specialisations) values ($1, $2, 19900, 40000, '{flying}')`, [P, acId]),
  /unknown specialisation/, 'specialisations validated against category_skills');
const [{ id: pps }] = await asP(`insert into provider_services (provider_id, category_id, visit_fee, labour_rate, specialisations, brands)
  values ($1, $2, 19900, 40000, '{split,gas-refill}', '{Daikin, LG}') returning id`, [P, acId]);
await asP(`update provider_services set attributes = '{"equipment":["split","inverter"],"expertise":["gas_refill"]}'::jsonb where id = $1`, [pps]);
await expectError(() => asP(`update provider_services set attributes = '{"equipment":["wrong"]}'::jsonb where id = $1`, [pps]), /unsupported item/, 'provider attributes validate against category schema');
const [{ id: ownLink }] = await asP(`insert into provider_links (provider_id, kind, url, handle) values ($1, 'website', 'https://example.com/priya', 'Priya portfolio') returning id`, [P]);
ok((await asP(`select id from provider_links where provider_id = '${P}'`)).length === 1, 'provider reads own link');
ok((await asX(`select id from provider_links where provider_id = '${P}'`)).length === 0, 'non-live provider link is private');
await expectError(() => asP(`insert into provider_links (provider_id, kind, url) values ($1, 'instagram', 'http://instagram.com/priya')`, [P]), /violates check constraint|https/, 'provider links require https');
await expectError(() => asX(`insert into provider_links (provider_id, kind, url) values ('${P}', 'instagram', 'https://instagram.com/priya')`), /row-level security/, 'provider links owner-only writes');
await expectError(() => asP(`update provider_links set status = 'approved' where id = '${ownLink}'`), /permission denied/, 'provider cannot self-approve a link');
await asP(`select save_provider_service_area('Testcity', 17.01, 78.01, 15, 'Old Town')`);
await expectError(() => asP(`select set_provider_availability('[{"weekday":1,"start":"09:00","end":"13:00"},{"weekday":1,"start":"12:00","end":"18:00"}]'::jsonb)`), /overlap/, 'overlapping slots rejected');
await expectError(() => asP(`select set_provider_availability('[{"weekday":1,"start":"09:00","end":"09:30"}]'::jsonb)`), /at least 1 hour/, 'slot shorter than 1 hour rejected');
await expectError(() => asP(`select set_provider_availability('[]'::jsonb)`), /at least one/, 'empty schedule rejected');
const monSat = JSON.stringify([1, 2, 3, 4, 5, 6].flatMap((d) => [{ weekday: d, start: '09:00', end: '13:00' }, { weekday: d, start: '14:00', end: '19:00' }]));
await asP(`select set_provider_availability($1::jsonb, null)`, [monSat]);

const [{ submit_provider_profile: sub }] = await asP(`select submit_provider_profile('provider-agreement-v1-2026-11-14')`);
ok(sub.state === 'action_needed' && sub.reasons.some((r) => r.code === 'payout_missing'), 'submitted without payout => action_needed (payout_missing)');
ok((await anon(`select * from search_providers('ac-repair')`)).every((r) => r.provider_id !== P), 'not searchable before payout verification');
await expectError(() => asC(`select create_booking($1, 'x', 'a', 'Testcity', 17.0, 78.0)`, [pps]), /service not available/, 'not bookable before payout verification');

// Payout beneficiary (as the Edge Function does with the service role), then gateway states.
await svc(`insert into provider_payout_accounts (provider_id, rail, contact_id, fund_account_id, beneficiary_name, bank_last4, ifsc)
  values ($1, 'payouts', 'cont_t', 'fa_test', 'Priya Sharma', '9012', 'HDFC0001234')`, [P]);
await svc(`select sync_provider_payout_status('fa_test', 'under_review')`);
let [{ get_my_provider_onboarding: ob }] = await asP(`select get_my_provider_onboarding()`);
ok(ob.go_live.state === 'under_review' && ob.go_live.reasons[0].code === 'payout_pending', 'bank validation pending => under_review');
await svc(`select sync_provider_payout_status('fa_test', 'needs_clarification', '[{"field_reference":"bank_account.name","reason_code":"name_mismatch","description":"Name does not match PAN"}]'::jsonb)`);
[{ get_my_provider_onboarding: ob }] = await asP(`select get_my_provider_onboarding()`);
ok(ob.go_live.state === 'action_needed' && ob.go_live.reasons[0].detail === 'Name does not match PAN', 'needs_clarification shows the reason');
const stale = (await svc(`select sync_provider_payout_status('fa_test', 'activated', '[]'::jsonb, now() - interval '1 day') as r`))[0].r;
ok(stale.stale === true, 'out-of-order (older) gateway event ignored');
await svc(`select sync_provider_payout_status('fa_test', 'activated')`);
[{ get_my_provider_onboarding: ob }] = await asP(`select get_my_provider_onboarding()`);
ok(ob.go_live.state === 'live', 'payout verified + submitted => live');
ok((await db.query(`select razorpay_account_id from providers where id = $1`, [P])).rows[0].razorpay_account_id === null, 'fund account id is not stored as Route account');
ok((await anon(`select * from search_providers('ac-repair', 17.0, 78.0)`)).some((r) => r.provider_id === P), 'live provider searchable');
ok((await asX(`select id from providers where id = '${P}'`)).length === 1, 'live provider readable');
ok((await asX(`select id from provider_links where provider_id = '${P}'`)).length === 0, 'unapproved link is not public');
await asA(`select admin_review_provider_link('${ownLink}', true, 'Portfolio looks valid')`);
ok((await asX(`select id from provider_links where provider_id = '${P}'`)).length === 1, 'approved live provider link is public');

// ---- Column privacy ----
await expectError(() => anon(`select base_location from providers`), /permission denied/, 'anon cannot read base_location');
await expectError(() => asX(`select razorpay_account_id from providers`), /permission denied/, 'others cannot read razorpay_account_id');
await expectError(() => asX(`select gender from providers`), /permission denied/, 'others cannot read gender');
await expectError(() => asP(`select * from providers where id = '${P}'`), /permission denied/, 'select * on providers is denied (explicit columns only)');
const [{ get_my_provider: me }] = await asP(`select get_my_provider()`);
ok(Math.abs(me.lat - 17.01) < 1e-9 && me.gender === 'female' && !('base_location' in me), 'owner reads own location via get_my_provider');
const [{ get_provider_public_profile: pub }] = await anon(`select get_provider_public_profile('${P}')`);
const pubText = JSON.stringify(pub);
ok(pub.badges.payout_verified === true && pub.base_area === 'Old Town' && pub.specialisations[0].labels.includes('Split AC'), 'public profile: badges, area name, specialisation labels');
ok(pub.specialisations[0].attributes.equipment.includes('inverter') && pub.links[0].kind === 'website', 'public profile: attributes and portfolio link');
ok(!['lat', 'lng', 'base_location', 'phone', 'fund_account', 'razorpay', 'gender'].some((key) => key in pub), 'public profile has no location/phone/gateway/gender');

// ---- Availability enforcement in create_booking ----
const at = async (dayOffset, hhmm) => (await db.query(
  `select ((date_trunc('week', now() at time zone 'Asia/Kolkata') + interval '7 days' + ($1 || ' days')::interval)::date + $2::time) at time zone 'Asia/Kolkata' as t`,
  [String(dayOffset), hhmm])).rows[0].t;
const book = (ps, when) => asC(`select create_booking($1, 'AC not cooling', '9 Test Road', 'Testcity', 17.0, 78.0, $2)`, [ps, when]);
const [{ create_booking: b1 }] = await book(pps, await at(0, '10:00'));
ok(!!b1, 'Monday 10-12 inside hours: booked');
await expectError(
  () => svc(`insert into reviews (booking_id, customer_id, provider_id, rating, tags) values ($1, $2, $3, 5, '{not_a_real_tag}')`, [b1, C, P]),
  /not available for this category/,
  'review tags validate against category config',
);
await svc(`insert into reviews (booking_id, customer_id, provider_id, rating, tags) values ($1, $2, $3, 5, '{quick_diagnosis,long_lasting}')`, [b1, C, P]);
const [{ get_provider_public_profile: reviewed }] = await anon(`select get_provider_public_profile('${P}')`);
ok(reviewed.review_themes.some((x) => x.tag === 'quick_diagnosis' && x.count === 1), 'public profile aggregates review themes');
await expectError(async () => book(pps, await at(0, '08:00')), /outside the provider's working hours/, 'Monday 8-10 before hours rejected');
await expectError(async () => book(pps, await at(0, '12:00')), /outside/, 'Monday 12-14 crosses lunch break rejected');
await expectError(async () => book(pps, await at(0, '18:00')), /outside/, 'Monday 18-20 ends after 19:00 rejected');
await expectError(async () => book(pps, await at(6, '10:00')), /outside/, 'Sunday (no hours) rejected');
const tueStr = (await db.query(`select ((date_trunc('week', now() at time zone 'Asia/Kolkata') + interval '8 days')::date)::text as d`)).rows[0].d;
await asP(`select add_provider_time_off($1::date, $1::date, 'Family function')`, [tueStr]);
await expectError(async () => book(pps, await at(1, '10:00')), /on leave/, 'time off day rejected');
ok((await asX(`select * from provider_time_off where provider_id = '${P}'`)).length === 0, 'time off reasons are private');
ok((await asX(`select * from provider_availability where provider_id = '${P}'`)).length === 12, 'weekly hours readable for live provider');
const [{ get_provider_availability: av }] = await anon(`select get_provider_availability('${P}')`);
ok(av.slots.length === 12 && av.time_off.length === 1 && !JSON.stringify(av).includes('Family'), 'availability RPC: slots + leave without reason');
await asP(`select set_provider_availability($1::jsonb, 1)`, [monSat]);
await expectError(async () => book(pps, await at(0, '14:00')), /fully booked/, 'max jobs per day enforced');
await asP(`select set_provider_availability($1::jsonb, null)`, [monSat]);

// ---- Pause / deactivate ----
await asP(`select set_provider_paused(true)`);
ok((await anon(`select * from search_providers('ac-repair')`)).every((r) => r.provider_id !== P), 'paused provider hidden from search');
await expectError(async () => book(pps, await at(2, '10:00')), /service not available/, 'paused provider not bookable');
await asP(`select set_provider_paused(false)`);

// ---- Documents: private storage + admin review + required-docs gate ----
await expectError(() => asP(`insert into provider_documents (provider_id, doc_type, file_path) values ('${P}', 'police_verification', '${P}/x.pdf')`), /permission denied/, 'no direct document insert');
await svc(`insert into storage.objects (bucket_id, name) values ('provider-docs', '${P}/police.pdf'), ('provider-docs', '${X}/other.pdf')`);
await expectError(() => asP(`select submit_provider_document('police_verification', '${X}/other.pdf')`), /invalid document path/, 'cannot claim another user\'s document');
const [{ submit_provider_document: docId }] = await asP(`select submit_provider_document('police_verification', '${P}/police.pdf')`);
ok((await asX(`select * from provider_documents`)).length === 0, 'documents not readable by other users');
ok((await asA(`select * from provider_documents where id = '${docId}'`)).length === 1, 'admin can read documents');
ok((await asX(`select name from storage.objects where bucket_id = 'provider-docs'`)).every((r) => r.name.startsWith(X)), 'provider-docs storage: only own files');
await db.exec(`update categories set requires_docs = '{police_verification}' where slug = 'ac-repair'`);
[{ get_my_provider_onboarding: ob }] = await asP(`select get_my_provider_onboarding()`);
ok(ob.go_live.state === 'under_review' && ob.go_live.reasons.some((r) => r.code === 'doc_pending'), 'required doc pending => not live');
ok((await anon(`select * from search_providers('ac-repair')`)).every((r) => r.provider_id !== P), 'required doc pending => hidden from search');
await expectError(() => asP(`select admin_review_document('${docId}', true)`), /admin only/, 'only admins review documents');
await expectError(() => asA(`select admin_review_document('${docId}', true)`), /expiry date is required/, 'police verification needs an expiry');
await asA(`select admin_review_document('${docId}', true, null, current_date + 180)`);
ok((await db.query(`select count(*)::int as n from admin_audit_log where action = 'approve_document'`)).rows[0].n === 1, 'document approval audited');
ok((await anon(`select * from search_providers('ac-repair')`)).some((r) => r.provider_id === P), 'approved doc => live again');
const [{ get_provider_public_profile: pub2 }] = await anon(`select get_provider_public_profile('${P}')`);
ok(pub2.badges.police_verified === true, 'police verified badge');
await db.exec(`update categories set requires_docs = '{}' where slug = 'ac-repair'`);

// ---- Portfolio limits ----
for (let i = 0; i < 13; i++) await svc(`insert into storage.objects (bucket_id, name) values ('portfolio', '${P}/w${i}.jpg')`);
for (let i = 0; i < 12; i++) await asP(`select add_portfolio_photo('${P}/w${i}.jpg', 'Work ${i}')`);
await expectError(() => asP(`select add_portfolio_photo('${P}/w12.jpg')`), /at most 12/, 'portfolio capped at 12');
ok((await anon(`select * from provider_portfolio where provider_id = '${P}'`)).length === 12, 'portfolio public for live provider');

// ---- Price guidance never invents numbers ----
const [{ get_local_price_guidance: g }] = await asP(`select get_local_price_guidance('${acId}', 'Testcity')`);
ok(g.visit_fee === null && g.labour_rate === null, 'fewer than 5 data points => no guidance');

// ---- Payout rails: snapshot, receivable netting, idempotency key, payouts webhook ----
async function pay(bookingId) {
  const [pp] = await svc(`select * from prepare_payment($1, $2)`, [bookingId, C]);
  const link = 'plink_' + pp.payment_id.slice(0, 8);
  await svc(`update payments set razorpay_link_id = $1 where id = $2`, [link, pp.payment_id]);
  await svc(`select record_payment_paid($1, $2, $3)`, [link, 'pay_' + pp.payment_id.slice(0, 8), pp.amount]);
}
await pay(b1);
await asP(`select accept_booking('${b1}')`);
await asP(`select start_trip('${b1}')`);
const [o1] = await asC(`select * from get_booking_otps('${b1}')`);
await asP(`select arrive($1, $2)`, [b1, o1.start_otp]);
const [{ send_quote: q1 }] = await asP(`select send_quote($1, $2::jsonb)`, [b1, JSON.stringify([{ kind: 'labour', title: 'Gas refill', qty: 1, unit_price: 150000 }])]);
await asC(`select approve_quote($1, $2)`, [b1, q1]);
await pay(b1);
await asP(`select request_completion('${b1}')`);
const [o2] = await asC(`select * from get_booking_otps('${b1}')`);
await asP(`select complete_booking($1, $2)`, [b1, o2.end_otp]);
const rails = (await db.query(`select t.rail from payout_transfers t join payouts p on p.id = t.payout_id where p.booking_id = $1`, [b1])).rows;
ok(rails.length > 0 && rails.every((r) => r.rail === 'payouts'), 'new payout_transfers snapshot rail = payouts (default config)');
await asA(`select admin_set_payout_rail('route')`);
ok((await db.query(`select t.rail from payout_transfers t join payouts p on p.id = t.payout_id where p.booking_id = $1`, [b1])).rows.every((r) => r.rail === 'payouts'), 'switching rail does not touch in-flight rows');
await asA(`select admin_set_payout_rail('payouts')`);
await expectError(() => asP(`select admin_set_payout_rail('route')`), /admin only/, 'only admins switch rails');
await asA(`select admin_add_provider_receivable('${P}', null, 5000, 'Goodwill refund after release')`);
await db.exec(`update payouts set release_after = now() - interval '1 minute' where booking_id = '${b1}'`);
await expectError(() => asP(`select * from claim_due_transfers(10)`), /permission denied/, 'claim is service-role only');
const claimed = await svc(`select * from claim_due_transfers(10)`);
const total = claimed.reduce((s, r) => s + r.amount, 0);
const gross = claimed.reduce((s, r) => s + r.gross_amount, 0);
ok(claimed.length > 0 && claimed.every((r) => r.rail === 'payouts' && r.fund_account_id === 'fa_test' && r.idempotency_key.endsWith(':0')), 'claim returns payouts rail destination + idempotency key');
ok(gross - total === 5000, `receivable netted once: gross ${gross} - net ${total} = 5000`);
ok((await db.query(`select status from provider_receivables where provider_id = $1`, [P])).rows[0].status === 'recovered', 'receivable marked recovered');
for (const r of claimed) await svc(`select complete_transfer($1, $2)`, [r.transfer_id, 'pout_' + r.transfer_id.slice(0, 8)]);
const ext = 'pout_' + claimed[0].transfer_id.slice(0, 8);
await svc(`select record_payout_gateway_event($1, 'processed', 'UTR1')`, [ext]);
ok((await db.query(`select utr from payout_transfers where razorpay_transfer_id = $1`, [ext])).rows[0].utr === 'UTR1', 'payout.processed stores UTR');
await svc(`select record_payout_gateway_event($1, 'reversed', null, 'Beneficiary account closed')`, [ext]);
const dupe = (await svc(`select record_payout_gateway_event($1, 'reversed') as r`, [ext]))[0].r;
ok(dupe.duplicate === true, 'payout webhook idempotent');
const [po] = (await db.query(`select p.id, p.status from payouts p where p.booking_id = $1`, [b1])).rows;
ok(po.status === 'failed', 'reversed payout flags payout for admin');
await svc(`select retry_payout($1)`, [po.id]);
const again = await svc(`select * from claim_due_transfers(10)`);
const retried = again.find((r) => r.transfer_id === claimed[0].transfer_id);
ok(retried && retried.idempotency_key.endsWith(':1') && retried.amount === claimed[0].amount, 'admin retry uses a new idempotency key and the same net amount');

await b6Scenario('B6 queues document, provider-review, and suspension notices to the provider with safe deep links', async () => {
  const fixture = await b6CreateProvider(8701);
  const documentId = (await b6One(`
    insert into public.provider_documents (provider_id, doc_type, file_path)
    values ($1::uuid, 'trade_certificate'::text, $2::text)
    returning id
  `, [fixture.provider, `${fixture.provider}/trade-certificate.pdf`])).id;
  await chainAs(fixture.admin, 'authenticated', `
    select public.admin_review_document($1::uuid, $2::boolean, $3::text, $4::date)
  `, [documentId, true, null, null]);
  await chainAs(fixture.admin, 'authenticated', `
    select public.admin_set_provider_review($1::uuid, $2::text, $3::text)
  `, [fixture.provider, 'needs_clarification', 'Please update your documents']);
  await chainAs(fixture.admin, 'authenticated', `
    select public.admin_set_provider_review($1::uuid, $2::text, $3::text)
  `, [fixture.provider, 'needs_clarification', 'Please update your documents']);
  await chainAs(fixture.admin, 'authenticated', `
    select public.set_provider_suspended($1::uuid, $2::boolean, $3::text)
  `, [fixture.provider, true, 'Repeated policy violations']);
  await chainAs(fixture.admin, 'authenticated', `
    select public.set_provider_suspended($1::uuid, $2::boolean, $3::text)
  `, [fixture.provider, true, 'Repeated policy violations']);

  const notices = await chainDb.query(`
    select user_id, kind, booking_id, title, body, data, collapse_key, count
      from public.notifications
     where user_id = $1::uuid
       and kind in ('verification_update', 'account_suspended')
     order by kind, collapse_key
  `, [fixture.provider]);
  const documentNotice = notices.rows.find((row) => row.collapse_key === `verification-document:${documentId}`);
  const reviewNotice = notices.rows.find((row) => row.collapse_key === `provider-review:${fixture.provider}:needs_clarification`);
  const suspensionNotice = notices.rows.find((row) => row.collapse_key === `provider-suspended:${fixture.provider}`);
  b6Ok(notices.rows.length === 3
    && [documentNotice, reviewNotice, suspensionNotice].every((row) =>
      row?.user_id === fixture.provider && row.booking_id === null
        && row.data.url === '/provider/dashboard' && row.count === 1)
    && documentNotice.kind === 'verification_update'
    && documentNotice.data.document_id === documentId
    && reviewNotice.kind === 'verification_update'
    && reviewNotice.data.review_status === 'needs_clarification'
    && reviewNotice.data.reason === 'Please update your documents'
    && suspensionNotice.kind === 'account_suspended'
    && suspensionNotice.data.reason === 'Repeated policy violations',
  `provider verification and suspension notices have exact recipients, kinds, links, and deduplication; actual=${JSON.stringify(notices.rows)}`);
});

await b6Scenario('B6 admin notification failures do not block document, review, or suspension updates', async () => {
  const fixture = await b6CreateProvider(8702);
  const documentId = (await b6One(`
    insert into public.provider_documents (provider_id, doc_type, file_path)
    values ($1::uuid, 'trade_certificate'::text, $2::text)
    returning id
  `, [fixture.provider, `${fixture.provider}/trade-certificate.pdf`])).id;
  await chainDb.exec(`
    create or replace function public.b6_reject_admin_notifications()
    returns trigger language plpgsql as $$
    begin
      if new.kind in ('verification_update', 'account_suspended') then
        raise exception 'B6 notification insert rejected';
      end if;
      return new;
    end;
    $$;
    create trigger b6_reject_admin_notifications
      before insert on public.notifications
      for each row execute function public.b6_reject_admin_notifications();
  `);
  try {
    await chainAs(fixture.admin, 'authenticated', `
      select public.admin_review_document($1::uuid, $2::boolean, $3::text, $4::date)
    `, [documentId, false, 'Please resubmit', null]);
    await chainAs(fixture.admin, 'authenticated', `
      select public.admin_set_provider_review($1::uuid, $2::text, $3::text)
    `, [fixture.provider, 'rejected', 'Documents do not match']);
    await chainAs(fixture.admin, 'authenticated', `
      select public.set_provider_suspended($1::uuid, $2::boolean, $3::text)
    `, [fixture.provider, true, 'Repeated policy violations']);
  } finally {
    await chainDb.exec(`
      drop trigger if exists b6_reject_admin_notifications on public.notifications;
      drop function if exists public.b6_reject_admin_notifications();
    `);
  }
  const providerState = await b6One(`
    select p.admin_review_status, p.suspended, d.status as document_status
      from public.providers p
      join public.provider_documents d on d.provider_id = p.id
     where p.id = $1::uuid and d.id = $2::uuid
  `, [fixture.provider, documentId]);
  b6Ok(providerState?.admin_review_status === 'rejected'
    && providerState.suspended === true
    && providerState.document_status === 'rejected',
  `admin state transitions commit when notification inserts fail; actual=${JSON.stringify(providerState)}`);
});

b6Finish();
const totalFailures = failures + b6Harness.failures;
console.log(totalFailures ? `${totalFailures} FAILED` : 'all provider onboarding tests passed');
process.exit(totalFailures ? 1 : 0);

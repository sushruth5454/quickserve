import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, '..', 'migrations', '0023_proposal_milestone_booking.sql'), 'utf8');
const checks = [
  ['service request table', /create table if not exists public\.service_requests/i],
  ['provider projection', /create or replace view public\.service_request_provider_view/i],
  ['private request table', /create table if not exists public\.request_private/i],
  ['recipient uniqueness', /primary key \(request_id, provider_id\)/i],
  ['proposal items and schedule', /create table if not exists public\.proposal_items[\s\S]+create table if not exists public\.proposal_schedule/i],
  ['fixed snapshots', /proposal booking snapshots are immutable/i],
  ['atomic accept lock', /for update[\s\S]+service_request_id = v_request\.id/i],
  ['30 minute hold', /now\(\) \+ interval '30 minutes'/i],
  ['schedule-scoped payment', /prepare_schedule_payment[\s\S]+schedule_id = ps\.id/i],
  ['expiry reopen', /payment hold expired[\s\S]+status = case when expires_at > now\(\) then 'open'/i],
  ['deliverable guard', /all milestones must be paid before accepting delivery/i],
  ['request masking', /_proposal_public_intake/i],
  ['recipient-only routing', /route_service_request/i],
  ['notification vocabulary', /proposal_request_received[\s\S]+milestone_due[\s\S]+delivery_submitted/i],
  ['RLS enabled', /alter table public\.request_private enable row level security[\s\S]+alter table public\.payment_schedule enable row level security/i],
];
const failed = checks.filter(([, pattern]) => !pattern.test(sql));
checks.filter(([, pattern]) => pattern.test(sql)).forEach(([name]) => console.log(`ok  : ${name}`));
failed.forEach(([name]) => console.error(`FAIL: ${name}`));
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
]) await db.exec(migration(file));

let runtimeFailures = 0;
const runtimeOk = (condition, message) => {
  if (condition) console.log(`ok  : ${message}`);
  else { runtimeFailures++; console.error(`FAIL: ${message}`); }
};
async function as(uid, role, query, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return (await db.query(query, params)).rows; }
  finally { await db.exec('reset role;'); }
}
const customer = '00000000-0000-0000-0000-0000000000c1';
const provider = '00000000-0000-0000-0000-0000000000p1'.replace('p', 'a');
const provider2 = '00000000-0000-0000-0000-0000000000d1';
await db.exec(`
  insert into auth.users (id, phone) values
    ('${customer}', '+919999000001'), ('${provider}', '+919999000002'), ('${provider2}', '+919999000003');
  update profiles set full_name = case id when '${provider}'::uuid then 'Proposal Pro' else 'Customer' end;
  insert into providers (id, city, base_location, kyc_status, submitted_at, is_online, paused, suspended)
  values
    ('${provider}', 'Proposal City', extensions.st_setsrid(extensions.st_makepoint(80.60,16.50),4326), 'verified', now(), true, false, false),
    ('${provider2}', 'Proposal City', extensions.st_setsrid(extensions.st_makepoint(80.61,16.50),4326), 'verified', now(), true, false, false);
`);
const category = (await db.query(`
  insert into categories (slug, name, pricing_mode, active, archetype, intake_schema, config_version, max_lead_days)
  values ('proposal-test', 'Proposal Test', 'quote', true, 'proposal',
    '{"type":"object","properties":{"brief":{"type":"string"},"private_note":{"type":"string","x-private":true}},"required":["brief"]}', 4, 365)
  on conflict (slug) do update set archetype='proposal', active=true
  returning id
`)).rows[0].id;
await db.exec(`
  update app_config set value = value || '{"proposal":true}'::jsonb where key = 'archetype_flags';
  insert into category_cities (category_id, city, live, launched_at)
  values ('${category}', 'Proposal City', true, now())
  on conflict (category_id, city) do update set live = true, launched_at = coalesce(category_cities.launched_at, now());
  insert into provider_services (provider_id, category_id, visit_fee, labour_rate, active)
  values ('${provider}', '${category}', 0, 0, true), ('${provider2}', '${category}', 0, 0, true);
  insert into addresses (user_id, label, line1, city, lat, lng)
  values ('${customer}', 'Venue', 'Private exact venue, Gate 2', 'Proposal City', 16.50, 80.60);
`);
const address = (await db.query(`select id from addresses where user_id='${customer}'`)).rows[0].id;
const request = (await as(customer, 'authenticated', `
  select create_service_request($1, 'Proposal City', 'Private Area', now()+interval '20 days',
    now()+interval '20 days 4 hours', '{"brief":"Four hour coverage","private_note":"gate code 7421"}',
    800000, 1200000, $2, null) id
`, [category, address]))[0].id;
runtimeOk((await as(provider, 'authenticated', `
  select * from service_request_provider_view where id=$1`, [request])).length === 1,
  'routed provider sees request projection');
runtimeOk((await as(provider, 'authenticated', `
  select intake->>'private_note' x from service_request_provider_view where id=$1`, [request]))[0].x === null,
  'private intake fields are masked from provider projection');
runtimeOk((await as(provider, 'authenticated', `select * from request_private where request_id=$1`, [request])).length === 0,
  'provider cannot read exact venue before advance');
runtimeOk((await as(provider2, 'authenticated', `select * from service_requests where id=$1`, [request])).length === 0,
  'competing provider cannot read raw request table');

const proposal = (await as(provider, 'authenticated', `
  select send_proposal($1,
    '[{"kind":"package","title":"Coverage","qty":1,"unit":"event","unit_price":1000000}]'::jsonb,
    '[{"label":"Advance","amount":300000,"due_rule":"at_booking"},{"label":"Final","amount":700000,"due_rule":"on_delivery"}]'::jsonb,
    now()+interval '2 days', 'Fixed proposal',
    '[{"type":"edited_photos","qty":100,"spec":"Private gallery"}]'::jsonb) id
`, [request]))[0].id;
const booking = (await as(customer, 'authenticated', `select accept_proposal($1,$2) id`, [proposal, address]))[0].id;
runtimeOk((await db.query(`select status, payment_hold_expires_at from bookings where id=$1`, [booking])).rows[0].status === 'pending_payment',
  'accept creates one held pending-payment booking');
runtimeOk((await db.query(`select count(*)::int n from payment_schedule where booking_id=$1 and obligation_kind='service'`, [booking])).rows[0].n === 2,
  'accepted proposal copies fixed service milestones');
runtimeOk((await db.query(`select count(*)::int n from payment_schedule where booking_id=$1 and obligation_kind='platform_fee'`, [booking])).rows[0].n === 1,
  'platform fee is a separate booking obligation');

await as(customer, 'authenticated', `select 1`);
const afterDuplicate = (await as(customer, 'authenticated', `select accept_proposal($1,$2) id`, [proposal, address]))[0].id;
runtimeOk(afterDuplicate === booking, 'repeated accept is idempotent');
let immutable = false;
try { await db.exec(`update bookings set pricing_snapshot='{}' where id='${booking}'`); }
catch (e) { immutable = /immutable/.test(e.message); }
runtimeOk(immutable, 'proposal snapshots cannot be changed');

for (const row of (await db.query(`select id,amount,purpose from payment_schedule where booking_id=$1 and status='due' order by seq`, [booking])).rows) {
  const prepared = (await as(null, 'service_role', `select * from prepare_schedule_payment($1,$2,$3)`, [booking, customer, row.id]))[0];
  await as(null, 'service_role', `update payments set razorpay_link_id=$1,short_url='https://pay.test' where id=$2`,
    [`link_${row.id}`, prepared.payment_id]);
  await as(null, 'service_role', `select record_payment_paid($1,$2,$3)`,
    [`link_${row.id}`, `gateway_${row.id}`, row.amount]);
}
runtimeOk((await db.query(`select status from bookings where id=$1`, [booking])).rows[0].status === 'confirmed',
  'advance and platform fee settle atomically into confirmed state');
runtimeOk((await as(provider, 'authenticated', `select * from request_private where request_id=$1`, [request])).length === 1,
  'selected provider reads venue only after advance is paid');

const request2 = (await as(customer, 'authenticated', `
  select create_service_request($1, 'Proposal City', 'Other Area', now()+interval '40 days',
    now()+interval '40 days 2 hours', '{"brief":"Second event","private_note":"hidden"}',
    500000, 900000, $2, null) id
`, [category, address]))[0].id;
const proposal2 = (await as(provider, 'authenticated', `
  select send_proposal($1,
    '[{"kind":"package","title":"Second","qty":1,"unit_price":600000}]'::jsonb,
    '[{"label":"Advance","amount":600000,"due_rule":"at_booking"}]'::jsonb,
    now()+interval '2 days', null, '[]'::jsonb) id
`, [request2]))[0].id;
const booking2 = (await as(customer, 'authenticated', `select accept_proposal($1,$2) id`, [proposal2, address]))[0].id;
await db.exec(`update bookings set payment_hold_expires_at=now()-interval '1 minute' where id='${booking2}'`);
await as(null, 'service_role', `select expire_proposal_flows()`);
runtimeOk((await db.query(`select status from service_requests where id=$1`, [request2])).rows[0].status === 'open',
  'expired 30 minute hold reopens request');
runtimeOk((await db.query(`select status from proposals where id=$1`, [proposal2])).rows[0].status === 'sent',
  'expired hold reopens valid proposals');

await db.exec(`
  update app_config set value = value || '{"proposal":false}'::jsonb where key = 'archetype_flags';
  insert into app_config (key, value) values ('launch_city', '"Launch City"')
  on conflict (key) do update set value = excluded.value;
`);
await db.exec(migration('0024_activate_creator_event_categories.sql'));
await db.exec(migration('0024_activate_creator_event_categories.sql'));
const launched = (await db.query(`
  select count(*)::int total,
         count(*) filter (where c.active)::int active,
         count(cc.category_id) filter (where cc.live and cc.city = 'Launch City')::int live_in_city
    from categories c
    left join category_cities cc on cc.category_id = c.id
   where c.slug in ('wedding-photographer', 'reel-maker', 'caterer', 'drone-operator')
`)).rows[0];
runtimeOk(launched.total === 4 && launched.active === 4 && launched.live_in_city === 4,
  '0024 activates creator/event categories in the launch city (idempotent)');
runtimeOk((await db.query(`select (value->>'proposal')::boolean on_ from app_config where key='archetype_flags'`)).rows[0].on_ === true,
  '0024 enables the proposal archetype');
runtimeOk((await as(null, 'anon', `select count(*)::int n from categories where slug = 'wedding-photographer'`))[0].n === 1,
  'anon can now read Wedding Photographer');

await db.exec(migration('0025_targeted_proposal_requests.sql'));
const targeted = (await as(customer, 'authenticated', `
  select create_service_request($1, 'Proposal City', 'Area', now()+interval '60 days',
    now()+interval '60 days 4 hours', '{"brief":"Reel shoot for my cafe"}', null, null, $2, null, $3) id
`, [category, address, provider2]))[0].id;
const targetedRecipients = (await db.query(`select provider_id from request_recipients where request_id=$1`, [targeted])).rows;
runtimeOk(targetedRecipients.length === 1 && targetedRecipients[0].provider_id === provider2,
  'targeted request reaches only the chosen provider');
runtimeOk((await as(provider, 'authenticated', `select * from service_request_provider_view where id=$1`, [targeted])).length === 0,
  'other providers cannot see a targeted request');
let unavailable = null;
try {
  await as(customer, 'authenticated', `
    select create_service_request($1, 'Other City', 'Area', now()+interval '60 days',
      now()+interval '60 days 4 hours', '{"brief":"Reel shoot elsewhere"}', null, null, null, 'Somewhere', $2)
  `, [category, provider2]);
} catch (e) { unavailable = e.message; }
runtimeOk(/not available/.test(unavailable ?? ''), 'targeting a provider outside the request city is rejected');
const openRequest = (await as(customer, 'authenticated', `
  select create_service_request($1, 'Proposal City', 'Area', now()+interval '61 days',
    now()+interval '61 days 4 hours', '{"brief":"Open brief for everyone"}', null, null, $2, null) id
`, [category, address]))[0].id;
runtimeOk((await db.query(`select count(*)::int n from request_recipients where request_id=$1`, [openRequest])).rows[0].n === 2,
  'untargeted requests still route to all eligible providers');

await db.exec(migration('0026_fix_proposal_prepare_payment.sql'));
const targetedProposal = (await as(provider2, 'authenticated', `
  select send_proposal($1,
    '[{"kind":"package","title":"Reel","qty":1,"unit":"job","unit_price":1200000}]'::jsonb,
    '[{"label":"Advance","amount":400000,"due_rule":"at_booking"},{"label":"Final","amount":800000,"due_rule":"on_delivery"}]'::jsonb,
    now()+interval '2 days', null, '[]'::jsonb) id
`, [targeted]))[0].id;
const targetedBooking = (await as(customer, 'authenticated', `select accept_proposal($1,$2) id`, [targetedProposal, address]))[0].id;
const prepared = (await as(null, 'service_role', `select * from prepare_payment($1,$2)`, [targetedBooking, customer]))[0];
runtimeOk(prepared?.purpose === 'advance' && prepared.amount === 400000,
  'prepare_payment charges the proposal advance first (no ambiguous purpose column)');

if (failed.length || runtimeFailures) process.exit(1);

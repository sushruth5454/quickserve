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
  '0031_holiday_mode_enforcement.sql', '0032_notification_centre.sql', '0033_city_waitlist.sql',
  '0034_targeted_request_radius.sql', '0035_request_coordinates.sql', '0036_provider_service_city.sql',
  '0037_proposal_validity_cap.sql', '0038_proposal_lead_time.sql', '0039_proposal_start_code.sql',
  '0040_urgent_proposals.sql', '0041_admin_support.sql', '0042_feature_registry.sql',
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
const one = async (query, params = []) => (await db.query(query, params)).rows[0];

const customer = '00000000-0000-0000-0000-0000000000c1';
const admin = '00000000-0000-0000-0000-0000000000b1';
await db.exec(`
  insert into auth.users (id, phone, raw_user_meta_data) values
    ('${customer}', '+919999000001', '{}'), ('${admin}', '+918888888888', '{}');
`);

const registry = await one(`select to_regclass('public.feature_flags') is not null as exists`);
ok(registry.exists, 'feature switch registry exists');
if (!registry.exists) process.exit(1);

const initial = (await as(customer, 'authenticated', `select get_app_features() features`))[0].features;
ok(initial.ai_assistant === true && initial.urgent_requests === true && initial.fixed_asap === true,
  'existing app feature values are preserved during migration');

const unknown = (await one(`select public._feature_enabled('unknown_feature') enabled`)).enabled;
ok(unknown === false, 'unknown feature keys fail closed');

const badKey = await fails(() => as(admin, 'authenticated', `select admin_set_feature('unknown_feature', true)`));
ok(/unknown feature/.test(badKey ?? ''), 'admin cannot create a flag through the toggle RPC');

await db.query(`
  insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
  values ('future_feature', false, 'Future feature', 'Added without UI code changes.', 'Future', 10)
`);
await as(admin, 'authenticated', `select admin_set_feature('future_feature', true)`);
const futureEnabled = (await as(customer, 'authenticated',
  `select get_app_features()->>'future_feature' enabled`))[0].enabled;
ok(futureEnabled === 'true', 'admin can toggle a newly registered feature without a code whitelist');

const listed = await as(admin, 'authenticated', `select key, enabled, label, group_name from admin_list_features()`);
ok(listed.length === 4 && listed[0].key === 'ai_assistant', 'admin sees feature metadata ordered by group and sort order');
const tableDenied = await fails(() => as(customer, 'authenticated', `select * from public.feature_flags`));
ok(/permission denied/.test(tableDenied ?? ''), 'non-admin cannot read the feature registry table directly');
const listDenied = await fails(() => as(customer, 'authenticated', `select * from admin_list_features()`));
ok(/admin only/.test(listDenied ?? ''), 'non-admin cannot list feature registry metadata');
const setDenied = await fails(() => as(customer, 'authenticated', `select admin_set_feature('future_feature', false)`));
ok(/admin only/.test(setDenied ?? ''), 'non-admin cannot change feature switches');
const audit = await one(`select count(*)::int as n from public.admin_audit_log where action = 'set_feature' and details->>'key' = 'future_feature'`);
ok(audit.n === 1, 'admin feature changes are audited');

if (failures) process.exit(1);

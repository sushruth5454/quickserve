import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

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
  '0043_commission_config.sql', '0044_creator_revisions.sql', '0045_preferred_language.sql',
  '0046_managed_geography.sql', '0047_coins_config.sql', '0048_sports.sql',
  '0049_shops_catalogue.sql', '0050_rfq.sql', '0051_ai_usage_v3.sql',
  '0052_merchant_staff.sql', '0053_activity_contracts.sql', '0054_addendum_foundations.sql',
  '0055_addendum_foundation_hardening.sql', '0056_home_services_catalogue.sql',
  '0057_recurring_plans_v2.sql', '0058_sports_payments.sql',
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
await db.exec(migration('0069_u3_account_deletion.sql'));

const { ok, scenario, finish } = createHarness();
const CUSTOMER = '00000000-0000-0000-0000-0000000000c1';
const OTHER = '00000000-0000-0000-0000-0000000000c2';
const DIRECT_INSERT_USER = '00000000-0000-0000-0000-0000000000c3';
const ADDRESS_OWNER = '00000000-0000-0000-0000-0000000000c4';
const ADDRESS_OTHER = '00000000-0000-0000-0000-0000000000c5';
const ADMIN = '00000000-0000-0000-0000-0000000000a1';

await db.exec(`
  insert into auth.users (id) values
    ('${CUSTOMER}'),
    ('${OTHER}'),
    ('${DIRECT_INSERT_USER}'),
    ('${ADDRESS_OWNER}'),
    ('${ADDRESS_OTHER}'),
    ('${ADMIN}');
  insert into public.admins (user_id) values ('${ADMIN}');
`);

async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

async function failureOf(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error.message;
  }
}

await scenario('account deletion request is owner-scoped, admin-readable, and idempotent', async () => {
  await as(CUSTOMER, 'authenticated', 'select public.request_account_deletion()');
  await as(CUSTOMER, 'authenticated', 'select public.request_account_deletion()');

  const ownRows = await as(CUSTOMER, 'authenticated', `
    select id, user_id, status from public.account_deletion_requests where user_id = $1::uuid
  `, [CUSTOMER]);
  const otherRows = await as(OTHER, 'authenticated', `
    select id from public.account_deletion_requests where user_id = $1::uuid
  `, [CUSTOMER]);
  const adminRows = await as(ADMIN, 'authenticated', `
    select id from public.account_deletion_requests
  `);

  ok(ownRows.length === 1 && ownRows[0].status === 'pending',
    `request creates one pending owner row after two calls: ${JSON.stringify(ownRows)}`);
  ok(otherRows.length === 0,
    `different user cannot read the request: ${JSON.stringify(otherRows)}`);
  ok(adminRows.length === 1,
    `admin can read all deletion requests: ${JSON.stringify(adminRows)}`);
});

await scenario('account deletion request rejects cross-user writes and anonymous access', async () => {
  const ownInsert = await as(DIRECT_INSERT_USER, 'authenticated', `
    insert into public.account_deletion_requests (user_id)
    values ($1::uuid) returning id, user_id, status
  `, [DIRECT_INSERT_USER]);
  const crossUserInsert = await failureOf(() => as(DIRECT_INSERT_USER, 'authenticated', `
    insert into public.account_deletion_requests (user_id)
    values ($1::uuid) returning id
  `, [CUSTOMER]));
  const forgedStatus = await failureOf(() => as(DIRECT_INSERT_USER, 'authenticated', `
    insert into public.account_deletion_requests (user_id, status)
    values ($1::uuid, $2::text) returning id
  `, [DIRECT_INSERT_USER, 'done']));
  const anonymousSelect = await failureOf(() => as(null, 'anon', `
    select id from public.account_deletion_requests
  `));
  const anonymousRpc = await failureOf(() => as(null, 'anon', `
    select public.request_account_deletion()
  `));

  ok(ownInsert.length === 1 && ownInsert[0].user_id === DIRECT_INSERT_USER,
    `owner can insert its own request: ${JSON.stringify(ownInsert)}`);
  ok(/row-level security/i.test(crossUserInsert ?? ''),
    `owner cannot insert for another user: ${crossUserInsert ?? 'no error'}`);
  ok(/permission denied/i.test(forgedStatus ?? ''),
    `owner cannot set the request status: ${forgedStatus ?? 'no error'}`);
  ok(/permission denied/i.test(anonymousSelect ?? ''),
    `anonymous select is rejected: ${anonymousSelect ?? 'no error'}`);
  ok(/permission denied/i.test(anonymousRpc ?? ''),
    `anonymous RPC execution is rejected: ${anonymousRpc ?? 'no error'}`);
});

await scenario('address owner delete is scoped and Booking rows are excluded by the delete filter', async () => {
  const saved = (await db.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Home', 'Saved Street', 'Vijayawada', 16.5, 80.65) returning id
  `, [ADDRESS_OWNER])).rows[0];
  const snapshot = (await db.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Booking', 'Booking Street', 'Vijayawada', 16.5, 80.65) returning id
  `, [ADDRESS_OWNER])).rows[0];
  const ownerDelete = await as(ADDRESS_OWNER, 'authenticated', `
    delete from public.addresses
    where id = $1::uuid and user_id = $2::uuid and label <> $3::text returning id
  `, [saved.id, ADDRESS_OWNER, 'Booking']);
  const otherDelete = await as(ADDRESS_OTHER, 'authenticated', `
    delete from public.addresses
    where id = $1::uuid and label <> $2::text returning id
  `, [saved.id, 'Booking']);
  const snapshotDelete = await as(ADDRESS_OWNER, 'authenticated', `
    delete from public.addresses
    where id = $1::uuid and user_id = $2::uuid and label <> $3::text returning id
  `, [snapshot.id, ADDRESS_OWNER, 'Booking']);
  const remaining = await db.query(`
    select id, label from public.addresses where id = $1::uuid
  `, [snapshot.id]).then((result) => result.rows);

  ok(ownerDelete.length === 1,
    `owner can delete its saved address: ${JSON.stringify(ownerDelete)}`);
  ok(otherDelete.length === 0,
    `different user cannot delete the address: ${JSON.stringify(otherDelete)}`);
  ok(snapshotDelete.length === 0 && remaining.length === 1 && remaining[0].label === 'Booking',
    `Booking snapshot is not deleted by the label filter: ${JSON.stringify({ snapshotDelete, remaining })}`);
});

finish();

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
await db.exec(migration('0044_creator_revisions.sql'));
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
const provider = '00000000-0000-0000-0000-0000000000a1';
await db.exec(`
  insert into auth.users (id, phone, raw_user_meta_data) values
    ('${customer}', '+919999000001', '{}'), ('${provider}', '+919999000002', '{}');
  insert into public.providers (id, city, base_location, kyc_status, submitted_at, is_online, paused, suspended)
  values ('${provider}', 'Review City', extensions.st_setsrid(extensions.st_makepoint(80.60,16.50),4326),
          'verified', now(), true, false, false);
`);

const category = await one(`
  select id from public.categories
   where archetype = 'proposal' and active and not restricted and cardinality(requires_docs) = 0
   order by sort_order limit 1
`);
ok(!!category, 'a bookable proposal category is available for the test fixture');
if (!category) process.exit(1);
await db.query(`
  insert into public.category_cities (category_id, city, live, launched_at)
  values ($1, 'Review City', true, now())
  on conflict (category_id, city) do update set live = true, launched_at = coalesce(public.category_cities.launched_at, excluded.launched_at)
`, [category.id]);
const service = await one(`
  insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
  values ($1, $2, 0, 1, true) returning id
`, [provider, category.id]);
const address = await one(`
  insert into public.addresses (user_id, label, line1, city, lat, lng)
  values ($1, 'Test', '1 Test Street', 'Review City', 16.50, 80.60) returning id
`, [customer]);

async function makeBooking(deliverySnapshot = []) {
  return one(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, status, visit_fee, platform_fee, total_amount, delivery_status,
      delivery_snapshot, completion_requested_at
    ) values (
      $1, $2, $3, $4, $5, 'Revision test', 'completion_requested', 0, 0, 100,
      'submitted', $6::jsonb, now() - interval '8 days'
    ) returning id, revisions_allowed, revisions_used, delivery_snapshot
  `, [customer, provider, category.id, service.id, address.id, JSON.stringify(deliverySnapshot)]);
}

const booking = await makeBooking();
const defaultFlag = (await one(`select enabled from public.feature_flags where key = 'creator_revisions'`)).enabled;
ok(defaultFlag === false, 'creator revisions are registered disabled by default');
const disabled = await fails(() => as(customer, 'authenticated',
  `select public.request_revision($1::uuid, $2)`, [booking.id, 'Please adjust the color grading']));
ok(/creator revisions are not enabled/.test(disabled ?? ''), 'request_revision refuses clearly while the feature flag is off');

await db.query(`update public.feature_flags set enabled = true where key = 'creator_revisions'`);
const shortNote = await fails(() => as(customer, 'authenticated',
  `select public.request_revision($1::uuid, $2)`, [booking.id, 'Fix']));
ok(/revision note must be between 5 and 1000 characters/.test(shortNote ?? ''), 'revision notes shorter than five trimmed characters are rejected');

const customerRequest = await fails(() => as(customer, 'authenticated',
  `select public.request_revision($1::uuid, $2)`, [booking.id, '  Please adjust the color grading  ']));
ok(customerRequest === null, 'the booking customer can request a revision');
let state = await one(`
  select status::text as status, delivery_status, revisions_allowed, revisions_used, completion_requested_at
    from public.bookings where id = $1
`, [booking.id]);
ok(state.status === 'delivery_pending' && state.delivery_status === 'revision_requested'
  && state.revisions_used === 1 && state.revisions_allowed === 2 && state.completion_requested_at === null,
  'requesting a revision increments the count and clears completion timing');

const event = await one(`
  select note from public.booking_events
   where booking_id = $1 and to_status = 'delivery_pending'
   order by at desc limit 1
`, [booking.id]);
ok(event.note === 'revision requested: Please adjust the color grading',
  'the booking event preserves the trimmed revision note');
const notification = await one(`
  select kind, user_id, body from public.notifications
   where booking_id = $1 and kind = 'revision_requested'
   order by created_at desc limit 1
`, [booking.id]);
ok(notification?.kind === 'revision_requested' && notification.user_id === provider
  && notification.body.includes('Please adjust the color grading'),
  'a revision notification with the note is queued for the provider');

const autoConfirmed = (await as(null, 'service_role', `select public.auto_confirm_completions() as count`))[0].count;
state = await one(`select status::text as status, completion_requested_at from public.bookings where id = $1`, [booking.id]);
ok(autoConfirmed === 0 && state.status === 'delivery_pending' && state.completion_requested_at === null,
  'auto-confirm does not complete a booking while a revision is pending');

const wrongOwner = await fails(() => as(provider, 'authenticated',
  `select public.request_revision($1::uuid, $2)`, [booking.id, 'Please make this change']));
ok(/only the customer can request revisions/.test(wrongOwner ?? ''), 'a provider cannot request a revision on the customer’s behalf');

const links = JSON.stringify([{ title: 'Updated work', url: 'https://example.test/revised-work' }]);
const resubmit = await fails(() => as(provider, 'authenticated',
  `select public.submit_delivery($1::uuid, $2::jsonb)`, [booking.id, links]));
state = await one(`
  select status::text as status, delivery_status, completion_requested_at
    from public.bookings where id = $1
`, [booking.id]);
ok(resubmit === null && state.status === 'completion_requested' && state.delivery_status === 'submitted'
  && state.completion_requested_at !== null,
  'provider resubmission returns the booking to submitted completion review');

await as(customer, 'authenticated',
  `select public.request_revision($1::uuid, $2)`, [booking.id, 'Please tighten the crop']);
await as(provider, 'authenticated', `select public.submit_delivery($1::uuid, $2::jsonb)`, [booking.id, links]);
const maxed = await fails(() => as(customer, 'authenticated',
  `select public.request_revision($1::uuid, $2)`, [booking.id, 'One more revision please']));
ok(/no revisions remaining/.test(maxed ?? ''), 'the default allowance of two revisions blocks a third request');

const customSnapshot = [
  { type: 'edited_video', qty: 1, spec: 'Final edit' },
  { type: 'revisions', qty: 1 },
];
const custom = await makeBooking(customSnapshot);
const customSnapshotPreserved = await one(`
  select revisions_allowed, delivery_snapshot = $2::jsonb as snapshot_unchanged
    from public.bookings where id = $1
`, [custom.id, JSON.stringify(customSnapshot)]);
ok(customSnapshotPreserved.revisions_allowed === 1 && customSnapshotPreserved.snapshot_unchanged,
  'a valid revisions deliverable sets the allowance without rewriting proposal deliverables');

if (failures) process.exit(1);
console.log('All creator revision tests passed.');
await db.close();

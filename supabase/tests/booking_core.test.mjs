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
  '0001_init.sql',
  '0002_qa_fixes.sql',
  '0003_payout_transfer_payment_cascade.sql',
  '0007_chat_unread_notifications.sql',
  '0008_provider_kyc_status_values.sql',
  '0009_provider_onboarding.sql',
  '0010_notification_freshness.sql',
  '0011_payout_rails.sql',
  '0012_matching_foundations.sql',
  '0013_review_matching.sql',
  '0014_travel_requests.sql',
  '0015_seva_coins.sql',
  '0016_leakage_programme.sql',
  '0017_creator_config.sql',
]) {
  await db.exec(migration(file));
}

const CUSTOMER = '00000000-0000-0000-0000-000000000051';
const PROVIDER = '00000000-0000-0000-0000-000000000052';
const STRANGER = '00000000-0000-0000-0000-000000000053';
const ADMIN = '00000000-0000-0000-0000-000000000054';
await db.exec(`
  insert into auth.users (id, phone) values
    ('${CUSTOMER}', '+919100000051'),
    ('${PROVIDER}', '+919100000052'),
    ('${STRANGER}', '+919100000053'),
    ('${ADMIN}', '+919100000054');
  update profiles set full_name = case id
    when '${CUSTOMER}'::uuid then 'Core customer'
    when '${PROVIDER}'::uuid then 'Core provider'
    when '${STRANGER}'::uuid then 'Core stranger'
    else 'Core admin'
  end where id in ('${CUSTOMER}', '${PROVIDER}', '${STRANGER}', '${ADMIN}');
  insert into admins (user_id) values ('${ADMIN}');
  insert into providers (id, city, kyc_status, submitted_at, is_online, suspended, paused)
  values ('${PROVIDER}', 'Core City', 'verified', now(), true, false, false);
`);
const acCategory = (await db.query(`select id from categories where slug = 'ac-repair'`)).rows[0].id;
const providerService = (await db.query(`
  insert into provider_services (provider_id, category_id, visit_fee, labour_rate, active)
  values ('${PROVIDER}', '${acCategory}', 19900, 50000, true)
  returning id
`)).rows[0].id;
const legacyAddress = (await db.query(`
  insert into addresses (user_id, label, line1, city, lat, lng)
  values ('${CUSTOMER}', 'Legacy', '1 Legacy Road', 'Core City', 16.5, 80.6)
  returning id
`)).rows[0].id;
const legacyBooking = (await db.query(`
  insert into bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id,
    description, status, visit_fee, platform_fee
  ) values (
    '${CUSTOMER}', '${PROVIDER}', '${acCategory}', '${providerService}', '${legacyAddress}',
    'Before 0018', 'pending_payment', 19900, 2900
  )
  returning id
`)).rows[0].id;

await db.exec(migration('0018_archetype_core.sql'));

let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('ok  :', message);
  else {
    failures++;
    console.log('FAIL:', message);
  }
};
async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
async function expectError(fn, pattern, message) {
  try {
    await fn();
    ok(false, `${message} (no error)`);
  } catch (error) {
    ok(pattern.test(error.message), `${message} -> ${error.message}`);
  }
}
const asCustomer = (sql, params) => as(CUSTOMER, 'authenticated', sql, params);
const asProvider = (sql, params) => as(PROVIDER, 'authenticated', sql, params);
const asStranger = (sql, params) => as(STRANGER, 'authenticated', sql, params);
const anon = (sql, params) => as(null, 'anon', sql, params);
const service = (sql, params) => as(null, 'service_role', sql, params);

const original = (await service(`
  select slug, vertical, archetype, location_modes, pricing_units, payment_template,
         cancellation_policy, config_version, pricing_mode
    from categories
   where slug = 'ac-repair'
`))[0];
ok(
  original.vertical === 'home-repairs'
    && original.archetype === 'inspect_quote'
    && original.location_modes.includes('at_customer')
    && original.pricing_units.includes('job')
    && original.payment_template === 'visit_then_balance'
    && original.cancellation_policy === 'standard_visit'
    && original.config_version === 1
    && original.pricing_mode === 'quote',
  'legacy category backfill has inspect_quote-safe configuration',
);
const cleaning = await service(`select vertical, archetype from categories where slug = 'house-cleaning'`);
ok(cleaning[0]?.vertical === 'cleaning' && cleaning[0]?.archetype === 'inspect_quote', 'cleaning remains inspect_quote until fixed booking migration');
const creator = await service(`select vertical, archetype, location_modes, active from categories where slug = 'instagram-influencer'`);
ok(
  creator[0]?.vertical === 'creators'
    && creator[0]?.archetype === 'proposal'
    && creator[0]?.location_modes.includes('remote')
    && creator[0]?.active === false,
  '0017 categories receive full-category configuration without going live',
);

const config = (await service(`select key, value from app_config where key in ('archetype_flags', 'launch_city')`))
  .reduce((out, row) => ({ ...out, [row.key]: row.value }), {});
ok(config.launch_city === 'Core City', 'launch city is derived from the existing provider-city data');
ok(config.archetype_flags?.inspect_quote === true && config.archetype_flags?.fixed === false, 'new archetypes are gated behind app_config');
ok((await anon(`select * from get_catalog('Core City')`)).length === 11, 'anon catalog exposes the 11 live legacy categories');
ok((await anon(`select * from get_catalog('Unknown City')`)).length === 0, 'catalog is empty for a city with no launch row');
ok((await asStranger(`select count(*)::int n from category_cities where live = false`))[0].n === 0, 'category city RLS exposes only live rows');
await expectError(
  () => asStranger(`insert into category_cities (category_id, city, live) values ('${acCategory}', 'Elsewhere', true)`),
  /permission denied|row-level security/,
  'clients cannot enable category cities',
);

const legacy = (await service(`
  select archetype, category_config_version, location_mode, pricing_snapshot,
         payment_template_snapshot, cancellation_snapshot, platform_fee_rule_snapshot
    from bookings where id = '${legacyBooking}'
`))[0];
ok(
  legacy.archetype === 'inspect_quote'
    && legacy.category_config_version === 1
    && legacy.location_mode === 'at_customer'
    && legacy.pricing_snapshot.visit_fee_paise === 19900
    && legacy.payment_template_snapshot.key === 'visit_then_balance'
    && legacy.cancellation_snapshot.key === 'standard_visit'
    && legacy.platform_fee_rule_snapshot.amount_paise === 2900,
  'pre-0018 bookings are backfilled without changing money fields',
);

const createBooking = async () => (
  await asCustomer(`select create_booking($1, 'AC not cooling', '2 Core Road', 'Core City', 16.51, 80.64)`, [providerService])
)[0].create_booking;
const booking1 = await createBooking();
const snapshot = (await service(`
  select archetype, category_config_version, location_mode, pricing_snapshot,
         payment_template_snapshot, cancellation_snapshot, platform_fee_rule_snapshot
    from bookings where id = '${booking1}'
`))[0];
ok(
  snapshot.archetype === 'inspect_quote'
    && snapshot.category_config_version === 1
    && snapshot.location_mode === 'at_customer'
    && snapshot.payment_template_snapshot.key === 'visit_then_balance'
    && snapshot.cancellation_snapshot.key === 'standard_visit',
  'new bookings receive category snapshots',
);
await expectError(
  () => service(`update bookings set cancellation_snapshot = '{"key":"changed"}' where id = '${booking1}'`),
  /immutable/,
  'booking snapshots are immutable',
);
await service(`update categories set config_version = 2, payment_template = 'visit_then_balance_v2' where id = '${acCategory}'`);
const booking2 = await createBooking();
const snapshot2 = (await service(`
  select category_config_version, payment_template_snapshot from bookings where id = '${booking2}'
`))[0];
ok(
  snapshot.category_config_version === 1
    && snapshot2.category_config_version === 2
    && snapshot2.payment_template_snapshot.key === 'visit_then_balance_v2',
  'a new booking snapshots a later category config version',
);

await service(`update category_cities set live = false where category_id = '${acCategory}' and lower(city) = 'core city'`);
await expectError(
  () => createBooking(),
  /category_not_bookable/,
  'create_booking rejects a category that is not live in the city',
);
await service(`update category_cities set live = true where category_id = '${acCategory}' and lower(city) = 'core city'`);
await service(`
  update app_config set value = '{"fixed":false,"inspect_quote":false,"proposal":false,"time_based":false,"remote":false}'
   where key = 'archetype_flags'
`);
await expectError(() => createBooking(), /category_not_bookable/, 'disabled archetypes stop new bookings');
await service(`update app_config set value = '{"fixed":false,"inspect_quote":true,"proposal":false,"time_based":false,"remote":false}' where key = 'archetype_flags'`);

await service(`update categories set archetype = 'proposal' where id = '${acCategory}'`);
await expectError(
  () => asCustomer(
    `select create_booking($1, 'Event request', '3 Venue Road', 'Core City', 16.51, 80.64)`,
    [providerService],
  ),
  /upgrade_required/,
  'legacy create_booking rejects non-inspect_quote categories with upgrade_required',
);
await service(`update categories set archetype = 'inspect_quote' where id = '${acCategory}'`);

const expectedTransitions = [
  'pending_payment:requested:system', 'pending_payment:accepted:system', 'pending_payment:cancelled:customer',
  'requested:accepted:provider', 'requested:declined:provider', 'requested:expired:system', 'requested:cancelled:customer',
  'accepted:en_route:provider', 'accepted:cancelled:customer',
  'en_route:inspecting:provider', 'en_route:in_progress:provider', 'en_route:cancelled:customer',
  'inspecting:quote_sent:provider',
  'quote_sent:awaiting_payment:customer', 'quote_sent:in_progress:customer', 'quote_sent:closed_no_work:customer',
  'awaiting_payment:in_progress:system', 'awaiting_payment:cancelled:customer',
  'in_progress:completion_requested:provider', 'in_progress:disputed:customer',
  'completion_requested:completed:provider', 'completion_requested:completed:customer',
  'completion_requested:completed:system', 'completion_requested:disputed:customer',
  'completed:closed:system', 'completed:disputed:customer',
  'disputed:refunded:admin', 'disputed:completed:admin',
];
const actualTransitions = (await anon(`
  select from_status || ':' || to_status || ':' || actor as value
    from archetype_transitions where archetype = 'inspect_quote'
   order by 1
`)).map((row) => row.value).sort();
ok(
  JSON.stringify(actualTransitions) === JSON.stringify(expectedTransitions.sort()),
  'transition table exactly matches the reconciled inspect_quote RPC paths',
);

async function pay(id) {
  const [payment] = await service(`select * from prepare_payment($1, $2)`, [id, CUSTOMER]);
  const link = `plink_${payment.payment_id.slice(0, 8)}`;
  await service(`update payments set razorpay_link_id = $1, short_url = 'https://rzp.test/x' where id = $2`, [link, payment.payment_id]);
  await service(`select record_payment_paid($1, $2, $3)`, [link, `pay_${payment.payment_id.slice(0, 8)}`, payment.amount]);
}
const flow = await createBooking();
await expectError(() => asCustomer(`select accept_booking('${flow}')`), /only the provider/, 'wrong actor cannot accept a booking');
await pay(flow);
await asProvider(`select accept_booking('${flow}')`);
await asProvider(`select start_trip('${flow}')`);
const [{ start_otp: otp }] = await asCustomer(`select * from get_booking_otps('${flow}')`);
await asProvider(`select arrive($1, $2)`, [flow, otp]);
const [{ send_quote: quoteId }] = await asProvider(
  `select send_quote($1, '[{"kind":"labour","title":"Repair","qty":1,"unit_price":150000}]'::jsonb)`,
  [flow],
);
await asCustomer(`select approve_quote($1, $2)`, [flow, quoteId]);
await pay(flow);
await asProvider(`select request_completion('${flow}')`);
const [{ end_otp: endOtp }] = await asCustomer(`select * from get_booking_otps('${flow}')`);
const completion = (await asProvider(`select complete_booking($1, $2) as result`, [flow, endOtp]))[0].result;
ok(completion.ok === true, 'real inspect_quote RPCs traverse the guarded transition contract');
await expectError(
  () => service(`select _set_status('${flow}', 'in_progress', '${PROVIDER}')`),
  /invalid transition/,
  'unguarded backwards transition is rejected even through the internal helper',
);

const [flowRow] = await service(`select status, archetype from bookings where id = '${flow}'`);
ok(flowRow.status === 'completed' && flowRow.archetype === 'inspect_quote', 'successful flow retains inspect_quote snapshot');
ok((await service(`select count(*)::int n from booking_events where booking_id = '${flow}'`))[0].n >= 10, 'guarded transitions still emit booking events');

console.log(failures === 0 ? '\nALL BOOKING CORE CHECKS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);

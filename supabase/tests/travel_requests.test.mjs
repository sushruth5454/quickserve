// Travel request M3 state machine and RLS tests. Run by supabase/tests npm test in CI.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mig = (f) =>
  fs
    .readFileSync(path.join(here, '..', 'migrations', f), 'utf8')
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
for (const f of [
  '0001_init.sql',
  '0002_qa_fixes.sql',
  '0003_payout_transfer_payment_cascade.sql',
  '0007_chat_unread_notifications.sql',
  '0008_provider_kyc_status_values.sql',
  '0009_provider_onboarding.sql',
  '0010_notification_freshness.sql',
  '0011_payout_rails.sql',
  '0012_matching_foundations.sql',
  '0014_travel_requests.sql',
]) {
  await db.exec(mig(f));
}

let failures = 0;
const ok = (condition, message) => {
  if (!condition) {
    failures += 1;
    console.log('FAIL:', message);
  } else console.log('ok  :', message);
};
const as = async (uid, role, sql, params = []) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
};
const svc = (sql, params) => as(null, 'service_role', sql, params);
const uuid = async () => (await db.query('select gen_random_uuid() as id')).rows[0].id;
const expectError = async (fn, regex, message) => {
  try {
    await fn();
    ok(false, `${message} (no error)`);
  } catch (error) {
    ok(regex.test(error.message), `${message} -> ${error.message}`);
  }
};

const [provider, customer, outsider] = [await uuid(), await uuid(), await uuid()];
await db.exec(`insert into auth.users (id, phone) values
  ('${provider}', '+919100000011'), ('${customer}', '+919100000012'), ('${outsider}', '+919100000013');
  update profiles set full_name = case id
    when '${provider}' then 'Priya Pro'
    when '${customer}' then 'Ravi Customer'
    else 'Other User' end
  where id in ('${provider}', '${customer}', '${outsider}');`);
await db.exec(`insert into providers (
    id, bio, city, base_location, service_radius_km, kyc_status, submitted_at, timezone
  ) values (
    '${provider}', 'AC specialist', 'Vijayawada',
    extensions.st_setsrid(extensions.st_makepoint(78.0, 17.0), 4326),
    5, 'verified', now(), 'Asia/Kolkata'
  );`);
const [{ id: categoryId }] = (await db.query(`select id from categories where slug = 'ac-repair'`)).rows;
const [{ id: serviceId }] = (
  await db.query(
    `insert into provider_services (
       provider_id, category_id, visit_fee, labour_rate, max_travel_km, travel_fee_mode, travel_fee_flat
     ) values ($1, $2, 14900, 30000, 15, 'flat', 4000) returning id`,
    [provider, categoryId],
  )
).rows;

const asProvider = (sql, params) => as(provider, 'authenticated', sql, params);
const asCustomer = (sql, params) => as(customer, 'authenticated', sql, params);
const asOutsider = (sql, params) => as(outsider, 'authenticated', sql, params);
const slot = async (hours) =>
  (
    await db.query(`select date_trunc('minute', now() + ($1 || ' hours')::interval) as t`, [String(hours)])
  ).rows[0].t;

await expectError(
  () => asProvider(`update provider_services set max_travel_km = 4 where id = $1`, [serviceId]),
  /at least the service radius/,
  'max travel distance cannot be smaller than the normal radius',
);

const preview = (
  await asCustomer(`select * from inspect_travel_request($1, 17.09, 78.0, $2)`, [serviceId, await slot(3)])
)[0];
ok(preview.needs_approval === true && preview.allowed === true, '10 km location needs approval and is allowed');
ok(Number(preview.distance_km) === 10 && preview.quoted_fee === 4000, 'distance and flat fee are computed server-side');

const outside = (
  await asCustomer(`select * from inspect_travel_request($1, 17.18, 78.0, $2)`, [serviceId, await slot(3)])
)[0];
ok(outside.needs_approval === true && outside.allowed === false, 'location beyond max travel is visible but not requestable');

await expectError(
  async () => asCustomer(`select create_booking($1, 'AC issue', '1 Road', 'Vijayawada', 17.09, 78.0, $2)`, [
    serviceId,
    await slot(3),
  ]),
  /travel approval required/,
  'booking beyond radius is rejected without approval',
);

const requestSlot = await slot(3);
const [{ create_travel_request: requestId }] = await asCustomer(
  `select create_travel_request($1, $2, 17.09, 78.0, 'Please call on arrival')`,
  [serviceId, requestSlot],
);
const expiry = (
  await svc(`select expires_at, created_at, service_window from travel_requests where id = $1`, [requestId])
)[0];
const slotMinusThirty = (await db.query(`select $1::timestamptz - interval '30 minutes' as x`, [requestSlot])).rows[0].x;
ok(
  new Date(expiry.expires_at).getTime() === new Date(slotMinusThirty).getTime(),
  'near-term request expires 30 minutes before its slot',
);
ok(String(expiry.service_window).includes('[') && String(expiry.service_window).includes(')'), 'travel request stores a two-hour range');
ok((await asOutsider(`select id from travel_requests where id = $1`, [requestId])).length === 0, 'outsider cannot read travel request');
ok((await asCustomer(`select id from travel_requests where id = $1`, [requestId])).length === 1, 'customer can read own request');
ok((await asProvider(`select id from travel_requests where id = $1`, [requestId])).length === 1, 'provider can read assigned request');
await expectError(
  () => asOutsider(`select respond_travel_request($1, true)`, [requestId]),
  /only the assigned provider/,
  'outsider cannot respond to request',
);
await expectError(
  () => asCustomer(`select create_booking($1, 'AC issue', '1 Road', 'Vijayawada', 17.09, 78.0, $2, '{}', $3)`, [
    serviceId,
    requestSlot,
    requestId,
  ]),
  /not approved/,
  'pending travel request cannot authorize booking',
);
ok(
  (await svc(`select count(*)::int as n from notifications where kind = 'travel_request_created' and user_id = $1`, [
    provider,
  ]))[0].n === 1,
  'creating a request queues provider notification',
);

await asProvider(`select respond_travel_request($1, true)`, [requestId]);
ok((await svc(`select status from travel_requests where id = $1`, [requestId]))[0].status === 'approved', 'provider approves travel request');
ok(
  (await svc(`select count(*)::int as n from notifications where kind = 'travel_request_approved' and user_id = $1`, [
    customer,
  ]))[0].n === 1,
  'approval queues customer notification',
);
await expectError(
  () =>
    asOutsider(`select create_booking($1, 'AC issue', '1 Road', 'Vijayawada', 17.09, 78.0, $2, '{}', $3)`, [
      serviceId,
      requestSlot,
      requestId,
    ]),
  /another customer/,
  'approved request cannot be used by another customer',
);
await expectError(
  () =>
    asCustomer(
      `select create_booking($1, 'AC issue', '1 Road', 'Vijayawada', 17.09, 78.0, $2, '{}', $3)`,
      [serviceId, await slot(5), requestId],
    ),
  /another window/,
  'approved request is bound to the exact two-hour window',
);

const [{ create_booking: bookingId }] = await asCustomer(
  `select create_booking($1, 'AC issue', '1 Road', 'Vijayawada', 17.09, 78.0, $2, '{}', $3)`,
  [serviceId, requestSlot, requestId],
);
ok(!!bookingId, 'approved unexpired request authorizes one booking');
ok((await svc(`select status from travel_requests where id = $1`, [requestId]))[0].status === 'used', 'approved request is consumed atomically');
await expectError(
  () =>
    asCustomer(`select create_booking($1, 'Again', '1 Road', 'Vijayawada', 17.09, 78.0, $2, '{}', $3)`, [
      serviceId,
      requestSlot,
      requestId,
    ]),
  /used|not approved/,
  'used request cannot authorize a second booking',
);

await svc(`update bookings set status = 'inspecting' where id = $1`, [bookingId]);
await asProvider(
  `select send_quote($1, '[{"kind":"labour","title":"Service","qty":1,"unit_price":10000}]'::jsonb)`,
  [bookingId],
);
const quote = (
  await asCustomer(`select q.*, (select jsonb_agg(qi) from quote_items qi where qi.quote_id = q.id) as items
     from quotes q where q.booking_id = $1`, [bookingId])
)[0];
ok(quote.subtotal_travel === 4000 && quote.total === 14000, 'travel fee is included in initial quote and subtotal');
ok(
  quote.items.some((line) => line.travel_request_id === requestId && line.title.includes('Travel fee')),
  'travel fee is stored as a marked, immutable quote line',
);

const declineSlot = await slot(5);
const [{ create_travel_request: declinedId }] = await asCustomer(
  `select create_travel_request($1, $2, 17.09, 78.0)`,
  [serviceId, declineSlot],
);
await expectError(
  () => asProvider(`select respond_travel_request($1, false, '   ')`, [declinedId]),
  /decline reason is required/,
  'declining requires a reason',
);
await asProvider(`select respond_travel_request($1, false, 'Schedule is full')`, [declinedId]);
ok((await svc(`select status from travel_requests where id = $1`, [declinedId]))[0].status === 'declined', 'provider can decline with reason');

const expiredSlot = await slot(6);
const [{ create_travel_request: expiredId }] = await asCustomer(
  `select create_travel_request($1, $2, 17.09, 78.0)`,
  [serviceId, expiredSlot],
);
const longExpiry = (
  await svc(`select extract(epoch from expires_at - created_at)::numeric as seconds from travel_requests where id = $1`, [expiredId])
)[0].seconds;
ok(Number(longExpiry) > 7100 && Number(longExpiry) < 7210, 'farther slot caps travel approval expiry at two hours');
await svc(`update travel_requests set expires_at = now() - interval '1 second' where id = $1`, [expiredId]);
ok((await svc(`select expire_travel_requests() as n`))[0].n >= 1, 'expiry sweeper transitions stale requests');
ok((await svc(`select status from travel_requests where id = $1`, [expiredId]))[0].status === 'expired', 'expired requests are terminal');

const mismatchSlot = await slot(7);
const [{ create_travel_request: mismatchId }] = await asCustomer(
  `select create_travel_request($1, $2, 17.09, 78.0)`,
  [serviceId, mismatchSlot],
);
await asProvider(`select respond_travel_request($1, true)`, [mismatchId]);
await expectError(
  () =>
    asCustomer(`select create_booking($1, 'AC issue', 'Elsewhere', 'Vijayawada', 17.12, 78.0, $2, '{}', $3)`, [
      serviceId,
      mismatchSlot,
      mismatchId,
    ]),
  /location does not match/,
  'approved request cannot be reused for a different distance',
);

if (failures) {
  console.error(`\n${failures} travel request test(s) failed`);
  process.exitCode = 1;
}

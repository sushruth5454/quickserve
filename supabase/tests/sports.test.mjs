import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sportsMigration = fs.readFileSync(path.join(here, '..', 'migrations', '0048_sports.sql'), 'utf8');
const prelude = `
create schema if not exists extensions;
create type extensions.geography as (lng float8, lat float8);
create function extensions.st_makepoint(x float8, y float8) returns extensions.geography language sql immutable as $$ select row(x, y)::extensions.geography $$;
create function extensions.st_setsrid(g extensions.geography, srid int) returns extensions.geography language sql immutable as $$ select g $$;
create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8 language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(b.lat - a.lat) / 2), 2) + cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - a.lng) / 2), 2))) $$;
create function extensions.st_dwithin(a extensions.geography, b extensions.geography, d float8) returns boolean language sql immutable as $$ select extensions.st_distance(a, b) <= d $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public, extensions to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, phone text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.profiles (
  id uuid primary key,
  full_name text not null default ''
);
create table public.admins (user_id uuid primary key references public.profiles(id));
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  action text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb
);
create table public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  label text not null,
  description text not null default '',
  group_name text not null default 'General',
  sort_order int not null default 100,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
create function public._assert(p_ok boolean, p_message text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) is not true then raise exception '%', p_message using errcode = 'P0001'; end if;
end
$$;
create function public._require_uid() returns uuid language plpgsql stable as $$
declare v_uid uuid := auth.uid();
begin
  perform public._assert(v_uid is not null, 'authentication required');
  return v_uid;
end
$$;
create function public._is_admin() returns boolean language sql stable as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid())
$$;
create function public._feature_enabled(p_key text) returns boolean language sql stable as $$
  select coalesce((select f.enabled from public.feature_flags f where f.key = p_key), false)
$$;
create function public.get_app_features() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_object_agg(f.key, f.enabled) from public.feature_flags f), '{}'::jsonb)
$$;
grant execute on function public._assert(boolean, text), public._require_uid(), public._is_admin(),
  public._feature_enabled(text), public.get_app_features() to anon, authenticated, service_role;
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  collapse_key text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create unique index notifications_pending_collapse_idx on public.notifications (user_id, collapse_key)
  where status = 'pending' and collapse_key is not null;
`;

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(prelude);
await db.exec(sportsMigration);
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

const owner = '00000000-0000-0000-0000-0000000000a1';
const customer1 = '00000000-0000-0000-0000-0000000000c1';
const customer2 = '00000000-0000-0000-0000-0000000000c2';
const admin = '00000000-0000-0000-0000-0000000000b1';
await db.exec(`
  insert into public.profiles (id, full_name) values
    ('${owner}', 'Venue Owner'), ('${customer1}', 'Customer One'),
    ('${customer2}', 'Customer Two'), ('${admin}', 'Sports Admin');
  insert into public.admins (user_id) values ('${admin}');
`);

const offCalls = [
  () => as(customer1, 'authenticated', `select * from public.list_sports_activities()`),
  () => as(customer1, 'authenticated', `select * from public.search_sports_venues('badminton', 16.5, 80.6, 15)`),
  () => as(customer1, 'authenticated', `select public.get_sports_venue(gen_random_uuid())`),
  () => as(customer1, 'authenticated', `select * from public.get_sports_slots(gen_random_uuid(), current_date)`),
  () => as(owner, 'authenticated', `select public.get_my_sports_venues()`),
  () => as(customer1, 'authenticated', `select public.get_my_sports_bookings()`),
  () => as(customer1, 'authenticated', `select public.get_sports_booking(gen_random_uuid())`),
  () => as(admin, 'authenticated', `select * from public.admin_list_sports_venues()`),
  () => as(admin, 'authenticated', `select * from public.admin_list_sports_activities()`),
  () => as(owner, 'authenticated', `select public.save_sports_resource(gen_random_uuid(), null::uuid, gen_random_uuid(), 'Court', 60, true)`),
  () => as(owner, 'authenticated', `select public.set_sports_hours(gen_random_uuid(), 1::smallint, time '08:00', time '20:00')`),
  () => as(owner, 'authenticated', `select public.save_sports_price_rule(gen_random_uuid(), null::uuid, null::smallint, time '08:00', time '20:00', 100, 'Standard')`),
  () => as(owner, 'authenticated', `select public.add_sports_block(gen_random_uuid(), now(), now() + interval '1 hour', '')`),
  () => as(owner, 'authenticated', `select public.remove_sports_block(gen_random_uuid())`),
  () => as(owner, 'authenticated', `select public.submit_sports_venue(gen_random_uuid())`),
  () => as(admin, 'authenticated', `select public.admin_set_venue_status(gen_random_uuid(), 'verified', '')`),
  () => as(admin, 'authenticated', `select public.admin_set_sports_activity(gen_random_uuid(), false)`),
  () => as(customer1, 'authenticated', `select public.request_sports_slot(gen_random_uuid(), now() + interval '1 day', 1, '')`),
  () => as(owner, 'authenticated', `select public.decide_sports_booking(gen_random_uuid(), true, '')`),
  () => as(customer1, 'authenticated', `select public.cancel_sports_booking(gen_random_uuid(), '')`),
  () => as(owner, 'authenticated', `select public.save_sports_venue(null::uuid, 'Off venue', '', '1 Test Road', 'Sangareddy', 'Center', 16.5::double precision, 80.6::double precision, array[]::text[], array[]::text[])`),
  () => db.query(`select public.expire_sports_requests()`),
];
let allOffCallsRefused = true;
for (const [index, call] of offCalls.entries()) {
  const message = await fails(call);
  if (!/turned off/.test(message ?? '')) {
    allOffCallsRefused = false;
    console.error(`Flag-off sports RPC ${index + 1} returned ${message ?? 'without an error'}`);
  }
}
ok(allOffCallsRefused, 'all customer, owner, admin and expiry RPCs are refused while the flag is off');
const directOffRows = await as(customer1, 'authenticated', `select id from public.sports_activities`);
ok(directOffRows.length === 0, 'RLS also hides sports catalogue tables while the feature flag is off');

await db.query(`update public.feature_flags set enabled = true where key = 'sports'`);
const activity = (await one(`select id from public.sports_activities where slug = 'badminton'`)).id;
const venue = (await as(owner, 'authenticated', `
  select public.save_sports_venue(
    null, 'Test Sports Hall', 'Courts for local players.', '1 Test Road',
    'Sangareddy', 'Center', 16.5, 80.6, array['Parking'], array['https://example.test/venue.jpg']
  ) id
`))[0].id;
const resource = (await as(owner, 'authenticated', `
  select public.save_sports_resource($1::uuid, null::uuid, $2::uuid, 'Court 1', 60, true) id
`, [venue, activity]))[0].id;
const tomorrow = (await one(`
  select extract(dow from (now() at time zone 'Asia/Kolkata')::date + 1)::smallint weekday
`)).weekday;
await as(owner, 'authenticated', `select public.set_sports_hours($1::uuid, $2::smallint, time '08:00', time '20:00')`, [venue, tomorrow]);
await as(owner, 'authenticated', `
  select public.save_sports_price_rule($1::uuid, null::uuid, null::smallint, time '08:00', time '20:00', 20000, 'Standard')
`, [resource]);
await as(owner, 'authenticated', `select public.submit_sports_venue($1::uuid)`, [venue]);

const searchBeforeVerify = await as(customer1, 'authenticated',
  `select * from public.search_sports_venues('badminton', 16.5, 80.6, 15)`);
ok(searchBeforeVerify.length === 0, 'unverified venue is not searchable');
await as(admin, 'authenticated', `select public.admin_set_venue_status($1::uuid, 'verified', '')`, [venue]);
const found = await as(customer1, 'authenticated',
  `select id, min_price_paise from public.search_sports_venues('badminton', 16.5, 80.6, 15)`);
ok(found.length === 1 && found[0].id === venue && found[0].min_price_paise === 20000,
  'verified venue search returns its server-configured minimum price');

const slot = (await one(`
  select ((now() at time zone 'Asia/Kolkata')::date + 1 + time '09:00') at time zone 'Asia/Kolkata' starts_at
`)).starts_at;
const block = (await as(owner, 'authenticated', `
  select public.add_sports_block($1::uuid, $2::timestamptz, $2::timestamptz + interval '1 hour', 'Maintenance') id
`, [resource, slot]))[0].id;
const blocked = await fails(() => as(customer1, 'authenticated', `
  select public.request_sports_slot($1::uuid, $2::timestamptz, 1, '')
`, [resource, slot]));
ok(/blocked by the venue/.test(blocked ?? ''), 'blocked slot cannot be requested');
await as(owner, 'authenticated', `select public.remove_sports_block($1::uuid)`, [block]);

await db.exec(`
  create function public.test_request_as(p_uid uuid, p_resource uuid, p_start timestamptz) returns uuid
  language plpgsql as $$
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    return public.request_sports_slot(p_resource, p_start, 1, '');
  end
  $$;
`);
const race = await Promise.all([
  db.query(`select public.test_request_as($1::uuid, $2::uuid, $3::timestamptz) id`, [customer1, resource, slot])
    .then((r) => ({ ok: true, id: r.rows[0].id })).catch((e) => ({ ok: false, error: e.message })),
  db.query(`select public.test_request_as($1::uuid, $2::uuid, $3::timestamptz) id`, [customer2, resource, slot])
    .then((r) => ({ ok: true, id: r.rows[0].id })).catch((e) => ({ ok: false, error: e.message })),
]);
ok(race.filter((r) => r.ok).length === 1, 'two customers racing for one slot produce exactly one booking');
const requested = race.find((r) => r.ok)?.id;
const storedPrice = (await one(`select price_paise from public.sports_bookings where id = $1`, [requested])).price_paise;
ok(storedPrice === 20000, 'booking price is calculated from the server-side price rule');
const notificationCount = (await one(`
  select count(*)::int n from public.notifications where kind = 'sports_booking_requested'
`)).n;
ok(notificationCount === 1, 'successful booking request notifies the venue owner once');

await db.query(`update public.sports_bookings set expires_at = now() - interval '1 second' where id = $1`, [requested]);
await db.query(`select public.expire_sports_requests()`);
const expired = (await one(`select status from public.sports_bookings where id = $1`, [requested])).status;
const nextSlots = await as(customer1, 'authenticated',
  `select state from public.get_sports_slots($1::uuid, (now() at time zone 'Asia/Kolkata')::date + 1) where starts_at = $2::timestamptz`,
  [resource, slot]);
ok(expired === 'expired' && nextSlots[0]?.state === 'free', 'expired request releases its slot');

const secondSlot = (await one(`
  select ((now() at time zone 'Asia/Kolkata')::date + 1 + time '10:00') at time zone 'Asia/Kolkata' starts_at
`)).starts_at;
const acceptedId = (await as(customer1, 'authenticated', `
  select public.request_sports_slot($1::uuid, $2::timestamptz, 1, '') id
`, [resource, secondSlot]))[0].id;
await as(owner, 'authenticated', `select public.decide_sports_booking($1::uuid, true, '')`, [acceptedId]);
const acceptedStatus = (await one(`select status from public.sports_bookings where id = $1`, [acceptedId])).status;
const acceptedNotice = (await one(`
  select count(*)::int n from public.notifications where kind = 'sports_booking_accepted'
`)).n;
ok(acceptedStatus === 'accepted' && acceptedNotice === 1, 'owner acceptance changes status and notifies the customer');

await db.query(`update public.feature_flags set enabled = false where key = 'sports'`);
const offAfterSetup = await fails(() => as(customer1, 'authenticated',
  `select public.get_my_sports_bookings()`));
const offDecision = await fails(() => as(admin, 'authenticated',
  `select public.admin_set_venue_status($1::uuid, 'verified', '')`, [venue]));
const offExpiry = await fails(() => db.query(`select public.expire_sports_requests()`));
ok(/turned off/.test(offAfterSetup ?? '') && /turned off/.test(offDecision ?? '') && /turned off/.test(offExpiry ?? ''),
  'feature-off customer, admin and maintenance RPCs are refused');

await db.close();
if (failures) process.exit(1);

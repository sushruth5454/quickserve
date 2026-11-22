import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const allocatedMigration = '0098_o20_sp06_oorva.sql';

const migration = (file) =>
  fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');

const numberedMigrations = fs.readdirSync(migrationsDir)
  .map((file) => ({ file, match: file.match(/^(\d{4})([a-z]?)_.+\.sql$/i) }))
  .filter(({ match }) => match)
  .sort((left, right) =>
    Number(left.match[1]) - Number(right.match[1])
    || left.match[2].localeCompare(right.match[2])
    || left.file.localeCompare(right.file))
  .map(({ file }) => file);

if (!numberedMigrations.includes('0087_ui_redesign_flags_guest_read.sql')) {
  throw new Error('0087_ui_redesign_flags_guest_read.sql must be loaded by this test');
}
if (!numberedMigrations.includes(allocatedMigration)) {
  throw new Error(`${allocatedMigration} must be loaded by this full-chain test`);
}

const prelude = `
create schema if not exists extensions;
create type extensions.geography as (lng float8, lat float8);
create type extensions.geometry as (lng float8, lat float8);
create function extensions.st_makepoint(x float8, y float8) returns extensions.geography
  language sql immutable as $$ select row(x, y)::extensions.geography $$;
create function extensions.st_setsrid(g extensions.geography, srid int) returns extensions.geography
  language sql immutable as $$ select g $$;
create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8
  language sql immutable as $$
    select 2 * 6371000 * asin(sqrt(power(sin(radians(b.lat - a.lat) / 2), 2)
      + cos(radians(a.lat)) * cos(radians(b.lat))
      * power(sin(radians(b.lng - a.lng) / 2), 2)))
  $$;
create function extensions.st_dwithin(a extensions.geography, b extensions.geography, d float8)
  returns boolean language sql immutable as $$ select extensions.st_distance(a, b) <= d $$;
create function extensions.geog_to_geom(g extensions.geography) returns extensions.geometry
  language sql immutable as $$ select row(g.lng, g.lat)::extensions.geometry $$;
create cast (extensions.geography as extensions.geometry)
  with function extensions.geog_to_geom(extensions.geography);
create function extensions.st_x(g extensions.geometry) returns float8
  language sql immutable as $$ select g.lng $$;
create function extensions.st_y(g extensions.geometry) returns float8
  language sql immutable as $$ select g.lat $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public, extensions to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, phone text, email text,
  phone_confirmed_at timestamptz, raw_app_meta_data jsonb default '{}',
  raw_user_meta_data jsonb default '{}', created_at timestamptz, updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(prelude);
for (const file of numberedMigrations) {
  try {
    await db.exec(migration(file));
  } catch (error) {
    throw new Error(`migration ${file} failed: ${error.message}`, { cause: error });
  }
}
await db.exec("set timezone = 'UTC'");

let phoneSequence = 0;

async function one(sql, params = []) {
  return (await db.query(sql, params)).rows[0];
}

async function as(uid, role, sql, params = []) {
  await db.exec(`
    reset role;
    select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);
    select set_config('request.jwt.claim.role', '${role}', false);
    set role ${role};
  `);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

async function setFlags({ guestBrowse, sports, online }) {
  const updated = await db.query(`
    update public.feature_flags as f
       set enabled = case f.key
         when 'guest_browse' then $1::boolean
         when 'sports' then $2::boolean
         when 'sports_online_payments' then $3::boolean
       end
     where f.key = any(array['guest_browse', 'sports', 'sports_online_payments']::text[])
    returning f.key
  `, [guestBrowse, sports, online]);
  if (updated.rows.length !== 3) {
    throw new Error(`Expected three sports read flags, updated ${JSON.stringify(updated.rows)}`);
  }
}

async function setRules(values) {
  const updated = await db.query(`
    update public.app_config as c
       set value = c.value || $1::jsonb
     where c.key = 'sports_rules'::text
    returning c.key
  `, [JSON.stringify(values)]);
  if (updated.rows.length !== 1) {
    throw new Error(`Expected one sports_rules row, updated ${JSON.stringify(updated.rows)}`);
  }
}

async function addUser(label) {
  phoneSequence += 1;
  const userId = randomUUID();
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [userId, `+9198${String(phoneSequence).padStart(8, '0')}`]);
  await db.query(`
    update public.profiles as p
       set full_name = $1::text
     where p.id = $2::uuid
  `, [`O20-SP06 ${label}`, userId]);
  return userId;
}

async function createFixture(label, { cancellationRules = {}, slotMinutes = 60, capacity = 2 } = {}) {
  const ownerId = await addUser(`${label} owner`);
  const customerId = await addUser(`${label} customer`);
  const activityId = (await one(`
    select a.id from public.sports_activities as a where a.slug = 'badminton'::text
  `)).id;
  const venueId = (await one(`
    insert into public.sports_venues (
      owner_id, name, description, address_line, city, area, lat, lng,
      status, payment_modes, cancellation_rules
    ) values (
      $1::uuid, $2::text, 'Public sports venue'::text, 'Private venue street'::text,
      'Sangareddy'::text, 'Center'::text, 16.5::double precision, 80.6::double precision,
      'verified'::text, array['online', 'pay_at_venue']::text[], $3::jsonb
    )
    returning id
  `, [ownerId, `O20-SP06 ${label}`, JSON.stringify(cancellationRules)])).id;
  const accountSuffix = randomUUID().replaceAll('-', '');
  await db.query(`
    insert into public.provider_payout_accounts
      (provider_id, rail, activation_status, razorpay_account_id, fund_account_id)
    values ($1::uuid, 'payouts'::text, 'activated'::text, $2::text, $3::text)
  `, [ownerId, `acc_${accountSuffix}`, `fa_${accountSuffix}`]);
  const resourceId = (await one(`
    insert into public.sports_resources (
      venue_id, activity_id, name, slot_minutes, active, booking_mode, capacity
    ) values ($1::uuid, $2::uuid, $3::text, $4::int, true, 'approval'::text, $5::int)
    returning id
  `, [venueId, activityId, `O20-SP06 ${label} court`, slotMinutes, capacity])).id;
  await db.query(`
    insert into public.sports_price_rules (resource_id, weekday, starts, ends, price_paise)
    values ($1::uuid, null::smallint, time '00:00', time '23:59', 25000::int)
  `, [resourceId]);
  return { ownerId, customerId, venueId, resourceId };
}

async function addHours(fixture, day, opens, closes) {
  await db.query(`
    insert into public.sports_hours (venue_id, weekday, opens, closes)
    select $1::uuid, extract(dow from $2::date)::smallint, $3::time, $4::time
  `, [fixture.venueId, day, opens, closes]);
}

async function getVenue(uid, role, venueId) {
  return (await as(uid, role, `
    select public.get_sports_venue($1::uuid) as venue
  `, [venueId]))[0].venue;
}

function policyMatches(actual, expected) {
  return actual !== null
    && typeof actual === 'object'
    && !Array.isArray(actual)
    && Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => actual[key] === value);
}

async function failureOf(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error?.message ?? String(error);
  }
}

async function inTransaction(run) {
  await db.exec('begin');
  try {
    await run();
  } finally {
    await db.exec('rollback');
  }
}

await scenario('SP-LATEST-POLICY-PROJECTION', async () => {
  await setFlags({ guestBrowse: true, sports: true, online: true });
  await setRules({ full_refund_hours: 24, partial_refund_hours: 6, partial_refund_bp: 2500 });
  const fixture = await createFixture('latest-policy', {
    cancellationRules: {
      full_refund_hours: 48,
      partial_refund_hours: 12,
      partial_refund_bp: 4000,
    },
  });
  const venue = await getVenue(null, 'anon', fixture.venueId);
  const expected = {
    full_refund_hours: 48,
    partial_refund_hours: 12,
    partial_refund_bp: 4000,
  };
  ok(
    policyMatches(venue?.cancellation_policy, expected)
      && !Object.hasOwn(venue ?? {}, 'cancellation_rules')
      && !Object.hasOwn(venue ?? {}, 'owner_id'),
    `[SP-LATEST-POLICY-PROJECTION] expected safe effective policy ${JSON.stringify(expected)}; actual ${JSON.stringify({ venue })}`,
  );
});

await scenario('SP-PER-FIELD-FALLBACK', async () => {
  await setFlags({ guestBrowse: true, sports: true, online: true });
  await setRules({ full_refund_hours: 36, partial_refund_hours: 9, partial_refund_bp: 3000 });
  const fixture = await createFixture('per-field-fallback', {
    cancellationRules: {
      full_refund_hours: 72,
      partial_refund_bp: 1000,
    },
  });
  const venue = await getVenue(null, 'anon', fixture.venueId);
  const expected = {
    full_refund_hours: 72,
    partial_refund_hours: 9,
    partial_refund_bp: 1000,
  };
  ok(
    policyMatches(venue?.cancellation_policy, expected),
    `[SP-PER-FIELD-FALLBACK] each missing venue scalar falls back independently; expected ${JSON.stringify(expected)}, actual ${JSON.stringify({ venue })}`,
  );
});

await scenario('SP-LEAD-BOUNDARY', async () => {
  await inTransaction(async () => {
    await setFlags({ guestBrowse: true, sports: true, online: true });
    const timing = await one(`
      with desired as (
        select floor(extract(epoch from (
          ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day 12 hours')
            at time zone 'Asia/Kolkata') - now()
        )) / 60)::int as lead_minutes
      )
      select d.lead_minutes,
             ((now() + make_interval(mins => d.lead_minutes) - interval '30 minutes')
               at time zone 'Asia/Kolkata')::date::text as slot_day,
             ((now() + make_interval(mins => d.lead_minutes) - interval '30 minutes')
               at time zone 'Asia/Kolkata')::time::text as opens,
             ((now() + make_interval(mins => d.lead_minutes) + interval '60 minutes')
               at time zone 'Asia/Kolkata')::time::text as closes
        from desired as d
    `);
    await setRules({ min_lead_minutes: timing.lead_minutes });
    const fixture = await createFixture('lead-boundary', { slotMinutes: 30, capacity: 2 });
    await addHours(fixture, timing.slot_day, timing.opens, timing.closes);
    const slots = await as(null, 'anon', `
      select s.starts_at::text as starts_at, s.state, s.price_paise, s.remaining
        from public.get_sports_slots($1::uuid, $2::date) as s
       order by s.starts_at
    `, [fixture.resourceId, timing.slot_day]);
    const expectedStates = ['blocked', 'blocked', 'free'];
    ok(
      timing.lead_minutes > 0
        && timing.lead_minutes <= 43200
        && JSON.stringify(slots.map((slot) => slot.state)) === JSON.stringify(expectedStates)
        && slots.every((slot) => slot.price_paise === 25000 && slot.remaining === 2),
      `[SP-LEAD-BOUNDARY] cutoff is inclusive and starts after it stay selectable; expected states ${JSON.stringify(expectedStates)}, actual ${JSON.stringify({ timing, slots })}`,
    );
  });
});

await scenario('SP-EXACT-HORIZON', async () => {
  await inTransaction(async () => {
    await setFlags({ guestBrowse: true, sports: true, online: true });
    const timing = await one(`
      select ((now() + interval '30 days' - interval '30 minutes')
                at time zone 'Asia/Kolkata')::date::text as slot_day,
             ((now() + interval '30 days' - interval '30 minutes')
                at time zone 'Asia/Kolkata')::time::text as opens,
             ((now() + interval '30 days' + interval '60 minutes')
                at time zone 'Asia/Kolkata')::time::text as closes,
             ((now() + interval '30 days') at time zone 'Asia/Kolkata')::time::text
               as horizon_local_time
    `);
    await setRules({ min_lead_minutes: 30 });
    const fixture = await createFixture('exact-horizon', { slotMinutes: 30, capacity: 2 });
    await addHours(fixture, timing.slot_day, timing.opens, timing.closes);
    const slots = await as(null, 'anon', `
      select s.starts_at::text as starts_at, s.state, s.price_paise, s.remaining
        from public.get_sports_slots($1::uuid, $2::date) as s
       order by s.starts_at
    `, [fixture.resourceId, timing.slot_day]);
    const expectedStates = ['free', 'free', 'blocked'];
    ok(
      JSON.stringify(slots.map((slot) => slot.state)) === JSON.stringify(expectedStates)
        && slots.every((slot) => slot.price_paise === 25000 && slot.remaining === 2),
      `[SP-EXACT-HORIZON] equality at now()+30 days remains eligible and later starts are blocked; expected states ${JSON.stringify(expectedStates)}, actual ${JSON.stringify({ timing, slots })}`,
    );
  });
});

await scenario('SP-GUEST-SAFE-FIELDS-AND-PARENT-GATES', async () => {
  await setFlags({ guestBrowse: true, sports: true, online: true });
  await setRules({ full_refund_hours: 24, partial_refund_hours: 6, partial_refund_bp: 2500 });
  const fixture = await createFixture('safe-guest-fields', {
    cancellationRules: { full_refund_hours: 48 },
  });
  const sportsSearch = await as(null, 'anon', `
    select v.id, v.name, v.address_line, v.city, v.area, v.lat, v.lng
      from public.search_sports_venues(
        $1::text, $2::double precision, $3::double precision, $4::double precision
      ) as v
  `, ['badminton', 16.5, 80.6, 15]);
  const sportsVenue = await getVenue(null, 'anon', fixture.venueId);
  const authenticatedVenue = await getVenue(fixture.customerId, 'authenticated', fixture.venueId);
  const serializedGuestVenue = JSON.stringify(sportsVenue);
  const safeFields = sportsSearch.every((row) =>
    row.address_line === '' && row.lat === null && row.lng === null)
    && sportsSearch.some((row) => row.id === fixture.venueId)
    && sportsVenue?.address_line === ''
    && sportsVenue?.lat === null
    && sportsVenue?.lng === null
    && sportsVenue?.cancellation_policy?.full_refund_hours === 48
    && !Object.hasOwn(sportsVenue ?? {}, 'owner_id')
    && !Object.hasOwn(sportsVenue ?? {}, 'cancellation_rules')
    && !serializedGuestVenue.includes('razorpay_account_id')
    && !serializedGuestVenue.includes('fund_account_id')
    && !serializedGuestVenue.includes('Private venue street');
  await setFlags({ guestBrowse: false, sports: true, online: true });
  const guestParentError = await failureOf(() => getVenue(null, 'anon', fixture.venueId));
  const authenticatedWithGuestBrowseOff = await getVenue(
    fixture.customerId,
    'authenticated',
    fixture.venueId,
  );
  await setFlags({ guestBrowse: true, sports: false, online: true });
  const sportsOffError = await failureOf(() => getVenue(fixture.customerId, 'authenticated', fixture.venueId));
  await setFlags({ guestBrowse: true, sports: true, online: true });
  await db.query(`
    update public.sports_venues as v
       set status = 'submitted'::text
     where v.id = $1::uuid
  `, [fixture.venueId]);
  const hiddenVenue = await getVenue(null, 'anon', fixture.venueId);
  const diagnostics = {
    sportsSearch,
    sportsVenue,
    authenticatedVenue,
    guestParentError,
    authenticatedWithGuestBrowseOff,
    sportsOffError,
    hiddenVenue,
  };
  ok(
    safeFields
      && sportsVenue?.online_payment_ready === true
      && authenticatedVenue?.address_line === 'Private venue street'
      && authenticatedVenue?.lat === 16.5
      && authenticatedVenue?.lng === 80.6
      && guestParentError?.includes('Sports & venues are turned off right now.')
      && authenticatedWithGuestBrowseOff?.address_line === 'Private venue street'
      && sportsOffError?.includes('Sports & venues are turned off right now.')
      && hiddenVenue === null,
    `[SP-GUEST-SAFE-FIELDS-AND-PARENT-GATES] expected safe guest projection, unchanged authenticated access and parent gates; actual ${JSON.stringify(diagnostics)}`,
  );
});

finish();

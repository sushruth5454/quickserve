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
const allocatedMigration = '0102_o20_sp11_oorva.sql';
const fixedDay = '2026-12-15';

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
  throw new Error('0087_ui_redesign_flags_guest_read.sql must be loaded by this full-chain test');
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
  await db.exec('savepoint o20_sp11_as_call;');
  await db.exec(`
    reset role;
    select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);
    select set_config('request.jwt.claim.role', '${role}', false);
    set role ${role};
  `);
  try {
    const result = await db.query(sql, params);
    await db.exec('reset role; release savepoint o20_sp11_as_call;');
    return result.rows;
  } catch (error) {
    await db.exec('rollback to savepoint o20_sp11_as_call; reset role; release savepoint o20_sp11_as_call;');
    throw error;
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

async function setFlags({ sports = true, multiSlot = true } = {}) {
  const rows = await db.query(`
    update public.feature_flags as f
       set enabled = case f.key
         when 'sports' then $1::boolean
         when 'sports_multi_slot' then $2::boolean
       end
     where f.key = any(array['sports', 'sports_multi_slot']::text[])
    returning f.key, f.enabled
  `, [sports, multiSlot]);
  if (rows.rows.length !== 2) {
    throw new Error(`Expected two sports flags to update: ${JSON.stringify(rows.rows)}`);
  }
  return rows.rows;
}

async function setRules(patch) {
  const rows = await db.query(`
    update public.app_config as c
       set value = c.value || $1::jsonb
     where c.key = 'sports_rules'::text
    returning c.key, c.value
  `, [JSON.stringify(patch)]);
  if (rows.rows.length !== 1) {
    throw new Error(`Expected one sports_rules row to update: ${JSON.stringify(rows.rows)}`);
  }
  return rows.rows[0].value;
}

async function createFixture(label, { capacity = 2, customers = 4, paymentModes = ['online', 'pay_at_venue'] } = {}) {
  const ownerId = randomUUID();
  const customerIds = Array.from({ length: customers }, () => randomUUID());
  for (const [index, userId] of [ownerId, ...customerIds].entries()) {
    phoneSequence += 1;
    await db.query(`
      insert into auth.users (id, phone, raw_user_meta_data)
      values ($1::uuid, $2::text, '{}'::jsonb)
    `, [userId, `+9198${String(phoneSequence).padStart(8, '0')}`]);
    await db.query(`
      update public.profiles as p
         set full_name = $1::text
       where p.id = $2::uuid
    `, [`O20-SP11 ${label} user ${index}`, userId]);
  }
  const activityId = (await one(`
    select a.id from public.sports_activities as a where a.slug = 'badminton'::text
  `)).id;
  const venueId = (await one(`
    insert into public.sports_venues (
      owner_id, name, description, address_line, city, area, lat, lng,
      status, payment_modes, cancellation_rules
    ) values (
      $1::uuid, $2::text, 'SP11 test venue'::text, 'Private SP11 street'::text,
      'Sangareddy'::text, 'Center'::text, 16.5::double precision, 80.6::double precision,
      'verified'::text, $3::text[], '{}'::jsonb
    )
    returning id
  `, [ownerId, `O20-SP11 ${label}`, paymentModes])).id;
  const suffix = randomUUID().replaceAll('-', '');
  await db.query(`
    insert into public.provider_payout_accounts
      (provider_id, rail, activation_status, razorpay_account_id, fund_account_id)
    values ($1::uuid, 'payouts'::text, 'activated'::text, $2::text, $3::text)
  `, [ownerId, `acc_${suffix}`, `fa_${suffix}`]);
  await db.query(`
    insert into public.sports_hours (venue_id, weekday, opens, closes)
    select $1::uuid, day::smallint, time '08:00', time '20:00'
      from generate_series(0, 6) as day
  `, [venueId]);
  const resourceId = (await one(`
    insert into public.sports_resources (
      venue_id, activity_id, name, slot_minutes, active, booking_mode, capacity
    ) values ($1::uuid, $2::uuid, $3::text, 60::int, true, 'approval'::text, $4::int)
    returning id
  `, [venueId, activityId, `O20-SP11 ${label} court`, capacity])).id;
  await db.query(`
    insert into public.sports_price_rules (resource_id, weekday, starts, ends, price_paise)
    values ($1::uuid, null::smallint, time '08:00', time '20:00', 20000::int)
  `, [resourceId]);
  return { ownerId, customerIds, venueId, resourceId, capacity };
}

async function startsAt(time) {
  return (await one(`
    select ($1::date + $2::time) at time zone 'Asia/Kolkata' starts_at
  `, [fixedDay, time])).starts_at;
}

async function seedAccepted(fixture, customerId, time, participants = 1) {
  const start = await startsAt(time);
  return (await one(`
    insert into public.sports_bookings (
      customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise,
      note, expires_at, payment_mode, participants, total_paise
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz + interval '1 hour',
      'accepted'::text, 20000::int, ''::text, now() + interval '1 hour',
      'pay_at_venue'::text, $5::int, 20000::int * $5::int
    )
    returning id
  `, [customerId, fixture.venueId, fixture.resourceId, start, participants])).id;
}

async function requestSlot(fixture, customerId, time, slots = 1) {
  const start = await startsAt(time);
  return (await as(customerId, 'authenticated', `
    select public.request_sports_slot(
      $1::uuid, $2::timestamptz, $3::int, $4::text
    ) as id
  `, [fixture.resourceId, start, slots, 'O20-SP11 legacy request']))[0].id;
}

async function failureOf(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error?.message ?? String(error);
  }
}

async function bookingState(resourceId, start, slots = 2) {
  return (await db.query(`
    select b.id, b.customer_id, b.starts_at, b.ends_at, b.status::text as status,
           b.payment_mode::text as payment_mode, b.participants,
           b.price_paise, b.total_paise
      from public.sports_bookings as b
     where b.resource_id = $1::uuid
       and b.starts_at < $2::timestamptz + make_interval(mins => 60::int * $3::int)
       and b.ends_at > $2::timestamptz
     order by b.starts_at, b.id
  `, [resourceId, start, slots])).rows;
}

async function slotOccupancy(resourceId, start, slots = 2) {
  return (await db.query(`
    select requested.slot_index::int as slot_index, slot.slot_start,
           coalesce(sum(b.participants), 0)::int as occupied,
           coalesce(jsonb_agg(jsonb_build_object(
             'id', b.id, 'customer_id', b.customer_id, 'participants', b.participants,
             'status', b.status::text, 'starts_at', b.starts_at, 'ends_at', b.ends_at
           ) order by b.starts_at, b.id) filter (where b.id is not null), '[]'::jsonb) as booking_rows
      from generate_series(0, $3::int - 1) as requested(slot_index)
      cross join lateral (
        select $2::timestamptz
          + make_interval(mins => 60::int * requested.slot_index) as slot_start
      ) as slot
      left join public.sports_bookings as b
        on b.resource_id = $1::uuid
       and b.starts_at < slot.slot_start + interval '60 minutes'
       and b.ends_at > slot.slot_start
       and (
         b.status = 'accepted'
         or (b.status = 'requested' and b.expires_at > now())
         or (b.status = 'awaiting_payment' and b.pay_by > now())
         or (b.status = 'pending_payment' and b.hold_expires_at > now())
       )
     group by requested.slot_index, slot.slot_start
     order by requested.slot_index
  `, [resourceId, start, slots])).rows;
}

await scenario('SP-LEGACY-ADJACENT-SLOTS-USE-MAX-OCCUPANCY', async () => {
  await inTransaction(async () => {
    const flags = await setFlags();
    const fixture = await createFixture('adjacent-capacity', { capacity: 2, customers: 4 });
    const firstSeed = await seedAccepted(fixture, fixture.customerIds[0], '10:00');
    const secondSeed = await seedAccepted(fixture, fixture.customerIds[1], '11:00');
    const start = await startsAt('10:00');
    const requestId = await requestSlot(fixture, fixture.customerIds[2], '10:00', 2);
    const actual = (await one(`
      select b.id, b.status::text as status, b.payment_mode::text as payment_mode,
             b.participants, b.price_paise, b.total_paise
        from public.sports_bookings as b
       where b.id = $1::uuid
    `, [requestId]));
    const occupancy = await slotOccupancy(fixture.resourceId, start);
    const rows = await bookingState(fixture.resourceId, start);
    const expected = {
      status: 'requested',
      payment_mode: 'pay_at_venue',
      participants: 1,
      price_paise: 40000,
      total_paise: 40000,
      occupancy: [2, 2],
    };
    const actualState = {
      actual,
      occupancy: occupancy.map(({ occupied }) => occupied),
      occupancyRows: occupancy,
      bookingRows: rows,
      seedIds: [firstSeed, secondSeed],
      flags,
      fixture,
    };
    ok(
      actual?.status === expected.status
        && actual?.payment_mode === expected.payment_mode
        && actual?.participants === expected.participants
        && actual?.price_paise === expected.price_paise
        && actual?.total_paise === expected.total_paise
        && JSON.stringify(actualState.occupancy) === JSON.stringify(expected.occupancy)
        && actualState.occupancy.every((used) => used <= fixture.capacity)
        && rows.length === 3,
      `[SP-LEGACY-ADJACENT-SLOTS-USE-MAX-OCCUPANCY] expected ${JSON.stringify(expected)}; actual ${JSON.stringify(actualState)}`,
    );
  });
});

await scenario('SP-LEGACY-FULL-SEGMENT-REJECTS-SPAN', async () => {
  await inTransaction(async () => {
    const flags = await setFlags();
    const fixture = await createFixture('full-segment', { capacity: 2, customers: 5 });
    const seedIds = [
      await seedAccepted(fixture, fixture.customerIds[0], '10:00'),
      await seedAccepted(fixture, fixture.customerIds[1], '10:00'),
      await seedAccepted(fixture, fixture.customerIds[2], '11:00'),
    ];
    const start = await startsAt('10:00');
    const requestError = await failureOf(() => requestSlot(fixture, fixture.customerIds[3], '10:00', 2));
    const rows = await bookingState(fixture.resourceId, start);
    const occupancy = await slotOccupancy(fixture.resourceId, start);
    const requesterRows = rows.filter((row) => row.customer_id === fixture.customerIds[3]);
    const expected = { error: 'slot is no longer available', occupancy: [2, 1], bookingCount: 3 };
    const actual = {
      requestError,
      occupancy: occupancy.map(({ occupied }) => occupied),
      occupancyRows: occupancy,
      bookingRows: rows,
      requesterRows,
      seedIds,
      flags,
      fixture,
    };
    ok(
      /slot is no longer available/.test(requestError ?? '')
        && JSON.stringify(actual.occupancy) === JSON.stringify(expected.occupancy)
        && rows.length === expected.bookingCount
        && requesterRows.length === 0,
      `[SP-LEGACY-FULL-SEGMENT-REJECTS-SPAN] expected ${JSON.stringify(expected)}; actual ${JSON.stringify(actual)}`,
    );
  });
});

await scenario('SP-LEGACY-PARENT-FEATURE-OFF-REJECTS', async () => {
  await inTransaction(async () => {
    const flags = await setFlags({ sports: false, multiSlot: true });
    const fixture = await createFixture('parent-off');
    const requestError = await failureOf(() => requestSlot(fixture, fixture.customerIds[0], '10:00', 2));
    const rows = await bookingState(fixture.resourceId, await startsAt('10:00'));
    const actual = { requestError, rows, flags, fixture };
    ok(
      /Sports & venues are turned off right now/.test(requestError ?? '') && rows.length === 0,
      `[SP-LEGACY-PARENT-FEATURE-OFF-REJECTS] expected no request row; actual ${JSON.stringify(actual)}`,
    );
  });
});

await scenario('SP-LEGACY-MULTI-SLOT-FEATURE-OFF-REJECTS', async () => {
  await inTransaction(async () => {
    const flags = await setFlags({ sports: true, multiSlot: false });
    const fixture = await createFixture('multi-slot-off');
    const requestError = await failureOf(() => requestSlot(fixture, fixture.customerIds[0], '12:00', 2));
    const rows = await bookingState(fixture.resourceId, await startsAt('12:00'));
    const actual = { requestError, rows, flags, fixture };
    ok(
      /Sports multi-slot booking is turned off right now/.test(requestError ?? '') && rows.length === 0,
      `[SP-LEGACY-MULTI-SLOT-FEATURE-OFF-REJECTS] expected no request row; actual ${JSON.stringify(actual)}`,
    );
  });
});

await scenario('SP-LEGACY-OWNER-SELF-BOOKING-REJECTS', async () => {
  await inTransaction(async () => {
    const flags = await setFlags();
    const fixture = await createFixture('owner-self-booking');
    const requestError = await failureOf(() => requestSlot(fixture, fixture.ownerId, '14:00', 1));
    const rows = await bookingState(fixture.resourceId, await startsAt('14:00'));
    const actual = { requestError, rows, flags, fixture };
    ok(
      /venue owners cannot book their own venue/.test(requestError ?? '') && rows.length === 0,
      `[SP-LEGACY-OWNER-SELF-BOOKING-REJECTS] expected no request row; actual ${JSON.stringify(actual)}`,
    );
  });
});

await scenario('SP-LEGACY-ONLINE-ONLY-VENUE-REJECTS-PAY-AT-VENUE', async () => {
  await inTransaction(async () => {
    const flags = await setFlags();
    const fixture = await createFixture('online-only', { paymentModes: ['online'] });
    const requestError = await failureOf(() => requestSlot(fixture, fixture.customerIds[0], '16:00', 1));
    const rows = await bookingState(fixture.resourceId, await startsAt('16:00'));
    const actual = { requestError, rows, flags, fixture };
    ok(
      /This venue does not accept pay-at-venue booking yet/.test(requestError ?? '') && rows.length === 0,
      `[SP-LEGACY-ONLINE-ONLY-VENUE-REJECTS-PAY-AT-VENUE] expected no request row; actual ${JSON.stringify(actual)}`,
    );
  });
});

await scenario('SP-LEGACY-ACTIVE-HOLD-LIMIT-REJECTS', async () => {
  await inTransaction(async () => {
    const flags = await setFlags();
    const rules = await setRules({ max_active_holds_per_customer: 1 });
    const fixture = await createFixture('active-hold-limit', { customers: 2 });
    const holdId = (await one(`
      insert into public.sports_bookings (
        customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise,
        note, expires_at, payment_mode, participants, total_paise
      ) values (
        $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz + interval '1 hour',
        'requested'::text, 20000::int, ''::text, now() + interval '1 hour',
        'pay_at_venue'::text, 1::int, 20000::int
      )
      returning id
    `, [
      fixture.customerIds[0], fixture.venueId, fixture.resourceId, await startsAt('10:00'),
    ])).id;
    const requestError = await failureOf(() => requestSlot(fixture, fixture.customerIds[0], '12:00', 1));
    const rows = await bookingState(fixture.resourceId, await startsAt('10:00'));
    const requesterRows = rows.filter((row) => row.customer_id === fixture.customerIds[0]);
    const actual = { requestError, rows, requesterRows, holdId, rules, flags, fixture };
    ok(
      /too many pending sports bookings/.test(requestError ?? '')
        && rows.length === 1
        && requesterRows.length === 1
        && requesterRows[0]?.id === holdId,
      `[SP-LEGACY-ACTIVE-HOLD-LIMIT-REJECTS] expected the existing hold only; actual ${JSON.stringify(actual)}`,
    );
  });
});

finish();

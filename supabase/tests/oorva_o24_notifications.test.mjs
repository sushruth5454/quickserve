import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const migration = (file) =>
  fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
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
    instance_id uuid, id uuid primary key, aud text, role text, phone text,
    phone_confirmed_at timestamptz, raw_app_meta_data jsonb default '{}',
    raw_user_meta_data jsonb default '{}', created_at timestamptz, updated_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
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
`);

const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}[a-z]?_.*\.sql$/.test(name))
  .sort();
for (const file of migrationFiles.filter((name) => name !== '0134_o24_notifications_oorva.sql')) {
  await db.exec(migration(file));
}
await db.exec("set timezone = 'UTC'");

async function as(uid, role, query, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [uid ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function createUser(name) {
  const id = randomUUID();
  const phone = `+1555${randomUUID().replace(/\D/g, '').slice(0, 10)}`;
  await db.query(
    `insert into auth.users (id, phone, raw_user_meta_data) values ($1::uuid, $2::text, '{}'::jsonb)`,
    [id, phone],
  );
  await db.query(
    `update public.profiles set full_name = $2::text where id = $1::uuid`,
    [id, name],
  );
  return id;
}

const preMigrationRecipient = await createUser('O24 Notification Recipient');
const preMigrationRowId = randomUUID();
const preMigrationCreatedAt = '2025-01-02T03:04:05.000Z';
const preMigrationUpdatedAt = '2026-02-03T04:05:06.000Z';
const preMigrationPayload = {
  url: '/recurring/legacy-route',
  _notification_time_source: 'queued_event',
  private_marker: 'unchanged',
};
await db.query(`
  insert into public.notifications (
    id, user_id, kind, title, body, data, count, status, created_at, updated_at
  ) values (
    $1::uuid, $2::uuid, 'booking_accepted'::text, 'Legacy O24'::text, 'History'::text,
    $3::jsonb, 3::int, 'pending'::text, $4::timestamptz, $5::timestamptz
  )
`, [
  preMigrationRowId,
  preMigrationRecipient,
  JSON.stringify(preMigrationPayload),
  preMigrationCreatedAt,
  preMigrationUpdatedAt,
]);
const preMigrationNonObjectId = randomUUID();
const preMigrationNonObjectPayload = ['historical'];
await db.query(`
  insert into public.notifications (
    id, user_id, kind, title, body, data, count, status, created_at, updated_at
  ) values (
    $1::uuid, $2::uuid, 'booking_accepted'::text, 'Legacy array'::text, 'History'::text,
    $3::jsonb, 1::int, 'pending'::text, $4::timestamptz, $5::timestamptz
  )
`, [
  preMigrationNonObjectId,
  preMigrationRecipient,
  JSON.stringify(preMigrationNonObjectPayload),
  preMigrationCreatedAt,
  preMigrationUpdatedAt,
]);
await db.exec(migration('0134_o24_notifications_oorva.sql'));

async function createBookingFixture() {
  const customerId = await createUser('Customer O24');
  const ownerId = await createUser('Provider O24');
  const managerId = await createUser('Manager O24');
  const staffId = await createUser('Staff O24');
  const outsiderId = await createUser('Outsider O24');
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended
    ) values (
      $1::uuid, 'O24 City'::text,
      extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', now(), 'approved', true, false, false
    )
  `, [ownerId]);
  const categoryId = (await db.query(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::text, 'O24 Repair'::text, 'quote'::public.pricing_mode, true, 'inspect_quote'::text,
      '{}'::jsonb, 1::int, 365::int, false, array[]::text[], 0::int
    ) returning id
  `, [`o24-${randomUUID().replaceAll('-', '')}`])).rows[0].id;
  await db.query(`
    update public.app_config
       set value = coalesce(value, '{}'::jsonb) || jsonb_build_object('inspect_quote'::text, true::boolean)
     where key = 'archetype_flags'::text
  `);
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, 'O24 City'::text, true::boolean, now())
  `, [categoryId]);
  const serviceId = (await db.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate)
    values ($1::uuid, $2::uuid, 19900::int, 50000::int) returning id
  `, [ownerId, categoryId])).rows[0].id;
  const bookability = (await db.query(`
    select public._is_bookable(
      $1::uuid, $2::uuid, $3::text, $4::text, null::tstzrange
    ) as is_bookable
  `, [categoryId, ownerId, 'O24 City', 'inspect_quote'])).rows[0];
  if (!bookability.is_bookable) {
    throw new Error(`O24 chat fixture must be bookable: ${JSON.stringify({
      categoryId,
      ownerId,
      city: 'O24 City',
      archetype: 'inspect_quote',
      bookability,
    })}`);
  }
  const addressId = (await db.query(`
    insert into public.addresses (user_id, line1, city, lat, lng)
    values ($1::uuid, '1 O24 Road'::text, 'O24 City'::text, 16.5::double precision, 80.6::double precision)
    returning id
  `, [customerId])).rows[0].id;
  const bookingId = (await db.query(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, status, visit_fee, platform_fee
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      'O24 chat fixture'::text, 'accepted'::public.booking_status, 19900::int, 2900::int
    ) returning id
  `, [customerId, ownerId, categoryId, serviceId, addressId])).rows[0].id;
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values ($1::uuid, $2::uuid, 'manager'::text, true), ($1::uuid, $3::uuid, 'staff'::text, true)
  `, [ownerId, managerId, staffId]);
  await db.query(`
    update public.feature_flags set enabled = true where key = 'merchant_staff'::text
  `);
  return { customerId, ownerId, managerId, staffId, outsiderId, categoryId, bookingId };
}

const asInstant = (value) => value == null ? null : new Date(value).toISOString();
const assertActual = (condition, name, actual) => ok(condition, `${name}: ${JSON.stringify(actual)}`);
const stableJson = (value) => Array.isArray(value)
  ? `[${value.map(stableJson).join(',')}]`
  : value instanceof Date
    ? JSON.stringify(value.toISOString())
    : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
    : JSON.stringify(value);

await scenario('CM_SQL_LEGACY_TIMESTAMP_PROVENANCE and CM_SQL_PROVENANCE_MARKER_AUTHORITY', async () => {
  const outsider = await createUser('O24 Notification Outsider');
  const storedBefore = (await db.query(`
    select id, created_at, updated_at, event_at, data
      from public.notifications where id = $1::uuid
  `, [preMigrationRowId])).rows[0];
  const projected = (await as(preMigrationRecipient, 'authenticated', `
    select id, at, data from public.list_my_notifications($1::int) where id = $2::uuid
  `, [20, preMigrationRowId]))[0];
  const nonObjectStored = (await db.query(`
    select created_at, updated_at, event_at, data
      from public.notifications where id = $1::uuid
  `, [preMigrationNonObjectId])).rows[0];
  const nonObjectProjected = (await as(preMigrationRecipient, 'authenticated', `
    select at, data from public.list_my_notifications($1::int) where id = $2::uuid
  `, [20, preMigrationNonObjectId]))[0];
  const denied = await as(outsider, 'authenticated', `
    select id from public.list_my_notifications($1::int) where id = $2::uuid
  `, [20, preMigrationRowId]);
  const directDenied = await as(outsider, 'authenticated', `
    select id from public.notifications where id = $1::uuid
  `, [preMigrationRowId]);
  const delayedTransportRowId = randomUUID();
  await db.query(`
    insert into public.notifications (
      id, user_id, kind, title, body, data, created_at, updated_at, event_at
    ) values (
      $1::uuid, $2::uuid, 'booking_accepted'::text, 'Queued event'::text, ''::text,
      '{"_notification_time_source":"legacy_created_at"}'::jsonb,
      '2024-12-01T00:00:00Z'::timestamptz, '2026-12-31T00:00:00Z'::timestamptz,
      '2025-01-01T00:00:00Z'::timestamptz
    )
  `, [delayedTransportRowId, preMigrationRecipient]);
  const orderedRows = await as(preMigrationRecipient, 'authenticated', `
    select id, at, data from public.list_my_notifications($1::int)
  `, [20]);
  const grants = (await db.query(`
    select has_function_privilege('authenticated', 'public.list_my_notifications(integer)', 'EXECUTE') as authenticated,
           has_function_privilege('anon', 'public.list_my_notifications(integer)', 'EXECUTE') as anon,
           has_function_privilege('authenticated', 'public._queue_notification(uuid,text,uuid,text,text,jsonb,text)', 'EXECUTE') as queue_authenticated,
           has_function_privilege('authenticated', 'public.claim_due_notifications(integer)', 'EXECUTE') as claim_authenticated,
           has_function_privilege('service_role', 'public.claim_due_notifications(integer)', 'EXECUTE') as claim_service
  `)).rows[0];
  const actual = {
    event_at: storedBefore.event_at,
    created_at: asInstant(storedBefore.created_at),
    updated_at: asInstant(storedBefore.updated_at),
    stored_data: storedBefore.data,
    projected_at: asInstant(projected?.at),
    projected_data: projected?.data,
    recipient_rows: denied.length,
    direct_recipient_rows: directDenied.length,
    non_object_stored: {
      created_at: asInstant(nonObjectStored.created_at),
      updated_at: asInstant(nonObjectStored.updated_at),
      event_at: nonObjectStored.event_at,
      data: nonObjectStored.data,
    },
    non_object_projected: {
      at: asInstant(nonObjectProjected?.at),
      data: nonObjectProjected?.data,
      marker: nonObjectProjected?.data?._notification_time_source,
    },
    displayed_order: orderedRows
      .filter((row) => [preMigrationRowId, delayedTransportRowId].includes(row.id))
      .map((row) => ({ id: row.id, at: asInstant(row.at), source: row.data?._notification_time_source })),
    grants,
  };
  assertActual(
    actual.event_at === null
      && actual.created_at === preMigrationCreatedAt
      && actual.updated_at === preMigrationUpdatedAt
      && stableJson(actual.stored_data) === stableJson(preMigrationPayload)
      && actual.projected_at === preMigrationCreatedAt
      && actual.projected_data?._notification_time_source === 'legacy_created_at'
      && actual.projected_data?.private_marker === 'unchanged'
      && denied.length === 0
      && directDenied.length === 0
      && actual.non_object_stored.created_at === preMigrationCreatedAt
      && actual.non_object_stored.updated_at === preMigrationUpdatedAt
      && actual.non_object_stored.event_at === null
      && stableJson(actual.non_object_stored.data) === stableJson(preMigrationNonObjectPayload)
      && actual.non_object_projected.at === preMigrationCreatedAt
      && stableJson(actual.non_object_projected.data) === stableJson(preMigrationNonObjectPayload)
      && actual.non_object_projected.marker === undefined
      && actual.displayed_order[0]?.id === preMigrationRowId
      && actual.displayed_order[1]?.id === delayedTransportRowId
      && actual.displayed_order[1]?.source === 'queued_event'
      && grants.authenticated
      && !grants.anon
      && !grants.queue_authenticated
      && !grants.claim_authenticated
      && grants.claim_service,
    'CM_SQL_LEGACY_TIMESTAMP_PROVENANCE / marker authority / non-object legacy / recipient and grant boundary',
    actual,
  );
});

await scenario('CM_SQL_NEW_EVENT_TIMESTAMP_PROVENANCE, CM_SQL_LEGACY_MERGE_PROMOTION, and CM_SQL_EVENT_MERGE_TIME', async () => {
  const userId = await createUser('O24 Queue Recipient');
  const legacyId = randomUUID();
  const legacyCreatedAt = '2025-03-04T05:06:07.000Z';
  const legacyKey = `o24-legacy-${randomUUID()}`;
  await db.query(`
    insert into public.notifications (
      id, user_id, kind, title, body, data, collapse_key, count, read_at, created_at, updated_at
    ) values (
      $1::uuid, $2::uuid, 'booking_accepted'::text, 'Old event'::text, 'Old body'::text,
      '{"url":"/booking/old"}'::jsonb, $3::text, 4::int, '2025-03-05T05:00:00Z'::timestamptz,
      $4::timestamptz, '2026-01-01T00:00:00Z'::timestamptz
    )
  `, [legacyId, userId, legacyKey, legacyCreatedAt]);

  await db.exec('begin');
  const legacyMergeTime = asInstant((await db.query('select now() as at')).rows[0].at);
  await db.query(`
    select public._queue_notification(
      $1::uuid, 'booking_accepted'::text, null::uuid, 'Merged event'::text, 'New body'::text,
      '{"url":"/booking/new"}'::jsonb, $2::text
    )
  `, [userId, legacyKey]);
  await db.exec('commit');
  const legacyMerge = (await db.query(`
    select id, count, read_at, created_at, event_at, data
      from public.notifications where id = $1::uuid
  `, [legacyId])).rows[0];

  const newKey = `o24-new-${randomUUID()}`;
  await db.exec('begin');
  const newQueueTime = asInstant((await db.query('select now() as at')).rows[0].at);
  await db.query(`
    select public._queue_notification(
      $1::uuid, 'booking_accepted'::text, null::uuid, 'New event'::text, 'New body'::text,
      '{"safe":true}'::jsonb, $2::text
    )
  `, [userId, newKey]);
  await db.exec('commit');
  const newRow = (await db.query(`
    select id, created_at, event_at, count, data from public.notifications
     where user_id = $1::uuid and collapse_key = $2::text and status = 'pending'::text
  `, [userId, newKey])).rows[0];
  const projectedNewRow = (await as(userId, 'authenticated', `
    select at, data from public.list_my_notifications($1::int) where id = $2::uuid
  `, [20, newRow.id]))[0];

  await db.exec('begin');
  const mergeAgainTime = asInstant((await db.query('select now() as at')).rows[0].at);
  await db.query(`
    select public._queue_notification(
      $1::uuid, 'booking_accepted'::text, null::uuid, 'Merged again'::text, 'Latest body'::text,
      '{"safe":true}'::jsonb, $2::text
    )
  `, [userId, newKey]);
  await db.exec('commit');
  const mergedNewRow = (await db.query(`
    select id, created_at, event_at, count from public.notifications where id = $1::uuid
  `, [newRow.id])).rows[0];
  const projectedMergedNewRow = (await as(userId, 'authenticated', `
    select at, data from public.list_my_notifications($1::int) where id = $2::uuid
  `, [20, newRow.id]))[0];

  const projectedLegacyMerge = (await as(userId, 'authenticated', `
    select at, data from public.list_my_notifications($1::int) where id = $2::uuid
  `, [20, legacyId]))[0];
  const routeKey = `o24-recurring-${randomUUID()}`;
  await db.query(`
    select public._queue_notification(
      $1::uuid, 'recurring_visit_payment_due'::text, null::uuid, 'Recurring event'::text, ''::text,
      $2::jsonb, $3::text
    )
  `, [userId, JSON.stringify({ recurring_schedule_id: randomUUID(), url: '/recurring/known-route' }), routeKey]);
  const recurring = (await db.query(`
    select data from public.notifications where user_id = $1::uuid and collapse_key = $2::text
  `, [userId, routeKey])).rows[0]?.data;
  const actual = {
    legacy: {
      id: legacyMerge.id,
      count: legacyMerge.count,
      read_at: legacyMerge.read_at,
      created_at: asInstant(legacyMerge.created_at),
      event_at: asInstant(legacyMerge.event_at),
      projected_at: asInstant(projectedLegacyMerge?.at),
      source: projectedLegacyMerge?.data?._notification_time_source,
    },
    new: {
      id: newRow.id,
      created_at: asInstant(newRow.created_at),
      event_at: asInstant(newRow.event_at),
      expected_event_at: newQueueTime,
      stored_data: newRow.data,
      projected_at: asInstant(projectedNewRow?.at),
      projected_source: projectedNewRow?.data?._notification_time_source,
      projected_payload: projectedNewRow?.data?.safe,
      count_after_merge: mergedNewRow.count,
      created_after_merge: asInstant(mergedNewRow.created_at),
      event_after_merge: asInstant(mergedNewRow.event_at),
      projected_after_merge: asInstant(projectedMergedNewRow?.at),
      source_after_merge: projectedMergedNewRow?.data?._notification_time_source,
      merge_time: mergeAgainTime,
    },
    recurring_url: recurring?.url,
    legacy_merge_time: legacyMergeTime,
  };
  assertActual(
    actual.legacy.count === 5
      && actual.legacy.read_at === null
      && actual.legacy.created_at === legacyCreatedAt
      && actual.legacy.event_at === legacyMergeTime
      && actual.legacy.projected_at === legacyMergeTime
      && actual.legacy.source === 'queued_event'
      && actual.new.created_at === actual.new.event_at
      && actual.new.event_at === newQueueTime
      && actual.new.projected_at === newQueueTime
      && actual.new.projected_source === 'queued_event'
      && actual.new.projected_payload === true
      && actual.new.stored_data.safe === true
      && actual.new.count_after_merge === 2
      && actual.new.created_after_merge === actual.new.created_at
      && actual.new.event_after_merge === mergeAgainTime
      && actual.new.projected_after_merge === mergeAgainTime
      && actual.new.source_after_merge === 'queued_event'
      && actual.recurring_url === '/recurring/known-route',
    'queue insert/merge timestamps, read reset, identity, projection, and recurring route',
    actual,
  );
});

await scenario('CM_SQL_TRANSPORT_RETRY_PROVENANCE, CM_SQL_EVENT_TIME, and CM_SQL_TRANSPORT_READ_INDEPENDENCE', async () => {
  const legacyUser = await createUser('O24 Legacy Worker');
  const legacyId = randomUUID();
  const createdAt = '2025-02-03T04:05:06.000Z';
  await db.query(`
    insert into public.notifications (
      id, user_id, kind, title, body, data, created_at, updated_at, next_attempt_at
    ) values (
      $1::uuid, $2::uuid, 'booking_accepted'::text, 'Legacy worker'::text, ''::text,
      '{}'::jsonb, $3::timestamptz, '2026-02-03T04:05:06Z'::timestamptz, now() - interval '1 minute'
    )
  `, [legacyId, legacyUser, createdAt]);
  const newUser = await createUser('O24 New Worker');
  const newKey = `o24-worker-new-${randomUUID()}`;
  await db.query(`
    select public._queue_notification(
      $1::uuid, 'booking_accepted'::text, null::uuid, 'New worker'::text, ''::text,
      '{}'::jsonb, $2::text
    )
  `, [newUser, newKey]);
  const newId = (await db.query(`
    select id from public.notifications where user_id = $1::uuid and collapse_key = $2::text
  `, [newUser, newKey])).rows[0].id;
  const mergeUser = await createUser('O24 Merged Worker');
  const mergeKey = `o24-worker-merged-${randomUUID()}`;
  await db.query(`
    select public._queue_notification(
      $1::uuid, 'booking_accepted'::text, null::uuid, 'Merged worker'::text, ''::text,
      '{}'::jsonb, $2::text
    )
  `, [mergeUser, mergeKey]);
  await db.query(`
    select public._queue_notification(
      $1::uuid, 'booking_accepted'::text, null::uuid, 'Merged worker again'::text, ''::text,
      '{}'::jsonb, $2::text
    )
  `, [mergeUser, mergeKey]);
  const mergedId = (await db.query(`
    select id from public.notifications where user_id = $1::uuid and collapse_key = $2::text
  `, [mergeUser, mergeKey])).rows[0].id;
  const transportIds = [legacyId, newId, mergedId];
  const peerIds = [randomUUID(), randomUUID(), randomUUID()];
  const peerAt = '2024-01-02T03:04:05.000Z';
  for (const [index, userId] of [legacyUser, newUser, mergeUser].entries()) {
    await db.query(`
      insert into public.notifications (
        id, user_id, kind, title, body, data, status, created_at, updated_at, event_at
      ) values (
        $1::uuid, $2::uuid, 'booking_accepted'::text, 'Order peer'::text, ''::text,
        '{}'::jsonb, 'sent'::text, $3::timestamptz, $3::timestamptz, $3::timestamptz
      )
    `, [peerIds[index], userId, peerAt]);
  }
  const transportReadAt = '2026-11-25T10:00:00.000Z';
  await db.query(`
    update public.notifications set read_at = $1::timestamptz
     where id = any($2::uuid[])
  `, [transportReadAt, transportIds]);
  for (const [index, userId] of [legacyUser, newUser, mergeUser].entries()) {
    await db.query(`
      insert into public.push_devices (user_id, token, platform)
      values ($1::uuid, $2::text, 'web'::text)
    `, [userId, `ExponentPushToken[O24worker${index}abcdefgh]`]);
  }
  const initial = (await db.query(`
    select id, created_at, event_at, read_at from public.notifications where id = any($1::uuid[])
  `, [transportIds])).rows;
  const listOrderFor = async (userId, ids) => (await as(userId, 'authenticated', `
    select id, at, data, read_at from public.list_my_notifications($1::int)
     where id = any($2::uuid[]) order by at desc
  `, [20, ids])).map((row) => ({
    id: row.id,
    at: asInstant(row.at),
    source: row.data?._notification_time_source ?? null,
    read_at: asInstant(row.read_at),
  }));
  const projectionBefore = {};
  const orderingBefore = {};
  for (const [userId, id] of [
    [legacyUser, legacyId],
    [newUser, newId],
    [mergeUser, mergedId],
  ]) {
    projectionBefore[id] = (await as(userId, 'authenticated', `
      select at, data, read_at from public.list_my_notifications($1::int) where id = $2::uuid
    `, [20, id]))[0];
    orderingBefore[id] = await listOrderFor(userId, [id, peerIds[transportIds.indexOf(id)]]);
  }
  const claims = (await db.query('select id from public.claim_due_notifications($1::int)', [1000])).rows;
  const claimed = claims.filter((row) => transportIds.includes(row.id)).map((row) => row.id);
  for (const id of claimed) {
    await db.query(`
      select public.finish_notification(
        $1::uuid, false::boolean, 'retry'::text, '[]'::jsonb, array[]::text[]
      )
    `, [id]);
  }
  await db.query(`
    update public.notifications set next_attempt_at = now() - interval '1 minute'
     where id = any($1::uuid[]) and status = 'pending'::text
  `, [claimed]);
  const retryClaims = (await db.query('select id from public.claim_due_notifications($1::int)', [1000])).rows;
  const retried = retryClaims.filter((row) => transportIds.includes(row.id)).map((row) => row.id);
  for (const id of retried) {
    await db.query(`
      select public.finish_notification(
        $1::uuid, true::boolean, null::text, '[]'::jsonb, array[]::text[]
      )
    `, [id]);
  }
  const after = (await db.query(`
    select id, created_at, event_at, updated_at, read_at, attempts, status
      from public.notifications where id = any($1::uuid[]) order by id
  `, [transportIds])).rows;
  const projectionAfter = {};
  const orderingAfter = {};
  for (const [userId, id] of [
    [legacyUser, legacyId],
    [newUser, newId],
    [mergeUser, mergedId],
  ]) {
    projectionAfter[id] = (await as(userId, 'authenticated', `
      select at, data, read_at from public.list_my_notifications($1::int) where id = $2::uuid
    `, [20, id]))[0];
    orderingAfter[id] = await listOrderFor(userId, [id, peerIds[transportIds.indexOf(id)]]);
  }
  const initialById = new Map(initial.map((row) => [row.id, row]));
  const unchanged = after.map((row) => ({
    id: row.id,
    created_at_unchanged: asInstant(row.created_at) === asInstant(initialById.get(row.id)?.created_at),
    event_at_unchanged: asInstant(row.event_at) === asInstant(initialById.get(row.id)?.event_at),
    read_at_unchanged: asInstant(row.read_at) === transportReadAt,
    updated_at: asInstant(row.updated_at),
    attempts: row.attempts,
    status: row.status,
  }));
  const skipUser = await createUser('O24 Skip Worker');
  const skipKey = `o24-worker-skip-${randomUUID()}`;
  await db.query(`
    select public._queue_notification(
      $1::uuid, 'chat_message'::text, null::uuid, 'Chat'::text, ''::text,
      '{}'::jsonb, $2::text
    )
  `, [skipUser, skipKey]);
  const skippedBefore = (await db.query(`
    select id, created_at, event_at, read_at from public.notifications
     where user_id = $1::uuid and collapse_key = $2::text
  `, [skipUser, skipKey])).rows[0];
  await db.query(`
    update public.notifications set read_at = $1::timestamptz where id = $2::uuid
  `, [transportReadAt, skippedBefore.id]);
  skippedBefore.read_at = transportReadAt;
  const skippedProjectionBefore = (await as(skipUser, 'authenticated', `
    select at, data, read_at from public.list_my_notifications($1::int) where id = $2::uuid
  `, [20, skippedBefore.id]))[0];
  await db.query('select * from public.claim_due_notifications($1::int)', [1000]);
  const skippedAfter = (await db.query(`
    select id, created_at, event_at, read_at, status from public.notifications where id = $1::uuid
  `, [skippedBefore.id])).rows[0];
  const skippedProjectionAfter = (await as(skipUser, 'authenticated', `
    select at, data, read_at from public.list_my_notifications($1::int) where id = $2::uuid
  `, [20, skippedBefore.id]))[0];
  const actual = {
    transport_ids: transportIds,
    claimed_ids: claimed,
    retried_ids: retried,
    transport: unchanged,
    projections_unchanged: transportIds.map((id) => ({
      id,
      before: projectionBefore[id],
      after: projectionAfter[id],
      equal: stableJson(projectionBefore[id]) === stableJson(projectionAfter[id]),
      order_before: orderingBefore[id],
      order_after: orderingAfter[id],
      order_equal: stableJson(orderingBefore[id]) === stableJson(orderingAfter[id]),
    })),
    skipped: {
      created_at_unchanged: asInstant(skippedBefore.created_at) === asInstant(skippedAfter.created_at),
      event_at_unchanged: asInstant(skippedBefore.event_at) === asInstant(skippedAfter.event_at),
      read_at_unchanged: asInstant(skippedBefore.read_at) === asInstant(skippedAfter.read_at),
      status: skippedAfter.status,
      projection_unchanged: stableJson(skippedProjectionBefore) === stableJson(skippedProjectionAfter),
    },
  };
  assertActual(
    claimed.length === 3
      && retried.length === 3
      && unchanged.every((row) => row.created_at_unchanged && row.event_at_unchanged && row.read_at_unchanged && row.attempts === 2 && row.status === 'sent')
      && transportIds.every((id) => stableJson(projectionBefore[id]) === stableJson(projectionAfter[id]))
      && transportIds.every((id) => stableJson(orderingBefore[id]) === stableJson(orderingAfter[id]))
      && actual.skipped.created_at_unchanged
      && actual.skipped.event_at_unchanged
      && actual.skipped.read_at_unchanged
      && actual.skipped.projection_unchanged
      && actual.skipped.status === 'skipped',
    'claim/retry/success/skip change transport state without retiming event or record',
    actual,
  );
});

await scenario('CM_SQL_CHAT_MEMBER_PROJECTIONS, CM_SQL_CHAT_MEMBER_FLAG_OFF, and CM_SQL_CHAT_PRIMARY_SEEN_RETAIN', async () => {
  const fixture = await createBookingFixture();
  const customerReadAt = '2026-11-25T10:00:00.000Z';
  const ownerReadAt = '2026-11-25T08:30:00.000Z';
  const managerReadAt = '2026-11-25T08:45:00.000Z';
  await db.query(`
    insert into public.messages (booking_id, sender_id, body, created_at)
    values ($1::uuid, $2::uuid, 'Customer unread message'::text, '2026-11-25T09:00:00Z'::timestamptz),
           ($1::uuid, $3::uuid, 'Provider reply'::text, '2026-11-25T09:30:00Z'::timestamptz)
  `, [fixture.bookingId, fixture.customerId, fixture.ownerId]);
  await db.query(`
    insert into public.booking_chat_reads (booking_id, user_id, last_read_at)
    values ($1::uuid, $2::uuid, $3::timestamptz),
           ($1::uuid, $4::uuid, $5::timestamptz),
           ($1::uuid, $6::uuid, $7::timestamptz)
    on conflict (booking_id, user_id) do update set last_read_at = excluded.last_read_at
  `, [
    fixture.bookingId,
    fixture.customerId,
    customerReadAt,
    fixture.ownerId,
    ownerReadAt,
    fixture.managerId,
    managerReadAt,
  ]);

  const authorized = {};
  for (const [actor, name] of [
    [fixture.customerId, 'customer'],
    [fixture.ownerId, 'owner'],
    [fixture.managerId, 'manager'],
    [fixture.staffId, 'staff'],
  ]) {
    authorized[name] = {
      unread: await as(actor, 'authenticated', `
        select booking_id, role, unread, last_message_at
          from public.get_unread_counts() where booking_id = $1::uuid
      `, [fixture.bookingId]),
      readState: await as(actor, 'authenticated', `
        select my_last_read_at, other_last_read_at
          from public.get_chat_read_state($1::uuid)
      `, [fixture.bookingId]),
      heading: await as(actor, 'authenticated', `
        select public.get_chat_heading($1::uuid) as heading
      `, [fixture.bookingId]),
    };
  }
  const outsider = {
    unread: await as(fixture.outsiderId, 'authenticated', `
      select booking_id from public.get_unread_counts() where booking_id = $1::uuid
    `, [fixture.bookingId]),
    readState: await as(fixture.outsiderId, 'authenticated', `
      select * from public.get_chat_read_state($1::uuid)
    `, [fixture.bookingId]),
    heading: await as(fixture.outsiderId, 'authenticated', `
      select public.get_chat_heading($1::uuid) as heading
    `, [fixture.bookingId]),
  };
  const pushRecipients = (await db.query(`
    select user_id from public.notifications
     where kind = 'chat_message'::text and booking_id = $1::uuid
     order by user_id
  `, [fixture.bookingId])).rows.map((row) => row.user_id);
  const memberNotificationRows = (await db.query(`
    select id from public.notifications where user_id = $1::uuid and booking_id = $2::uuid
  `, [fixture.managerId, fixture.bookingId])).rows;

  await db.query(`update public.feature_flags set enabled = false where key = 'merchant_staff'::text`);
  const off = {
    memberUnread: await as(fixture.managerId, 'authenticated', `
      select booking_id from public.get_unread_counts() where booking_id = $1::uuid
    `, [fixture.bookingId]),
    memberHeading: await as(fixture.managerId, 'authenticated', `
      select public.get_chat_heading($1::uuid) as heading
    `, [fixture.bookingId]),
    ownerUnread: await as(fixture.ownerId, 'authenticated', `
      select booking_id from public.get_unread_counts() where booking_id = $1::uuid
    `, [fixture.bookingId]),
    ownerHeading: await as(fixture.ownerId, 'authenticated', `
      select public.get_chat_heading($1::uuid) as heading
    `, [fixture.bookingId]),
    customerUnread: await as(fixture.customerId, 'authenticated', `
      select booking_id from public.get_unread_counts() where booking_id = $1::uuid
    `, [fixture.bookingId]),
    customerHeading: await as(fixture.customerId, 'authenticated', `
      select public.get_chat_heading($1::uuid) as heading
    `, [fixture.bookingId]),
  };
  await db.query(`update public.feature_flags set enabled = true where key = 'merchant_staff'::text`);
  await db.query(`
    update public.business_members set active = false where owner_id = $1::uuid and member_id = $2::uuid
  `, [fixture.ownerId, fixture.managerId]);
  const inactive = await as(fixture.managerId, 'authenticated', `
    select booking_id from public.get_unread_counts() where booking_id = $1::uuid
  `, [fixture.bookingId]);
  const inactiveHeading = await as(fixture.managerId, 'authenticated', `
    select public.get_chat_heading($1::uuid) as heading
  `, [fixture.bookingId]);
  const inactiveOwner = await as(fixture.ownerId, 'authenticated', `
    select booking_id from public.get_unread_counts() where booking_id = $1::uuid
  `, [fixture.bookingId]);
  const inactiveCustomer = await as(fixture.customerId, 'authenticated', `
    select booking_id from public.get_unread_counts() where booking_id = $1::uuid
  `, [fixture.bookingId]);
  const actual = {
    authorized,
    outsider: {
      unread_count: outsider.unread.length,
      read_state_count: outsider.readState.length,
      heading: outsider.heading[0]?.heading ?? null,
    },
    push_recipients: pushRecipients,
    member_notification_rows: memberNotificationRows,
    off: {
      member: off.memberUnread.length,
      member_heading: off.memberHeading[0]?.heading ?? null,
      owner: off.ownerUnread.length,
      owner_heading: off.ownerHeading[0]?.heading ?? null,
      customer: off.customerUnread.length,
      customer_heading: off.customerHeading[0]?.heading ?? null,
    },
    inactive_member: inactive.length,
    inactive_member_heading: inactiveHeading[0]?.heading ?? null,
    inactive_primary_access: { owner: inactiveOwner.length, customer: inactiveCustomer.length },
    expected: {
      customerReadAt,
      ownerReadAt,
      managerReadAt,
      customerName: 'Customer',
      providerName: 'Provider',
      customerMessageAt: '2026-11-25T09:00:00.000Z',
    },
  };
  assertActual(
    authorized.customer.unread.length === 0
      && authorized.owner.unread.length === 1
      && authorized.manager.unread.length === 1
      && authorized.staff.unread.length === 1
      && authorized.manager.unread[0]?.booking_id === fixture.bookingId
      && authorized.manager.unread[0]?.role === 'provider'
      && authorized.owner.unread[0]?.unread === 1
      && authorized.manager.unread[0]?.unread === 1
      && authorized.staff.unread[0]?.unread === 1
      && asInstant(authorized.manager.unread[0]?.last_message_at) === '2026-11-25T09:00:00.000Z'
      && asInstant(authorized.manager.readState[0]?.my_last_read_at) === managerReadAt
      && authorized.manager.readState[0]?.other_last_read_at
      && asInstant(authorized.manager.readState[0].other_last_read_at) === customerReadAt
      && asInstant(authorized.customer.readState[0]?.other_last_read_at) === ownerReadAt
      && authorized.manager.heading[0]?.heading?.name === 'Customer'
      && authorized.customer.heading[0]?.heading?.name === 'Provider'
      && outsider.unread.length === 0
      && outsider.readState.length === 0
      && outsider.heading[0]?.heading == null
      && memberNotificationRows.length === 0
      && pushRecipients.includes(fixture.customerId)
      && pushRecipients.includes(fixture.ownerId)
      && !pushRecipients.includes(fixture.managerId)
      && !pushRecipients.includes(fixture.staffId)
      && off.member === 0
      && off.memberHeading[0]?.heading == null
      && off.owner === 1
      && off.ownerHeading[0]?.heading?.name === 'Customer'
      && off.customer === 0
      && off.customerHeading[0]?.heading?.name === 'Provider'
      && inactive.length === 0
      && inactiveHeading[0]?.heading == null
      && inactiveOwner.length === 1
      && inactiveCustomer.length === 0,
    'member read projections use existing authorization; customer read/push semantics and owner access remain primary',
    actual,
  );
});

await scenario('CM_SQL_SUPPORT_PREVIEW_MASKED, CM_SQL_SUPPORT_PRIVATE_BODY_RETAIN, CM_SQL_RECURRING_ROUTE_RETAIN, and CM_SQL_NOTIFICATION_ADMIN_IS_RECIPIENT_ONLY', async () => {
  const sender = await createUser('Mira 9876543210');
  const admin = await createUser('O24 Support Admin');
  const outsider = await createUser('O24 Support Outsider');
  await db.query(`insert into public.admins (user_id) values ($1::uuid)`, [admin]);
  const threadId = randomUUID();
  const subject = 'Help at person@example.com';
  const body = 'Call 9876543210, email person@example.com, or use https://example.com/help';
  await db.query(`
    insert into public.support_threads (
      id, user_id, subject, status, user_unread, admin_unread, last_message
    ) values (
      $1::uuid, $2::uuid, $3::text, 'closed'::text, 3::int, 5::int, 'old private body'::text
    )
  `, [threadId, sender, subject]);
  await db.query(`
    select public._support_post(t, $2::uuid, false::boolean, $3::text)
      from public.support_threads t where t.id = $1::uuid
  `, [threadId, sender, body]);
  const adminPreview = (await db.query(`
    select id, title, body, data from public.notifications
     where user_id = $1::uuid and kind = 'support_message'::text
  `, [admin])).rows[0];
  const afterUserPost = (await db.query(`
    select status, admin_unread, user_unread, last_message
      from public.support_threads where id = $1::uuid
  `, [threadId])).rows[0];
  await db.query(`
    select public._support_post(t, $2::uuid, true::boolean, $3::text)
      from public.support_threads t where t.id = $1::uuid
  `, [threadId, admin, body]);
  const userPreview = (await db.query(`
    select id, title, body, data from public.notifications
     where user_id = $1::uuid and kind = 'support_reply'::text
  `, [sender])).rows[0];
  const adminInbox = await as(admin, 'authenticated', `
    select id, title, body, data from public.list_my_notifications($1::int)
     where id = $2::uuid
  `, [100, adminPreview?.id]);
  const outsiderInbox = await as(outsider, 'authenticated', `
    select id from public.list_my_notifications($1::int)
     where id = $2::uuid
  `, [100, adminPreview?.id]);
  const senderInbox = await as(sender, 'authenticated', `
    select id, title, body, data from public.list_my_notifications($1::int)
     where id = $2::uuid
  `, [100, userPreview?.id]);
  const afterAdminPost = (await db.query(`
    select status, admin_unread, user_unread, last_message
      from public.support_threads where id = $1::uuid
  `, [threadId])).rows[0];
  const privateMessages = (await db.query(`
    select sender_id, body, from_admin from public.support_messages
     where thread_id = $1::uuid order by created_at, id
  `, [threadId])).rows;
  const actual = {
    admin_preview: adminPreview,
    user_preview: userPreview,
    thread_after_user: afterUserPost,
    thread_after_admin: afterAdminPost,
    private_messages: privateMessages,
    admin_notification_has_private_contact: /9876543210|person@example\.com|https:\/\//.test(
      `${adminPreview?.title ?? ''} ${adminPreview?.body ?? ''}`,
    ),
    user_notification_has_private_contact: /9876543210|person@example\.com|https:\/\//.test(
      `${userPreview?.title ?? ''} ${userPreview?.body ?? ''}`,
    ),
    admin_notification_route: adminPreview?.data?.url,
    user_notification_route: userPreview?.data?.url,
    admin_inbox_rows: adminInbox,
    outsider_inbox_rows: outsiderInbox,
    sender_inbox_rows: senderInbox,
  };
  assertActual(
    !actual.admin_notification_has_private_contact
      && !actual.user_notification_has_private_contact
      && adminPreview?.title?.includes('[number]')
      && adminPreview?.title?.includes('[email]')
      && adminPreview?.body?.includes('[number]')
      && adminPreview?.body?.includes('[email]')
      && adminPreview?.body?.includes('[link]')
      && afterUserPost.status === 'open'
      && afterUserPost.admin_unread === 6
      && afterUserPost.user_unread === 0
      && afterUserPost.last_message === body
      && afterAdminPost.status === 'open'
      && afterAdminPost.user_unread === 1
      && afterAdminPost.admin_unread === 0
      && afterAdminPost.last_message === body
      && privateMessages.length === 2
      && privateMessages.every((message) => message.body === body)
      && adminInbox.length === 1
      && adminInbox[0]?.id === adminPreview?.id
      && outsiderInbox.length === 0
      && senderInbox.length === 1
      && senderInbox[0]?.id === userPreview?.id
      && adminPreview?.data?.url === `/admin/support/${threadId}`
      && userPreview?.data?.url === `/support/${threadId}`,
    'support previews mask title/body only while authorized history, route, recipient and reopen state remain',
    actual,
  );
});

finish();
await db.close();

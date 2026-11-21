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
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}[a-z]?_.*\.sql$/.test(name))
  .sort();
const migration = (file) =>
  fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');

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
  instance_id uuid, id uuid primary key, aud text, role text, phone text,
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
for (const file of migrationFiles) {
  try {
    await db.exec(migration(file));
  } catch (error) {
    throw new Error(`migration ${file} failed: ${error.message}`, { cause: error });
  }
}
await db.exec("set timezone = 'UTC'");

const FIXED_AT = '2020-01-02T03:04:05.000Z';
const FIXED_FUTURE_DAY = '2026-12-15';
let phoneSequence = 0;

async function as(uid, role, sql, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [uid ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function createUser(label) {
  phoneSequence += 1;
  const id = randomUUID();
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, `+1555${String(phoneSequence).padStart(10, '0')}`]);
  await db.query(`update public.profiles as p set full_name = $1::text where p.id = $2::uuid`, [label, id]);
  return id;
}

async function setFeature(key, enabled) {
  await db.query(`
    update public.feature_flags as f
       set enabled = $1::boolean
     where f.key = $2::text
  `, [enabled, key]);
}

async function createFixture(label, {
  status = 'draft',
  statusReason = '',
  activeActivity = true,
  activeResource = true,
  includeHours = true,
  includePrice = true,
} = {}) {
  const ownerId = await createUser(`${label} owner`);
  const customerId = await createUser(`${label} customer`);
  const adminId = await createUser(`${label} admin`);
  await db.query(`
    insert into public.admins (user_id)
    values ($1::uuid)
    on conflict (user_id) do nothing
  `, [adminId]);
  const activityId = (await db.query(`
    insert into public.sports_activities (slug, name, icon, active)
    values ($1::text, $2::text, 'football-outline'::text, $3::boolean)
    returning id
  `, [`o09-${label}-${randomUUID()}`, `${label} activity`, activeActivity])).rows[0].id;
  const venueId = (await db.query(`
    insert into public.sports_venues (
      owner_id, name, description, address_line, city, area, lat, lng,
      status, status_reason, created_at, updated_at
    ) values (
      $1::uuid, $2::text, 'O09 isolated review fixture'::text, '1 Test Road'::text,
      'Test City'::text, 'Test Area'::text, 16.5::double precision, 80.6::double precision,
      $3::text, $4::text, $5::timestamptz, $5::timestamptz
    ) returning id
  `, [ownerId, `O09 ${label} venue`, status, statusReason, FIXED_AT])).rows[0].id;
  const resourceId = (await db.query(`
    insert into public.sports_resources (
      venue_id, activity_id, name, slot_minutes, active, booking_mode, capacity
    ) values (
      $1::uuid, $2::uuid, $3::text, 60::int, $4::boolean, 'approval'::text, 1::int
    ) returning id
  `, [venueId, activityId, `${label} resource`, activeResource])).rows[0].id;
  if (includeHours) {
    await db.query(`
      insert into public.sports_hours (venue_id, weekday, opens, closes)
      values ($1::uuid, extract(dow from $2::date)::smallint, time '08:00', time '20:00')
    `, [venueId, FIXED_FUTURE_DAY]);
  }
  if (includePrice) {
    await db.query(`
      insert into public.sports_price_rules (resource_id, weekday, starts, ends, price_paise)
      values ($1::uuid, extract(dow from $2::date)::smallint, time '08:00', time '20:00', 20000::int)
    `, [resourceId, FIXED_FUTURE_DAY]);
  }
  return { ownerId, customerId, adminId, activityId, venueId, resourceId, label };
}

async function failureOf(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error?.message ?? String(error);
  }
}

async function statusViews(fixture) {
  const admin = (await as(fixture.adminId, 'authenticated', `
    select v.id, v.status, v.status_reason
      from public.admin_list_sports_venues() as v
     where v.id = $1::uuid
  `, [fixture.venueId]))[0] ?? null;
  const owner = (await as(fixture.ownerId, 'authenticated', `
    select v.id, v.status, v.status_reason, v.updated_at
      from public.sports_venues as v
     where v.id = $1::uuid
  `, [fixture.venueId]))[0] ?? null;
  const publicPayload = (await as(null, 'anon', `
    select public.get_sports_venue($1::uuid) as payload
  `, [fixture.venueId]))[0]?.payload ?? null;
  return { admin, owner, public: publicPayload };
}

async function auditCount(venueId) {
  return (await db.query(`
    select count(*)::int as count
      from public.admin_audit_log as a
     where a.action = 'set_sports_venue_status'::text
       and a.target_id = $1::uuid
  `, [venueId])).rows[0].count;
}

await setFeature('sports', true);
await setFeature('guest_browse', true);
await setFeature('merchant_staff', true);

await scenario('SP-REVIEW-01 verified stale owner submit preserves the state and public row', async () => {
  const fixture = await createFixture('review-01-verified', {
    status: 'verified', statusReason: 'approved before stale owner submit',
  });
  const before = await statusViews(fixture);
  const error = await failureOf(() => as(fixture.ownerId, 'authenticated', `
    select public.submit_sports_venue($1::uuid)
  `, [fixture.venueId]));
  const after = await statusViews(fixture);
  ok(error === null
    && before.admin?.status === 'verified'
    && after.admin?.status === 'verified'
    && after.admin?.status_reason === 'approved before stale owner submit'
    && after.owner?.status === 'verified'
    && after.owner?.status_reason === 'approved before stale owner submit'
    && after.owner?.updated_at === before.owner?.updated_at
    && after.public?.id === fixture.venueId,
  `[SP-REVIEW-01] verified stale submit leaves same-PK admin/owner/public reads unchanged: ${JSON.stringify({ fixture, error, before, after })}`);
});

await scenario('SP-REVIEW-02 repeated submitted owner submit is a no-op before prerequisites', async () => {
  const fixture = await createFixture('review-02-submitted', {
    status: 'submitted', statusReason: 'awaiting review', activeActivity: false,
    activeResource: false, includeHours: false, includePrice: false,
  });
  const before = await statusViews(fixture);
  const error = await failureOf(() => as(fixture.ownerId, 'authenticated', `
    select public.submit_sports_venue($1::uuid)
  `, [fixture.venueId]));
  const after = await statusViews(fixture);
  ok(error === null
    && after.admin?.status === 'submitted'
    && after.admin?.status_reason === 'awaiting review'
    && after.owner?.updated_at === before.owner?.updated_at
    && after.owner?.status_reason === before.owner?.status_reason
    && after.public === null,
  `[SP-REVIEW-02] repeated submitted leaves admin/owner state and hidden public view unchanged: ${JSON.stringify({ fixture, error, before, after })}`);
});

await scenario('SP-REVIEW-03 actor and sports feature checks precede owner no-op handling', async () => {
  const nonOwnerFixture = await createFixture('review-03-nonowner', { status: 'submitted' });
  const nonOwnerError = await failureOf(() => as(nonOwnerFixture.customerId, 'authenticated', `
    select public.submit_sports_venue($1::uuid)
  `, [nonOwnerFixture.venueId]));
  const nonOwnerViews = await statusViews(nonOwnerFixture);

  const memberFixture = await createFixture('review-03-business-member', { status: 'submitted' });
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values ($1::uuid, $2::uuid, 'manager'::text, true)
  `, [memberFixture.ownerId, memberFixture.customerId]);
  const memberError = await failureOf(() => as(memberFixture.customerId, 'authenticated', `
    select public.submit_sports_venue($1::uuid)
  `, [memberFixture.venueId]));
  const memberViews = await statusViews(memberFixture);

  const anonymousFixture = await createFixture('review-03-anonymous', { status: 'submitted' });
  const anonymousError = await failureOf(() => as(null, 'authenticated', `
    select public.submit_sports_venue($1::uuid)
  `, [anonymousFixture.venueId]));
  const anonymousViews = await statusViews(anonymousFixture);

  const disabledFixture = await createFixture('review-03-sports-off', { status: 'submitted' });
  await setFeature('sports', false);
  const disabledError = await failureOf(() => as(disabledFixture.ownerId, 'authenticated', `
    select public.submit_sports_venue($1::uuid)
  `, [disabledFixture.venueId]));
  await setFeature('sports', true);
  const disabledViews = await statusViews(disabledFixture);

  ok(Boolean(nonOwnerError) && nonOwnerViews.owner?.status === 'submitted'
    && Boolean(memberError) && memberViews.owner?.status === 'submitted'
    && Boolean(anonymousError) && anonymousViews.owner?.status === 'submitted'
    && Boolean(disabledError) && disabledViews.owner?.status === 'submitted',
  `[SP-REVIEW-03] nonowner/member/anonymous/sports-OFF all deny submitted no-op without mutation: ${JSON.stringify({ nonOwnerError, nonOwnerViews, memberError, memberViews, anonymousError, anonymousViews, disabledError, disabledViews })}`);
});

await scenario('SP-REVIEW-04 suspended venue submit is denied without state churn', async () => {
  const fixture = await createFixture('review-04-suspended', {
    status: 'suspended', statusReason: 'suspended for review',
  });
  const before = await statusViews(fixture);
  const error = await failureOf(() => as(fixture.ownerId, 'authenticated', `
    select public.submit_sports_venue($1::uuid)
  `, [fixture.venueId]));
  const after = await statusViews(fixture);
  ok(Boolean(error)
    && after.admin?.status === 'suspended'
    && after.admin?.status_reason === 'suspended for review'
    && after.owner?.updated_at === before.owner?.updated_at
    && after.public === null,
  `[SP-REVIEW-04] suspended submit is denied and admin/owner/public reads remain correct: ${JSON.stringify({ fixture, error, before, after })}`);
});

await scenario('SP-REVIEW-05 draft and rejected require active resource/activity, hours, and price', async () => {
  const missingCases = [
    { suffix: 'resource', activeResource: false, expected: 'add an active court or resource before submitting' },
    { suffix: 'activity', activeActivity: false, expected: 'add an active court or resource before submitting' },
    { suffix: 'hours', includeHours: false, expected: 'add opening hours before submitting' },
    { suffix: 'price', includePrice: false, expected: 'add a price rule before submitting' },
  ];
  for (const status of ['draft', 'rejected']) {
    for (const missing of missingCases) {
      const fixture = await createFixture(`review-05-${status}-${missing.suffix}`, {
        status,
        statusReason: status === 'rejected' ? 'needs owner changes' : '',
        ...missing,
      });
      const before = await statusViews(fixture);
      const error = await failureOf(() => as(fixture.ownerId, 'authenticated', `
        select public.submit_sports_venue($1::uuid)
      `, [fixture.venueId]));
      const after = await statusViews(fixture);
      ok(Boolean(error) && error.includes(missing.expected)
        && after.owner?.status === status
        && after.owner?.status_reason === before.owner?.status_reason
        && after.owner?.updated_at === before.owner?.updated_at,
      `[SP-REVIEW-05] ${status} blocked for missing ${missing.suffix}: ${JSON.stringify({ fixture, expected: missing.expected, error, before, after })}`);
    }
  }
  for (const status of ['draft', 'rejected']) {
    const fixture = await createFixture(`review-05-valid-${status}`, {
      status, statusReason: status === 'rejected' ? 'needs owner changes' : '',
    });
    const before = await statusViews(fixture);
    const error = await failureOf(() => as(fixture.ownerId, 'authenticated', `
      select public.submit_sports_venue($1::uuid)
    `, [fixture.venueId]));
    const after = await statusViews(fixture);
    ok(error === null
      && after.admin?.status === 'submitted'
      && after.admin?.status_reason === ''
      && after.owner?.updated_at !== before.owner?.updated_at
      && after.public === null,
    `[SP-REVIEW-05] valid ${status} advances to submitted and clears reason: ${JSON.stringify({ fixture, error, before, after })}`);
  }
});

await scenario('SP-REVIEW-06 admin same-state is a no-op while role, feature, and draft guards remain', async () => {
  for (const status of ['verified', 'rejected', 'suspended']) {
    const fixture = await createFixture(`review-06-same-${status}`, {
      status, statusReason: status === 'verified' ? 'original approval' : 'original moderation reason',
    });
    const before = await statusViews(fixture);
    const auditBefore = await auditCount(fixture.venueId);
    const error = await failureOf(() => as(fixture.adminId, 'authenticated', `
      select public.admin_set_venue_status($1::uuid, $2::text, $3::text)
    `, [fixture.venueId, status, 'ignored duplicate reason']));
    const after = await statusViews(fixture);
    const auditAfter = await auditCount(fixture.venueId);
    ok(error === null
      && after.owner?.status === status
      && after.owner?.status_reason === before.owner?.status_reason
      && after.owner?.updated_at === before.owner?.updated_at
      && auditAfter === auditBefore,
    `[SP-REVIEW-06] repeated ${status} is a no-op without timestamp/reason/audit churn: ${JSON.stringify({ fixture, error, before, after, auditBefore, auditAfter })}`);
  }

  const unauthorizedFixture = await createFixture('review-06-nonadmin', { status: 'verified' });
  const unauthorizedBefore = await statusViews(unauthorizedFixture);
  const unauthorizedAuditBefore = await auditCount(unauthorizedFixture.venueId);
  const unauthorizedError = await failureOf(() => as(unauthorizedFixture.customerId, 'authenticated', `
    select public.admin_set_venue_status($1::uuid, $2::text, $3::text)
  `, [unauthorizedFixture.venueId, 'verified', '']));
  const unauthorizedAfter = await statusViews(unauthorizedFixture);
  const unauthorizedAuditAfter = await auditCount(unauthorizedFixture.venueId);

  const disabledFixture = await createFixture('review-06-sports-off', { status: 'verified' });
  const disabledAuditBefore = await auditCount(disabledFixture.venueId);
  await setFeature('sports', false);
  const disabledError = await failureOf(() => as(disabledFixture.adminId, 'authenticated', `
    select public.admin_set_venue_status($1::uuid, $2::text, $3::text)
  `, [disabledFixture.venueId, 'verified', '']));
  await setFeature('sports', true);
  const disabledAfter = await statusViews(disabledFixture);
  const disabledAuditAfter = await auditCount(disabledFixture.venueId);

  const draftFixture = await createFixture('review-06-draft', { status: 'draft' });
  const draftAuditBefore = await auditCount(draftFixture.venueId);
  const draftError = await failureOf(() => as(draftFixture.adminId, 'authenticated', `
    select public.admin_set_venue_status($1::uuid, $2::text, $3::text)
  `, [draftFixture.venueId, 'verified', '']));
  const draftAfter = await statusViews(draftFixture);
  const draftAuditAfter = await auditCount(draftFixture.venueId);

  ok(Boolean(unauthorizedError)
    && unauthorizedAfter.owner?.status === 'verified'
    && unauthorizedAfter.owner?.updated_at === unauthorizedBefore.owner?.updated_at
    && unauthorizedAuditAfter === unauthorizedAuditBefore
    && Boolean(disabledError)
    && disabledAfter.owner?.status === 'verified'
    && disabledAuditAfter === disabledAuditBefore
    && Boolean(draftError)
    && draftAfter.owner?.status === 'draft'
    && draftAuditAfter === draftAuditBefore,
  `[SP-REVIEW-06] nonadmin/sports-OFF/draft attempts are denied before writes: ${JSON.stringify({ unauthorizedError, unauthorizedBefore, unauthorizedAfter, unauthorizedAuditBefore, unauthorizedAuditAfter, disabledError, disabledAfter, disabledAuditBefore, disabledAuditAfter, draftError, draftAfter, draftAuditBefore, draftAuditAfter })}`);
});

await scenario('SP-REVIEW-07 admin preserves every existing non-draft different-state edge', async () => {
  const edges = [
    ['submitted', 'verified'], ['submitted', 'rejected'], ['submitted', 'suspended'],
    ['verified', 'rejected'], ['verified', 'suspended'],
    ['rejected', 'verified'], ['rejected', 'suspended'],
    ['suspended', 'verified'], ['suspended', 'rejected'],
  ];
  for (const [from, to] of edges) {
    const fixture = await createFixture(`review-07-${from}-to-${to}`, {
      status: from, statusReason: from === 'verified' ? 'prior approval' : 'prior reason',
    });
    const auditBefore = await auditCount(fixture.venueId);
    const reason = to === 'verified' ? '' : `O09 ${from} to ${to} reason`;
    const error = await failureOf(() => as(fixture.adminId, 'authenticated', `
      select public.admin_set_venue_status($1::uuid, $2::text, $3::text)
    `, [fixture.venueId, to, reason]));
    const after = await statusViews(fixture);
    const auditAfter = await auditCount(fixture.venueId);
    ok(error === null
      && after.admin?.status === to
      && after.owner?.status === to
      && after.owner?.status_reason === reason
      && auditAfter === auditBefore + 1
      && (to === 'verified' ? after.public?.id === fixture.venueId : after.public === null),
    `[SP-REVIEW-07] authorized ${from} -> ${to} transition and audit retained: ${JSON.stringify({ fixture, reason, error, after, auditBefore, auditAfter })}`);
  }
});

finish();
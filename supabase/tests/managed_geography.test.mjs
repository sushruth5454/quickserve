import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(here, '..', 'migrations', '0046_managed_geography.sql'), 'utf8');
const db = new PGlite({ extensions: { pgcrypto } });

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create table public.admins (user_id uuid primary key);
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
    description text not null,
    group_name text not null,
    sort_order int not null
  );
  create function public._is_admin() returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.admins where user_id = auth.uid())
  $$;
  create function public._require_uid() returns uuid language plpgsql stable security definer set search_path = public as $$
  declare v_uid uuid := auth.uid();
  begin
    if v_uid is null then raise exception 'not signed in'; end if;
    return v_uid;
  end
  $$;
  create function public._assert(p_ok boolean, p_message text) returns void language plpgsql as $$
  begin
    if not coalesce(p_ok, false) then raise exception '%', p_message using errcode = 'P0001'; end if;
  end
  $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant select on public.admins to anon, authenticated;
`);
await db.exec(migration);
assert.equal(
  (await db.query(`select enabled from public.feature_flags where key = 'area_picker'`)).rows[0]?.enabled,
  true,
  'managed area quick picks are enabled by default',
);

const ADMIN = '00000000-0000-0000-0000-000000000001';
const NON_ADMIN = '00000000-0000-0000-0000-000000000002';
await db.exec(`insert into public.admins (user_id) values ('${ADMIN}');`);

async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

const adminUpsert = (kind, parentId, name, lat = null, lng = null, active = true) =>
  as(ADMIN, 'authenticated', `
    select public.admin_upsert_geo($1, null, $2, $3, $4, $5, $6) as id
  `, [kind, parentId, name, lat, lng, active]).then((rows) => rows[0].id);

const stateId = await adminUpsert('state', null, 'Test State');
const districtId = await adminUpsert('district', stateId, 'Test District');
const cityId = await adminUpsert('city', districtId, 'Test City');
const areaId = await adminUpsert('area', cityId, 'Test Area', 17.0, 78.0);
assert.ok(stateId && districtId && cityId && areaId, 'admin can create the complete geography hierarchy');

await assert.rejects(
  () => db.query(`insert into public.geo_districts (state_id, name) values ('00000000-0000-0000-0000-000000000099', 'Orphan District')`),
  /foreign key/i,
  'districts require an existing state',
);
await assert.rejects(
  () => db.query(`insert into public.geo_cities (district_id, name) values ('00000000-0000-0000-0000-000000000099', 'Orphan City')`),
  /foreign key/i,
  'cities require an existing district',
);
await assert.rejects(
  () => db.query(`insert into public.geo_areas (city_id, name, lat, lng) values ('00000000-0000-0000-0000-000000000099', 'Orphan Area', 17, 78)`),
  /foreign key/i,
  'areas require an existing city',
);

await assert.rejects(
  () => as(ADMIN, 'authenticated', `select public.admin_upsert_geo('area', null, $1, 'Invalid Area', 91, 78, true)`, [cityId]),
  /area coordinates are required and must be within valid ranges/,
  'area coordinates outside latitude bounds are rejected',
);
await assert.rejects(
  () => db.query(`insert into public.geo_areas (city_id, name, lat, lng) values ($1, 'Invalid Area', 17, 181)`, [cityId]),
  /check constraint/i,
  'area table constraints reject longitude outside bounds',
);

await assert.rejects(
  () => as(NON_ADMIN, 'authenticated', `select public.admin_upsert_geo('state', null, null, 'Unauthorized State', null, null, true)`),
  /admin only/,
  'non-admin users cannot call the geography upsert RPC',
);
await assert.rejects(
  () => as(NON_ADMIN, 'authenticated', `insert into public.geo_states (name) values ('Direct Write')`),
  /permission denied/,
  'authenticated users cannot write geography tables directly',
);

const hiddenStateId = await adminUpsert('state', null, 'Hidden State', null, null, false);
const hiddenDistrictId = await adminUpsert('district', stateId, 'Hidden District', null, null, false);
const hiddenCityId = await adminUpsert('city', districtId, 'Hidden City', null, null, false);
await adminUpsert('area', cityId, 'Hidden Area', 17.1, 78.1, false);
assert.ok(hiddenStateId && hiddenDistrictId && hiddenCityId);

for (const [table, name] of [
  ['geo_states', 'Hidden State'],
  ['geo_districts', 'Hidden District'],
  ['geo_cities', 'Hidden City'],
  ['geo_areas', 'Hidden Area'],
]) {
  const rows = await as(null, 'anon', `select id from public.${table} where name = $1`, [name]);
  assert.equal(rows.length, 0, `anonymous readers cannot see inactive ${table}`);
}
assert.equal((await as(null, 'anon', `select id from public.geo_areas where id = $1`, [areaId])).length, 1, 'anonymous readers can see active areas');

console.log('managed geography SQL tests passed');

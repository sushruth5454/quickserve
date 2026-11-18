import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const migration = (file) =>
  fs.readFileSync(path.join(migrationsDir, file), 'utf8')
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
create function auth.role() returns text language sql stable as $$ select current_user::text $$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
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
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file) && Number(file.slice(0, 4)) <= 59)
  .sort();
if (!migrationFiles.includes('0059_admin_identity_hardening.sql')) {
  throw new Error('the X1 migration must be part of the full 0001..0059 chain');
}
for (const file of migrationFiles) await db.exec(migration(file));

const { ok, scenario, finish } = createHarness();
const phoneOnlyUser = '00000000-0000-0000-0000-0000000000a1';
const tableAdmin = '00000000-0000-0000-0000-0000000000a2';

async function as(uid, role, query, params = []) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1::text, false)", [uid]);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function failureOf(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error.message;
  }
}

await scenario('phone allowlist no longer grants admin', async () => {
  await db.query(
    `insert into auth.users (id, phone, phone_confirmed_at) values ($1::uuid, $2::text, now())`,
    [phoneOnlyUser, '+918888888888'],
  );
  const [clearedAllowlist] = await db.query(
    `select value from public.app_config where key = $1::text`,
    ['admin_phones'],
  ).then((result) => result.rows);
  ok(
    Array.isArray(clearedAllowlist.value) && clearedAllowlist.value.length === 0,
    `migration clears the legacy phone allowlist: ${JSON.stringify({ clearedAllowlist })}`,
  );
  await db.query(
    `update public.app_config set value = $2::jsonb where key = $1::text`,
    ['admin_phones', JSON.stringify(['918888888888'])],
  );

  const [identity] = await as(phoneOnlyUser, 'authenticated', 'select public._is_admin() as is_admin');
  ok(identity.is_admin === false, `allowlisted phone is not an admin: ${JSON.stringify({ identity })}`);

  const denied = await failureOf(() =>
    as(phoneOnlyUser, 'authenticated', 'select public.admin_dashboard($1::int)', [30]),
  );
  ok(/admin only/.test(denied ?? ''), `allowlisted phone is denied admin RPCs: ${JSON.stringify({ denied })}`);

  const [notificationRecipient] = await db.query(
    `select exists (
       select 1 from public._admin_user_ids() as admin_ids(user_id)
        where admin_ids.user_id = $1::uuid
     ) as included`,
    [phoneOnlyUser],
  ).then((result) => result.rows);
  ok(
    notificationRecipient.included === false,
    `allowlisted phone is excluded from admin notifications: ${JSON.stringify({ notificationRecipient })}`,
  );
});

await scenario('admins table grants admin', async () => {
  await db.query(
    `insert into auth.users (id, phone, phone_confirmed_at) values ($1::uuid, $2::text, now())`,
    [tableAdmin, '+919100000001'],
  );
  await db.query(`insert into public.admins (user_id) values ($1::uuid)`, [tableAdmin]);

  const [identity] = await as(tableAdmin, 'authenticated', 'select public._is_admin() as is_admin');
  ok(identity.is_admin === true, `admins-table member is an admin: ${JSON.stringify({ identity })}`);

  const [notificationRecipient] = await db.query(
    `select exists (
       select 1 from public._admin_user_ids() as admin_ids(user_id)
        where admin_ids.user_id = $1::uuid
     ) as included`,
    [tableAdmin],
  ).then((result) => result.rows);
  ok(
    notificationRecipient.included === true,
    `admins-table member receives admin notifications: ${JSON.stringify({ notificationRecipient })}`,
  );
});

finish();
await db.close();

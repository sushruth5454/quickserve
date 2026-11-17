import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(here, '..', 'migrations', '0045_preferred_language.sql'), 'utf8');
const db = new PGlite();

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create table public.profiles (id uuid primary key);
  create table public.admins (user_id uuid primary key);
  create table public.feature_flags (
    key text primary key,
    enabled boolean not null default false,
    label text not null,
    description text not null default '',
    group_name text not null default 'General',
    sort_order int not null default 100
  );
  create function public._require_uid() returns uuid language plpgsql stable as $$
  declare v_uid uuid := auth.uid();
  begin
    if v_uid is null then raise exception 'authentication required'; end if;
    return v_uid;
  end
  $$;
  create function public._assert(p_cond boolean, p_msg text) returns void language plpgsql as $$
  begin
    if not coalesce(p_cond, false) then raise exception '%', p_msg; end if;
  end
  $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  insert into public.profiles (id) values
    ('00000000-0000-0000-0000-0000000000c1'),
    ('00000000-0000-0000-0000-0000000000c2');
  insert into public.admins (user_id) values ('00000000-0000-0000-0000-0000000000c2');
`);

await db.exec(migration);

const flag = (await db.query(`select enabled from public.feature_flags where key = 'telugu_language'`)).rows[0];
assert.equal(flag?.enabled, false, 'the Telugu language feature is off by default');

async function as(uid, role, query, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return await db.query(query, params);
  } finally {
    await db.exec('reset role;');
  }
}

const customer = '00000000-0000-0000-0000-0000000000c1';
const adminUser = '00000000-0000-0000-0000-0000000000c2';
const isAdmin = (await db.query(`select exists (select 1 from public.admins where user_id = $1::uuid) as value`, [customer])).rows[0]?.value;
assert.equal(isAdmin, false, 'the caller is a non-admin user');

await assert.rejects(
  as(customer, 'authenticated', `select public.set_preferred_language($1)`, ['fr']),
  /invalid language/,
  'unsupported language values are rejected',
);

await assert.rejects(
  as(customer, 'anon', `select public.set_preferred_language($1)`, ['te']),
  /permission denied/,
  'anonymous callers cannot execute the preference RPC',
);

await as(customer, 'authenticated', `select public.set_preferred_language($1)`, ['te']);
const profiles = (await db.query(`select id::text, preferred_language from public.profiles order by id`)).rows;
assert.deepEqual(
  profiles,
  [
    { id: customer, preferred_language: 'te' },
    { id: adminUser, preferred_language: 'en' },
  ],
  'a non-admin user can update only their own profile preference',
);

console.log('preferred language migration tests passed');

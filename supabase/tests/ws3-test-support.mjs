import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');

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
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, phone text, phone_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}', created_at timestamptz, updated_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export const USERS = {
  customer: '00000000-0000-0000-0000-0000000000c1',
  otherCustomer: '00000000-0000-0000-0000-0000000000c2',
  ownerA: '00000000-0000-0000-0000-0000000000a1',
  ownerB: '00000000-0000-0000-0000-0000000000a2',
  ownerC: '00000000-0000-0000-0000-0000000000a3',
  ownerD: '00000000-0000-0000-0000-0000000000a4',
  ownerE: '00000000-0000-0000-0000-0000000000a5',
  ownerF: '00000000-0000-0000-0000-0000000000a6',
  admin: '00000000-0000-0000-0000-0000000000b1',
};

const SHOP_DEFAULTS = {
  name: 'North Tiles',
  description: 'Tile supplier',
  addressLine: '12 Market Road',
  city: 'Vijayawada',
  area: 'Benz Circle',
  lat: 16.5,
  lng: 80.6,
  deliveryRadiusKm: 20,
  offersDelivery: true,
  offersPickup: true,
  whatsappContact: false,
  gstin: null,
  categorySlugs: ['tiles'],
};

export async function createWs3TestContext() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(prelude);
  const migrations = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 70)
    .sort((left, right) => left.localeCompare(right));
  for (const name of migrations) {
    let sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
    if (name === '0001_init.sql') {
      sql = sql
        .replace('create extension if not exists postgis with schema extensions;', '')
        .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
        .replaceAll('using gist', 'using btree');
    }
    await db.exec(sql);
  }

  await db.query(`
    insert into auth.users (id, phone) values
      ($1::uuid, '+919000000001'), ($2::uuid, '+919000000002'), ($3::uuid, '+919000000003'),
      ($4::uuid, '+919000000004'), ($5::uuid, '+919000000005'), ($6::uuid, '+919000000006'),
      ($7::uuid, '+919000000007'), ($8::uuid, '+919000000008'), ($9::uuid, '+919000000009')
  `, Object.values(USERS));
  for (const [id, fullName] of Object.entries({
    [USERS.customer]: 'Customer One',
    [USERS.otherCustomer]: 'Customer Two',
    [USERS.ownerA]: 'Shop Owner A',
    [USERS.ownerB]: 'Shop Owner B',
    [USERS.ownerC]: 'Shop Owner C',
    [USERS.ownerD]: 'Shop Owner D',
    [USERS.ownerE]: 'Shop Owner E',
    [USERS.ownerF]: 'Shop Owner F',
    [USERS.admin]: 'Shop Admin',
  })) {
    await db.query(
      'insert into public.profiles (id, full_name) values ($1::uuid, $2::text) on conflict (id) do update set full_name = excluded.full_name',
      [id, fullName],
    );
  }
  await db.query('insert into public.admins (user_id) values ($1::uuid) on conflict do nothing', [USERS.admin]);
  await db.query(`update public.feature_flags set enabled = true where key in ('products', 'product_enquiries')`);

  async function as(uid, role, query, params = []) {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
    try {
      return (await db.query(query, params)).rows;
    } finally {
      await db.exec('reset role;');
    }
  }

  async function saveShop(owner, options = {}) {
    const shop = { ...SHOP_DEFAULTS, ...options };
    const [row] = await as(owner, 'authenticated', `
      select public.save_shop(
        $1::text, $2::text, $3::text, $4::text, $5::text, $6::double precision, $7::double precision,
        $8::int, $9::boolean, $10::boolean, $11::boolean, $12::text, $13::text[]
      ) as id
    `, [
      shop.name, shop.description, shop.addressLine, shop.city, shop.area, shop.lat, shop.lng,
      shop.deliveryRadiusKm, shop.offersDelivery, shop.offersPickup, shop.whatsappContact,
      shop.gstin, shop.categorySlugs,
    ]);
    return row.id;
  }

  async function createVerifiedShop(owner, options = {}) {
    const id = await saveShop(owner, options);
    await as(owner, 'authenticated', 'select public.submit_shop($1::uuid)', [id]);
    await as(USERS.admin, 'authenticated', 'select public.admin_set_shop_status($1::uuid, $2::text, $3::text)', [id, 'verified', null]);
    return id;
  }

  async function createProduct(owner, input) {
    const [category] = await db.query(
      'select id from public.product_categories where slug = $1::text',
      [input.categorySlug ?? 'tiles'],
    ).then((result) => result.rows);
    const [row] = await as(owner, 'authenticated', `
      select public.save_product(
        null::uuid, $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::jsonb, $7::text,
        $8::int, $9::boolean, $10::boolean, '{}'::text[]
      ) as id
    `, [
      category.id, input.name, input.brand ?? '', input.model ?? '', input.description ?? '',
      JSON.stringify(input.specs ?? {}), input.unit ?? 'box', input.pricePaise ?? null,
      input.inStock ?? true, input.active ?? true,
    ]);
    return row.id;
  }

  return { db, as, saveShop, createVerifiedShop, createProduct };
}

export async function expectError(ok, fn, pattern, description) {
  let actual;
  try {
    await fn();
    actual = 'no error';
  } catch (error) {
    actual = error?.message ?? String(error);
  }
  ok(pattern.test(actual), `${description} ${JSON.stringify({ actual })}`);
}

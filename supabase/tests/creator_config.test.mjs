// Creator/event config and generic package foundation (docs/07 T1.3, docs/09 M5).
// Run through `npm test` in supabase/tests; no booking or payment engine is required.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = (file) =>
  fs.readFileSync(path.join(here, '..', 'migrations', file), 'utf8')
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
for (const file of [
  '0001_init.sql',
  '0002_qa_fixes.sql',
  '0003_payout_transfer_payment_cascade.sql',
  '0007_chat_unread_notifications.sql',
  '0008_provider_kyc_status_values.sql',
  '0009_provider_onboarding.sql',
  '0010_notification_freshness.sql',
  '0011_payout_rails.sql',
  '0012_matching_foundations.sql',
  '0013_review_matching.sql',
  '0017_creator_config.sql',
]) {
  await db.exec(migration(file));
}

let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('ok  :', message);
  else {
    failures++;
    console.log('FAIL:', message);
  }
};
async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
async function expectError(fn, pattern, message) {
  try {
    await fn();
    ok(false, `${message} (no error)`);
  } catch (error) {
    ok(pattern.test(error.message), `${message} -> ${error.message}`);
  }
}
const owner = '00000000-0000-0000-0000-000000000041';
const stranger = '00000000-0000-0000-0000-000000000042';
const admin = '00000000-0000-0000-0000-000000000043';
const asOwner = (sql, params) => as(owner, 'authenticated', sql, params);
const asStranger = (sql, params) => as(stranger, 'authenticated', sql, params);
const asAdmin = (sql, params) => as(admin, 'authenticated', sql, params);
const anon = (sql, params) => as(null, 'anon', sql, params);
const service = (sql, params) => as(null, 'service_role', sql, params);

await db.exec(`
  insert into auth.users (id, phone) values
    ('${owner}', '+919100000041'), ('${stranger}', '+919100000042'), ('${admin}', '+919100000043');
`);
await db.exec(`
  update profiles set full_name = case id
    when '${owner}'::uuid then 'Live package owner'
    when '${stranger}'::uuid then 'Draft provider'
    when '${admin}'::uuid then 'Config admin'
  end
  where id in ('${owner}', '${stranger}', '${admin}');
`);
await db.exec(`insert into admins (user_id) values ('${admin}');`);
await db.exec(`
  insert into providers (id, city, kyc_status, submitted_at, is_online, paused, suspended)
  values
    ('${owner}', 'Package City', 'verified', now(), true, false, false),
    ('${stranger}', 'Package City', 'pending', null, false, false, false);
`);
const categoryId = (await service(`select id from categories where slug = 'ac-repair'`))[0].id;
const ownerServiceId = (
  await service(
    `insert into provider_services (provider_id, category_id, visit_fee, labour_rate, active)
     values ($1, $2, 10000, 20000, true) returning id`,
    [owner, categoryId],
  )
)[0].id;
const strangerServiceId = (
  await service(
    `insert into provider_services (provider_id, category_id, visit_fee, labour_rate, active)
     values ($1, $2, 10000, 20000, true) returning id`,
    [stranger, categoryId],
  )
)[0].id;

const creatorSlugs = [
  'instagram-influencer', 'youtube-creator', 'ugc-creator', 'reel-maker',
  'wedding-photographer', 'candid-photographer', 'pre-wedding-shoot', 'maternity-newborn',
  'product-photographer', 'event-videographer', 'drone-operator', 'photo-booth',
  'caterer', 'decorator', 'bridal-makeup', 'mehendi-artist', 'dj', 'live-band', 'wedding-planner',
];
const creatorRows = await service(
  `select slug, active, profile_schema, review_tags, requires_docs, recommended_docs
     from categories where slug = any($1::text[])`,
  [creatorSlugs],
);
ok(creatorRows.length === creatorSlugs.length, 'all requested creator/event categories are present');
ok(creatorRows.every((row) => row.active === false), 'creator/event categories remain inactive');
ok(
  creatorRows.every((row) => row.profile_schema?.type === 'object' && row.review_tags.length > 0),
  'every creator/event category has profile schema and review tags',
);
const caterer = creatorRows.find((row) => row.slug === 'caterer');
const drone = creatorRows.find((row) => row.slug === 'drone-operator');
const planner = creatorRows.find((row) => row.slug === 'wedding-planner');
ok(caterer?.requires_docs.includes('fssai'), 'caterer requires FSSAI');
ok(drone?.requires_docs.includes('dgca_drone_permission'), 'drone operator requires DGCA permission');
ok(planner?.recommended_docs.includes('gst_registration'), 'planner recommends GST registration');
ok(
  Number((await anon(`select count(*)::int as n from categories where slug = any($1::text[])`, [creatorSlugs]))[0].n) === 0,
  'inactive categories are not exposed by category RLS',
);
ok(
  Number((await service(`select count(*)::int as n from package_templates where category_id in (select id from categories where slug = any($1::text[]))`, [creatorSlugs]))[0].n) === creatorSlugs.length,
  'every creator/event category has a package template',
);
ok(
  Number((await anon(`select count(*)::int as n from package_templates`))[0].n) === 0,
  'templates for inactive creator/event categories are not public',
);

const deliverables = JSON.stringify([{ type: 'edited_reel', qty: 2, spec: '30-60 sec, 9:16, 1080p' }]);
const rights = JSON.stringify({ organic_posting: true, paid_ads_days: 30, exclusivity_days: 0 });
const packageBase = `
  provider_service_id, title, description, price_type, price, price_min, price_max, unit,
  qty_min, qty_max, deliverables, turnaround_days, revisions_included, usage_rights
`;

await expectError(
  () =>
    asOwner(
      `insert into service_packages (${packageBase})
       values ($1, 'Invalid fixed', '', 'fixed', 10000, 9000, 10000, 'job', 1, 1, $2::jsonb, 3, 1, $3::jsonb)`,
      [ownerServiceId, deliverables, rights],
    ),
  /violates check constraint/,
  'fixed package must have price = price_min = price_max',
);
await expectError(
  () =>
    asOwner(
      `insert into service_packages (${packageBase})
       values ($1, 'Invalid range', '', 'range', null, 20000, 10000, 'job', 1, 1, $2::jsonb, 3, 1, $3::jsonb)`,
      [ownerServiceId, deliverables, rights],
    ),
  /violates check constraint/,
  'range package requires ascending min/max',
);
await expectError(
  () =>
    asOwner(
      `insert into service_packages (${packageBase})
       values ($1, 'Bad deliverable', '', 'quote', null, null, null, 'job', 1, 1,
         '[{"type":"reel","qty":0,"spec":"missing quantity"}]'::jsonb, 3, 1, $2::jsonb)`,
      [ownerServiceId, rights],
    ),
  /deliverable qty must be greater than zero/,
  'deliverable quantity must be positive',
);
await expectError(
  () =>
    asOwner(
      `insert into service_packages (${packageBase})
       values ($1, 'Bad rights', '', 'quote', null, null, null, 'job', 1, 1, $2::jsonb, 3, 1,
         '{"paid_ads_days":60}'::jsonb)`,
      [ownerServiceId, deliverables],
    ),
  /paid_ads_days/,
  'usage rights reject unsupported paid-ad windows',
);

const fixed = (
  await asOwner(
    `insert into service_packages (${packageBase})
     values ($1, 'Fixed package', 'One fixed scope', 'fixed', 12000, 12000, 12000, 'job', 1, 1, $2::jsonb, 3, 1, $3::jsonb)
     returning id`,
    [ownerServiceId, deliverables, rights],
  )
)[0].id;
await asOwner(
  `insert into service_packages (${packageBase})
   values ($1, 'Range package', '', 'range', null, 12000, 16000, 'job', 1, 1, $2::jsonb, 5, 2, $3::jsonb)`,
  [ownerServiceId, deliverables, rights],
);
await asOwner(
  `insert into service_packages (${packageBase})
   values ($1, 'From package', '', 'from', null, 15000, null, 'job', 1, 2, $2::jsonb, 7, 1, $3::jsonb)`,
  [ownerServiceId, deliverables, rights],
);
const quote = (
  await asOwner(
    `insert into service_packages (${packageBase})
     values ($1, 'Quote package', '', 'quote', null, null, null, 'event', 1, 1, $2::jsonb, 10, 1, $3::jsonb)
     returning id`,
    [ownerServiceId, deliverables, rights],
  )
)[0].id;
ok(!!fixed && !!quote, 'fixed, range, from and quote package shapes are accepted');

await service(
  `insert into price_bands (category_id, city, unit, "min", "max")
   values ($1, 'Package City', 'job', 10000, 16000)`,
  [categoryId],
);
await asAdmin(
  `insert into price_bands (category_id, city, unit, "min", "max")
   values ($1, 'Admin Test City', 'hour', 5000, 9000)`,
  [categoryId],
);
await expectError(
  () =>
    asStranger(
      `insert into price_bands (category_id, city, unit, "min", "max")
       values ($1, 'Blocked City', 'hour', 5000, 9000)`,
      [categoryId],
    ),
  /row-level security/,
  'price bands are admin-writable only',
);
await expectError(
  () =>
    asOwner(
      `insert into service_packages (${packageBase})
       values ($1, 'Outside band', '', 'fixed', 20000, 20000, 20000, 'job', 1, 1, $2::jsonb, 3, 1, $3::jsonb)`,
      [ownerServiceId, deliverables, rights],
    ),
  /inside the job band/,
  'provider prices are constrained by the configured city band',
);
await expectError(
  () =>
    asOwner(
      `insert into service_packages (${packageBase})
       values ($1, 'Cross-owner', '', 'quote', null, null, null, 'job', 1, 1, $2::jsonb, 3, 1, $3::jsonb)`,
      [strangerServiceId, deliverables, rights],
    ),
  /row-level security/,
  'provider cannot create a package for another provider',
);
await expectError(
  () => asStranger(`select save_provider_service_package($1, $2, '{"title":"x"}'::jsonb)`, [null, ownerServiceId]),
  /provider service not found/,
  'package save RPC enforces provider ownership',
);

const strangerPackage = (
  await service(
    `insert into service_packages (${packageBase})
     values ($1, 'Draft package', '', 'quote', null, null, null, 'job', 1, 1, $2::jsonb, 2, 0, $3::jsonb)
     returning id`,
    [strangerServiceId, deliverables, rights],
  )
)[0].id;
ok((await asStranger(`select id from service_packages where id = $1`, [fixed])).length === 1, 'authenticated users read active packages through the same public live-provider policy as anon');
ok((await anon(`select id from service_packages where id = $1`, [fixed])).length === 1, 'anon can read active packages for a live provider and active category');
ok((await anon(`select id from service_packages where id = $1`, [strangerPackage])).length === 0, 'draft provider packages are private');
await expectError(
  () => anon(`update service_packages set title = 'Tampered' where id = $1`, [fixed]),
  /permission denied|row-level security/,
  'anon cannot update packages',
);
await asOwner(`select delete_provider_service_package($1)`, [quote]);
ok((await asOwner(`select id from service_packages where id = $1`, [quote])).length === 0, 'owner can delete a package through the provider RPC');

const rpcSaved = (
  await asOwner(
    `select save_provider_service_package(
       null, $1,
       jsonb_build_object(
         'title', 'RPC package',
         'description', 'Created by provider RPC',
         'price_type', 'fixed',
         'price', 14000,
         'price_min', 14000,
         'price_max', 14000,
         'unit', 'job',
         'qty_min', 1,
         'qty_max', 1,
         'deliverables', $2::jsonb,
         'turnaround_days', 4,
         'revisions_included', 1,
         'usage_rights', $3::jsonb,
         'active', true
       )
     ) as id`,
    [ownerServiceId, deliverables, rights],
  )
)[0].id;
ok(!!rpcSaved, 'provider save RPC creates a package');

if (failures) process.exitCode = 1;

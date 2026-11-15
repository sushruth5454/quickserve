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
const near = (actual, expected, epsilon = 1e-9) => Math.abs(actual - expected) <= epsilon;
async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const anon = (sql, params) => as(null, 'anon', sql, params);
const service = (sql, params) => as(null, 'service_role', sql, params);
async function expectError(fn, pattern, message) {
  try {
    await fn();
    ok(false, `${message} (no error)`);
  } catch (error) {
    ok(pattern.test(error.message), `${message} -> ${error.message}`);
  }
}

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';
const C = '00000000-0000-0000-0000-000000000003';
const D = '00000000-0000-0000-0000-000000000004';
const CUSTOMER = '00000000-0000-0000-0000-000000000010';
const REVIEWER = '00000000-0000-0000-0000-000000000011';
const scheduledAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
const scheduledEnd = new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString();

await db.exec(`
  insert into auth.users (id, phone) values
    ('${A}', '+919100000001'), ('${B}', '+919100000002'),
    ('${C}', '+919100000003'), ('${D}', '+919100000004'),
    ('${CUSTOMER}', '+919100000010'), ('${REVIEWER}', '+919100000011');
  insert into profiles (id, full_name) values
    ('${A}', 'Provider A'), ('${B}', 'Provider B'),
    ('${C}', 'Provider C'), ('${D}', 'Provider D'),
    ('${CUSTOMER}', 'Fixture Customer'), ('${REVIEWER}', 'Fixture Reviewer');
  insert into providers (
    id, city, service_radius_km, base_location, kyc_status, submitted_at, rating_avg,
    rating_count, jobs_completed, is_online, paused
  ) values
    ('${A}', 'Testcity', 10, extensions.st_setsrid(extensions.st_makepoint(78.0, 17.0), 4326)::extensions.geography,
      'verified', now(), 5, 20, 20, true, false),
    ('${B}', 'Testcity', 10, extensions.st_setsrid(extensions.st_makepoint(78.0, 17.02), 4326)::extensions.geography,
      'verified', now(), 5, 20, 20, true, false),
    ('${C}', 'Testcity', 10, extensions.st_setsrid(extensions.st_makepoint(78.0, 17.20), 4326)::extensions.geography,
      'verified', now(), 5, 20, 20, true, false),
    ('${D}', 'Testcity', 10, extensions.st_setsrid(extensions.st_makepoint(78.0, 17.01), 4326)::extensions.geography,
      'verified', now(), 5, 20, 20, true, false);
`);

const [{ id: categoryId }] = (await db.query(`select id from categories where slug = 'ac-repair'`)).rows;
const providerServices = {};
for (const [key, providerId] of Object.entries({ A, B, C, D })) {
  const [{ id }] = (await db.query(
    `insert into provider_services (
       provider_id, category_id, visit_fee, labour_rate, attributes
     ) values ($1, $2, 10000, 20000, '{"equipment":["split"],"expertise":["gas_refill"]}'::jsonb)
     returning id`,
    [providerId, categoryId],
  )).rows;
  providerServices[key] = id;
}

const [{ id: addressId }] = (await db.query(
  `insert into addresses (user_id, label, line1, city, lat, lng, location)
   values ($1, 'Fixture', '1 Test Street', 'Testcity', 17.0, 78.0,
           extensions.st_setsrid(extensions.st_makepoint(78.0, 17.0), 4326)::extensions.geography)
   returning id`,
  [CUSTOMER],
)).rows;

async function addReview(providerId, serviceId, customerId, status, tag, serial) {
  const [{ id: bookingId }] = (await db.query(
    `insert into bookings (
       customer_id, provider_id, category_id, provider_service_id, address_id,
       description, status, visit_fee, platform_fee, created_at, accepted_at
     ) values ($1, $2, $3, $4, $5, $6, $7, 10000, 1000, now() - interval '1 day', now() - interval '23 hours')
     returning id`,
    [customerId, providerId, categoryId, serviceId, addressId, `Fixture repair ${serial}`, status],
  )).rows;
  const comment = `Quick diagnosis and clean finish throughout for fixture ${serial}.`;
  const [{ id: reviewId }] = (await db.query(
    `insert into reviews (booking_id, customer_id, provider_id, rating, comment, tags)
     values ($1, $2, $3, 5, $4, $5::text[])
     returning id`,
    [bookingId, customerId, providerId, comment, tag === null ? [] : [tag]],
  )).rows;
  return { reviewId, comment };
}

const aReviews = [];
const bReviews = [];
for (let index = 0; index < 3; index++) {
  aReviews.push(await addReview(A, providerServices.A, CUSTOMER, 'completed', 'quick_diagnosis', `A${index}`));
  bReviews.push(await addReview(B, providerServices.B, REVIEWER, 'completed', null, `B${index}`));
}
await db.query(
  `insert into bookings (
     customer_id, provider_id, category_id, provider_service_id, address_id,
     description, status, visit_fee, platform_fee, created_at, accepted_at
   ) values ($1, $2, $3, $4, $5, 'Accepted then cancelled fixture', 'cancelled', 10000, 1000,
             now() - interval '1 day', now() - interval '23 hours')`,
  [REVIEWER, A, categoryId, providerServices.A, addressId],
);
await db.query(
  `insert into provider_time_off (provider_id, period, reason)
   values ($1, tstzrange($2::timestamptz, $3::timestamptz, '[)'), 'Fixture leave')`,
  [D, scheduledAt, scheduledEnd],
);

await expectError(
  () => anon(`select * from claim_reviews_for_insights(10)`),
  /permission denied/,
  'anonymous callers cannot claim reviews',
);
const claimed = await service(`select * from claim_reviews_for_insights(10)`);
ok(claimed.length === 6, 'service role atomically claims eligible reviews');
ok(
  claimed[0].allowed_aspects.includes('quick_diagnosis')
    && claimed[0].allowed_aspects.includes('gas_refill')
    && !claimed[0].allowed_aspects.includes('made_up_need'),
  'claim taxonomy combines configured review tags and attribute enums',
);
ok((await service(`select * from claim_reviews_for_insights(10)`)).length === 0, 'claimed reviews stay leased until finished');

await expectError(
  () => service(
    `select finish_review_insights($1, $2, '[]'::jsonb, 'test', 'test')`,
    [aReviews[0].reviewId, providerServices.B],
  ),
  /provider service does not belong to review/,
  'finish rejects a review/service mismatch',
);
for (const [index, review] of bReviews.entries()) {
  await service(
    `select finish_review_insights(
       $1, $2,
       $3::jsonb,
       'fixture-model', 'fixture-policy-v1', null
     )`,
    [
      review.reviewId,
      providerServices.B,
      JSON.stringify([{
        aspect: 'quick_diagnosis',
        sentiment: 'positive',
        quote: index === 0
          ? 'Contact person@example.com for more'
          : `Quick diagnosis and clean finish throughout for fixture B${index}.`,
      }]),
    ],
  );
}

await expectError(
  () => anon(`select * from review_insights`),
  /permission denied/,
  'raw review insights are private',
);
const summaries = await anon(`select * from review_insight_summary where aspect = 'quick_diagnosis'`);
ok(summaries.length === 1 && summaries[0].positive === 3, 'public insight summary is aggregated');
ok(!('review_id' in summaries[0]) && summaries[0].evidence[0].quote.length <= 140, 'public insight evidence omits review identity');
ok(summaries[0].evidence.length === 2 && summaries[0].evidence.every((item) => !item.quote.includes('@')), 'unsafe or invented quotes are not exposed');

const needs = JSON.stringify({ attributes: ['gas_refill'], review_tags: ['quick_diagnosis'] });
const matches = await as(
  CUSTOMER,
  'authenticated',
  `select * from match_providers('ac-repair', 17.0, 78.0, $1::jsonb, $2::timestamptz, null, 6)`,
  [needs, scheduledAt],
);
ok(matches.length === 2, 'match returns only live, in-radius, available services');
ok(matches.some((row) => row.provider_id === C) === false, 'provider outside normal radius is excluded');
ok(matches.some((row) => row.provider_id === D) === false, 'provider unavailable for requested window is excluded');
ok(matches[0].provider_id === A && matches[0].tier === 'best_match', 'highest score receives best_match tier');
ok(matches[1].provider_id === B && matches[1].tier === 'nearest_good', 'qualifying nearest alternate receives nearest_good tier');

const matchA = matches.find((row) => row.provider_id === A);
const matchB = matches.find((row) => row.provider_id === B);
const radians = (degrees) => degrees * Math.PI / 180;
const deltaLat = radians(0.02);
const deltaLng = radians(0);
const haversine = 2 * 6371 * Math.asin(Math.sqrt(
  Math.sin(deltaLat / 2) ** 2
  + Math.cos(radians(17.0)) * Math.cos(radians(17.02)) * Math.sin(deltaLng / 2) ** 2,
));
const expectedA = 0.45 * 1 + 0.35 * 0.5 + 0.15 * (3 / 4) + 0.05 * 1;
const expectedB = 0.45 * 1 + 0.35 * 0.5 + 0.15 * 1 - 0.10 * (haversine / 10);
ok(near(matchA.score, expectedA), `score A computed independently by hand: ${expectedA}`);
ok(near(matchB.score, expectedB), `score B computed independently by hand: ${expectedB}`);
ok(matchA.score_components.repeat === 1 && matchB.score_components.repeat === 0, 'repeat provider boost is customer-specific');
ok(matchA.matched_needs.join(',') === 'gas_refill,quick_diagnosis', 'declared attributes and review tags satisfy needs');
ok(matchB.evidence_quotes.quick_diagnosis.length <= 2, 'match emits at most two positive quotes per need');

const invalidNeeds = await as(
  CUSTOMER,
  'authenticated',
  `select * from match_providers(
     'ac-repair', 17.0, 78.0,
     '{"attributes":["made_up_need"],"review_tags":["also_not_allowed"]}'::jsonb,
     $1::timestamptz
   )`,
  [scheduledAt],
);
ok(invalidNeeds.every((row) => row.score_components.need === 0.5 && row.matched_needs.length === 0), 'invalid needs are ignored and leave a neutral need score');

const noNeeds = await as(
  CUSTOMER,
  'authenticated',
  `select * from match_providers('ac-repair', 17.0, 78.0, '{}'::jsonb, $1::timestamptz)`,
  [scheduledAt],
);
ok(noNeeds.every((row) => row.score_components.need === 0.5), 'no requested needs use the neutral 0.5');

const again = await as(
  CUSTOMER,
  'authenticated',
  `select provider_service_id, tier, score from match_providers(
     'ac-repair', 17.0, 78.0, $1::jsonb, $2::timestamptz
   )`,
  [needs, scheduledAt],
);
ok(
  JSON.stringify(again) === JSON.stringify(matches.map(({ provider_service_id, tier, score }) => ({ provider_service_id, tier, score }))),
  'scoring and tie-break order are deterministic across calls',
);

if (failures) {
  console.error(`${failures} review matching assertion(s) failed`);
  process.exitCode = 1;
}

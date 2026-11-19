// Fixed fixtures keep the public-read checks independent of run time and one another.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const { ok, scenario, finish } = createHarness();
const fixedCreatedAt = '2026-01-15T12:00:00.000Z';
const sportsDate = '2026-12-01';
const guestFlags = [
  ['home_v2', 'New home screen'],
  ['unified_search', 'Search everything'],
  ['guest_browse', 'Browse without signing in'],
  ['creators_landing', 'Creators landing page'],
  ['booking_steps', 'Step-by-step booking'],
  ['book_again', 'Book again'],
];

/*
 * Current signed-out read inventory (source call sites verified in this lane):
 * - Home: get_catalog(p_city), get_app_features(), and listTopRated(10, city) via
 *   providers(id,city,rating_avg,rating_count,jobs_completed,years_experience,is_online,
 *   profiles(full_name,avatar_url),provider_services(visit_fee,skill_level,active,categories(name,slug))).
 *   Top-rated uses limit=50. Filters are kyc_status=verified, suspended=false, paused=false,
 *   rating_count>0, optional city ilike, ordered by rating_avg/rating_count descending. listMyBookings/
 *   getMyProfile stop at requireUserId().
 * - category/[slug]: get_catalog(p_city) through getCatalogueCategory; search_providers(
 *   p_category_slug, p_lat, p_lng, p_sort, p_min_rating, p_skill_level, p_max_visit_fee,
 *   p_online_only, p_limit); get_catalog(NULL) through listCategories().
 * - provider/[id]: providers.select(PUBLIC_PROVIDER_COLUMNS + profiles(full_name,avatar_url)).eq(id);
 *   provider_services.select(*, categories(name,slug,archetype), rate_card_items(*),
 *   service_packages(*)).eq(provider_id).eq(active,true); reviews.select(id,rating,punctuality,
 *   quality,behaviour,pricing,comment,provider_reply,created_at).eq(provider_id)
 *   .order(created_at desc).limit(50); get_provider_public_profile(p_provider_id).
 *   list_live_cities() is called on the city-switch action with no arguments; anon receives city/count
 *   rows with coordinates redacted, while authenticated callers retain the existing coordinates.
 * - sports/index: list_sports_activities(); sports/[activity]: search_sports_venues(
 *   p_activity_slug,p_lat,p_lng,p_radius_km); venue/[id]: get_sports_venue(p_id),
 *   get_sports_slots(p_resource_id,p_date).
 * - shop/index: list_product_categories(), search_shops(p_lat,p_lng,p_radius_km=50,p_limit=30),
 *   and conditionally list_my_product_enquiries() when products and product_enquiries are on.
 *   products: list_product_categories(), search_products(p_query,p_category_slug,p_lat,p_lng,
 *   p_radius_km=15,p_max_price_paise,p_in_stock_only,p_limit=50), then
 *   product-images createSignedUrl(path,3600). product/[id]: get_product(p_id), then the same
 *   signed URL call. shop/[id]: get_shop(p_id), list_shop_products(p_shop_id), then signed URLs.
 *   AI product search optionally invokes ai-assistant({mode:'product_search',query,lat,lng}), which
 *   calls search_products(p_query,p_category_slug,p_lat,p_lng,p_radius_km=15,p_max_price_paise,
 *   p_in_stock_only,p_limit=50) as the caller.
 * - top-rated: listTopRated(50, city), the same direct provider query as Home.
 * - location: get_app_features(), then geo_states(id,name,active), geo_districts(id,state_id,name,active),
 *   geo_cities(id,district_id,name,lat,lng,active), geo_areas(id,city_id,name,lat,lng,active,sort_order).
 *   listMyAddresses would select addresses(id,label,line1,city,lat,lng,is_default,created_at)
 *   with user_id=uid and label!='Booking', but stops at requireUserId() when signed out; addresses remain private.
 *
 * This lane begins before migrations 0071-0087. The loader applies every numbered migration actually
 * present through 0087; re-run this test against main after those ordered migrations land.
 */

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
`;

const migration = (file) =>
  fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');

const numberedMigrations = fs.readdirSync(migrationsDir)
  .map((file) => ({ file, match: file.match(/^(\d{4})([a-z]?)_.+\.sql$/i) }))
  .filter(({ match }) => match && Number(match[1]) <= 87)
  .sort((a, b) =>
    Number(a.match[1]) - Number(b.match[1])
    || a.match[2].localeCompare(b.match[2])
    || a.file.localeCompare(b.file))
  .map(({ file }) => file);

if (!numberedMigrations.includes('0087_ui_redesign_flags_guest_read.sql')) {
  throw new Error('0087_ui_redesign_flags_guest_read.sql must be loaded by this test');
}

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

function uuid(value) {
  return `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

async function as(uid, role, sql, params = []) {
  await db.exec('reset role');
  await db.query(
    `select set_config('request.jwt.claim.sub', $1::text, false),
            set_config('request.jwt.claim.role', $2::text, false)`,
    [uid ?? '', role],
  );
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
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

async function expectDenied(run, label) {
  const error = await failureOf(run);
  ok(error !== null, `${label}: ${JSON.stringify({ error })}`);
}

async function setFlags(flags) {
  for (const [key, enabled] of Object.entries(flags)) {
    await db.query(
      `update public.feature_flags as f set enabled = $1::boolean where f.key = $2::text`,
      [enabled, key],
    );
  }
}

async function addUser(idNumber, name, phone = null) {
  const id = uuid(idNumber);
  const email = `guest-test-${idNumber}@example.test`;
  await db.query(
    `insert into auth.users (id, phone, email, raw_user_meta_data, created_at, updated_at)
     values ($1::uuid, $2::text, $3::text, '{}'::jsonb, $4::timestamptz, $4::timestamptz)
     on conflict (id) do nothing`,
    [id, phone, email, fixedCreatedAt],
  );
  await db.query(
    `insert into public.profiles (id, full_name, avatar_url, role_customer, role_provider)
     values ($1::uuid, $2::text, null, true, false)
     on conflict (id) do update set full_name = excluded.full_name`,
    [id, name],
  );
  if (phone) {
    await db.query(
      `insert into public.private_user_accounts (user_id, phone)
       values ($1::uuid, $2::text)
       on conflict (user_id) do update set phone = excluded.phone`,
      [id, phone],
    );
  }
  return id;
}

async function addCategory(idNumber, city) {
  const slug = `guest-service-${idNumber}`;
  const [{ id }] = (await db.query(
    `insert into public.categories (slug, name, vertical, archetype, active, restricted)
     values ($1::text, $2::text, 'guest-test', 'inspect_quote', true, false)
     returning id`,
    [slug, `Guest service ${idNumber}`],
  )).rows;
  await db.query(
    `insert into public.category_cities (category_id, city, live, launched_at)
     values ($1::uuid, $2::text, true, $3::timestamptz)`,
    [id, city, fixedCreatedAt],
  );
  await db.query(
    `insert into public.category_skills (category_id, kind, slug, label, sort_order, active)
     values ($1::uuid, 'skill', 'fixture-skill', 'Fixture skill', 1, true)`,
    [id],
  );
  await db.query(
    `insert into public.app_config (key, value)
     values ('launch_city', to_jsonb($1::text))
     on conflict (key) do update set value = excluded.value`,
    [city],
  );
  await db.query(
    `insert into public.app_config as config (key, value)
     values ('archetype_flags', '{"inspect_quote":true}'::jsonb)
     on conflict (key) do update
       set value = coalesce(config.value, '{}'::jsonb) || excluded.value`,
  );
  return { id, slug };
}

async function addProviderFixture(base, city) {
  const providerId = await addUser(base + 1, `Guest provider ${base}`, `+1555000${String(base).padStart(4, '0')}`);
  const customerId = await addUser(base + 2, `Guest customer ${base}`, `+1556000${String(base).padStart(4, '0')}`);
  await db.query(
    `update public.profiles as p set role_provider = true where p.id = $1::uuid`,
    [providerId],
  );
  const category = await addCategory(base, city);
  await db.query(
    `insert into public.providers (
       id, bio, city, service_radius_km, base_location, years_experience, languages,
       kyc_status, suspended, is_online, rating_avg, rating_count, jobs_completed,
       commission_tier, created_at, admin_review_status, submitted_at, paused, timezone, base_area
     ) values (
       $1::uuid, 'Public repair profile', $2::text, 15,
       extensions.st_setsrid(extensions.st_makepoint($3::double precision, $4::double precision), 4326),
       5, array['en'], 'verified', false, true, 4.8, 1, 1, 12,
       $5::timestamptz, 'approved', $5::timestamptz, false, 'Asia/Kolkata', 'Public locality'
     )`,
    [providerId, city, 80.6, 16.5, fixedCreatedAt],
  );
  const [{ id: serviceId }] = (await db.query(
    `insert into public.provider_services (
       provider_id, category_id, skill_level, visit_fee, labour_rate, active, created_at
     ) values ($1::uuid, $2::uuid, 'expert', 19900, 50000, true, $3::timestamptz)
     returning id`,
    [providerId, category.id, fixedCreatedAt],
  )).rows;
  await db.query(
    `insert into public.provider_links (
       provider_id, kind, url, handle, verified_method, stats, status, review_reason, created_at
     ) values (
       $1::uuid, 'website', $2::text, 'public-site', 'manual', '{"visits":5}'::jsonb,
       'approved', 'private moderation note', $3::timestamptz
     )`,
    [providerId, `https://example.test/provider-${base}`, fixedCreatedAt],
  );
  await db.query(
    `insert into public.rate_card_items (provider_service_id, title, price)
     values ($1::uuid, 'Fixture labour', 50000)`,
    [serviceId],
  );
  await db.query(
    `insert into public.service_packages (
       provider_service_id, title, description, price_type, price, price_min, price_max,
       unit, active, sort_order, created_at, updated_at
     ) values (
       $1::uuid, 'Fixture package', 'Public package detail', 'fixed',
       10000, 10000, 10000, 'job', true, 1, $2::timestamptz, $2::timestamptz
     )`,
    [serviceId, fixedCreatedAt],
  );
  const addressId = (await db.query(
    `insert into public.addresses (user_id, label, line1, city, lat, lng, created_at)
     values ($1::uuid, 'Home', 'Customer private street', $2::text, 16.5, 80.6, $3::timestamptz)
     returning id`,
    [customerId, city, fixedCreatedAt],
  )).rows[0].id;
  const bookingId = uuid(base + 3);
  await db.query(
    `insert into public.bookings (
       id, customer_id, provider_id, category_id, provider_service_id, address_id,
       description, visit_fee, platform_fee, created_at, updated_at
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
       'Fixture booking', 19900, 0, $7::timestamptz, $7::timestamptz
     )`,
    [bookingId, customerId, providerId, category.id, serviceId, addressId, fixedCreatedAt],
  );
  const reviewId = (await db.query(
    `insert into public.reviews (
       booking_id, customer_id, provider_id, rating, punctuality, quality,
       behaviour, pricing, comment, provider_reply, created_at,
       insights_claimed_at, insights_processed_at, insights_error
     ) values (
       $1::uuid, $2::uuid, $3::uuid, 5, 5, 4, 5, 4,
       'Public fixture review', 'Public fixture reply', $4::timestamptz,
       $4::timestamptz, $4::timestamptz, 'private review processing detail'
     ) returning id`,
    [bookingId, customerId, providerId, fixedCreatedAt],
  )).rows[0].id;
  return { providerId, customerId, category, serviceId, bookingId, reviewId };
}

async function addShopFixture(base, city) {
  const ownerId = await addUser(base + 1, `Guest shop ${base}`, `+1557000${String(base).padStart(4, '0')}`);
  const categorySlug = `guest-product-${base}`;
  const [{ id: productCategoryId }] = (await db.query(
    `insert into public.product_categories (slug, name, icon, active, sort_order)
     values ($1::text, $2::text, 'cube-outline', true, 1) returning id`,
    [categorySlug, `Guest product ${base}`],
  )).rows;
  const [{ id: shopId }] = (await db.query(
    `insert into public.shops (
       owner_id, name, description, address_line, city, area, lat, lng,
       delivery_radius_km, offers_delivery, offers_pickup, status, created_at, updated_at
     ) values (
       $1::uuid, $2::text, 'Public shop description', 'Private shop street',
       $3::text, 'Public locality', 16.5, 80.6, 10, true, true, 'verified',
       $4::timestamptz, $4::timestamptz
     ) returning id`,
    [ownerId, `Guest shop ${base}`, city, fixedCreatedAt],
  )).rows;
  await db.query(
    `insert into public.shop_categories (shop_id, category_id)
     values ($1::uuid, $2::uuid)`,
    [shopId, productCategoryId],
  );
  const [{ id: productId }] = (await db.query(
    `insert into public.products (
       shop_id, category_id, name, brand, model, description, specs, unit,
       indicative_price_paise, price_updated_at, in_stock, active, created_at, updated_at
     ) values (
       $1::uuid, $2::uuid, $3::text, 'Fixture brand', 'Fixture model',
       'Public product description', '{}'::jsonb, 'piece', 25000,
       $4::timestamptz, true, true, $4::timestamptz, $4::timestamptz
     ) returning id`,
    [shopId, productCategoryId, `Guest product ${base}`, fixedCreatedAt],
  )).rows;
  const imagePath = `${shopId}/visible.webp`;
  await db.query(
    `insert into public.product_images (product_id, path, sort_order, created_at)
     values ($1::uuid, $2::text, 0, $3::timestamptz)`,
    [productId, imagePath, fixedCreatedAt],
  );
  await db.query(
    `insert into storage.objects (bucket_id, name) values ('product-images', $1::text)`,
    [imagePath],
  );

  const [{ id: inactiveProductId }] = (await db.query(
    `insert into public.products (
       shop_id, category_id, name, unit, active, created_at, updated_at
     ) values ($1::uuid, $2::uuid, $3::text, 'piece', false, $4::timestamptz, $4::timestamptz)
     returning id`,
    [shopId, productCategoryId, `Inactive product ${base}`, fixedCreatedAt],
  )).rows;
  const inactiveImagePath = `${shopId}/inactive.webp`;
  await db.query(
    `insert into public.product_images (product_id, path, sort_order, created_at)
     values ($1::uuid, $2::text, 1, $3::timestamptz)`,
    [inactiveProductId, inactiveImagePath, fixedCreatedAt],
  );
  await db.query(
    `insert into storage.objects (bucket_id, name) values ('product-images', $1::text)`,
    [inactiveImagePath],
  );

  const hiddenOwner = await addUser(base + 2, `Unverified shop ${base}`);
  const [{ id: hiddenShopId }] = (await db.query(
    `insert into public.shops (
       owner_id, name, address_line, city, area, lat, lng, status, created_at, updated_at
     ) values (
       $1::uuid, $2::text, 'Hidden shop street', $3::text, 'Hidden locality',
       16.5, 80.6, 'submitted', $4::timestamptz, $4::timestamptz
     ) returning id`,
    [hiddenOwner, `Hidden shop ${base}`, city, fixedCreatedAt],
  )).rows;
  await db.query(
    `insert into public.shop_categories (shop_id, category_id)
     values ($1::uuid, $2::uuid)`,
    [hiddenShopId, productCategoryId],
  );
  const [{ id: hiddenProductId }] = (await db.query(
    `insert into public.products (shop_id, category_id, name, unit, active)
     values ($1::uuid, $2::uuid, $3::text, 'piece', true) returning id`,
    [hiddenShopId, productCategoryId, `Hidden product ${base}`],
  )).rows;
  const hiddenImagePath = `${hiddenShopId}/hidden.webp`;
  await db.query(
    `insert into public.product_images (product_id, path, sort_order, created_at)
     values ($1::uuid, $2::text, 0, $3::timestamptz)`,
    [hiddenProductId, hiddenImagePath, fixedCreatedAt],
  );
  await db.query(
    `insert into storage.objects (bucket_id, name) values ('product-images', $1::text)`,
    [hiddenImagePath],
  );
  return {
    ownerId,
    shopId,
    productCategoryId,
    productId,
    imagePath,
    inactiveProductId,
    inactiveImagePath,
    hiddenShopId,
    hiddenProductId,
    hiddenImagePath,
  };
}

async function addSportsFixture(base, city) {
  const ownerId = await addUser(base + 1, `Guest venue owner ${base}`);
  const [{ id: activityId }] = (await db.query(
    `select a.id from public.sports_activities as a where a.slug = $1::text`,
    ['badminton'],
  )).rows;
  const [{ id: venueId }] = (await db.query(
    `insert into public.sports_venues (
       owner_id, name, description, address_line, city, area, lat, lng,
       amenities, photos, status, created_at, updated_at
     ) values (
       $1::uuid, $2::text, 'Public venue description', 'Private venue street',
       $3::text, 'Public locality', 16.5, 80.6, array['parking'], array[]::text[],
       'verified', $4::timestamptz, $4::timestamptz
     ) returning id`,
    [ownerId, `Guest venue ${base}`, city, fixedCreatedAt],
  )).rows;
  const [{ id: resourceId }] = (await db.query(
    `insert into public.sports_resources (venue_id, activity_id, name, slot_minutes, active)
     values ($1::uuid, $2::uuid, 'Fixture court', 60, true) returning id`,
    [venueId, activityId],
  )).rows;
  await db.query(
    `insert into public.sports_hours (venue_id, weekday, opens, closes)
     values ($1::uuid, 2, '10:00'::time, '12:00'::time)`,
    [venueId],
  );
  await db.query(
    `insert into public.sports_price_rules (resource_id, weekday, starts, ends, price_paise, label)
     values ($1::uuid, 2, '10:00'::time, '12:00'::time, 2500, 'Fixture rate')`,
    [resourceId],
  );

  const hiddenOwnerId = await addUser(base + 2, `Unverified venue owner ${base}`);
  const [{ id: hiddenVenueId }] = (await db.query(
    `insert into public.sports_venues (
       owner_id, name, description, address_line, city, area, lat, lng, status,
       created_at, updated_at
     ) values (
       $1::uuid, $2::text, '', 'Hidden venue street', $3::text, 'Hidden locality',
       16.5, 80.6, 'submitted', $4::timestamptz, $4::timestamptz
     ) returning id`,
    [hiddenOwnerId, `Hidden venue ${base}`, city, fixedCreatedAt],
  )).rows;
  await db.query(
    `insert into public.sports_resources (venue_id, activity_id, name, slot_minutes, active)
     values ($1::uuid, $2::uuid, 'Hidden court', 60, true)`,
    [hiddenVenueId, activityId],
  );
  return { ownerId, activityId, venueId, resourceId, hiddenVenueId };
}

async function addGeographyFixture(base) {
  const stateId = uuid(base + 1);
  const districtId = uuid(base + 2);
  const cityId = uuid(base + 3);
  const areaId = uuid(base + 4);
  const inactiveStateId = uuid(base + 5);
  const inactiveDistrictId = uuid(base + 6);
  const inactiveCityId = uuid(base + 7);
  const inactiveAreaId = uuid(base + 8);
  await db.query(
    `insert into public.geo_states (id, name, active, created_at, updated_at)
     values ($1::uuid, $2::text, true, $3::timestamptz, $3::timestamptz),
            ($4::uuid, $5::text, false, $3::timestamptz, $3::timestamptz)`,
    [stateId, `Active state ${base}`, fixedCreatedAt, inactiveStateId, `Inactive state ${base}`],
  );
  await db.query(
    `insert into public.geo_districts (id, state_id, name, active, created_at, updated_at)
     values ($1::uuid, $2::uuid, $3::text, true, $4::timestamptz, $4::timestamptz),
            ($5::uuid, $6::uuid, $7::text, true, $4::timestamptz, $4::timestamptz)`,
    [districtId, stateId, `Active district ${base}`, fixedCreatedAt, inactiveDistrictId, inactiveStateId, `Orphan district ${base}`],
  );
  await db.query(
    `insert into public.geo_cities (id, district_id, name, lat, lng, active, created_at, updated_at)
     values ($1::uuid, $2::uuid, $3::text, 16.5, 80.6, true, $4::timestamptz, $4::timestamptz),
            ($5::uuid, $6::uuid, $7::text, 16.6, 80.7, true, $4::timestamptz, $4::timestamptz)`,
    [cityId, districtId, `Active city ${base}`, fixedCreatedAt, inactiveCityId, inactiveDistrictId, `Orphan city ${base}`],
  );
  await db.query(
    `insert into public.geo_areas (id, city_id, name, lat, lng, active, sort_order, created_at, updated_at)
     values ($1::uuid, $2::uuid, $3::text, 16.5, 80.6, true, 1, $4::timestamptz, $4::timestamptz),
            ($5::uuid, $6::uuid, $7::text, 16.6, 80.7, true, 1, $4::timestamptz, $4::timestamptz)`,
    [areaId, cityId, `Active area ${base}`, fixedCreatedAt, inactiveAreaId, inactiveCityId, `Orphan area ${base}`],
  );
  return { stateId, districtId, cityId, areaId, inactiveStateId, inactiveDistrictId, inactiveCityId, inactiveAreaId };
}

async function topRatedRows(providerId, city) {
  return as(
    null,
    'anon',
    `select p.id, p.city, p.rating_avg, p.rating_count, p.jobs_completed, p.years_experience,
            p.is_online, pr.full_name, pr.avatar_url, ps.visit_fee, ps.skill_level,
            ps.active, c.name as category_name, c.slug as category_slug
       from public.providers as p
       left join public.profiles as pr on pr.id = p.id
       left join public.provider_services as ps on ps.provider_id = p.id
       left join public.categories as c on c.id = ps.category_id
      where p.kyc_status = 'verified' and not p.suspended and not p.paused
         and p.rating_count > 0 and lower(p.city) = lower($1::text) and p.id = $2::uuid
      order by p.rating_avg desc, p.rating_count desc
       limit $3::int`,
    [city, providerId, 50],
  );
}

async function readProviderDetails(providerId) {
  const providerRows = await as(
    null,
    'anon',
    `select p.id, p.bio, p.city, p.service_radius_km, p.years_experience, p.languages,
            p.kyc_status, p.suspended, p.is_online, p.rating_avg, p.rating_count,
            p.jobs_completed, p.commission_tier, p.created_at, p.paused, p.base_area,
            p.timezone, pr.full_name, pr.avatar_url
       from public.providers as p
       left join public.profiles as pr on pr.id = p.id
      where p.id = $1::uuid`,
    [providerId],
  );
  const serviceRows = await as(
    null,
    'anon',
    `select ps.*, c.name as category_name, c.slug as category_slug, c.archetype as category_archetype
       from public.provider_services as ps
       left join public.categories as c on c.id = ps.category_id
      where ps.provider_id = $1::uuid and ps.active = true`,
    [providerId],
  );
  const rateCardRows = await as(
    null,
    'anon',
    `select rci.* from public.rate_card_items as rci
      join public.provider_services as ps on ps.id = rci.provider_service_id
     where ps.provider_id = $1::uuid and ps.active = true`,
    [providerId],
  );
  const packageRows = await as(
    null,
    'anon',
    `select sp.* from public.service_packages as sp
      join public.provider_services as ps on ps.id = sp.provider_service_id
     where ps.provider_id = $1::uuid and ps.active = true`,
    [providerId],
  );
  const reviewRows = await as(
    null,
    'anon',
    `select r.id, r.rating, r.punctuality, r.quality, r.behaviour, r.pricing,
            r.comment, r.provider_reply, r.created_at
       from public.reviews as r
      where r.provider_id = $1::uuid
      order by r.created_at desc
      limit $2::int`,
    [providerId, 50],
  );
  const publicProfileRows = await as(
    null,
    'anon',
    `select public.get_provider_public_profile($1::uuid) as profile`,
    [providerId],
  );
  return { providerRows, serviceRows, rateCardRows, packageRows, reviewRows, publicProfileRows };
}

await scenario('B-01 flags default off', async () => {
  const rows = await db.query(
    `select f.key, f.enabled, f.label, f.description, f.group_name, f.sort_order
       from public.feature_flags as f
      where f.key = any($1::text[])
      order by f.sort_order, f.key`,
    [guestFlags.map(([key]) => key)],
  ).then((result) => result.rows);
  ok(
    rows.length === guestFlags.length
      && rows.every((row, index) =>
        row.key === guestFlags[index][0]
        && row.enabled === false
        && row.label === guestFlags[index][1]
        && row.group_name === 'Customer experience'
        && row.description.includes('Off:'),
      ),
    `six customer-experience flags are seeded disabled with visible OFF behavior: ${JSON.stringify({ rows })}`,
  );
  const features = (await as(null, 'anon', `select public.get_app_features() as features`))[0].features;
  ok(
    guestFlags.every(([key]) => features[key] === false),
    `get_app_features exposes the safe OFF defaults: ${JSON.stringify({ features })}`,
  );
});

await scenario('enabled public reads and private-field boundaries', async () => {
  const city = 'Guest Read City A';
  await setFlags({ guest_browse: true, products: true, product_enquiries: true, sports: true });
  const provider = await addProviderFixture(10000, city);
  const nonLiveProvider = await addProviderFixture(10050, city);
  await db.query(
    `update public.providers as p set admin_review_status = $1::text where p.id = $2::uuid`,
    ['rejected', nonLiveProvider.providerId],
  );
  const shop = await addShopFixture(11000, city);
  const sports = await addSportsFixture(12000, city);
  const geography = await addGeographyFixture(13000);
  const privateProviderImagePath = `${provider.providerId}/kyc-private.jpg`;
  await db.query(
    `insert into storage.objects (bucket_id, name) values ('provider-docs', $1::text)`,
    [privateProviderImagePath],
  );

  const features = (await as(null, 'anon', `select public.get_app_features() as features`))[0].features;
  ok(
    features.guest_browse === true && features.products === true && features.sports === true,
    `anon feature read reflects the runtime parent and child switches: ${JSON.stringify({ features })}`,
  );

  const catalog = await as(
    null,
    'anon',
    `select c.id, c.slug, c.name from public.get_catalog($1::text) as c`,
    [city],
  );
  ok(
    catalog.some((row) => row.id === provider.category.id && row.slug === provider.category.slug),
    `home/category get_catalog returns the live active category: ${JSON.stringify({ catalog })}`,
  );
  const categoriesWithoutCity = await as(
    null,
    'anon',
    `select c.id, c.slug from public.get_catalog($1::text) as c`,
    [null],
  );
  ok(
    categoriesWithoutCity.some((row) => row.id === provider.category.id),
    `category listCategories call uses the configured launch city: ${JSON.stringify({ categoriesWithoutCity })}`,
  );
  const providerSearch = await as(
    null,
    'anon',
    `select s.provider_id, s.provider_service_id, s.full_name, s.city, s.visit_fee
       from public.search_providers(
         $1::text, $2::double precision, $3::double precision, $4::text,
         $5::numeric, $6::public.skill_level, $7::int, $8::boolean, $9::int
       ) as s`,
    [provider.category.slug, 16.5, 80.6, 'recommended', null, null, null, false, 50],
  );
  ok(
    providerSearch.some((row) => row.provider_id === provider.providerId),
    `category search returns a live provider without exposing contact data: ${JSON.stringify({ providerSearch })}`,
  );
  const topRated = await topRatedRows(provider.providerId, city);
  ok(
    topRated.some((row) => row.id === provider.providerId && row.full_name === `Guest provider 10000`),
    `Home and top-rated direct-table reads return the verified provider: ${JSON.stringify({ topRated })}`,
  );

  const detail = await readProviderDetails(provider.providerId);
  ok(
    detail.providerRows.length === 1
      && detail.serviceRows.length === 1
      && detail.rateCardRows.length === 1
      && detail.packageRows.length === 1
      && detail.reviewRows.length === 1
      && detail.reviewRows[0].id === provider.reviewId,
    `provider detail reads return public provider, active service, pricing, package and review rows: ${JSON.stringify({
      providerRows: detail.providerRows,
      serviceRows: detail.serviceRows,
      rateCardRows: detail.rateCardRows,
      packageRows: detail.packageRows,
      reviewRows: detail.reviewRows,
    })}`,
  );
  const profile = detail.publicProfileRows[0].profile;
  const publicLink = profile?.links?.find((link) => link.url === 'https://example.test/provider-10000');
  ok(
    profile?.id === provider.providerId
      && publicLink?.status === 'approved'
      && publicLink?.review_reason === null
      && !JSON.stringify(profile).includes('private review processing detail')
      && !JSON.stringify(profile).includes('private moderation note')
      && !('phone' in profile)
      && !('email' in profile)
      && !('address_line' in profile),
    `get_provider_public_profile returns only public profile fields: ${JSON.stringify({ profile })}`,
  );
  const liveCities = await as(
    null,
    'anon',
    `select c.city, c.categories, c.providers, c.lat, c.lng from public.list_live_cities() as c`,
  );
  ok(
    liveCities.some((row) => row.city === city && row.providers > 0 && row.lat === null && row.lng === null),
    `provider city-switch read returns live city aggregates without precise coordinates: ${JSON.stringify({ liveCities })}`,
  );
  const hiddenProviderRow = await as(
    null,
    'anon',
    `select p.id from public.providers as p where p.id = $1::uuid`,
    [nonLiveProvider.providerId],
  );
  const hiddenProviderReviews = await as(
    null,
    'anon',
    `select r.id from public.reviews as r where r.provider_id = $1::uuid`,
    [nonLiveProvider.providerId],
  );
  const hiddenProviderProfile = (await as(
    null,
    'anon',
    `select public.get_provider_public_profile($1::uuid) as profile`,
    [nonLiveProvider.providerId],
  ))[0].profile;
  const nonLiveOwnerProfile = (await as(
    nonLiveProvider.providerId,
    'authenticated',
    `select public.get_provider_public_profile($1::uuid) as profile`,
    [nonLiveProvider.providerId],
  ))[0].profile;
  ok(
    hiddenProviderRow.length === 0 && hiddenProviderReviews.length === 0 && hiddenProviderProfile === null,
    `unapproved provider rows and reviews stay hidden: ${JSON.stringify({
      hiddenProviderRow,
      hiddenProviderReviews,
      hiddenProviderProfile,
    })}`,
  );
  ok(
    nonLiveOwnerProfile?.id === nonLiveProvider.providerId && nonLiveOwnerProfile.live === false,
    `authenticated provider can still read their own non-live profile: ${JSON.stringify({ nonLiveOwnerProfile })}`,
  );

  const productCategories = await as(null, 'anon', `select c.id, c.slug from public.list_product_categories() as c`);
  const shops = await as(
    null,
    'anon',
    `select s.id, s.name, s.city, s.area
       from public.search_shops($1::double precision, $2::double precision, $3::int, $4::int) as s`,
    [16.5, 80.6, 50, 30],
  );
  const products = await as(
    null,
    'anon',
    `select p.id, p.shop_id, p.name, p.image_paths, p.city, p.area
       from public.search_products(
         $1::text, $2::text, $3::double precision, $4::double precision,
         $5::int, $6::int, $7::boolean, $8::int
       ) as p`,
    [null, null, 16.5, 80.6, 15, null, false, 50],
  );
  const shopDetails = await as(
    null,
    'anon',
    `select s.id, s.name, s.address_line, s.city, s.area, s.lat, s.lng
       from public.get_shop($1::uuid) as s`,
    [shop.shopId],
  );
  const shopProducts = await as(
    null,
    'anon',
    `select p.id, p.shop_id, p.name, p.image_paths
       from public.list_shop_products($1::uuid) as p`,
    [shop.shopId],
  );
  const productDetails = await as(
    null,
    'anon',
    `select p.id, p.shop_id, p.name, p.image_paths, p.city, p.area
       from public.get_product($1::uuid) as p`,
    [shop.productId],
  );
  const hiddenProductDetails = await as(
    null,
    'anon',
    `select p.id from public.get_product($1::uuid) as p`,
    [shop.inactiveProductId],
  );
  const hiddenShopProductDetails = await as(
    null,
    'anon',
    `select p.id from public.get_product($1::uuid) as p`,
    [shop.hiddenProductId],
  );
  const hiddenShopDetails = await as(
    null,
    'anon',
    `select s.id from public.get_shop($1::uuid) as s`,
    [shop.hiddenShopId],
  );
  const guestEnquiries = await as(
    null,
    'anon',
    `select e.id from public.list_my_product_enquiries() as e`,
  );
  ok(
    productCategories.some((row) => row.id === shop.productCategoryId)
      && shops.some((row) => row.id === shop.shopId)
      && products.some((row) => row.id === shop.productId)
      && shopDetails.length === 1
      && shopProducts.some((row) => row.id === shop.productId)
      && productDetails.length === 1
      && hiddenProductDetails.length === 0
      && hiddenShopProductDetails.length === 0
      && hiddenShopDetails.length === 0
      && guestEnquiries.length === 0,
    `shop/product reads return active verified data while the signed-out enquiry read is empty: ${JSON.stringify({
      productCategories,
      shops,
      products,
      shopDetails,
      shopProducts,
      productDetails,
      hiddenProductDetails,
      hiddenShopProductDetails,
      hiddenShopDetails,
      guestEnquiries,
    })}`,
  );
  ok(
    shopDetails[0].address_line === '' && shopDetails[0].lat === null && shopDetails[0].lng === null,
    `guest shop detail omits the private street address and precise coordinates: ${JSON.stringify({ shopDetails })}`,
  );
  ok(
    !products.some((row) => row.id === shop.inactiveProductId || row.id === shop.hiddenProductId)
      && !shopProducts.some((row) => row.id === shop.inactiveProductId)
      && productDetails.length === 1
      && productDetails[0].id === shop.productId,
    `inactive products and products in an unverified shop are not returned: ${JSON.stringify({
      inactiveProductId: shop.inactiveProductId,
      hiddenProductId: shop.hiddenProductId,
      products,
      shopProducts,
      productDetails,
    })}`,
  );

  const sportsActivities = await as(
    null,
    'anon',
    `select a.id, a.slug, a.name from public.list_sports_activities() as a`,
  );
  const sportsSearch = await as(
    null,
    'anon',
    `select v.id, v.name, v.address_line, v.city, v.area, v.lat, v.lng
       from public.search_sports_venues(
         $1::text, $2::double precision, $3::double precision, $4::double precision
       ) as v`,
    ['badminton', 16.5, 80.6, 15],
  );
  const sportsVenue = (await as(
    null,
    'anon',
    `select public.get_sports_venue($1::uuid) as venue`,
    [sports.venueId],
  ))[0].venue;
  const hiddenSportsVenue = (await as(
    null,
    'anon',
    `select public.get_sports_venue($1::uuid) as venue`,
    [sports.hiddenVenueId],
  ))[0].venue;
  const sportsSlots = await as(
    null,
    'anon',
    `select s.starts_at, s.ends_at, s.state, s.price_paise, s.remaining
       from public.get_sports_slots($1::uuid, $2::date) as s`,
    [sports.resourceId, sportsDate],
  );
  ok(
    sportsActivities.some((row) => row.slug === 'badminton')
      && sportsSearch.some((row) => row.id === sports.venueId)
      && sportsVenue?.id === sports.venueId
      && hiddenSportsVenue === null
      && sportsSlots.length === 2
      && sportsSlots.every((row) => row.state === 'free' && row.price_paise === 2500 && row.remaining === 1),
    `sports reads return active activity, verified venue and fixed-date slots: ${JSON.stringify({
      sportsActivities,
      sportsSearch,
      sportsVenue,
      hiddenSportsVenue,
      sportsSlots,
    })}`,
  );
  ok(
    sportsSearch.every((row) => row.address_line === '' && row.lat === null && row.lng === null)
      && sportsVenue.address_line === ''
      && sportsVenue.lat === null
      && sportsVenue.lng === null
      && !sportsSearch.some((row) => row.id === sports.hiddenVenueId),
    `guest sports reads omit street addresses/precise coordinates and hide unverified venues: ${JSON.stringify({
      sportsSearch,
      sportsVenue,
      hiddenVenueId: sports.hiddenVenueId,
    })}`,
  );

  const geoStates = await as(
    null,
    'anon',
    `select s.id, s.name, s.active from public.geo_states as s order by s.name`,
  );
  const geoDistricts = await as(
    null,
    'anon',
    `select d.id, d.state_id, d.name, d.active from public.geo_districts as d order by d.name`,
  );
  const geoCities = await as(
    null,
    'anon',
    `select c.id, c.district_id, c.name, c.lat, c.lng, c.active
       from public.geo_cities as c order by c.name`,
  );
  const geoAreas = await as(
    null,
    'anon',
    `select a.id, a.city_id, a.name, a.lat, a.lng, a.active, a.sort_order
       from public.geo_areas as a order by a.sort_order, a.name`,
  );
  ok(
    geoStates.some((row) => row.id === geography.stateId)
      && geoDistricts.some((row) => row.id === geography.districtId)
      && geoCities.some((row) => row.id === geography.cityId)
      && geoAreas.some((row) => row.id === geography.areaId)
      && !geoDistricts.some((row) => row.id === geography.inactiveDistrictId)
      && !geoCities.some((row) => row.id === geography.inactiveCityId)
      && !geoAreas.some((row) => row.id === geography.inactiveAreaId),
    `location reads return only active geography beneath active parents: ${JSON.stringify({
      geoStates,
      geoDistricts,
      geoCities,
      geoAreas,
    })}`,
  );

  const visibleImage = await as(
    null,
    'anon',
    `select o.id, o.name from storage.objects as o
      where o.bucket_id = $1::text and o.name = $2::text`,
    ['product-images', shop.imagePath],
  );
  const inactiveImage = await as(
    null,
    'anon',
    `select o.id, o.name from storage.objects as o
      where o.bucket_id = $1::text and o.name = $2::text`,
    ['product-images', shop.inactiveImagePath],
  );
  const hiddenShopImage = await as(
    null,
    'anon',
    `select o.id, o.name from storage.objects as o
      where o.bucket_id = $1::text and o.name = $2::text`,
    ['product-images', shop.hiddenImagePath],
  );
  const privateProviderImage = await as(
    null,
    'anon',
    `select o.id, o.name from storage.objects as o
      where o.bucket_id = $1::text and o.name = $2::text`,
    ['provider-docs', privateProviderImagePath],
  );
  const [{ public: productBucketPublic }] = (await db.query(
    `select b.public from storage.buckets as b where b.id = $1::text`,
    ['product-images'],
  )).rows;
  ok(
    visibleImage.length === 1
      && inactiveImage.length === 0
      && hiddenShopImage.length === 0
      && privateProviderImage.length === 0
      && productBucketPublic === false,
    `Storage SELECT permits signed-URL authorization only for active products in verified shops; bucket stays private: ${JSON.stringify({
      visibleImage,
      inactiveImage,
      hiddenShopImage,
      privateProviderImage,
      productBucketPublic,
    })}`,
  );
  const storagePrivileges = await db.query(`
    select has_table_privilege('anon', 'storage.objects', 'select') as select,
           has_table_privilege('anon', 'storage.objects', 'insert') as insert,
           has_table_privilege('anon', 'storage.objects', 'update') as update,
           has_table_privilege('anon', 'storage.objects', 'delete') as delete
  `).then((result) => result.rows[0]);
  ok(
    storagePrivileges.select === true
      && storagePrivileges.insert === false
      && storagePrivileges.update === false
      && storagePrivileges.delete === false,
    `anon has the storage read needed for signing but no object writes: ${JSON.stringify({ storagePrivileges })}`,
  );

  await expectDenied(
    () => as(null, 'anon', `select a.line1 from public.addresses as a where a.user_id = $1::uuid`, [provider.customerId]),
    'anon cannot read customer addresses',
  );
  await expectDenied(
    () => as(null, 'anon', `select a.phone from public.private_user_accounts as a where a.user_id = $1::uuid`, [provider.customerId]),
    'anon cannot read customer phone',
  );
  await expectDenied(
    () => as(null, 'anon', `select u.email from auth.users as u where u.id = $1::uuid`, [provider.customerId]),
    'anon cannot read customer email',
  );
  await expectDenied(
    () => as(null, 'anon', `select p.base_location from public.providers as p where p.id = $1::uuid`, [provider.providerId]),
    'anon cannot read provider precise address coordinates',
  );
  await expectDenied(
    () => as(null, 'anon', `select p.phone from public.providers as p where p.id = $1::uuid`, [provider.providerId]),
    'provider phone is not a public column',
  );
  await expectDenied(
    () => as(null, 'anon', `select r.booking_id from public.reviews as r where r.id = $1::uuid`, [provider.reviewId]),
    'anon cannot read review booking identifiers',
  );
  await expectDenied(
    () => as(null, 'anon', `select r.customer_id from public.reviews as r where r.id = $1::uuid`, [provider.reviewId]),
    'anon cannot read review customer identifiers',
  );
  await expectDenied(
    () => as(null, 'anon', `select r.insights_claimed_at from public.reviews as r where r.id = $1::uuid`, [provider.reviewId]),
    'anon cannot read review insights_claimed_at',
  );
  await expectDenied(
    () => as(null, 'anon', `select r.insights_processed_at from public.reviews as r where r.id = $1::uuid`, [provider.reviewId]),
    'anon cannot read review insights_processed_at',
  );
  await expectDenied(
    () => as(null, 'anon', `select r.insights_error from public.reviews as r where r.id = $1::uuid`, [provider.reviewId]),
    'anon cannot read review insights_error',
  );
  await expectDenied(
    () => as(null, 'anon', `select i.evidence from public.review_insight_summary as i`),
    'anon cannot read generated review insight evidence',
  );
  await expectDenied(
    () => as(null, 'anon', `select l.review_reason from public.provider_links as l where l.provider_id = $1::uuid`, [provider.providerId]),
    'anon cannot read private provider-link moderation fields',
  );
  const reviewPrivileges = await db.query(`
    select has_table_privilege('anon', 'public.reviews', 'select') as table_select,
           has_column_privilege('anon', 'public.reviews', 'provider_id', 'select') as filter_column,
           has_column_privilege('anon', 'public.reviews', 'comment', 'select') as public_comment,
           has_column_privilege('anon', 'public.reviews', 'booking_id', 'select') as booking_id,
           has_column_privilege('anon', 'public.reviews', 'customer_id', 'select') as customer_id,
           has_column_privilege('anon', 'public.reviews', 'insights_error', 'select') as insights_error
  `).then((result) => result.rows[0]);
  ok(
    reviewPrivileges.table_select === false
      && reviewPrivileges.filter_column === true
      && reviewPrivileges.public_comment === true
      && reviewPrivileges.booking_id === false
      && reviewPrivileges.customer_id === false
      && reviewPrivileges.insights_error === false,
    `review grants expose only the public projection and provider filter: ${JSON.stringify({ reviewPrivileges })}`,
  );
  const anonTablewideGrants = await db.query(`
    select has_table_privilege('anon', 'public.profiles', 'select') as profiles,
           has_table_privilege('anon', 'public.providers', 'select') as providers,
           has_table_privilege('anon', 'public.addresses', 'select') as addresses,
           has_table_privilege('anon', 'public.provider_services', 'select') as provider_services,
           has_table_privilege('anon', 'public.rate_card_items', 'select') as rate_card_items,
           has_table_privilege('anon', 'public.categories', 'select') as categories,
           has_table_privilege('anon', 'public.category_cities', 'select') as category_cities,
           has_table_privilege('anon', 'public.provider_links', 'select') as provider_links,
           has_table_privilege('anon', 'public.review_insight_summary', 'select') as review_insight_summary,
           has_table_privilege('anon', 'public.service_packages', 'select') as service_packages,
           has_table_privilege('anon', 'public.document_types', 'select') as document_types,
           has_table_privilege('anon', 'public.category_skills', 'select') as category_skills,
           has_table_privilege('anon', 'public.provider_availability', 'select') as provider_availability,
           has_table_privilege('anon', 'public.provider_portfolio', 'select') as provider_portfolio,
           has_table_privilege('anon', 'public.package_templates', 'select') as package_templates,
           has_table_privilege('anon', 'public.price_bands', 'select') as price_bands,
           has_table_privilege('anon', 'public.product_categories', 'select') as product_categories,
           has_table_privilege('anon', 'public.shops', 'select') as shops,
           has_table_privilege('anon', 'public.shop_categories', 'select') as shop_categories,
           has_table_privilege('anon', 'public.products', 'select') as products,
           has_table_privilege('anon', 'public.product_images', 'select') as product_images,
           has_table_privilege('anon', 'public.sports_activities', 'select') as sports_activities,
           has_table_privilege('anon', 'public.sports_venues', 'select') as sports_venues,
           has_table_privilege('anon', 'public.sports_resources', 'select') as sports_resources,
           has_table_privilege('anon', 'public.sports_hours', 'select') as sports_hours,
           has_table_privilege('anon', 'public.sports_price_rules', 'select') as sports_price_rules,
           has_table_privilege('anon', 'public.geo_states', 'select') as geo_states,
           has_table_privilege('anon', 'public.geo_districts', 'select') as geo_districts,
           has_table_privilege('anon', 'public.geo_cities', 'select') as geo_cities,
           has_table_privilege('anon', 'public.geo_areas', 'select') as geo_areas
  `).then((result) => result.rows[0]);
  ok(
    Object.values(anonTablewideGrants).every((allowed) => allowed === false),
    `anon relies on public column grants/RPCs rather than table-wide SELECT: ${JSON.stringify({ anonTablewideGrants })}`,
  );
  const fullAuthenticatedReview = await as(
    provider.customerId,
    'authenticated',
    `select r.* from public.reviews as r where r.booking_id = $1::uuid`,
    [provider.bookingId],
  );
  ok(
    fullAuthenticatedReview.length === 1
      && fullAuthenticatedReview[0].customer_id === provider.customerId
      && fullAuthenticatedReview[0].insights_error === 'private review processing detail',
    `authenticated getReviewForBooking-style full-row reads remain unchanged: ${JSON.stringify({
      fullAuthenticatedReview,
    })}`,
  );
});

await scenario('parent guest_browse off blocks anon while child flags are on', async () => {
  const city = 'Guest Read City B';
  const provider = await addProviderFixture(20000, city);
  const shop = await addShopFixture(21000, city);
  const sports = await addSportsFixture(22000, city);
  const geography = await addGeographyFixture(23000);
  await setFlags({ guest_browse: false, products: true, product_enquiries: true, sports: true });

  const features = (await as(null, 'anon', `select public.get_app_features() as features`))[0].features;
  const serviceBrowseGate = (await as(
    null,
    'service_role',
    `select public._guest_browse_enabled() as allowed`,
  ))[0].allowed;
  const catalog = await as(
    null,
    'anon',
    `select c.id from public.get_catalog($1::text) as c`,
    [city],
  );
  const providerSearch = await as(
    null,
    'anon',
    `select s.provider_id from public.search_providers(
       $1::text,$2::double precision,$3::double precision,$4::text,
       $5::numeric,$6::public.skill_level,$7::int,$8::boolean,$9::int
     ) as s`,
    [provider.category.slug, 16.5, 80.6, 'recommended', null, null, null, false, 50],
  );
  const providers = await topRatedRows(provider.providerId, city);
  const providerDetails = await readProviderDetails(provider.providerId);
  const providerProfile = (await as(
    null,
    'anon',
    `select public.get_provider_public_profile($1::uuid) as profile`,
    [provider.providerId],
  ))[0].profile;
  const liveCities = await as(
    null,
    'anon',
    `select c.city from public.list_live_cities() as c`,
  );
  const geographyRows = await as(
    null,
    'anon',
    `select a.id from public.geo_areas as a where a.id = $1::uuid`,
    [geography.areaId],
  );
  const productImage = await as(
    null,
    'anon',
    `select o.id from storage.objects as o where o.bucket_id = $1::text and o.name = $2::text`,
    ['product-images', shop.imagePath],
  );
  ok(
    features.guest_browse === false
      && serviceBrowseGate === true
      && catalog.length === 0
      && providerSearch.length === 0
      && providers.length === 0
      && providerDetails.providerRows.length === 0
      && providerDetails.serviceRows.length === 0
      && providerDetails.reviewRows.length === 0
      && providerProfile === null
      && liveCities.length === 0
      && geographyRows.length === 0
      && productImage.length === 0,
    `parent OFF blocks every tested anon read even with child flags ON: ${JSON.stringify({
      features,
      serviceBrowseGate,
      catalog,
      providerSearch,
      providers,
      providerDetails,
      providerProfile,
      liveCities,
      geographyRows,
      productImage,
    })}`,
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.list_product_categories()`),
    'parent OFF blocks product category RPC',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.search_shops($1::double precision,$2::double precision,$3::int,$4::int)`, [16.5, 80.6, 50, 30]),
    'parent OFF blocks shop search RPC',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.search_products($1::text,$2::text,$3::double precision,$4::double precision,$5::int,$6::int,$7::boolean,$8::int)`, [null, null, 16.5, 80.6, 15, null, false, 50]),
    'parent OFF blocks product search RPC',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.get_shop($1::uuid)`, [shop.shopId]),
    'parent OFF blocks shop detail RPC',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.list_shop_products($1::uuid)`, [shop.shopId]),
    'parent OFF blocks shop product listing RPC',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.get_product($1::uuid)`, [shop.productId]),
    'parent OFF blocks product detail RPC',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.list_my_product_enquiries()`),
    'parent OFF blocks the conditional guest enquiry-list RPC',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.list_sports_activities()`),
    'parent OFF blocks sports activities RPC',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.search_sports_venues($1::text,$2::double precision,$3::double precision,$4::double precision)`, ['badminton', 16.5, 80.6, 15]),
    'parent OFF blocks sports venue search RPC',
  );
  await expectDenied(
    () => as(null, 'anon', `select public.get_sports_venue($1::uuid)`, [sports.venueId]),
    'parent OFF blocks sports venue detail RPC',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.get_sports_slots($1::uuid,$2::date)`, [sports.resourceId, sportsDate]),
    'parent OFF blocks sports slot RPC',
  );

  const authenticatedCategories = await as(
    provider.customerId,
    'authenticated',
    `select c.id from public.get_catalog($1::text) as c`,
    [city],
  );
  const authenticatedProducts = await as(
    provider.customerId,
    'authenticated',
    `select c.id from public.list_product_categories() as c`,
  );
  const authenticatedActivities = await as(
    provider.customerId,
    'authenticated',
    `select a.id from public.list_sports_activities() as a`,
  );
  const authenticatedProfile = await as(
    provider.customerId,
    'authenticated',
    `select p.id, p.full_name, p.avatar_url, p.role_customer, p.role_provider, p.created_at
       from public.profiles as p where p.id = $1::uuid`,
    [provider.customerId],
  );
  const authenticatedSkills = await as(
    provider.customerId,
    'authenticated',
    `select s.id, s.category_id, s.kind, s.slug, s.label, s.sort_order
       from public.category_skills as s
      where s.category_id = $1::uuid and s.active
      order by s.sort_order`,
    [provider.category.id],
  );
  const authenticatedDocumentTypes = await as(
    provider.customerId,
    'authenticated',
    `select d.code, d.label, d.description, d.has_expiry, d.sort_order
       from public.document_types as d order by d.sort_order`,
  );
  const authenticatedGeoStates = await as(
    provider.customerId,
    'authenticated',
    `select s.id, s.name, s.active from public.geo_states as s order by s.name`,
  );
  const authenticatedGeoDistricts = await as(
    provider.customerId,
    'authenticated',
    `select d.id, d.state_id, d.name, d.active from public.geo_districts as d order by d.name`,
  );
  const authenticatedGeoCities = await as(
    provider.customerId,
    'authenticated',
    `select c.id, c.district_id, c.name, c.lat, c.lng, c.active
       from public.geo_cities as c order by c.name`,
  );
  const authenticatedGeoAreas = await as(
    provider.customerId,
    'authenticated',
    `select a.id, a.active from public.geo_areas as a
      where a.id = any($1::uuid[]) order by a.id`,
    [[geography.areaId, geography.inactiveAreaId]],
  );
  ok(
    authenticatedCategories.some((row) => row.id === provider.category.id)
      && authenticatedProducts.some((row) => row.id === shop.productCategoryId)
      && authenticatedActivities.length > 0
      && authenticatedProfile.length === 1
      && authenticatedSkills.some((row) => row.slug === 'fixture-skill')
      && authenticatedDocumentTypes.length > 0
      && authenticatedGeoStates.some((row) => row.id === geography.stateId)
      && authenticatedGeoDistricts.some((row) => row.id === geography.districtId)
      && authenticatedGeoDistricts.some((row) => row.id === geography.inactiveDistrictId)
      && authenticatedGeoCities.some((row) => row.id === geography.cityId)
      && authenticatedGeoCities.some((row) => row.id === geography.inactiveCityId)
      && authenticatedGeoAreas.some((row) => row.id === geography.areaId)
      && authenticatedGeoAreas.some((row) => row.id === geography.inactiveAreaId),
    `authenticated profile, onboarding, location and marketplace reads remain available with guest_browse OFF: ${JSON.stringify({
      authenticatedCategories,
      authenticatedProducts,
      authenticatedActivities,
      authenticatedProfile,
      authenticatedSkills,
      authenticatedDocumentTypes,
      authenticatedGeoStates,
      authenticatedGeoDistricts,
      authenticatedGeoCities,
      authenticatedGeoAreas,
    })}`,
  );
});

await scenario('child product and sports flags fail closed', async () => {
  const city = 'Guest Read City C';
  const provider = await addProviderFixture(30000, city);
  const shop = await addShopFixture(31000, city);
  const sports = await addSportsFixture(32000, city);
  await setFlags({ guest_browse: true, products: false, product_enquiries: true, sports: false });

  const catalog = await as(
    null,
    'anon',
    `select c.id from public.get_catalog($1::text) as c`,
    [city],
  );
  const providerSearch = await as(
    null,
    'anon',
    `select s.provider_id from public.search_providers(
       $1::text,$2::double precision,$3::double precision,$4::text,
       $5::numeric,$6::public.skill_level,$7::int,$8::boolean,$9::int
     ) as s`,
    [provider.category.slug, 16.5, 80.6, 'recommended', null, null, null, false, 50],
  );
  ok(
    catalog.some((row) => row.id === provider.category.id)
      && providerSearch.some((row) => row.provider_id === provider.providerId),
    `parent-enabled home-service reads remain available with unrelated children OFF: ${JSON.stringify({
      catalog,
      providerSearch,
    })}`,
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.list_product_categories()`),
    'products OFF blocks product categories',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.search_shops($1::double precision,$2::double precision,$3::int,$4::int)`, [16.5, 80.6, 50, 30]),
    'products OFF blocks shop search',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.search_products($1::text,$2::text,$3::double precision,$4::double precision,$5::int,$6::int,$7::boolean,$8::int)`, [null, null, 16.5, 80.6, 15, null, false, 50]),
    'products OFF blocks product search',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.get_shop($1::uuid)`, [shop.shopId]),
    'products OFF blocks shop detail',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.list_shop_products($1::uuid)`, [shop.shopId]),
    'products OFF blocks shop product listing',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.get_product($1::uuid)`, [shop.productId]),
    'products OFF blocks product detail',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.list_sports_activities()`),
    'sports OFF blocks activities',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.search_sports_venues($1::text,$2::double precision,$3::double precision,$4::double precision)`, ['badminton', 16.5, 80.6, 15]),
    'sports OFF blocks venue search',
  );
  await expectDenied(
    () => as(null, 'anon', `select public.get_sports_venue($1::uuid)`, [sports.venueId]),
    'sports OFF blocks venue detail',
  );
  await expectDenied(
    () => as(null, 'anon', `select * from public.get_sports_slots($1::uuid,$2::date)`, [sports.resourceId, sportsDate]),
    'sports OFF blocks slot availability',
  );
  await expectDenied(
    () => as(provider.customerId, 'authenticated', `select * from public.list_product_categories()`),
    'products OFF still blocks authenticated product reads',
  );
  await expectDenied(
    () => as(provider.customerId, 'authenticated', `select * from public.list_sports_activities()`),
    'sports OFF still blocks authenticated sports reads',
  );
});

await scenario('authenticated callers retain behavior when guest browsing is off', async () => {
  const city = 'Guest Read City D';
  const provider = await addProviderFixture(40000, city);
  const shop = await addShopFixture(41000, city);
  const sports = await addSportsFixture(42000, city);
  await setFlags({ guest_browse: false, products: true, product_enquiries: true, sports: true });

  const authenticatedShop = await as(
    provider.customerId,
    'authenticated',
    `select s.id, s.address_line, s.lat, s.lng from public.get_shop($1::uuid) as s`,
    [shop.shopId],
  );
  const authenticatedVenue = (await as(
    provider.customerId,
    'authenticated',
    `select public.get_sports_venue($1::uuid) as venue`,
    [sports.venueId],
  ))[0].venue;
  const fullReview = await as(
    provider.customerId,
    'authenticated',
    `select r.* from public.reviews as r where r.booking_id = $1::uuid`,
    [provider.bookingId],
  );
  const authenticatedLiveCities = await as(
    provider.customerId,
    'authenticated',
    `select c.city, c.lat, c.lng from public.list_live_cities() as c where c.city = $1::text`,
    [city],
  );
  ok(
    authenticatedShop.length === 1
      && authenticatedShop[0].address_line === 'Private shop street'
      && authenticatedShop[0].lat === 16.5
      && authenticatedVenue?.address_line === 'Private venue street'
      && authenticatedVenue?.lat === 16.5
      && fullReview.length === 1
      && fullReview[0].insights_error === 'private review processing detail'
      && authenticatedLiveCities.some((row) => row.city === city && row.lat !== null && row.lng !== null),
    `authenticated shop, sports and full-review reads retain existing behavior: ${JSON.stringify({
      authenticatedShop,
      authenticatedVenue,
      fullReview,
      authenticatedLiveCities,
    })}`,
  );
});

await scenario('anon cannot execute any listed write RPC', async () => {
  const id = uuid(50001);
  const range = '[2026-12-01 10:00:00+00,2026-12-01 11:00:00+00)';
  await expectDenied(
    () => as(
      null,
      'anon',
      `select public.create_fixed_booking(
         $1::uuid,$2::numeric,$3::tstzrange,$4::jsonb,$5::jsonb
       )`,
       [
         id,
         1,
         range,
         '{"mode":"at_customer","address_id":null,"address_line":"private","city":"Guest Read City","lat":16.5,"lng":80.6}',
         '{}',
       ],
    ),
    'anon cannot call create_fixed_booking',
  );
  await expectDenied(
    () => as(
      null,
      'anon',
      `select public.book_sports_slot(
         $1::uuid,$2::timestamptz,$3::int,$4::int,$5::text,$6::text,$7::text
       )`,
      [id, '2026-12-01T10:00:00.000Z', 1, 1, 'pay_at_venue', '', 'guest-write-denied'],
    ),
    'anon cannot call book_sports_slot',
  );
  await expectDenied(
    () => as(
      null,
      'anon',
      `select public.start_product_enquiry($1::uuid,$2::uuid,$3::text)`,
      [id, id, 'guest write must be denied'],
    ),
    'anon cannot call start_product_enquiry',
  );
  await expectDenied(
    () => as(
      null,
      'anon',
      `select public.create_service_request(
         $1::uuid,$2::text,$3::text,$4::timestamptz,$5::timestamptz,$6::jsonb,
         $7::int,$8::int,$9::uuid,$10::text,$11::uuid,$12::double precision,
         $13::double precision,$14::boolean
       )`,
      [
        id,
        'Guest Read City',
        'Fixture area',
        '2026-12-15T10:00:00.000Z',
        '2026-12-15T11:00:00.000Z',
        '{}',
        null,
        null,
        null,
        'Fixture venue',
        null,
        null,
        null,
        false,
      ],
    ),
    'anon cannot call create_service_request',
  );
});

finish();

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
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
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
const bucketPrimaryKey = await db.query(`
  select exists (
    select 1
      from pg_constraint
     where conrelid = 'storage.buckets'::regclass
       and contype = 'p'
       and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
  ) as present
`);
if (!bucketPrimaryKey.rows[0].present) {
  throw new Error('PGlite fixture must model the storage.buckets id primary key');
}
const legacyHomeSlugs = [
  'house-cleaning', 'electrician', 'plumber', 'ac-repair', 'appliance-repair',
  'carpenter', 'painter', 'pest-control', 'water-tank-cleaning',
];
const fixedPackageProvider = '00000000-0000-0000-0000-0000000000d1';
let legacyHomeCategories = [];
const migrations = [
  '0001_init.sql', '0002_qa_fixes.sql', '0003_payout_transfer_payment_cascade.sql',
  '0007_chat_unread_notifications.sql', '0008_provider_kyc_status_values.sql',
  '0009_provider_onboarding.sql', '0010_notification_freshness.sql',
  '0011_payout_rails.sql', '0012_matching_foundations.sql', '0013_review_matching.sql',
  '0014_travel_requests.sql', '0015_seva_coins.sql', '0016_leakage_programme.sql',
  '0017_creator_config.sql', '0018_archetype_core.sql', '0019_fixed_package_booking.sql',
  '0020_proposal_enum_values.sql', '0021_cancellation_availability_payouts.sql',
  '0022_time_based_booking.sql', '0023_proposal_milestone_booking.sql',
  '0024_activate_creator_event_categories.sql', '0025_targeted_proposal_requests.sql',
  '0026_fix_proposal_prepare_payment.sql', '0027_restore_fixed_prepare_payment.sql',
  '0028_auto_approve_provider_links.sql', '0029_single_due_payment.sql', '0030_review_fixes.sql',
  '0031_holiday_mode_enforcement.sql', '0032_notification_centre.sql', '0033_city_waitlist.sql',
  '0034_targeted_request_radius.sql', '0035_request_coordinates.sql', '0036_provider_service_city.sql',
  '0037_proposal_validity_cap.sql', '0038_proposal_lead_time.sql', '0039_proposal_start_code.sql',
  '0040_urgent_proposals.sql', '0041_admin_support.sql', '0042_feature_registry.sql',
  '0043_commission_config.sql', '0044_creator_revisions.sql', '0045_preferred_language.sql',
  '0046_managed_geography.sql', '0047_coins_config.sql', '0048_sports.sql',
  '0049_shops_catalogue.sql', '0050_rfq.sql', '0051_ai_usage_v3.sql',
  '0052_merchant_staff.sql', '0053_activity_contracts.sql', '0054_addendum_foundations.sql',
  '0055_addendum_foundation_hardening.sql', '0056_home_services_catalogue.sql',
];

for (const file of migrations) {
  if (file === '0056_home_services_catalogue.sql') {
    legacyHomeCategories = (await db.query(
      `select slug, id, name, archetype, pricing_units, payment_template,
              cancellation_policy, config_version
         from public.categories where slug = any($1::text[])`,
      [legacyHomeSlugs],
    )).rows;
    await db.exec(`
      insert into auth.users (id, phone, raw_user_meta_data)
      values ('${fixedPackageProvider}', '+919999000003', '{}');
      update public.categories
         set active = true
       where slug in ('house-cleaning', 'pest-control', 'water-tank-cleaning');
      insert into public.providers (
        id, city, base_location, kyc_status, submitted_at, is_online, paused, suspended
      ) values (
        '${fixedPackageProvider}', 'Review City',
        extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
        'verified', now(), true, false, false
      );
      insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
      select '${fixedPackageProvider}', c.id, 0, 50000, true
        from public.categories c
       where c.slug in ('house-cleaning', 'pest-control');
      insert into public.service_packages (
        provider_service_id, title, price_type, price, price_min, price_max, unit, active
      )
      select ps.id, 'Pest control package', 'fixed', 1000, 1000, 1000, 'job', true
        from public.provider_services ps
        join public.categories c on c.id = ps.category_id
       where ps.provider_id = '${fixedPackageProvider}'
         and c.slug = 'pest-control';
    `);
  }
  if (file === '0051_ai_usage_v3.sql') {
    await db.exec(`
      create table public.ai_usage (
        id bigint generated always as identity primary key,
        user_id uuid not null references public.profiles (id) on delete cascade,
        kind text not null constraint ai_usage_kind_check check (kind in ('transcribe', 'voice_chat', 'photo')),
        request_id uuid,
        created_at timestamptz not null default now()
      )
    `);
  }
  await db.exec(migration(file));
}

await db.exec("set timezone = 'UTC'");
let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log(`ok  : ${message}`);
  else { failures++; console.error(`FAIL: ${message}`); }
};
async function as(uid, role, query, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return (await db.query(query, params)).rows; }
  finally { await db.exec('reset role;'); }
}
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

const admin = '00000000-0000-0000-0000-0000000000b1';
const customer = '00000000-0000-0000-0000-0000000000c1';
const provider = '00000000-0000-0000-0000-0000000000a1';
await db.exec(`
  insert into auth.users (id, phone, raw_user_meta_data) values
    ('${admin}', '+918888000001', '{}'),
    ('${customer}', '+919999000001', '{}'),
    ('${provider}', '+919999000002', '{}');
  insert into public.admins (user_id) values ('${admin}');
  update public.feature_flags set enabled = true where key = 'admin_category_editor';
  update public.feature_flags set enabled = false where key = 'home_services_catalogue_v2';
  update public.app_config
     set value = value || '{"fixed":true,"time_based":true,"inspect_quote":true}'::jsonb
   where key = 'archetype_flags';
`);

await db.exec(`
  insert into public.category_cities (category_id, city, live, launched_at)
  select id, 'Review City', true, now()
    from public.categories
   where slug = 'house-cleaning'
  on conflict (category_id, city) do update set live = true;
`);
const legacyServiceId = await one(
  `select ps.id
     from public.provider_services ps
     join public.categories c on c.id = ps.category_id
    where ps.provider_id = $1 and c.slug = 'house-cleaning'`,
  [fixedPackageProvider],
).then((row) => row.id);
let legacyBookingId;
const legacyBookingError = await fails(async () => {
  legacyBookingId = (await as(
    customer,
    'authenticated',
    `select public.create_booking(
       $1::uuid, 'Legacy cleaning request', '12 Main Road', 'Review City',
       16.50, 80.60, null, '{}'::text[], null
     ) as id`,
    [legacyServiceId],
  ))[0].id;
});
const legacyBooking = legacyBookingId
  ? await one(
    `select b.archetype, b.payment_template_snapshot, b.cancellation_snapshot
       from public.bookings b where b.id = $1`,
    [legacyBookingId],
  )
  : null;
const catalogueFlag = await one(
  "select enabled from public.feature_flags where key = 'home_services_catalogue_v2'",
);
ok(
  legacyBookingError === null,
  `HSC-01 create_booking expected success; error=${legacyBookingError ?? 'none'}`,
);
ok(
  catalogueFlag?.enabled === false,
  `HSC-01 catalogue v2 expected off; actual=${JSON.stringify(catalogueFlag)}`,
);
ok(
  legacyBooking?.archetype === 'inspect_quote'
    && legacyBooking.payment_template_snapshot?.key === 'visit_then_balance'
    && legacyBooking.cancellation_snapshot?.key === 'standard_visit',
  `HSC-01 legacy snapshot expected inspect_quote/visit_then_balance/standard_visit; id=${legacyBookingId ?? 'none'} row=${JSON.stringify(legacyBooking)}`,
);

const parentId = async (slug) =>
  (await one('select id from public.categories where slug = $1', [slug])).id;
const makeCategory = (slug, parent, overrides = {}) => ({
  slug,
  name: slug.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
  icon: 'tool',
  parent_id: parent,
  vertical: 'home-other',
  archetype: 'inspect_quote',
  pricing_units: ['job'],
  recurrence_allowed: false,
  allowed_frequencies: [],
  recurring_discount_bp: null,
  cancellation_policy: 'standard_visit',
  requires_docs: [],
  restricted: false,
  sort_order: 900,
  intake_schema: { type: 'object', properties: { brief: { type: 'string' } } },
  ...overrides,
});
const upsert = (uid, payload) =>
  as(uid, 'authenticated', 'select public.admin_upsert_category($1::jsonb) as id', [JSON.stringify(payload)]);
const flag = (key, enabled) =>
  db.query('update public.feature_flags set enabled = $1 where key = $2', [enabled, key]);

const expectedChildren = [
  ['deep-cleaning', 'household-help', 'fixed', ['monthly'], 'bhk'],
  ['bathroom-cleaning', 'household-help', 'fixed', ['weekly', 'monthly'], 'piece'],
  ['kitchen-cleaning', 'household-help', 'fixed', ['weekly', 'monthly'], 'visit'],
  ['sofa-carpet-cleaning', 'household-help', 'fixed', ['monthly'], 'piece'],
  ['full-house-cleaning', 'household-help', 'fixed', ['monthly'], 'bhk'],
  ['dishwashing', 'household-help', 'time_based', ['daily', 'alternate_days', 'weekly'], 'hour'],
  ['laundry-ironing', 'household-help', 'fixed', ['weekly', 'alternate_days'], 'kg'],
  ['cooking-meal-prep', 'household-help', 'time_based', ['daily', 'weekly'], 'hour'],
  ['daily-cook', 'household-help', 'time_based', ['daily', 'weekly'], 'month'],
  ['part-time-cook', 'household-help', 'time_based', ['daily', 'weekly'], 'hour'],
  ['full-time-cook', 'household-help', 'time_based', ['daily'], 'month'],
  ['maid-household-helper', 'household-help', 'time_based', ['daily', 'alternate_days', 'weekly'], 'hour'],
  ['ac-servicing', 'home-repairs', 'fixed', ['monthly'], 'visit'],
  ['fridge-washing-machine-repair', 'home-repairs', 'inspect_quote', [], 'job'],
  ['ro-water-purifier-service', 'home-repairs', 'fixed', ['monthly'], 'visit'],
  ['appliance-installation', 'home-repairs', 'fixed', [], 'piece'],
  ['gardening', 'home-other', 'time_based', ['weekly', 'alternate_days'], 'hour'],
  ['packers-movers', 'home-other', 'inspect_quote', [], 'job'],
  ['home-sanitisation', 'home-other', 'fixed', ['monthly'], 'bhk'],
  ['babysitting', 'home-other', 'time_based', ['daily', 'weekly'], 'hour'],
  ['elderly-assistance', 'home-other', 'time_based', ['daily', 'weekly'], 'hour'],
];

const migratedLegacy = await db.query(
  `select c.slug, c.id, c.name, c.parent_id, p.slug as parent_slug
     from public.categories c
     left join public.categories p on p.id = c.parent_id
    where c.slug = any($1::text[])`,
  [legacyHomeSlugs],
);
const originalBySlug = new Map(legacyHomeCategories.map((row) => [row.slug, row]));
ok(
  migratedLegacy.rows.length === legacyHomeSlugs.length
    && migratedLegacy.rows.every((row) => originalBySlug.get(row.slug)?.id === row.id
      && originalBySlug.get(row.slug)?.name === row.name),
  'HSC-01 existing home-service category IDs, slugs, and names are preserved',
);
const renamedCleaningSlug = await one(
  "select count(*)::int as n from public.categories where slug = 'home-cleaning'",
);
ok(renamedCleaningSlug.n === 0, 'HSC-01 no replacement home-cleaning slug is created');
const existingRecurrence = await db.query(
  `select slug, archetype, recurrence_allowed, allowed_frequencies, pricing_units,
          payment_template, cancellation_policy, config_version
     from public.categories
    where slug in ('house-cleaning', 'pest-control', 'water-tank-cleaning')`,
);
const legacyRows = existingRecurrence.rows.filter(
  (row) => row.slug === 'house-cleaning' || row.slug === 'water-tank-cleaning',
);
ok(
  legacyRows.length === 2
    && legacyRows.every((row) => {
      const original = originalBySlug.get(row.slug);
      return row.archetype === original.archetype
        && row.payment_template === original.payment_template
        && row.cancellation_policy === original.cancellation_policy
        && JSON.stringify(row.pricing_units) === JSON.stringify(original.pricing_units)
        && row.config_version === original.config_version
        && !row.recurrence_allowed
        && row.allowed_frequencies.length === 0;
    }),
  'HSC-01 legacy services without fixed packages preserve their booking configuration',
);
const packageBackedConversion = existingRecurrence.rows.find((row) => row.slug === 'pest-control');
ok(
  packageBackedConversion?.archetype === 'fixed'
    && packageBackedConversion.payment_template === 'full_upfront'
    && packageBackedConversion.cancellation_policy === 'fixed_flexible'
    && packageBackedConversion.recurrence_allowed
    && JSON.stringify(packageBackedConversion.allowed_frequencies) === JSON.stringify(['monthly'])
    && packageBackedConversion.pricing_units.includes('visit')
    && packageBackedConversion.config_version === originalBySlug.get('pest-control').config_version + 1,
  'HSC-01 package-backed fixed conversion uses the 0019 guard and fixed booking metadata',
);
const expectedParents = {
  'house-cleaning': 'household-help',
  'deep-cleaning': 'household-help',
  'bathroom-cleaning': 'household-help',
  'kitchen-cleaning': 'household-help',
  'sofa-carpet-cleaning': 'household-help',
  'full-house-cleaning': 'household-help',
  dishwashing: 'household-help',
  'laundry-ironing': 'household-help',
  'cooking-meal-prep': 'household-help',
  'daily-cook': 'household-help',
  'part-time-cook': 'household-help',
  'full-time-cook': 'household-help',
  'maid-household-helper': 'household-help',
  electrician: 'home-repairs',
  plumber: 'home-repairs',
  carpenter: 'home-repairs',
  painter: 'home-repairs',
  'ac-repair': 'home-repairs',
  'ac-servicing': 'home-repairs',
  'appliance-repair': 'home-repairs',
  'fridge-washing-machine-repair': 'home-repairs',
  'ro-water-purifier-service': 'home-repairs',
  'pest-control': 'home-repairs',
  'water-tank-cleaning': 'home-repairs',
  'appliance-installation': 'home-repairs',
  gardening: 'home-other',
  'packers-movers': 'home-other',
  'home-sanitisation': 'home-other',
  babysitting: 'home-other',
  'elderly-assistance': 'home-other',
};
const childRows = await db.query(
  `select c.slug, p.slug as parent_slug
     from public.categories c
     join public.categories p on p.id = c.parent_id
    where c.slug = any($1::text[])`,
  [Object.keys(expectedParents)],
);
ok(
  childRows.rows.length === Object.keys(expectedParents).length
    && childRows.rows.every((row) => expectedParents[row.slug] === row.parent_slug),
  'HSC-01 all existing and seeded child categories are attached to their planned group',
);
const groupRows = await db.query(
  `select c.slug, c.name, c.vertical, c.parent_id, c.archetype, c.active,
          count(cc.category_id)::int as city_rows
     from public.categories c
     left join public.category_cities cc on cc.category_id = c.id
    where c.slug = any($1::text[])
    group by c.id`,
  [['household-help', 'home-repairs', 'home-other']],
);
ok(
  groupRows.rows.length === 3
    && groupRows.rows.every((row) => row.vertical === row.slug
      && row.parent_id === null && row.archetype === null && !row.active && row.city_rows === 0)
    && groupRows.rows.find((row) => row.slug === 'household-help')?.name === 'Household help'
    && groupRows.rows.find((row) => row.slug === 'home-repairs')?.name === 'Repair & maintenance'
    && groupRows.rows.find((row) => row.slug === 'home-other')?.name === 'Other services',
  'HSC-02 seeded parent groups are top-level, archetype-free, inactive, and not city-live',
);
const seedRows = await db.query(
  `select c.slug, c.archetype, c.recurrence_allowed, c.allowed_frequencies,
          c.recurring_discount_bp, c.pricing_units, c.active, c.restricted, c.requires_docs,
          count(cc.category_id)::int as city_rows
     from public.categories c
     left join public.category_cities cc on cc.category_id = c.id
    where c.slug = any($1::text[])
    group by c.id`,
  [expectedChildren.map(([slug]) => slug)],
);
ok(
  seedRows.rows.length === expectedChildren.length
    && seedRows.rows.every((row) => {
      const [, , archetype, frequencies, unit] = expectedChildren.find(([slug]) => slug === row.slug);
      return row.archetype === archetype
        && row.recurrence_allowed === (frequencies.length > 0)
        && JSON.stringify(row.allowed_frequencies) === JSON.stringify(frequencies)
        && row.recurring_discount_bp === null
        && row.pricing_units.includes(unit)
        && !row.active
        && row.city_rows === 0;
    }),
  'HSC-02 all new child categories have planned archetype, recurrence policy, unit, and inactive/no-city state',
);
const sensitiveRows = await db.query(
  `select slug, restricted, requires_docs, active
     from public.categories
    where slug in ('babysitting', 'elderly-assistance')`,
);
ok(
  sensitiveRows.rows.length === 2
    && sensitiveRows.rows.every((row) => row.restricted
      && row.requires_docs.includes('police_verification') && !row.active),
  'HSC-02 sensitive categories require police verification and start inactive',
);
ok(
  !seedRows.rows.some((row) => row.slug === 'house-cleaning'),
  'HSC-02 new-seed assertions exclude the existing house-cleaning row',
);

const houseGroupId = await parentId('household-help');
const deepCleaningId = await one(
  "select id from public.categories where slug = 'deep-cleaning'",
).then((row) => row.id);
await db.exec(`
  update public.categories set active = true
   where slug in ('house-cleaning', 'deep-cleaning', 'car-mechanic');
  insert into public.category_cities (category_id, city, live, launched_at)
  select id, 'Review City', true, now()
    from public.categories where slug in ('house-cleaning', 'deep-cleaning', 'car-mechanic')
  on conflict do nothing;
`);
await flag('home_services_catalogue_v2', true);
const enabledCatalog = await as(customer, 'anon', `
  select slug, parent_id, recurrence_allowed, allowed_frequencies
    from public.get_catalog('Review City')
`);
const enabledDeepCleaning = enabledCatalog.find((row) => row.slug === 'deep-cleaning');
ok(
  enabledDeepCleaning?.parent_id === houseGroupId
    && enabledDeepCleaning.recurrence_allowed
    && JSON.stringify(enabledDeepCleaning.allowed_frequencies) === JSON.stringify(['monthly'])
    && enabledCatalog.some((row) => row.slug === 'household-help'),
  'HSC-03 enabled customer catalogue returns recurrence metadata and visible parent group',
);
await flag('home_services_catalogue_v2', false);
const legacyCatalog = await as(customer, 'anon', `
  select slug from public.get_catalog('Review City')
`);
ok(
  legacyCatalog.some((row) => row.slug === 'house-cleaning')
    && legacyCatalog.some((row) => row.slug === 'car-mechanic')
    && !legacyCatalog.some((row) => row.slug === 'deep-cleaning' || row.slug === 'household-help'),
  'HSC-03 disabled catalogue preserves legacy services and hides expanded categories/groups',
);

const homeOtherId = await parentId('home-other');
const reorderGroup = await upsert(admin, makeCategory(
  'a1-reorder-group',
  null,
  { archetype: null },
));
const reorderGroupId = reorderGroup[0]?.id;
const initialCreate = makeCategory('a1-category-first', reorderGroupId);
const created = await upsert(admin, initialCreate);
const firstId = created[0]?.id;
const createdVersion = await one('select config_version from public.categories where id = $1', [firstId]);
ok(
  !!firstId && createdVersion.config_version === 1,
  'HSC-04 admin can create a category with initial config_version',
);
const updated = await upsert(admin, {
  ...initialCreate,
  id: firstId,
  slug: initialCreate.slug,
  name: 'Updated A1 Category',
  recurring_discount_bp: 250,
});
const updatedCategory = await one(
  'select slug, name, config_version, recurring_discount_bp from public.categories where id = $1',
  [updated[0]?.id],
);
ok(
  updated[0]?.id === firstId
    && updatedCategory.slug === 'a1-category-first'
    && updatedCategory.name === 'Updated A1 Category'
    && updatedCategory.config_version === 2
    && updatedCategory.recurring_discount_bp === 250,
  'HSC-04 admin can edit a category without changing its slug or identity',
);
const auditCreateEdit = await one(
  `select count(*)::int as n from public.admin_audit_log
    where admin_id = $1 and target_id = $2 and action = 'upsert_category'`,
  [admin, firstId],
);
ok(auditCreateEdit.n >= 2, 'HSC-04 category create and edit are audit logged');

const secondCreate = await upsert(admin, makeCategory('a1-category-second', reorderGroupId));
const secondId = secondCreate[0]?.id;
const reorderError = await fails(() => as(
  admin,
  'authenticated',
  'select public.admin_reorder_categories($1::uuid[])',
  [[secondId, firstId]],
));
const reordered = await db.query(
  'select id, sort_order, config_version from public.categories where id = any($1::uuid[]) order by sort_order',
  [[firstId, secondId]],
);
ok(
  reorderError === null
    && reordered.rows[0]?.id === secondId
    && reordered.rows[0]?.sort_order === 10
    && reordered.rows[1]?.id === firstId
    && reordered.rows[1]?.sort_order === 20
    && reordered.rows[0]?.config_version === 2
    && reordered.rows[1]?.config_version === 3,
  'HSC-04 admin reorders siblings within one parent and versions changed categories',
);
const reorderAudit = await one(
  `select count(*)::int as n from public.admin_audit_log
    where admin_id = $1 and action = 'reorder_categories'`,
  [admin],
);
ok(reorderAudit.n >= 1, 'HSC-04 category reorder is audit logged');

const categoryList = await as(
  admin,
  'authenticated',
  `select id, name, slug, archetype, active, sort_order, cities, providers, bookings_30d,
          parent_id, vertical, recurrence_allowed, allowed_frequencies, recurring_discount_bp
     from public.admin_list_categories() where id = $1`,
  [firstId],
);
ok(
  categoryList.length === 1
    && categoryList[0].slug === 'a1-category-first'
    && categoryList[0].parent_id === reorderGroupId
    && Array.isArray(categoryList[0].allowed_frequencies),
  'HSC-04 admin category listing preserves its original fields and includes hierarchy/recurrence fields',
);

await as(admin, 'authenticated', 'select public.admin_set_category_active($1::uuid, true)', [firstId]);
const afterActivate = await one('select active, config_version from public.categories where id = $1', [firstId]);
await as(admin, 'authenticated', 'select public.admin_set_category_active($1::uuid, false)', [firstId]);
const afterDisable = await one('select active, config_version from public.categories where id = $1', [firstId]);
ok(
  afterActivate.active && afterActivate.config_version === 4
    && !afterDisable.active && afterDisable.config_version === 5,
  'HSC-04 existing admin activation RPC activates/disables categories and bumps config_version',
);

const nonAdminError = await fails(() => upsert(customer, makeCategory('a1-non-admin-category', homeOtherId)));
const nonAdminReorder = await fails(() => as(
  customer,
  'authenticated',
  'select public.admin_reorder_categories($1::uuid[])',
  [[firstId, secondId]],
));
const nonAdminActivation = await fails(() =>
  as(customer, 'authenticated', 'select public.admin_set_category_active($1::uuid, true)', [firstId]));
ok(
  nonAdminError?.includes('admin only')
    && nonAdminReorder?.includes('admin only')
    && nonAdminActivation?.includes('admin only'),
  'HSC-04 non-admin category writes, reorders, and activation are refused',
);
await flag('admin_category_editor', false);
const editorOffPayload = makeCategory('a1-editor-off-category', homeOtherId);
const editorOffCreate = await fails(() => upsert(admin, editorOffPayload));
const editorOffReorder = await fails(() => as(
  admin,
  'authenticated',
  'select public.admin_reorder_categories($1::uuid[])',
  [[firstId, secondId]],
));
const editorOffCount = await one(
  "select count(*)::int as n from public.categories where slug = 'a1-editor-off-category'",
);
ok(
  editorOffCreate?.toLowerCase().includes('category editor is turned off')
    && editorOffReorder?.toLowerCase().includes('category editor is turned off')
    && editorOffCount.n === 0,
  'HSC-04 category-management RPCs refuse writes when admin_category_editor is off',
);
await flag('admin_category_editor', true);

const invalidSlug = await fails(() =>
  upsert(admin, makeCategory('Bad Slug', homeOtherId)));
const unknownPolicy = await fails(() =>
  upsert(admin, makeCategory('a1-unknown-policy', homeOtherId, { cancellation_policy: 'missing_policy' })));
const nonObjectSchema = await fails(() =>
  upsert(admin, makeCategory('a1-invalid-schema', homeOtherId, { intake_schema: [] })));
const invalidDiscount = await fails(() =>
  upsert(admin, makeCategory('a1-invalid-discount', homeOtherId, { recurring_discount_bp: 5001 })));
const unsafeIntake = await fails(() =>
  upsert(admin, makeCategory('a1-unsafe-intake', homeOtherId, {
    intake_schema: { type: 'object', properties: { phone: { type: 'string' } } },
  })));
const invalidFrequency = await fails(() =>
  upsert(admin, makeCategory('a1-invalid-frequency', homeOtherId, {
    recurrence_allowed: true,
    allowed_frequencies: ['every_hour'],
  })));
ok(
  invalidSlug && unknownPolicy && nonObjectSchema && invalidDiscount && unsafeIntake
    && invalidFrequency?.includes('allowed_frequencies'),
  'HSC-05 category payload validation rejects invalid slug, policy, schema, discount, and frequency values',
);
const invalidWrites = await one(
  `select count(*)::int as n from public.categories
    where slug in ('Bad Slug', 'a1-unknown-policy', 'a1-invalid-schema', 'a1-invalid-discount',
                   'a1-unsafe-intake', 'a1-invalid-frequency')`,
);
ok(invalidWrites.n === 0, 'HSC-05 rejected category payloads leave no partial rows');

const selfParentGroup = await fails(() => upsert(admin, {
  ...makeCategory('home-other', homeOtherId),
  id: homeOtherId,
  parent_id: homeOtherId,
  archetype: null,
}));
const depthThree = await fails(() =>
  upsert(admin, makeCategory('a1-depth-three', firstId)));
const changedSlug = await fails(() =>
  upsert(admin, { ...initialCreate, id: firstId, slug: 'a1-renamed-category' }));
ok(
  selfParentGroup && depthThree && changedSlug,
  'HSC-05 category writes reject self-cycles, depth-three parents, and slug edits',
);
const unchangedAfterInvalidHierarchy = await one(
  `select parent_id, slug from public.categories where id = $1`,
  [homeOtherId],
);
ok(
  unchangedAfterInvalidHierarchy.parent_id === null
    && unchangedAfterInvalidHierarchy.slug === 'home-other',
  'HSC-05 invalid hierarchy and slug changes do not mutate existing categories',
);

const babysittingId = await one(
  "select id from public.categories where slug = 'babysitting'",
).then((row) => row.id);
await db.query('update public.categories set requires_docs = array[]::text[] where id = $1', [babysittingId]);
const protectedActivation = await fails(() =>
  as(admin, 'authenticated', 'select public.admin_set_category_active($1::uuid, true)', [babysittingId]));
const stillInactive = await one('select active from public.categories where id = $1', [babysittingId]);
await db.query(
  "update public.categories set requires_docs = array['police_verification'] where id = $1",
  [babysittingId],
);
const allowedActivation = await fails(() =>
  as(admin, 'authenticated', 'select public.admin_set_category_active($1::uuid, true)', [babysittingId]));
await as(admin, 'authenticated', 'select public.admin_set_category_active($1::uuid, true)', [firstId]);
const restrictedEdit = await fails(() => upsert(admin, {
  ...initialCreate,
  id: firstId,
  restricted: true,
  requires_docs: [],
}));
const remainsUnrestricted = await one(
  'select active, restricted from public.categories where id = $1',
  [firstId],
);
await as(admin, 'authenticated', 'select public.admin_set_category_active($1::uuid, false)', [firstId]);
ok(
  protectedActivation?.includes('require documents'),
  `HSC-06 activation without documents expected the requirement error; actual=${protectedActivation ?? 'none'}`,
);
ok(
  !stillInactive.active,
  `HSC-06 rejected activation expected inactive row; actual=${JSON.stringify(stillInactive)}`,
);
ok(
  allowedActivation === null,
  `HSC-06 activation with requirements expected success; error=${allowedActivation ?? 'none'}`,
);
ok(
  restrictedEdit?.includes('require documents before they can remain active'),
  `HSC-06 restricted edit expected the missing-requirements error; actual=${restrictedEdit ?? 'none'}`,
);
ok(
  remainsUnrestricted.active && !remainsUnrestricted.restricted,
  `HSC-06 rejected edit expected original active/unrestricted row; actual=${JSON.stringify(remainsUnrestricted)}`,
);

await db.exec(`
  insert into public.providers (id, city, base_location, kyc_status, submitted_at, is_online, paused, suspended)
  values ('${provider}', 'Review City', extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
          'verified', now(), true, false, false);
  insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate)
  values ('${provider}', '${deepCleaningId}', 0, 0);
`);
const providerServiceId = await one(
  'select id from public.provider_services where provider_id = $1 and category_id = $2',
  [provider, deepCleaningId],
).then((row) => row.id);
const supportedUnits = [
  'job', 'hour', 'day', 'session', 'person', 'plate', 'sqft', 'bhk', 'seat', 'litre', 'event', 'month',
  'visit', 'kg', 'piece',
];
const unitInsertError = await fails(() => db.query(
  `insert into public.service_packages
    (provider_service_id, title, price_type, price, price_min, price_max, unit)
   select $1, 'Unit ' || u, 'fixed', 1000, 1000, 1000, u
     from unnest($2::text[]) as units(u)`,
  [providerServiceId, supportedUnits],
));
const insertedUnitCount = await one(
  'select count(*)::int as n from public.service_packages where provider_service_id = $1',
  [providerServiceId],
);
const unsupportedUnitError = await fails(() => db.query(
  `insert into public.service_packages
    (provider_service_id, title, price_type, price, price_min, price_max, unit)
   values ($1, 'Unsupported unit', 'fixed', 1000, 1000, 1000, 'dozen')`,
  [providerServiceId],
));
const categoryUnitsUpdate = await fails(() =>
  upsert(admin, makeCategory('a1-unit-category', homeOtherId, {
    pricing_units: ['visit', 'kg', 'piece'],
  })));
ok(
  unitInsertError === null
    && insertedUnitCount.n === supportedUnits.length
    && unsupportedUnitError
    && categoryUnitsUpdate === null,
  'HSC-07 existing and added package units are accepted while unsupported units are rejected',
);

if (failures) process.exitCode = 1;
else console.log('All home services catalogue SQL checks passed.');
await db.close();

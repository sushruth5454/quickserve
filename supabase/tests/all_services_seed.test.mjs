import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = (file) => fs.readFileSync(path.join(here, '..', 'migrations', file), 'utf8')
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
  '0001_init.sql', '0002_qa_fixes.sql', '0003_payout_transfer_payment_cascade.sql',
  '0007_chat_unread_notifications.sql', '0008_provider_kyc_status_values.sql',
  '0009_provider_onboarding.sql', '0010_notification_freshness.sql',
  '0011_payout_rails.sql', '0012_matching_foundations.sql', '0013_review_matching.sql',
  '0014_travel_requests.sql', '0015_seva_coins.sql', '0016_leakage_programme.sql',
  '0017_creator_config.sql', '0018_archetype_core.sql', '0019_fixed_package_booking.sql',
  '0020_proposal_enum_values.sql', '0021_cancellation_availability_payouts.sql',
  '0022_time_based_booking.sql',
  '0023_proposal_milestone_booking.sql',
]) {
  if (!fs.existsSync(path.join(here, '..', 'migrations', file))) continue;
  const sql = migration(file);
  try {
    if (file === '0023_proposal_milestone_booking.sql') {
      const split = sql.indexOf('alter table public.categories');
      await db.exec(sql.slice(0, split));
      await db.exec('drop policy if exists payment_schedule_participants on public.payment_schedule;');
      // PGlite does not commit newly-added enum labels before a later partial-index statement
      // in the same parsed batch. The live migration is already applied outside this harness;
      // map only its PGlite-incompatible partial-index labels to the equivalent active state.
      await db.exec(sql.slice(split)
        .replaceAll("'confirmed'::public.booking_status", "'accepted'::public.booking_status")
        .replaceAll("'delivery_pending'::public.booking_status", "'accepted'::public.booking_status"));
    } else {
      await db.exec(sql);
    }
  } catch (error) {
    throw new Error(`migration ${file} failed: ${error.message}`, { cause: error });
  }
}

const seed = fs.readFileSync(path.join(here, '..', 'seed-all-services.sql'), 'utf8')
  .replace("begin;\n\n", "begin;\nselect set_config('quickserve.demo_seed', '1', true);\n\n", 1);
await db.exec(seed);
const countQuery = `
  select
    (select count(*)::int from auth.users where raw_user_meta_data->>'demo_only' = 'true') demo_users,
    (select count(*)::int from service_packages sp join providers p on p.id = (
      select provider_id from provider_services ps where ps.id = sp.provider_service_id
    ) where p.city = 'Vijayawada Demo') packages,
    (select count(distinct ps.category_id)::int from provider_services ps
       join providers p on p.id = ps.provider_id
       where p.city = 'Vijayawada Demo') provider_categories,
    (select count(distinct ps.category_id)::int from service_packages sp
       join provider_services ps on ps.id = sp.provider_service_id
       join providers p on p.id = ps.provider_id
       where p.city = 'Vijayawada Demo') package_categories,
    (select count(*)::int from proposals where note like '[DEMO ONLY]%') proposals,
    (select count(*)::int from bookings where description like '[DEMO ONLY]%') bookings
`;
const first = await db.query(countQuery);
await db.exec(seed);
const second = await db.query(countQuery);

const failures = [];
const ok = (condition, message) => {
  if (condition) console.log(`ok  : ${message}`);
  else { failures.push(message); console.error(`FAIL: ${message}`); }
};
const initial = first.rows[0];
const repeated = second.rows[0];
ok(initial.demo_users >= 31, 'one synthetic provider exists for every configured demo category');
ok(initial.provider_categories >= 31, 'one provider service exists for every configured demo category');
ok(initial.packages >= 31 && initial.package_categories >= 31, 'every configured demo category has a package');
ok(initial.proposals >= 19, 'every creator/event category has a participant-scoped proposal');
ok(initial.bookings >= 6, 'inspect_quote, fixed and proposal booking paths are seeded');
ok(JSON.stringify(initial) === JSON.stringify(repeated), 'seed reset is idempotent');

const [gates] = (await db.query(`
  select
    count(*) filter (where active and vertical = 'weddings-events')::int as active_events,
    count(*) filter (where active and vertical = 'photo-video')::int as active_photo,
    count(*) filter (where active and vertical = 'creators')::int as active_creators,
    max((slug = 'demo-home-tutor' and active and archetype = 'time_based')::int)::int as time_category
  from categories
`)).rows;
ok(gates.active_events === 0 && gates.active_photo === 0 && gates.active_creators === 0,
  'creator and event categories remain inactive globally');
ok(gates.time_category === 1, 'the explicitly demo-only time category is active only in the demo seed');

const [seedFixes] = (await db.query(`
  select
    (select sp.price_type from service_packages sp
       join provider_services ps on ps.id = sp.provider_service_id
       join categories c on c.id = ps.category_id
      where c.slug = 'house-cleaning' and sp.title = 'Demo 2 BHK deep clean' limit 1) as cleaning_price_type,
    (select (value->>'time_based')::boolean from app_config where key = 'archetype_flags') as time_based_on,
    (select count(*)::int from addresses a join auth.users u on u.id = a.user_id
      where u.phone in ('919999999999', '+919999999999') and a.is_default) as founder_defaults
`)).rows;
ok(seedFixes.cleaning_price_type === 'fixed', 'fixed categories get instantly bookable fixed-price packages');
ok(seedFixes.time_based_on === true, 'the demo tutor archetype is enabled');
ok(seedFixes.founder_defaults <= 1, 'the seed never adds a second default address for the founder');

const [payments] = (await db.query(`
  select count(*) filter (where coalesce(razorpay_link_id,'') not like 'plink_demo_all_%'
                             and coalesce(razorpay_payment_id,'') not like 'pay_demo_all_%')::int as real_ids
  from payments
  where coalesce(razorpay_link_id,'') <> '' or coalesce(razorpay_payment_id,'') <> ''
`)).rows;
ok(payments.real_ids === 0, 'seed contains no real Razorpay identifiers');

// Payment preparation across archetypes with the latest prepare_payment (0026 + 0027).
for (const file of ['0026_fix_proposal_prepare_payment.sql', '0027_restore_fixed_prepare_payment.sql']) await db.exec(migration(file));
const [fixedBooking] = (await db.query(`
  select id, customer_id from bookings
   where archetype = 'fixed' and status = 'pending_payment' and description like '[DEMO ONLY]%' limit 1
`)).rows;
let fixedPrepared = null;
try {
  await db.exec(`set role service_role`);
  fixedPrepared = (await db.query(`select * from prepare_payment($1, $2)`, [fixedBooking.id, fixedBooking.customer_id])).rows[0];
} catch (error) {
  console.error(error.message);
} finally {
  await db.exec('reset role');
}
ok(fixedPrepared?.purpose === 'fixed' && fixedPrepared.amount > 0, 'prepare_payment charges a fixed package its package total');

// Review-aware matching demo: each customer need ranks the AC pro whose reviews prove it first.
const founderId = (await db.query(`select id from auth.users where phone in ('919999999999', '+919999999999') order by created_at limit 1`)).rows[0].id;
const topFor = async (need) => {
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [founderId]);
  try {
    return (await db.query(`
      select full_name, matched_needs, evidence_quotes
        from match_providers(p_category_slug => 'ac-repair', p_lat => 16.5, p_lng => 80.65,
                             p_needs => jsonb_build_object('attributes', '[]'::jsonb, 'review_tags', jsonb_build_array($1::text)),
                             p_limit => 6)
    `, [need])).rows;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
};
const expectations = { quick_diagnosis: 'Kiran Demo Cool Tech', explained_well: 'Ravi Demo Kumar', clean_work: 'Mahesh Demo AC Care' };
for (const [need, name] of Object.entries(expectations)) {
  const rows = await topFor(need);
  const top = rows[0];
  const matched = JSON.stringify(top?.matched_needs ?? []).includes(need);
  const quoted = JSON.stringify(top?.evidence_quotes ?? []).length > 4;
  ok(rows.length >= 3 && top?.full_name === name && matched && quoted,
    `match_providers ranks ${name} first for "${need}" with review quotes (got ${top?.full_name ?? 'none'})`);
}
const [insightRows] = (await db.query(`
  select count(*)::int as insights,
         count(*) filter (where r.insights_processed_at is null)::int as unprocessed,
         count(distinct r.customer_id) filter (where r.customer_id = $1)::int as founder_reviews
    from review_insights i join reviews r on r.id = i.review_id
`, [founderId])).rows;
ok(insightRows.insights >= 60 && insightRows.unprocessed === 0 && insightRows.founder_reviews === 0,
  'matching-demo insights are pre-processed and never written by the founder');

// 0028: provider links go live on save; the safety validation still blocks contact links.
await db.exec(migration('0028_auto_approve_provider_links.sql'));
const linkPro = (await db.query(`select id from providers where city = 'Vijayawada Demo' order by id limit 1`)).rows[0].id;
const asLinkPro = async (sql, params = []) => {
  await db.exec('set role authenticated');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [linkPro]);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
await asLinkPro(`select save_provider_link('youtube', 'https://youtube.com/@demo_channel', 'demo channel')`);
const [savedLink] = (await db.query(`select status from provider_links where provider_id = $1 and kind = 'youtube'`, [linkPro])).rows;
let blocked = false;
try { await asLinkPro(`select save_provider_link('other', 'https://wa.me/919999999999', null)`); } catch { blocked = true; }
ok(savedLink?.status === 'approved' && blocked, 'provider links are approved on save and WhatsApp links are still rejected');

if (failures.length) process.exit(1);

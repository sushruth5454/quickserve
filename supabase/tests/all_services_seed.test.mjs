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
const migrationsDir = path.join(here, '..', 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((file) => /^\d{4}[a-z]?_.+\.sql$/.test(file) && file <= '0065_h2a_recurring_correctness.sql')
  .sort();
for (const required of ['0064_o2_provider_verification.sql', '0065_h2a_recurring_correctness.sql']) {
  if (!migrationFiles.includes(required)) throw new Error(`required migration is missing: ${required}`);
}
for (const file of migrationFiles) {
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

const categoryActivationBeforeSeed = (await db.query(`
  select
    count(*) filter (where active and vertical = 'weddings-events')::int as active_events,
    count(*) filter (where active and vertical = 'photo-video')::int as active_photo,
    count(*) filter (where active and vertical = 'creators')::int as active_creators
  from public.categories
`)).rows[0];
const paymentReceiptTableAbsentBeforeSeed = (await db.query(`
  select to_regclass('public.payment_receipts') is null as absent
`)).rows[0].absent;

const seed = fs.readFileSync(path.join(here, '..', 'seed-all-services.sql'), 'utf8')
  .replace("begin;\n\n", "begin;\nselect set_config('quickserve.demo_seed', '1', true);\n\n", 1);
await db.query(`
  insert into auth.users (id, phone, raw_app_meta_data, raw_user_meta_data)
  values (
    '11111111-1111-1111-1111-111111111111'::uuid,
    '919000000101',
    '{"provider":"phone","providers":["phone"]}'::jsonb,
    '{"full_name":"Ravi Kumar"}'::jsonb
  )
  on conflict (id) do nothing
`);
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
const receiptBookingId = (await db.query(`
  select id
    from public.bookings
   where description like '[DEMO ONLY]%'
   order by id
   limit 1
`)).rows[0].id;
await db.exec(`
  create table public.payment_receipts (
    id uuid primary key default gen_random_uuid(),
    booking_id uuid not null references public.bookings (id)
  )
`);
await db.query(`
  insert into public.payment_receipts (booking_id)
  values ($1::uuid)
`, [receiptBookingId]);
const [recurringFixture] = (await db.query(`
  select p.id as provider_id, ps.id as provider_service_id
    from public.providers p
    join auth.users pu on pu.id = p.id
      and pu.raw_app_meta_data->>'demo_only' = 'true'
      and pu.raw_user_meta_data->>'demo_only' = 'true'
    join public.provider_services ps on ps.provider_id = p.id
   where p.city = 'Vijayawada Demo'
   limit 1
`)).rows;
if (!recurringFixture) throw new Error('demo recurring schedule fixture could not find demo participants');
await db.query(`
  update auth.users
     set raw_user_meta_data = raw_user_meta_data - 'demo_only'
   where id = $1::uuid
`, [recurringFixture.provider_id]);
const [providerFlagsBeforeReset] = (await db.query(`
  select raw_app_meta_data ->> 'demo_only' as app_demo,
         raw_user_meta_data ->> 'demo_only' as user_demo
    from auth.users
   where id = $1::uuid
`, [recurringFixture.provider_id])).rows;
const founderIdForSchedule = (await db.query(`
  select id from auth.users where phone in ('919999999999', '+919999999999') limit 1
`)).rows[0].id;
const [recurringSchedule] = (await db.query(`
  insert into public.recurring_schedules (
    customer_id, provider_id, provider_service_id, weekdays, start_time,
    session_duration_min, payment_mode, address_line, city, lat, lng, starts_on, description
  )
  values (
    $1::uuid, $2::uuid, $3::uuid, array[1]::smallint[], $4::time,
    $5::int, $6::text, $7::text, $8::text, $9::double precision,
    $10::double precision, $11::date, $12::text
  )
  returning id
`, [
  founderIdForSchedule,
  recurringFixture.provider_id,
  recurringFixture.provider_service_id,
  '09:00:00',
  60,
  'per_session',
  'Demo home',
  'Vijayawada Demo',
  16.503,
  80.645,
  '2027-01-04',
  'Recurring plan from a prior E2E run',
])).rows;
let resetError = null;
try {
  await db.exec(seed);
} catch (error) {
  resetError = error;
  await db.exec('rollback');
  await db.query(`delete from public.recurring_schedules where id = $1::uuid`, [recurringSchedule.id]);
  await db.exec(seed);
}
const second = await db.query(countQuery);
const demoReceiptsAfterReset = (await db.query(`
  select count(*)::int as count
    from public.payment_receipts
`)).rows[0].count;
const recurringSchedulesAfterReset = (await db.query(`
  select count(*)::int as count
    from public.recurring_schedules
   where id = $1::uuid
`, [recurringSchedule.id])).rows[0].count;
const [remainingRecurringSchedule] = (await db.query(`
  select r.provider_id, r.description,
         u.raw_app_meta_data ->> 'demo_only' as provider_app_demo,
         u.raw_user_meta_data ->> 'demo_only' as provider_user_demo
    from public.recurring_schedules r
    left join auth.users u on u.id = r.provider_id
   where r.id = $1::uuid
`, [recurringSchedule.id])).rows;
const [demoProviders] = (await db.query(`
  select count(*)::int as providers,
         count(*) filter (where p.admin_review_status = 'approved')::int as approved,
         count(*) filter (where public._provider_is_live(p.id))::int as live
    from public.providers p
    join auth.users u on u.id = p.id
   where u.raw_app_meta_data->>'demo_only' = 'true'
`)).rows;
const [plumberBookingGate] = (await db.query(`
  select p.admin_review_status,
         public._provider_is_live(p.id) as live,
         public._is_bookable(c.id, p.id, 'Vijayawada Demo', c.archetype, null) as bookable
    from public.providers p
    join auth.users u on u.id = p.id
    join public.provider_services ps on ps.provider_id = p.id and ps.active
    join public.categories c on c.id = ps.category_id
   where u.raw_app_meta_data->>'demo_only' = 'true'
     and p.city = 'Vijayawada Demo'
     and c.slug = 'plumber'
   limit 1
`)).rows;

const failures = [];
const ok = (condition, message) => {
  if (condition) console.log(`ok  : ${message}`);
  else { failures.push(message); console.error(`FAIL: ${message}`); }
};
const initial = first.rows[0];
const repeated = second.rows[0];
ok(paymentReceiptTableAbsentBeforeSeed,
  'seed reset tolerates a migration chain without the B2 payment_receipts table');
ok(demoReceiptsAfterReset === 0,
  'seed reset removes receipts attached to demo bookings before deleting those bookings');
ok(resetError === null && recurringSchedulesAfterReset === 0,
  `seed reset removes prior schedules for demo providers even when descriptions are unmarked: ${JSON.stringify({
    recurringScheduleId: recurringSchedule.id,
    remaining: recurringSchedulesAfterReset,
    providerFlagsBeforeReset,
    remainingRecurringSchedule: remainingRecurringSchedule ?? null,
    resetError: resetError?.message ?? null,
  })}`);
ok(initial.demo_users >= 31, 'one synthetic provider exists for every configured demo category');
ok(initial.provider_categories >= 31, 'one provider service exists for every configured demo category');
ok(initial.packages >= 31 && initial.package_categories >= 31, 'every configured demo category has a package');
ok(initial.proposals >= 19, 'every creator/event category has a participant-scoped proposal');
ok(initial.bookings >= 6, 'inspect_quote, fixed and proposal booking paths are seeded');
ok(demoProviders.providers >= 35 && demoProviders.approved === demoProviders.providers
  && demoProviders.live === demoProviders.providers,
`full-chain guarded seed approves and keeps all demo providers live: ${JSON.stringify(demoProviders)}`);
ok(plumberBookingGate.admin_review_status === 'approved' && plumberBookingGate.live && plumberBookingGate.bookable,
  `seeded demo plumber passes the booking predicate: ${JSON.stringify(plumberBookingGate)}`);
const demoConfig = (await db.query(`select value->>'is_demo_project' is_demo from public.app_config where key='deployment'`)).rows[0];
const demoMetadata = (await db.query(`
  select count(*)::int missing_app_flag
    from auth.users
   where raw_user_meta_data->>'demo_only' = 'true'
     and coalesce(raw_app_meta_data->>'demo_only', 'false') <> 'true'
`)).rows[0];
ok(demoConfig.is_demo === 'true' && demoMetadata.missing_app_flag === 0,
  `guarded seed enables demo project and sets service-controlled provider metadata: ${JSON.stringify({ demoConfig, demoMetadata })}`);
const e2eDemoProvider = (await db.query(`
  select raw_app_meta_data->>'demo_only' app_demo,
         raw_user_meta_data->>'demo_only' user_demo
    from auth.users
   where id='11111111-1111-1111-1111-111111111111'::uuid
`)).rows[0];
ok(e2eDemoProvider.app_demo === 'true' && e2eDemoProvider.user_demo == null,
  `guarded seed marks only the fixed E2E provider in app_metadata: ${JSON.stringify(e2eDemoProvider)}`);
ok(JSON.stringify(initial) === JSON.stringify(repeated), 'seed reset is idempotent');

const [gates] = (await db.query(`
  select
    count(*) filter (where active and vertical = 'weddings-events')::int as active_events,
    count(*) filter (where active and vertical = 'photo-video')::int as active_photo,
    count(*) filter (where active and vertical = 'creators')::int as active_creators,
    max((slug = 'demo-home-tutor' and active and archetype = 'time_based')::int)::int as time_category
  from categories
`)).rows;
const categoryActivationAfterSeed = {
  active_events: gates.active_events,
  active_photo: gates.active_photo,
  active_creators: gates.active_creators,
};
ok(JSON.stringify(categoryActivationAfterSeed) === JSON.stringify(categoryActivationBeforeSeed),
  `guarded seed preserves global creator/event category activation: ${JSON.stringify({ before: categoryActivationBeforeSeed, after: categoryActivationAfterSeed })}`);
ok(gates.time_category === 1, 'the explicitly demo-only time category is active only in the demo seed');

const [seedFixes] = (await db.query(`
  select
    (select sp.price_type from service_packages sp
       join provider_services ps on ps.id = sp.provider_service_id
       join categories c on c.id = ps.category_id
      where c.slug = 'house-cleaning' and sp.title = 'Demo 2 BHK deep clean' limit 1) as cleaning_price_type,
    (select sp.price::int from service_packages sp
       join provider_services ps on ps.id = sp.provider_service_id
       join categories c on c.id = ps.category_id
      where c.slug = 'house-cleaning' and sp.title = 'Demo 2 BHK deep clean' limit 1) as cleaning_price_paise,
    (select b.platform_fee::int from bookings b
      where b.description = '[DEMO ONLY] 2 BHK fixed package.' limit 1) as fixed_booking_fee,
    (select b.total_amount::int from bookings b
      where b.description = '[DEMO ONLY] 2 BHK fixed package.' limit 1) as fixed_booking_total,
    (select (b.pricing_snapshot->>'price_paise')::int from bookings b
      where b.description = '[DEMO ONLY] 2 BHK fixed package.' limit 1) as fixed_booking_snapshot_price,
    (select q.total::int from quotes q join bookings b on b.id = q.booking_id
      where b.description = '[DEMO ONLY] 2 BHK fixed package.' limit 1) as fixed_quote_total,
    (select (q.package_snapshot->>'unit_price')::int from quotes q join bookings b on b.id = q.booking_id
      where b.description = '[DEMO ONLY] 2 BHK fixed package.' limit 1) as fixed_quote_snapshot_price,
    (select qi.unit_price::int from quote_items qi join quotes q on q.id = qi.quote_id
       join bookings b on b.id = q.booking_id
      where b.description = '[DEMO ONLY] 2 BHK fixed package.' limit 1) as fixed_quote_item_price,
    (select array_agg(ps.amount order by ps.seq)::int[] from payment_schedule ps
       join bookings b on b.id = ps.booking_id
      where b.description = '[DEMO ONLY] 2 BHK fixed package.') as fixed_schedule_amounts,
    (select (value->>'time_based')::boolean from app_config where key = 'archetype_flags') as time_based_on,
    (select count(*)::int from addresses a join auth.users u on u.id = a.user_id
      where u.phone in ('919999999999', '+919999999999') and a.is_default) as founder_defaults
`)).rows;
ok(seedFixes.cleaning_price_type === 'fixed' && seedFixes.cleaning_price_paise === 99900,
  `the fixed-package E2E fixture matches the ₹999 sample: ${JSON.stringify(seedFixes)}`);
const fixedSeedAmounts = {
  package: seedFixes.cleaning_price_paise,
  booking_fee: seedFixes.fixed_booking_fee,
  booking_total: seedFixes.fixed_booking_total,
  booking_snapshot: seedFixes.fixed_booking_snapshot_price,
  quote_total: seedFixes.fixed_quote_total,
  quote_snapshot: seedFixes.fixed_quote_snapshot_price,
  quote_item: seedFixes.fixed_quote_item_price,
  schedule: seedFixes.fixed_schedule_amounts,
};
ok(JSON.stringify(fixedSeedAmounts) === JSON.stringify({
  package: 99900,
  booking_fee: 2900,
  booking_total: 102800,
  booking_snapshot: 99900,
  quote_total: 99900,
  quote_snapshot: 99900,
  quote_item: 99900,
  schedule: [99900, 2900],
}), `the seeded fixed booking, quote, item and payment schedule stay consistent: ${JSON.stringify(fixedSeedAmounts)}`);
ok(seedFixes.time_based_on === true, 'the demo tutor archetype is enabled');
ok(seedFixes.founder_defaults <= 1, 'the seed never adds a second default address for the founder');

const [payments] = (await db.query(`
  select count(*) filter (where coalesce(razorpay_link_id,'') not like 'plink_demo_all_%'
                             and coalesce(razorpay_payment_id,'') not like 'pay_demo_all_%')::int as real_ids
  from payments
  where coalesce(razorpay_link_id,'') <> '' or coalesce(razorpay_payment_id,'') <> ''
`)).rows;
ok(payments.real_ids === 0, 'seed contains no real Razorpay identifiers');

// Payment preparation across archetypes uses the complete migration chain through 0065.
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

// A fixed package pays every due obligation in one payment and the webhook confirms it
// (0023 had dropped the fixed branch, so real fixed payments were queued for refund).
const [fixedDue] = (await db.query(`
  select coalesce(sum(amount), 0)::int total, count(*)::int n from payment_schedule where booking_id = $1 and status = 'due'
`, [fixedBooking.id])).rows;
let fixedSettled = null;
try {
  await db.exec('set role service_role');
  const fp = (await db.query(`select * from prepare_payment($1, $2)`, [fixedBooking.id, fixedBooking.customer_id])).rows[0];
  await db.query(`update payments set razorpay_link_id = 'link_fixed_combined', short_url = 'https://pay.test' where id = $1`, [fp.payment_id]);
  const res = (await db.query(`select record_payment_paid('link_fixed_combined', 'gateway_fixed_combined', $1) r`, [fp.amount])).rows[0].r;
  fixedSettled = { amount: fp.amount, res, ...(await db.query(`
    select b.status, (select count(*)::int from payment_schedule where booking_id = b.id and status <> 'paid') unpaid,
           (select count(*)::int from refunds r join payments p on p.id = r.payment_id where p.booking_id = b.id) refunds
      from bookings b where b.id = $1`, [fixedBooking.id])).rows[0] };
} catch (error) {
  console.error(error.message);
} finally {
  await db.exec('reset role');
}
ok(fixedDue.n >= 1 && fixedSettled?.amount === fixedDue.total && fixedSettled.status === 'requested'
  && fixedSettled.unpaid === 0 && fixedSettled.refunds === 0,
  `one fixed-package payment settles all due rows and sends the request (${JSON.stringify(fixedSettled)})`);

// The seed must reload cleanly on the complete migration chain used by lane CI.
let reloadError = null;
try {
  await db.exec(seed);
} catch (error) {
  reloadError = error.message;
}
ok(!reloadError, `seed reloads cleanly on the latest migrations (${reloadError ?? 'ok'})`);

if (failures.length) process.exit(1);

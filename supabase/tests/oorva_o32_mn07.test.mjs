import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const targetMigration = '0136_o32_mn07_oorva.sql';
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((file) => /^\d{4}[a-z]?_.+\.sql$/.test(file) && Number(file.slice(0, 4)) <= 136)
  .sort();
if (!migrationFiles.includes(targetMigration)) throw new Error(`missing reserved MN07 migration: ${targetMigration}`);
const migration = (file) =>
  fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
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
    instance_id uuid, id uuid primary key, aud text, role text, phone text,
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
  grant select, insert, delete on storage.objects to authenticated, anon, service_role;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);
for (const file of migrationFiles) {
  const sql = migration(file);
  if (file === '0023_proposal_milestone_booking.sql') {
    const split = sql.indexOf('alter table public.categories');
    await db.exec(sql.slice(0, split));
    await db.exec('drop policy if exists payment_schedule_participants on public.payment_schedule;');
    await db.exec(sql.slice(split)
      .replaceAll("'confirmed'::public.booking_status", "'accepted'::public.booking_status")
      .replaceAll("'delivery_pending'::public.booking_status", "'accepted'::public.booking_status"));
  } else {
    await db.exec(sql);
  }
}
await db.exec("set timezone = 'UTC'");

const one = async (query, params = []) => (await db.query(query, params)).rows[0];
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const check = (condition, label, actual) =>
  ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const fails = async (fn) => {
  try { await fn(); return null; } catch (error) { return error.message; }
};

async function as(uid, role, query, params = []) {
  await db.exec('reset role');
  await db.query('select set_config(\'request.jwt.claim.sub\', $1::text, false)', [uid ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function createActors(seed) {
  const customer = uuid(seed * 100 + 1);
  const provider = uuid(seed * 100 + 2);
  const admin = uuid(seed * 100 + 3);
  const category = uuid(seed * 100 + 4);
  const service = uuid(seed * 100 + 5);
  const address = uuid(seed * 100 + 6);
  const sessionPackage = uuid(seed * 100 + 7);
  const city = `MN07 City ${seed}`;

  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb),
           ($3::uuid, $4::text, '{}'::jsonb),
           ($5::uuid, $6::text, '{}'::jsonb)
  `, [customer, `+919100${String(seed).padStart(6, '0')}`,
    provider, `+918100${String(seed).padStart(6, '0')}`,
    admin, `+917100${String(seed).padStart(6, '0')}`]);
  await db.query('insert into public.admins (user_id) values ($1::uuid)', [admin]);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended, razorpay_account_id, jobs_completed
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.6, 16.5), 4326),
      'verified', now(), 'approved', true, false, false, $3::text, 0
    )
  `, [provider, city, `acc_mn07_${seed}`]);
  await db.query(`
    insert into public.categories (
      id, slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::uuid, $2::text, $3::text, 'quote', true, 'time_based', '{}'::jsonb, 1,
      365, true, array['daily','alternate_days','weekly','monthly','custom']::text[], 0
    )
  `, [category, `mn07-${seed}`, `MN07 session ${seed}`]);
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [category, city]);
  await db.query(`
    insert into public.app_config (key, value)
    values ('archetype_flags', '{"time_based":true}'::jsonb)
    on conflict (key) do update
      set value = public.app_config.value || excluded.value
  `);
  await db.query(`
    insert into public.provider_services (id, provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, $3::uuid, 0, 10000, true)
  `, [service, provider, category]);
  await db.query(`
    insert into public.service_packages (
      id, provider_service_id, title, description, price_type, price, price_min, price_max,
      unit, qty_min, qty_max, duration_min, active
    ) values ($1::uuid, $2::uuid, 'Session', '', 'fixed', 20000, 20000, 20000, 'session', 1, 1, 60, true)
  `, [sessionPackage, service]);
  await db.query(`
    insert into public.addresses (id, user_id, label, line1, city, lat, lng)
    values ($1::uuid, $2::uuid, 'Home', '1 MN07 Test Road', $3::text, 16.5, 80.6)
  `, [address, customer, city]);
  await db.query(`
    insert into public.provider_payout_accounts (provider_id, rail, razorpay_account_id, activation_status)
    values ($1::uuid, 'route', $2::text, 'activated')
  `, [provider, `acc_mn07_${seed}`]);
  return { customer, provider, admin, category, service, address, sessionPackage };
}

async function createDisputeFixture(seed, { disputed = true } = {}) {
  const actors = await createActors(seed);
  const booking = uuid(seed * 1000 + 101);
  const paymentSchedule = uuid(seed * 1000 + 102);
  const payment = uuid(seed * 1000 + 103);
  const slot = new Date(Date.UTC(2030, 6, seed + 1, 10)).toISOString();
  await db.query(`
    insert into public.bookings (
      id, customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, service_window, status, visit_fee, platform_fee,
      total_amount, archetype, exclusive, session_duration_min, service_package_id,
      commission_bp_snapshot
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
      'MN07 dispute test', $7::timestamptz,
      tstzrange($7::timestamptz, $7::timestamptz + interval '1 hour', '[)'),
      'in_progress', 0, 0, 20000, 'time_based', true, 60, $8::uuid, 1180
    )
  `, [booking, actors.customer, actors.provider, actors.category, actors.service,
    actors.address, slot, actors.sessionPackage]);
  await db.query(`
    insert into public.payment_schedule (
      id, booking_id, seq, obligation_type, label, amount, due_rule, due_at, status
    ) values ($1::uuid, $2::uuid, 1, 'service', 'Session service', 20000, 'at_booking', $3::timestamptz, 'paid')
  `, [paymentSchedule, booking, slot]);
  await db.query(`
    insert into public.payments (
      id, booking_id, schedule_id, purpose, amount, status, razorpay_payment_id, paid_at
    ) values ($1::uuid, $2::uuid, $3::uuid, 'session', 20000, 'paid', $4::text, $5::timestamptz)
  `, [payment, booking, paymentSchedule, `gateway-mn07-${seed}`, slot]);
  await db.query('update public.payment_schedule set payment_id = $1::uuid where id = $2::uuid', [payment, paymentSchedule]);
  await db.query(`
    insert into public.payouts (
      booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
    ) values ($1::uuid, $2::uuid, 20000, 2360, 0, 17640, 'pending', $3::timestamptz)
  `, [booking, actors.provider, slot]);
  if (disputed) {
    await as(actors.customer, 'authenticated',
      'select public.dispute_booking($1::uuid, $2::text)', [booking, 'MN07 dispute test']);
  }
  return { ...actors, booking, payment, slot };
}

async function snapshot(booking) {
  return one(`
    select public.bookings.status::text as booking_status,
           count(distinct public.refunds.id)::int as refund_count,
           coalesce(sum(public.refunds.amount), 0)::int as refund_paise,
           (select count(*)::int from public.admin_audit_log
             where public.admin_audit_log.action = 'resolve_dispute'
               and public.admin_audit_log.target_id = public.bookings.id) as audit_count
      from public.bookings
      left join public.payments on public.payments.booking_id = public.bookings.id
      left join public.refunds on public.refunds.payment_id = public.payments.id
     where public.bookings.id = $1::uuid
     group by public.bookings.id
  `, [booking]);
}

const resolve = `select public.resolve_dispute(
  $1::uuid, $2::public.dispute_outcome, $3::int, $4::text
)`;

await scenario('MN-PARTIAL-NOTE-ROLE', async () => {
  const fixture = await createDisputeFixture(11);
  const invalidNotes = [];
  for (const note of [null, '   ', 'x'.repeat(501)]) {
    invalidNotes.push(await fails(() => as(fixture.admin, 'authenticated', resolve,
      [fixture.booking, 'partial_refund', 17600, note])));
  }
  const overPayout = await fails(() => as(fixture.admin, 'authenticated', resolve,
    [fixture.booking, 'partial_refund', 18000, 'valid note']));
  const afterRejects = await snapshot(fixture.booking);
  const validError = await fails(() => as(fixture.admin, 'authenticated', resolve,
    [fixture.booking, 'partial_refund', 17600, '  reviewed  ']));
  const afterSuccess = await snapshot(fixture.booking);
  const audit = await one(`
    select public.admin_audit_log.details ->> 'note' as note
      from public.admin_audit_log
     where public.admin_audit_log.action = 'resolve_dispute'
       and public.admin_audit_log.target_id = $1::uuid
  `, [fixture.booking]);
  check(invalidNotes.every(Boolean)
    && Boolean(overPayout)
    && afterRejects.booking_status === 'disputed'
    && afterRejects.refund_count === 0
    && afterRejects.audit_count === 0
    && validError === null
    && afterSuccess.refund_paise === 17600
    && afterSuccess.audit_count === 1
    && audit.note === 'reviewed',
  'partial note bounds and payout cap reject unsafe direct calls, then accept the valid amount',
  { invalidNotes, overPayout, afterRejects, validError, afterSuccess, audit });
});

await scenario('MN-ROLES-SAME-PK', async () => {
  const fixture = await createDisputeFixture(12);
  const nullOutcome = await fails(() => as(fixture.admin, 'authenticated', resolve,
    [fixture.booking, null, null, null]));
  const nonAdmin = await fails(() => as(fixture.customer, 'authenticated', resolve,
    [fixture.booking, 'partial_refund', 100, 'valid note']));
  const afterRejectedCalls = await snapshot(fixture.booking);
  const otherState = await createDisputeFixture(13, { disputed: false });
  const nonDisputed = await fails(() => as(otherState.admin, 'authenticated', resolve,
    [otherState.booking, 'partial_refund', 100, 'valid note']));
  const afterNonDisputed = await snapshot(otherState.booking);
  check(Boolean(nullOutcome)
    && Boolean(nonAdmin)
    && afterRejectedCalls.booking_status === 'disputed'
    && afterRejectedCalls.refund_count === 0
    && afterRejectedCalls.audit_count === 0
    && Boolean(nonDisputed)
    && afterNonDisputed.booking_status === 'in_progress'
    && afterNonDisputed.refund_count === 0
    && afterNonDisputed.audit_count === 0,
  'null outcomes, unauthorized same-row resolution, and non-disputed rows reject without money or audit writes',
  { nullOutcome, nonAdmin, afterRejectedCalls, nonDisputed, afterNonDisputed });
});

await scenario('MN-OFF-SAFETY', async () => {
  const fixture = await createDisputeFixture(14);
  await db.query('update public.feature_flags set enabled = false');
  const flags = await one(`
    select count(*)::int as total, (count(*) filter (where public.feature_flags.enabled))::int as enabled
      from public.feature_flags
  `);
  const blankNote = await fails(() => as(fixture.admin, 'authenticated', resolve,
    [fixture.booking, 'partial_refund', 17600, '   ']));
  const before = await snapshot(fixture.booking);
  const validError = await fails(() => as(fixture.admin, 'authenticated', resolve,
    [fixture.booking, 'partial_refund', 17600, 'safe resolution']));
  const afterValid = await snapshot(fixture.booking);
  const repeat = await fails(() => as(fixture.admin, 'authenticated', resolve,
    [fixture.booking, 'partial_refund', 100, 'stale repeat']));
  const afterRepeat = await snapshot(fixture.booking);
  check(flags.total > 0
    && flags.enabled === 0
    && Boolean(blankNote)
    && before.booking_status === 'disputed'
    && before.refund_count === 0
    && validError === null
    && afterValid.refund_paise === 17600
    && afterValid.audit_count === 1
    && Boolean(repeat)
    && afterRepeat.refund_count === 1
    && afterRepeat.refund_paise === 17600
    && afterRepeat.audit_count === 1,
  'all feature switches off preserve partial-refund guards, valid safety resolution, and stale-repeat rejection',
  { flags, blankNote, before, validError, afterValid, repeat, afterRepeat });
});

finish();

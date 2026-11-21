import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const { ok, scenario, finish } = createHarness();
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
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

const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((file) => /^\d{4}[a-z]?_.*\.sql$/.test(file))
  .sort();
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
  await db.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [uid ?? '']);
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
  const packPackage = uuid(seed * 100 + 8);
  const city = `O32 MN02 City ${seed}`;

  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb),
           ($3::uuid, $4::text, '{}'::jsonb),
           ($5::uuid, $6::text, '{}'::jsonb)
  `, [customer, `+919900${String(seed).padStart(6, '0')}`,
    provider, `+918800${String(seed).padStart(6, '0')}`,
    admin, `+917700${String(seed).padStart(6, '0')}`]);
  await db.query(`
    insert into public.admins (user_id)
    values ($1::uuid)
  `, [admin]);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended, razorpay_account_id, jobs_completed
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.6, 16.5), 4326),
      'verified', now(), 'approved', true, false, false, $3::text, 0
    )
  `, [provider, city, `acc_o32_${seed}`]);
  await db.query(`
    insert into public.categories (
      id, slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::uuid, $2::text, $3::text, 'quote', true, 'time_based', '{}'::jsonb, 1,
      365, true, array['daily','alternate_days','weekly','monthly','custom']::text[], 0
    )
  `, [category, `o32-mn02-${seed}`, `O32 MN02 session ${seed}`]);
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
    ) values
      ($1::uuid, $3::uuid, 'Single session', '', 'fixed', 10000, 10000, 10000, 'session', 1, 1, 60, true),
      ($2::uuid, $3::uuid, 'Two-session pack', '', 'fixed', 20000, 20000, 20000, 'session', 2, 2, 60, true)
  `, [sessionPackage, packPackage, service]);
  await db.query(`
    insert into public.addresses (id, user_id, label, line1, city, lat, lng)
    values ($1::uuid, $2::uuid, 'Home', '1 O32 Test Road', $3::text, 16.5, 80.6)
  `, [address, customer, city]);
  return {
    seed, customer, provider, admin, category, service, address,
    sessionPackage, packPackage, city,
  };
}

async function createSession(fixture, suffix, { demo, pack = false }) {
  const booking = uuid(fixture.seed * 1000 + 100 + suffix);
  const packId = uuid(fixture.seed * 1000 + 200 + suffix);
  const packSession = uuid(fixture.seed * 1000 + 300 + suffix);
  const slot = `2027-02-${String(fixture.seed * 2 + suffix).padStart(2, '0')}T10:00:00Z`;
  const paymentRef = `${demo ? 'pay_demo_o32_' : 'pay_o32_live_'}${fixture.seed}_${suffix}`;

  if (pack) {
    await db.query(`
      insert into public.pack_purchases (
        id, customer_id, provider_id, provider_service_id, service_package_id,
        sessions_total, price, platform_fee, status, expires_at
      ) values (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        2, 20000, 4900, 'active', '2035-01-01T00:00:00Z'::timestamptz
      )
    `, [packId, fixture.customer, fixture.provider, fixture.service, fixture.packPackage]);
    await db.query(`
      insert into public.pack_sessions (id, pack_id, seq, allocated_amount, status)
      values ($1::uuid, $2::uuid, 1, 10000, 'allocated')
    `, [packSession, packId]);
  }

  await db.query(`
    insert into public.bookings (
      id, customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, service_window, status, visit_fee, platform_fee,
      total_amount, archetype, exclusive, session_duration_min, service_package_id,
      pack_purchase_id, pack_session_id, commission_bp_snapshot
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
      'O32 MN02 finalizer fixture', $7::timestamptz,
      tstzrange($7::timestamptz, $7::timestamptz + interval '1 hour', '[)'),
      'completion_requested', 0, 0, 10000, 'time_based', true, 60, $8::uuid,
      $9::uuid, $10::uuid, 1000
    )
  `, [booking, fixture.customer, fixture.provider, fixture.category, fixture.service,
    fixture.address, slot, pack ? fixture.packPackage : fixture.sessionPackage,
    pack ? packId : null, pack ? packSession : null]);
  if (pack) {
    await db.query(`
      update public.pack_sessions
         set booking_id = $1::uuid
       where id = $2::uuid
    `, [booking, packSession]);
  }

  let scheduleId = null;
  if (pack) {
    const paymentId = (await one(`
      insert into public.payments (
        pack_purchase_id, purpose, amount, status, razorpay_payment_id, paid_at
      ) values ($1::uuid, 'session', 24900, 'paid', $2::text, $3::timestamptz)
      returning id
    `, [packId, paymentRef, slot])).id;
    await db.query(`
      update public.pack_purchases
         set payment_id = $1::uuid
       where id = $2::uuid
    `, [paymentId, packId]);
    return { booking, paymentId, paymentRef, packId, packSession, slot };
  }

  scheduleId = (await one(`
    insert into public.payment_schedule (
      booking_id, seq, obligation_type, label, amount, due_rule, due_at, status
    ) values ($1::uuid, 1, 'service', 'Session service', 10000, 'at_booking', $2::timestamptz, 'paid')
    returning id
  `, [booking, slot])).id;
  const paymentId = (await one(`
    insert into public.payments (
      booking_id, schedule_id, purpose, amount, status, razorpay_payment_id, paid_at
    ) values ($1::uuid, $2::uuid, 'session', 10000, 'paid', $3::text, $4::timestamptz)
    returning id
  `, [booking, scheduleId, paymentRef, slot])).id;
  await db.query(`
    update public.payment_schedule
       set payment_id = $1::uuid
     where id = $2::uuid
  `, [paymentId, scheduleId]);
  return { booking, paymentId, paymentRef, scheduleId, slot };
}

async function finalize(fixture, session) {
  await as(null, 'service_role', `
    select public._finalize_session_completion($1::uuid, $2::uuid)
  `, [session.booking, fixture.customer]);
}

async function payoutDetails(booking) {
  const payout = await one(`
    select public.payouts.id, public.payouts.gross, public.payouts.commission,
           public.payouts.gst_on_commission, public.payouts.amount,
           public.payouts.status::text as status, public.bookings.status::text as booking_status,
           public.bookings.completed_at, public.bookings.commission as booking_commission,
           public.bookings.gst_on_commission as booking_gst, public.providers.jobs_completed
      from public.payouts
      join public.bookings on public.bookings.id = public.payouts.booking_id
      join public.providers on public.providers.id = public.bookings.provider_id
     where public.payouts.booking_id = $1::uuid
  `, [booking]);
  const transfers = await one(`
    select count(public.payout_transfers.id)::int as count,
           coalesce(sum(public.payout_transfers.amount), 0)::int as amount
      from public.payout_transfers
     where public.payout_transfers.payout_id = $1::uuid
  `, [payout.id]);
  return { payout, transfers };
}

await scenario('MN-DEMO-SESSION-ONESHOT', async () => {
  const fixture = await createActors(1);
  const session = await createSession(fixture, 1, { demo: true });
  await finalize(fixture, session);
  const actual = await payoutDetails(session.booking);
  check(actual.payout.status === 'demo'
    && actual.payout.gross === 10000
    && actual.payout.commission === 1000
    && actual.payout.gst_on_commission === 180
    && actual.payout.amount === 8820
    && actual.transfers.count === 0
    && actual.payout.booking_status === 'completed'
    && actual.payout.booking_commission === 1000
    && actual.payout.booking_gst === 180
    && actual.payout.jobs_completed === 1,
  'synthetic one-shot session records demo payout without transfer and still completes', actual);
});

await scenario('MN-DEMO-PACK-SESSION', async () => {
  const fixture = await createActors(2);
  const session = await createSession(fixture, 1, { demo: true, pack: true });
  await finalize(fixture, session);
  const actual = await payoutDetails(session.booking);
  const pack = await one(`
    select public.pack_sessions.status, public.pack_sessions.completed_at
      from public.pack_sessions
     where public.pack_sessions.id = $1::uuid
  `, [session.packSession]);
  check(actual.payout.status === 'demo'
    && actual.payout.gross === 10000
    && actual.payout.commission === 1000
    && actual.payout.gst_on_commission === 180
    && actual.payout.amount === 8820
    && actual.transfers.count === 0
    && actual.payout.booking_status === 'completed'
    && actual.payout.jobs_completed === 1
    && pack.status === 'completed'
    && Boolean(pack.completed_at),
  'synthetic pack session records demo payout without transfer and completes its ledger row',
  { actual, pack });
});

await scenario('MN-LIVE-SESSION-PAISE', async () => {
  const fixture = await createActors(3);
  const session = await createSession(fixture, 1, { demo: false });
  await finalize(fixture, session);
  const actual = await payoutDetails(session.booking);
  const transfer = await one(`
    select public.payout_transfers.source_payment_id, public.payout_transfers.amount
      from public.payout_transfers
     where public.payout_transfers.payout_id = $1::uuid
  `, [actual.payout.id]);
  check(actual.payout.status === 'pending'
    && actual.payout.gross === 10000
    && actual.payout.commission === 1000
    && actual.payout.gst_on_commission === 180
    && actual.payout.amount === 8820
    && actual.transfers.count === 1
    && actual.transfers.amount === 8820
    && transfer.source_payment_id === session.paymentId
    && transfer.amount === 8820
    && actual.payout.booking_status === 'completed'
    && actual.payout.jobs_completed === 1,
  'live session records pending payout and one matching 8,820-paise transfer', { actual, transfer });
});

await scenario('MN-OFF-SAFETY', async () => {
  const fixture = await createActors(4);
  const demo = await createSession(fixture, 1, { demo: true });
  const live = await createSession(fixture, 2, { demo: false });
  const statementFlagBefore = await one(`
    select public.feature_flags.enabled
      from public.feature_flags
     where public.feature_flags.key = $1::text
  `, ['provider_earnings_statement']);
  await finalize(fixture, demo);
  await finalize(fixture, live);
  const demoPayout = await payoutDetails(demo.booking);
  const livePayout = await payoutDetails(live.booking);
  const providerRowsWhileOff = await as(fixture.provider, 'authenticated', `
    select public.payouts.booking_id, public.payouts.gross, public.payouts.commission,
           public.payouts.gst_on_commission, public.payouts.amount, public.payouts.status::text as status
      from public.payouts
     where public.payouts.provider_id = auth.uid()
     order by public.payouts.booking_id
  `);
  await db.query(`
    update public.feature_flags
       set enabled = true
     where key = $1::text
  `, ['provider_earnings_statement']);
  const statementRows = await as(fixture.provider, 'authenticated', `
    select statement.payout_id, statement.booking_id, statement.gross, statement.commission,
           statement.gst_on_commission, statement.net, statement.status::text as status
      from public.get_provider_statement($1::date, $2::date) as statement
     order by statement.status::text, statement.booking_id
  `, ['2026-01-01', '2099-12-31']);
  const totals = statementRows.reduce((sum, row) => {
    if (row.status === 'demo') sum.demo += row.net;
    else sum.financial += row.net;
    return sum;
  }, { demo: 0, financial: 0 });
  await db.query(`
    update public.feature_flags
       set enabled = false
     where key = $1::text
  `, ['provider_earnings_statement']);

  await db.query(`
    update public.payouts
       set status = 'pending', release_after = now() - interval '1 minute'
     where booking_id = $1::uuid
  `, [demo.booking]);
  const legacyDemoTransfer = (await one(`
    insert into public.payout_transfers (
      payout_id, source_payment_id, amount, rail, release_after
    ) values (
      $1::uuid, $2::uuid, 8820, 'route', now() - interval '1 minute'
    )
    returning id
  `, [demoPayout.payout.id, demo.paymentId])).id;
  const claimed = await as(null, 'service_role', `
    select claim.transfer_id
      from public.claim_due_transfers($1::int) as claim
  `, [20]);
  const transferAfterClaim = await one(`
    select public.payout_transfers.status::text as status
      from public.payout_transfers
     where public.payout_transfers.id = $1::uuid
  `, [legacyDemoTransfer]);

  const customerError = await fails(() => as(fixture.customer, 'authenticated', `
    select public._finalize_session_completion($1::uuid, $2::uuid)
  `, [live.booking, fixture.customer]));
  const providerError = await fails(() => as(fixture.provider, 'authenticated', `
    select public._finalize_session_completion($1::uuid, $2::uuid)
  `, [live.booking, fixture.provider]));
  const adminError = await fails(() => as(fixture.admin, 'authenticated', `
    select public._finalize_session_completion($1::uuid, $2::uuid)
  `, [live.booking, fixture.admin]));
  const statementAllowed = await one(`
    select has_function_privilege(
      'authenticated', 'public._finalize_session_completion(uuid, uuid)', 'EXECUTE'
    ) as allowed
  `);
  const actual = {
    statementFlagBefore: statementFlagBefore.enabled,
    demoPayout,
    livePayout,
    providerRowsWhileOff,
    statementRows,
    totals,
    claimed,
    transferAfterClaim,
    customerError,
    providerError,
    adminError,
    statementAllowed: statementAllowed.allowed,
  };
  check(statementFlagBefore.enabled === false
    && demoPayout.payout.status === 'demo'
    && livePayout.payout.status === 'pending'
    && providerRowsWhileOff.length === 2
    && providerRowsWhileOff.some((row) => row.status === 'demo'
      && row.gross === 10000 && row.commission === 1000
      && row.gst_on_commission === 180 && row.amount === 8820)
    && statementRows.length === 2
    && statementRows.some((row) => row.status === 'demo'
      && row.gross === 10000 && row.commission === 1000
      && row.gst_on_commission === 180 && row.net === 8820)
    && statementRows.some((row) => row.status === 'pending'
      && row.gross === 10000 && row.commission === 1000
      && row.gst_on_commission === 180 && row.net === 8820)
    && totals.demo === 8820
    && totals.financial === 8820
    && claimed.length === 0
    && transferAfterClaim.status === 'pending'
    && /permission denied/i.test(customerError ?? '')
    && /permission denied/i.test(providerError ?? '')
    && /permission denied/i.test(adminError ?? '')
    && statementAllowed.allowed === false,
  'classification and provider readability hold with statement OFF; demo claims and direct callers are blocked',
  actual);
});

finish();

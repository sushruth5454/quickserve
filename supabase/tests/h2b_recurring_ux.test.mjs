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
  grant select, insert, delete on storage.objects to anon, authenticated, service_role;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

for (const file of fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}[a-z]?_.*\.sql$/.test(name))
  .sort()) {
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

function uuid(value) {
  return `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;
}

async function createPlanFixture(index, serviceDate, startTime, planAcceptance = false, archetype = 'time_based') {
  const customer = uuid(index * 10 + 1);
  const provider = uuid(index * 10 + 2);
  const city = `H2b City ${index}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb), ($3::uuid, $4::text, '{}'::jsonb)
  `, [customer, `+91990000${String(index).padStart(4, '0')}`, provider, `+91880000${String(index).padStart(4, '0')}`]);
  await db.query(`update public.profiles set full_name=$1::text where id in ($2::uuid,$3::uuid)`,
    [`H2b Person ${index}`, customer, provider]);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended, created_at
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.60,16.50),4326),
      'verified', now(), 'approved', true, false, false, '2025-01-01T00:00:00.000Z'::timestamptz
    )
  `, [provider, city]);
  await db.query(`
    update public.app_config
       set value=value || '{"time_based":true}'::jsonb
     where key='archetype_flags'
  `);
  await db.query(`
    update public.feature_flags
       set enabled=case
         when key='recurring_plan_acceptance' then $1::boolean
         when key in ('recurring_bookings','recurring_reminders') then true
         else enabled
       end
     where key in ('recurring_bookings','recurring_reminders','recurring_plan_acceptance')
  `, [planAcceptance]);
  const category = (await db.query(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::text, $2::text, 'quote', true, $3::text, '{}'::jsonb, 1, 365,
      true, array['custom']::text[], 0
    ) returning id
  `, [`h2b-recurring-${index}`, `H2b recurring service ${index}`, archetype])).rows[0].id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [category, city]);
  const service = (await db.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0, 60000, true)
    returning id
  `, [provider, category])).rows[0].id;
  const packageId = archetype === 'fixed'
    ? (await db.query(`
        insert into public.service_packages (
          provider_service_id, title, description, price_type, price, price_min, price_max,
          unit, qty_min, qty_max, duration_min, active
        ) values (
          $1::uuid, $2::text, '', 'fixed', 120000, 120000, 120000,
          'visit', 1, 1, 60, true
        ) returning id
      `, [service, `H2b fixed package ${index}`])).rows[0].id
    : null;
  const address = (await db.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Home', $2::text, $3::text, 16.50, 80.60)
    returning id
  `, [customer, `H2b address ${index}`, city])).rows[0].id;
  const input = {
    provider_service_id: service,
    archetype,
    package_id: packageId,
    frequency: 'custom',
    interval_count: 1,
    weekdays: [],
    month_day: null,
    custom_dates: [serviceDate],
    start_date: serviceDate,
    end_date: null,
    max_occurrences: 1,
    start_time: startTime,
    duration_min: archetype === 'time_based' ? 60 : null,
    package_qty: archetype === 'fixed' ? 1 : null,
    billing_frequency: 'per_visit',
    address_id: address,
    description: `H2b visit ${index}`,
  };
  const planId = (await as(customer, 'authenticated',
    `select public.create_recurring_plan($1::jsonb) as id`, [JSON.stringify(input)]))[0].id;
  const bookingId = (await db.query(`
    select b.id
      from public.bookings b
     where b.recurring_schedule_id=$1::uuid
     order by b.scheduled_at
     limit 1
  `, [planId])).rows[0]?.id ?? null;
  return { customer, provider, planId, bookingId };
}

async function markVisitDue(bookingId) {
  await db.query(`
    update public.payment_schedule
       set due_at=$2::timestamptz
     where booking_id=$1::uuid and status in ('due','upcoming')
  `, [bookingId, '2026-11-17T00:00:00.000Z']);
}

await scenario('payment-due notice is queued once per visit', async () => {
  const fixture = await createPlanFixture(11, '2026-12-10', '10:00');
  await markVisitDue(fixture.bookingId);
  const first = (await as(null, 'service_role', `select public.queue_recurring_reminders() as queued`))[0];
  const second = (await as(null, 'service_role', `select public.queue_recurring_reminders() as queued`))[0];
  const rows = (await db.query(`
    select n.user_id, n.kind, n.booking_id, n.collapse_key, n.data, n.count
      from public.notifications n
     where n.user_id=$1::uuid
       and n.kind='recurring_visit_payment_due'
       and n.booking_id=$2::uuid
  `, [fixture.customer, fixture.bookingId])).rows;
  ok(first.queued === 1 && second.queued === 0 && rows.length === 1
    && rows[0].collapse_key === `recurring-pay:${fixture.bookingId}`
    && rows[0].data.recurring_schedule_id === fixture.planId,
    `[RP-41] a due notice is idempotent and uses the visit collapse key: ${JSON.stringify({ first, second, rows })}`);
});

await scenario('payment-due notices stay off when their child flag is disabled', async () => {
  const fixture = await createPlanFixture(12, '2026-12-11', '12:00');
  await markVisitDue(fixture.bookingId);
  await db.query(`update public.feature_flags set enabled=false where key='recurring_reminders'`);
  const result = (await as(null, 'service_role', `select public.queue_recurring_reminders() as queued`))[0];
  const rows = (await db.query(`
    select n.id, n.kind
      from public.notifications n
     where n.user_id=$1::uuid and n.kind='recurring_visit_payment_due'
       and n.booking_id=$2::uuid
  `, [fixture.customer, fixture.bookingId])).rows;
  ok(result.queued === 0 && rows.length === 0,
    `[RP-41] reminder flag-off leaves no due notice: ${JSON.stringify({ result, rows })}`);
});

await scenario('payment-due notices fail closed when the recurring parent flag is disabled', async () => {
  const fixture = await createPlanFixture(13, '2026-12-12', '14:00');
  await markVisitDue(fixture.bookingId);
  await db.query(`update public.feature_flags set enabled=true where key='recurring_reminders'`);
  await db.query(`update public.feature_flags set enabled=false where key='recurring_bookings'`);
  const result = (await as(null, 'service_role', `select public.queue_recurring_reminders() as queued`))[0];
  const rows = (await db.query(`
    select n.id, n.kind
      from public.notifications n
     where n.user_id=$1::uuid and n.kind='recurring_visit_payment_due'
       and n.booking_id=$2::uuid
  `, [fixture.customer, fixture.bookingId])).rows;
  ok(result.queued === 0 && rows.length === 0,
    `[RP-41] parent-off/child-on blocks reminder delivery: ${JSON.stringify({ result, rows })}`);
});

await scenario('recurring notifications carry recipient-specific deep links', async () => {
  const fixture = await createPlanFixture(14, '2026-12-13', '16:00', true);
  const providerPayload = (await as(fixture.provider, 'authenticated',
    `select public.get_recurring_plan($1::uuid) as payload`, [fixture.planId]))[0].payload;
  const customerPayload = (await as(fixture.customer, 'authenticated',
    `select public.get_recurring_plan($1::uuid) as payload`, [fixture.planId]))[0].payload;
  const requested = (await db.query(`
    select n.user_id, n.kind, n.collapse_key, n.data
      from public.notifications n
     where n.user_id=$1::uuid and n.kind='recurring_plan_requested'
       and n.data->>'recurring_schedule_id'=$2::text
  `, [fixture.provider, fixture.planId])).rows[0];
  await as(fixture.provider, 'authenticated', `
    select public.respond_recurring_plan($1::uuid, $2::boolean, $3::text)
  `, [fixture.planId, true, null]);
  const accepted = (await db.query(`
    select n.user_id, n.kind, n.collapse_key, n.data
      from public.notifications n
     where n.user_id=$1::uuid and n.kind='recurring_plan_accepted'
       and n.data->>'recurring_schedule_id'=$2::text
  `, [fixture.customer, fixture.planId])).rows[0];
  ok(requested?.data?.url === `/recurring/provider/${fixture.planId}`
    && accepted?.data?.url === `/recurring/${fixture.planId}`
    && requested?.collapse_key === `recurring-plan-request:${fixture.planId}`
    && providerPayload.plan.per_visit_paise === 60000
    && providerPayload.plan.net_estimate_paise === 54336
    && customerPayload.plan.net_estimate_paise === null,
    `[WS2-T09/WS7-T02] recipient URLs and provider estimate are correct: ${JSON.stringify({ requested, accepted, providerPlan: providerPayload.plan, customerPlan: customerPayload.plan })}`);
});

await scenario('fixed recurring provider net estimate uses fixed commission', async () => {
  const fixture = await createPlanFixture(15, '2026-12-14', '10:00', true, 'fixed');
  const payload = (await as(fixture.provider, 'authenticated',
    `select public.get_recurring_plan($1::uuid) as payload`, [fixture.planId]))[0].payload;
  ok(payload.plan.per_visit_paise === 120000 && payload.plan.net_estimate_paise === 103008,
    `[WS2-T09] fixed provider estimate uses exact paise: ${JSON.stringify(payload.plan)}`);
});

finish();

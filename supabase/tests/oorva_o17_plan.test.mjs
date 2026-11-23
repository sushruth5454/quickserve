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
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text
  );
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

let fixtureNumber = 0;
const uuid = (number) => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
const dateEpoch = (value) => new Date(value).getTime();

async function createFixture(label, serviceDate, planAcceptance = false) {
  const index = ++fixtureNumber;
  const customer = uuid(index * 10 + 1);
  const provider = uuid(index * 10 + 2);
  const manager = uuid(index * 10 + 3);
  const staff = uuid(index * 10 + 4);
  const city = `O17 ${label} ${index}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values
      ($1::uuid, $2::text, '{}'::jsonb),
      ($3::uuid, $4::text, '{}'::jsonb),
      ($5::uuid, $6::text, '{}'::jsonb),
      ($7::uuid, $8::text, '{}'::jsonb)
  `, [
    customer, `+91990000${String(index).padStart(4, '0')}`,
    provider, `+91880000${String(index).padStart(4, '0')}`,
    manager, `+91770000${String(index).padStart(4, '0')}`,
    staff, `+91660000${String(index).padStart(4, '0')}`,
  ]);
  await db.query(`
    update public.profiles set full_name=$1::text where id in ($2::uuid,$3::uuid,$4::uuid)
  `, [`O17 ${label} ${index}`, customer, provider, manager]);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended, created_at
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.60,16.50),4326),
      'verified', now(), 'approved', true, false, false, '2025-01-01T00:00:00Z'::timestamptz
    )
  `, [provider, city]);
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active) values
      ($1::uuid, $2::uuid, 'manager', true),
      ($1::uuid, $3::uuid, 'staff', true)
  `, [provider, manager, staff]);
  await db.query(`
    update public.app_config
       set value=value || '{"time_based":true}'::jsonb
     where key='archetype_flags'
  `);
  await db.query(`
    update public.feature_flags
       set enabled=case
         when key='recurring_plan_acceptance' then $1::boolean
         when key in ('recurring_bookings','recurring_skip_pause','recurring_reschedule') then true
         when key='merchant_staff' then true
         else enabled
       end
     where key in ('recurring_bookings','recurring_skip_pause','recurring_reschedule','recurring_plan_acceptance')
        or key='merchant_staff'
  `, [planAcceptance]);

  const category = (await db.query(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::text, $2::text, 'quote', true, 'time_based', '{}'::jsonb, 1, 365,
      true, array['custom']::text[], 0
    ) returning id
  `, [`o17-${label.toLowerCase()}-${index}`, `O17 ${label} ${index}`])).rows[0].id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [category, city]);
  const service = (await db.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0, 60000, true)
    returning id
  `, [provider, category])).rows[0].id;
  await db.query(`
    insert into public.provider_availability (provider_id, weekday, start_time, end_time)
    select $1::uuid, d, time '00:00', time '23:59' from generate_series(0, 6) d
  `, [provider]);
  const addressLine = `O17 private address ${index}`;
  const address = (await db.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Home', $2::text, $3::text, 16.50, 80.60)
    returning id
  `, [customer, addressLine, city])).rows[0].id;
  const input = {
    provider_service_id: service,
    archetype: 'time_based',
    package_id: null,
    frequency: 'custom',
    interval_count: 1,
    weekdays: [],
    month_day: null,
    custom_dates: [serviceDate],
    start_date: serviceDate,
    end_date: null,
    max_occurrences: 1,
    start_time: '10:00',
    duration_min: 60,
    package_qty: null,
    billing_frequency: 'per_visit',
    address_id: address,
    description: `O17 isolated visit ${index}`,
  };
  const planId = (await as(
    customer,
    'authenticated',
    `select public.create_recurring_plan($1::jsonb) as id`,
    [JSON.stringify(input)],
  ))[0].id;
  const bookingId = (await db.query(`
    select b.id
      from public.bookings b
     where b.recurring_schedule_id=$1::uuid
     order by b.scheduled_at, b.id
     limit 1
  `, [planId])).rows[0]?.id ?? null;
  if (!planAcceptance && !bookingId) {
    throw new Error(`expected a materialized O17 occurrence: ${JSON.stringify({ planId, bookingId, input })}`);
  }
  return { customer, provider, manager, staff, service, address, addressLine, input, planId, bookingId };
}

await scenario('SV-RECURRING-DEADLINE-DEFAULTS', async () => {
  const fixture = await createFixture('default-payment-window', '2026-12-10', false);
  const quote = (await as(
    fixture.customer,
    'authenticated',
    `select public.quote_recurring_plan($1::jsonb) as value`,
    [JSON.stringify(fixture.input)],
  ))[0].value;
  const expectedWindow = {
    due_hours_before: 48,
    grace_hours: 24,
    release_cutoff_minutes_before_visit: 30,
  };
  ok(quote.payment_window?.due_hours_before === expectedWindow.due_hours_before
    && quote.payment_window?.grace_hours === expectedWindow.grace_hours
    && quote.payment_window?.release_cutoff_minutes_before_visit === expectedWindow.release_cutoff_minutes_before_visit
    && Object.keys(quote.payment_window ?? {}).sort().join('|') === Object.keys(expectedWindow).sort().join('|'),
    `[SV-RECURRING-DEADLINE-DEFAULTS] default payment window is server-projected: ${JSON.stringify({ quote, expectedWindow })}`);
});

await scenario('SV-RECURRING-DEADLINE-LATE-GENERATION', async () => {
  await db.query(`
    update public.app_config
       set value=value || '{"payment_due_hours_before":720,"billing_grace_hours":8}'::jsonb
     where key='recurring_rules'
  `);
  const fixture = await createFixture('late-generated-occurrence', '2026-12-17', false);
  const occurrence = (await as(
    fixture.customer,
    'authenticated',
    `select public.get_recurring_plan($1::uuid) as value`,
    [fixture.planId],
  ))[0].value.occurrences.find((item) => item.id === fixture.bookingId);
  const rows = (await db.query(`
    select amount, due_at, status, created_at
      from public.payment_schedule
     where booking_id=$1::uuid and status in ('due','upcoming')
     order by seq, id
  `, [fixture.bookingId])).rows;
  const dueRows = rows.filter((row) => row.status === 'due');
  const scheduledAt = Date.parse(occurrence.scheduled_at);
  const expectedDueAt = Math.min(...dueRows.map((row) => dateEpoch(row.due_at)));
  const clampedAtCreation = dueRows.length > 0 &&
    dueRows.every((row) => dateEpoch(row.due_at) === dateEpoch(row.created_at));
  const expectedExpiry = Math.max(...rows.map((row) =>
    Math.min(
      dateEpoch(row.due_at) + 8 * 60 * 60 * 1000,
      scheduledAt - 30 * 60 * 1000,
    ),
  ));
  const checks = {
    paymentRemainsOpen: occurrence.can_pay === true,
    projectedDueMatchesObligations: Date.parse(occurrence.payment_due_at) === expectedDueAt,
    leadWindowWasClampedAtCreation: expectedDueAt > scheduledAt - 720 * 60 * 60 * 1000 && clampedAtCreation,
    projectedExpiryMatchesObligations: Date.parse(occurrence.payment_expires_at) === expectedExpiry,
  };
  ok(Object.values(checks).every(Boolean),
    `[SV-RECURRING-DEADLINE-LATE-GENERATION] late-created due rows use the clamped server deadline and expiry without a due_at opening gate: ${JSON.stringify({ checks, projectedDueMs: Date.parse(occurrence.payment_due_at), expectedDueAt, projectedExpiryMs: Date.parse(occurrence.payment_expires_at), expectedExpiry, rows: rows.map((row) => ({ due_at: row.due_at, created_at: row.created_at, status: row.status })) })}`);
});

await scenario('SV-RECURRING-DEADLINE-01 and SV-RECURRING-PRIVACY-03', async () => {
  await db.query(`
    update public.app_config
       set value=value || '{"payment_due_hours_before":36,"billing_grace_hours":8}'::jsonb
     where key='recurring_rules'
  `);
  const fixture = await createFixture('plan-acceptance-privacy', '2026-12-12', true);
  const quote = (await as(
    fixture.customer,
    'authenticated',
    `select public.quote_recurring_plan($1::jsonb) as value`,
    [JSON.stringify(fixture.input)],
  ))[0].value;
  const customerPayload = (await as(
    fixture.customer,
    'authenticated',
    `select public.get_recurring_plan($1::uuid) as value`,
    [fixture.planId],
  ))[0].value;
  const providerPayload = (await as(
    fixture.manager,
    'authenticated',
    `select public.get_recurring_plan($1::uuid) as value`,
    [fixture.planId],
  ))[0].value;
  const expectedWindow = {
    due_hours_before: 36,
    grace_hours: 8,
    release_cutoff_minutes_before_visit: 30,
  };
  ok(quote.acceptance_mode === 'plan'
    && quote.payment_window?.due_hours_before === expectedWindow.due_hours_before
    && quote.payment_window?.grace_hours === expectedWindow.grace_hours
    && quote.payment_window?.release_cutoff_minutes_before_visit === expectedWindow.release_cutoff_minutes_before_visit
    && Object.keys(quote.payment_window ?? {}).sort().join('|') === Object.keys(expectedWindow).sort().join('|')
    && !Object.prototype.hasOwnProperty.call(quote, 'recurring_rules'),
    `[SV-RECURRING-DEADLINE-01] quote returns only approved acceptance/payment summary: ${JSON.stringify({ quote, expectedWindow })}`);
  ok(customerPayload.plan.address_line === fixture.addressLine
    && customerPayload.plan.net_estimate_paise === null
    && typeof providerPayload.plan.per_visit_paise === 'number'
    && customerPayload.plan.per_visit_paise === providerPayload.plan.per_visit_paise
    && typeof providerPayload.plan.net_estimate_paise === 'number'
    && providerPayload.plan.address_line === null
    && providerPayload.plan.lat === null
    && providerPayload.plan.lng === null,
    `[SV-RECURRING-PRIVACY-03] customer address is retained, provider pending address stays masked, and net estimate is not sent to customer: ${JSON.stringify({ customerPlan: customerPayload.plan, providerPlan: providerPayload.plan })}`);
  ok(customerPayload.plan.capabilities.can_pause === false
    && providerPayload.plan.capabilities.can_cancel === false,
    `[SV-PLAN-CAPABILITY-PARITY-01] pending plan does not expose Pause and provider cannot cancel: ${JSON.stringify({ customerCapabilities: customerPayload.plan.capabilities, providerCapabilities: providerPayload.plan.capabilities })}`);
});

await scenario('SV-RECURRING-DEADLINE-02 and SV-PLAN-CAPABILITY-PARITY-01', async () => {
  await db.query(`
    update public.app_config
       set value=value || '{"payment_due_hours_before":36,"billing_grace_hours":8}'::jsonb
     where key='recurring_rules'
  `);
  const fixture = await createFixture('occurrence-payment-window', '2026-12-14', false);
  const initial = (await as(
    fixture.customer,
    'authenticated',
    `select public.get_recurring_plan($1::uuid) as value`,
    [fixture.planId],
  ))[0].value;
  const initialOccurrence = initial.occurrences.find((item) => item.id === fixture.bookingId);
  const dueRows = (await db.query(`
    select id, amount, due_at, status
      from public.payment_schedule
     where booking_id=$1::uuid and status in ('due','upcoming')
     order by seq, id
  `, [fixture.bookingId])).rows;
  const dueRowsOnly = dueRows.filter((row) => row.status === 'due');
  const expectedAmount = dueRowsOnly.reduce((sum, row) => sum + row.amount, 0);
  const dueInstants = dueRowsOnly.map((row) => dateEpoch(row.due_at));
  const scheduledAt = Date.parse(initialOccurrence.scheduled_at);
  const expectedDueAt = Math.min(...dueInstants);
  const expectedExpiry = Math.max(...dueRows.map((row) =>
    Math.min(
      dateEpoch(row.due_at) + 8 * 60 * 60 * 1000,
      scheduledAt - 30 * 60 * 1000,
    ),
  ));
  const actualDeadline = {
    status: initialOccurrence.status,
    due_at: initialOccurrence.payment_due_at,
    expires_at: initialOccurrence.payment_expires_at,
    remaining_due_paise: initialOccurrence.remaining_due_paise,
    can_pay: initialOccurrence.can_pay,
  };
  ok(initialOccurrence.status === 'pending_payment'
    && dueRowsOnly.length > 0
    && dueInstants.every((instant) => instant > Date.now())
    && initialOccurrence.can_pay === true
    && initialOccurrence.can_skip === true
    && initialOccurrence.can_request_reschedule === true
    && initialOccurrence.remaining_due_paise === expectedAmount
    && Date.parse(initialOccurrence.payment_due_at) === expectedDueAt
    && Date.parse(initialOccurrence.payment_expires_at) === expectedExpiry,
    `[SV-RECURRING-DEADLINE-02] future due_at does not invent a payment gate; due amount and expiry match payment_schedule/expiry rules: ${JSON.stringify({ actualDeadline, dueRows, expectedAmount, expectedDueAt: new Date(expectedDueAt).toISOString(), expectedExpiry: new Date(expectedExpiry).toISOString() })}`);

  const customerCapabilities = initial.plan.capabilities;
  const providerPayload = (await as(
    fixture.manager,
    'authenticated',
    `select public.get_recurring_plan($1::uuid) as value`,
    [fixture.planId],
  ))[0].value;
  const staffPayload = (await as(
    fixture.staff,
    'authenticated',
    `select public.get_recurring_plan($1::uuid) as value`,
    [fixture.planId],
  ))[0].value;
  const providerOccurrence = providerPayload.occurrences.find((item) => item.id === fixture.bookingId);
  ok(customerCapabilities.can_cancel === true
    && customerCapabilities.can_pause === true
    && customerCapabilities.can_reschedule === true
    && providerPayload.plan.capabilities.can_cancel === false
    && providerPayload.plan.capabilities.can_reschedule === true
    && providerOccurrence.can_pay === false
    && providerOccurrence.remaining_due_paise === null
    && staffPayload.plan.capabilities.can_reschedule === false,
    `[SV-PLAN-CAPABILITY-PARITY-01] customer, manager, and staff capabilities are actor-scoped: ${JSON.stringify({ customerCapabilities, providerCapabilities: providerPayload.plan.capabilities, providerOccurrence, staffCapabilities: staffPayload.plan.capabilities })}`);

  const rescheduledAt = '2026-12-15T04:30:00.000Z';
  const changeId = (await as(
    fixture.customer,
    'authenticated',
    `select public.request_visit_reschedule($1::uuid, $2::timestamptz, $3::text) as id`,
    [fixture.bookingId, rescheduledAt, 'O17 isolated deadline refresh'],
  ))[0].id;
  await as(
    fixture.manager,
    'authenticated',
    `select public.respond_visit_reschedule($1::uuid, $2::boolean)`,
    [changeId, true],
  );
  const rescheduled = (await as(
    fixture.customer,
    'authenticated',
    `select public.get_recurring_plan($1::uuid) as value`,
    [fixture.planId],
  ))[0].value.occurrences.find((item) => item.id === fixture.bookingId);
  const rescheduledRows = (await db.query(`
    select amount, due_at, status
      from public.payment_schedule
     where booking_id=$1::uuid and status in ('due','upcoming')
     order by seq, id
  `, [fixture.bookingId])).rows;
  const rescheduledDueRows = rescheduledRows.filter((row) => row.status === 'due');
  const rescheduledScheduledAt = Date.parse(rescheduled.scheduled_at);
  const expectedRescheduledDueAt = Math.min(...rescheduledDueRows.map((row) => dateEpoch(row.due_at)));
  const expectedRescheduledExpiry = Math.max(...rescheduledRows.map((row) =>
    Math.min(
      dateEpoch(row.due_at) + 8 * 60 * 60 * 1000,
      rescheduledScheduledAt - 30 * 60 * 1000,
    ),
  ));
  ok(Date.parse(rescheduled.scheduled_at) === Date.parse(rescheduledAt)
    && Date.parse(rescheduled.payment_due_at) === expectedRescheduledDueAt
    && Date.parse(rescheduled.payment_expires_at) === expectedRescheduledExpiry,
    `[SV-RECURRING-DEADLINE-02] accepted reschedule refreshes current due and expiry projections: ${JSON.stringify({ rescheduled, rescheduledRows, expectedRescheduledDueAt: new Date(expectedRescheduledDueAt).toISOString(), expectedRescheduledExpiry: new Date(expectedRescheduledExpiry).toISOString() })}`);

  await db.query(`
    update public.app_config
       set value=value || '{"payment_due_hours_before":30,"billing_grace_hours":6}'::jsonb
     where key='recurring_rules'
  `);
  const configRefreshed = (await as(
    fixture.customer,
    'authenticated',
    `select public.get_recurring_plan($1::uuid) as value`,
    [fixture.planId],
  ))[0].value.occurrences.find((item) => item.id === fixture.bookingId);
  const configRows = (await db.query(`
    select amount, due_at, status
      from public.payment_schedule
     where booking_id=$1::uuid and status in ('due','upcoming')
     order by seq, id
  `, [fixture.bookingId])).rows;
  const configDueRows = configRows.filter((row) => row.status === 'due');
  const configScheduledAt = Date.parse(configRefreshed.scheduled_at);
  const expectedConfigDueAt = Math.min(...configDueRows.map((row) => dateEpoch(row.due_at)));
  const expectedConfigExpiry = Math.max(...configRows.map((row) =>
    Math.min(
      dateEpoch(row.due_at) + 6 * 60 * 60 * 1000,
      configScheduledAt - 30 * 60 * 1000,
    ),
  ));
  ok(Date.parse(configRefreshed.payment_due_at) === expectedConfigDueAt
    && Date.parse(configRefreshed.payment_expires_at) === expectedConfigExpiry,
    `[SV-RECURRING-DEADLINE-02] current config refreshes scheduled obligation deadline and grace expiry: ${JSON.stringify({ configRefreshed, configRows, expectedConfigDueAt: new Date(expectedConfigDueAt).toISOString(), expectedConfigExpiry: new Date(expectedConfigExpiry).toISOString() })}`);

  const firstDue = dueRowsOnly[0];
  await db.query(`update public.payment_schedule set status='paid' where id=$1::uuid`, [firstDue.id]);
  const partial = (await as(
    fixture.customer,
    'authenticated',
    `select public.get_recurring_plan($1::uuid) as value`,
    [fixture.planId],
  ))[0].value.occurrences.find((item) => item.id === fixture.bookingId);
  const remainingRows = (await db.query(`
    select amount, due_at
      from public.payment_schedule
     where booking_id=$1::uuid and status='due'
     order by seq, id
  `, [fixture.bookingId])).rows;
  const expectedRemaining = remainingRows.reduce((sum, row) => sum + row.amount, 0);
  ok(partial.can_pay === (expectedRemaining > 0)
    && partial.remaining_due_paise === expectedRemaining
    && (expectedRemaining === 0 || Date.parse(partial.payment_due_at) === Math.min(...remainingRows.map((row) => dateEpoch(row.due_at)))),
    `[SV-RECURRING-DEADLINE-02] paid obligations leave only the current due amount/deadline projected: ${JSON.stringify({ partial, remainingRows, expectedRemaining })}`);

  await db.query(`update public.payment_schedule set status='waived' where booking_id=$1::uuid and status='due'`, [fixture.bookingId]);
  const settled = (await as(
    fixture.customer,
    'authenticated',
    `select public.get_recurring_plan($1::uuid) as value`,
    [fixture.planId],
  ))[0].value.occurrences.find((item) => item.id === fixture.bookingId);
  ok(settled.remaining_due_paise === 0
    && settled.payment_due_at === null
    && settled.payment_expires_at === null
    && settled.can_pay === false,
    `[SV-RECURRING-DEADLINE-02] waived remaining obligations remove payment amount/window and payment capability: ${JSON.stringify({ settled })}`);

  await db.query(`update public.feature_flags set enabled=false where key='recurring_bookings'`);
  await db.query(`update public.feature_flags set enabled=true where key in ('recurring_skip_pause','recurring_reschedule')`);
  const parentOff = (await as(
    fixture.customer,
    'authenticated',
    `select public.get_recurring_plan($1::uuid) as value`,
    [fixture.planId],
  ))[0].value;
  const parentOffOccurrence = parentOff.occurrences.find((item) => item.id === fixture.bookingId);
  ok(parentOff.plan.capabilities.can_cancel === true
    && parentOff.plan.capabilities.can_pause === false
    && parentOff.plan.capabilities.can_reschedule === false
    && parentOffOccurrence.can_skip === false
    && parentOffOccurrence.can_request_reschedule === false,
    `[SV-PLAN-CAPABILITY-PARITY-01] child-on/parent-off hides new actions but retains customer cancellation: ${JSON.stringify({ capabilities: parentOff.plan.capabilities, occurrence: parentOffOccurrence })}`);
});

finish();
await db.close();

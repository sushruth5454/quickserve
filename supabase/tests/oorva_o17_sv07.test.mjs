import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

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
  '0057_recurring_plans_v2.sql', '0058_sports_payments.sql',
  '0059_admin_identity_hardening.sql', '0060a_demo_payout_status.sql',
  '0060b_demo_payout_isolation.sql',
]) {
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
await db.exec(migration('0061_h1_provider_cancellation_and_recurring_privacy.sql'));
await db.exec(migration('0094_o17_sv07_oorva.sql'));
await db.exec("set timezone = 'UTC'");

const { ok, scenario, finish } = createHarness();
await db.query(`
  update feature_flags set enabled = true
   where key in ('recurring_bookings', 'recurring_reschedule', 'merchant_staff')
`);
await db.query(`
  update app_config
     set value = value || '{"time_based":true,"fixed":true}'::jsonb
   where key = 'archetype_flags'
`);

let fixtureNumber = 0;
const uuid = (prefix, number) => `${prefix}0000-0000-0000-${String(number).padStart(12, '0')}`;
const newAt = '2027-10-16T10:00:00+05:30';

async function as(uid, role, sql, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [uid ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function failureOf(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error?.message ?? String(error);
  }
}

async function createFixture(label) {
  const number = ++fixtureNumber;
  const customer = uuid('10000000-', number);
  const provider = uuid('20000000-', number);
  const manager = uuid('30000000-', number);
  const staff = uuid('40000000-', number);
  const otherCustomer = uuid('50000000-', number);
  await db.query(`
    insert into auth.users (id) values
      ($1::uuid), ($2::uuid), ($3::uuid), ($4::uuid), ($5::uuid)
  `, [customer, provider, manager, staff, otherCustomer]);
  await db.query(`
    insert into providers (
      id, city, base_location, kyc_status, submitted_at, is_online, paused, suspended
    ) values (
      $1::uuid, $2::text,
      extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', now(), true, false, false
    )
  `, [provider, `SV07 ${label}`]);
  await db.query(`
    insert into business_members (owner_id, member_id, role, active) values
      ($1::uuid, $2::uuid, 'manager', true),
      ($1::uuid, $3::uuid, 'staff', true)
  `, [provider, manager, staff]);
  const category = (await db.query(`
    insert into categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::text, $2::text, 'quote', true, 'time_based', '{}'::jsonb, 1, 365,
      true, array['custom']::text[], 0
    ) returning id
  `, [`sv07-${number}`, `SV07 ${label}`])).rows[0].id;
  await db.query(`
    insert into category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [category, `SV07 ${label}`]);
  const service = (await db.query(`
    insert into provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0, 60000, true)
    returning id
  `, [provider, category])).rows[0].id;
  await db.query(`
    insert into provider_availability (provider_id, weekday, start_time, end_time)
    select $1::uuid, d, time '00:00', time '23:59' from generate_series(0, 6) d
  `, [provider]);
  const schedule = (await db.query(`
    insert into recurring_schedules (
      customer_id, provider_id, provider_service_id, frequency, weekdays, start_time, timezone,
      session_duration_min, payment_mode, address_line, city, lat, lng, description,
      starts_on, ends_on, status, custom_dates, max_occurrences, archetype,
      provider_acceptance, acceptance_mode, billing_frequency, plan_version
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'custom', array[]::smallint[], time '10:00',
      'Asia/Kolkata', 60, 'per_session', 'SV07 address', $4::text, 16.50, 80.60,
      $5::text, date '2027-10-15', date '2027-10-15', 'active',
      array[date '2027-10-15'], 1, 'time_based', 'accepted', 'occurrence',
      'per_visit', 'v2'
    ) returning id
  `, [customer, provider, service, `SV07 ${label}`, `SV07 ${label}`])).rows[0].id;
  const materialized = (await db.query(
    `select materialize_recurring_schedule($1::uuid, date '2027-10-15') created`,
    [schedule],
  )).rows[0].created;
  const bookingRows = (await db.query(`
    select id, status::text status, scheduled_at, service_window
      from bookings where recurring_schedule_id = $1::uuid
  `, [schedule])).rows;
  const unavailableRows = (await db.query(`
    select kind, reason from recurring_occurrence_changes
     where schedule_id = $1::uuid order by created_at, id
  `, [schedule])).rows;
  if (materialized !== 1 || bookingRows.length !== 1) {
    throw new Error(`expected one isolated recurring booking: ${JSON.stringify({ materialized, bookingRows, unavailableRows })}`);
  }
  return { customer, provider, manager, staff, otherCustomer, service, schedule, booking: bookingRows[0] };
}

async function request(fixture, requester = fixture.customer, requestedAt = newAt) {
  const rows = await as(
    requester,
    'authenticated',
    `select request_visit_reschedule($1::uuid, $2::timestamptz, $3::text) id`,
    [fixture.booking.id, requestedAt, 'SV07 isolated reschedule test'],
  );
  return rows[0].id;
}

async function state(bookingId) {
  return (await db.query(`
    select jsonb_build_object(
      'booking', (
        select jsonb_build_object(
          'id', id, 'status', status::text, 'scheduled_at', scheduled_at,
          'service_window', service_window::text
        ) from bookings where id = $1::uuid
      ),
      'due', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'seq', seq, 'amount', amount, 'due_at', due_at, 'status', status
        ) order by seq) from payment_schedule where booking_id = $1::uuid
      ), '[]'::jsonb),
      'ledger', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'schedule_id', schedule_id, 'booking_id', booking_id,
          'occurrence_date', occurrence_date, 'original_at', original_at,
          'kind', kind, 'new_at', new_at, 'actor_id', actor_id, 'reason', reason
        ) order by created_at, id)
          from recurring_occurrence_changes where booking_id = $1::uuid
      ), '[]'::jsonb)
    ) value
  `, [bookingId])).rows[0].value;
}

async function bookingAndDue(bookingId) {
  const value = await state(bookingId);
  return { booking: value.booking, due: value.due };
}

async function outcomes(bookingId) {
  return (await db.query(`
    select id, schedule_id, booking_id, occurrence_date, original_at, kind, new_at, actor_id
      from recurring_occurrence_changes
     where booking_id = $1::uuid and kind in ('rescheduled', 'reschedule_declined')
     order by created_at, id
  `, [bookingId])).rows;
}

await scenario('SV-RESCHEDULE-TERMINAL-01', async () => {
  for (const [index, terminalStatus] of ['cancelled', 'expired', 'in_progress'].entries()) {
    const fixture = await createFixture(`terminal-${index}`);
    const changeId = await request(fixture);
    if (terminalStatus === 'in_progress') {
      await db.query(`update bookings set status = 'accepted' where id = $1::uuid`, [fixture.booking.id]);
      await db.query(`update payment_schedule set status = 'paid' where booking_id = $1::uuid`, [fixture.booking.id]);
    }
    await db.query(`
      select public._set_status(
        $1::uuid, $2::booking_status, $3::uuid, $4::text
      )
    `, [
      fixture.booking.id,
      terminalStatus,
      terminalStatus === 'cancelled' ? fixture.customer : terminalStatus === 'in_progress' ? fixture.provider : null,
      `SV07 ${terminalStatus} transition`,
    ]);
    const beforeAccept = await state(fixture.booking.id);
    const acceptError = await failureOf(() => as(
      fixture.manager,
      'authenticated',
      `select respond_visit_reschedule($1::uuid, true)`,
      [changeId],
    ));
    const afterAccept = await state(fixture.booking.id);
    ok(/visit can no longer be rescheduled/i.test(acceptError ?? ''),
      `${terminalStatus} stale Accept is rejected: ${JSON.stringify({ acceptError, beforeAccept })}`);
    ok(JSON.stringify(beforeAccept) === JSON.stringify(afterAccept),
      `${terminalStatus} stale Accept preserves booking, due rows, and change ledger: ${JSON.stringify({ beforeAccept, afterAccept })}`);

    const declineError = await failureOf(() => as(
      fixture.manager,
      'authenticated',
      `select respond_visit_reschedule($1::uuid, false)`,
      [changeId],
    ));
    const declineState = await bookingAndDue(fixture.booking.id);
    const declineOutcomes = await outcomes(fixture.booking.id);
    ok(!declineError && declineOutcomes.length === 1 && declineOutcomes[0].kind === 'reschedule_declined'
      && declineState.booking.scheduled_at === beforeAccept.booking.scheduled_at,
    `${terminalStatus} decline remains safe without scheduling the visit: ${JSON.stringify({ declineError, declineState, declineOutcomes })}`);
    const beforeDuplicateDecline = await state(fixture.booking.id);
    const duplicateError = await failureOf(() => as(
      fixture.manager,
      'authenticated',
      `select respond_visit_reschedule($1::uuid, false)`,
      [changeId],
    ));
    const afterDuplicateDecline = await state(fixture.booking.id);
    ok(!duplicateError && JSON.stringify(beforeDuplicateDecline) === JSON.stringify(afterDuplicateDecline),
      `${terminalStatus} duplicate decline is an idempotent read: ${JSON.stringify({ duplicateError, beforeDuplicateDecline, afterDuplicateDecline })}`);
  }
});

await scenario('SV-RESCHEDULE-ALLOW-02', async () => {
  const fixture = await createFixture('manager-accept');
  const changeId = await request(fixture);
  const selfAcceptError = await failureOf(() => as(
    fixture.customer,
    'authenticated',
    `select respond_visit_reschedule($1::uuid, true)`,
    [changeId],
  ));
  const staffAcceptError = await failureOf(() => as(
    fixture.staff,
    'authenticated',
    `select respond_visit_reschedule($1::uuid, true)`,
    [changeId],
  ));
  const beforeAccept = await state(fixture.booking.id);
  const beforeBooking = (await db.query(`
    select id, status::text status, scheduled_at,
           extract(epoch from upper(service_window) - lower(service_window))::int duration_seconds
      from bookings where id = $1::uuid
  `, [fixture.booking.id])).rows[0];
  const managerError = await failureOf(() => as(
    fixture.manager,
    'authenticated',
    `select respond_visit_reschedule($1::uuid, true)`,
    [changeId],
  ));
  const accepted = await db.query(`
    select id, status::text status, scheduled_at,
           extract(epoch from upper(service_window) - lower(service_window))::int duration_seconds
      from bookings where id = $1::uuid
  `, [fixture.booking.id]);
  const acceptedOutcomes = await outcomes(fixture.booking.id);
  const outcome = acceptedOutcomes[0];
  ok(/only the provider manager can respond/i.test(selfAcceptError ?? '')
    && /only the provider manager can respond/i.test(staffAcceptError ?? ''),
  `customer cannot accept own request and staff cannot substitute for manager: ${JSON.stringify({ selfAcceptError, staffAcceptError })}`);
  const acceptedRow = accepted.rows[0];
  ok(!managerError && acceptedRow?.id === fixture.booking.id
    && new Date(acceptedRow.scheduled_at).toISOString() === new Date(newAt).toISOString()
    && beforeAccept.booking.status === acceptedRow.status,
  `manager Accept moves the same booking: ${JSON.stringify({ managerError, before: beforeBooking, after: acceptedRow })}`);
  ok(acceptedRow?.duration_seconds === beforeBooking.duration_seconds,
    `manager Accept preserves service duration: ${JSON.stringify({ beforeSeconds: beforeBooking.duration_seconds, afterSeconds: acceptedRow?.duration_seconds })}`);
  const exactOutcome = acceptedOutcomes.length === 1 && outcome.kind === 'rescheduled'
    && outcome.schedule_id === fixture.schedule && outcome.booking_id === fixture.booking.id
    && new Date(outcome.original_at).toISOString() === new Date(beforeBooking.scheduled_at).toISOString()
    && new Date(outcome.new_at).toISOString() === new Date(newAt).toISOString()
    && outcome.actor_id === fixture.manager;
  ok(exactOutcome,
    `manager Accept records one outcome with exact identity: ${JSON.stringify({ outcomeCount: acceptedOutcomes.length, outcome, expected: { schedule: fixture.schedule, booking: fixture.booking.id, originalAt: beforeBooking.scheduled_at, newAt, actor: fixture.manager } })}`);

  for (const [index, legalStatus] of ['requested', 'accepted', 'confirmed'].entries()) {
    const legalFixture = await createFixture(`legal-${index}`);
    const legalChangeId = await request(legalFixture);
    await db.query(`update bookings set status = $2::booking_status where id = $1::uuid`, [
      legalFixture.booking.id,
      legalStatus,
    ]);
    const legalError = await failureOf(() => as(
      legalFixture.manager,
      'authenticated',
      `select respond_visit_reschedule($1::uuid, true)`,
      [legalChangeId],
    ));
    const legalState = await state(legalFixture.booking.id);
    const legalOutcomes = await outcomes(legalFixture.booking.id);
    ok(!legalError && legalState.booking.status === legalStatus && legalOutcomes.length === 1
      && legalOutcomes[0].kind === 'rescheduled',
    `Accept remains allowed for ${legalStatus}: ${JSON.stringify({ legalError, legalState, legalOutcomes })}`);
  }

  const providerRequestFixture = await createFixture('customer-accept');
  const providerRequestId = await request(providerRequestFixture, providerRequestFixture.manager);
  const customerAcceptError = await failureOf(() => as(
    providerRequestFixture.customer,
    'authenticated',
    `select respond_visit_reschedule($1::uuid, true)`,
    [providerRequestId],
  ));
  const customerRequestOutcomes = await outcomes(providerRequestFixture.booking.id);
  ok(!customerAcceptError && customerRequestOutcomes.length === 1
    && customerRequestOutcomes[0].kind === 'rescheduled'
    && customerRequestOutcomes[0].actor_id === providerRequestFixture.customer,
  `customer can accept the provider manager's request as the opposite party: ${JSON.stringify({ customerAcceptError, customerRequestOutcomes })}`);

  const conflictFixture = await createFixture('conflict');
  const conflictChangeId = await request(conflictFixture);
  const blockerId = (await db.query(`
    select _create_session_booking(
      $1::uuid, $2::uuid, null, $3::timestamptz, 60,
      'SV07 blocker', $4::text, 16.50, 80.60, 'SV07 conflict blocker'
    ) id
  `, [conflictFixture.otherCustomer, conflictFixture.service, newAt, `SV07 conflict`])).rows[0].id;
  const beforeConflictAccept = await state(conflictFixture.booking.id);
  const conflictError = await failureOf(() => as(
    conflictFixture.manager,
    'authenticated',
    `select respond_visit_reschedule($1::uuid, true)`,
    [conflictChangeId],
  ));
  const afterConflictAccept = await state(conflictFixture.booking.id);
  ok(!!conflictError && JSON.stringify(beforeConflictAccept) === JSON.stringify(afterConflictAccept),
    `response-time provider conflict blocks the move without changing booking or ledger: ${JSON.stringify({ blockerId, conflictError, beforeConflictAccept, afterConflictAccept })}`);

  const pausedFixture = await createFixture('paused');
  const pausedChangeId = await request(pausedFixture);
  await db.query(`update providers set paused = true where id = $1::uuid`, [pausedFixture.provider]);
  const beforePausedAccept = await state(pausedFixture.booking.id);
  const pausedError = await failureOf(() => as(
    pausedFixture.manager,
    'authenticated',
    `select respond_visit_reschedule($1::uuid, true)`,
    [pausedChangeId],
  ));
  const afterPausedAccept = await state(pausedFixture.booking.id);
  ok(!!pausedError && JSON.stringify(beforePausedAccept) === JSON.stringify(afterPausedAccept)
    && (await outcomes(pausedFixture.booking.id)).length === 0,
  `paused provider cannot accept a reschedule: ${JSON.stringify({ pausedError, beforePausedAccept, afterPausedAccept })}`);

  const cutoffFixture = await createFixture('cutoff');
  const cutoffChangeId = await request(cutoffFixture);
  await db.query(`
    update recurring_occurrence_changes
       set new_at = now() + interval '45 minutes'
     where id = $1::uuid
  `, [cutoffChangeId]);
  const beforeCutoffAccept = await state(cutoffFixture.booking.id);
  const cutoffError = await failureOf(() => as(
    cutoffFixture.manager,
    'authenticated',
    `select respond_visit_reschedule($1::uuid, true)`,
    [cutoffChangeId],
  ));
  const afterCutoffAccept = await state(cutoffFixture.booking.id);
  ok(/60 minutes/i.test(cutoffError ?? '')
    && JSON.stringify(beforeCutoffAccept) === JSON.stringify(afterCutoffAccept),
  `response rechecks the 60-minute lead time without changing state: ${JSON.stringify({ cutoffError, beforeCutoffAccept, afterCutoffAccept })}`);
});

await scenario('SV-RESCHEDULE-IDEMPOTENT-03', async () => {
  const fixture = await createFixture('idempotent');
  const changeId = await request(fixture);
  await as(fixture.manager, 'authenticated', `select respond_visit_reschedule($1::uuid, true)`, [changeId]);
  const afterFirst = await state(fixture.booking.id);
  const duplicateError = await failureOf(() => as(
    fixture.manager,
    'authenticated',
    `select respond_visit_reschedule($1::uuid, true)`,
    [changeId],
  ));
  const afterDuplicate = await state(fixture.booking.id);
  const exactOutcomes = await outcomes(fixture.booking.id);
  ok(!duplicateError && exactOutcomes.length === 1 && exactOutcomes[0].kind === 'rescheduled'
    && JSON.stringify(afterFirst) === JSON.stringify(afterDuplicate),
  `duplicate Accept is a no-op with one preserved outcome: ${JSON.stringify({ duplicateError, afterFirst, afterDuplicate, exactOutcomes })}`);
});

await scenario('SV-RESCHEDULE-RACE-04', async () => {
  const fixture = await createFixture('stale-original');
  const changeId = await request(fixture);
  await db.query(`
    update bookings
       set scheduled_at = $2::timestamptz,
           service_window = tstzrange($2::timestamptz, $2::timestamptz + interval '60 minutes', '[)')
     where id = $1::uuid
  `, [fixture.booking.id, '2027-10-17T10:00:00+05:30']);
  const beforeAccept = await state(fixture.booking.id);
  const acceptError = await failureOf(() => as(
    fixture.manager,
    'authenticated',
    `select respond_visit_reschedule($1::uuid, true)`,
    [changeId],
  ));
  const afterAccept = await state(fixture.booking.id);
  ok(/visit changed after the reschedule request/i.test(acceptError ?? '')
    && JSON.stringify(beforeAccept) === JSON.stringify(afterAccept),
  `changed original occurrence cannot be moved by a stale response: ${JSON.stringify({ acceptError, beforeAccept, afterAccept })}`);
});

finish();

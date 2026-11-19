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
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}[a-z]?_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 81)
  .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
const targetMigration = '0081_c2_creator_delivery.sql';
if (!migrationFiles.includes(targetMigration)) throw new Error(`missing C2 migration: ${targetMigration}`);

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
for (const file of migrationFiles) await db.exec(migration(file));
await db.exec("set timezone = 'UTC'");

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const json = (value) => typeof value === 'string' ? JSON.parse(value) : value;
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const check = (condition, label, actual) => ok(condition, `${label}; actual=${JSON.stringify(actual)}`);

async function as(uid, role, sql, params = []) {
  await db.exec('reset role');
  await db.query('select set_config($1::text, $2::text, false)', ['request.jwt.claim.sub', uid ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function fails(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error.message;
  }
}

async function createFixture(index) {
  const customer = uuid(index * 10 + 1);
  const provider = uuid(index * 10 + 2);
  const manager = uuid(index * 10 + 3);
  const city = `C2 Creator City ${index}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $4::text, '{}'::jsonb), ($2::uuid, $5::text, '{}'::jsonb),
           ($3::uuid, $6::text, '{}'::jsonb)`,
  [customer, provider, manager, `+9199300${String(index).padStart(4, '0')}`,
    `+9199301${String(index).padStart(4, '0')}`, `+9199302${String(index).padStart(4, '0')}`]);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended, created_at, jobs_completed
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', now(), 'approved', true, false, false, now() - interval '90 days', 0
    )`, [provider, city]);
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values ($1::uuid, $2::uuid, 'manager', true)`, [provider, manager]);
  const categoryId = (await one(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::text, $2::text, 'quote', true, 'proposal', '{}'::jsonb, 1, 365,
      true, array['daily','alternate_days','weekly','monthly','custom']::text[], 0
    ) returning id`, [`c2-creator-${index}`, `C2 creator ${index}`])).id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())`, [categoryId, city]);
  const serviceId = (await one(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0, 0, true) returning id`,
  [provider, categoryId])).id;
  const addressId = (await one(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Venue', 'C2 test address', $2::text, 16.50, 80.60) returning id`,
  [customer, city])).id;
  await db.query(`
    insert into public.provider_availability (provider_id, weekday, start_time, end_time)
    select $1::uuid, day, time '00:00', time '23:59'
      from generate_series(0, 6) day`, [provider]);
  await db.query(`
    insert into public.app_config (key, value)
    values ($1::text, $2::jsonb)
    on conflict (key) do update set value = public.app_config.value || excluded.value`,
  ['archetype_flags', '{"proposal":true}']);
  await db.query(`
    update public.feature_flags
       set enabled = case key
         when 'creator_delivery_deadline' then false
         when 'creator_revisions' then true
         else enabled
       end
     where key in ('creator_delivery_deadline', 'creator_revisions')`);
  return { customer, provider, manager, city, categoryId, serviceId, addressId };
}

async function createRequest(fixture, intake = { brief: 'A clean creator brief' }) {
  return (await as(fixture.customer, 'authenticated', `
    select public.create_service_request(
      $1::uuid, $2::text, $3::text, $4::timestamptz, $5::timestamptz,
      $6::jsonb, $7::int, $8::int, $9::uuid, $10::text, $11::uuid,
      $12::double precision, $13::double precision
    ) id`,
  [fixture.categoryId, fixture.city, 'Creator area', '2027-03-25T10:00:00Z',
    '2027-03-25T14:00:00Z', JSON.stringify(intake), 50000, 200000,
    fixture.addressId, 'Creator venue', fixture.provider, 16.50, 80.60]))[0].id;
}

async function sendProposal(fixture, requestId, {
  total = 100000,
  advance = Math.round(total * 0.25),
  deadline = null,
  revisions = null,
  note = 'A clear proposal',
  itemTitle = 'Creator service',
  deliverableSpec = 'Final edit',
} = {}) {
  const deliverables = [
    { type: 'final_delivery', qty: 1, spec: deliverableSpec },
    ...(revisions == null ? [] : [{ type: 'revisions', qty: revisions, spec: 'Revision rounds' }]),
  ];
  return (await as(fixture.provider, 'authenticated', `
    select public.send_proposal(
      $1::uuid, $2::jsonb, $3::jsonb, $4::timestamptz, $5::text, $6::jsonb, $7::timestamptz
    ) id`,
  [requestId,
    JSON.stringify([{ kind: 'package', title: itemTitle, qty: 1, unit: 'job', unit_price: total }]),
    JSON.stringify([
      { label: 'Booking advance', amount: advance, due_rule: 'at_booking' },
      { label: 'Delivery balance', amount: total - advance, due_rule: 'on_delivery' },
    ]),
    '2040-01-01T10:00:00Z', note, JSON.stringify(deliverables), deadline]))[0].id;
}

async function acceptProposal(fixture, proposalId) {
  return (await as(fixture.customer, 'authenticated', `
    select public.accept_proposal($1::uuid, $2::uuid) id`,
  [proposalId, fixture.addressId]))[0].id;
}

await scenario('creator deadline is default-off, ignored while off, required and copied while on', async () => {
  const fixture = await createFixture(1);
  const defaultFlag = await one(`
    select enabled from public.feature_flags where key = $1::text`, ['creator_delivery_deadline']);
  const offRequest = await createRequest(fixture);
  const offProposal = await sendProposal(fixture, offRequest, { deadline: '2027-03-24T10:00:00Z' });
  const ignored = await one(`
    select delivery_due_at from public.proposals where id = $1::uuid`, [offProposal]);

  await db.query(`
    update public.feature_flags set enabled = $1::boolean where key = $2::text`,
  [true, 'creator_delivery_deadline']);
  const onRequest = await createRequest(fixture);
  const missingError = await fails(() => sendProposal(fixture, onRequest));
  const pastError = await fails(() => sendProposal(fixture, onRequest, { deadline: '2026-01-01T10:00:00Z' }));
  const lateError = await fails(() => sendProposal(fixture, onRequest, { deadline: '2028-03-26T10:00:00Z' }));
  const proposalId = await sendProposal(fixture, onRequest, { deadline: '2027-03-24T10:00:00Z' });
  const bookingId = await acceptProposal(fixture, proposalId);
  const stored = await one(`
    select p.delivery_due_at as proposal_due, b.delivery_due_at as booking_due
      from public.proposals p join public.bookings b on b.proposal_id = p.id
     where p.id = $1::uuid`, [proposalId]);
  await db.query(`
    insert into public.app_config (key, value)
    values ($1::text, $2::jsonb)
    on conflict (key) do update set value = public.app_config.value || excluded.value`,
  ['archetype_flags', '{"proposal":false}']);
  const parentOffRequest = await createRequest(fixture);
  const parentOffProposal = await sendProposal(fixture, parentOffRequest, { deadline: '2027-03-24T10:00:00Z' });
  const parentOffStored = await one(`
    select delivery_due_at from public.proposals where id = $1::uuid`, [parentOffProposal]);
  const actual = { defaultFlag, ignored, missingError, pastError, lateError, stored, parentOffStored };
  check(defaultFlag.enabled === false
    && ignored.delivery_due_at === null
    && parentOffStored.delivery_due_at === null
    && /deliver-by date is required/i.test(missingError ?? '')
    && /future/i.test(pastError ?? '')
    && /365/i.test(lateError ?? '')
    && stored.proposal_due === '2027-03-24T10:00:00.000Z'
    && stored.booking_due === stored.proposal_due
    && !!bookingId,
  'deadline flag behavior and immutable booking copy are exact', actual);
});

await scenario('owner D2 revisions default to one and proposal terms override it', async () => {
  const defaultConfig = json((await one(`
    select value from public.app_config where key = $1::text`, ['creator'])).value);
  const anonymousConfigError = await fails(() => as(null, 'anon', `
    select public.get_creator_proposal_config()`));
  const revisionsFlag = await one(`
    select enabled from public.feature_flags where key = $1::text`, ['creator_revisions']);
  const defaultFixture = await createFixture(2);
  const defaultRequest = await createRequest(defaultFixture);
  const defaultProposal = await sendProposal(defaultFixture, defaultRequest);
  const defaultBooking = await acceptProposal(defaultFixture, defaultProposal);
  const defaultAllowed = (await one(`
    select revisions_allowed from public.bookings where id = $1::uuid`, [defaultBooking])).revisions_allowed;
  await db.query(`
    update public.bookings set status = 'completion_requested', delivery_status = 'submitted'
     where id = $1::uuid`, [defaultBooking]);
  await db.query(`
    update public.feature_flags set enabled = false where key = $1::text`,
  ['creator_revisions']);
  const featureOffError = await fails(() => as(defaultFixture.customer, 'authenticated', `
    select public.request_revision($1::uuid, $2::text)`,
  [defaultBooking, 'Please adjust the opening']));
  await db.query(`
    update public.feature_flags set enabled = true where key = $1::text`,
  ['creator_revisions']);

  const offeredFixture = await createFixture(3);
  const offeredRequest = await createRequest(offeredFixture);
  const invalidQtyError = await fails(() => sendProposal(offeredFixture, offeredRequest, { revisions: 11 }));
  const duplicateError = await fails(() => as(offeredFixture.provider, 'authenticated', `
    select public.send_proposal(
      $1::uuid, $2::jsonb, $3::jsonb, $4::timestamptz, $5::text, $6::jsonb, null::timestamptz
    )`,
  [offeredRequest,
    JSON.stringify([{ kind: 'package', title: 'Creator service', qty: 1, unit_price: 100000 }]),
    JSON.stringify([
      { label: 'Booking advance', amount: 25000, due_rule: 'at_booking' },
      { label: 'Delivery balance', amount: 75000, due_rule: 'on_delivery' },
    ]),
    '2040-01-01T10:00:00Z', 'A clear proposal',
    JSON.stringify([
      { type: 'revisions', qty: 1, spec: 'Revision rounds' },
      { type: 'revisions', qty: 2, spec: 'More revision rounds' },
    ])]));
  const offeredProposal = await sendProposal(offeredFixture, offeredRequest, { revisions: 3 });
  const offeredBooking = await acceptProposal(offeredFixture, offeredProposal);
  await db.query(`
    update public.bookings
       set status = 'completion_requested', delivery_status = 'submitted'
     where id = $1::uuid`, [offeredBooking]);
  const firstRevisionError = await fails(() => as(offeredFixture.customer, 'authenticated', `
    select public.request_revision($1::uuid, $2::text)`,
  [offeredBooking, 'Please adjust the opening']));
  await db.query(`
    update public.bookings
       set status = 'completion_requested', delivery_status = 'submitted'
     where id = $1::uuid`, [offeredBooking]);
  const secondRevisionError = await fails(() => as(offeredFixture.customer, 'authenticated', `
    select public.request_revision($1::uuid, $2::text)`,
  [offeredBooking, 'Please adjust it again']));
  const offeredAllowed = (await one(`
    select revisions_allowed from public.bookings where id = $1::uuid`, [offeredBooking])).revisions_allowed;
  const actual = {
    defaultConfig,
    anonymousConfigError,
    revisionsFlag,
    defaultAllowed,
    featureOffError,
    offeredAllowed,
    invalidQtyError,
    duplicateError,
    firstRevisionError,
    secondRevisionError,
  };
  check(defaultConfig.default_revisions === 1
    && /permission denied|not authenticated/i.test(anonymousConfigError ?? '')
    && revisionsFlag.enabled === true
    && defaultAllowed === 1
    && /creator revisions are not enabled/i.test(featureOffError ?? '')
    && offeredAllowed === 3
    && /revisions.*0.*10/i.test(invalidQtyError ?? '')
    && /at most one/i.test(duplicateError ?? '')
    && firstRevisionError === null
    && /no revisions remaining/i.test(secondRevisionError ?? ''),
  'default and offered revision counts are enforced, including the final allowed round', actual);
});

await scenario('overdue cancellation uses provider_fault for an exact full refund after the flag is turned off', async () => {
  const fixture = await createFixture(4);
  await db.query(`
    update public.feature_flags set enabled = true where key = $1::text`,
  ['creator_delivery_deadline']);
  const requestId = await createRequest(fixture);
  const proposalId = await sendProposal(fixture, requestId, { deadline: '2027-03-24T10:00:00Z' });
  const bookingId = await acceptProposal(fixture, proposalId);
  const quoteId = (await one(`
    select approved_quote_id from public.bookings where id = $1::uuid`, [bookingId])).approved_quote_id;
  await db.query(`
    update public.bookings
       set status = 'delivery_pending',
           delivery_status = 'pending',
           delivery_due_at = $1::timestamptz
     where id = $2::uuid`,
  ['2025-01-01T10:00:00Z', bookingId]);
  await db.query(`
    insert into public.payments (
      booking_id, quote_id, purpose, amount, status, razorpay_payment_id, paid_at
    ) values
      ($1::uuid, $2::uuid, 'advance'::public.payment_purpose, $3::int, 'paid', $4::text, $6::timestamptz),
      ($1::uuid, $2::uuid, 'platform_fee'::public.payment_purpose, $5::int, 'paid', $7::text, $6::timestamptz)`,
  [bookingId, quoteId, 25000, 'pay_c2_advance_4', 9900, '2026-11-18T10:00:00Z', 'pay_c2_fee_4']);
  await db.query(`
    update public.feature_flags set enabled = false where key = $1::text`,
  ['creator_delivery_deadline']);

  const cancelError = await fails(() => as(fixture.customer, 'authenticated', `
    select public.cancel_booking($1::uuid, null::text)`, [bookingId]));
  const actual = await one(`
    select b.status, b.refund_amount, b.cancellation_outcome ->> 'reason' as reason,
           b.cancellation_outcome ->> 'refund_amount' as outcome_refund,
           (select coalesce(sum(r.amount), 0)::int
              from public.refunds r join public.payments p on p.id = r.payment_id
             where p.booking_id = b.id) as queued_refund
      from public.bookings b where b.id = $1::uuid`, [bookingId]);
  check(cancelError === null
    && actual.status === 'cancelled'
    && actual.reason === 'provider_fault'
    && actual.refund_amount === 34900
    && Number(actual.outcome_refund) === 34900
    && actual.queued_refund === 34900,
  'stored overdue deadline remains cancelable with exact advance and platform-fee refunds', { cancelError, actual });
});

await scenario('delivery_pending cancellation rejects a not-yet-overdue booking', async () => {
  const fixture = await createFixture(5);
  const requestId = await createRequest(fixture);
  const proposalId = await sendProposal(fixture, requestId);
  const bookingId = await acceptProposal(fixture, proposalId);
  await db.query(`
    update public.bookings
       set status = 'delivery_pending',
           delivery_status = 'pending',
           delivery_due_at = $1::timestamptz
     where id = $2::uuid`,
  ['2027-03-24T10:00:00Z', bookingId]);
  const cancelError = await fails(() => as(fixture.customer, 'authenticated', `
    select public.cancel_booking($1::uuid, null::text)`, [bookingId]));
  const after = await one(`
    select status, refund_amount from public.bookings where id = $1::uuid`, [bookingId]);
  check(/not overdue/i.test(cancelError ?? '')
    && after.status === 'delivery_pending'
    && after.refund_amount === 0,
  'customer cannot cancel before the agreed date plus the 48-hour grace', { cancelError, after });
});

await scenario('customer can dispute delivery_pending and the pending payout is frozen', async () => {
  const fixture = await createFixture(6);
  const requestId = await createRequest(fixture);
  const proposalId = await sendProposal(fixture, requestId);
  const bookingId = await acceptProposal(fixture, proposalId);
  await db.query(`
    update public.bookings
       set status = 'delivery_pending', delivery_status = 'pending'
     where id = $1::uuid`, [bookingId]);
  await db.query(`
    insert into public.payouts (
      booking_id, provider_id, gross, commission, gst_on_commission, amount, release_after, status
    ) values (
      $1::uuid, $2::uuid, $3::int, 0, 0, $3::int, $4::timestamptz, 'pending'
    )`, [bookingId, fixture.provider, 100000, '2030-04-01T10:00:00Z']);
  const disputeError = await fails(() => as(fixture.customer, 'authenticated', `
    select public.dispute_booking($1::uuid, $2::text)`,
  [bookingId, 'The delivery date passed']));
  const actual = await one(`
    select b.status, p.status as payout_status
      from public.bookings b join public.payouts p on p.booking_id = b.id
     where b.id = $1::uuid`, [bookingId]);
  check(disputeError === null
    && actual.status === 'disputed'
    && actual.payout_status === 'frozen',
  'delivery dispute succeeds and freezes the pending payout', { disputeError, actual });
});

await scenario('creator contact hints are rejected at each C2 server entry point', async () => {
  const fixture = await createFixture(7);
  const requestCountBefore = (await one('select count(*)::int as count from public.service_requests')).count;
  const badBriefError = await fails(() => as(fixture.customer, 'authenticated', `
    select public.create_service_request(
      $1::uuid, $2::text, $3::text, $4::timestamptz, $5::timestamptz,
      $6::jsonb, $7::int, $8::int, $9::uuid, $10::text, $11::uuid,
      $12::double precision, $13::double precision
    )`,
  [fixture.categoryId, fixture.city, 'Creator area', '2027-03-25T10:00:00Z',
    '2027-03-25T14:00:00Z', JSON.stringify({ brief: 'Call +91 9876543210' }),
    50000, 200000, fixture.addressId, 'Creator venue', fixture.provider, 16.50, 80.60]));
  const requestCountAfter = (await one('select count(*)::int as count from public.service_requests')).count;
  const requestId = await createRequest(fixture);
  const noteError = await fails(() => sendProposal(fixture, requestId, { note: 'Call +91 9876543210' }));
  const itemError = await fails(() => sendProposal(fixture, requestId, { itemTitle: 'UPI transfer' }));
  const specError = await fails(() => sendProposal(fixture, requestId, { deliverableSpec: 'Send on WhatsApp' }));
  const proposalId = await sendProposal(fixture, requestId);
  const bookingId = await acceptProposal(fixture, proposalId);
  await db.query(`
    update public.bookings set status = 'delivery_pending', delivery_status = 'pending'
     where id = $1::uuid`, [bookingId]);
  const titleError = await fails(() => as(fixture.provider, 'authenticated', `
    select public.submit_delivery($1::uuid, $2::jsonb)`,
  [bookingId, JSON.stringify([{ title: 'UPI transfer', url: 'https://example.test/delivery' }])]));
  const cleanTitleError = await fails(() => as(fixture.provider, 'authenticated', `
    select public.submit_delivery($1::uuid, $2::jsonb)`,
  [bookingId, JSON.stringify([{ title: 'Final edit', url: 'https://example.test/delivery' }])]));
  const actual = { badBriefError, requestCountBefore, requestCountAfter, noteError, itemError, specError, titleError, cleanTitleError };
  check(/Remove phone numbers, emails or payment handles/i.test(badBriefError ?? '')
    && requestCountAfter === requestCountBefore
    && /Remove phone numbers, emails or payment handles/i.test(noteError ?? '')
    && /Remove phone numbers, emails or payment handles/i.test(itemError ?? '')
    && /Remove phone numbers, emails or payment handles/i.test(specError ?? '')
    && /Remove phone numbers, emails or payment handles/i.test(titleError ?? '')
    && cleanTitleError === null,
  'brief, proposal note, item title, deliverable spec and delivery link title are screened', actual);
});

await scenario('proposal advance cap and fee preview match the accepted booking exactly', async () => {
  const fixture = await createFixture(8);
  const requestId = await createRequest(fixture);
  const rejectedAdvanceError = await fails(() => sendProposal(fixture, requestId, {
    total: 5000000,
    advance: 1300000,
  }));
  const proposalId = await sendProposal(fixture, requestId, { total: 5000000, advance: 1250000 });
  const preview = (await as(fixture.customer, 'authenticated', `
    select platform_fee, advance_due, total_today
      from public.get_proposal_fee_preview($1::uuid)`, [proposalId]))[0];
  const bookingId = await acceptProposal(fixture, proposalId);
  const acceptedFee = (await one(`
    select platform_fee from public.bookings where id = $1::uuid`, [bookingId])).platform_fee;
  const actual = { rejectedAdvanceError, preview, acceptedFee };
  check(/advance can be at most 25%/i.test(rejectedAdvanceError ?? '')
    && preview.platform_fee === 49900
    && preview.advance_due === 1250000
    && preview.total_today === 1299900
    && acceptedFee === preview.platform_fee,
  'advance limit and preview use the exact accepted platform fee without tax additions', actual);
});

await scenario('creator intake schemas cover all four supported creator categories', async () => {
  const rows = await db.query(`
    select slug, intake_schema
      from public.categories
     where slug = any($1::text[])
     order by slug`, [[
    'reel-maker', 'ugc-creator', 'product-photographer', 'event-videographer',
  ]]);
  const schemas = rows.rows.map((row) => ({ slug: row.slug, schema: json(row.intake_schema) }));
  const reel = schemas.find((row) => row.slug === 'reel-maker')?.schema;
  const event = schemas.find((row) => row.slug === 'event-videographer')?.schema;
  const actual = schemas.map(({ slug, schema }) => ({
    slug,
    properties: Object.keys(schema?.properties ?? {}),
    required: schema?.required ?? [],
  }));
  check(schemas.length === 4
    && ['count', 'length_seconds', 'aspect_ratio'].every((key) => key in (reel?.properties ?? {}))
    && reel.required?.includes('count')
    && reel.required?.includes('aspect_ratio')
    && 'styles' in (reel?.properties ?? {})
    && ['count', 'aspect_ratio', 'formats'].every((key) => key in (event?.properties ?? {})),
  'creator brief schemas cover four categories, retain existing fields, and capture reel count, length, and ratio', actual);
});

await db.close();
finish();

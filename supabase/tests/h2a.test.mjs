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

for (const file of fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name) && name.slice(0, 4) <= '0065')
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

async function one(query, params = []) {
  return (await db.query(query, params)).rows[0];
}

async function fails(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error.message;
  }
}

function uuid(value) {
  return `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;
}

async function fixture(index, archetype = 'time_based', { packagePrice = 50000, packageId = true } = {}) {
  const customer = uuid(1000 + index * 10);
  const provider = uuid(1001 + index * 10);
  const manager = uuid(1002 + index * 10);
  const city = `H2a City ${index}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $4::text, '{}'::jsonb), ($2::uuid, $5::text, '{}'::jsonb),
           ($3::uuid, $6::text, '{}'::jsonb)`,
  [customer, provider, manager, `+9199000${String(index).padStart(4, '0')}`,
    `+9199001${String(index).padStart(4, '0')}`, `+9199002${String(index).padStart(4, '0')}`]);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, is_online, paused, suspended
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', now(), true, false, false
    )`, [provider, city]);
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values ($1::uuid, $2::uuid, 'manager', true)`, [provider, manager]);
  const categoryId = (await one(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version, max_lead_days,
      recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::text, $2::text, 'quote', true, $3::text, '{}'::jsonb, 1, 365,
      true, array['daily','alternate_days','weekly','monthly','custom']::text[], 0
    ) returning id`, [`h2a-${index}`, `H2a service ${index}`, archetype])).id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())`, [categoryId, city]);
  const serviceId = (await one(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0, 60000, true) returning id`, [provider, categoryId])).id;
  const savedAddressId = (await one(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Home', 'H2a address', $2::text, 16.50, 80.60) returning id`,
  [customer, city])).id;
  await db.query(`
    insert into public.provider_availability (provider_id, weekday, start_time, end_time)
    select $1::uuid, day, time '00:00', time '23:59'
      from generate_series(0, 6) day`, [provider]);
  let servicePackageId = null;
  if (packageId) {
    servicePackageId = (await one(`
      insert into public.service_packages (
        provider_service_id, title, description, price_type, price, price_min, price_max,
        unit, qty_min, qty_max, duration_min, active
      ) values (
        $1::uuid, $2::text, '', 'fixed', $3::int, $3::int, $3::int,
        $4::text, 1, 1, 60, true
      ) returning id`, [serviceId, `H2a package ${index}`, packagePrice,
    archetype === 'time_based' ? 'session' : 'visit'])).id;
  }
  await db.query(`
    update public.app_config
       set value = value || '{"time_based":true,"fixed":true}'::jsonb
     where key = 'archetype_flags'`);
  await db.query(`
    update public.feature_flags set enabled = true
     where key in (
       'recurring_bookings', 'recurring_skip_pause', 'recurring_reschedule',
       'recurring_plan_acceptance', 'recurring_reminders', 'recurring_prepaid_packages',
       'recurring_billing', 'merchant_staff'
     )`);
  return { customer, provider, manager, city, categoryId, serviceId, savedAddressId, servicePackageId, archetype };
}

function planInput(fixtureRow, date, time = '10:00') {
  return {
    provider_service_id: fixtureRow.serviceId,
    package_id: fixtureRow.servicePackageId,
    archetype: fixtureRow.archetype,
    frequency: 'custom',
    interval_count: 1,
    weekdays: [],
    month_day: null,
    custom_dates: [date],
    start_date: date,
    end_date: null,
    max_occurrences: 1,
    start_time: time,
    duration_min: fixtureRow.archetype === 'time_based' ? 60 : null,
    package_qty: fixtureRow.servicePackageId ? 1 : null,
    billing_frequency: 'per_visit',
    address_id: fixtureRow.savedAddressId,
    description: 'H2a regression visit',
  };
}

async function createPlan(fixtureRow, input) {
  return (await as(fixtureRow.customer, 'authenticated',
    `select public.create_recurring_plan($1::jsonb) id`, [JSON.stringify(input)]))[0].id;
}

async function materialize(planId, throughDate) {
  return (await as(null, 'service_role',
    `select public.materialize_recurring_schedule($1::uuid, $2::date) count`,
    [planId, throughDate]))[0].count;
}

async function payVisit(fixtureRow, bookingId, tag) {
  const amount = (await one(`
    select coalesce(sum(amount), 0)::int amount
      from public.payment_schedule
     where booking_id = $1::uuid and status = 'due'`, [bookingId])).amount;
  const linkId = `h2a-link-${tag}`;
  await db.query(`
    insert into public.payments (booking_id, purpose, amount, status, razorpay_link_id)
    values ($1::uuid, 'session', $2::int, 'created', $3::text)`,
  [bookingId, amount, linkId]);
  const paymentId = (await one(`
    select id from public.payments where razorpay_link_id = $1::text`, [linkId])).id;
  await db.query(`
    insert into public.payment_obligations (payment_id, schedule_id, amount)
    select $1::uuid, ps.id, ps.amount
      from public.payment_schedule ps
     where ps.booking_id = $2::uuid and ps.status = 'due'`,
  [paymentId, bookingId]);
  await as(null, 'service_role', `
    select public.record_session_payment_paid($1::text, $2::text, $3::int)`,
  [linkId, `h2a-paid-${tag}`, amount]);
  return amount;
}

async function payFixedVisit(fixtureRow, bookingId, tag) {
  const amount = (await one(`
    select coalesce(sum(amount), 0)::int amount
      from public.payment_schedule
     where booking_id = $1::uuid and status = 'due'`, [bookingId])).amount;
  const quoteId = (await one(`
    select id from public.quotes where booking_id = $1::uuid`, [bookingId])).id;
  const linkId = `h2a-fixed-link-${tag}`;
  await db.query(`
    insert into public.payments (booking_id, quote_id, purpose, amount, status, razorpay_link_id)
    values ($1::uuid, $2::uuid, 'fixed', $3::int, 'created', $4::text)`,
  [bookingId, quoteId, amount, linkId]);
  const paymentId = (await one(`
    select id from public.payments where razorpay_link_id = $1::text`, [linkId])).id;
  await db.query(`
    insert into public.payment_obligations (payment_id, schedule_id, amount)
    select $1::uuid, ps.id, ps.amount
      from public.payment_schedule ps
     where ps.booking_id = $2::uuid and ps.status = 'due'`,
  [paymentId, bookingId]);
  await as(null, 'service_role', `
    select public.record_payment_paid($1::text, $2::text, $3::int)`,
  [linkId, `h2a-fixed-paid-${tag}`, amount]);
  return amount;
}

const lockedPriceDate = '2027-02-01';
const paidVisitDate = '2027-02-02';

await scenario('H2a accepts plan-mode paid visits', async () => {
  const f = await fixture(1);
  const planId = await createPlan(f, planInput(f, paidVisitDate));
  await as(f.manager, 'authenticated',
    `select public.respond_recurring_plan($1::uuid, true, null)`, [planId]);
  const created = await materialize(planId, paidVisitDate);
  const bookingId = (await one(`
    select id from public.bookings where recurring_schedule_id = $1::uuid`, [planId])).id;
  const amount = await payVisit(f, bookingId, 'plan');
  const actual = await one(`
    select b.status::text status, b.accepted_at is not null accepted_at_set,
           r.acceptance_mode, r.provider_acceptance, b.total_amount,
           r.per_visit_paise, r.platform_fee_paise
      from public.bookings b
      join public.recurring_schedules r on r.id = b.recurring_schedule_id
     where b.id = $1::uuid`, [bookingId]);
  ok(created === 1 && actual.status === 'accepted' && actual.accepted_at_set
    && actual.acceptance_mode === 'plan' && actual.provider_acceptance === 'accepted'
    && actual.total_amount === 52900 && actual.per_visit_paise === 50000
    && actual.platform_fee_paise === 2900,
  `[H2a RP-38] paid plan-mode visit is system-accepted; actual=${JSON.stringify({ created, amount, ...actual })}`);
});

await scenario('H2a accepts fixed plan-mode paid visits', async () => {
  const f = await fixture(9, 'fixed', { packagePrice: 80000 });
  const planId = await createPlan(f, planInput(f, '2027-02-09'));
  await as(f.manager, 'authenticated',
    `select public.respond_recurring_plan($1::uuid, true, null)`, [planId]);
  await materialize(planId, '2027-02-09');
  const bookingId = (await one(`
    select id from public.bookings where recurring_schedule_id = $1::uuid`, [planId])).id;
  const amount = await payFixedVisit(f, bookingId, 'accepted');
  const actual = await one(`
    select b.status::text status, b.accepted_at is not null accepted_at_set,
           r.acceptance_mode, b.total_amount
      from public.bookings b
      join public.recurring_schedules r on r.id = b.recurring_schedule_id
     where b.id = $1::uuid`, [bookingId]);
  ok(actual.status === 'accepted' && actual.accepted_at_set
    && actual.acceptance_mode === 'plan' && actual.total_amount === amount,
  `[H2a RP-38] paid fixed plan-mode visit is system-accepted; actual=${JSON.stringify({ amount, ...actual })}`);
});

await scenario('H2a preserves occurrence acceptance and skips recurring expiry', async () => {
  const f = await fixture(2);
  await db.query(`
    update public.feature_flags set enabled = false where key = 'recurring_plan_acceptance'`);
  const planId = await createPlan(f, planInput(f, '2027-02-03'));
  const schedule = await one(`
    select acceptance_mode, provider_acceptance from public.recurring_schedules where id = $1::uuid`,
  [planId]);
  await materialize(planId, '2027-02-03');
  const bookingId = (await one(`
    select id from public.bookings where recurring_schedule_id = $1::uuid`, [planId])).id;
  await payVisit(f, bookingId, 'occurrence');
  await db.query(`
    update public.bookings set updated_at = now() - interval '16 minutes' where id = $1::uuid`,
  [bookingId]);
  const expired = (await as(null, 'service_role',
    `select public.expire_stale_requests() count`))[0].count;
  const actual = await one(`
    select status::text status from public.bookings where id = $1::uuid`, [bookingId]);
  ok(schedule.acceptance_mode === 'occurrence' && schedule.provider_acceptance === 'accepted'
    && actual.status === 'requested' && Number(expired) === 0,
  `[H2a RP-39] occurrence-mode visit stays requested and recurring rows are not expired; actual=${JSON.stringify({ schedule, expired, ...actual })}`);
});

await scenario('H2a stores quoted fixed price and platform fee', async () => {
  const f = await fixture(3, 'fixed', { packagePrice: 140000 });
  const input = planInput(f, lockedPriceDate);
  const planId = await createPlan(f, input);
  await as(f.manager, 'authenticated',
    `select public.respond_recurring_plan($1::uuid, true, null)`, [planId]);
  await materialize(planId, lockedPriceDate);
  const actual = await one(`
    select r.per_visit_paise, r.platform_fee_paise, b.total_amount, b.platform_fee,
           q.total quote_total
      from public.recurring_schedules r
      join public.bookings b on b.recurring_schedule_id = r.id
      join public.quotes q on q.booking_id = b.id
     where r.id = $1::uuid`, [planId]);
  ok(actual.per_visit_paise === 140000 && actual.platform_fee_paise === 2900
    && actual.total_amount === 142900 && actual.platform_fee === 2900 && actual.quote_total === 140000,
  `[H2a RP-40] accepted fixed occurrence uses quoted paise and fee; actual=${JSON.stringify(actual)}`);
});

await scenario('H2a does not charge a changed fixed package price', async () => {
  const f = await fixture(4, 'fixed', { packagePrice: 160000 });
  const planId = await createPlan(f, planInput(f, '2027-02-04'));
  await as(f.manager, 'authenticated',
    `select public.respond_recurring_plan($1::uuid, true, null)`, [planId]);
  await db.query(`
    update public.service_packages
       set price = 210000, price_min = 210000, price_max = 210000
     where id = $1::uuid`, [f.servicePackageId]);
  await materialize(planId, '2027-02-04');
  const actual = await one(`
    select (select count(*)::int from public.bookings where recurring_schedule_id = $1::uuid) visits,
           c.kind, c.reason, r.per_visit_paise
      from public.recurring_schedules r
      left join public.recurring_occurrence_changes c
        on c.schedule_id = r.id and c.occurrence_date = '2027-02-04'::date
     where r.id = $1::uuid`, [planId]);
  ok(actual.visits === 0 && actual.kind === 'provider_unavailable'
    && actual.reason === 'price changed – needs customer approval'
    && actual.per_visit_paise === 160000,
  `[H2a RP-40] changed fixed price is recorded unavailable instead of charged; actual=${JSON.stringify(actual)}`);
});

await scenario('H2a does not charge a changed time-based labour rate', async () => {
  const f = await fixture(5, 'time_based', { packageId: false });
  const planId = await createPlan(f, planInput(f, '2027-02-05'));
  await as(f.manager, 'authenticated',
    `select public.respond_recurring_plan($1::uuid, true, null)`, [planId]);
  await db.query(`
    update public.provider_services set labour_rate = 90000 where id = $1::uuid`,
  [f.serviceId]);
  await materialize(planId, '2027-02-05');
  const actual = await one(`
    select (select count(*)::int from public.bookings where recurring_schedule_id = $1::uuid) visits,
           c.kind, c.reason, r.per_visit_paise
      from public.recurring_schedules r
      left join public.recurring_occurrence_changes c
        on c.schedule_id = r.id and c.occurrence_date = '2027-02-05'::date
     where r.id = $1::uuid`, [planId]);
  ok(actual.visits === 0 && actual.kind === 'provider_unavailable'
    && actual.reason === 'price changed – needs customer approval'
    && actual.per_visit_paise === 60000,
  `[H2a RP-40] changed labour rate is recorded unavailable instead of charged; actual=${JSON.stringify(actual)}`);
});

await scenario('H2a cancels an unpaid near-term session without charging', async () => {
  const f = await fixture(6);
  const slotParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + 6 * 60 * 60 * 1000))
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  const slot = `${slotParts.year}-${slotParts.month}-${slotParts.day}`;
  const time = `${slotParts.hour}:${slotParts.minute}`;
  const planId = await createPlan(f, planInput(f, slot, time));
  await as(f.manager, 'authenticated',
    `select public.respond_recurring_plan($1::uuid, true, null)`, [planId]);
  const bookingId = (await one(`
    select id from public.bookings where recurring_schedule_id = $1::uuid`, [planId])).id;
  const amount = (await one(`
    select coalesce(sum(amount), 0)::int amount
      from public.payment_schedule where booking_id = $1::uuid and status = 'due'`,
  [bookingId])).amount;
  await db.query(`
    insert into public.payments (booking_id, purpose, amount, status, razorpay_link_id)
    values ($1::uuid, 'session', $2::int, 'created', 'h2a-cancel-link')`, [bookingId, amount]);
  const paymentId = (await one(`
    select id from public.payments where razorpay_link_id = 'h2a-cancel-link'::text`)).id;
  await db.query(`
    insert into public.payment_obligations (payment_id, schedule_id, amount)
    select $1::uuid, ps.id, ps.amount from public.payment_schedule ps
     where ps.booking_id = $2::uuid and ps.status = 'due'`, [paymentId, bookingId]);
  const cancelError = await fails(() => as(f.customer, 'authenticated',
    `select public.cancel_recurring_plan($1::uuid, $2::text)`,
    [planId, 'customer cancelled']));
  const actual = await one(`
    select r.status plan_status, b.status::text booking_status, p.status payment_status,
           p.cancel_link_pending, count(ps.id) filter (where ps.status = 'waived')::int waived_rows,
           (select count(*)::int from public.refunds where payment_id = p.id) refunds
      from public.recurring_schedules r
      join public.bookings b on b.recurring_schedule_id = r.id
      join public.payments p on p.booking_id = b.id
      left join public.payment_schedule ps on ps.booking_id = b.id
     where r.id = $1::uuid
     group by r.id, b.id, p.id`, [planId]);
  ok(!cancelError && actual.plan_status === 'cancelled' && actual.booking_status === 'cancelled'
    && actual.payment_status === 'failed' && actual.cancel_link_pending
    && actual.waived_rows > 0 && actual.refunds === 0,
  `[H2a RP-43] near-term unpaid visit cancels without charge; actual=${JSON.stringify({ cancelError, amount, ...actual })}`);
});

await scenario('H2a refuses pause and provider response in invalid plan states', async () => {
  const f = await fixture(7);
  const planId = await createPlan(f, planInput(f, '2027-02-07'));
  const pauseError = await fails(() => as(f.customer, 'authenticated',
    `select public.pause_recurring_plan($1::uuid, null)`, [planId]));
  await db.query(`
    update public.feature_flags set enabled = false where key = 'recurring_plan_acceptance'`);
  const respondError = await fails(() => as(f.manager, 'authenticated',
    `select public.respond_recurring_plan($1::uuid, true, null)`, [planId]));
  const actual = await one(`
    select status, provider_acceptance from public.recurring_schedules where id = $1::uuid`, [planId]);
  ok(/accepted/i.test(pauseError ?? '') && /turned off/i.test(respondError ?? '')
    && actual.status === 'active' && actual.provider_acceptance === 'pending',
  `[H2a RP-44/RP-45] pending plan remains active and cannot pause or be decided with flag off; actual=${JSON.stringify({ pauseError, respondError, ...actual })}`);
});

await scenario('H2a expires stale pending plans and notifies the customer', async () => {
  const f = await fixture(8);
  const planId = await createPlan(f, planInput(f, '2027-02-08'));
  await db.query(`
    update public.recurring_schedules
       set created_at = now() - interval '73 hours', updated_at = now() - interval '73 hours'
     where id = $1::uuid`, [planId]);
  const expired = (await as(null, 'service_role',
    `select public.expire_pending_recurring_plans() count`))[0].count;
  const actual = await one(`
    select r.status, r.provider_acceptance,
           (select count(*)::int from public.notifications n
             where n.user_id = r.customer_id and n.kind = 'recurring_plan_declined'
               and n.data ->> 'recurring_schedule_id' = r.id::text) notifications
      from public.recurring_schedules r where r.id = $1::uuid`, [planId]);
  ok(Number(expired) === 1 && actual.status === 'cancelled'
    && actual.provider_acceptance === 'declined' && actual.notifications > 0,
  `[H2a RP-45] stale pending plan closes and notifies once; actual=${JSON.stringify({ expired, ...actual })}`);
});

await db.close();
finish();

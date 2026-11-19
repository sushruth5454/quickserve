// Cancellation policy snapshots, exclusive-window reservation and post-transfer payout recovery.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';
import { as as chainAs, db as chainDb } from './r1-test-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = (file) =>
  fs.readFileSync(path.join(here, '..', 'migrations', file), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');
const cases = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'cancellation-cases.json'), 'utf8'));
const b6Harness = createHarness();
const { ok: b6Ok, scenario: b6Scenario, finish: b6Finish } = b6Harness;
const b6Uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const b6One = async (sql, params = []) => (await chainDb.query(sql, params)).rows[0];
const b6Service = (sql, params = []) => chainAs(null, 'service_role', sql, params);

async function b6CreateBooking(seed, status = 'pending_payment', archetype = 'inspect_quote') {
  const customer = b6Uuid(seed * 10 + 1);
  const provider = b6Uuid(seed * 10 + 2);
  const admin = b6Uuid(seed * 10 + 3);
  await chainDb.query(`
    insert into auth.users (id) values ($1::uuid), ($2::uuid), ($3::uuid)
  `, [customer, provider, admin]);
  await chainDb.query(
    `update public.profiles set full_name = $1::text where id = $2::uuid`,
    [`B6 Customer ${seed}`, customer],
  );
  await chainDb.query(
    `update public.profiles set full_name = $1::text, role_provider = true where id = $2::uuid`,
    [`B6 Provider ${seed}`, provider],
  );
  await chainDb.query(`insert into public.admins (user_id) values ($1::uuid)`, [admin]);
  await chainDb.query(`
    insert into public.providers (
      id, city, kyc_status, admin_review_status, submitted_at, is_online, paused, suspended
    ) values ($1::uuid, $2::text, 'verified', 'approved', now(), true, false, false)
  `, [provider, `B6 City ${seed}`]);
  let categoryId;
  if (archetype === 'time_based') {
    await chainDb.query(`
      update public.app_config
         set value = value || '{"time_based":true}'::jsonb
       where key = 'archetype_flags'
    `);
    categoryId = (await b6One(`
      insert into public.categories (
        slug, name, pricing_mode, active, archetype, intake_schema, config_version,
        max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
      ) values (
        $1::text, $2::text, 'quote'::public.pricing_mode, true, 'time_based'::text,
        '{}'::jsonb, 1::int, 365::int, true,
        array['daily','alternate_days','weekly','monthly','custom']::text[], 0::int
      )
      returning id
    `, [`b6-time-${seed}`, `B6 time service ${seed}`])).id;
  } else {
    categoryId = (await b6One(`select id from public.categories where slug = 'ac-repair'`)).id;
  }
  const serviceId = (await b6One(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 19900::int, 50000::int, true)
    returning id
  `, [provider, categoryId])).id;
  await chainDb.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
    on conflict (category_id, city) do update
      set live = true, launched_at = excluded.launched_at
  `, [categoryId, `B6 City ${seed}`]);
  const addressId = (await b6One(`
    insert into public.addresses (user_id, line1, city, lat, lng)
    values ($1::uuid, $2::text, $3::text, 18.5::double precision, 73.8::double precision)
    returning id
  `, [customer, `B6 Road ${seed}`, `B6 City ${seed}`])).id;
  const bookingId = (await b6One(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, status, visit_fee, platform_fee, total_amount, session_duration_min
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      'B6 test booking', $6::public.booking_status, 19900::int, 0::int, 19900::int,
      case when $7::text = 'time_based' then 60::int else null::int end
    )
    returning id
  `, [customer, provider, categoryId, serviceId, addressId, status, archetype])).id;
  return { customer, provider, admin, categoryId, serviceId, bookingId };
}

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
  '0001_init.sql',
  '0002_qa_fixes.sql',
  '0003_payout_transfer_payment_cascade.sql',
  '0007_chat_unread_notifications.sql',
  '0008_provider_kyc_status_values.sql',
  '0009_provider_onboarding.sql',
  '0010_notification_freshness.sql',
  '0011_payout_rails.sql',
  '0012_matching_foundations.sql',
  '0013_review_matching.sql',
  '0014_travel_requests.sql',
  '0015_seva_coins.sql',
  '0016_leakage_programme.sql',
  '0017_creator_config.sql',
  '0018_archetype_core.sql',
  '0019_fixed_package_booking.sql',
  '0020_proposal_enum_values.sql',
  '0021_cancellation_availability_payouts.sql',
  '0022_time_based_booking.sql',
  '0023_proposal_milestone_booking.sql',
]) {
  await db.exec(migration(file));
}

const cancellationNotification = migration('0063_o1_notifications.sql')
  .match(/create or replace function public\._on_booking_event_notify\(\)[\s\S]*?\n\$\$;/i)?.[0];
if (!cancellationNotification) throw new Error('0063 must define _on_booking_event_notify');
await db.exec(cancellationNotification);

let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log('ok  :', message);
  else {
    failures++;
    console.log('FAIL:', message);
  }
};
async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
async function expectError(fn, pattern, message) {
  try {
    await fn();
    ok(false, `${message} (no error)`);
  } catch (error) {
    ok(pattern.test(error.message), `${message} -> ${error.message}`);
  }
}

const customer = '00000000-0000-0000-0000-000000000101';
const provider = '00000000-0000-0000-0000-000000000102';
const other = '00000000-0000-0000-0000-000000000103';
const admin = '00000000-0000-0000-0000-000000000104';
await db.exec(`
  insert into auth.users (id) values ('${customer}'), ('${provider}'), ('${other}'), ('${admin}');
  insert into admins (user_id) values ('${admin}');
  update profiles set role_provider = true where id = '${provider}';
  insert into providers (
    id, bio, city, kyc_status, razorpay_account_id, submitted_at, terms_version, onboarding_step, created_at
  ) values (
    '${provider}', 'Test provider', 'Vijayawada', 'verified', 'acc_route',
    now() - interval '90 days', 'legacy', 7, now() - interval '90 days'
  );
  insert into provider_payout_accounts (
    provider_id, rail, razorpay_account_id, activation_status
  ) values (
    '${provider}', 'route', 'acc_route', 'activated'
  );
  insert into app_config (key, value)
  values ('archetype_flags', '{"fixed":true,"inspect_quote":true,"proposal":true,"time_based":true,"remote":true}'::jsonb)
  on conflict (key) do update set value = excluded.value;
  insert into category_cities (category_id, city, live, launched_at)
  select id, 'Vijayawada', true, now() from categories
  on conflict (category_id, city) do update set live = true, launched_at = excluded.launched_at;
`);
const asCustomer = (sql, params) => as(customer, 'authenticated', sql, params);
const asProvider = (sql, params) => as(provider, 'authenticated', sql, params);
const asAdmin = (sql, params) => as(admin, 'authenticated', sql, params);
const service = (sql, params) => as(null, 'service_role', sql, params);

const [{ id: categoryId }] = await service(`select id from categories where slug = 'ac-repair'`);
const [{ id: serviceId }] = await service(
  `insert into provider_services (provider_id, category_id, visit_fee, labour_rate)
   values ($1, $2, 19900, 50000) returning id`,
  [provider, categoryId],
);
const [{ id: addressId }] = await service(
  `insert into addresses (user_id, label, line1, city, lat, lng)
   values ($1, 'Test', '1 Road', 'Vijayawada', 16.5, 80.6) returning id`,
  [customer],
);

async function fixtureBooking(fx, sequence) {
  await service(
    `update categories
        set cancellation_policy = $1, exclusive = false, min_lead_hours = 0, max_lead_days = 365
      where id = $2`,
    [fx.policy, categoryId],
  );
  const since = fx.hoursSinceBooking ?? 0;
  const created = new Date();
  const at = new Date(created.getTime() + since * 3600_000);
  const start = new Date(at.getTime() + (fx.hoursBefore ?? 24) * 3600_000);
  const bookingRows = await service(
    `insert into bookings (
       customer_id, provider_id, category_id, provider_service_id, address_id,
       description, scheduled_at, status, visit_fee, platform_fee, service_window, total_amount,
       created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
     returning *`,
    [
      customer, provider, categoryId, serviceId, addressId, fx.name,
      start.toISOString(), fx.status, fx.principal, fx.platform,
      `[${start.toISOString()},${new Date(start.getTime() + 7200_000).toISOString()})`,
      fx.principal + fx.platform,
      created.toISOString(),
    ],
  );
  const booking = bookingRows[0];
  if (fx.advance > 0) {
    await service(
      `insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
       values ($1, 'advance', $2, 'paid', $3, $4)`,
      [booking.id, fx.advance, `pay_adv_${sequence}`, at.toISOString()],
    );
  }
  if (fx.principal > fx.advance) {
    await service(
      `insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
       values ($1, 'balance', $2, 'paid', $3, $4)`,
      [booking.id, fx.principal - fx.advance, `pay_principal_${sequence}`, at.toISOString()],
    );
  }
  if (fx.platform > 0) {
    const currentPaid = (await service(
      `select coalesce(sum(amount), 0)::int n from payments where booking_id = $1 and status = 'paid'`,
      [booking.id],
    ))[0].n;
    if (currentPaid + fx.platform > fx.principal) {
      await service(
        `insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
         values ($1, 'fixed', $2, 'paid', $3, $4)`,
        [booking.id, fx.platform, `pay_platform_${sequence}`, at.toISOString()],
      );
    }
  }
  return { booking, at };
}

for (let i = 0; i < cases.length; i++) {
  const fx = cases[i];
  const { booking, at } = await fixtureBooking(fx, i);
  const [{ outcome }] = await service(
    `select _cancellation_outcome($1, $2, $3, $4) outcome`,
    [booking.id, fx.actor, fx.reason, at.toISOString()],
  );
  ok(
    outcome.refund_amount === fx.refund
      && outcome.provider_compensation === fx.provider
      && (outcome.customer_credit ?? 0) === (fx.credit ?? 0),
    `${fx.name}: ${JSON.stringify(outcome)}`,
  );
}

const [{ id: immutableBooking }] = await service(`select id from bookings order by created_at limit 1`);
await expectError(
  () => service(`update bookings set cancellation_snapshot = '{}'::jsonb where id = '${immutableBooking}'`),
  /snapshot is immutable/,
  'cancellation snapshot is immutable',
);

// Standard-visit exact parity: customer after en_route loses the visit fee; 0016 still computes provider commission/GST.
await service(`update categories set cancellation_policy = 'standard_visit' where id = '${categoryId}'`);
const chargeStart = new Date(Date.now() + 3600_000);
const [{ id: chargeBooking }] = await service(
  `insert into bookings (
     customer_id, provider_id, category_id, provider_service_id, address_id, description,
     scheduled_at, status, visit_fee, platform_fee, service_window
   ) values ($1, $2, $3, $4, $5, 'charge', $6, 'en_route', 19900, 2900,
             tstzrange($6::timestamptz, $6::timestamptz + interval '2 hours', '[)')) returning id`,
  [customer, provider, categoryId, serviceId, addressId, chargeStart.toISOString()],
);
await service(
  `insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
   values ($1, 'visit_fee', 19900, 'paid', 'pay_charge', now())`,
  [chargeBooking],
);
await asCustomer(`select cancel_booking($1, 'late')`, [chargeBooking]);
const [{ amount, commission, gst_on_commission: gst }] = await service(
  `select amount, commission, gst_on_commission from payouts where booking_id = $1`,
  [chargeBooking],
);
ok(amount === 17082 && commission === 2388 && gst === 430, '0016 commission math preserved for standard_visit cancellation');

// Any exclusive overlap blocks; two non-exclusive jobs can coexist.
await service(`update categories set exclusive = false where id = '${categoryId}'`);
const overlapStart = new Date(Date.now() + 48 * 3600_000);
const insertWindow = (exclusive, name) =>
  service(
    `insert into bookings (
       customer_id, provider_id, category_id, provider_service_id, address_id, description,
       scheduled_at, status, visit_fee, platform_fee, service_window, exclusive
     ) values ($1, $2, $3, $4, $5, $6, $7, 'requested', 100, 0,
               tstzrange($7::timestamptz, $7::timestamptz + interval '2 hours', '[)'), $8) returning id`,
    [customer, provider, categoryId, serviceId, addressId, name, overlapStart.toISOString(), exclusive],
  );
await service(`update categories set exclusive = false where id = '${categoryId}'`);
await insertWindow(false, 'parallel-a');
await insertWindow(false, 'parallel-b');
ok(true, 'overlapping non-exclusive bookings allowed');
await service(`update categories set exclusive = true where id = '${categoryId}'`);
await expectError(
  () => insertWindow(true, 'exclusive'),
  /service window overlaps/,
  'exclusive booking rejects overlap with a non-exclusive occupant',
);

// A future tranche remains blocked even when the booking-level payout is due.
const [{ id: duePayout }] = await service(
  `update payouts set release_after = now() - interval '1 day' where booking_id = $1 returning id`,
  [chargeBooking],
);
const [{ id: transfer }] = await service(
  `update payout_transfers set release_after = now() + interval '1 day', rail = 'route'
    where payout_id = $1 returning id`,
  [duePayout],
);
ok((await service(`select * from claim_due_transfers()`)).length === 0, 'transfer release_after gates the tranche independently');
await service(`update payout_transfers set release_after = now() - interval '1 minute' where id = '${transfer}'`);
ok((await service(`select * from claim_due_transfers()`)).length === 1, 'due tranche becomes claimable');

// A post-transfer RazorpayX dispute refunds now and immediately records provider debt.
const disputeStart = new Date(Date.now() + 72 * 3600_000);
const [{ id: disputeBooking }] = await service(
  `insert into bookings (
     customer_id, provider_id, category_id, provider_service_id, address_id, description,
     scheduled_at, status, visit_fee, platform_fee, service_window
   ) values ($1, $2, $3, $4, $5, 'post transfer dispute', $6, 'completed', 10000, 0,
             tstzrange($6::timestamptz, $6::timestamptz + interval '2 hours', '[)')) returning id`,
  [customer, provider, categoryId, serviceId, addressId, disputeStart.toISOString()],
);
const [{ id: disputePayment }] = await service(
  `insert into payments (booking_id, purpose, amount, status, razorpay_payment_id, paid_at)
   values ($1, 'balance', 10000, 'paid', 'pay_dispute', now()) returning id`,
  [disputeBooking],
);
const [{ id: disputePayout }] = await service(
  `insert into payouts (booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after, transferred_at)
   values ($1, $2, 10000, 0, 0, 10000, 'transferred', now() - interval '1 day', now() - interval '1 day') returning id`,
  [disputeBooking, provider],
);
await service(
  `insert into payout_transfers (
     payout_id, source_payment_id, amount, rail, status, razorpay_transfer_id, release_after, transferred_at
   ) values ($1, $2, 10000, 'payouts', 'transferred', 'pout_dispute', now() - interval '1 day', now() - interval '1 day')`,
  [disputePayout, disputePayment],
);
await asCustomer(`select dispute_booking($1, 'not delivered')`, [disputeBooking]);
await asAdmin(`select resolve_dispute($1, 'partial_refund', 4000, 'reviewed')`, [disputeBooking]);
const debt = await service(
  `select amount, recovery_key, status from provider_receivables where booking_id = $1`,
  [disputeBooking],
);
const refunds = await service(
  `select sum(amount)::int amount from refunds where payment_id = $1 and status <> 'failed'`,
  [disputePayment],
);
ok(debt.length === 1 && debt[0].amount === 4000, 'unreversible RazorpayX amount becomes provider debt');
ok(refunds[0].amount === 4000, 'customer refund is queued before provider recovery');

const categoryName = (await service(`select name from categories where id = $1::uuid`, [categoryId]))[0].name;
const cancellationNoticeFixtures = [
  {
    customer: '00000000-0000-0000-0000-000000000201',
    provider: '00000000-0000-0000-0000-000000000202',
    scheduledAt: '2027-01-04T04:30:00Z',
    customerName: 'Cancellation Customer One',
    providerName: 'Cancellation Pro One',
  },
  {
    customer: '00000000-0000-0000-0000-000000000203',
    provider: '00000000-0000-0000-0000-000000000204',
    scheduledAt: '2027-01-05T05:00:00Z',
    customerName: 'Cancellation Customer Two',
    providerName: 'Cancellation Pro Two',
  },
  {
    customer: '00000000-0000-0000-0000-000000000205',
    provider: '00000000-0000-0000-0000-000000000206',
    scheduledAt: '2027-01-06T05:30:00Z',
    customerName: 'Cancellation Customer Three',
    providerName: 'Cancellation Pro Three',
  },
];
await service(
  `update categories set min_lead_hours = 0, max_lead_days = 365, exclusive = false where id = $1::uuid`,
  [categoryId],
);
for (const fixture of cancellationNoticeFixtures) {
  await db.query(`
    insert into auth.users (id, raw_user_meta_data)
    values ($1::uuid, $2::jsonb), ($3::uuid, $4::jsonb)
  `, [
    fixture.customer, JSON.stringify({ full_name: fixture.customerName }),
    fixture.provider, JSON.stringify({ full_name: fixture.providerName }),
  ]);
  await db.query(`update profiles set role_provider = true where id = $1::uuid`, [fixture.provider]);
  await db.query(`
    insert into providers (
      id, city, kyc_status, razorpay_account_id, submitted_at, terms_version, onboarding_step
    ) values ($1::uuid, 'Vijayawada', 'verified', $2::text, now(), 'legacy', 7)
  `, [fixture.provider, `acc_${fixture.provider}`]);
  fixture.serviceId = (await db.query(`
    insert into provider_services (provider_id, category_id, visit_fee, labour_rate)
    values ($1::uuid, $2::uuid, 19900, 50000) returning id
  `, [fixture.provider, categoryId])).rows[0].id;
  fixture.addressId = (await db.query(`
    insert into addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Test', '1 Road', 'Vijayawada', 16.5, 80.6) returning id
  `, [fixture.customer])).rows[0].id;
}
const cancellationNoticeBooking = async (fixture, description) => {
  return (await service(
    `insert into bookings (
       customer_id, provider_id, category_id, provider_service_id, address_id, description,
       scheduled_at, status, visit_fee, platform_fee, service_window
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text,
               $7::timestamptz, 'accepted', 19900, 0,
               tstzrange($7::timestamptz, $7::timestamptz + interval '2 hours', '[)'))
     returning id`,
    [fixture.customer, fixture.provider, categoryId, fixture.serviceId, fixture.addressId,
      description, fixture.scheduledAt],
  ))[0].id;
};
const cancellationNoticeRows = (bookingId) => service(
  `select user_id, title, body from notifications
    where booking_id = $1::uuid and kind = 'booking_cancelled' order by user_id`,
  [bookingId],
);

const providerCancelFixture = cancellationNoticeFixtures[0];
const providerCancelledBooking = await cancellationNoticeBooking(
  providerCancelFixture, 'provider cancellation notification');
await as(providerCancelFixture.provider, 'authenticated',
  `select provider_cancel_booking($1::uuid, $2::text, $3::text)`,
  [providerCancelledBooking, 'provider_cancellation', 'test cancellation'],
);
const providerCancellationNotice = await cancellationNoticeRows(providerCancelledBooking);
const cancellationProviderName = (await service(
  `select _first_name($1::uuid, 'Your pro') name`,
  [providerCancelFixture.provider],
))[0].name;
ok(providerCancellationNotice.length === 1
  && providerCancellationNotice[0].user_id === providerCancelFixture.customer
  && providerCancellationNotice[0].title === 'Booking cancelled by your pro'
  && providerCancellationNotice[0].body === `${cancellationProviderName} cancelled your ${categoryName} booking. Any refund due is on its way.`,
  `[WS7-T01] provider cancellation notifies the customer (${JSON.stringify(providerCancellationNotice)})`);

const customerCancelFixture = cancellationNoticeFixtures[1];
const customerCancelledBooking = await cancellationNoticeBooking(
  customerCancelFixture, 'customer cancellation notification');
await as(customerCancelFixture.customer, 'authenticated',
  `select cancel_booking($1::uuid, $2::text)`,
  [customerCancelledBooking, 'test cancellation']);
const customerCancellationNotice = await cancellationNoticeRows(customerCancelledBooking);
ok(customerCancellationNotice.length === 1
  && customerCancellationNotice[0].user_id === customerCancelFixture.provider
  && customerCancellationNotice[0].body === `The customer cancelled the ${categoryName} booking.`,
  `[WS7-T01] customer cancellation notifies the provider (${JSON.stringify(customerCancellationNotice)})`);

const systemCancelFixture = cancellationNoticeFixtures[2];
const systemCancelledBooking = await cancellationNoticeBooking(
  systemCancelFixture, 'system cancellation notification');
await service(`select public._set_status($1::uuid, 'cancelled'::public.booking_status, null::uuid, $2::text)`,
  [systemCancelledBooking, 'system cancellation']);
const systemCancellationNotices = await cancellationNoticeRows(systemCancelledBooking);
ok(systemCancellationNotices.length === 2
  && systemCancellationNotices.map((row) => row.user_id).sort().join(',')
    === [systemCancelFixture.customer, systemCancelFixture.provider].sort().join(',')
  && systemCancellationNotices.every((row) => row.body === `This ${categoryName} booking was cancelled.`),
  `[WS7-T01] system cancellation notifies both parties with neutral text (${JSON.stringify(systemCancellationNotices)})`);

await b6Scenario('B6 queues customer payment and refund notifications once with exact paise and booking links', async () => {
  const fixture = await b6CreateBooking(8601);
  const paymentId = b6Uuid(86011);
  const linkId = `b6-link-${paymentId}`;
  await chainDb.query(`
    insert into public.payments (
      id, booking_id, purpose, amount, status, razorpay_link_id, funding_source
    ) values (
      $1::uuid, $2::uuid, 'visit_fee'::public.payment_purpose, 19900::int,
      'created'::public.payment_status, $3::text, 'customer'::text
    )
  `, [paymentId, fixture.bookingId, linkId]);
  await b6Service(
    `select public.record_payment_paid($1::text, $2::text, $3::int)`,
    [linkId, 'pay_b6_customer_86011', 19900],
  );
  await b6Service(
    `select public.record_payment_paid($1::text, $2::text, $3::int)`,
    [linkId, 'pay_b6_customer_86011', 19900],
  );
  const paymentNotice = await b6One(`
    select user_id, kind, booking_id, data, collapse_key, count
      from public.notifications
     where collapse_key = $1::text
  `, [`payment-received:${paymentId}`]);
  b6Ok(paymentNotice?.user_id === fixture.customer
    && paymentNotice.kind === 'payment_received'
    && paymentNotice.booking_id === fixture.bookingId
    && paymentNotice.data.url === `/booking/${fixture.bookingId}`
    && paymentNotice.data.payment_id === paymentId
    && paymentNotice.data.amount_paise === 19900
    && paymentNotice.count === 1,
  `payment notification is customer-only, linked, exact, and idempotent; actual=${JSON.stringify(paymentNotice)}`);

  const refundId = b6Uuid(86012);
  await chainDb.query(`
    insert into public.refunds (id, payment_id, amount, status)
    values ($1::uuid, $2::uuid, $3::int, 'processing'::public.refund_status)
  `, [refundId, paymentId, 7500]);
  await b6Service(
    `select public.complete_refund($1::uuid, $2::text)`,
    [refundId, 'rfnd_b6_86012'],
  );
  const refundNotice = await b6One(`
    select user_id, kind, booking_id, data, collapse_key
      from public.notifications
     where collapse_key = $1::text
  `, [`refund-completed:${refundId}`]);
  const refundState = await b6One(`
    select r.status::text as refund_status, r.amount::int as refund_paise,
           p.status::text as payment_status
      from public.refunds r
      join public.payments p on p.id = r.payment_id
     where r.id = $1::uuid
  `, [refundId]);
  b6Ok(refundNotice?.user_id === fixture.customer
    && refundNotice.kind === 'refund_completed'
    && refundNotice.booking_id === fixture.bookingId
    && refundNotice.data.url === `/booking/${fixture.bookingId}`
    && refundNotice.data.refund_id === refundId
    && refundNotice.data.amount_paise === 7500
    && refundState?.refund_status === 'refunded'
    && refundState.refund_paise === 7500
    && refundState.payment_status === 'paid',
  `partial refund notification preserves exact paise and payment state; actual=${JSON.stringify({ refundNotice, refundState })}`);
});

await b6Scenario('B6 payment notifications cover successful session and pack captures', async () => {
  const sessionFixture = await b6CreateBooking(8608, 'pending_payment', 'time_based');
  const scheduleId = (await b6One(`
    insert into public.payment_schedule (
      booking_id, seq, label, amount, due_rule, status, purpose, obligation_type
    ) values (
      $1::uuid, 1::int, 'First session'::text, 19900::int, 'at_booking'::text,
      'due'::text, 'session'::text, 'service'::text
    )
    returning id
  `, [sessionFixture.bookingId])).id;
  const sessionPaymentId = b6Uuid(86082);
  const sessionLink = `b6-session-${sessionPaymentId}`;
  await chainDb.query(`
    insert into public.payments (
      id, booking_id, schedule_id, purpose, amount, status, razorpay_link_id, funding_source
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'session'::public.payment_purpose, 19900::int,
      'created'::public.payment_status, $4::text, 'customer'::text
    )
  `, [sessionPaymentId, sessionFixture.bookingId, scheduleId, sessionLink]);
  await b6Service(
    `select public.record_session_payment_paid($1::text, $2::text, $3::int)`,
    [sessionLink, 'pay_b6_session_86082', 19900],
  );
  const sessionNotice = await b6One(`
    select user_id, kind, booking_id, data, collapse_key
      from public.notifications
     where collapse_key = $1::text
  `, [`payment-received:${sessionPaymentId}`]);

  const packFixture = await b6CreateBooking(8609);
  const packageId = (await b6One(`
    insert into public.service_packages (
      provider_service_id, title, description, price_type, price, price_min, price_max,
      unit, qty_min, qty_max, duration_min, active
    ) values (
      $1::uuid, 'Three sessions'::text, ''::text, 'fixed'::text, 60000::int,
      60000::int, 60000::int, 'session'::text, 3::numeric, 3::numeric, 60::int, true
    )
    returning id
  `, [packFixture.serviceId])).id;
  const packId = (await b6One(`
    insert into public.pack_purchases (
      customer_id, provider_id, provider_service_id, service_package_id,
      sessions_total, price, platform_fee, expires_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid,
      3::int, 60000::int, 4900::int, '2027-03-01T00:00:00Z'::timestamptz
    )
    returning id
  `, [packFixture.customer, packFixture.provider, packFixture.serviceId, packageId])).id;
  const packPaymentId = b6Uuid(86092);
  const packLink = `b6-pack-${packPaymentId}`;
  await chainDb.query(`
    insert into public.payments (
      id, pack_purchase_id, purpose, amount, status, razorpay_link_id, funding_source
    ) values (
      $1::uuid, $2::uuid, 'session'::public.payment_purpose, 64900::int,
      'created'::public.payment_status, $3::text, 'customer'::text
    )
  `, [packPaymentId, packId, packLink]);
  await b6Service(
    `select public.record_pack_payment_paid($1::text, $2::text, $3::int)`,
    [packLink, 'pay_b6_pack_86092', 64900],
  );
  const packNotice = await b6One(`
    select user_id, kind, booking_id, data, collapse_key
      from public.notifications
     where collapse_key = $1::text
  `, [`payment-received:${packPaymentId}`]);
  const packReceiptCount = await b6One(`
    select count(*)::int as count
      from public.payment_receipts
     where payment_id = $1::uuid
  `, [packPaymentId]);
  b6Ok(sessionNotice?.user_id === sessionFixture.customer
    && sessionNotice.kind === 'payment_received'
    && sessionNotice.booking_id === sessionFixture.bookingId
    && sessionNotice.data.url === `/booking/${sessionFixture.bookingId}`
    && sessionNotice.data.amount_paise === 19900
    && packNotice?.user_id === packFixture.customer
    && packNotice.kind === 'payment_received'
    && packNotice.booking_id === null
    && packNotice.data.pack_purchase_id === packId
    && packNotice.data.payment_id === packPaymentId
    && packNotice.data.amount_paise === 64900
    && packReceiptCount?.count === 0,
  `session and pack captures notify the customer with exact paise and pack receipts stay booking-scoped; actual=${JSON.stringify({ sessionNotice, packNotice, packReceiptCount })}`);
});

await b6Scenario('B6 booking-event money notifications use the correct parties and booking deep links', async () => {
  const fixture = await b6CreateBooking(8602, 'awaiting_payment');
  await chainDb.query(`
    insert into public.payouts (
      booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
    ) values (
      $1::uuid, $2::uuid, 19900::int, 0::int, 0::int, 19900::int,
      'pending'::public.payout_status, '2026-12-03T00:00:00Z'::timestamptz
    )
  `, [fixture.bookingId, fixture.provider]);
  const addEvent = (from, to, actor, note) => chainDb.query(`
    insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
    values ($1::uuid, $2::uuid, $3::public.booking_status, $4::public.booking_status, $5::text)
    returning id
  `, [fixture.bookingId, actor, from, to, note]);
  const quoteEvent = (await addEvent('awaiting_payment', 'in_progress', fixture.customer, 'balance paid')).rows[0];
  const completedEvent = (await addEvent('in_progress', 'completed', fixture.customer, 'customer confirmed')).rows[0];
  const disputeEvent = (await addEvent('completed', 'disputed', fixture.customer, 'not delivered')).rows[0];
  const resolvedEvent = (await addEvent('disputed', 'completed', fixture.admin, 'dispute denied')).rows[0];
  const eventNotices = await chainDb.query(`
    select user_id, kind, booking_id, body, data, collapse_key
      from public.notifications
     where collapse_key = any($1::text[])
     order by kind, user_id
  `, [[
    `booking-event:${quoteEvent.id}`,
    `booking-event:${completedEvent.id}`,
    `booking-event:${disputeEvent.id}`,
    `booking-event:${resolvedEvent.id}:customer`,
    `booking-event:${resolvedEvent.id}:provider`,
  ]]);
  const rows = eventNotices.rows;
  const quoteNotice = rows.find((row) => row.kind === 'quote_approved');
  const completionNotice = rows.find((row) => row.kind === 'job_completed_payout_scheduled');
  const disputeNotice = rows.find((row) => row.kind === 'dispute_opened');
  const resolved = rows.filter((row) => row.kind === 'dispute_resolved');
  b6Ok(quoteNotice?.user_id === fixture.provider
    && quoteNotice.booking_id === fixture.bookingId
    && quoteNotice.data.url === `/booking/${fixture.bookingId}`,
  `quote approval is linked to the provider booking; actual=${JSON.stringify(quoteNotice)}`);
  b6Ok(completionNotice?.user_id === fixture.provider
    && completionNotice.booking_id === fixture.bookingId
    && completionNotice.data.url === `/booking/${fixture.bookingId}`,
  `completion payout notice is linked to the provider booking; actual=${JSON.stringify(completionNotice)}`);
  b6Ok(disputeNotice?.user_id === fixture.provider
    && disputeNotice.booking_id === fixture.bookingId
    && disputeNotice.data.url === `/booking/${fixture.bookingId}`,
  `dispute notice is linked to the provider booking; actual=${JSON.stringify(disputeNotice)}`);
  b6Ok(resolved.length === 2
    && resolved.map((row) => row.user_id).sort().join(',')
      === [fixture.customer, fixture.provider].sort().join(','),
  `dispute resolution notifies both booking parties; actual=${JSON.stringify(resolved)}`);
  b6Ok(resolved.every((row) => row.booking_id === fixture.bookingId
    && row.data.url === `/booking/${fixture.bookingId}`
    && row.body.includes('dispute denied')),
  `dispute resolution includes the outcome and booking link; actual=${JSON.stringify(resolved)}`);
});

await b6Scenario('B6 payout notifications identify providers and earnings route', async () => {
  const fixture = await b6CreateBooking(8603, 'accepted');
  const paymentId = b6Uuid(86031);
  await chainDb.query(`
    insert into public.payments (
      id, booking_id, purpose, amount, status, razorpay_payment_id, funding_source
    ) values (
      $1::uuid, $2::uuid, 'visit_fee'::public.payment_purpose, 19900::int,
      'paid'::public.payment_status, $3::text, 'customer'::text
    )
  `, [paymentId, fixture.bookingId, 'pay_b6_transfer_source']);

  const sentPayout = (await b6One(`
    insert into public.payouts (
      booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
    ) values (
      $1::uuid, $2::uuid, 19900::int, 0::int, 0::int, 19900::int,
      'pending'::public.payout_status, now()
    )
    returning id
  `, [fixture.bookingId, fixture.provider])).id;
  const sentTransfer = (await b6One(`
    insert into public.payout_transfers (payout_id, source_payment_id, amount, status, rail)
    values ($1::uuid, $2::uuid, 19900::int, 'processing'::public.transfer_status, 'payouts'::text)
    returning id
  `, [sentPayout, paymentId])).id;
  await b6Service(
    `select public.complete_transfer($1::uuid, $2::text)`,
    [sentTransfer, 'trf_b6_sent'],
  );
  const sentNotice = await b6One(`
    select user_id, kind, booking_id, data, collapse_key
      from public.notifications
     where collapse_key = $1::text
  `, [`payout-sent:${sentPayout}`]);

  const failedPayout = b6Uuid(86032);
  const failedBooking = await b6CreateBooking(8604, 'accepted');
  const failedPayment = b6Uuid(86041);
  await chainDb.query(`
    insert into public.payments (
      id, booking_id, purpose, amount, status, razorpay_payment_id, funding_source
    ) values (
      $1::uuid, $2::uuid, 'visit_fee'::public.payment_purpose, 19900::int,
      'paid'::public.payment_status, $3::text, 'customer'::text
    )
  `, [failedPayment, failedBooking.bookingId, 'pay_b6_transfer_failure']);
  await chainDb.query(`
    insert into public.payouts (
      id, booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 19900::int, 0::int, 0::int, 19900::int,
      'pending'::public.payout_status, now()
    )
  `, [failedPayout, failedBooking.bookingId, failedBooking.provider]);
  const failedTransfer = (await b6One(`
    insert into public.payout_transfers (
      payout_id, source_payment_id, amount, status, attempts, rail
    ) values (
      $1::uuid, $2::uuid, 19900::int, 'processing'::public.transfer_status, 4::int, 'payouts'::text
    )
    returning id
  `, [failedPayout, failedPayment])).id;
  await b6Service(
    `select public.fail_transfer($1::uuid, $2::text)`,
    [failedTransfer, 'bank account unavailable'],
  );
  const failedNotice = await b6One(`
    select user_id, kind, booking_id, data, collapse_key
      from public.notifications
     where collapse_key = $1::text
  `, [`payout-problem:${failedPayout}`]);

  const gatewayFixture = await b6CreateBooking(8606, 'accepted');
  const gatewayPayment = b6Uuid(86061);
  const gatewayPayout = b6Uuid(86062);
  await chainDb.query(`
    insert into public.payments (
      id, booking_id, purpose, amount, status, razorpay_payment_id, funding_source
    ) values (
      $1::uuid, $2::uuid, 'visit_fee'::public.payment_purpose, 19900::int,
      'paid'::public.payment_status, $3::text, 'customer'::text
    )
  `, [gatewayPayment, gatewayFixture.bookingId, 'pay_b6_gateway_source']);
  await chainDb.query(`
    insert into public.payouts (
      id, booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 19900::int, 0::int, 0::int, 19900::int,
      'transferred'::public.payout_status, now()
    )
  `, [gatewayPayout, gatewayFixture.bookingId, gatewayFixture.provider]);
  await chainDb.query(`
    insert into public.payout_transfers (
      payout_id, source_payment_id, amount, status, rail, razorpay_transfer_id, transferred_at
    ) values (
      $1::uuid, $2::uuid, 19900::int, 'transferred'::public.transfer_status,
      'payouts'::text, $3::text, now()
    )
  `, [gatewayPayout, gatewayPayment, 'trf_b6_gateway_8606']);
  await b6Service(
    `select public.record_payout_gateway_event($1::text, $2::text, $3::text, $4::text)`,
    ['trf_b6_gateway_8606', 'reversed', null, 'Beneficiary account closed'],
  );
  await b6Service(
    `select public.record_payout_gateway_event($1::text, $2::text, $3::text, $4::text)`,
    ['trf_b6_gateway_8606', 'reversed', null, 'Beneficiary account closed'],
  );
  const gatewayNotice = await b6One(`
    select user_id, kind, booking_id, data, collapse_key
      from public.notifications
     where collapse_key = $1::text
  `, [`payout-problem:${gatewayPayout}`]);

  b6Ok(sentNotice?.user_id === fixture.provider
    && sentNotice.kind === 'payout_sent'
    && sentNotice.booking_id === fixture.bookingId
    && sentNotice.data.url === '/earnings'
    && sentNotice.data.amount_paise === 19900
    && failedNotice?.user_id === failedBooking.provider
    && failedNotice.kind === 'payout_problem'
    && failedNotice.booking_id === failedBooking.bookingId
    && failedNotice.data.url === '/earnings'
    && failedNotice.data.amount_paise === 19900
    && gatewayNotice?.user_id === gatewayFixture.provider
    && gatewayNotice.kind === 'payout_problem'
    && gatewayNotice.booking_id === gatewayFixture.bookingId
    && gatewayNotice.data.url === '/earnings'
    && gatewayNotice.data.amount_paise === 19900,
  `payout notices are provider-only, idempotent, and linked to earnings with exact paise; actual=${JSON.stringify({ sentNotice, failedNotice, gatewayNotice })}`);
});

await b6Scenario('B6 notification insert failures do not roll back payment, refund, or payout state changes', async () => {
  const fixture = await b6CreateBooking(8605);
  const payoutFixture = await b6CreateBooking(8607, 'accepted');
  const transferFailureFixture = await b6CreateBooking(8610, 'accepted');
  const gatewayFailureFixture = await b6CreateBooking(8611, 'accepted');
  const paymentId = b6Uuid(86051);
  const refundId = b6Uuid(86052);
  const payoutPaymentId = b6Uuid(86073);
  const payoutId = b6Uuid(86074);
  const transferFailurePaymentId = b6Uuid(86103);
  const transferFailurePayoutId = b6Uuid(86104);
  const gatewayFailurePaymentId = b6Uuid(86113);
  const gatewayFailurePayoutId = b6Uuid(86114);
  const linkId = `b6-failure-link-${paymentId}`;
  await chainDb.query(`
    insert into public.payments (
      id, booking_id, purpose, amount, status, razorpay_link_id, funding_source
    ) values (
      $1::uuid, $2::uuid, 'visit_fee'::public.payment_purpose, 19900::int,
      'created'::public.payment_status, $3::text, 'customer'::text
    )
  `, [paymentId, fixture.bookingId, linkId]);
  await chainDb.query(`
    insert into public.payments (
      id, booking_id, purpose, amount, status, razorpay_payment_id, funding_source
    ) values (
      $1::uuid, $2::uuid, 'visit_fee'::public.payment_purpose, 19900::int,
      'paid'::public.payment_status, $3::text, 'customer'::text
    )
  `, [payoutPaymentId, payoutFixture.bookingId, 'pay_b6_failure_payout']);
  await chainDb.query(`
    insert into public.payouts (
      id, booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 19900::int, 0::int, 0::int, 19900::int,
      'pending'::public.payout_status, now()
    )
  `, [payoutId, payoutFixture.bookingId, payoutFixture.provider]);
  const payoutTransferId = (await b6One(`
    insert into public.payout_transfers (
      payout_id, source_payment_id, amount, status, rail
    ) values (
      $1::uuid, $2::uuid, 19900::int, 'processing'::public.transfer_status, 'payouts'::text
    )
    returning id
  `, [payoutId, payoutPaymentId])).id;
  await chainDb.query(`
    insert into public.payments (
      id, booking_id, purpose, amount, status, razorpay_payment_id, funding_source
    ) values (
      $1::uuid, $2::uuid, 'visit_fee'::public.payment_purpose, 19900::int,
      'paid'::public.payment_status, $3::text, 'customer'::text
    )
  `, [transferFailurePaymentId, transferFailureFixture.bookingId, 'pay_b6_failure_terminal']);
  await chainDb.query(`
    insert into public.payouts (
      id, booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 19900::int, 0::int, 0::int, 19900::int,
      'pending'::public.payout_status, now()
    )
  `, [transferFailurePayoutId, transferFailureFixture.bookingId, transferFailureFixture.provider]);
  const terminalTransferId = (await b6One(`
    insert into public.payout_transfers (
      payout_id, source_payment_id, amount, status, attempts, rail
    ) values (
      $1::uuid, $2::uuid, 19900::int, 'processing'::public.transfer_status, 4::int, 'payouts'::text
    )
    returning id
  `, [transferFailurePayoutId, transferFailurePaymentId])).id;
  await chainDb.query(`
    insert into public.payments (
      id, booking_id, purpose, amount, status, razorpay_payment_id, funding_source
    ) values (
      $1::uuid, $2::uuid, 'visit_fee'::public.payment_purpose, 19900::int,
      'paid'::public.payment_status, $3::text, 'customer'::text
    )
  `, [gatewayFailurePaymentId, gatewayFailureFixture.bookingId, 'pay_b6_failure_gateway']);
  await chainDb.query(`
    insert into public.payouts (
      id, booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 19900::int, 0::int, 0::int, 19900::int,
      'transferred'::public.payout_status, now()
    )
  `, [gatewayFailurePayoutId, gatewayFailureFixture.bookingId, gatewayFailureFixture.provider]);
  const gatewayTransferId = (await b6One(`
    insert into public.payout_transfers (
      payout_id, source_payment_id, amount, status, rail, razorpay_transfer_id, transferred_at
    ) values (
      $1::uuid, $2::uuid, 19900::int, 'transferred'::public.transfer_status,
      'payouts'::text, $3::text, now()
    )
    returning id
  `, [gatewayFailurePayoutId, gatewayFailurePaymentId, 'trf_b6_failure_gateway'])).id;
  await chainDb.exec(`
    create or replace function public.b6_reject_money_notifications()
    returns trigger language plpgsql as $$
    begin
      if new.kind in ('payment_received', 'refund_completed', 'payout_sent', 'payout_problem') then
        raise exception 'B6 notification insert rejected';
      end if;
      return new;
    end;
    $$;
    create trigger b6_reject_money_notifications
      before insert on public.notifications
      for each row execute function public.b6_reject_money_notifications();
  `);
  try {
    await b6Service(
      `select public.record_payment_paid($1::text, $2::text, $3::int)`,
      [linkId, 'pay_b6_failure_86051', 19900],
    );
    await chainDb.query(`
      update public.payments
         set status = 'refund_processing'::public.payment_status
       where id = $1::uuid
    `, [paymentId]);
    await chainDb.query(`
      insert into public.refunds (id, payment_id, amount, status)
      values ($1::uuid, $2::uuid, 19900::int, 'processing'::public.refund_status)
    `, [refundId, paymentId]);
    await b6Service(
      `select public.complete_refund($1::uuid, $2::text)`,
      [refundId, 'rfnd_b6_failure_86052'],
    );
    await b6Service(
      `select public.complete_transfer($1::uuid, $2::text)`,
      [payoutTransferId, 'trf_b6_failure_payout'],
    );
    await b6Service(
      `select public.fail_transfer($1::uuid, $2::text)`,
      [terminalTransferId, 'bank account unavailable'],
    );
    await b6Service(
      `select public.record_payout_gateway_event($1::text, $2::text, $3::text, $4::text)`,
      ['trf_b6_failure_gateway', 'reversed', null, 'Beneficiary account closed'],
    );
  } finally {
    await chainDb.exec(`
      drop trigger if exists b6_reject_money_notifications on public.notifications;
      drop function if exists public.b6_reject_money_notifications();
    `);
  }
  const moneyState = await b6One(`
    select p.status::text as payment_status, r.status::text as refund_status,
           r.amount::int as refund_paise
      from public.payments p
      join public.refunds r on r.payment_id = p.id
     where p.id = $1::uuid and r.id = $2::uuid
  `, [paymentId, refundId]);
  const payoutState = await b6One(`
    select p.status::text as payout_status, t.status::text as transfer_status
      from public.payouts p
      join public.payout_transfers t on t.payout_id = p.id
     where p.id = $1::uuid
  `, [payoutId]);
  const failedTransferState = await b6One(`
    select p.status::text as payout_status, t.status::text as transfer_status
      from public.payouts p
      join public.payout_transfers t on t.payout_id = p.id
     where p.id = $1::uuid
  `, [transferFailurePayoutId]);
  const gatewayState = await b6One(`
    select p.status::text as payout_status, t.status::text as transfer_status
      from public.payouts p
      join public.payout_transfers t on t.payout_id = p.id
     where p.id = $1::uuid and t.id = $2::uuid
  `, [gatewayFailurePayoutId, gatewayTransferId]);
  b6Ok(moneyState?.payment_status === 'refunded'
    && moneyState.refund_status === 'refunded'
    && moneyState.refund_paise === 19900,
  `failed notification insert leaves payment/refund state committed in exact paise; actual=${JSON.stringify(moneyState)}`);
  b6Ok(payoutState?.payout_status === 'transferred' && payoutState.transfer_status === 'transferred',
    `failed payout notification insert leaves the transfer committed; actual=${JSON.stringify(payoutState)}`);
  b6Ok(failedTransferState?.payout_status === 'failed' && failedTransferState.transfer_status === 'failed'
    && gatewayState?.payout_status === 'failed' && gatewayState.transfer_status === 'failed',
  `failed payout notifications do not roll back terminal and gateway failures; actual=${JSON.stringify({ failedTransferState, gatewayState })}`);
});

b6Finish();
if (failures) process.exitCode = 1;

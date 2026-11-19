import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const targetMigration = '0087_o3_admin_money_visibility.sql';
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{4}[a-z]?_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 87)
  .sort();
if (!migrationFiles.includes(targetMigration)) {
  throw new Error(`missing reserved O3 migration: ${targetMigration}`);
}

const migration = (name) =>
  fs.readFileSync(path.join(migrationsDir, name), 'utf8')
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
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, phone text, phone_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
  created_at timestamptz, updated_at timestamptz
);
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
for (const name of migrationFiles) await db.exec(migration(name));
await db.exec("set timezone = 'UTC'");

const { ok, scenario, finish } = createHarness();
const check = (condition, label, actual) =>
  ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const uuid = async () => (await one('select gen_random_uuid() as id')).id;
let nextPhone = 7800000000;
let slotNumber = 0;

async function as(uid, role, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

const service = (sql, params = []) => as(null, 'service_role', sql, params);

async function createActors() {
  const customer = await uuid();
  const provider = await uuid();
  const admin = await uuid();
  const other = await uuid();
  await db.query(
    `insert into auth.users (id, phone) values
      ($1::uuid, $2::text), ($3::uuid, $4::text), ($5::uuid, $6::text), ($7::uuid, $8::text)`,
    [
      customer, `+91${nextPhone++}`, provider, `+91${nextPhone++}`,
      admin, `+91${nextPhone++}`, other, `+91${nextPhone++}`,
    ],
  );
  await db.query(`insert into public.admins (user_id) values ($1::uuid)`, [admin]);
  await db.query(`update public.profiles set full_name = 'O3 Admin' where id = $1::uuid`, [admin]);
  await db.query(
    `insert into public.providers (
       id, bio, city, years_experience, kyc_status, admin_review_status, razorpay_account_id, created_at,
       submitted_at, is_online, suspended, paused
     ) values (
       $1::uuid, 'O3 test provider', 'Vijayawada', 5, 'verified', 'approved', $2::text,
       now() - interval '90 days', now(), true, false, false
     )`,
    [provider, `acc_${provider.slice(0, 8)}`],
  );
  const { id: categoryId } = await one(
    `select id from public.categories where slug = $1::text`,
    ['ac-repair'],
  );
  await db.query(
    `update public.categories
        set cancellation_policy = $1::text, archetype = $2::text
      where id = $3::uuid`,
    ['standard_visit', 'inspect_quote', categoryId],
  );
  await db.query(
    `insert into public.category_cities (category_id, city, live, launched_at)
     values ($1::uuid, $2::text, true, now())
     on conflict (category_id, city) do update
       set live = true, launched_at = excluded.launched_at`,
    [categoryId, 'Vijayawada'],
  );
  const { id: serviceId } = await one(
    `insert into public.provider_services (
       provider_id, category_id, skill_level, visit_fee, labour_rate, active
     ) values ($1::uuid, $2::uuid, 'expert', 19900, 50000, true)
     returning id`,
    [provider, categoryId],
  );
  await db.query(
    `insert into public.provider_payout_accounts (
       provider_id, rail, razorpay_account_id, activation_status
     ) values ($1::uuid, 'route', $2::text, 'activated')`,
    [provider, `acc_${provider.slice(0, 8)}`],
  );
  return { customer, provider, admin, other, categoryId, serviceId };
}

async function createVisit(actors) {
  const [{ create_booking: bookingId }] = await as(
    actors.customer,
    'authenticated',
    `select public.create_booking(
       $1::uuid, $2::text, $3::text, $4::text, $5::numeric, $6::numeric
     ) as create_booking`,
    [actors.serviceId, `O3 booking ${await uuid()}`, '12 MG Road', 'Vijayawada', 16.51, 80.64],
  );
  const [payment] = await service(
    `select * from public.prepare_payment($1::uuid, $2::uuid)`,
    [bookingId, actors.customer],
  );
  const link = `o3-link-${payment.payment_id}`;
  await db.query(
    `update public.payments
        set razorpay_link_id = $1::text, short_url = $2::text
      where id = $3::uuid`,
    [link, 'https://pay.test/o3', payment.payment_id],
  );
  await service(
    `select public.record_payment_paid($1::text, $2::text, $3::int)`,
    [link, `gateway-${payment.payment_id}`, payment.amount],
  );
  await as(actors.provider, 'authenticated', `select public.accept_booking($1::uuid)`, [bookingId]);
  await as(actors.provider, 'authenticated', `select public.start_trip($1::uuid)`, [bookingId]);
  const [{ start_otp: startOtp }] = await as(
    actors.customer,
    'authenticated',
    `select * from public.get_booking_otps($1::uuid)`,
    [bookingId],
  );
  await as(
    actors.provider,
    'authenticated',
    `select public.arrive($1::uuid, $2::text)`,
    [bookingId, startOtp],
  );
  slotNumber += 1;
  const slotStart = new Date(Date.UTC(2027, 0, 5 + slotNumber, 10, 0)).toISOString();
  await db.query(
    `update public.bookings
        set scheduled_at = $1::timestamptz,
            service_window = tstzrange($1::timestamptz, $1::timestamptz + interval '2 hours', '[)')
      where id = $2::uuid`,
    [slotStart, bookingId],
  );
  return bookingId;
}

async function sendQuote(actors, bookingId) {
  return (await as(
    actors.provider,
    'authenticated',
    `select public.send_quote($1::uuid, $2::jsonb) as quote_id`,
    [bookingId, JSON.stringify([
      { kind: 'labour', title: 'Gas refill', qty: 1, unit_price: 150000 },
      { kind: 'part', title: 'Capacitor', qty: 1, unit_price: 65000 },
    ])],
  ))[0].quote_id;
}

async function addCashBalance(actors, bookingId) {
  const quoteId = await sendQuote(actors, bookingId);
  await as(
    actors.customer,
    'authenticated',
    `select public.approve_quote_with_coins($1::uuid, $2::uuid, $3::boolean)`,
    [bookingId, quoteId, false],
  );
  const [payment] = await service(
    `select * from public.prepare_payment($1::uuid, $2::uuid)`,
    [bookingId, actors.customer],
  );
  const link = `o3-balance-${payment.payment_id}`;
  await db.query(
    `update public.payments
        set razorpay_link_id = $1::text, short_url = $2::text
      where id = $3::uuid`,
    [link, 'https://pay.test/o3-balance', payment.payment_id],
  );
  await service(
    `select public.record_payment_paid($1::text, $2::text, $3::int)`,
    [link, `gateway-${payment.payment_id}`, payment.amount],
  );
}

async function errorMessage(fn) {
  try {
    await fn();
    return '';
  } catch (error) {
    return error.message;
  }
}

await scenario('WS7-T06 admin money RPCs expose booking state and retry failed payouts once with an audit row', async () => {
  const actors = await createActors();
  const bookingId = await createVisit(actors);
  const { id: paymentId } = await one(
    `select p.id from public.payments p
      where p.booking_id = $1::uuid and p.status = 'paid'
      order by p.created_at limit 1`,
    [bookingId],
  );
  const { id: payoutId } = await one(
    `insert into public.payouts (
       booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
     ) values (
       $1::uuid, $2::uuid, 19900, 1990, 358, 17552, 'failed', $3::timestamptz
     ) returning id`,
    [bookingId, actors.provider, '2027-02-01T10:00:00.000Z'],
  );
  const secondBookingId = await createVisit(actors);
  const { id: secondPaymentId } = await one(
    `select p.id from public.payments p
      where p.booking_id = $1::uuid and p.status = 'paid'
      order by p.created_at limit 1`,
    [secondBookingId],
  );
  const { id: payoutWithTransferErrorId } = await one(
    `insert into public.payouts (
       booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
     ) values (
       $1::uuid, $2::uuid, 19900, 1990, 358, 17552, 'pending', $3::timestamptz
     ) returning id`,
    [secondBookingId, actors.provider, '2027-02-02T10:00:00.000Z'],
  );
  await db.query(
    `insert into public.payout_transfers (
       payout_id, source_payment_id, amount, status, attempts, last_error
     ) values ($1::uuid, $2::uuid, $3::int, 'processing', $4::int, $5::text)`,
    [payoutWithTransferErrorId, secondPaymentId, 17552, 1, 'stale transfer error'],
  );
  const { id: transferId } = await one(
    `insert into public.payout_transfers (
       payout_id, source_payment_id, amount, status, attempts, next_attempt_at, last_error,
       rail, gateway_status, razorpay_transfer_id, idempotency_seq
     ) values (
       $1::uuid, $2::uuid, 17552, 'failed', 4, $3::timestamptz, $4::text,
       'payouts', 'failed', $5::text, 2
     ) returning id`,
    [payoutId, paymentId, '2027-01-03T10:00:00.000Z', 'gateway declined', `pout_${payoutId}`],
  );
  const { id: refundId } = await one(
    `insert into public.refunds (payment_id, amount, status, attempts, last_error)
     values ($1::uuid, $2::int, 'failed', $3::int, $4::text) returning id`,
    [paymentId, 1200, 3, 'refund gateway error'],
  );
  await db.query(
    `insert into public.payout_transfer_reversals (
       payout_transfer_id, recovery_key, amount, rail, status, attempts, last_error
     ) values ($1::uuid, $2::text, $3::int, 'payouts', 'failed', $4::int, $5::text)`,
    [transferId, `o3-reversal:${transferId}`, 800, 2, 'reversal gateway error'],
  );
  await db.query(
    `insert into public.provider_receivables (provider_id, booking_id, amount, recovered, reason, status, created_by)
     values ($1::uuid, $2::uuid, $3::int, $4::int, $5::text, 'open', $6::uuid)`,
    [actors.provider, bookingId, 1000, 250, 'O3 test receivable', actors.admin],
  );
  await db.query(
    `insert into public.booking_events (booking_id, actor_id, to_status, note, at) values
      ($1::uuid, $2::uuid, 'requested', 'customer event', '2027-01-01T10:00:00.000Z'::timestamptz),
      ($1::uuid, $3::uuid, 'accepted', 'provider event', '2027-01-01T10:01:00.000Z'::timestamptz),
      ($1::uuid, $4::uuid, 'in_progress', 'admin event', '2027-01-01T10:02:00.000Z'::timestamptz),
      ($1::uuid, null, 'disputed', 'system event', '2027-01-01T10:03:00.000Z'::timestamptz)`,
    [bookingId, actors.customer, actors.provider, actors.admin],
  );

  const forbiddenList = await errorMessage(() =>
    as(actors.other, 'authenticated', `select public.admin_list_problem_payouts()`));
  const forbiddenRetry = await errorMessage(() =>
    as(
      actors.other,
      'authenticated',
      `select public.admin_retry_payout($1::uuid, $2::text)`,
      [payoutId, 'unauthorized attempt'],
    ));
  const missingNote = await errorMessage(() =>
    as(
      actors.admin,
      'authenticated',
      `select public.admin_retry_payout($1::uuid, $2::text)`,
      [payoutId, '   '],
    ));
  const details = (await as(
    actors.admin,
    'authenticated',
    `select public.admin_get_booking($1::uuid) as value`,
    [bookingId],
  ))[0].value;
  const queue = (await as(
    actors.admin,
    'authenticated',
    `select public.admin_list_problem_payouts() as value`,
  ))[0].value;

  check(
    /admin only/i.test(forbiddenList)
      && /admin only/i.test(forbiddenRetry)
      && /note/i.test(missingNote),
    'payout access is admin-only and retry requires a non-empty audit note',
    { forbiddenList, forbiddenRetry, missingNote },
  );
  check(
    details.events.some((event) => event.actor_role === 'customer' && event.actor_id === actors.customer)
      && details.events.some((event) => event.actor_role === 'provider' && event.actor_id === actors.provider)
      && details.events.some((event) => event.actor_role === 'admin' && event.actor_id === actors.admin)
      && details.events.some((event) => event.actor_role === 'system' && event.actor_id === null)
      && details.refunds.some((refund) => refund.id === refundId && refund.amount === 1200 && refund.last_error === 'refund gateway error')
      && details.payouts.some((payout) => payout.id === payoutId && payout.gross === 19900 && payout.commission === 1990 && payout.amount === 17552)
      && details.transfers.some((transfer) => transfer.status === 'failed' && transfer.attempts === 4 && transfer.last_error === 'gateway declined')
      && details.reversals.some((reversal) => reversal.payout_transfer_id === transferId && reversal.amount === 800)
      && details.receivables.some((receivable) => receivable.amount === 1000 && receivable.recovered === 250),
    'admin booking detail returns money records and actor identity/role',
    details,
  );
  check(
    queue.payouts.some((payout) => payout.id === payoutId && payout.transfers.some((transfer) => transfer.last_error === 'gateway declined'))
      && queue.payouts.some((payout) => payout.id === payoutWithTransferErrorId && payout.status === 'pending'),
    'problem payout queue includes failed payouts and payouts with a transfer error',
    queue,
  );

  const note = 'Gateway confirmed the payout failure; retry after reviewing the transfer.';
  const retryResult = (await as(
    actors.admin,
    'authenticated',
    `select public.admin_retry_payout($1::uuid, $2::text) as value`,
    [payoutId, note],
  ))[0].value;
  const transferAfter = await one(
    `select t.status::text as status, t.next_attempt_at, t.gateway_status, t.razorpay_transfer_id,
            t.idempotency_seq, p.status::text as payout_status
       from public.payout_transfers t
       join public.payouts p on p.id = t.payout_id
      where t.id = $1::uuid`,
    [transferId],
  );
  const duplicateRetry = await errorMessage(() =>
    as(
      actors.admin,
      'authenticated',
      `select public.admin_retry_payout($1::uuid, $2::text)`,
      [payoutId, note],
    ));
  const audit = (await as(
    actors.admin,
    'authenticated',
    `select public.admin_list_audit($1::uuid, $2::int) as value`,
    [payoutId, 100],
  ))[0].value;
  const retryAudit = audit.find((entry) => entry.action === 'retry_payout');

  check(
    retryResult.status === 'pending'
      && transferAfter.status === 'pending'
      && transferAfter.payout_status === 'pending'
      && transferAfter.next_attempt_at === null
      && transferAfter.gateway_status === null
      && transferAfter.razorpay_transfer_id === null
      && transferAfter.idempotency_seq === 3
      && /failed/i.test(duplicateRetry)
      && audit.filter((entry) => entry.action === 'retry_payout').length === 1,
    'an audited retry resets only the failed payout transfer and a repeat retry is rejected',
    { retryResult, transferAfter, duplicateRetry, audit },
  );
  check(
    retryAudit?.admin_name === 'O3 Admin'
      && retryAudit.target_id === payoutId
      && retryAudit.details.note === note,
    'admin audit reader returns the acting admin, target, action and note',
    { retryAudit, expectedAdmin: actors.admin, payoutId, note },
  );
});

await scenario('WS7-T06 partial refund passes exact paise and rejects amounts above cash paid', async () => {
  const actors = await createActors();
  const bookingId = await createVisit(actors);
  await addCashBalance(actors, bookingId);
  const { amount: cashPaid } = await one(
    `select coalesce(sum(p.amount), 0)::int as amount
       from public.payments p
      where p.booking_id = $1::uuid
        and p.status = 'paid'
        and p.funding_source is distinct from 'coins'
        and p.razorpay_payment_id is not null`,
    [bookingId],
  );
  await as(
    actors.customer,
    'authenticated',
    `select public.dispute_booking($1::uuid, $2::text)`,
    [bookingId, 'O3 partial-refund test'],
  );

  const overCap = await errorMessage(() =>
    as(
      actors.admin,
      'authenticated',
      `select public.resolve_dispute($1::uuid, $2::public.dispute_outcome, $3::int, $4::text)`,
      [bookingId, 'partial_refund', cashPaid + 1, 'over-cap test'],
    ));
  const before = await one(
    `select b.refund_amount::int as refund_amount,
            (select count(*)::int from public.refunds r join public.payments p on p.id = r.payment_id where p.booking_id = b.id) as refunds
       from public.bookings b where b.id = $1::uuid`,
    [bookingId],
  );

  const refundPaise = 10000;
  await as(
    actors.admin,
    'authenticated',
    `select public.resolve_dispute($1::uuid, $2::public.dispute_outcome, $3::int, $4::text)`,
    [bookingId, 'partial_refund', refundPaise, 'Refund ₹100.00 by admin support'],
  );
  const after = await one(
    `select b.status::text as booking_status, b.refund_amount::int as refund_amount,
            coalesce(sum(r.amount) filter (where r.status <> 'failed'), 0)::int as refunded_paise
       from public.bookings b
       left join public.payments p on p.booking_id = b.id
       left join public.refunds r on r.payment_id = p.id
      where b.id = $1::uuid
      group by b.id`,
    [bookingId],
  );
  const audit = (await as(
    actors.admin,
    'authenticated',
    `select public.admin_list_audit($1::uuid, $2::int) as value`,
    [bookingId, 100],
  ))[0].value;

  check(
    cashPaid >= refundPaise
      && /invalid refund amount/i.test(overCap)
      && before.refund_amount === 0
      && before.refunds === 0
      && after.booking_status === 'completed'
      && after.refund_amount === refundPaise
      && after.refunded_paise === refundPaise,
    'partial dispute refund rejects above-paid paise and applies exactly 10,000 paise for ₹100.00',
    { cashPaid, refundPaise, overCap, before, after },
  );
  check(
    audit.some((entry) => entry.action === 'resolve_dispute'
      && entry.admin_name === 'O3 Admin'
      && entry.details.refund_amount === refundPaise),
    'audit reader exposes the F4-owned dispute resolution entry without duplicating its mutation',
    audit,
  );
});

await scenario('WS7-T15 audit reader rejects non-admin users and applies target filtering', async () => {
  const actors = await createActors();
  await db.query(
    `insert into public.admin_audit_log (admin_id, action, target_id, details)
     values
       ($1::uuid, 'o3_target_action', $2::uuid, $3::jsonb),
       ($1::uuid, 'o3_other_action', $4::uuid, $5::jsonb)`,
    [actors.admin, await uuid(), JSON.stringify({ marker: 'target' }), await uuid(), JSON.stringify({ marker: 'other' })],
  );
  const target = (await one(
    `select target_id from public.admin_audit_log where action = $1::text`,
    ['o3_target_action'],
  )).target_id;
  const forbidden = await errorMessage(() =>
    as(actors.other, 'authenticated', `select public.admin_list_audit($1::uuid, $2::int)`, [null, 100]));
  const rows = (await as(
    actors.admin,
    'authenticated',
    `select public.admin_list_audit($1::uuid, $2::int) as value`,
    [target, 100],
  ))[0].value;

  check(/admin only/i.test(forbidden), 'non-admin users cannot read the audit log', { forbidden });
  check(
    rows.length === 1
      && rows[0].action === 'o3_target_action'
      && rows[0].target_id === target
      && rows[0].details.marker === 'target',
    'admin audit reader filters by target and returns the recorded details',
    rows,
  );
});

finish();

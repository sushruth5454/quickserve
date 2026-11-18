import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const db = new PGlite();
await db.exec(`
  create schema auth;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create table public.profiles (id uuid primary key);
  create table public.admins (user_id uuid primary key references public.profiles(id));
  create table public.feature_flags (
    key text primary key, enabled boolean not null default false, label text not null,
    description text not null default '', group_name text not null default 'General',
    sort_order int not null default 100, updated_at timestamptz not null default now(), updated_by uuid
  );
  create table public.app_config (
    key text primary key, value jsonb not null, updated_at timestamptz not null default now(), updated_by uuid
  );
  create table public.admin_audit_log (
    id bigint generated always as identity primary key, admin_id uuid not null, action text not null,
    target_id uuid, details jsonb not null default '{}'::jsonb, at timestamptz not null default now()
  );
  create table public.notifications (
    id bigint generated always as identity primary key,
    kind text constraint notifications_kind_check check (kind in ('legacy_notification'))
  );
  create table public.bookings (
    id uuid primary key, provider_id uuid not null, service_window tstzrange,
    exclusive boolean not null default true, status text not null, created_at timestamptz not null default now()
  );
  create function public._require_uid() returns uuid language plpgsql stable as $$
  declare v_uid uuid := auth.uid();
  begin
    if v_uid is null then raise exception 'authentication required'; end if;
    return v_uid;
  end $$;
  create function public._assert(p_ok boolean, p_message text) returns void language plpgsql as $$
  begin
    if not coalesce(p_ok, false) then raise exception '%', p_message using errcode = 'P0001'; end if;
  end $$;
  create function public._is_admin() returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.admins where user_id = auth.uid())
  $$;
  create function public._feature_enabled(p_key text) returns boolean language sql stable security definer set search_path = public as $$
    select coalesce((select enabled from public.feature_flags where key = p_key), false)
  $$;
  insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
    values ('sports', true, 'Sports', 'Sports parent capability.', 'Marketplace', 40);
  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant execute on all functions in schema public to anon, authenticated, service_role;
`);

const admin = '00000000-0000-0000-0000-000000000001';
const customer = '00000000-0000-0000-0000-000000000002';
const provider = '00000000-0000-0000-0000-000000000003';
await db.query('insert into public.profiles (id) values ($1), ($2), ($3)', [admin, customer, provider]);
await db.query('insert into public.admins (user_id) values ($1)', [admin]);
await db.exec(fs.readFileSync(new URL('../migrations/0054_addendum_foundations.sql', import.meta.url), 'utf8'));
await db.exec(fs.readFileSync(new URL('../migrations/0055_addendum_foundation_hardening.sql', import.meta.url), 'utf8'));

async function as(userId, role, query, params = []) {
  await db.exec(`
    reset role;
    select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);
    set role ${role};
  `);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

async function expectError(run, pattern, message) {
  try {
    await run();
    assert.fail(`${message}: expected error`);
  } catch (error) {
    assert.match(error.message, pattern, message);
  }
}

const flags = (await db.query(`
  select key, enabled from public.feature_flags
   where key in (
     'home_services_catalogue_v2', 'admin_category_editor', 'recurring_bookings',
     'recurring_skip_pause', 'recurring_reschedule', 'recurring_plan_acceptance',
     'recurring_reminders', 'recurring_billing', 'recurring_prepaid_packages',
     'sports_online_payments', 'sports_instant_booking', 'sports_capacity_slots',
     'sports_multi_slot', 'merchant_calendar', 'admin_rules_editor'
   )
`)).rows;
assert.equal(flags.length, 15, 'all addendum feature switches are registered');
assert.equal(flags.filter((flag) => !['admin_category_editor', 'admin_rules_editor'].includes(flag.key) && flag.enabled).length, 0,
  'customer/merchant capabilities default off');
assert.equal(flags.find((flag) => flag.key === 'admin_category_editor')?.enabled, true);
assert.equal(flags.find((flag) => flag.key === 'admin_rules_editor')?.enabled, true);

await db.query(`update public.feature_flags set enabled = true where key = 'recurring_skip_pause'`);
assert.equal((await db.query(`select public._recurring_feature('recurring_skip_pause') enabled`)).rows[0].enabled, false,
  'child recurring switch cannot bypass disabled recurring parent');
await db.query(`update public.feature_flags set enabled = true where key = 'recurring_bookings'`);
assert.equal((await db.query(`select public._recurring_feature('recurring_skip_pause') enabled`)).rows[0].enabled, true,
  'recurring feature is enabled only when parent and child are on');
assert.equal((await db.query(`select public._recurring_feature('recurring_reschedule') enabled`)).rows[0].enabled, false,
  'a disabled child remains off while its parent is on');
assert.equal((await db.query(`select public._recurring_feature('future_flag') enabled`)).rows[0].enabled, false,
  'unknown recurring child keys fail closed');
await db.query(`update public.feature_flags set enabled = false where key = 'sports'`);
await db.query(`update public.feature_flags set enabled = true where key = 'sports_online_payments'`);
assert.equal((await db.query(`select public._sports_feature('sports_online_payments') enabled`)).rows[0].enabled, false,
  'sports child switch cannot bypass disabled sports parent');

const adminRules = (await as(admin, 'authenticated', `select public.admin_get_rules('recurring_rules') value`))[0].value;
assert.equal(adminRules.horizon_days, 28);
assert.equal(adminRules.billing_grace_hours, 24);
assert.equal((await db.query(`select public._recurring_rule('horizon_days') value`)).rows[0].value, '28',
  'private recurring rule reader returns the configured scalar');
assert.equal((await db.query(`select public._sports_rule('commission_bp') value`)).rows[0].value, '1000',
  'private sports rule reader returns the configured scalar');
await expectError(
  () => as(admin, 'authenticated', `select public._recurring_rule('horizon_days')`),
  /permission denied/,
  'rule readers are not directly executable by authenticated clients',
);
const updatedRules = { ...adminRules, horizon_days: 35, recurring_discount_bp: 250 };
assert.deepEqual((await as(admin, 'authenticated', `select public.admin_set_rules('recurring_rules', $1::jsonb) value`, [
  JSON.stringify(updatedRules),
]))[0].value, updatedRules, 'admin can update validated rules at runtime');
const sportsRules = (await as(admin, 'authenticated', `select public.admin_get_rules('sports_rules') value`))[0].value;
const updatedSportsRules = { ...sportsRules, commission_bp: 1500 };
assert.deepEqual((await as(admin, 'authenticated', `select public.admin_set_rules('sports_rules', $1::jsonb) value`, [
  JSON.stringify(updatedSportsRules),
]))[0].value, updatedSportsRules, 'admin can update sports payment/refund rules at runtime');
await expectError(
  () => as(customer, 'authenticated', `select public.admin_set_rules('recurring_rules', $1::jsonb)`, [JSON.stringify(updatedRules)]),
  /admin only/,
  'non-admin cannot update booking rules',
);
await expectError(
  () => as(admin, 'authenticated', `select public.admin_set_rules('recurring_rules', $1::jsonb)`, [
    JSON.stringify({ ...updatedRules, horizon_days: 120 }),
  ]),
  /horizon_days must be between 1 and 90/,
  'out-of-range recurrence horizon is rejected',
);
await expectError(
  () => as(admin, 'authenticated', `select public.admin_set_rules('recurring_rules', $1::jsonb)`, [
    JSON.stringify({ ...updatedRules, horizon_days: '35' }),
  ]),
  /whole-number JSON number/,
  'numeric strings are rejected instead of stored as typed settings',
);
await expectError(
  () => as(admin, 'authenticated', `select public.admin_set_rules('recurring_rules', $1::jsonb)`, [
    JSON.stringify({ ...updatedRules, extra: true }),
  ]),
  /unknown field/,
  'unknown rule keys are rejected',
);
await expectError(
  () => as(admin, 'authenticated', `select public.admin_set_rules('sports_rules', $1::jsonb)`, [
    JSON.stringify({ ...updatedSportsRules, full_refund_hours: 5, partial_refund_hours: 24 }),
  ]),
  /full_refund_hours must be greater than or equal to partial_refund_hours/,
  'inconsistent sports refund windows are rejected',
);
await expectError(
  () => as(admin, 'authenticated', `select public.admin_set_rules('sports_rules', $1::jsonb)`, [
    JSON.stringify({ ...updatedSportsRules, partial_refund_bp: 5001 }),
  ]),
  /partial_refund_bp must be between 0 and 5000/,
  'partial sports refunds respect the configured maximum basis points',
);
assert.equal((await db.query(`select count(*)::int n from public.admin_audit_log where action = 'set_booking_rules'`)).rows[0].n, 2,
  'successful rule changes are audited');
await db.query(`update public.feature_flags set enabled = false where key = 'admin_rules_editor'`);
await expectError(
  () => as(admin, 'authenticated', `select public.admin_get_rules('sports_rules')`),
  /Admin rules editor is turned off/,
  'admin rules editor switch is enforced server-side',
);

const notificationKinds = [
  'recurring_plan_requested', 'recurring_plan_accepted', 'recurring_plan_declined',
  'recurring_plan_paused', 'recurring_plan_resumed', 'recurring_plan_cancelled',
  'recurring_visit_upcoming', 'recurring_visit_skipped', 'recurring_visit_unavailable',
  'recurring_visit_reschedule_requested', 'recurring_visit_rescheduled',
  'recurring_visit_reschedule_declined', 'recurring_visit_cancelled_by_provider',
  'recurring_visit_completed', 'recurring_payment_due', 'recurring_payment_failed',
  'sports_booking_confirmed', 'sports_payment_due', 'sports_payment_failed',
  'sports_booking_expired', 'sports_booking_cancelled', 'sports_refund_issued',
];
for (const kind of notificationKinds) {
  await as(customer, 'authenticated', `insert into public.notifications (kind) values ($1)`, [kind]);
}
await as(customer, 'authenticated', `insert into public.notifications (kind) values ('legacy_notification')`);
await expectError(
  () => db.query(`insert into public.notifications (kind) values ('unregistered_kind')`),
  /notifications_kind_check/,
  'notification constraint retains a closed allowlist after appending new kinds',
);

const occupiedStart = '2030-01-02T10:00:00Z';
const occupiedEnd = '2030-01-02T11:00:00Z';
const bookingId = '90000000-0000-0000-0000-000000000001';
await db.query(`
  insert into public.bookings (id, provider_id, service_window, exclusive, status)
  values ($1, $2, tstzrange($3::timestamptz, $4::timestamptz, '[)'), true, 'accepted')
`, [bookingId, provider, occupiedStart, occupiedEnd]);
await expectError(
  () => db.query(`select public._assert_provider_window_free($1, tstzrange($2::timestamptz, $3::timestamptz, '[)'), null, true)`,
    [provider, occupiedStart, occupiedEnd]),
  /provider_unavailable/,
  'overlapping provider window is rejected under the lock',
);
await db.query(`
  select public._assert_provider_window_free($1, tstzrange($2::timestamptz, $3::timestamptz, '[)'), $4, true)
`, [provider, occupiedStart, occupiedEnd, bookingId]);
assert.equal((await db.query(`select count(*)::int n from public.notifications`)).rows[0].n, notificationKinds.length + 1,
  'all new and legacy notification kinds can be stored');

await db.close();
console.log('Addendum foundations migration tests passed');

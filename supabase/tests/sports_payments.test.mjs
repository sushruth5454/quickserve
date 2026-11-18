import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  '0009_provider_onboarding.sql', '0010_notification_freshness.sql', '0011_payout_rails.sql',
  '0012_matching_foundations.sql', '0013_review_matching.sql', '0014_travel_requests.sql',
  '0015_seva_coins.sql', '0016_leakage_programme.sql', '0017_creator_config.sql',
  '0018_archetype_core.sql', '0019_fixed_package_booking.sql', '0020_proposal_enum_values.sql',
  '0021_cancellation_availability_payouts.sql', '0022_time_based_booking.sql',
  '0023_proposal_milestone_booking.sql', '0024_activate_creator_event_categories.sql',
  '0025_targeted_proposal_requests.sql', '0026_fix_proposal_prepare_payment.sql',
  '0027_restore_fixed_prepare_payment.sql', '0028_auto_approve_provider_links.sql',
  '0029_single_due_payment.sql', '0030_review_fixes.sql', '0031_holiday_mode_enforcement.sql',
  '0032_notification_centre.sql', '0033_city_waitlist.sql', '0034_targeted_request_radius.sql',
  '0035_request_coordinates.sql', '0036_provider_service_city.sql', '0037_proposal_validity_cap.sql',
  '0038_proposal_lead_time.sql', '0039_proposal_start_code.sql', '0040_urgent_proposals.sql',
  '0041_admin_support.sql', '0042_feature_registry.sql', '0043_commission_config.sql',
  '0044_creator_revisions.sql', '0045_preferred_language.sql', '0046_managed_geography.sql',
  '0047_coins_config.sql', '0048_sports.sql', '0049_shops_catalogue.sql', '0050_rfq.sql',
  '0051_ai_usage_v3.sql', '0052_merchant_staff.sql', '0053_activity_contracts.sql',
  '0054_addendum_foundations.sql', '0055_addendum_foundation_hardening.sql',
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
await db.exec(migration('0058_sports_payments.sql'));
await db.exec("set timezone = 'UTC'");

let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log(`ok  : ${message}`);
  else { failures++; console.error(`FAIL: ${message}`); }
};
async function as(uid, role, query, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return (await db.query(query, params)).rows; }
  finally { await db.exec('reset role;'); }
}
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const one = async (query, params = []) => (await db.query(query, params)).rows[0];
const json = (value) => typeof value === 'string' ? JSON.parse(value) : value;

const owner = '00000000-0000-0000-0000-0000000000a1';
const customer1 = '00000000-0000-0000-0000-0000000000c1';
const customer2 = '00000000-0000-0000-0000-0000000000c2';
const admin = '00000000-0000-0000-0000-0000000000b1';
await db.exec(`
  insert into auth.users (id, phone, raw_user_meta_data) values
    ('${owner}', '+919999000001', '{}'), ('${customer1}', '+919999000002', '{}'),
    ('${customer2}', '+919999000003', '{}'), ('${admin}', '+918888888888', '{}');
  update public.profiles set full_name = 'Sports test user';
  insert into public.admins (user_id) values ('${admin}');
  update public.feature_flags set enabled = true
   where key in ('sports', 'sports_online_payments', 'sports_instant_booking',
                 'sports_capacity_slots', 'sports_multi_slot');
  update public.app_config
     set value = value || '{"customer_fee_paise":500,"commission_bp":1000}'::jsonb
   where key = 'sports_rules';
`);

const activity = (await one(`select id from public.sports_activities where slug = 'badminton'`)).id;
const venue = (await as(owner, 'authenticated', `
  select public.save_sports_venue(
    null::uuid, 'Test Sports Hall', 'Courts for local players.', '1 Test Road',
    'Sangareddy', 'Center', 16.5::double precision, 80.6::double precision,
    array['Parking']::text[], array['https://example.test/venue.jpg']::text[],
    array['online', 'pay_at_venue']::text[]
  ) id
`))[0].id;
const instantResource = (await as(owner, 'authenticated', `
  select public.save_sports_resource($1::uuid, null::uuid, $2::uuid, 'Instant Court',
    60, true, 'instant', 1) id
`, [venue, activity]))[0].id;
const capacityResource = (await as(owner, 'authenticated', `
  select public.save_sports_resource($1::uuid, null::uuid, $2::uuid, 'Class Court',
    60, true, 'instant', 2) id
`, [venue, activity]))[0].id;
const approvalResource = (await as(owner, 'authenticated', `
  select public.save_sports_resource($1::uuid, null::uuid, $2::uuid, 'Approval Court',
    60, true, 'approval', 5) id
`, [venue, activity]))[0].id;
const tomorrow = (await one(`select (now() at time zone 'Asia/Kolkata')::date + 1 as day`)).day;
const weekday = (await one(`select extract(dow from $1::date)::smallint weekday`, [tomorrow])).weekday;
await as(owner, 'authenticated', `
  select public.set_sports_hours($1::uuid, $2::smallint, time '08:00', time '20:00')
`, [venue, weekday]);
for (const resource of [instantResource, capacityResource, approvalResource]) {
  await as(owner, 'authenticated', `
    select public.save_sports_price_rule($1::uuid, null::uuid, null::smallint,
      time '08:00', time '20:00', 20000, 'Standard')
  `, [resource]);
}
await as(owner, 'authenticated', `select public.submit_sports_venue($1::uuid)`, [venue]);
await as(admin, 'authenticated', `select public.admin_set_venue_status($1::uuid, 'verified', '')`, [venue]);
await db.query(`
  insert into public.provider_payout_accounts
    (provider_id, rail, activation_status, razorpay_account_id, fund_account_id)
  values ($1::uuid, 'payouts', 'activated', 'acc_sports_owner', 'fa_sports_owner')
`, [owner]);
const syncedOwnerAccount = json((await as(null, 'service_role', `
  select public.sync_provider_payout_status('acc_sports_owner', 'activated', '[]'::jsonb, now()) result
`))[0].result);
ok(syncedOwnerAccount.ok === true
  && (await one(`select activation_status from public.provider_payout_accounts where provider_id=$1`,
    [owner])).activation_status === 'activated',
  '[SP-05] venue-owner payout status sync succeeds without a providers row');

const book = async (user, resource, start, key, mode = 'online', slots = 1, participants = 1) => {
  const rows = await as(user, 'authenticated', `
    select public.book_sports_slot(
      $1::uuid, $2::timestamptz, $3::int, $4::int, $5::text, ''::text, $6::text
    ) result
  `, [resource, start, slots, participants, mode, key]);
  return json(rows[0].result);
};
const prepare = async (bookingId, user = customer1) =>
  (await as(null, 'service_role', `
    select * from public.prepare_sports_payment($1::uuid, $2::uuid)
  `, [bookingId, user]))[0];
const attachOrder = async (paymentId, orderId) =>
  db.query(`update public.payments set razorpay_link_id = $1, short_url = 'https://pay.test' where id = $2`,
    [orderId, paymentId]);
const recordPaid = async (orderId, paymentId, amount) =>
  json((await as(null, 'service_role', `
    select public.record_sports_payment_paid($1::text, $2::text, $3::int) result
  `, [orderId, paymentId, amount]))[0].result);
const slotAt = async (time) =>
  (await one(`select ($1::date + $2::time) at time zone 'Asia/Kolkata' starts_at`, [tomorrow, time])).starts_at;

await db.exec(`
  create function public.test_book_sports_as(
    p_uid uuid, p_resource uuid, p_start timestamptz, p_slots int,
    p_participants int, p_mode text, p_key text
  ) returns jsonb language plpgsql as $$
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    return public.book_sports_slot(p_resource, p_start, p_slots, p_participants, p_mode, '', p_key);
  end
  $$;
`);

const venueRead = json((await as(owner, 'authenticated',
  `select public.get_my_business_sports_venues() result`))[0].result)[0];
ok(venueRead.venue.payment_modes.includes('online')
  && venueRead.resources.some((item) => item.booking_mode === 'instant' && item.capacity === 1)
  && venueRead.payout_account_status === 'activated'
  && venueRead.payout_account_ready === true,
'[SP-01] venue settings read returns payment modes, resource capacity/mode, and payout readiness');

const savedVenueStatus = (await one(`select status from public.sports_venues where id = $1`, [venue])).status;
await as(owner, 'authenticated', `
  select public.save_sports_venue(
    $1::uuid, 'Test Sports Hall', 'Courts for local players.', '1 Test Road',
    'Sangareddy', 'Center', 16.5::double precision, 80.6::double precision,
    array['Parking']::text[], array['https://example.test/venue.jpg']::text[],
    array['pay_at_venue']::text[]
  )
`, [venue]);
const paymentModeEditStatus = (await one(`select status from public.sports_venues where id = $1`, [venue])).status;
ok(savedVenueStatus === 'verified' && paymentModeEditStatus === 'verified',
  '[SP-01] payment-mode-only venue settings preserve verification status');
await as(owner, 'authenticated', `
  select public.save_sports_venue(
    $1::uuid, 'Test Sports Hall', 'Courts for local players.', '1 Test Road',
    'Sangareddy', 'Center', 16.5::double precision, 80.6::double precision,
    array['Parking']::text[], array['https://example.test/venue.jpg']::text[],
    array['online', 'pay_at_venue']::text[]
  )
`, [venue]);

const instantSlot = await slotAt('09:00');
const held = await book(customer1, instantResource, instantSlot, 'sp-hold-1');
ok(held.status === 'pending_payment' && held.total_paise === 20500 && held.hold_expires_at,
  '[SP-01] instant online booking creates a priced payment hold');
const heldSlot = await as(customer1, 'authenticated', `
  select state, remaining from public.get_sports_slots($1::uuid, $2::date) where starts_at = $3::timestamptz
`, [instantResource, tomorrow, instantSlot]);
ok(heldSlot[0]?.state === 'taken' && heldSlot[0]?.remaining === 0,
  '[SP-01] a live payment hold consumes the slot capacity');

const multiSlotStart = await slotAt('11:00');
const multiSlotBooking = await book(customer2, capacityResource, multiSlotStart, 'sp-multi-slot',
  'online', 2, 1);
const multiSlotEnd = (await one(`select ends_at from public.sports_bookings where id=$1`,
  [multiSlotBooking.booking_id])).ends_at;
ok(multiSlotBooking.total_paise === 40500
  && new Date(multiSlotEnd).getTime() - new Date(multiSlotStart).getTime() === 2 * 60 * 60 * 1000,
  '[SP-01] multi-slot booking sums each server price and reserves consecutive slots');
await db.query(`update public.feature_flags set enabled=false where key='sports_multi_slot'`);
const multiSlotOffStart = await slotAt('13:00');
const multiSlotOff = await fails(() =>
  book(customer1, capacityResource, multiSlotOffStart, 'sp-multi-slot-off', 'online', 2, 1));
ok(/turned off/.test(multiSlotOff ?? ''),
  '[SP-05] the multi-slot child switch refuses new multi-slot bookings');
await db.query(`update public.feature_flags set enabled=true where key='sports_multi_slot'`);

const firstAttempt = await prepare(held.booking_id);
const reusedAttempt = await prepare(held.booking_id);
ok(firstAttempt.payment_id === reusedAttempt.payment_id && firstAttempt.amount === 20500
  && firstAttempt.purpose === 'fixed',
  '[SP-09] payment preparation reuses a created server-priced attempt');
const wrongOwner = await fails(() => prepare(held.booking_id, customer2));
ok(/only the customer can pay/.test(wrongOwner ?? ''),
  '[SP-09] a different customer cannot prepare payment');

const duplicateKey = await book(customer1, instantResource, instantSlot, 'sp-hold-1');
ok(duplicateKey.booking_id === held.booking_id,
  '[SP-04] the same customer idempotency key returns its existing booking');
const secondCustomer = await fails(() =>
  book(customer2, instantResource, instantSlot, 'sp-hold-2'));
ok(/capacity|available/.test(secondCustomer ?? ''),
  '[SP-02] a second customer cannot take a held slot');

const capacitySlot = await slotAt('10:00');
const capacityRace = await Promise.all([
  db.query(`select public.test_book_sports_as($1::uuid,$2::uuid,$3::timestamptz,1,2,'online','sp-cap-2') result`,
    [customer1, capacityResource, capacitySlot]).then((r) => ({ ok: true, result: json(r.rows[0].result) }))
    .catch((e) => ({ ok: false, error: e.message })),
  db.query(`select public.test_book_sports_as($1::uuid,$2::uuid,$3::timestamptz,1,1,'online','sp-cap-1') result`,
    [customer2, capacityResource, capacitySlot]).then((r) => ({ ok: true, result: json(r.rows[0].result) }))
    .catch((e) => ({ ok: false, error: e.message })),
]);
ok(capacityRace.filter((result) => result.ok).length === 1,
  '[SP-02] concurrent bookings serialize so participant occupancy never exceeds capacity');
const tooManySlot = await slotAt('11:00');
const tooMany = await fails(() =>
  book(customer1, capacityResource, tooManySlot, 'sp-too-many', 'online', 1, 4));
ok(/capacity|participants/.test(tooMany ?? ''),
  '[SP-03] a request larger than the resource capacity is refused');

const invalidCapacity = await fails(() => as(owner, 'authenticated', `
  select public.save_sports_resource($1::uuid, $2::uuid, $3::uuid, 'Bad capacity',
    60, true, 'instant', 101)
`, [venue, null, activity]));
ok(/capacity|check constraint/.test(invalidCapacity ?? ''),
  '[SP-03] resource capacity cannot exceed the schema limit');

const approvalSlot = await slotAt('12:00');
const approval = await book(customer1, approvalResource, approvalSlot, 'sp-approval');
await as(owner, 'authenticated', `select public.decide_sports_booking($1::uuid, true, '')`, [approval.booking_id]);
const awaiting = (await one(`select status, pay_by from public.sports_bookings where id = $1`, [approval.booking_id]));
ok(awaiting.status === 'awaiting_payment' && awaiting.pay_by
  && (await one(`select count(*)::int n from public.notifications where kind='sports_payment_due' and user_id=$1`,
    [customer1])).n === 1,
  '[SP-06] owner acceptance moves an online request to awaiting payment and notifies the customer');
const approvalAttempt = await prepare(approval.booking_id);
await attachOrder(approvalAttempt.payment_id, 'order_sp_approval');
const paidApproval = await recordPaid('order_sp_approval', 'pay_sp_approval', approvalAttempt.amount);
const approvalAfterPay = (await one(`select status, paid_at from public.sports_bookings where id = $1`, [approval.booking_id]));
ok(paidApproval.ok === true && approvalAfterPay.status === 'accepted' && approvalAfterPay.paid_at,
  '[SP-06, SP-11] paying before the pay-by deadline accepts the approved booking');

const approvalExpirySlot = await slotAt('13:00');
const approvalExpiring = await book(customer2, approvalResource, approvalExpirySlot, 'sp-approval-expiry');
await as(owner, 'authenticated', `select public.decide_sports_booking($1::uuid, true, '')`,
  [approvalExpiring.booking_id]);
const approvalExpiringAttempt = await prepare(approvalExpiring.booking_id, customer2);
await attachOrder(approvalExpiringAttempt.payment_id, 'order_sp_approval_expiry');
await db.query(`update public.sports_bookings set pay_by=now()-interval '1 second' where id=$1`,
  [approvalExpiring.booking_id]);

const onlineOff = await slotAt('13:00');
await db.query(`update public.feature_flags set enabled = false where key = 'sports_online_payments'`);
const onlineDisabled = await fails(() =>
  book(customer1, instantResource, onlineOff, 'sp-online-off'));
ok(/turned off/.test(onlineDisabled ?? ''),
  '[SP-05] the online-payment child switch refuses new online bookings');
const payAtVenue = await book(customer1, instantResource, onlineOff, 'sp-venue-pay', 'pay_at_venue');
ok(payAtVenue.status === 'accepted'
  && (await one(`select count(*)::int n from public.payments where sports_booking_id=$1`,
    [payAtVenue.booking_id])).n === 0
  && (await one(`select count(*)::int n from public.notifications
                  where kind='sports_booking_confirmed' and user_id in ($1,$2)
                    and data ->> 'sports_booking_id' = $3`,
    [customer1, owner, payAtVenue.booking_id])).n === 2,
  '[SP-07, SP-15] instant pay-at-venue booking remains immediate and payment-free when online payments are off');

await db.query(`update public.feature_flags set enabled = true where key = 'sports_online_payments'`);
await db.query(`update public.feature_flags set enabled = false where key = 'sports'`);
await db.query(`update public.feature_flags set enabled = true where key = 'sports_online_payments'`);
const parentOffSlot = await slotAt('14:00');
const parentOff = await fails(() =>
  book(customer2, instantResource, parentOffSlot, 'sp-parent-off'));
ok(/turned off/.test(parentOff ?? ''),
  '[SP-05] an enabled online child cannot bypass a disabled sports parent');
const visibleWhenOff = await as(customer1, 'authenticated', `select public.get_my_sports_bookings() result`);
ok(json(visibleWhenOff[0].result).some((item) => item.id === held.booking_id),
  '[SP-15] existing sports bookings remain readable while the parent feature is off');
const directVisibleWhenOff = await as(customer1, 'authenticated',
  `select id from public.sports_bookings where id=$1`, [held.booking_id]);
ok(directVisibleWhenOff.length === 1,
  '[SP-15] participant RLS keeps an existing booking readable while sports is off');
const preparedWhenOff = await prepare(held.booking_id);
ok(preparedWhenOff.payment_id === firstAttempt.payment_id,
  '[SP-15] an existing booking can reuse its payment attempt while feature switches are off');
await db.query(`update public.feature_flags set enabled = true where key = 'sports'`);

const parentApprovalSlot = await slotAt('15:00');
await db.query(`update public.feature_flags set enabled = false where key = 'sports_instant_booking'`);
const approvalFallback = await book(customer1, instantResource, parentApprovalSlot, 'sp-instant-off', 'pay_at_venue');
ok(approvalFallback.status === 'requested',
  '[SP-05] disabling instant booking fails closed to the approval flow');
await db.query(`update public.feature_flags set enabled = true where key = 'sports_instant_booking'`);

const onlinePrerequisiteSlot = await slotAt('14:00');
await db.query(`update public.sports_venues set payment_modes=array['pay_at_venue'] where id=$1`, [venue]);
const venueModeOff = await fails(() =>
  book(customer2, instantResource, onlinePrerequisiteSlot, 'sp-venue-mode-off'));
ok(/does not accept online payment yet/.test(venueModeOff ?? ''),
  '[SP-05] online booking is refused when the venue does not allow online payment');
await db.query(`update public.sports_venues set payment_modes=array['online','pay_at_venue'] where id=$1`, [venue]);
await db.query(`delete from public.provider_payout_accounts where provider_id=$1`, [owner]);
const payoutNotReady = await fails(() =>
  book(customer2, instantResource, onlinePrerequisiteSlot, 'sp-payout-not-ready'));
ok(/does not accept online payment yet/.test(payoutNotReady ?? ''),
  '[SP-05] online booking is refused until the venue owner payout account is verified');
await db.query(`
  insert into public.provider_payout_accounts
    (provider_id, rail, activation_status, razorpay_account_id, fund_account_id)
  values ($1::uuid, 'payouts', 'activated', 'acc_sports_owner', 'fa_sports_owner')
`, [owner]);

const retrySlot = await slotAt('16:00');
const retryBooking = await book(customer1, instantResource, retrySlot, 'sp-retry');
const failedAttempt = await prepare(retryBooking.booking_id);
await db.query(`update public.payments set status='failed' where id=$1`, [failedAttempt.payment_id]);
const retriedAttempt = await prepare(retryBooking.booking_id);
ok(retriedAttempt.payment_id !== failedAttempt.payment_id,
  '[SP-10] a failed payment attempt can be retried while the hold remains valid');
await attachOrder(retriedAttempt.payment_id, 'order_sp_retry');
const mismatch = await recordPaid('order_sp_retry', 'pay_sp_wrong_amount', retriedAttempt.amount - 1);
ok(mismatch.ok === false && /amount mismatch/.test(mismatch.error ?? ''),
  '[SP-11] a gateway amount mismatch is refused');
const successfulRetry = await recordPaid('order_sp_retry', 'pay_sp_retry', retriedAttempt.amount);
const retryStatus = (await one(`select status from public.sports_bookings where id=$1`, [retryBooking.booking_id])).status;
ok(successfulRetry.ok === true && retryStatus === 'accepted',
  '[SP-10, SP-11] a valid retry payment accepts the booking');
const duplicatePaid = await recordPaid('order_sp_retry', 'pay_sp_retry', retriedAttempt.amount);
ok(duplicatePaid.duplicate === true,
  '[SP-11] recording the same gateway payment twice is idempotent');

const legacySlot = await slotAt('17:00');
const legacyBookingId = (await as(customer2, 'authenticated', `
  select public.request_sports_slot($1::uuid, $2::timestamptz, 1, '') id
`, [instantResource, legacySlot]))[0].id;
const legacyBefore = (await one(`select status, payment_mode, participants from public.sports_bookings where id=$1`,
  [legacyBookingId]));
await as(owner, 'authenticated', `select public.decide_sports_booking($1::uuid, true, '')`, [legacyBookingId]);
const legacyAfter = (await one(`select status from public.sports_bookings where id=$1`, [legacyBookingId])).status;
ok(legacyBefore.status === 'requested' && legacyBefore.payment_mode === 'pay_at_venue'
  && legacyBefore.participants === 1 && legacyAfter === 'accepted',
  '[SP-08] request_sports_slot keeps its legacy pay-at-venue request and accepted statuses');

const holdExpirySlot = await slotAt('18:00');
const expiring = await book(customer1, instantResource, holdExpirySlot, 'sp-expiry');
const expiringAttempt = await prepare(expiring.booking_id);
await attachOrder(expiringAttempt.payment_id, 'order_sp_late');
await db.query(`
  update public.sports_bookings set hold_expires_at=now()-interval '1 second'
   where id=$1
`, [expiring.booking_id]);
await db.query(`update public.feature_flags set enabled=false where key in ('sports','sports_online_payments')`);
await as(null, 'service_role', `select public.expire_sports_requests()`);
const expiredState = await one(`select status from public.sports_bookings where id=$1`, [expiring.booking_id]);
const retiredAttempt = await one(`select status, cancel_link_pending from public.payments where id=$1`,
  [expiringAttempt.payment_id]);
ok(expiredState.status === 'expired' && retiredAttempt.status === 'failed'
  && retiredAttempt.cancel_link_pending === true,
  '[SP-12, SP-15] expiry retires payment attempts and works while sports switches are off');
const expiredApproval = await one(`select status from public.sports_bookings where id=$1`,
  [approvalExpiring.booking_id]);
const retiredApprovalAttempt = await one(`select status from public.payments where id=$1`,
  [approvalExpiringAttempt.payment_id]);
ok(expiredApproval.status === 'expired' && retiredApprovalAttempt.status === 'failed',
  '[SP-12] an awaiting-payment booking expires at pay_by and retires its created attempt');
const latePayment = await recordPaid('order_sp_late', 'pay_sp_late', expiringAttempt.amount);
const lateRows = await one(`
  select p.status, b.refund_paise,
         (select coalesce(sum(r.amount),0)::int from public.refunds r where r.payment_id=p.id) refunded
    from public.payments p join public.sports_bookings b on b.id=p.sports_booking_id where p.id=$1
`, [expiringAttempt.payment_id]);
ok(latePayment.ok === true && lateRows.status === 'refund_pending'
  && lateRows.refunded === expiringAttempt.amount && lateRows.refund_paise === expiringAttempt.amount,
  '[SP-12, SP-15] a late payment is recorded and fully refunded after expiry even with switches off');
await db.query(`update public.feature_flags set enabled=true where key='sports'`);
const freedHoldSlot = await as(customer1, 'authenticated', `
  select state from public.get_sports_slots($1::uuid, $2::date) where starts_at=$3::timestamptz
`, [instantResource, tomorrow, holdExpirySlot]);
ok(freedHoldSlot[0]?.state === 'free',
  '[SP-12] expiring a payment hold releases the slot capacity');

const makePaidBooking = async (user, start, key, price = 20000, fee = 500) => {
  const bookingId = (await one(`
    insert into public.sports_bookings
      (customer_id,venue_id,resource_id,starts_at,ends_at,status,price_paise,note,expires_at,
       payment_mode,participants,customer_fee_paise,total_paise,commission_bp,paid_at)
    values ($1,$2,$3,$4,$4+interval '1 hour','accepted',$5,'',now()+interval '2 hours',
       'online',1,$6,$5+$6,1000,now())
    returning id
  `, [user, venue, instantResource, start, price, fee])).id;
  const paymentId = (await one(`
    insert into public.payments (sports_booking_id,purpose,amount,status,razorpay_link_id,razorpay_payment_id,paid_at)
    values ($1,'fixed',$2,'paid',$3,$4,now()) returning id
  `, [bookingId, price + fee, `order_${key}`, `pay_${key}`])).id;
  return { bookingId, paymentId, amount: price + fee };
};

const fullRefundStart = (await one(`select now()+interval '48 hours' starts_at`)).starts_at;
const fullRefund = await makePaidBooking(customer1, fullRefundStart, 'sp-full');
await as(customer1, 'authenticated', `select public.cancel_sports_booking($1::uuid, 'customer cancel')`,
  [fullRefund.bookingId]);
const fullRefundRow = await one(`select status, refund_paise from public.sports_bookings where id=$1`,
  [fullRefund.bookingId]);
const fullRefundAmount = (await one(`
  select coalesce(sum(r.amount),0)::int amount from public.refunds r
    join public.payments p on p.id=r.payment_id where p.sports_booking_id=$1
`, [fullRefund.bookingId])).amount;
ok(fullRefundRow.status === 'cancelled' && fullRefundAmount === 20000
  && fullRefundRow.refund_paise === 20000,
  '[SP-13, SP-15] customer cancellation refunds 100% of price but not the customer fee with switches off');

const partialRefundStart = (await one(`select now()+interval '10 hours' starts_at`)).starts_at;
const partialRefund = await makePaidBooking(customer2, partialRefundStart, 'sp-partial');
await as(customer2, 'authenticated', `select public.cancel_sports_booking($1::uuid, 'customer cancel')`,
  [partialRefund.bookingId]);
const partialRefundRow = await one(`
  select b.refund_paise,
         (select coalesce(sum(r.amount),0)::int from public.refunds r
           join public.payments p on p.id=r.payment_id where p.sports_booking_id=b.id) refunded
    from public.sports_bookings b where b.id=$1
`, [partialRefund.bookingId]);
ok(partialRefundRow.refund_paise === 10000 && partialRefundRow.refunded === 10000,
  '[SP-13] the configured 5000-basis-point partial refund returns 50% of price');

const noRefundStart = (await one(`select now()+interval '2 hours' starts_at`)).starts_at;
const noRefund = await makePaidBooking(customer1, noRefundStart, 'sp-none');
await as(customer1, 'authenticated', `select public.cancel_sports_booking($1::uuid, 'customer cancel')`,
  [noRefund.bookingId]);
const noRefundRow = await one(`select refund_paise from public.sports_bookings where id=$1`, [noRefund.bookingId]);
ok(noRefundRow.refund_paise === 0
  && (await one(`select count(*)::int n from public.refunds r join public.payments p on p.id=r.payment_id
                 where p.sports_booking_id=$1`, [noRefund.bookingId])).n === 0,
  '[SP-13] cancellation inside the partial-refund cutoff queues no refund');

const venueRefund = await makePaidBooking(customer2, fullRefundStart, 'sp-venue-cancel');
await as(owner, 'authenticated', `
  select public.cancel_sports_booking($1::uuid, 'venue maintenance')
`, [venueRefund.bookingId]);
const venueRefundAmount = (await one(`
  select coalesce(sum(r.amount),0)::int amount from public.refunds r
    join public.payments p on p.id=r.payment_id where p.sports_booking_id=$1
`, [venueRefund.bookingId])).amount;
ok(venueRefundAmount === venueRefund.amount,
  '[SP-13] venue cancellation refunds the full customer payment including fee');

const completionStart = (await one(`select now()-interval '2 hours' starts_at`)).starts_at;
const payoutBooking = await makePaidBooking(customer1, completionStart, 'sp-payout');
await db.query(`
  update public.app_config
     set value=jsonb_set(value, '{commission_bp}', '2000'::jsonb)
   where key='sports_rules'
`);
await db.query(`update public.feature_flags set enabled=false where key in ('sports','sports_online_payments')`);
await as(null, 'service_role', `select public.expire_sports_requests()`);
const payout = await one(`
  select id, booking_id, sports_booking_id, provider_id, payee_id, gross, commission,
         gst_on_commission, amount, status, release_after
    from public.payouts where sports_booking_id=$1
`, [payoutBooking.bookingId]);
const allocated = await one(`
  select id, source_payment_id, amount from public.payout_transfers where payout_id=$1
`, [payout.id]);
ok(payout.booking_id === null && payout.sports_booking_id === payoutBooking.bookingId
  && payout.provider_id === null && payout.payee_id === owner
  && payout.gross === 20000 && payout.commission === 2000
  && payout.gst_on_commission === 360 && payout.amount === 17640
  && payout.status === 'pending' && allocated.source_payment_id === payoutBooking.paymentId
  && allocated.amount === 17640,
  '[SP-14, SP-15] completion creates an idempotent sports payout with snapshotted commission, GST, payee, and payment transfer');

await db.query(`update public.payouts set release_after=now()-interval '1 second' where id=$1`, [payout.id]);
await db.query(`update public.payout_transfers set release_after=now()-interval '1 second' where payout_id=$1`,
  [payout.id]);
const claimed = await as(null, 'service_role', `select * from public.claim_due_transfers(10)`);
const sportsClaim = claimed.find((item) => item.transfer_id === allocated.id);
ok(sportsClaim?.provider_id === owner && sportsClaim?.booking_id === payoutBooking.bookingId
  && sportsClaim?.fund_account_id === 'fa_sports_owner',
  '[SP-14] payout claiming resolves a sports payee without changing provider earnings ownership');
if (sportsClaim) {
  await as(null, 'service_role', `select public.complete_transfer($1::uuid, 'tr_sports_test')`,
    [sportsClaim.transfer_id]);
}
ok((await one(`select status from public.payouts where id=$1`, [payout.id])).status === 'transferred',
  '[SP-14, SP-15] transfer completion settles an existing sports payout while feature switches are off');

const flagPayVenueSlot = await slotAt('19:00');
await db.query(`update public.feature_flags set enabled=true where key='sports'`);
const flagOffVenue = await book(customer1, instantResource, flagPayVenueSlot, 'sp-online-off-venue', 'pay_at_venue');
const freshOnlineOff = await fails(() =>
  book(customer2, instantResource, flagPayVenueSlot, 'sp-online-off-fresh'));
ok(flagOffVenue.status === 'accepted' && /turned off/.test(freshOnlineOff ?? ''),
  '[SP-05, SP-15] pay-at-venue remains available while new online bookings are refused');

const beforeClose = await as(customer1, 'authenticated', `
  select public.get_sports_booking($1::uuid) result
`, [held.booking_id]);
ok(json(beforeClose[0].result).id === held.booking_id,
  '[SP-15] existing booking detail remains readable after online payments are disabled');

await db.close();
if (failures) process.exit(1);

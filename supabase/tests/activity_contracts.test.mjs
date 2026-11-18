import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create schema auth;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema auth, public to anon, authenticated;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated;
  create table public.feature_flags (key text primary key, enabled boolean not null default false);
  create function public._require_uid() returns uuid language plpgsql stable as $$
  declare v_uid uuid := auth.uid();
  begin
    if v_uid is null then raise exception 'authentication required'; end if;
    return v_uid;
  end $$;
  create function public._assert(p_ok boolean, p_message text) returns void language plpgsql immutable as $$
  begin
    if not coalesce(p_ok, false) then raise exception '%', p_message; end if;
  end $$;
  create function public._feature_enabled(p_key text) returns boolean language sql stable security definer set search_path = public as $$
    select coalesce((select enabled from public.feature_flags where key = p_key), false)
  $$;
  create function public._shops_products_enabled() returns boolean language sql stable security definer set search_path = public as $$
    select public._feature_enabled('products')
  $$;
  create function public._shops_enquiries_enabled() returns boolean language sql stable security definer set search_path = public as $$
    select public._feature_enabled('products') and public._feature_enabled('product_enquiries')
  $$;
  create function public._product_rfq_enabled() returns boolean language sql stable security definer set search_path = public as $$
    select public._feature_enabled('product_rfq') and public._shops_products_enabled()
  $$;
  create table public.bookings (id uuid primary key, customer_id uuid not null);
  create table public.service_requests (id uuid primary key, customer_id uuid not null);
  create table public.notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    kind text not null,
    booking_id uuid,
    data jsonb not null default '{}'::jsonb,
    read_at timestamptz
  );
  create table public.activity_chat_unread (
    user_id uuid not null,
    booking_id uuid not null,
    role text not null,
    unread int not null
  );
  create function public.get_unread_counts()
  returns table (booking_id uuid, role text, unread int)
  language sql stable security definer set search_path = public as $$
    select u.booking_id, u.role, u.unread
      from public.activity_chat_unread u
     where u.user_id = auth.uid()
  $$;
  create table public.product_categories (id uuid primary key, name text not null);
  create table public.rfqs (
    id uuid primary key, customer_id uuid not null, category_id uuid not null,
    title text not null, city text not null, area text not null, needed_by date not null,
    expires_at timestamptz not null, created_at timestamptz not null, status text not null
  );
  create table public.rfq_recipients (rfq_id uuid not null);
  create table public.supplier_quotes (rfq_id uuid not null);
  create table public.product_enquiries (customer_id uuid not null, customer_unread int not null);
  create table public.sports_venues (id uuid primary key, owner_id uuid not null, name text not null);
  create table public.sports_activities (id uuid primary key, name text not null);
  create table public.sports_resources (id uuid primary key, venue_id uuid not null, activity_id uuid not null, name text not null);
  create table public.sports_bookings (
    id uuid primary key, customer_id uuid not null, venue_id uuid not null, resource_id uuid not null,
    starts_at timestamptz not null, ends_at timestamptz not null, status text not null,
    price_paise int not null, expires_at timestamptz not null
  );
`);

await db.exec(fs.readFileSync(new URL('../migrations/0053_activity_contracts.sql', import.meta.url), 'utf8'));

let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log(`ok  : ${message}`);
  else { failures++; console.error(`FAIL: ${message}`); }
};

async function as(userId, query, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false); set role authenticated;`);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

async function expectError(run, pattern, message) {
  try {
    await run();
    ok(false, `${message} (no error)`);
  } catch (error) {
    ok(pattern.test(error.message), message);
  }
}

const customer = '00000000-0000-0000-0000-000000000001';
const otherCustomer = '00000000-0000-0000-0000-000000000002';
const booking = '10000000-0000-0000-0000-000000000001';
const otherBooking = '10000000-0000-0000-0000-000000000002';
const request = '20000000-0000-0000-0000-000000000001';
const otherRequest = '20000000-0000-0000-0000-000000000002';
const rfq = '30000000-0000-0000-0000-000000000001';
const otherRfq = '30000000-0000-0000-0000-000000000002';
const sportsBooking = '40000000-0000-0000-0000-000000000001';
const ownerOnlyBooking = '40000000-0000-0000-0000-000000000002';
const venue = '50000000-0000-0000-0000-000000000001';
const resource = '60000000-0000-0000-0000-000000000001';
const activity = '70000000-0000-0000-0000-000000000001';
const category = '80000000-0000-0000-0000-000000000001';

await db.exec(`
  insert into public.feature_flags (key, enabled) values
    ('products', true), ('product_enquiries', true), ('product_rfq', true), ('sports', true);
`);
await db.query(`insert into public.bookings (id, customer_id) values ($1, $2), ($3, $4)`,
  [booking, customer, otherBooking, otherCustomer]);
await db.query(`insert into public.activity_chat_unread (user_id, booking_id, role, unread) values
  ($1, $2, 'customer', 3), ($1, $3, 'provider', 17)`,
  [customer, booking, otherBooking]);
await db.query(`insert into public.service_requests (id, customer_id) values ($1, $2), ($3, $4)`,
  [request, customer, otherRequest, otherCustomer]);
await db.query(`insert into public.product_categories (id, name) values ($1, 'Tiles')`, [category]);
await db.query(`insert into public.rfqs
  (id, customer_id, category_id, title, city, area, needed_by, expires_at, created_at, status)
  values
    ($1, $2, $3, 'Bathroom tiles', 'Vijayawada', 'Benz Circle', current_date + 7, now() + interval '7 days', now(), 'open'),
    ($4, $5, $3, 'Other tiles', 'Vijayawada', 'Other area', current_date + 7, now() + interval '7 days', now(), 'open')`,
  [rfq, customer, category, otherRfq, otherCustomer]);
await db.query(`insert into public.rfq_recipients (rfq_id) values ($1), ($1), ($2)`, [rfq, otherRfq]);
await db.query(`insert into public.supplier_quotes (rfq_id) values ($1), ($2), ($2)`, [rfq, otherRfq]);
await db.query(`insert into public.product_enquiries (customer_id, customer_unread) values ($1, 4), ($2, 20)`,
  [customer, otherCustomer]);
await db.query(`insert into public.sports_venues (id, owner_id, name) values ($1, $2, 'Customer-owned venue')`,
  [venue, customer]);
await db.query(`insert into public.sports_activities (id, name) values ($1, 'Badminton')`, [activity]);
await db.query(`insert into public.sports_resources (id, venue_id, activity_id, name) values ($1, $2, $3, 'Court 1')`,
  [resource, venue, activity]);
await db.query(`insert into public.sports_bookings
  (id, customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise, expires_at)
  values
    ($1, $2, $3, $4, now(), now() + interval '1 hour', 'accepted', 20000, now() + interval '1 day'),
    ($5, $6, $3, $4, now(), now() + interval '1 hour', 'accepted', 20000, now() + interval '1 day')`,
  [sportsBooking, customer, venue, resource, ownerOnlyBooking, otherCustomer]);

await db.query(`
  insert into public.notifications (user_id, kind, booking_id, data, read_at) values
    ($1, 'booking_accepted', $2, '{}'::jsonb, null),
    ($1, 'chat_message', $2, jsonb_build_object('booking_id', $2), null),
    ($1, 'booking_accepted', $3, '{}'::jsonb, null),
    ($4, 'booking_accepted', $2, '{}'::jsonb, null),
    ($1, 'proposal_received', null, jsonb_build_object('request_id', $5::text), null),
    ($1, 'proposal_received', null, jsonb_build_object('request_id', $5::text), null),
    ($1, 'proposal_received', null, jsonb_build_object('request_id', $6::text), null),
    ($1, 'request_message', null, jsonb_build_object('request_id', $5::text), null),
    ($1, 'rfq_quote_received', null, jsonb_build_object('rfq_id', $7::text), null),
    ($1, 'rfq_quote_received', null, jsonb_build_object('rfq_id', $8::text), null),
    ($4, 'rfq_quote_received', null, jsonb_build_object('rfq_id', $7::text), null),
    ($1, 'rfq_quote_received', null, jsonb_build_object('rfq_id', $7::text), now()),
    ($1, 'sports_booking_accepted', null, jsonb_build_object('sports_booking_id', $9::text), null),
    ($1, 'sports_booking_declined', null, jsonb_build_object('sports_booking_id', $9::text), null),
    ($1, 'sports_booking_requested', null, jsonb_build_object('sports_booking_id', $9::text), null),
    ($1, 'sports_booking_accepted', null, jsonb_build_object('sports_booking_id', $10::text), null),
    ($4, 'sports_booking_accepted', null, jsonb_build_object('sports_booking_id', $9::text), null)
`, [customer, booking, otherBooking, otherCustomer, request, otherRequest, rfq, otherRfq, sportsBooking, ownerOnlyBooking]);

const rfqs = await as(customer, `select id, status, recipient_count from public.list_my_customer_rfqs()`);
ok(rfqs.length === 1 && rfqs[0].id === rfq && rfqs[0].recipient_count === 2 && rfqs[0].status === 'open',
  'customer RFQ list is gated and returns only the customer-owned RFQ with its native state');

const sports = await as(customer, `select id, status from public.list_my_customer_sports_bookings()`);
ok(sports.length === 1 && sports[0].id === sportsBooking,
  'customer sports list excludes a venue-owner booking for a different customer');

const unread = (await as(customer, `select * from public.get_my_activity_unread_counts()`))[0];
ok(unread.services === 4, 'Services adds customer chat unread to own booking notifications and excludes chat_message notification rows');
ok(unread.requests === 3, 'Requests counts proposal and message notifications only for owned service requests');
ok(unread.shop === 5, 'Shop adds own enquiry customer_unread to unread RFQ quote notifications for owned RFQs');
ok(unread.sports === 2, 'Sports counts only accepted/declined notifications for customer-owned sports bookings');

await db.query(`update public.feature_flags set enabled = false where key = 'product_rfq'`);
await expectError(
  () => as(customer, `select * from public.list_my_customer_rfqs()`),
  /product RFQs are disabled/,
  'customer RFQ list refuses access when product_rfq is off',
);
await expectError(
  () => as(customer, `select public.mark_my_activity_notification_read('rfq', $1::uuid)`, [rfq]),
  /product RFQs are disabled/,
  'RFQ mark-read refuses access when product_rfq is off',
);
const noRfqUnread = (await as(customer, `select * from public.get_my_activity_unread_counts()`))[0];
ok(noRfqUnread.shop === 4, 'Shop unread omits RFQ notifications when product_rfq is off but retains enabled enquiry unread');

await db.query(`update public.feature_flags set enabled = false where key = 'product_enquiries'`);
const noShopChildUnread = (await as(customer, `select * from public.get_my_activity_unread_counts()`))[0];
ok(noShopChildUnread.shop === 0, 'Shop unread is zero when both child resource flags are off');

await db.query(`update public.feature_flags set enabled = true where key = 'product_rfq'`);
const rfqOnlyUnread = (await as(customer, `select * from public.get_my_activity_unread_counts()`))[0];
ok(rfqOnlyUnread.shop === 1, 'Shop unread retains RFQ notifications when only the enquiry child is disabled');
await db.query(`update public.feature_flags set enabled = false where key = 'products'`);
const noProductsUnread = (await as(customer, `select * from public.get_my_activity_unread_counts()`))[0];
ok(noProductsUnread.shop === 0, 'Shop unread is zero when the products parent flag is off');
await expectError(
  () => as(customer, `select * from public.list_my_customer_rfqs()`),
  /product RFQs are disabled/,
  'customer RFQ list also requires the products parent flag',
);
await db.query(`update public.feature_flags set enabled = true where key = 'products'`);
await db.query(`update public.feature_flags set enabled = false where key = 'sports'`);
await expectError(
  () => as(customer, `select * from public.list_my_customer_sports_bookings()`),
  /Sports & venues are turned off/,
  'customer sports list refuses access when sports is off',
);
await expectError(
  () => as(customer, `select public.mark_my_activity_notification_read('sports_booking', $1::uuid)`, [sportsBooking]),
  /Sports & venues are turned off/,
  'sports mark-read refuses access when sports is off',
);
const noSportsUnread = (await as(customer, `select * from public.get_my_activity_unread_counts()`))[0];
ok(noSportsUnread.sports === 0, 'Sports unread is zero while sports is disabled');
await db.query(`update public.feature_flags set enabled = true where key = 'sports'`);
await db.query(`update public.feature_flags set enabled = true where key = 'product_enquiries'`);

await expectError(
  () => as(otherCustomer, `select public.mark_my_activity_notification_read('request', $1::uuid)`, [request]),
  /activity not found/,
  'request mark-read refuses a request belonging to another customer',
);
await expectError(
  () => as(otherCustomer, `select public.mark_my_activity_notification_read('rfq', $1::uuid)`, [rfq]),
  /activity not found/,
  'RFQ mark-read refuses an RFQ belonging to another customer',
);
await expectError(
  () => as(otherCustomer, `select public.mark_my_activity_notification_read('sports_booking', $1::uuid)`, [sportsBooking]),
  /activity not found/,
  'sports mark-read refuses a booking belonging to another customer',
);

const readBooking = await as(customer, `select public.mark_my_activity_notification_read('booking', $1::uuid) count`, [booking]);
ok(readBooking[0].count === 1, 'booking read clears only non-chat notifications for the customer-owned booking');
const afterBookingRead = (await as(customer, `select * from public.get_my_activity_unread_counts()`))[0];
ok(afterBookingRead.services === 3, 'marking a booking notification read leaves booking-chat unread intact');

const readRequest = await as(customer, `select public.mark_my_activity_notification_read('request', $1::uuid) count`, [request]);
ok(readRequest[0].count === 3, 'request read clears proposal and message notifications for the owned request');
const readRfq = await as(customer, `select public.mark_my_activity_notification_read('rfq', $1::uuid) count`, [rfq]);
ok(readRfq[0].count === 1, 'RFQ read clears unread quote notifications for the owned RFQ');
const readSports = await as(customer, `select public.mark_my_activity_notification_read('sports_booking', $1::uuid) count`, [sportsBooking]);
ok(readSports[0].count === 2, 'sports booking read clears accepted/declined notifications for the owned booking');

await expectError(
  () => as(otherCustomer, `select public.mark_my_activity_notification_read('booking', $1::uuid)`, [booking]),
  /activity not found/,
  'mark-read refuses a booking belonging to another customer',
);
await expectError(
  () => as(null, `select * from public.get_my_activity_unread_counts()`),
  /authentication required/,
  'activity unread RPC requires authentication',
);

await db.close();
if (failures) process.exitCode = 1;

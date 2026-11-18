import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const db = new PGlite({ extensions: { pgcrypto } });

await db.exec(`
  create schema extensions;
  create type extensions.geography as (lat float8, lng float8);
  create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8 language sql immutable as $$ select 0::float8 $$;
  create schema auth;
  create schema storage;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function storage.foldername(p_name text) returns text[] language sql immutable as $$
    select string_to_array(p_name, '/')
  $$;
  create role anon nologin;
  create role authenticated nologin;
  create table public.profiles (id uuid primary key, full_name text not null default '');
  create table public.feature_flags (
    key text primary key, enabled boolean not null default false, label text not null,
    description text not null default '', group_name text not null default 'General',
    sort_order int not null default 100, updated_at timestamptz not null default now(), updated_by uuid
  );
  create type public.booking_status as enum ('pending_payment', 'requested', 'accepted', 'en_route', 'inspecting',
    'quote_sent', 'in_progress', 'completion_requested', 'completed', 'declined', 'cancelled', 'expired', 'closed');
  create type public.quote_item_kind as enum ('labour', 'part', 'other', 'package');
  create table public.providers (
    id uuid primary key references public.profiles(id), base_location extensions.geography, created_at timestamptz not null default now(),
    bio text not null default '', city text not null default '', service_radius_km int not null default 10,
    years_experience int not null default 0, languages text[] not null default '{}',
    kyc_status text not null default 'verified', kyc_reference text, kyc_reason text,
    kyc_requirements jsonb not null default '[]'::jsonb, kyc_updated_at timestamptz, review_note text,
    gender text, suspended boolean not null default false, is_online boolean not null default false,
    rating_avg numeric not null default 0, rating_count int not null default 0, jobs_completed int not null default 0,
    commission_tier int not null default 12, razorpay_account_id text, timezone text not null default 'Asia/Kolkata',
    base_area text, max_jobs_per_day int, paused boolean not null default false, deactivated_at timestamptz,
    onboarding_step int not null default 0, submitted_at timestamptz, terms_version text, terms_accepted_at timestamptz
  );
  create function public.get_my_provider() returns jsonb language sql stable security definer set search_path = public as $$
    select to_jsonb(p) from public.providers p where p.id = auth.uid()
  $$;
  create table public.categories (id uuid primary key default gen_random_uuid(), name text not null, slug text not null default '');
  create table public.addresses (
    id uuid primary key default gen_random_uuid(), city text not null default '', line1 text not null default '',
    lat float8, lng float8, location extensions.geography
  );
  create table public.shops (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
    created_at timestamptz not null default now(), name text not null default 'Shop', status text not null default 'verified',
    description text not null default '', address_line text not null default '', city text not null default '', area text not null default '',
    lat float8, lng float8, delivery_radius_km int not null default 10, offers_delivery boolean not null default false,
    offers_pickup boolean not null default true, whatsapp_contact boolean not null default false, gstin text, status_reason text
  );
  create table public.product_categories (
    id uuid primary key default gen_random_uuid(), slug text not null default '', name text not null default '',
    sort_order int not null default 1, active boolean not null default true
  );
  create table public.shop_categories (
    shop_id uuid not null references public.shops(id), category_id uuid not null references public.product_categories(id)
  );
  create table public.products (id uuid primary key default gen_random_uuid(), name text not null default '');
  create table public.sports_venues (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
    created_at timestamptz not null default now(), name text not null default 'Venue', status text not null default 'verified'
  );
  create table public.sports_activities (id uuid primary key default gen_random_uuid(), name text not null, slug text not null, active boolean not null default true);
  create table public.sports_resources (
    id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.sports_venues(id),
    activity_id uuid not null references public.sports_activities(id), name text not null default 'Court',
    slot_minutes int not null default 60, active boolean not null default true, created_at timestamptz not null default now()
  );
  create table public.sports_hours (venue_id uuid not null references public.sports_venues(id), weekday int, opens time, closes time);
  create table public.sports_price_rules (
    id uuid primary key default gen_random_uuid(), resource_id uuid not null references public.sports_resources(id),
    weekday int, starts time, ends time, price_paise int, label text
  );
  create table public.sports_blocks (
    id uuid primary key default gen_random_uuid(), resource_id uuid not null references public.sports_resources(id),
    starts_at timestamptz, ends_at timestamptz, reason text
  );
  create table public.bookings (
    id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id),
    provider_id uuid not null references public.providers(id), category_id uuid references public.categories(id),
    address_id uuid references public.addresses(id), status public.booking_status not null default 'requested',
    accepted_at timestamptz, description text not null default '', scheduled_at timestamptz,
    created_at timestamptz not null default now(), visit_fee int not null default 0,
    photos text[] not null default '{}', travel_request_id uuid,
    booking_origin text not null default 'normal', archetype text not null default 'inspect_quote'
  );
  create table public.travel_requests (id uuid primary key default gen_random_uuid(), status text, quoted_fee int, distance_km float8);
  alter table public.bookings add constraint bookings_travel_request_fk foreign key (travel_request_id) references public.travel_requests(id);
  create table public.quotes (
    id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id),
    version int, total int, note text, is_change_order boolean, subtotal_labour int, subtotal_parts int,
    subtotal_other int, subtotal_travel int, status text, quote_type text, source_package_id uuid, package_snapshot jsonb
  );
  create table public.quote_items (
    id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.quotes(id),
    kind public.quote_item_kind, title text, qty numeric, unit text, unit_price int, bill_photo_url text,
    travel_request_id uuid references public.travel_requests(id)
  );
  create table public.messages (
    id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id),
    sender_id uuid not null references public.profiles(id), body text not null, created_at timestamptz not null default now()
  );
  create table public.product_enquiries (
    id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id),
    customer_id uuid not null references public.profiles(id), product_id uuid references public.products(id),
    status text not null default 'open', last_message_at timestamptz not null default now(),
    shop_unread int not null default 0, customer_unread int not null default 0
  );
  create table public.product_enquiry_messages (
    id uuid primary key default gen_random_uuid(), enquiry_id uuid not null references public.product_enquiries(id),
    sender_id uuid not null references public.profiles(id), body text not null
  );
  create table public.rfqs (
    id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id),
    category_id uuid not null references public.product_categories(id), title text not null default 'RFQ',
    city text not null default 'City', area text not null default 'Area', needs_delivery boolean not null default false,
    needed_by date not null default current_date, expires_at timestamptz not null default now() + interval '1 day',
    created_at timestamptz not null default now(), notes text not null default '', status text not null default 'open'
  );
  create table public.rfq_items (
    id uuid primary key default gen_random_uuid(), rfq_id uuid not null references public.rfqs(id),
    seq int not null default 1, description text not null default 'Item', brand_pref text not null default '',
    specs jsonb not null default '{}'::jsonb, quantity numeric not null default 1, unit text not null default 'piece'
  );
  create table public.rfq_recipients (rfq_id uuid not null references public.rfqs(id), shop_id uuid not null references public.shops(id));
  create table public.supplier_quotes (
    id uuid primary key default gen_random_uuid(), rfq_id uuid not null references public.rfqs(id),
    shop_id uuid not null references public.shops(id), version int, status text, valid_until timestamptz,
    delivery_charge_paise bigint, delivery_days int, notes text, subtotal_paise bigint, gst_paise bigint, total_paise bigint,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table public.supplier_quote_items (
    id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.supplier_quotes(id),
    rfq_item_id uuid not null references public.rfq_items(id), brand text, model text, specs jsonb,
    unit_price_paise bigint, quantity numeric, gst_rate_bp int, available boolean, line_total_paise bigint
  );
  create table public.sports_bookings (
    id uuid primary key default gen_random_uuid(), venue_id uuid not null references public.sports_venues(id),
    resource_id uuid not null references public.sports_resources(id), customer_id uuid not null references public.profiles(id),
    starts_at timestamptz, ends_at timestamptz, status text not null default 'requested', price_paise int not null default 1,
    note text not null default '', decision_reason text not null default '', expires_at timestamptz,
    decided_at timestamptz, created_at timestamptz not null default now()
  );
  create table public.service_requests (
    id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id),
    category_id uuid not null references public.categories(id), status text not null default 'open',
    expires_at timestamptz not null default now() + interval '1 day', event_start timestamptz not null default now() + interval '2 days',
    event_end timestamptz, intake jsonb not null default '{}'::jsonb, budget_min int, budget_max int,
    city text not null default 'City', area text not null default 'Area', created_at timestamptz not null default now(), urgent boolean not null default false
  );
  create table public.request_recipients (
    request_id uuid not null references public.service_requests(id), provider_id uuid not null references public.providers(id),
    provider_service_id uuid, routed_at timestamptz not null default now()
  );
  create table public.proposals (
    id uuid primary key default gen_random_uuid(), request_id uuid not null references public.service_requests(id),
    provider_id uuid not null references public.providers(id), provider_service_id uuid, version int,
    total int, valid_until timestamptz, note text, deliverables jsonb, cancellation_snapshot jsonb,
    status text not null default 'sent', pricing_snapshot jsonb, payment_snapshot jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table public.proposal_items (
    id uuid primary key default gen_random_uuid(), proposal_id uuid not null references public.proposals(id),
    seq int, kind public.quote_item_kind, title text, qty numeric, unit text, unit_price int,
    bill_photo_url text, metadata jsonb
  );
  create table public.proposal_schedule (
    id uuid primary key default gen_random_uuid(), proposal_id uuid not null references public.proposals(id),
    seq int, label text, amount int, due_rule text, due_at timestamptz
  );
  create table public.request_messages (
    id uuid primary key default gen_random_uuid(), request_id uuid not null references public.service_requests(id),
    provider_id uuid not null references public.providers(id), sender_id uuid not null references public.profiles(id),
    body text not null, created_at timestamptz not null default now()
  );
  create table public.admins (user_id uuid primary key references public.profiles(id));
  create table public.booking_chat_reads (
    booking_id uuid not null references public.bookings(id), user_id uuid not null references public.profiles(id),
    last_read_at timestamptz not null default '-infinity', viewing_until timestamptz, updated_at timestamptz not null default now(),
    primary key (booking_id, user_id)
  );
  create table public.notifications (
    id uuid primary key default gen_random_uuid(), user_id uuid not null, booking_id uuid, kind text,
    status text not null default 'pending', last_error text, updated_at timestamptz not null default now()
  );
  create table public.leakage_signals (
    id uuid primary key default gen_random_uuid(), subject_id uuid, kind text, booking_id uuid, message_id uuid, details jsonb
  );
  create table storage.objects (name text not null, bucket_id text not null);
  create table public._test_anchor (id int);
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
  create function public._feature_enabled(p_key text) returns boolean language sql stable security definer as $$
    select coalesce((select enabled from public.feature_flags where key = p_key), false)
  $$;
  create function public._shops_products_enabled() returns boolean language sql stable as $$
    select public._feature_enabled('products')
  $$;
  create function public._shops_enquiries_enabled() returns boolean language sql stable as $$
    select public._feature_enabled('products') and public._feature_enabled('product_enquiries')
  $$;
  create function public._product_rfq_enabled() returns boolean language sql stable as $$
    select public._feature_enabled('product_rfq') and public._shops_products_enabled()
  $$;
  create function public._is_admin() returns boolean language sql stable as $$
    select exists (select 1 from public.admins where user_id = auth.uid())
  $$;
  create function public.get_app_features() returns jsonb language sql stable as $$
    select coalesce((select jsonb_object_agg(key, enabled) from public.feature_flags), '{}'::jsonb)
  $$;
  create function public._proposal_public_intake(p_category_id uuid, p_intake jsonb) returns jsonb language sql immutable as $$
    select coalesce(p_intake, '{}'::jsonb)
  $$;
  create function public._proposal_notice(p_request public.service_requests) returns interval language sql immutable as $$
    select interval '24 hours'
  $$;
  create function public._validate_product_specs(p_category_id uuid, p_specs jsonb) returns void language plpgsql as $$
  begin
    if jsonb_typeof(coalesce(p_specs, '{}'::jsonb)) <> 'object' then raise exception 'invalid specs'; end if;
  end $$;
  create function public._product_enquiry_participant(p_enquiry_id uuid) returns boolean language sql stable as $$
    select false
  $$;
  create function public._rfq_shop_recipient(p_rfq_id uuid, p_shop_id uuid) returns boolean language sql stable as $$
    select false
  $$;
  create function public._rfq_can_read(p_rfq_id uuid) returns boolean language sql stable as $$
    select false
  $$;
  create function public._rfq_quote_can_read(p_quote_id uuid) returns boolean language sql stable as $$
    select false
  $$;
  create function public._product_enquiry_post(p_enquiry_id uuid, p_sender_id uuid, p_from_shop boolean, p_body text, p_initial boolean default false)
    returns void language plpgsql as $$ begin null; end $$;
  create function public._queue_notification(p_user uuid, p_kind text, p_booking uuid, p_title text, p_body text, p_data jsonb, p_collapse_key text default null)
    returns void language plpgsql as $$ begin null; end $$;
  create function public._leakage_signal_kinds(p_body text) returns text[] language sql immutable as $$ select '{}'::text[] $$;
  create function public._mask_preview(p_body text) returns text language sql immutable as $$ select p_body $$;
  create function public._lock_booking(p_booking_id uuid) returns public.bookings language sql as $$
    select b from public.bookings b where b.id = p_booking_id
  $$;
  create function public._close_open_quotes(p_booking_id uuid) returns void language plpgsql as $$ begin null; end $$;
  create function public._transition_actor(p_booking_id uuid, p_actor uuid) returns text language sql stable as $$
    select 'provider'::text
  $$;
  create function public._set_status(p_booking_id uuid, p_status public.booking_status, p_actor uuid, p_note text default null)
    returns void language plpgsql as $$
    begin
      perform public._assert(public._transition_actor(p_booking_id, p_actor) is not null, 'transition actor is not authorised');
      update public.bookings set status = p_status where id = p_booking_id;
    end $$;
  create function public._log_event(p_booking_id uuid, p_actor uuid, p_note text) returns void language plpgsql as $$ begin null; end $$;
  create function public._commission_bp(p_provider uuid, p_customer uuid, p_booking uuid, p_at timestamptz) returns int language sql stable as $$ select 1200 $$;
  create function public._time_based_commission_bp(p_booking uuid, p_at timestamptz) returns int language sql stable as $$ select 1200 $$;
  alter table public.bookings enable row level security;
  alter table public.messages enable row level security;
  alter table public.product_enquiries enable row level security;
  alter table public.product_enquiry_messages enable row level security;
  alter table public.rfqs enable row level security;
  alter table public.request_messages enable row level security;
  alter table public.sports_venues enable row level security;
  alter table public.sports_resources enable row level security;
  alter table public.sports_hours enable row level security;
  alter table public.sports_price_rules enable row level security;
  alter table public.sports_bookings enable row level security;
  create policy product_enquiries_read on public.product_enquiries for select to authenticated using (public._product_enquiry_participant(id));
  create policy product_enquiry_messages_read on public.product_enquiry_messages for select to authenticated using (public._product_enquiry_participant(enquiry_id));
  create policy rfqs_participant_read on public.rfqs for select to authenticated using (public._rfq_can_read(id));
  create policy request_messages_thread_participants on public.request_messages for select to authenticated using (
    provider_id = auth.uid()
    or exists (select 1 from public.service_requests r where r.id = request_id and r.customer_id = auth.uid())
  );
  create policy sports_venues_read on public.sports_venues for select to anon, authenticated using (status = 'verified');
  create policy sports_resources_read on public.sports_resources for select to anon, authenticated using (active);
  create policy sports_hours_read on public.sports_hours for select to anon, authenticated using (true);
  create policy sports_price_rules_read on public.sports_price_rules for select to anon, authenticated using (true);
  create policy sports_bookings_participant_read on public.sports_bookings for select to authenticated using (customer_id = auth.uid());
  grant usage on schema auth, public to anon, authenticated;
  grant usage on schema extensions, storage to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant execute on function storage.foldername(text) to authenticated;
  grant all on all tables in schema public to anon, authenticated;
  grant all on all tables in schema storage to anon, authenticated;
`);

const ownerA = '00000000-0000-0000-0000-0000000000a1';
const ownerB = '00000000-0000-0000-0000-0000000000a2';
const manager = '00000000-0000-0000-0000-0000000000b1';
const staff = '00000000-0000-0000-0000-0000000000b2';
const stranger = '00000000-0000-0000-0000-0000000000c1';
const customer = '00000000-0000-0000-0000-0000000000c2';
const shopA = '20000000-0000-0000-0000-0000000000a1';
const shopB = '20000000-0000-0000-0000-0000000000a2';
const venueA = '30000000-0000-0000-0000-0000000000a1';
const venueB = '30000000-0000-0000-0000-0000000000a2';
const activity = '40000000-0000-0000-0000-0000000000a1';
const resourceA = '50000000-0000-0000-0000-0000000000a1';
const resourceB = '50000000-0000-0000-0000-0000000000a2';
const rfqA = '60000000-0000-0000-0000-0000000000a1';
const rfqB = '60000000-0000-0000-0000-0000000000a2';
const requestA = '61000000-0000-0000-0000-0000000000a1';
const requestB = '61000000-0000-0000-0000-0000000000a2';

await db.exec(`
  insert into public.profiles (id, full_name) values
    ('${ownerA}', 'Owner A'), ('${ownerB}', 'Owner B'), ('${manager}', 'Manager'),
    ('${staff}', 'Staff'), ('${stranger}', 'Stranger'), ('${customer}', 'Customer');
  insert into public.providers (id) values ('${ownerA}'), ('${ownerB}');
  insert into public.categories (id, name, slug) values ('70000000-0000-0000-0000-000000000001', 'General', 'general');
  insert into public.addresses (id, city, line1) values ('80000000-0000-0000-0000-000000000001', 'City', 'Market Road');
  insert into public.shops (id, owner_id, name) values
    ('${shopA}', '${ownerA}', 'Shop A'), ('${shopB}', '${ownerB}', 'Shop B');
  insert into public.product_categories (id, slug, name) values
    ('90000000-0000-0000-0000-000000000001', 'tiles', 'Tiles');
  insert into public.sports_venues (id, owner_id, name) values
    ('${venueA}', '${ownerA}', 'Venue A'), ('${venueB}', '${ownerB}', 'Venue B');
  insert into public.sports_activities (id, name, slug) values ('${activity}', 'Badminton', 'badminton');
  insert into public.sports_resources (id, venue_id, activity_id) values
    ('${resourceA}', '${venueA}', '${activity}'), ('${resourceB}', '${venueB}', '${activity}');
  insert into public.bookings (id, customer_id, provider_id) values
    ('10000000-0000-0000-0000-000000000001', '${customer}', '${ownerA}'),
    ('10000000-0000-0000-0000-000000000002', '${customer}', '${ownerB}'),
    ('10000000-0000-0000-0000-000000000003', '${customer}', '${ownerA}');
  update public.bookings set status = 'inspecting' where id = '10000000-0000-0000-0000-000000000003';
  insert into public.messages (booking_id, sender_id, body) values
    ('10000000-0000-0000-0000-000000000001', '${customer}', 'A chat'),
    ('10000000-0000-0000-0000-000000000002', '${customer}', 'B chat');
  insert into public.product_enquiries (id, shop_id, customer_id) values
    ('11000000-0000-0000-0000-000000000001', '${shopA}', '${customer}'),
    ('11000000-0000-0000-0000-000000000002', '${shopB}', '${customer}');
  insert into public.rfqs (id, customer_id, category_id, title) values
    ('${rfqA}', '${customer}', '90000000-0000-0000-0000-000000000001', 'RFQ A'),
    ('${rfqB}', '${customer}', '90000000-0000-0000-0000-000000000001', 'RFQ B');
  insert into public.rfq_items (id, rfq_id, seq, description, quantity, unit) values
    ('62000000-0000-0000-0000-000000000001', '${rfqA}', 1, 'Tiles', 1, 'piece');
  insert into public.rfq_recipients (rfq_id, shop_id) values
    ('${rfqA}', '${shopA}'), ('${rfqB}', '${shopB}');
  insert into public.service_requests (id, customer_id, category_id, title) values
    ('${requestA}', '${customer}', '70000000-0000-0000-0000-000000000001', 'Request A'),
    ('${requestB}', '${customer}', '70000000-0000-0000-0000-000000000001', 'Request B');
  insert into public.request_recipients (request_id, provider_id) values
    ('${requestA}', '${ownerA}'), ('${requestB}', '${ownerB}');
  insert into public.request_messages (request_id, provider_id, sender_id, body) values
    ('${requestA}', '${ownerA}', '${customer}', 'A request chat'),
    ('${requestB}', '${ownerB}', '${customer}', 'B request chat');
  insert into public.sports_bookings (id, venue_id, resource_id, customer_id, price_paise) values
    ('12000000-0000-0000-0000-000000000001', '${venueA}', '${resourceA}', '${customer}', 100),
    ('12000000-0000-0000-0000-000000000002', '${venueB}', '${resourceB}', '${customer}', 100);
`);

const migrationUrl = new URL('../migrations/0052_merchant_staff.sql', import.meta.url);
await db.exec(fs.readFileSync(migrationUrl, 'utf8'));

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
async function expectError(fn, pattern, message) {
  try { await fn(); ok(false, `${message} (no error)`); }
  catch (error) { ok(pattern.test(error.message), `${message} -> ${error.message}`); }
}

const flag = await db.query(`select enabled from public.feature_flags where key = 'merchant_staff'`);
ok(flag.rows.length === 1 && flag.rows[0].enabled === false, 'merchant staff is disabled by default');
await expectError(
  () => as(ownerA, 'authenticated', `select public.add_business_member($1, $2, 'staff')`, [ownerA, staff]),
  /merchant staff.*disabled/i,
  'staff cannot be added while the feature flag is off',
);

await db.query(`update public.feature_flags set enabled = true where key = 'merchant_staff'`);
await db.exec(`
  insert into public.feature_flags (key, enabled, label) values
    ('products', true, 'Products'), ('product_enquiries', true, 'Enquiries'),
    ('product_rfq', true, 'RFQs'), ('sports', true, 'Sports');
`);
await as(ownerA, 'authenticated', `select public.add_business_member($1, $2, 'manager')`, [ownerA, manager]);
await as(ownerA, 'authenticated', `select public.add_business_member($1, $2, 'staff')`, [ownerA, staff]);
await as(ownerB, 'authenticated', `select public.add_business_member($1, $2, 'staff')`, [ownerB, ownerA]);
await db.query(`
  update public.providers
     set kyc_reference = 'private-kyc-ref',
         kyc_reason = 'private verification detail',
         kyc_requirements = '["private document"]'::jsonb,
         kyc_updated_at = now(),
         review_note = 'private reviewer note',
         terms_version = 'private-terms',
         terms_accepted_at = now(),
         onboarding_step = 4,
         submitted_at = now(),
         deactivated_at = now(),
         razorpay_account_id = 'private-payout',
         commission_tier = 5
   where id = $1
`, [ownerA]);

const staffProviderContext = (await as(manager, 'authenticated', `select public.get_provider_business_context() as value`))[0].value;
ok(staffProviderContext.business_role === 'manager' && staffProviderContext.id === ownerA,
  'manager context is scoped to the provider business');
ok(
  !['base_location', 'razorpay_account_id', 'kyc_reference', 'kyc_status', 'kyc_reason', 'kyc_requirements',
    'kyc_updated_at', 'review_note', 'terms_version', 'terms_accepted_at', 'onboarding_step', 'submitted_at',
    'deactivated_at', 'commission_tier', 'gender'].some((key) => key in staffProviderContext),
  'non-owner provider context omits payout, identity, KYC, terms, and review data',
);
const [selectedBusinessContext] = await as(ownerA, 'authenticated', `
  select public.get_provider_business_context($1) as value
`, [ownerB]);
ok(selectedBusinessContext.value.id === ownerB && selectedBusinessContext.value.business_role === 'staff',
  'a member can explicitly select the intended business when they belong to multiple providers');
await expectError(
  () => as(stranger, 'authenticated', `select public.get_provider_business_context($1)`, [ownerA]),
  /business access denied/i,
  'business context refuses an explicitly selected business without membership',
);

const [rank] = await as(staff, 'authenticated', `
  select public._acts_for('${ownerA}', 'staff') as staff_read,
         public._acts_for('${ownerA}', 'manager') as staff_quote,
         public._acts_for('${ownerA}', 'owner') as staff_owner,
         public._acts_for('${ownerB}', 'staff') as cross_business
`);
ok(rank.staff_read && !rank.staff_quote && !rank.staff_owner,
  'staff can read business work but cannot quote or perform owner actions');
ok((await as(manager, 'authenticated', `select public._acts_for($1, 'manager') as allowed`, [ownerA]))[0].allowed,
  'managers can perform quote-level actions');
ok(!(await as(manager, 'authenticated', `select public._acts_for($1, 'owner') as allowed`, [ownerA]))[0].allowed,
  'managers cannot perform owner-only actions');
ok(!(await as(stranger, 'authenticated', `select public._acts_for($1, 'staff') as allowed`, [ownerA]))[0].allowed,
  'unrelated accounts have no business access');

const quoteItems = JSON.stringify([{ kind: 'labour', title: 'Repair', qty: 1, unit_price: 1000 }]);
const [managerQuote] = await as(manager, 'authenticated', `
  select public.send_quote($1, $2::jsonb, 'Manager quote') as id
`, ['10000000-0000-0000-0000-000000000003', quoteItems]);
ok(!!managerQuote.id, 'manager can send a quote for a business job');
await expectError(
  () => as(staff, 'authenticated', `
    select public.send_quote($1, $2::jsonb, 'Staff quote')
  `, ['10000000-0000-0000-0000-000000000003', quoteItems]),
  /manager role required/i,
  'staff cannot send provider quotes',
);

const proposalItems = JSON.stringify([{ kind: 'package', title: 'Service', qty: 1, unit_price: 1000 }]);
const proposalSchedule = JSON.stringify([{ label: 'Booking advance', amount: 1000, due_rule: 'at_booking' }]);
const [managerProposal] = await as(manager, 'authenticated', `
  select public.send_proposal($1, $2::jsonb, $3::jsonb, now() + interval '1 hour', null, '[]'::jsonb) as id
`, [requestA, proposalItems, proposalSchedule]);
ok(!!managerProposal.id, 'manager can send a proposal for a routed request');
await expectError(
  () => as(manager, 'authenticated', `
    select public.send_proposal($1, $2::jsonb, $3::jsonb, now() + interval '1 hour', null, '[]'::jsonb)
  `, [requestB, proposalItems, proposalSchedule]),
  /exactly one business/i,
  'manager cannot send a proposal for an unrelated business',
);

const supplierItems = JSON.stringify([{
  rfq_item_id: '62000000-0000-0000-0000-000000000001',
  brand: '', model: '', specs: {}, unit_price_paise: 1000, gst_rate_bp: 0, available: true,
}]);
const [managerSupplierQuote] = await as(manager, 'authenticated', `
  select public.send_supplier_quote_for_business($1, $2, $3::jsonb, 0, null, null, null) as id
`, [rfqA, shopA, supplierItems]);
ok(!!managerSupplierQuote.id, 'manager can send a quote to a routed shop RFQ');
const [notificationRfq] = await as(manager, 'authenticated', `
  select public.get_supplier_rfq_for_business($1, null) as value
`, [rfqA]);
ok(notificationRfq.value.shop_id === shopA && notificationRfq.value.business_role === 'manager',
  'an RFQ notification without shopId resolves the single accessible recipient shop');
await as(ownerB, 'authenticated', `select public.add_business_member($1, $2, 'staff')`, [ownerB, manager]);
await db.query(`insert into public.rfq_recipients (rfq_id, shop_id) values ($1, $2)`, [rfqA, shopB]);
await expectError(
  () => as(manager, 'authenticated', `select public.get_supplier_rfq_for_business($1, null)`, [rfqA]),
  /ambiguous or unavailable/i,
  'an RFQ notification with multiple accessible recipient shops asks the user to select a shop',
);
await expectError(
  () => as(staff, 'authenticated', `
    select public.send_supplier_quote_for_business($1, $2, $3::jsonb, 0, null, null, null)
  `, [rfqA, shopA, supplierItems]),
  /manager role required/i,
  'staff cannot send shop RFQ quotes',
);

await expectError(
  () => as(staff, 'authenticated', `select public.add_business_member($1, $2, 'manager')`, [ownerA, stranger]),
  /owner only/i,
  'staff cannot manage members',
);
await expectError(
  () => as(manager, 'authenticated', `select public.add_business_member($1, $2, 'staff')`, [ownerA, stranger]),
  /owner only/i,
  'managers cannot manage members',
);

const staffBookings = await as(staff, 'authenticated', `select id from public.bookings order by id`);
ok(staffBookings.length === 2 && staffBookings.every((booking) => booking.id.endsWith('0001') || booking.id.endsWith('0003')),
  'staff see jobs for their business and not another business');
const assignedJobs = await as(staff, 'authenticated', `
  select booking_id from public.get_my_business_provider_jobs($1) order by booking_id
`, [ownerA]);
ok(assignedJobs.length === 2 && assignedJobs.every((job) => job.booking_id.endsWith('0001') || job.booking_id.endsWith('0003')),
  'assigned-job RPC returns only jobs for the selected business');
const otherBusinessJobs = await as(staff, 'authenticated', `
  select booking_id from public.get_my_business_provider_jobs($1)
`, [ownerB]);
ok(otherBusinessJobs.length === 0, 'assigned-job RPC does not expose a business the caller does not belong to');
const ownerBusinessAJobs = await as(ownerA, 'authenticated', `
  select booking_id from public.get_my_business_provider_jobs($1) order by booking_id
`, [ownerA]);
const ownerBusinessBJobs = await as(ownerA, 'authenticated', `
  select booking_id from public.get_my_business_provider_jobs($1) order by booking_id
`, [ownerB]);
ok(ownerBusinessAJobs.length === 2 && ownerBusinessAJobs.every((job) => job.booking_id.endsWith('0001') || job.booking_id.endsWith('0003')),
  'multi-business owner dashboard can select only its own provider jobs');
ok(ownerBusinessBJobs.length === 1 && ownerBusinessBJobs[0].booking_id.endsWith('0002'),
  'the same identity sees a second business only when explicitly requesting that business');
const staffMessages = await as(staff, 'authenticated', `select body from public.messages order by body`);
ok(staffMessages.length === 1 && staffMessages[0].body === 'A chat',
  'staff can read chat only for their business');
const [staffMessage] = await as(staff, 'authenticated', `
  select public.send_booking_message($1, 'Staff reply') as result
`, ['10000000-0000-0000-0000-000000000001']);
ok(!!staffMessage.result.message_id, 'staff can send chat for an assigned job');
await expectError(
  () => as(staff, 'authenticated', `select public.send_booking_message($1, 'Cross-business reply')`, ['10000000-0000-0000-0000-000000000002']),
  /not a booking participant/i,
  'staff cannot send chat for another business job',
);
await expectError(
  () => as(staff, 'authenticated', `
    insert into public.messages (booking_id, sender_id, body)
    values ('10000000-0000-0000-0000-000000000002', '${staff}', 'cross-business')
  `),
  /row-level security|new row violates/i,
  'staff cannot send chat to another business',
);
const staffEnquiries = await as(staff, 'authenticated', `select id from public.product_enquiries order by id`);
ok(staffEnquiries.length === 1 && staffEnquiries[0].id.endsWith('0001'),
  'shop staff can view enquiries for their business only');
const staffRfqs = await as(staff, 'authenticated', `select id from public.rfqs order by id`);
ok(staffRfqs.length === 1 && staffRfqs[0].id === rfqA,
  'shop staff can view routed RFQs for their business only');
const staffRequestMessages = await as(staff, 'authenticated', `select body from public.request_messages order by body`);
ok(staffRequestMessages.length === 1 && staffRequestMessages[0].body === 'A request chat',
  'provider staff can read request chat only for their business');
await as(staff, 'authenticated', `select public.send_request_message($1, $2, 'Staff reply')`, [requestA, ownerA]);
await expectError(
  () => as(staff, 'authenticated', `select public.send_request_message($1, $2, 'Cross-business reply')`, [requestB, ownerB]),
  /not a request participant/i,
  'staff cannot send request chat for another business',
);
const staffSports = await as(staff, 'authenticated', `select id from public.sports_bookings order by id`);
ok(staffSports.length === 1 && staffSports[0].id.endsWith('0001'),
  'sports staff can view bookings for their business only');

const ownMembership = await as(staff, 'authenticated', `select owner_id, member_id from public.business_members`);
ok(ownMembership.length === 1 && ownMembership[0].owner_id === ownerA,
  'members can see only their own membership row');

if (failures) process.exitCode = 1;

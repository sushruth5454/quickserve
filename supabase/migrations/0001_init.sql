-- QuickServe initial schema: tables, RLS, state-machine RPCs, payment/payout internals.
-- All money is integer paise.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.booking_status as enum (
  'pending_payment', 'requested', 'accepted', 'en_route', 'inspecting',
  'quote_sent', 'awaiting_payment', 'in_progress', 'completion_requested', 'completed',
  'closed', 'closed_no_work', 'declined', 'expired', 'cancelled', 'disputed', 'refunded'
);
create type public.skill_level as enum ('beginner', 'skilled', 'expert', 'certified');
create type public.kyc_status as enum ('pending', 'verified', 'rejected');
create type public.pricing_mode as enum ('quote', 'fixed');
create type public.rate_unit as enum ('hour', 'job');
create type public.quote_status as enum ('sent', 'approved_pending_payment', 'approved', 'rejected', 'superseded');
create type public.quote_item_kind as enum ('labour', 'part', 'other');
create type public.payment_purpose as enum ('visit_fee', 'balance', 'fixed');
create type public.payment_status as enum ('created', 'paid', 'failed', 'refund_pending', 'refunded');
create type public.payout_status as enum ('pending', 'frozen', 'transferred', 'failed', 'reversed', 'partially_reversed');
create type public.transfer_status as enum ('pending', 'processing', 'transferred', 'failed');
create type public.dispute_outcome as enum ('denied', 'partial_refund', 'full_refund');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
-- Public-safe profile fields only. Phone/push token live in private_user_accounts.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  role_customer boolean not null default true,
  role_provider boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.private_user_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone text,
  expo_push_token text,
  updated_at timestamptz not null default now()
);

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  action text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null default 'Home',
  line1 text not null,
  city text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  location extensions.geography(Point, 4326),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index addresses_user_idx on public.addresses (user_id);
create index addresses_location_gix on public.addresses using gist (location);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  icon text not null default 'tool',
  pricing_mode public.pricing_mode not null default 'quote',
  sort_order int not null default 0,
  active boolean not null default true
);

create table public.providers (
  id uuid primary key references public.profiles (id) on delete cascade,
  bio text not null default '',
  city text not null,
  service_radius_km int not null default 10 check (service_radius_km between 1 and 100),
  base_location extensions.geography(Point, 4326),
  years_experience int not null default 0 check (years_experience between 0 and 60),
  languages text[] not null default '{}',
  kyc_status public.kyc_status not null default 'pending',
  kyc_reference text,
  suspended boolean not null default false,
  is_online boolean not null default false,
  rating_avg numeric(3, 2) not null default 0,
  rating_count int not null default 0,
  jobs_completed int not null default 0,
  commission_tier int not null default 12,
  razorpay_account_id text,
  created_at timestamptz not null default now()
);
create index providers_base_location_gix on public.providers using gist (base_location);
create index providers_city_idx on public.providers (city) where kyc_status = 'verified' and not suspended;

create table public.provider_services (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  category_id uuid not null references public.categories (id),
  skill_level public.skill_level not null default 'skilled',
  visit_fee int not null check (visit_fee >= 0),
  labour_rate int not null check (labour_rate >= 0),
  rate_unit public.rate_unit not null default 'job',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider_id, category_id)
);
create index provider_services_category_idx on public.provider_services (category_id) where active;

create table public.rate_card_items (
  id uuid primary key default gen_random_uuid(),
  provider_service_id uuid not null references public.provider_services (id) on delete cascade,
  title text not null,
  price int not null check (price >= 0)
);
create index rate_card_items_service_idx on public.rate_card_items (provider_service_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id),
  provider_id uuid not null references public.providers (id),
  category_id uuid not null references public.categories (id),
  provider_service_id uuid not null references public.provider_services (id),
  address_id uuid not null references public.addresses (id),
  description text not null default '',
  photos text[] not null default '{}',
  scheduled_at timestamptz,
  status public.booking_status not null default 'pending_payment',
  visit_fee int not null check (visit_fee >= 0),
  platform_fee int not null check (platform_fee >= 0),
  approved_quote_id uuid,
  total_amount int,
  commission int,
  gst_on_commission int,
  refund_amount int not null default 0,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  completion_requested_at timestamptz,
  completed_at timestamptz,
  check (customer_id <> provider_id)
);
create index bookings_customer_idx on public.bookings (customer_id, created_at desc);
create index bookings_provider_idx on public.bookings (provider_id, status);
create index bookings_requested_idx on public.bookings (updated_at) where status = 'requested';
create index bookings_completion_idx on public.bookings (completion_requested_at) where status = 'completion_requested';

-- OTPs: no client SELECT at all; exposed to the customer only through get_booking_otps().
create table public.booking_secrets (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  start_otp text not null,
  start_attempts int not null default 0,
  end_otp text,
  end_attempts int not null default 0
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  version int not null,
  status public.quote_status not null default 'sent',
  is_change_order boolean not null default false,
  subtotal_labour int not null default 0,
  subtotal_parts int not null default 0,
  subtotal_other int not null default 0,
  total int not null,
  note text,
  created_at timestamptz not null default now(),
  unique (booking_id, version)
);
alter table public.bookings
  add constraint bookings_approved_quote_fk foreign key (approved_quote_id) references public.quotes (id);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  kind public.quote_item_kind not null,
  title text not null,
  qty numeric(10, 2) not null check (qty > 0),
  unit_price int not null check (unit_price >= 0),
  bill_photo_url text
);
create index quote_items_quote_idx on public.quote_items (quote_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  quote_id uuid references public.quotes (id),
  purpose public.payment_purpose not null,
  amount int not null check (amount > 0),
  status public.payment_status not null default 'created',
  razorpay_link_id text unique,
  razorpay_payment_id text unique,
  short_url text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index payments_booking_idx on public.payments (booking_id);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  provider_id uuid not null references public.providers (id),
  gross int not null,
  commission int not null,
  gst_on_commission int not null,
  amount int not null check (amount >= 0),
  status public.payout_status not null default 'pending',
  release_after timestamptz not null,
  created_at timestamptz not null default now(),
  transferred_at timestamptz
);
create index payouts_due_idx on public.payouts (release_after) where status = 'pending';
create index payouts_provider_idx on public.payouts (provider_id, created_at desc);

create table public.payout_transfers (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.payouts (id) on delete cascade,
  source_payment_id uuid not null references public.payments (id),
  amount int not null check (amount > 0),
  razorpay_transfer_id text unique,
  status public.transfer_status not null default 'pending',
  last_error text,
  created_at timestamptz not null default now(),
  transferred_at timestamptz
);
create index payout_transfers_payout_idx on public.payout_transfers (payout_id);
create index payout_transfers_payment_idx on public.payout_transfers (source_payment_id);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  customer_id uuid not null references public.profiles (id),
  provider_id uuid not null references public.providers (id),
  rating int not null check (rating between 1 and 5),
  punctuality int check (punctuality between 1 and 5),
  quality int check (quality between 1 and 5),
  behaviour int check (behaviour between 1 and 5),
  pricing int check (pricing between 1 and 5),
  comment text,
  photos text[] not null default '{}',
  provider_reply text,
  created_at timestamptz not null default now()
);
create index reviews_provider_idx on public.reviews (provider_id, created_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text check (char_length(body) <= 2000),
  image_url text,
  created_at timestamptz not null default now(),
  check (body is not null or image_url is not null)
);
create index messages_booking_idx on public.messages (booking_id, created_at);

create table public.booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  actor_id uuid,
  from_status public.booking_status,
  to_status public.booking_status not null,
  note text,
  at timestamptz not null default now()
);
create index booking_events_booking_idx on public.booking_events (booking_id, at);

-- ---------------------------------------------------------------------------
-- Seed categories
-- ---------------------------------------------------------------------------
insert into public.categories (slug, name, icon, pricing_mode, sort_order) values
  ('ac-repair', 'AC Repair', 'snowflake', 'quote', 1),
  ('electrician', 'Electrician', 'zap', 'quote', 2),
  ('plumber', 'Plumber', 'droplet', 'quote', 3),
  ('house-cleaning', 'House Cleaning', 'home', 'quote', 4),
  ('water-tank-cleaning', 'Water Tank Cleaning', 'database', 'quote', 5),
  ('car-mechanic', 'Car Mechanic', 'truck', 'quote', 6),
  ('bike-mechanic', 'Bike Mechanic', 'bike', 'quote', 7),
  ('appliance-repair', 'Appliance Repair', 'tv', 'quote', 8),
  ('pest-control', 'Pest Control', 'bug', 'quote', 9),
  ('carpenter', 'Carpenter', 'hammer', 'quote', 10),
  ('painter', 'Painter', 'brush', 'quote', 11);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  insert into public.private_user_accounts (user_id, phone)
  values (new.id, new.phone)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_address_location()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.location := extensions.st_setsrid(extensions.st_makepoint(new.lng, new.lat), 4326)::extensions.geography;
  return new;
end;
$$;

create trigger addresses_set_location
  before insert or update of lat, lng on public.addresses
  for each row execute function public.set_address_location();

create or replace function public.refresh_provider_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.providers p
     set rating_avg = coalesce(s.avg_rating, 0),
         rating_count = s.cnt
    from (select round(avg(rating)::numeric, 2) as avg_rating, count(*)::int as cnt
            from public.reviews where provider_id = new.provider_id) s
   where p.id = new.provider_id;
  return new;
end;
$$;

create trigger reviews_refresh_rating
  after insert on public.reviews
  for each row execute function public.refresh_provider_rating();

-- ---------------------------------------------------------------------------
-- Internal helpers (EXECUTE revoked from clients at the end of this file)
-- ---------------------------------------------------------------------------
create or replace function public._assert(p_cond boolean, p_msg text)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_cond, false) then
    raise exception '%', p_msg using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public._require_uid()
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return v;
end;
$$;

create or replace function public._is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public._is_participant(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.bookings b
     where b.id = p_booking_id and auth.uid() in (b.customer_id, b.provider_id)
  );
$$;

create or replace function public._gen_otp()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  b bytea := extensions.gen_random_bytes(3);
begin
  return lpad(((get_byte(b, 0) * 65536 + get_byte(b, 1) * 256 + get_byte(b, 2)) % 10000)::text, 4, '0');
end;
$$;

create or replace function public._lock_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  return b;
end;
$$;

create or replace function public._set_status(
  p_booking_id uuid, p_to public.booking_status, p_actor uuid, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from public.booking_status;
begin
  select status into v_from from public.bookings where id = p_booking_id;
  update public.bookings set status = p_to, updated_at = now() where id = p_booking_id;
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (p_booking_id, p_actor, v_from, p_to, p_note);
end;
$$;

create or replace function public._log_event(p_booking_id uuid, p_actor uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.booking_status;
begin
  select status into v_status from public.bookings where id = p_booking_id;
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (p_booking_id, p_actor, v_status, v_status, p_note);
end;
$$;

create or replace function public._paid_total(p_booking_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::int from public.payments where booking_id = p_booking_id and status = 'paid';
$$;

-- Commission rate in basis points; mirrors app/src/lib/money.ts commissionRateBp().
create or replace function public._commission_bp(p_provider_id uuid, p_at timestamptz)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p_at < p.created_at + interval '30 days' then 0
           when p.jobs_completed >= 200 then 800
           when p.jobs_completed >= 50 then 1000
           else 1200
         end
    from public.providers p
   where p.id = p_provider_id;
$$;

-- Funded total the customer owes for a quote: visit fee is credited, platform fee charged once.
create or replace function public._required_total(p_quote_total int, p_visit_fee int, p_platform_fee int)
returns int
language sql
immutable
as $$
  select greatest(p_quote_total, p_visit_fee) + p_platform_fee;
$$;

-- Splits a payout greedily across the booking's paid payments: visit fee first, then balance payments in order.
create or replace function public._allocate_payout(p_payout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  po public.payouts;
  pm record;
  v_remaining int;
  v_avail int;
  v_take int;
begin
  select * into po from public.payouts where id = p_payout_id for update;
  delete from public.payout_transfers where payout_id = po.id and status in ('pending', 'failed');
  v_remaining := po.amount - coalesce((select sum(amount) from public.payout_transfers
                                        where payout_id = po.id and status in ('processing', 'transferred')), 0);
  for pm in
    select p.id, p.amount
      from public.payments p
     where p.booking_id = po.booking_id and p.status = 'paid' and p.razorpay_payment_id is not null
     order by (p.purpose <> 'visit_fee'), p.paid_at, p.id
  loop
    exit when v_remaining <= 0;
    v_avail := pm.amount - coalesce((select sum(t.amount) from public.payout_transfers t
                                       where t.source_payment_id = pm.id and t.status <> 'failed'), 0);
    v_take := least(v_avail, v_remaining);
    if v_take > 0 then
      insert into public.payout_transfers (payout_id, source_payment_id, amount) values (po.id, pm.id, v_take);
      v_remaining := v_remaining - v_take;
    end if;
  end loop;
  perform public._assert(v_remaining <= 0, 'paid amount does not cover provider payout');
end;
$$;

create or replace function public._create_payout(
  p_booking_id uuid, p_gross int, p_commissionable int, p_release_after timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid;
  v_bp int;
  v_commission int;
  v_gst int;
  v_payout uuid;
begin
  select provider_id into v_provider from public.bookings where id = p_booking_id;
  v_bp := public._commission_bp(v_provider, now());
  v_commission := round(p_commissionable::numeric * v_bp / 10000);
  v_gst := round(v_commission::numeric * 18 / 100);
  insert into public.payouts (booking_id, provider_id, gross, commission, gst_on_commission, amount, release_after)
  values (p_booking_id, v_provider, p_gross, v_commission, v_gst, greatest(p_gross - v_commission - v_gst, 0), p_release_after)
  on conflict (booking_id) do nothing
  returning id into v_payout;
  if v_payout is not null then
    update public.bookings set commission = v_commission, gst_on_commission = v_gst where id = p_booking_id;
    perform public._allocate_payout(v_payout);
  end if;
end;
$$;

create or replace function public._activate_quote(p_booking_id uuid, p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  q public.quotes;
begin
  select * into b from public.bookings where id = p_booking_id;
  select * into q from public.quotes where id = p_quote_id;
  update public.quotes set status = 'superseded' where booking_id = p_booking_id and status = 'approved' and id <> q.id;
  update public.quotes set status = 'approved' where id = q.id;
  update public.bookings
     set approved_quote_id = q.id,
         total_amount = public._required_total(q.total, b.visit_fee, b.platform_fee)
   where id = p_booking_id;
end;
$$;

create or replace function public._close_open_quotes(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payments set status = 'failed'
   where booking_id = p_booking_id and status = 'created'
     and quote_id in (select id from public.quotes where booking_id = p_booking_id
                       and status in ('sent', 'approved_pending_payment'));
  update public.quotes set status = 'superseded'
   where booking_id = p_booking_id and status in ('sent', 'approved_pending_payment');
end;
$$;

create or replace function public._finalize_completion(p_booking_id uuid, p_actor uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  q public.quotes;
  v_completed timestamptz := now();
begin
  select * into b from public.bookings where id = p_booking_id;
  select * into q from public.quotes where id = b.approved_quote_id;
  perform public._assert(q.id is not null, 'no approved quote');
  perform public._close_open_quotes(b.id);
  update public.bookings set completed_at = v_completed where id = b.id;
  perform public._create_payout(b.id, greatest(q.total, b.visit_fee), q.subtotal_labour, v_completed + interval '24 hours');
  update public.providers set jobs_completed = jobs_completed + 1 where id = b.provider_id;
  update public.providers set commission_tier = public._commission_bp(id, now()) / 100 where id = b.provider_id;
  perform public._set_status(b.id, 'completed', p_actor, p_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- Provider profile RPCs
-- ---------------------------------------------------------------------------
create or replace function public.upsert_provider_profile(
  p_full_name text, p_bio text, p_city text, p_service_radius_km int,
  p_lat double precision, p_lng double precision, p_years_experience int, p_languages text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_loc extensions.geography;
begin
  perform public._assert(coalesce(trim(p_city), '') <> '', 'city is required');
  if p_lat is not null and p_lng is not null then
    v_loc := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  end if;
  update public.profiles
     set full_name = coalesce(nullif(trim(p_full_name), ''), full_name), role_provider = true
   where id = v_uid;
  insert into public.providers (id, bio, city, service_radius_km, base_location, years_experience, languages)
  values (v_uid, coalesce(p_bio, ''), trim(p_city), coalesce(p_service_radius_km, 10), v_loc,
          coalesce(p_years_experience, 0), coalesce(p_languages, '{}'))
  on conflict (id) do update
     set bio = excluded.bio,
         city = excluded.city,
         service_radius_km = excluded.service_radius_km,
         base_location = coalesce(excluded.base_location, public.providers.base_location),
         years_experience = excluded.years_experience,
         languages = excluded.languages;
end;
$$;

create or replace function public.set_provider_online(p_online boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  update public.providers set is_online = p_online where id = v_uid;
  perform public._assert(found, 'provider profile not found');
end;
$$;

-- ---------------------------------------------------------------------------
-- Search (PRD 5.3 Bayesian recommended score)
-- ---------------------------------------------------------------------------
create or replace function public.search_providers(
  p_category_slug text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_sort text default 'recommended',
  p_min_rating numeric default null,
  p_skill_level public.skill_level default null,
  p_max_visit_fee int default null,
  p_online_only boolean default false,
  p_limit int default 50
)
returns table (
  provider_id uuid,
  provider_service_id uuid,
  full_name text,
  avatar_url text,
  city text,
  skill_level public.skill_level,
  visit_fee int,
  labour_rate int,
  rate_unit public.rate_unit,
  rating_avg numeric,
  rating_count int,
  jobs_completed int,
  years_experience int,
  is_online boolean,
  distance_km double precision,
  score double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with origin as (
    select case when p_lat is not null and p_lng is not null
                then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
           end as g
  ),
  city_avg as (
    select p.city, avg(r.rating)::numeric as m
      from public.reviews r join public.providers p on p.id = r.provider_id
     group by p.city
  ),
  stats as (
    select b.provider_id,
           count(*) filter (where b.status in ('completed', 'closed'))::numeric as done,
           count(*) filter (where b.accepted_at is not null)::numeric as accepted,
           avg(extract(epoch from (b.accepted_at - b.created_at)) / 60.0)
             filter (where b.accepted_at is not null) as avg_response_min
      from public.bookings b
     group by b.provider_id
  ),
  base as (
    select pr.id as provider_id,
           ps.id as provider_service_id,
           pf.full_name,
           pf.avatar_url,
           pr.city,
           ps.skill_level,
           ps.visit_fee,
           ps.labour_rate,
           ps.rate_unit,
           pr.rating_avg,
           pr.rating_count,
           pr.jobs_completed,
           pr.years_experience,
           pr.is_online,
           case when o.g is not null and pr.base_location is not null
                then extensions.st_distance(pr.base_location, o.g) / 1000.0 end as distance_km,
           ((10 * coalesce(ca.m, 4.0) + pr.rating_avg * pr.rating_count) / (10 + pr.rating_count))::double precision as bayes,
           coalesce(s.done / nullif(s.accepted, 0), 0.8)::double precision as completion_rate,
           (case when s.avg_response_min is null then 0.5
                 else 1 - least(s.avg_response_min, 15) / 15.0 end)::double precision as response_speed
      from public.provider_services ps
      join public.categories c on c.id = ps.category_id and c.slug = p_category_slug and c.active
      join public.providers pr on pr.id = ps.provider_id
      join public.profiles pf on pf.id = pr.id
      cross join origin o
      left join city_avg ca on ca.city = pr.city
      left join stats s on s.provider_id = pr.id
     where pr.kyc_status = 'verified'
       and not pr.suspended
       and ps.active
       and (o.g is null or pr.base_location is null
            or extensions.st_dwithin(pr.base_location, o.g, pr.service_radius_km * 1000.0))
       and (p_min_rating is null or pr.rating_avg >= p_min_rating)
       and (p_skill_level is null or ps.skill_level = p_skill_level)
       and (p_max_visit_fee is null or ps.visit_fee <= p_max_visit_fee)
       and (not coalesce(p_online_only, false) or pr.is_online)
  ),
  scored as (
    select b.*,
           0.60 * greatest(least((b.bayes - 1) / 4.0, 1), 0)
         + 0.15 * b.completion_rate
         + 0.15 * (case when b.distance_km is null then 0.5
                        else 1 - b.distance_km / greatest(max(b.distance_km) over (), 1) end)
         + 0.10 * b.response_speed as score
      from base b
  )
  select s.provider_id, s.provider_service_id, s.full_name, s.avatar_url, s.city, s.skill_level,
         s.visit_fee, s.labour_rate, s.rate_unit, s.rating_avg, s.rating_count, s.jobs_completed,
         s.years_experience, s.is_online, s.distance_km, s.score
    from scored s
   order by
     case when p_sort = 'rating' then s.rating_avg end desc nulls last,
     case when p_sort = 'rating' then s.rating_count end desc nulls last,
     case when p_sort = 'price' then s.visit_fee end asc nulls last,
     case when p_sort = 'distance' then s.distance_km end asc nulls last,
     case when p_sort = 'experience' then s.years_experience end desc nulls last,
     s.score desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- ---------------------------------------------------------------------------
-- Booking lifecycle RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_booking(
  p_provider_service_id uuid,
  p_description text,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision,
  p_scheduled_at timestamptz default null,
  p_photos text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_ps record;
  v_address uuid;
  v_booking uuid;
  c_platform_fee constant int := 2900;
begin
  select ps.id, ps.provider_id, ps.category_id, ps.visit_fee
    into v_ps
    from public.provider_services ps
    join public.providers pr on pr.id = ps.provider_id
   where ps.id = p_provider_service_id and ps.active and pr.kyc_status = 'verified' and not pr.suspended;
  perform public._assert(found, 'service not available');
  perform public._assert(v_ps.provider_id <> v_uid, 'cannot book yourself');
  perform public._assert(coalesce(trim(p_address_line), '') <> '' and coalesce(trim(p_city), '') <> '', 'address is required');
  perform public._assert(p_lat is not null and p_lng is not null, 'location is required');
  perform public._assert(p_scheduled_at is null or p_scheduled_at > now() - interval '5 minutes', 'scheduled time is in the past');
  perform public._assert(coalesce(array_length(p_photos, 1), 0) <= 4, 'at most 4 photos');
  perform public._assert(not exists (select 1 from unnest(coalesce(p_photos, '{}')) ph
                                      where ph not like v_uid::text || '/%'), 'invalid photo path');

  insert into public.addresses (user_id, label, line1, city, lat, lng)
  values (v_uid, 'Booking', trim(p_address_line), trim(p_city), p_lat, p_lng)
  returning id into v_address;

  insert into public.bookings (customer_id, provider_id, category_id, provider_service_id, address_id,
                               description, photos, scheduled_at, visit_fee, platform_fee)
  values (v_uid, v_ps.provider_id, v_ps.category_id, v_ps.id, v_address,
          coalesce(p_description, ''), coalesce(p_photos, '{}'), p_scheduled_at, v_ps.visit_fee, c_platform_fee)
  returning id into v_booking;

  insert into public.booking_secrets (booking_id, start_otp) values (v_booking, public._gen_otp());
  insert into public.booking_events (booking_id, actor_id, from_status, to_status)
  values (v_booking, v_uid, null, 'pending_payment');
  return v_booking;
end;
$$;

create or replace function public.accept_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can accept');
  perform public._assert(b.status = 'requested', 'booking is not awaiting acceptance');
  perform public._assert(not exists (select 1 from public.providers where id = v_uid and suspended), 'account suspended');
  update public.bookings set accepted_at = now() where id = b.id;
  perform public._set_status(b.id, 'accepted', v_uid);
end;
$$;

create or replace function public.decline_booking(p_booking_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can decline');
  perform public._assert(b.status = 'requested', 'booking is not awaiting acceptance');
  update public.bookings set cancelled_reason = p_reason where id = b.id;
  update public.payments set status = 'refund_pending' where booking_id = b.id and status = 'paid';
  perform public._set_status(b.id, 'declined', v_uid, p_reason);
end;
$$;

create or replace function public.start_trip(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can start the trip');
  perform public._assert(b.status = 'accepted', 'booking is not accepted');
  perform public._set_status(b.id, 'en_route', v_uid);
end;
$$;

-- OTP checks return jsonb instead of raising so the attempt counter increment is committed.
create or replace function public.arrive(p_booking_id uuid, p_otp text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  s public.booking_secrets;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can mark arrival');
  perform public._assert(b.status = 'en_route', 'provider is not en route');
  select * into s from public.booking_secrets where booking_id = b.id for update;
  if s.start_attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'locked', 'attempts_left', 0);
  end if;
  if p_otp is distinct from s.start_otp then
    update public.booking_secrets set start_attempts = start_attempts + 1 where booking_id = b.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_otp', 'attempts_left', 4 - s.start_attempts);
  end if;
  update public.booking_secrets set start_attempts = 0 where booking_id = b.id;
  perform public._set_status(b.id, 'inspecting', v_uid);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_booking_otps(p_booking_id uuid)
returns table (start_otp text, start_locked boolean, end_otp text, end_locked boolean)
language sql
stable
security definer
set search_path = public
as $$
  select case when b.status in ('accepted', 'en_route') then s.start_otp end,
         s.start_attempts >= 5,
         case when b.status = 'completion_requested' then s.end_otp end,
         s.end_attempts >= 5
    from public.bookings b
    join public.booking_secrets s on s.booking_id = b.id
   where b.id = p_booking_id and b.customer_id = auth.uid();
$$;

create or replace function public.regenerate_otp(p_booking_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can regenerate codes');
  if p_kind = 'start' then
    perform public._assert(b.status in ('accepted', 'en_route'), 'start code not applicable now');
    update public.booking_secrets set start_otp = public._gen_otp(), start_attempts = 0 where booking_id = b.id;
  elsif p_kind = 'end' then
    perform public._assert(b.status = 'completion_requested', 'end code not applicable now');
    update public.booking_secrets set end_otp = public._gen_otp(), end_attempts = 0 where booking_id = b.id;
  else
    raise exception 'unknown otp kind' using errcode = '22023';
  end if;
  perform public._log_event(b.id, v_uid, p_kind || ' code regenerated');
end;
$$;

-- Initial quote (inspecting/quote_sent) or change order (in_progress; booking status unchanged).
create or replace function public.send_quote(p_booking_id uuid, p_items jsonb, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_item jsonb;
  v_kind public.quote_item_kind;
  v_qty numeric;
  v_price int;
  v_line int;
  v_labour int := 0;
  v_parts int := 0;
  v_other int := 0;
  v_version int;
  v_quote uuid;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can send a quote');
  perform public._assert(b.status in ('inspecting', 'quote_sent', 'in_progress'), 'quote not allowed in this state');
  perform public._assert(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 30,
                         'quote needs 1 to 30 items');

  perform public._close_open_quotes(b.id);
  select coalesce(max(version), 0) + 1 into v_version from public.quotes where booking_id = b.id;
  insert into public.quotes (booking_id, version, total, note, is_change_order)
  values (b.id, v_version, 0, p_note, b.status = 'in_progress')
  returning id into v_quote;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind := (v_item ->> 'kind')::public.quote_item_kind;
    v_qty := (v_item ->> 'qty')::numeric;
    v_price := (v_item ->> 'unit_price')::int;
    perform public._assert(coalesce(trim(v_item ->> 'title'), '') <> '', 'item title is required');
    perform public._assert(v_qty > 0 and v_qty <= 1000, 'invalid quantity');
    perform public._assert(v_price >= 0 and v_price <= 10000000, 'invalid unit price');
    v_line := round(v_qty * v_price);
    case v_kind
      when 'labour' then v_labour := v_labour + v_line;
      when 'part' then v_parts := v_parts + v_line;
      else v_other := v_other + v_line;
    end case;
    insert into public.quote_items (quote_id, kind, title, qty, unit_price, bill_photo_url)
    values (v_quote, v_kind, trim(v_item ->> 'title'), v_qty, v_price, nullif(v_item ->> 'bill_photo_url', ''));
  end loop;

  update public.quotes
     set subtotal_labour = v_labour, subtotal_parts = v_parts, subtotal_other = v_other,
         total = v_labour + v_parts + v_other
   where id = v_quote;

  if b.status = 'inspecting' then
    perform public._set_status(b.id, 'quote_sent', v_uid, 'quote v' || v_version);
  else
    perform public._log_event(b.id, v_uid,
      case when b.status = 'in_progress' then 'change order v' else 'quote v' end || v_version);
  end if;
  return v_quote;
end;
$$;

create or replace function public.approve_quote(p_booking_id uuid, p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  v_initial boolean;
  v_due int;
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can approve');
  select * into q from public.quotes where id = p_quote_id and booking_id = b.id for update;
  perform public._assert(found and q.status = 'sent', 'quote is not open');
  v_initial := b.status = 'quote_sent' and b.approved_quote_id is null;
  perform public._assert(v_initial or (b.status = 'in_progress' and b.approved_quote_id is not null),
                         'quote cannot be approved in this state');

  v_due := public._required_total(q.total, b.visit_fee, b.platform_fee) - public._paid_total(b.id);
  if v_due > 0 then
    update public.quotes set status = 'approved_pending_payment' where id = q.id;
    if v_initial then
      perform public._set_status(b.id, 'awaiting_payment', v_uid, 'quote v' || q.version || ' approved, due ' || v_due);
    else
      perform public._log_event(b.id, v_uid, 'change order v' || q.version || ' approved, due ' || v_due);
    end if;
  else
    perform public._activate_quote(b.id, q.id);
    if v_initial then
      perform public._set_status(b.id, 'in_progress', v_uid, 'quote v' || q.version || ' approved');
    else
      perform public._log_event(b.id, v_uid, 'change order v' || q.version || ' approved'
        || case when v_due < 0 then ', overpaid ' || (-v_due) || ' (manual refund)' else '' end);
    end if;
  end if;
  return jsonb_build_object('amount_due', greatest(v_due, 0));
end;
$$;

create or replace function public.reject_quote(p_booking_id uuid, p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can reject');
  select * into q from public.quotes where id = p_quote_id and booking_id = b.id for update;
  perform public._assert(found and q.status = 'sent', 'quote is not open');
  update public.quotes set status = 'rejected' where id = q.id;

  if b.status = 'quote_sent' and b.approved_quote_id is null then
    perform public._create_payout(b.id, b.visit_fee, b.visit_fee, now() + interval '24 hours');
    perform public._set_status(b.id, 'closed_no_work', v_uid, 'quote v' || q.version || ' rejected');
  else
    perform public._log_event(b.id, v_uid, 'change order v' || q.version || ' rejected');
  end if;
end;
$$;

create or replace function public.request_completion(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can request completion');
  perform public._assert(b.status = 'in_progress', 'job is not in progress');
  perform public._assert(not exists (select 1 from public.quotes where booking_id = b.id
                                      and status in ('sent', 'approved_pending_payment')),
                         'resolve the pending change order first');
  update public.booking_secrets set end_otp = public._gen_otp(), end_attempts = 0 where booking_id = b.id;
  update public.bookings set completion_requested_at = now() where id = b.id;
  perform public._set_status(b.id, 'completion_requested', v_uid);
end;
$$;

-- Provider enters the end OTP the customer reads out.
create or replace function public.complete_booking(p_booking_id uuid, p_otp text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  s public.booking_secrets;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can complete');
  perform public._assert(b.status = 'completion_requested', 'completion was not requested');
  select * into s from public.booking_secrets where booking_id = b.id for update;
  if s.end_attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'locked', 'attempts_left', 0);
  end if;
  if s.end_otp is null or p_otp is distinct from s.end_otp then
    update public.booking_secrets set end_attempts = end_attempts + 1 where booking_id = b.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_otp', 'attempts_left', 4 - s.end_attempts);
  end if;
  perform public._finalize_completion(b.id, v_uid, 'end code verified');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.confirm_completion(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can confirm');
  perform public._assert(b.status = 'completion_requested', 'completion was not requested');
  perform public._finalize_completion(b.id, v_uid, 'confirmed by customer');
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can cancel');
  perform public._assert(b.status in ('pending_payment', 'requested', 'accepted', 'en_route', 'awaiting_payment'),
                         'booking can no longer be cancelled');
  update public.bookings set cancelled_reason = p_reason where id = b.id;
  update public.payments set status = 'failed' where booking_id = b.id and status = 'created';
  perform public._close_open_quotes(b.id);
  if b.status in ('en_route', 'awaiting_payment') then
    -- Chargeable cancellation: visit fee is forfeited to the provider.
    perform public._create_payout(b.id, b.visit_fee, b.visit_fee, now() + interval '24 hours');
  else
    update public.payments set status = 'refund_pending' where booking_id = b.id and status = 'paid';
  end if;
  perform public._set_status(b.id, 'cancelled', v_uid, p_reason);
end;
$$;

create or replace function public.dispute_booking(p_booking_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can raise a dispute');
  perform public._assert(b.status in ('in_progress', 'completion_requested', 'completed'), 'dispute not allowed in this state');
  perform public._assert(coalesce(trim(p_reason), '') <> '', 'reason is required');
  perform public._assert(not exists (
    select 1 from public.payout_transfers t join public.payouts po on po.id = t.payout_id
     where po.booking_id = b.id and t.status in ('processing', 'transferred')
  ), 'payout already released');
  update public.payouts set status = 'frozen' where booking_id = b.id and status = 'pending';
  perform public._set_status(b.id, 'disputed', v_uid, p_reason);
end;
$$;

create or replace function public.submit_review(
  p_booking_id uuid, p_rating int, p_punctuality int default null, p_quality int default null,
  p_behaviour int default null, p_pricing int default null, p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_id uuid;
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can review');
  perform public._assert(b.status in ('completed', 'closed'), 'only completed jobs can be reviewed');
  perform public._assert(b.total_amount is not null and public._paid_total(b.id) >= b.total_amount,
                         'only jobs paid in the app can be reviewed');
  perform public._assert(not exists (select 1 from public.reviews where booking_id = b.id), 'already reviewed');
  insert into public.reviews (booking_id, customer_id, provider_id, rating, punctuality, quality, behaviour, pricing, comment)
  values (b.id, v_uid, b.provider_id, p_rating, p_punctuality, p_quality, p_behaviour, p_pricing, nullif(trim(p_comment), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privacy-aware reads
-- ---------------------------------------------------------------------------
-- Provider inbox: exact address only after acceptance; before that only area (city) and distance.
create or replace function public.get_provider_jobs()
returns table (
  booking_id uuid,
  status public.booking_status,
  category_name text,
  customer_name text,
  description text,
  scheduled_at timestamptz,
  created_at timestamptz,
  visit_fee int,
  area text,
  distance_km double precision,
  address_line text,
  lat double precision,
  lng double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.status, c.name, pf.full_name, b.description, b.scheduled_at, b.created_at, b.visit_fee,
         a.city,
         case when pr.base_location is not null and a.location is not null
              then round((extensions.st_distance(pr.base_location, a.location) / 1000.0)::numeric, 1)::double precision end,
         case when b.accepted_at is not null then a.line1 end,
         case when b.accepted_at is not null then a.lat end,
         case when b.accepted_at is not null then a.lng end
    from public.bookings b
    join public.categories c on c.id = b.category_id
    join public.profiles pf on pf.id = b.customer_id
    join public.addresses a on a.id = b.address_id
    join public.providers pr on pr.id = b.provider_id
   where b.provider_id = auth.uid()
     and b.status <> 'pending_payment'
   order by b.created_at desc
   limit 200;
$$;

create or replace function public.get_booking_address(p_booking_id uuid)
returns table (area text, address_line text, lat double precision, lng double precision)
language sql
stable
security definer
set search_path = public
as $$
  select a.city,
         case when b.customer_id = auth.uid() or b.accepted_at is not null then a.line1 end,
         case when b.customer_id = auth.uid() or b.accepted_at is not null then a.lat end,
         case when b.customer_id = auth.uid() or b.accepted_at is not null then a.lng end
    from public.bookings b
    join public.addresses a on a.id = b.address_id
   where b.id = p_booking_id
     and auth.uid() in (b.customer_id, b.provider_id);
$$;

-- ---------------------------------------------------------------------------
-- Admin RPCs (users listed in public.admins)
-- ---------------------------------------------------------------------------
create or replace function public.set_provider_suspended(p_provider_id uuid, p_suspended boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(coalesce(trim(p_reason), '') <> '', 'reason is required');
  update public.providers set suspended = p_suspended, is_online = case when p_suspended then false else is_online end
   where id = p_provider_id;
  perform public._assert(found, 'provider not found');
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_provider_suspended', p_provider_id, jsonb_build_object('suspended', p_suspended, 'reason', p_reason));
end;
$$;

create or replace function public.resolve_dispute(
  p_booking_id uuid, p_outcome public.dispute_outcome, p_refund_amount int default null, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  po public.payouts;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(b.status = 'disputed', 'booking is not disputed');

  if p_outcome = 'full_refund' then
    update public.payout_transfers set status = 'failed', last_error = 'dispute: full refund'
     where status = 'pending' and payout_id in (select id from public.payouts where booking_id = b.id);
    update public.payouts set status = 'reversed', amount = 0 where booking_id = b.id;
    update public.payments set status = 'refund_pending' where booking_id = b.id and status = 'paid';
    update public.bookings set refund_amount = public._paid_total(b.id) where id = b.id;
    perform public._set_status(b.id, 'refunded', v_uid, coalesce(p_note, 'dispute: full refund'));
  else
    if not exists (select 1 from public.payouts where booking_id = b.id) then
      perform public._finalize_completion(b.id, v_uid, 'dispute resolved before completion');
    else
      perform public._set_status(b.id, 'completed', v_uid, 'dispute resolved');
    end if;
    select * into po from public.payouts where booking_id = b.id for update;
    if p_outcome = 'partial_refund' then
      perform public._assert(p_refund_amount > 0 and p_refund_amount <= po.amount, 'invalid refund amount');
      update public.payouts set amount = amount - p_refund_amount where id = po.id;
      update public.bookings set refund_amount = refund_amount + p_refund_amount where id = b.id;
    end if;
    update public.payouts set status = 'pending', release_after = greatest(release_after, now()) where id = po.id;
    perform public._allocate_payout(po.id);
  end if;

  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'resolve_dispute', b.id,
          jsonb_build_object('outcome', p_outcome, 'refund_amount', p_refund_amount, 'note', p_note));
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role internals (Edge Functions / cron)
-- ---------------------------------------------------------------------------
-- Computes what the customer owes now and returns a reusable or new payments row.
create or replace function public.prepare_payment(p_booking_id uuid, p_user_id uuid)
returns table (payment_id uuid, amount int, purpose public.payment_purpose, short_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  v_purpose public.payment_purpose;
  v_amount int;
  v_quote uuid;
  p public.payments;
begin
  perform public._assert(b.customer_id = p_user_id, 'only the customer can pay');
  if b.status = 'pending_payment' then
    v_purpose := 'visit_fee';
    v_amount := b.visit_fee;
  elsif b.status in ('awaiting_payment', 'in_progress') then
    select * into q from public.quotes x
     where x.booking_id = b.id and x.status = 'approved_pending_payment'
     order by x.version desc limit 1;
    perform public._assert(q.id is not null, 'nothing to pay');
    v_purpose := 'balance';
    v_quote := q.id;
    v_amount := public._required_total(q.total, b.visit_fee, b.platform_fee) - public._paid_total(b.id);
  else
    raise exception 'nothing to pay in this state' using errcode = 'P0001';
  end if;
  perform public._assert(v_amount > 0, 'nothing to pay');

  select * into p from public.payments x
   where x.booking_id = b.id and x.status = 'created' and x.purpose = v_purpose
     and x.amount = v_amount and x.quote_id is not distinct from v_quote and x.short_url is not null
   order by x.created_at desc limit 1;
  if found then
    return query select p.id, p.amount, p.purpose, p.short_url;
    return;
  end if;

  update public.payments x set status = 'failed' where x.booking_id = b.id and x.status = 'created';
  insert into public.payments (booking_id, quote_id, purpose, amount)
  values (b.id, v_quote, v_purpose, v_amount)
  returning * into p;
  return query select p.id, p.amount, p.purpose, null::text;
end;
$$;

-- Idempotent (deduped by razorpay_payment_id). Called by the razorpay-webhook function.
create or replace function public.record_payment_paid(p_link_id text, p_payment_id text, p_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  b public.bookings;
  q public.quotes;
begin
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into p from public.payments where razorpay_link_id = p_link_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown link');
  end if;
  if p.amount <> p_amount then
    return jsonb_build_object('ok', false, 'error', 'amount mismatch');
  end if;

  b := public._lock_booking(p.booking_id);
  update public.payments set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now() where id = p.id;

  if b.status in ('cancelled', 'expired', 'declined', 'closed_no_work', 'refunded') then
    update public.payments set status = 'refund_pending' where id = p.id;
    perform public._log_event(b.id, null, 'late payment ' || p_payment_id || ' marked for refund');
  elsif p.purpose = 'visit_fee' and b.status = 'pending_payment' then
    perform public._set_status(b.id, 'requested', null, 'visit fee paid');
  elsif p.purpose = 'balance' and p.quote_id is not null then
    select * into q from public.quotes where id = p.quote_id for update;
    if q.status = 'approved_pending_payment'
       and public._paid_total(b.id) >= public._required_total(q.total, b.visit_fee, b.platform_fee) then
      perform public._activate_quote(b.id, q.id);
      if b.status = 'awaiting_payment' then
        perform public._set_status(b.id, 'in_progress', null, 'balance paid');
      else
        perform public._log_event(b.id, null, 'change order v' || q.version || ' paid');
      end if;
    else
      perform public._log_event(b.id, null, 'payment ' || p_payment_id || ' received for inactive quote');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'booking_id', b.id);
end;
$$;

create or replace function public.expire_stale_requests()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in select id from public.bookings
            where status = 'requested' and updated_at < now() - interval '15 minutes'
            for update skip locked loop
    update public.payments set status = 'refund_pending' where booking_id = r.id and status = 'paid';
    perform public._set_status(r.id, 'expired', null, 'not accepted within 15 minutes');
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.auto_confirm_completions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in select id from public.bookings
            where status = 'completion_requested' and completion_requested_at < now() - interval '24 hours'
            for update skip locked loop
    perform public._finalize_completion(r.id, null, 'auto-confirmed after 24h');
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.claim_due_transfers(p_limit int default 20)
returns table (
  transfer_id uuid, payout_id uuid, booking_id uuid, amount int, razorpay_payment_id text, account_id text
)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update public.payout_transfers pt
       set status = 'processing'
     where pt.id in (
       select t.id
         from public.payout_transfers t
         join public.payouts po on po.id = t.payout_id
         join public.bookings b on b.id = po.booking_id
         join public.providers pr on pr.id = po.provider_id
        where t.status = 'pending'
          and po.status = 'pending'
          and po.release_after <= now()
          and b.status <> 'disputed'
          and pr.razorpay_account_id is not null
        order by po.release_after
        limit p_limit
        for update of t skip locked
     )
    returning pt.*
  )
  select c.id, c.payout_id, po.booking_id, c.amount, pm.razorpay_payment_id, pr.razorpay_account_id
    from claimed c
    join public.payouts po on po.id = c.payout_id
    join public.providers pr on pr.id = po.provider_id
    join public.payments pm on pm.id = c.source_payment_id;
$$;

create or replace function public.complete_transfer(p_transfer_id uuid, p_razorpay_transfer_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout uuid;
  v_booking uuid;
begin
  update public.payout_transfers
     set status = 'transferred', razorpay_transfer_id = p_razorpay_transfer_id, transferred_at = now(), last_error = null
   where id = p_transfer_id and status = 'processing'
  returning payout_id into v_payout;
  if v_payout is null then
    return;
  end if;
  if not exists (select 1 from public.payout_transfers where payout_id = v_payout and status <> 'transferred') then
    update public.payouts set status = 'transferred', transferred_at = now()
     where id = v_payout returning booking_id into v_booking;
    if exists (select 1 from public.bookings where id = v_booking and status = 'completed') then
      perform public._set_status(v_booking, 'closed', null, 'payout transferred');
    end if;
  end if;
end;
$$;

create or replace function public.fail_transfer(p_transfer_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payout_transfers set status = 'failed', last_error = left(p_error, 2000)
   where id = p_transfer_id and status = 'processing';
  update public.payouts set status = 'failed'
   where id = (select payout_id from public.payout_transfers where id = p_transfer_id) and status = 'pending';
end;
$$;

-- Linked-account (Route) status drives KYC; there is intentionally no manual "mark verified" RPC.
create or replace function public.sync_provider_kyc(p_provider_id uuid, p_account_id text, p_gateway_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.providers
     set razorpay_account_id = p_account_id,
         kyc_reference = p_account_id,
         kyc_status = case
                        when p_gateway_status = 'activated' then 'verified'::public.kyc_status
                        when p_gateway_status in ('rejected', 'suspended') then 'rejected'::public.kyc_status
                        else 'pending'::public.kyc_status
                      end
   where id = p_provider_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.private_user_accounts enable row level security;
alter table public.admins enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.addresses enable row level security;
alter table public.categories enable row level security;
alter table public.providers enable row level security;
alter table public.provider_services enable row level security;
alter table public.rate_card_items enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_secrets enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.payments enable row level security;
alter table public.payouts enable row level security;
alter table public.payout_transfers enable row level security;
alter table public.reviews enable row level security;
alter table public.messages enable row level security;
alter table public.booking_events enable row level security;

-- Tables with no client access whatsoever.
revoke all on public.booking_secrets, public.admins, public.admin_audit_log from anon, authenticated;

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, avatar_url, role_customer, role_provider) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or exists (select 1 from public.providers p where p.id = profiles.id and p.kyc_status = 'verified' and not p.suspended)
  or exists (select 1 from public.bookings b
              where (b.customer_id = auth.uid() and b.provider_id = profiles.id)
                 or (b.provider_id = auth.uid() and b.customer_id = profiles.id))
);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke all on public.private_user_accounts from anon, authenticated;
grant select on public.private_user_accounts to authenticated;
grant update (expo_push_token) on public.private_user_accounts to authenticated;
create policy private_accounts_own_select on public.private_user_accounts for select to authenticated
  using (user_id = auth.uid());
create policy private_accounts_own_update on public.private_user_accounts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy addresses_own on public.addresses for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke insert, update, delete on public.categories from anon, authenticated;
create policy categories_read on public.categories for select using (active);

revoke insert, update, delete on public.providers from anon, authenticated;
create policy providers_read on public.providers for select
  using ((kyc_status = 'verified' and not suspended) or id = auth.uid());

create policy provider_services_read on public.provider_services for select using (
  provider_id = auth.uid()
  or (active and exists (select 1 from public.providers p
                          where p.id = provider_id and p.kyc_status = 'verified' and not p.suspended))
);
create policy provider_services_insert on public.provider_services for insert to authenticated
  with check (provider_id = auth.uid());
create policy provider_services_update on public.provider_services for update to authenticated
  using (provider_id = auth.uid()) with check (provider_id = auth.uid());
create policy provider_services_delete on public.provider_services for delete to authenticated
  using (provider_id = auth.uid());

create policy rate_card_read on public.rate_card_items for select using (
  exists (select 1 from public.provider_services ps join public.providers p on p.id = ps.provider_id
           where ps.id = provider_service_id
             and ((p.kyc_status = 'verified' and not p.suspended) or p.id = auth.uid()))
);
create policy rate_card_write on public.rate_card_items for all to authenticated
  using (exists (select 1 from public.provider_services ps where ps.id = provider_service_id and ps.provider_id = auth.uid()))
  with check (exists (select 1 from public.provider_services ps where ps.id = provider_service_id and ps.provider_id = auth.uid()));

-- Booking-related data is read-only to clients; every mutation goes through an RPC.
revoke insert, update, delete on public.bookings, public.quotes, public.quote_items, public.payments,
  public.payouts, public.payout_transfers, public.reviews, public.booking_events from anon, authenticated;

create policy bookings_participants on public.bookings for select to authenticated
  using (customer_id = auth.uid() or provider_id = auth.uid());
create policy quotes_participants on public.quotes for select to authenticated
  using (public._is_participant(booking_id));
create policy quote_items_participants on public.quote_items for select to authenticated using (
  exists (select 1 from public.quotes q where q.id = quote_id and public._is_participant(q.booking_id))
);
create policy payments_participants on public.payments for select to authenticated
  using (public._is_participant(booking_id));
create policy payouts_provider on public.payouts for select to authenticated using (provider_id = auth.uid());
create policy payout_transfers_provider on public.payout_transfers for select to authenticated using (
  exists (select 1 from public.payouts po where po.id = payout_id and po.provider_id = auth.uid())
);
create policy reviews_public on public.reviews for select using (true);
create policy booking_events_participants on public.booking_events for select to authenticated
  using (public._is_participant(booking_id));

revoke update, delete on public.messages from anon, authenticated;
create policy messages_read on public.messages for select to authenticated using (public._is_participant(booking_id));
create policy messages_insert on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and exists (select 1 from public.bookings b
               where b.id = booking_id and auth.uid() in (b.customer_id, b.provider_id)
                 and b.status not in ('pending_payment', 'declined', 'expired', 'cancelled'))
);

-- ---------------------------------------------------------------------------
-- Storage: job, portfolio and dispute photos only (no identity documents).
-- Object paths are "<uid>/<file>".
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('job-photos', 'job-photos', false),
  ('portfolio', 'portfolio', true),
  ('dispute-photos', 'dispute-photos', false)
on conflict (id) do nothing;

create policy storage_own_upload on storage.objects for insert to authenticated with check (
  bucket_id in ('job-photos', 'portfolio', 'dispute-photos')
  and (storage.foldername(name))[1] = auth.uid()::text
);
create policy storage_own_delete on storage.objects for delete to authenticated using (
  bucket_id in ('job-photos', 'portfolio', 'dispute-photos')
  and (storage.foldername(name))[1] = auth.uid()::text
);
create policy storage_job_photos_read on storage.objects for select to authenticated using (
  bucket_id = 'job-photos'
  and ((storage.foldername(name))[1] = auth.uid()::text
       or exists (select 1 from public.bookings b
                   where objects.name = any (b.photos) and auth.uid() in (b.customer_id, b.provider_id)))
);
create policy storage_dispute_photos_read on storage.objects for select to authenticated using (
  bucket_id = 'dispute-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public._is_admin())
);
create policy storage_portfolio_read on storage.objects for select using (bucket_id = 'portfolio');

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public._assert(boolean, text),
  public._require_uid(),
  public._gen_otp(),
  public._lock_booking(uuid),
  public._set_status(uuid, public.booking_status, uuid, text),
  public._log_event(uuid, uuid, text),
  public._paid_total(uuid),
  public._commission_bp(uuid, timestamptz),
  public._required_total(int, int, int),
  public._allocate_payout(uuid),
  public._create_payout(uuid, int, int, timestamptz),
  public._activate_quote(uuid, uuid),
  public._close_open_quotes(uuid),
  public._finalize_completion(uuid, uuid, text),
  public.handle_new_user(),
  public.refresh_provider_rating(),
  public.set_address_location(),
  public.prepare_payment(uuid, uuid),
  public.record_payment_paid(text, text, int),
  public.expire_stale_requests(),
  public.auto_confirm_completions(),
  public.claim_due_transfers(int),
  public.complete_transfer(uuid, text),
  public.fail_transfer(uuid, text),
  public.sync_provider_kyc(uuid, text, text)
from public, anon, authenticated;

-- Used inside RLS policies, so they must stay executable by signed-in users (read-only, caller-scoped).
revoke execute on function public._is_admin(), public._is_participant(uuid) from public, anon;
grant execute on function public._is_admin(), public._is_participant(uuid) to authenticated;

grant execute on function
  public.prepare_payment(uuid, uuid),
  public.record_payment_paid(text, text, int),
  public.expire_stale_requests(),
  public.auto_confirm_completions(),
  public.claim_due_transfers(int),
  public.complete_transfer(uuid, text),
  public.fail_transfer(uuid, text),
  public.sync_provider_kyc(uuid, text, text)
to service_role;

revoke execute on function
  public.upsert_provider_profile(text, text, text, int, double precision, double precision, int, text[]),
  public.set_provider_online(boolean),
  public.create_booking(uuid, text, text, text, double precision, double precision, timestamptz, text[]),
  public.accept_booking(uuid),
  public.decline_booking(uuid, text),
  public.start_trip(uuid),
  public.arrive(uuid, text),
  public.get_booking_otps(uuid),
  public.regenerate_otp(uuid, text),
  public.send_quote(uuid, jsonb, text),
  public.approve_quote(uuid, uuid),
  public.reject_quote(uuid, uuid),
  public.request_completion(uuid),
  public.complete_booking(uuid, text),
  public.confirm_completion(uuid),
  public.cancel_booking(uuid, text),
  public.dispute_booking(uuid, text),
  public.submit_review(uuid, int, int, int, int, int, text),
  public.get_provider_jobs(),
  public.get_booking_address(uuid),
  public.set_provider_suspended(uuid, boolean, text),
  public.resolve_dispute(uuid, public.dispute_outcome, int, text)
from public, anon;

grant execute on function
  public.upsert_provider_profile(text, text, text, int, double precision, double precision, int, text[]),
  public.set_provider_online(boolean),
  public.create_booking(uuid, text, text, text, double precision, double precision, timestamptz, text[]),
  public.accept_booking(uuid),
  public.decline_booking(uuid, text),
  public.start_trip(uuid),
  public.arrive(uuid, text),
  public.get_booking_otps(uuid),
  public.regenerate_otp(uuid, text),
  public.send_quote(uuid, jsonb, text),
  public.approve_quote(uuid, uuid),
  public.reject_quote(uuid, uuid),
  public.request_completion(uuid),
  public.complete_booking(uuid, text),
  public.confirm_completion(uuid),
  public.cancel_booking(uuid, text),
  public.dispute_booking(uuid, text),
  public.submit_review(uuid, int, int, int, int, int, text),
  public.get_provider_jobs(),
  public.get_booking_address(uuid),
  public.set_provider_suspended(uuid, boolean, text),
  public.resolve_dispute(uuid, public.dispute_outcome, int, text)
to authenticated;

grant execute on function
  public.search_providers(text, double precision, double precision, text, numeric, public.skill_level, int, boolean, int)
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.bookings;
  end if;
end;
$$;

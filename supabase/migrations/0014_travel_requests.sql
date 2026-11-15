-- Travel requests for providers serving customers beyond their normal radius (docs/09, M3).

alter table public.provider_services
  add column if not exists max_travel_km int,
  add column if not exists travel_fee_mode text not null default 'none',
  add column if not exists travel_fee_flat int not null default 0,
  add column if not exists travel_fee_per_km int not null default 0;

alter table public.provider_services
  drop constraint if exists provider_services_max_travel_km_check,
  drop constraint if exists provider_services_travel_fee_mode_check,
  drop constraint if exists provider_services_travel_fee_flat_check,
  drop constraint if exists provider_services_travel_fee_per_km_check,
  drop constraint if exists provider_services_travel_policy_check;
alter table public.provider_services
  add constraint provider_services_max_travel_km_check check (max_travel_km is null or max_travel_km between 1 and 100),
  add constraint provider_services_travel_fee_mode_check check (travel_fee_mode in ('none', 'flat', 'per_km')),
  add constraint provider_services_travel_fee_flat_check check (travel_fee_flat between 0 and 10000000),
  add constraint provider_services_travel_fee_per_km_check check (travel_fee_per_km between 0 and 1000000),
  add constraint provider_services_travel_policy_check
    check ((max_travel_km is null and travel_fee_mode = 'none') or max_travel_km is not null);

create or replace function public._validate_provider_service_travel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_radius int;
begin
  select service_radius_km into v_radius from public.providers where id = new.provider_id;
  perform public._assert(v_radius is not null, 'provider profile not found');
  perform public._assert(new.max_travel_km is null or new.max_travel_km >= v_radius,
                         'max travel distance must be at least the service radius');
  if new.max_travel_km is not null and new.travel_fee_mode = 'flat' then
    perform public._assert(new.travel_fee_flat >= 0, 'flat travel fee must be non-negative');
  elsif new.max_travel_km is not null and new.travel_fee_mode = 'per_km' then
    perform public._assert(new.travel_fee_per_km >= 0, 'per-km travel fee must be non-negative');
  end if;
  return new;
end;
$$;

drop trigger if exists provider_services_validate_travel on public.provider_services;
create trigger provider_services_validate_travel
  before insert or update of provider_id, max_travel_km, travel_fee_mode, travel_fee_flat, travel_fee_per_km
  on public.provider_services
  for each row execute function public._validate_provider_service_travel();

create or replace function public._validate_provider_travel_radius()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert(
    not exists (
      select 1 from public.provider_services ps
       where ps.provider_id = new.id
         and ps.max_travel_km is not null
         and ps.max_travel_km < new.service_radius_km
    ),
    'service radius cannot exceed a service max travel distance'
  );
  return new;
end;
$$;

drop trigger if exists providers_validate_travel_radius on public.providers;
create trigger providers_validate_travel_radius
  before update of service_radius_km on public.providers
  for each row execute function public._validate_provider_travel_radius();

create table public.travel_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id),
  provider_service_id uuid not null references public.provider_services (id),
  service_window tstzrange not null,
  distance_km numeric(5, 1) not null check (distance_km > 0),
  quoted_fee int not null check (quoted_fee >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'expired', 'used')),
  expires_at timestamptz not null,
  request_note text,
  response_reason text,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint travel_requests_window_check check (
    lower_inc(service_window) and not upper_inc(service_window)
    and upper(service_window) - lower(service_window) = interval '2 hours'
  ),
  constraint travel_requests_reason_check check (
    (request_note is null or char_length(request_note) <= 500)
    and (response_reason is null or char_length(response_reason) <= 500)
  )
);

create index travel_requests_provider_status_idx
  on public.travel_requests (provider_service_id, status, expires_at);
create index travel_requests_customer_idx
  on public.travel_requests (customer_id, created_at desc);
create unique index travel_requests_open_window_idx
  on public.travel_requests (customer_id, provider_service_id, lower(service_window))
  where status in ('pending', 'approved');

alter table public.bookings
  add column if not exists travel_request_id uuid references public.travel_requests (id),
  add column if not exists service_window tstzrange;
create unique index if not exists bookings_travel_request_idx
  on public.bookings (travel_request_id) where travel_request_id is not null;

alter table public.quotes
  add column if not exists subtotal_travel int not null default 0 check (subtotal_travel >= 0);
alter table public.quote_items
  add column if not exists travel_request_id uuid references public.travel_requests (id);
create unique index if not exists quote_items_travel_request_idx
  on public.quote_items (quote_id, travel_request_id) where travel_request_id is not null;

create or replace function public._travel_fee(p_provider_service_id uuid, p_distance_km numeric)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case ps.travel_fee_mode
           when 'flat' then ps.travel_fee_flat
           when 'per_km' then round(greatest(p_distance_km - pr.service_radius_km, 0) * ps.travel_fee_per_km)::int
           else 0
         end
    from public.provider_services ps
    join public.providers pr on pr.id = ps.provider_id
   where ps.id = p_provider_service_id;
$$;

create or replace function public.inspect_travel_request(
  p_provider_service_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_scheduled_at timestamptz default null
)
returns table (
  needs_approval boolean,
  allowed boolean,
  distance_km numeric,
  max_travel_km int,
  quoted_fee int,
  travel_request_id uuid,
  status text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_ps record;
  v_distance numeric;
  v_window tstzrange;
  v_request public.travel_requests;
begin
  select ps.id, ps.provider_id, pr.base_location, pr.service_radius_km, ps.max_travel_km
    into v_ps
    from public.provider_services ps
    join public.providers pr on pr.id = ps.provider_id
   where ps.id = p_provider_service_id and ps.active
     and public._provider_is_live(pr.id) and not pr.paused
     and public._category_docs_ok(pr.id, ps.category_id);
  perform public._assert(found, 'service not available');
  perform public._assert(p_lat is not null and p_lng is not null, 'location is required');

  if v_ps.base_location is null then
    return query select false, true, null::numeric, v_ps.max_travel_km, 0, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  v_distance := round((extensions.st_distance(
    v_ps.base_location,
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
  ) / 1000.0)::numeric, 1);
  v_window := case when p_scheduled_at is null then null
                   else tstzrange(p_scheduled_at, p_scheduled_at + interval '2 hours', '[)') end;
  if v_window is not null then
    select r.* into v_request
      from public.travel_requests r
     where r.customer_id = v_uid and r.provider_service_id = v_ps.id and r.service_window = v_window
     order by r.created_at desc limit 1;
  end if;

  return query
    select v_distance > v_ps.service_radius_km as needs_approval,
           v_distance <= v_ps.service_radius_km or (v_ps.max_travel_km is not null and v_distance <= v_ps.max_travel_km) as allowed,
           v_distance,
           v_ps.max_travel_km,
           case when v_distance > v_ps.service_radius_km
                then public._travel_fee(v_ps.id, v_distance) else 0 end,
           v_request.id,
           v_request.status,
           v_request.expires_at;
end;
$$;

create or replace function public.create_travel_request(
  p_provider_service_id uuid,
  p_scheduled_at timestamptz,
  p_lat double precision,
  p_lng double precision,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_ps record;
  v_distance numeric;
  v_window tstzrange;
  v_expires timestamptz;
  v_fee int;
  v_existing public.travel_requests;
  v_id uuid;
begin
  select ps.id, ps.provider_id, ps.max_travel_km, pr.base_location, pr.service_radius_km
    into v_ps
    from public.provider_services ps
    join public.providers pr on pr.id = ps.provider_id
   where ps.id = p_provider_service_id and ps.active
     and public._provider_is_live(pr.id) and not pr.paused
     and public._category_docs_ok(pr.id, ps.category_id);
  perform public._assert(found, 'service not available');
  perform public._assert(v_ps.provider_id <> v_uid, 'cannot request travel from yourself');
  perform public._assert(v_ps.base_location is not null, 'provider location is unavailable');
  perform public._assert(p_scheduled_at > now() + interval '30 minutes', 'travel request must start at least 30 minutes from now');
  perform public._assert(char_length(coalesce(p_note, '')) <= 500, 'request note is too long');
  perform pg_advisory_xact_lock(hashtext(v_uid::text || v_ps.id::text || p_scheduled_at::text));

  v_distance := round((extensions.st_distance(
    v_ps.base_location,
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
  ) / 1000.0)::numeric, 1);
  perform public._assert(v_distance > v_ps.service_radius_km, 'travel approval is only required beyond the service radius');
  perform public._assert(v_ps.max_travel_km is not null and v_distance <= v_ps.max_travel_km,
                         'provider does not travel this far');
  perform public._assert(public._provider_slot_problem(v_ps.provider_id, p_scheduled_at, false) is null,
                         'provider_unavailable: the requested window is not available');

  v_window := tstzrange(p_scheduled_at, p_scheduled_at + interval '2 hours', '[)');
  v_expires := least(now() + interval '2 hours', p_scheduled_at - interval '30 minutes');
  select r.* into v_existing
    from public.travel_requests r
   where r.customer_id = v_uid and r.provider_service_id = v_ps.id and r.service_window = v_window
     and r.status in ('pending', 'approved')
   for update;
  if found then
    if v_existing.expires_at <= now() then
      update public.travel_requests set status = 'expired' where id = v_existing.id;
    else
      return v_existing.id;
    end if;
  end if;

  v_fee := public._travel_fee(v_ps.id, v_distance);
  insert into public.travel_requests (
    customer_id, provider_service_id, service_window, distance_km, quoted_fee, expires_at, request_note
  ) values (
    v_uid, v_ps.id, v_window, v_distance, v_fee, v_expires, nullif(trim(p_note), '')
  ) returning id into v_id;

  begin
    perform public._queue_notification(
      v_ps.provider_id, 'travel_request_created', null,
      'Travel request',
      public._first_name(v_uid, 'A customer') || ' asked you to travel '
        || v_distance || ' km for ₹' || round(v_fee / 100.0, 2) || '.',
      jsonb_build_object('url', '/provider/dashboard', 'travel_request_id', v_id, 'provider_service_id', v_ps.id),
      'travel-request:' || v_id
    );
  exception when others then
    raise warning 'travel request notification skipped: %', sqlerrm;
  end;
  return v_id;
end;
$$;

create or replace function public.respond_travel_request(
  p_travel_request_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_request public.travel_requests;
  v_provider uuid;
begin
  select r.* into v_request from public.travel_requests r where r.id = p_travel_request_id for update;
  perform public._assert(found, 'travel request not found');
  select ps.provider_id into v_provider from public.provider_services ps where ps.id = v_request.provider_service_id;
  perform public._assert(v_provider = v_uid, 'only the assigned provider can respond');
  perform public._assert(v_request.status = 'pending', 'travel request is not pending');
  if v_request.expires_at <= now() then
    update public.travel_requests set status = 'expired', responded_at = now() where id = v_request.id;
    raise exception 'travel request expired';
  end if;
  perform public._assert(p_approve or coalesce(trim(p_reason), '') <> '', 'decline reason is required');
  perform public._assert(char_length(coalesce(p_reason, '')) <= 500, 'response reason is too long');

  update public.travel_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         response_reason = nullif(trim(p_reason), ''),
         responded_at = now()
   where id = v_request.id;

  begin
    perform public._queue_notification(
      v_request.customer_id,
      case when p_approve then 'travel_request_approved' else 'travel_request_declined' end,
      null,
      case when p_approve then 'Travel request approved' else 'Travel request declined' end,
      case when p_approve
           then 'The provider approved your travel request. Continue to book before it expires.'
           else 'The provider could not travel for this slot. ' || coalesce(nullif(trim(p_reason), ''), 'Choose another time or provider.')
      end,
      jsonb_build_object(
        'url', '/book/' || v_request.provider_service_id,
        'travel_request_id', v_request.id,
        'provider_service_id', v_request.provider_service_id
      ),
      'travel-response:' || v_request.id
    );
  exception when others then
    raise warning 'travel response notification skipped: %', sqlerrm;
  end;
end;
$$;

create or replace function public.list_my_travel_requests(p_status text default null)
returns table (
  id uuid,
  customer_id uuid,
  provider_id uuid,
  provider_service_id uuid,
  customer_name text,
  provider_name text,
  category_name text,
  service_window tstzrange,
  window_start timestamptz,
  window_end timestamptz,
  distance_km numeric,
  quoted_fee int,
  status text,
  expires_at timestamptz,
  request_note text,
  response_reason text,
  created_at timestamptz,
  role text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.customer_id, ps.provider_id, r.provider_service_id,
         cp.full_name as customer_name, pp.full_name as provider_name, c.name as category_name,
         r.service_window, lower(r.service_window), upper(r.service_window),
         r.distance_km, r.quoted_fee, r.status, r.expires_at, r.request_note,
         r.response_reason, r.created_at,
         case when r.customer_id = auth.uid() then 'customer' else 'provider' end
    from public.travel_requests r
    join public.provider_services ps on ps.id = r.provider_service_id
    join public.profiles cp on cp.id = r.customer_id
    join public.profiles pp on pp.id = ps.provider_id
    join public.categories c on c.id = ps.category_id
   where (r.customer_id = auth.uid() or ps.provider_id = auth.uid())
     and (p_status is null or r.status = p_status)
     and r.created_at >= now() - interval '14 days'
   order by r.created_at desc;
$$;

create or replace function public.expire_travel_requests()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.travel_requests;
  v_count int := 0;
begin
  for v_request in
    select r.* from public.travel_requests r
     where r.status in ('pending', 'approved') and r.expires_at <= now()
     for update skip locked
  loop
    update public.travel_requests set status = 'expired' where id = v_request.id;
    begin
      perform public._queue_notification(
        v_request.customer_id, 'travel_request_expired', null,
        'Travel request expired',
        'The provider travel approval expired. Choose a slot again to send a new request.',
        jsonb_build_object(
          'url', '/book/' || v_request.provider_service_id,
          'travel_request_id', v_request.id,
          'provider_service_id', v_request.provider_service_id
        ),
        'travel-expired:' || v_request.id
      );
    exception when others then
      raise warning 'travel expiry notification skipped: %', sqlerrm;
    end;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public._enforce_booking_travel_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ps record;
  v_request public.travel_requests;
  v_address public.addresses;
  v_distance numeric;
  v_window tstzrange;
begin
  select ps.id, pr.base_location, pr.service_radius_km
    into v_ps
    from public.provider_services ps
    join public.providers pr on pr.id = ps.provider_id
   where ps.id = new.provider_service_id;
  if v_ps.base_location is null then
    perform public._assert(new.travel_request_id is null, 'travel request is not valid for this booking');
    return new;
  end if;

  select a.* into v_address from public.addresses a where a.id = new.address_id;
  v_distance := round((extensions.st_distance(
    v_ps.base_location,
    extensions.st_setsrid(extensions.st_makepoint(v_address.lng, v_address.lat), 4326)::extensions.geography
  ) / 1000.0)::numeric, 1);
  v_window := case when new.scheduled_at is null then null
                   else tstzrange(new.scheduled_at, new.scheduled_at + interval '2 hours', '[)') end;
  if v_distance <= v_ps.service_radius_km then
    perform public._assert(new.travel_request_id is null, 'travel request is not required for this booking');
    new.service_window := v_window;
    return new;
  end if;

  perform public._assert(new.travel_request_id is not null, 'travel approval required before booking');
  perform public._assert(v_window is not null, 'scheduled time is required for travel');
  select r.* into v_request from public.travel_requests r where r.id = new.travel_request_id for update;
  perform public._assert(found, 'travel request not found');
  perform public._assert(v_request.customer_id = new.customer_id, 'travel request belongs to another customer');
  perform public._assert(v_request.provider_service_id = new.provider_service_id, 'travel request is for another service');
  perform public._assert(v_request.service_window = v_window, 'travel request is for another window');
  perform public._assert(v_request.status = 'approved', 'travel request is not approved');
  perform public._assert(v_request.expires_at > now(), 'travel request expired');
  perform public._assert(v_request.distance_km = v_distance, 'travel request location does not match the booking');

  update public.travel_requests set status = 'used' where id = v_request.id;
  new.service_window := v_window;
  return new;
end;
$$;

drop trigger if exists bookings_enforce_travel_request on public.bookings;
create trigger bookings_enforce_travel_request
  before insert on public.bookings
  for each row execute function public._enforce_booking_travel_request();

drop function if exists public.create_booking(
  uuid, text, text, text, double precision, double precision, timestamptz, text[]
);
create or replace function public.create_booking(
  p_provider_service_id uuid,
  p_description text,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision,
  p_scheduled_at timestamptz default null,
  p_photos text[] default '{}',
  p_travel_request_id uuid default null
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
  v_problem text;
  c_platform_fee constant int := 2900;
begin
  select ps.id, ps.provider_id, ps.category_id, ps.visit_fee
    into v_ps
    from public.provider_services ps
    join public.providers pr on pr.id = ps.provider_id
   where ps.id = p_provider_service_id and ps.active
     and public._provider_is_live(pr.id) and not pr.paused and public._category_docs_ok(pr.id, ps.category_id);
  perform public._assert(found, 'service not available');
  perform public._assert(v_ps.provider_id <> v_uid, 'cannot book yourself');
  perform public._assert(coalesce(trim(p_address_line), '') <> '' and coalesce(trim(p_city), '') <> '', 'address is required');
  perform public._assert(p_lat is not null and p_lng is not null, 'location is required');
  perform public._assert(p_scheduled_at is null or p_scheduled_at > now() - interval '5 minutes', 'scheduled time is in the past');
  perform public._assert(coalesce(array_length(p_photos, 1), 0) <= 4, 'at most 4 photos');
  perform public._assert(not exists (select 1 from unnest(coalesce(p_photos, '{}')) ph
                                      where ph not like v_uid::text || '/%'), 'invalid photo path');

  perform pg_advisory_xact_lock(hashtext(v_ps.provider_id::text));
  v_problem := public._provider_slot_problem(v_ps.provider_id, coalesce(p_scheduled_at, now()), p_scheduled_at is null);
  perform public._assert(v_problem is null,
    case v_problem
      when 'provider_on_leave' then 'provider_unavailable: the provider is on leave at that time'
      when 'outside_working_hours' then 'provider_unavailable: that time is outside the provider''s working hours'
      when 'fully_booked' then 'provider_unavailable: the provider is fully booked that day'
      else 'provider_unavailable' end);

  insert into public.addresses (user_id, label, line1, city, lat, lng)
  values (v_uid, 'Booking', trim(p_address_line), trim(p_city), p_lat, p_lng)
  returning id into v_address;

  insert into public.bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id,
    description, photos, scheduled_at, visit_fee, platform_fee, travel_request_id, service_window
  ) values (
    v_uid, v_ps.provider_id, v_ps.category_id, v_ps.id, v_address,
    coalesce(p_description, ''), coalesce(p_photos, '{}'), p_scheduled_at,
    v_ps.visit_fee, c_platform_fee, p_travel_request_id,
    case when p_scheduled_at is null then null
         else tstzrange(p_scheduled_at, p_scheduled_at + interval '2 hours', '[)') end
  ) returning id into v_booking;

  insert into public.booking_secrets (booking_id, start_otp) values (v_booking, public._gen_otp());
  insert into public.booking_events (booking_id, actor_id, from_status, to_status)
  values (v_booking, v_uid, null, 'pending_payment');
  return v_booking;
end;
$$;

create or replace function public.send_quote(p_booking_id uuid, p_items jsonb, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_request public.travel_requests;
  v_item jsonb;
  v_kind public.quote_item_kind;
  v_qty numeric;
  v_price int;
  v_line int;
  v_labour int := 0;
  v_parts int := 0;
  v_other int := 0;
  v_travel int := 0;
  v_version int;
  v_quote uuid;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can send a quote');
  perform public._assert(b.status in ('inspecting', 'quote_sent', 'in_progress'), 'quote not allowed in this state');
  perform public._assert(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 30,
                         'quote needs 1 to 30 items');
  perform public._assert(not exists (
    select 1 from jsonb_array_elements(p_items) item
    where coalesce(item ->> 'travel_request_id', '') <> ''
  ), 'travel fee lines are managed automatically');

  if b.travel_request_id is not null then
    select r.* into v_request from public.travel_requests r where r.id = b.travel_request_id;
    perform public._assert(found and v_request.status = 'used', 'travel request is not attached to this booking');
    v_travel := v_request.quoted_fee;
    v_other := v_travel;
  end if;

  perform public._close_open_quotes(b.id);
  select coalesce(max(version), 0) + 1 into v_version from public.quotes where booking_id = b.id;
  insert into public.quotes (booking_id, version, total, note, is_change_order)
  values (b.id, v_version, 0, p_note, b.status = 'in_progress')
  returning id into v_quote;

  if b.travel_request_id is not null then
    insert into public.quote_items (
      quote_id, kind, title, qty, unit_price, travel_request_id
    ) values (
      v_quote, 'other', 'Travel fee (' || v_request.distance_km || ' km)', 1, v_travel, v_request.id
    );
  end if;

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
         subtotal_travel = v_travel, total = v_labour + v_parts + v_other
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
  perform public._create_payout(
    b.id, greatest(q.total, b.visit_fee), q.subtotal_labour + q.subtotal_travel, v_completed + interval '24 hours'
  );
  update public.providers set jobs_completed = jobs_completed + 1 where id = b.provider_id;
  update public.providers set commission_tier = public._commission_bp(id, now()) / 100 where id = b.provider_id;
  perform public._set_status(b.id, 'completed', p_actor, p_note);
end;
$$;

alter table public.travel_requests enable row level security;
revoke all on public.travel_requests from anon, authenticated;
grant select on public.travel_requests to authenticated;
drop policy if exists travel_requests_participants on public.travel_requests;
create policy travel_requests_participants on public.travel_requests
  for select to authenticated
  using (
    customer_id = auth.uid()
    or exists (
      select 1 from public.provider_services ps
       where ps.id = provider_service_id and ps.provider_id = auth.uid()
    )
  );

-- Expand the notification outbox vocabulary for travel lifecycle events.
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'chat_message', 'booking_requested', 'booking_accepted', 'booking_declined', 'booking_expired',
    'booking_cancelled', 'provider_en_route', 'quote_sent', 'change_order_sent', 'completion_requested',
    'travel_request_created', 'travel_request_approved', 'travel_request_declined', 'travel_request_expired'
  ));

revoke execute on function
  public._validate_provider_service_travel(),
  public._validate_provider_travel_radius(),
  public._travel_fee(uuid, numeric),
  public._enforce_booking_travel_request()
from public, anon, authenticated;

revoke execute on function
  public.inspect_travel_request(uuid, double precision, double precision, timestamptz),
  public.create_travel_request(uuid, timestamptz, double precision, double precision, text),
  public.respond_travel_request(uuid, boolean, text),
  public.list_my_travel_requests(text),
  public.expire_travel_requests()
from public, anon, authenticated;

grant execute on function
  public.inspect_travel_request(uuid, double precision, double precision, timestamptz),
  public.create_travel_request(uuid, timestamptz, double precision, double precision, text),
  public.respond_travel_request(uuid, boolean, text),
  public.list_my_travel_requests(text)
to authenticated;

grant execute on function public.expire_travel_requests() to service_role;

revoke execute on function
  public.create_booking(uuid, text, text, text, double precision, double precision, timestamptz, text[], uuid),
  public.send_quote(uuid, jsonb, text)
from public, anon;
grant execute on function
  public.create_booking(uuid, text, text, text, double precision, double precision, timestamptz, text[], uuid),
  public.send_quote(uuid, jsonb, text)
to authenticated;

-- pg_cron is installed/configured outside migrations in Supabase; schedule only when the schema is present.
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule(
      'expire-travel-requests',
      '* * * * *',
      'select public.expire_travel_requests()'
    );
  end if;
end;
$$;

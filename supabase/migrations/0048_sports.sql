-- Sports phase 1: verified venue discovery and pay-at-venue booking requests.

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values ('sports', false, 'Sports & venues', 'Venue discovery and booking requests.', 'Marketplace', 30)
on conflict (key) do nothing;

create table public.sports_activities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  icon text not null default 'football-outline',
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create table public.sports_venues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  address_line text not null check (char_length(btrim(address_line)) between 3 and 300),
  city text not null check (char_length(btrim(city)) between 2 and 80),
  area text not null check (char_length(btrim(area)) between 2 and 80),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  amenities text[] not null default '{}',
  photos text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'verified', 'rejected', 'suspended')),
  status_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sports_venues_owner_idx on public.sports_venues (owner_id, created_at desc);
create index sports_venues_search_idx on public.sports_venues (status, city, area);

create table public.sports_resources (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.sports_venues (id) on delete cascade,
  activity_id uuid not null references public.sports_activities (id),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  slot_minutes int not null default 60 check (slot_minutes in (30, 60, 90, 120)),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index sports_resources_venue_idx on public.sports_resources (venue_id, active);
create index sports_resources_activity_idx on public.sports_resources (activity_id, active);

create table public.sports_hours (
  venue_id uuid not null references public.sports_venues (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens time not null,
  closes time not null,
  created_at timestamptz not null default now(),
  primary key (venue_id, weekday),
  check (opens < closes)
);

create table public.sports_price_rules (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.sports_resources (id) on delete cascade,
  weekday smallint check (weekday between 0 and 6),
  starts time not null,
  ends time not null,
  price_paise int not null check (price_paise > 0),
  label text not null default 'Standard' check (char_length(btrim(label)) between 1 and 50),
  created_at timestamptz not null default now(),
  check (starts < ends)
);
create index sports_price_rules_resource_idx on public.sports_price_rules (resource_id, weekday, starts, ends);

create table public.sports_blocks (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.sports_resources (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);
create index sports_blocks_resource_time_idx on public.sports_blocks (resource_id, starts_at, ends_at);

create table public.sports_bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  venue_id uuid not null references public.sports_venues (id) on delete cascade,
  resource_id uuid not null references public.sports_resources (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'requested'
    check (status in ('requested', 'accepted', 'declined', 'cancelled', 'completed', 'expired')),
  price_paise int not null check (price_paise > 0),
  note text not null default '' check (char_length(note) <= 500),
  decision_reason text not null default '' check (char_length(decision_reason) <= 500),
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);
create index sports_bookings_resource_start_idx on public.sports_bookings (resource_id, starts_at);
create index sports_bookings_customer_idx on public.sports_bookings (customer_id, created_at desc);
create index sports_bookings_venue_status_idx on public.sports_bookings (venue_id, status, starts_at);

alter table public.sports_activities enable row level security;
alter table public.sports_venues enable row level security;
alter table public.sports_resources enable row level security;
alter table public.sports_hours enable row level security;
alter table public.sports_price_rules enable row level security;
alter table public.sports_blocks enable row level security;
alter table public.sports_bookings enable row level security;

revoke all on public.sports_activities, public.sports_venues, public.sports_resources,
  public.sports_hours, public.sports_price_rules, public.sports_blocks, public.sports_bookings
  from public, anon, authenticated;
grant select on public.sports_activities, public.sports_venues, public.sports_resources,
  public.sports_hours, public.sports_price_rules to anon, authenticated;
grant select on public.sports_bookings to authenticated;

create policy sports_activities_read on public.sports_activities for select to anon, authenticated
  using (active and coalesce((public.get_app_features() ->> 'sports')::boolean, false));
create policy sports_venues_read on public.sports_venues for select to anon, authenticated
  using (
    coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and (status = 'verified' or owner_id = auth.uid())
  );
create policy sports_resources_read on public.sports_resources for select to anon, authenticated
  using (
    coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and (active and exists (
      select 1 from public.sports_venues v where v.id = venue_id and v.status = 'verified'
    ) or exists (
      select 1 from public.sports_venues v where v.id = venue_id and v.owner_id = auth.uid()
    ))
  );
create policy sports_hours_read on public.sports_hours for select to anon, authenticated
  using (
    coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and exists (
      select 1 from public.sports_venues v
       where v.id = venue_id and (v.status = 'verified' or v.owner_id = auth.uid())
    )
  );
create policy sports_price_rules_read on public.sports_price_rules for select to anon, authenticated
  using (
    coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and exists (
      select 1 from public.sports_resources r
      join public.sports_venues v on v.id = r.venue_id
       where r.id = resource_id and ((r.active and v.status = 'verified') or v.owner_id = auth.uid())
    )
  );
create policy sports_bookings_participant_read on public.sports_bookings for select to authenticated
  using (
    coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and (
      customer_id = auth.uid()
      or exists (select 1 from public.sports_venues v where v.id = venue_id and v.owner_id = auth.uid())
    )
  );

insert into public.sports_activities (slug, name, icon, sort_order) values
  ('badminton', 'Badminton', 'tennisball-outline', 10),
  ('cricket-turf', 'Cricket turf', 'baseball-outline', 20),
  ('football-turf', 'Football turf', 'football-outline', 30),
  ('swimming', 'Swimming', 'water-outline', 40),
  ('tennis', 'Tennis', 'tennisball-outline', 50),
  ('table-tennis', 'Table tennis', 'tennisball-outline', 60),
  ('coaching', 'Coaching', 'school-outline', 70),
  ('fitness', 'Fitness', 'fitness-outline', 80)
on conflict (slug) do nothing;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'chat_message', 'booking_requested', 'booking_accepted', 'booking_declined', 'booking_expired',
  'booking_cancelled', 'provider_en_route', 'quote_sent', 'change_order_sent', 'completion_requested',
  'travel_request_created', 'travel_request_approved', 'travel_request_declined', 'travel_request_expired',
  'proposal_request_received', 'proposal_received', 'proposal_booked', 'proposal_hold_expired',
  'request_message', 'milestone_due', 'delivery_submitted', 'support_message', 'support_reply',
  'revision_requested',
  'sports_booking_requested', 'sports_booking_accepted', 'sports_booking_declined'
));

create or replace function public.list_sports_activities()
returns table (id uuid, slug text, name text, icon text, sort_order int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  return query
    select a.id, a.slug, a.name, a.icon, a.sort_order
      from public.sports_activities a
     where a.active
     order by a.sort_order, a.name;
end;
$$;

create or replace function public.save_sports_venue(
  p_id uuid,
  p_name text,
  p_description text,
  p_address_line text,
  p_city text,
  p_area text,
  p_lat double precision,
  p_lng double precision,
  p_amenities text[] default '{}',
  p_photos text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_id uuid;
  v_amenities text[] := array(select btrim(x) from unnest(coalesce(p_amenities, '{}')) x where btrim(x) <> '');
  v_photos text[] := array(select btrim(x) from unnest(coalesce(p_photos, '{}')) x where btrim(x) <> '');
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(char_length(btrim(coalesce(p_name, ''))) between 2 and 120, 'venue name must be 2 to 120 characters');
  perform public._assert(char_length(btrim(coalesce(p_address_line, ''))) between 3 and 300, 'address is required');
  perform public._assert(char_length(btrim(coalesce(p_city, ''))) between 2 and 80, 'city is required');
  perform public._assert(char_length(btrim(coalesce(p_area, ''))) between 2 and 80, 'area is required');
  perform public._assert(p_lat between -90 and 90 and p_lng between -180 and 180, 'valid venue coordinates are required');
  perform public._assert(char_length(coalesce(p_description, '')) <= 2000, 'description is too long');
  perform public._assert(cardinality(v_amenities) <= 20, 'up to 20 amenities are allowed');
  perform public._assert(cardinality(v_photos) <= 12, 'up to 12 photo URLs are allowed');
  perform public._assert(not exists (select 1 from unnest(v_photos) x where x !~* '^https://'), 'photo URLs must use https');

  if p_id is null then
    insert into public.sports_venues
      (owner_id, name, description, address_line, city, area, lat, lng, amenities, photos)
    values
      (v_uid, btrim(p_name), coalesce(p_description, ''), btrim(p_address_line), btrim(p_city),
       btrim(p_area), p_lat, p_lng, v_amenities, v_photos)
    returning id into v_id;
  else
    update public.sports_venues
       set name = btrim(p_name), description = coalesce(p_description, ''), address_line = btrim(p_address_line),
           city = btrim(p_city), area = btrim(p_area), lat = p_lat, lng = p_lng,
           amenities = v_amenities, photos = v_photos, status = 'draft', status_reason = '', updated_at = now()
     where id = p_id and owner_id = v_uid and status <> 'suspended';
    perform public._assert(found, 'venue not found, suspended, or not owned by you');
    v_id := p_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.save_sports_resource(
  p_venue_id uuid,
  p_id uuid,
  p_activity_id uuid,
  p_name text,
  p_slot_minutes int default 60,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_id uuid;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(exists (
    select 1 from public.sports_venues v where v.id = p_venue_id and v.owner_id = v_uid
  ), 'venue not found or not owned by you');
  perform public._assert(exists (
    select 1 from public.sports_activities a where a.id = p_activity_id and a.active
  ), 'activity is unavailable');
  perform public._assert(char_length(btrim(coalesce(p_name, ''))) between 2 and 80, 'resource name must be 2 to 80 characters');
  perform public._assert(p_slot_minutes in (30, 60, 90, 120), 'slot length must be 30, 60, 90 or 120 minutes');
  perform public._assert(p_active is not null, 'active is required');
  if p_id is null then
    insert into public.sports_resources (venue_id, activity_id, name, slot_minutes, active)
    values (p_venue_id, p_activity_id, btrim(p_name), p_slot_minutes, p_active)
    returning id into v_id;
  else
    update public.sports_resources
       set activity_id = p_activity_id, name = btrim(p_name), slot_minutes = p_slot_minutes, active = p_active
     where id = p_id and venue_id = p_venue_id;
    perform public._assert(found, 'resource not found for this venue');
    v_id := p_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.set_sports_hours(
  p_venue_id uuid,
  p_weekday smallint,
  p_opens time,
  p_closes time
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(exists (
    select 1 from public.sports_venues v where v.id = p_venue_id and v.owner_id = v_uid
  ), 'venue not found or not owned by you');
  perform public._assert(p_weekday between 0 and 6, 'weekday must be between 0 and 6');
  perform public._assert((p_opens is null and p_closes is null) or (p_opens is not null and p_closes is not null and p_opens < p_closes),
                         'opening time must be earlier than closing time');
  if p_opens is null then
    delete from public.sports_hours where venue_id = p_venue_id and weekday = p_weekday;
  else
    insert into public.sports_hours (venue_id, weekday, opens, closes)
    values (p_venue_id, p_weekday, p_opens, p_closes)
    on conflict (venue_id, weekday) do update set opens = excluded.opens, closes = excluded.closes;
  end if;
end;
$$;

create or replace function public.save_sports_price_rule(
  p_resource_id uuid,
  p_id uuid,
  p_weekday smallint,
  p_starts time,
  p_ends time,
  p_price_paise int,
  p_label text default 'Standard'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_id uuid;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(exists (
    select 1 from public.sports_resources r join public.sports_venues v on v.id = r.venue_id
     where r.id = p_resource_id and v.owner_id = v_uid
  ), 'resource not found or not owned by you');
  perform public._assert(p_weekday is null or p_weekday between 0 and 6, 'weekday must be between 0 and 6');
  perform public._assert(p_starts is not null and p_ends is not null and p_starts < p_ends, 'price rule start must be earlier than end');
  perform public._assert(p_price_paise > 0, 'price must be greater than zero');
  perform public._assert(char_length(btrim(coalesce(p_label, ''))) between 1 and 50, 'price label must be 1 to 50 characters');
  perform pg_advisory_xact_lock(hashtext(p_resource_id::text || ':sports-price-rules'));
  perform public._assert(not exists (
    select 1 from public.sports_price_rules r
     where r.resource_id = p_resource_id
       and coalesce(r.weekday, -1) = coalesce(p_weekday, -1)
       and (p_id is null or r.id <> p_id)
       and r.starts < p_ends and r.ends > p_starts
  ), 'price rules cannot overlap for the same day');
  if p_id is null then
    insert into public.sports_price_rules (resource_id, weekday, starts, ends, price_paise, label)
    values (p_resource_id, p_weekday, p_starts, p_ends, p_price_paise, btrim(p_label))
    returning id into v_id;
  else
    update public.sports_price_rules
       set weekday = p_weekday, starts = p_starts, ends = p_ends, price_paise = p_price_paise, label = btrim(p_label)
     where id = p_id and resource_id = p_resource_id;
    perform public._assert(found, 'price rule not found for this resource');
    v_id := p_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.add_sports_block(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_id uuid;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(exists (
    select 1 from public.sports_resources r join public.sports_venues v on v.id = r.venue_id
     where r.id = p_resource_id and v.owner_id = v_uid
  ), 'resource not found or not owned by you');
  perform public._assert(p_starts_at is not null and p_ends_at > p_starts_at, 'block end must be after its start');
  perform public._assert(char_length(coalesce(p_reason, '')) <= 200, 'block reason is too long');
  perform pg_advisory_xact_lock(hashtext(p_resource_id::text));
  perform public._assert(not exists (
    select 1 from public.sports_bookings b
     where b.resource_id = p_resource_id and b.starts_at < p_ends_at and b.ends_at > p_starts_at
       and (b.status = 'accepted' or (b.status = 'requested' and b.expires_at > now()))
  ), 'cannot block a time with an active booking');
  insert into public.sports_blocks (resource_id, starts_at, ends_at, reason)
  values (p_resource_id, p_starts_at, p_ends_at, coalesce(p_reason, ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.remove_sports_block(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  delete from public.sports_blocks b using public.sports_resources r, public.sports_venues v
   where b.id = p_id and r.id = b.resource_id and v.id = r.venue_id and v.owner_id = v_uid;
  perform public._assert(found, 'block not found or not owned by you');
end;
$$;

create or replace function public.submit_sports_venue(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(exists (
    select 1 from public.sports_venues v where v.id = p_id and v.owner_id = v_uid and v.status <> 'suspended'
  ), 'venue not found, suspended, or not owned by you');
  perform public._assert(exists (
    select 1 from public.sports_resources r join public.sports_activities a on a.id = r.activity_id
     where r.venue_id = p_id and r.active and a.active
  ), 'add an active court or resource before submitting');
  perform public._assert(exists (select 1 from public.sports_hours h where h.venue_id = p_id),
                         'add opening hours before submitting');
  perform public._assert(exists (
    select 1 from public.sports_price_rules r join public.sports_resources s on s.id = r.resource_id
     where s.venue_id = p_id and s.active
  ), 'add a price rule before submitting');
  update public.sports_venues
     set status = 'submitted', status_reason = '', updated_at = now()
   where id = p_id and owner_id = v_uid;
end;
$$;

create or replace function public.admin_set_venue_status(p_id uuid, p_status text, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(p_status in ('verified', 'rejected', 'suspended'), 'invalid venue status');
  perform public._assert(p_status = 'verified' or char_length(btrim(coalesce(p_reason, ''))) between 3 and 500,
                         'a reason is required unless the venue is verified');
  update public.sports_venues
     set status = p_status, status_reason = coalesce(btrim(p_reason), ''), updated_at = now()
   where id = p_id and status in ('submitted', 'verified', 'rejected', 'suspended');
  perform public._assert(found, 'venue not found');
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_sports_venue_status', p_id, jsonb_build_object('status', p_status, 'reason', coalesce(p_reason, '')));
end;
$$;

create or replace function public.admin_list_sports_venues()
returns table (id uuid, name text, city text, area text, owner_id uuid, owner_name text, status text, status_reason text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(public._is_admin(), 'admin only');
  return query
    select v.id, v.name, v.city, v.area, v.owner_id, p.full_name, v.status, v.status_reason, v.created_at
      from public.sports_venues v join public.profiles p on p.id = v.owner_id
     order by (v.status = 'submitted') desc, v.created_at desc;
end;
$$;

create or replace function public.admin_list_sports_activities()
returns table (id uuid, slug text, name text, icon text, active boolean, sort_order int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(public._is_admin(), 'admin only');
  return query select a.id, a.slug, a.name, a.icon, a.active, a.sort_order
    from public.sports_activities a order by a.sort_order, a.name;
end;
$$;

create or replace function public.admin_set_sports_activity(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(p_active is not null, 'active is required');
  update public.sports_activities set active = p_active where id = p_id;
  perform public._assert(found, 'activity not found');
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_sports_activity', p_id, jsonb_build_object('active', p_active));
end;
$$;

create or replace function public.search_sports_venues(
  p_activity_slug text,
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 15
)
returns table (
  id uuid, name text, description text, address_line text, city text, area text,
  lat double precision, lng double precision, amenities text[], photos text[],
  distance_km double precision, min_price_paise int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(p_lat between -90 and 90 and p_lng between -180 and 180, 'valid search coordinates are required');
  perform public._assert(p_radius_km between 1 and 100, 'search radius must be between 1 and 100 km');
  perform public._assert(exists (
    select 1 from public.sports_activities a where a.slug = p_activity_slug and a.active
  ), 'activity is unavailable');
  return query
    select v.id, v.name, v.description, v.address_line, v.city, v.area, v.lat, v.lng, v.amenities, v.photos,
           (extensions.st_distance(
             extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography,
             extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
           ) / 1000.0)::double precision,
           (select min(pr.price_paise)::int
              from public.sports_resources r
              join public.sports_activities a on a.id = r.activity_id
              join public.sports_price_rules pr on pr.resource_id = r.id
             where r.venue_id = v.id and r.active and a.active and a.slug = p_activity_slug)
      from public.sports_venues v
     where v.status = 'verified'
       and exists (
         select 1 from public.sports_resources r
         join public.sports_activities a on a.id = r.activity_id
          where r.venue_id = v.id and r.active and a.active and a.slug = p_activity_slug
       )
       and extensions.st_dwithin(
         extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography,
         extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
         p_radius_km * 1000.0
       )
     order by extensions.st_distance(
       extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography,
       extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
     ), v.name;
end;
$$;

create or replace function public.get_sports_venue(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  select jsonb_build_object(
    'id', v.id, 'name', v.name, 'description', v.description, 'address_line', v.address_line,
    'city', v.city, 'area', v.area, 'lat', v.lat, 'lng', v.lng, 'amenities', v.amenities, 'photos', v.photos,
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'activity_id', a.id, 'activity_slug', a.slug, 'activity_name', a.name,
        'slot_minutes', r.slot_minutes
      ) order by r.created_at)
        from public.sports_resources r join public.sports_activities a on a.id = r.activity_id
       where r.venue_id = v.id and r.active and a.active
    ), '[]'::jsonb)
  ) into v_result
    from public.sports_venues v
   where v.id = p_id and v.status = 'verified';
  return v_result;
end;
$$;

create or replace function public.get_my_sports_venues()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_result jsonb;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  select coalesce(jsonb_agg(jsonb_build_object(
    'venue', to_jsonb(v),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'venue_id', r.venue_id, 'activity_id', a.id, 'activity_slug', a.slug,
        'activity_name', a.name, 'name', r.name, 'slot_minutes', r.slot_minutes, 'active', r.active
      ) order by r.created_at)
        from public.sports_resources r join public.sports_activities a on a.id = r.activity_id
       where r.venue_id = v.id
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.weekday) from public.sports_hours h where h.venue_id = v.id
    ), '[]'::jsonb),
    'price_rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id, 'resource_id', pr.resource_id, 'weekday', pr.weekday, 'starts', pr.starts,
        'ends', pr.ends, 'price_paise', pr.price_paise, 'label', pr.label
      ) order by pr.weekday nulls first, pr.starts)
        from public.sports_price_rules pr join public.sports_resources r on r.id = pr.resource_id
       where r.venue_id = v.id
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'resource_id', b.resource_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'reason', b.reason
      ) order by b.starts_at)
        from public.sports_blocks b join public.sports_resources r on r.id = b.resource_id
       where r.venue_id = v.id
    ), '[]'::jsonb)
  ) order by v.created_at desc), '[]'::jsonb)
    into v_result
    from public.sports_venues v
   where v.owner_id = v_uid;
  return v_result;
end;
$$;

create or replace function public.get_sports_slots(p_resource_id uuid, p_date date)
returns table (starts_at timestamptz, ends_at timestamptz, state text, price_paise int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(p_date is not null and p_date between (now() at time zone 'Asia/Kolkata')::date
                         and (now() at time zone 'Asia/Kolkata')::date + 30, 'date must be within the next 30 days');
  return query
    with scope as (
      select r.id resource_id, r.slot_minutes, h.opens, h.closes,
             extract(dow from p_date)::smallint weekday
        from public.sports_resources r
        join public.sports_venues v on v.id = r.venue_id
        join public.sports_activities a on a.id = r.activity_id
        join public.sports_hours h on h.venue_id = v.id and h.weekday = extract(dow from p_date)::smallint
       where r.id = p_resource_id and r.active and a.active and v.status = 'verified'
    ), slots as (
      select s.resource_id, s.slot_minutes, s.weekday, gs as slot_start,
             gs + make_interval(mins => s.slot_minutes) as slot_end,
             (gs at time zone 'Asia/Kolkata')::time as local_start,
             ((gs + make_interval(mins => s.slot_minutes)) at time zone 'Asia/Kolkata')::time as local_end
        from scope s
        cross join lateral generate_series(
          (p_date + s.opens) at time zone 'Asia/Kolkata',
          (p_date + s.closes) at time zone 'Asia/Kolkata' - make_interval(mins => s.slot_minutes),
          make_interval(mins => s.slot_minutes)
        ) gs
    )
    select s.slot_start, s.slot_end,
           case
             when s.slot_start <= now() then 'past'
             when exists (
               select 1 from public.sports_blocks b
                where b.resource_id = s.resource_id and b.starts_at < s.slot_end and b.ends_at > s.slot_start
             ) then 'blocked'
             when exists (
               select 1 from public.sports_bookings b
                where b.resource_id = s.resource_id
                  and b.starts_at < s.slot_end and b.ends_at > s.slot_start
                  and (b.status = 'accepted' or (b.status = 'requested' and b.expires_at > now()))
             ) then 'taken'
             when (select pr.price_paise from public.sports_price_rules pr
                    where pr.resource_id = s.resource_id and (pr.weekday = s.weekday or pr.weekday is null)
                      and pr.starts <= s.local_start and pr.ends >= s.local_end
                    order by (pr.weekday is null), pr.starts limit 1) is null then 'blocked'
             else 'free'
           end,
           (select pr.price_paise from public.sports_price_rules pr
             where pr.resource_id = s.resource_id and (pr.weekday = s.weekday or pr.weekday is null)
               and pr.starts <= s.local_start and pr.ends >= s.local_end
             order by (pr.weekday is null), pr.starts limit 1)::int
      from slots s
     order by s.slot_start;
end;
$$;

create or replace function public.request_sports_slot(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_slots int default 1,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_resource record;
  v_start_local timestamp;
  v_end_local timestamp;
  v_day smallint;
  v_hours public.sports_hours;
  v_end_at timestamptz;
  v_expires_at timestamptz;
  v_price int;
  v_total bigint := 0;
  v_slot_start timestamptz;
  v_slot_local time;
  v_slot_end_local time;
  v_booking_id uuid;
  i int;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  select r.id, r.venue_id, r.slot_minutes, v.owner_id, v.name venue_name, v.status, a.active
    into v_resource
    from public.sports_resources r
    join public.sports_venues v on v.id = r.venue_id
    join public.sports_activities a on a.id = r.activity_id
   where r.id = p_resource_id and r.active;
  perform public._assert(found and v_resource.status = 'verified' and v_resource.active, 'resource is unavailable');
  perform public._assert(v_resource.owner_id <> v_uid, 'venue owners cannot book their own venue');
  perform public._assert(p_starts_at > now() and p_starts_at <= now() + interval '30 days', 'start time must be within the next 30 days');
  perform public._assert(p_slots between 1 and 48, 'slot count must be between 1 and 48');
  perform public._assert(char_length(coalesce(p_note, '')) <= 500, 'request note is too long');
  perform public._assert(extract(second from (p_starts_at at time zone 'Asia/Kolkata')) = 0,
                         'start time must align to a slot boundary');

  perform pg_advisory_xact_lock(hashtext(p_resource_id::text));
  v_start_local := p_starts_at at time zone 'Asia/Kolkata';
  v_end_at := p_starts_at + make_interval(mins => v_resource.slot_minutes * p_slots);
  v_end_local := v_end_at at time zone 'Asia/Kolkata';
  v_day := extract(dow from v_start_local)::smallint;
  select * into v_hours from public.sports_hours h
   where h.venue_id = v_resource.venue_id and h.weekday = v_day;
  perform public._assert(found, 'venue is closed on that day');
  perform public._assert(v_start_local::date = v_end_local::date
                         and v_start_local::time >= v_hours.opens
                         and v_end_local::time <= v_hours.closes,
                         'requested time is outside opening hours');
  perform public._assert(
    mod(extract(epoch from (v_start_local::time - v_hours.opens))::int, v_resource.slot_minutes * 60) = 0,
    'start time is not aligned to the venue slot schedule'
  );
  v_expires_at := least(p_starts_at - interval '30 minutes', now() + interval '2 hours');
  perform public._assert(v_expires_at > now(), 'slot must start more than 30 minutes from now');
  perform public._assert(not exists (
    select 1 from public.sports_blocks b
     where b.resource_id = p_resource_id and b.starts_at < v_end_at and b.ends_at > p_starts_at
  ), 'slot is blocked by the venue');
  perform public._assert(not exists (
    select 1 from public.sports_bookings b
     where b.resource_id = p_resource_id
       and b.starts_at < v_end_at and b.ends_at > p_starts_at
       and (b.status = 'accepted' or (b.status = 'requested' and b.expires_at > now()))
  ), 'slot is no longer available');

  for i in 0 .. p_slots - 1 loop
    v_slot_start := p_starts_at + make_interval(mins => v_resource.slot_minutes * i);
    v_slot_local := (v_slot_start at time zone 'Asia/Kolkata')::time;
    v_slot_end_local := ((v_slot_start + make_interval(mins => v_resource.slot_minutes)) at time zone 'Asia/Kolkata')::time;
    select r.price_paise into v_price
      from public.sports_price_rules r
     where r.resource_id = p_resource_id
       and (r.weekday = v_day or r.weekday is null)
       and r.starts <= v_slot_local and r.ends >= v_slot_end_local
     order by (r.weekday is null), r.starts
     limit 1;
    perform public._assert(v_price is not null, 'no price rule covers every requested slot');
    v_total := v_total + v_price;
  end loop;
  perform public._assert(v_total <= 2147483647, 'total price is too large');

  insert into public.sports_bookings
    (customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise, note, expires_at)
  values
    (v_uid, v_resource.venue_id, p_resource_id, p_starts_at, v_end_at, 'requested', v_total::int,
     coalesce(p_note, ''), v_expires_at)
  returning id into v_booking_id;

  insert into public.notifications (user_id, kind, title, body, data, collapse_key)
  values (
    v_resource.owner_id, 'sports_booking_requested', 'New sports venue request',
    v_resource.venue_name || ' has a new booking request.',
    jsonb_build_object('sports_booking_id', v_booking_id, 'url', '/sports-booking/' || v_booking_id::text),
    'sports-booking-request:' || v_booking_id::text
  );
  return v_booking_id;
end;
$$;

create or replace function public.get_my_sports_bookings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_result jsonb;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'customer_id', b.customer_id, 'customer_name', p.full_name,
    'owner_id', v.owner_id, 'venue_id', v.id, 'venue_name', v.name,
    'resource_id', r.id, 'resource_name', r.name, 'activity_name', a.name,
    'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
    'price_paise', b.price_paise, 'note', b.note, 'decision_reason', b.decision_reason,
    'expires_at', b.expires_at, 'decided_at', b.decided_at, 'created_at', b.created_at
  ) order by b.starts_at desc), '[]'::jsonb)
    into v_result
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
    join public.sports_resources r on r.id = b.resource_id
    join public.sports_activities a on a.id = r.activity_id
    join public.profiles p on p.id = b.customer_id
   where b.customer_id = v_uid or v.owner_id = v_uid;
  return v_result;
end;
$$;

create or replace function public.get_sports_booking(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_result jsonb;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  select jsonb_build_object(
    'id', b.id, 'customer_id', b.customer_id, 'customer_name', p.full_name,
    'owner_id', v.owner_id, 'venue_id', v.id, 'venue_name', v.name,
    'resource_id', r.id, 'resource_name', r.name, 'activity_name', a.name,
    'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
    'price_paise', b.price_paise, 'note', b.note, 'decision_reason', b.decision_reason,
    'expires_at', b.expires_at, 'decided_at', b.decided_at, 'created_at', b.created_at
  ) into v_result
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
    join public.sports_resources r on r.id = b.resource_id
    join public.sports_activities a on a.id = r.activity_id
    join public.profiles p on p.id = b.customer_id
   where b.id = p_id and (b.customer_id = v_uid or v.owner_id = v_uid);
  perform public._assert(v_result is not null, 'booking not found');
  return v_result;
end;
$$;

create or replace function public.decide_sports_booking(p_id uuid, p_accept boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_booking record;
  v_status text;
  v_kind text;
  v_title text;
  v_body text;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(p_accept is not null, 'decision is required');
  perform public._assert(p_accept or char_length(btrim(coalesce(p_reason, ''))) between 3 and 500,
                         'a decline reason is required');
  select b.*, v.owner_id, v.name venue_name into v_booking
    from public.sports_bookings b join public.sports_venues v on v.id = b.venue_id
   where b.id = p_id for update of b;
  perform public._assert(found and v_booking.owner_id = v_uid, 'booking not found or not owned by you');
  perform public._assert(v_booking.status = 'requested' and v_booking.expires_at > now(), 'request is no longer pending');
  v_status := case when p_accept then 'accepted' else 'declined' end;
  v_kind := case when p_accept then 'sports_booking_accepted' else 'sports_booking_declined' end;
  v_title := case when p_accept then 'Sports booking accepted' else 'Sports booking declined' end;
  v_body := case when p_accept then v_booking.venue_name || ' accepted your request.'
                 else coalesce(nullif(btrim(p_reason), ''), v_booking.venue_name || ' declined your request.') end;
  update public.sports_bookings
     set status = v_status, decision_reason = case when p_accept then '' else btrim(p_reason) end, decided_at = now()
   where id = p_id;
  insert into public.notifications (user_id, kind, title, body, data, collapse_key)
  values (
    v_booking.customer_id, v_kind, v_title, left(v_body, 300),
    jsonb_build_object('sports_booking_id', p_id, 'url', '/sports-booking/' || p_id::text),
    'sports-booking-decision:' || p_id::text
  );
end;
$$;

create or replace function public.cancel_sports_booking(p_id uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_booking record;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  select b.*, v.owner_id into v_booking
    from public.sports_bookings b join public.sports_venues v on v.id = b.venue_id
   where b.id = p_id for update of b;
  perform public._assert(found, 'booking not found');
  perform public._assert(v_booking.status in ('requested', 'accepted'), 'booking cannot be cancelled');
  if v_booking.customer_id = v_uid then
    perform public._assert(v_booking.starts_at > now(), 'booking can only be cancelled before it starts');
  elsif v_booking.owner_id = v_uid then
    perform public._assert(char_length(btrim(coalesce(p_reason, ''))) between 3 and 500,
                           'a cancellation reason is required');
  else
    raise exception 'booking not found' using errcode = 'P0001';
  end if;
  update public.sports_bookings
     set status = 'cancelled', decision_reason = coalesce(btrim(p_reason), ''), decided_at = now()
   where id = p_id;
end;
$$;

create or replace function public.expire_sports_requests()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  update public.sports_bookings
     set status = 'expired', decided_at = now()
   where status = 'requested' and expires_at <= now();
  get diagnostics v_count = row_count;
  update public.sports_bookings
     set status = 'completed', decided_at = now()
   where status = 'accepted' and ends_at <= now();
  return v_count;
end;
$$;

revoke execute on function
  public.list_sports_activities(),
  public.save_sports_venue(uuid, text, text, text, text, text, double precision, double precision, text[], text[]),
  public.save_sports_resource(uuid, uuid, uuid, text, int, boolean),
  public.set_sports_hours(uuid, smallint, time, time),
  public.save_sports_price_rule(uuid, uuid, smallint, time, time, int, text),
  public.add_sports_block(uuid, timestamptz, timestamptz, text),
  public.remove_sports_block(uuid),
  public.submit_sports_venue(uuid),
  public.admin_set_venue_status(uuid, text, text),
  public.admin_list_sports_venues(),
  public.admin_list_sports_activities(),
  public.admin_set_sports_activity(uuid, boolean),
  public.search_sports_venues(text, double precision, double precision, double precision),
  public.get_sports_venue(uuid),
  public.get_my_sports_venues(),
  public.get_sports_slots(uuid, date),
  public.request_sports_slot(uuid, timestamptz, int, text),
  public.get_my_sports_bookings(),
  public.get_sports_booking(uuid),
  public.decide_sports_booking(uuid, boolean, text),
  public.cancel_sports_booking(uuid, text),
  public.expire_sports_requests()
from public, anon;

grant execute on function
  public.list_sports_activities(),
  public.search_sports_venues(text, double precision, double precision, double precision),
  public.get_sports_venue(uuid),
  public.get_sports_slots(uuid, date)
to anon, authenticated;

grant execute on function
  public.save_sports_venue(uuid, text, text, text, text, text, double precision, double precision, text[], text[]),
  public.save_sports_resource(uuid, uuid, uuid, text, int, boolean),
  public.set_sports_hours(uuid, smallint, time, time),
  public.save_sports_price_rule(uuid, uuid, smallint, time, time, int, text),
  public.add_sports_block(uuid, timestamptz, timestamptz, text),
  public.remove_sports_block(uuid),
  public.submit_sports_venue(uuid),
  public.get_my_sports_venues(),
  public.get_my_sports_bookings(),
  public.get_sports_booking(uuid),
  public.request_sports_slot(uuid, timestamptz, int, text),
  public.decide_sports_booking(uuid, boolean, text),
  public.cancel_sports_booking(uuid, text)
to authenticated;

grant execute on function
  public.admin_set_venue_status(uuid, text, text),
  public.admin_list_sports_venues(),
  public.admin_list_sports_activities(),
  public.admin_set_sports_activity(uuid, boolean)
to authenticated;
revoke execute on function public.expire_sports_requests() from authenticated;
grant execute on function public.expire_sports_requests() to service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'sports-booking-expiry';
    perform cron.schedule(
      'sports-booking-expiry',
      '*/5 * * * *',
      'select case when public._feature_enabled(''sports'') then public.expire_sports_requests() end'
    );
  end if;
end;
$$;

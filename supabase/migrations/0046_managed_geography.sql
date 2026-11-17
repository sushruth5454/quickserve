-- 0046: admin-managed geography hierarchy for service-area quick picks.

create table public.geo_states (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index geo_states_name_unique on public.geo_states (lower(btrim(name)));

create table public.geo_districts (
  id uuid primary key default gen_random_uuid(),
  state_id uuid not null references public.geo_states (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index geo_districts_sibling_name_unique on public.geo_districts (state_id, lower(btrim(name)));

create table public.geo_cities (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.geo_districts (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  lat double precision,
  lng double precision,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint geo_cities_coordinate_pair check (
    (lat is null and lng is null)
    or (lat between -90 and 90 and lng between -180 and 180)
  )
);
create unique index geo_cities_sibling_name_unique on public.geo_cities (district_id, lower(btrim(name)));

create table public.geo_areas (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.geo_cities (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index geo_areas_sibling_name_unique on public.geo_areas (city_id, lower(btrim(name)));

alter table public.geo_states enable row level security;
alter table public.geo_districts enable row level security;
alter table public.geo_cities enable row level security;
alter table public.geo_areas enable row level security;

revoke all on public.geo_states, public.geo_districts, public.geo_cities, public.geo_areas from public, anon, authenticated;
grant select on public.geo_states, public.geo_districts, public.geo_cities, public.geo_areas to anon, authenticated;

drop policy if exists geo_states_active_read on public.geo_states;
create policy geo_states_active_read on public.geo_states
  for select to anon, authenticated using (active);
drop policy if exists geo_states_admin_read on public.geo_states;
create policy geo_states_admin_read on public.geo_states
  for select to authenticated using (public._is_admin());

drop policy if exists geo_districts_active_read on public.geo_districts;
create policy geo_districts_active_read on public.geo_districts
  for select to anon, authenticated using (active);
drop policy if exists geo_districts_admin_read on public.geo_districts;
create policy geo_districts_admin_read on public.geo_districts
  for select to authenticated using (public._is_admin());

drop policy if exists geo_cities_active_read on public.geo_cities;
create policy geo_cities_active_read on public.geo_cities
  for select to anon, authenticated using (active);
drop policy if exists geo_cities_admin_read on public.geo_cities;
create policy geo_cities_admin_read on public.geo_cities
  for select to authenticated using (public._is_admin());

drop policy if exists geo_areas_active_read on public.geo_areas;
create policy geo_areas_active_read on public.geo_areas
  for select to anon, authenticated using (active);
drop policy if exists geo_areas_admin_read on public.geo_areas;
create policy geo_areas_admin_read on public.geo_areas
  for select to authenticated using (public._is_admin());

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values ('area_picker', true, 'Area quick picks', 'Show admin-managed areas in location quick picks.', 'App', 50)
on conflict (key) do nothing;

create or replace function public.admin_upsert_geo(
  p_kind text,
  p_id uuid,
  p_parent_id uuid,
  p_name text,
  p_lat double precision,
  p_lng double precision,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid := p_id;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(v_kind in ('state', 'district', 'city', 'area'), 'invalid geography kind');
  perform public._assert(char_length(v_name) between 2 and 80, 'name must be 2 to 80 characters');
  perform public._assert(p_active is not null, 'active is required');

  if v_kind = 'state' then
    perform public._assert(p_parent_id is null, 'state cannot have a parent');
    perform public._assert(p_lat is null and p_lng is null, 'coordinates are not supported for states');
  elsif v_kind = 'district' then
    perform public._assert(p_parent_id is not null, 'state is required');
    perform public._assert(exists (select 1 from public.geo_states s where s.id = p_parent_id), 'state not found');
    perform public._assert(p_lat is null and p_lng is null, 'coordinates are not supported for districts');
  elsif v_kind = 'city' then
    perform public._assert(p_parent_id is not null, 'district is required');
    perform public._assert(exists (select 1 from public.geo_districts d where d.id = p_parent_id), 'district not found');
    perform public._assert(
      (p_lat is null and p_lng is null)
      or (p_lat between -90 and 90 and p_lng between -180 and 180),
      'city coordinates must both be null or within valid ranges'
    );
  else
    perform public._assert(p_parent_id is not null, 'city is required');
    perform public._assert(exists (select 1 from public.geo_cities c where c.id = p_parent_id), 'city not found');
    perform public._assert(
      p_lat is not null and p_lng is not null
      and p_lat between -90 and 90 and p_lng between -180 and 180,
      'area coordinates are required and must be within valid ranges'
    );
  end if;

  if v_kind = 'state' then
    if v_id is null then
      insert into public.geo_states (name, active) values (v_name, p_active) returning id into v_id;
    else
      update public.geo_states set name = v_name, active = p_active, updated_at = now() where id = v_id;
      perform public._assert(found, 'geography record not found');
    end if;
  elsif v_kind = 'district' then
    if v_id is null then
      insert into public.geo_districts (state_id, name, active)
      values (p_parent_id, v_name, p_active) returning id into v_id;
    else
      update public.geo_districts
         set state_id = p_parent_id, name = v_name, active = p_active, updated_at = now()
       where id = v_id;
      perform public._assert(found, 'geography record not found');
    end if;
  elsif v_kind = 'city' then
    if v_id is null then
      insert into public.geo_cities (district_id, name, lat, lng, active)
      values (p_parent_id, v_name, p_lat, p_lng, p_active) returning id into v_id;
    else
      update public.geo_cities
         set district_id = p_parent_id, name = v_name, lat = p_lat, lng = p_lng, active = p_active, updated_at = now()
       where id = v_id;
      perform public._assert(found, 'geography record not found');
    end if;
  else
    if v_id is null then
      insert into public.geo_areas (city_id, name, lat, lng, active)
      values (p_parent_id, v_name, p_lat, p_lng, p_active) returning id into v_id;
    else
      update public.geo_areas
         set city_id = p_parent_id, name = v_name, lat = p_lat, lng = p_lng, active = p_active, updated_at = now()
       where id = v_id;
      perform public._assert(found, 'geography record not found');
    end if;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (
    v_uid,
    'upsert_geo',
    v_id,
    jsonb_build_object(
      'kind', v_kind, 'name', v_name, 'parent_id', p_parent_id,
      'lat', p_lat, 'lng', p_lng, 'active', p_active
    )
  );
  return v_id;
end;
$$;

revoke execute on function public.admin_upsert_geo(text, uuid, uuid, text, double precision, double precision, boolean)
  from public, anon;
grant execute on function public.admin_upsert_geo(text, uuid, uuid, text, double precision, double precision, boolean)
  to authenticated;

-- Only names are seeded; area coordinates must be entered from a verified place result.
insert into public.geo_states (name) values ('Telangana')
on conflict do nothing;
insert into public.geo_districts (state_id, name)
select s.id, 'Sangareddy' from public.geo_states s
where lower(btrim(s.name)) = 'telangana'
on conflict do nothing;
insert into public.geo_cities (district_id, name)
select d.id, 'Sangareddy' from public.geo_districts d
join public.geo_states s on s.id = d.state_id
where lower(btrim(s.name)) = 'telangana' and lower(btrim(d.name)) = 'sangareddy'
on conflict do nothing;

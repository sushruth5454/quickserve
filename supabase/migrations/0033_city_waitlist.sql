-- No-services-nearby experience: which cities are live (to offer instead) and a per-city launch waitlist.

-- Cities with at least one live, bookable provider (provider city launched for that category). Returns a centre
-- point (average of provider base locations) so the app can switch the customer's location to that city.
create or replace function public.list_live_cities()
returns table (city text, categories int, providers int, lat double precision, lng double precision)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p.city,
         count(distinct ps.category_id)::int,
         count(distinct p.id)::int,
         avg(extensions.st_y(p.base_location::extensions.geometry)),
         avg(extensions.st_x(p.base_location::extensions.geometry))
    from public.providers p
    join public.provider_services ps on ps.provider_id = p.id and ps.active
    join public.categories c on c.id = ps.category_id and c.active and not c.restricted
   where p.base_location is not null
     and not p.paused
     and public._provider_is_live(p.id)
     and exists (
       select 1 from public.category_cities cc
        where cc.category_id = c.id and cc.live and lower(trim(cc.city)) = lower(trim(p.city))
     )
   group by p.city
   order by count(distinct p.id) desc, p.city;
$$;

-- The live service city covering a point: geocoders name villages and suburbs ("Pothireddypally") instead of the
-- launch city ("Sangareddy"), so the app resolves the city from coordinates. A p_city that is already a live city is
-- kept as is (e.g. the "Vijayawada Demo" test city overlapping Vijayawada). Otherwise the nearest live provider whose
-- own service radius reaches the point decides; null when no live provider covers it (the area is not served yet).
create or replace function public.resolve_service_city(p_lat double precision, p_lng double precision, p_city text default null)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select btrim(p_city)
      where exists (select 1 from public.category_cities cc where cc.live and lower(trim(cc.city)) = lower(btrim(coalesce(p_city, ''))))),
    (select p.city
       from public.providers p
      where p_lat between -90 and 90 and p_lng between -180 and 180
        and p.base_location is not null
        and not p.paused
        and public._provider_is_live(p.id)
        and extensions.st_dwithin(
              p.base_location,
              extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
              greatest(coalesce(p.service_radius_km, 10), 1) * 1000)
        and exists (
          select 1 from public.provider_services ps
            join public.category_cities cc on cc.category_id = ps.category_id and cc.live and lower(trim(cc.city)) = lower(trim(p.city))
           where ps.provider_id = p.id and ps.active
        )
      order by extensions.st_distance(
                 p.base_location,
                 extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography)
      limit 1)
  );
$$;

create table public.city_waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  city text not null check (char_length(btrim(city)) between 2 and 120),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  created_at timestamptz not null default now()
);
create unique index city_waitlist_user_city_idx on public.city_waitlist (user_id, lower(btrim(city)));
create index city_waitlist_city_idx on public.city_waitlist (lower(btrim(city)));
alter table public.city_waitlist enable row level security;
revoke all on public.city_waitlist from anon, authenticated;

-- true when newly added, false when the user was already on that city's list.
create or replace function public.join_city_waitlist(p_city text, p_lat double precision default null, p_lng double precision default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_rows int;
begin
  perform public._assert(char_length(btrim(coalesce(p_city, ''))) between 2 and 120, 'city is required');
  insert into public.city_waitlist (user_id, city, lat, lng)
  values (v_uid, btrim(p_city),
          case when p_lat between -90 and 90 then p_lat end,
          case when p_lng between -180 and 180 then p_lng end)
  on conflict (user_id, lower(btrim(city))) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.on_city_waitlist(p_city text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.city_waitlist w
     where w.user_id = auth.uid() and lower(btrim(w.city)) = lower(btrim(coalesce(p_city, '')))
  );
$$;

revoke execute on function public.list_live_cities(), public.resolve_service_city(double precision, double precision, text),
  public.join_city_waitlist(text, double precision, double precision), public.on_city_waitlist(text) from public, anon;
grant execute on function public.list_live_cities(), public.resolve_service_city(double precision, double precision, text),
  public.join_city_waitlist(text, double precision, double precision), public.on_city_waitlist(text) to authenticated;

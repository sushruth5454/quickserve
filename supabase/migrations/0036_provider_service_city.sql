-- 0036: a provider's city is normalised to the live service city covering their base location. The provider app saves
-- the phone geocoder's name ("Pothreddipalle" for a village 5 km from Sangareddy), which no category is launched in,
-- so search, the creators list and booking (_is_bookable matches category_cities by the provider's city) hid the pro.
-- resolve_service_city keeps a city that is already live and returns null where nothing is live; then the saved name
-- is kept unchanged.

create or replace function public._normalise_provider_city()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_city text;
begin
  if new.base_location is not null then
    v_city := public.resolve_service_city(
      extensions.st_y(new.base_location::extensions.geometry),
      extensions.st_x(new.base_location::extensions.geometry),
      new.city);
    if v_city is not null then
      new.city := v_city;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public._normalise_provider_city() from public, anon, authenticated;

drop trigger if exists providers_normalise_city on public.providers;
create trigger providers_normalise_city
  before insert or update of city, base_location on public.providers
  for each row execute function public._normalise_provider_city();

-- Existing rows: only those whose city resolves to a different live city change.
update public.providers p
   set city = p.city
 where p.base_location is not null
   and public.resolve_service_city(
         extensions.st_y(p.base_location::extensions.geometry),
         extensions.st_x(p.base_location::extensions.geometry),
         p.city) is distinct from p.city
   and public.resolve_service_city(
         extensions.st_y(p.base_location::extensions.geometry),
         extensions.st_x(p.base_location::extensions.geometry),
         p.city) is not null;

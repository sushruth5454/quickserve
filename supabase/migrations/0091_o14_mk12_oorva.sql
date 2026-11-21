create or replace function public.list_top_rated_public(p_city text, p_limit int)
returns table (
  id uuid,
  city text,
  rating_avg numeric,
  rating_count int,
  jobs_completed int,
  years_experience int,
  is_online boolean,
  on_leave_until timestamptz,
  profiles jsonb,
  provider_services jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_city text := nullif(trim(p_city), '');
begin
  if v_city is null or not public._guest_browse_enabled() then
    return;
  end if;

  return query
  with ranked as (
    select p.id,
           p.city,
           p.rating_avg,
           p.rating_count,
           p.jobs_completed,
           p.years_experience,
           p.is_online and leave.on_leave_until is null as is_online,
           leave.on_leave_until
      from public.providers as p
      cross join lateral (
        select max(upper(t.period)) as on_leave_until
          from public.provider_time_off as t
         where t.provider_id = p.id
           and t.period @> now()
      ) as leave
     where lower(trim(p.city)) = lower(trim(v_city))
       and p.id is distinct from auth.uid()
       and p.rating_count > 0
       and public._provider_is_live(p.id)
       and exists (
         select 1
           from public.provider_services as ps
           join public.categories as c on c.id = ps.category_id
          where ps.provider_id = p.id
            and ps.active
            and public._is_bookable(c.id, p.id, v_city, c.archetype, null)
       )
     order by p.rating_avg desc, p.rating_count desc
     limit least(greatest(coalesce(p_limit, 10), 1), 50)
  )
  select ranked.id,
         ranked.city,
         ranked.rating_avg,
         ranked.rating_count,
         ranked.jobs_completed,
         ranked.years_experience,
         ranked.is_online,
         ranked.on_leave_until,
         case
           when profile.id is null then null
           else jsonb_build_object('full_name', profile.full_name, 'avatar_url', profile.avatar_url)
         end as profiles,
         coalesce(service_list.provider_services, '[]'::jsonb) as provider_services
    from ranked
    left join public.profiles as profile on profile.id = ranked.id
    left join lateral (
      select jsonb_agg(
               jsonb_build_object(
                 'id', ps.id,
                 'visit_fee', ps.visit_fee,
                 'skill_level', ps.skill_level,
                 'active', ps.active,
                 'categories', jsonb_build_object(
                   'name', c.name,
                   'slug', c.slug,
                   'archetype', c.archetype,
                   'sort_order', c.sort_order
                 ),
                 'service_packages', (
                   select coalesce(
                     jsonb_agg(
                       jsonb_build_object(
                         'id', sp.id,
                         'sort_order', sp.sort_order,
                         'price_type', sp.price_type,
                         'price', sp.price,
                         'price_min', sp.price_min,
                         'price_max', sp.price_max,
                         'unit', sp.unit
                       )
                       order by sp.sort_order, sp.id
                     ),
                     '[]'::jsonb
                   )
                     from public.service_packages as sp
                    where sp.provider_service_id = ps.id
                      and sp.active
                 )
               )
               order by c.sort_order, ps.id
             ) as provider_services
        from public.provider_services as ps
        join public.categories as c on c.id = ps.category_id
       where ps.provider_id = ranked.id
         and ps.active
         and public._is_bookable(c.id, ranked.id, v_city, c.archetype, null)
    ) as service_list on true
   order by ranked.rating_avg desc, ranked.rating_count desc;
end;
$$;

revoke all on function public.list_top_rated_public(text, int) from public;
grant execute on function public.list_top_rated_public(text, int) to anon, authenticated, service_role;

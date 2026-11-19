insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values
  ('home_v2', false, 'New home screen', 'New customer home layout. Off: customers see the current home screen.', 'Customer experience', 60),
  ('unified_search', false, 'Search everything', 'Unified search across marketplace categories. Off: customers use the existing separate discovery flows.', 'Customer experience', 61),
  ('guest_browse', false, 'Browse without signing in', 'Browse public marketplace listings without an account. Off: signed-out customers must sign in before browsing.', 'Customer experience', 62),
  ('creators_landing', false, 'Creators landing page', 'Dedicated discovery for creators and freelancers. Off: creators remain in the existing category drill-down.', 'Customer experience', 63),
  ('booking_steps', false, 'Step-by-step booking', 'Guided steps for service booking. Off: customers use the existing booking flow.', 'Customer experience', 64),
  ('book_again', false, 'Book again', 'Quickly repeat an eligible past booking. Off: the Book again action is hidden.', 'Customer experience', 65)
on conflict (key) do nothing;

-- Distinguish anonymous JWTs from signed-in and server roles inside SECURITY DEFINER functions.
create or replace function public._guest_browse_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('role', true), ''),
      'anon'
    ) = 'anon' then public._feature_enabled('guest_browse')
    when coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('role', true), ''),
      'anon'
    ) in ('authenticated', 'service_role') then true
    when session_user in ('postgres', 'supabase_admin') then true
    else false
  end;
$$;

revoke all on function public._guest_browse_enabled() from public, anon, authenticated, service_role;
grant execute on function public._guest_browse_enabled() to anon, authenticated, service_role;

create or replace function public._shops_products_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._feature_enabled('products') and public._guest_browse_enabled();
$$;

create or replace function public._sports_feature(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when p_key = 'sports' then public._feature_enabled('sports')
      when p_key in (
        'sports_online_payments', 'sports_instant_booking', 'sports_capacity_slots', 'sports_multi_slot'
      ) then public._feature_enabled('sports') and public._feature_enabled(p_key)
      else false
    end
    and public._guest_browse_enabled();
$$;

revoke all on public.profiles, public.providers, public.provider_services, public.rate_card_items,
public.categories, public.category_cities, public.provider_links, public.reviews, public.service_packages,
  public.product_categories, public.shops, public.shop_categories, public.products, public.product_images,
  public.sports_activities, public.sports_venues, public.sports_resources, public.sports_hours,
  public.sports_price_rules, public.geo_states, public.geo_districts, public.geo_cities, public.geo_areas
from anon;

grant select (id, full_name, avatar_url) on public.profiles to anon;
grant select (
  id, bio, city, service_radius_km, years_experience, languages, kyc_status, suspended,
  is_online, rating_avg, rating_count, jobs_completed, commission_tier, created_at, paused,
  base_area, timezone
) on public.providers to anon;
grant select (
  id, provider_id, category_id, skill_level, visit_fee, labour_rate, rate_unit, active, created_at,
  specialisations, brands, tools, attributes, max_travel_km, travel_fee_mode, travel_fee_flat,
  travel_fee_per_km
) on public.provider_services to anon;
grant select (id, provider_service_id, title, price) on public.rate_card_items to anon;
grant select (id, name, slug, archetype, active, restricted) on public.categories to anon;
grant select (category_id, city, live) on public.category_cities to anon;
grant select (
  id, provider_service_id, package_template_id, title, description, price_type, price, price_min,
  price_max, unit, qty_min, qty_max, duration_min, inclusions, exclusions, deliverables,
  turnaround_days, revisions_included, raw_files_included, usage_rights, travel_included_km,
  active, sort_order, created_at, updated_at
) on public.service_packages to anon;
grant select (
  id, provider_id, rating, punctuality, quality, behaviour, pricing, comment, provider_reply, created_at
) on public.reviews to anon;
revoke all on public.review_insight_summary from anon;
grant select (id, name, active) on public.geo_states to anon;
grant select (id, state_id, name, active) on public.geo_districts to anon;
grant select (id, district_id, name, lat, lng, active) on public.geo_cities to anon;
grant select (id, city_id, name, lat, lng, active, sort_order) on public.geo_areas to anon;

revoke all on public.document_types, public.category_skills, public.provider_availability,
  public.provider_portfolio, public.package_templates, public.price_bands
from anon;

revoke all on public.product_categories, public.shops, public.shop_categories, public.products,
  public.product_images, public.sports_activities, public.sports_venues, public.sports_resources,
  public.sports_hours, public.sports_price_rules
from anon;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (
    public._guest_browse_enabled()
    and (
      id = auth.uid()
      or public._provider_is_live(id)
      or exists (
        select 1 from public.bookings as b
         where (b.customer_id = auth.uid() and b.provider_id = profiles.id)
            or (b.provider_id = auth.uid() and b.customer_id = profiles.id)
      )
    )
  );

drop policy if exists providers_read on public.providers;
create policy providers_read on public.providers for select
  using (public._guest_browse_enabled() and (id = auth.uid() or public._provider_is_live(id)));

drop policy if exists provider_services_read on public.provider_services;
create policy provider_services_read on public.provider_services for select to authenticated
  using (
    provider_id = auth.uid()
    or (active and public._provider_is_live(provider_id) and public._category_docs_ok(provider_id, category_id))
  );
create policy provider_services_guest_read on public.provider_services for select to anon
  using (
    public._guest_browse_enabled()
    and active
    and public._provider_is_live(provider_id)
    and public._category_docs_ok(provider_id, category_id)
    and exists (
      select 1
        from public.providers as p
        join public.categories as c on c.id = provider_services.category_id
        join public.category_cities as cc on cc.category_id = c.id
       where p.id = provider_services.provider_id
         and c.active
         and not c.restricted
         and cc.live
         and lower(trim(cc.city)) = lower(trim(p.city))
    )
  );

drop policy if exists rate_card_read on public.rate_card_items;
create policy rate_card_read on public.rate_card_items for select to authenticated
  using (
    exists (
      select 1 from public.provider_services as ps
       where ps.id = rate_card_items.provider_service_id
         and (ps.provider_id = auth.uid() or public._provider_is_live(ps.provider_id))
    )
  );
create policy rate_card_guest_read on public.rate_card_items for select to anon
  using (
    public._guest_browse_enabled()
    and exists (
      select 1
        from public.provider_services as ps
        join public.providers as p on p.id = ps.provider_id
        join public.categories as c on c.id = ps.category_id
        join public.category_cities as cc on cc.category_id = c.id
       where ps.id = rate_card_items.provider_service_id
         and ps.active
         and c.active
         and not c.restricted
         and cc.live
         and lower(trim(cc.city)) = lower(trim(p.city))
         and public._provider_is_live(ps.provider_id)
         and public._category_docs_ok(ps.provider_id, ps.category_id)
    )
  );

drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to anon
  using (
    public._guest_browse_enabled()
    and active
    and not restricted
    and exists (
      select 1 from public.category_cities as cc
       where cc.category_id = categories.id and cc.live
    )
  );
create policy categories_authenticated_read on public.categories for select to authenticated
  using (
    active
    and exists (
      select 1 from public.category_cities as cc
       where cc.category_id = categories.id and cc.live
    )
  );

drop policy if exists category_cities_live_read on public.category_cities;
create policy category_cities_live_read on public.category_cities for select to anon, authenticated
  using (public._guest_browse_enabled() and live);

drop policy if exists reviews_public on public.reviews;
create policy reviews_public on public.reviews for select
  using (
    public._guest_browse_enabled()
    and (auth.uid() is not null or public._provider_is_live(provider_id))
  );

drop policy if exists service_packages_public_read on public.service_packages;
create policy service_packages_public_read on public.service_packages for select to authenticated
  using (
    active
    and exists (
      select 1
        from public.provider_services as ps
        join public.categories as c on c.id = ps.category_id
       where ps.id = service_packages.provider_service_id
         and ps.active
         and c.active
         and public._provider_is_live(ps.provider_id)
         and public._category_docs_ok(ps.provider_id, ps.category_id)
    )
  );
create policy service_packages_guest_read on public.service_packages for select to anon
  using (
    public._guest_browse_enabled()
    and active
    and exists (
      select 1
        from public.provider_services as ps
        join public.providers as p on p.id = ps.provider_id
        join public.categories as c on c.id = ps.category_id
        join public.category_cities as cc on cc.category_id = c.id
       where ps.id = service_packages.provider_service_id
         and ps.active
         and c.active
         and not c.restricted
         and cc.live
         and lower(trim(cc.city)) = lower(trim(p.city))
         and public._provider_is_live(ps.provider_id)
         and public._category_docs_ok(ps.provider_id, ps.category_id)
    )
  );

drop policy if exists document_types_read on public.document_types;
create policy document_types_read on public.document_types for select to anon, authenticated
  using (public._guest_browse_enabled());

drop policy if exists category_skills_read on public.category_skills;
create policy category_skills_read on public.category_skills for select to anon, authenticated
  using (public._guest_browse_enabled() and active);

drop policy if exists provider_availability_read on public.provider_availability;
create policy provider_availability_read on public.provider_availability for select
  using (provider_id = auth.uid() or (public._guest_browse_enabled() and public._provider_is_live(provider_id)));

drop policy if exists provider_portfolio_read on public.provider_portfolio;
create policy provider_portfolio_read on public.provider_portfolio for select
  using (provider_id = auth.uid() or (public._guest_browse_enabled() and public._provider_is_live(provider_id)));

drop policy if exists provider_links_public_read on public.provider_links;
create policy provider_links_public_read on public.provider_links for select to anon, authenticated
  using (
    public._guest_browse_enabled()
    and status = 'approved'
    and exists (
      select 1 from public.providers as p
       where p.id = provider_links.provider_id and public._provider_is_live(p.id)
    )
  );

drop policy if exists package_templates_public_read on public.package_templates;
create policy package_templates_public_read on public.package_templates for select to anon, authenticated
  using (
    public._guest_browse_enabled()
    and active
    and exists (select 1 from public.categories as c where c.id = package_templates.category_id and c.active)
  );

drop policy if exists price_bands_public_read on public.price_bands;
create policy price_bands_public_read on public.price_bands for select to anon, authenticated
  using (
    public._guest_browse_enabled()
    and active
    and exists (select 1 from public.categories as c where c.id = price_bands.category_id and c.active)
  );

drop policy if exists geo_states_active_read on public.geo_states;
create policy geo_states_active_read on public.geo_states for select to anon
  using (public._guest_browse_enabled() and active);
create policy geo_states_authenticated_active_read on public.geo_states for select to authenticated
  using (active);

drop policy if exists geo_districts_active_read on public.geo_districts;
create policy geo_districts_active_read on public.geo_districts for select to anon
  using (
    public._guest_browse_enabled()
    and active
    and exists (
      select 1 from public.geo_states as s
       where s.id = geo_districts.state_id and s.active
    )
  );
create policy geo_districts_authenticated_active_read on public.geo_districts for select to authenticated
  using (active);

drop policy if exists geo_cities_active_read on public.geo_cities;
create policy geo_cities_active_read on public.geo_cities for select to anon
  using (
    public._guest_browse_enabled()
    and active
    and exists (
      select 1
        from public.geo_districts as d
        join public.geo_states as s on s.id = d.state_id and s.active
       where d.id = geo_cities.district_id and d.active
    )
  );
create policy geo_cities_authenticated_active_read on public.geo_cities for select to authenticated
  using (active);

drop policy if exists geo_areas_active_read on public.geo_areas;
create policy geo_areas_active_read on public.geo_areas for select to anon
  using (
    public._guest_browse_enabled()
    and active
    and exists (
      select 1
        from public.geo_cities as c
        join public.geo_districts as d on d.id = c.district_id and d.active
        join public.geo_states as s on s.id = d.state_id and s.active
       where c.id = geo_areas.city_id and c.active
    )
  );
create policy geo_areas_authenticated_active_read on public.geo_areas for select to authenticated
  using (active);

drop policy if exists sports_activities_read on public.sports_activities;
create policy sports_activities_read on public.sports_activities for select to anon, authenticated
  using (
    public._guest_browse_enabled()
    and active
    and coalesce((public.get_app_features() ->> 'sports')::boolean, false)
  );

drop policy if exists sports_venues_read on public.sports_venues;
create policy sports_venues_read on public.sports_venues for select to anon, authenticated
  using (
    public._guest_browse_enabled()
    and coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and (status = 'verified' or owner_id = auth.uid())
  );

drop policy if exists sports_resources_read on public.sports_resources;
create policy sports_resources_read on public.sports_resources for select to anon, authenticated
  using (
    public._guest_browse_enabled()
    and coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and (
      (active and exists (
        select 1 from public.sports_venues as v where v.id = sports_resources.venue_id and v.status = 'verified'
      ))
      or exists (
        select 1 from public.sports_venues as v where v.id = sports_resources.venue_id and v.owner_id = auth.uid()
      )
    )
  );

drop policy if exists sports_hours_read on public.sports_hours;
create policy sports_hours_read on public.sports_hours for select to anon, authenticated
  using (
    public._guest_browse_enabled()
    and coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and exists (
      select 1 from public.sports_venues as v
       where v.id = sports_hours.venue_id and (v.status = 'verified' or v.owner_id = auth.uid())
    )
  );

drop policy if exists sports_price_rules_read on public.sports_price_rules;
create policy sports_price_rules_read on public.sports_price_rules for select to anon, authenticated
  using (
    public._guest_browse_enabled()
    and coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and exists (
      select 1
        from public.sports_resources as r
        join public.sports_venues as v on v.id = r.venue_id
       where r.id = sports_price_rules.resource_id
         and ((r.active and v.status = 'verified') or v.owner_id = auth.uid())
    )
  );

drop policy if exists storage_avatars_read on storage.objects;
create policy storage_avatars_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars' and public._guest_browse_enabled());

drop policy if exists storage_portfolio_read on storage.objects;
create policy storage_portfolio_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'portfolio' and public._guest_browse_enabled());

update storage.buckets set public = false where id = 'product-images';
revoke insert, update, delete on storage.objects from anon;
drop policy if exists product_images_bucket_read on storage.objects;
create policy product_images_bucket_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images' and public._product_image_access(name, false));

create or replace function public.get_catalog(p_city text default null)
returns table (
  id uuid,
  slug text,
  name text,
  icon text,
  vertical text,
  parent_id uuid,
  archetype text,
  location_modes text[],
  pricing_units text[],
  intake_schema jsonb,
  payment_template text,
  cancellation_policy text,
  commission_bp int,
  min_lead_hours int,
  max_lead_days int,
  requires_docs text[],
  recommended_docs text[],
  restricted boolean,
  config_version int,
  pricing_mode public.pricing_mode,
  sort_order int,
  profile_schema jsonb,
  review_tags text[],
  recurrence_allowed boolean,
  allowed_frequencies text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select coalesce(
      nullif(trim(p_city), ''),
      (select value #>> '{}' from public.app_config where key = 'launch_city')
    ) as city
  ),
  visible as (
    select c.*
      from public.categories as c
      join public.category_cities as cc on cc.category_id = c.id and cc.live
      cross join target as t
     where public._guest_browse_enabled()
       and c.active
       and not c.restricted
       and lower(trim(cc.city)) = lower(trim(coalesce(t.city, '')))
       and public._archetype_enabled(c.archetype)
       and public._home_services_catalogue_visible(c.slug, c.vertical)
  ),
  result as (
    select v.* from visible as v
    union all
    select g.*
      from public.categories as g
     where public._guest_browse_enabled()
       and public._feature_enabled('home_services_catalogue_v2')
       and g.parent_id is null
       and g.archetype is null
       and exists (select 1 from visible as child where child.parent_id = g.id)
  )
  select c.id, c.slug, c.name, c.icon, c.vertical, c.parent_id, c.archetype,
         c.location_modes, c.pricing_units, c.intake_schema, c.payment_template,
         c.cancellation_policy, c.commission_bp, c.min_lead_hours, c.max_lead_days,
         c.requires_docs, c.recommended_docs, c.restricted, c.config_version,
         c.pricing_mode, c.sort_order, c.profile_schema, c.review_tags,
         c.recurrence_allowed, c.allowed_frequencies
    from result as c
   order by c.sort_order, c.name;
$$;

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
  select r.*
    from public._search_providers_phase0(
      p_category_slug, p_lat, p_lng, p_sort, p_min_rating, p_skill_level,
      p_max_visit_fee, p_online_only, p_limit
    ) as r
    join public.provider_services as ps on ps.id = r.provider_service_id
    join public.categories as c on c.id = ps.category_id
   where public._guest_browse_enabled()
     and public._is_bookable(c.id, r.provider_id, r.city, c.archetype, null);
$$;

create or replace function public.get_provider_public_profile(p_provider_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.providers;
  v_today date;
begin
  if not public._guest_browse_enabled() then
    return null;
  end if;
  select * into p from public.providers where id = p_provider_id;
  if not found or not (public._provider_is_live(p_provider_id) or p_provider_id = auth.uid()) then
    return null;
  end if;
  v_today := public._provider_local_date(p_provider_id, now());
  return jsonb_build_object(
    'id', p.id,
    'base_area', p.base_area,
    'city', p.city,
    'service_radius_km', p.service_radius_km,
    'paused', p.paused,
    'live', public._provider_is_live(p.id),
    'member_since', p.created_at,
    'badges', jsonb_build_object(
      'id_verified', p.kyc_status = 'verified' and coalesce(p.razorpay_account_id, '') like 'acc\_%',
      'payout_verified', p.kyc_status = 'verified',
      'police_verified', exists (
        select 1 from public.provider_documents as d
        where d.provider_id = p.id and d.doc_type = 'police_verification'
          and d.status = 'approved' and (d.expires_on is null or d.expires_on >= v_today)
      )
    ),
    'credentials', coalesce((
      select jsonb_agg(distinct dt.label)
        from public.provider_documents as d
        join public.document_types as dt on dt.code = d.doc_type
       where d.provider_id = p.id and d.status = 'approved'
         and (d.expires_on is null or d.expires_on >= v_today)
    ), '[]'::jsonb),
    'specialisations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', s.category_id,
        'labels', (
          select coalesce(jsonb_agg(k.label order by k.sort_order), '[]'::jsonb)
            from public.category_skills as k
           where k.category_id = s.category_id and k.kind = 'skill' and k.slug = any(s.specialisations)
        ),
        'brands', to_jsonb(s.brands),
        'attributes', s.attributes,
        'schema', c.profile_schema
      ))
        from public.provider_services as s
        join public.categories as c on c.id = s.category_id
       where s.provider_id = p.id and s.active
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', a.weekday, 'start', to_char(a.start_time, 'HH24:MI'), 'end', to_char(a.end_time, 'HH24:MI')
      ) order by a.weekday, a.start_time)
        from public.provider_availability as a
       where a.provider_id = p.id
    ), '[]'::jsonb),
    'on_leave_until', (
      select max(upper(t.period)) from public.provider_time_off as t
       where t.provider_id = p.id and t.period @> now()
    ),
    'portfolio', coalesce((
      select jsonb_agg(jsonb_build_object('file_path', x.file_path, 'caption', x.caption) order by x.sort_order)
        from public.provider_portfolio as x
       where x.provider_id = p.id
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'kind', l.kind, 'url', l.url, 'handle', l.handle,
        'status', l.status,
        'review_reason', case when p.id = auth.uid() then l.review_reason else null end,
        'verified', l.verified_method <> 'none', 'verified_method', l.verified_method,
        'stats', l.stats, 'stats_synced_at', l.stats_synced_at
      ) order by l.created_at)
        from public.provider_links as l
       where l.provider_id = p.id and (l.status = 'approved' or p.id = auth.uid())
    ), '[]'::jsonb),
    'review_themes', coalesce((
      select jsonb_agg(jsonb_build_object('tag', x.tag, 'count', x.n) order by x.n desc, x.tag)
        from (
          select unnest(r.tags) as tag, count(*) as n
            from public.reviews as r
           where r.provider_id = p.id
           group by 1
           order by n desc
           limit 10
        ) as x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_live_cities()
returns table (city text, categories int, providers int, lat double precision, lng double precision)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- The signed-out city picker needs public city counts, never provider-derived center coordinates.
  select p.city,
         count(distinct ps.category_id)::int,
         count(distinct p.id)::int,
         case when current_setting('request.jwt.claim.role', true) = 'anon'
              then null::double precision
              else avg(extensions.st_y(p.base_location::extensions.geometry))
          end,
         case when current_setting('request.jwt.claim.role', true) = 'anon'
              then null::double precision
              else avg(extensions.st_x(p.base_location::extensions.geometry))
          end
    from public.providers as p
    join public.provider_services as ps on ps.provider_id = p.id and ps.active
    join public.categories as c on c.id = ps.category_id and c.active and not c.restricted
   where public._guest_browse_enabled()
     and p.base_location is not null
     and not p.paused
     and public._provider_is_live(p.id)
     and exists (
       select 1 from public.category_cities as cc
        where cc.category_id = c.id and cc.live and lower(trim(cc.city)) = lower(trim(p.city))
     )
   group by p.city
   order by count(distinct p.id) desc, p.city;
$$;

create or replace function public.list_sports_activities()
returns table (id uuid, slug text, name text, icon text, sort_order int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  return query
    select a.id, a.slug, a.name, a.icon, a.sort_order
      from public.sports_activities as a
     where a.active
     order by a.sort_order, a.name;
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
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(p_lat between -90 and 90 and p_lng between -180 and 180, 'valid search coordinates are required');
  perform public._assert(p_radius_km between 1 and 100, 'search radius must be between 1 and 100 km');
  perform public._assert(exists (
    select 1 from public.sports_activities as a where a.slug = p_activity_slug and a.active
  ), 'activity is unavailable');
  return query
    select v.id, v.name, v.description,
           case when current_setting('request.jwt.claim.role', true) = 'anon' then '' else v.address_line end,
           v.city, v.area,
           case when current_setting('request.jwt.claim.role', true) = 'anon' then null::double precision else v.lat end,
           case when current_setting('request.jwt.claim.role', true) = 'anon' then null::double precision else v.lng end,
           v.amenities, v.photos,
           (extensions.st_distance(
             extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography,
             extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
           ) / 1000.0)::double precision,
           (select min(pr.price_paise)::int
              from public.sports_resources as r
              join public.sports_activities as a on a.id = r.activity_id
              join public.sports_price_rules as pr on pr.resource_id = r.id
             where r.venue_id = v.id and r.active and a.active and a.slug = p_activity_slug)
      from public.sports_venues as v
     where v.status = 'verified'
       and exists (
         select 1 from public.sports_resources as r
         join public.sports_activities as a on a.id = r.activity_id
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
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  select jsonb_build_object(
    'id', v.id,
    'name', v.name,
    'description', v.description,
    'address_line', case when current_setting('request.jwt.claim.role', true) = 'anon' then '' else v.address_line end,
    'city', v.city,
    'area', v.area,
    'lat', case when current_setting('request.jwt.claim.role', true) = 'anon' then null else v.lat end,
    'lng', case when current_setting('request.jwt.claim.role', true) = 'anon' then null else v.lng end,
    'amenities', v.amenities,
    'photos', v.photos,
    'payment_modes', v.payment_modes,
    'online_payment_ready', coalesce(
      public._sports_feature('sports_online_payments')
      and 'online' = any(v.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts as pa
         where pa.provider_id = v.owner_id and pa.activation_status = 'activated'
      ),
      false
    ),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'activity_id', a.id, 'activity_slug', a.slug,
        'activity_name', a.name, 'slot_minutes', r.slot_minutes,
        'booking_mode', r.booking_mode, 'capacity', r.capacity
      ) order by r.created_at)
        from public.sports_resources as r
        join public.sports_activities as a on a.id = r.activity_id
       where r.venue_id = v.id and r.active and a.active
    ), '[]'::jsonb)
  ) into v_result
    from public.sports_venues as v
   where v.id = p_id and v.status = 'verified';
  return v_result;
end;
$$;

drop function if exists public.get_sports_slots(uuid, date);
create function public.get_sports_slots(p_resource_id uuid, p_date date)
returns table (starts_at timestamptz, ends_at timestamptz, state text, price_paise int, remaining int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(
    p_date is not null
    and p_date between (now() at time zone 'Asia/Kolkata')::date
      and (now() at time zone 'Asia/Kolkata')::date + 30,
    'date must be within the next 30 days'
  );
  return query
    with scope as (
      select r.id as resource_id, r.slot_minutes, r.capacity, h.opens, h.closes,
             extract(dow from p_date)::smallint as weekday
        from public.sports_resources as r
        join public.sports_venues as v on v.id = r.venue_id
        join public.sports_activities as a on a.id = r.activity_id
        join public.sports_hours as h
          on h.venue_id = v.id and h.weekday = extract(dow from p_date)::smallint
       where r.id = p_resource_id and r.active and a.active and v.status = 'verified'
    ),
    slots as (
      select s.resource_id, s.capacity, s.slot_minutes, s.weekday, gs as slot_start,
             gs + make_interval(mins => s.slot_minutes) as slot_end,
             (gs at time zone 'Asia/Kolkata')::time as local_start,
             ((gs + make_interval(mins => s.slot_minutes)) at time zone 'Asia/Kolkata')::time as local_end
        from scope as s
        cross join lateral generate_series(
          (p_date + s.opens) at time zone 'Asia/Kolkata',
          (p_date + s.closes) at time zone 'Asia/Kolkata' - make_interval(mins => s.slot_minutes),
          make_interval(mins => s.slot_minutes)
        ) as gs
    )
    select s.slot_start, s.slot_end,
           case
             when s.slot_start <= now() then 'past'
             when exists (
               select 1 from public.sports_blocks as b
                where b.resource_id = s.resource_id and b.starts_at < s.slot_end and b.ends_at > s.slot_start
             ) then 'blocked'
             when used.participants >= s.capacity then 'taken'
             when price.price_paise is null then 'blocked'
             else 'free'
           end,
           price.price_paise,
           greatest(s.capacity - used.participants, 0)::int
      from slots as s
      left join lateral (
        select coalesce(sum(b.participants), 0)::int as participants
          from public.sports_bookings as b
         where b.resource_id = s.resource_id
           and b.starts_at < s.slot_end and b.ends_at > s.slot_start
           and (
             b.status = 'accepted'
             or (b.status = 'requested' and b.expires_at > now())
             or (b.status = 'awaiting_payment' and b.pay_by > now())
             or (b.status = 'pending_payment' and b.hold_expires_at > now())
           )
      ) as used on true
      left join lateral (
        select pr.price_paise::int as price_paise
          from public.sports_price_rules as pr
         where pr.resource_id = s.resource_id
           and (pr.weekday = s.weekday or pr.weekday is null)
           and pr.starts <= s.local_start and pr.ends >= s.local_end
         order by (pr.weekday is null), pr.starts
         limit 1
      ) as price on true
     order by s.slot_start;
end;
$$;

revoke execute on function public.get_sports_slots(uuid, date) from public, anon, authenticated;
grant execute on function public.get_sports_slots(uuid, date) to anon, authenticated;

create or replace function public.get_shop(p_id uuid)
returns table (
  id uuid, name text, description text, address_line text, city text, area text, lat double precision,
  lng double precision, delivery_radius_km int, offers_delivery boolean, offers_pickup boolean,
  whatsapp_contact boolean, category_slugs text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  return query
    select s.id, s.name, s.description,
           case when current_setting('request.jwt.claim.role', true) = 'anon' then '' else s.address_line end,
           s.city, s.area,
           case when current_setting('request.jwt.claim.role', true) = 'anon' then null::double precision else s.lat end,
           case when current_setting('request.jwt.claim.role', true) = 'anon' then null::double precision else s.lng end,
           s.delivery_radius_km, s.offers_delivery, s.offers_pickup, s.whatsapp_contact,
           coalesce((
             select array_agg(c.slug order by c.sort_order, c.name)
               from public.shop_categories as sc
               join public.product_categories as c on c.id = sc.category_id
              where sc.shop_id = s.id and c.active
           ), '{}'::text[])
      from public.shops as s
     where s.id = p_id and s.status = 'verified';
end;
$$;

create or replace function public.list_my_product_enquiries()
returns table (
  id uuid, shop_id uuid, product_id uuid, shop_name text, product_name text,
  status text, customer_unread int, last_message_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
  if auth.uid() is null then
    return;
  end if;
  v_uid := public._require_uid();
  return query
    select e.id, e.shop_id, e.product_id, s.name, p.name, e.status, e.customer_unread, e.last_message_at
      from public.product_enquiries as e
      join public.shops as s on s.id = e.shop_id
      left join public.products as p on p.id = e.product_id
     where e.customer_id = v_uid
     order by e.last_message_at desc
     limit 100;
end;
$$;

revoke execute on function public.list_my_product_enquiries() from public, anon;
grant execute on function public.list_my_product_enquiries() to anon, authenticated;

revoke execute on function public.create_fixed_booking(uuid, numeric, tstzrange, jsonb, jsonb),
  public.book_sports_slot(uuid, timestamptz, int, int, text, text, text),
  public.start_product_enquiry(uuid, uuid, text),
  public.create_service_request(uuid, text, text, timestamptz, timestamptz, jsonb, int, int, uuid, text, uuid, double precision, double precision, boolean)
from public, anon;

revoke execute on function public.list_live_cities() from public, anon;
grant execute on function public.list_live_cities() to anon, authenticated;

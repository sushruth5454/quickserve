-- WP P1a; owns: save_shop, delete_product, _refresh_product_search, _product_tsquery, search_products; sources: WS3-T01, WS3-T06, WS3-T12

create or replace function public.save_shop(
  p_name text, p_description text, p_address_line text, p_city text, p_area text,
  p_lat double precision, p_lng double precision, p_delivery_radius_km int,
  p_offers_delivery boolean, p_offers_pickup boolean, p_whatsapp_contact boolean,
  p_gstin text, p_category_slugs text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_shop public.shops;
  v_id uuid;
  v_slugs text[] := array(select distinct lower(trim(x)) from unnest(coalesce(p_category_slugs, '{}'::text[])) x where trim(x) <> '' order by 1);
  v_identity_changed boolean;
  v_gstin text := nullif(upper(trim(coalesce(p_gstin, ''))), '');
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  perform public._assert(char_length(trim(coalesce(p_name, ''))) between 2 and 100, 'shop name must be 2 to 100 characters');
  perform public._assert(char_length(coalesce(p_description, '')) <= 1500, 'shop description is too long');
  perform public._assert(char_length(coalesce(p_address_line, '')) <= 220, 'shop address is too long');
  perform public._assert(char_length(coalesce(p_city, '')) between 2 and 100, 'enter a valid city');
  perform public._assert(char_length(coalesce(p_area, '')) <= 100, 'shop area is too long');
  perform public._assert(coalesce((p_lat is null and p_lng is null) or (p_lat between -90 and 90 and p_lng between -180 and 180), false), 'invalid shop coordinates');
  perform public._assert(coalesce(p_delivery_radius_km, 10) between 1 and 250, 'delivery radius must be 1 to 250 km');
  perform public._assert(v_gstin is null or v_gstin ~ '^[0-9A-Z]{15}$', 'enter a valid 15-character GSTIN');
  perform public._assert(cardinality(v_slugs) between 1 and 10, 'choose at least one product category');
  perform public._assert(
    (select count(*) from public.product_categories c where c.active and c.slug = any(v_slugs)) = cardinality(v_slugs),
    'one or more product categories are unavailable'
  );

  select * into v_shop from public.shops where owner_id = v_uid for update;
  if not found then
    insert into public.shops (
      owner_id, name, description, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, whatsapp_contact, gstin
    ) values (
      v_uid, trim(p_name), trim(coalesce(p_description, '')), trim(coalesce(p_address_line, '')),
      trim(p_city), trim(coalesce(p_area, '')), p_lat, p_lng, coalesce(p_delivery_radius_km, 10),
      coalesce(p_offers_delivery, false), coalesce(p_offers_pickup, true), coalesce(p_whatsapp_contact, false), v_gstin
    ) returning id into v_id;
  else
    v_id := v_shop.id;
    v_identity_changed :=
      v_shop.name is distinct from trim(p_name)
      or v_shop.address_line is distinct from trim(coalesce(p_address_line, ''))
      or v_shop.city is distinct from trim(p_city)
      or v_shop.area is distinct from trim(coalesce(p_area, ''))
      or v_shop.lat is distinct from p_lat
      or v_shop.lng is distinct from p_lng
      or v_shop.gstin is distinct from v_gstin;
    update public.shops
       set name = trim(p_name), description = trim(coalesce(p_description, '')),
           address_line = trim(coalesce(p_address_line, '')), city = trim(p_city), area = trim(coalesce(p_area, '')),
           lat = p_lat, lng = p_lng, delivery_radius_km = coalesce(p_delivery_radius_km, 10),
           offers_delivery = coalesce(p_offers_delivery, false), offers_pickup = coalesce(p_offers_pickup, true),
           whatsapp_contact = coalesce(p_whatsapp_contact, false), gstin = v_gstin,
           status = case
             when status = 'suspended' then status
             when v_identity_changed and status in ('verified', 'rejected') then 'submitted'
             else status
           end,
           status_reason = case
             when status = 'suspended' then status_reason
             when v_identity_changed and status in ('verified', 'rejected') then null
             else status_reason
           end,
           updated_at = now()
     where id = v_id;
  end if;

  delete from public.shop_categories sc
   where sc.shop_id = v_id
     and not exists (
       select 1 from public.product_categories c
        where c.id = sc.category_id and c.slug = any(v_slugs)
     );
  insert into public.shop_categories (shop_id, category_id)
    select v_id, c.id from public.product_categories c where c.slug = any(v_slugs)
  on conflict do nothing;
  return v_id;
end;
$$;

create or replace function public.delete_product(p_product_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_shop_id uuid;
  v_paths text[];
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  select s.id into v_shop_id from public.shops s where s.owner_id = v_uid;
  perform public._assert(found, 'shop not found');
  select coalesce(array_agg(i.path order by i.sort_order), '{}'::text[]) into v_paths
    from public.product_images i join public.products p on p.id = i.product_id
   where p.id = p_product_id and p.shop_id = v_shop_id;
  delete from public.products where id = p_product_id and shop_id = v_shop_id;
  perform public._assert(found, 'product not found');
  return v_paths;
end;
$$;

create or replace function public._refresh_product_search()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.search := to_tsvector('english', concat_ws(' ', new.name, new.brand, new.model, new.description,
    (select c.name from public.product_categories c where c.id = new.category_id)));
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.indicative_price_paise is distinct from old.indicative_price_paise then
      new.price_updated_at := now();
    end if;
  elsif new.indicative_price_paise is not null and new.price_updated_at is null then
    new.price_updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public._product_tsquery(p text)
returns tsquery
language sql
immutable
as $$
  select to_tsquery(
    'english',
    string_agg(quote_literal(w) || ':*', ' & ')
  )
    from regexp_split_to_table(
      lower(regexp_replace(coalesce(p, ''), '[^[:alnum:] ]', ' ', 'g')),
      '\s+'
    ) w
   where w <> '';
$$;

revoke execute on function public._product_tsquery(text) from public, anon, authenticated;

update public.products set name = name;

create or replace function public.search_products(
  p_query text default null, p_category_slug text default null, p_lat double precision default null,
  p_lng double precision default null, p_radius_km int default 15, p_max_price_paise int default null,
  p_in_stock_only boolean default false, p_limit int default 30
)
returns table (
  id uuid, shop_id uuid, category_id uuid, category_slug text, category_name text,
  name text, brand text, model text, description text, specs jsonb, unit text,
  indicative_price_paise int, price_updated_at timestamptz, in_stock boolean, active boolean,
  image_paths text[], shop_name text, city text, area text, distance_km double precision
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query tsquery;
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  perform public._assert(coalesce((p_lat is null and p_lng is null) or (p_lat between -90 and 90 and p_lng between -180 and 180), false), 'invalid search coordinates');
  perform public._assert(p_radius_km is null or p_radius_km between 1 and 250, 'search radius must be 1 to 250 km');
  perform public._assert(p_max_price_paise is null or p_max_price_paise >= 0, 'maximum price cannot be negative');
  if nullif(trim(coalesce(p_query, '')), '') is not null then
    v_query := public._product_tsquery(p_query);
  end if;
  return query
    with candidates as (
      select p.id, p.shop_id, p.category_id, c.slug as category_slug, c.name as category_name,
             p.name, p.brand, p.model, p.description, p.specs, p.unit, p.indicative_price_paise,
             p.price_updated_at, p.in_stock, p.active,
             coalesce((select array_agg(i.path order by i.sort_order) from public.product_images i where i.product_id = p.id), '{}'::text[]) as image_paths,
             s.name as shop_name, s.city, s.area,
             case when p_lat is null then null::double precision else
               6371.0 * 2 * asin(sqrt(least(1.0, greatest(0.0,
                 power(sin(radians(s.lat - p_lat) / 2), 2)
                 + cos(radians(p_lat)) * cos(radians(s.lat))
                 * power(sin(radians(s.lng - p_lng) / 2), 2)
               ))))
             end as distance_km,
             case when v_query is null then 0::real else ts_rank(p.search, v_query) end as relevance
        from public.products p
        join public.shops s on s.id = p.shop_id and s.status = 'verified'
        join public.product_categories c on c.id = p.category_id and c.active
       where p.active
         and (p_category_slug is null or c.slug = p_category_slug)
         and exists (select 1 from public.shop_categories sc where sc.shop_id = p.shop_id and sc.category_id = p.category_id)
         and (v_query is null or p.search @@ v_query)
         and (p_max_price_paise is null or p.indicative_price_paise <= p_max_price_paise)
         and (not coalesce(p_in_stock_only, false) or p.in_stock)
    )
    select c.id, c.shop_id, c.category_id, c.category_slug, c.category_name, c.name, c.brand, c.model,
           c.description, c.specs, c.unit, c.indicative_price_paise, c.price_updated_at, c.in_stock, c.active,
           c.image_paths, c.shop_name, c.city, c.area, c.distance_km
      from candidates c
     where p_lat is null or (c.distance_km is not null and c.distance_km <= coalesce(p_radius_km, 15))
     order by c.distance_km nulls last, c.relevance desc, c.name
     limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

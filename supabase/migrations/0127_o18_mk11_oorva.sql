drop function public.get_shop(uuid);
drop function public.get_product(uuid);

create function public.get_shop(p_id uuid)
returns table (
  id uuid,
  name text,
  description text,
  address_line text,
  city text,
  area text,
  lat double precision,
  lng double precision,
  delivery_radius_km int,
  offers_delivery boolean,
  offers_pickup boolean,
  whatsapp_contact boolean,
  category_slugs text[],
  can_enquire boolean,
  enquiry_block_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  return query
    select s.id,
           s.name,
           s.description,
           case when auth.uid() is null then null::text else s.address_line end,
           s.city,
           s.area,
           case when auth.uid() is null then null::double precision else s.lat end,
           case when auth.uid() is null then null::double precision else s.lng end,
           s.delivery_radius_km,
           s.offers_delivery,
           s.offers_pickup,
           s.whatsapp_contact,
           coalesce((
             select array_agg(c.slug order by c.sort_order, c.name)
               from public.shop_categories as sc
               join public.product_categories as c on c.id = sc.category_id
              where sc.shop_id = s.id and c.active
           ), '{}'::text[]),
           public._can_start_product_enquiry(s.id, null::uuid),
           case
             when not public._shops_enquiries_enabled() then 'feature_off'
             when auth.uid() is null then 'sign_in'
             when s.owner_id = auth.uid() then 'own_shop'
             when not public._can_start_product_enquiry(s.id, null::uuid) then 'feature_off'
             else null::text
           end
      from public.shops as s
     where s.id = p_id and s.status = 'verified';
end;
$$;

create function public.get_product(p_id uuid)
returns table (
  id uuid,
  shop_id uuid,
  category_id uuid,
  category_slug text,
  category_name text,
  name text,
  brand text,
  model text,
  description text,
  specs jsonb,
  unit text,
  indicative_price_paise int,
  price_updated_at timestamptz,
  in_stock boolean,
  active boolean,
  shop_name text,
  city text,
  area text,
  image_paths text[],
  can_enquire boolean,
  enquiry_block_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  return query
    select p.id,
           p.shop_id,
           p.category_id,
           c.slug,
           c.name,
           p.name,
           p.brand,
           p.model,
           p.description,
           p.specs,
           p.unit,
           p.indicative_price_paise,
           p.price_updated_at,
           p.in_stock,
           p.active,
           s.name,
           s.city,
           s.area,
           coalesce((
             select array_agg(i.path order by i.sort_order)
               from public.product_images as i
              where i.product_id = p.id
           ), '{}'::text[]),
           public._can_start_product_enquiry(s.id, p.id),
           case
             when not public._shops_enquiries_enabled() then 'feature_off'
             when auth.uid() is null then 'sign_in'
             when s.owner_id = auth.uid() then 'own_shop'
             when not public._can_start_product_enquiry(s.id, p.id) then 'feature_off'
             else null::text
           end
      from public.products as p
      join public.product_categories as c on c.id = p.category_id and c.active
      join public.shops as s on s.id = p.shop_id and s.status = 'verified'
      join public.shop_categories as sc on sc.shop_id = p.shop_id and sc.category_id = p.category_id
     where p.id = p_id and p.active;
end;
$$;

revoke execute on function public.get_shop(uuid), public.get_product(uuid)
  from public, anon, authenticated;
grant execute on function public.get_shop(uuid), public.get_product(uuid)
  to anon, authenticated;

begin;

drop function if exists public.list_my_business_memberships();

create function public.list_my_business_memberships()
returns table (owner_id uuid, role text, business_type text, business_name text, business_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._feature_enabled('merchant_staff'), 'merchant staff is disabled');
  return query
    select p.id, bm.role, 'provider'::text, coalesce(pf.full_name, 'Provider business'), p.id
      from public.business_members bm
      join public.providers p on p.id = bm.owner_id
      join public.profiles pf on pf.id = p.id
     where bm.member_id = v_uid and bm.active
    union all
    select s.owner_id, bm.role, 'shop'::text, s.name, s.id
      from public.business_members bm
      join public.shops s on s.owner_id = bm.owner_id
     where bm.member_id = v_uid and bm.active
    union all
    select v.owner_id, bm.role, 'sports'::text, v.name, v.id
      from public.business_members bm
      join public.sports_venues v on v.owner_id = bm.owner_id
     where bm.member_id = v_uid and bm.active
    order by 3, 4;
end;
$$;

create or replace function public.get_business_shop_context(p_owner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_shop public.shops;
  v_role text;
  v_categories text[];
begin
  perform public._assert(p_owner_id is not null, 'shop not found');
  perform public._assert(
    p_owner_id = v_uid
      or (public._feature_enabled('merchant_staff') and public._acts_for(p_owner_id, 'staff')),
    'business access denied'
  );

  select s.* into v_shop
    from public.shops s
   where s.owner_id = p_owner_id;
  if not found then return null; end if;

  v_role := public._business_role(v_shop.owner_id);
  v_categories := '{}'::text[];
  if public._shops_products_enabled() then
    select coalesce(array_agg(c.slug order by c.sort_order, c.name), '{}'::text[]) into v_categories
      from public.shop_categories sc
      join public.product_categories c on c.id = sc.category_id
     where sc.shop_id = v_shop.id and c.active;
  end if;

  return jsonb_build_object(
    'id', v_shop.id, 'owner_id', v_shop.owner_id, 'business_role', v_role,
    'name', v_shop.name, 'description', v_shop.description, 'address_line', v_shop.address_line,
    'city', v_shop.city, 'area', v_shop.area, 'lat', v_shop.lat, 'lng', v_shop.lng,
    'delivery_radius_km', v_shop.delivery_radius_km, 'offers_delivery', v_shop.offers_delivery,
    'offers_pickup', v_shop.offers_pickup, 'whatsapp_contact', v_shop.whatsapp_contact,
    'gstin', case when v_role = 'owner' then v_shop.gstin else null end,
    'status', v_shop.status, 'status_reason', v_shop.status_reason,
    'category_slugs', to_jsonb(v_categories)
  );
end;
$$;

revoke execute on function public.list_my_business_memberships() from public, anon;
grant execute on function public.list_my_business_memberships() to authenticated;
revoke execute on function public.get_business_shop_context(uuid) from public, anon;
grant execute on function public.get_business_shop_context(uuid) to authenticated;

commit;

-- O27-MK02: owners may submit only complete draft or rejected shops.
create or replace function public.submit_shop(p_shop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  s public.shops;
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  select * into s
    from public.shops
   where id = p_shop_id and owner_id = v_uid
   for update;
  perform public._assert(found, 'shop not found');
  perform public._assert(s.status in ('draft', 'rejected'),
                         'only draft or rejected shops can be submitted');
  perform public._assert(char_length(trim(s.name)) >= 2 and char_length(trim(s.address_line)) >= 5
    and char_length(trim(s.city)) >= 2 and char_length(trim(s.area)) >= 2
    and s.lat is not null and s.lng is not null, 'complete the shop address and map location before submitting');
  perform public._assert(exists (
    select 1 from public.shop_categories sc where sc.shop_id = s.id
  ), 'choose at least one product category');
  update public.shops
     set status = 'submitted', status_reason = null, updated_at = now()
   where id = s.id;
end;
$$;

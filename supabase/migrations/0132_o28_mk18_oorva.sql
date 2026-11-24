begin;

drop function if exists public.list_my_supplier_rfqs();
create function public.list_my_supplier_rfqs()
returns table (
  shop_id uuid, shop_name text, rfq_id uuid, title text, category_name text, city text, area text,
  needs_delivery boolean, needed_by date, expires_at timestamptz, created_at timestamptz,
  item_count bigint, quote_status text, business_role text, rfq_status text, my_outcome text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select s.id, s.name, r.id, r.title, c.name, r.city, r.area, r.needs_delivery, r.needed_by,
           r.expires_at, r.created_at,
           (select count(*) from public.rfq_items i where i.rfq_id = r.id),
           (select q.status from public.supplier_quotes q
             where q.rfq_id = r.id and q.shop_id = s.id and q.status = 'sent'
             order by q.version desc limit 1),
           public._business_role(s.owner_id), r.status,
           (select q.status from public.supplier_quotes q
             where q.rfq_id = r.id and q.shop_id = s.id
             order by q.version desc limit 1)
      from public.rfq_recipients rr
      join public.shops s on s.id = rr.shop_id
      join public.rfqs r on r.id = rr.rfq_id
      join public.product_categories c on c.id = r.category_id
     where public._acts_for(s.owner_id, 'staff')
       and ((r.status = 'open' and r.expires_at > now()) or r.updated_at > now() - interval '30 days')
     order by r.created_at desc;
end;
$$;

revoke all on function public.list_my_supplier_rfqs() from public, anon;
grant execute on function public.list_my_supplier_rfqs() to authenticated;

commit;

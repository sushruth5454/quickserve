begin;

create or replace function public.get_supplier_rfq_for_business(p_rfq_id uuid, p_shop_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop public.shops;
  v_rfq public.rfqs;
  v_shop_id uuid := p_shop_id;
  v_accessible_shops int;
  v_send_block_reason text;
begin
  if v_shop_id is null then
    select count(*)::int into v_accessible_shops
      from public.rfq_recipients rr
      join public.shops s on s.id = rr.shop_id
     where rr.rfq_id = p_rfq_id and public._acts_for(s.owner_id, 'staff');
    perform public._assert(v_accessible_shops = 1, 'RFQ shop is ambiguous or unavailable; open it from Supplier RFQs.');
    select s.id into v_shop_id
      from public.rfq_recipients rr
      join public.shops s on s.id = rr.shop_id
     where rr.rfq_id = p_rfq_id and public._acts_for(s.owner_id, 'staff')
     order by s.id
     limit 1;
  end if;

  select * into v_shop from public.shops where id = v_shop_id;
  perform public._assert(found and public._acts_for(v_shop.owner_id, 'staff'), 'shop not found');
  perform public._assert(public._rfq_shop_recipient(p_rfq_id, v_shop.id), 'RFQ not found');

  select * into v_rfq from public.rfqs where id = p_rfq_id;
  perform public._assert(found, 'RFQ not found');

  v_send_block_reason := case
    when not coalesce(public._product_rfq_enabled(), false) then 'feature_off'
    when v_shop.status <> 'verified' then 'shop_unavailable'
    when not public._acts_for(v_shop.owner_id, 'manager') then 'role_not_permitted'
    when v_rfq.status <> 'open' then 'closed'
    when v_rfq.expires_at <= now() then 'rfq_expired'
    else null
  end;

  return jsonb_build_object(
    'id', v_rfq.id,
    'category_id', v_rfq.category_id,
    'category_name', (select c.name from public.product_categories c where c.id = v_rfq.category_id),
    'title', v_rfq.title,
    'city', v_rfq.city,
    'area', v_rfq.area,
    'needs_delivery', v_rfq.needs_delivery,
    'needed_by', v_rfq.needed_by,
    'notes', v_rfq.notes,
    'status', v_rfq.status,
    'expires_at', v_rfq.expires_at,
    'shop_id', v_shop.id,
    'shop_name', v_shop.name,
    'business_role', public._business_role(v_shop.owner_id),
    'shop_has_gstin', v_shop.gstin is not null,
    'can_send_quote', v_send_block_reason is null,
    'send_block_reason', v_send_block_reason,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'seq', i.seq,
        'description', i.description,
        'brand_pref', i.brand_pref,
        'specs', i.specs,
        'quantity', i.quantity,
        'unit', i.unit
      ) order by i.seq)
        from public.rfq_items i
       where i.rfq_id = v_rfq.id
    ), '[]'::jsonb),
    'my_quote', (
      select jsonb_build_object(
        'id', q.id,
        'version', q.version,
        'status', q.status,
        'delivery_charge_paise', q.delivery_charge_paise,
        'delivery_days', q.delivery_days,
        'valid_until', q.valid_until,
        'notes', q.notes,
        'subtotal_paise', q.subtotal_paise,
        'gst_paise', q.gst_paise,
        'total_paise', q.total_paise,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'rfq_item_id', qi.rfq_item_id,
            'seq', ri.seq,
            'description', ri.description,
            'brand', qi.brand,
            'model', qi.model,
            'specs', qi.specs,
            'quantity', qi.quantity,
            'unit', ri.unit,
            'unit_price_paise', qi.unit_price_paise,
            'gst_rate_bp', qi.gst_rate_bp,
            'available', qi.available,
            'line_total_paise', qi.line_total_paise
          ) order by ri.seq)
            from public.supplier_quote_items qi
            join public.rfq_items ri on ri.id = qi.rfq_item_id
            where qi.quote_id = q.id
              and ri.rfq_id = v_rfq.id
        ), '[]'::jsonb)
      )
        from public.supplier_quotes q
       where q.rfq_id = v_rfq.id
         and q.shop_id = v_shop.id
       order by q.version desc, q.created_at desc, q.id desc
       limit 1
    )
  );
end;
$$;

revoke all on function public.get_supplier_rfq_for_business(uuid, uuid) from public, anon;
grant execute on function public.get_supplier_rfq_for_business(uuid, uuid) to authenticated;

commit;

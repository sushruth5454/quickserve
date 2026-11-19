-- WP P1b; owns: compare_rfq_quotes, send_supplier_quote_for_business, get_supplier_rfq_for_business, list_my_supplier_rfqs, cancel_rfq, send_supplier_quote; sources: WS3-T03, WS3-T04, WS3-T07, WS3-T09, WS3-T10

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
begin
  perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
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
     order by s.id limit 1;
  end if;
  select * into v_shop from public.shops where id = v_shop_id;
  perform public._assert(found and public._acts_for(v_shop.owner_id, 'staff'), 'shop not found');
  perform public._assert(public._rfq_shop_recipient(p_rfq_id, v_shop.id), 'RFQ not found');
  select * into v_rfq from public.rfqs where id = p_rfq_id;
  perform public._assert(found, 'RFQ not found');
  return jsonb_build_object(
    'id', v_rfq.id, 'category_name', (select c.name from public.product_categories c where c.id = v_rfq.category_id),
    'title', v_rfq.title, 'city', v_rfq.city, 'area', v_rfq.area, 'needs_delivery', v_rfq.needs_delivery,
    'needed_by', v_rfq.needed_by, 'notes', v_rfq.notes, 'status', v_rfq.status, 'expires_at', v_rfq.expires_at,
    'shop_id', v_shop.id, 'business_role', public._business_role(v_shop.owner_id),
    'shop_has_gstin', v_shop.gstin is not null,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'seq', i.seq, 'description', i.description, 'brand_pref', i.brand_pref,
        'specs', i.specs, 'quantity', i.quantity, 'unit', i.unit
      ) order by i.seq)
        from public.rfq_items i where i.rfq_id = v_rfq.id
    ), '[]'::jsonb),
    'my_quote', (
      select jsonb_build_object(
        'id', q.id, 'version', q.version, 'status', q.status, 'delivery_charge_paise', q.delivery_charge_paise,
        'delivery_days', q.delivery_days, 'valid_until', q.valid_until, 'notes', q.notes
      )
        from public.supplier_quotes q
       where q.rfq_id = v_rfq.id and q.shop_id = v_shop.id and q.status = 'sent'
       order by q.version desc limit 1
    )
  );
end;
$$;

create or replace function public.send_supplier_quote_for_business(
  p_rfq_id uuid,
  p_shop_id uuid,
  p_items jsonb,
  p_delivery_charge_paise bigint,
  p_delivery_days int,
  p_valid_until timestamptz,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop public.shops;
  v_rfq public.rfqs;
  v_quote_id uuid;
  v_item jsonb;
  v_rfq_item public.rfq_items;
  v_expected int;
  v_input_count int;
  v_seen int := 0;
  v_version int;
  v_valid_until timestamptz;
  v_price bigint;
  v_gst_rate int;
  v_available boolean;
  v_quantity numeric(12, 3);
  v_line_total bigint;
  v_subtotal numeric := 0;
  v_gst numeric := 0;
begin
  perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
  select * into v_shop from public.shops where id = p_shop_id for update;
  perform public._assert(found and v_shop.status = 'verified', 'verified shop not found');
  perform public._assert(public._acts_for(v_shop.owner_id, 'manager'), 'manager role required to send quotes');
  select * into v_rfq from public.rfqs where id = p_rfq_id for update;
  perform public._assert(found and v_rfq.status = 'open' and v_rfq.expires_at > now(), 'RFQ is closed or expired');
  perform public._assert(public._rfq_shop_recipient(p_rfq_id, v_shop.id), 'shop is not a recipient');
  perform public._assert(p_delivery_charge_paise between 0 and 1000000000000, 'delivery charge is invalid');
  perform public._assert(p_delivery_days is null or p_delivery_days between 0 and 365, 'delivery days must be between 0 and 365');
  perform public._assert(char_length(coalesce(p_notes, '')) <= 2000, 'quote notes are too long');
  perform public._assert(jsonb_typeof(p_items) = 'array', 'quote items must be an array');
  select count(*)::int into v_expected from public.rfq_items where rfq_id = v_rfq.id;
  v_input_count := jsonb_array_length(p_items);
  perform public._assert(v_input_count = v_expected and v_expected > 0, 'a quote must include one line for every RFQ item');
  v_valid_until := least(coalesce(p_valid_until, v_rfq.expires_at), v_rfq.expires_at);
  perform public._assert(v_valid_until > now(), 'quote validity must be in the future');

  update public.supplier_quotes
     set status = 'withdrawn', updated_at = now()
   where rfq_id = v_rfq.id and shop_id = v_shop.id and status = 'sent';
  select coalesce(max(q.version), 0) + 1 into v_version
    from public.supplier_quotes q where q.rfq_id = v_rfq.id and q.shop_id = v_shop.id;
  insert into public.supplier_quotes (
    rfq_id, shop_id, version, status, valid_until, delivery_charge_paise, delivery_days, notes
  ) values (
    v_rfq.id, v_shop.id, v_version, 'sent', v_valid_until, p_delivery_charge_paise,
    p_delivery_days, trim(coalesce(p_notes, ''))
  ) returning id into v_quote_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    perform public._assert(jsonb_typeof(v_item) = 'object', 'each quote item must be an object');
    perform public._assert(jsonb_typeof(v_item -> 'rfq_item_id') = 'string', 'quote line must identify an RFQ item');
    select * into v_rfq_item from public.rfq_items
     where id = (v_item ->> 'rfq_item_id')::uuid and rfq_id = v_rfq.id;
    perform public._assert(found, 'quote line references an item outside this RFQ');
    perform public._assert(not exists (
      select 1 from public.supplier_quote_items qi where qi.quote_id = v_quote_id and qi.rfq_item_id = v_rfq_item.id
    ), 'duplicate RFQ item in quote');
    perform public._assert(char_length(coalesce(v_item ->> 'brand', '')) <= 80, 'quoted brand is too long');
    perform public._assert(char_length(coalesce(v_item ->> 'model', '')) <= 80, 'quoted model is too long');
    perform public._assert(jsonb_typeof(coalesce(v_item -> 'specs', '{}'::jsonb)) = 'object', 'quoted specifications must be an object');
    v_available := coalesce((v_item ->> 'available')::boolean, true);
    v_price := case when v_available then coalesce((v_item ->> 'unit_price_paise')::bigint, -1) else 0 end;
    perform public._assert(v_price between 0 and 1000000000000, 'unit price is invalid');
    v_gst_rate := coalesce((v_item ->> 'gst_rate_bp')::int, case when v_available then -1 else 0 end);
    perform public._assert(v_gst_rate in (0, 500, 1200, 1800, 2800), 'GST rate is invalid');
    perform public._assert(v_gst_rate = 0 or v_shop.gstin is not null, 'Add your GSTIN in My shop before charging GST');
    if v_available then
      perform public._validate_product_specs(v_rfq.category_id, coalesce(v_item -> 'specs', '{}'::jsonb));
    end if;
    v_quantity := coalesce((v_item ->> 'offered_quantity')::numeric, v_rfq_item.quantity);
    perform public._assert(
      v_quantity >= v_rfq_item.quantity and v_quantity <= v_rfq_item.quantity * 2,
      'offered quantity must be at least the requested quantity and at most double it'
    );
    v_line_total := case when v_available then round(v_quantity * v_price)::bigint else 0 end;
    insert into public.supplier_quote_items (
      quote_id, rfq_item_id, brand, model, specs, unit_price_paise, quantity, gst_rate_bp, available, line_total_paise
    ) values (
      v_quote_id, v_rfq_item.id, trim(coalesce(v_item ->> 'brand', '')), trim(coalesce(v_item ->> 'model', '')),
      case when v_available then coalesce(v_item -> 'specs', '{}'::jsonb) else '{}'::jsonb end,
      v_price, v_quantity, v_gst_rate, v_available, v_line_total
    );
    v_seen := v_seen + 1;
    v_subtotal := v_subtotal + v_line_total;
    v_gst := v_gst + case when v_available then round(v_line_total::numeric * v_gst_rate / 10000.0) else 0 end;
  end loop;
  perform public._assert(v_seen = v_expected, 'a quote must include one line for every RFQ item');
  perform public._assert(v_subtotal + v_gst + p_delivery_charge_paise <= 9007199254740991, 'quote total is too large');
  update public.supplier_quotes
     set subtotal_paise = v_subtotal::bigint, gst_paise = v_gst::bigint,
         total_paise = (v_subtotal + v_gst + p_delivery_charge_paise)::bigint, updated_at = now()
   where id = v_quote_id;

  perform public._queue_notification(
    v_rfq.customer_id, 'rfq_quote_received', null, 'A shop sent a quotation',
    left(v_shop.name || ' replied to your product RFQ', 300),
    jsonb_build_object('url', '/rfq/' || v_rfq.id, 'rfq_id', v_rfq.id, 'quote_id', v_quote_id),
    'rfq-quote:' || v_rfq.id::text
  );
  return v_quote_id;
end;
$$;

create or replace function public.send_supplier_quote(
  p_rfq_id uuid,
  p_items jsonb,
  p_delivery_charge_paise bigint,
  p_delivery_days int,
  p_valid_until timestamptz,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_id uuid;
begin
  select s.id into v_shop_id
    from public.shops s
   where s.owner_id = public._require_uid();
  perform public._assert(found, 'verified shop not found');
  return public.send_supplier_quote_for_business(
    p_rfq_id, v_shop_id, p_items, p_delivery_charge_paise, p_delivery_days, p_valid_until, p_notes
  );
end;
$$;

drop function if exists public.compare_rfq_quotes(uuid);
create function public.compare_rfq_quotes(p_rfq_id uuid)
returns table (
  quote_id uuid, shop_id uuid, shop_name text, version int, status text, valid_until timestamptz,
  delivery_charge_paise bigint, delivery_days int, notes text, subtotal_paise bigint, gst_paise bigint,
  total_paise bigint, unavailable_count bigint, complete boolean, arrives_after_needed_by boolean,
  delivery_terms_missing boolean, items jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
  perform public._assert(exists (
    select 1 from public.rfqs r where r.id = p_rfq_id and r.customer_id = v_uid
  ), 'RFQ not found');
  return query
    select q.id, q.shop_id, s.name, q.version, q.status, q.valid_until, q.delivery_charge_paise,
           q.delivery_days, q.notes, q.subtotal_paise, q.gst_paise, q.total_paise,
           (select count(*) from public.supplier_quote_items qi where qi.quote_id = q.id and not qi.available),
           not exists (
             select 1 from public.supplier_quote_items qi where qi.quote_id = q.id and not qi.available
           ),
           q.delivery_days is not null and (q.created_at::date + q.delivery_days) > r.needed_by,
           r.needs_delivery and q.delivery_days is null,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'rfq_item_id', i.id, 'seq', i.seq, 'description', i.description,
               'requested_brand', i.brand_pref, 'requested_specs', i.specs,
               'brand', qi.brand, 'model', qi.model, 'specs', qi.specs, 'quantity', qi.quantity,
               'unit', i.unit, 'unit_price_paise', qi.unit_price_paise, 'gst_rate_bp', qi.gst_rate_bp,
               'available', qi.available, 'line_total_paise', qi.line_total_paise,
               'brand_differs', qi.available and nullif(btrim(i.brand_pref), '') is not null
                 and lower(btrim(i.brand_pref)) is distinct from lower(btrim(qi.brand)),
               'specs_missing', case when qi.available then exists (
                 select 1 from jsonb_each(coalesce(i.specs, '{}'::jsonb)) requested(key, value)
                  where not (coalesce(qi.specs, '{}'::jsonb) ? requested.key)
                     or qi.specs ->> requested.key is null
                     or btrim(qi.specs ->> requested.key) = ''
               ) else false end,
               'missing_spec_keys', case when qi.available then coalesce((
                 select jsonb_agg(requested.key order by requested.key)
                   from jsonb_each(coalesce(i.specs, '{}'::jsonb)) requested(key, value)
                  where not (coalesce(qi.specs, '{}'::jsonb) ? requested.key)
                     or qi.specs ->> requested.key is null
                     or btrim(qi.specs ->> requested.key) = ''
               ), '[]'::jsonb) else '[]'::jsonb end,
               'specs_differ', qi.available and exists (
                 select 1
                   from jsonb_each_text(coalesce(i.specs, '{}'::jsonb)) requested(key, value)
                  where coalesce(qi.specs, '{}'::jsonb) ? requested.key
                    and lower(btrim(qi.specs ->> requested.key)) <> lower(btrim(requested.value))
               ),
               'differing_spec_keys', coalesce((
                 select jsonb_agg(requested.key order by requested.key)
                   from jsonb_each_text(coalesce(i.specs, '{}'::jsonb)) requested(key, value)
                  where qi.available
                    and coalesce(qi.specs, '{}'::jsonb) ? requested.key
                    and lower(btrim(qi.specs ->> requested.key)) <> lower(btrim(requested.value))
               ), '[]'::jsonb),
               'quantity_rounded_up', qi.quantity > i.quantity
             ) order by i.seq)
               from public.supplier_quote_items qi
               join public.rfq_items i on i.id = qi.rfq_item_id
              where qi.quote_id = q.id
           ), '[]'::jsonb)
      from public.supplier_quotes q
      join public.shops s on s.id = q.shop_id
      join public.rfqs r on r.id = q.rfq_id
     where q.rfq_id = p_rfq_id and q.status in ('sent', 'selected', 'rejected', 'expired')
     order by (not exists (
       select 1 from public.supplier_quote_items qi where qi.quote_id = q.id and not qi.available
     )) desc, q.total_paise, q.created_at, q.id;
end;
$$;
revoke all on function public.compare_rfq_quotes(uuid) from public, anon;
grant execute on function public.compare_rfq_quotes(uuid) to authenticated;

create or replace function public.cancel_rfq(p_rfq_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_rfq public.rfqs;
begin
  perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
  select * into v_rfq from public.rfqs where id = p_rfq_id for update;
  perform public._assert(found and v_rfq.customer_id = v_uid, 'RFQ not found');
  perform public._assert(v_rfq.status = 'open', 'RFQ is not open');
  update public.supplier_quotes
     set status = 'rejected', updated_at = now()
   where rfq_id = v_rfq.id and status = 'sent';
  update public.rfqs set status = 'cancelled', updated_at = now() where id = v_rfq.id;
end;
$$;
revoke all on function public.cancel_rfq(uuid) from public, anon;
grant execute on function public.cancel_rfq(uuid) to authenticated;

drop function if exists public.list_my_supplier_rfqs();
create function public.list_my_supplier_rfqs()
returns table (
  shop_id uuid, rfq_id uuid, title text, category_name text, city text, area text,
  needs_delivery boolean, needed_by date, expires_at timestamptz, created_at timestamptz,
  item_count bigint, quote_status text, business_role text, rfq_status text, my_outcome text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
  return query
    select s.id, r.id, r.title, c.name, r.city, r.area, r.needs_delivery, r.needed_by,
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

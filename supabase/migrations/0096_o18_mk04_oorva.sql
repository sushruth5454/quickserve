-- O18-MK04: retain identity-authorized marketplace history when new capabilities are OFF.
-- New-work RPCs and public discovery remain governed by their existing capability checks.
begin;

create or replace function public._product_enquiry_participant(p_enquiry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.product_enquiries e
      join public.shops s on s.id = e.shop_id
     where e.id = p_enquiry_id
       and (e.customer_id = auth.uid() or public._acts_for(s.owner_id, 'staff'))
  );
$$;

create or replace function public._rfq_is_customer(p_rfq_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rfqs r where r.id = p_rfq_id and r.customer_id = auth.uid()
  );
$$;

create or replace function public._rfq_shop_recipient(p_rfq_id uuid, p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.rfq_recipients r
      join public.shops s on s.id = r.shop_id
     where r.rfq_id = p_rfq_id and r.shop_id = p_shop_id
       and public._acts_for(s.owner_id, 'staff')
  );
$$;

create or replace function public._rfq_can_read(p_rfq_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.rfqs r
     where r.id = p_rfq_id
       and (r.customer_id = auth.uid() or exists (
         select 1
           from public.rfq_recipients rr
           join public.shops s on s.id = rr.shop_id
          where rr.rfq_id = r.id and public._acts_for(s.owner_id, 'staff')
       ))
  );
$$;

create or replace function public._rfq_quote_can_read(p_quote_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.supplier_quotes q
      join public.rfqs r on r.id = q.rfq_id
     where q.id = p_quote_id
       and (r.customer_id = auth.uid() or exists (
         select 1 from public.shops s
          where s.id = q.shop_id and public._acts_for(s.owner_id, 'staff')
       ))
  );
$$;

create or replace function public.get_product_enquiry(p_enquiry_id uuid)
returns table (
  id uuid, shop_id uuid, product_id uuid, customer_id uuid, status text,
  shop_name text, product_name text, shop_unread int, customer_unread int, last_message_at timestamptz,
  from_shop_user boolean, business_role text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._product_enquiry_participant(p_enquiry_id), 'enquiry not found');
  return query
    select e.id, e.shop_id, e.product_id, e.customer_id, e.status, s.name, p.name,
           e.shop_unread, e.customer_unread, e.last_message_at,
           public._acts_for(s.owner_id, 'staff'),
           public._business_role(s.owner_id)
      from public.product_enquiries e
      join public.shops s on s.id = e.shop_id
      left join public.products p on p.id = e.product_id
     where e.id = p_enquiry_id;
end;
$$;

create or replace function public.list_product_enquiry_messages(p_enquiry_id uuid)
returns table (id uuid, sender_id uuid, from_shop boolean, body text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._product_enquiry_participant(p_enquiry_id), 'enquiry not found');
  return query select m.id, m.sender_id, m.from_shop, m.body, m.created_at
    from public.product_enquiry_messages m where m.enquiry_id = p_enquiry_id order by m.created_at;
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

create or replace function public.list_shop_product_enquiries()
returns table (
  id uuid, shop_id uuid, product_id uuid, customer_id uuid, shop_name text, product_name text,
  customer_name text, status text, shop_unread int, last_message_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select e.id, e.shop_id, e.product_id, e.customer_id, s.name, p.name, profile.full_name,
           e.status, e.shop_unread, e.last_message_at
      from public.product_enquiries e join public.shops s on s.id = e.shop_id
      join public.profiles profile on profile.id = e.customer_id
      left join public.products p on p.id = e.product_id
     where public._acts_for(s.owner_id, 'staff')
     order by e.last_message_at desc limit 100;
end;
$$;

create or replace function public.mark_enquiry_read(p_enquiry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  e public.product_enquiries;
  v_owner uuid;
begin
  select * into e from public.product_enquiries where id = p_enquiry_id for update;
  perform public._assert(found, 'enquiry not found');
  select s.owner_id into v_owner from public.shops s where s.id = e.shop_id;
  if e.customer_id = v_uid then
    update public.product_enquiries set customer_unread = 0 where id = e.id;
  else
    perform public._assert(public._acts_for(v_owner, 'staff'), 'enquiry not found');
    update public.product_enquiries set shop_unread = 0 where id = e.id;
  end if;
end;
$$;

create or replace function public.get_my_business_shop()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop public.shops;
  v_role text;
  v_categories text[];
begin
  select * into v_shop
    from public.shops s
   where s.owner_id = auth.uid() or public._acts_for(s.owner_id, 'staff')
   order by (s.owner_id = auth.uid()) desc, s.created_at
   limit 1;
  if not found then return null; end if;
  v_role := public._business_role(v_shop.owner_id);
  v_categories := '{}'::text[];
  if public._shops_products_enabled() then
    select coalesce(array_agg(c.slug order by c.sort_order, c.name), '{}'::text[]) into v_categories
      from public.shop_categories sc join public.product_categories c on c.id = sc.category_id
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

create or replace function public.list_my_products()
returns table (
  id uuid, shop_id uuid, category_id uuid, category_slug text, category_name text,
  name text, brand text, model text, description text, specs jsonb, unit text,
  indicative_price_paise int, price_updated_at timestamptz, in_stock boolean, active boolean, image_paths text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_shop_id uuid;
begin
  select s.id into v_shop_id from public.shops s where s.owner_id = v_uid;
  perform public._assert(found, 'shop not found');
  return query
    select p.id, p.shop_id, p.category_id, c.slug, c.name, p.name, p.brand, p.model, p.description, p.specs,
           p.unit, p.indicative_price_paise, p.price_updated_at, p.in_stock, p.active,
           coalesce((select array_agg(i.path order by i.sort_order) from public.product_images i where i.product_id = p.id), '{}'::text[])
      from public.products p join public.product_categories c on c.id = p.category_id
     where p.shop_id = v_shop_id order by p.updated_at desc, p.name;
end;
$$;

create or replace function public.get_rfq(p_rfq_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_rfq public.rfqs;
begin
  select * into v_rfq from public.rfqs where id = p_rfq_id and customer_id = v_uid;
  perform public._assert(found, 'RFQ not found');
  return jsonb_build_object(
    'id', v_rfq.id, 'customer_id', v_rfq.customer_id, 'category_id', v_rfq.category_id,
    'category_name', (select c.name from public.product_categories c where c.id = v_rfq.category_id),
    'title', v_rfq.title, 'city', v_rfq.city, 'area', v_rfq.area, 'lat', v_rfq.lat, 'lng', v_rfq.lng,
    'needs_delivery', v_rfq.needs_delivery, 'needed_by', v_rfq.needed_by, 'notes', v_rfq.notes,
    'status', v_rfq.status, 'expires_at', v_rfq.expires_at, 'created_at', v_rfq.created_at,
    'recipient_count', (select count(*) from public.rfq_recipients r where r.rfq_id = v_rfq.id),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'seq', i.seq, 'description', i.description, 'brand_pref', i.brand_pref,
        'specs', i.specs, 'quantity', i.quantity, 'unit', i.unit
      ) order by i.seq)
        from public.rfq_items i where i.rfq_id = v_rfq.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_my_customer_rfqs()
returns table (
  id uuid,
  title text,
  category_name text,
  city text,
  area text,
  needed_by date,
  expires_at timestamptz,
  created_at timestamptz,
  status text,
  recipient_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  return query
    select r.id, r.title, c.name, r.city, r.area, r.needed_by, r.expires_at, r.created_at, r.status,
           (select count(*)::int from public.rfq_recipients rr where rr.rfq_id = r.id)
      from public.rfqs r
      join public.product_categories c on c.id = r.category_id
     where r.customer_id = v_uid
     order by r.created_at desc;
end;
$$;

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

create or replace function public.list_my_supplier_rfqs()
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

create or replace function public.compare_rfq_quotes(p_rfq_id uuid)
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
  select * into v_rfq from public.rfqs where id = p_rfq_id for update;
  perform public._assert(found and v_rfq.customer_id = v_uid, 'RFQ not found');
  perform public._assert(v_rfq.status = 'open', 'RFQ is not open');
  update public.supplier_quotes
     set status = 'rejected', updated_at = now()
   where rfq_id = v_rfq.id and status = 'sent';
  update public.rfqs set status = 'cancelled', updated_at = now() where id = v_rfq.id;
end;
$$;

create or replace function public.get_my_activity_unread_counts()
returns table (services int, requests int, shop int, sports int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_services int := 0;
  v_requests int := 0;
  v_shop int := 0;
  v_sports int := 0;
begin
  select coalesce(sum(u.unread), 0)::int
    into v_services
    from public.get_unread_counts() u
    join public.bookings b on b.id = u.booking_id
   where u.role = 'customer'
     and b.customer_id = v_uid;

  select v_services + count(*)::int
    into v_services
    from public.notifications n
    join public.bookings b on b.id = n.booking_id
   where n.user_id = v_uid
     and n.read_at is null
     and n.kind <> 'chat_message'
     and b.customer_id = v_uid;

  select count(*)::int
    into v_requests
    from public.notifications n
    join public.service_requests r on r.id::text = (n.data ->> 'request_id')
   where n.user_id = v_uid
     and n.read_at is null
     and n.kind in ('proposal_received', 'request_message')
     and r.customer_id = v_uid;

  select coalesce(sum(e.customer_unread), 0)::int
    into v_shop
    from public.product_enquiries e
   where e.customer_id = v_uid;

  select v_shop + count(*)::int
    into v_shop
    from public.notifications n
    join public.rfqs r on r.id::text = (n.data ->> 'rfq_id')
   where n.user_id = v_uid
     and n.read_at is null
     and n.kind = 'rfq_quote_received'
     and r.customer_id = v_uid;

  if public._feature_enabled('sports') then
    select count(*)::int
      into v_sports
      from public.notifications n
      join public.sports_bookings b on b.id::text = (n.data ->> 'sports_booking_id')
     where n.user_id = v_uid
       and n.read_at is null
       and n.kind in ('sports_booking_accepted', 'sports_booking_declined')
       and b.customer_id = v_uid;
  end if;

  return query select v_services, v_requests, v_shop, v_sports;
end;
$$;

create or replace function public.mark_my_activity_notification_read(p_resource_type text, p_resource_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_count int;
begin
  perform public._assert(p_resource_id is not null, 'activity id is required');

  if p_resource_type = 'booking' then
    perform public._assert(exists (
      select 1 from public.bookings b where b.id = p_resource_id and b.customer_id = v_uid
    ), 'activity not found');
    update public.notifications n
       set read_at = now()
      from public.bookings b
     where b.id = p_resource_id
       and b.customer_id = v_uid
       and n.user_id = v_uid
       and n.booking_id = b.id
       and n.read_at is null
       and n.kind <> 'chat_message';
  elsif p_resource_type = 'request' then
    perform public._assert(exists (
      select 1 from public.service_requests r where r.id = p_resource_id and r.customer_id = v_uid
    ), 'activity not found');
    update public.notifications n
       set read_at = now()
     where n.user_id = v_uid
       and n.read_at is null
       and n.kind in ('proposal_received', 'request_message')
       and n.data ->> 'request_id' = p_resource_id::text;
  elsif p_resource_type = 'rfq' then
    perform public._assert(exists (
      select 1 from public.rfqs r where r.id = p_resource_id and r.customer_id = v_uid
    ), 'activity not found');
    update public.notifications n
       set read_at = now()
     where n.user_id = v_uid
       and n.read_at is null
       and n.kind = 'rfq_quote_received'
       and n.data ->> 'rfq_id' = p_resource_id::text;
  elsif p_resource_type = 'sports_booking' then
    perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
    perform public._assert(exists (
      select 1 from public.sports_bookings b where b.id = p_resource_id and b.customer_id = v_uid
    ), 'activity not found');
    update public.notifications n
       set read_at = now()
     where n.user_id = v_uid
       and n.read_at is null
       and n.kind in ('sports_booking_accepted', 'sports_booking_declined')
       and n.data ->> 'sports_booking_id' = p_resource_id::text;
  else
    perform public._assert(false, 'invalid activity resource type');
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public._product_image_access(p_path text, p_manage boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.shops s
     where s.id::text = split_part(coalesce(p_path, ''), '/', 1)
       and (
         (p_manage and public._shops_products_enabled() and s.owner_id = auth.uid())
         or (not p_manage and s.owner_id = auth.uid())
         or (not p_manage and public._shops_products_enabled() and s.status = 'verified'
             and exists (
               select 1 from public.product_images i
               join public.products p on p.id = i.product_id
               join public.shop_categories sc on sc.shop_id = p.shop_id and sc.category_id = p.category_id
               where i.path = p_path and p.shop_id = s.id and p.active
             ))
       )
  );
$$;
commit;

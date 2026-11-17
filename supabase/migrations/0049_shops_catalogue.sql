-- Phase 7a: verified local shops, searchable catalogues, and customer enquiries.

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values
  ('products', false, 'Products & shops', 'Shop catalogues and product search.', 'Marketplace', 40),
  ('product_enquiries', false, 'Product enquiries', 'Customers message shops about products.', 'Marketplace', 41)
on conflict (key) do nothing;

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 80),
  parent_id uuid references public.product_categories (id) on delete set null,
  icon text not null default 'cube-outline',
  active boolean not null default true,
  sort_order int not null default 100,
  attribute_schema jsonb not null default '{"type":"object","properties":{}}'::jsonb
    check (jsonb_typeof(attribute_schema) = 'object'),
  created_at timestamptz not null default now()
);

insert into public.product_categories (slug, name, icon, sort_order, attribute_schema)
values
  ('tiles', 'Tiles', 'grid-outline', 10,
   '{"type":"object","properties":{"size":{"type":"string","maxLength":40},"finish":{"type":"string","maxLength":40},"material":{"type":"string","maxLength":60}}}'::jsonb),
  ('sanitaryware', 'Sanitaryware', 'water-outline', 20, '{"type":"object","properties":{}}'::jsonb),
  ('electrical', 'Electrical', 'flash-outline', 30, '{"type":"object","properties":{}}'::jsonb),
  ('plumbing', 'Plumbing', 'construct-outline', 40, '{"type":"object","properties":{}}'::jsonb),
  ('hardware', 'Hardware', 'hammer-outline', 50, '{"type":"object","properties":{}}'::jsonb),
  ('paints', 'Paints', 'color-palette-outline', 60, '{"type":"object","properties":{}}'::jsonb),
  ('construction', 'Construction', 'business-outline', 70, '{"type":"object","properties":{}}'::jsonb),
  ('lighting', 'Lighting', 'bulb-outline', 80, '{"type":"object","properties":{}}'::jsonb),
  ('home-improvement', 'Home improvement', 'home-outline', 90, '{"type":"object","properties":{}}'::jsonb),
  ('other', 'Other', 'ellipsis-horizontal-outline', 100, '{"type":"object","properties":{}}'::jsonb)
on conflict (slug) do nothing;

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  description text not null default '' check (char_length(description) <= 1500),
  address_line text not null default '' check (char_length(address_line) <= 220),
  city text not null default '' check (char_length(city) <= 100),
  area text not null default '' check (char_length(area) <= 100),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  delivery_radius_km int not null default 10 check (delivery_radius_km between 1 and 250),
  offers_delivery boolean not null default false,
  offers_pickup boolean not null default true,
  whatsapp_contact boolean not null default false,
  gstin text check (gstin is null or gstin ~ '^[0-9A-Z]{15}$'),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'under_review', 'verified', 'rejected', 'suspended')),
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);
create index shops_status_location_idx on public.shops (status, city, area);

create table public.shop_categories (
  shop_id uuid not null references public.shops (id) on delete cascade,
  category_id uuid not null references public.product_categories (id) on delete restrict,
  primary key (shop_id, category_id)
);
create index shop_categories_category_idx on public.shop_categories (category_id, shop_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  category_id uuid not null references public.product_categories (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 120),
  brand text not null default '' check (char_length(brand) <= 80),
  model text not null default '' check (char_length(model) <= 80),
  description text not null default '' check (char_length(description) <= 2000),
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  unit text not null default 'piece'
    check (unit in ('piece', 'sqft', 'box', 'kg', 'litre', 'bag', 'metre', 'set')),
  indicative_price_paise int check (indicative_price_paise is null or indicative_price_paise >= 0),
  price_updated_at timestamptz,
  in_stock boolean not null default true,
  active boolean not null default true,
  search tsvector not null default ''::tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_shop_category_idx on public.products (shop_id, category_id, active);
create index products_search_gin_idx on public.products using gin (search);
-- Use a trigger-maintained vector for SQL-test compatibility rather than a generated tsvector column.

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  path text not null unique check (char_length(path) between 3 and 240),
  sort_order int not null default 0 check (sort_order between 0 and 5),
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, sort_order);

create table public.product_enquiries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  last_message_at timestamptz not null default now(),
  shop_unread int not null default 0 check (shop_unread >= 0),
  customer_unread int not null default 0 check (customer_unread >= 0),
  created_at timestamptz not null default now()
);
create unique index product_enquiries_one_open_idx
  on public.product_enquiries (shop_id, customer_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'open';
create index product_enquiries_customer_idx on public.product_enquiries (customer_id, last_message_at desc);
create index product_enquiries_shop_idx on public.product_enquiries (shop_id, last_message_at desc);

create table public.product_enquiry_messages (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.product_enquiries (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  from_shop boolean not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index product_enquiry_messages_thread_idx on public.product_enquiry_messages (enquiry_id, created_at);

alter table public.product_categories enable row level security;
alter table public.shops enable row level security;
alter table public.shop_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_enquiries enable row level security;
alter table public.product_enquiry_messages enable row level security;

revoke all on public.product_categories, public.shops, public.shop_categories, public.products,
  public.product_images, public.product_enquiries, public.product_enquiry_messages from anon, authenticated;
grant select on public.product_categories, public.shop_categories, public.products, public.product_images to anon, authenticated;
grant select (id, name, description, address_line, city, area, lat, lng, delivery_radius_km,
              offers_delivery, offers_pickup, whatsapp_contact, status, created_at, updated_at)
  on public.shops to anon, authenticated;
grant select on public.product_enquiries, public.product_enquiry_messages to authenticated;

create or replace function public._shops_products_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public._feature_enabled('products'); $$;

create or replace function public._shops_enquiries_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public._feature_enabled('products') and public._feature_enabled('product_enquiries'); $$;

create or replace function public._shop_is_owner(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.shops s where s.id = p_shop_id and s.owner_id = auth.uid());
$$;

create or replace function public._shop_is_visible(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._shops_products_enabled()
     and exists (select 1 from public.shops s where s.id = p_shop_id and s.status = 'verified');
$$;

create or replace function public._product_enquiry_participant(p_enquiry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._shops_enquiries_enabled() and exists (
    select 1
      from public.product_enquiries e
      join public.shops s on s.id = e.shop_id
     where e.id = p_enquiry_id and (e.customer_id = auth.uid() or s.owner_id = auth.uid())
  );
$$;

create or replace function public._product_image_access(p_path text, p_manage boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._shops_products_enabled() and exists (
    select 1
      from public.shops s
     where s.id::text = split_part(coalesce(p_path, ''), '/', 1)
       and (
         (p_manage and s.owner_id = auth.uid())
         or (not p_manage and s.owner_id = auth.uid())
         or (not p_manage and s.status = 'verified' and public._shops_products_enabled()
             and exists (
               select 1 from public.product_images i
               join public.products p on p.id = i.product_id
               join public.shop_categories sc on sc.shop_id = p.shop_id and sc.category_id = p.category_id
               where i.path = p_path and p.shop_id = s.id and p.active
             ))
       )
  );
$$;

grant execute on function public._shops_products_enabled(), public._shops_enquiries_enabled(),
  public._shop_is_owner(uuid), public._shop_is_visible(uuid), public._product_enquiry_participant(uuid),
  public._product_image_access(text, boolean) to anon, authenticated;
revoke execute on function public._shops_products_enabled(), public._shops_enquiries_enabled(),
  public._shop_is_owner(uuid), public._shop_is_visible(uuid), public._product_enquiry_participant(uuid),
  public._product_image_access(text, boolean) from public;

create policy product_categories_read on public.product_categories for select to anon, authenticated
  using (active and public._shops_products_enabled());
create policy shops_read on public.shops for select to anon, authenticated
  using (public._shops_products_enabled() and (public._shop_is_visible(id) or public._shop_is_owner(id)));
create policy shop_categories_read on public.shop_categories for select to anon, authenticated
  using (public._shops_products_enabled() and (public._shop_is_visible(shop_id) or public._shop_is_owner(shop_id)));
create policy products_read on public.products for select to anon, authenticated
  using (public._shops_products_enabled() and (
    (active and public._shop_is_visible(shop_id) and exists (
      select 1 from public.shop_categories sc where sc.shop_id = products.shop_id and sc.category_id = products.category_id
    ))
    or public._shop_is_owner(shop_id)
  ));
create policy product_images_read on public.product_images for select to authenticated
  using (public._shops_products_enabled() and exists (
    select 1 from public.products p
    where p.id = product_id and (public._shop_is_visible(p.shop_id) or public._shop_is_owner(p.shop_id))
  ));
create policy product_enquiries_read on public.product_enquiries for select to authenticated
  using (public._shops_enquiries_enabled() and public._product_enquiry_participant(id));
create policy product_enquiry_messages_read on public.product_enquiry_messages for select to authenticated
  using (public._shops_enquiries_enabled() and public._product_enquiry_participant(enquiry_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists product_images_bucket_read on storage.objects;
drop policy if exists product_images_bucket_insert on storage.objects;
drop policy if exists product_images_bucket_delete on storage.objects;
create policy product_images_bucket_read on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and public._product_image_access(name, false));
create policy product_images_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public._product_image_access(name, true));
create policy product_images_bucket_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public._product_image_access(name, true));

create or replace function public.list_product_categories()
returns table (id uuid, slug text, name text, icon text, sort_order int, attribute_schema jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  return query
    select c.id, c.slug, c.name, c.icon, c.sort_order, c.attribute_schema
      from public.product_categories c
     where c.active
     order by c.sort_order, c.name;
end;
$$;

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
  v_old_slugs text[];
  v_changed boolean;
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
    select coalesce(array_agg(c.slug order by c.slug), '{}'::text[]) into v_old_slugs
      from public.shop_categories sc join public.product_categories c on c.id = sc.category_id
     where sc.shop_id = v_id;
    v_changed :=
      v_shop.name is distinct from trim(p_name)
      or v_shop.description is distinct from trim(coalesce(p_description, ''))
      or v_shop.address_line is distinct from trim(coalesce(p_address_line, ''))
      or v_shop.city is distinct from trim(p_city)
      or v_shop.area is distinct from trim(coalesce(p_area, ''))
      or v_shop.lat is distinct from p_lat
      or v_shop.lng is distinct from p_lng
      or v_shop.delivery_radius_km is distinct from coalesce(p_delivery_radius_km, 10)
      or v_shop.offers_delivery is distinct from coalesce(p_offers_delivery, false)
      or v_shop.offers_pickup is distinct from coalesce(p_offers_pickup, true)
      or v_shop.whatsapp_contact is distinct from coalesce(p_whatsapp_contact, false)
      or v_shop.gstin is distinct from v_gstin
      or v_old_slugs is distinct from v_slugs;
    update public.shops
       set name = trim(p_name), description = trim(coalesce(p_description, '')),
           address_line = trim(coalesce(p_address_line, '')), city = trim(p_city), area = trim(coalesce(p_area, '')),
           lat = p_lat, lng = p_lng, delivery_radius_km = coalesce(p_delivery_radius_km, 10),
           offers_delivery = coalesce(p_offers_delivery, false), offers_pickup = coalesce(p_offers_pickup, true),
           whatsapp_contact = coalesce(p_whatsapp_contact, false), gstin = v_gstin,
           status = case when v_changed and status <> 'suspended' then 'draft' else status end,
           status_reason = case when v_changed and status <> 'suspended' then null else status_reason end, updated_at = now()
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

create or replace function public.get_my_shop()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_shop public.shops;
  v_categories text[];
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  select * into v_shop from public.shops where owner_id = v_uid;
  if not found then return null; end if;
  select coalesce(array_agg(c.slug order by c.sort_order, c.name), '{}'::text[]) into v_categories
    from public.shop_categories sc join public.product_categories c on c.id = sc.category_id
   where sc.shop_id = v_shop.id and c.active;
  return jsonb_build_object(
    'id', v_shop.id, 'name', v_shop.name, 'description', v_shop.description, 'address_line', v_shop.address_line,
    'city', v_shop.city, 'area', v_shop.area, 'lat', v_shop.lat, 'lng', v_shop.lng,
    'delivery_radius_km', v_shop.delivery_radius_km, 'offers_delivery', v_shop.offers_delivery,
    'offers_pickup', v_shop.offers_pickup, 'whatsapp_contact', v_shop.whatsapp_contact,
    'gstin', v_shop.gstin, 'status', v_shop.status, 'status_reason', v_shop.status_reason,
    'category_slugs', to_jsonb(v_categories)
  );
end;
$$;

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
  select * into s from public.shops where id = p_shop_id and owner_id = v_uid for update;
  perform public._assert(found, 'shop not found');
  perform public._assert(s.status <> 'suspended', 'suspended shops cannot be submitted');
  perform public._assert(char_length(trim(s.name)) >= 2 and char_length(trim(s.address_line)) >= 5
    and char_length(trim(s.city)) >= 2 and char_length(trim(s.area)) >= 2
    and s.lat is not null and s.lng is not null, 'complete the shop address and map location before submitting');
  perform public._assert(exists (select 1 from public.shop_categories sc where sc.shop_id = s.id), 'choose at least one product category');
  update public.shops set status = 'submitted', status_reason = null, updated_at = now() where id = s.id;
end;
$$;

create or replace function public.admin_list_shops(p_status text default 'all')
returns table (
  id uuid, name text, description text, address_line text, city text, area text,
  lat double precision, lng double precision, gstin text, status text, status_reason text, owner_name text,
  category_slugs text[], created_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(coalesce(p_status, 'all') in ('all', 'draft', 'submitted', 'under_review', 'verified', 'rejected', 'suspended'), 'invalid shop status');
  return query
    select s.id, s.name, s.description, s.address_line, s.city, s.area, s.lat, s.lng, s.gstin,
           s.status, s.status_reason, p.full_name,
           coalesce(array_agg(c.slug order by c.slug) filter (where c.slug is not null), '{}'::text[]),
           s.created_at, s.updated_at
      from public.shops s
      join public.profiles p on p.id = s.owner_id
      left join public.shop_categories sc on sc.shop_id = s.id
      left join public.product_categories c on c.id = sc.category_id
     where coalesce(p_status, 'all') = 'all' or s.status = p_status
     group by s.id, p.full_name
     order by case when s.status in ('submitted', 'under_review') then 0 else 1 end, s.updated_at desc
     limit 300;
end;
$$;

create or replace function public.admin_set_shop_status(p_shop_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  s public.shops;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(coalesce(p_status in ('under_review', 'verified', 'rejected', 'suspended'), false), 'invalid shop status');
  perform public._assert(v_reason is null or char_length(v_reason) <= 500, 'status reason is too long');
  select * into s from public.shops where id = p_shop_id for update;
  perform public._assert(found, 'shop not found');
  if p_status = 'verified' then
    perform public._assert(char_length(trim(s.name)) >= 2 and char_length(trim(s.address_line)) >= 5
      and char_length(trim(s.city)) >= 2 and char_length(trim(s.area)) >= 2
      and s.lat is not null and s.lng is not null
      and exists (select 1 from public.shop_categories sc where sc.shop_id = s.id), 'shop profile is incomplete');
  end if;
  update public.shops
     set status = p_status, status_reason = case when p_status in ('rejected', 'suspended') then v_reason else null end,
         updated_at = now()
   where id = s.id;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_shop_status', s.id, jsonb_build_object('status', p_status, 'reason', v_reason));
end;
$$;

create or replace function public.admin_list_product_categories()
returns table (id uuid, slug text, name text, active boolean, sort_order int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return query select c.id, c.slug, c.name, c.active, c.sort_order
    from public.product_categories c order by c.sort_order, c.name;
end;
$$;

create or replace function public.admin_set_product_category_active(p_category_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._is_admin(), 'admin only');
  update public.product_categories set active = p_active where id = p_category_id;
  perform public._assert(found, 'product category not found');
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_product_category_active', p_category_id, jsonb_build_object('active', p_active));
end;
$$;

create or replace function public.admin_shop_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return jsonb_build_object(
    'shops', (select count(*) from public.shops),
    'verified_shops', (select count(*) from public.shops where status = 'verified'),
    'products', (select count(*) from public.products where active),
    'open_enquiries', (select count(*) from public.product_enquiries where status = 'open')
  );
end;
$$;

create or replace function public._validate_product_specs(p_category_id uuid, p_specs jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_schema jsonb;
  v_properties jsonb;
  v_key text;
  v_value jsonb;
  v_field jsonb;
  v_type text;
begin
  perform public._assert(jsonb_typeof(coalesce(p_specs, '{}'::jsonb)) = 'object', 'product specifications must be an object');
  select c.attribute_schema into v_schema from public.product_categories c where c.id = p_category_id;
  perform public._assert(found, 'product category not found');
  v_properties := coalesce(v_schema -> 'properties', '{}'::jsonb);
  for v_key, v_value in select key, value from jsonb_each(coalesce(p_specs, '{}'::jsonb)) loop
    v_field := v_properties -> v_key;
    perform public._assert(v_field is not null, 'unsupported product specification: ' || v_key);
    v_type := v_field ->> 'type';
    perform public._assert(
      v_type is null
      or (v_type = 'string' and jsonb_typeof(v_value) = 'string')
      or (v_type = 'number' and jsonb_typeof(v_value) = 'number')
      or (v_type = 'integer' and jsonb_typeof(v_value) = 'number' and (v_value #>> '{}') ~ '^-?[0-9]+$')
      or (v_type = 'boolean' and jsonb_typeof(v_value) = 'boolean')
      or (v_type = 'array' and jsonb_typeof(v_value) = 'array'),
      'invalid value type for product specification: ' || v_key
    );
    if v_field ? 'enum' then
      perform public._assert(v_field -> 'enum' @> jsonb_build_array(v_value), 'unsupported value for product specification: ' || v_key);
    end if;
    if v_type = 'string' and v_field ? 'maxLength' then
      perform public._assert(char_length(v_value #>> '{}') <= (v_field ->> 'maxLength')::int, 'product specification is too long: ' || v_key);
    end if;
  end loop;
  if jsonb_typeof(v_schema -> 'required') = 'array' then
    for v_key in select jsonb_array_elements_text(v_schema -> 'required') loop
      perform public._assert(coalesce(p_specs, '{}'::jsonb) ? v_key, 'missing product specification: ' || v_key);
    end loop;
  end if;
end;
$$;

create or replace function public._refresh_product_search()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.search := to_tsvector('simple', concat_ws(' ', coalesce(new.name, ''), coalesce(new.brand, ''), coalesce(new.model, '')));
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
create trigger products_refresh_search
  before insert or update on public.products
  for each row execute function public._refresh_product_search();

create or replace function public.save_product(
  p_product_id uuid, p_category_id uuid, p_name text, p_brand text, p_model text,
  p_description text, p_specs jsonb, p_unit text, p_indicative_price_paise int,
  p_in_stock boolean, p_active boolean, p_image_paths text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_shop public.shops;
  v_product public.products;
  v_product_id uuid := p_product_id;
  v_paths text[] := coalesce(p_image_paths, '{}'::text[]);
  v_path text;
  v_index int := 0;
  v_category_active boolean;
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  select * into v_shop from public.shops where owner_id = v_uid for update;
  perform public._assert(found, 'shop not found');
  perform public._assert(v_shop.status <> 'suspended', 'suspended shops cannot edit products');
  perform public._assert(cardinality(v_paths) <= 6, 'a product can have at most 6 images');
  perform public._assert(cardinality(v_paths) = cardinality(array(select distinct x from unnest(v_paths) x)), 'duplicate product image paths');
  select active into v_category_active from public.product_categories where id = p_category_id;
  perform public._assert(found, 'product category is unavailable');
  perform public._assert(v_category_active or (p_product_id is not null and exists (
    select 1 from public.products p where p.id = p_product_id and p.shop_id = v_shop.id and p.category_id = p_category_id
  )), 'product category is unavailable');
  if v_category_active then
    perform public._assert(exists (
      select 1 from public.shop_categories sc where sc.shop_id = v_shop.id and sc.category_id = p_category_id
    ), 'product category is not selected for this shop');
  end if;
  perform public._validate_product_specs(p_category_id, coalesce(p_specs, '{}'::jsonb));
  perform public._assert(char_length(trim(coalesce(p_name, ''))) between 2 and 120, 'product name must be 2 to 120 characters');
  perform public._assert(char_length(coalesce(p_brand, '')) <= 80 and char_length(coalesce(p_model, '')) <= 80, 'product brand or model is too long');
  perform public._assert(char_length(coalesce(p_description, '')) <= 2000, 'product description is too long');
  perform public._assert(coalesce(p_unit in ('piece', 'sqft', 'box', 'kg', 'litre', 'bag', 'metre', 'set'), false), 'invalid product unit');
  perform public._assert(p_indicative_price_paise is null or p_indicative_price_paise >= 0, 'indicative price cannot be negative');
  perform public._assert(p_product_id is null or exists (
    select 1 from public.products p where p.id = p_product_id and p.shop_id = v_shop.id
  ), 'product not found');
  if p_product_id is null then
    perform public._assert((select count(*) from public.products p where p.shop_id = v_shop.id) < 500, 'a shop can have at most 500 products');
  else
    select * into v_product from public.products p where p.id = p_product_id and p.shop_id = v_shop.id for update;
  end if;
  foreach v_path in array v_paths loop
    perform public._assert(
      left(v_path, char_length(v_shop.id::text) + 1) = v_shop.id::text || '/'
      and v_path !~ '//'
      and exists (select 1 from storage.objects o where o.bucket_id = 'product-images' and o.name = v_path),
      'product image must be uploaded to this shop first'
    );
    perform public._assert(not exists (
      select 1 from public.product_images i where i.path = v_path and i.product_id <> coalesce(v_product_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ), 'product image is already used by another product');
  end loop;

  if p_product_id is null then
    insert into public.products (
      shop_id, category_id, name, brand, model, description, specs, unit,
      indicative_price_paise, in_stock, active
    ) values (
      v_shop.id, p_category_id, trim(p_name), trim(coalesce(p_brand, '')), trim(coalesce(p_model, '')),
      trim(coalesce(p_description, '')), coalesce(p_specs, '{}'::jsonb), p_unit,
      p_indicative_price_paise, coalesce(p_in_stock, true), coalesce(p_active, true)
    ) returning id into v_product_id;
  else
    update public.products
       set category_id = p_category_id, name = trim(p_name), brand = trim(coalesce(p_brand, '')),
           model = trim(coalesce(p_model, '')), description = trim(coalesce(p_description, '')),
           specs = coalesce(p_specs, '{}'::jsonb), unit = p_unit,
           indicative_price_paise = p_indicative_price_paise, in_stock = coalesce(p_in_stock, true),
           active = coalesce(p_active, true)
     where id = p_product_id and shop_id = v_shop.id;
  end if;

  delete from public.product_images i
   where i.product_id = v_product_id and not (i.path = any(v_paths));
  foreach v_path in array v_paths loop
    v_index := v_index + 1;
    insert into public.product_images (product_id, path, sort_order)
    values (v_product_id, v_path, v_index - 1)
    on conflict (path) do update set product_id = excluded.product_id, sort_order = excluded.sort_order;
  end loop;
  return v_product_id;
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
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
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
  update public.products set active = false where id = p_product_id and shop_id = v_shop_id;
  perform public._assert(found, 'product not found');
  delete from public.product_images i where i.product_id = p_product_id;
  return v_paths;
end;
$$;

create or replace function public.search_products(
  p_query text default null, p_category_slug text default null, p_lat double precision default null,
  p_lng double precision default null, p_radius_km int default 15, p_max_price_paise int default null,
  p_in_stock_only boolean default false, p_limit int default 30
)
returns table (
  id uuid, shop_id uuid, category_id uuid, category_slug text, category_name text,
  name text, brand text, model text, description text, specs jsonb, unit text,
  indicative_price_paise int, price_updated_at timestamptz, in_stock boolean,
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
    v_query := websearch_to_tsquery('simple', trim(p_query));
  end if;
  return query
    with candidates as (
      select p.id, p.shop_id, p.category_id, c.slug as category_slug, c.name as category_name,
             p.name, p.brand, p.model, p.description, p.specs, p.unit, p.indicative_price_paise,
             p.price_updated_at, p.in_stock,
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
           c.description, c.specs, c.unit, c.indicative_price_paise, c.price_updated_at, c.in_stock,
           c.image_paths, c.shop_name, c.city, c.area, c.distance_km
      from candidates c
     where p_lat is null or (c.distance_km is not null and c.distance_km <= coalesce(p_radius_km, 15))
     order by c.distance_km nulls last, c.relevance desc, c.name
     limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

create or replace function public.search_shops(
  p_lat double precision default null, p_lng double precision default null,
  p_radius_km int default 15, p_limit int default 30
)
returns table (
  id uuid, name text, description text, city text, area text,
  offers_delivery boolean, offers_pickup boolean, distance_km double precision, category_slugs text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  perform public._assert(coalesce((p_lat is null and p_lng is null) or (p_lat between -90 and 90 and p_lng between -180 and 180), false), 'invalid search coordinates');
  perform public._assert(p_radius_km is null or p_radius_km between 1 and 250, 'search radius must be 1 to 250 km');
  return query
    with nearby as (
      select s.id, s.name, s.description, s.city, s.area, s.offers_delivery, s.offers_pickup,
             case when p_lat is null then null::double precision else
               6371.0 * 2 * asin(sqrt(least(1.0, greatest(0.0,
                 power(sin(radians(s.lat - p_lat) / 2), 2)
                 + cos(radians(p_lat)) * cos(radians(s.lat))
                 * power(sin(radians(s.lng - p_lng) / 2), 2)
               ))))
             end as distance_km
        from public.shops s
       where s.status = 'verified'
    )
    select n.id, n.name, n.description, n.city, n.area, n.offers_delivery, n.offers_pickup, n.distance_km,
           coalesce((select array_agg(c.slug order by c.sort_order, c.name)
             from public.shop_categories sc join public.product_categories c on c.id = sc.category_id
            where sc.shop_id = n.id and c.active), '{}'::text[])
      from nearby n
     where p_lat is null or (n.distance_km is not null and n.distance_km <= coalesce(p_radius_km, 15))
     order by n.distance_km nulls last, n.name
     limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

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
    select s.id, s.name, s.description, s.address_line, s.city, s.area, s.lat, s.lng, s.delivery_radius_km,
           s.offers_delivery, s.offers_pickup, s.whatsapp_contact,
           coalesce((select array_agg(c.slug order by c.sort_order, c.name)
             from public.shop_categories sc join public.product_categories c on c.id = sc.category_id
            where sc.shop_id = s.id and c.active), '{}'::text[])
      from public.shops s where s.id = p_id and s.status = 'verified';
end;
$$;

create or replace function public.list_shop_products(p_shop_id uuid)
returns table (
  id uuid, shop_id uuid, category_id uuid, category_slug text, category_name text,
  name text, brand text, model text, description text, specs jsonb, unit text,
  indicative_price_paise int, price_updated_at timestamptz, in_stock boolean, image_paths text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  return query
    select p.id, p.shop_id, p.category_id, c.slug, c.name, p.name, p.brand, p.model, p.description, p.specs,
           p.unit, p.indicative_price_paise, p.price_updated_at, p.in_stock,
           coalesce((select array_agg(i.path order by i.sort_order) from public.product_images i where i.product_id = p.id), '{}'::text[])
      from public.products p
      join public.product_categories c on c.id = p.category_id and c.active
      join public.shops s on s.id = p.shop_id and s.status = 'verified'
      join public.shop_categories sc on sc.shop_id = p.shop_id and sc.category_id = p.category_id
     where p.shop_id = p_shop_id and p.active
     order by p.name;
end;
$$;

create or replace function public.get_product(p_id uuid)
returns table (
  id uuid, shop_id uuid, category_id uuid, category_slug text, category_name text, name text, brand text, model text,
  description text, specs jsonb, unit text, indicative_price_paise int, price_updated_at timestamptz,
  in_stock boolean, shop_name text, city text, area text, image_paths text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  return query
    select p.id, p.shop_id, p.category_id, c.slug, c.name, p.name, p.brand, p.model, p.description, p.specs, p.unit,
           p.indicative_price_paise, p.price_updated_at, p.in_stock, s.name, s.city, s.area,
           coalesce((select array_agg(i.path order by i.sort_order) from public.product_images i where i.product_id = p.id), '{}'::text[])
      from public.products p
      join public.product_categories c on c.id = p.category_id and c.active
      join public.shops s on s.id = p.shop_id and s.status = 'verified'
      join public.shop_categories sc on sc.shop_id = p.shop_id and sc.category_id = p.category_id
     where p.id = p_id and p.active;
end;
$$;

create or replace function public._product_enquiry_post(
  p_enquiry_id uuid, p_sender_id uuid, p_from_shop boolean, p_body text, p_initial boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := trim(coalesce(p_body, ''));
  e public.product_enquiries;
  v_created boolean := false;
  s public.shops;
begin
  perform public._assert(char_length(v_body) between 1 and 2000, 'message must be 1 to 2000 characters');
  select * into e from public.product_enquiries where id = p_enquiry_id for update;
  perform public._assert(found and e.status = 'open', 'enquiry is closed or unavailable');
  select * into s from public.shops where id = e.shop_id;
  insert into public.product_enquiry_messages (enquiry_id, sender_id, from_shop, body)
  values (e.id, p_sender_id, p_from_shop, v_body);
  update public.product_enquiries
     set last_message_at = now(),
         shop_unread = case when p_from_shop then 0 else shop_unread + 1 end,
         customer_unread = case when p_from_shop then customer_unread + 1 else 0 end
   where id = e.id;
  if p_from_shop then
    perform public._queue_notification(
      e.customer_id, case when p_initial then 'product_enquiry' else 'product_enquiry_reply' end,
      null, s.name || ' replied about a product', left(v_body, 300),
      jsonb_build_object('url', '/enquiry/' || e.id, 'enquiry_id', e.id, 'shop_id', s.id),
      case when p_initial then 'product-enquiry:' else 'product-enquiry-reply:' end || e.id::text
    );
  else
    perform public._queue_notification(
      s.owner_id, case when p_initial then 'product_enquiry' else 'product_enquiry_reply' end,
      null, case when p_initial then 'New product enquiry' else 'Customer replied' end,
      left(v_body, 300),
      jsonb_build_object('url', '/enquiry/' || e.id, 'enquiry_id', e.id, 'shop_id', s.id),
      case when p_initial then 'product-enquiry:' else 'product-enquiry-reply:' end || e.id::text
    );
  end if;
end;
$$;

create or replace function public.start_product_enquiry(p_shop_id uuid, p_product_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  s public.shops;
  e public.product_enquiries;
  v_created boolean := false;
begin
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
  select * into s from public.shops where id = p_shop_id and status = 'verified' for update;
  perform public._assert(found, 'verified shop not found');
  perform public._assert(s.owner_id <> v_uid, 'you cannot enquire with your own shop');
  if p_product_id is not null then
    perform public._assert(exists (
      select 1 from public.products p where p.id = p_product_id and p.shop_id = s.id and p.active
    ), 'product not found');
  end if;
  select * into e from public.product_enquiries x
   where x.shop_id = s.id and x.customer_id = v_uid and x.product_id is not distinct from p_product_id and x.status = 'open'
   order by x.last_message_at desc limit 1 for update;
  if not found then
    insert into public.product_enquiries (shop_id, product_id, customer_id) values (s.id, p_product_id, v_uid)
    returning * into e;
    v_created := true;
  end if;
  perform public._product_enquiry_post(e.id, v_uid, false, p_body, v_created);
  return e.id;
end;
$$;

create or replace function public.send_enquiry_message(p_enquiry_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  e public.product_enquiries;
  s public.shops;
  v_from_shop boolean;
begin
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
  select * into e from public.product_enquiries where id = p_enquiry_id for update;
  perform public._assert(found, 'enquiry not found');
  select * into s from public.shops where id = e.shop_id;
  v_from_shop := s.owner_id = v_uid;
  perform public._assert(v_from_shop or e.customer_id = v_uid, 'enquiry not found');
  perform public._product_enquiry_post(e.id, v_uid, v_from_shop, p_body, false);
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
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
  select * into e from public.product_enquiries where id = p_enquiry_id for update;
  perform public._assert(found, 'enquiry not found');
  select s.owner_id into v_owner from public.shops s where s.id = e.shop_id;
  if e.customer_id = v_uid then
    update public.product_enquiries set customer_unread = 0 where id = e.id;
  else
    perform public._assert(v_owner = v_uid, 'enquiry not found');
    update public.product_enquiries set shop_unread = 0 where id = e.id;
  end if;
end;
$$;

create or replace function public.set_product_enquiry_status(p_enquiry_id uuid, p_status text)
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
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
  perform public._assert(coalesce(p_status in ('open', 'closed'), false), 'invalid enquiry status');
  select * into e from public.product_enquiries where id = p_enquiry_id for update;
  perform public._assert(found, 'enquiry not found');
  select s.owner_id into v_owner from public.shops s where s.id = e.shop_id;
  perform public._assert(e.customer_id = v_uid or v_owner = v_uid, 'enquiry not found');
  update public.product_enquiries set status = p_status where id = e.id;
end;
$$;

create or replace function public.get_product_enquiry(p_enquiry_id uuid)
returns table (
  id uuid, shop_id uuid, product_id uuid, customer_id uuid, status text,
  shop_name text, product_name text, shop_unread int, customer_unread int, last_message_at timestamptz, from_shop_user boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
  perform public._assert(public._product_enquiry_participant(p_enquiry_id), 'enquiry not found');
  return query
    select e.id, e.shop_id, e.product_id, e.customer_id, e.status, s.name, p.name,
           e.shop_unread, e.customer_unread, e.last_message_at, s.owner_id = v_uid
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
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
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
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
  return query
    select e.id, e.shop_id, e.product_id, s.name, p.name, e.status, e.customer_unread, e.last_message_at
      from public.product_enquiries e join public.shops s on s.id = e.shop_id
      left join public.products p on p.id = e.product_id
     where e.customer_id = v_uid order by e.last_message_at desc limit 100;
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
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
  return query
    select e.id, e.shop_id, e.product_id, e.customer_id, s.name, p.name, profile.full_name,
           e.status, e.shop_unread, e.last_message_at
      from public.product_enquiries e join public.shops s on s.id = e.shop_id
      join public.profiles profile on profile.id = e.customer_id
      left join public.products p on p.id = e.product_id
     where s.owner_id = v_uid order by e.last_message_at desc limit 100;
end;
$$;

do $$
declare
  v_constraint oid;
  v_definition text;
  v_expression text;
begin
  select oid into v_constraint from pg_constraint
   where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check' and contype = 'c';
  if v_constraint is not null then
    v_definition := pg_get_constraintdef(v_constraint);
    v_expression := substring(v_definition from 8 for char_length(v_definition) - 8);
    alter table public.notifications drop constraint notifications_kind_check;
    execute format(
      'alter table public.notifications add constraint notifications_kind_check check ((%s) or kind in (''product_enquiry'', ''product_enquiry_reply''))',
      v_expression
    );
  else
    alter table public.notifications add constraint notifications_kind_check
      check (kind is not null);
  end if;
end;
$$;

revoke execute on function public._validate_product_specs(uuid, jsonb),
  public._product_enquiry_post(uuid, uuid, boolean, text, boolean),
  public._refresh_product_search() from public, anon, authenticated;
revoke execute on function
  public.list_product_categories(), public.save_shop(text, text, text, text, text, double precision, double precision, int, boolean, boolean, boolean, text, text[]),
  public.get_my_shop(), public.submit_shop(uuid), public.admin_list_shops(text), public.admin_set_shop_status(uuid, text, text),
  public.admin_list_product_categories(), public.admin_set_product_category_active(uuid, boolean), public.admin_shop_dashboard(),
  public.save_product(uuid, uuid, text, text, text, text, jsonb, text, int, boolean, boolean, text[]),
  public.list_my_products(), public.delete_product(uuid),
  public.search_products(text, text, double precision, double precision, int, int, boolean, int),
  public.search_shops(double precision, double precision, int, int), public.get_shop(uuid), public.list_shop_products(uuid), public.get_product(uuid),
  public.start_product_enquiry(uuid, uuid, text), public.send_enquiry_message(uuid, text), public.mark_enquiry_read(uuid),
  public.set_product_enquiry_status(uuid, text), public.get_product_enquiry(uuid), public.list_product_enquiry_messages(uuid),
  public.list_my_product_enquiries(), public.list_shop_product_enquiries()
from public, anon;
grant execute on function
  public.list_product_categories(), public.save_shop(text, text, text, text, text, double precision, double precision, int, boolean, boolean, boolean, text, text[]),
  public.get_my_shop(), public.submit_shop(uuid), public.admin_list_shops(text), public.admin_set_shop_status(uuid, text, text),
  public.admin_list_product_categories(), public.admin_set_product_category_active(uuid, boolean), public.admin_shop_dashboard(),
  public.save_product(uuid, uuid, text, text, text, text, jsonb, text, int, boolean, boolean, text[]),
  public.list_my_products(), public.delete_product(uuid),
  public.search_products(text, text, double precision, double precision, int, int, boolean, int),
  public.search_shops(double precision, double precision, int, int), public.get_shop(uuid), public.list_shop_products(uuid), public.get_product(uuid),
  public.start_product_enquiry(uuid, uuid, text), public.send_enquiry_message(uuid, text), public.mark_enquiry_read(uuid),
  public.set_product_enquiry_status(uuid, text), public.get_product_enquiry(uuid), public.list_product_enquiry_messages(uuid),
  public.list_my_product_enquiries(), public.list_shop_product_enquiries()
to authenticated;
grant execute on function public.list_product_categories(),
  public.search_products(text, text, double precision, double precision, int, int, boolean, int),
  public.search_shops(double precision, double precision, int, int), public.get_shop(uuid),
  public.list_shop_products(uuid), public.get_product(uuid)
to anon;

-- Phase 7b: multi-shop product requests for quotation and supplier comparison.

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values ('product_rfq', false, 'Bulk quotations (RFQ)', 'Customers request quotes from several shops.', 'Marketplace', 42)
on conflict (key) do nothing;

create table public.rfqs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid not null references public.product_categories (id) on delete restrict,
  title text not null check (char_length(title) between 3 and 120),
  city text not null check (char_length(city) between 2 and 100),
  area text not null check (char_length(area) between 2 and 100),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  needs_delivery boolean not null default false,
  needed_by date not null,
  notes text not null default '' check (char_length(notes) <= 2000),
  status text not null default 'open' check (status in ('open', 'closed', 'expired', 'cancelled')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rfqs_customer_created_idx on public.rfqs (customer_id, created_at desc);
create index rfqs_open_expiry_idx on public.rfqs (expires_at) where status = 'open';

create table public.rfq_items (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.rfqs (id) on delete cascade,
  seq int not null check (seq between 1 and 20),
  description text not null check (char_length(description) between 2 and 500),
  brand_pref text not null default '' check (char_length(brand_pref) <= 80),
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  quantity numeric(12, 3) not null check (quantity > 0 and quantity <= 1000000),
  unit text not null check (unit in ('piece', 'sqft', 'box', 'kg', 'litre', 'bag', 'metre', 'set')),
  created_at timestamptz not null default now(),
  unique (rfq_id, seq)
);
create index rfq_items_rfq_idx on public.rfq_items (rfq_id, seq);

create table public.rfq_recipients (
  rfq_id uuid not null references public.rfqs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  routed_at timestamptz not null default now(),
  primary key (rfq_id, shop_id)
);
create index rfq_recipients_shop_idx on public.rfq_recipients (shop_id, routed_at desc);

create table public.supplier_quotes (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.rfqs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  version int not null check (version > 0),
  status text not null default 'sent' check (status in ('sent', 'withdrawn', 'selected', 'rejected', 'expired')),
  valid_until timestamptz not null,
  delivery_charge_paise bigint not null default 0 check (delivery_charge_paise >= 0),
  delivery_days int check (delivery_days is null or delivery_days between 0 and 365),
  notes text not null default '' check (char_length(notes) <= 2000),
  subtotal_paise bigint not null default 0 check (subtotal_paise >= 0),
  gst_paise bigint not null default 0 check (gst_paise >= 0),
  total_paise bigint not null default 0 check (total_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rfq_id, shop_id, version)
);
create unique index supplier_quotes_one_sent_idx on public.supplier_quotes (rfq_id, shop_id) where status = 'sent';
create unique index supplier_quotes_one_selected_idx on public.supplier_quotes (rfq_id) where status = 'selected';
create index supplier_quotes_rfq_idx on public.supplier_quotes (rfq_id, status, total_paise);

create table public.supplier_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.supplier_quotes (id) on delete cascade,
  rfq_item_id uuid not null references public.rfq_items (id) on delete cascade,
  brand text not null default '' check (char_length(brand) <= 80),
  model text not null default '' check (char_length(model) <= 80),
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  quantity numeric(12, 3) not null check (quantity > 0),
  gst_rate_bp int not null check (gst_rate_bp in (0, 500, 1200, 1800, 2800)),
  available boolean not null default true,
  line_total_paise bigint not null check (line_total_paise >= 0),
  created_at timestamptz not null default now(),
  unique (quote_id, rfq_item_id)
);
create index supplier_quote_items_quote_idx on public.supplier_quote_items (quote_id);

alter table public.rfqs enable row level security;
alter table public.rfq_items enable row level security;
alter table public.rfq_recipients enable row level security;
alter table public.supplier_quotes enable row level security;
alter table public.supplier_quote_items enable row level security;

revoke all on public.rfqs, public.rfq_items, public.rfq_recipients, public.supplier_quotes,
  public.supplier_quote_items from anon, authenticated;
grant select (id, category_id, title, city, area, needs_delivery, needed_by,
              notes, status, expires_at, created_at, updated_at) on public.rfqs to authenticated;
grant select on public.rfq_items, public.rfq_recipients, public.supplier_quotes, public.supplier_quote_items to authenticated;

create or replace function public._product_rfq_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._feature_enabled('product_rfq') and public._shops_products_enabled();
$$;

create or replace function public._rfq_shop_recipient(p_rfq_id uuid, p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._product_rfq_enabled() and exists (
    select 1
      from public.rfq_recipients r
      join public.shops s on s.id = r.shop_id
     where r.rfq_id = p_rfq_id and r.shop_id = p_shop_id and s.owner_id = auth.uid()
  );
$$;

create or replace function public._rfq_is_customer(p_rfq_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._product_rfq_enabled() and exists (
    select 1 from public.rfqs r where r.id = p_rfq_id and r.customer_id = auth.uid()
  );
$$;

create or replace function public._rfq_can_read(p_rfq_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._product_rfq_enabled() and exists (
    select 1
      from public.rfqs r
     where r.id = p_rfq_id
       and (r.customer_id = auth.uid() or exists (
         select 1
           from public.rfq_recipients rr
           join public.shops s on s.id = rr.shop_id
          where rr.rfq_id = r.id and s.owner_id = auth.uid()
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
  select public._product_rfq_enabled() and exists (
    select 1
      from public.supplier_quotes q
      join public.rfqs r on r.id = q.rfq_id
     where q.id = p_quote_id
       and (r.customer_id = auth.uid() or exists (
         select 1 from public.shops s where s.id = q.shop_id and s.owner_id = auth.uid()
       ))
  );
$$;

grant execute on function public._product_rfq_enabled(), public._rfq_shop_recipient(uuid, uuid),
  public._rfq_is_customer(uuid), public._rfq_can_read(uuid), public._rfq_quote_can_read(uuid) to authenticated;
revoke execute on function public._product_rfq_enabled(), public._rfq_shop_recipient(uuid, uuid),
  public._rfq_is_customer(uuid), public._rfq_can_read(uuid), public._rfq_quote_can_read(uuid) from public, anon;

create policy rfqs_participant_read on public.rfqs for select to authenticated
  using (public._rfq_can_read(id));
create policy rfq_items_participant_read on public.rfq_items for select to authenticated
  using (public._rfq_can_read(rfq_id));
create policy rfq_recipients_party_read on public.rfq_recipients for select to authenticated
  using (
    public._rfq_can_read(rfq_id)
    and (public._rfq_is_customer(rfq_id)
         or public._rfq_shop_recipient(rfq_id, shop_id))
  );
create policy supplier_quotes_participant_read on public.supplier_quotes for select to authenticated
  using (public._rfq_can_read(rfq_id) and public._rfq_quote_can_read(id));
create policy supplier_quote_items_participant_read on public.supplier_quote_items for select to authenticated
  using (public._rfq_quote_can_read(quote_id));

create or replace function public._rfq_distance_km(
  p_lat_a double precision, p_lng_a double precision, p_lat_b double precision, p_lng_b double precision
)
returns double precision
language sql
immutable
strict
as $$
  select 6371.0 * 2.0 * asin(sqrt(least(1.0, greatest(0.0,
    power(sin(radians(p_lat_b - p_lat_a) / 2.0), 2)
    + cos(radians(p_lat_a)) * cos(radians(p_lat_b))
      * power(sin(radians(p_lng_b - p_lng_a) / 2.0), 2)
  ))));
$$;
revoke execute on function public._rfq_distance_km(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

create or replace function public.create_rfq(
  p_category_id uuid,
  p_title text,
  p_items jsonb,
  p_city text,
  p_area text,
  p_lat double precision,
  p_lng double precision,
  p_needs_delivery boolean,
  p_needed_by date,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_category public.product_categories;
  v_rfq_id uuid;
  v_item jsonb;
  v_item_count int;
  v_routed int;
  v_shop record;
  v_seq int := 0;
  v_description text;
  v_specs jsonb;
  v_quantity numeric;
begin
  perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
  perform public._assert(char_length(trim(coalesce(p_title, ''))) between 3 and 120, 'RFQ title must be 3 to 120 characters');
  perform public._assert(char_length(trim(coalesce(p_city, ''))) between 2 and 100, 'enter a valid city');
  perform public._assert(char_length(trim(coalesce(p_area, ''))) between 2 and 100, 'enter a valid area');
  perform public._assert(p_lat between -90 and 90 and p_lng between -180 and 180, 'a valid map location is required');
  perform public._assert(p_needed_by >= current_date, 'needed-by date cannot be in the past');
  perform public._assert(char_length(coalesce(p_notes, '')) <= 2000, 'RFQ notes are too long');
  perform public._assert(jsonb_typeof(p_items) = 'array', 'RFQ items must be an array');
  v_item_count := jsonb_array_length(p_items);
  perform public._assert(v_item_count between 1 and 20, 'an RFQ must contain 1 to 20 items');
  select * into v_category from public.product_categories where id = p_category_id and active;
  perform public._assert(found, 'product category is unavailable');

  insert into public.rfqs (
    customer_id, category_id, title, city, area, lat, lng, needs_delivery, needed_by, notes
  ) values (
    v_uid, p_category_id, trim(p_title), trim(p_city), trim(p_area), p_lat, p_lng,
    coalesce(p_needs_delivery, false), p_needed_by, trim(coalesce(p_notes, ''))
  ) returning id into v_rfq_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_seq := v_seq + 1;
    perform public._assert(jsonb_typeof(v_item) = 'object', 'each RFQ item must be an object');
    v_description := trim(coalesce(v_item ->> 'description', ''));
    v_specs := coalesce(v_item -> 'specs', '{}'::jsonb);
    perform public._assert(char_length(v_description) between 2 and 500, 'item description must be 2 to 500 characters');
    perform public._assert(char_length(coalesce(v_item ->> 'brand_pref', '')) <= 80, 'brand preference is too long');
    perform public._assert(jsonb_typeof(v_specs) = 'object', 'item specifications must be an object');
    perform public._assert(jsonb_typeof(v_item -> 'quantity') = 'number', 'item quantity must be numeric');
    v_quantity := (v_item ->> 'quantity')::numeric;
    perform public._assert(v_quantity > 0 and v_quantity <= 1000000, 'item quantity must be greater than zero and at most 1000000');
    perform public._assert(coalesce(v_item ->> 'unit', '') in ('piece', 'sqft', 'box', 'kg', 'litre', 'bag', 'metre', 'set'), 'unsupported item unit');
    perform public._validate_product_specs(p_category_id, v_specs);
    insert into public.rfq_items (rfq_id, seq, description, brand_pref, specs, quantity, unit)
    values (v_rfq_id, v_seq, v_description, trim(coalesce(v_item ->> 'brand_pref', '')), v_specs, v_quantity, v_item ->> 'unit');
  end loop;

  insert into public.rfq_recipients (rfq_id, shop_id)
  select v_rfq_id, candidate.id
    from (
      select s.id, s.owner_id,
             public._rfq_distance_km(p_lat, p_lng, s.lat, s.lng) as distance_km
        from public.shops s
        join public.shop_categories sc on sc.shop_id = s.id and sc.category_id = p_category_id
       where s.status = 'verified'
         and s.owner_id <> v_uid
         and s.lat is not null and s.lng is not null
         and (not coalesce(p_needs_delivery, false) or s.offers_delivery)
         and public._rfq_distance_km(p_lat, p_lng, s.lat, s.lng) <= s.delivery_radius_km
    ) candidate
   order by candidate.distance_km, candidate.id
   limit 10;
  get diagnostics v_routed = row_count;
  perform public._assert(v_routed > 0, 'no verified shops in this category cover the selected location');

  for v_shop in
    select s.owner_id
      from public.rfq_recipients r join public.shops s on s.id = r.shop_id
     where r.rfq_id = v_rfq_id
  loop
    perform public._queue_notification(
      v_shop.owner_id, 'rfq_received', null, 'New product RFQ',
      left('A customer requested a quotation for ' || trim(p_title), 300),
      jsonb_build_object('url', '/rfq/merchant/' || v_rfq_id, 'rfq_id', v_rfq_id), 'rfq:' || v_rfq_id::text
    );
  end loop;
  return v_rfq_id;
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
  perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
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

create or replace function public.list_my_supplier_rfqs()
returns table (
  rfq_id uuid, title text, category_name text, city text, area text, needs_delivery boolean,
  needed_by date, expires_at timestamptz, created_at timestamptz, item_count bigint, quote_status text
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
  perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
  select s.id into v_shop_id from public.shops s where s.owner_id = v_uid;
  perform public._assert(found, 'shop not found');
  return query
    select r.id, r.title, c.name, r.city, r.area, r.needs_delivery, r.needed_by, r.expires_at, r.created_at,
           (select count(*) from public.rfq_items i where i.rfq_id = r.id),
           (select q.status from public.supplier_quotes q
             where q.rfq_id = r.id and q.shop_id = v_shop_id and q.status = 'sent' order by q.version desc limit 1)
      from public.rfq_recipients rr
      join public.rfqs r on r.id = rr.rfq_id
      join public.product_categories c on c.id = r.category_id
     where rr.shop_id = v_shop_id and r.status = 'open' and r.expires_at > now()
     order by r.created_at desc;
end;
$$;

create or replace function public.get_supplier_rfq(p_rfq_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_shop_id uuid;
  v_rfq public.rfqs;
begin
  perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
  select s.id into v_shop_id from public.shops s where s.owner_id = v_uid;
  perform public._assert(found, 'shop not found');
  perform public._assert(public._rfq_shop_recipient(p_rfq_id, v_shop_id), 'RFQ not found');
  select * into v_rfq from public.rfqs where id = p_rfq_id;
  perform public._assert(found, 'RFQ not found');
  return jsonb_build_object(
    'id', v_rfq.id, 'category_name', (select c.name from public.product_categories c where c.id = v_rfq.category_id),
    'title', v_rfq.title, 'city', v_rfq.city, 'area', v_rfq.area, 'needs_delivery', v_rfq.needs_delivery,
    'needed_by', v_rfq.needed_by, 'notes', v_rfq.notes, 'status', v_rfq.status, 'expires_at', v_rfq.expires_at,
    'shop_id', v_shop_id,
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
       where q.rfq_id = v_rfq.id and q.shop_id = v_shop_id and q.status = 'sent'
       order by q.version desc limit 1
    )
  );
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
  v_uid uuid := public._require_uid();
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
  select * into v_shop from public.shops where owner_id = v_uid for update;
  perform public._assert(found and v_shop.status = 'verified', 'verified shop not found');
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
    if v_available then
      perform public._validate_product_specs(v_rfq.category_id, coalesce(v_item -> 'specs', '{}'::jsonb));
    end if;
    v_quantity := v_rfq_item.quantity;
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
  perform public._assert(v_subtotal + v_gst + p_delivery_charge_paise <= 9223372036854775807, 'quote total is too large');
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

create or replace function public.compare_rfq_quotes(p_rfq_id uuid)
returns table (
  quote_id uuid, shop_id uuid, shop_name text, version int, status text, valid_until timestamptz,
  delivery_charge_paise bigint, delivery_days int, notes text, subtotal_paise bigint, gst_paise bigint,
  total_paise bigint, unavailable_count bigint, items jsonb
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
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'rfq_item_id', i.id, 'seq', i.seq, 'description', i.description,
               'requested_brand', i.brand_pref, 'requested_specs', i.specs,
               'brand', qi.brand, 'model', qi.model, 'specs', qi.specs, 'quantity', qi.quantity,
               'unit', i.unit, 'unit_price_paise', qi.unit_price_paise, 'gst_rate_bp', qi.gst_rate_bp,
               'available', qi.available, 'line_total_paise', qi.line_total_paise,
               'brand_differs', qi.available and nullif(btrim(i.brand_pref), '') is not null
                 and lower(btrim(i.brand_pref)) is distinct from lower(btrim(qi.brand)),
               'specs_missing', exists (
                 select 1 from jsonb_each(coalesce(i.specs, '{}'::jsonb)) requested(key, value)
                  where not (coalesce(qi.specs, '{}'::jsonb) ? requested.key)
                     or qi.specs ->> requested.key is null
                     or btrim(qi.specs ->> requested.key) = ''
               ),
               'missing_spec_keys', coalesce((
                 select jsonb_agg(requested.key order by requested.key)
                   from jsonb_each(coalesce(i.specs, '{}'::jsonb)) requested(key, value)
                  where not (coalesce(qi.specs, '{}'::jsonb) ? requested.key)
                     or qi.specs ->> requested.key is null
                     or btrim(qi.specs ->> requested.key) = ''
               ), '[]'::jsonb)
             ) order by i.seq)
               from public.supplier_quote_items qi
               join public.rfq_items i on i.id = qi.rfq_item_id
              where qi.quote_id = q.id
           ), '[]'::jsonb)
      from public.supplier_quotes q
      join public.shops s on s.id = q.shop_id
     where q.rfq_id = p_rfq_id and q.status in ('sent', 'selected', 'rejected', 'expired')
     order by q.total_paise, q.created_at, q.id;
end;
$$;

create or replace function public.select_supplier_quote(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_rfq_id uuid;
  v_quote public.supplier_quotes;
  v_rfq public.rfqs;
  v_enquiry public.product_enquiries;
  v_created boolean := false;
begin
  perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
  select q.rfq_id into v_rfq_id from public.supplier_quotes q where q.id = p_quote_id;
  perform public._assert(found, 'quote not found');
  select * into v_rfq from public.rfqs where id = v_rfq_id for update;
  perform public._assert(found and v_rfq.customer_id = v_uid, 'quote not found');
  select * into v_quote from public.supplier_quotes where id = p_quote_id and rfq_id = v_rfq.id for update;
  perform public._assert(found, 'quote not found');
  perform public._assert(v_rfq.status = 'open' and v_rfq.expires_at > now(), 'RFQ is closed or expired');
  perform public._assert(v_quote.status = 'sent' and v_quote.valid_until > now(), 'quote is no longer available');

  update public.supplier_quotes
     set status = 'rejected', updated_at = now()
   where rfq_id = v_rfq.id and id <> v_quote.id and status = 'sent';
  update public.supplier_quotes set status = 'selected', updated_at = now() where id = v_quote.id;
  update public.rfqs set status = 'closed', updated_at = now() where id = v_rfq.id;

  select * into v_enquiry from public.product_enquiries e
   where e.shop_id = v_quote.shop_id and e.customer_id = v_uid and e.product_id is null and e.status = 'open'
   order by e.last_message_at desc limit 1 for update;
  if not found then
    insert into public.product_enquiries (shop_id, customer_id, product_id)
    values (v_quote.shop_id, v_uid, null) returning * into v_enquiry;
    v_created := true;
  end if;
  perform public._product_enquiry_post(
    v_enquiry.id, v_uid, false,
    left('I selected your quotation for "' || v_rfq.title || '". Please coordinate the next steps here; no payment was taken.', 2000),
    v_created
  );
  return jsonb_build_object('rfq_id', v_rfq.id, 'enquiry_id', v_enquiry.id);
end;
$$;

create or replace function public.expire_rfqs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_rfq record;
  v_updated int;
begin
  for v_rfq in
    select r.id, r.expires_at
      from public.rfqs r
     where r.status = 'open'
       and (r.expires_at <= now() or exists (
         select 1 from public.supplier_quotes q
          where q.rfq_id = r.id and q.status = 'sent' and q.valid_until <= now()
       ))
     for update of r skip locked
  loop
    update public.supplier_quotes q
       set status = 'expired', updated_at = now()
     where q.rfq_id = v_rfq.id and q.status = 'sent'
       and (q.valid_until <= now() or v_rfq.expires_at <= now());
    if v_rfq.expires_at <= now() then
      update public.rfqs set status = 'expired', updated_at = now()
       where id = v_rfq.id and status = 'open';
      get diagnostics v_updated = row_count;
      v_count := v_count + v_updated;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.admin_rfq_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return (
    with per_rfq as (
      select r.id, r.title, r.city, r.status, r.created_at,
             (select count(*)::int from public.supplier_quotes q
               where q.rfq_id = r.id and q.status in ('sent', 'selected', 'rejected', 'expired')) as quote_count,
             (select min(q.created_at) from public.supplier_quotes q where q.rfq_id = r.id) as first_response_at
        from public.rfqs r
    ),
    recent as (
      select id, title, city, status, created_at, quote_count
        from per_rfq order by created_at desc limit 20
    )
    select jsonb_build_object(
      'open_rfqs', (select count(*) from per_rfq where status = 'open'),
      'total_rfqs', (select count(*) from per_rfq),
      'total_quotes', (select coalesce(sum(quote_count), 0) from per_rfq),
      'average_quotes_per_rfq', (select coalesce(round(avg(quote_count)::numeric, 1), 0) from per_rfq),
      'average_response_minutes', (
        select coalesce(round(avg(extract(epoch from (first_response_at - created_at)) / 60.0)::numeric, 1), 0)
          from per_rfq where first_response_at is not null
      ),
      'recent_rfqs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'title', title, 'city', city, 'status', status, 'created_at', created_at, 'quote_count', quote_count
        ) order by created_at desc) from recent
      ), '[]'::jsonb)
    )
  );
end;
$$;

do $$
declare
  v_constraint oid;
  v_definition text;
  v_expression text;
begin
  select oid into v_constraint from pg_constraint
   where conrelid = 'public.notifications'::regclass
     and conname = 'notifications_kind_check' and contype = 'c';
  if v_constraint is not null then
    v_definition := pg_get_constraintdef(v_constraint);
    v_expression := substring(v_definition from 8 for char_length(v_definition) - 8);
    alter table public.notifications drop constraint notifications_kind_check;
    execute format(
      'alter table public.notifications add constraint notifications_kind_check check ((%s) or kind in (''rfq_received'', ''rfq_quote_received''))',
      v_expression
    );
  else
    alter table public.notifications add constraint notifications_kind_check check (kind is not null);
  end if;
end;
$$;

revoke execute on function public.create_rfq(uuid, text, jsonb, text, text, double precision, double precision, boolean, date, text),
  public.get_rfq(uuid), public.list_my_supplier_rfqs(), public.get_supplier_rfq(uuid),
  public.send_supplier_quote(uuid, jsonb, bigint, int, timestamptz, text),
  public.compare_rfq_quotes(uuid), public.select_supplier_quote(uuid), public.expire_rfqs(),
  public.admin_rfq_dashboard()
from public, anon;
grant execute on function public.create_rfq(uuid, text, jsonb, text, text, double precision, double precision, boolean, date, text),
  public.get_rfq(uuid), public.list_my_supplier_rfqs(), public.get_supplier_rfq(uuid),
  public.send_supplier_quote(uuid, jsonb, bigint, int, timestamptz, text),
  public.compare_rfq_quotes(uuid), public.select_supplier_quote(uuid), public.admin_rfq_dashboard()
to authenticated;
revoke all on function public.expire_rfqs() from public, anon, authenticated;
grant execute on function public.expire_rfqs() to service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('expire-product-rfqs', '* * * * *', 'select public.expire_rfqs()');
  end if;
end;
$$;

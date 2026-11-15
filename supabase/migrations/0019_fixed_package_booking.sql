-- Fixed package booking (docs/07 Phase 1, T1.2 and T1.4).
-- Requires the Phase 0 category/booking contract from migration 0018.
-- All amounts are integer paise. This migration is CI-tested and is not live-applied.

insert into public.app_config (key, value)
values ('fixed_booking', '{"platform_fee_paise":2900,"max_quantity":100}'::jsonb)
on conflict (key) do update
set value = public.app_config.value || excluded.value;

insert into public.app_config (key, value)
values ('archetype_flags', '{"inspect_quote":true,"fixed":false,"proposal":false,"time_based":false,"remote":false}'::jsonb)
on conflict (key) do nothing;

update public.app_config
   set value = jsonb_set(value, '{fixed}', 'true'::jsonb, true)
 where key = 'archetype_flags';

update public.categories c
   set archetype = 'fixed',
       pricing_units = '{job}'::text[],
       payment_template = 'full_upfront',
       cancellation_policy = 'fixed_flexible',
       config_version = config_version + 1
 where c.slug in ('house-cleaning', 'water-tank-cleaning', 'pest-control')
   and c.active
   and exists (
     select 1
       from public.provider_services ps
       join public.service_packages sp on sp.provider_service_id = ps.id
      where ps.category_id = c.id
        and ps.active
        and sp.active
        and sp.price_type = 'fixed'
   );

insert into public.category_cities (category_id, city, live, launched_at)
select c.id, p.city, true, now()
  from public.categories c
  join public.provider_services ps on ps.category_id = c.id and ps.active
  join public.service_packages sp on sp.provider_service_id = ps.id
                                and sp.active
                                and sp.price_type = 'fixed'
  join public.providers p on p.id = ps.provider_id
 where c.archetype = 'fixed'
   and public._provider_is_live(p.id)
 group by c.id, p.city
on conflict (category_id, city) do update
set live = true,
    launched_at = coalesce(public.category_cities.launched_at, excluded.launched_at);

insert into public.archetype_transitions (archetype, from_status, to_status, actor)
values
  ('fixed', 'pending_payment', 'requested', 'system'),
  ('fixed', 'requested', 'accepted', 'provider'),
  ('fixed', 'requested', 'declined', 'provider'),
  ('fixed', 'accepted', 'en_route', 'provider'),
  ('fixed', 'en_route', 'in_progress', 'provider'),
  ('fixed', 'in_progress', 'completion_requested', 'provider'),
  ('fixed', 'completion_requested', 'completed', 'customer'),
  ('fixed', 'completed', 'closed', 'system'),
  ('fixed', 'pending_payment', 'expired', 'system'),
  ('fixed', 'requested', 'cancelled', 'customer'),
  ('fixed', 'accepted', 'cancelled', 'customer'),
  ('fixed', 'en_route', 'cancelled', 'provider')
on conflict do nothing;

alter table public.quotes
  add column if not exists quote_type text not null default 'itemized'
    check (quote_type in ('itemized', 'package')),
  add column if not exists source_package_id uuid references public.service_packages (id) on delete set null,
  add column if not exists package_snapshot jsonb not null default '{}'::jsonb;

alter table public.quote_items
  add column if not exists unit text;

create table public.payment_schedule (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  quote_id uuid references public.quotes (id) on delete set null,
  seq int not null check (seq > 0),
  obligation_type text not null
    check (obligation_type in ('service', 'platform_fee', 'addon')),
  label text not null check (char_length(trim(label)) between 1 and 120),
  amount int not null check (amount > 0),
  due_rule text not null
    check (due_rule in ('at_booking', 'on_quote_approval', 'on_completion', 'on_delivery')
           or due_rule ~ '^days_before_start:[0-9]+$'),
  due_at timestamptz,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'due', 'paid', 'waived', 'refunded')),
  payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, seq)
);
create index payment_schedule_booking_idx
  on public.payment_schedule (booking_id, seq);
create index payment_schedule_due_idx
  on public.payment_schedule (due_at) where status in ('upcoming', 'due');

alter table public.payments
  add column if not exists schedule_id uuid references public.payment_schedule (id) on delete restrict;
alter table public.payment_schedule
  add constraint payment_schedule_payment_fk
  foreign key (payment_id) references public.payments (id) on delete set null;
create unique index payments_live_schedule_attempt_idx
  on public.payments (schedule_id)
  where status = 'created' and schedule_id is not null;

create or replace function public._protect_package_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.quote_type <> 'package' then
    return new;
  end if;
  perform public._assert(
    new.id = old.id
    and new.booking_id = old.booking_id
    and new.version = old.version
    and new.is_change_order = old.is_change_order
    and new.subtotal_labour = old.subtotal_labour
    and new.subtotal_parts = old.subtotal_parts
    and new.subtotal_other = old.subtotal_other
    and coalesce(new.subtotal_travel, 0) = coalesce(old.subtotal_travel, 0)
    and new.total = old.total
    and new.note is not distinct from old.note
    and new.quote_type = old.quote_type
    and new.source_package_id is not distinct from old.source_package_id
    and new.package_snapshot = old.package_snapshot,
    'package quote financial fields are immutable'
  );
  return new;
end;
$$;

drop trigger if exists quotes_protect_package_financials on public.quotes;
create trigger quotes_protect_package_financials
  before update on public.quotes
  for each row execute function public._protect_package_quote();

create or replace function public._protect_package_quote_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
      from public.quotes q
     where q.id = coalesce(old.quote_id, new.quote_id)
       and q.quote_type = 'package'
  ) then
    raise exception 'package quote line items are immutable' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists quote_items_protect_package_lines on public.quote_items;
create trigger quote_items_protect_package_lines
  before update or delete on public.quote_items
  for each row execute function public._protect_package_quote_item();

create or replace function public._fixed_booking_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value from public.app_config where key = 'fixed_booking'),
    '{"platform_fee_paise":2900,"max_quantity":100}'::jsonb
  ) || jsonb_build_object(
    'enabled', coalesce(
      (select (value ->> 'fixed')::boolean from public.app_config where key = 'archetype_flags'),
      false
    )
  );
$$;

create or replace function public.create_fixed_booking(
  p_package_id uuid,
  p_quantity numeric,
  p_window tstzrange,
  p_location jsonb,
  p_intake jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_config jsonb := public._fixed_booking_config();
  v_package public.service_packages;
  v_service public.provider_services;
  v_provider public.providers;
  v_category public.categories;
  v_address public.addresses;
  v_address_id uuid;
  v_booking uuid;
  v_quote uuid;
  v_mode text;
  v_city text;
  v_lat double precision;
  v_lng double precision;
  v_quantity numeric;
  v_service_total int;
  v_duration int;
  v_platform_fee int;
  v_snapshot jsonb;
begin
  perform public._assert(coalesce((v_config ->> 'enabled')::boolean, false), 'fixed booking is disabled');
  perform public._assert(jsonb_typeof(coalesce(p_location, '{}'::jsonb)) = 'object', 'location must be an object');
  perform public._assert(jsonb_typeof(coalesce(p_intake, '{}'::jsonb)) = 'object', 'intake must be an object');
  perform public._assert(p_window is not null and lower_inc(p_window) and not isempty(p_window), 'service window is required');
  perform public._assert(lower(p_window) > now(), 'service window must be in the future');
  perform public._assert(p_quantity is not null and p_quantity > 0, 'quantity must be greater than zero');

  select * into v_package
    from public.service_packages
   where id = p_package_id
     and active
     and price_type = 'fixed'
   for share;
  perform public._assert(found, 'active fixed package not found');
  perform public._assert(
    p_quantity between v_package.qty_min and v_package.qty_max
    and (p_quantity = trunc(p_quantity) or v_package.qty_max > 1),
    'quantity is outside the package bounds'
  );
  perform public._assert(p_quantity <= coalesce((v_config ->> 'max_quantity')::numeric, 100), 'quantity exceeds the configured maximum');

  select * into v_service
    from public.provider_services
   where id = v_package.provider_service_id and active
   for share;
  perform public._assert(found, 'provider service is not available');
  select * into v_provider from public.providers where id = v_service.provider_id for share;
  select * into v_category from public.categories where id = v_service.category_id;
  perform public._assert(found and v_category.archetype = 'fixed', 'category must use the fixed archetype');
  perform public._assert(v_provider.id <> v_uid, 'cannot book yourself');

  v_mode := lower(trim(coalesce(p_location ->> 'mode', 'at_customer')));
  perform public._assert(v_mode = any (v_category.location_modes), 'location mode is not enabled for this category');
  perform public._assert(v_mode = 'at_customer', 'fixed package booking currently supports at_customer only');

  if coalesce(p_location ->> 'address_id', '') <> '' then
    select * into v_address
      from public.addresses
     where id = (p_location ->> 'address_id')::uuid
       and user_id = v_uid;
    perform public._assert(found, 'saved address not found');
    v_city := v_address.city;
    v_lat := v_address.lat;
    v_lng := v_address.lng;
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values (v_uid, 'Booking', v_address.line1, v_address.city, v_address.lat, v_address.lng)
    returning id into v_address_id;
  else
    v_city := trim(coalesce(p_location ->> 'city', ''));
    v_lat := (p_location ->> 'lat')::double precision;
    v_lng := (p_location ->> 'lng')::double precision;
    perform public._assert(
      char_length(trim(coalesce(p_location ->> 'address_line', ''))) between 3 and 1000
      and char_length(v_city) between 2 and 120
      and v_lat between -90 and 90
      and v_lng between -180 and 180,
      'complete customer address is required'
    );
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values (v_uid, 'Booking', trim(p_location ->> 'address_line'), v_city, v_lat, v_lng)
    returning id into v_address_id;
  end if;

  perform public._assert_bookable(
    v_category.id, v_provider.id, v_city, 'fixed', p_window
  );

  v_quantity := p_quantity;
  v_service_total := round((v_package.price::numeric * v_quantity))::int;
  v_platform_fee := greatest(coalesce((v_config ->> 'platform_fee_paise')::int, 2900), 0);
  v_duration := case
    when v_package.qty_min = 1 and v_package.qty_max = 1 then coalesce(v_package.duration_min, 60)
    else coalesce(v_package.duration_min, 60) * ceil(v_quantity)::int
  end;
  perform public._assert(
    upper(p_window) - lower(p_window) >= make_interval(mins => v_duration),
    format('service window must be at least %s minutes', v_duration)
  );
  perform public._assert(v_service_total > 0 and v_service_total <= 100000000, 'invalid package total');

  v_snapshot := jsonb_build_object(
    'id', v_package.id,
    'title', v_package.title,
    'description', v_package.description,
    'price_type', v_package.price_type,
    'unit', v_package.unit,
    'quantity', v_quantity,
    'unit_price', v_package.price,
    'duration_min', v_package.duration_min,
    'service_duration_min', v_duration,
    'inclusions', to_jsonb(v_package.inclusions),
    'exclusions', to_jsonb(v_package.exclusions),
    'deliverables', v_package.deliverables,
    'usage_rights', v_package.usage_rights,
    'intake', coalesce(p_intake, '{}'::jsonb)
  );

  perform pg_advisory_xact_lock(hashtext(v_provider.id::text));
  perform public._assert(
    not exists (
      select 1
        from public.bookings b
       where b.provider_id = v_provider.id
         and b.service_window && p_window
         and b.status in ('requested', 'accepted', 'en_route', 'in_progress', 'completion_requested', 'pending_payment')
    ),
    'provider_unavailable: service window overlaps another booking'
  );

  insert into public.bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id,
    description, scheduled_at, service_window, status, visit_fee, platform_fee,
    total_amount, archetype, location_mode, booking_origin
  ) values (
    v_uid, v_provider.id, v_category.id, v_service.id, v_address_id,
    coalesce(trim(p_intake ->> 'description'), v_package.title),
    lower(p_window), p_window, 'pending_payment', 0, v_platform_fee,
    v_service_total + v_platform_fee, 'fixed', v_mode, 'marketplace'
  ) returning id into v_booking;

  insert into public.booking_secrets (booking_id, start_otp)
  values (v_booking, public._gen_otp());

  insert into public.quotes (
    booking_id, version, status, is_change_order, subtotal_labour, subtotal_parts,
    subtotal_other, total, note, quote_type, source_package_id, package_snapshot
  ) values (
    v_booking, 1, 'approved_pending_payment', false, 0, 0,
    v_service_total, v_service_total, 'Fixed package quote', 'package', v_package.id, v_snapshot
  ) returning id into v_quote;

  insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price)
  values (v_quote, 'other', v_package.title, v_quantity, v_package.unit, v_package.price);

  insert into public.payment_schedule (
    booking_id, quote_id, seq, obligation_type, label, amount, due_rule, due_at, status
  ) values
    (v_booking, v_quote, 1, 'service', 'Package payment', v_service_total, 'at_booking', now(), 'due'),
    (v_booking, v_quote, 2, 'platform_fee', 'Platform fee', v_platform_fee, 'at_booking', now(), 'due');

  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (v_booking, v_uid, null, 'pending_payment', 'fixed package booking created');
  return v_booking;
end;
$$;

create or replace function public.prepare_fixed_payment(
  p_booking_id uuid,
  p_user_id uuid,
  p_schedule_id uuid default null
)
returns table (
  payment_id uuid,
  schedule_id uuid,
  amount int,
  purpose public.payment_purpose,
  short_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  s public.payment_schedule;
  p public.payments;
begin
  perform public._assert(b.customer_id = p_user_id, 'only the customer can pay');
  perform public._assert(b.archetype = 'fixed', 'not a fixed booking');
  perform public._assert(b.status in ('pending_payment', 'in_progress'), 'nothing to pay in this state');

  select * into s
    from public.payment_schedule x
   where x.booking_id = b.id
     and (p_schedule_id is null or x.id = p_schedule_id)
     and x.status = 'due'
   order by x.seq
   limit 1
   for update;
  perform public._assert(found, 'payment obligation is not due');

  select * into p
    from public.payments x
   where x.schedule_id = s.id
     and x.status = 'created'
     and x.amount = s.amount
     and x.short_url is not null
   order by x.created_at desc
   limit 1;
  if found then
    return query select p.id, s.id, p.amount, p.purpose, p.short_url;
    return;
  end if;

  update public.payments x
     set status = 'failed', cancel_link_pending = true
   where x.schedule_id = s.id and x.status = 'created';
  insert into public.payments (booking_id, quote_id, schedule_id, purpose, amount)
  values (b.id, s.quote_id, s.id, 'fixed', s.amount)
  returning * into p;
  return query select p.id, s.id, p.amount, p.purpose, null::text;
end;
$$;

create or replace function public.prepare_payment(p_booking_id uuid, p_user_id uuid)
returns table (payment_id uuid, amount int, purpose public.payment_purpose, short_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  f record;
  v_purpose public.payment_purpose;
  v_amount int;
  v_quote uuid;
  p public.payments;
begin
  perform public._assert(b.customer_id = p_user_id, 'only the customer can pay');

  if b.archetype = 'fixed' then
    select x.payment_id, x.amount, x.purpose, x.short_url
      into f
      from public.prepare_fixed_payment(b.id, p_user_id, null) x;
    perform public._assert(f.payment_id is not null, 'nothing to pay');
    return query select f.payment_id, f.amount, f.purpose, f.short_url;
    return;
  end if;

  if b.booking_origin = 'byo' and b.status = 'pending_payment' then
    select * into q from public.quotes where id = b.approved_quote_id;
    perform public._assert(q.id is not null and q.status = 'approved', 'BYO agreement is missing');
    v_purpose := 'fixed';
    v_quote := q.id;
    v_amount := b.total_amount - public._net_paid(b.id);
  elsif b.status = 'pending_payment' then
    v_purpose := 'visit_fee';
    v_amount := b.visit_fee;
  elsif b.status in ('awaiting_payment', 'in_progress') then
    select * into q from public.quotes x
     where x.booking_id = b.id and x.status = 'approved_pending_payment'
     order by x.version desc limit 1;
    perform public._assert(q.id is not null, 'nothing to pay');
    v_purpose := 'balance';
    v_quote := q.id;
    v_amount := public._required_total(q.total, b.visit_fee, b.platform_fee) - public._net_paid(b.id);
  else
    raise exception 'nothing to pay in this state' using errcode = 'P0001';
  end if;
  perform public._assert(v_amount > 0, 'nothing to pay');

  select * into p from public.payments x
   where x.booking_id = b.id and x.status = 'created' and x.purpose = v_purpose
     and x.amount = v_amount and x.quote_id is not distinct from v_quote
     and x.schedule_id is null and x.short_url is not null
   order by x.created_at desc limit 1;
  if found then
    return query select p.id, p.amount, p.purpose, p.short_url;
    return;
  end if;

  update public.payments
     set status = 'failed', cancel_link_pending = true
   where booking_id = b.id and schedule_id is null and status = 'created';
  insert into public.payments (booking_id, quote_id, purpose, amount)
  values (b.id, v_quote, v_purpose, v_amount)
  returning * into p;
  return query select p.id, p.amount, p.purpose, null::text;
end;
$$;

create or replace function public.send_fixed_addons(
  p_booking_id uuid,
  p_addons jsonb,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  qi record;
  v_item jsonb;
  v_quote uuid;
  v_version int;
  v_addon_total int := 0;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can add services');
  perform public._assert(b.archetype = 'fixed' and b.status = 'in_progress', 'add-ons are allowed only during fixed service');
  perform public._assert(jsonb_typeof(p_addons) = 'array' and jsonb_array_length(p_addons) between 1 and 20, '1 to 20 add-ons are required');
  select * into q from public.quotes where id = b.approved_quote_id for update;
  perform public._assert(q.id is not null and q.status = 'approved' and q.quote_type = 'package', 'approved package quote not found');

  for v_item in select value from jsonb_array_elements(p_addons) loop
    perform public._assert(
      char_length(trim(coalesce(v_item ->> 'title', ''))) between 2 and 160,
      'add-on title is required'
    );
    perform public._assert(
      coalesce((v_item ->> 'qty')::numeric, 0) > 0
      and coalesce((v_item ->> 'qty')::numeric, 0) <= 100
      and coalesce((v_item ->> 'unit_price')::int, -1) > 0
      and coalesce((v_item ->> 'unit_price')::int, 0) <= 10000000,
      'invalid add-on quantity or price'
    );
    v_addon_total := v_addon_total
      + round((v_item ->> 'qty')::numeric * (v_item ->> 'unit_price')::int)::int;
  end loop;

  perform public._close_open_quotes(b.id);
  select coalesce(max(version), 0) + 1 into v_version from public.quotes where booking_id = b.id;
  insert into public.quotes (
    booking_id, version, status, is_change_order, subtotal_labour, subtotal_parts,
    subtotal_other, total, note, quote_type, source_package_id, package_snapshot
  ) values (
    b.id, v_version, 'sent', true, q.subtotal_labour, q.subtotal_parts,
    q.subtotal_other + v_addon_total, q.total + v_addon_total,
    nullif(trim(p_note), ''), 'package', q.source_package_id,
    q.package_snapshot
  ) returning id into v_quote;

  for qi in select * from public.quote_items where quote_id = q.id order by id loop
    insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price, bill_photo_url)
    values (v_quote, qi.kind, qi.title, qi.qty, qi.unit, qi.unit_price, qi.bill_photo_url);
  end loop;

  for v_item in select value from jsonb_array_elements(p_addons) loop
    insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price)
    values (
      v_quote, 'other', trim(v_item ->> 'title'), (v_item ->> 'qty')::numeric,
      nullif(trim(v_item ->> 'unit'), ''), (v_item ->> 'unit_price')::int
    );
  end loop;
  perform public._log_event(b.id, v_uid, 'fixed add-on change order v' || v_version);
  return v_quote;
end;
$$;

create or replace function public.approve_fixed_change_order(
  p_booking_id uuid,
  p_quote_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  v_target int;
  v_delta int;
  v_refund int := 0;
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can approve');
  perform public._assert(b.archetype = 'fixed' and b.status = 'in_progress', 'change order is not open');
  select * into q from public.quotes where id = p_quote_id and booking_id = b.id for update;
  perform public._assert(q.id is not null and q.status = 'sent' and q.quote_type = 'package' and q.is_change_order, 'fixed change order not found');

  v_target := q.total + b.platform_fee;
  v_delta := v_target - public._net_paid(b.id);
  if v_delta > 0 then
    update public.quotes set status = 'approved_pending_payment' where id = q.id;
    insert into public.payment_schedule (
      booking_id, quote_id, seq, obligation_type, label, amount, due_rule, due_at, status
    )
    select b.id, q.id, coalesce(max(seq), 0) + 1, 'addon', 'Add-on payment',
           v_delta, 'on_quote_approval', now(), 'due'
      from public.payment_schedule
     where booking_id = b.id;
  else
    perform public._activate_quote(b.id, q.id);
    if v_delta < 0 then
      v_refund := public._refund_partial(b.id, -v_delta, 'fixed package change order reduced the total');
      update public.bookings set refund_amount = refund_amount + v_refund where id = b.id;
    end if;
  end if;
  perform public._log_event(b.id, v_uid, 'fixed add-on v' || q.version || ' approved, due ' || greatest(v_delta, 0));
  return jsonb_build_object('amount_due', greatest(v_delta, 0), 'refund', v_refund, 'quote_id', q.id);
end;
$$;

create or replace function public.record_payment_paid(p_link_id text, p_payment_id text, p_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  b public.bookings;
  q public.quotes;
  s public.payment_schedule;
  v_required int;
  v_accept boolean;
  v_all_paid boolean;
begin
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into p from public.payments where razorpay_link_id = p_link_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown link');
  end if;
  if p.amount <> p_amount then
    return jsonb_build_object('ok', false, 'error', 'amount mismatch');
  end if;

  b := public._lock_booking(p.booking_id);
  if p.schedule_id is not null then
    select * into s from public.payment_schedule where id = p.schedule_id for update;
    select * into q from public.quotes where id = p.quote_id for update;
    v_accept := p.status = 'created'
      and s.status = 'due'
      and b.archetype = 'fixed'
      and (
        (b.status = 'pending_payment' and q.status = 'approved_pending_payment' and s.obligation_type in ('service', 'platform_fee'))
        or (b.status = 'in_progress' and q.status = 'approved_pending_payment' and s.obligation_type = 'addon')
      );
    update public.payments
       set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
     where id = p.id;
    if not v_accept then
      perform public._queue_refund(p.id, p.amount, 'stale or excess fixed payment');
      perform public._log_event(b.id, null, 'payment ' || p_payment_id || ' not owed; queued for refund');
      return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund', true);
    end if;

    update public.payment_schedule
       set status = 'paid', payment_id = p.id, updated_at = now()
     where id = s.id;

    select not exists (
      select 1 from public.payment_schedule x
       where x.booking_id = b.id
         and x.quote_id = q.id
         and x.status <> 'paid'
    ) into v_all_paid;
    if v_all_paid then
      perform public._activate_quote(b.id, q.id);
      if b.status = 'pending_payment' then
        perform public._set_status(b.id, 'requested', null, 'fixed package fully paid');
      else
        perform public._log_event(b.id, null, 'fixed add-on v' || q.version || ' paid');
      end if;
    end if;
    return jsonb_build_object('ok', true, 'booking_id', b.id, 'schedule_id', s.id);
  end if;

  if p.status = 'created' then
    if p.purpose = 'fixed' and b.booking_origin = 'byo' and b.status = 'pending_payment' then
      select * into q from public.quotes where id = p.quote_id for update;
      if q.status = 'approved' then
        v_required := b.total_amount;
      end if;
    elsif p.purpose = 'visit_fee' and b.status = 'pending_payment' then
      v_required := b.visit_fee;
    elsif p.purpose = 'balance' and p.quote_id is not null then
      select * into q from public.quotes where id = p.quote_id for update;
      if q.status = 'approved_pending_payment' then
        v_required := public._required_total(q.total, b.visit_fee, b.platform_fee);
      end if;
    end if;
  end if;
  v_accept := v_required is not null and public._net_paid(b.id) + p.amount <= v_required;

  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
   where id = p.id;

  if not v_accept then
    perform public._queue_refund(p.id, p.amount, 'stale or excess payment');
    perform public._log_event(b.id, null, 'payment ' || p_payment_id || ' not owed; queued for refund');
    return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund', true);
  end if;

  if p.purpose = 'fixed' and b.booking_origin = 'byo' then
    update public.bookings set accepted_at = now() where id = b.id;
    perform public._set_status(b.id, 'accepted', null, 'BYO fixed payment received');
  elsif p.purpose = 'visit_fee' then
    perform public._set_status(b.id, 'requested', null, 'visit fee paid');
  elsif public._net_paid(b.id) >= v_required then
    perform public._activate_quote(b.id, q.id);
    if b.status = 'awaiting_payment' then
      perform public._set_status(b.id, 'in_progress', null, 'balance paid');
    else
      perform public._log_event(b.id, null, 'change order v' || q.version || ' paid');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'booking_id', b.id);
end;
$$;

create or replace function public.arrive(p_booking_id uuid, p_otp text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  s public.booking_secrets;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can mark arrival');
  perform public._assert(b.status = 'en_route', 'provider is not en route');
  if b.archetype = 'fixed' and exists (
    select 1 from public.payment_schedule
     where booking_id = b.id and status in ('upcoming', 'due') and due_at <= now()
  ) then
    raise exception 'payment obligation is overdue' using errcode = 'P0001';
  end if;
  select * into s from public.booking_secrets where booking_id = b.id for update;
  if s.start_attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'locked', 'attempts_left', 0);
  end if;
  if p_otp is distinct from s.start_otp then
    update public.booking_secrets set start_attempts = start_attempts + 1 where booking_id = b.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_otp', 'attempts_left', 4 - s.start_attempts);
  end if;
  update public.booking_secrets set start_attempts = 0 where booking_id = b.id;
  perform public._set_status(
    b.id,
    case when b.archetype = 'fixed' or b.booking_origin = 'byo'
      then 'in_progress'::public.booking_status
      else 'inspecting'::public.booking_status end,
    v_uid
  );
  return jsonb_build_object('ok', true);
end;
$$;

alter table public.payment_schedule enable row level security;
revoke all on public.payment_schedule from anon, authenticated;
grant select on public.payment_schedule to authenticated;
grant all on public.payment_schedule to service_role;
create policy payment_schedule_participants on public.payment_schedule
  for select to authenticated
  using (public._is_participant(booking_id));

revoke execute on function
  public._protect_package_quote(),
  public._protect_package_quote_item(),
  public._fixed_booking_config(),
  public.prepare_payment(uuid, uuid),
  public.create_fixed_booking(uuid, numeric, tstzrange, jsonb, jsonb),
  public.prepare_fixed_payment(uuid, uuid, uuid),
  public.send_fixed_addons(uuid, jsonb, text),
  public.approve_fixed_change_order(uuid, uuid),
  public.record_payment_paid(text, text, int),
  public.arrive(uuid, text)
from public, anon;
grant execute on function
  public.create_fixed_booking(uuid, numeric, tstzrange, jsonb, jsonb),
  public.send_fixed_addons(uuid, jsonb, text),
  public.approve_fixed_change_order(uuid, uuid),
  public.arrive(uuid, text)
to authenticated;
grant execute on function public.prepare_fixed_payment(uuid, uuid, uuid), public.record_payment_paid(text, text, int)
  to service_role;

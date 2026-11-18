insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values ('merchant_staff', false, 'Staff accounts', 'Shops and providers can add staff.', 'Marketplace', 60)
on conflict (key) do nothing;

create table public.business_members (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff')),
  active boolean not null default true,
  invited_at timestamptz not null default now(),
  primary key (owner_id, member_id),
  check (owner_id <> member_id)
);
create index business_members_active_member_idx
  on public.business_members (member_id, owner_id) where active;

alter table public.business_members enable row level security;
revoke all on public.business_members from public, anon, authenticated;
grant select on public.business_members to authenticated;
create policy business_members_read on public.business_members
  for select to authenticated
  using (
    public._feature_enabled('merchant_staff')
    and (owner_id = auth.uid() or member_id = auth.uid())
  );

create or replace function public._business_role(p_owner_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner_id = auth.uid() then 'owner'
    when public._feature_enabled('merchant_staff') then (
      select bm.role
        from public.business_members bm
       where bm.owner_id = p_owner_id and bm.member_id = auth.uid() and bm.active
    )
    else null
  end;
$$;

create or replace function public._acts_for(p_owner_id uuid, p_min_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_owner_id = auth.uid(), false)
      or (
        public._feature_enabled('merchant_staff')
        and exists (
          select 1
            from public.business_members bm
           where bm.owner_id = p_owner_id
             and bm.member_id = auth.uid()
             and bm.active
             and case p_min_role
               when 'staff' then bm.role in ('owner', 'manager', 'staff')
               when 'manager' then bm.role in ('owner', 'manager')
               when 'owner' then bm.role = 'owner'
               else false
             end
        )
      );
$$;

create or replace function public._transition_actor(p_booking_id uuid, p_actor uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when b.id is null then null
           when p_actor is null then 'system'
           when p_actor = b.customer_id then 'customer'
           when p_actor = b.provider_id then 'provider'
           when exists (select 1 from public.admins a where a.user_id = p_actor) then 'admin'
           when p_actor = auth.uid() and public._acts_for(b.provider_id, 'manager') then 'provider'
           else null
         end
    from public.bookings b
   where b.id = p_booking_id;
$$;

create or replace function public.get_booking_commission_rate(p_booking_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id;
  perform public._assert(found and public._acts_for(b.provider_id, 'manager'), 'booking not found');
  if b.booking_origin = 'byo' then return 0; end if;
  if b.archetype = 'time_based' then return public._time_based_commission_bp(b.id, now()); end if;
  return public._commission_bp(b.provider_id, b.customer_id, b.id, now());
end;
$$;

create or replace function public.list_business_members(p_owner_id uuid)
returns table (member_id uuid, full_name text, role text, active boolean, invited_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._feature_enabled('merchant_staff'), 'merchant staff is disabled');
  perform public._assert(public._acts_for(p_owner_id, 'owner'), 'owner only');
  return query
    select bm.member_id, p.full_name, bm.role, bm.active, bm.invited_at
      from public.business_members bm
      join public.profiles p on p.id = bm.member_id
     where bm.owner_id = p_owner_id
     order by bm.active desc, bm.role, p.full_name, bm.member_id;
end;
$$;

create or replace function public.add_business_member(p_owner_id uuid, p_member_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert(public._feature_enabled('merchant_staff'), 'merchant staff is disabled');
  perform public._assert(public._acts_for(p_owner_id, 'owner'), 'owner only');
  perform public._assert(p_member_id is not null and p_member_id <> p_owner_id, 'member must be a different existing user');
  perform public._assert(p_role in ('manager', 'staff'), 'staff role must be manager or staff');
  perform public._assert(exists (select 1 from public.profiles p where p.id = p_member_id), 'member account unavailable');
  perform public._assert(
    exists (select 1 from public.providers p where p.id = p_owner_id)
    or exists (select 1 from public.shops s where s.owner_id = p_owner_id)
    or exists (select 1 from public.sports_venues v where v.owner_id = p_owner_id),
    'business owner not found'
  );
  insert into public.business_members (owner_id, member_id, role, active, invited_at)
  values (p_owner_id, p_member_id, p_role, true, now())
  on conflict (owner_id, member_id) do update
    set role = excluded.role, active = true, invited_at = now();
end;
$$;

create or replace function public.remove_business_member(p_owner_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert(public._feature_enabled('merchant_staff'), 'merchant staff is disabled');
  perform public._assert(public._acts_for(p_owner_id, 'owner'), 'owner only');
  update public.business_members
     set active = false
   where owner_id = p_owner_id and member_id = p_member_id and active;
  perform public._assert(found, 'active business member not found');
end;
$$;

create or replace function public.has_provider_business_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.providers p where public._acts_for(p.id, 'staff')
  );
$$;

create or replace function public.list_my_business_memberships()
returns table (owner_id uuid, role text, business_type text, business_name text)
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
    select p.id, bm.role, 'provider'::text, coalesce(pf.full_name, 'Provider business')
      from public.business_members bm
      join public.providers p on p.id = bm.owner_id
      join public.profiles pf on pf.id = p.id
     where bm.member_id = v_uid and bm.active
    union all
    select s.owner_id, bm.role, 'shop'::text, s.name
      from public.business_members bm
      join public.shops s on s.owner_id = bm.owner_id
     where bm.member_id = v_uid and bm.active
    union all
    select v.owner_id, bm.role, 'sports'::text, v.name
      from public.business_members bm
      join public.sports_venues v on v.owner_id = bm.owner_id
     where bm.member_id = v_uid and bm.active
    order by 3, 4;
end;
$$;

create or replace function public.get_provider_business_context(p_provider_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_provider public.providers;
  v_role text;
begin
  if p_provider_id is not null then
    perform public._assert(public._acts_for(p_provider_id, 'staff'), 'business access denied');
  end if;

  select p.* into v_provider
    from public.providers p
   where (p_provider_id is null or p.id = p_provider_id)
     and (p.id = v_uid or public._acts_for(p.id, 'staff'))
   order by (p.id = v_uid) desc, p.created_at
   limit 1;
  if not found then return null; end if;
  v_role := public._business_role(v_provider.id);
  if v_role = 'owner' then
    return public.get_my_provider() || jsonb_build_object('business_role', v_role);
  end if;
  return (to_jsonb(v_provider) - array[
           'base_location', 'razorpay_account_id', 'kyc_reference', 'gender',
           'kyc_reason', 'kyc_requirements', 'kyc_updated_at', 'review_note',
           'terms_version', 'terms_accepted_at', 'onboarding_step', 'submitted_at',
           'deactivated_at', 'commission_tier'
         ])
         || jsonb_build_object('business_role', v_role);
end;
$$;

create or replace function public.get_my_business_provider_jobs(p_provider_id uuid)
returns table (
  booking_id uuid,
  status public.booking_status,
  category_name text,
  customer_name text,
  description text,
  scheduled_at timestamptz,
  created_at timestamptz,
  visit_fee int,
  area text,
  distance_km double precision,
  address_line text,
  lat double precision,
  lng double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.status, c.name, pf.full_name, b.description, b.scheduled_at, b.created_at, b.visit_fee,
         a.city,
         case when pr.base_location is not null and a.location is not null
              then round((extensions.st_distance(pr.base_location, a.location) / 1000.0)::numeric, 1)::double precision end,
         case when b.accepted_at is not null then a.line1 end,
         case when b.accepted_at is not null then a.lat end,
         case when b.accepted_at is not null then a.lng end
    from public.bookings b
    join public.categories c on c.id = b.category_id
    join public.profiles pf on pf.id = b.customer_id
    join public.addresses a on a.id = b.address_id
    join public.providers pr on pr.id = b.provider_id
   where b.provider_id = p_provider_id
     and public._acts_for(p_provider_id, 'staff')
     and b.status <> 'pending_payment'
   order by b.created_at desc
   limit 200;
$$;

create or replace function public.get_booking_address(p_booking_id uuid)
returns table (area text, address_line text, lat double precision, lng double precision)
language sql
stable
security definer
set search_path = public
as $$
  select a.city,
         case when b.customer_id = auth.uid() or b.accepted_at is not null then a.line1 end,
         case when b.customer_id = auth.uid() or b.accepted_at is not null then a.lat end,
         case when b.customer_id = auth.uid() or b.accepted_at is not null then a.lng end
    from public.bookings b
    join public.addresses a on a.id = b.address_id
   where b.id = p_booking_id
     and (b.customer_id = auth.uid() or public._acts_for(b.provider_id, 'staff'));
$$;

create or replace function public._business_chat_participant(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.bookings b
     where b.id = p_booking_id
       and (b.customer_id = auth.uid() or public._acts_for(b.provider_id, 'staff'))
  );
$$;

drop policy if exists bookings_participants on public.bookings;
create policy bookings_participants on public.bookings
  for select to authenticated
  using (customer_id = auth.uid() or public._acts_for(provider_id, 'staff'));

drop policy if exists quotes_participants on public.quotes;
create policy quotes_participants on public.quotes
  for select to authenticated using (
    exists (
      select 1 from public.bookings b
       where b.id = booking_id
         and (b.customer_id = auth.uid() or public._acts_for(b.provider_id, 'manager'))
    )
  );
drop policy if exists quote_items_participants on public.quote_items;
create policy quote_items_participants on public.quote_items
  for select to authenticated using (
    exists (
      select 1
        from public.quotes q
        join public.bookings b on b.id = q.booking_id
       where q.id = quote_id
         and (b.customer_id = auth.uid() or public._acts_for(b.provider_id, 'manager'))
    )
  );

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages
  for select to authenticated using (public._business_chat_participant(booking_id));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and public._business_chat_participant(booking_id)
    and exists (
      select 1 from public.bookings b
       where b.id = booking_id
         and b.status not in ('pending_payment', 'declined', 'expired', 'cancelled')
    )
  );

drop policy if exists storage_job_photos_read on storage.objects;
create policy storage_job_photos_read on storage.objects
  for select to authenticated using (
    bucket_id = 'job-photos'
    and ((storage.foldername(name))[1] = auth.uid()::text
         or exists (
           select 1 from public.bookings b
            where objects.name = any (b.photos)
              and (b.customer_id = auth.uid() or public._acts_for(b.provider_id, 'staff'))
         ))
  );

create or replace function public.send_booking_message(p_booking_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings;
  v_body text := trim(coalesce(p_body, ''));
  v_message uuid;
  v_kinds text[];
  v_kind text;
begin
  select * into b from public.bookings where id = p_booking_id for share;
  perform public._assert(found, 'booking not found');
  perform public._assert(public._business_chat_participant(p_booking_id), 'not a booking participant');
  perform public._assert(
    b.status not in ('pending_payment', 'declined', 'expired', 'cancelled'),
    'chat is closed for this booking'
  );
  perform public._assert(v_body <> '' and char_length(v_body) <= 2000, 'message is invalid');

  insert into public.messages (booking_id, sender_id, body)
  values (b.id, v_uid, v_body)
  returning id into v_message;

  v_kinds := public._leakage_signal_kinds(v_body);
  foreach v_kind in array v_kinds loop
    insert into public.leakage_signals (subject_id, kind, booking_id, message_id, details)
    values (v_uid, v_kind, b.id, v_message, jsonb_build_object('source', 'chat', 'matched', v_kind));
  end loop;

  return jsonb_build_object('message_id', v_message, 'nudge', coalesce(array_length(v_kinds, 1), 0) > 0);
end;
$$;

create or replace function public.mark_chat_read(p_booking_id uuid, p_viewing boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._business_chat_participant(p_booking_id), 'not a participant of this booking');
  insert into public.booking_chat_reads as r (booking_id, user_id, last_read_at, viewing_until, updated_at)
  values (p_booking_id, v_uid, now(), case when p_viewing then now() + interval '45 seconds' end, now())
  on conflict (booking_id, user_id) do update
    set last_read_at = greatest(r.last_read_at, excluded.last_read_at),
        viewing_until = case when p_viewing is null then r.viewing_until else excluded.viewing_until end,
        updated_at = now();
  update public.notifications
     set status = 'skipped', last_error = 'read', updated_at = now()
   where user_id = v_uid and booking_id = p_booking_id and kind = 'chat_message' and status = 'pending';
end;
$$;

create or replace view public.service_request_provider_view
with (security_barrier = true) as
  with managed_provider_ids as (
    select auth.uid() as provider_id
     where auth.uid() is not null
    union
    select bm.owner_id
      from public.business_members bm
     where bm.member_id = auth.uid()
       and bm.active
       and bm.role in ('owner', 'manager')
  )
  select
    r.id,
    r.category_id,
    c.name as category_name,
    c.slug as category_slug,
    r.city,
    r.area,
    r.event_start,
    r.event_end,
    public._proposal_public_intake(r.category_id, r.intake) as intake,
    r.budget_min,
    r.budget_max,
    r.status,
    r.expires_at,
    r.created_at,
    rr.provider_id,
    rr.routed_at,
    r.urgent
  from public.request_recipients rr
  join public.service_requests r on r.id = rr.request_id
  join public.categories c on c.id = r.category_id
  where rr.provider_id in (select m.provider_id from managed_provider_ids m)
    and (select count(*)
           from public.request_recipients routed
          where routed.request_id = rr.request_id
            and routed.provider_id in (select m.provider_id from managed_provider_ids m)) = 1
    and r.status in ('open', 'closed', 'booked');

drop policy if exists request_recipients_own on public.request_recipients;
create policy request_recipients_own on public.request_recipients
  for select to authenticated using (
    public._acts_for(provider_id, 'manager')
    or exists (select 1 from public.service_requests r where r.id = request_id and r.customer_id = auth.uid())
    or public._is_admin()
  );
drop policy if exists proposals_participants on public.proposals;
create policy proposals_participants on public.proposals
  for select to authenticated using (
    public._acts_for(provider_id, 'manager')
    or exists (select 1 from public.service_requests r where r.id = request_id and r.customer_id = auth.uid())
    or public._is_admin()
  );
drop policy if exists request_messages_thread_participants on public.request_messages;
create policy request_messages_thread_participants on public.request_messages
  for select to authenticated using (
    sender_id = auth.uid()
    or public._acts_for(provider_id, 'staff')
    or exists (
      select 1 from public.service_requests r where r.id = request_id and r.customer_id = auth.uid()
    )
    or public._is_admin()
  );
drop policy if exists proposal_items_participants on public.proposal_items;
create policy proposal_items_participants on public.proposal_items
  for select to authenticated using (
    exists (
      select 1 from public.proposals p
       where p.id = proposal_id
         and (public._acts_for(p.provider_id, 'manager')
              or exists (select 1 from public.service_requests r where r.id = p.request_id and r.customer_id = auth.uid())
              or public._is_admin())
    )
  );
drop policy if exists proposal_schedule_participants on public.proposal_schedule;
create policy proposal_schedule_participants on public.proposal_schedule
  for select to authenticated using (
    exists (
      select 1 from public.proposals p
       where p.id = proposal_id
         and (public._acts_for(p.provider_id, 'manager')
              or exists (select 1 from public.service_requests r where r.id = p.request_id and r.customer_id = auth.uid())
              or public._is_admin())
    )
  );

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
  select public._product_rfq_enabled() and exists (
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
  select public._product_rfq_enabled() and exists (
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
     where e.id = p_enquiry_id
       and (e.customer_id = auth.uid() or public._acts_for(s.owner_id, 'staff'))
  );
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
  perform public._assert(public._shops_products_enabled(), 'products are disabled');
  select * into v_shop
    from public.shops s
   where s.owner_id = auth.uid() or public._acts_for(s.owner_id, 'staff')
   order by (s.owner_id = auth.uid()) desc, s.created_at
   limit 1;
  if not found then return null; end if;
  v_role := public._business_role(v_shop.owner_id);
  select coalesce(array_agg(c.slug order by c.sort_order, c.name), '{}'::text[]) into v_categories
    from public.shop_categories sc join public.product_categories c on c.id = sc.category_id
   where sc.shop_id = v_shop.id and c.active;
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
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
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
  v_from_shop := public._acts_for(s.owner_id, 'staff');
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
    perform public._assert(public._acts_for(v_owner, 'staff'), 'enquiry not found');
    update public.product_enquiries set shop_unread = 0 where id = e.id;
  end if;
end;
$$;

drop function if exists public.get_product_enquiry(uuid);
create function public.get_product_enquiry(p_enquiry_id uuid)
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
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
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

drop function if exists public.list_my_supplier_rfqs();
create function public.list_my_supplier_rfqs()
returns table (
  shop_id uuid, rfq_id uuid, title text, category_name text, city text, area text,
  needs_delivery boolean, needed_by date, expires_at timestamptz, created_at timestamptz,
  item_count bigint, quote_status text, business_role text
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
           public._business_role(s.owner_id)
      from public.rfq_recipients rr
      join public.shops s on s.id = rr.shop_id
      join public.rfqs r on r.id = rr.rfq_id
      join public.product_categories c on c.id = r.category_id
     where public._acts_for(s.owner_id, 'staff')
       and r.status = 'open' and r.expires_at > now()
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

create or replace function public.send_quote(p_booking_id uuid, p_items jsonb, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_request public.travel_requests;
  v_item jsonb;
  v_kind public.quote_item_kind;
  v_qty numeric;
  v_price int;
  v_line int;
  v_labour int := 0;
  v_parts int := 0;
  v_other int := 0;
  v_travel int := 0;
  v_version int;
  v_quote uuid;
begin
  perform public._assert(public._acts_for(b.provider_id, 'manager'), 'manager role required to send quotes');
  perform public._assert(b.status in ('inspecting', 'quote_sent', 'in_progress'), 'quote not allowed in this state');
  perform public._assert(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 30,
                         'quote needs 1 to 30 items');
  perform public._assert(not exists (
    select 1 from jsonb_array_elements(p_items) item
    where coalesce(item ->> 'travel_request_id', '') <> ''
  ), 'travel fee lines are managed automatically');

  if b.travel_request_id is not null then
    select r.* into v_request from public.travel_requests r where r.id = b.travel_request_id;
    perform public._assert(found and v_request.status = 'used', 'travel request is not attached to this booking');
    v_travel := v_request.quoted_fee;
    v_other := v_travel;
  end if;

  perform public._close_open_quotes(b.id);
  select coalesce(max(version), 0) + 1 into v_version from public.quotes where booking_id = b.id;
  insert into public.quotes (booking_id, version, total, note, is_change_order)
  values (b.id, v_version, 0, p_note, b.status = 'in_progress')
  returning id into v_quote;

  if b.travel_request_id is not null then
    insert into public.quote_items (quote_id, kind, title, qty, unit_price, travel_request_id)
    values (v_quote, 'other', 'Travel fee (' || v_request.distance_km || ' km)', 1, v_travel, v_request.id);
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind := (v_item ->> 'kind')::public.quote_item_kind;
    v_qty := (v_item ->> 'qty')::numeric;
    v_price := (v_item ->> 'unit_price')::int;
    perform public._assert(coalesce(trim(v_item ->> 'title'), '') <> '', 'item title is required');
    perform public._assert(v_qty > 0 and v_qty <= 1000, 'invalid quantity');
    perform public._assert(v_price >= 0 and v_price <= 10000000, 'invalid unit price');
    v_line := round(v_qty * v_price);
    case v_kind
      when 'labour' then v_labour := v_labour + v_line;
      when 'part' then v_parts := v_parts + v_line;
      else v_other := v_other + v_line;
    end case;
    insert into public.quote_items (quote_id, kind, title, qty, unit_price, bill_photo_url)
    values (v_quote, v_kind, trim(v_item ->> 'title'), v_qty, v_price, nullif(v_item ->> 'bill_photo_url', ''));
  end loop;

  update public.quotes
     set subtotal_labour = v_labour, subtotal_parts = v_parts, subtotal_other = v_other,
         subtotal_travel = v_travel, total = v_labour + v_parts + v_other
   where id = v_quote;

  if b.status = 'inspecting' then
    perform public._set_status(b.id, 'quote_sent', v_uid, 'quote v' || v_version);
  else
    perform public._log_event(b.id, v_uid,
      case when b.status = 'in_progress' then 'change order v' else 'quote v' end || v_version);
  end if;
  return v_quote;
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
  perform public._assert(public._acts_for(b.provider_id, 'manager'), 'manager role required to send quotes');
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

create or replace function public.send_proposal(
  p_request_id uuid,
  p_items jsonb,
  p_schedule jsonb,
  p_valid_until timestamptz,
  p_note text default null,
  p_deliverables jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_request public.service_requests;
  v_recipient public.request_recipients;
  v_item jsonb;
  v_row jsonb;
  v_kind public.quote_item_kind;
  v_seq int;
  v_total int := 0;
  v_schedule_total int := 0;
  v_version int;
  v_proposal uuid;
  v_due timestamptz;
  v_cancel jsonb := '{}'::jsonb;
  v_recipient_count int;
begin
  select * into v_request from public.service_requests where id = p_request_id for update;
  perform public._assert(found and v_request.status = 'open', 'request is not open');
  perform public._assert(v_request.expires_at > now(), 'request expired');
  perform public._assert(
    v_request.event_start >= now() + public._proposal_notice(v_request) - interval '5 minutes',
    'This event is too soon to be booked, so a proposal can''t be accepted. Ask the customer for a later date.');
  select count(*) into v_recipient_count
    from public.request_recipients rr
   where rr.request_id = p_request_id and public._acts_for(rr.provider_id, 'manager');
  perform public._assert(v_recipient_count = 1, 'request must be routed to exactly one business you manage');
  select * into v_recipient from public.request_recipients
   where request_id = p_request_id and public._acts_for(provider_id, 'manager');
  perform public._assert(found, 'provider was not routed this request');
  p_valid_until := least(coalesce(p_valid_until, v_request.expires_at), v_request.expires_at);
  perform public._assert(p_valid_until > now() + interval '15 minutes', 'this request expires too soon for a new proposal');
  perform public._assert(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 30,
                         'proposal needs 1 to 30 items');
  perform public._assert(jsonb_typeof(p_schedule) = 'array' and jsonb_array_length(p_schedule) between 1 and 8,
                         'proposal needs 1 to 8 payment milestones');
  perform public._assert(jsonb_typeof(coalesce(p_deliverables, '[]'::jsonb)) = 'array', 'deliverables must be an array');

  update public.proposals set status = 'withdrawn', updated_at = now()
   where request_id = p_request_id and provider_id = v_recipient.provider_id and status = 'sent';
  select coalesce(max(version), 0) + 1 into v_version from public.proposals
   where request_id = p_request_id and provider_id = v_recipient.provider_id;

  insert into public.proposals (
    request_id, provider_id, provider_service_id, version, total, valid_until, note, deliverables,
    cancellation_snapshot
  ) values (
    p_request_id, v_recipient.provider_id, v_recipient.provider_service_id, v_version, 1, p_valid_until,
    nullif(trim(coalesce(p_note, '')), ''), coalesce(p_deliverables, '[]'::jsonb), v_cancel
  ) returning id into v_proposal;

  for v_item, v_seq in
    select value, ordinality::int from jsonb_array_elements(p_items) with ordinality
  loop
    v_kind := (v_item ->> 'kind')::public.quote_item_kind;
    perform public._assert(coalesce(trim(v_item ->> 'title'), '') <> '', 'proposal item title is required');
    perform public._assert((v_item ->> 'qty')::numeric > 0 and (v_item ->> 'qty')::numeric <= 1000,
                           'proposal item quantity is invalid');
    perform public._assert((v_item ->> 'unit_price')::int >= 0 and (v_item ->> 'unit_price')::int <= 100000000,
                           'proposal item price is invalid');
    v_total := v_total + round((v_item ->> 'qty')::numeric * (v_item ->> 'unit_price')::int);
    insert into public.proposal_items (
      proposal_id, seq, kind, title, qty, unit, unit_price, bill_photo_url, metadata
    ) values (
      v_proposal, v_seq, v_kind, trim(v_item ->> 'title'), (v_item ->> 'qty')::numeric,
      nullif(trim(coalesce(v_item ->> 'unit', '')), ''), (v_item ->> 'unit_price')::int,
      nullif(v_item ->> 'bill_photo_url', ''), coalesce(v_item -> 'metadata', '{}'::jsonb)
    );
  end loop;
  perform public._assert(v_total > 0, 'proposal total must be positive');

  for v_row, v_seq in
    select value, ordinality::int from jsonb_array_elements(p_schedule) with ordinality
  loop
    perform public._assert(coalesce(trim(v_row ->> 'label'), '') <> '', 'milestone label is required');
    perform public._assert((v_row ->> 'amount')::int > 0, 'milestone amount must be positive');
    perform public._assert(v_row ->> 'due_rule' in (
      'at_booking', 'days_before_start:7', 'days_before_start:1', 'on_completion', 'on_delivery'
    ), 'milestone due rule is invalid');
    v_due := case v_row ->> 'due_rule'
      when 'at_booking' then now()
      when 'days_before_start:7' then v_request.event_start - interval '7 days'
      when 'days_before_start:1' then v_request.event_start - interval '1 day'
      else null
    end;
    v_schedule_total := v_schedule_total + (v_row ->> 'amount')::int;
    insert into public.proposal_schedule (proposal_id, seq, label, amount, due_rule, due_at)
    values (v_proposal, v_seq, trim(v_row ->> 'label'), (v_row ->> 'amount')::int, v_row ->> 'due_rule', v_due);
  end loop;
  perform public._assert(v_schedule_total = v_total, 'milestones must sum exactly to the proposal total');

  update public.proposals
     set total = v_total,
         pricing_snapshot = jsonb_build_object(
           'version', v_version, 'total', v_total,
           'items', (select jsonb_agg(row_to_json(x)) from (
             select seq, kind, title, qty, unit, unit_price, metadata
               from public.proposal_items where proposal_id = v_proposal order by seq
           ) x),
           'deliverables', coalesce(p_deliverables, '[]'::jsonb)
         ),
         payment_snapshot = jsonb_build_object(
           'schedule', (select jsonb_agg(row_to_json(x)) from (
             select seq, label, amount, due_rule, due_at
               from public.proposal_schedule where proposal_id = v_proposal order by seq
           ) x)
         ),
         updated_at = now()
   where id = v_proposal;

  perform public._queue_notification(
    v_request.customer_id, 'proposal_received', null, 'New proposal received',
    'A verified provider sent a proposal for your request.',
    jsonb_build_object('request_id', v_request.id, 'proposal_id', v_proposal),
    'proposal-received:' || v_request.id::text
  );
  return v_proposal;
end;
$$;

create or replace function public.withdraw_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.proposals;
begin
  select * into v_proposal from public.proposals where id = p_proposal_id for update;
  perform public._assert(found and public._acts_for(v_proposal.provider_id, 'manager'), 'proposal not found or manager role required');
  perform public._assert(v_proposal.status = 'sent', 'proposal is not open');
  update public.proposals set status = 'withdrawn', updated_at = now() where id = v_proposal.id;
end;
$$;

create or replace function public.send_request_message(p_request_id uuid, p_provider_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_request public.service_requests;
  v_body text := trim(coalesce(p_body, ''));
  v_message uuid;
  v_to uuid;
  v_kinds text[] := '{}';
begin
  select * into v_request from public.service_requests where id = p_request_id for share;
  perform public._assert(found, 'request not found');
  perform public._assert(exists (
    select 1 from public.request_recipients where request_id = p_request_id and provider_id = p_provider_id
  ), 'provider is not part of this request');
  perform public._assert(
    v_uid = v_request.customer_id or public._acts_for(p_provider_id, 'staff'),
    'not a request participant'
  );
  perform public._assert(v_request.status in ('open', 'closed'), 'request conversation is closed');
  perform public._assert(v_body <> '' and char_length(v_body) <= 2000, 'message is invalid');
  v_to := case when v_uid = v_request.customer_id then p_provider_id else v_request.customer_id end;
  v_kinds := public._leakage_signal_kinds(v_body);

  insert into public.request_messages (request_id, provider_id, sender_id, body)
  values (p_request_id, p_provider_id, v_uid, v_body)
  returning id into v_message;
  perform public._queue_notification(
    v_to, 'request_message', null, 'New request message',
    public._mask_preview(v_body), jsonb_build_object('request_id', p_request_id, 'provider_id', p_provider_id),
    'request-message:' || p_request_id::text || ':' || p_provider_id::text
  );
  return jsonb_build_object('message_id', v_message, 'nudge', cardinality(v_kinds) > 0);
end;
$$;

create or replace function public.get_my_business_sports_venues()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  select coalesce(jsonb_agg(jsonb_build_object(
    'venue', to_jsonb(v) || jsonb_build_object('business_role', public._business_role(v.owner_id)),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'venue_id', r.venue_id, 'activity_id', a.id, 'activity_slug', a.slug,
        'activity_name', a.name, 'name', r.name, 'slot_minutes', r.slot_minutes, 'active', r.active
      ) order by r.created_at)
        from public.sports_resources r join public.sports_activities a on a.id = r.activity_id
       where r.venue_id = v.id
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.weekday) from public.sports_hours h where h.venue_id = v.id
    ), '[]'::jsonb),
    'price_rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id, 'resource_id', pr.resource_id, 'weekday', pr.weekday, 'starts', pr.starts,
        'ends', pr.ends, 'price_paise', pr.price_paise, 'label', pr.label
      ) order by pr.weekday nulls first, pr.starts)
        from public.sports_price_rules pr join public.sports_resources r on r.id = pr.resource_id
       where r.venue_id = v.id
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'resource_id', b.resource_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'reason', b.reason
      ) order by b.starts_at)
        from public.sports_blocks b join public.sports_resources r on r.id = b.resource_id
       where r.venue_id = v.id
    ), '[]'::jsonb)
  ) order by v.created_at desc), '[]'::jsonb)
    into v_result
    from public.sports_venues v
   where public._acts_for(v.owner_id, 'staff');
  return v_result;
end;
$$;

create or replace function public.get_my_business_sports_bookings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_result jsonb;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'customer_id', b.customer_id, 'customer_name', p.full_name,
    'owner_id', v.owner_id, 'business_role', public._business_role(v.owner_id), 'venue_id', v.id, 'venue_name', v.name,
    'resource_id', r.id, 'resource_name', r.name, 'activity_name', a.name,
    'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
    'price_paise', b.price_paise, 'note', b.note, 'decision_reason', b.decision_reason,
    'expires_at', b.expires_at, 'decided_at', b.decided_at, 'created_at', b.created_at
  ) order by b.starts_at desc), '[]'::jsonb)
    into v_result
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
    join public.sports_resources r on r.id = b.resource_id
    join public.sports_activities a on a.id = r.activity_id
    join public.profiles p on p.id = b.customer_id
   where b.customer_id = v_uid or public._acts_for(v.owner_id, 'staff');
  return v_result;
end;
$$;

create or replace function public.get_business_sports_booking(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_result jsonb;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  select jsonb_build_object(
    'id', b.id, 'customer_id', b.customer_id, 'customer_name', p.full_name,
    'owner_id', v.owner_id, 'business_role', public._business_role(v.owner_id), 'venue_id', v.id, 'venue_name', v.name,
    'resource_id', r.id, 'resource_name', r.name, 'activity_name', a.name,
    'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
    'price_paise', b.price_paise, 'note', b.note, 'decision_reason', b.decision_reason,
    'expires_at', b.expires_at, 'decided_at', b.decided_at, 'created_at', b.created_at
  ) into v_result
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
    join public.sports_resources r on r.id = b.resource_id
    join public.sports_activities a on a.id = r.activity_id
    join public.profiles p on p.id = b.customer_id
   where b.id = p_id and (b.customer_id = v_uid or public._acts_for(v.owner_id, 'staff'));
  perform public._assert(v_result is not null, 'booking not found');
  return v_result;
end;
$$;

drop policy if exists sports_venues_read on public.sports_venues;
create policy sports_venues_read on public.sports_venues for select to anon, authenticated
  using (
    coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and (status = 'verified' or public._acts_for(owner_id, 'staff'))
  );
drop policy if exists sports_resources_read on public.sports_resources;
create policy sports_resources_read on public.sports_resources for select to anon, authenticated
  using (
    coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and (
      (active and exists (select 1 from public.sports_venues v where v.id = venue_id and v.status = 'verified'))
      or exists (select 1 from public.sports_venues v where v.id = venue_id and public._acts_for(v.owner_id, 'staff'))
    )
  );
drop policy if exists sports_hours_read on public.sports_hours;
create policy sports_hours_read on public.sports_hours for select to anon, authenticated
  using (
    coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and exists (
      select 1 from public.sports_venues v
       where v.id = venue_id and (v.status = 'verified' or public._acts_for(v.owner_id, 'staff'))
    )
  );
drop policy if exists sports_price_rules_read on public.sports_price_rules;
create policy sports_price_rules_read on public.sports_price_rules for select to anon, authenticated
  using (
    coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and exists (
      select 1 from public.sports_resources r
      join public.sports_venues v on v.id = r.venue_id
       where r.id = resource_id
         and ((r.active and v.status = 'verified') or public._acts_for(v.owner_id, 'staff'))
    )
  );
drop policy if exists sports_bookings_participant_read on public.sports_bookings;
create policy sports_bookings_participant_read on public.sports_bookings for select to authenticated
  using (
    coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and (
      customer_id = auth.uid()
      or exists (
        select 1 from public.sports_venues v where v.id = venue_id and public._acts_for(v.owner_id, 'staff')
      )
    )
  );

revoke execute on function public._business_role(uuid), public._acts_for(uuid, text),
  public._business_chat_participant(uuid) from public, anon;
grant execute on function public._business_role(uuid), public._acts_for(uuid, text),
  public._business_chat_participant(uuid) to anon, authenticated;
revoke execute on function public.list_business_members(uuid), public.add_business_member(uuid, uuid, text),
  public.remove_business_member(uuid, uuid), public.has_provider_business_access(),
  public.list_my_business_memberships(),
  public.get_provider_business_context(uuid), public.get_my_business_provider_jobs(uuid),
  public.get_booking_address(uuid), public.send_booking_message(uuid, text),
  public.get_my_business_shop(),
  public.get_my_business_sports_venues(), public.get_my_business_sports_bookings(),
  public.get_business_sports_booking(uuid) from public, anon;
grant execute on function public.list_business_members(uuid), public.add_business_member(uuid, uuid, text),
  public.remove_business_member(uuid, uuid), public.has_provider_business_access(),
  public.list_my_business_memberships(),
  public.get_provider_business_context(uuid), public.get_my_business_provider_jobs(uuid),
  public.get_booking_address(uuid), public.send_booking_message(uuid, text),
  public.get_my_business_shop(),
  public.get_my_business_sports_venues(), public.get_my_business_sports_bookings(),
  public.get_business_sports_booking(uuid) to authenticated;
revoke execute on function public.list_my_supplier_rfqs(), public.get_supplier_rfq_for_business(uuid, uuid),
  public.send_supplier_quote_for_business(uuid, uuid, jsonb, bigint, int, timestamptz, text),
  public.get_product_enquiry(uuid) from public, anon;
grant execute on function public.list_my_supplier_rfqs(), public.get_supplier_rfq_for_business(uuid, uuid),
  public.send_supplier_quote_for_business(uuid, uuid, jsonb, bigint, int, timestamptz, text),
  public.get_product_enquiry(uuid) to authenticated;
revoke execute on function public.send_quote(uuid, jsonb, text), public.send_fixed_addons(uuid, jsonb, text),
  public.send_proposal(uuid, jsonb, jsonb, timestamptz, text, jsonb),
  public.withdraw_proposal(uuid), public.get_booking_commission_rate(uuid),
  public.send_request_message(uuid, uuid, text) from public, anon;
grant execute on function public.send_quote(uuid, jsonb, text), public.send_fixed_addons(uuid, jsonb, text),
  public.send_proposal(uuid, jsonb, jsonb, timestamptz, text, jsonb),
  public.withdraw_proposal(uuid), public.get_booking_commission_rate(uuid),
  public.send_request_message(uuid, uuid, text) to authenticated;

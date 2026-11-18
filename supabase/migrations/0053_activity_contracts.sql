-- Phase 9: participant-scoped customer activity queries and unread totals.

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
  perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
  return query
    select r.id, r.title, c.name, r.city, r.area, r.needed_by, r.expires_at, r.created_at, r.status,
           (select count(*)::int from public.rfq_recipients rr where rr.rfq_id = r.id)
      from public.rfqs r
      join public.product_categories c on c.id = r.category_id
     where r.customer_id = v_uid
     order by r.created_at desc;
end;
$$;

create or replace function public.list_my_customer_sports_bookings()
returns table (
  id uuid,
  venue_name text,
  resource_name text,
  activity_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  price_paise int,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  return query
    select b.id, v.name, r.name, a.name, b.starts_at, b.ends_at, b.status, b.price_paise, b.expires_at
      from public.sports_bookings b
      join public.sports_venues v on v.id = b.venue_id
      join public.sports_resources r on r.id = b.resource_id
      join public.sports_activities a on a.id = r.activity_id
     where b.customer_id = v_uid
     order by b.starts_at desc;
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

  if public._shops_enquiries_enabled() then
    select coalesce(sum(e.customer_unread), 0)::int
      into v_shop
      from public.product_enquiries e
     where e.customer_id = v_uid;
  end if;

  if public._product_rfq_enabled() then
    select v_shop + count(*)::int
      into v_shop
      from public.notifications n
      join public.rfqs r on r.id::text = (n.data ->> 'rfq_id')
     where n.user_id = v_uid
       and n.read_at is null
       and n.kind = 'rfq_quote_received'
       and r.customer_id = v_uid;
  end if;

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

-- Detail routes do not otherwise clear these notification rows. Chat read state and enquiry read state
-- remain owned by mark_chat_read and mark_enquiry_read respectively.
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
    perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
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

revoke execute on function public.list_my_customer_rfqs(),
  public.list_my_customer_sports_bookings(),
  public.get_my_activity_unread_counts(),
  public.mark_my_activity_notification_read(text, uuid)
from public, anon;
grant execute on function public.list_my_customer_rfqs(),
  public.list_my_customer_sports_bookings(),
  public.get_my_activity_unread_counts(),
  public.mark_my_activity_notification_read(text, uuid)
to authenticated;

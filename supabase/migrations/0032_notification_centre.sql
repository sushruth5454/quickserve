-- In-app notification centre on top of the existing public.notifications outbox (0007): list, unread count, mark read,
-- and a chat heading ("Ravi · AC Repair") for in-app message banners. Recipients only; rows stay trigger-written.

create or replace function public._notification_category(n public.notifications)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select c.name from public.bookings b join public.categories c on c.id = b.category_id where b.id = n.booking_id),
    (select c.name from public.service_requests r join public.categories c on c.id = r.category_id
      where n.data ->> 'request_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and r.id = (n.data ->> 'request_id')::uuid),
    (select c.name from public.provider_services ps join public.categories c on c.id = ps.category_id
      where n.data ->> 'provider_service_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and ps.id = (n.data ->> 'provider_service_id')::uuid)
  );
$$;

revoke execute on function public._notification_category(public.notifications) from public, anon, authenticated;

create or replace function public.list_my_notifications(p_limit int default 50)
returns table (
  id uuid, kind text, title text, body text, data jsonb, count int, booking_id uuid,
  category_name text, at timestamptz, read_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.kind, n.title, n.body, n.data, n.count, n.booking_id,
         public._notification_category(n), greatest(n.created_at, n.updated_at), n.read_at
    from public.notifications n
   where n.user_id = public._require_uid()
   order by greatest(n.created_at, n.updated_at) desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- Chat messages are counted by the chat read-state (get_unread_counts), so only other kinds count here.
create or replace function public.count_unread_notifications()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.notifications n
   where n.user_id = public._require_uid()
     and n.read_at is null
     and n.kind <> 'chat_message';
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.notifications n
     set read_at = now()
   where n.user_id = public._require_uid()
     and n.read_at is null
     and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- "Ravi" + "AC Repair" for the other participant of a booking chat; null for non-participants.
create or replace function public.get_chat_heading(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'name', public._first_name(
             case when b.customer_id = auth.uid() then b.provider_id else b.customer_id end,
             case when b.customer_id = auth.uid() then 'Your pro' else 'Customer' end),
           'category', c.name)
    from public.bookings b
    left join public.categories c on c.id = b.category_id
   where b.id = p_booking_id
     and auth.uid() in (b.customer_id, b.provider_id);
$$;

revoke execute on function public.list_my_notifications(int), public.count_unread_notifications(),
  public.mark_notifications_read(uuid[]), public.get_chat_heading(uuid) from public, anon;
grant execute on function public.list_my_notifications(int), public.count_unread_notifications(),
  public.mark_notifications_read(uuid[]), public.get_chat_heading(uuid) to authenticated;

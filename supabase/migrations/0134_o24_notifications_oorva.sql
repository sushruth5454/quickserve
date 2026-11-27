alter table public.notifications
  add column if not exists event_at timestamptz default null;

create or replace function public._queue_notification(
  p_user uuid,
  p_kind text,
  p_booking uuid,
  p_title text,
  p_body text,
  p_data jsonb,
  p_collapse_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_schedule_id uuid;
  v_customer_id uuid;
  v_provider_id uuid;
begin
  if p_booking is null
     and left(p_kind, 10) = 'recurring_'
     and not (v_data ? 'url')
     and coalesce(v_data ->> 'recurring_schedule_id', '') ~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    v_schedule_id := (v_data ->> 'recurring_schedule_id')::uuid;
    select r.customer_id, r.provider_id
      into v_customer_id, v_provider_id
      from public.recurring_schedules r
     where r.id = v_schedule_id;
    if found then
      if p_user = v_provider_id then
        v_data := v_data || jsonb_build_object('url', '/recurring/provider/' || v_schedule_id);
      elsif p_user = v_customer_id then
        v_data := v_data || jsonb_build_object('url', '/recurring/' || v_schedule_id);
      end if;
    end if;
  end if;

  insert into public.notifications as n (
    user_id, kind, booking_id, title, body, data, collapse_key, event_at
  )
  values (
    p_user, p_kind, p_booking, left(p_title, 120), left(p_body, 300), v_data, p_collapse_key, now()
  )
  on conflict (user_id, collapse_key) where status = 'pending' and collapse_key is not null do update
    set count = n.count + 1,
        title = excluded.title,
        body = excluded.body,
        data = excluded.data,
        read_at = null,
        event_at = now(),
        updated_at = now();
end;
$$;

create or replace function public.list_my_notifications(p_limit int default 50)
returns table (
  id uuid,
  kind text,
  title text,
  body text,
  data jsonb,
  count int,
  booking_id uuid,
  category_name text,
  at timestamptz,
  read_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id,
         n.kind,
         n.title,
         n.body,
         case when jsonb_typeof(n.data) = 'object'
           then n.data || jsonb_build_object(
             '_notification_time_source',
             case when n.event_at is null then 'legacy_created_at' else 'queued_event' end
           )
           else n.data
         end,
         n.count,
         n.booking_id,
         public._notification_category(n),
         coalesce(n.event_at, n.created_at),
         n.read_at
    from public.notifications n
   where n.user_id = public._require_uid()
   order by coalesce(n.event_at, n.created_at) desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public._support_post(
  p_thread public.support_threads,
  p_sender uuid,
  p_from_admin boolean,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := trim(coalesce(p_body, ''));
  v_name text;
begin
  perform public._assert(char_length(v_body) between 1 and 2000, 'message must be 1 to 2000 characters');
  insert into public.support_messages (thread_id, sender_id, from_admin, body)
  values (p_thread.id, p_sender, p_from_admin, v_body);
  update public.support_threads
     set status = 'open',
         last_message = left(v_body, 200),
         last_from_admin = p_from_admin,
         last_message_at = now(),
         user_unread = case when p_from_admin then user_unread + 1 else 0 end,
         admin_unread = case when p_from_admin then 0 else admin_unread + 1 end
   where id = p_thread.id;
  if p_from_admin then
    perform public._queue_notification(
      p_thread.user_id,
      'support_reply',
      null,
      public._mask_preview('QuickServe support replied', 120),
      public._mask_preview(left(v_body, 300), 300),
      jsonb_build_object('url', '/support/' || p_thread.id, 'thread_id', p_thread.id),
      'support:' || p_thread.id::text
    );
  else
    select full_name into v_name from public.profiles where id = p_sender;
    perform public._queue_notification(
      a,
      'support_message',
      null,
      public._mask_preview(
        'Support: ' || coalesce(nullif(v_name, ''), 'a user') || ' · ' || p_thread.subject,
        120
      ),
      public._mask_preview(left(v_body, 300), 300),
      jsonb_build_object('url', '/admin/support/' || p_thread.id, 'thread_id', p_thread.id),
      'support-admin:' || p_thread.id::text
    )
      from public._admin_user_ids() a
     where a <> p_sender;
  end if;
end;
$$;

create or replace function public.get_unread_counts()
returns table (booking_id uuid, role text, unread int, last_message_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.id,
         case when b.customer_id = auth.uid() then 'customer' else 'provider' end,
         count(m.id)::int,
         max(m.created_at)
    from public.bookings b
    left join public.booking_chat_reads r on r.booking_id = b.id and r.user_id = auth.uid()
    join public.messages m
      on m.booking_id = b.id
     and m.sender_id <> auth.uid()
     and (
       auth.uid() = b.customer_id
       or auth.uid() = b.provider_id
       or m.sender_id = b.customer_id
     )
     and m.created_at > coalesce(r.last_read_at, '-infinity')
   where public._business_chat_participant(b.id)
   group by b.id, b.customer_id;
$$;

create or replace function public.get_chat_read_state(p_booking_id uuid)
returns table (my_last_read_at timestamptz, other_last_read_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select (select nullif(r.last_read_at, '-infinity')
            from public.booking_chat_reads r
           where r.booking_id = b.id and r.user_id = auth.uid()),
         (select nullif(r.last_read_at, '-infinity')
            from public.booking_chat_reads r
           where r.booking_id = b.id
             and r.user_id = case when b.customer_id = auth.uid() then b.provider_id else b.customer_id end)
    from public.bookings b
   where b.id = p_booking_id
     and public._business_chat_participant(b.id);
$$;

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
             case when b.customer_id = auth.uid() then 'Your pro' else 'Customer' end
           ),
           'category', c.name
         )
    from public.bookings b
    left join public.categories c on c.id = b.category_id
   where b.id = p_booking_id
     and public._business_chat_participant(b.id);
$$;

revoke execute on function public.list_my_notifications(int) from public, anon;
grant execute on function public.list_my_notifications(int) to authenticated;

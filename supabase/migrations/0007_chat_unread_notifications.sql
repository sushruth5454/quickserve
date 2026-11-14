-- Chat read state, unread counts, push devices and a generic notifications outbox.
--
-- Read state: one row per (booking, participant) with the time they last read the chat. Unread = messages from the
-- other participant newer than that. Sending a message marks the chat read for the sender. Rows are owner-readable
-- only; all writes go through RPCs.
--
-- Push: devices register Expo push tokens (push_devices, several per user). Events (new chat message, booking status
-- changes) write rows to public.notifications (the outbox). The Edge Function send-notifications claims due rows,
-- sends them through the Expo Push API, records tickets, checks receipts and removes dead tokens. It is kicked by a
-- trigger through pg_net (when the vault secrets project_url and cron_secret exist) and by a pg_cron safety-net job.

-- ---------------------------------------------------------------------------
-- Read state
-- ---------------------------------------------------------------------------
create table public.booking_chat_reads (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default '-infinity',
  -- Set while the chat screen is open and focused (heartbeat); new messages then skip the push.
  viewing_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (booking_id, user_id)
);
create index booking_chat_reads_user_idx on public.booking_chat_reads (user_id);
-- Unread counting filters a booking's messages by time and excludes the reader's own messages.
create index messages_booking_sender_idx on public.messages (booking_id, created_at, sender_id);

alter table public.booking_chat_reads enable row level security;
revoke all on public.booking_chat_reads from anon, authenticated;
grant select on public.booking_chat_reads to authenticated;
create policy booking_chat_reads_own on public.booking_chat_reads for select to authenticated using (user_id = auth.uid());

-- Existing chats: treat everything up to a participant's own latest message as read (they replied after it), so the
-- first release does not light up every old conversation. Later messages from the other side stay unread.
insert into public.booking_chat_reads (booking_id, user_id, last_read_at)
select m.booking_id, m.sender_id, max(m.created_at)
  from public.messages m
  join public.bookings b on b.id = m.booking_id and m.sender_id in (b.customer_id, b.provider_id)
 group by m.booking_id, m.sender_id
on conflict do nothing;

create or replace function public._unread_count(p_user uuid, p_booking uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.messages m
   where m.booking_id = p_booking
     and m.sender_id <> p_user
     and m.created_at > coalesce((select r.last_read_at from public.booking_chat_reads r
                                   where r.booking_id = p_booking and r.user_id = p_user), '-infinity');
$$;

create or replace function public._total_unread(p_user uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(public._unread_count(p_user, b.id)), 0)::int
    from public.bookings b
   where b.customer_id = p_user or b.provider_id = p_user;
$$;

-- Unread messages per booking for the signed-in user (only bookings with unread > 0) and which side they are on.
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
     and m.created_at > coalesce(r.last_read_at, '-infinity')
   where b.customer_id = auth.uid() or b.provider_id = auth.uid()
   group by b.id, b.customer_id;
$$;

-- Marks the chat read now (idempotent; never moves backwards). p_viewing: true = chat open and focused (presence for
-- 45 s, refreshed by the app), false = chat closed, null = leave presence unchanged. Pending chat pushes for this
-- booking are dropped because the user has now seen the messages.
create or replace function public.mark_chat_read(p_booking_id uuid, p_viewing boolean default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._is_participant(p_booking_id), 'not a participant of this booking');
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

-- Read state of both sides of one chat (for the "New messages" divider and "Seen" receipts). Participants only.
create or replace function public.get_chat_read_state(p_booking_id uuid)
returns table (my_last_read_at timestamptz, other_last_read_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select (select nullif(r.last_read_at, '-infinity') from public.booking_chat_reads r
           where r.booking_id = b.id and r.user_id = auth.uid()),
         (select nullif(r.last_read_at, '-infinity') from public.booking_chat_reads r
           where r.booking_id = b.id
             and r.user_id = case when b.customer_id = auth.uid() then b.provider_id else b.customer_id end)
    from public.bookings b
   where b.id = p_booking_id and auth.uid() in (b.customer_id, b.provider_id);
$$;

-- ---------------------------------------------------------------------------
-- Push devices (multiple per user). private_user_accounts.expo_push_token is legacy and no longer written.
-- ---------------------------------------------------------------------------
create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique check (token ~ '^Expo(nent)?PushToken\[[^\]]{8,}\]$'),
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_devices_user_idx on public.push_devices (user_id);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;
grant select on public.push_devices to authenticated;
create policy push_devices_own on public.push_devices for select to authenticated using (user_id = auth.uid());

-- A token belongs to one device; signing in as someone else on that device moves it to the new user.
create or replace function public.register_push_device(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(p_token ~ '^Expo(nent)?PushToken\[[^\]]{8,}\]$', 'invalid push token');
  perform public._assert(p_platform in ('ios', 'android', 'web'), 'invalid platform');
  insert into public.push_devices (user_id, token, platform)
  values (v_uid, p_token, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
  -- Bound the list per user (stale installs are also removed by DeviceNotRegistered receipts).
  delete from public.push_devices
   where user_id = v_uid
     and id not in (select id from public.push_devices where user_id = v_uid order by last_seen_at desc limit 10);
end;
$$;

create or replace function public.unregister_push_device(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_devices where token = p_token and user_id = public._require_uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications outbox (generic: chat messages and booking events today; reusable for any kind)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'chat_message', 'booking_requested', 'booking_accepted', 'booking_declined', 'booking_expired',
    'booking_cancelled', 'provider_en_route', 'quote_sent', 'change_order_sent', 'completion_requested'
  )),
  booking_id uuid references public.bookings (id) on delete cascade,
  title text not null check (char_length(title) <= 120),
  body text not null check (char_length(body) <= 300),
  data jsonb not null default '{}'::jsonb,
  -- Rows with the same key that are still pending are merged (e.g. "3 new messages"); also the device collapse id.
  collapse_key text,
  count int not null default 1,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz
);
create index notifications_due_idx on public.notifications (next_attempt_at) where status in ('pending', 'sending');
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create unique index notifications_pending_collapse_idx on public.notifications (user_id, collapse_key)
  where status = 'pending' and collapse_key is not null;
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
-- Readable by the recipient (future in-app notification centre); written only by triggers and service RPCs.
grant select on public.notifications to authenticated;
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());

create table public.push_tickets (
  ticket_id text primary key,
  notification_id uuid references public.notifications (id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now()
);
create index push_tickets_created_idx on public.push_tickets (created_at);
alter table public.push_tickets enable row level security;
revoke all on public.push_tickets from anon, authenticated;

-- Push previews never carry contact details: emails, UPI ids, links and phone-like digit runs are masked (same rules
-- as the assistant's redactPII plus links), whitespace is collapsed and the text is clipped.
create or replace function public._mask_preview(p_text text, p_max int default 120)
returns text
language sql
immutable
as $$
  with masked as (
    select btrim(regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(p_text, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
            '[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}', '[upi]', 'g'),
          '(https?://|www\.)\S+', '[link]', 'gi'),
        '\m[A-Za-z0-9-]+\.(com|in|net|org|io|co|app|me|ly|link|xyz|info|biz|page|site)\M(/\S*)?', '[link]', 'gi'),
      '(\+?\d[\s-]?){8,}\d', '[number]', 'g')) as t
  )
  select case when char_length(t) > p_max then rtrim(left(t, p_max - 1)) || '…' else t end
    from (select regexp_replace(t, '\s+', ' ', 'g') as t from masked) s;
$$;

create or replace function public._first_name(p_user uuid, p_fallback text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(split_part(btrim(p.full_name), ' ', 1), ''), p_fallback)
    from (select 1) one
    left join public.profiles p on p.id = p_user;
$$;

-- Queues one notification; a pending row with the same collapse key is merged instead (count + latest text).
create or replace function public._queue_notification(
  p_user uuid, p_kind text, p_booking uuid, p_title text, p_body text, p_data jsonb, p_collapse_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications as n (user_id, kind, booking_id, title, body, data, collapse_key)
  values (p_user, p_kind, p_booking, left(p_title, 120), left(p_body, 300), coalesce(p_data, '{}'::jsonb), p_collapse_key)
  on conflict (user_id, collapse_key) where status = 'pending' and collapse_key is not null do update
    set count = n.count + 1, title = excluded.title, body = excluded.body, data = excluded.data, updated_at = now();
end;
$$;

-- New chat message: the sender has read the chat; the other participant gets a push unless they are viewing it.
create or replace function public._on_message_inserted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_to uuid;
  v_viewing timestamptz;
begin
  insert into public.booking_chat_reads as r (booking_id, user_id, last_read_at)
  values (new.booking_id, new.sender_id, new.created_at)
  on conflict (booking_id, user_id) do update
    set last_read_at = greatest(r.last_read_at, excluded.last_read_at), updated_at = now();

  begin
    select * into b from public.bookings where id = new.booking_id;
    v_to := case when new.sender_id = b.customer_id then b.provider_id else b.customer_id end;
    select viewing_until into v_viewing from public.booking_chat_reads where booking_id = b.id and user_id = v_to;
    if v_viewing is null or v_viewing < now() then
      perform public._queue_notification(
        v_to, 'chat_message', b.id,
        public._first_name(new.sender_id, case when new.sender_id = b.provider_id then 'Your pro' else 'Customer' end),
        case when coalesce(btrim(new.body), '') = '' then 'Sent a photo' else public._mask_preview(new.body) end,
        jsonb_build_object('url', '/chat/' || b.id, 'booking_id', b.id),
        'chat:' || b.id);
    end if;
  exception when others then
    -- A notification problem must never block the chat itself.
    raise warning 'chat notification skipped: %', sqlerrm;
  end;
  return new;
end;
$$;

create trigger messages_after_insert after insert on public.messages
  for each row execute function public._on_message_inserted();

-- Booking status events that matter to the other party. Recipient is fixed per event; never the actor.
create or replace function public._on_booking_event_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_cat text;
  v_area text;
  v_pro text;
  v_to uuid;
  v_kind text;
  v_title text;
  v_body text;
begin
  begin
    select * into b from public.bookings where id = new.booking_id;
    select c.name into v_cat from public.categories c where c.id = b.category_id;
    v_pro := public._first_name(b.provider_id, 'Your pro');

    if new.to_status = 'requested' and new.from_status = 'pending_payment' then
      select a.city into v_area from public.addresses a where a.id = b.address_id;
      v_to := b.provider_id; v_kind := 'booking_requested';
      v_title := 'New job request';
      v_body := coalesce(v_cat, 'Service') || coalesce(' · ' || v_area, '') || ' · accept within 15 minutes';
    elsif new.to_status = 'accepted' and new.from_status is distinct from 'accepted' then
      v_to := b.customer_id; v_kind := 'booking_accepted';
      v_title := 'Booking accepted';
      v_body := v_pro || ' accepted your ' || coalesce(v_cat, 'service') || ' booking.';
    elsif new.to_status = 'declined' and new.from_status is distinct from 'declined' then
      v_to := b.customer_id; v_kind := 'booking_declined';
      v_title := 'Booking declined';
      v_body := v_pro || ' could not take this job. Your visit fee is being refunded.';
    elsif new.to_status = 'expired' and new.from_status is distinct from 'expired' then
      v_to := b.customer_id; v_kind := 'booking_expired';
      v_title := 'Request expired';
      v_body := 'The pro did not respond in time. Your visit fee is being refunded.';
    elsif new.to_status = 'cancelled' and new.from_status is distinct from 'cancelled' then
      v_to := b.provider_id; v_kind := 'booking_cancelled';
      v_title := 'Booking cancelled';
      v_body := 'The customer cancelled the ' || coalesce(v_cat, 'service') || ' booking.';
    elsif new.to_status = 'en_route' and new.from_status is distinct from 'en_route' then
      v_to := b.customer_id; v_kind := 'provider_en_route';
      v_title := v_pro || ' is on the way';
      v_body := 'Share your start code when they arrive.';
    elsif new.to_status = 'quote_sent' and new.from_status is distinct from 'quote_sent' then
      v_to := b.customer_id; v_kind := 'quote_sent';
      v_title := 'Quote received';
      v_body := v_pro || ' sent a quote. Review and approve it to start the work.';
    elsif new.from_status = new.to_status and new.note ~ '^(quote|change order) v[0-9]+$' then
      v_to := b.customer_id;
      v_kind := case when new.note like 'change order%' then 'change_order_sent' else 'quote_sent' end;
      v_title := case when v_kind = 'change_order_sent' then 'Change order received' else 'Updated quote received' end;
      v_body := v_pro || ' sent ' || case when v_kind = 'change_order_sent' then 'a change order' else 'a new quote' end
                || '. Review it in the app.';
    elsif new.to_status = 'completion_requested' and new.from_status is distinct from 'completion_requested' then
      v_to := b.customer_id; v_kind := 'completion_requested';
      v_title := 'Job marked complete';
      v_body := v_pro || ' finished the work. Check it and confirm completion.';
    else
      return null;
    end if;

    if v_to is null or v_to is not distinct from new.actor_id then
      return null;
    end if;
    perform public._queue_notification(v_to, v_kind, b.id, v_title, v_body,
      jsonb_build_object('url', '/booking/' || b.id, 'booking_id', b.id), null);
  exception when others then
    raise warning 'booking notification skipped: %', sqlerrm;
  end;
  return null;
end;
$$;

create trigger booking_events_notify after insert on public.booking_events
  for each row execute function public._on_booking_event_notify();

-- Wakes the sender right away through pg_net. Needs vault secrets 'project_url' (https://<ref>.supabase.co) and
-- 'cron_secret'. Without them (or without pg_net) this is a no-op and the cron job delivers within a minute.
create or replace function public._kick_notification_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  if to_regnamespace('net') is null or to_regnamespace('vault') is null then
    return null;
  end if;
  execute $q$select max(decrypted_secret) filter (where name = 'project_url'),
                    max(decrypted_secret) filter (where name = 'cron_secret')
               from vault.decrypted_secrets where name in ('project_url', 'cron_secret')$q$
    into v_url, v_secret;
  if v_url is null or v_secret is null then
    return null;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    using rtrim(v_url, '/') || '/functions/v1/send-notifications', '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret);
  return null;
exception when others then
  raise warning 'notification kick failed: %', sqlerrm;
  return null;
end;
$$;

create trigger notifications_kick after insert on public.notifications
  for each statement execute function public._kick_notification_sender();

-- ---------------------------------------------------------------------------
-- Service-role RPCs used by the send-notifications Edge Function
-- ---------------------------------------------------------------------------
-- Claims due rows (pending and due, or stuck in 'sending' for 5 min). Chat rows the recipient has meanwhile read and
-- rows for users without devices are skipped. Returns everything needed to build the Expo messages.
create or replace function public.claim_due_notifications(p_limit int default 100)
returns table (
  id uuid, user_id uuid, kind text, booking_id uuid, title text, body text, data jsonb,
  collapse_key text, count int, unread int, badge int, tokens text[], attempts int
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  n public.notifications;
  v_tokens text[];
  v_unread int;
begin
  for n in
    select * from public.notifications x
     where (x.status = 'pending' and x.next_attempt_at <= now())
        or (x.status = 'sending' and x.updated_at < now() - interval '5 minutes')
     order by x.next_attempt_at
     limit greatest(1, least(p_limit, 500))
     for update skip locked
  loop
    select array_agg(d.token order by d.last_seen_at desc) into v_tokens from public.push_devices d where d.user_id = n.user_id;
    v_unread := case when n.kind = 'chat_message' then public._unread_count(n.user_id, n.booking_id) else 0 end;
    if n.kind = 'chat_message' and v_unread = 0 then
      update public.notifications set status = 'skipped', last_error = 'read', updated_at = now() where notifications.id = n.id;
      continue;
    end if;
    if v_tokens is null then
      update public.notifications set status = 'skipped', last_error = 'no_device', updated_at = now() where notifications.id = n.id;
      continue;
    end if;
    update public.notifications set status = 'sending', attempts = notifications.attempts + 1, updated_at = now()
     where notifications.id = n.id;
    id := n.id; user_id := n.user_id; kind := n.kind; booking_id := n.booking_id; title := n.title; body := n.body;
    data := n.data; collapse_key := n.collapse_key; count := n.count; unread := v_unread;
    badge := public._total_unread(n.user_id); tokens := v_tokens; attempts := n.attempts + 1;
    return next;
  end loop;
end;
$$;

-- Records the outcome of one claimed notification. p_tickets: [{"id": "<ticket id>", "token": "<token>"}] accepted
-- by Expo; p_dead_tokens are removed (DeviceNotRegistered). Failures retry with backoff (1, 2, 4, 8 min), then 'failed'.
create or replace function public.finish_notification(
  p_id uuid, p_ok boolean, p_error text default null, p_tickets jsonb default '[]'::jsonb, p_dead_tokens text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_devices where token = any (coalesce(p_dead_tokens, '{}'));
  insert into public.push_tickets (ticket_id, notification_id, token)
  select t ->> 'id', p_id, t ->> 'token'
    from jsonb_array_elements(coalesce(p_tickets, '[]'::jsonb)) t
   where coalesce(t ->> 'id', '') <> '' and coalesce(t ->> 'token', '') <> ''
  on conflict (ticket_id) do nothing;
  if p_ok then
    update public.notifications set status = 'sent', sent_at = now(), last_error = null, updated_at = now()
     where id = p_id;
  else
    update public.notifications
       set status = case when attempts >= 5 then 'failed' else 'pending' end,
           next_attempt_at = now() + make_interval(mins => power(2, least(attempts, 5) - 1)::int),
           last_error = left(p_error, 500),
           updated_at = now()
     where id = p_id;
  end if;
end;
$$;

-- Tickets whose receipts are due (Expo recommends checking ~15 min after sending; receipts live 24 h).
create or replace function public.claim_push_receipts(p_limit int default 1000)
returns table (ticket_id text, token text)
language sql
security definer
set search_path = public
as $$
  select t.ticket_id, t.token from public.push_tickets t
   where t.created_at < now() - interval '15 minutes'
   order by t.created_at
   limit greatest(1, least(p_limit, 1000));
$$;

-- Drops checked tickets, tickets older than 24 h (receipt expired) and dead tokens.
create or replace function public.resolve_push_receipts(p_ticket_ids text[], p_dead_tokens text[] default '{}')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_devices where token = any (coalesce(p_dead_tokens, '{}'));
  delete from public.push_tickets where ticket_id = any (coalesce(p_ticket_ids, '{}')) or created_at < now() - interval '24 hours';
  -- Keep the outbox small: delivered/skipped rows older than 30 days are history only.
  delete from public.notifications where status in ('sent', 'skipped', 'failed') and created_at < now() - interval '30 days';
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public._unread_count(uuid, uuid),
  public._total_unread(uuid),
  public._mask_preview(text, int),
  public._first_name(uuid, text),
  public._queue_notification(uuid, text, uuid, text, text, jsonb, text),
  public._on_message_inserted(),
  public._on_booking_event_notify(),
  public._kick_notification_sender(),
  public.claim_due_notifications(int),
  public.finish_notification(uuid, boolean, text, jsonb, text[]),
  public.claim_push_receipts(int),
  public.resolve_push_receipts(text[], text[])
from public, anon, authenticated;

grant execute on function
  public.claim_due_notifications(int),
  public.finish_notification(uuid, boolean, text, jsonb, text[]),
  public.claim_push_receipts(int),
  public.resolve_push_receipts(text[], text[])
to service_role;

revoke execute on function
  public.get_unread_counts(),
  public.mark_chat_read(uuid, boolean),
  public.get_chat_read_state(uuid),
  public.register_push_device(text, text),
  public.unregister_push_device(text)
from public, anon;

grant execute on function
  public.get_unread_counts(),
  public.mark_chat_read(uuid, boolean),
  public.get_chat_read_state(uuid),
  public.register_push_device(text, text),
  public.unregister_push_device(text)
to authenticated;

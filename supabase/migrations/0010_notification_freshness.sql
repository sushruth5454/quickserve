-- Notifications only for live events. Seed scripts, imports and backfills insert back-dated booking_events/messages;
-- those must update read state but never queue pushes ("Ravi accepted your booking" for a job from last month).

drop trigger if exists booking_events_notify on public.booking_events;
create trigger booking_events_notify after insert on public.booking_events
  for each row when (new.at > now() - interval '10 minutes')
  execute function public._on_booking_event_notify();

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

  if new.created_at < now() - interval '10 minutes' then
    return new;
  end if;

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
revoke execute on function public._on_message_inserted() from public, anon, authenticated;

-- Rows queued by back-dated events before this guard existed are history, not news.
update public.notifications n
   set status = 'skipped', last_error = 'stale_event', updated_at = now()
 where n.status = 'pending'
   and n.kind <> 'chat_message'
   and not exists (select 1 from public.booking_events e
                    where e.booking_id = n.booking_id and e.at > now() - interval '10 minutes');
update public.notifications n
   set status = 'skipped', last_error = 'stale_event', updated_at = now()
 where n.status = 'pending'
   and n.kind = 'chat_message'
   and not exists (select 1 from public.messages m
                    where m.booking_id = n.booking_id and m.created_at > now() - interval '10 minutes');

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values (
  'creator_revisions', false, 'Creator revisions',
  'Customers can ask creators to revise delivered work.', 'Creators', 10
)
on conflict (key) do nothing;

alter table public.bookings
  add column if not exists revisions_allowed int not null default 2
    check (revisions_allowed between 0 and 10),
  add column if not exists revisions_used int not null default 0
    check (revisions_used >= 0);

alter table public.bookings
  drop constraint if exists bookings_delivery_status_check;
alter table public.bookings
  add constraint bookings_delivery_status_check
    check (delivery_status in ('not_applicable', 'pending', 'submitted', 'revision_requested', 'accepted'));

insert into public.archetype_transitions (archetype, from_status, to_status, actor)
values ('proposal', 'completion_requested', 'delivery_pending', 'customer')
on conflict do nothing;

create or replace function public._set_proposal_revisions_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archetype text;
  v_qty int;
begin
  select c.archetype into v_archetype
    from public.categories c
   where c.id = new.category_id;

  if v_archetype = 'proposal' and jsonb_typeof(new.delivery_snapshot) = 'array' then
    select (item.value ->> 'qty')::int into v_qty
      from jsonb_array_elements(new.delivery_snapshot) as item(value)
     where item.value ->> 'type' = 'revisions'
       and item.value ->> 'qty' ~ '^(0|[1-9]|10)$'
     limit 1;
    if found then
      new.revisions_allowed := v_qty;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_set_revisions_allowed on public.bookings;
create trigger bookings_set_revisions_allowed
  before insert on public.bookings
  for each row execute function public._set_proposal_revisions_allowed();

create or replace function public.request_revision(p_booking_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_note text := trim(coalesce(p_note, ''));
begin
  perform public._assert(public._feature_enabled('creator_revisions'), 'creator revisions are not enabled');
  perform public._assert(b.customer_id = v_uid, 'only the customer can request revisions');
  perform public._assert(
    b.archetype = 'proposal'
    and b.status = 'completion_requested'
    and b.delivery_status = 'submitted',
    'delivery is not available for revision'
  );
  perform public._assert(b.revisions_used < b.revisions_allowed, 'no revisions remaining');
  perform public._assert(
    char_length(v_note) between 5 and 1000,
    'revision note must be between 5 and 1000 characters'
  );

  update public.bookings
     set delivery_status = 'revision_requested',
         revisions_used = revisions_used + 1,
         completion_requested_at = null
   where id = b.id;

  perform public._set_status(b.id, 'delivery_pending', v_uid, 'revision requested: ' || v_note);
  perform public._queue_notification(
    b.provider_id, 'revision_requested', b.id, 'Revision requested',
    'The customer requested changes: ' || v_note,
    jsonb_build_object(
      'booking_id', b.id,
      'revisions_used', b.revisions_used + 1,
      'revisions_allowed', b.revisions_allowed,
      'note', v_note
    ),
    'revision:' || b.id::text
  );
end;
$$;

create or replace function public.submit_delivery(p_booking_id uuid, p_links jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_link jsonb;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can submit delivery');
  perform public._assert(b.archetype = 'proposal' and b.status = 'delivery_pending', 'delivery is not ready to submit');
  perform public._assert(b.delivery_status in ('pending', 'revision_requested'), 'delivery was already submitted');
  perform public._assert(jsonb_typeof(p_links) = 'array' and jsonb_array_length(p_links) between 1 and 20,
                         'submit 1 to 20 delivery links');
  for v_link in select value from jsonb_array_elements(p_links)
  loop
    perform public._assert(
      jsonb_typeof(v_link) = 'object'
      and coalesce(v_link ->> 'url', '') ~ '^https://[^[:space:]]+$',
      'every delivery item needs a full https URL'
    );
  end loop;
  update public.bookings
     set delivery_links = p_links, delivery_status = 'submitted', delivery_submitted_at = now(),
         completion_requested_at = now()
   where id = b.id;
  update public.payment_schedule
     set status = case when status = 'paid' then status else 'due' end,
         due_at = coalesce(due_at, now())
   where booking_id = b.id and due_rule = 'on_delivery';
  perform public._set_status(b.id, 'completion_requested', v_uid, 'deliverables submitted');
  perform public._queue_notification(
    b.customer_id, 'delivery_submitted', b.id, 'Your deliverables are ready',
    'Review the delivery and pay any final milestone to complete the booking.',
    jsonb_build_object('booking_id', b.id), 'delivery:' || b.id::text
  );
end;
$$;

alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'chat_message', 'booking_requested', 'booking_accepted', 'booking_declined', 'booking_expired',
    'booking_cancelled', 'provider_en_route', 'quote_sent', 'change_order_sent', 'completion_requested',
    'travel_request_created', 'travel_request_approved', 'travel_request_declined', 'travel_request_expired',
    'proposal_request_received', 'proposal_received', 'proposal_booked', 'proposal_hold_expired',
    'request_message', 'milestone_due', 'delivery_submitted', 'support_message', 'support_reply',
    'revision_requested'
  ));

revoke execute on function public._set_proposal_revisions_allowed() from public, anon, authenticated;
revoke execute on function public.request_revision(uuid, text) from public, anon, authenticated;
grant execute on function public.request_revision(uuid, text) to authenticated;

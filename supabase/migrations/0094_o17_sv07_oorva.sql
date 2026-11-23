begin;

create or replace function public.respond_visit_reschedule(
  p_change_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  c public.recurring_occurrence_changes;
  b public.bookings;
  r public.recurring_schedules;
  v_requester_is_customer boolean;
  v_duration interval;
  v_new_window tstzrange;
  v_kind text;
  v_recipient uuid;
begin
  perform public._assert(public._recurring_feature('recurring_reschedule'), 'Recurring rescheduling is turned off right now.');
  perform public._assert(p_accept is not null, 'reschedule decision is required');
  select * into c from public.recurring_occurrence_changes where id = p_change_id for update;
  perform public._assert(found and c.kind = 'reschedule_requested', 'reschedule request not found');
  select * into r from public.recurring_schedules where id = c.schedule_id for update;
  perform public._assert(found, 'recurring visit not found');
  begin
    select * into b
      from public.bookings
     where id = c.booking_id
     for update nowait;
  exception
    when lock_not_available then
      raise exception 'booking is being updated; retry reschedule response'
        using errcode = '55P03';
  end;
  if b.id is null then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  perform public._assert(b.recurring_schedule_id = r.id, 'recurring visit not found');
  v_requester_is_customer := c.actor_id = b.customer_id;
  if v_requester_is_customer then
    perform public._assert(public._acts_for(b.provider_id, 'manager'), 'only the provider manager can respond');
  else
    perform public._assert(v_uid = b.customer_id, 'only the other party can respond');
  end if;

  if exists (
    select 1
      from public.recurring_occurrence_changes outcome
     where outcome.booking_id = c.booking_id
       and outcome.occurrence_date = c.occurrence_date
       and outcome.original_at = c.original_at
       and outcome.new_at = c.new_at
       and outcome.kind in ('rescheduled', 'reschedule_declined')
  ) then
    return;
  end if;
  if p_accept then
    perform public._assert(
      b.status::text in ('pending_payment', 'requested', 'accepted', 'confirmed'),
      'visit can no longer be rescheduled'
    );
  end if;
  perform public._assert(b.scheduled_at = c.original_at, 'visit changed after the reschedule request');

  if p_accept then
    perform public._assert(
      c.new_at is not null and c.new_at > now() + interval '60 minutes',
      'reschedule time must remain more than 60 minutes ahead when accepted'
    );
    v_duration := coalesce(upper(b.service_window) - lower(b.service_window),
      make_interval(mins => coalesce(b.session_duration_min, 60)));
    v_new_window := tstzrange(c.new_at, c.new_at + v_duration, '[)');
    perform public._assert_provider_not_paused(b.provider_id);
    perform public._assert_recurring_provider_window(b.provider_id, v_new_window, b.id);
    perform public._assert_provider_window_free(b.provider_id, v_new_window, b.id, true);
    update public.bookings
       set scheduled_at = c.new_at, service_window = v_new_window, updated_at = now()
     where id = b.id;
    v_kind := 'rescheduled';
  else
    v_kind := 'reschedule_declined';
  end if;

  insert into public.recurring_occurrence_changes (
    schedule_id, booking_id, occurrence_date, original_at, kind, new_at, actor_id, reason
  ) values (
    r.id, b.id, c.occurrence_date, c.original_at, v_kind, c.new_at, v_uid, null
  );
  v_recipient := c.actor_id;
  perform public._queue_notification(
    v_recipient,
    case when p_accept then 'recurring_visit_rescheduled' else 'recurring_visit_reschedule_declined' end,
    b.id,
    case when p_accept then 'Visit rescheduled' else 'Reschedule declined' end,
    case when p_accept then 'The recurring visit time was updated.' else 'The reschedule request was declined.' end,
    jsonb_build_object('recurring_schedule_id', r.id, 'change_id', c.id, 'new_at', case when p_accept then c.new_at else null end),
    'recurring-reschedule-response:' || c.id
  );
end;
$$;

commit;

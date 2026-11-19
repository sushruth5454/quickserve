-- WP H2b; owns: _queue_notification, queue_recurring_reminders, _recurring_plan_payload;
-- sources: WS2-T06, WS2-T09, WS7-T02

do $$
declare
  v_constraint oid;
  v_definition text;
  v_expression text;
begin
  select c.oid
    into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.notifications'::regclass
     and c.conname = 'notifications_kind_check'
     and c.contype = 'c';
  if v_constraint is not null then
    v_definition := pg_get_constraintdef(v_constraint);
    v_expression := substring(v_definition from 8 for char_length(v_definition) - 8);
    alter table public.notifications drop constraint notifications_kind_check;
    execute format(
      'alter table public.notifications add constraint notifications_kind_check check ((%s) or kind in (%s))',
      v_expression,
      quote_literal('recurring_visit_payment_due')
    );
  else
    alter table public.notifications add constraint notifications_kind_check check (kind is not null);
  end if;
end;
$$;

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

  insert into public.notifications as n (user_id, kind, booking_id, title, body, data, collapse_key)
  values (p_user, p_kind, p_booking, left(p_title, 120), left(p_body, 300), v_data, p_collapse_key)
  on conflict (user_id, collapse_key) where status = 'pending' and collapse_key is not null do update
    set count = n.count + 1, title = excluded.title, body = excluded.body, data = excluded.data, updated_at = now();
end;
$$;

create or replace function public.queue_recurring_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_hours int := coalesce(nullif(public._recurring_rule('reminder_hours_before'), '')::int, 12);
  v_count int := 0;
  v_collapse_key text;
begin
  if not public._recurring_feature('recurring_reminders') then
    return 0;
  end if;

  for b in
    select bk.id, bk.customer_id, bk.provider_id, bk.scheduled_at, r.id schedule_id
      from public.bookings bk
      join public.recurring_schedules r on r.id = bk.recurring_schedule_id
     where r.status = 'active'
       and r.provider_acceptance = 'accepted'
       and bk.status::text in ('pending_payment', 'requested', 'accepted', 'confirmed')
       and bk.scheduled_at > now()
       and bk.scheduled_at <= now() + make_interval(hours => v_hours)
     order by bk.scheduled_at
     limit 1000
     for update of bk skip locked
  loop
    v_collapse_key := 'recurring-reminder:' || b.id;
    if not exists (
      select 1 from public.notifications n
       where n.user_id = b.customer_id
         and n.kind = 'recurring_visit_upcoming'
         and n.collapse_key = v_collapse_key
    ) then
      perform public._queue_notification(
        b.customer_id, 'recurring_visit_upcoming', b.id, 'Upcoming recurring visit',
        'You have an upcoming home-service visit.',
        jsonb_build_object('recurring_schedule_id', b.schedule_id, 'scheduled_at', b.scheduled_at),
        v_collapse_key
      );
      v_count := v_count + 1;
    end if;
  end loop;

  for b in
    select bk.id, bk.customer_id, bk.scheduled_at, r.id schedule_id,
           (
             select min(ps.due_at)
               from public.payment_schedule ps
              where ps.booking_id = bk.id
                and ps.status in ('due', 'upcoming')
                and ps.due_at is not null
                and ps.due_at <= now()
           ) due_at
      from public.bookings bk
      join public.recurring_schedules r on r.id = bk.recurring_schedule_id
     where r.billing_frequency = 'per_visit'
       and bk.status::text = 'pending_payment'
       and bk.scheduled_at > now()
       and exists (
         select 1
           from public.payment_schedule ps
          where ps.booking_id = bk.id
            and ps.status in ('due', 'upcoming')
            and ps.due_at is not null
            and ps.due_at <= now()
       )
       and not exists (
         select 1
           from public.notifications n
          where n.user_id = bk.customer_id
            and n.kind = 'recurring_visit_payment_due'
            and n.collapse_key = 'recurring-pay:' || bk.id
       )
     order by bk.scheduled_at
     limit 1000
     for update of bk skip locked
  loop
    v_collapse_key := 'recurring-pay:' || b.id;
    perform public._queue_notification(
      b.customer_id,
      'recurring_visit_payment_due',
      b.id,
      'Payment due for your visit',
      'Pay for this recurring visit before the day prior to its scheduled time.',
      jsonb_build_object(
        'recurring_schedule_id', b.schedule_id,
        'scheduled_at', b.scheduled_at,
        'due_at', b.due_at
      ),
      v_collapse_key
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public._recurring_plan_payload(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.recurring_schedules;
  v_plan jsonb;
  v_occurrences jsonb;
  v_changes jsonb;
  v_commission_config jsonb;
  v_category_bp int;
  v_provider_bp int;
  v_commission_bp int;
  v_provider_created_at timestamptz;
  v_repeat_customer boolean := false;
  v_commission int := 0;
  v_gst int := 0;
  v_net_estimate int;
begin
  select * into r from public.recurring_schedules where id = p_id;
  if not found then
    return null;
  end if;

  if r.per_visit_paise is not null then
    select p.created_at
      into v_provider_created_at
      from public.providers p
     where p.id = r.provider_id;
    select c.commission_bp
      into v_category_bp
      from public.provider_services ps
      join public.categories c on c.id = ps.category_id
     where ps.id = r.provider_service_id;
    select c.value
      into v_commission_config
      from public.app_config c
     where c.key = 'commission';
    v_commission_config := coalesce(v_commission_config, '{
      "founding_days":30,
      "repeat_discount_bp":400,
      "repeat_floor_bp":500,
      "time_based":{"recurring_bp":800}
    }'::jsonb);

    if r.archetype = 'time_based' then
      if v_provider_created_at is not null
         and now() < v_provider_created_at + make_interval(
           days => coalesce(nullif(v_commission_config ->> 'founding_days', '')::int, 30)
         )
      then
        v_commission_bp := 0;
      else
        v_commission_bp := coalesce(
          v_category_bp,
          nullif(v_commission_config -> 'time_based' ->> 'recurring_bp', '')::int,
          800
        );
      end if;
    else
      v_provider_bp := public._commission_bp(r.provider_id, now());
      if coalesce(v_provider_bp, 0) = 0 then
        v_commission_bp := 0;
      else
        v_commission_bp := coalesce(v_category_bp, v_provider_bp);
        select exists (
          select 1
            from public.bookings prior
           where prior.provider_id = r.provider_id
             and prior.customer_id = r.customer_id
             and prior.completed_at is not null
             and prior.completed_at >= now() - interval '12 months'
             and prior.completed_at <= now()
             and prior.status in ('completed', 'closed')
        ) into v_repeat_customer;
        if v_repeat_customer and v_commission_bp > 0 then
          v_commission_bp := greatest(
            v_commission_bp - coalesce(nullif(v_commission_config ->> 'repeat_discount_bp', '')::int, 400),
            coalesce(nullif(v_commission_config ->> 'repeat_floor_bp', '')::int, 500)
          );
        end if;
      end if;
    end if;

    v_commission := round(r.per_visit_paise::numeric * coalesce(v_commission_bp, 0) / 10000)::int;
    v_gst := round(v_commission::numeric * 18 / 100)::int;
    v_net_estimate := greatest(r.per_visit_paise - v_commission - v_gst, 0);
  end if;

  select jsonb_build_object(
    'id', r.id,
    'customer_id', r.customer_id,
    'provider_id', r.provider_id,
    'provider_service_id', r.provider_service_id,
    'service_package_id', r.service_package_id,
    'plan_version', r.plan_version,
    'frequency', r.frequency,
    'interval_count', r.interval_count,
    'weekdays', to_jsonb(r.weekdays),
    'month_day', r.month_day,
    'custom_dates', to_jsonb(r.custom_dates),
    'start_time', r.start_time,
    'timezone', r.timezone,
    'session_duration_min', r.session_duration_min,
    'payment_mode', r.payment_mode,
    'billing_frequency', r.billing_frequency,
    'archetype', r.archetype,
    'package_qty', r.package_qty,
    'per_visit_paise', r.per_visit_paise,
    'net_estimate_paise', case
      when r.customer_id <> auth.uid() and public._acts_for(r.provider_id, 'staff')
      then v_net_estimate
      else null
    end,
    'provider_acceptance', r.provider_acceptance,
    'acceptance_mode', r.acceptance_mode,
    'decided_at', r.decided_at,
    'decline_reason', r.decline_reason,
    'paused_at', r.paused_at,
    'pause_until', r.pause_until,
    'address_line', case
      when r.customer_id = auth.uid()
        or (r.provider_acceptance = 'accepted' and r.status in ('active', 'paused'))
      then r.address_line
      else null
    end,
    'city', r.city,
    'lat', case
      when r.customer_id = auth.uid()
        or (r.provider_acceptance = 'accepted' and r.status in ('active', 'paused'))
      then r.lat
      else null
    end,
    'lng', case
      when r.customer_id = auth.uid()
        or (r.provider_acceptance = 'accepted' and r.status in ('active', 'paused'))
      then r.lng
      else null
    end,
    'description', r.description,
    'starts_on', r.starts_on,
    'ends_on', r.ends_on,
    'generated_through', r.generated_through,
    'max_occurrences', r.max_occurrences,
    'occurrences_created', r.occurrences_created,
    'status', r.status,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'cancelled_at', r.cancelled_at
  ) into v_plan;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'scheduled_at', b.scheduled_at,
    'service_window', b.service_window::text,
    'status', b.status::text,
    'total_amount', b.total_amount,
    'archetype', b.archetype,
    'service_package_id', b.service_package_id
  ) order by b.scheduled_at), '[]'::jsonb)
    into v_occurrences
    from public.bookings b
   where b.recurring_schedule_id = r.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'booking_id', c.booking_id,
    'occurrence_date', c.occurrence_date,
    'original_at', c.original_at,
    'kind', c.kind,
    'new_at', c.new_at,
    'actor_id', c.actor_id,
    'reason', c.reason,
    'created_at', c.created_at
  ) order by c.created_at), '[]'::jsonb)
    into v_changes
    from public.recurring_occurrence_changes c
   where c.schedule_id = r.id;

  return jsonb_build_object(
    'plan', v_plan,
    'occurrences', v_occurrences,
    'changes', v_changes
  );
end;
$$;

begin;

create or replace function public.quote_recurring_plan(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_quote jsonb;
  v_rules jsonb;
  v_due_hours int;
  v_grace_hours int;
begin
  v_quote := public._recurring_plan_quote(p, v_uid) -> 'quote';
  select value into v_rules from public.app_config where key = 'recurring_rules';
  v_due_hours := coalesce(nullif(v_rules ->> 'payment_due_hours_before', '')::int, 48);
  v_grace_hours := coalesce(nullif(v_rules ->> 'billing_grace_hours', '')::int, 24);

  return v_quote || jsonb_build_object(
    'acceptance_mode', case
      when public._recurring_feature('recurring_plan_acceptance') then 'plan'
      else 'occurrence'
    end,
    'payment_window', jsonb_build_object(
      'due_hours_before', v_due_hours,
      'grace_hours', v_grace_hours,
      'release_cutoff_minutes_before_visit', 30
    )
  );
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
  v_grace_hours int;
  v_skip_cutoff_hours int;
  v_reschedule_cutoff_hours int;
begin
  select * into r from public.recurring_schedules where id = p_id;
  if not found then
    return null;
  end if;

  select coalesce(nullif(c.value ->> 'billing_grace_hours', '')::int, 24),
         coalesce(nullif(c.value ->> 'skip_cutoff_hours', '')::int, 12),
         coalesce(nullif(c.value ->> 'reschedule_cutoff_hours', '')::int, 12)
    into v_grace_hours, v_skip_cutoff_hours, v_reschedule_cutoff_hours
    from public.app_config c
   where c.key = 'recurring_rules';
  v_grace_hours := coalesce(v_grace_hours, 24);
  v_skip_cutoff_hours := coalesce(v_skip_cutoff_hours, 12);
  v_reschedule_cutoff_hours := coalesce(v_reschedule_cutoff_hours, 12);

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
    'capabilities', jsonb_build_object(
      'can_cancel', coalesce(r.customer_id = auth.uid(), false) and (
        r.status in ('active', 'paused')
        or (
          r.status = 'completed'
          and exists (
            select 1
              from public.bookings bk
             where bk.recurring_schedule_id = r.id
               and bk.scheduled_at > now()
               and bk.status::text in (
                 'pending_payment', 'requested', 'accepted', 'confirmed', 'en_route',
                 'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress',
                 'completion_requested'
               )
          )
        )
      ),
      'can_pause', coalesce(r.customer_id = auth.uid(), false)
        and r.status = 'active'
        and r.provider_acceptance <> 'pending'
        and public._recurring_feature('recurring_skip_pause'),
      'can_resume', coalesce(r.customer_id = auth.uid(), false)
        and r.status = 'paused'
        and public._recurring_feature('recurring_skip_pause'),
      'can_reschedule', (
        coalesce(r.customer_id = auth.uid(), false)
        or coalesce(public._acts_for(r.provider_id, 'manager'), false)
      ) and public._recurring_feature('recurring_reschedule')
    ),
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
    'service_package_id', b.service_package_id,
    'remaining_due_paise', case
      when r.customer_id = auth.uid() and r.billing_frequency = 'per_visit'
      then coalesce((
        select sum(ps.amount)::bigint
          from public.payment_schedule ps
         where ps.booking_id = b.id and ps.status = 'due'
      ), 0)
      else null
    end,
    'payment_due_at', case
      when r.customer_id = auth.uid() and r.billing_frequency = 'per_visit'
      then case
        when exists (
          select 1 from public.payment_schedule ps
           where ps.booking_id = b.id and ps.status = 'due' and ps.due_at is null
        ) then null
        else (
          select min(ps.due_at)
            from public.payment_schedule ps
           where ps.booking_id = b.id and ps.status = 'due'
        )
      end
      else null
    end,
    'payment_expires_at', case
      when r.customer_id = auth.uid() and r.billing_frequency = 'per_visit'
        and b.status::text = 'pending_payment'
        and exists (
          select 1 from public.payment_schedule ps
           where ps.booking_id = b.id and ps.status in ('due', 'upcoming')
        )
      then case
        when exists (
          select 1 from public.payment_schedule ps
           where ps.booking_id = b.id and ps.status in ('due', 'upcoming') and ps.due_at is null
        ) then null
        else (
          select max(least(
            ps.due_at + make_interval(hours => v_grace_hours),
            b.scheduled_at - interval '30 minutes'
          ))
            from public.payment_schedule ps
           where ps.booking_id = b.id and ps.status in ('due', 'upcoming')
        )
      end
      else null
    end,
    'can_pay', coalesce(
      r.customer_id = auth.uid()
      and r.billing_frequency = 'per_visit'
      and (
        (b.archetype = 'time_based' and b.pack_purchase_id is null and b.status::text = 'pending_payment')
        or (b.archetype = 'fixed' and b.status::text in ('pending_payment', 'in_progress'))
      )
      and exists (
        select 1 from public.payment_schedule ps
         where ps.booking_id = b.id and ps.status = 'due'
      ),
      false
    ),
    'skip_cutoff_at', case
      when r.customer_id = auth.uid()
      then b.scheduled_at - make_interval(hours => v_skip_cutoff_hours)
      else null
    end,
    'can_skip', coalesce(
      r.customer_id = auth.uid()
      and public._recurring_feature('recurring_skip_pause')
      and b.status::text in ('pending_payment', 'requested', 'accepted')
      and b.scheduled_at > now() + make_interval(hours => v_skip_cutoff_hours),
      false
    ),
    'reschedule_cutoff_at', case
      when r.customer_id = auth.uid() or public._acts_for(r.provider_id, 'manager')
      then b.scheduled_at - make_interval(hours => v_reschedule_cutoff_hours)
      else null
    end,
    'can_request_reschedule', coalesce(
      (
        r.customer_id = auth.uid()
        or coalesce(public._acts_for(r.provider_id, 'manager'), false)
      )
      and public._recurring_feature('recurring_reschedule')
      and b.status::text in ('pending_payment', 'requested', 'accepted', 'confirmed')
      and b.scheduled_at > now() + make_interval(hours => v_reschedule_cutoff_hours),
      false
    )
  ) order by b.scheduled_at, b.id), '[]'::jsonb)
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
  ) order by c.created_at, c.id), '[]'::jsonb)
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

commit;

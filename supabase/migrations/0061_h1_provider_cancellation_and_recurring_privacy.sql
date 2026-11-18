-- WP H1; owns: provider_cancel_booking, _recurring_plan_payload; sources: WS2-T01, WS2-T08

create or replace function public.provider_cancel_booking(
  p_booking_id uuid,
  p_reason text default 'provider_cancellation',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can cancel');
  perform public._assert(
    p_reason in ('provider_cancellation', 'provider_no_show'),
    'invalid provider cancellation reason'
  );
  perform public._assert(
    b.status::text in ('requested', 'accepted', 'confirmed', 'en_route',
                       'inspecting', 'quote_sent', 'awaiting_payment'),
    'booking can no longer be cancelled'
  );
  return public._cancel_booking_by_policy(
    b.id,
    'provider',
    p_reason,
    coalesce(nullif(trim(p_note), ''), replace(p_reason, '_', ' ')),
    now()
  );
end;
$$;

update public.cancellation_policies p
   set rules = jsonb_set(
         p.rules,
         '{rules}',
         coalesce((
           select jsonb_agg(
             case
               when (p.key = 'standard_visit' and rule ->> 'name' = 'customer_after_trip_or_no_show')
                 or (p.key in ('fixed', 'fixed_flexible')
                     and rule ->> 'name' = 'half_refund_after_arrival_or_no_show')
               then jsonb_set(rule, '{match,actors}', '["customer","system"]'::jsonb, true)
               else rule
             end
             order by ordinal
           )
             from jsonb_array_elements(p.rules -> 'rules') with ordinality as entries(rule, ordinal)
         ), '[]'::jsonb),
         true
       ),
       version = p.version + 1,
       updated_at = now()
 where p.key in ('standard_visit', 'fixed', 'fixed_flexible')
   and exists (
     select 1
       from jsonb_array_elements(p.rules -> 'rules') as entries(rule)
      where (
        (p.key = 'standard_visit' and rule ->> 'name' = 'customer_after_trip_or_no_show')
        or (p.key in ('fixed', 'fixed_flexible')
            and rule ->> 'name' = 'half_refund_after_arrival_or_no_show')
      )
        and rule -> 'match' -> 'actors' is distinct from '["customer","system"]'::jsonb
   );

do $h1$
begin
  execute 'lock table public.bookings in access exclusive mode';
  execute 'alter table public.bookings disable trigger bookings_apply_core_contract';
  update public.bookings b
     set cancellation_snapshot = jsonb_set(
       b.cancellation_snapshot,
       '{rules}',
       coalesce((
         select jsonb_agg(
           case
             when (b.cancellation_snapshot ->> 'key' = 'standard_visit'
                   and rule ->> 'name' = 'customer_after_trip_or_no_show')
               or (b.cancellation_snapshot ->> 'key' in ('fixed', 'fixed_flexible')
                   and rule ->> 'name' = 'half_refund_after_arrival_or_no_show')
             then jsonb_set(rule, '{match,actors}', '["customer","system"]'::jsonb, true)
             else rule
           end
           order by ordinal
         )
           from jsonb_array_elements(b.cancellation_snapshot -> 'rules')
                with ordinality as entries(rule, ordinal)
       ), '[]'::jsonb),
       true
     )
   where b.cancellation_snapshot ->> 'key' in ('standard_visit', 'fixed', 'fixed_flexible')
     and exists (
       select 1
         from jsonb_array_elements(b.cancellation_snapshot -> 'rules') as entries(rule)
        where (
            (b.cancellation_snapshot ->> 'key' = 'standard_visit'
             and rule ->> 'name' = 'customer_after_trip_or_no_show')
            or (b.cancellation_snapshot ->> 'key' in ('fixed', 'fixed_flexible')
                and rule ->> 'name' = 'half_refund_after_arrival_or_no_show')
        )
            and rule -> 'match' -> 'actors' is distinct from '["customer","system"]'::jsonb
     );
  execute 'alter table public.bookings enable trigger bookings_apply_core_contract';
end
$h1$;

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
begin
  select * into r from public.recurring_schedules where id = p_id;
  if not found then
    return null;
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

-- Foundations for the Home Services / recurring / sports-payment product addendum.
-- All new customer capabilities start off; money-safety paths remain independently callable.

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values
  ('home_services_catalogue_v2', false, 'Expanded Home services', 'Grouped home-service catalogue. Off: existing catalogue remains available.', 'Home services', 70),
  ('admin_category_editor', true, 'Category editor', 'Admin tool for creating, editing and ordering services.', 'Admin tools', 90),
  ('recurring_bookings', false, 'Recurring bookings', 'Customers can request repeating home-service visits. Off: one-time booking only.', 'Recurring', 70),
  ('recurring_skip_pause', false, 'Skip and pause visits', 'Customers can skip a visit or pause a recurring plan.', 'Recurring', 71),
  ('recurring_reschedule', false, 'Recurring visit rescheduling', 'Customers and providers can request recurring-visit reschedules.', 'Recurring', 72),
  ('recurring_plan_acceptance', false, 'Accept recurring plans', 'Providers can accept a full recurring plan at once.', 'Recurring', 73),
  ('recurring_reminders', false, 'Recurring visit reminders', 'Send reminders before scheduled recurring visits.', 'Recurring', 74),
  ('recurring_billing', false, 'Recurring billing cycles', 'Allow weekly or monthly recurring payment cycles.', 'Recurring', 75),
  ('recurring_prepaid_packages', false, 'Prepaid recurring packages', 'Allow recurring plans to use prepaid visit packages.', 'Recurring', 76),
  ('sports_online_payments', false, 'Sports online payments', 'Allow in-app payment for sports bookings. Off: venue-enabled pay-at-venue only.', 'Sports payments', 80),
  ('sports_instant_booking', false, 'Sports instant booking', 'Allow instant-confirm sports resources.', 'Sports payments', 81),
  ('sports_capacity_slots', false, 'Sports capacity booking', 'Allow multiple participants for capacity-based activities.', 'Sports payments', 82),
  ('sports_multi_slot', false, 'Sports multi-slot booking', 'Allow consecutive sports time slots in one booking.', 'Sports payments', 83),
  ('merchant_calendar', false, 'Merchant calendar', 'Show merchant calendar and schedule screens.', 'Marketplace', 85),
  ('admin_rules_editor', true, 'Booking rules editor', 'Admin tool for recurring and sports booking rules.', 'Admin tools', 91)
on conflict (key) do nothing;

insert into public.app_config (key, value)
values
  ('recurring_rules', '{
    "frequencies":["daily","alternate_days","weekly","monthly","custom"],
    "horizon_days":28,"max_plan_days":365,"skip_cutoff_hours":12,
    "reschedule_cutoff_hours":12,"reminder_hours_before":12,
    "payment_due_hours_before":24,"billing_grace_hours":24,
    "payment_frequencies":["per_visit","weekly","monthly","prepaid_package"],
    "recurring_discount_bp":0
  }'::jsonb),
  ('sports_rules', '{
    "payment_hold_minutes":10,"approval_pay_window_minutes":60,
    "commission_bp":1000,"customer_fee_paise":0,"full_refund_hours":24,
    "partial_refund_hours":6,"partial_refund_bp":5000,"release_after_hours":24
  }'::jsonb)
on conflict (key) do nothing;

create or replace function public._recurring_feature(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_key = 'recurring_bookings' then public._feature_enabled('recurring_bookings')
    when p_key in (
      'recurring_skip_pause', 'recurring_reschedule', 'recurring_plan_acceptance',
      'recurring_reminders', 'recurring_billing', 'recurring_prepaid_packages'
    ) then public._feature_enabled('recurring_bookings') and public._feature_enabled(p_key)
    else false
  end;
$$;

create or replace function public._sports_feature(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_key = 'sports' then public._feature_enabled('sports')
    when p_key in (
      'sports_online_payments', 'sports_instant_booking', 'sports_capacity_slots', 'sports_multi_slot'
    ) then public._feature_enabled('sports') and public._feature_enabled(p_key)
    else false
  end;
$$;

create or replace function public.admin_get_rules(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(public._feature_enabled('admin_rules_editor'), 'Admin rules editor is turned off');
  perform public._assert(p_key in ('recurring_rules', 'sports_rules'), 'unknown rules key');
  select c.value into v_value from public.app_config c where c.key = p_key;
  perform public._assert(v_value is not null, 'rules are not configured');
  return v_value;
end;
$$;

create or replace function public.admin_set_rules(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_allowed_keys text[];
  v_values text[];
  v_number bigint;
  v_second_number bigint;
  v_unknown_key text;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(public._feature_enabled('admin_rules_editor'), 'Admin rules editor is turned off');
  perform public._assert(p_key in ('recurring_rules', 'sports_rules'), 'unknown rules key');
  perform public._assert(coalesce(jsonb_typeof(p_value) = 'object', false), 'rules must be a JSON object');

  if p_key = 'recurring_rules' then
    v_allowed_keys := array[
      'frequencies', 'horizon_days', 'max_plan_days', 'skip_cutoff_hours',
      'reschedule_cutoff_hours', 'reminder_hours_before', 'payment_due_hours_before',
      'billing_grace_hours', 'payment_frequencies', 'recurring_discount_bp'
    ];
  else
    v_allowed_keys := array[
      'payment_hold_minutes', 'approval_pay_window_minutes', 'commission_bp',
      'customer_fee_paise', 'full_refund_hours', 'partial_refund_hours',
      'partial_refund_bp', 'release_after_hours'
    ];
  end if;

  select k into v_unknown_key
    from jsonb_object_keys(p_value) as keys(k)
   where not (k = any(v_allowed_keys))
   limit 1;
  perform public._assert(v_unknown_key is null, 'rules contain an unknown field');
  perform public._assert(
    (select count(*) = cardinality(v_allowed_keys) from jsonb_object_keys(p_value)),
    'rules are missing a required field'
  );

  if p_key = 'recurring_rules' then
    perform public._assert(jsonb_typeof(p_value -> 'frequencies') = 'array', 'frequencies must be an array');
    perform public._assert(jsonb_typeof(p_value -> 'payment_frequencies') = 'array', 'payment_frequencies must be an array');
    select coalesce(array_agg(value), '{}'::text[]) into v_values
      from jsonb_array_elements_text(p_value -> 'frequencies');
    perform public._assert(cardinality(v_values) > 0, 'at least one frequency is required');
    perform public._assert(v_values <@ array['daily','alternate_days','weekly','monthly','custom']::text[], 'frequencies contains an unsupported value');
    perform public._assert(cardinality(v_values) = (select count(distinct value) from unnest(v_values) as x(value)), 'frequencies cannot contain duplicates');
    select coalesce(array_agg(value), '{}'::text[]) into v_values
      from jsonb_array_elements_text(p_value -> 'payment_frequencies');
    perform public._assert(cardinality(v_values) > 0, 'at least one payment frequency is required');
    perform public._assert(v_values <@ array['per_visit','weekly','monthly','prepaid_package']::text[], 'payment_frequencies contains an unsupported value');
    perform public._assert(cardinality(v_values) = (select count(distinct value) from unnest(v_values) as x(value)), 'payment_frequencies cannot contain duplicates');

    perform public._assert(
      jsonb_typeof(p_value -> 'horizon_days') = 'number'
      and (p_value ->> 'horizon_days') ~ '^[0-9]+$',
      'horizon_days must be a whole-number JSON number'
    );
    v_number := (p_value ->> 'horizon_days')::bigint;
    perform public._assert(v_number between 1 and 90, 'horizon_days must be between 1 and 90');
    perform public._assert(
      jsonb_typeof(p_value -> 'max_plan_days') = 'number'
      and (p_value ->> 'max_plan_days') ~ '^[0-9]+$',
      'max_plan_days must be a whole-number JSON number'
    );
    v_number := (p_value ->> 'max_plan_days')::bigint;
    perform public._assert(v_number between 1 and 3650, 'max_plan_days must be between 1 and 3650');
    foreach v_unknown_key in array array['skip_cutoff_hours','reschedule_cutoff_hours','reminder_hours_before','payment_due_hours_before','billing_grace_hours'] loop
      perform public._assert(
        jsonb_typeof(p_value -> v_unknown_key) = 'number'
        and (p_value ->> v_unknown_key) ~ '^[0-9]+$',
        v_unknown_key || ' must be a whole-number JSON number'
      );
      v_number := (p_value ->> v_unknown_key)::bigint;
      perform public._assert(v_number between 0 and 720, v_unknown_key || ' must be between 0 and 720');
    end loop;
    perform public._assert(
      jsonb_typeof(p_value -> 'recurring_discount_bp') = 'number'
      and (p_value ->> 'recurring_discount_bp') ~ '^[0-9]+$',
      'recurring_discount_bp must be a whole-number JSON number'
    );
    v_number := (p_value ->> 'recurring_discount_bp')::bigint;
    perform public._assert(v_number between 0 and 5000, 'recurring_discount_bp must be between 0 and 5000');
  else
    foreach v_unknown_key in array array['payment_hold_minutes','approval_pay_window_minutes','commission_bp','customer_fee_paise','full_refund_hours','partial_refund_hours','partial_refund_bp','release_after_hours'] loop
      perform public._assert(
        jsonb_typeof(p_value -> v_unknown_key) = 'number'
        and (p_value ->> v_unknown_key) ~ '^[0-9]+$',
        v_unknown_key || ' must be a whole-number JSON number'
      );
      v_number := (p_value ->> v_unknown_key)::bigint;
      if v_unknown_key in ('payment_hold_minutes','approval_pay_window_minutes') then
        perform public._assert(v_number between 5 and 1440, v_unknown_key || ' must be between 5 and 1440');
      elsif v_unknown_key = 'commission_bp' then
        perform public._assert(v_number between 0 and 5000, 'commission_bp must be between 0 and 5000');
      elsif v_unknown_key = 'customer_fee_paise' then
        perform public._assert(v_number between 0 and 2147483647, 'customer_fee_paise is out of range');
      elsif v_unknown_key = 'partial_refund_bp' then
        perform public._assert(v_number between 0 and 10000, 'partial_refund_bp must be between 0 and 10000');
      else
        perform public._assert(v_number between 0 and 720, v_unknown_key || ' must be between 0 and 720');
      end if;
    end loop;
    v_number := (p_value ->> 'full_refund_hours')::bigint;
    v_second_number := (p_value ->> 'partial_refund_hours')::bigint;
    perform public._assert(v_number >= v_second_number, 'full_refund_hours must be greater than or equal to partial_refund_hours');
  end if;

  insert into public.app_config (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), v_uid)
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  insert into public.admin_audit_log (admin_id, action, details)
  values (v_uid, 'set_booking_rules', jsonb_build_object('key', p_key, 'value', p_value));
  return p_value;
end;
$$;

create or replace function public._assert_provider_window_free(
  p_provider_id uuid,
  p_window tstzrange,
  p_exclude_booking_id uuid default null,
  p_exclusive boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._assert(p_provider_id is not null, 'provider is required');
  perform public._assert(p_window is not null and not isempty(p_window), 'service window is required');
  perform pg_advisory_xact_lock(hashtext(p_provider_id::text));
  perform public._assert(not exists (
    select 1
      from public.bookings existing
     where existing.provider_id = p_provider_id
       and (p_exclude_booking_id is null or existing.id <> p_exclude_booking_id)
       and existing.service_window && p_window
       and (existing.exclusive or p_exclusive)
       and (
         existing.status::text in (
           'requested', 'accepted', 'confirmed', 'en_route', 'inspecting',
           'quote_sent', 'awaiting_payment', 'in_progress', 'completion_requested'
         )
         or (
           existing.status::text = 'pending_payment'
           and existing.created_at > now() - interval '30 minutes'
         )
       )
  ), 'provider_unavailable: service window overlaps an existing booking');
end;
$$;

revoke all on function public._recurring_feature(text), public._sports_feature(text),
  public._assert_provider_window_free(uuid, tstzrange, uuid, boolean)
from public, anon, authenticated;
grant execute on function public._recurring_feature(text), public._sports_feature(text),
  public._assert_provider_window_free(uuid, tstzrange, uuid, boolean)
to service_role;

revoke execute on function public.admin_get_rules(text), public.admin_set_rules(text, jsonb) from public, anon;
grant execute on function public.admin_get_rules(text), public.admin_set_rules(text, jsonb) to authenticated;

do $$
declare
  v_constraint oid;
  v_definition text;
  v_expression text;
begin
  select oid into v_constraint from pg_constraint
   where conrelid = 'public.notifications'::regclass
     and conname = 'notifications_kind_check' and contype = 'c';
  if v_constraint is not null then
    v_definition := pg_get_constraintdef(v_constraint);
    v_expression := substring(v_definition from 8 for char_length(v_definition) - 8);
    alter table public.notifications drop constraint notifications_kind_check;
    execute format(
      'alter table public.notifications add constraint notifications_kind_check check ((%s) or kind in (%s))',
      v_expression,
      quote_literal('recurring_plan_requested') || ', ' ||
      quote_literal('recurring_plan_accepted') || ', ' ||
      quote_literal('recurring_plan_declined') || ', ' ||
      quote_literal('recurring_plan_paused') || ', ' ||
      quote_literal('recurring_plan_resumed') || ', ' ||
      quote_literal('recurring_plan_cancelled') || ', ' ||
      quote_literal('recurring_visit_upcoming') || ', ' ||
      quote_literal('recurring_visit_skipped') || ', ' ||
      quote_literal('recurring_visit_unavailable') || ', ' ||
      quote_literal('recurring_visit_reschedule_requested') || ', ' ||
      quote_literal('recurring_visit_rescheduled') || ', ' ||
      quote_literal('recurring_visit_reschedule_declined') || ', ' ||
      quote_literal('recurring_visit_cancelled_by_provider') || ', ' ||
      quote_literal('recurring_visit_completed') || ', ' ||
      quote_literal('recurring_payment_due') || ', ' ||
      quote_literal('recurring_payment_failed') || ', ' ||
      quote_literal('sports_booking_confirmed') || ', ' ||
      quote_literal('sports_payment_due') || ', ' ||
      quote_literal('sports_payment_failed') || ', ' ||
      quote_literal('sports_booking_expired') || ', ' ||
      quote_literal('sports_booking_cancelled') || ', ' ||
      quote_literal('sports_refund_issued')
    );
  else
    alter table public.notifications add constraint notifications_kind_check
      check (kind is not null);
  end if;
end;
$$;

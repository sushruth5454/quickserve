-- WP S2; owns: sports read/config RPCs, cancellation preview, price-rule deletion, sports payment failure, demo settlement, booking windows/limits; sources: WS4-T05, WS8-T08, WS4-T07, T08, T09, T13, T16, T17, T19

update public.app_config
   set value = value || jsonb_build_object(
     'max_active_holds_per_customer',
       case when jsonb_typeof(value -> 'max_active_holds_per_customer') = 'number'
            then value -> 'max_active_holds_per_customer' else '3'::jsonb end,
     'request_response_minutes',
       case when jsonb_typeof(value -> 'request_response_minutes') = 'number'
            then value -> 'request_response_minutes' else '120'::jsonb end,
     'min_lead_minutes',
       case when jsonb_typeof(value -> 'min_lead_minutes') = 'number'
            then value -> 'min_lead_minutes' else '30'::jsonb end
   )
 where key = 'sports_rules';

create or replace function public._sports_rule(p_path text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.value ->> p_path
    from public.app_config c
   where c.key = 'sports_rules'
     and p_path = any(array[
       'payment_hold_minutes', 'approval_pay_window_minutes', 'commission_bp',
       'customer_fee_paise', 'full_refund_hours', 'partial_refund_hours',
       'partial_refund_bp', 'release_after_hours', 'max_active_holds_per_customer',
       'request_response_minutes', 'min_lead_minutes'
     ]::text[]);
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
  v_current jsonb;
  v_value jsonb;
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
      'partial_refund_bp', 'release_after_hours', 'max_active_holds_per_customer',
      'request_response_minutes', 'min_lead_minutes'
    ];
  end if;

  select k into v_unknown_key
    from jsonb_object_keys(p_value) as keys(k)
   where not (k = any(v_allowed_keys))
   limit 1;
  perform public._assert(v_unknown_key is null, 'rules contain an unknown field');

  if p_key = 'recurring_rules' then
    perform public._assert(
      (select count(*) = cardinality(v_allowed_keys) from jsonb_object_keys(p_value)),
      'rules are missing a required field'
    );
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

    foreach v_unknown_key in array array['horizon_days','max_plan_days','skip_cutoff_hours','reschedule_cutoff_hours','reminder_hours_before','payment_due_hours_before','billing_grace_hours','recurring_discount_bp'] loop
      perform public._assert(
        jsonb_typeof(p_value -> v_unknown_key) = 'number'
        and (p_value ->> v_unknown_key) ~ '^[0-9]+$',
        v_unknown_key || ' must be a whole-number JSON number'
      );
      v_number := (p_value ->> v_unknown_key)::bigint;
      if v_unknown_key = 'horizon_days' then
        perform public._assert(v_number between 1 and 90, 'horizon_days must be between 1 and 90');
      elsif v_unknown_key = 'max_plan_days' then
        perform public._assert(v_number between 1 and 3650, 'max_plan_days must be between 1 and 3650');
      elsif v_unknown_key = 'recurring_discount_bp' then
        perform public._assert(v_number between 0 and 5000, 'recurring_discount_bp must be between 0 and 5000');
      else
        perform public._assert(v_number between 0 and 720, v_unknown_key || ' must be between 0 and 720');
      end if;
    end loop;
    v_value := p_value;
  else
    select c.value into v_current from public.app_config c where c.key = 'sports_rules';
    perform public._assert(v_current is not null, 'sports rules are not configured');
    v_value := v_current || p_value;
    foreach v_unknown_key in array array[
      'payment_hold_minutes','approval_pay_window_minutes','commission_bp',
      'customer_fee_paise','full_refund_hours','partial_refund_hours',
      'partial_refund_bp','release_after_hours','max_active_holds_per_customer',
      'request_response_minutes','min_lead_minutes'
    ] loop
      perform public._assert(
        jsonb_typeof(v_value -> v_unknown_key) = 'number'
        and (v_value ->> v_unknown_key) ~ '^[0-9]+$',
        v_unknown_key || ' must be a whole-number JSON number'
      );
      v_number := (v_value ->> v_unknown_key)::bigint;
      if v_unknown_key in ('payment_hold_minutes','approval_pay_window_minutes','request_response_minutes') then
        perform public._assert(v_number between 5 and 1440, v_unknown_key || ' must be between 5 and 1440');
      elsif v_unknown_key = 'commission_bp' then
        perform public._assert(v_number between 0 and 5000, 'commission_bp must be between 0 and 5000');
      elsif v_unknown_key = 'customer_fee_paise' then
        perform public._assert(v_number between 0 and 2147483647, 'customer_fee_paise is out of range');
      elsif v_unknown_key = 'partial_refund_bp' then
        perform public._assert(v_number between 0 and 5000, 'partial_refund_bp must be between 0 and 5000');
      elsif v_unknown_key = 'max_active_holds_per_customer' then
        perform public._assert(v_number between 1 and 100, 'max_active_holds_per_customer must be between 1 and 100');
      elsif v_unknown_key = 'min_lead_minutes' then
        perform public._assert(v_number between 0 and 43200, 'min_lead_minutes must be between 0 and 43200');
      else
        perform public._assert(v_number between 0 and 720, v_unknown_key || ' must be between 0 and 720');
      end if;
    end loop;
    v_number := (v_value ->> 'full_refund_hours')::bigint;
    v_second_number := (v_value ->> 'partial_refund_hours')::bigint;
    perform public._assert(v_number >= v_second_number, 'full_refund_hours must be greater than or equal to partial_refund_hours');
  end if;

  insert into public.app_config (key, value, updated_at, updated_by)
  values (p_key, v_value, now(), v_uid)
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  insert into public.admin_audit_log (admin_id, action, details)
  values (v_uid, 'set_booking_rules', jsonb_build_object('key', p_key, 'value', v_value));
  return v_value;
end;
$$;

drop policy if exists sports_bookings_participant_read on public.sports_bookings;
create policy sports_bookings_participant_read on public.sports_bookings
  for select to authenticated
  using (
    customer_id = auth.uid()
    or exists (
      select 1 from public.sports_venues v
       where v.id = sports_bookings.venue_id
         and public._acts_for(v.owner_id, 'staff')
    )
  );

create or replace function public.list_my_customer_sports_bookings()
returns table (
  id uuid,
  venue_name text,
  resource_name text,
  activity_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  price_paise int,
  expires_at timestamptz,
  payment_mode text,
  participants int,
  customer_fee_paise int,
  total_paise int,
  refund_paise int,
  paid_at timestamptz,
  hold_expires_at timestamptz,
  pay_by timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  return query
    select b.id, v.name, r.name, a.name, b.starts_at, b.ends_at, b.status, b.price_paise, b.expires_at, b.payment_mode, b.participants,
           b.customer_fee_paise, b.total_paise, b.refund_paise, b.paid_at,
           b.hold_expires_at, b.pay_by
      from public.sports_bookings b
      join public.sports_venues v on v.id = b.venue_id
      join public.sports_resources r on r.id = b.resource_id
      join public.sports_activities a on a.id = r.activity_id
     where b.customer_id = v_uid
     order by b.starts_at desc;
end;
$$;
revoke all on function public.list_my_customer_sports_bookings() from public, anon, service_role;
grant execute on function public.list_my_customer_sports_bookings() to authenticated;

create or replace function public.get_business_sports_booking(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', b.id, 'customer_id', b.customer_id, 'customer_name', p.full_name,
    'owner_id', v.owner_id, 'business_role', public._business_role(v.owner_id),
    'venue_id', v.id, 'venue_name', v.name, 'payment_modes', v.payment_modes,
    'online_payment_ready', coalesce(
      public._sports_feature('sports_online_payments')
      and 'online' = any(v.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts pa
         where pa.provider_id = v.owner_id and pa.activation_status = 'activated'
      ),
      false
    ),
    'resource_id', r.id, 'resource_name', r.name, 'activity_name', a.name,
    'booking_mode', r.booking_mode, 'capacity', r.capacity,
    'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
    'price_paise', b.price_paise, 'total_paise', b.total_paise,
    'customer_fee_paise', b.customer_fee_paise, 'refund_paise', b.refund_paise,
    'payment_mode', b.payment_mode, 'participants', b.participants,
    'hold_expires_at', b.hold_expires_at, 'pay_by', b.pay_by, 'paid_at', b.paid_at,
    'note', b.note, 'decision_reason', b.decision_reason,
    'expires_at', b.expires_at, 'decided_at', b.decided_at, 'created_at', b.created_at
  ) into v_result
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
    join public.sports_resources r on r.id = b.resource_id
    join public.sports_activities a on a.id = r.activity_id
    join public.profiles p on p.id = b.customer_id
   where b.id = p_id and (b.customer_id = v_uid or public._acts_for(v.owner_id, 'staff'));
  perform public._assert(v_result is not null, 'booking not found');
  return v_result;
end;
$$;

create or replace function public.get_sports_venue(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  select jsonb_build_object(
    'id', v.id, 'name', v.name, 'description', v.description, 'address_line', v.address_line,
    'city', v.city, 'area', v.area, 'lat', v.lat, 'lng', v.lng, 'amenities', v.amenities,
    'photos', v.photos, 'payment_modes', v.payment_modes,
    'online_payment_ready', coalesce(
      public._sports_feature('sports_online_payments')
      and 'online' = any(v.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts pa
         where pa.provider_id = v.owner_id and pa.activation_status = 'activated'
      ),
      false
    ),
    'cancellation_policy', jsonb_build_object(
      'full_refund_hours', coalesce(
        nullif(v.cancellation_rules ->> 'full_refund_hours', '')::int,
        nullif(public._sports_rule('full_refund_hours'), '')::int
      ),
      'partial_refund_hours', coalesce(
        nullif(v.cancellation_rules ->> 'partial_refund_hours', '')::int,
        nullif(public._sports_rule('partial_refund_hours'), '')::int
      ),
      'partial_refund_bp', coalesce(
        nullif(v.cancellation_rules ->> 'partial_refund_bp', '')::int,
        nullif(public._sports_rule('partial_refund_bp'), '')::int
      )
    ),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'activity_id', a.id, 'activity_slug', a.slug,
        'activity_name', a.name, 'slot_minutes', r.slot_minutes,
        'booking_mode', r.booking_mode, 'capacity', r.capacity
      ) order by r.created_at)
        from public.sports_resources r
        join public.sports_activities a on a.id = r.activity_id
       where r.venue_id = v.id and r.active and a.active
    ), '[]'::jsonb)
  ) into v_result
    from public.sports_venues v
   where v.id = p_id and v.status = 'verified';
  return v_result;
end;
$$;

create or replace function public._sports_cancellation_refund(
  p_booking_id uuid,
  p_owner_cancel boolean
)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_booking record;
  v_rules jsonb;
  v_full_hours int;
  v_partial_hours int;
  v_partial_bp int;
  v_hours_to_start numeric;
begin
  select b.*, v.owner_id, v.cancellation_rules
    into v_booking
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
   where b.id = p_booking_id;
  perform public._assert(found, 'booking not found');
  if p_owner_cancel then
    perform public._assert(v_booking.owner_id = v_uid, 'booking not found');
  else
    perform public._assert(v_booking.customer_id = v_uid, 'booking not found');
  end if;
  perform public._assert(v_booking.status in ('requested', 'accepted', 'pending_payment', 'awaiting_payment'),
                         'booking cannot be cancelled');
  if v_booking.payment_mode <> 'online' then
    return 0;
  end if;
  if p_owner_cancel then
    return coalesce(v_booking.total_paise, v_booking.price_paise + v_booking.customer_fee_paise);
  end if;

  v_rules := coalesce(v_booking.cancellation_rules,
    (select c.value from public.app_config c where c.key = 'sports_rules'));
  v_full_hours := coalesce(nullif(v_rules ->> 'full_refund_hours', '')::int,
                           nullif(public._sports_rule('full_refund_hours'), '')::int);
  v_partial_hours := coalesce(nullif(v_rules ->> 'partial_refund_hours', '')::int,
                              nullif(public._sports_rule('partial_refund_hours'), '')::int);
  v_partial_bp := coalesce(nullif(v_rules ->> 'partial_refund_bp', '')::int,
                           nullif(public._sports_rule('partial_refund_bp'), '')::int, -1);
  perform public._assert(v_full_hours is not null and v_partial_hours is not null
                         and v_partial_bp between 0 and 5000,
                         'sports cancellation rules are unavailable');
  v_hours_to_start := extract(epoch from (v_booking.starts_at - now())) / 3600.0;
  if v_hours_to_start >= v_full_hours then
    return v_booking.price_paise;
  elsif v_hours_to_start >= v_partial_hours then
    return round(v_booking.price_paise::numeric * v_partial_bp / 10000)::int;
  end if;
  return 0;
end;
$$;
revoke all on function public._sports_cancellation_refund(uuid, boolean) from public, anon, authenticated;

create or replace function public.preview_sports_cancellation(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_booking record;
  v_owner_cancel boolean;
  v_can_cancel boolean;
  v_target_paise int := 0;
  v_available_paise bigint := 0;
  v_refund_paise int := 0;
  v_retained_paise int := 0;
  v_rules jsonb;
  v_full_hours int;
  v_partial_hours int;
  v_partial_bp int;
begin
  select b.*, v.owner_id, v.cancellation_rules
    into v_booking
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
   where b.id = p_id and (b.customer_id = v_uid or v.owner_id = v_uid);
  perform public._assert(found, 'booking not found');
  v_owner_cancel := v_booking.owner_id = v_uid;
  v_can_cancel := v_booking.status in ('requested', 'accepted', 'pending_payment', 'awaiting_payment')
    and (v_owner_cancel or v_booking.starts_at > now());
  v_rules := coalesce(v_booking.cancellation_rules,
    (select c.value from public.app_config c where c.key = 'sports_rules'));
  v_full_hours := coalesce(nullif(v_rules ->> 'full_refund_hours', '')::int,
                           nullif(public._sports_rule('full_refund_hours'), '')::int);
  v_partial_hours := coalesce(nullif(v_rules ->> 'partial_refund_hours', '')::int,
                              nullif(public._sports_rule('partial_refund_hours'), '')::int);
  v_partial_bp := coalesce(nullif(v_rules ->> 'partial_refund_bp', '')::int,
                           nullif(public._sports_rule('partial_refund_bp'), '')::int);
  if v_can_cancel and v_booking.payment_mode = 'online' and v_booking.paid_at is not null then
    v_target_paise := public._sports_cancellation_refund(p_id, v_owner_cancel);
    select coalesce(sum(greatest(
      p.amount - coalesce((
        select sum(r.amount)::int
          from public.refunds r
         where r.payment_id = p.id and r.status <> 'failed'
      ), 0),
      0
    )), 0)
      into v_available_paise
      from public.payments p
     where p.sports_booking_id = p_id
       and p.razorpay_payment_id is not null
       and p.status in ('paid', 'refund_pending');
    v_refund_paise := least(v_target_paise::bigint, v_available_paise)::int;
    if not v_owner_cancel then
      v_retained_paise := greatest(v_booking.price_paise - coalesce(v_booking.refund_paise, 0) - v_refund_paise, 0);
    end if;
  end if;
  return jsonb_build_object(
    'can_cancel', v_can_cancel,
    'refund_paise', v_refund_paise,
    'retained_paise', v_retained_paise,
    'full_refund_hours', v_full_hours,
    'partial_refund_hours', v_partial_hours,
    'partial_refund_bp', v_partial_bp
  );
end;
$$;
revoke all on function public.preview_sports_cancellation(uuid) from public, anon, service_role;
grant execute on function public.preview_sports_cancellation(uuid) to authenticated;

create or replace function public.cancel_sports_booking(p_id uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_booking record;
  v_refunded int := 0;
  v_target int := 0;
  v_owner_cancel boolean;
  v_notice_user uuid;
  v_notice_title text;
  v_notice_body text;
begin
  select resource_id into v_booking from public.sports_bookings where id = p_id;
  perform public._assert(found, 'booking not found');
  perform pg_advisory_xact_lock(hashtext(v_booking.resource_id::text));
  select b.*, v.owner_id, v.name venue_name into v_booking
    from public.sports_bookings b join public.sports_venues v on v.id = b.venue_id
   where b.id = p_id for update of b;
  perform public._assert(found, 'booking not found');
  perform public._assert(v_booking.status in ('requested', 'accepted', 'pending_payment', 'awaiting_payment'),
                         'booking cannot be cancelled');

  if v_booking.customer_id = v_uid then
    perform public._assert(v_booking.starts_at > now(), 'booking can only be cancelled before it starts');
    v_owner_cancel := false;
    v_notice_user := v_booking.owner_id;
    v_notice_title := 'Sports booking cancelled';
    v_notice_body := v_booking.venue_name || ' booking was cancelled by the customer.';
  elsif v_booking.owner_id = v_uid then
    perform public._assert(char_length(btrim(coalesce(p_reason, ''))) between 3 and 500,
                           'a cancellation reason is required');
    v_owner_cancel := true;
    v_notice_user := v_booking.customer_id;
    v_notice_title := 'Sports booking cancelled by venue';
    v_notice_body := coalesce(nullif(btrim(p_reason), ''),
                              v_booking.venue_name || ' cancelled the booking.');
  else
    raise exception 'booking not found' using errcode = 'P0001';
  end if;

  if v_booking.payment_mode = 'online' then
    v_target := public._sports_cancellation_refund(p_id, v_owner_cancel);
    if v_target > 0 then
      v_refunded := public._queue_sports_refund(p_id, v_target,
        case when v_owner_cancel then 'venue cancelled sports booking'
             else 'customer cancelled sports booking' end);
    end if;
  end if;

  update public.payments
     set status = 'failed', cancel_link_pending = (razorpay_link_id is not null)
   where sports_booking_id = p_id and status = 'created';
  update public.sports_bookings
     set status = 'cancelled', refund_paise = refund_paise + v_refunded,
         decision_reason = coalesce(btrim(p_reason), ''), decided_at = now(),
         cancelled_by = case when v_owner_cancel then 'venue' else 'customer' end
   where id = p_id;

  if not v_owner_cancel and v_booking.payment_mode = 'online' and v_booking.paid_at is not null then
    perform public._create_sports_payout(p_id);
  end if;
  begin
    perform public._queue_notification(
      v_notice_user, 'sports_booking_cancelled', null, v_notice_title, left(v_notice_body, 300),
      jsonb_build_object('sports_booking_id', p_id, 'url', '/sports-booking/' || p_id::text),
      'sports-booking-cancelled:' || p_id::text
    );
  exception when others then
    raise warning 'sports notification skipped: %', sqlerrm;
  end;
  if v_refunded > 0 then
    begin
      perform public._queue_notification(
        v_booking.customer_id, 'sports_refund_issued', null, 'Sports refund queued',
        'A refund has been queued according to the sports cancellation policy.',
        jsonb_build_object('sports_booking_id', p_id, 'url', '/sports-booking/' || p_id::text),
        'sports-refund:' || p_id::text
      );
    exception when others then
      raise warning 'sports notification skipped: %', sqlerrm;
    end;
  end if;
end;
$$;

create or replace function public.delete_sports_price_rule(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_deleted uuid;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  delete from public.sports_price_rules pr
   using public.sports_resources r, public.sports_venues v
   where pr.id = p_id and r.id = pr.resource_id and v.id = r.venue_id
     and v.owner_id = v_uid
   returning pr.id into v_deleted;
  perform public._assert(v_deleted is not null, 'price rule not found or not owned by you');
end;
$$;
revoke all on function public.delete_sports_price_rule(uuid) from public, anon, service_role;
grant execute on function public.delete_sports_price_rule(uuid) to authenticated;

create or replace function public.record_sports_payment_failed(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_customer_id uuid;
  v_venue_name text;
begin
  if nullif(btrim(coalesce(p_order_id, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'order id is required');
  end if;
  select p.* into v_payment
    from public.payments p
   where p.razorpay_link_id = p_order_id
     and p.sports_booking_id is not null
   for update;
  if not found or v_payment.status <> 'created' then
    return jsonb_build_object('ok', true, 'ignored', true);
  end if;
  select b.customer_id, v.name into v_customer_id, v_venue_name
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
   where b.id = v_payment.sports_booking_id;
  if not found then
    return jsonb_build_object('ok', true, 'ignored', true);
  end if;
  update public.payments
     set status = 'failed', cancel_link_pending = false
   where id = v_payment.id and status = 'created';
  if not found then
    return jsonb_build_object('ok', true, 'ignored', true);
  end if;
  begin
    perform public._queue_notification(
      v_customer_id, 'sports_payment_failed', null, 'Sports payment failed',
      'Your payment for ' || v_venue_name || ' could not be completed. You can try again.',
      jsonb_build_object('sports_booking_id', v_payment.sports_booking_id,
                         'url', '/sports-checkout/' || v_payment.sports_booking_id::text),
      'sports-payment-failed:' || v_payment.sports_booking_id::text
    );
  exception when others then
    raise warning 'sports payment failure notification skipped: %', sqlerrm;
  end;
  return jsonb_build_object('ok', true, 'booking_id', v_payment.sports_booking_id);
end;
$$;
revoke all on function public.record_sports_payment_failed(text) from public, anon, authenticated;
grant execute on function public.record_sports_payment_failed(text) to service_role;

create or replace function public.demo_settle_sports_payment(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_owner_id uuid;
  v_key text;
  v_attempt record;
  v_result jsonb;
  v_config jsonb;
begin
  select value into v_config from public.app_config where key = 'deployment';
  perform public._assert(coalesce((v_config ->> 'is_demo_project')::boolean, false),
                         'demo payments are disabled');
  select value into v_config from public.app_config where key = 'demo_payments';
  perform public._assert(coalesce((v_config ->> 'enabled')::boolean, false),
                         'demo payments are disabled');
  select v.owner_id into v_owner_id
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
   where b.id = p_booking_id and b.customer_id = v_uid and b.paid_at is null;
  perform public._assert(found, 'only the customer can pay');
  perform public._assert(
    exists (
      select 1 from auth.users u
       where u.id = v_owner_id
         and u.raw_app_meta_data ->> 'demo_only' = 'true'
    ),
    'demo payments only work with demo venue owners'
  );
  select x.payment_id, x.amount into v_attempt
    from public.prepare_sports_payment(p_booking_id, v_uid) x;
  v_key := replace(v_attempt.payment_id::text, '-', '');
  update public.payments
     set razorpay_link_id = 'plink_demo_' || v_key, short_url = 'demo://payment'
   where id = v_attempt.payment_id and status = 'created';
  perform public._assert(found, 'demo sports payment is no longer available');
  v_result := public.record_sports_payment_paid(
    'plink_demo_' || v_key, 'pay_demo_' || v_key, v_attempt.amount
  );
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('amount', v_attempt.amount);
end;
$$;
revoke all on function public.demo_settle_sports_payment(uuid) from public, anon, service_role;
grant execute on function public.demo_settle_sports_payment(uuid) to authenticated;

create or replace function public.request_sports_slot(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_slots int default 1,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_resource record;
  v_start_local timestamp;
  v_end_local timestamp;
  v_day smallint;
  v_hours public.sports_hours;
  v_end_at timestamptz;
  v_expires_at timestamptz;
  v_price int;
  v_total bigint := 0;
  v_used int;
  v_slot_start timestamptz;
  v_slot_local time;
  v_slot_end_local time;
  v_booking_id uuid;
  v_response_minutes int;
  v_min_lead_minutes int;
  i int;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  perform pg_advisory_xact_lock(hashtext(p_resource_id::text));
  select r.id, r.venue_id, r.slot_minutes, r.capacity, v.owner_id, v.name venue_name,
         v.status, v.payment_modes, a.active
    into v_resource
    from public.sports_resources r
    join public.sports_venues v on v.id = r.venue_id
    join public.sports_activities a on a.id = r.activity_id
   where r.id = p_resource_id and r.active;
  perform public._assert(found and v_resource.status = 'verified' and v_resource.active, 'resource is unavailable');
  perform public._assert('pay_at_venue' = any(v_resource.payment_modes),
                         'This venue does not accept pay-at-venue booking yet');
  perform public._assert(v_resource.owner_id <> v_uid, 'venue owners cannot book their own venue');
  perform public._assert(p_starts_at > now() and p_starts_at <= now() + interval '30 days',
                         'start time must be within the next 30 days');
  perform public._assert(p_slots between 1 and 4, 'slot count must be between 1 and 4');
  perform public._assert(p_slots = 1 or public._sports_feature('sports_multi_slot'),
                         'Sports multi-slot booking is turned off right now.');
  perform public._assert(char_length(coalesce(p_note, '')) <= 500, 'request note is too long');
  perform public._assert(extract(second from (p_starts_at at time zone 'Asia/Kolkata')) = 0,
                         'start time must align to a slot boundary');

  v_response_minutes := coalesce(nullif(public._sports_rule('request_response_minutes'), '')::int, -1);
  v_min_lead_minutes := coalesce(nullif(public._sports_rule('min_lead_minutes'), '')::int, -1);
  perform public._assert(v_response_minutes between 5 and 1440
                         and v_min_lead_minutes between 0 and 43200,
                         'sports booking window rules are unavailable');
  perform public._assert(p_starts_at > now() + make_interval(mins => v_min_lead_minutes),
                         'slot must start beyond the configured lead time');

  v_start_local := p_starts_at at time zone 'Asia/Kolkata';
  v_end_at := p_starts_at + make_interval(mins => v_resource.slot_minutes * p_slots);
  v_end_local := v_end_at at time zone 'Asia/Kolkata';
  v_day := extract(dow from v_start_local)::smallint;
  select * into v_hours from public.sports_hours h
   where h.venue_id = v_resource.venue_id and h.weekday = v_day;
  perform public._assert(found, 'venue is closed on that day');
  perform public._assert(v_start_local::date = v_end_local::date
                         and v_start_local::time >= v_hours.opens
                         and v_end_local::time <= v_hours.closes,
                         'requested time is outside opening hours');
  perform public._assert(
    mod(extract(epoch from (v_start_local::time - v_hours.opens))::int, v_resource.slot_minutes * 60) = 0,
    'start time is not aligned to the venue slot schedule'
  );
  v_expires_at := least(
    p_starts_at - make_interval(mins => v_min_lead_minutes),
    now() + make_interval(mins => v_response_minutes)
  );
  perform public._assert(v_expires_at > now(), 'slot is inside the configured lead time');
  perform public._assert(not exists (
    select 1 from public.sports_blocks b
     where b.resource_id = p_resource_id and b.starts_at < v_end_at and b.ends_at > p_starts_at
  ), 'slot is blocked by the venue');
  select coalesce(sum(b.participants), 0)::int into v_used
    from public.sports_bookings b
   where b.resource_id = p_resource_id and b.starts_at < v_end_at and b.ends_at > p_starts_at
     and (
       b.status = 'accepted'
       or (b.status = 'requested' and b.expires_at > now())
       or (b.status = 'awaiting_payment' and b.pay_by > now())
       or (b.status = 'pending_payment' and b.hold_expires_at > now())
     );
  perform public._assert(v_used + 1 <= v_resource.capacity, 'slot is no longer available');

  for i in 0 .. p_slots - 1 loop
    v_slot_start := p_starts_at + make_interval(mins => v_resource.slot_minutes * i);
    v_slot_local := (v_slot_start at time zone 'Asia/Kolkata')::time;
    v_slot_end_local := ((v_slot_start + make_interval(mins => v_resource.slot_minutes)) at time zone 'Asia/Kolkata')::time;
    select r.price_paise into v_price
      from public.sports_price_rules r
     where r.resource_id = p_resource_id
       and (r.weekday = v_day or r.weekday is null)
       and r.starts <= v_slot_local and r.ends >= v_slot_end_local
     order by (r.weekday is null), r.starts
     limit 1;
    perform public._assert(v_price is not null, 'no price rule covers every requested slot');
    v_total := v_total + v_price;
  end loop;
  perform public._assert(v_total <= 2147483647, 'total price is too large');

  insert into public.sports_bookings
    (customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise, note, expires_at,
     payment_mode, participants, total_paise, commission_bp)
  values
    (v_uid, v_resource.venue_id, p_resource_id, p_starts_at, v_end_at, 'requested', v_total::int,
     coalesce(p_note, ''), v_expires_at, 'pay_at_venue', 1, v_total::int,
     nullif(public._sports_rule('commission_bp'), '')::int)
  returning id into v_booking_id;

  begin
    perform public._queue_notification(
      v_resource.owner_id, 'sports_booking_requested', null, 'New sports venue request',
      v_resource.venue_name || ' has a new booking request.',
      jsonb_build_object('sports_booking_id', v_booking_id, 'url', '/sports-booking/' || v_booking_id::text),
      'sports-booking-request:' || v_booking_id::text
    );
  exception when others then
    raise warning 'sports notification skipped: %', sqlerrm;
  end;
  return v_booking_id;
end;
$$;

create or replace function public.decide_sports_booking(p_id uuid, p_accept boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_booking record;
  v_pay_by timestamptz;
  v_window_minutes int;
  v_min_lead_minutes int;
  v_status text;
  v_kind text;
  v_title text;
  v_body text;
begin
  perform public._assert(p_accept is not null, 'decision is required');
  perform public._assert(p_accept or char_length(btrim(coalesce(p_reason, ''))) between 3 and 500,
                         'a decline reason is required');
  select resource_id into v_booking from public.sports_bookings where id = p_id;
  perform public._assert(found, 'booking not found');
  perform pg_advisory_xact_lock(hashtext(v_booking.resource_id::text));
  select b.*, v.owner_id, v.name venue_name into v_booking
    from public.sports_bookings b join public.sports_venues v on v.id = b.venue_id
   where b.id = p_id for update of b;
  perform public._assert(found and v_booking.owner_id = v_uid, 'booking not found or not owned by you');
  perform public._assert(v_booking.status = 'requested' and v_booking.expires_at > now(),
                         'request is no longer pending');

  if p_accept and v_booking.payment_mode = 'online' then
    v_window_minutes := coalesce(nullif(public._sports_rule('request_response_minutes'), '')::int, -1);
    v_min_lead_minutes := coalesce(nullif(public._sports_rule('min_lead_minutes'), '')::int, -1);
    perform public._assert(v_window_minutes between 5 and 1440
                           and v_min_lead_minutes between 0 and 43200,
                           'sports approval payment rule is unavailable');
    v_pay_by := least(v_booking.starts_at - make_interval(mins => v_min_lead_minutes),
                      now() + make_interval(mins => v_window_minutes));
    perform public._assert(v_pay_by > now(), 'request is no longer payable');
    v_status := 'awaiting_payment';
    v_kind := 'sports_payment_due';
    v_title := 'Payment due for sports booking';
    v_body := v_booking.venue_name || ' approved your booking. Complete payment before the deadline.';
  else
    v_status := case when p_accept then 'accepted' else 'declined' end;
    v_kind := case when p_accept then 'sports_booking_accepted' else 'sports_booking_declined' end;
    v_title := case when p_accept then 'Sports booking accepted' else 'Sports booking declined' end;
    v_body := case when p_accept then v_booking.venue_name || ' accepted your request.'
                   else coalesce(nullif(btrim(p_reason), ''), v_booking.venue_name || ' declined your request.') end;
  end if;

  update public.sports_bookings
     set status = v_status,
         pay_by = v_pay_by,
         decision_reason = case when p_accept then '' else btrim(p_reason) end,
         decided_at = now()
   where id = p_id;
  begin
    perform public._queue_notification(
      v_booking.customer_id, v_kind, null, v_title, left(v_body, 300),
      jsonb_build_object('sports_booking_id', p_id, 'url', '/sports-booking/' || p_id::text),
      case when v_kind = 'sports_payment_due' then 'sports-payment-due:' || p_id::text
           else 'sports-booking-decision:' || p_id::text end
    );
  exception when others then
    raise warning 'sports notification skipped: %', sqlerrm;
  end;
end;
$$;

create or replace function public.book_sports_slot(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_slots int,
  p_participants int,
  p_payment_mode text,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_existing public.sports_bookings%rowtype;
  v_resource record;
  v_venue_id uuid;
  v_start_local timestamp;
  v_end_local timestamp;
  v_day smallint;
  v_hours public.sports_hours;
  v_end_at timestamptz;
  v_request_expires timestamptz;
  v_hold_expires timestamptz;
  v_price int;
  v_price_total bigint := 0;
  v_fee int := 0;
  v_total bigint;
  v_used int;
  v_slot_used int;
  v_hold_minutes int;
  v_commission_bp int;
  v_booking_mode text;
  v_status text;
  v_booking_id uuid;
  v_response_minutes int;
  v_min_lead_minutes int;
  v_max_active_holds int;
  v_active_holds int;
  v_slot_start timestamptz;
  v_slot_local time;
  v_slot_end_local time;
  i int;
begin
  perform public._assert(char_length(btrim(coalesce(p_idempotency_key, ''))) between 1 and 200,
                         'idempotency key is required');
  perform public._assert(p_payment_mode in ('online', 'pay_at_venue'), 'payment mode must be online or pay_at_venue');

  select * into v_existing from public.sports_bookings
   where customer_id = v_uid and idempotency_key = btrim(p_idempotency_key);
  if found then
    return jsonb_build_object(
      'booking_id', v_existing.id, 'status', v_existing.status,
      'total_paise', coalesce(v_existing.total_paise, v_existing.price_paise),
      'hold_expires_at', v_existing.hold_expires_at, 'pay_by', v_existing.pay_by
    );
  end if;

  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  if p_payment_mode = 'online' then
    perform public._assert(public._sports_feature('sports_online_payments'),
                           'Sports online payments are turned off right now.');
  end if;
  perform public._assert(p_starts_at > now() and p_starts_at <= now() + interval '30 days',
                         'start time must be within the next 30 days');
  perform public._assert(p_slots between 1 and 4, 'slot count must be between 1 and 4');
  perform public._assert(p_participants between 1 and 50, 'participant count must be between 1 and 50');
  perform public._assert(char_length(coalesce(p_note, '')) <= 500, 'request note is too long');
  perform public._assert(extract(second from (p_starts_at at time zone 'Asia/Kolkata')) = 0,
                         'start time must align to a slot boundary');
  perform public._assert(p_slots = 1 or public._sports_feature('sports_multi_slot'),
                         'Sports multi-slot booking is turned off right now.');
  perform public._assert(p_participants = 1 or public._sports_feature('sports_capacity_slots'),
                         'Sports capacity booking is turned off right now.');

  select r.venue_id into v_venue_id
    from public.sports_resources r
   where r.id = p_resource_id and r.active;
  perform public._assert(found, 'resource is unavailable');
  perform pg_advisory_xact_lock(hashtext('sports-venue:' || v_venue_id::text));
  perform pg_advisory_xact_lock(hashtext(p_resource_id::text));
  perform pg_advisory_xact_lock(hashtext('sports-customer:' || v_uid::text));
  select r.id, r.venue_id, r.slot_minutes, r.capacity, r.booking_mode,
         v.owner_id, v.name venue_name, v.status venue_status, v.payment_modes,
         a.active activity_active
    into v_resource
    from public.sports_resources r
    join public.sports_venues v on v.id = r.venue_id
    join public.sports_activities a on a.id = r.activity_id
   where r.id = p_resource_id and r.active;
  perform public._assert(found and v_resource.venue_status = 'verified' and v_resource.activity_active,
                         'resource is unavailable');
  perform public._assert(v_resource.owner_id <> v_uid, 'venue owners cannot book their own venue');
  if p_payment_mode = 'online' then
    perform public._assert(
      'online' = any(v_resource.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts pa
         where pa.provider_id = v_resource.owner_id and pa.activation_status = 'activated'
      ),
      'This venue does not accept online payment yet'
    );
  else
    perform public._assert('pay_at_venue' = any(v_resource.payment_modes),
                           'This venue does not accept pay-at-venue booking yet');
  end if;

  v_max_active_holds := coalesce(nullif(public._sports_rule('max_active_holds_per_customer'), '')::int, -1);
  perform public._assert(v_max_active_holds between 1 and 100,
                         'sports booking limit is unavailable');
  select count(*)::int into v_active_holds
    from public.sports_bookings b
   where b.customer_id = v_uid
     and (
       (b.status = 'requested' and b.expires_at > now())
       or (b.status = 'pending_payment' and b.hold_expires_at > now())
       or (b.status = 'awaiting_payment' and b.pay_by > now())
       or (b.status = 'accepted' and b.starts_at > now() and b.payment_mode = 'pay_at_venue')
     );
  perform public._assert(v_active_holds < v_max_active_holds,
                         'You have too many pending sports bookings.');

  v_start_local := p_starts_at at time zone 'Asia/Kolkata';
  v_end_at := p_starts_at + make_interval(mins => v_resource.slot_minutes * p_slots);
  v_end_local := v_end_at at time zone 'Asia/Kolkata';
  v_day := extract(dow from v_start_local)::smallint;
  select * into v_hours from public.sports_hours h
   where h.venue_id = v_resource.venue_id and h.weekday = v_day;
  perform public._assert(found, 'venue is closed on that day');
  perform public._assert(v_start_local::date = v_end_local::date
                         and v_start_local::time >= v_hours.opens
                         and v_end_local::time <= v_hours.closes,
                         'requested time is outside opening hours');
  perform public._assert(
    mod(extract(epoch from (v_start_local::time - v_hours.opens))::int, v_resource.slot_minutes * 60) = 0,
    'start time is not aligned to the venue slot schedule'
  );
  v_response_minutes := coalesce(nullif(public._sports_rule('request_response_minutes'), '')::int, -1);
  v_min_lead_minutes := coalesce(nullif(public._sports_rule('min_lead_minutes'), '')::int, -1);
  perform public._assert(v_response_minutes between 5 and 1440
                         and v_min_lead_minutes between 0 and 43200,
                         'sports booking window rules are unavailable');
  perform public._assert(p_starts_at > now() + make_interval(mins => v_min_lead_minutes),
                         'slot must start beyond the configured lead time');
  perform public._assert(not exists (
    select 1 from public.sports_blocks b
     where b.resource_id = p_resource_id and b.starts_at < v_end_at and b.ends_at > p_starts_at
  ), 'slot is blocked by the venue');

  v_used := 0;
  for i in 0 .. p_slots - 1 loop
    v_slot_start := p_starts_at + make_interval(mins => v_resource.slot_minutes * i);
    select coalesce(sum(b.participants), 0)::int into v_slot_used
      from public.sports_bookings b
     where b.resource_id = p_resource_id
       and b.starts_at < v_slot_start + make_interval(mins => v_resource.slot_minutes)
       and b.ends_at > v_slot_start
       and (
         b.status = 'accepted'
         or (b.status = 'requested' and b.expires_at > now())
         or (b.status = 'awaiting_payment' and b.pay_by > now())
         or (b.status = 'pending_payment' and b.hold_expires_at > now())
       );
    v_used := greatest(v_used, v_slot_used);
  end loop;
  perform public._assert(v_used + p_participants <= v_resource.capacity, 'slot is no longer available');

  for i in 0 .. p_slots - 1 loop
    v_slot_start := p_starts_at + make_interval(mins => v_resource.slot_minutes * i);
    v_slot_local := (v_slot_start at time zone 'Asia/Kolkata')::time;
    v_slot_end_local := ((v_slot_start + make_interval(mins => v_resource.slot_minutes)) at time zone 'Asia/Kolkata')::time;
    select r.price_paise into v_price
      from public.sports_price_rules r
     where r.resource_id = p_resource_id
       and (r.weekday = v_day or r.weekday is null)
       and r.starts <= v_slot_local and r.ends >= v_slot_end_local
     order by (r.weekday is null), r.starts
     limit 1;
    perform public._assert(v_price is not null, 'no price rule covers every requested slot');
    v_price_total := v_price_total + v_price;
  end loop;
  perform public._assert(v_price_total between 1 and 2147483647, 'total price is too large');

  v_commission_bp := coalesce(nullif(public._sports_rule('commission_bp'), '')::int, -1);
  perform public._assert(v_commission_bp between 0 and 5000, 'sports commission rule is unavailable');
  if p_payment_mode = 'online' then
    v_fee := coalesce(nullif(public._sports_rule('customer_fee_paise'), '')::int, -1);
    v_hold_minutes := coalesce(nullif(public._sports_rule('payment_hold_minutes'), '')::int, -1);
    perform public._assert(v_fee >= 0 and v_hold_minutes between 5 and 1440,
                           'sports payment rules are unavailable');
  end if;
  v_total := v_price_total + v_fee;
  perform public._assert(v_total between 1 and 2147483647, 'total price is too large');

  v_request_expires := least(
    p_starts_at - make_interval(mins => v_min_lead_minutes),
    now() + make_interval(mins => v_response_minutes)
  );
  perform public._assert(v_request_expires > now(), 'slot is inside the configured lead time');
  v_booking_mode := case
    when v_resource.booking_mode = 'instant' and public._sports_feature('sports_instant_booking') then 'instant'
    else 'approval'
  end;
  if p_payment_mode = 'online' and v_booking_mode = 'instant' then
    v_status := 'pending_payment';
    v_hold_expires := now() + make_interval(mins => v_hold_minutes);
  elsif p_payment_mode = 'pay_at_venue' and v_booking_mode = 'instant' then
    v_status := 'accepted';
  else
    v_status := 'requested';
  end if;

  insert into public.sports_bookings
    (customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise, note, expires_at,
     payment_mode, participants, hold_expires_at, customer_fee_paise, total_paise, commission_bp,
     idempotency_key, decided_at)
  values
    (v_uid, v_resource.venue_id, p_resource_id, p_starts_at, v_end_at, v_status, v_price_total::int,
     coalesce(p_note, ''), coalesce(v_hold_expires, v_request_expires), p_payment_mode,
     p_participants, v_hold_expires, v_fee, v_total::int, v_commission_bp,
     btrim(p_idempotency_key), case when v_status = 'accepted' then now() else null end)
  on conflict (customer_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_booking_id;

  if v_booking_id is null then
    select * into v_existing from public.sports_bookings
     where customer_id = v_uid and idempotency_key = btrim(p_idempotency_key);
    perform public._assert(found, 'booking could not be created');
    return jsonb_build_object(
      'booking_id', v_existing.id, 'status', v_existing.status,
      'total_paise', coalesce(v_existing.total_paise, v_existing.price_paise),
      'hold_expires_at', v_existing.hold_expires_at, 'pay_by', v_existing.pay_by
    );
  end if;

  if v_status = 'requested' then
    begin
      perform public._queue_notification(
        v_resource.owner_id, 'sports_booking_requested', null, 'New sports venue request',
        v_resource.venue_name || ' has a new booking request.',
        jsonb_build_object('sports_booking_id', v_booking_id, 'url', '/sports-booking/' || v_booking_id::text),
        'sports-booking-request:' || v_booking_id::text
      );
    exception when others then
      raise warning 'sports notification skipped: %', sqlerrm;
    end;
  elsif v_status = 'accepted' then
    begin
      perform public._queue_notification(
        v_uid, 'sports_booking_confirmed', null, 'Sports booking confirmed',
        v_resource.venue_name || ' booking confirmed.',
        jsonb_build_object('sports_booking_id', v_booking_id, 'url', '/sports-booking/' || v_booking_id::text),
        'sports-booking-confirmed:' || v_booking_id::text
      );
    exception when others then
      raise warning 'sports notification skipped: %', sqlerrm;
    end;
    begin
      perform public._queue_notification(
        v_resource.owner_id, 'sports_booking_confirmed', null, 'Sports booking confirmed',
        v_resource.venue_name || ' has a confirmed booking.',
        jsonb_build_object('sports_booking_id', v_booking_id, 'url', '/sports-booking/' || v_booking_id::text),
        'sports-booking-confirmed:' || v_booking_id::text
      );
    exception when others then
      raise warning 'sports notification skipped: %', sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'booking_id', v_booking_id, 'status', v_status, 'total_paise', v_total::int,
    'hold_expires_at', v_hold_expires, 'pay_by', null
  );
end;
$$;

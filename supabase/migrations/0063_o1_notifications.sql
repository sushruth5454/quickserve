-- WP O1; owns: _on_booking_event_notify, request_sports_slot, book_sports_slot, decide_sports_booking, _refund_unmatched_sports_capture, record_sports_payment_paid, cancel_sports_booking, expire_sports_requests; sources: WS7-T01, WS7-T08

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
      v_kind := 'booking_cancelled';
      if new.actor_id = b.customer_id then
        v_to := b.provider_id;
        v_title := 'Booking cancelled';
        v_body := 'The customer cancelled the ' || coalesce(v_cat, 'service') || ' booking.';
      elsif new.actor_id = b.provider_id then
        v_to := b.customer_id;
        v_title := 'Booking cancelled by your pro';
        v_body := v_pro || ' cancelled your ' || coalesce(v_cat, 'service')
                  || ' booking. Any refund due is on its way.';
      elsif new.actor_id is null then
        perform public._queue_notification(
          b.customer_id, v_kind, b.id, 'Booking cancelled',
          'This ' || coalesce(v_cat, 'service') || ' booking was cancelled.',
          jsonb_build_object('url', '/booking/' || b.id, 'booking_id', b.id), null);
        perform public._queue_notification(
          b.provider_id, v_kind, b.id, 'Booking cancelled',
          'This ' || coalesce(v_cat, 'service') || ' booking was cancelled.',
          jsonb_build_object('url', '/booking/' || b.id, 'booking_id', b.id), null);
        return null;
      else
        return null;
      end if;
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
  perform public._assert(p_slots between 1 and 48, 'slot count must be between 1 and 48');
  perform public._assert(char_length(coalesce(p_note, '')) <= 500, 'request note is too long');
  perform public._assert(extract(second from (p_starts_at at time zone 'Asia/Kolkata')) = 0,
                         'start time must align to a slot boundary');

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
  v_expires_at := least(p_starts_at - interval '30 minutes', now() + interval '2 hours');
  perform public._assert(v_expires_at > now(), 'slot must start more than 30 minutes from now');
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
  v_hold_minutes int;
  v_commission_bp int;
  v_slot_start timestamptz;
  v_slot_local time;
  v_slot_end_local time;
  v_booking_mode text;
  v_status text;
  v_booking_id uuid;
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

  select * into v_existing from public.sports_bookings
   where customer_id = v_uid and idempotency_key = btrim(p_idempotency_key);
  if found then
    return jsonb_build_object(
      'booking_id', v_existing.id, 'status', v_existing.status,
      'total_paise', coalesce(v_existing.total_paise, v_existing.price_paise),
      'hold_expires_at', v_existing.hold_expires_at, 'pay_by', v_existing.pay_by
    );
  end if;

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

  v_booking_mode := case
    when v_resource.booking_mode = 'instant' and public._sports_feature('sports_instant_booking') then 'instant'
    else 'approval'
  end;
  v_request_expires := least(p_starts_at - interval '30 minutes', now() + interval '2 hours');
  perform public._assert(v_request_expires > now(), 'slot must start more than 30 minutes from now');
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
    v_window_minutes := coalesce(nullif(public._sports_rule('approval_pay_window_minutes'), '')::int, -1);
    perform public._assert(v_window_minutes between 5 and 1440, 'sports approval payment rule is unavailable');
    v_pay_by := least(v_booking.starts_at - interval '30 minutes',
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

create or replace function public._refund_unmatched_sports_capture(
  p_booking_id uuid,
  p_payment_id text,
  p_amount int,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capture_payment_id uuid;
  v_refunded int;
begin
  if p_amount is null or p_amount <= 0 then
    return 0;
  end if;
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return 0;
  end if;

  insert into public.payments (
    sports_booking_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at
  ) values (
    p_booking_id, 'fixed', p_amount, 'paid', 'sports-capture:' || p_payment_id, p_payment_id, now()
  ) returning id into v_capture_payment_id;

  v_refunded := public._queue_refund(v_capture_payment_id, p_amount, p_reason);
  if v_refunded > 0 then
    begin
      perform public._queue_notification(
        (select b.customer_id from public.sports_bookings b where b.id = p_booking_id),
        'sports_refund_issued', null, 'Sports payment refunded',
        'An extra or mismatched sports payment has been queued for refund.',
        jsonb_build_object('sports_booking_id', p_booking_id, 'url', '/sports-booking/' || p_booking_id::text),
        'sports-refund-capture:' || p_payment_id
      );
    exception when others then
      raise warning 'sports notification skipped: %', sqlerrm;
    end;
  end if;
  return v_refunded;
end;
$$;

create or replace function public.record_sports_payment_paid(
  p_order_id text, p_payment_id text, p_amount int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_booking public.sports_bookings%rowtype;
  v_booking_id uuid;
  v_resource_id uuid;
  v_refunded int;
  v_payable boolean;
  v_owner_id uuid;
  v_venue_name text;
begin
  if nullif(btrim(coalesce(p_order_id, '')), '') is null
     or nullif(btrim(coalesce(p_payment_id, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'payment identifiers are required');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_payment_id));
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'captured amount must be positive');
  end if;
  select p.sports_booking_id into v_booking_id
    from public.payments p where p.razorpay_link_id = p_order_id;
  if not found or v_booking_id is null then
    return jsonb_build_object('ok', false, 'error', 'not a sports payment');
  end if;
  select resource_id into v_resource_id from public.sports_bookings where id = v_booking_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sports booking not found');
  end if;
  perform pg_advisory_xact_lock(hashtext(v_resource_id::text));
  select * into v_booking from public.sports_bookings where id = v_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sports booking not found');
  end if;
  select * into v_payment from public.payments
   where razorpay_link_id = p_order_id and sports_booking_id = v_booking_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not a sports payment');
  end if;
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if v_payment.razorpay_payment_id is not null then
    v_refunded := public._refund_unmatched_sports_capture(
      v_booking_id, p_payment_id, p_amount, 'duplicate sports payment capture'
    );
    return jsonb_build_object(
      'ok', true, 'booking_id', v_booking_id, 'duplicate_capture', true,
      'refund', v_refunded > 0, 'refund_amount', v_refunded
    );
  end if;
  if v_payment.amount <> p_amount then
    update public.payments
       set status = 'failed', cancel_link_pending = false
     where id = v_payment.id and status = 'created';
    v_refunded := public._refund_unmatched_sports_capture(
      v_booking_id, p_payment_id, p_amount, 'sports payment amount mismatch'
    );
    return jsonb_build_object(
      'ok', true, 'booking_id', v_booking_id, 'amount_mismatch', true,
      'refund', v_refunded > 0, 'refund_amount', v_refunded
    );
  end if;

  v_payable :=
    v_payment.status = 'created'
    and v_booking.payment_mode = 'online'
    and v_booking.paid_at is null
    and (
      (v_booking.status = 'pending_payment' and v_booking.hold_expires_at > now())
      or (v_booking.status = 'awaiting_payment' and v_booking.pay_by > now())
    );
  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
   where id = v_payment.id;

  if v_payable then
    update public.sports_bookings set status = 'accepted', paid_at = now()
     where id = v_booking.id;
    select owner_id, name into v_owner_id, v_venue_name
      from public.sports_venues where id = v_booking.venue_id;
    begin
      perform public._queue_notification(
        v_booking.customer_id, 'sports_booking_confirmed', null, 'Sports booking confirmed',
        v_venue_name || ' booking confirmed.',
        jsonb_build_object('sports_booking_id', v_booking.id, 'url', '/sports-booking/' || v_booking.id::text),
        'sports-booking-confirmed:' || v_booking.id::text
      );
    exception when others then
      raise warning 'sports notification skipped: %', sqlerrm;
    end;
    begin
      perform public._queue_notification(
        v_owner_id, 'sports_booking_confirmed', null, 'Sports booking confirmed',
        v_venue_name || ' has a paid booking.',
        jsonb_build_object('sports_booking_id', v_booking.id, 'url', '/sports-booking/' || v_booking.id::text),
        'sports-booking-confirmed:' || v_booking.id::text
      );
    exception when others then
      raise warning 'sports notification skipped: %', sqlerrm;
    end;
    return jsonb_build_object('ok', true, 'booking_id', v_booking.id);
  end if;

  v_refunded := public._queue_refund(v_payment.id, v_payment.amount, 'late or cancelled sports payment');
  if v_refunded > 0 then
    update public.sports_bookings set refund_paise = refund_paise + v_refunded
     where id = v_booking.id;
    begin
      perform public._queue_notification(
        v_booking.customer_id, 'sports_refund_issued', null, 'Sports payment refunded',
        'A payment received after the booking could no longer be accepted has been refunded.',
        jsonb_build_object('sports_booking_id', v_booking.id, 'url', '/sports-booking/' || v_booking.id::text),
        'sports-refund:' || v_booking.id::text
      );
    exception when others then
      raise warning 'sports notification skipped: %', sqlerrm;
    end;
  end if;
  return jsonb_build_object('ok', true, 'booking_id', v_booking.id, 'refund', v_refunded > 0);
end;
$$;

create or replace function public.cancel_sports_booking(p_id uuid, p_reason text default '')
returns void
language plpgsql
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
  v_target int := 0;
  v_refunded int := 0;
  v_owner_cancel boolean;
  v_notice_user uuid;
  v_notice_title text;
  v_notice_body text;
begin
  select resource_id into v_booking from public.sports_bookings where id = p_id;
  perform public._assert(found, 'booking not found');
  perform pg_advisory_xact_lock(hashtext(v_booking.resource_id::text));
  select b.*, v.owner_id, v.name venue_name, v.cancellation_rules into v_booking
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
    if v_owner_cancel then
      v_target := coalesce(v_booking.total_paise, v_booking.price_paise + v_booking.customer_fee_paise);
    else
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
        v_target := v_booking.price_paise;
      elsif v_hours_to_start >= v_partial_hours then
        v_target := round(v_booking.price_paise::numeric * v_partial_bp / 10000)::int;
      else
        v_target := 0;
      end if;
    end if;
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
         decision_reason = coalesce(btrim(p_reason), ''), decided_at = now()
   where id = p_id;
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

create or replace function public.expire_sports_requests()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resource record;
  v_booking record;
  v_expired_count int := 0;
begin
  for v_resource in
    select distinct b.resource_id
      from public.sports_bookings b
     where (b.status = 'requested' and b.expires_at <= now())
        or (b.status = 'pending_payment' and b.hold_expires_at <= now())
        or (b.status = 'awaiting_payment' and b.pay_by <= now())
        or (b.status = 'accepted' and b.ends_at <= now())
     order by b.resource_id
  loop
    perform pg_advisory_xact_lock(hashtext(v_resource.resource_id::text));
    for v_booking in
      with expired as (
        update public.sports_bookings b
           set status = 'expired', decided_at = now()
         where b.resource_id = v_resource.resource_id
           and (
             (b.status = 'requested' and b.expires_at <= now())
             or (b.status = 'pending_payment' and b.hold_expires_at <= now())
             or (b.status = 'awaiting_payment' and b.pay_by <= now())
           )
        returning b.id, b.customer_id, b.venue_id
      )
      select e.id, e.customer_id, e.venue_id, v.owner_id, v.name venue_name
        from expired e join public.sports_venues v on v.id = e.venue_id
    loop
      v_expired_count := v_expired_count + 1;
      update public.payments
         set status = 'failed', cancel_link_pending = (razorpay_link_id is not null)
       where sports_booking_id = v_booking.id and status = 'created';
      begin
        perform public._queue_notification(
          v_booking.customer_id, 'sports_booking_expired', null, 'Sports booking expired',
          v_booking.venue_name || ' booking expired before payment or owner decision.',
          jsonb_build_object('sports_booking_id', v_booking.id, 'url', '/sports-booking/' || v_booking.id::text),
          'sports-booking-expired:' || v_booking.id::text
        );
      exception when others then
        raise warning 'sports notification skipped: %', sqlerrm;
      end;
    end loop;

    for v_booking in
      with completed as (
        update public.sports_bookings b
           set status = 'completed', decided_at = now()
         where b.resource_id = v_resource.resource_id and b.status = 'accepted' and b.ends_at <= now()
        returning b.id, b.payment_mode, b.paid_at
      )
      select * from completed
    loop
      if v_booking.payment_mode = 'online' and v_booking.paid_at is not null then
        perform public._create_sports_payout(v_booking.id);
      end if;
    end loop;
  end loop;
  return v_expired_count;
end;
$$;

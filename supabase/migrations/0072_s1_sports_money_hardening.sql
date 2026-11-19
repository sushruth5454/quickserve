-- WP S1; owns: list_my_customer_sports_bookings, _create_sports_payout, request_sports_slot, book_sports_slot, cancel_sports_booking, record_sports_payment_paid, add_sports_block; sources: WS4-T01, T02, T03, T06, T10, T11, WS6-T09

alter table public.sports_bookings
  add column cancelled_by text check (cancelled_by in ('customer', 'venue', 'system'));

drop function if exists public.list_my_customer_sports_bookings();

drop function if exists public.save_sports_venue(uuid,text,text,text,text,text,double precision,double precision,text[],text[]);
drop function if exists public.save_sports_resource(uuid,uuid,uuid,text,int,boolean);

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
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
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

create or replace function public.add_sports_block(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_id uuid;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(exists (
    select 1 from public.sports_resources r join public.sports_venues v on v.id = r.venue_id
     where r.id = p_resource_id and v.owner_id = v_uid
  ), 'resource not found or not owned by you');
  perform public._assert(p_starts_at is not null and p_ends_at > p_starts_at, 'block end must be after its start');
  perform public._assert(char_length(coalesce(p_reason, '')) <= 200, 'block reason is too long');
  perform pg_advisory_xact_lock(hashtext(p_resource_id::text));
  perform public._assert(not exists (
    select 1 from public.sports_bookings b
     where b.resource_id = p_resource_id and b.starts_at < p_ends_at and b.ends_at > p_starts_at
       and (b.status = 'accepted'
            or (b.status = 'requested' and b.expires_at > now())
            or (b.status = 'awaiting_payment' and b.pay_by > now())
            or (b.status = 'pending_payment' and b.hold_expires_at > now()))
  ), 'cannot block a time with an active booking');
  insert into public.sports_blocks (resource_id, starts_at, ends_at, reason)
  values (p_resource_id, p_starts_at, p_ends_at, coalesce(p_reason, ''))
  returning id into v_id;
  return v_id;
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
  perform public._assert(p_slots between 1 and 4, 'slot count must be between 1 and 4');
  perform public._assert(p_slots = 1 or public._sports_feature('sports_multi_slot'),
                         'Sports multi-slot booking is turned off right now.');
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
  v_slot_used int;
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
  if not v_payable and v_booking.paid_at is not null then
    update public.payments
       set status = 'failed', razorpay_payment_id = null
     where id = v_payment.id;
    v_refunded := public._refund_unmatched_sports_capture(
      v_booking_id, p_payment_id, p_amount, 'late duplicate sports payment capture'
    );
    return jsonb_build_object(
      'ok', true, 'booking_id', v_booking_id, 'late_capture', true,
      'refund', v_refunded > 0, 'refund_amount', v_refunded
    );
  end if;

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

create or replace function public._create_sports_payout(p_sports_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_payout_id uuid;
  v_gross int;
  v_commission_bp int;
  v_commission int;
  v_gst int;
  v_amount int;
  v_release_hours int;
  v_remaining int;
  v_payment record;
  v_available int;
  v_transfer int;
  v_is_demo boolean;
begin
  select b.*, v.owner_id into v_booking
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
   where b.id = p_sports_booking_id
   for update of b;
  if not found
     or v_booking.status not in ('completed', 'cancelled')
     or (v_booking.status = 'cancelled' and v_booking.cancelled_by is distinct from 'customer')
     or v_booking.payment_mode <> 'online' or v_booking.paid_at is null then
    return;
  end if;
  if exists (select 1 from public.payouts p where p.sports_booking_id = p_sports_booking_id) then
    return;
  end if;
  v_is_demo := exists (
    select 1
      from public.payments p
     where p.sports_booking_id = p_sports_booking_id
       and p.status = 'paid'
       and p.razorpay_payment_id is not null
       and left(p.razorpay_payment_id, 9) = 'pay_demo_'
  );

  v_gross := greatest(v_booking.price_paise - v_booking.refund_paise, 0);
  if v_gross <= 0 then
    return;
  end if;
  v_commission_bp := coalesce(v_booking.commission_bp,
                              nullif(public._sports_rule('commission_bp'), '')::int, -1);
  v_release_hours := coalesce(nullif(public._sports_rule('release_after_hours'), '')::int, -1);
  perform public._assert(v_commission_bp between 0 and 5000, 'sports commission snapshot is unavailable');
  perform public._assert(v_release_hours between 0 and 720, 'sports payout release rule is unavailable');
  v_commission := round(v_gross::numeric * v_commission_bp / 10000)::int;
  v_gst := round(v_commission::numeric * 18 / 100)::int;
  v_amount := greatest(v_gross - v_commission - v_gst, 0);

  insert into public.payouts
    (booking_id, provider_id, sports_booking_id, payee_id, gross, commission,
     gst_on_commission, amount, status, release_after)
  values
    (null, null, p_sports_booking_id, v_booking.owner_id, v_gross, v_commission,
     v_gst, v_amount,
     case when v_is_demo then 'demo'::public.payout_status else 'pending'::public.payout_status end,
     now() + make_interval(hours => v_release_hours))
  on conflict (sports_booking_id) do nothing
  returning id into v_payout_id;
  if v_payout_id is null or v_amount = 0 or v_is_demo then
    return;
  end if;

  v_remaining := v_amount;
  for v_payment in
    select p.id, p.amount
      from public.payments p
     where p.sports_booking_id = p_sports_booking_id
       and p.status = 'paid' and p.razorpay_payment_id is not null
       and left(p.razorpay_payment_id, 9) <> 'pay_demo_'
     order by p.paid_at, p.id
     for update
  loop
    exit when v_remaining <= 0;
    v_available := v_payment.amount
      - coalesce((select sum(t.amount) from public.payout_transfers t
                   where t.source_payment_id = v_payment.id), 0)
      - coalesce((select sum(r.amount) from public.refunds r
                   where r.payment_id = v_payment.id and r.status <> 'failed'), 0);
    v_transfer := least(greatest(v_available, 0), v_remaining);
    if v_transfer > 0 then
      insert into public.payout_transfers (payout_id, source_payment_id, amount)
      values (v_payout_id, v_payment.id, v_transfer);
      v_remaining := v_remaining - v_transfer;
    end if;
  end loop;
  perform public._assert(v_remaining = 0, 'paid sports amount does not cover venue payout');
end;
$$;

revoke all on function public.list_my_customer_sports_bookings() from public, anon, service_role;
grant execute on function public.list_my_customer_sports_bookings() to authenticated;

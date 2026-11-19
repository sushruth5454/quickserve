-- WP F1; owns: record_payment_paid, record_session_payment_paid, record_pack_payment_paid, record_time_payment_paid;
-- sources: WS6-T01, WS6-T02, WS6-T05, WS8-T03, WS8-T04.

create table public.payment_exceptions (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  razorpay_payment_id text not null unique,
  amount int not null,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.payment_exceptions enable row level security;
revoke all on public.payment_exceptions from public, anon, authenticated;
grant all on public.payment_exceptions to service_role;

create or replace function public._record_payment_exception(
  p_reference text,
  p_payment_id text,
  p_amount int,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.payment_exceptions (reference, razorpay_payment_id, amount, reason)
  values (p_reference, p_payment_id, coalesce(p_amount, 0), p_reason)
  on conflict (razorpay_payment_id) do update
    set reference = excluded.reference,
        amount = excluded.amount,
        reason = excluded.reason;
end;
$$;
revoke all on function public._record_payment_exception(text, text, int, text)
  from public, anon, authenticated;
grant execute on function public._record_payment_exception(text, text, int, text) to service_role;

create or replace function public.record_payment_paid(p_link_id text, p_payment_id text, p_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  p2 public.payments;
  b public.bookings;
  q public.quotes;
  v_ids uuid[];
  v_required int;
  v_accept boolean;
  v_all_due boolean;
  v_any_at_booking boolean;
  v_all_base boolean;
  v_all_addon boolean;
  v_refund int;
begin
  perform pg_advisory_xact_lock(hashtext(p_payment_id));
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    delete from public.payment_exceptions where razorpay_payment_id = p_payment_id;
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into p from public.payments where razorpay_link_id = p_link_id for update;
  if not found then
    perform public._record_payment_exception(p_link_id, p_payment_id, p_amount, 'unknown link');
    return jsonb_build_object('ok', false, 'error', 'unknown link', 'exception', true);
  end if;
  if p.razorpay_payment_id = p_payment_id then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if p_amount is null or p_amount <= 0 then
    perform public._record_payment_exception(p_link_id, p_payment_id, p_amount, 'captured amount must be positive');
    return jsonb_build_object('ok', false, 'error', 'captured amount must be positive', 'exception', true);
  end if;
  if p.amount <> p_amount then
    if p.status = 'created' then
      update public.payments
         set status = 'failed', cancel_link_pending = false
       where id = p.id;
    end if;
    insert into public.payments (
      booking_id, quote_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at
    ) values (
      p.booking_id, p.quote_id, p.purpose, p_amount, 'paid', 'capture:' || p_payment_id, p_payment_id, now()
    ) returning * into p2;
    v_refund := public._queue_refund(p2.id, p_amount, 'amount mismatch');
    perform public._record_payment_exception(p_link_id, p_payment_id, p_amount, 'amount mismatch');
    perform public._log_event(p.booking_id, null, 'payment ' || p_payment_id || ' amount mismatch; refund queued');
    return jsonb_build_object(
      'ok', true, 'amount_mismatch', true, 'refund', v_refund > 0,
      'refund_amount', v_refund, 'capture_payment_id', p2.id, 'exception', true
    );
  end if;
  if p.status <> 'created' or p.razorpay_payment_id is not null then
    insert into public.payments (
      booking_id, quote_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at
    ) values (
      p.booking_id, p.quote_id, p.purpose, p_amount, 'paid', 'extra-capture:' || p_payment_id, p_payment_id, now()
    ) returning * into p2;
    v_refund := public._queue_refund(p2.id, p_amount, 'duplicate capture');
    perform public._log_event(p.booking_id, null, 'duplicate capture ' || p_payment_id || ' refunded');
    return jsonb_build_object(
      'ok', true, 'duplicate_capture', true, 'refund', v_refund > 0,
      'refund_amount', v_refund, 'capture_payment_id', p2.id
    );
  end if;
  delete from public.payment_exceptions where razorpay_payment_id = p_payment_id;
  b := public._lock_booking(p.booking_id);

  select array_agg(o.schedule_id) into v_ids from public.payment_obligations o where o.payment_id = p.id;
  if v_ids is null and p.schedule_id is not null then
    v_ids := array[p.schedule_id];
  end if;

  if v_ids is not null and b.archetype in ('proposal', 'fixed') then
    perform 1 from public.payment_schedule ps where ps.id = any (v_ids) for update;
    select coalesce(bool_and(ps.status = 'due'), false),
           coalesce(bool_or(ps.due_rule = 'at_booking'), false),
           coalesce(bool_and(ps.obligation_type in ('service', 'platform_fee')), false),
           coalesce(bool_and(ps.obligation_type = 'addon'), false)
      into v_all_due, v_any_at_booking, v_all_base, v_all_addon
      from public.payment_schedule ps
     where ps.id = any (v_ids);
    v_all_due := v_all_due
      and (select coalesce(sum(ps.amount), 0) from public.payment_schedule ps where ps.id = any (v_ids)) = p.amount;

    if b.archetype = 'proposal' then
      v_accept := p.status = 'created' and v_all_due
        and b.status not in ('expired', 'cancelled', 'declined')
        and (not v_any_at_booking or coalesce(b.payment_hold_expires_at, '-infinity') > now());
    else
      select * into q from public.quotes where id = p.quote_id for update;
      v_accept := p.status = 'created' and v_all_due and q.id is not null
        and ((b.status = 'pending_payment' and q.status = 'approved_pending_payment' and v_all_base)
          or (b.status = 'in_progress' and q.status = 'approved_pending_payment' and v_all_addon));
    end if;

    update public.payments
       set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
     where id = p.id;
    if not v_accept then
      perform public._queue_refund(p.id, p.amount, 'stale, expired or excess scheduled payment');
      perform public._log_event(b.id, null, 'payment ' || p_payment_id || ' not owed; refund queued');
      return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund', true);
    end if;

    update public.payment_schedule
       set status = 'paid', payment_id = p.id, paid_at = now(), updated_at = now()
     where id = any (v_ids);

    if b.archetype = 'proposal' then
      update public.bookings set payment_hold_expires_at = null
       where id = b.id
         and not exists (
           select 1 from public.payment_schedule
            where booking_id = b.id and due_rule = 'at_booking' and status <> 'paid'
         );
      if b.status = 'pending_payment' and not exists (
        select 1 from public.payment_schedule
         where booking_id = b.id and due_rule = 'at_booking' and status <> 'paid'
      ) then
        perform 1 from public.service_requests where id = b.service_request_id for update;
        update public.quotes set status = 'approved' where id = b.approved_quote_id;
        update public.service_requests set status = 'booked', updated_at = now() where id = b.service_request_id;
        update public.proposals set status = 'rejected', updated_at = now()
         where request_id = b.service_request_id and status = 'sent' and id <> b.proposal_id;
        update public.bookings set accepted_at = now(), payment_hold_expires_at = null where id = b.id;
        perform public._set_status(b.id, 'confirmed', null, 'advance and platform fee paid');
        perform public._queue_notification(
          b.customer_id, 'proposal_booked', b.id, 'Booking confirmed',
          'Your advance is paid and the provider is confirmed.',
          jsonb_build_object('booking_id', b.id, 'proposal_id', b.proposal_id), 'proposal-booked:' || b.id::text
        );
        perform public._queue_notification(
          b.provider_id, 'proposal_booked', b.id, 'You have a confirmed booking',
          'The customer paid the booking advance.',
          jsonb_build_object('booking_id', b.id, 'proposal_id', b.proposal_id), 'proposal-booked:' || b.id::text
        );
      end if;
    elsif not exists (
      select 1 from public.payment_schedule x
       where x.booking_id = b.id and x.quote_id = q.id and x.status <> 'paid'
    ) then
      perform public._activate_quote(b.id, q.id);
      if b.status = 'pending_payment' then
        perform public._set_status(b.id, 'requested', null, 'fixed package fully paid');
        if b.recurring_schedule_id is not null and exists (
          select 1 from public.recurring_schedules r
           where r.id = b.recurring_schedule_id
             and r.acceptance_mode = 'plan'
             and r.provider_acceptance = 'accepted'
        ) then
          update public.bookings set accepted_at = now() where id = b.id;
          perform public._set_status(b.id, 'accepted', null, 'recurring plan pre-accepted');
        end if;
      else
        perform public._log_event(b.id, null, 'fixed add-on v' || q.version || ' paid');
      end if;
    end if;
    return jsonb_build_object('ok', true, 'booking_id', b.id, 'schedule_ids', to_jsonb(v_ids));
  end if;

  if p.status = 'created' then
    if p.purpose = 'fixed' and b.booking_origin = 'byo' and b.status = 'pending_payment' then
      select * into q from public.quotes where id = p.quote_id for update;
      if q.status = 'approved' then
        v_required := b.total_amount;
      end if;
    elsif p.purpose = 'visit_fee' and b.status = 'pending_payment' then
      v_required := b.visit_fee;
    elsif p.purpose = 'balance' and p.quote_id is not null then
      select * into q from public.quotes where id = p.quote_id for update;
      if q.status = 'approved_pending_payment' then
        v_required := public._required_total(q.total, b.visit_fee, b.platform_fee);
      end if;
    end if;
  end if;
  v_accept := v_required is not null and public._net_paid(b.id) + p.amount <= v_required;
  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
   where id = p.id;
  if not v_accept then
    perform public._queue_refund(p.id, p.amount, 'stale or excess payment');
    perform public._log_event(b.id, null, 'payment ' || p_payment_id || ' not owed; queued for refund');
    return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund', true);
  end if;
  if p.purpose = 'fixed' then
    update public.bookings set accepted_at = now() where id = b.id;
    perform public._set_status(b.id, 'accepted', null, 'BYO fixed payment received');
  elsif p.purpose = 'visit_fee' then
    perform public._set_status(b.id, 'requested', null, 'visit fee paid');
  elsif public._net_paid(b.id) >= v_required then
    perform public._activate_quote(b.id, q.id);
    if b.status = 'awaiting_payment' then
      perform public._set_status(b.id, 'in_progress', null, 'balance paid');
    else
      perform public._log_event(b.id, null, 'change order v' || q.version || ' paid');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'booking_id', b.id);
end;
$$;

create or replace function public.record_session_payment_paid(
  p_link_id text, p_payment_id text, p_amount int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  p2 public.payments;
  b public.bookings;
  v_ids uuid[];
  v_ok boolean;
  v_refund int;
begin
  perform pg_advisory_xact_lock(hashtext(p_payment_id));
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    delete from public.payment_exceptions where razorpay_payment_id = p_payment_id;
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into p from public.payments where razorpay_link_id = p_link_id for update;
  if not found then
    perform public._record_payment_exception(p_link_id, p_payment_id, p_amount, 'unknown link');
    return jsonb_build_object('ok', false, 'error', 'unknown link', 'exception', true);
  end if;
  if p.booking_id is null then
    perform public._record_payment_exception(p_link_id, p_payment_id, p_amount, 'not a session payment');
    return jsonb_build_object('ok', false, 'error', 'not a session payment', 'exception', true);
  end if;
  if p.razorpay_payment_id = p_payment_id then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if p_amount is null or p_amount <= 0 then
    perform public._record_payment_exception(p_link_id, p_payment_id, p_amount, 'captured amount must be positive');
    return jsonb_build_object('ok', false, 'error', 'captured amount must be positive', 'exception', true);
  end if;
  if p.amount <> p_amount then
    if p.status = 'created' then
      update public.payments
         set status = 'failed', cancel_link_pending = false
       where id = p.id;
    end if;
    insert into public.payments (
      booking_id, quote_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at
    ) values (
      p.booking_id, p.quote_id, p.purpose, p_amount, 'paid', 'capture:' || p_payment_id, p_payment_id, now()
    ) returning * into p2;
    v_refund := public._queue_refund(p2.id, p_amount, 'amount mismatch');
    perform public._record_payment_exception(p_link_id, p_payment_id, p_amount, 'amount mismatch');
    perform public._log_event(p.booking_id, null, 'payment ' || p_payment_id || ' amount mismatch; refund queued');
    return jsonb_build_object(
      'ok', true, 'amount_mismatch', true, 'refund', v_refund > 0,
      'refund_amount', v_refund, 'capture_payment_id', p2.id, 'exception', true
    );
  end if;
  if p.status <> 'created' or p.razorpay_payment_id is not null then
    insert into public.payments (
      booking_id, quote_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at
    ) values (
      p.booking_id, p.quote_id, p.purpose, p_amount, 'paid', 'extra-capture:' || p_payment_id, p_payment_id, now()
    ) returning * into p2;
    v_refund := public._queue_refund(p2.id, p_amount, 'duplicate capture');
    perform public._log_event(p.booking_id, null, 'duplicate capture ' || p_payment_id || ' refunded');
    return jsonb_build_object(
      'ok', true, 'duplicate_capture', true, 'refund', v_refund > 0,
      'refund_amount', v_refund, 'capture_payment_id', p2.id
    );
  end if;
  delete from public.payment_exceptions where razorpay_payment_id = p_payment_id;
  select array_agg(o.schedule_id) into v_ids from public.payment_obligations o where o.payment_id = p.id;
  if v_ids is null and p.schedule_id is not null then
    v_ids := array[p.schedule_id];
  end if;
  if v_ids is null then
    perform public._record_payment_exception(p_link_id, p_payment_id, p_amount, 'not a session payment');
    return jsonb_build_object('ok', false, 'error', 'not a session payment', 'exception', true);
  end if;
  b := public._lock_booking(p.booking_id);
  perform 1 from public.payment_schedule x where x.id = any (v_ids) for update;
  select coalesce(bool_and(x.status = 'due'), false) and coalesce(sum(x.amount), 0) = p.amount
    into v_ok
    from public.payment_schedule x
   where x.id = any (v_ids);

  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
   where id = p.id;
  if p.status <> 'created' or b.archetype <> 'time_based' or not v_ok then
    perform public._queue_refund(p.id, p.amount, 'stale or excess session payment');
    return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund', true);
  end if;
  update public.payment_schedule
     set status = 'paid', payment_id = p.id, paid_at = now(), updated_at = now()
   where id = any (v_ids);

  if not exists (
    select 1 from public.payment_schedule x
     where x.booking_id = b.id and x.status in ('upcoming', 'due')
  ) and b.status = 'pending_payment' then
    perform public._set_status(b.id, 'requested', null, 'session paid');
    if b.recurring_schedule_id is not null and exists (
      select 1 from public.recurring_schedules r
       where r.id = b.recurring_schedule_id
         and r.acceptance_mode = 'plan'
         and r.provider_acceptance = 'accepted'
    ) then
      update public.bookings set accepted_at = now() where id = b.id;
      perform public._set_status(b.id, 'accepted', null, 'recurring plan pre-accepted');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'booking_id', b.id, 'schedule_ids', to_jsonb(v_ids));
end;
$$;

create or replace function public.record_pack_payment_paid(
  p_link_id text, p_payment_id text, p_amount int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  p2 public.payments;
  k public.pack_purchases;
  v_refund int;
begin
  perform pg_advisory_xact_lock(hashtext(p_payment_id));
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    delete from public.payment_exceptions where razorpay_payment_id = p_payment_id;
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into p from public.payments where razorpay_link_id = p_link_id for update;
  if not found then
    perform public._record_payment_exception(p_link_id, p_payment_id, p_amount, 'unknown link');
    return jsonb_build_object('ok', false, 'error', 'unknown link', 'exception', true);
  end if;
  if p.pack_purchase_id is null then
    perform public._record_payment_exception(p_link_id, p_payment_id, p_amount, 'not a pack payment');
    return jsonb_build_object('ok', false, 'error', 'not a pack payment', 'exception', true);
  end if;
  if p.razorpay_payment_id = p_payment_id then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if p_amount is null or p_amount <= 0 then
    perform public._record_payment_exception(p_link_id, p_payment_id, p_amount, 'captured amount must be positive');
    return jsonb_build_object('ok', false, 'error', 'captured amount must be positive', 'exception', true);
  end if;
  if p.amount <> p_amount then
    if p.status = 'created' then
      update public.payments
         set status = 'failed', cancel_link_pending = false
       where id = p.id;
    end if;
    insert into public.payments (
      pack_purchase_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at
    ) values (
      p.pack_purchase_id, p.purpose, p_amount, 'paid', 'capture:' || p_payment_id, p_payment_id, now()
    ) returning * into p2;
    v_refund := public._queue_refund(p2.id, p_amount, 'amount mismatch');
    perform public._record_payment_exception(p_link_id, p_payment_id, p_amount, 'amount mismatch');
    return jsonb_build_object(
      'ok', true, 'amount_mismatch', true, 'refund', v_refund > 0,
      'refund_amount', v_refund, 'capture_payment_id', p2.id, 'exception', true
    );
  end if;
  if p.status <> 'created' or p.razorpay_payment_id is not null then
    insert into public.payments (
      pack_purchase_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at
    ) values (
      p.pack_purchase_id, p.purpose, p_amount, 'paid', 'extra-capture:' || p_payment_id, p_payment_id, now()
    ) returning * into p2;
    v_refund := public._queue_refund(p2.id, p_amount, 'duplicate capture');
    return jsonb_build_object(
      'ok', true, 'duplicate_capture', true, 'refund', v_refund > 0,
      'refund_amount', v_refund, 'capture_payment_id', p2.id
    );
  end if;
  delete from public.payment_exceptions where razorpay_payment_id = p_payment_id;
  select * into k from public.pack_purchases where id = p.pack_purchase_id for update;

  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
   where id = p.id;

  if p.status <> 'created' or k.status <> 'pending_payment' then
    perform public._queue_refund(p.id, p.amount, 'stale pack payment');
    return jsonb_build_object('ok', true, 'pack_id', k.id, 'refund', true);
  end if;

  update public.pack_purchases
     set status = 'active', payment_id = p.id, expires_at = now() + interval '90 days'
   where id = k.id;
  return jsonb_build_object('ok', true, 'pack_id', k.id, 'activated', true);
end;
$$;

create or replace function public.record_time_payment_paid(
  p_link_id text, p_payment_id text, p_amount int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
begin
  perform pg_advisory_xact_lock(hashtext(p_payment_id));
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    delete from public.payment_exceptions where razorpay_payment_id = p_payment_id;
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into p from public.payments where razorpay_link_id = p_link_id;
  if p.pack_purchase_id is not null then
    return public.record_pack_payment_paid(p_link_id, p_payment_id, p_amount);
  end if;
  return public.record_session_payment_paid(p_link_id, p_payment_id, p_amount);
end;
$$;

revoke all on function public.record_payment_paid(text, text, int),
  public.record_session_payment_paid(text, text, int),
  public.record_pack_payment_paid(text, text, int),
  public.record_time_payment_paid(text, text, int)
from public, anon, authenticated;
grant execute on function public.record_payment_paid(text, text, int),
  public.record_session_payment_paid(text, text, int),
  public.record_pack_payment_paid(text, text, int),
  public.record_time_payment_paid(text, text, int)
to service_role;

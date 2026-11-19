-- WP B6; owns: _on_booking_event_notify, record_payment_paid, record_session_payment_paid,
-- record_pack_payment_paid, complete_refund, complete_transfer, fail_transfer,
-- record_payout_gateway_event, admin_review_document, admin_set_provider_review,
-- set_provider_suspended, payment_receipts_on_payment_paid; sources: WS9-T14, WS7-T07

-- B2 receipts are booking-scoped; a pack purchase must not fail the payment update.
drop trigger if exists payment_receipts_on_payment_paid on public.payments;
create trigger payment_receipts_on_payment_paid
after update of status on public.payments
for each row
when (
  new.status = 'paid'
  and new.funding_source = 'customer'
  and new.booking_id is not null
)
execute function public._issue_payment_receipt();

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
  v_release_after timestamptz;
  v_outcome text;
  v_collapse_key text;
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
    elsif new.to_status = 'in_progress' and new.from_status in ('quote_sent', 'awaiting_payment') then
      v_to := b.provider_id; v_kind := 'quote_approved';
      v_title := 'Bill approved';
      v_body := 'The customer approved your bill — start the work.';
      v_collapse_key := 'booking-event:' || new.id::text;
    elsif new.from_status = 'disputed' and new.to_status is distinct from 'disputed' then
      v_kind := 'dispute_resolved';
      v_title := 'Problem resolved';
      v_outcome := coalesce(nullif(trim(new.note), ''), new.to_status::text);
      v_body := 'The customer report was resolved: ' || v_outcome || '.';
      perform public._queue_notification(
        b.customer_id, v_kind, b.id, v_title, v_body,
        jsonb_build_object('url', '/booking/' || b.id, 'booking_id', b.id, 'outcome', v_outcome),
        'booking-event:' || new.id::text || ':customer');
      perform public._queue_notification(
        b.provider_id, v_kind, b.id, v_title, v_body,
        jsonb_build_object('url', '/booking/' || b.id, 'booking_id', b.id, 'outcome', v_outcome),
        'booking-event:' || new.id::text || ':provider');
      return null;
    elsif new.to_status = 'completed' and new.from_status is distinct from 'completed' then
      select p.release_after into v_release_after
        from public.payouts p
       where p.booking_id = b.id;
      if v_release_after is null then
        return null;
      end if;
      v_to := b.provider_id; v_kind := 'job_completed_payout_scheduled';
      v_title := 'Job finished';
      v_body := 'Payment is scheduled for ' ||
        to_char(v_release_after at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.';
      v_collapse_key := 'booking-event:' || new.id::text;
    elsif new.to_status = 'disputed' and new.from_status is distinct from 'disputed' then
      v_to := b.provider_id; v_kind := 'dispute_opened';
      v_title := 'Customer reported a problem';
      v_body := 'Payment for this job is on hold while support reviews the report.';
      v_collapse_key := 'booking-event:' || new.id::text;
    else
      return null;
    end if;

    if v_to is null or v_to is not distinct from new.actor_id then
      return null;
    end if;
    perform public._queue_notification(v_to, v_kind, b.id, v_title, v_body,
      case when v_kind = 'job_completed_payout_scheduled'
        then jsonb_build_object(
          'url', '/booking/' || b.id,
          'booking_id', b.id,
          'release_after', v_release_after)
        else jsonb_build_object('url', '/booking/' || b.id, 'booking_id', b.id)
      end,
      v_collapse_key);
  exception when others then
    raise warning 'booking notification skipped: %', sqlerrm;
  end;
  return null;
end;
$$;

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
    perform public._append_payment_capture_event(p2.id);
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
    perform public._append_payment_capture_event(p2.id);
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
    perform public._append_payment_capture_event(p.id);
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
        begin
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
        exception when others then
          raise warning 'proposal booking notification skipped: %', sqlerrm;
        end;
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
    begin
      perform public._queue_notification(
        b.customer_id, 'payment_received', b.id, 'Payment received',
        'Your payment has been received and confirmed.',
        jsonb_build_object(
          'url', '/booking/' || b.id,
          'booking_id', b.id,
          'payment_id', p.id,
          'amount_paise', p.amount
        ),
        'payment-received:' || p.id::text
      );
    exception when others then
      raise warning 'payment notification skipped: %', sqlerrm;
    end;
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
  perform public._append_payment_capture_event(p.id);
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
  begin
    perform public._queue_notification(
      b.customer_id, 'payment_received', b.id, 'Payment received',
      'Your payment has been received and confirmed.',
      jsonb_build_object(
        'url', '/booking/' || b.id,
        'booking_id', b.id,
        'payment_id', p.id,
        'amount_paise', p.amount
      ),
      'payment-received:' || p.id::text
    );
  exception when others then
    raise warning 'payment notification skipped: %', sqlerrm;
  end;
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
    perform public._append_payment_capture_event(p2.id);
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
    perform public._append_payment_capture_event(p2.id);
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
  perform public._append_payment_capture_event(p.id);
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
  begin
    perform public._queue_notification(
      b.customer_id, 'payment_received', b.id, 'Payment received',
      'Your session payment has been received and confirmed.',
      jsonb_build_object(
        'url', '/booking/' || b.id,
        'booking_id', b.id,
        'payment_id', p.id,
        'amount_paise', p.amount
      ),
      'payment-received:' || p.id::text
    );
  exception when others then
    raise warning 'session payment notification skipped: %', sqlerrm;
  end;
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
    perform public._append_payment_capture_event(p2.id);
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
    perform public._append_payment_capture_event(p2.id);
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
  perform public._append_payment_capture_event(p.id);

  if p.status <> 'created' or k.status <> 'pending_payment' then
    perform public._queue_refund(p.id, p.amount, 'stale pack payment');
    return jsonb_build_object('ok', true, 'pack_id', k.id, 'refund', true);
  end if;

  update public.pack_purchases
     set status = 'active', payment_id = p.id, expires_at = now() + interval '90 days'
   where id = k.id;
  begin
    perform public._queue_notification(
      k.customer_id, 'payment_received', null, 'Payment received',
      'Your session pack payment has been received and confirmed.',
      jsonb_build_object(
        'pack_purchase_id', k.id,
        'payment_id', p.id,
        'amount_paise', p.amount
      ),
      'payment-received:' || p.id::text
    );
  exception when others then
    raise warning 'pack payment notification skipped: %', sqlerrm;
  end;
  return jsonb_build_object('ok', true, 'pack_id', k.id, 'activated', true);
end;
$$;

create or replace function public.complete_refund(p_refund_id uuid, p_razorpay_refund_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment uuid;
  v_booking uuid;
  v_customer uuid;
  v_amount int;
  v_processed_at timestamptz;
begin
  update public.refunds
     set status = 'refunded',
         razorpay_refund_id = p_razorpay_refund_id,
         processed_at = now(),
         processing_started_at = null,
         next_attempt_at = null,
         last_error = null
   where id = p_refund_id and status = 'processing'
  returning payment_id, amount, processed_at into v_payment, v_amount, v_processed_at;
  if v_payment is null then
    return;
  end if;
  update public.payments p
     set status = 'refunded'
   where p.id = v_payment
     and p.status in ('refund_pending', 'refund_processing')
     and (select coalesce(sum(r.amount), 0)
            from public.refunds r
           where r.payment_id = p.id and r.status = 'refunded') >= p.amount;
  select p.booking_id, coalesce(b.customer_id, k.customer_id)
    into v_booking, v_customer
    from public.payments p
    left join public.bookings b on b.id = p.booking_id
    left join public.pack_purchases k on k.id = p.pack_purchase_id
   where p.id = v_payment;
  if v_customer is not null then
    begin
      perform public._queue_notification(
        v_customer, 'refund_completed', v_booking, 'Refund processed',
        'Your refund of ₹' || to_char(v_amount::numeric / 100, 'FM9999999990.00') || ' is complete.',
        jsonb_build_object(
          'url', case when v_booking is null then null else '/booking/' || v_booking end,
          'booking_id', v_booking,
          'payment_id', v_payment,
          'refund_id', p_refund_id,
          'amount_paise', v_amount,
          'processed_at', v_processed_at
        ),
        'refund-completed:' || p_refund_id::text
      );
    exception when others then
      raise warning 'refund notification skipped: %', sqlerrm;
    end;
  end if;
end;
$$;

create or replace function public.complete_transfer(p_transfer_id uuid, p_razorpay_transfer_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout uuid;
  v_booking uuid;
  v_recipient uuid;
  v_amount int;
  v_sports_booking uuid;
begin
  update public.payout_transfers
     set status = 'transferred', razorpay_transfer_id = p_razorpay_transfer_id, transferred_at = now(), last_error = null
   where id = p_transfer_id and status = 'processing'
  returning payout_id into v_payout;
  if v_payout is null then
    return;
  end if;
  if not exists (select 1 from public.payout_transfers where payout_id = v_payout and status <> 'transferred') then
    -- Never overwrite a frozen (disputed) or otherwise non-pending payout.
    update public.payouts
       set status = 'transferred', transferred_at = now()
     where id = v_payout and status = 'pending'
    returning booking_id, coalesce(provider_id, payee_id), amount, sports_booking_id
         into v_booking, v_recipient, v_amount, v_sports_booking;
    if v_booking is not null and exists (select 1 from public.bookings where id = v_booking and status = 'completed') then
      perform public._set_status(v_booking, 'closed', null, 'payout transferred');
    end if;
    if v_recipient is not null then
      begin
        perform public._queue_notification(
          v_recipient, 'payout_sent', v_booking, 'Payout sent',
          '₹' || to_char(v_amount::numeric / 100, 'FM9999999990.00') || ' was sent to your bank.',
          jsonb_build_object(
            'url', '/earnings',
            'booking_id', v_booking,
            'sports_booking_id', v_sports_booking,
            'payout_id', v_payout,
            'transfer_id', p_transfer_id,
            'amount_paise', v_amount
          ),
          'payout-sent:' || v_payout::text
        );
      exception when others then
        raise warning 'payout notification skipped: %', sqlerrm;
      end;
    end if;
  end if;
end;
$$;

create or replace function public.fail_transfer(p_transfer_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout uuid;
  v_status text;
  v_booking uuid;
  v_recipient uuid;
  v_amount int;
  v_sports_booking uuid;
begin
  update public.payout_transfers
     set attempts = attempts + 1,
         last_error = left(p_error, 2000),
         status = case when attempts + 1 >= 5 then 'failed'::public.transfer_status else 'pending'::public.transfer_status end,
         next_attempt_at = case when attempts + 1 >= 5 then null
                                else now() + interval '5 minutes' * power(2, attempts) end
   where id = p_transfer_id and status = 'processing'
  returning payout_id, status::text into v_payout, v_status;
  if v_status = 'failed' then
    update public.payouts
       set status = 'failed'
     where id = v_payout and status = 'pending'
    returning booking_id, coalesce(provider_id, payee_id), amount, sports_booking_id
         into v_booking, v_recipient, v_amount, v_sports_booking;
    if v_recipient is not null then
      begin
        perform public._queue_notification(
          v_recipient, 'payout_problem', v_booking, 'Payout problem',
          'We could not send your payout. Our team is checking it.',
          jsonb_build_object(
            'url', '/earnings',
            'booking_id', v_booking,
            'sports_booking_id', v_sports_booking,
            'payout_id', v_payout,
            'transfer_id', p_transfer_id,
            'amount_paise', v_amount
          ),
          'payout-problem:' || v_payout::text
        );
      exception when others then
        raise warning 'payout failure notification skipped: %', sqlerrm;
      end;
    end if;
  end if;
end;
$$;

create or replace function public.record_payout_gateway_event(
  p_external_id text, p_status text, p_utr text default null, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.payout_transfers;
  v_booking uuid;
  v_recipient uuid;
  v_amount int;
  v_sports_booking uuid;
begin
  select * into t from public.payout_transfers where razorpay_transfer_id = p_external_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_payout');
  end if;
  if p_status = 'processed' then
    update public.payout_transfers set gateway_status = 'processed', utr = coalesce(p_utr, utr), processed_at = coalesce(processed_at, now())
     where id = t.id;
  elsif p_status in ('failed', 'reversed', 'rejected', 'cancelled') then
    if t.gateway_status in ('failed', 'reversed', 'rejected', 'cancelled') then
      return jsonb_build_object('ok', true, 'duplicate', true);
    end if;
    update public.payout_transfers
       set gateway_status = p_status, status = 'failed', last_error = left(coalesce(p_reason, 'payout ' || p_status), 2000),
           next_attempt_at = null
     where id = t.id;
    update public.payouts
       set status = 'failed'
     where id = t.payout_id and status in ('pending', 'transferred')
    returning booking_id, coalesce(provider_id, payee_id), amount, sports_booking_id
         into v_booking, v_recipient, v_amount, v_sports_booking;
    if v_recipient is not null then
      begin
        perform public._queue_notification(
          v_recipient, 'payout_problem', v_booking, 'Payout problem',
          'We could not send your payout. Our team is checking it.',
          jsonb_build_object(
            'url', '/earnings',
            'booking_id', v_booking,
            'sports_booking_id', v_sports_booking,
            'payout_id', t.payout_id,
            'transfer_id', t.id,
            'amount_paise', v_amount
          ),
          'payout-problem:' || t.payout_id::text
        );
      exception when others then
        raise warning 'payout gateway notification skipped: %', sqlerrm;
      end;
    end if;
  else
    update public.payout_transfers set gateway_status = p_status where id = t.id;
  end if;
  return jsonb_build_object('ok', true, 'transfer_id', t.id, 'status', p_status);
end;
$$;

create or replace function public.admin_review_document(
  p_document_id uuid,
  p_approve boolean,
  p_reason text default null,
  p_expires_on date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._require_uid();
  d public.provider_documents;
  v_has_expiry boolean;
  v_label text;
  v_body text;
begin
  perform public._assert(public._is_admin(), 'admin only');
  select * into d from public.provider_documents where id = p_document_id for update;
  perform public._assert(found, 'document not found');
  perform public._assert(d.status = 'pending', 'document is not pending review');
  select has_expiry, label into v_has_expiry, v_label
    from public.document_types where code = d.doc_type;
  if p_approve then
    perform public._assert(not v_has_expiry or coalesce(p_expires_on, d.expires_on) is not null, 'expiry date is required for this document');
    perform public._assert(coalesce(p_expires_on, d.expires_on) is null or coalesce(p_expires_on, d.expires_on) > current_date, 'document has expired');
  else
    perform public._assert(char_length(trim(coalesce(p_reason, ''))) >= 5, 'give the provider a reason');
  end if;
  update public.provider_documents
     set status = case when p_approve then 'approved' else 'rejected' end,
         reject_reason = case when p_approve then null else left(trim(p_reason), 300) end,
         expires_on = coalesce(p_expires_on, expires_on),
         reviewed_by = v_admin, reviewed_at = now()
   where id = p_document_id;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_admin, case when p_approve then 'approve_document' else 'reject_document' end, d.provider_id,
          jsonb_build_object('document_id', d.id, 'doc_type', d.doc_type, 'reason', p_reason, 'expires_on', coalesce(p_expires_on, d.expires_on)));
  perform public._log_onboarding_event(d.provider_id, 'document_reviewed',
                                       jsonb_build_object('doc_type', d.doc_type, 'approved', p_approve, 'reason', p_reason));
  v_body := case when p_approve
    then coalesce(v_label, 'Your document') || ' was approved.'
    else 'Please update your ' || lower(coalesce(v_label, 'provider document')) || ': '
      || public._mask_preview(p_reason, 200)
  end;
  begin
    perform public._queue_notification(
      d.provider_id, 'verification_update', null,
      case when p_approve then 'Document approved' else 'Document update needed' end,
      v_body,
      jsonb_build_object(
        'url', '/provider/dashboard',
        'document_id', d.id,
        'document_type', d.doc_type,
        'status', case when p_approve then 'approved' else 'rejected' end,
        'reason', p_reason
      ),
      'verification-document:' || d.id::text
    );
  exception when others then
    raise warning 'document notification skipped: %', sqlerrm;
  end;
end;
$$;

create or replace function public.admin_set_provider_review(
  p_provider_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._require_uid();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_submitted_at timestamptz;
  v_old_status text;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(p_status in ('approved', 'rejected', 'needs_clarification'), 'invalid provider review status');
  perform public._assert(p_status = 'approved' or v_reason is not null, 'reason is required');
  perform public._assert(v_reason is null or char_length(v_reason) <= 500, 'review reason is too long');

  select p.submitted_at, p.admin_review_status
    into v_submitted_at, v_old_status
    from public.providers p
   where p.id = p_provider_id
   for update;
  perform public._assert(found, 'provider not found');
  perform public._assert(v_submitted_at is not null, 'provider has not been submitted');
  if p_status = 'approved' then
    perform public._assert(
      exists (
        select 1 from public.providers p
         where p.id = p_provider_id and p.razorpay_account_id is not null
      )
      or exists (select 1 from public.provider_payout_accounts pa where pa.provider_id = p_provider_id),
      'payout account is required before approval'
    );
  end if;

  update public.providers
     set admin_review_status = p_status,
         review_note = case when p_status in ('rejected', 'needs_clarification') then v_reason else null end
   where id = p_provider_id;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_admin, 'set_provider_review', p_provider_id,
          jsonb_build_object('status', p_status, 'reason', v_reason));
  if v_old_status is distinct from p_status then
    begin
      perform public._queue_notification(
        p_provider_id, 'verification_update', null,
        case p_status
          when 'approved' then 'Profile approved'
          when 'rejected' then 'Profile not approved'
          else 'Profile update needed'
        end,
        case when p_status = 'approved'
          then 'Your provider profile is approved.'
          else 'Please update your provider profile: ' || public._mask_preview(v_reason, 200)
        end,
        jsonb_build_object(
          'url', '/provider/dashboard',
          'provider_id', p_provider_id,
          'review_status', p_status,
          'reason', v_reason
        ),
        'provider-review:' || p_provider_id::text || ':' || p_status
      );
    exception when others then
      raise warning 'provider review notification skipped: %', sqlerrm;
    end;
  end if;
end;
$$;

revoke execute on function public.admin_set_provider_review(uuid, text, text) from public, anon;
grant execute on function public.admin_set_provider_review(uuid, text, text) to authenticated;

create or replace function public.set_provider_suspended(p_provider_id uuid, p_suspended boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_was_suspended boolean;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(coalesce(trim(p_reason), '') <> '', 'reason is required');
  select suspended into v_was_suspended
    from public.providers
   where id = p_provider_id
   for update;
  perform public._assert(found, 'provider not found');
  update public.providers set suspended = p_suspended, is_online = case when p_suspended then false else is_online end
   where id = p_provider_id;
  perform public._assert(found, 'provider not found');
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_provider_suspended', p_provider_id, jsonb_build_object('suspended', p_suspended, 'reason', p_reason));
  if p_suspended and not coalesce(v_was_suspended, false) then
    begin
      perform public._queue_notification(
        p_provider_id, 'account_suspended', null, 'Account suspended',
        'Your provider account is suspended: ' || public._mask_preview(p_reason, 200),
        jsonb_build_object(
          'url', '/provider/dashboard',
          'provider_id', p_provider_id,
          'reason', p_reason
        ),
        'provider-suspended:' || p_provider_id::text
      );
    exception when others then
      raise warning 'suspension notification skipped: %', sqlerrm;
    end;
  end if;
end;
$$;

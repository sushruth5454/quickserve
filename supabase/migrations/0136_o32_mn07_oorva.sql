-- O32-MN07: validate dispute outcomes and partial-refund notes server-side.

create or replace function public.resolve_dispute(
  p_booking_id uuid,
  p_outcome public.dispute_outcome,
  p_refund_amount int default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  po public.payouts;
  v_cash_payment record;
  v_refund int := 0;
  v_refunded int := 0;
  v_cash_net int := 0;
  v_recovery_key text;
  v_note text;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(b.status = 'disputed', 'booking is not disputed');
  perform public._assert(
    p_outcome is not null
      and p_outcome in ('denied', 'partial_refund', 'full_refund'),
    'invalid dispute outcome'
  );
  if p_outcome = 'partial_refund' then
    v_note := regexp_replace(coalesce(p_note, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
    perform public._assert(
      p_note is not null
        and p_note ~ '[^[:space:]]'
        and char_length(v_note) between 1 and 500,
      'partial refund note must be between 1 and 500 characters'
    );
  end if;
  select * into po from public.payouts where booking_id = b.id for update;

  if p_outcome = 'full_refund' then
    perform public._restore_coins_for_terminal_booking(b.id);
    select coalesce(sum(greatest(p.amount - coalesce(refunds.amount, 0), 0)), 0)::int
      into v_refund
      from public.payments p
      left join lateral (
        select coalesce(sum(rf.amount) filter (where rf.status <> 'failed'), 0)::int as amount
          from public.refunds rf
         where rf.payment_id = p.id
      ) refunds on true
     where p.booking_id = b.id
       and p.razorpay_payment_id is not null
       and p.status in ('paid', 'refund_pending', 'refund_processing', 'refunded');
  elsif p_outcome = 'partial_refund' then
    v_refund := p_refund_amount;
    if po.id is null then
      select coalesce(sum(greatest(p.amount - coalesce(refunds.amount, 0), 0)), 0)::int
        into v_cash_net
        from public.payments p
        left join lateral (
          select coalesce(sum(rf.amount) filter (where rf.status <> 'failed'), 0)::int as amount
            from public.refunds rf
           where rf.payment_id = p.id
        ) refunds on true
       where p.booking_id = b.id
         and p.status = 'paid'
         and p.funding_source is distinct from 'coins'
         and p.razorpay_payment_id is not null;
      perform public._assert(v_refund > 0 and v_refund <= v_cash_net, 'invalid refund amount');
    else
      perform public._assert(v_refund > 0 and v_refund <= po.amount, 'invalid refund amount');
    end if;
  else
    v_refund := 0;
  end if;

  if v_refund > 0 then
    if p_outcome = 'full_refund' then
      for v_cash_payment in
        select p.id,
               greatest(p.amount - coalesce(refunds.amount, 0), 0)::int as amount
          from public.payments p
          left join lateral (
            select coalesce(sum(rf.amount) filter (where rf.status <> 'failed'), 0)::int as amount
              from public.refunds rf
             where rf.payment_id = p.id
          ) refunds on true
         where p.booking_id = b.id
           and p.razorpay_payment_id is not null
           and p.status in ('paid', 'refund_pending', 'refund_processing', 'refunded')
         order by p.paid_at nulls first, p.id
      loop
        if v_cash_payment.amount > 0 then
          v_refunded := v_refunded
            + public._queue_refund(v_cash_payment.id, v_cash_payment.amount, 'dispute: full refund');
        end if;
      end loop;
    else
      v_refunded := public._refund_partial(b.id, v_refund, 'dispute: partial refund');
    end if;
    perform public._assert(v_refunded = v_refund, 'refund exceeds refundable payments');
    update public.bookings set refund_amount = refund_amount + v_refunded where id = b.id;
    v_recovery_key := 'dispute:' || b.id::text || ':' || (b.refund_amount + v_refunded)::text;
    perform public._queue_transfer_reversals(b.id, v_refund, 'dispute: ' || p_outcome::text, v_recovery_key);
  end if;

  if p_outcome = 'full_refund' then
    update public.payout_transfers
       set status = 'failed', last_error = 'dispute: full refund'
     where status::text in ('pending', 'failed')
       and payout_id in (select id from public.payouts where booking_id = b.id);
    update public.payouts set amount = 0 where id = po.id;
    update public.payouts
       set status = case
         when exists (select 1 from public.payout_transfer_reversals x
                       join public.payout_transfers t on t.id = x.payout_transfer_id
                      where t.payout_id = po.id and x.status in ('pending', 'processing')) then 'frozen'::public.payout_status
         when exists (select 1 from public.provider_receivables r
                      where r.booking_id = b.id and r.status = 'open') then 'partially_reversed'::public.payout_status
         else 'reversed'::public.payout_status
       end
     where id = po.id;
    perform public._set_status(b.id, 'refunded', v_uid, coalesce(p_note, 'dispute: full refund'));
  elsif po.id is null then
    if b.archetype = 'time_based' then
      perform public._finalize_session_completion(b.id, v_uid);
    else
      perform public._finalize_completion(b.id, v_uid, 'dispute resolved before completion');
    end if;
  else
    update public.payouts
       set amount = greatest(amount - v_refund, 0),
           status = case when exists (
             select 1 from public.payout_transfer_reversals x
              join public.payout_transfers t on t.id = x.payout_transfer_id
              where t.payout_id = po.id and x.status in ('pending', 'processing')
           ) then 'frozen'::public.payout_status else 'pending'::public.payout_status end,
           release_after = greatest(release_after, now())
     where id = po.id;
    delete from public.payout_transfers
     where payout_id = po.id and status::text = 'failed' and attempts = 0 and reversed_amount = 0;
    perform public._allocate_payout(po.id);
    perform public._set_status(b.id, 'completed', v_uid, 'dispute resolved');
  end if;

  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'resolve_dispute', b.id,
          jsonb_build_object('outcome', p_outcome, 'refund_amount', v_refund,
                  'note', case when p_outcome = 'partial_refund' then v_note else p_note end));
end;
$$;

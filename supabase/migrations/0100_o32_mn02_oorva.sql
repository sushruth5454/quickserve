-- O32-MN02: classify time-based session payouts from their selected payment source.
create or replace function public._finalize_session_completion(p_booking_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  ps public.pack_sessions;
  k public.pack_purchases;
  p public.payments;
  v_payout uuid;
  v_bp int;
  v_commission int;
  v_gst int;
  v_net int;
  v_capacity int;
  v_is_demo boolean;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.pack_session_id is not null then
    select * into ps from public.pack_sessions where id = b.pack_session_id for update;
    select * into k from public.pack_purchases where id = b.pack_purchase_id for update;
    perform public._assert(k.payment_id is not null, 'pack payment is missing');
    select * into p from public.payments where id = k.payment_id and status = 'paid' for update;
  else
    select pm.* into p
      from public.payments pm
      join public.payment_schedule o on o.id = pm.schedule_id
     where pm.booking_id = b.id
       and pm.status = 'paid'
       and o.label = 'Session service'
     order by pm.paid_at
     limit 1
     for update of pm;
  end if;
  perform public._assert(p.id is not null, 'session payment is missing');

  v_is_demo := p.razorpay_payment_id is not null
    and left(p.razorpay_payment_id, 9) = 'pay_demo_';
  v_bp := coalesce(b.commission_bp_snapshot, public._time_based_commission_bp(b.id, now()));
  v_commission := round((b.total_amount - coalesce(b.platform_fee, 0))::numeric * v_bp / 10000)::int;
  v_gst := round(v_commission::numeric * 18 / 100)::int;
  v_net := greatest((b.total_amount - b.platform_fee) - v_commission - v_gst, 0);
  v_capacity := p.amount
    - coalesce((select sum(t.amount) from public.payout_transfers t where t.source_payment_id = p.id), 0)
    - coalesce((select sum(r.amount) from public.refunds r where r.payment_id = p.id and r.status <> 'failed'), 0);
  perform public._assert(v_capacity >= v_net, 'pack payment does not cover provider payout');

  insert into public.payouts (
    booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
  )
  values (
    b.id, b.provider_id, b.total_amount - b.platform_fee,
    v_commission, v_gst, v_net,
    case when v_is_demo then 'demo'::public.payout_status else 'pending'::public.payout_status end,
    now() + interval '24 hours'
  )
  on conflict (booking_id) do nothing
  returning id into v_payout;
  if v_payout is not null then
    if not v_is_demo then
      insert into public.payout_transfers (payout_id, source_payment_id, amount)
      values (v_payout, p.id, v_net);
    end if;
    update public.bookings
       set completed_at = now(), commission = v_commission, gst_on_commission = v_gst
     where id = b.id;
    update public.providers
       set jobs_completed = jobs_completed + 1
     where id = b.provider_id;
    update public.pack_sessions
       set status = 'completed', completed_at = now()
     where id = b.pack_session_id;
    perform public._set_status(b.id, 'completed', p_actor, 'session completed');
  end if;
end;
$$;

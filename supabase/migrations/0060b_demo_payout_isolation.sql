-- WP X3; owns: demo_settle_payment, _allocate_payout, _create_payout, _create_sports_payout, claim_due_transfers; sources: WS8-T02, WS6-T04

insert into public.app_config (key, value)
values ('deployment', '{"is_demo_project": false}'::jsonb)
on conflict (key) do nothing;

create or replace function public.demo_settle_payment(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_cfg jsonb;
  b public.bookings;
  d record;
  v_key text;
  v_result jsonb;
begin
  perform public._assert(
    coalesce((
      select (value ->> 'is_demo_project')::boolean
        from public.app_config
       where key = 'deployment'
    ), false),
    'demo payments are disabled'
  );
  select value into v_cfg from public.app_config where key = 'demo_payments';
  perform public._assert(coalesce((v_cfg ->> 'enabled')::boolean, false), 'demo payments are disabled');
  select * into b from public.bookings where id = p_booking_id;
  perform public._assert(found and b.customer_id = v_uid, 'only the customer can pay');
  perform public._assert(
    exists (
      select 1
        from auth.users u
       where u.id = b.provider_id
         and u.raw_app_meta_data ->> 'demo_only' = 'true'
    ),
    'demo payments only work with demo providers'
  );
  if b.archetype = 'time_based' then
    select x.payment_id, x.amount into d from public.prepare_session_payment(b.id, v_uid, null) x;
  else
    select x.payment_id, x.amount into d from public.prepare_payment(b.id, v_uid) x;
  end if;
  v_key := replace(d.payment_id::text, '-', '');
  update public.payments
     set razorpay_link_id = 'plink_demo_' || v_key, short_url = 'demo://payment'
   where id = d.payment_id and status = 'created';
  if b.archetype = 'time_based' then
    v_result := public.record_time_payment_paid('plink_demo_' || v_key, 'pay_demo_' || v_key, d.amount);
  else
    v_result := public.record_payment_paid('plink_demo_' || v_key, 'pay_demo_' || v_key, d.amount);
  end if;
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('amount', d.amount);
end;
$$;
revoke execute on function public.demo_settle_payment(uuid) from public, anon;
grant execute on function public.demo_settle_payment(uuid) to authenticated, service_role;

create or replace function public._allocate_payout(p_payout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  po public.payouts;
  pm record;
  v_remaining int;
  v_avail int;
  v_take int;
begin
  select * into po from public.payouts where id = p_payout_id for update;
  if po.status = 'demo' then
    return;
  end if;
  delete from public.payout_transfers
   where payout_id = po.id and status in ('pending', 'failed') and attempts = 0;
  v_remaining := po.amount - coalesce((select sum(amount) from public.payout_transfers where payout_id = po.id), 0);
  for pm in
    select p.id, p.amount
      from public.payments p
     where p.booking_id = po.booking_id and p.status = 'paid'
       and p.razorpay_payment_id is not null
       and left(p.razorpay_payment_id, 9) <> 'pay_demo_'
     order by (p.purpose <> 'visit_fee'), p.paid_at, p.id
  loop
    exit when v_remaining <= 0;
    v_avail := pm.amount
      - coalesce((select sum(t.amount) from public.payout_transfers t where t.source_payment_id = pm.id), 0)
      - coalesce((select sum(r.amount) from public.refunds r where r.payment_id = pm.id and r.status <> 'failed'), 0);
    v_take := least(v_avail, v_remaining);
    if v_take > 0 then
      insert into public.payout_transfers (payout_id, source_payment_id, amount) values (po.id, pm.id, v_take);
      v_remaining := v_remaining - v_take;
    end if;
  end loop;
  perform public._assert(v_remaining <= 0, 'paid amount does not cover provider payout');
end;
$$;

create or replace function public._create_payout(
  p_booking_id uuid,
  p_gross int,
  p_commissionable int,
  p_release_after timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_bp int;
  v_commission int;
  v_gst int;
  v_payout uuid;
  v_is_demo boolean;
begin
  select * into b from public.bookings where id = p_booking_id;
  perform public._assert(found, 'booking not found');
  v_is_demo := exists (
    select 1
      from public.payments p
     where p.booking_id = b.id
       and p.status = 'paid'
       and p.razorpay_payment_id is not null
       and left(p.razorpay_payment_id, 9) = 'pay_demo_'
  );

  v_bp := case
    when b.booking_origin = 'byo' then 0
    else public._commission_bp(b.provider_id, b.customer_id, b.id, now())
  end;
  v_commission := round(p_commissionable::numeric * v_bp / 10000);
  v_gst := round(v_commission::numeric * 18 / 100);

  insert into public.payouts (
    booking_id, provider_id, gross, commission, gst_on_commission, amount, status, release_after
  )
  values (
    b.id, b.provider_id, p_gross, v_commission, v_gst,
    greatest(p_gross - v_commission - v_gst, 0),
    case when v_is_demo then 'demo'::public.payout_status else 'pending'::public.payout_status end,
    p_release_after
  )
  on conflict (booking_id) do nothing
  returning id into v_payout;

  if v_payout is not null then
    update public.bookings set commission = v_commission, gst_on_commission = v_gst where id = b.id;
    if v_is_demo then
      return;
    end if;
    perform public._allocate_payout(v_payout);
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
  if not found or v_booking.status <> 'completed'
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

create or replace function public.claim_due_transfers(p_limit int default 20)
returns table (
  transfer_id uuid, payout_id uuid, booking_id uuid, provider_id uuid, amount int, gross_amount int, rail text,
  razorpay_payment_id text, account_id text, fund_account_id text, attempts int, idempotency_key text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  c record;
  v_net int;
  v_ids uuid[];
begin
  with claimed as (
    update public.payout_transfers pt
       set status = 'processing'
     where pt.id in (
       select t.id
         from public.payout_transfers t
         join public.payouts po on po.id = t.payout_id
         join public.payments source_payment on source_payment.id = t.source_payment_id
         left join public.bookings b on b.id = po.booking_id
         left join public.providers pr on pr.id = po.provider_id
         left join public.provider_payout_accounts pa
           on pa.provider_id = coalesce(po.provider_id, po.payee_id)
        where t.status = 'pending'
          and (t.next_attempt_at is null or t.next_attempt_at <= now())
          and t.release_after <= now()
          and po.status = 'pending'
          and po.release_after <= now()
          and source_payment.razorpay_payment_id is not null
          and left(source_payment.razorpay_payment_id, 9) <> 'pay_demo_'
          and (po.booking_id is null or b.status <> 'disputed')
          and (
            (coalesce(t.rail, 'route') = 'route'
              and coalesce(pr.razorpay_account_id, pa.razorpay_account_id) is not null
              and (po.provider_id is not null or pa.activation_status = 'activated'))
            or
            (t.rail = 'payouts' and pa.fund_account_id is not null
              and ((po.provider_id is not null and pr.kyc_status = 'verified')
                or (po.payee_id is not null and pa.activation_status = 'activated')))
          )
        order by t.release_after, po.release_after
        limit greatest(p_limit, 0)
        for update of t, po skip locked
     )
    returning pt.id
  )
  select array_agg(claimed.id) into v_ids from claimed;

  for c in
    select cl.id, cl.payout_id, po.booking_id, po.sports_booking_id,
           coalesce(po.provider_id, po.payee_id) payee_id, cl.amount,
           coalesce(cl.rail, 'route') rail, pm.razorpay_payment_id,
           coalesce(pr.razorpay_account_id, pa.razorpay_account_id) account_id,
           pa.fund_account_id, cl.attempts, cl.idempotency_seq
      from public.payout_transfers cl
      join public.payouts po on po.id = cl.payout_id
      left join public.providers pr on pr.id = po.provider_id
      left join public.provider_payout_accounts pa
        on pa.provider_id = coalesce(po.provider_id, po.payee_id)
      join public.payments pm on pm.id = cl.source_payment_id
     where cl.id = any (coalesce(v_ids, '{}'))
  loop
    v_net := c.amount - public._net_receivables(c.id);
    if v_net <= 0 then
      perform public.complete_transfer(c.id, 'netted_' || c.id::text);
      continue;
    end if;
    transfer_id := c.id;
    payout_id := c.payout_id;
    booking_id := coalesce(c.booking_id, c.sports_booking_id);
    provider_id := c.payee_id;
    amount := v_net;
    gross_amount := c.amount;
    rail := c.rail;
    razorpay_payment_id := c.razorpay_payment_id;
    account_id := c.account_id;
    fund_account_id := c.fund_account_id;
    attempts := c.attempts;
    idempotency_key := c.id::text || ':' || c.idempotency_seq::text;
    return next;
  end loop;
end;
$$;

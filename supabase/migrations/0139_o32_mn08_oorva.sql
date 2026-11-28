drop function if exists public.admin_list_bookings(text, text);

create function public.admin_list_bookings(p_status text default null, p_search text default null)
returns table (
  id uuid, created_at timestamptz, status text, archetype text, category text, customer text, customer_phone text,
  provider text, total_amount int, paid_paise int, scheduled_at timestamptz, city text,
  cash_captured_paise int, coins_applied_paise int, demo_captured_paise int,
  refund_pending_paise int, refund_processing_paise int, refund_completed_paise int, refund_failed_paise int,
  net_held_paise int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
  perform public._assert(public._is_admin(), 'admin only');
  return query
  select b.id, b.created_at, b.status::text, b.archetype, c.name, cp.full_name, cu.phone::text, pp.full_name,
         coalesce(b.total_amount, b.visit_fee),
         (select coalesce(sum(pm.amount), 0)::int from public.payments pm where pm.booking_id = b.id and pm.status = 'paid'),
         b.scheduled_at, a.city,
         coalesce(money.cash_captured_paise, 0)::int,
         coalesce(money.coins_applied_paise, 0)::int,
         coalesce(money.demo_captured_paise, 0)::int,
         coalesce(money.refund_pending_paise, 0)::int,
         coalesce(money.refund_processing_paise, 0)::int,
         coalesce(money.refund_completed_paise, 0)::int,
         coalesce(money.refund_failed_paise, 0)::int,
         coalesce(public._net_paid(b.id), 0)::int
    from public.bookings b
    join public.categories c on c.id = b.category_id
    left join public.profiles cp on cp.id = b.customer_id
    left join auth.users cu on cu.id = b.customer_id
    left join public.profiles pp on pp.id = b.provider_id
    left join public.addresses a on a.id = b.address_id
    left join lateral (
      select
        coalesce(sum(pm.amount) filter (
          where pm.funding_source = 'customer'
            and nullif(btrim(pm.razorpay_payment_id), '') is not null
            and left(btrim(pm.razorpay_payment_id), 9) <> 'pay_demo_'
            and pm.status in ('paid', 'refund_pending', 'refund_processing', 'refunded')
        ), 0)::int as cash_captured_paise,
        coalesce(sum(pm.amount) filter (
          where pm.funding_source = 'coins'
            and pm.status in ('paid', 'refund_pending', 'refund_processing', 'refunded')
        ), 0)::int as coins_applied_paise,
        coalesce(sum(pm.amount) filter (
          where pm.funding_source = 'customer'
            and left(btrim(pm.razorpay_payment_id), 9) = 'pay_demo_'
            and pm.status in ('paid', 'refund_pending', 'refund_processing', 'refunded')
        ), 0)::int as demo_captured_paise,
        coalesce(sum(refunds.pending_paise), 0)::int as refund_pending_paise,
        coalesce(sum(refunds.processing_paise), 0)::int as refund_processing_paise,
        coalesce(sum(refunds.completed_paise), 0)::int as refund_completed_paise,
        coalesce(sum(refunds.failed_paise), 0)::int as refund_failed_paise
      from public.payments pm
      left join lateral (
        select
          coalesce(sum(r.amount) filter (where r.status = 'pending'), 0)::int as pending_paise,
          coalesce(sum(r.amount) filter (where r.status = 'processing'), 0)::int as processing_paise,
          coalesce(sum(r.amount) filter (where r.status = 'refunded'), 0)::int as completed_paise,
          coalesce(sum(r.amount) filter (where r.status = 'failed'), 0)::int as failed_paise
        from public.refunds r
        where r.payment_id = pm.id
      ) refunds on true
      where pm.booking_id = b.id
    ) money on true
   where (p_status is null or p_status = 'all'
          or (p_status = 'active' and b.status::text not in ('completed', 'closed', 'closed_no_work', 'declined', 'expired', 'cancelled', 'refunded'))
          or b.status::text = p_status)
     and (v_q is null or b.id::text like v_q || '%' or replace(b.id::text, '-', '') like replace(replace(v_q, 'qs-', ''), '-', '') || '%'
          or lower(coalesce(cp.full_name, '')) like '%' || v_q || '%' or lower(coalesce(pp.full_name, '')) like '%' || v_q || '%'
          or lower(c.name) like '%' || v_q || '%')
   order by b.created_at desc
   limit 200;
end;
$$;

create or replace function public.admin_list_stuck_money()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_refunds jsonb;
  v_transfers jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'refund_id', r.id, 'payment_id', p.id, 'booking_id', p.booking_id,
             'sports_booking_id', p.sports_booking_id, 'pack_purchase_id', p.pack_purchase_id,
             'amount', r.amount, 'status', r.status, 'attempts', r.attempts,
             'last_error', r.last_error, 'created_at', r.created_at,
             'processing_started_at', r.processing_started_at
           ) order by r.created_at desc
         ), '[]'::jsonb)
    into v_refunds
    from public.refunds r
    join public.payments p on p.id = r.payment_id
   where r.status = 'failed'
      or (r.status = 'processing'
          and r.processing_started_at <= now() - interval '30 minutes');

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'transfer_id', t.id, 'payout_id', t.payout_id, 'booking_id', po.booking_id,
             'sports_booking_id', po.sports_booking_id, 'pack_purchase_id', source_payment.pack_purchase_id,
             'amount', t.amount, 'status', t.status, 'attempts', t.attempts,
             'last_error', t.last_error, 'created_at', t.created_at,
             'processing_started_at', t.processing_started_at, 'rail', t.rail,
             'gateway_status', t.gateway_status
           ) order by t.created_at desc
         ), '[]'::jsonb)
    into v_transfers
    from public.payout_transfers t
    join public.payouts po on po.id = t.payout_id
    left join public.payments source_payment on source_payment.id = t.source_payment_id
   where t.status in ('failed', 'processing');
  return jsonb_build_object('refunds', v_refunds, 'transfers', v_transfers);
end;
$$;

create or replace function public.admin_list_problem_payouts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_payouts jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', po.id,
      'booking_id', po.booking_id,
      'sports_booking_id', po.sports_booking_id,
      'provider_id', po.provider_id,
      'payee_id', po.payee_id,
      'provider_name', coalesce(provider.full_name, payee.full_name),
      'gross', po.gross,
      'commission', po.commission,
      'amount', po.amount,
      'status', po.status,
      'release_after', po.release_after,
      'transferred_at', po.transferred_at,
      'transfers', coalesce(tx.transfers, '[]'::jsonb)
    ) order by po.created_at desc, po.id
  ), '[]'::jsonb)
    into v_payouts
    from public.payouts po
    left join public.profiles provider on provider.id = po.provider_id
    left join public.profiles payee on payee.id = po.payee_id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'booking_id', po.booking_id,
          'sports_booking_id', po.sports_booking_id,
          'pack_purchase_id', source_payment.pack_purchase_id,
          'status', t.status,
          'last_error', t.last_error,
          'attempts', t.attempts,
          'amount', t.amount,
          'rail', t.rail,
          'gateway_status', t.gateway_status,
          'processing_started_at', t.processing_started_at,
          'created_at', t.created_at
        ) order by t.created_at, t.id
      ) as transfers
        from public.payout_transfers t
        left join public.payments source_payment on source_payment.id = t.source_payment_id
       where t.payout_id = po.id
    ) tx on true
   where po.status = 'failed'
      or exists (
        select 1
          from public.payout_transfers t
         where t.payout_id = po.id
           and (
             t.last_error is not null
             or (t.status = 'processing'
                 and t.processing_started_at <= now() - interval '30 minutes')
           )
      );
  return jsonb_build_object('payouts', v_payouts);
end;
$$;

revoke all on function public.admin_list_bookings(text, text),
  public.admin_list_stuck_money(), public.admin_list_problem_payouts()
from public, anon;
grant execute on function public.admin_list_bookings(text, text),
  public.admin_list_stuck_money(), public.admin_list_problem_payouts()
to authenticated;

begin;

drop function public.get_receipt(uuid);

create function public.get_receipt(p_payment_id uuid)
returns table (
  id uuid,
  receipt_no text,
  payment_id uuid,
  booking_id uuid,
  issued_at timestamptz,
  snapshot jsonb,
  current_payment_status public.payment_status,
  current_refunds jsonb,
  current_payment_is_demo boolean,
  read_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id,
         r.receipt_no,
         r.payment_id,
         r.booking_id,
         r.issued_at,
         r.snapshot,
         p.status,
         coalesce((
           select jsonb_agg(
                    jsonb_build_object(
                      'id', refund.id,
                      'payment_id', refund.payment_id,
                      'amount', refund.amount,
                      'status', refund.status,
                      'created_at', refund.created_at,
                      'processed_at', refund.processed_at
                    )
                    order by refund.created_at, refund.id
                  )
             from public.refunds as refund
            where refund.payment_id = p.id
         ), '[]'::jsonb),
         left(coalesce(p.razorpay_payment_id, ''), 9) = 'pay_demo_',
         statement_timestamp()
    from public.payment_receipts as r
    join public.payments as p on p.id = r.payment_id
    join public.bookings as b on b.id = r.booking_id
   where r.payment_id = $1
     and public._feature_enabled('payment_receipts')
     and (
       b.customer_id = auth.uid()
       or b.provider_id = auth.uid()
       or public._is_admin()
     )
   limit 1;
$$;

revoke all on function public.get_receipt(uuid) from public, anon, authenticated;
grant execute on function public.get_receipt(uuid) to authenticated;

commit;

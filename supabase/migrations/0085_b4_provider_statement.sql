insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values (
  'provider_earnings_statement',
  false,
  'Provider earnings statements',
  'Monthly provider and venue payout statements. Off: statement access and venue-owner payout rows are hidden; existing provider earnings remain available.',
  'Payments',
  70
)
on conflict (key) do nothing;

drop policy if exists payouts_provider on public.payouts;
create policy payouts_owner_read on public.payouts
  for select to authenticated
  using (
    provider_id = auth.uid()
    or (
      payee_id = auth.uid()
      and coalesce((public.get_app_features() ->> 'provider_earnings_statement')::boolean, false)
    )
  );

create or replace function public.get_provider_statement(p_from date, p_to date)
returns table (
  payout_id uuid,
  booking_id uuid,
  sports_booking_id uuid,
  booking_ref text,
  date date,
  gross int,
  commission int,
  gst_on_commission int,
  reversed_amount int,
  net int,
  status public.payout_status,
  release_after timestamptz,
  transferred_at timestamptz,
  razorpay_transfer_id text,
  utr text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  perform public._assert(v_uid is not null, 'sign in required');
  perform public._assert(p_from is not null and p_to is not null and p_from <= p_to, 'invalid statement period');
  perform public._assert(
    public._feature_enabled('provider_earnings_statement'),
    'provider earnings statement is disabled'
  );

  return query
    select po.id,
           po.booking_id,
           po.sports_booking_id,
           'QS-' || upper(substr(replace(coalesce(po.booking_id, po.sports_booking_id)::text, '-', ''), 1, 8)),
           (po.created_at at time zone 'UTC')::date,
           po.gross,
           po.commission,
           po.gst_on_commission,
           transfers.reversed_amount,
           po.amount,
           po.status,
           po.release_after,
           po.transferred_at,
           transfers.razorpay_transfer_id,
           transfers.utr
      from public.payouts po
      left join lateral (
        select coalesce(sum(pt.reversed_amount), 0)::int as reversed_amount,
               string_agg(distinct pt.razorpay_transfer_id, ', ' order by pt.razorpay_transfer_id)
                 filter (where pt.razorpay_transfer_id is not null) as razorpay_transfer_id,
               string_agg(distinct pt.utr, ', ' order by pt.utr)
                 filter (where pt.utr is not null) as utr
          from public.payout_transfers pt
         where pt.payout_id = po.id
      ) transfers on true
     where (po.provider_id = v_uid or po.payee_id = v_uid)
       and po.created_at >= (p_from::timestamp at time zone 'UTC')
       and po.created_at < ((p_to + 1)::timestamp at time zone 'UTC')
     order by po.created_at desc, po.id desc;
end;
$$;

revoke all on function public.get_provider_statement(date, date) from public, anon, service_role;
grant execute on function public.get_provider_statement(date, date) to authenticated;

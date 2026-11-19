-- WP U2; owns: preview_cancellation; sources: WS1-T03, WS2-T03

create or replace function public.preview_cancellation(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings;
  v_outcome jsonb;
  v_paid int := 0;
  v_prior_refunds int := 0;
  v_refundable int := 0;
  v_refund int := 0;
  v_charged int := 0;
  v_hours_before numeric;
begin
  select * into b
    from public.bookings
   where id = p_booking_id;
  perform public._assert(found, 'booking not found');
  perform public._assert(b.customer_id = v_uid, 'only the booking customer can preview cancellation');
  perform public._assert(
    case
      when b.archetype = 'time_based' then b.status::text in ('pending_payment', 'requested', 'accepted')
      else b.status::text in (
        'pending_payment', 'requested', 'accepted', 'confirmed', 'en_route',
        'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress', 'completion_requested'
      )
    end,
    'booking can no longer be cancelled'
  );

  if b.archetype = 'time_based' then
    select coalesce(sum(p.amount) filter (where p.status = 'paid'), 0)::int
      into v_paid
      from public.payments p
     where p.booking_id = b.id;

    select coalesce(sum(r.amount) filter (where r.status <> 'failed'), 0)::int
      into v_prior_refunds
      from public.refunds r
      join public.payments p on p.id = r.payment_id
     where p.booking_id = b.id
       and p.status = 'paid';

    v_hours_before := extract(epoch from (b.scheduled_at - now())) / 3600.0;
    if v_paid > 0 and (v_hours_before is null or v_hours_before >= 12) then
      select coalesce(sum(
        greatest(p.amount - coalesce(refunds.amount, 0), 0)
      ), 0)::int
        into v_refundable
        from public.payments p
        left join lateral (
          select coalesce(sum(r.amount) filter (where r.status <> 'failed'), 0)::int as amount
            from public.refunds r
           where r.payment_id = p.id
        ) refunds on true
       where p.booking_id = b.id
         and p.status = 'paid'
         and p.razorpay_payment_id is not null;
      v_refund := v_refundable;
    end if;

    v_charged := greatest(v_paid - v_prior_refunds - v_refund, 0);
    return jsonb_build_object(
      'refund_amount', v_refund,
      'charged_amount', v_charged
    );
  end if;

  v_outcome := public._cancellation_outcome(b.id, 'customer', 'customer_choice', now());
  select coalesce(sum(p.amount) filter (where p.status = 'paid'), 0)::int
    into v_paid
    from public.payments p
   where p.booking_id = b.id;
  v_prior_refunds := coalesce((v_outcome ->> 'prior_refunds')::int, 0);
  v_refund := coalesce((v_outcome ->> 'refund_amount')::int, 0);
  v_charged := greatest(v_paid - v_prior_refunds - v_refund, 0);

  return v_outcome || jsonb_build_object('charged_amount', v_charged);
end;
$$;

revoke all on function public.preview_cancellation(uuid) from public, anon, authenticated;
grant execute on function public.preview_cancellation(uuid) to authenticated;

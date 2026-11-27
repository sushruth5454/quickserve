create or replace function public.cancel_service_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_request public.service_requests;
begin
  select * into v_request
    from public.service_requests r
   where r.id = p_request_id
   for update;
  perform public._assert(found and v_request.customer_id = v_uid, 'only the customer can cancel this request');
  perform public._assert(v_request.status in ('open', 'closed'), 'request cannot be cancelled');
  perform public._assert(not exists (
    select 1
      from public.bookings b
     where b.service_request_id = v_request.id
       and b.status in ('pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
                        'delivery_pending', 'completion_requested', 'disputed')
  ), 'request has an active booking; manage the booking instead');

  update public.service_requests
     set status = 'cancelled', updated_at = now()
   where id = v_request.id;
  update public.proposals
     set status = 'rejected', updated_at = now()
   where request_id = v_request.id
     and status = 'sent';
end;
$$;

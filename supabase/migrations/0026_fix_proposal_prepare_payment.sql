-- prepare_payment's proposal branch referenced payment_schedule.purpose unqualified, which is ambiguous with
-- the function's own `purpose` output column, so paying any proposal advance failed. Same body, qualified.

create or replace function public.prepare_payment(p_booking_id uuid, p_user_id uuid)
returns table (payment_id uuid, amount int, purpose public.payment_purpose, short_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  v_purpose public.payment_purpose;
  v_amount int;
  v_quote uuid;
  p public.payments;
  v_schedule uuid;
  v_prepared record;
begin
  perform public._assert(b.customer_id = p_user_id, 'only the customer can pay');
  if b.archetype = 'proposal' then
    select ps.id into v_schedule from public.payment_schedule ps
     where ps.booking_id = b.id and ps.status = 'due'
     order by case when ps.purpose = 'advance' then 0 when ps.purpose = 'platform_fee' then 1 else 2 end, ps.seq
     limit 1;
    perform public._assert(v_schedule is not null, 'nothing to pay');
    select * into v_prepared from public.prepare_schedule_payment(b.id, p_user_id, v_schedule);
    return query select v_prepared.payment_id, v_prepared.amount, v_prepared.purpose, v_prepared.short_url;
    return;
  end if;

  if b.booking_origin = 'byo' and b.status = 'pending_payment' then
    select * into q from public.quotes where id = b.approved_quote_id;
    perform public._assert(q.id is not null and q.status = 'approved', 'BYO agreement is missing');
    v_purpose := 'fixed';
    v_quote := q.id;
    v_amount := b.total_amount - public._net_paid(b.id);
  elsif b.status = 'pending_payment' then
    v_purpose := 'visit_fee';
    v_amount := b.visit_fee;
  elsif b.status in ('awaiting_payment', 'in_progress') then
    select * into q from public.quotes x
     where x.booking_id = b.id and x.status = 'approved_pending_payment'
     order by x.version desc limit 1;
    perform public._assert(q.id is not null, 'nothing to pay');
    v_purpose := 'balance';
    v_quote := q.id;
    v_amount := public._required_total(q.total, b.visit_fee, b.platform_fee) - public._net_paid(b.id);
  else
    raise exception 'nothing to pay in this state' using errcode = 'P0001';
  end if;
  perform public._assert(v_amount > 0, 'nothing to pay');

  select * into p from public.payments x
   where x.booking_id = b.id and x.status = 'created' and x.purpose = v_purpose
     and x.amount = v_amount and x.quote_id is not distinct from v_quote and x.short_url is not null
   order by x.created_at desc limit 1;
  if found then
    return query select p.id, p.amount, p.purpose, p.short_url;
    return;
  end if;
  update public.payments x set status = 'failed', cancel_link_pending = true
   where x.booking_id = b.id and x.status = 'created';
  insert into public.payments (booking_id, quote_id, purpose, amount)
  values (b.id, v_quote, v_purpose, v_amount)
  returning * into p;
  return query select p.id, p.amount, p.purpose, null::text;
end;
$$;

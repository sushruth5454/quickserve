-- Creator/event (proposal) bookings start from 'confirmed' (start_proposal_booking), but the customer's
-- start code was only exposed for 'accepted'/'en_route', so the customer had no code to share.

create or replace function public.get_booking_otps(p_booking_id uuid)
returns table (start_otp text, start_locked boolean, end_otp text, end_locked boolean)
language sql
stable
security definer
set search_path = public
as $$
  select case when b.status in ('accepted', 'en_route')
                or (b.archetype = 'proposal' and b.status = 'confirmed') then s.start_otp end,
         s.start_attempts >= 5,
         case when b.status = 'completion_requested' then s.end_otp end,
         s.end_attempts >= 5
    from public.bookings b
    join public.booking_secrets s on s.booking_id = b.id
   where b.id = p_booking_id and b.customer_id = auth.uid();
$$;

create or replace function public.regenerate_otp(p_booking_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can regenerate codes');
  if p_kind = 'start' then
    perform public._assert(
      b.status in ('accepted', 'en_route') or (b.archetype = 'proposal' and b.status = 'confirmed'),
      'start code not applicable now'
    );
    update public.booking_secrets set start_otp = public._gen_otp(), start_attempts = 0 where booking_id = b.id;
  elsif p_kind = 'end' then
    perform public._assert(b.status = 'completion_requested', 'end code not applicable now');
    update public.booking_secrets set end_otp = public._gen_otp(), end_attempts = 0 where booking_id = b.id;
  else
    raise exception 'unknown otp kind' using errcode = '22023';
  end if;
  perform public._log_event(b.id, v_uid, p_kind || ' code regenerated');
end;
$$;

drop function if exists public.get_my_business_provider_jobs(uuid);

create function public.get_my_business_provider_jobs(p_provider_id uuid)
returns table (
  booking_id uuid,
  status public.booking_status,
  category_name text,
  customer_name text,
  description text,
  scheduled_at timestamptz,
  created_at timestamptz,
  visit_fee int,
  area text,
  distance_km double precision,
  address_line text,
  lat double precision,
  lng double precision,
  archetype text,
  booking_origin text,
  recurring_schedule_id uuid,
  request_expires_at timestamptz,
  can_accept boolean,
  can_decline boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.status, c.name, pf.full_name, b.description, b.scheduled_at, b.created_at, b.visit_fee,
         a.city,
         case when pr.base_location is not null and a.location is not null
              then round((extensions.st_distance(pr.base_location, a.location) / 1000.0)::numeric, 1)::double precision end,
         case when b.accepted_at is not null then a.line1 end,
         case when b.accepted_at is not null then a.lat end,
         case when b.accepted_at is not null then a.lng end,
         b.archetype::text,
         b.booking_origin::text,
         b.recurring_schedule_id,
         case
           when b.status = 'requested' and b.recurring_schedule_id is null
             then b.updated_at + interval '15 minutes'
           else null
         end,
         coalesce(
           b.status = 'requested'
           and b.provider_id = auth.uid()
           and not pr.suspended
           and (
             b.recurring_schedule_id is not null
             or b.updated_at + interval '15 minutes' > statement_timestamp()
           ),
           false
         ),
         coalesce(b.status = 'requested' and b.provider_id = auth.uid(), false)
    from public.bookings b
    join public.categories c on c.id = b.category_id
    join public.profiles pf on pf.id = b.customer_id
    join public.addresses a on a.id = b.address_id
    join public.providers pr on pr.id = b.provider_id
   where b.provider_id = p_provider_id
     and public._acts_for(p_provider_id, 'staff')
     and b.status <> 'pending_payment'
   order by b.created_at desc
   limit 200;
$$;

revoke execute on function public.get_my_business_provider_jobs(uuid) from public, anon;
grant execute on function public.get_my_business_provider_jobs(uuid) to authenticated;

create or replace function public.accept_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can accept');
  perform public._assert(b.status = 'requested', 'booking is not awaiting acceptance');
  perform public._assert(not exists (select 1 from public.providers where id = v_uid and suspended), 'account suspended');
  if b.recurring_schedule_id is null then
    perform public._assert(
      b.updated_at + interval '15 minutes' > clock_timestamp(),
      'booking request has expired'
    );
  end if;
  update public.bookings set accepted_at = now() where id = b.id;
  perform public._set_status(b.id, 'accepted', v_uid);
end;
$$;

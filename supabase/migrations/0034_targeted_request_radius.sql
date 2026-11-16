-- 0034: targeted proposal requests are routed by the pro's service radius rather than an exact city-name match.
-- Ravi's saved address is labelled "Vijayawada Demo" (the test city) while Sushruth's city is "Vijayawada"; they
-- are 1.4 km apart, yet the request failed with "this provider is not available in your city or on that date".
CREATE OR REPLACE FUNCTION public.route_service_request(p_request_id uuid, p_limit integer DEFAULT 8)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request public.service_requests;
  v_private public.request_private;
  v_limit int := least(greatest(coalesce(p_limit, 8), 1), 8);
  v_origin extensions.geography;
  v_inserted int := 0;
begin
  select * into v_request from public.service_requests where id = p_request_id for update;
  perform public._assert(found, 'request not found');
  perform public._assert(v_request.status = 'open', 'request is not open');
  select * into v_private from public.request_private where request_id = p_request_id;
  if v_private.lat is not null and v_private.lng is not null then
    v_origin := extensions.st_setsrid(extensions.st_makepoint(v_private.lng, v_private.lat), 4326)::extensions.geography;
  end if;

  with candidates as (
    select ps.provider_id, ps.id as provider_service_id,
           case when v_origin is not null and pr.base_location is not null
                then extensions.st_distance(pr.base_location, v_origin) / 1000.0 end as distance_km,
           pr.rating_avg, pr.rating_count, pr.is_online, pr.jobs_completed
      from public.provider_services ps
      join public.providers pr on pr.id = ps.provider_id
      join public.categories c on c.id = ps.category_id
     where ps.category_id = v_request.category_id
       and ps.active
       and (v_request.target_provider_id is null or ps.provider_id = v_request.target_provider_id)
       and c.active
       and c.archetype = 'proposal'
       and pr.kyc_status = 'verified'
       and not pr.suspended
       and not coalesce(pr.paused, false)
       -- An open request goes to pros in the request's city. A request aimed at one pro is decided by distance
       -- (the radius check below) when both points are known, so overlapping city names ("Vijayawada Demo" vs
       -- "Vijayawada") cannot block a pro who serves the address.
       and (lower(trim(pr.city)) = lower(trim(v_request.city))
            or (v_request.target_provider_id is not null and v_origin is not null and pr.base_location is not null))
       and pr.id <> v_request.customer_id
       and public._category_docs_ok(pr.id, c.id)
       and (v_origin is null or pr.base_location is null
            or extensions.st_dwithin(pr.base_location, v_origin, pr.service_radius_km * 1000.0))
       and not exists (
         select 1 from public.provider_time_off t
          where t.provider_id = pr.id and t.period && tstzrange(v_request.event_start, v_request.event_end, '[)')
       )
       and not exists (
         select 1 from public.bookings b
          where b.provider_id = pr.id
            and b.service_window && tstzrange(v_request.event_start, v_request.event_end, '[)')
            and b.status in ('pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
                             'delivery_pending', 'completion_requested')
            and (b.status <> 'pending_payment' or coalesce(b.payment_hold_expires_at, '-infinity') > now())
       )
     order by
       pr.is_online desc,
       distance_km asc nulls last,
       pr.rating_avg desc,
       pr.rating_count desc,
       pr.jobs_completed desc,
       ps.id
     limit v_limit
  ),
  inserted as (
    insert into public.request_recipients (request_id, provider_id, provider_service_id)
    select v_request.id, c.provider_id, c.provider_service_id from candidates c
    on conflict (request_id, provider_id) do nothing
    returning provider_id
  )
  select count(*) into v_inserted from inserted;

  insert into public.notifications (user_id, kind, title, body, data, collapse_key)
  select rr.provider_id, 'proposal_request_received',
         'New proposal request',
         coalesce(nullif(v_request.area, ''), v_request.city) || ' · ' ||
           to_char(v_request.event_start, 'DD Mon'),
         jsonb_build_object('request_id', v_request.id, 'event_start', v_request.event_start),
         'proposal-request:' || v_request.id::text
    from public.request_recipients rr
   where rr.request_id = v_request.id
  on conflict (user_id, collapse_key) where status = 'pending' and collapse_key is not null do nothing;

  return v_inserted;
end;
$function$;

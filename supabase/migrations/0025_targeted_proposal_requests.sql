-- Let customers browse creators/event pros and send a brief to one chosen provider.
-- A targeted request is routed only to that provider, with the same eligibility checks as open routing.

alter table public.service_requests
  add column if not exists target_provider_id uuid references public.providers (id) on delete set null;
create or replace function public.route_service_request(p_request_id uuid, p_limit int default 8)
returns int
language plpgsql
security definer
set search_path = public
as $$
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
       and lower(trim(pr.city)) = lower(trim(v_request.city))
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
$$;

drop function if exists public.create_service_request(uuid, text, text, timestamptz, timestamptz, jsonb, int, int, uuid, text);

create or replace function public.create_service_request(
  p_category_id uuid,
  p_city text,
  p_area text,
  p_event_start timestamptz,
  p_event_end timestamptz,
  p_intake jsonb,
  p_budget_min int,
  p_budget_max int,
  p_address_id uuid default null,
  p_venue_text text default null,
  p_provider_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_category public.categories;
  v_address public.addresses;
  v_request uuid;
  v_routed int;
begin
  select * into v_category from public.categories where id = p_category_id;
  perform public._assert(found and v_category.active and v_category.archetype = 'proposal', 'proposal category is not available');
  perform public._assert(p_event_start > now() and p_event_end > p_event_start, 'event window must be in the future');
  perform public._assert(p_event_start <= now() + interval '365 days', 'event is outside the booking window');
  perform public._assert(coalesce(trim(p_city), '') <> '', 'city is required');
  perform public._assert(jsonb_typeof(coalesce(p_intake, '{}'::jsonb)) = 'object', 'intake must be an object');
  perform public._assert(p_budget_min is null or p_budget_max is null or p_budget_min <= p_budget_max, 'budget range is invalid');
  perform public._assert(p_address_id is not null or coalesce(trim(p_venue_text), '') <> '', 'venue or address is required');
  perform public._assert(p_provider_id is null or p_provider_id <> v_uid, 'you cannot request your own proposal');

  if p_address_id is not null then
    select * into v_address from public.addresses where id = p_address_id for share;
    perform public._assert(found and v_address.user_id = v_uid, 'address belongs to another customer');
  end if;

  insert into public.service_requests (
    customer_id, category_id, city, area, event_start, event_end, intake, budget_min, budget_max,
    expires_at, target_provider_id
  ) values (
    v_uid, p_category_id, trim(p_city), coalesce(trim(p_area), ''), p_event_start, p_event_end,
    coalesce(p_intake, '{}'::jsonb), p_budget_min, p_budget_max, now() + interval '7 days', p_provider_id
  ) returning id into v_request;

  insert into public.request_private (
    request_id, address_id, venue_text, contact_name, lat, lng
  ) values (
    v_request, p_address_id, nullif(trim(coalesce(p_venue_text, '')), ''),
    null, v_address.lat, v_address.lng
  );

  v_routed := public.route_service_request(v_request, 8);
  perform public._assert(
    p_provider_id is null or v_routed = 1,
    'this provider is not available in your city or on that date'
  );
  return v_request;
end;
$$;

revoke execute on function
  public.create_service_request(uuid, text, text, timestamptz, timestamptz, jsonb, int, int, uuid, text, uuid)
from public, anon;
grant execute on function
  public.create_service_request(uuid, text, text, timestamptz, timestamptz, jsonb, int, int, uuid, text, uuid)
to authenticated;
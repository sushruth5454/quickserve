-- WP R1; owns: service_request_provider_view; sources: WS8-09, WS8-T05, WS8-T13

create or replace view public.service_request_provider_view
with (security_barrier = true) as
  with managed_provider_ids as (
    select auth.uid() as provider_id
     where auth.uid() is not null
    union
    select bm.owner_id
      from public.business_members bm
     where bm.member_id = auth.uid()
       and bm.active
       and bm.role in ('owner', 'manager')
  )
  select
    r.id,
    r.category_id,
    c.name as category_name,
    c.slug as category_slug,
    r.city,
    r.area,
    r.event_start,
    r.event_end,
    coalesce(r.intake, '{}'::jsonb) - array(
      select schema_property.key
        from jsonb_each(coalesce(c.intake_schema -> 'properties', '{}'::jsonb))
          as schema_property(key, value)
       where coalesce((schema_property.value ->> 'x-private')::boolean, false)
    )::text[] as intake,
    r.budget_min,
    r.budget_max,
    r.status,
    r.expires_at,
    r.created_at,
    rr.provider_id,
    rr.routed_at,
    r.urgent
  from public.request_recipients rr
  join public.service_requests r on r.id = rr.request_id
  join public.categories c on c.id = r.category_id
  where rr.provider_id in (select m.provider_id from managed_provider_ids m)
    and (select count(*)
           from public.request_recipients routed
          where routed.request_id = rr.request_id
            and routed.provider_id in (select m.provider_id from managed_provider_ids m)) = 1
    and r.status in ('open', 'closed', 'booked');

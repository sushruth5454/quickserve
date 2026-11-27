-- O21-SV19: private recursive SchemaField subset validation.
create or replace function public._validate_service_request_intake_node(
  p_spec jsonb, p_value jsonb, p_path text, p_allow_reserved boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_key text;
  v_required text;
  v_child jsonb;
  v_item jsonb;
  v_item_spec jsonb;
  v_number numeric;
begin
  perform public._assert(jsonb_typeof(p_spec) = 'object', format('%s schema is invalid', p_path));
  v_type := p_spec ->> 'type';
  perform public._assert(v_type in ('object', 'string', 'integer', 'number', 'boolean', 'array'),
    format('%s schema type is unsupported', p_path));
  perform public._assert(not exists (
    select 1 from jsonb_object_keys(p_spec) as schema_key(key)
     where schema_key.key not in (
       'type', 'title', 'description', 'enum', 'properties', 'required', 'minimum', 'maximum',
       'minLength', 'maxLength', 'format', 'items', 'minItems', 'maxItems', 'uniqueItems', 'x-private'
     )
  ), format('%s schema contains an unsupported keyword', p_path));
  perform public._assert(p_spec -> 'enum' is null or jsonb_typeof(p_spec -> 'enum') = 'array',
    format('%s enum is invalid', p_path));
  perform public._assert(p_spec -> 'x-private' is null or jsonb_typeof(p_spec -> 'x-private') = 'boolean',
    format('%s x-private setting is invalid', p_path));
  perform public._assert(not coalesce((p_spec ->> 'x-private')::boolean, false)
    or (p_allow_reserved and p_path <> '$'),
    format('%s x-private fields must be top-level so the provider projection can redact them', p_path));

  if v_type = 'object' then
    perform public._assert(p_spec -> 'properties' is null or jsonb_typeof(p_spec -> 'properties') = 'object',
      format('%s properties are invalid', p_path));
    perform public._assert(p_spec -> 'required' is null or jsonb_typeof(p_spec -> 'required') = 'array',
      format('%s required list is invalid', p_path));
    perform public._assert(not (p_spec ? 'items') and not (p_spec ? 'enum')
      and not (p_spec ? 'minimum') and not (p_spec ? 'maximum')
      and not (p_spec ? 'minLength') and not (p_spec ? 'maxLength')
      and not (p_spec ? 'minItems') and not (p_spec ? 'maxItems')
      and not (p_spec ? 'uniqueItems') and not (p_spec ? 'format'),
      format('%s object schema has unsupported constraints', p_path));
    perform public._assert(not exists (
      select 1 from jsonb_array_elements(coalesce(p_spec -> 'required', '[]'::jsonb)) as required_field(value)
       where jsonb_typeof(required_field.value) <> 'string'
          or not (coalesce(p_spec -> 'properties', '{}'::jsonb) ? (required_field.value #>> '{}'))
    ), format('%s has an unknown required field', p_path));
    if p_value is null or jsonb_typeof(p_value) = 'null' then return; end if;
    perform public._assert(jsonb_typeof(p_value) = 'object', format('%s has the wrong type', p_path));
    for v_required in select jsonb_array_elements_text(coalesce(p_spec -> 'required', '[]'::jsonb))
    loop
      v_child := p_value -> v_required;
      perform public._assert(p_value ? v_required and v_child <> 'null'::jsonb
        and not (jsonb_typeof(v_child) = 'string' and v_child #>> '{}' = '')
        and not (jsonb_typeof(v_child) = 'array' and jsonb_array_length(v_child) = 0),
        format('%s.%s is required', p_path, v_required));
    end loop;
    perform public._assert(not exists (
      select 1 from jsonb_object_keys(p_value) as submitted(key)
       where not (coalesce(p_spec -> 'properties', '{}'::jsonb) ? submitted.key)
         and not (p_allow_reserved and p_path = '$' and submitted.key in ('brief', 'package_id', 'deliver_by'))
    ), format('%s contains a field not configured for this category', p_path));
    for v_key, v_child in select property.key, property.value
      from jsonb_each(coalesce(p_spec -> 'properties', '{}'::jsonb)) as property(key, value)
    loop
      perform public._validate_service_request_intake_node(
        v_child, p_value -> v_key, p_path || '.' || v_key, p_path = '$'
      );
    end loop;
    return;
  end if;

  perform public._assert(not (p_spec ? 'properties') and not (p_spec ? 'required'),
    format('%s non-object schema cannot declare properties or required fields', p_path));
  if v_type = 'array' then
    perform public._assert(jsonb_typeof(p_spec -> 'items') = 'object'
      and p_spec -> 'items' ->> 'type' in ('string', 'integer', 'number', 'boolean'),
      format('%s array items must have a supported scalar type', p_path));
    perform public._assert(not exists (
      select 1 from jsonb_object_keys(p_spec -> 'items') as item_key(key)
       where item_key.key not in ('type', 'title', 'description', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'format')
    ), format('%s array items contain an unsupported keyword', p_path));
    perform public._assert(p_spec -> 'minimum' is null and p_spec -> 'maximum' is null
      and p_spec -> 'minLength' is null and p_spec -> 'maxLength' is null and p_spec -> 'format' is null,
      format('%s array item constraints belong in items', p_path));
    perform public._assert(p_spec -> 'minItems' is null or (jsonb_typeof(p_spec -> 'minItems') = 'number'
      and (p_spec ->> 'minItems')::numeric >= 0 and (p_spec ->> 'minItems')::numeric = trunc((p_spec ->> 'minItems')::numeric)),
      format('%s minItems is invalid', p_path));
    perform public._assert(p_spec -> 'maxItems' is null or (jsonb_typeof(p_spec -> 'maxItems') = 'number'
      and (p_spec ->> 'maxItems')::numeric >= 0 and (p_spec ->> 'maxItems')::numeric = trunc((p_spec ->> 'maxItems')::numeric)),
      format('%s maxItems is invalid', p_path));
    perform public._assert(not (p_spec ? 'minItems') or not (p_spec ? 'maxItems')
      or (p_spec ->> 'minItems')::numeric <= (p_spec ->> 'maxItems')::numeric,
      format('%s array bounds are invalid', p_path));
    perform public._assert(p_spec -> 'uniqueItems' is null or jsonb_typeof(p_spec -> 'uniqueItems') = 'boolean',
      format('%s uniqueItems is invalid', p_path));
  else
    perform public._assert(not (p_spec ? 'items') and not (p_spec ? 'minItems')
      and not (p_spec ? 'maxItems') and not (p_spec ? 'uniqueItems'),
      format('%s non-array schema has array constraints', p_path));
  end if;
  if v_type in ('integer', 'number') then
    perform public._assert(p_spec -> 'minimum' is null or jsonb_typeof(p_spec -> 'minimum') = 'number',
      format('%s minimum is invalid', p_path));
    perform public._assert(p_spec -> 'maximum' is null or jsonb_typeof(p_spec -> 'maximum') = 'number',
      format('%s maximum is invalid', p_path));
    perform public._assert(not (p_spec ? 'minimum') or not (p_spec ? 'maximum')
      or (p_spec ->> 'minimum')::numeric <= (p_spec ->> 'maximum')::numeric,
      format('%s numeric bounds are invalid', p_path));
  else
    perform public._assert(not (p_spec ? 'minimum') and not (p_spec ? 'maximum'),
      format('%s numeric bounds require a numeric field', p_path));
  end if;
  if v_type = 'string' then
    perform public._assert(p_spec -> 'minLength' is null or (jsonb_typeof(p_spec -> 'minLength') = 'number'
      and (p_spec ->> 'minLength')::numeric >= 0 and (p_spec ->> 'minLength')::numeric = trunc((p_spec ->> 'minLength')::numeric)),
      format('%s minLength is invalid', p_path));
    perform public._assert(p_spec -> 'maxLength' is null or (jsonb_typeof(p_spec -> 'maxLength') = 'number'
      and (p_spec ->> 'maxLength')::numeric >= 0 and (p_spec ->> 'maxLength')::numeric = trunc((p_spec ->> 'maxLength')::numeric)),
      format('%s maxLength is invalid', p_path));
    perform public._assert(not (p_spec ? 'minLength') or not (p_spec ? 'maxLength')
      or (p_spec ->> 'minLength')::numeric <= (p_spec ->> 'maxLength')::numeric,
      format('%s string bounds are invalid', p_path));
    perform public._assert(p_spec -> 'format' is null or p_spec ->> 'format' in ('date', 'date-time'),
      format('%s format is invalid', p_path));
  else
    perform public._assert(not (p_spec ? 'minLength') and not (p_spec ? 'maxLength') and not (p_spec ? 'format'),
      format('%s string constraints require a string field', p_path));
  end if;
  v_item_spec := p_spec -> 'items';
  if v_type = 'array' then
    perform public._validate_service_request_intake_node(v_item_spec, null::jsonb, p_path || '[]', false);
  end if;
  if p_value is null or jsonb_typeof(p_value) = 'null' then return; end if;

  if v_type = 'array' then
    perform public._assert(jsonb_typeof(p_value) = 'array', format('%s has the wrong type', p_path));
    if p_spec ? 'minItems' then
      perform public._assert(jsonb_array_length(p_value) >= (p_spec ->> 'minItems')::int,
        format('%s has too few values', p_path));
    end if;
    if p_spec ? 'maxItems' then
      perform public._assert(jsonb_array_length(p_value) <= (p_spec ->> 'maxItems')::int,
        format('%s has too many values', p_path));
    end if;
    if coalesce((p_spec ->> 'uniqueItems')::boolean, false) then
      perform public._assert((select count(*) = count(distinct item.value)
        from jsonb_array_elements(p_value) as item(value)), format('%s values must be unique', p_path));
    end if;
    for v_item in select item.value from jsonb_array_elements(p_value) as item(value)
    loop
      perform public._validate_service_request_intake_node(v_item_spec, v_item, p_path || '[]', false);
      if p_spec ? 'enum' then
        perform public._assert(p_spec -> 'enum' @> jsonb_build_array(v_item), format('%s contains an unsupported item', p_path));
      end if;
    end loop;
  elsif v_type in ('integer', 'number') then
    perform public._assert(jsonb_typeof(p_value) = 'number', format('%s has the wrong type', p_path));
    v_number := (p_value #>> '{}')::numeric;
    if v_type = 'integer' then
      perform public._assert(v_number = trunc(v_number), format('%s must be an integer', p_path));
    end if;
    if p_spec ? 'minimum' then
      perform public._assert(v_number >= (p_spec ->> 'minimum')::numeric, format('%s is below its minimum', p_path));
    end if;
    if p_spec ? 'maximum' then
      perform public._assert(v_number <= (p_spec ->> 'maximum')::numeric, format('%s is above its maximum', p_path));
    end if;
    if p_spec ? 'enum' then
      perform public._assert(p_spec -> 'enum' @> jsonb_build_array(p_value), format('%s has an unsupported value', p_path));
    end if;
  elsif v_type = 'string' then
    perform public._assert(jsonb_typeof(p_value) = 'string', format('%s has the wrong type', p_path));
    if p_spec ? 'minLength' then
      perform public._assert(char_length(p_value #>> '{}') >= (p_spec ->> 'minLength')::int,
        format('%s is shorter than its minimum length', p_path));
    end if;
    if p_spec ? 'maxLength' then
      perform public._assert(char_length(p_value #>> '{}') <= (p_spec ->> 'maxLength')::int,
        format('%s is longer than its maximum length', p_path));
    end if;
    if p_spec ? 'enum' then
      perform public._assert(p_spec -> 'enum' @> jsonb_build_array(p_value), format('%s has an unsupported value', p_path));
    end if;
  else
    perform public._assert(jsonb_typeof(p_value) = 'boolean', format('%s has the wrong type', p_path));
    if p_spec ? 'enum' then
      perform public._assert(p_spec -> 'enum' @> jsonb_build_array(p_value), format('%s has an unsupported value', p_path));
    end if;
  end if;
end;
$$;

revoke all on function public._validate_service_request_intake_node(jsonb, jsonb, text, boolean) from public, anon, authenticated, service_role;

create or replace function public._validate_service_request_intake(p_category_id uuid, p_intake jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schema jsonb;
begin
  select c.intake_schema into v_schema from public.categories c where c.id = p_category_id;
  perform public._assert(found and jsonb_typeof(coalesce(v_schema, 'null'::jsonb)) = 'object'
    and v_schema ->> 'type' = 'object', 'proposal category intake schema is unavailable');
  perform public._assert(not exists (
    select 1 from jsonb_object_keys(v_schema) as root_key(key)
     where root_key.key not in ('type', 'properties', 'required', 'title', 'description')
  ), 'proposal category intake schema contains an unsupported keyword');
  perform public._assert(jsonb_typeof(coalesce(v_schema -> 'properties', '{}'::jsonb)) = 'object'
    and (v_schema -> 'required' is null or jsonb_typeof(v_schema -> 'required') = 'array'),
    'proposal category intake schema is invalid');
  perform public._assert(jsonb_typeof(coalesce(p_intake, 'null'::jsonb)) = 'object', 'intake must be an object');
  perform public._assert(jsonb_typeof(p_intake -> 'brief') = 'string'
    and char_length(btrim(p_intake ->> 'brief')) >= 10, 'brief must contain at least 10 characters');
  perform public._assert(not (p_intake ? 'package_id') or jsonb_typeof(p_intake -> 'package_id') = 'string',
    'package_id must be a string');
  perform public._assert(not (p_intake ? 'deliver_by') or jsonb_typeof(p_intake -> 'deliver_by') = 'string',
    'deliver_by must be a string');
  perform public._validate_service_request_intake_node(v_schema, p_intake, '$', true);
end;
$$;

revoke all on function public._validate_service_request_intake(uuid, jsonb) from public, anon, authenticated, service_role;
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
  perform public._assert(public._archetype_enabled('proposal'), 'proposal service type is turned off');
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
       and public._provider_is_live(pr.id)
       and not coalesce(pr.paused, false)
       and (lower(trim(pr.city)) = lower(trim(v_request.city))
            or (v_origin is not null and pr.base_location is not null))
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
     order by pr.is_online desc, distance_km asc nulls last,
              pr.rating_avg desc, pr.rating_count desc, pr.jobs_completed desc, ps.id
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
         case when v_request.urgent then 'Urgent proposal request' else 'New proposal request' end,
         coalesce(nullif(v_request.area, ''), v_request.city) || ' · ' ||
           case when v_request.urgent
             then to_char(v_request.event_start at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') || ' · reply fast'
             else to_char(v_request.event_start, 'DD Mon') end,
         jsonb_build_object('request_id', v_request.id, 'event_start', v_request.event_start),
         'proposal-request:' || v_request.id::text
    from public.request_recipients rr
   where rr.request_id = v_request.id
  on conflict (user_id, collapse_key) where status = 'pending' and collapse_key is not null do nothing;

  return v_inserted;
end;
$$;

revoke execute on function public.route_service_request(uuid, int) from public, anon, authenticated;
grant execute on function public.route_service_request(uuid, int) to service_role;
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
  p_provider_id uuid default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_urgent boolean default false
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
  v_urgent boolean;
begin
  perform public._assert(public._archetype_enabled('proposal'), 'proposal service type is turned off');
  select * into v_category from public.categories where id = p_category_id;
  perform public._assert(found and v_category.active and v_category.archetype = 'proposal', 'proposal category is not available');
  perform public._assert(p_event_start > now() and p_event_end > p_event_start, 'event window must be in the future');
  perform public._assert(p_event_start <= now() + interval '365 days', 'event is outside the booking window');
  v_urgent := coalesce(p_urgent, false)
    and p_event_start < now() + make_interval(hours => v_category.min_lead_hours);
  if v_urgent then
    perform public._assert(p_event_start >= now() + interval '2 hours' - interval '5 minutes',
      'An urgent request needs at least 2 hours so the pro can get there. Choose a later time.');
  else
    perform public._assert(p_event_start >= now() + make_interval(hours => v_category.min_lead_hours),
      format('%s needs at least %s hours'' notice. Choose a later date, or mark it urgent.',
        v_category.name, v_category.min_lead_hours));
  end if;
  perform public._assert(coalesce(trim(p_city), '') <> '', 'city is required');
  perform public._assert(jsonb_typeof(coalesce(p_intake, '{}'::jsonb)) = 'object', 'intake must be an object');
  perform public._assert(not public._creator_contact_hint(coalesce(p_intake, '{}'::jsonb)::text),
    'Remove phone numbers, emails or payment handles from the brief');
  perform public._validate_service_request_intake(p_category_id, coalesce(p_intake, '{}'::jsonb));
  perform public._assert(p_budget_min is null or p_budget_max is null or p_budget_min <= p_budget_max, 'budget range is invalid');
  perform public._assert(p_address_id is not null or coalesce(trim(p_venue_text), '') <> '', 'venue or address is required');
  perform public._assert(p_provider_id is null or p_provider_id <> v_uid, 'you cannot request your own proposal');
  perform public._assert((p_lat is null) = (p_lng is null)
    and (p_lat is null or (p_lat between -90 and 90 and p_lng between -180 and 180)), 'location is invalid');

  if p_address_id is not null then
    select * into v_address from public.addresses where id = p_address_id for share;
    perform public._assert(found and v_address.user_id = v_uid, 'address belongs to another customer');
  end if;

  insert into public.service_requests (
    customer_id, category_id, city, area, event_start, event_end, intake, budget_min, budget_max,
    expires_at, target_provider_id, urgent
  ) values (
    v_uid, p_category_id, trim(p_city), coalesce(trim(p_area), ''), p_event_start, p_event_end,
    coalesce(p_intake, '{}'::jsonb), p_budget_min, p_budget_max,
    case when v_urgent then least(now() + interval '7 days', p_event_start - interval '30 minutes')
         else now() + interval '7 days' end,
    p_provider_id, v_urgent
  ) returning id into v_request;

  insert into public.request_private (request_id, address_id, venue_text, contact_name, lat, lng)
  values (v_request, p_address_id, nullif(trim(coalesce(p_venue_text, '')), ''),
          null, coalesce(v_address.lat, p_lat), coalesce(v_address.lng, p_lng));

  v_routed := public.route_service_request(v_request, 8);
  perform public._assert(p_provider_id is null or v_routed = 1,
    'this provider is not available in your city or on that date');
  return v_request;
end;
$$;

revoke execute on function public.create_service_request(
  uuid, text, text, timestamptz, timestamptz, jsonb, int, int,
  uuid, text, uuid, double precision, double precision, boolean
) from public, anon;
grant execute on function public.create_service_request(
  uuid, text, text, timestamptz, timestamptz, jsonb, int, int,
  uuid, text, uuid, double precision, double precision, boolean
) to authenticated;
alter function public.send_proposal(uuid, jsonb, jsonb, timestamptz, text, jsonb, timestamptz)
  rename to _send_proposal_unchecked;
revoke all on function public._send_proposal_unchecked(uuid, jsonb, jsonb, timestamptz, text, jsonb, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.send_proposal(
  p_request_id uuid,
  p_items jsonb,
  p_schedule jsonb,
  p_valid_until timestamptz,
  p_note text default null,
  p_deliverables jsonb default '[]'::jsonb,
  p_delivery_due_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.service_requests;
  v_recipient public.request_recipients;
  v_service public.provider_services;
  v_provider public.providers;
  v_category public.categories;
  v_private public.request_private;
  v_origin extensions.geography;
  v_recipient_count int;
begin
  perform public._require_uid();
  perform public._assert(public._archetype_enabled('proposal'), 'proposal service type is turned off');
  select * into v_request from public.service_requests where id = p_request_id for update;
  perform public._assert(found and v_request.status = 'open', 'request is not open');
  perform public._assert(v_request.expires_at > now(), 'request expired');
  select count(*) into v_recipient_count from public.request_recipients rr
   where rr.request_id = p_request_id and public._acts_for(rr.provider_id, 'manager');
  perform public._assert(v_recipient_count = 1, 'request must be routed to exactly one business you manage');
  select rr.* into v_recipient from public.request_recipients rr
   where rr.request_id = p_request_id and public._acts_for(rr.provider_id, 'manager');
  perform public._assert(found, 'provider was not routed this request');
  select ps.* into v_service from public.provider_services ps
   where ps.id = v_recipient.provider_service_id for share;
  perform public._assert(found and v_service.active and v_service.provider_id = v_recipient.provider_id
    and v_service.category_id = v_request.category_id, 'provider service is not available for this request');
  select p.* into v_provider from public.providers p where p.id = v_recipient.provider_id for share;
  perform public._assert(found and public._provider_is_live(v_provider.id)
    and not coalesce(v_provider.paused, false), 'provider is not available for new proposals');
  select c.* into v_category from public.categories c where c.id = v_request.category_id for share;
  perform public._assert(found and v_category.active and v_category.archetype = 'proposal'
    and public._category_docs_ok(v_provider.id, v_category.id), 'provider category is not available for new proposals');
  perform public._assert(v_request.target_provider_id is null or v_request.target_provider_id = v_recipient.provider_id,
    'provider was not targeted for this request');
  select rp.* into v_private from public.request_private rp where rp.request_id = p_request_id;
  if v_private.lat is not null and v_private.lng is not null then
    v_origin := extensions.st_setsrid(extensions.st_makepoint(v_private.lng, v_private.lat), 4326)::extensions.geography;
  end if;
  perform public._assert(lower(trim(v_provider.city)) = lower(trim(v_request.city))
    or (v_origin is not null and v_provider.base_location is not null), 'provider is not available in the request city');
  perform public._assert(v_origin is null or v_provider.base_location is null
    or extensions.st_dwithin(v_provider.base_location, v_origin, v_provider.service_radius_km * 1000.0),
    'provider is outside the request service area');
  perform public._assert(not exists (
    select 1 from public.provider_time_off t
     where t.provider_id = v_provider.id and t.period && tstzrange(v_request.event_start, v_request.event_end, '[)')
  ), 'provider is unavailable for the request window');
  perform public._assert(not exists (
    select 1 from public.bookings b
     where b.provider_id = v_provider.id
       and b.service_window && tstzrange(v_request.event_start, v_request.event_end, '[)')
       and b.status in ('pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
                        'delivery_pending', 'completion_requested')
       and (b.status <> 'pending_payment' or coalesce(b.payment_hold_expires_at, '-infinity') > now())
  ), 'provider is unavailable for the request window');
  return public._send_proposal_unchecked(
    p_request_id, p_items, p_schedule, p_valid_until, p_note, p_deliverables, p_delivery_due_at
  );
end;
$$;

revoke execute on function public.send_proposal(uuid, jsonb, jsonb, timestamptz, text, jsonb, timestamptz)
  from public, anon;
grant execute on function public.send_proposal(uuid, jsonb, jsonb, timestamptz, text, jsonb, timestamptz)
  to authenticated;
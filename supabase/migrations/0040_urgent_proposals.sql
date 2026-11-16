-- 0040: urgent creator/event requests. Proposal categories need 24 hours' notice; a customer can now mark a request
-- urgent for an event as soon as 2 hours away. Urgent requests expire 30 minutes before the event, pros are notified
-- with the event time, and the notice check in send_proposal, accept_proposal and the booking trigger uses 2 hours.

alter table public.service_requests add column if not exists urgent boolean not null default false;

create or replace function public._proposal_notice(p_request public.service_requests)
returns interval
language sql
stable
security definer
set search_path = public
as $$
  select case when p_request.urgent then interval '2 hours'
              else make_interval(hours => (select c.min_lead_hours from public.categories c where c.id = p_request.category_id)) end;
$$;
revoke execute on function public._proposal_notice(public.service_requests) from public, anon, authenticated;

drop function if exists public.create_service_request(uuid, text, text, timestamptz, timestamptz, jsonb, int, int, uuid, text, uuid, double precision, double precision);

CREATE OR REPLACE FUNCTION public.create_service_request(p_category_id uuid, p_city text, p_area text, p_event_start timestamp with time zone, p_event_end timestamp with time zone, p_intake jsonb, p_budget_min integer, p_budget_max integer, p_address_id uuid DEFAULT NULL::uuid, p_venue_text text DEFAULT NULL::text, p_provider_id uuid DEFAULT NULL::uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_urgent boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public._require_uid();
  v_category public.categories;
  v_address public.addresses;
  v_request uuid;
  v_routed int;
  v_urgent boolean;
begin
  select * into v_category from public.categories where id = p_category_id;
  perform public._assert(found and v_category.active and v_category.archetype = 'proposal', 'proposal category is not available');
  perform public._assert(p_event_start > now() and p_event_end > p_event_start, 'event window must be in the future');
  perform public._assert(p_event_start <= now() + interval '365 days', 'event is outside the booking window');
  -- An urgent request only needs enough time for the pro to get there; otherwise the category's notice applies.
  v_urgent := coalesce(p_urgent, false) and p_event_start < now() + make_interval(hours => v_category.min_lead_hours);
  if v_urgent then
    perform public._assert(p_event_start >= now() + interval '2 hours' - interval '5 minutes',
      'An urgent request needs at least 2 hours so the pro can get there. Choose a later time.');
  else
    perform public._assert(p_event_start >= now() + make_interval(hours => v_category.min_lead_hours),
      format('%s needs at least %s hours'' notice. Choose a later date, or mark it urgent.', v_category.name, v_category.min_lead_hours));
  end if;
  perform public._assert(coalesce(trim(p_city), '') <> '', 'city is required');
  perform public._assert(jsonb_typeof(coalesce(p_intake, '{}'::jsonb)) = 'object', 'intake must be an object');
  perform public._assert(p_budget_min is null or p_budget_max is null or p_budget_min <= p_budget_max, 'budget range is invalid');
  perform public._assert(p_address_id is not null or coalesce(trim(p_venue_text), '') <> '', 'venue or address is required');
  perform public._assert(p_provider_id is null or p_provider_id <> v_uid, 'you cannot request your own proposal');
  perform public._assert((p_lat is null) = (p_lng is null) and (p_lat is null or (p_lat between -90 and 90 and p_lng between -180 and 180)), 'location is invalid');

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
    case when v_urgent then least(now() + interval '7 days', p_event_start - interval '30 minutes') else now() + interval '7 days' end,
    p_provider_id, v_urgent
  ) returning id into v_request;

  insert into public.request_private (
    request_id, address_id, venue_text, contact_name, lat, lng
  ) values (
    v_request, p_address_id, nullif(trim(coalesce(p_venue_text, '')), ''),
    null, coalesce(v_address.lat, p_lat), coalesce(v_address.lng, p_lng)
  );

  v_routed := public.route_service_request(v_request, 8);
  perform public._assert(
    p_provider_id is null or v_routed = 1,
    'this provider is not available in your city or on that date'
  );
  return v_request;
end;
$function$;

revoke execute on function
  public.create_service_request(uuid, text, text, timestamptz, timestamptz, jsonb, int, int, uuid, text, uuid, double precision, double precision, boolean)
from public, anon;
grant execute on function
  public.create_service_request(uuid, text, text, timestamptz, timestamptz, jsonb, int, int, uuid, text, uuid, double precision, double precision, boolean)
to authenticated;

create or replace view public.service_request_provider_view
with (security_barrier = true) as
  select
    r.id,
    r.category_id,
    c.name as category_name,
    c.slug as category_slug,
    r.city,
    r.area,
    r.event_start,
    r.event_end,
    public._proposal_public_intake(r.category_id, r.intake) as intake,
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
  where rr.provider_id = auth.uid()
    and r.status in ('open', 'closed', 'booked');
grant select on public.service_request_provider_view to authenticated;

CREATE OR REPLACE FUNCTION public.send_proposal(p_request_id uuid, p_items jsonb, p_schedule jsonb, p_valid_until timestamp with time zone, p_note text DEFAULT NULL::text, p_deliverables jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public._require_uid();
  v_request public.service_requests;
  v_recipient public.request_recipients;
  v_item jsonb;
  v_row jsonb;
  v_kind public.quote_item_kind;
  v_seq int;
  v_total int := 0;
  v_schedule_total int := 0;
  v_version int;
  v_proposal uuid;
  v_due timestamptz;
  v_cancel jsonb := '{}'::jsonb;
begin
  select * into v_request from public.service_requests where id = p_request_id for update;
  perform public._assert(found and v_request.status = 'open', 'request is not open');
  perform public._assert(v_request.expires_at > now(), 'request expired');
  perform public._assert(
    v_request.event_start >= now() + public._proposal_notice(v_request) - interval '5 minutes',
    'This event is too soon to be booked, so a proposal can''t be accepted. Ask the customer for a later date.');
  select * into v_recipient from public.request_recipients
   where request_id = p_request_id and provider_id = v_uid;
  perform public._assert(found, 'provider was not routed this request');
  -- A proposal can't outlive its request; cap it instead of rejecting a client default such as 'now + 7 days'.
  p_valid_until := least(coalesce(p_valid_until, v_request.expires_at), v_request.expires_at);
  perform public._assert(p_valid_until > now() + interval '15 minutes', 'this request expires too soon for a new proposal');
  perform public._assert(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 30,
                         'proposal needs 1 to 30 items');
  perform public._assert(jsonb_typeof(p_schedule) = 'array' and jsonb_array_length(p_schedule) between 1 and 8,
                         'proposal needs 1 to 8 payment milestones');
  perform public._assert(jsonb_typeof(coalesce(p_deliverables, '[]'::jsonb)) = 'array', 'deliverables must be an array');

  update public.proposals set status = 'withdrawn', updated_at = now()
   where request_id = p_request_id and provider_id = v_uid and status = 'sent';
  select coalesce(max(version), 0) + 1 into v_version from public.proposals
   where request_id = p_request_id and provider_id = v_uid;

  insert into public.proposals (
    request_id, provider_id, provider_service_id, version, total, valid_until, note, deliverables,
    cancellation_snapshot
  )
  values (
    p_request_id, v_uid, v_recipient.provider_service_id, v_version, 1, p_valid_until,
    nullif(trim(coalesce(p_note, '')), ''), coalesce(p_deliverables, '[]'::jsonb), v_cancel
  ) returning id into v_proposal;

  for v_item, v_seq in
    select value, ordinality::int from jsonb_array_elements(p_items) with ordinality
  loop
    v_kind := (v_item ->> 'kind')::public.quote_item_kind;
    perform public._assert(coalesce(trim(v_item ->> 'title'), '') <> '', 'proposal item title is required');
    perform public._assert((v_item ->> 'qty')::numeric > 0 and (v_item ->> 'qty')::numeric <= 1000,
                           'proposal item quantity is invalid');
    perform public._assert((v_item ->> 'unit_price')::int >= 0 and (v_item ->> 'unit_price')::int <= 100000000,
                           'proposal item price is invalid');
    v_total := v_total + round((v_item ->> 'qty')::numeric * (v_item ->> 'unit_price')::int);
    insert into public.proposal_items (
      proposal_id, seq, kind, title, qty, unit, unit_price, bill_photo_url, metadata
    ) values (
      v_proposal, v_seq, v_kind, trim(v_item ->> 'title'), (v_item ->> 'qty')::numeric,
      nullif(trim(coalesce(v_item ->> 'unit', '')), ''), (v_item ->> 'unit_price')::int,
      nullif(v_item ->> 'bill_photo_url', ''), coalesce(v_item -> 'metadata', '{}'::jsonb)
    );
  end loop;
  perform public._assert(v_total > 0, 'proposal total must be positive');

  for v_row, v_seq in
    select value, ordinality::int from jsonb_array_elements(p_schedule) with ordinality
  loop
    perform public._assert(coalesce(trim(v_row ->> 'label'), '') <> '', 'milestone label is required');
    perform public._assert((v_row ->> 'amount')::int > 0, 'milestone amount must be positive');
    perform public._assert(v_row ->> 'due_rule' in (
      'at_booking', 'days_before_start:7', 'days_before_start:1', 'on_completion', 'on_delivery'
    ), 'milestone due rule is invalid');
    v_due := case v_row ->> 'due_rule'
      when 'at_booking' then now()
      when 'days_before_start:7' then v_request.event_start - interval '7 days'
      when 'days_before_start:1' then v_request.event_start - interval '1 day'
      else null
    end;
    v_schedule_total := v_schedule_total + (v_row ->> 'amount')::int;
    insert into public.proposal_schedule (proposal_id, seq, label, amount, due_rule, due_at)
    values (
      v_proposal, v_seq, trim(v_row ->> 'label'), (v_row ->> 'amount')::int,
      v_row ->> 'due_rule', v_due
    );
  end loop;
  perform public._assert(v_schedule_total = v_total, 'milestones must sum exactly to the proposal total');

  update public.proposals
     set total = v_total,
         pricing_snapshot = jsonb_build_object(
           'version', v_version,
           'total', v_total,
           'items', (select jsonb_agg(row_to_json(x)) from (
             select seq, kind, title, qty, unit, unit_price, metadata
               from public.proposal_items where proposal_id = v_proposal order by seq
           ) x),
           'deliverables', coalesce(p_deliverables, '[]'::jsonb)
         ),
         payment_snapshot = jsonb_build_object(
           'schedule', (select jsonb_agg(row_to_json(x)) from (
             select seq, label, amount, due_rule, due_at
               from public.proposal_schedule where proposal_id = v_proposal order by seq
           ) x)
         ),
         updated_at = now()
   where id = v_proposal;

  perform public._queue_notification(
    v_request.customer_id, 'proposal_received', null,
    'New proposal received',
    'A verified provider sent a proposal for your request.',
    jsonb_build_object('request_id', v_request.id, 'proposal_id', v_proposal),
    'proposal-received:' || v_request.id::text
  );
  return v_proposal;
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_proposal(p_proposal_id uuid, p_address_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public._require_uid();
  v_proposal public.proposals;
  v_request public.service_requests;
  v_private public.request_private;
  v_address public.addresses;
  v_category public.categories;
  v_booking uuid;
  v_existing uuid;
  v_quote uuid;
  v_address_id uuid;
  v_window tstzrange;
  v_platform_fee int;
  v_cancel_snapshot jsonb := '{}'::jsonb;
  v_fee_snapshot jsonb;
  v_seq int;
begin
  select * into v_proposal from public.proposals where id = p_proposal_id for update;
  perform public._assert(found, 'proposal not found');
  select * into v_request from public.service_requests where id = v_proposal.request_id for update;
  perform public._assert(v_request.customer_id = v_uid, 'only the customer can accept this proposal');
  select b.id into v_existing
    from public.bookings b
   where b.service_request_id = v_request.id
     and b.status in ('pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
                      'delivery_pending', 'completion_requested', 'disputed')
   limit 1;
  if v_existing is not null then
    perform public._assert(
      exists (select 1 from public.bookings where id = v_existing and proposal_id = p_proposal_id),
      'this request already has an active booking'
    );
    return v_existing;
  end if;
  perform public._assert(v_request.status = 'open', 'request is not open');
  perform public._assert(v_proposal.status = 'sent' and v_proposal.valid_until > now(), 'proposal is no longer valid');

  perform pg_advisory_xact_lock(hashtext(v_proposal.provider_id::text));
  select * into v_category from public.categories where id = v_request.category_id;
  perform public._assert(v_category.active and v_category.archetype = 'proposal', 'category is unavailable');
  perform public._assert(v_request.event_start >= now() + public._proposal_notice(v_request) - interval '5 minutes',
    case when v_request.urgent
      then 'This event starts too soon to be booked. Post a new request with a later time.'
      else format('This event is less than %s hours away, so it can no longer be booked. Post a new request with a later date, or mark it urgent.', v_category.min_lead_hours) end);
  select * into v_private from public.request_private where request_id = v_request.id;
  v_address_id := coalesce(p_address_id, v_private.address_id);
  if v_address_id is not null then
    select * into v_address from public.addresses where id = v_address_id;
    perform public._assert(found and v_address.user_id = v_uid, 'address belongs to another customer');
  elsif v_private.lat is not null and v_private.lng is not null then
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values (v_uid, 'Event venue', coalesce(v_private.venue_text, v_request.area), v_request.city,
            v_private.lat, v_private.lng)
    returning id into v_address_id;
  else
    raise exception 'address is required for booking' using errcode = 'P0001';
  end if;

  v_window := tstzrange(v_request.event_start, v_request.event_end, '[)');
  perform public._assert(not exists (
    select 1 from public.bookings b
     where b.provider_id = v_proposal.provider_id
       and b.service_window && v_window
       and b.status in ('pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
                        'delivery_pending', 'completion_requested')
       and (b.status <> 'pending_payment' or coalesce(b.payment_hold_expires_at, '-infinity') > now())
  ), 'provider is no longer available for this event');

  v_platform_fee := least(49900, greatest(9900, round(v_proposal.total * 0.01)));
  v_fee_snapshot := jsonb_build_object(
    'archetype', 'proposal', 'rate_bp', 100, 'minimum', 9900, 'maximum', 49900, 'amount', v_platform_fee
  );
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'cancellation_policies') then
    execute     $sql$
      select rules from public.cancellation_policies
       where key = 'event_moderate' limit 1
    $sql$ into v_cancel_snapshot;
  end if;

  insert into public.bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id, description,
    scheduled_at, status, visit_fee, platform_fee, total_amount, service_window,
    service_request_id, proposal_id, archetype, category_config_version,
    pricing_snapshot, payment_template_snapshot, cancellation_snapshot, platform_fee_rule_snapshot,
    payment_hold_expires_at, delivery_status, delivery_snapshot
  ) values (
    v_uid, v_proposal.provider_id, v_request.category_id, v_proposal.provider_service_id, v_address_id,
    'Proposal request ' || left(v_request.id::text, 8), v_request.event_start, 'pending_payment',
    0, v_platform_fee, v_proposal.total + v_platform_fee, v_window,
    v_request.id, v_proposal.id, 'proposal', v_category.config_version,
    v_proposal.pricing_snapshot, v_proposal.payment_snapshot, coalesce(v_cancel_snapshot, '{}'::jsonb),
    v_fee_snapshot, now() + interval '30 minutes',
    case when jsonb_array_length(v_proposal.deliverables) > 0 then 'pending' else 'not_applicable' end,
    v_proposal.deliverables
  ) returning id into v_booking;

  insert into public.quotes (
    booking_id, version, status, is_change_order, total, note
  ) values (v_booking, 1, 'approved_pending_payment', false, v_proposal.total, v_proposal.note)
  returning id into v_quote;

  insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price, bill_photo_url)
  select v_quote, pi.kind, pi.title, pi.qty, pi.unit, pi.unit_price, pi.bill_photo_url
    from public.proposal_items pi
   where pi.proposal_id = v_proposal.id
   order by pi.seq;

  update public.bookings set approved_quote_id = v_quote where id = v_booking;
  insert into public.booking_secrets (booking_id, start_otp) values (v_booking, public._gen_otp());
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (v_booking, v_uid, null, 'pending_payment', 'proposal accepted; 30 minute payment hold');

  insert into public.payment_schedule (
    booking_id, quote_id, seq, obligation_type, label, amount, due_rule, due_at,
    status, purpose, obligation_kind, proposal_schedule_id
  )
  select v_booking, v_quote, ps.seq, 'service', ps.label, ps.amount, ps.due_rule, ps.due_at,
         case when ps.due_rule = 'at_booking' or ps.due_at <= now() then 'due' else 'upcoming' end,
         case
           when ps.due_rule = 'at_booking' then 'advance'::public.payment_purpose
           when ps.due_rule in ('on_completion', 'on_delivery') then 'final'::public.payment_purpose
           else 'milestone'::public.payment_purpose
         end,
         'service', ps.id
    from public.proposal_schedule ps
   where ps.proposal_id = v_proposal.id
   order by ps.seq;

  select coalesce(max(seq), 0) + 1 into v_seq from public.payment_schedule where booking_id = v_booking;
  insert into public.payment_schedule (
    booking_id, quote_id, seq, obligation_type, label, amount, due_rule, due_at,
    status, purpose, obligation_kind
  ) values (
    v_booking, v_quote, v_seq, 'platform_fee', 'QuickServe platform fee', v_platform_fee, 'at_booking', now(),
    'due', 'platform_fee', 'platform_fee'
  );

  update public.proposals set status = 'accepted', updated_at = now() where id = v_proposal.id;
  update public.service_requests set status = 'closed', updated_at = now() where id = v_request.id;
  return v_booking;
end;
$function$;

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
       -- With known coordinates the pro's service radius (checked below) decides, for open and targeted requests
       -- alike, so city labels ("Vijayawada Demo" vs "Vijayawada", a suburb vs its city) never hide a pro who serves
       -- the location. Without coordinates the request's city must match.
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
$function$;

create or replace function public._apply_booking_core_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.categories;
  p public.cancellation_policies;
  v_city text;
  v_window tstzrange;
begin
  if tg_op = 'UPDATE' then
    perform public._assert(
      new.archetype is not distinct from old.archetype
      and new.category_config_version is not distinct from old.category_config_version
      and new.location_mode is not distinct from old.location_mode
      and new.pricing_snapshot is not distinct from old.pricing_snapshot
      and new.payment_template_snapshot is not distinct from old.payment_template_snapshot
      and new.cancellation_snapshot is not distinct from old.cancellation_snapshot
      and new.platform_fee_rule_snapshot is not distinct from old.platform_fee_rule_snapshot
      and new.exclusive is not distinct from old.exclusive,
      'booking core snapshot is immutable'
    );
    return new;
  end if;

  select * into c from public.categories where id = new.category_id;
  perform public._assert(found, 'category not found');
  select a.city into v_city from public.addresses a where a.id = new.address_id;
  perform public._assert(coalesce(trim(v_city), '') <> '', 'booking city not found');
  v_window := coalesce(
    new.service_window,
    case when new.scheduled_at is null then null
         else tstzrange(new.scheduled_at, new.scheduled_at + interval '2 hours', '[)') end
  );
  if c.archetype = 'proposal' and new.service_request_id is not null
     and exists (select 1 from public.service_requests r where r.id = new.service_request_id and r.urgent) then
    -- Urgent proposal bookings skip the category's notice period; accept_proposal enforces the urgent minimum.
    perform public._assert_bookable(c.id, new.provider_id, v_city, c.archetype, null);
    perform public._assert(v_window is null or lower(v_window) > now(), 'event window must be in the future');
  else
    perform public._assert_bookable(c.id, new.provider_id, v_city, c.archetype, v_window);
  end if;
  perform public._assert(
    new.location_mode is null or new.location_mode = any(c.location_modes),
    'location mode is not available for this category'
  );
  select * into p
    from public.cancellation_policies
   where key = c.cancellation_policy and active;
  perform public._assert(found, 'active cancellation policy not found');

  new.archetype := c.archetype;
  new.category_config_version := c.config_version;
  new.location_mode := coalesce(new.location_mode, c.location_modes[1]);
  new.pricing_snapshot := coalesce(new.pricing_snapshot, jsonb_build_object(
    'key', 'category:' || c.id::text || ':v' || c.config_version::text,
    'pricing_mode', c.pricing_mode,
    'pricing_units', to_jsonb(c.pricing_units),
    'visit_fee_paise', new.visit_fee,
    'platform_fee_paise', new.platform_fee
  ));
  new.payment_template_snapshot := coalesce(new.payment_template_snapshot, jsonb_build_object(
    'key', c.payment_template,
    'version', c.config_version
  ));
  new.cancellation_snapshot := jsonb_build_object(
    'key', p.key,
    'label', p.label,
    'version', p.version,
    'rules', p.rules -> 'rules'
  );
  new.platform_fee_rule_snapshot := coalesce(new.platform_fee_rule_snapshot, jsonb_build_object(
    'key', case when c.archetype = 'inspect_quote' then 'legacy_flat' else 'archetype:' || c.archetype end,
    'amount_paise', new.platform_fee
  ));
  new.exclusive := c.exclusive;
  if new.scheduled_at is not null and new.service_window is null then
    new.service_window := v_window;
  end if;
  return new;
end;
$$;

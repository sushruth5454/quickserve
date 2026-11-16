-- 0038: proposal events must respect the category's notice period (min_lead_hours) at every step. Requests for an
-- event 17 hours away were accepted and quoted, then accept_proposal failed in the booking trigger with the raw code
-- 'category_not_bookable'. Requests now reject a too-soon date with a clear message, send_proposal refuses a request that
-- can no longer be booked, and accept_proposal explains why instead of the raw code.

CREATE OR REPLACE FUNCTION public.create_service_request(p_category_id uuid, p_city text, p_area text, p_event_start timestamp with time zone, p_event_end timestamp with time zone, p_intake jsonb, p_budget_min integer, p_budget_max integer, p_address_id uuid DEFAULT NULL::uuid, p_venue_text text DEFAULT NULL::text, p_provider_id uuid DEFAULT NULL::uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
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
begin
  select * into v_category from public.categories where id = p_category_id;
  perform public._assert(found and v_category.active and v_category.archetype = 'proposal', 'proposal category is not available');
  perform public._assert(p_event_start > now() and p_event_end > p_event_start, 'event window must be in the future');
  perform public._assert(p_event_start <= now() + interval '365 days', 'event is outside the booking window');
  perform public._assert(p_event_start >= now() + make_interval(hours => v_category.min_lead_hours),
    format('%s needs at least %s hours'' notice. Choose a later date.', v_category.name, v_category.min_lead_hours));
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
    expires_at, target_provider_id
  ) values (
    v_uid, p_category_id, trim(p_city), coalesce(trim(p_area), ''), p_event_start, p_event_end,
    coalesce(p_intake, '{}'::jsonb), p_budget_min, p_budget_max, now() + interval '7 days', p_provider_id
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
    v_request.event_start >= now() + make_interval(hours => (select c.min_lead_hours from public.categories c where c.id = v_request.category_id)) - interval '5 minutes',
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
  perform public._assert(v_request.event_start >= now() + make_interval(hours => v_category.min_lead_hours) - interval '5 minutes',
    format('This event is less than %s hours away, so it can no longer be booked. Post a new request with a later date.', v_category.min_lead_hours));
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

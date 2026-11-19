-- WP C2; owns: create_service_request, send_proposal, accept_proposal (after F7), cancel_booking,
-- _cancel_booking_by_policy delivery-deadline branch, dispute_booking, submit_delivery screening;
-- sources: WS5-T02, WS5-T06, WS5-T07, WS5-T08, WS5-T09, WS5-T10, WS5-T11,
-- WS5-T12, WS5-T15, WS5-T16.

alter table public.proposals
  add column if not exists delivery_due_at timestamptz;

alter table public.bookings
  add column if not exists delivery_due_at timestamptz;

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values (
  'creator_delivery_deadline',
  false,
  'Creator delivery deadlines',
  'Off: the proposal deliver-by field is hidden and new deadline values are ignored. On: creators must set a valid deliver-by date.',
  'Creators',
  20
)
on conflict (key) do nothing;

-- D2 approves the one-round default; preserve any explicit administrator override.
update public.feature_flags
   set enabled = true
 where key = 'creator_revisions'
   and enabled = false
   and updated_by is null;

insert into public.app_config (key, value)
values
  ('creator', '{"default_revisions":1}'::jsonb),
  ('proposal', '{"max_advance_bp":2500}'::jsonb)
on conflict (key) do update
  set value = excluded.value || public.app_config.value,
      updated_at = now();

alter table public.bookings
  alter column revisions_allowed set default 1;

create or replace function public._set_proposal_revisions_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archetype text;
  v_qty int;
  v_default int := 1;
  v_config text;
begin
  select c.archetype into v_archetype
    from public.categories c
   where c.id = new.category_id;

  select c.value ->> 'default_revisions'
    into v_config
    from public.app_config c
   where c.key = 'creator';
  if v_config ~ '^(0|[1-9]|10)$' then
    v_default := v_config::int;
  end if;

  if v_archetype = 'proposal' then
    if jsonb_typeof(new.delivery_snapshot) = 'array' then
      select (item.value ->> 'qty')::int into v_qty
        from jsonb_array_elements(new.delivery_snapshot) as item(value)
       where item.value ->> 'type' = 'revisions'
         and item.value ->> 'qty' ~ '^(0|[1-9]|10)$'
       limit 1;
    end if;
    new.revisions_allowed := coalesce(v_qty, v_default);
  end if;
  return new;
end;
$$;

with creator_fields(slug, properties) as (
  values
    ('reel-maker', '{
      "count":{"type":"integer","title":"Number of deliverables","minimum":1,"maximum":100},
      "length_seconds":{"type":"integer","title":"Video length (seconds)","enum":[15,30,60,90]},
      "aspect_ratio":{"type":"string","title":"Aspect ratio","enum":["9:16","1:1","16:9"]},
      "captions":{"type":"boolean","title":"Captions included"},
      "music":{"type":"string","title":"Music","enum":["provider-licensed","customer-supplied","none"]},
      "footage_handover":{"type":"string","title":"Footage handover","enum":["drive-link","in-person","creator-shoots"]},
      "reference_links":{"type":"string","title":"Reference links"}
    }'::jsonb),
    ('ugc-creator', '{
      "count":{"type":"integer","title":"Number of deliverables","minimum":1,"maximum":100},
      "length_seconds":{"type":"integer","title":"Video length (seconds)","enum":[15,30,60,90]},
      "aspect_ratio":{"type":"string","title":"Aspect ratio","enum":["9:16","1:1","16:9"]},
      "captions":{"type":"boolean","title":"Captions included"},
      "music":{"type":"string","title":"Music","enum":["provider-licensed","customer-supplied","none"]},
      "footage_handover":{"type":"string","title":"Footage handover","enum":["drive-link","in-person","creator-shoots"]},
      "reference_links":{"type":"string","title":"Reference links"}
    }'::jsonb),
    ('product-photographer', '{
      "count":{"type":"integer","title":"Number of products","minimum":1,"maximum":100},
      "aspect_ratio":{"type":"string","title":"Image aspect ratio"},
      "reference_links":{"type":"string","title":"Reference links"}
    }'::jsonb),
    ('event-videographer', '{
      "count":{"type":"integer","title":"Number of deliverables","minimum":1,"maximum":100},
      "length_seconds":{"type":"integer","title":"Video length (seconds)","enum":[15,30,60,90]},
      "aspect_ratio":{"type":"string","title":"Aspect ratio","enum":["9:16","1:1","16:9"]},
      "captions":{"type":"boolean","title":"Captions included"},
      "music":{"type":"string","title":"Music","enum":["provider-licensed","customer-supplied","none"]},
      "footage_handover":{"type":"string","title":"Footage handover","enum":["drive-link","in-person","creator-shoots"]},
      "reference_links":{"type":"string","title":"Reference links"}
    }'::jsonb)
)
update public.categories c
   set intake_schema = jsonb_set(
     jsonb_set(
       coalesce(c.intake_schema, '{"type":"object"}'::jsonb),
       '{properties}',
       coalesce(c.intake_schema -> 'properties', '{}'::jsonb) || creator_fields.properties,
       true
     ),
     '{required}',
     coalesce(c.intake_schema -> 'required', '[]'::jsonb) || '["count","aspect_ratio"]'::jsonb,
     true
   )
  from creator_fields
 where c.slug = creator_fields.slug;

insert into public.archetype_transitions (archetype, from_status, to_status, actor)
values ('proposal', 'delivery_pending', 'cancelled', 'customer')
on conflict do nothing;

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
  p_lng double precision default null
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
  perform public._assert(
    not public._contains_contact_hint(coalesce(p_intake, '{}'::jsonb)::text),
    'Remove phone numbers, emails or payment handles from the brief'
  );
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
$$;

create or replace function public.get_creator_proposal_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_creator jsonb;
  v_proposal jsonb;
  v_default_revisions int := 1;
  v_max_advance_bp int := 2500;
  v_value text;
begin
  perform public._require_uid();
  select c.value into v_creator from public.app_config c where c.key = 'creator';
  v_value := v_creator ->> 'default_revisions';
  if v_value is not null then
    perform public._assert(v_value ~ '^(0|[1-9]|10)$', 'creator revision configuration is invalid');
    v_default_revisions := v_value::int;
  end if;
  select c.value into v_proposal from public.app_config c where c.key = 'proposal';
  v_value := v_proposal ->> 'max_advance_bp';
  if v_value is not null then
    perform public._assert(v_value ~ '^[0-9]+$', 'proposal advance configuration is invalid');
    v_max_advance_bp := v_value::int;
  end if;
  perform public._assert(v_max_advance_bp between 0 and 10000, 'proposal advance configuration is invalid');
  return jsonb_build_object(
    'default_revisions', v_default_revisions,
    'max_advance_bp', v_max_advance_bp
  );
end;
$$;

drop function public.send_proposal(uuid, jsonb, jsonb, timestamptz, text, jsonb);

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
  v_uid uuid := public._require_uid();
  v_request public.service_requests;
  v_recipient public.request_recipients;
  v_item jsonb;
  v_row jsonb;
  v_kind public.quote_item_kind;
  v_seq int;
  v_total int := 0;
  v_schedule_total int := 0;
  v_at_booking numeric := 0;
  v_version int;
  v_proposal uuid;
  v_due timestamptz;
  v_cancel jsonb := '{}'::jsonb;
  v_recipient_count int;
  v_delivery_due_at timestamptz;
  v_deadline_enabled boolean;
  v_revision_count int := 0;
  v_max_advance_bp int := 2500;
  v_advance_config text;
  v_advance_limit text;
begin
  select * into v_request from public.service_requests where id = p_request_id for update;
  perform public._assert(found and v_request.status = 'open', 'request is not open');
  perform public._assert(v_request.expires_at > now(), 'request expired');
  perform public._assert(
    v_request.event_start >= now() + public._proposal_notice(v_request) - interval '5 minutes',
    'This event is too soon to be booked, so a proposal can''t be accepted. Ask the customer for a later date.');
  v_deadline_enabled := public._feature_enabled('creator_delivery_deadline')
    and public._archetype_enabled('proposal');
  if v_deadline_enabled then
    perform public._assert(p_delivery_due_at is not null, 'deliver-by date is required');
    perform public._assert(p_delivery_due_at > now(), 'deliver-by date must be in the future');
    perform public._assert(
      p_delivery_due_at <= v_request.event_start + interval '365 days',
      'deliver-by date cannot be more than 365 days after the event'
    );
    v_delivery_due_at := p_delivery_due_at;
  else
    v_delivery_due_at := null;
  end if;

  select count(*) into v_recipient_count
    from public.request_recipients rr
   where rr.request_id = p_request_id and public._acts_for(rr.provider_id, 'manager');
  perform public._assert(v_recipient_count = 1, 'request must be routed to exactly one business you manage');
  select * into v_recipient from public.request_recipients
   where request_id = p_request_id and public._acts_for(provider_id, 'manager');
  perform public._assert(found, 'provider was not routed this request');

  p_valid_until := least(coalesce(p_valid_until, v_request.expires_at), v_request.expires_at);
  perform public._assert(p_valid_until > now() + interval '15 minutes', 'this request expires too soon for a new proposal');
  perform public._assert(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 30,
                         'proposal needs 1 to 30 items');
  perform public._assert(jsonb_typeof(p_schedule) = 'array' and jsonb_array_length(p_schedule) between 1 and 8,
                         'proposal needs 1 to 8 payment milestones');
  perform public._assert(jsonb_typeof(coalesce(p_deliverables, '[]'::jsonb)) = 'array', 'deliverables must be an array');
  perform public._assert(
    not public._contains_contact_hint(coalesce(p_note, '')),
    'Remove phone numbers, emails or payment handles from the proposal'
  );

  select c.value ->> 'max_advance_bp'
    into v_advance_config
    from public.app_config c
   where c.key = 'proposal';
  if v_advance_config is not null then
    perform public._assert(v_advance_config ~ '^[0-9]+$', 'proposal advance configuration is invalid');
    v_max_advance_bp := v_advance_config::int;
  end if;
  perform public._assert(v_max_advance_bp between 0 and 10000, 'proposal advance configuration is invalid');
  v_advance_limit := case
    when v_max_advance_bp % 100 = 0 then (v_max_advance_bp / 100)::text || '%'
    else round(v_max_advance_bp::numeric / 100, 2)::text || '%'
  end;

  for v_row in select value from jsonb_array_elements(coalesce(p_deliverables, '[]'::jsonb))
  loop
    if v_row ->> 'type' = 'revisions' then
      v_revision_count := v_revision_count + 1;
      perform public._assert(
        coalesce(v_row ->> 'qty', '') ~ '^(0|[1-9]|10)$',
        'revision quantity must be between 0 and 10'
      );
    end if;
    perform public._assert(
      not public._contains_contact_hint(coalesce(v_row ->> 'spec', '')),
      'Remove phone numbers, emails or payment handles from proposal deliverables'
    );
  end loop;
  perform public._assert(v_revision_count <= 1, 'proposal may include at most one revisions term');

  update public.proposals set status = 'withdrawn', updated_at = now()
   where request_id = p_request_id and provider_id = v_recipient.provider_id and status = 'sent';
  select coalesce(max(version), 0) + 1 into v_version from public.proposals
   where request_id = p_request_id and provider_id = v_recipient.provider_id;

  insert into public.proposals (
    request_id, provider_id, provider_service_id, version, total, valid_until, note, deliverables,
    cancellation_snapshot, delivery_due_at
  ) values (
    p_request_id, v_recipient.provider_id, v_recipient.provider_service_id, v_version, 1, p_valid_until,
    nullif(trim(coalesce(p_note, '')), ''), coalesce(p_deliverables, '[]'::jsonb), v_cancel,
    v_delivery_due_at
  ) returning id into v_proposal;

  for v_item, v_seq in
    select value, ordinality::int from jsonb_array_elements(p_items) with ordinality
  loop
    v_kind := (v_item ->> 'kind')::public.quote_item_kind;
    perform public._assert(v_kind <> 'discount', 'discount proposal items are not allowed');
    perform public._assert(coalesce(trim(v_item ->> 'title'), '') <> '', 'proposal item title is required');
    perform public._assert(
      not public._contains_contact_hint(coalesce(v_item ->> 'title', '')),
      'Remove phone numbers, emails or payment handles from proposal item titles'
    );
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
    if v_row ->> 'due_rule' = 'at_booking' then
      v_at_booking := v_at_booking + (v_row ->> 'amount')::numeric;
    end if;
    insert into public.proposal_schedule (proposal_id, seq, label, amount, due_rule, due_at)
    values (v_proposal, v_seq, trim(v_row ->> 'label'), (v_row ->> 'amount')::int, v_row ->> 'due_rule', v_due);
  end loop;
  perform public._assert(v_schedule_total = v_total, 'milestones must sum exactly to the proposal total');
  perform public._assert(
    v_at_booking * 10000 <= v_total::numeric * v_max_advance_bp,
    'Advance can be at most ' || v_advance_limit
  );

  update public.proposals
     set total = v_total,
         pricing_snapshot = jsonb_build_object(
           'version', v_version, 'total', v_total,
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
    v_request.customer_id, 'proposal_received', null, 'New proposal received',
    'A verified provider sent a proposal for your request.',
    jsonb_build_object('request_id', v_request.id, 'proposal_id', v_proposal),
    'proposal-received:' || v_request.id::text
  );
  return v_proposal;
end;
$$;

revoke all on function public.send_proposal(uuid, jsonb, jsonb, timestamptz, text, jsonb, timestamptz)
  from public, anon;
grant execute on function public.send_proposal(uuid, jsonb, jsonb, timestamptz, text, jsonb, timestamptz)
  to authenticated;

create or replace function public._cancel_booking_by_policy(
  p_booking_id uuid,
  p_actor text,
  p_reason text,
  p_note text,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_outcome jsonb;
  v_refunded int;
  v_provider int;
begin
  b := public._lock_booking(p_booking_id);
  perform public._assert(
    b.status::text in (
      'pending_payment', 'requested', 'accepted', 'confirmed', 'en_route',
      'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress',
      'completion_requested'
    ) or (
      b.archetype = 'proposal'
      and b.status = 'delivery_pending'
      and p_actor = 'customer'
      and p_reason = 'provider_fault'
      and b.delivery_due_at is not null
      and p_at > b.delivery_due_at + interval '48 hours'
    ),
    'booking can no longer be cancelled'
  );

  v_outcome := public._cancellation_outcome(b.id, p_actor, p_reason, p_at);
  update public.payments
     set status = 'failed', cancel_link_pending = true
   where booking_id = b.id and status = 'created';
  perform public._close_open_quotes(b.id);

  v_refunded := public._refund_partial(
    b.id, (v_outcome ->> 'refund_amount')::int, 'cancellation: ' || p_reason
  );
  perform public._assert(
    v_refunded = (v_outcome ->> 'refund_amount')::int,
    'refund exceeds refundable payments'
  );

  v_provider := (v_outcome ->> 'provider_compensation')::int;
  if v_provider > 0 then
    perform public._create_payout(
      b.id, v_provider, v_provider, (v_outcome ->> 'release_after')::timestamptz
    );
  end if;

  update public.bookings
     set cancelled_reason = p_note,
         refund_amount = refund_amount + v_refunded,
         cancellation_outcome = v_outcome
   where id = b.id;
  perform public._set_status(b.id, 'cancelled', case when p_actor = 'customer' then b.customer_id
                                                     when p_actor = 'provider' then b.provider_id end, p_note);
  return v_outcome;
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_now timestamptz := now();
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can cancel');
  if b.status = 'delivery_pending' then
    perform public._assert(
      b.archetype = 'proposal'
      and b.delivery_due_at is not null
      and v_now > b.delivery_due_at + interval '48 hours',
      'delivery is not overdue; raise a dispute or wait until the cancellation window opens'
    );
    perform public._cancel_booking_by_policy(
      b.id, 'customer', 'provider_fault',
      coalesce(nullif(trim(p_reason), ''), 'delivery deadline missed'), v_now
    );
  else
    perform public._cancel_booking_by_policy(
      b.id, 'customer', 'customer_choice', coalesce(nullif(trim(p_reason), ''), 'customer choice'), v_now
    );
  end if;
end;
$$;

create or replace function public.dispute_booking(p_booking_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_max_days int;
  v_closed_at timestamptz;
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can raise a dispute');
  perform public._assert(
    b.status::text in ('in_progress', 'delivery_pending', 'completion_requested', 'completed', 'closed'),
    'dispute not allowed in this state'
  );
  if b.status = 'closed' then
    select case
             when c.value ->> 'max_days_after_close' ~ '^[0-9]+$'
             then (c.value ->> 'max_days_after_close')::int
           end
      into v_max_days
      from public.app_config c
     where c.key = 'dispute_rules';
    perform public._assert(
      v_max_days between 1 and 3650,
      'closed-booking dispute window is not configured'
    );
    select max(e.at)
      into v_closed_at
      from public.booking_events e
     where e.booking_id = b.id and e.to_status = 'closed';
    perform public._assert(
      v_closed_at is not null
        and v_closed_at > now() - make_interval(days => v_max_days),
      'dispute window has expired'
    );
  end if;
  perform public._assert(coalesce(trim(p_reason), '') <> '', 'reason is required');
  perform 1 from public.payouts where booking_id = b.id for update;
  perform 1 from public.payout_transfers t
   where t.payout_id in (select id from public.payouts where booking_id = b.id) for update;
  update public.payouts set status = 'frozen' where booking_id = b.id and status = 'pending';
  update public.payout_transfers
     set status = 'failed', last_error = 'dispute: release frozen'
   where status = 'pending'
     and payout_id in (select id from public.payouts where booking_id = b.id);
  perform public._set_status(b.id, 'disputed', v_uid, p_reason);
end;
$$;

create or replace function public.submit_delivery(p_booking_id uuid, p_links jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_link jsonb;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can submit delivery');
  perform public._assert(b.archetype = 'proposal' and b.status = 'delivery_pending', 'delivery is not ready to submit');
  perform public._assert(b.delivery_status in ('pending', 'revision_requested'), 'delivery was already submitted');
  perform public._assert(jsonb_typeof(p_links) = 'array' and jsonb_array_length(p_links) between 1 and 20,
                         'submit 1 to 20 delivery links');
  for v_link in select value from jsonb_array_elements(p_links)
  loop
    perform public._assert(
      jsonb_typeof(v_link) = 'object'
      and coalesce(v_link ->> 'url', '') ~ '^https://[^[:space:]]+$',
      'every delivery item needs a full https URL'
    );
    perform public._assert(
      not public._contains_contact_hint(coalesce(v_link ->> 'title', '')),
      'Remove phone numbers, emails or payment handles from delivery titles'
    );
  end loop;
  update public.bookings
     set delivery_links = p_links, delivery_status = 'submitted', delivery_submitted_at = now(),
         completion_requested_at = now()
   where id = b.id;
  update public.payment_schedule
     set status = case when status = 'paid' then status else 'due' end,
         due_at = coalesce(due_at, now())
   where booking_id = b.id and due_rule = 'on_delivery';
  perform public._set_status(b.id, 'completion_requested', v_uid, 'deliverables submitted');
  perform public._queue_notification(
    b.customer_id, 'delivery_submitted', b.id, 'Your deliverables are ready',
    'Review the delivery and pay any final milestone to complete the booking.',
    jsonb_build_object('booking_id', b.id), 'delivery:' || b.id::text
  );
end;
$$;

revoke all on function public.get_creator_proposal_config() from public, anon;
grant execute on function public.get_creator_proposal_config() to authenticated;

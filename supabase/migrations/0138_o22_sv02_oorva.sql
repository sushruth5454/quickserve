-- O22-SV02: keep itemized quote RPCs on the inspect/BYO contract and fixed
-- package changes on the package-specific add-on and approval RPCs.

create or replace function public.send_quote(p_booking_id uuid, p_items jsonb, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_request public.travel_requests;
  v_item jsonb;
  v_kind public.quote_item_kind;
  v_qty numeric;
  v_price int;
  v_line int;
  v_labour int := 0;
  v_parts int := 0;
  v_other int := 0;
  v_travel int := 0;
  v_commissionable int := 0;
  v_version int;
  v_quote uuid;
begin
  perform public._assert(public._acts_for(b.provider_id, 'manager'), 'manager role required to send quotes');
  perform public._assert(
    b.booking_origin = 'byo'
    or (b.booking_origin = 'marketplace' and b.archetype = 'inspect_quote'),
    'itemized quotes are not supported for this booking'
  );
  perform public._assert(b.status in ('inspecting', 'quote_sent', 'in_progress'), 'quote not allowed in this state');
  perform public._assert(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 30,
                         'quote needs 1 to 30 items');
  perform public._assert(not exists (
    select 1 from jsonb_array_elements(p_items) item
    where coalesce(item ->> 'travel_request_id', '') <> ''
  ), 'travel fee lines are managed automatically');

  if b.travel_request_id is not null then
    select r.* into v_request from public.travel_requests r where r.id = b.travel_request_id;
    perform public._assert(found and v_request.status = 'used', 'travel request is not attached to this booking');
    v_travel := v_request.quoted_fee;
    v_other := v_travel;
    v_commissionable := v_travel;
  end if;

  perform public._close_open_quotes(b.id);
  select coalesce(max(version), 0) + 1 into v_version from public.quotes where booking_id = b.id;
  insert into public.quotes (booking_id, version, total, note, is_change_order)
  values (b.id, v_version, 0, p_note, b.status = 'in_progress')
  returning id into v_quote;

  if b.travel_request_id is not null then
    insert into public.quote_items (quote_id, kind, title, qty, unit_price, travel_request_id)
    values (v_quote, 'travel', 'Travel fee (' || v_request.distance_km || ' km)', 1, v_travel, v_request.id);
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind := (v_item ->> 'kind')::public.quote_item_kind;
    perform public._assert(v_kind in ('labour', 'part', 'other'), 'quote item kind is not allowed');
    v_qty := (v_item ->> 'qty')::numeric;
    v_price := (v_item ->> 'unit_price')::int;
    perform public._assert(coalesce(trim(v_item ->> 'title'), '') <> '', 'item title is required');
    perform public._assert(v_qty > 0 and v_qty <= 1000, 'invalid quantity');
    perform public._assert(v_price >= 0 and v_price <= 10000000, 'invalid unit price');
    v_line := round(v_qty * v_price);
    if v_kind = 'part' and v_line > 50000 then
      perform public._assert(
        nullif(trim(v_item ->> 'bill_photo_url'), '') is not null,
        'parts above ₹500 need a bill photo'
      );
    end if;
    case v_kind
      when 'labour' then v_labour := v_labour + v_line;
      when 'part' then v_parts := v_parts + v_line;
      else v_other := v_other + v_line;
    end case;
    if public._commissionable(v_kind) then
      v_commissionable := v_commissionable + v_line;
    end if;
    insert into public.quote_items (quote_id, kind, title, qty, unit_price, bill_photo_url)
    values (v_quote, v_kind, trim(v_item ->> 'title'), v_qty, v_price, nullif(v_item ->> 'bill_photo_url', ''));
  end loop;

  update public.quotes
     set subtotal_labour = v_labour, subtotal_parts = v_parts, subtotal_other = v_other,
         subtotal_travel = v_travel, subtotal_commissionable = v_commissionable,
         total = v_labour + v_parts + v_other
   where id = v_quote;

  if b.status = 'inspecting' then
    perform public._set_status(b.id, 'quote_sent', v_uid, 'quote v' || v_version);
  else
    perform public._log_event(b.id, v_uid,
      case when b.status = 'in_progress' then 'change order v' else 'quote v' end || v_version);
  end if;
  return v_quote;
end;
$$;

create or replace function public.approve_quote(p_booking_id uuid, p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  v_initial boolean;
  v_due int;
  v_refunded int;
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can approve');
  select * into q from public.quotes where id = p_quote_id and booking_id = b.id for update;
  perform public._assert(found and q.status = 'sent', 'quote is not open');
  perform public._assert(
    q.quote_type = 'itemized'
    and (b.booking_origin = 'byo'
      or (b.booking_origin = 'marketplace' and b.archetype = 'inspect_quote')),
    'itemized quote approval is not supported for this booking'
  );
  v_initial := b.status = 'quote_sent' and b.approved_quote_id is null;
  perform public._assert(v_initial or (b.status = 'in_progress' and b.approved_quote_id is not null),
                         'quote cannot be approved in this state');

  v_due := public._required_total(q.total, b.visit_fee, b.platform_fee) - public._net_paid(b.id);
  if v_due > 0 then
    update public.quotes set status = 'approved_pending_payment' where id = q.id;
    if v_initial then
      perform public._set_status(b.id, 'awaiting_payment', v_uid, 'quote v' || q.version || ' approved, due ' || v_due);
    else
      perform public._log_event(b.id, v_uid, 'change order v' || q.version || ' approved, due ' || v_due);
    end if;
  else
    perform public._activate_quote(b.id, q.id);
    if v_initial then
      perform public._set_status(b.id, 'in_progress', v_uid, 'quote v' || q.version || ' approved');
    else
      v_refunded := 0;
      if v_due < 0 then
        v_refunded := public._refund_partial(b.id, -v_due, 'change order reduced the total');
        update public.bookings set refund_amount = refund_amount + v_refunded where id = b.id;
      end if;
      perform public._log_event(b.id, v_uid, 'change order v' || q.version || ' approved'
        || case when v_refunded > 0 then ', refund ' || v_refunded else '' end);
    end if;
  end if;
  return jsonb_build_object('amount_due', greatest(v_due, 0));
end;
$$;

create or replace function public.approve_quote_with_coins(
  p_booking_id uuid,
  p_quote_id uuid,
  p_use_coins boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  v_initial boolean;
  v_coins int;
  v_result jsonb;
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can approve');
  select * into q from public.quotes where id = p_quote_id and booking_id = b.id for update;
  perform public._assert(found and q.status = 'sent', 'quote is not open');
  perform public._assert(
    q.quote_type = 'itemized'
    and (b.booking_origin = 'byo'
      or (b.booking_origin = 'marketplace' and b.archetype = 'inspect_quote')),
    'itemized quote approval is not supported for this booking'
  );
  v_initial := b.status = 'quote_sent' and b.approved_quote_id is null;
  perform public._assert(v_initial or (b.status = 'in_progress' and b.approved_quote_id is not null),
                         'quote cannot be approved in this state');

  v_coins := public._apply_quote_coins(p_booking_id, p_quote_id, coalesce(p_use_coins, false));
  v_result := public.approve_quote(p_booking_id, p_quote_id);
  return v_result || jsonb_build_object('coins_redeemed_paise', v_coins);
end;
$$;

create or replace function public.reject_quote(p_booking_id uuid, p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can reject');
  select * into q from public.quotes where id = p_quote_id and booking_id = b.id for update;
  perform public._assert(found and q.status = 'sent', 'quote is not open');
  perform public._assert(
    q.quote_type = 'itemized'
    and (b.booking_origin = 'byo'
      or (b.booking_origin = 'marketplace' and b.archetype = 'inspect_quote')),
    'itemized quote rejection is not supported for this booking'
  );
  update public.quotes set status = 'rejected' where id = q.id;

  if b.status = 'quote_sent' and b.approved_quote_id is null then
    perform public._create_payout(b.id, b.visit_fee, b.visit_fee, now() + interval '24 hours');
    perform public._set_status(b.id, 'closed_no_work', v_uid, 'quote v' || q.version || ' rejected');
  else
    perform public._log_event(b.id, v_uid, 'change order v' || q.version || ' rejected');
  end if;
end;
$$;

create or replace function public.send_fixed_addons(
  p_booking_id uuid,
  p_addons jsonb,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  qi record;
  v_item jsonb;
  v_quote uuid;
  v_version int;
  v_addon_total int := 0;
  v_commissionable int;
begin
  perform public._assert(public._acts_for(b.provider_id, 'manager'), 'manager role required to send quotes');
  perform public._assert(b.booking_origin = 'marketplace', 'fixed add-ons are not supported for BYO bookings');
  perform public._assert(b.archetype = 'fixed' and b.status = 'in_progress', 'add-ons are allowed only during fixed service');
  perform public._assert(jsonb_typeof(p_addons) = 'array' and jsonb_array_length(p_addons) between 1 and 20, '1 to 20 add-ons are required');
  select * into q from public.quotes where id = b.approved_quote_id for update;
  perform public._assert(q.id is not null and q.status = 'approved' and q.quote_type = 'package', 'approved package quote not found');
  perform public._assert(not exists (
    select 1
      from public.quotes pending
     where pending.booking_id = b.id
       and pending.status = 'approved_pending_payment'
       and pending.is_change_order
       and pending.quote_type = 'package'
  ), 'resolve the pending fixed add-on payment before sending another add-on');

  for v_item in select value from jsonb_array_elements(p_addons) loop
    perform public._assert(
      char_length(trim(coalesce(v_item ->> 'title', ''))) between 2 and 160,
      'add-on title is required'
    );
    perform public._assert(
      coalesce((v_item ->> 'qty')::numeric, 0) > 0
      and coalesce((v_item ->> 'qty')::numeric, 0) <= 100
      and coalesce((v_item ->> 'unit_price')::int, -1) > 0
      and coalesce((v_item ->> 'unit_price')::int, 0) <= 10000000,
      'invalid add-on quantity or price'
    );
    v_addon_total := v_addon_total
      + round((v_item ->> 'qty')::numeric * (v_item ->> 'unit_price')::int)::int;
  end loop;

  v_commissionable := case
    when q.subtotal_commissionable > 0 then q.subtotal_commissionable
    else public._legacy_fixed_commissionable(q.id)
  end + v_addon_total;
  update public.bookings
     set commission_bp_snapshot = coalesce(
       commission_bp_snapshot, public._booking_commission_bp(b.id, now())
     )
   where id = b.id;
  perform public._close_open_quotes(b.id);
  select coalesce(max(version), 0) + 1 into v_version from public.quotes where booking_id = b.id;
  insert into public.quotes (
    booking_id, version, status, is_change_order, subtotal_labour, subtotal_parts,
    subtotal_other, subtotal_commissionable, total, note, quote_type, source_package_id, package_snapshot
  ) values (
    b.id, v_version, 'sent', true, q.subtotal_labour, q.subtotal_parts,
    q.subtotal_other + v_addon_total, v_commissionable, q.total + v_addon_total,
    nullif(trim(p_note), ''), 'package', q.source_package_id, q.package_snapshot
  ) returning id into v_quote;

  for qi in select * from public.quote_items where quote_id = q.id order by id loop
    insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price, bill_photo_url)
    values (
      v_quote,
      case
        when qi.kind = 'other'
         and q.quote_type = 'package'
         and qi.title = q.package_snapshot ->> 'title'
         and round(qi.qty * qi.unit_price)::int =
           round((q.package_snapshot ->> 'unit_price')::numeric
             * (q.package_snapshot ->> 'quantity')::numeric)::int
        then 'package'::public.quote_item_kind else qi.kind end,
      qi.title, qi.qty, qi.unit, qi.unit_price, qi.bill_photo_url
    );
  end loop;
  for v_item in select value from jsonb_array_elements(p_addons) loop
    insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price)
    values (
      v_quote, 'addon', trim(v_item ->> 'title'), (v_item ->> 'qty')::numeric,
      nullif(trim(v_item ->> 'unit'), ''), (v_item ->> 'unit_price')::int
    );
  end loop;
  perform public._log_event(b.id, v_uid, 'fixed add-on change order v' || v_version);
  return v_quote;
end;
$$;

create or replace function public.approve_fixed_change_order(
  p_booking_id uuid,
  p_quote_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  v_target int;
  v_delta int;
  v_refund int := 0;
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can approve');
  perform public._assert(b.booking_origin = 'marketplace', 'fixed change orders are not supported for BYO bookings');
  perform public._assert(b.archetype = 'fixed' and b.status = 'in_progress', 'change order is not open');
  select * into q from public.quotes where id = p_quote_id and booking_id = b.id for update;
  perform public._assert(q.id is not null and q.status = 'sent' and q.quote_type = 'package' and q.is_change_order, 'fixed change order not found');

  v_target := public._required_total(q.total, b.visit_fee, b.platform_fee);
  v_delta := v_target - public._net_paid(b.id);
  if v_delta > 0 then
    update public.quotes set status = 'approved_pending_payment' where id = q.id;
    insert into public.payment_schedule (
      booking_id, quote_id, seq, obligation_type, label, amount, due_rule, due_at, status
    )
    select b.id, q.id, coalesce(max(seq), 0) + 1, 'addon', 'Add-on payment',
           v_delta, 'on_quote_approval', now(), 'due'
      from public.payment_schedule
     where booking_id = b.id;
  else
    perform public._activate_quote(b.id, q.id);
    if v_delta < 0 then
      v_refund := public._refund_partial(b.id, -v_delta, 'fixed package change order reduced the total');
      update public.bookings set refund_amount = refund_amount + v_refund where id = b.id;
    end if;
  end if;
  perform public._log_event(b.id, v_uid, 'fixed add-on v' || q.version || ' approved, due ' || greatest(v_delta, 0));
  return jsonb_build_object('amount_due', greatest(v_delta, 0), 'refund', v_refund, 'quote_id', q.id);
end;
$$;

-- WP R1; owns: create_booking_v2, create_service_request_v2, create_rfq_v2, function grants, storage.buckets, ai_monthly_usage_cost; sources: WS8-T05, WS8-T06, WS8-T07, WS8-T12, WS8-T13

alter table public.bookings add column idempotency_key text;
create unique index bookings_customer_idempotency_idx
  on public.bookings (customer_id, idempotency_key)
  where idempotency_key is not null;

alter table public.service_requests add column idempotency_key text;
create unique index service_requests_customer_idempotency_idx
  on public.service_requests (customer_id, idempotency_key)
  where idempotency_key is not null;

alter table public.rfqs add column idempotency_key text;
create unique index rfqs_customer_idempotency_idx
  on public.rfqs (customer_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.create_booking_v2(
  p_provider_service_id uuid,
  p_description text,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision,
  p_scheduled_at timestamptz default null,
  p_photos text[] default '{}',
  p_travel_request_id uuid default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_key text;
  v_existing uuid;
  v_booking uuid;
begin
  if p_idempotency_key is not null then
    v_key := btrim(p_idempotency_key);
    perform public._assert(char_length(v_key) between 1 and 200, 'idempotency key must be 1 to 200 characters');
    perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || v_key));
    select b.id into v_existing
      from public.bookings b
     where b.customer_id = v_uid and b.idempotency_key = v_key;
    if found then
      return v_existing;
    end if;
  end if;

  v_booking := public.create_booking(
    p_provider_service_id, p_description, p_address_line, p_city,
    p_lat, p_lng, p_scheduled_at, p_photos, p_travel_request_id
  );
  if v_key is not null then
    update public.bookings b
       set idempotency_key = v_key
     where b.id = v_booking and b.customer_id = v_uid;
  end if;
  return v_booking;
end;
$$;

create or replace function public.create_service_request_v2(
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
  p_urgent boolean default false,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_key text;
  v_existing uuid;
  v_request uuid;
begin
  if p_idempotency_key is not null then
    v_key := btrim(p_idempotency_key);
    perform public._assert(char_length(v_key) between 1 and 200, 'idempotency key must be 1 to 200 characters');
    perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || v_key));
    select r.id into v_existing
      from public.service_requests r
     where r.customer_id = v_uid and r.idempotency_key = v_key;
    if found then
      return v_existing;
    end if;
  end if;

  v_request := public.create_service_request(
    p_category_id, p_city, p_area, p_event_start, p_event_end, p_intake,
    p_budget_min, p_budget_max, p_address_id, p_venue_text, p_provider_id,
    p_lat, p_lng, p_urgent
  );
  if v_key is not null then
    update public.service_requests r
       set idempotency_key = v_key
     where r.id = v_request and r.customer_id = v_uid;
  end if;
  return v_request;
end;
$$;

create or replace function public.create_rfq_v2(
  p_category_id uuid,
  p_title text,
  p_items jsonb,
  p_city text,
  p_area text,
  p_lat double precision,
  p_lng double precision,
  p_needs_delivery boolean,
  p_needed_by date,
  p_notes text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_key text;
  v_existing uuid;
  v_rfq uuid;
begin
  if p_idempotency_key is not null then
    v_key := btrim(p_idempotency_key);
    perform public._assert(char_length(v_key) between 1 and 200, 'idempotency key must be 1 to 200 characters');
    perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || v_key));
    select r.id into v_existing
      from public.rfqs r
     where r.customer_id = v_uid and r.idempotency_key = v_key;
    if found then
      return v_existing;
    end if;
  end if;

  v_rfq := public.create_rfq(
    p_category_id, p_title, p_items, p_city, p_area, p_lat, p_lng,
    p_needs_delivery, p_needed_by, p_notes
  );
  if v_key is not null then
    update public.rfqs r
       set idempotency_key = v_key
     where r.id = v_rfq and r.customer_id = v_uid;
  end if;
  return v_rfq;
end;
$$;

revoke execute on function public.create_booking_v2(uuid, text, text, text, double precision, double precision, timestamptz, text[], uuid, text),
  public.create_service_request_v2(uuid, text, text, timestamptz, timestamptz, jsonb, int, int, uuid, text, uuid, double precision, double precision, boolean, text),
  public.create_rfq_v2(uuid, text, jsonb, text, text, double precision, double precision, boolean, date, text, text)
from public, anon;
grant execute on function public.create_booking_v2(uuid, text, text, text, double precision, double precision, timestamptz, text[], uuid, text),
  public.create_service_request_v2(uuid, text, text, timestamptz, timestamptz, jsonb, int, int, uuid, text, uuid, double precision, double precision, boolean, text),
  public.create_rfq_v2(uuid, text, jsonb, text, text, double precision, double precision, boolean, date, text, text)
to authenticated;

revoke execute on function public.route_service_request(uuid, int),
  public.process_proposal_milestones(),
  public._proposal_public_intake(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.route_service_request(uuid, int),
  public.process_proposal_milestones(),
  public._proposal_public_intake(uuid, jsonb)
to service_role;

revoke execute on function public.cancel_session_booking(uuid, text),
  public.cancel_session_pack(uuid, text),
  public.confirm_session_completion(uuid),
  public.complete_session_booking(uuid, text),
  public.create_session_booking(uuid, uuid, timestamptz, int, text, text, double precision, double precision, text, uuid),
  public.decline_session_booking(uuid, text),
  public.extend_session_pack(uuid),
  public.purchase_session_pack(uuid, int),
  public.request_session_completion(uuid),
  public.start_session_booking(uuid, text),
  public.provider_cancel_booking(uuid, text, text),
  public.submit_review(uuid, int, int, int, int, int, text, text[]),
  public.can_read_request_private(uuid)
from public, anon;

revoke update (role_customer, role_provider) on public.profiles from authenticated;

update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = '{image/jpeg,image/png,image/webp}'
 where id in ('job-photos', 'dispute-photos');

create or replace function public.ai_monthly_usage_cost(p_month_start timestamptz)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role only';
  end if;
  if p_month_start is null then
    raise exception 'month start is required';
  end if;
  return (
    select coalesce(sum(u.cost_micros_usd), 0)::bigint
      from public.ai_usage u
     where u.created_at >= p_month_start
       and u.cost_micros_usd is not null
  );
end;
$$;

revoke all on function public.ai_monthly_usage_cost(timestamptz) from public, anon, authenticated;
grant execute on function public.ai_monthly_usage_cost(timestamptz) to service_role;

-- Proposal / milestone booking engine (docs/07 Phase 3, contracts C6-C10).
-- All amounts are integer paise. Clients only mutate proposal state through the
-- security-definer RPCs below; request and booking payment state is never directly writable.

alter type public.booking_status add value if not exists 'confirmed';
alter type public.booking_status add value if not exists 'delivery_pending';
alter type public.quote_item_kind add value if not exists 'material';
alter type public.quote_item_kind add value if not exists 'package';
alter type public.quote_item_kind add value if not exists 'per_unit';
alter type public.quote_item_kind add value if not exists 'travel';
alter type public.quote_item_kind add value if not exists 'rental';
alter type public.quote_item_kind add value if not exists 'discount';
alter type public.quote_item_kind add value if not exists 'addon';
alter type public.payment_purpose add value if not exists 'advance';
alter type public.payment_purpose add value if not exists 'milestone';
alter type public.payment_purpose add value if not exists 'final';
alter type public.payment_purpose add value if not exists 'platform_fee';
alter type public.payment_purpose add value if not exists 'package';
alter type public.payment_purpose add value if not exists 'addon';
alter type public.payment_purpose add value if not exists 'session';

-- 0018 owns the category/snapshot foundation. These idempotent additions keep 0020
-- safe to rebase over that migration while making the ownership of proposal fields explicit.
alter table public.categories
  add column if not exists archetype text not null default 'inspect_quote',
  add column if not exists intake_schema jsonb not null default '{"type":"object","properties":{}}'::jsonb,
  add column if not exists payment_template text not null default 'visit_then_balance',
  add column if not exists cancellation_policy text not null default 'standard_visit',
  add column if not exists config_version int not null default 1,
  add column if not exists deliverable_acceptance_hours int not null default 168;

alter table public.bookings
  add column if not exists service_request_id uuid,
  add column if not exists proposal_id uuid,
  add column if not exists archetype text not null default 'inspect_quote',
  add column if not exists category_config_version int not null default 1,
  add column if not exists pricing_snapshot jsonb,
  add column if not exists payment_template_snapshot jsonb,
  add column if not exists cancellation_snapshot jsonb,
  add column if not exists platform_fee_rule_snapshot jsonb,
  add column if not exists payment_hold_expires_at timestamptz,
  add column if not exists delivery_status text not null default 'not_applicable',
  add column if not exists delivery_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists delivery_links jsonb not null default '[]'::jsonb,
  add column if not exists delivery_submitted_at timestamptz,
  add column if not exists delivery_accepted_at timestamptz;

alter table public.quote_items
  add column if not exists unit text,
  add column if not exists target_item_id uuid;

alter table public.payments
  add column if not exists schedule_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.bookings'::regclass and conname = 'bookings_delivery_status_check'
  ) then
    alter table public.bookings add constraint bookings_delivery_status_check check (
      delivery_status in ('not_applicable', 'pending', 'submitted', 'accepted')
    );
  end if;
end;
$$;

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid not null references public.categories (id),
  city text not null check (char_length(trim(city)) between 2 and 120),
  area text not null default '',
  event_start timestamptz not null,
  event_end timestamptz not null,
  intake jsonb not null default '{}'::jsonb,
  budget_min int check (budget_min is null or budget_min >= 0),
  budget_max int check (budget_max is null or budget_max >= 0),
  status text not null default 'open' check (status in ('open', 'closed', 'booked', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (event_end > event_start),
  check (budget_min is null or budget_max is null or budget_min <= budget_max)
);
create index if not exists service_requests_customer_idx on public.service_requests (customer_id, created_at desc);
create index if not exists service_requests_open_idx on public.service_requests (category_id, city, event_start) where status = 'open';

create table if not exists public.request_private (
  request_id uuid primary key references public.service_requests (id) on delete cascade,
  address_id uuid references public.addresses (id),
  venue_text text check (venue_text is null or char_length(venue_text) between 3 and 1000),
  contact_name text,
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  created_at timestamptz not null default now()
);

create table if not exists public.request_recipients (
  request_id uuid not null references public.service_requests (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  provider_service_id uuid not null references public.provider_services (id) on delete cascade,
  routed_at timestamptz not null default now(),
  primary key (request_id, provider_id)
);
create unique index if not exists request_recipients_request_service_idx
  on public.request_recipients (request_id, provider_service_id);

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests (id) on delete cascade,
  provider_id uuid not null references public.providers (id),
  provider_service_id uuid not null references public.provider_services (id),
  version int not null check (version > 0),
  status text not null default 'sent' check (status in ('sent', 'withdrawn', 'accepted', 'rejected', 'expired')),
  total int not null check (total > 0),
  valid_until timestamptz not null,
  note text check (note is null or char_length(note) <= 2000),
  deliverables jsonb not null default '[]'::jsonb,
  pricing_snapshot jsonb not null default '{}'::jsonb,
  payment_snapshot jsonb not null default '{}'::jsonb,
  cancellation_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, provider_id, version)
);
create unique index if not exists proposals_one_active_provider_idx
  on public.proposals (request_id, provider_id) where status = 'sent';
create index if not exists proposals_request_idx on public.proposals (request_id, created_at desc);

create table if not exists public.proposal_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  seq int not null check (seq > 0),
  kind public.quote_item_kind not null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  qty numeric(10, 2) not null check (qty > 0 and qty <= 1000),
  unit text,
  unit_price int not null check (unit_price >= 0 and unit_price <= 100000000),
  bill_photo_url text,
  metadata jsonb not null default '{}'::jsonb,
  unique (proposal_id, seq)
);
create index if not exists proposal_items_proposal_idx on public.proposal_items (proposal_id, seq);

create table if not exists public.proposal_schedule (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  seq int not null check (seq > 0),
  label text not null check (char_length(trim(label)) between 1 and 100),
  amount int not null check (amount > 0),
  due_rule text not null check (
    due_rule in ('at_booking', 'days_before_start:1', 'days_before_start:7', 'on_completion', 'on_delivery')
  ),
  due_at timestamptz,
  unique (proposal_id, seq)
);
create index if not exists proposal_schedule_proposal_idx on public.proposal_schedule (proposal_id, seq);

create table if not exists public.payment_schedule (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  seq int not null check (seq >= 0),
  label text not null,
  amount int not null check (amount > 0),
  due_rule text not null check (
    due_rule in ('at_booking', 'on_quote_approval', 'days_before_start:1', 'days_before_start:7', 'on_completion', 'on_delivery')
  ),
  due_at timestamptz,
  status text not null default 'upcoming' check (status in ('upcoming', 'due', 'paid', 'waived', 'refunded')),
  purpose text not null default 'milestone' check (
    purpose in ('advance', 'milestone', 'final', 'platform_fee', 'package', 'addon', 'session')
  ),
  obligation_kind text not null default 'service' check (obligation_kind in ('service', 'platform_fee')),
  proposal_schedule_id uuid references public.proposal_schedule (id),
  payment_id uuid references public.payments (id),
  reminded_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (booking_id, seq)
);
create index if not exists payment_schedule_due_idx
  on public.payment_schedule (due_at, created_at) where status = 'upcoming';
create index if not exists payment_schedule_booking_idx on public.payment_schedule (booking_id, seq);

alter table public.payment_schedule
  add column if not exists purpose text not null default 'milestone',
  add column if not exists obligation_kind text not null default 'service',
  add column if not exists proposal_schedule_id uuid references public.proposal_schedule (id),
  add column if not exists reminded_at timestamptz,
  add column if not exists paid_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.bookings'::regclass and conname = 'bookings_service_request_fk'
  ) then
    alter table public.bookings
      add constraint bookings_service_request_fk foreign key (service_request_id) references public.service_requests (id);
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.bookings'::regclass and conname = 'bookings_proposal_fk'
  ) then
    alter table public.bookings
      add constraint bookings_proposal_fk foreign key (proposal_id) references public.proposals (id);
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.payments'::regclass and conname = 'payments_schedule_fk'
  ) then
    alter table public.payments
      add constraint payments_schedule_fk foreign key (schedule_id) references public.payment_schedule (id);
  end if;
end;
$$;

create unique index if not exists bookings_one_active_proposal_request_idx
  on public.bookings (service_request_id)
  where service_request_id is not null
    and status in ('pending_payment'::public.booking_status, 'confirmed'::public.booking_status,
                   'accepted'::public.booking_status, 'en_route'::public.booking_status,
                   'in_progress'::public.booking_status, 'delivery_pending'::public.booking_status,
                   'completion_requested'::public.booking_status, 'disputed'::public.booking_status);

create or replace function public._freeze_proposal_booking_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.archetype = 'proposal' and (
    new.proposal_id is distinct from old.proposal_id
    or new.category_config_version is distinct from old.category_config_version
    or new.pricing_snapshot is distinct from old.pricing_snapshot
    or new.payment_template_snapshot is distinct from old.payment_template_snapshot
    or new.cancellation_snapshot is distinct from old.cancellation_snapshot
    or new.platform_fee_rule_snapshot is distinct from old.platform_fee_rule_snapshot
    or new.delivery_snapshot is distinct from old.delivery_snapshot
  ) then
    raise exception 'proposal booking snapshots are immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_freeze_proposal_snapshot on public.bookings;
create trigger bookings_freeze_proposal_snapshot
  before update on public.bookings
  for each row execute function public._freeze_proposal_booking_snapshot();

create table if not exists public.request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists request_messages_thread_idx
  on public.request_messages (request_id, provider_id, created_at);

create or replace function public._proposal_public_intake(p_category_id uuid, p_intake jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_schema jsonb;
  v_public jsonb := coalesce(p_intake, '{}'::jsonb);
  v_key text;
  v_spec jsonb;
begin
  select intake_schema into v_schema from public.categories where id = p_category_id;
  for v_key, v_spec in select key, value from jsonb_each(coalesce(v_schema -> 'properties', '{}'::jsonb))
  loop
    if coalesce((v_spec ->> 'x-private')::boolean, false) then
      v_public := v_public - v_key;
    end if;
  end loop;
  return v_public;
end;
$$;

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
    rr.routed_at
  from public.request_recipients rr
  join public.service_requests r on r.id = rr.request_id
  join public.categories c on c.id = r.category_id
  where rr.provider_id = auth.uid()
    and r.status in ('open', 'closed', 'booked');

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
  p_venue_text text default null
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
begin
  select * into v_category from public.categories where id = p_category_id;
  perform public._assert(found and v_category.active and v_category.archetype = 'proposal', 'proposal category is not available');
  perform public._assert(p_event_start > now() and p_event_end > p_event_start, 'event window must be in the future');
  perform public._assert(p_event_start <= now() + interval '365 days', 'event is outside the booking window');
  perform public._assert(coalesce(trim(p_city), '') <> '', 'city is required');
  perform public._assert(jsonb_typeof(coalesce(p_intake, '{}'::jsonb)) = 'object', 'intake must be an object');
  perform public._assert(p_budget_min is null or p_budget_max is null or p_budget_min <= p_budget_max, 'budget range is invalid');
  perform public._assert(p_address_id is not null or coalesce(trim(p_venue_text), '') <> '', 'venue or address is required');

  if p_address_id is not null then
    select * into v_address from public.addresses where id = p_address_id for share;
    perform public._assert(found and v_address.user_id = v_uid, 'address belongs to another customer');
  end if;

  insert into public.service_requests (
    customer_id, category_id, city, area, event_start, event_end, intake, budget_min, budget_max,
    expires_at
  ) values (
    v_uid, p_category_id, trim(p_city), coalesce(trim(p_area), ''), p_event_start, p_event_end,
    coalesce(p_intake, '{}'::jsonb), p_budget_min, p_budget_max, now() + interval '7 days'
  ) returning id into v_request;

  insert into public.request_private (
    request_id, address_id, venue_text, contact_name, lat, lng
  ) values (
    v_request, p_address_id, nullif(trim(coalesce(p_venue_text, '')), ''),
    null, v_address.lat, v_address.lng
  );

  perform public.route_service_request(v_request, 8);
  return v_request;
end;
$$;

create or replace function public.cancel_service_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_request public.service_requests;
begin
  select * into v_request from public.service_requests where id = p_request_id for update;
  perform public._assert(found and v_request.customer_id = v_uid, 'only the customer can cancel this request');
  perform public._assert(v_request.status in ('open', 'closed'), 'request cannot be cancelled');
  update public.service_requests set status = 'cancelled', updated_at = now() where id = p_request_id;
  update public.proposals set status = 'rejected', updated_at = now()
   where request_id = p_request_id and status = 'sent';
end;
$$;

create or replace function public.send_proposal(
  p_request_id uuid,
  p_items jsonb,
  p_schedule jsonb,
  p_valid_until timestamptz,
  p_note text default null,
  p_deliverables jsonb default '[]'::jsonb
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
  v_version int;
  v_proposal uuid;
  v_due timestamptz;
  v_cancel jsonb := '{}'::jsonb;
begin
  select * into v_request from public.service_requests where id = p_request_id for update;
  perform public._assert(found and v_request.status = 'open', 'request is not open');
  perform public._assert(v_request.expires_at > now(), 'request expired');
  select * into v_recipient from public.request_recipients
   where request_id = p_request_id and provider_id = v_uid;
  perform public._assert(found, 'provider was not routed this request');
  perform public._assert(p_valid_until > now() and p_valid_until <= v_request.expires_at
                         and p_valid_until > now() + interval '15 minutes', 'proposal validity is invalid');
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
    request_id, provider_id, provider_service_id, version, valid_until, note, deliverables,
    cancellation_snapshot
  )
  values (
    p_request_id, v_uid, v_recipient.provider_service_id, v_version, p_valid_until,
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
$$;

create or replace function public.withdraw_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_proposal public.proposals;
begin
  select * into v_proposal from public.proposals where id = p_proposal_id for update;
  perform public._assert(found and v_proposal.provider_id = v_uid, 'only the provider can withdraw this proposal');
  perform public._assert(v_proposal.status = 'sent', 'proposal is not open');
  update public.proposals set status = 'withdrawn', updated_at = now() where id = p_proposal_id;
end;
$$;

create or replace function public.accept_proposal(p_proposal_id uuid, p_address_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
  perform public._assert(v_request.status = 'open', 'request is not open');
  perform public._assert(v_proposal.status = 'sent' and v_proposal.valid_until > now(), 'proposal is no longer valid');

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

  perform pg_advisory_xact_lock(hashtext(v_proposal.provider_id::text));
  select * into v_category from public.categories where id = v_request.category_id;
  perform public._assert(v_category.active and v_category.archetype = 'proposal', 'category is unavailable');
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
    booking_id, seq, label, amount, due_rule, due_at, status, purpose, obligation_kind, proposal_schedule_id
  )
  select v_booking, ps.seq, ps.label, ps.amount, ps.due_rule, ps.due_at,
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
    booking_id, seq, label, amount, due_rule, due_at, status, purpose, obligation_kind
  ) values (
    v_booking, v_seq, 'QuickServe platform fee', v_platform_fee, 'at_booking', now(),
    'due', 'platform_fee', 'platform_fee'
  );

  update public.proposals set status = 'accepted', updated_at = now() where id = v_proposal.id;
  update public.service_requests set status = 'closed', updated_at = now() where id = v_request.id;
  return v_booking;
end;
$$;

create or replace function public.send_request_message(p_request_id uuid, p_provider_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_request public.service_requests;
  v_body text := trim(coalesce(p_body, ''));
  v_message uuid;
  v_to uuid;
  v_kinds text[] := '{}';
begin
  select * into v_request from public.service_requests where id = p_request_id for share;
  perform public._assert(found, 'request not found');
  perform public._assert(exists (
    select 1 from public.request_recipients where request_id = p_request_id and provider_id = p_provider_id
  ), 'provider is not part of this request');
  perform public._assert(v_uid = v_request.customer_id or v_uid = p_provider_id, 'not a request participant');
  perform public._assert(v_request.status in ('open', 'closed'), 'request conversation is closed');
  perform public._assert(v_body <> '' and char_length(v_body) <= 2000, 'message is invalid');
  v_to := case when v_uid = v_request.customer_id then p_provider_id else v_request.customer_id end;
  v_kinds := public._leakage_signal_kinds(v_body);

  insert into public.request_messages (request_id, provider_id, sender_id, body)
  values (p_request_id, p_provider_id, v_uid, v_body)
  returning id into v_message;

  perform public._queue_notification(
    v_to, 'request_message', null, 'New request message',
    public._mask_preview(v_body), jsonb_build_object('request_id', p_request_id, 'provider_id', p_provider_id),
    'request-message:' || p_request_id::text || ':' || p_provider_id::text
  );
  return jsonb_build_object('message_id', v_message, 'nudge', cardinality(v_kinds) > 0);
end;
$$;

create or replace function public.start_proposal_booking(p_booking_id uuid, p_otp text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  s public.booking_secrets;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can start');
  perform public._assert(b.archetype = 'proposal' and b.status = 'confirmed', 'proposal is not confirmed');
  perform public._assert(
    b.scheduled_at between now() - interval '30 minutes' and now() + interval '30 minutes'
    or b.scheduled_at::date = current_date,
    'the service start window has not opened'
  );
  perform public._assert(not exists (
    select 1 from public.payment_schedule ps
     where ps.booking_id = b.id and ps.status <> 'paid'
       and ps.status = 'due'
       and ps.due_rule <> 'on_delivery' and ps.due_rule <> 'on_completion'
  ), 'a due milestone must be paid before start');
  select * into s from public.booking_secrets where booking_id = b.id for update;
  if s.start_attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'locked', 'attempts_left', 0);
  end if;
  if p_otp is distinct from s.start_otp then
    update public.booking_secrets set start_attempts = start_attempts + 1 where booking_id = b.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_otp', 'attempts_left', 4 - s.start_attempts);
  end if;
  update public.booking_secrets set start_attempts = 0 where booking_id = b.id;
  perform public._set_status(b.id, 'in_progress', v_uid, 'start code verified');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.begin_delivery(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can begin delivery');
  perform public._assert(b.archetype = 'proposal' and b.status = 'in_progress', 'booking is not in progress');
  perform public._assert(b.delivery_status = 'pending', 'this booking has no pending deliverables');
  perform public._set_status(b.id, 'delivery_pending', v_uid, 'deliverables in progress');
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
  perform public._assert(b.delivery_status = 'pending', 'delivery was already submitted');
  perform public._assert(jsonb_typeof(p_links) = 'array' and jsonb_array_length(p_links) between 1 and 20,
                         'submit 1 to 20 delivery links');
  for v_link in select value from jsonb_array_elements(p_links)
  loop
    perform public._assert(
      jsonb_typeof(v_link) = 'object'
      and coalesce(v_link ->> 'url', '') ~ '^https://[^[:space:]]+$',
      'every delivery item needs a full https URL'
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

create or replace function public.accept_delivery(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can accept delivery');
  perform public._assert(b.archetype = 'proposal' and b.status = 'completion_requested', 'delivery is not awaiting acceptance');
  perform public._assert(b.delivery_status = 'submitted', 'delivery has not been submitted');
  perform public._assert(not exists (
    select 1 from public.payment_schedule where booking_id = b.id and status <> 'paid'
  ), 'all milestones must be paid before accepting delivery');
  update public.bookings
     set delivery_status = 'accepted', delivery_accepted_at = now()
   where id = b.id;
  perform public._finalize_completion(b.id, v_uid, 'delivery accepted');
end;
$$;

-- Schedule-aware preparation. A single live link is reused only for the selected
-- obligation; other milestone links are never retired as a side effect.
create or replace function public.prepare_schedule_payment(
  p_booking_id uuid, p_user_id uuid, p_schedule_id uuid
)
returns table (payment_id uuid, amount int, purpose public.payment_purpose, short_url text, schedule_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  ps public.payment_schedule;
  p public.payments;
begin
  perform public._assert(b.customer_id = p_user_id, 'only the customer can pay');
  perform public._assert(b.archetype = 'proposal', 'schedule payments are only for proposal bookings');
  select * into ps from public.payment_schedule where id = p_schedule_id and booking_id = b.id for update;
  perform public._assert(found, 'milestone not found');
  perform public._assert(ps.status = 'due', 'milestone is not due');
  perform public._assert(
    b.status <> 'pending_payment' or ps.due_rule <> 'at_booking'
    or coalesce(b.payment_hold_expires_at, '-infinity') > now(),
    'payment hold expired'
  );

  select * into p from public.payments
   where booking_id = b.id and schedule_id = ps.id and status = 'created' and short_url is not null
   order by created_at desc limit 1;
  if found then
    return query select p.id, p.amount, p.purpose, p.short_url, ps.id;
    return;
  end if;

  update public.payments
     set status = 'failed', cancel_link_pending = true
   where booking_id = b.id and schedule_id = ps.id and status = 'created';
  insert into public.payments (
    booking_id, quote_id, purpose, amount, schedule_id
  ) values (b.id, b.approved_quote_id, ps.purpose, ps.amount, ps.id)
  returning * into p;
  return query select p.id, p.amount, p.purpose, null::text, ps.id;
end;
$$;

-- Compatibility wrapper: existing inspect-quote callers still take the legacy path;
-- proposal callers without an explicit schedule pay the earliest due obligation.
create or replace function public.prepare_payment(p_booking_id uuid, p_user_id uuid)
returns table (payment_id uuid, amount int, purpose public.payment_purpose, short_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  v_purpose public.payment_purpose;
  v_amount int;
  v_quote uuid;
  p public.payments;
  v_schedule uuid;
  v_prepared record;
begin
  perform public._assert(b.customer_id = p_user_id, 'only the customer can pay');
  if b.archetype = 'proposal' then
    select id into v_schedule from public.payment_schedule
     where booking_id = b.id and status = 'due'
     order by case when purpose = 'advance' then 0 when purpose = 'platform_fee' then 1 else 2 end, seq
     limit 1;
    perform public._assert(v_schedule is not null, 'nothing to pay');
    select * into v_prepared from public.prepare_schedule_payment(b.id, p_user_id, v_schedule);
    return query select v_prepared.payment_id, v_prepared.amount, v_prepared.purpose, v_prepared.short_url;
    return;
  end if;

  if b.booking_origin = 'byo' and b.status = 'pending_payment' then
    select * into q from public.quotes where id = b.approved_quote_id;
    perform public._assert(q.id is not null and q.status = 'approved', 'BYO agreement is missing');
    v_purpose := 'fixed';
    v_quote := q.id;
    v_amount := b.total_amount - public._net_paid(b.id);
  elsif b.status = 'pending_payment' then
    v_purpose := 'visit_fee';
    v_amount := b.visit_fee;
  elsif b.status in ('awaiting_payment', 'in_progress') then
    select * into q from public.quotes x
     where x.booking_id = b.id and x.status = 'approved_pending_payment'
     order by x.version desc limit 1;
    perform public._assert(q.id is not null, 'nothing to pay');
    v_purpose := 'balance';
    v_quote := q.id;
    v_amount := public._required_total(q.total, b.visit_fee, b.platform_fee) - public._net_paid(b.id);
  else
    raise exception 'nothing to pay in this state' using errcode = 'P0001';
  end if;
  perform public._assert(v_amount > 0, 'nothing to pay');

  select * into p from public.payments x
   where x.booking_id = b.id and x.status = 'created' and x.purpose = v_purpose
     and x.amount = v_amount and x.quote_id is not distinct from v_quote and x.short_url is not null
   order by x.created_at desc limit 1;
  if found then
    return query select p.id, p.amount, p.purpose, p.short_url;
    return;
  end if;
  update public.payments x set status = 'failed', cancel_link_pending = true
   where x.booking_id = b.id and x.status = 'created';
  insert into public.payments (booking_id, quote_id, purpose, amount)
  values (b.id, v_quote, v_purpose, v_amount)
  returning * into p;
  return query select p.id, p.amount, p.purpose, null::text;
end;
$$;

create or replace function public.record_payment_paid(p_link_id text, p_payment_id text, p_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  b public.bookings;
  ps public.payment_schedule;
  q public.quotes;
  v_required int;
  v_accept boolean;
  v_request public.service_requests;
begin
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into p from public.payments where razorpay_link_id = p_link_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown link');
  end if;
  if p.amount <> p_amount then
    return jsonb_build_object('ok', false, 'error', 'amount mismatch');
  end if;
  b := public._lock_booking(p.booking_id);

  if b.archetype = 'proposal' then
    select * into ps from public.payment_schedule where id = p.schedule_id for update;
    v_accept := found and p.status = 'created' and ps.status = 'due'
      and (b.status not in ('expired', 'cancelled', 'declined') and
           (ps.due_rule <> 'at_booking' or coalesce(b.payment_hold_expires_at, '-infinity') > now()));
    update public.payments
       set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
     where id = p.id;
    if not v_accept then
      perform public._queue_refund(p.id, p.amount, 'stale, expired or excess proposal payment');
      perform public._log_event(b.id, null, 'proposal payment ' || p_payment_id || ' not owed; refund queued');
      return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund', true);
    end if;
    update public.payment_schedule
       set status = 'paid', payment_id = p.id, paid_at = now()
     where id = ps.id;
    update public.bookings set payment_hold_expires_at = null
     where id = b.id
       and not exists (
         select 1 from public.payment_schedule
          where booking_id = b.id and due_rule = 'at_booking' and status <> 'paid'
       );

    if b.status = 'pending_payment' and not exists (
      select 1 from public.payment_schedule
       where booking_id = b.id and due_rule = 'at_booking' and status <> 'paid'
    ) then
      select * into v_request from public.service_requests where id = b.service_request_id for update;
      update public.quotes set status = 'approved' where id = b.approved_quote_id;
      update public.service_requests set status = 'booked', updated_at = now() where id = b.service_request_id;
      update public.proposals set status = 'rejected', updated_at = now()
       where request_id = b.service_request_id and status = 'sent' and id <> b.proposal_id;
      update public.bookings set accepted_at = now(), payment_hold_expires_at = null where id = b.id;
      perform public._set_status(b.id, 'confirmed', null, 'advance and platform fee paid');
      perform public._queue_notification(
        b.customer_id, 'proposal_booked', b.id, 'Booking confirmed',
        'Your advance is paid and the provider is confirmed.',
        jsonb_build_object('booking_id', b.id, 'proposal_id', b.proposal_id), 'proposal-booked:' || b.id::text
      );
      perform public._queue_notification(
        b.provider_id, 'proposal_booked', b.id, 'You have a confirmed booking',
        'The customer paid the booking advance.',
        jsonb_build_object('booking_id', b.id, 'proposal_id', b.proposal_id), 'proposal-booked:' || b.id::text
      );
    end if;
    return jsonb_build_object('ok', true, 'booking_id', b.id, 'schedule_id', ps.id);
  end if;

  if p.status = 'created' then
    if p.purpose = 'fixed' and b.booking_origin = 'byo' and b.status = 'pending_payment' then
      select * into q from public.quotes where id = p.quote_id for update;
      if q.status = 'approved' then
        v_required := b.total_amount;
      end if;
    elsif p.purpose = 'visit_fee' and b.status = 'pending_payment' then
      v_required := b.visit_fee;
    elsif p.purpose = 'balance' and p.quote_id is not null then
      select * into q from public.quotes where id = p.quote_id for update;
      if q.status = 'approved_pending_payment' then
        v_required := public._required_total(q.total, b.visit_fee, b.platform_fee);
      end if;
    end if;
  end if;
  v_accept := v_required is not null and public._net_paid(b.id) + p.amount <= v_required;
  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
   where id = p.id;
  if not v_accept then
    perform public._queue_refund(p.id, p.amount, 'stale or excess payment');
    perform public._log_event(b.id, null, 'payment ' || p_payment_id || ' not owed; queued for refund');
    return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund', true);
  end if;
  if p.purpose = 'fixed' then
    update public.bookings set accepted_at = now() where id = b.id;
    perform public._set_status(b.id, 'accepted', null, 'BYO fixed payment received');
  elsif p.purpose = 'visit_fee' then
    perform public._set_status(b.id, 'requested', null, 'visit fee paid');
  elsif public._net_paid(b.id) >= v_required then
    perform public._activate_quote(b.id, q.id);
    if b.status = 'awaiting_payment' then
      perform public._set_status(b.id, 'in_progress', null, 'balance paid');
    else
      perform public._log_event(b.id, null, 'change order v' || q.version || ' paid');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'booking_id', b.id);
end;
$$;

create or replace function public.request_completion(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can request completion');
  perform public._assert(b.status = 'in_progress', 'job is not in progress');
  if b.archetype = 'proposal' then
    perform public._assert(b.delivery_status = 'not_applicable', 'submit deliverables instead');
    update public.payment_schedule
       set status = case when status = 'paid' then status else 'due' end, due_at = coalesce(due_at, now())
     where booking_id = b.id and due_rule = 'on_completion';
  else
    perform public._assert(not exists (select 1 from public.quotes where booking_id = b.id
                                        and status in ('sent', 'approved_pending_payment')),
                           'resolve the pending change order first');
  end if;
  update public.booking_secrets set end_otp = public._gen_otp(), end_attempts = 0 where booking_id = b.id;
  update public.bookings set completion_requested_at = now() where id = b.id;
  perform public._set_status(b.id, 'completion_requested', v_uid);
end;
$$;

create or replace function public.confirm_completion(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can confirm');
  perform public._assert(b.status = 'completion_requested', 'completion was not requested');
  if b.archetype = 'proposal' then
    perform public._assert(not exists (
      select 1 from public.payment_schedule where booking_id = b.id and status <> 'paid'
    ), 'all milestones must be paid before completion');
  end if;
  perform public._finalize_completion(b.id, v_uid, 'confirmed by customer');
end;
$$;

create or replace function public.complete_booking(p_booking_id uuid, p_otp text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  s public.booking_secrets;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can complete');
  perform public._assert(b.status = 'completion_requested', 'completion was not requested');
  select * into s from public.booking_secrets where booking_id = b.id for update;
  if s.end_attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'locked', 'attempts_left', 0);
  end if;
  if s.end_otp is null or p_otp is distinct from s.end_otp then
    update public.booking_secrets set end_attempts = end_attempts + 1 where booking_id = b.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_otp', 'attempts_left', 4 - s.end_attempts);
  end if;
  if b.archetype = 'proposal' then
    perform public._assert(not exists (
      select 1 from public.payment_schedule where booking_id = b.id and status <> 'paid'
    ), 'all milestones must be paid before completion');
  end if;
  perform public._finalize_completion(b.id, v_uid, 'end code verified');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cancel_proposal_payment_default(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_outcome jsonb;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can report payment default');
  perform public._assert(b.archetype = 'proposal' and b.status in ('confirmed', 'in_progress'),
                         'proposal is not active');
  perform public._assert(exists (
    select 1 from public.payment_schedule ps
     where ps.booking_id = b.id and ps.status = 'due'
       and ps.due_at <= now() - interval '48 hours'
       and ps.reminded_at is not null
  ), 'the milestone is not overdue past the grace period');
  perform public._assert(
    to_regprocedure('public._cancellation_outcome(uuid,text,text,timestamp with time zone)') is not null,
    'cancellation policy engine is unavailable'
  );
  execute 'select public._cancellation_outcome($1, $2, $3, $4)'
    into v_outcome using b.id, 'provider', 'customer_payment_default', now();
  update public.bookings
     set cancelled_reason = 'customer payment default',
         updated_at = now()
   where id = b.id;
  perform public._set_status(b.id, 'cancelled', v_uid, 'milestone overdue past grace');
end;
$$;

create or replace function public.process_proposal_milestones()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    update public.payment_schedule ps
       set status = 'due', reminded_at = now()
      from public.bookings b
     where ps.booking_id = b.id
       and ps.status = 'upcoming'
       and ps.due_at is not null
       and ps.due_at <= now()
       and b.status not in ('expired', 'cancelled', 'declined', 'completed', 'closed', 'refunded')
     returning ps.id, ps.booking_id, ps.label, b.customer_id
  loop
    perform public._queue_notification(
      r.customer_id, 'milestone_due', r.booking_id, 'Payment milestone due',
      r.label || ' is ready to pay in QuickServe.',
      jsonb_build_object('booking_id', r.booking_id, 'schedule_id', r.id),
      'milestone:' || r.id::text
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.expire_proposal_flows()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_count int := 0;
begin
  for b in
    select * from public.bookings
     where archetype = 'proposal' and status = 'pending_payment'
       and payment_hold_expires_at <= now()
     for update skip locked
  loop
    update public.payments
       set status = 'failed', cancel_link_pending = true
     where booking_id = b.id and status = 'created';
    update public.payment_schedule set status = 'waived'
     where booking_id = b.id and status in ('due', 'upcoming');
    update public.quotes set status = 'superseded'
     where id = b.approved_quote_id and status in ('sent', 'approved_pending_payment');
    perform public._set_status(b.id, 'expired', null, 'proposal payment hold expired');
    update public.proposals
       set status = case when valid_until > now() then 'sent' else 'expired' end, updated_at = now()
     where id = b.proposal_id;
    update public.service_requests
       set status = case when expires_at > now() then 'open' else 'expired' end, updated_at = now()
     where id = b.service_request_id and status = 'closed';
    perform public._queue_notification(
      b.customer_id, 'proposal_hold_expired', b.id, 'Proposal hold expired',
      'The payment window closed. Your request is available again.',
      jsonb_build_object('booking_id', b.id, 'request_id', b.service_request_id),
      'proposal-hold:' || b.id::text
    );
    v_count := v_count + 1;
  end loop;

  update public.proposals
     set status = 'expired', updated_at = now()
   where status = 'sent' and valid_until <= now();
  update public.service_requests r
     set status = 'expired', updated_at = now()
   where r.status in ('open', 'closed')
     and r.expires_at <= now()
     and not exists (
       select 1 from public.bookings b
        where b.service_request_id = r.id
          and b.status in ('confirmed', 'accepted', 'en_route', 'in_progress', 'delivery_pending',
                           'completion_requested', 'disputed')
     );
  return v_count;
end;
$$;

create or replace function public.auto_confirm_completions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_count int := 0;
  v_hours int;
begin
  for b in
    select * from public.bookings where status = 'completion_requested' for update skip locked
  loop
    v_hours := case when b.archetype = 'proposal' and b.delivery_status <> 'not_applicable' then 168 else 24 end;
    if b.completion_requested_at <= now() - make_interval(hours => v_hours)
       and (b.archetype <> 'proposal' or not exists (
         select 1 from public.payment_schedule where booking_id = b.id and status <> 'paid'
       )) then
      if b.delivery_status = 'submitted' then
        update public.bookings set delivery_status = 'accepted', delivery_accepted_at = now() where id = b.id;
      end if;
      perform public._finalize_completion(b.id, null, 'auto-confirmed after acceptance window');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- RLS and projection privileges.
alter table public.service_requests enable row level security;
alter table public.request_private enable row level security;
alter table public.request_recipients enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_items enable row level security;
alter table public.proposal_schedule enable row level security;
alter table public.request_messages enable row level security;
alter table public.payment_schedule enable row level security;

revoke all on public.service_requests, public.request_private, public.request_recipients,
  public.proposals, public.proposal_items, public.proposal_schedule, public.request_messages,
  public.payment_schedule, public.service_request_provider_view from anon, authenticated;

grant select on public.service_requests to authenticated;
grant select on public.request_private to authenticated;
grant select on public.request_recipients to authenticated;
grant select on public.proposals, public.proposal_items, public.proposal_schedule to authenticated;
grant select on public.request_messages to authenticated;
grant select on public.payment_schedule to authenticated;
grant select on public.service_request_provider_view to authenticated;

create policy service_requests_customer on public.service_requests
  for select to authenticated using (customer_id = auth.uid() or public._is_admin());
create policy request_private_customer_or_paid_provider on public.request_private
  for select to authenticated using (
    exists (
      select 1 from public.service_requests r
       where r.id = request_id and (
         r.customer_id = auth.uid()
         or exists (
           select 1 from public.bookings b
            where b.service_request_id = r.id
              and b.provider_id = auth.uid()
              and b.status not in ('pending_payment', 'expired', 'declined', 'cancelled')
         )
       )
    )
    or public._is_admin()
  );
create policy request_recipients_own on public.request_recipients
  for select to authenticated using (
    provider_id = auth.uid()
    or exists (select 1 from public.service_requests r where r.id = request_id and r.customer_id = auth.uid())
    or public._is_admin()
  );
create policy proposals_participants on public.proposals
  for select to authenticated using (
    provider_id = auth.uid()
    or exists (select 1 from public.service_requests r where r.id = request_id and r.customer_id = auth.uid())
    or public._is_admin()
  );
create policy proposal_items_participants on public.proposal_items
  for select to authenticated using (
    exists (select 1 from public.proposals p where p.id = proposal_id and (
      p.provider_id = auth.uid()
      or exists (select 1 from public.service_requests r where r.id = p.request_id and r.customer_id = auth.uid())
      or public._is_admin()
    ))
  );
create policy proposal_schedule_participants on public.proposal_schedule
  for select to authenticated using (
    exists (select 1 from public.proposals p where p.id = proposal_id and (
      p.provider_id = auth.uid()
      or exists (select 1 from public.service_requests r where r.id = p.request_id and r.customer_id = auth.uid())
      or public._is_admin()
    ))
  );
create policy request_messages_thread_participants on public.request_messages
  for select to authenticated using (
    sender_id = auth.uid()
    or (provider_id = auth.uid())
    or exists (
      select 1 from public.service_requests r where r.id = request_id and r.customer_id = auth.uid()
    )
    or public._is_admin()
  );
create policy payment_schedule_participants on public.payment_schedule
  for select to authenticated using (public._is_participant(booking_id));

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'chat_message', 'booking_requested', 'booking_accepted', 'booking_declined', 'booking_expired',
  'booking_cancelled', 'provider_en_route', 'quote_sent', 'change_order_sent', 'completion_requested',
  'travel_request_created', 'travel_request_approved', 'travel_request_declined', 'travel_request_expired',
  'proposal_request_received', 'proposal_received', 'proposal_booked', 'proposal_hold_expired',
  'request_message', 'milestone_due', 'delivery_submitted'
));

revoke execute on function
  public._proposal_public_intake(uuid, jsonb),
  public._freeze_proposal_booking_snapshot(),
  public.route_service_request(uuid, int),
  public.create_service_request(uuid, text, text, timestamptz, timestamptz, jsonb, int, int, uuid, text),
  public.cancel_service_request(uuid),
  public.send_proposal(uuid, jsonb, jsonb, timestamptz, text, jsonb),
  public.withdraw_proposal(uuid),
  public.accept_proposal(uuid, uuid),
  public.send_request_message(uuid, uuid, text),
  public.start_proposal_booking(uuid, text),
  public.begin_delivery(uuid),
  public.submit_delivery(uuid, jsonb),
  public.accept_delivery(uuid),
  public.prepare_schedule_payment(uuid, uuid, uuid),
  public.cancel_proposal_payment_default(uuid),
  public.process_proposal_milestones(),
  public.expire_proposal_flows(),
  public.prepare_payment(uuid, uuid),
  public.record_payment_paid(text, text, int),
  public.request_completion(uuid),
  public.confirm_completion(uuid),
  public.complete_booking(uuid, text),
  public.auto_confirm_completions()
from public, anon;

grant execute on function
  public.create_service_request(uuid, text, text, timestamptz, timestamptz, jsonb, int, int, uuid, text),
  public.cancel_service_request(uuid),
  public.send_proposal(uuid, jsonb, jsonb, timestamptz, text, jsonb),
  public.withdraw_proposal(uuid),
  public.accept_proposal(uuid, uuid),
  public.send_request_message(uuid, uuid, text),
  public.start_proposal_booking(uuid, text),
  public.begin_delivery(uuid),
  public.submit_delivery(uuid, jsonb),
  public.accept_delivery(uuid),
  public.prepare_schedule_payment(uuid, uuid, uuid),
  public.cancel_proposal_payment_default(uuid)
to authenticated;

grant execute on function
  public.route_service_request(uuid, int),
  public.process_proposal_milestones(),
  public.expire_proposal_flows(),
  public.record_payment_paid(text, text, int),
  public.prepare_payment(uuid, uuid),
  public.auto_confirm_completions()
to service_role;
grant execute on function
  public.prepare_payment(uuid, uuid),
  public.request_completion(uuid),
  public.confirm_completion(uuid),
  public.complete_booking(uuid, text)
to authenticated;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid)
      from cron.job where jobname in ('proposal-expiry', 'proposal-milestone-reminders');
    perform cron.schedule('proposal-expiry', '* * * * *', 'select public.expire_proposal_flows()');
    perform cron.schedule('proposal-milestone-reminders', '*/15 * * * *', 'select public.process_proposal_milestones()');
  end if;
end;
$$;

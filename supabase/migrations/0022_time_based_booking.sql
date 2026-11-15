-- Phase 4: session and recurring bookings (docs/07 C6, C11, D1, D2, D3, D6).
-- Requires the payment-obligation and category/package migrations that precede 0022.
-- Existing booking state and legacy money functions remain unchanged; time-based
-- fulfilment uses separate RPCs and branches on bookings.archetype.

do $$
begin
  if to_regclass('public.cancellation_policies') is not null then
    execute $policy$
      insert into public.cancellation_policies (key, label, rules)
      select 'session_standard', 'Standard prepaid session cancellation', rules
        from public.cancellation_policies
       where key = 'fixed'
      on conflict (key) do update
      set label = excluded.label,
          rules = excluded.rules,
          active = true,
          updated_at = now()
    $policy$;
  end if;
end;
$$;

-- 0020 inserts the proposal row before calculating and persisting total. Keep that
-- transaction valid for databases that already use the proposal engine.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'proposals' and column_name = 'total'
  ) then
    alter table public.proposals alter column total set default 1;
  end if;
end;
$$;

-- 0020's table-returning schedule_id name collides with payments.schedule_id in
-- PGlite/Postgres PL/pgSQL. Recreate the same API with qualified column references.
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
  select * into ps
    from public.payment_schedule x
   where x.id = p_schedule_id and x.booking_id = b.id
   for update;
  perform public._assert(found, 'milestone not found');
  perform public._assert(ps.status = 'due', 'milestone is not due');
  perform public._assert(
    b.status <> 'pending_payment' or ps.due_rule <> 'at_booking'
    or coalesce(b.payment_hold_expires_at, '-infinity') > now(),
    'payment hold expired'
  );

  select * into p
    from public.payments x
   where x.booking_id = b.id
     and x.schedule_id = ps.id
     and x.status = 'created'
     and x.short_url is not null
   order by x.created_at desc
   limit 1;
  if found then
    return query select p.id, p.amount, p.purpose, p.short_url, ps.id;
    return;
  end if;

  update public.payments x
     set status = 'failed', cancel_link_pending = true
   where x.booking_id = b.id and x.schedule_id = ps.id and x.status = 'created';
  insert into public.payments (booking_id, quote_id, purpose, amount, schedule_id)
  values (b.id, b.approved_quote_id, ps.purpose::public.payment_purpose, ps.amount, ps.id)
  returning * into p;
  return query select p.id, p.amount, p.purpose, null::text, ps.id;
end;
$$;
revoke all on function public.prepare_schedule_payment(uuid, uuid, uuid) from public, anon;
grant execute on function public.prepare_schedule_payment(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.expire_proposal_flows()
returns int
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
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
  update public.service_requests sr
     set status = 'expired', updated_at = now()
   where sr.status in ('open', 'closed')
     and sr.expires_at <= now()
     and not exists (
       select 1 from public.bookings bk
        where bk.service_request_id = sr.id
          and bk.status in ('confirmed', 'accepted', 'en_route', 'in_progress', 'delivery_pending',
                            'completion_requested', 'disputed')
     );
  return v_count;
end;
$$;
revoke all on function public.expire_proposal_flows() from public, anon, authenticated;
grant execute on function public.expire_proposal_flows() to service_role;

create or replace function public.can_read_request_private(p_request_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
      from public.service_requests sr
     where sr.id = p_request_id
       and (
         sr.customer_id = auth.uid()
         or public._is_admin()
         or exists (
           select 1
             from public.bookings b
            where b.service_request_id = sr.id
              and b.provider_id = auth.uid()
              and b.status not in ('pending_payment', 'expired', 'declined', 'cancelled')
         )
       )
  );
end
$$;
revoke all on function public.can_read_request_private(uuid) from public;
grant execute on function public.can_read_request_private(uuid) to authenticated, service_role;
do $$
begin
  if to_regclass('public.request_private') is not null then
    execute 'drop policy if exists request_private_customer_or_paid_provider on public.request_private';
    execute 'create policy request_private_customer_or_paid_provider on public.request_private '
      || 'for select to authenticated using (public.can_read_request_private(request_id))';
  end if;
end;
$$;

-- 0020 creates the active booking and closes the request in one transaction, so
-- repeated acceptance must find the booking before checking the request state.
do $$
begin
  if to_regprocedure('public.accept_proposal(uuid,uuid)') is not null then
    alter function public.accept_proposal(uuid, uuid) rename to _accept_proposal_v20;
    create function public.accept_proposal(p_proposal_id uuid, p_address_id uuid default null)
    returns uuid
    language plpgsql
    security definer
    set search_path = public
    as $wrapper$
    declare
      v_uid uuid := public._require_uid();
      v_booking uuid;
    begin
      select b.id into v_booking
        from public.bookings b
       where b.proposal_id = p_proposal_id
         and b.status in ('pending_payment','confirmed','accepted','en_route','in_progress',
                          'delivery_pending','completion_requested','disputed')
       limit 1;
      if found then
        perform public._assert(exists (
          select 1 from public.bookings b
           where b.id = v_booking and b.customer_id = v_uid
        ), 'only the customer can accept this proposal');
        return v_booking;
      end if;
      return public._accept_proposal_v20(p_proposal_id, p_address_id);
    end;
    $wrapper$;
    grant execute on function public.accept_proposal(uuid, uuid) to authenticated;
  end if;
end;
$$;

do $$
begin
  perform public._assert(
    to_regclass('public.payment_schedule') is not null,
    '0022 requires the payment_schedule migration (0019)'
  );
  perform public._assert(
    exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'payments' and column_name = 'schedule_id'
    ),
    '0022 requires payments.schedule_id from the payment-obligation migration'
  );
  perform public._assert(
    exists (
      select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'payment_purpose' and e.enumlabel = 'session'
    )
    and exists (
      select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'payment_purpose' and e.enumlabel = 'package'
    ),
    '0022 requires payment_purpose values package and session from the enum migration'
  );
end;
$$;

alter table public.bookings
  add column if not exists archetype text not null default 'inspect_quote',
  add column if not exists service_window tstzrange,
  add column if not exists exclusive boolean not null default true,
  add column if not exists session_duration_min int,
  add column if not exists service_package_id uuid references public.service_packages (id),
  add column if not exists pack_purchase_id uuid,
  add column if not exists pack_session_id uuid,
  add column if not exists recurring_schedule_id uuid;

alter table public.bookings
  drop constraint if exists bookings_time_session_fields,
  add constraint bookings_time_session_fields check (
    (archetype <> 'time_based'
      and session_duration_min is null
      and service_package_id is null
      and pack_purchase_id is null
      and pack_session_id is null
      and recurring_schedule_id is null)
    or
    (archetype = 'time_based' and session_duration_min between 15 and 480)
  );

create table public.pack_purchases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete restrict,
  provider_id uuid not null references public.providers (id) on delete restrict,
  provider_service_id uuid not null references public.provider_services (id) on delete restrict,
  service_package_id uuid not null references public.service_packages (id) on delete restrict,
  sessions_total int not null check (sessions_total > 1 and sessions_total <= 120),
  price int not null check (price > 0),
  platform_fee int not null check (platform_fee = 4900),
  payment_id uuid,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'active', 'completed', 'expired', 'cancelled', 'refunded')),
  expires_at timestamptz not null,
  extension_used boolean not null default false,
  extension_used_at timestamptz,
  refund_amount int not null default 0 check (refund_amount >= 0 and refund_amount <= price + platform_fee),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id)
);
create index pack_purchases_customer_idx on public.pack_purchases (customer_id, created_at desc);
create index pack_purchases_provider_idx on public.pack_purchases (provider_id, status);
create index pack_purchases_expiry_idx on public.pack_purchases (expires_at) where status = 'active';

create table public.pack_sessions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.pack_purchases (id) on delete restrict,
  seq int not null check (seq > 0),
  booking_id uuid unique references public.bookings (id) on delete set null,
  allocated_amount int not null check (allocated_amount > 0),
  status text not null default 'available'
    check (status in ('available', 'allocated', 'completed', 'consumed', 'cancelled', 'expired', 'refunded')),
  allocated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (pack_id, seq)
);
create index pack_sessions_open_idx on public.pack_sessions (pack_id, seq)
  where status = 'available';

alter table public.pack_purchases
  add constraint pack_purchases_payment_fk
    foreign key (payment_id) references public.payments (id);

alter table public.bookings
  add constraint bookings_pack_purchase_fk
    foreign key (pack_purchase_id) references public.pack_purchases (id),
  add constraint bookings_pack_session_fk
    foreign key (pack_session_id) references public.pack_sessions (id);

alter table public.payments
  add column if not exists pack_purchase_id uuid references public.pack_purchases (id),
  alter column booking_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.payments'::regclass and conname = 'payments_booking_or_pack'
  ) then
    alter table public.payments
      add constraint payments_booking_or_pack
      check (num_nonnulls(booking_id, pack_purchase_id) = 1);
  end if;
end;
$$;

create table public.recurring_schedules (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete restrict,
  provider_service_id uuid not null references public.provider_services (id) on delete restrict,
  service_package_id uuid references public.service_packages (id) on delete restrict,
  pack_purchase_id uuid references public.pack_purchases (id) on delete restrict,
  frequency text not null default 'weekly' check (frequency = 'weekly'),
  weekdays smallint[] not null,
  start_time time not null,
  timezone text not null default 'Asia/Kolkata',
  session_duration_min int not null check (session_duration_min between 15 and 480),
  payment_mode text not null check (payment_mode in ('per_session', 'pack_prepaid', 'monthly_prepaid')),
  address_line text not null,
  city text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  description text not null default '',
  starts_on date not null,
  ends_on date,
  generated_through date,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (array_length(weekdays, 1) between 1 and 7),
  check (weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  check (ends_on is null or ends_on >= starts_on),
  check (
    (payment_mode = 'per_session' and pack_purchase_id is null)
    or (payment_mode in ('pack_prepaid', 'monthly_prepaid') and pack_purchase_id is not null)
  )
);
create index recurring_schedules_customer_idx
  on public.recurring_schedules (customer_id, status, created_at desc);
create index recurring_schedules_due_idx
  on public.recurring_schedules (status, generated_through) where status = 'active';

alter table public.bookings
  add constraint bookings_recurring_schedule_fk
    foreign key (recurring_schedule_id) references public.recurring_schedules (id);

create unique index recurring_schedule_session_idx
  on public.bookings (recurring_schedule_id, scheduled_at)
  where recurring_schedule_id is not null;

create or replace function public._pack_ledger_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.pack_id is distinct from old.pack_id
     or new.seq is distinct from old.seq
     or new.allocated_amount is distinct from old.allocated_amount then
    raise exception 'pack allocation ledger is immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger pack_sessions_immutable
  before update on public.pack_sessions
  for each row execute function public._pack_ledger_immutable();

create or replace function public._pack_purchase_money_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.customer_id is distinct from old.customer_id
     or new.provider_id is distinct from old.provider_id
     or new.provider_service_id is distinct from old.provider_service_id
     or new.service_package_id is distinct from old.service_package_id
     or new.sessions_total is distinct from old.sessions_total
     or new.price is distinct from old.price
     or new.platform_fee is distinct from old.platform_fee then
    raise exception 'pack price and identity are immutable' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger pack_purchases_immutable
  before update on public.pack_purchases
  for each row execute function public._pack_purchase_money_immutable();

create or replace function public._assert_session_package(p_provider_service_id uuid, p_package_id uuid)
returns public.service_packages
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sp public.service_packages;
  ps public.provider_services;
begin
  select * into sp from public.service_packages where id = p_package_id and active;
  perform public._assert(found, 'session package is unavailable');
  select * into ps from public.provider_services where id = p_provider_service_id and id = sp.provider_service_id and active;
  perform public._assert(found, 'package does not belong to this service');
  perform public._assert(sp.unit = 'session' and sp.price_type = 'fixed', 'session package must be fixed-price');
  perform public._assert(sp.price is not null and sp.price > 0, 'session package price is required');
  return sp;
end;
$$;

create or replace function public.list_session_packages(p_provider_service_id uuid)
returns setof public.service_packages
language sql
stable
security definer
set search_path = public
as $$
  select sp.*
    from public.service_packages sp
    join public.provider_services ps on ps.id = sp.provider_service_id
    join public.categories c on c.id = ps.category_id
   where ps.id = p_provider_service_id
     and ps.active
     and sp.active
     and sp.unit = 'session'
     and c.archetype = 'time_based';
$$;

create or replace function public.purchase_session_pack(p_service_package_id uuid, p_sessions int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  sp public.service_packages;
  ps public.provider_services;
  v_pack uuid;
  v_count int := p_sessions;
  v_base int;
  v_remainder int;
begin
  select * into sp from public.service_packages where id = p_service_package_id and active for update;
  perform public._assert(found, 'session package is unavailable');
  select * into ps from public.provider_services where id = sp.provider_service_id and active for update;
  perform public._assert(found, 'provider service is unavailable');
  perform public._assert(public._provider_is_live(ps.provider_id), 'provider is not available');
  perform public._assert(public._category_docs_ok(ps.provider_id, ps.category_id), 'provider verification is incomplete');
  perform public._assert(ps.provider_id <> v_uid, 'cannot buy your own pack');
  perform public._assert(sp.unit = 'session' and sp.price_type = 'fixed' and sp.price > 0, 'pack must be a fixed session package');
  perform public._assert(sp.qty_min = trunc(sp.qty_min) and sp.qty_max = trunc(sp.qty_max), 'pack size must be a whole number');
  perform public._assert(v_count between sp.qty_min::int and sp.qty_max::int and v_count > 1, 'invalid pack session count');

  insert into public.pack_purchases (
    customer_id, provider_id, provider_service_id, service_package_id,
    sessions_total, price, platform_fee, expires_at
  )
  values (
    v_uid, ps.provider_id, ps.id, sp.id,
    v_count, sp.price * v_count, 4900, now() + interval '90 days'
  )
  returning id into v_pack;

  v_base := (sp.price * v_count) / v_count;
  v_remainder := (sp.price * v_count) % v_count;
  insert into public.pack_sessions (pack_id, seq, allocated_amount)
  select v_pack, s, v_base + case when s <= v_remainder then 1 else 0 end
    from generate_series(1, v_count) s;

  return v_pack;
end;
$$;

create or replace function public.prepare_pack_payment(p_pack_id uuid, p_user_id uuid)
returns table (payment_id uuid, amount int, purpose public.payment_purpose, short_url text, schedule_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  k public.pack_purchases;
begin
  select * into k from public.pack_purchases where id = p_pack_id for update;
  perform public._assert(k.customer_id = p_user_id, 'only the customer can pay for the pack');
  perform public._assert(k.status = 'pending_payment', 'pack is not awaiting payment');

  select * into p
    from public.payments x
   where x.pack_purchase_id = k.id
     and x.status = 'created'
     and x.amount = k.price + k.platform_fee
     and x.short_url is not null
   order by x.created_at desc
   limit 1;
  if found then
    return query select p.id, p.amount, p.purpose, p.short_url, null::uuid;
    return;
  end if;

  update public.payments
     set status = 'failed', cancel_link_pending = true
   where pack_purchase_id = k.id and status = 'created';
  insert into public.payments (pack_purchase_id, purpose, amount)
  values (k.id, 'package', k.price + k.platform_fee)
  returning * into p;
  return query select p.id, p.amount, p.purpose, null::text, null::uuid;
end;
$$;

create or replace function public.record_pack_payment_paid(
  p_link_id text, p_payment_id text, p_amount int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  k public.pack_purchases;
begin
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into p from public.payments where razorpay_link_id = p_link_id for update;
  if not found or p.pack_purchase_id is null then
    return jsonb_build_object('ok', false, 'error', 'not a pack payment');
  end if;
  if p.amount <> p_amount then
    return jsonb_build_object('ok', false, 'error', 'amount mismatch');
  end if;
  select * into k from public.pack_purchases where id = p.pack_purchase_id for update;

  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
   where id = p.id;

  if p.status <> 'created' or k.status <> 'pending_payment' then
    perform public._queue_refund(p.id, p.amount, 'stale pack payment');
    return jsonb_build_object('ok', true, 'pack_id', k.id, 'refund', true);
  end if;

  update public.pack_purchases
     set status = 'active', payment_id = p.id, expires_at = now() + interval '90 days'
   where id = k.id;
  return jsonb_build_object('ok', true, 'pack_id', k.id, 'activated', true);
end;
$$;

create or replace function public._create_session_booking(
  p_customer_id uuid,
  p_provider_service_id uuid,
  p_service_package_id uuid,
  p_scheduled_at timestamptz,
  p_duration_min int,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision,
  p_description text,
  p_pack_id uuid default null,
  p_recurring_schedule_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ps public.provider_services;
  sp public.service_packages;
  k public.pack_purchases;
  s public.pack_sessions;
  v_address uuid;
  v_booking uuid;
  v_problem text;
  v_service_amount int;
  v_platform_fee int;
  v_duration int;
  v_initial_status public.booking_status := 'pending_payment';
begin
  select * into ps from public.provider_services where id = p_provider_service_id and active for update;
  perform public._assert(found, 'service not available');
  perform public._assert(public._provider_is_live(ps.provider_id), 'provider is not available');
  perform public._assert(public._category_docs_ok(ps.provider_id, ps.category_id), 'provider verification is incomplete');
  perform public._assert(ps.provider_id <> p_customer_id, 'cannot book yourself');
  perform public._assert(p_scheduled_at > now() + interval '30 minutes', 'session must be scheduled at least 30 minutes ahead');
  perform public._assert(coalesce(trim(p_address_line), '') <> '' and coalesce(trim(p_city), '') <> '', 'address is required');
  perform public._assert(p_lat between -90 and 90 and p_lng between -180 and 180, 'location is invalid');

  perform pg_advisory_xact_lock(hashtext(ps.provider_id::text));
  v_problem := public._provider_slot_problem(ps.provider_id, p_scheduled_at, false);
  perform public._assert(v_problem is null, coalesce('provider_unavailable: ' || v_problem, 'provider_unavailable'));

  if p_service_package_id is not null then
    sp := public._assert_session_package(ps.id, p_service_package_id);
    v_service_amount := sp.price;
    v_duration := coalesce(sp.duration_min, p_duration_min);
  else
    perform public._assert(p_duration_min between 15 and 480, 'session duration must be between 15 and 480 minutes');
    v_duration := p_duration_min;
    v_service_amount := greatest(round(ps.labour_rate::numeric * v_duration / 60.0), 1);
  end if;
  v_platform_fee := 2900;

  if p_pack_id is not null then
    select * into k from public.pack_purchases where id = p_pack_id for update;
    perform public._assert(
      found and k.customer_id = p_customer_id and k.provider_service_id = ps.id and k.status = 'active',
      'pack is not available for this session'
    );
    perform public._assert(k.expires_at > now(), 'pack has expired');
    select * into s
      from public.pack_sessions
     where pack_id = k.id and status = 'available'
     order by seq
     limit 1
     for update;
    perform public._assert(found, 'pack has no unused sessions');
    v_service_amount := s.allocated_amount;
    v_platform_fee := 0;
    v_initial_status := 'requested';
  elsif p_recurring_schedule_id is not null then
    perform public._assert(
      exists (
        select 1 from public.recurring_schedules r
         where r.id = p_recurring_schedule_id
           and r.customer_id = p_customer_id
           and r.payment_mode = 'per_session'
      ),
      'recurring schedule does not allow per-session payment'
    );
  end if;

  insert into public.addresses (user_id, label, line1, city, lat, lng)
  values (p_customer_id, 'Booking', trim(p_address_line), trim(p_city), p_lat, p_lng)
  returning id into v_address;

  insert into public.bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id,
    description, scheduled_at, status, visit_fee, platform_fee, total_amount,
    archetype, service_window, exclusive, session_duration_min, service_package_id,
    pack_purchase_id, pack_session_id, recurring_schedule_id
  )
  values (
    p_customer_id, ps.provider_id, ps.category_id, ps.id, v_address,
    coalesce(p_description, ''), p_scheduled_at, v_initial_status, 0, v_platform_fee,
    v_service_amount + v_platform_fee, 'time_based',
    tstzrange(p_scheduled_at, p_scheduled_at + (v_duration || ' minutes')::interval, '[)'),
    true, v_duration, p_service_package_id, p_pack_id, s.id, p_recurring_schedule_id
  )
  returning id into v_booking;

  insert into public.booking_secrets (booking_id, start_otp) values (v_booking, public._gen_otp());
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (v_booking, p_customer_id, null, v_initial_status, case when p_pack_id is null then 'session payment due' else 'pack session allocated' end);

  if p_pack_id is not null then
    update public.pack_sessions
       set booking_id = v_booking, status = 'allocated', allocated_at = now()
     where id = s.id;
  else
    insert into public.payment_schedule (booking_id, seq, label, amount, due_rule, due_at, status)
    values
      (v_booking, 1, 'Session service', v_service_amount, 'at_booking', now(), 'due'),
      (v_booking, 2, 'Platform fee', v_platform_fee, 'at_booking', now(), 'due');
  end if;
  return v_booking;
end;
$$;

create or replace function public.create_session_booking(
  p_provider_service_id uuid,
  p_service_package_id uuid,
  p_scheduled_at timestamptz,
  p_duration_min int,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision,
  p_description text default '',
  p_pack_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  return public._create_session_booking(
    v_uid, p_provider_service_id, p_service_package_id, p_scheduled_at, p_duration_min,
    p_address_line, p_city, p_lat, p_lng, p_description, p_pack_id, null
  );
end;
$$;

create or replace function public.prepare_session_payment(
  p_booking_id uuid, p_user_id uuid, p_schedule_id uuid default null
)
returns table (payment_id uuid, amount int, purpose public.payment_purpose, short_url text, schedule_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  o public.payment_schedule;
  p public.payments;
begin
  perform public._assert(b.customer_id = p_user_id, 'only the customer can pay');
  perform public._assert(b.archetype = 'time_based', 'not a session booking');
  perform public._assert(b.pack_purchase_id is null, 'prepaid pack sessions do not require payment');
  perform public._assert(b.status = 'pending_payment', 'session is not awaiting payment');

  select * into o
    from public.payment_schedule x
   where x.booking_id = b.id
     and x.status = 'due'
     and (p_schedule_id is null or x.id = p_schedule_id)
   order by x.seq
   limit 1
   for update;
  perform public._assert(found, 'selected payment obligation is not due');

  select * into p
    from public.payments x
   where x.schedule_id = o.id
     and x.status = 'created'
     and x.amount = o.amount
     and x.short_url is not null
   order by x.created_at desc
   limit 1;
  if found then
    return query select p.id, p.amount, p.purpose, p.short_url, p.schedule_id;
    return;
  end if;

  update public.payments
     set status = 'failed', cancel_link_pending = true
   where schedule_id = o.id and status = 'created';
  insert into public.payments (booking_id, schedule_id, purpose, amount)
  values (b.id, o.id, 'session', o.amount)
  returning * into p;
  return query select p.id, p.amount, p.purpose, null::text, p.schedule_id;
end;
$$;

create or replace function public.record_session_payment_paid(
  p_link_id text, p_payment_id text, p_amount int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  b public.bookings;
  o public.payment_schedule;
begin
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into p from public.payments where razorpay_link_id = p_link_id for update;
  if not found or p.booking_id is null or p.schedule_id is null then
    return jsonb_build_object('ok', false, 'error', 'not a session payment');
  end if;
  if p.amount <> p_amount then
    return jsonb_build_object('ok', false, 'error', 'amount mismatch');
  end if;
  b := public._lock_booking(p.booking_id);
  select * into o from public.payment_schedule where id = p.schedule_id for update;

  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
   where id = p.id;

  if p.status <> 'created' or b.archetype <> 'time_based' or o.status <> 'due' then
    perform public._queue_refund(p.id, p.amount, 'stale or excess session payment');
    return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund', true);
  end if;
  perform public._assert(o.amount = p.amount, 'obligation amount mismatch');
  update public.payment_schedule set status = 'paid', payment_id = p.id where id = o.id;

  if not exists (
    select 1 from public.payment_schedule x
     where x.booking_id = b.id and x.status in ('upcoming', 'due')
  ) and b.status = 'pending_payment' then
    perform public._set_status(b.id, 'requested', null, 'session paid');
  end if;
  return jsonb_build_object('ok', true, 'booking_id', b.id, 'schedule_id', o.id);
end;
$$;

create or replace function public.record_time_payment_paid(
  p_link_id text, p_payment_id text, p_amount int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
begin
  select * into p from public.payments where razorpay_link_id = p_link_id;
  if p.pack_purchase_id is not null then
    return public.record_pack_payment_paid(p_link_id, p_payment_id, p_amount);
  end if;
  return public.record_session_payment_paid(p_link_id, p_payment_id, p_amount);
end;
$$;

create or replace function public.start_session_booking(p_booking_id uuid, p_otp text)
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
  perform public._assert(b.provider_id = v_uid, 'only the provider can start the session');
  perform public._assert(b.archetype = 'time_based', 'not a session booking');
  perform public._assert(b.status = 'accepted', 'session is not accepted');
  perform public._assert(
    b.scheduled_at between now() - interval '15 minutes'
      and now() + interval '15 minutes',
    'start code is available only in the session window'
  );
  perform public._assert(
    not exists (
      select 1 from public.payment_schedule o
       where o.booking_id = b.id and o.status in ('upcoming', 'due')
    ),
    'payment is overdue'
  );
  select * into s from public.booking_secrets where booking_id = b.id for update;
  if s.start_attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'locked', 'attempts_left', 0);
  end if;
  if p_otp is distinct from s.start_otp then
    update public.booking_secrets set start_attempts = start_attempts + 1 where booking_id = b.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_otp', 'attempts_left', 4 - s.start_attempts);
  end if;
  update public.booking_secrets set start_attempts = 0 where booking_id = b.id;
  perform public._set_status(b.id, 'in_progress', v_uid, 'session start code verified');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.request_session_completion(p_booking_id uuid)
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
  perform public._assert(b.archetype = 'time_based' and b.status = 'in_progress', 'session is not in progress');
  update public.booking_secrets set end_otp = public._gen_otp(), end_attempts = 0 where booking_id = b.id;
  update public.bookings set completion_requested_at = now() where id = b.id;
  perform public._set_status(b.id, 'completion_requested', v_uid);
end;
$$;

create or replace function public._finalize_session_completion(p_booking_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  ps public.pack_sessions;
  k public.pack_purchases;
  p public.payments;
  v_payout uuid;
  v_bp int;
  v_commission int;
  v_gst int;
  v_net int;
  v_capacity int;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.pack_session_id is not null then
    select * into ps from public.pack_sessions where id = b.pack_session_id for update;
    select * into k from public.pack_purchases where id = b.pack_purchase_id for update;
    perform public._assert(k.payment_id is not null, 'pack payment is missing');
    select * into p from public.payments where id = k.payment_id and status = 'paid' for update;
  else
    select pm.* into p
      from public.payments pm
      join public.payment_schedule o on o.id = pm.schedule_id
     where pm.booking_id = b.id
       and pm.status = 'paid'
       and o.label = 'Session service'
     order by pm.paid_at
     limit 1
     for update of pm;
  end if;
  perform public._assert(p.id is not null, 'session payment is missing');

  if now() < (select created_at + interval '30 days' from public.providers where id = b.provider_id) then
    v_bp := 0;
  elsif b.recurring_schedule_id is not null then
    v_bp := 800;
  else
    v_bp := 1000;
  end if;
  v_commission := round(b.total_amount::numeric - coalesce(b.platform_fee, 0))::int;
  v_commission := round(v_commission::numeric * v_bp / 10000)::int;
  v_gst := round(v_commission::numeric * 18 / 100)::int;
  v_net := greatest((b.total_amount - b.platform_fee) - v_commission - v_gst, 0);
  v_capacity := p.amount
    - coalesce((select sum(t.amount) from public.payout_transfers t where t.source_payment_id = p.id), 0)
    - coalesce((select sum(r.amount) from public.refunds r where r.payment_id = p.id and r.status <> 'failed'), 0);
  perform public._assert(v_capacity >= v_net, 'pack payment does not cover provider payout');

  insert into public.payouts (
    booking_id, provider_id, gross, commission, gst_on_commission, amount, release_after
  )
  values (
    b.id, b.provider_id, b.total_amount - b.platform_fee,
    v_commission, v_gst, v_net, now() + interval '24 hours'
  )
  on conflict (booking_id) do nothing
  returning id into v_payout;
  if v_payout is not null then
    insert into public.payout_transfers (payout_id, source_payment_id, amount) values (v_payout, p.id, v_net);
    update public.bookings
       set completed_at = now(), commission = v_commission, gst_on_commission = v_gst
     where id = b.id;
    update public.providers
       set jobs_completed = jobs_completed + 1
     where id = b.provider_id;
    update public.pack_sessions
       set status = 'completed', completed_at = now()
     where id = b.pack_session_id;
    perform public._set_status(b.id, 'completed', p_actor, 'session completed');
  end if;
end;
$$;

create or replace function public.complete_session_booking(p_booking_id uuid, p_otp text)
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
  perform public._assert(b.provider_id = v_uid, 'only the provider can complete the session');
  perform public._assert(b.archetype = 'time_based' and b.status = 'completion_requested', 'session completion was not requested');
  select * into s from public.booking_secrets where booking_id = b.id for update;
  if s.end_attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'locked', 'attempts_left', 0);
  end if;
  if s.end_otp is null or p_otp is distinct from s.end_otp then
    update public.booking_secrets set end_attempts = end_attempts + 1 where booking_id = b.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_otp', 'attempts_left', 4 - s.end_attempts);
  end if;
  perform public._finalize_session_completion(b.id, v_uid);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.confirm_session_completion(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can confirm the session');
  perform public._assert(b.archetype = 'time_based' and b.status = 'completion_requested', 'session completion was not requested');
  perform public._finalize_session_completion(b.id, v_uid);
end;
$$;

create or replace function public._cancel_session_booking(
  p_booking_id uuid, p_actor uuid, p_provider_fault boolean, p_reason text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  v_hours numeric;
  v_refund int := 0;
begin
  perform public._assert(
    b.archetype = 'time_based'
    and b.status in ('pending_payment', 'requested', 'accepted'),
    'session can no longer be cancelled'
  );
  v_hours := extract(epoch from (b.scheduled_at - now())) / 3600.0;

  update public.payments
     set status = 'failed', cancel_link_pending = true
   where booking_id = b.id and status = 'created';
  update public.bookings set cancelled_reason = p_reason where id = b.id;

  if b.pack_session_id is not null then
    update public.pack_sessions
       set booking_id = null,
           status = case when p_provider_fault or v_hours >= 12 then 'available' else 'consumed' end,
           allocated_at = null
     where id = b.pack_session_id;
    if not p_provider_fault and v_hours < 12 then
      perform public._finalize_session_completion(b.id, p_actor);
      update public.pack_sessions
         set status = 'consumed', booking_id = b.id
       where id = b.pack_session_id;
      return 0;
    end if;
  elsif p_provider_fault or v_hours >= 12 then
    v_refund := public._refund_booking_payments(b.id, coalesce(p_reason, 'session cancelled'));
    update public.bookings set refund_amount = refund_amount + v_refund where id = b.id;
  else
    perform public._finalize_session_completion(b.id, p_actor);
  end if;

  if b.status <> 'completed' then
    perform public._set_status(b.id, 'cancelled', p_actor, p_reason);
  end if;
  update public.bookings set refund_amount = refund_amount + v_refund where id = b.id;
  return v_refund;
end;
$$;

create or replace function public.cancel_session_booking(p_booking_id uuid, p_reason text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can cancel this session');
  return public._cancel_session_booking(b.id, v_uid, false, coalesce(p_reason, 'customer cancellation'));
end;
$$;

create or replace function public.decline_session_booking(p_booking_id uuid, p_reason text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can cancel this session');
  perform public._assert(coalesce(trim(p_reason), '') <> '', 'reason is required');
  return public._cancel_session_booking(b.id, v_uid, true, p_reason);
end;
$$;

create or replace function public.extend_session_pack(p_pack_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  k public.pack_purchases;
begin
  select * into k from public.pack_purchases where id = p_pack_id for update;
  perform public._assert(k.customer_id = v_uid, 'only the customer can extend the pack');
  perform public._assert(k.status = 'active', 'pack is not active');
  perform public._assert(not k.extension_used, 'the one free extension has already been used');
  perform public._assert(k.expires_at > now() - interval '7 days', 'pack extension window has passed');
  update public.pack_purchases
     set expires_at = expires_at + interval '30 days',
         extension_used = true, extension_used_at = now()
   where id = k.id
  returning expires_at into k.expires_at;
  return k.expires_at;
end;
$$;

create or replace function public.cancel_session_pack(p_pack_id uuid, p_reason text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  k public.pack_purchases;
  b record;
  v_unused int;
  v_refund int := 0;
begin
  select * into k from public.pack_purchases where id = p_pack_id for update;
  perform public._assert(k.customer_id = v_uid, 'only the customer can cancel the pack');
  perform public._assert(k.status = 'active', 'pack is not active');
  perform public._assert(k.payment_id is not null, 'pack payment is missing');

  for b in
    select bk.id from public.bookings bk
     join public.pack_sessions ps on ps.booking_id = bk.id
     where ps.pack_id = k.id
       and bk.status in ('pending_payment', 'requested', 'accepted')
     for update of bk
  loop
    perform public._cancel_session_booking(b.id, v_uid, false, coalesce(p_reason, 'pack cancelled'));
  end loop;

  select coalesce(sum(allocated_amount), 0)::int into v_unused
    from public.pack_sessions
   where pack_id = k.id and status = 'available';
  if v_unused > 0 then
    v_refund := public._queue_refund(k.payment_id, v_unused - least(round(v_unused * 0.10), 20000), 'unused pack sessions');
  end if;
  update public.pack_sessions
     set status = 'refunded'
   where pack_id = k.id and status = 'available';
  update public.recurring_schedules
     set status = 'cancelled', cancelled_at = now(), updated_at = now()
   where pack_purchase_id = k.id and status in ('active', 'paused');
  update public.pack_purchases
     set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason, refund_amount = refund_amount + v_refund
   where id = k.id;
  return v_refund;
end;
$$;

create or replace function public.create_recurring_schedule(
  p_provider_service_id uuid,
  p_service_package_id uuid,
  p_pack_id uuid,
  p_payment_mode text,
  p_weekdays smallint[],
  p_start_time time,
  p_timezone text,
  p_duration_min int,
  p_starts_on date,
  p_ends_on date,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision,
  p_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  ps public.provider_services;
  k public.pack_purchases;
  v_id uuid;
begin
  select * into ps from public.provider_services where id = p_provider_service_id and active;
  perform public._assert(found, 'service not available');
  perform public._assert(public._provider_is_live(ps.provider_id), 'provider is not available');
  perform public._assert(ps.provider_id <> v_uid, 'cannot schedule your own service');
  perform public._assert(p_payment_mode in ('per_session', 'pack_prepaid', 'monthly_prepaid'), 'invalid recurring payment mode');
  perform public._assert(
    coalesce(cardinality(p_weekdays), 0) between 1 and 7
      and p_weekdays <@ array[1,2,3,4,5,6,7]::smallint[],
    'weekdays must be ISO days 1 through 7'
  );
  perform public._assert(p_duration_min between 15 and 480, 'invalid session duration');
  perform public._assert(p_starts_on >= current_date, 'recurring start date is in the past');
  perform public._assert(p_ends_on is null or p_ends_on <= p_starts_on + interval '366 days', 'recurring schedule may span at most one year');
  if p_service_package_id is not null then
    perform public._assert_session_package(ps.id, p_service_package_id);
  end if;
  if p_payment_mode in ('pack_prepaid', 'monthly_prepaid') then
    select * into k from public.pack_purchases where id = p_pack_id and status = 'active' for update;
    perform public._assert(
      found and k.customer_id = v_uid and k.provider_service_id = ps.id and k.expires_at > now(),
      'an active matching pack is required for prepaid recurrence'
    );
  end if;

  insert into public.recurring_schedules (
    customer_id, provider_id, provider_service_id, service_package_id, pack_purchase_id,
    weekdays, start_time, timezone, session_duration_min, payment_mode,
    address_line, city, lat, lng, description, starts_on, ends_on
  )
  values (
    v_uid, ps.provider_id, ps.id, p_service_package_id, p_pack_id,
    array(select distinct x from unnest(p_weekdays) x order by x),
    p_start_time, coalesce(nullif(trim(p_timezone), ''), 'Asia/Kolkata'), p_duration_min,
    p_payment_mode, trim(p_address_line), trim(p_city), p_lat, p_lng,
    coalesce(p_description, ''), p_starts_on, p_ends_on
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.materialize_recurring_schedule(
  p_schedule_id uuid, p_through_date date default (current_date + 28)::date
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.recurring_schedules;
  d date;
  v_at timestamptz;
  v_created int := 0;
begin
  select * into r from public.recurring_schedules where id = p_schedule_id for update;
  perform public._assert(found and r.status = 'active', 'recurring schedule is not active');
  p_through_date := least(p_through_date, coalesce(r.ends_on, p_through_date));
  d := greatest(r.starts_on, coalesce(r.generated_through + 1, current_date));

  while d <= p_through_date loop
    if extract(isodow from d)::smallint = any(r.weekdays) then
      v_at := make_timestamptz(
        extract(year from d)::int,
        extract(month from d)::int,
        extract(day from d)::int,
        extract(hour from r.start_time)::int,
        extract(minute from r.start_time)::int,
        extract(second from r.start_time),
        r.timezone
      );
      begin
        perform public._create_session_booking(
          r.customer_id, r.provider_service_id, r.service_package_id, v_at,
          r.session_duration_min, r.address_line, r.city, r.lat, r.lng, r.description,
          case when r.payment_mode in ('pack_prepaid', 'monthly_prepaid') then r.pack_purchase_id else null end,
          r.id
        );
        v_created := v_created + 1;
      exception
        when unique_violation then
          null;
      end;
    end if;
    d := d + 1;
  end loop;

  update public.recurring_schedules
     set generated_through = greatest(coalesce(generated_through, p_through_date), p_through_date),
         updated_at = now(),
         status = case when ends_on is not null and ends_on <= p_through_date then 'completed' else status end
   where id = r.id;
  return v_created;
end;
$$;

create or replace function public.generate_recurring_sessions(p_limit int default 50)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_total int := 0;
begin
  for r in
    select id from public.recurring_schedules
     where status = 'active'
     order by coalesce(generated_through, starts_on), id
     limit greatest(least(p_limit, 500), 1)
     for update skip locked
  loop
    v_total := v_total + public.materialize_recurring_schedule(r.id, (current_date + 28)::date);
  end loop;
  return v_total;
end;
$$;

create or replace function public.cancel_recurring_schedule(p_schedule_id uuid, p_cancel_future boolean default true)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  r public.recurring_schedules;
  b record;
  v_cancelled int := 0;
begin
  select * into r from public.recurring_schedules where id = p_schedule_id for update;
  perform public._assert(r.customer_id = v_uid, 'only the customer can cancel this schedule');
  perform public._assert(r.status in ('active', 'paused'), 'schedule is already closed');
  update public.recurring_schedules
     set status = 'cancelled', cancelled_at = now(), updated_at = now()
   where id = r.id;

  if p_cancel_future then
    for b in
      select id from public.bookings
       where recurring_schedule_id = r.id
         and status in ('pending_payment', 'requested', 'accepted')
       for update
    loop
      perform public._cancel_session_booking(b.id, v_uid, false, 'recurring schedule cancelled');
      v_cancelled := v_cancelled + 1;
    end loop;
  end if;
  return v_cancelled;
end;
$$;

create or replace function public.expire_session_packs(p_limit int default 100)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.pack_purchases;
  b record;
  v_unused int;
  v_penalty int;
  v_refund int;
  v_provider_fault boolean;
  v_count int := 0;
begin
  for k in
    select * from public.pack_purchases
     where status = 'active' and expires_at <= now()
     order by expires_at
     limit greatest(least(p_limit, 1000), 1)
     for update skip locked
  loop
    select (pr.suspended or coalesce(pr.paused, false) or pr.kyc_status <> 'verified') into v_provider_fault
      from public.providers pr
     where pr.id = k.provider_id;
    for b in
      select bk.id from public.bookings bk
       join public.pack_sessions ps on ps.booking_id = bk.id
       where ps.pack_id = k.id
         and bk.status in ('pending_payment', 'requested', 'accepted')
       for update of bk
    loop
      perform public._cancel_session_booking(
        b.id, null, coalesce(v_provider_fault, false),
        case when v_provider_fault then 'provider unavailable: pack refund' else 'pack expired' end
      );
    end loop;

    select coalesce(sum(allocated_amount), 0)::int into v_unused
      from public.pack_sessions
     where pack_id = k.id and status = 'available';
    v_penalty := case when coalesce(v_provider_fault, false) then 0 else least(round(v_unused * 0.10), 20000) end;
    v_refund := 0;
    if v_unused > 0 and k.payment_id is not null then
      v_refund := public._queue_refund(
        k.payment_id,
        v_unused - v_penalty
          + case when v_provider_fault and v_unused = k.price then k.platform_fee else 0 end,
        case when v_provider_fault then 'provider unavailable: unused pack refund' else 'expired unused pack sessions' end
      );
    end if;
    update public.pack_sessions
       set status = 'refunded'
     where pack_id = k.id and status in ('available', 'cancelled', 'expired');
    update public.recurring_schedules
       set status = 'cancelled', cancelled_at = now(), updated_at = now()
     where pack_purchase_id = k.id and status in ('active', 'paused');
    update public.pack_purchases
       set status = case when v_unused = k.price then 'refunded' else 'expired' end,
           refund_amount = refund_amount + v_refund,
           cancelled_at = now(),
           cancellation_reason = case when v_provider_fault then 'provider unavailable' else 'pack expired' end
     where id = k.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and RPC grants
-- ---------------------------------------------------------------------------
alter table public.pack_purchases enable row level security;
alter table public.pack_sessions enable row level security;
alter table public.recurring_schedules enable row level security;

revoke all on public.pack_purchases, public.pack_sessions, public.recurring_schedules
  from anon, authenticated;
grant select on public.pack_purchases, public.pack_sessions, public.recurring_schedules
  to authenticated;

create policy pack_purchases_participants on public.pack_purchases
  for select to authenticated
  using (customer_id = auth.uid() or provider_id = auth.uid() or public._is_admin());
create policy pack_sessions_participants on public.pack_sessions
  for select to authenticated
  using (exists (
    select 1 from public.pack_purchases k
     where k.id = pack_sessions.pack_id
       and (k.customer_id = auth.uid() or k.provider_id = auth.uid() or public._is_admin())
  ));
create policy recurring_schedules_participants on public.recurring_schedules
  for select to authenticated
  using (customer_id = auth.uid() or provider_id = auth.uid() or public._is_admin());

revoke execute on function
  public._pack_ledger_immutable(),
  public._pack_purchase_money_immutable(),
  public._assert_session_package(uuid, uuid),
  public._create_session_booking(uuid, uuid, uuid, timestamptz, int, text, text, double precision, double precision, text, uuid, uuid),
  public._finalize_session_completion(uuid, uuid),
  public._cancel_session_booking(uuid, uuid, boolean, text),
  public.prepare_pack_payment(uuid, uuid),
  public.record_pack_payment_paid(text, text, int),
  public.record_session_payment_paid(text, text, int),
  public.record_time_payment_paid(text, text, int),
  public.prepare_session_payment(uuid, uuid, uuid),
  public.materialize_recurring_schedule(uuid, date),
  public.generate_recurring_sessions(int),
  public.expire_session_packs(int)
from public, anon, authenticated;

grant execute on function
  public.list_session_packages(uuid),
  public.purchase_session_pack(uuid, int),
  public.create_session_booking(uuid, uuid, timestamptz, int, text, text, double precision, double precision, text, uuid),
  public.start_session_booking(uuid, text),
  public.request_session_completion(uuid),
  public.complete_session_booking(uuid, text),
  public.confirm_session_completion(uuid),
  public.cancel_session_booking(uuid, text),
  public.decline_session_booking(uuid, text),
  public.extend_session_pack(uuid),
  public.cancel_session_pack(uuid, text),
  public.create_recurring_schedule(uuid, uuid, uuid, text, smallint[], time, text, int, date, date, text, text, double precision, double precision, text),
  public.cancel_recurring_schedule(uuid, boolean)
to authenticated;

grant execute on function
  public.prepare_pack_payment(uuid, uuid),
  public.prepare_session_payment(uuid, uuid, uuid),
  public.record_pack_payment_paid(text, text, int),
  public.record_session_payment_paid(text, text, int),
  public.record_time_payment_paid(text, text, int),
  public.materialize_recurring_schedule(uuid, date),
  public.generate_recurring_sessions(int),
  public.expire_session_packs(int)
to service_role;

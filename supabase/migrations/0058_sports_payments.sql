-- Sports online payments, capacity reservations, refunds, and venue-owner settlement.

alter table public.sports_venues
  add column payment_modes text[] not null default array['pay_at_venue']::text[],
  add column cancellation_rules jsonb,
  add constraint sports_venues_payment_modes_check check (
    cardinality(payment_modes) > 0
    and payment_modes <@ array['online', 'pay_at_venue']::text[]
  ),
  add constraint sports_venues_cancellation_rules_check check (
    cancellation_rules is null or jsonb_typeof(cancellation_rules) = 'object'
  );

alter table public.sports_resources
  add column booking_mode text not null default 'approval',
  add column capacity int not null default 1,
  add constraint sports_resources_booking_mode_check check (booking_mode in ('instant', 'approval')),
  add constraint sports_resources_capacity_check check (capacity between 1 and 100);

alter table public.sports_bookings
  drop constraint if exists sports_bookings_status_check,
  add column payment_mode text not null default 'pay_at_venue',
  add column participants int not null default 1,
  add column hold_expires_at timestamptz,
  add column pay_by timestamptz,
  add column customer_fee_paise int not null default 0,
  add column total_paise int,
  add column commission_bp int,
  add column refund_paise int not null default 0,
  add column paid_at timestamptz,
  add column idempotency_key text;

update public.sports_bookings
   set total_paise = price_paise
 where total_paise is null;

alter table public.sports_bookings
  add constraint sports_bookings_status_check check (
    status in ('requested', 'accepted', 'declined', 'cancelled', 'completed', 'expired',
               'pending_payment', 'awaiting_payment')
  ),
  add constraint sports_bookings_payment_mode_check check (payment_mode in ('online', 'pay_at_venue')),
  add constraint sports_bookings_participants_check check (participants between 1 and 50),
  add constraint sports_bookings_customer_fee_paise_check check (customer_fee_paise >= 0),
  add constraint sports_bookings_total_paise_check check (total_paise is null or total_paise >= 0),
  add constraint sports_bookings_commission_bp_check check (commission_bp between 0 and 5000),
  add constraint sports_bookings_refund_paise_check check (refund_paise >= 0);

create unique index sports_bookings_customer_idempotency_idx
  on public.sports_bookings (customer_id, idempotency_key)
  where idempotency_key is not null;
create index sports_bookings_resource_capacity_idx
  on public.sports_bookings (resource_id, starts_at, ends_at, status);

alter table public.payments
  add column sports_booking_id uuid references public.sports_bookings (id);

alter table public.payments
  drop constraint if exists payments_booking_or_pack,
  add constraint payments_booking_or_pack
    check (num_nonnulls(booking_id, pack_purchase_id, sports_booking_id) = 1);

create unique index payments_sports_booking_created_idx
  on public.payments (sports_booking_id)
  where sports_booking_id is not null and status = 'created';
create index payments_sports_booking_idx
  on public.payments (sports_booking_id, paid_at desc)
  where sports_booking_id is not null;

alter table public.payouts
  alter column booking_id drop not null,
  alter column provider_id drop not null,
  add column sports_booking_id uuid unique references public.sports_bookings (id),
  add column payee_id uuid references public.profiles (id);

alter table public.payouts
  add constraint payouts_booking_or_sports_booking_check
    check (num_nonnulls(booking_id, sports_booking_id) = 1),
  add constraint payouts_provider_or_payee_check
    check (coalesce(provider_id, payee_id) is not null);

create index payouts_payee_idx on public.payouts (payee_id, created_at desc)
  where payee_id is not null;

do $$
declare
  v_constraint text;
begin
  select c.conname into v_constraint
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.provider_payout_accounts'::regclass
     and c.confrelid = 'public.providers'::regclass
     and c.contype = 'f'
     and a.attname = 'provider_id'
   limit 1;
  if v_constraint is not null then
    execute format('alter table public.provider_payout_accounts drop constraint %I', v_constraint);
  end if;
end;
$$;

alter table public.provider_payout_accounts
  add constraint provider_payout_accounts_profile_id_fkey
  foreign key (provider_id) references public.profiles (id) on delete cascade;

alter table public.provider_payout_accounts
  add column if not exists activation_event_at timestamptz;

update public.provider_payout_accounts pa
   set activation_event_at = p.kyc_updated_at
  from public.providers p
 where p.id = pa.provider_id
   and pa.activation_event_at is null
   and p.kyc_updated_at is not null;

create or replace function public.sync_venue_payout_status(
  p_account_id text,
  p_status text,
  p_requirements jsonb default '[]'::jsonb,
  p_event_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_seen timestamptz;
  v_status text;
  v_event_at timestamptz := coalesce(p_event_at, now());
  v_requirements jsonb;
begin
  select pa.provider_id, pa.activation_event_at, pa.activation_status
    into v_owner_id, v_seen, v_status
    from public.provider_payout_accounts pa
   where pa.razorpay_account_id = p_account_id or pa.fund_account_id = p_account_id
   for update;
  if v_owner_id is null
     or exists (select 1 from public.providers p where p.id = v_owner_id)
     or not exists (select 1 from public.sports_venues v where v.owner_id = v_owner_id) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_venue_account');
  end if;
  if v_seen is not null and v_event_at < v_seen then
    return jsonb_build_object('ok', true, 'stale', true, 'payee_id', v_owner_id,
                              'activation_status', v_status);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'field_reference', left(r ->> 'field_reference', 80),
           'reason_code', left(r ->> 'reason_code', 40),
           'description', left(r ->> 'description', 200)
         )), '[]'::jsonb)
    into v_requirements
    from jsonb_array_elements(
      case when jsonb_typeof(p_requirements) = 'array' then p_requirements else '[]'::jsonb end
    ) r;

  update public.provider_payout_accounts
     set activation_status = coalesce(p_status, activation_status),
         requirements = v_requirements,
         activation_event_at = v_event_at,
         updated_at = now(),
         last_error = case when p_status = 'activated' then null else last_error end
   where provider_id = v_owner_id;

  return jsonb_build_object(
    'ok', true, 'payee_id', v_owner_id, 'activation_status', p_status, 'stale', false
  );
end;
$$;

create or replace function public.sync_provider_payout_status(
  p_account_id text,
  p_status text,
  p_requirements jsonb default '[]'::jsonb,
  p_event_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid;
  v_old text;
  v_new public.kyc_status := public._map_gateway_status(p_status);
  v_seen timestamptz;
  v_requirements jsonb;
  v_reason text;
begin
  select provider_id into v_provider
    from public.provider_payout_accounts
   where razorpay_account_id = p_account_id or fund_account_id = p_account_id;
  if v_provider is null then
    select id into v_provider from public.providers where razorpay_account_id = p_account_id;
  end if;
  if v_provider is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_account');
  end if;
  select kyc_status::text, kyc_updated_at into v_old, v_seen
    from public.providers where id = v_provider for update;
  if v_seen is not null and p_event_at < v_seen then
    return jsonb_build_object('ok', true, 'stale', true, 'provider_id', v_provider, 'kyc_status', v_old);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'field_reference', left(r ->> 'field_reference', 80),
           'reason_code', left(r ->> 'reason_code', 40),
           'description', left(r ->> 'description', 200)
         )), '[]'::jsonb),
           (array_agg(left(r ->> 'description', 200))
             filter (where r ->> 'description' is not null))[1]
    into v_requirements, v_reason
    from jsonb_array_elements(
      case when jsonb_typeof(p_requirements) = 'array' then p_requirements else '[]'::jsonb end
    ) r;

  update public.providers
     set kyc_status = v_new,
         razorpay_account_id = case when p_account_id like 'acc\_%' then p_account_id else razorpay_account_id end,
         kyc_reference = p_account_id,
         kyc_requirements = v_requirements,
         kyc_reason = case when v_new = 'verified' then null else v_reason end,
         kyc_updated_at = p_event_at
   where id = v_provider;
  update public.provider_payout_accounts
     set activation_status = coalesce(p_status, activation_status),
         requirements = v_requirements,
         activation_event_at = p_event_at,
         updated_at = now(),
         last_error = case when v_new = 'verified' then null else last_error end
   where provider_id = v_provider;
  if v_old is distinct from v_new::text then
    perform public._log_onboarding_event(
      v_provider, 'payout_status_changed',
      jsonb_build_object('from', v_old, 'to', v_new, 'gateway_status', p_status)
    );
  end if;
  return jsonb_build_object(
    'ok', true, 'provider_id', v_provider, 'kyc_status', v_new, 'changed', v_old is distinct from v_new::text
  );
end;
$$;

drop policy if exists payouts_provider on public.payouts;
create policy payouts_provider on public.payouts for select to authenticated
  using (provider_id = auth.uid() or payee_id = auth.uid());

drop policy if exists payout_transfers_provider on public.payout_transfers;
create policy payout_transfers_provider on public.payout_transfers for select to authenticated
  using (
    exists (
      select 1 from public.payouts po
       where po.id = payout_id and coalesce(po.provider_id, po.payee_id) = auth.uid()
    )
  );

drop policy if exists sports_bookings_participant_read on public.sports_bookings;
create policy sports_bookings_participant_read on public.sports_bookings for select to authenticated
  using (
    coalesce((public.get_app_features() ->> 'sports')::boolean, false)
    and (
      customer_id = auth.uid()
      or exists (
        select 1 from public.sports_venues v
         where v.id = venue_id and public._acts_for(v.owner_id, 'staff')
      )
    )
  );

-- Venue owners use the same profile-keyed payout-account table as providers.
-- Provider-only onboarding events remain scoped to rows in public.providers.
create or replace function public._log_onboarding_event(
  p_provider_id uuid, p_kind text, p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.provider_onboarding_events (provider_id, kind, details)
  select p_provider_id, p_kind, coalesce(p_details, '{}'::jsonb)
   where exists (select 1 from public.providers p where p.id = p_provider_id);
$$;

create or replace function public.save_sports_venue(
  p_id uuid,
  p_name text,
  p_description text,
  p_address_line text,
  p_city text,
  p_area text,
  p_lat double precision,
  p_lng double precision,
  p_amenities text[],
  p_photos text[],
  p_payment_modes text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_id uuid;
  v_existing public.sports_venues%rowtype;
  v_resource_id uuid;
  v_amenities text[] := array(select btrim(x) from unnest(coalesce(p_amenities, '{}')) x where btrim(x) <> '');
  v_photos text[] := array(select btrim(x) from unnest(coalesce(p_photos, '{}')) x where btrim(x) <> '');
  v_payment_modes text[] := coalesce(p_payment_modes, '{}');
  v_details_changed boolean;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(char_length(btrim(coalesce(p_name, ''))) between 2 and 120, 'venue name must be 2 to 120 characters');
  perform public._assert(char_length(btrim(coalesce(p_address_line, ''))) between 3 and 300, 'address is required');
  perform public._assert(char_length(btrim(coalesce(p_city, ''))) between 2 and 80, 'city is required');
  perform public._assert(char_length(btrim(coalesce(p_area, ''))) between 2 and 80, 'area is required');
  perform public._assert(p_lat between -90 and 90 and p_lng between -180 and 180, 'valid venue coordinates are required');
  perform public._assert(char_length(coalesce(p_description, '')) <= 2000, 'description is too long');
  perform public._assert(cardinality(v_amenities) <= 20, 'up to 20 amenities are allowed');
  perform public._assert(cardinality(v_photos) <= 12, 'up to 12 photo URLs are allowed');
  perform public._assert(not exists (select 1 from unnest(v_photos) x where x !~* '^https://'), 'photo URLs must use https');
  perform public._assert(
    cardinality(v_payment_modes) between 1 and 2
      and v_payment_modes <@ array['online', 'pay_at_venue']::text[],
    'payment modes must include online, pay_at_venue, or both'
  );

  if p_id is null then
    insert into public.sports_venues
      (owner_id, name, description, address_line, city, area, lat, lng, amenities, photos, payment_modes)
    values
      (v_uid, btrim(p_name), coalesce(p_description, ''), btrim(p_address_line), btrim(p_city),
       btrim(p_area), p_lat, p_lng, v_amenities, v_photos, v_payment_modes)
    returning id into v_id;
  else
    select * into v_existing from public.sports_venues
     where id = p_id and owner_id = v_uid and status <> 'suspended'
     for update;
    perform public._assert(found, 'venue not found, suspended, or not owned by you');
    perform pg_advisory_xact_lock(hashtext('sports-venue:' || p_id::text));
    for v_resource_id in
      select r.id from public.sports_resources r where r.venue_id = p_id order by r.id
    loop
      perform pg_advisory_xact_lock(hashtext(v_resource_id::text));
    end loop;
    v_details_changed :=
      v_existing.name is distinct from btrim(p_name)
      or v_existing.description is distinct from coalesce(p_description, '')
      or v_existing.address_line is distinct from btrim(p_address_line)
      or v_existing.city is distinct from btrim(p_city)
      or v_existing.area is distinct from btrim(p_area)
      or v_existing.lat is distinct from p_lat
      or v_existing.lng is distinct from p_lng
      or v_existing.amenities is distinct from v_amenities
      or v_existing.photos is distinct from v_photos;
    update public.sports_venues
       set name = btrim(p_name), description = coalesce(p_description, ''),
           address_line = btrim(p_address_line), city = btrim(p_city), area = btrim(p_area),
           lat = p_lat, lng = p_lng, amenities = v_amenities, photos = v_photos,
           payment_modes = v_payment_modes,
           status = case when v_details_changed then 'draft' else status end,
           status_reason = case when v_details_changed then '' else status_reason end,
           updated_at = now()
     where id = p_id and owner_id = v_uid;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.save_sports_resource(
  p_venue_id uuid,
  p_id uuid,
  p_activity_id uuid,
  p_name text,
  p_slot_minutes int,
  p_active boolean,
  p_booking_mode text,
  p_capacity int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_id uuid;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(exists (
    select 1 from public.sports_venues v where v.id = p_venue_id and v.owner_id = v_uid
  ), 'venue not found or not owned by you');
  perform public._assert(exists (
    select 1 from public.sports_activities a where a.id = p_activity_id and a.active
  ), 'activity is unavailable');
  perform public._assert(char_length(btrim(coalesce(p_name, ''))) between 2 and 80, 'resource name must be 2 to 80 characters');
  perform public._assert(p_slot_minutes in (30, 60, 90, 120), 'slot length must be 30, 60, 90 or 120 minutes');
  perform public._assert(p_active is not null, 'active is required');
  perform public._assert(p_booking_mode in ('instant', 'approval'), 'booking mode must be instant or approval');
  perform public._assert(p_capacity between 1 and 100, 'capacity must be between 1 and 100');
  perform pg_advisory_xact_lock(hashtext('sports-venue:' || p_venue_id::text));
  if p_id is not null then
    perform pg_advisory_xact_lock(hashtext(p_id::text));
  end if;
  perform public._assert(exists (
    select 1 from public.sports_venues v where v.id = p_venue_id and v.owner_id = v_uid
  ), 'venue not found or not owned by you');

  if p_id is null then
    insert into public.sports_resources
      (venue_id, activity_id, name, slot_minutes, active, booking_mode, capacity)
    values
      (p_venue_id, p_activity_id, btrim(p_name), p_slot_minutes, p_active, p_booking_mode, p_capacity)
    returning id into v_id;
  else
    update public.sports_resources
       set activity_id = p_activity_id, name = btrim(p_name), slot_minutes = p_slot_minutes,
           active = p_active, booking_mode = p_booking_mode, capacity = p_capacity
     where id = p_id and venue_id = p_venue_id;
    perform public._assert(found, 'resource not found for this venue');
    v_id := p_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.get_my_sports_venues()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_result jsonb;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  select coalesce(jsonb_agg(jsonb_build_object(
    'venue', to_jsonb(v),
    'online_payment_ready', coalesce(
      public._sports_feature('sports_online_payments')
      and 'online' = any(v.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts pa
         where pa.provider_id = v.owner_id and pa.activation_status = 'activated'
      ),
      false
    ),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'venue_id', r.venue_id, 'activity_id', a.id, 'activity_slug', a.slug,
        'activity_name', a.name, 'name', r.name, 'slot_minutes', r.slot_minutes, 'active', r.active,
        'booking_mode', r.booking_mode, 'capacity', r.capacity
      ) order by r.created_at)
        from public.sports_resources r join public.sports_activities a on a.id = r.activity_id
       where r.venue_id = v.id
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.weekday) from public.sports_hours h where h.venue_id = v.id
    ), '[]'::jsonb),
    'price_rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id, 'resource_id', pr.resource_id, 'weekday', pr.weekday, 'starts', pr.starts,
        'ends', pr.ends, 'price_paise', pr.price_paise, 'label', pr.label
      ) order by pr.weekday nulls first, pr.starts)
        from public.sports_price_rules pr join public.sports_resources r on r.id = pr.resource_id
       where r.venue_id = v.id
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'resource_id', b.resource_id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'reason', b.reason
      ) order by b.starts_at)
        from public.sports_blocks b join public.sports_resources r on r.id = b.resource_id
       where r.venue_id = v.id
    ), '[]'::jsonb)
  ) order by v.created_at desc), '[]'::jsonb)
    into v_result
    from public.sports_venues v
   where v.owner_id = v_uid;
  return v_result;
end;
$$;

create or replace function public.get_sports_venue(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  select jsonb_build_object(
    'id', v.id, 'name', v.name, 'description', v.description, 'address_line', v.address_line,
    'city', v.city, 'area', v.area, 'lat', v.lat, 'lng', v.lng, 'amenities', v.amenities,
    'photos', v.photos, 'payment_modes', v.payment_modes,
    'online_payment_ready', coalesce(
      public._sports_feature('sports_online_payments')
      and 'online' = any(v.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts pa
         where pa.provider_id = v.owner_id and pa.activation_status = 'activated'
      ),
      false
    ),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'activity_id', a.id, 'activity_slug', a.slug,
        'activity_name', a.name, 'slot_minutes', r.slot_minutes,
        'booking_mode', r.booking_mode, 'capacity', r.capacity
      ) order by r.created_at)
        from public.sports_resources r
        join public.sports_activities a on a.id = r.activity_id
       where r.venue_id = v.id and r.active and a.active
    ), '[]'::jsonb)
  ) into v_result
    from public.sports_venues v
   where v.id = p_id and v.status = 'verified';
  return v_result;
end;
$$;

create or replace function public.get_my_business_sports_venues()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  select coalesce(jsonb_agg(jsonb_build_object(
    'venue', to_jsonb(v) || jsonb_build_object('business_role', public._business_role(v.owner_id)),
    'online_payment_ready', coalesce(
      public._sports_feature('sports_online_payments')
      and 'online' = any(v.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts pa
         where pa.provider_id = v.owner_id and pa.activation_status = 'activated'
      ),
      false
    ),
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'venue_id', r.venue_id, 'activity_id', a.id, 'activity_slug', a.slug,
        'activity_name', a.name, 'name', r.name, 'slot_minutes', r.slot_minutes, 'active', r.active,
        'booking_mode', r.booking_mode, 'capacity', r.capacity
      ) order by r.created_at)
        from public.sports_resources r
        join public.sports_activities a on a.id = r.activity_id
       where r.venue_id = v.id
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.weekday)
        from public.sports_hours h where h.venue_id = v.id
    ), '[]'::jsonb),
    'price_rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id, 'resource_id', pr.resource_id, 'weekday', pr.weekday, 'starts', pr.starts,
        'ends', pr.ends, 'price_paise', pr.price_paise, 'label', pr.label
      ) order by pr.weekday nulls first, pr.starts)
        from public.sports_price_rules pr
        join public.sports_resources r on r.id = pr.resource_id
       where r.venue_id = v.id
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'resource_id', b.resource_id, 'starts_at', b.starts_at,
        'ends_at', b.ends_at, 'reason', b.reason
      ) order by b.starts_at)
        from public.sports_blocks b
        join public.sports_resources r on r.id = b.resource_id
       where r.venue_id = v.id
    ), '[]'::jsonb)
  ) || case
    when v.owner_id = auth.uid() then jsonb_build_object(
      'payout_account_ready', exists (
        select 1 from public.provider_payout_accounts pa
         where pa.provider_id = v.owner_id and pa.activation_status = 'activated'
      )
    )
    else '{}'::jsonb
  end order by v.created_at desc), '[]'::jsonb)
    into v_result
    from public.sports_venues v
   where public._acts_for(v.owner_id, 'staff');
  return v_result;
end;
$$;

create or replace function public.get_my_sports_bookings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'customer_id', b.customer_id, 'customer_name', p.full_name,
    'owner_id', v.owner_id, 'venue_id', v.id, 'venue_name', v.name,
    'payment_modes', v.payment_modes,
    'online_payment_ready', coalesce(
      public._sports_feature('sports_online_payments')
      and 'online' = any(v.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts pa
         where pa.provider_id = v.owner_id and pa.activation_status = 'activated'
      ),
      false
    ),
    'resource_id', r.id, 'resource_name', r.name, 'activity_name', a.name,
    'booking_mode', r.booking_mode, 'capacity', r.capacity,
    'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
    'price_paise', b.price_paise, 'total_paise', b.total_paise,
    'customer_fee_paise', b.customer_fee_paise, 'refund_paise', b.refund_paise,
    'payment_mode', b.payment_mode, 'participants', b.participants,
    'hold_expires_at', b.hold_expires_at, 'pay_by', b.pay_by, 'paid_at', b.paid_at,
    'note', b.note, 'decision_reason', b.decision_reason,
    'expires_at', b.expires_at, 'decided_at', b.decided_at, 'created_at', b.created_at
  ) order by b.starts_at desc), '[]'::jsonb)
    into v_result
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
    join public.sports_resources r on r.id = b.resource_id
    join public.sports_activities a on a.id = r.activity_id
    join public.profiles p on p.id = b.customer_id
   where b.customer_id = v_uid or v.owner_id = v_uid;
  return v_result;
end;
$$;

create or replace function public.get_sports_booking(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', b.id, 'customer_id', b.customer_id, 'customer_name', p.full_name,
    'owner_id', v.owner_id, 'venue_id', v.id, 'venue_name', v.name,
    'payment_modes', v.payment_modes,
    'online_payment_ready', coalesce(
      public._sports_feature('sports_online_payments')
      and 'online' = any(v.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts pa
         where pa.provider_id = v.owner_id and pa.activation_status = 'activated'
      ),
      false
    ),
    'resource_id', r.id, 'resource_name', r.name, 'activity_name', a.name,
    'booking_mode', r.booking_mode, 'capacity', r.capacity,
    'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
    'price_paise', b.price_paise, 'total_paise', b.total_paise,
    'customer_fee_paise', b.customer_fee_paise, 'refund_paise', b.refund_paise,
    'payment_mode', b.payment_mode, 'participants', b.participants,
    'hold_expires_at', b.hold_expires_at, 'pay_by', b.pay_by, 'paid_at', b.paid_at,
    'note', b.note, 'decision_reason', b.decision_reason,
    'expires_at', b.expires_at, 'decided_at', b.decided_at, 'created_at', b.created_at
  ) into v_result
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
    join public.sports_resources r on r.id = b.resource_id
    join public.sports_activities a on a.id = r.activity_id
    join public.profiles p on p.id = b.customer_id
   where b.id = p_id and (b.customer_id = v_uid or v.owner_id = v_uid);
  perform public._assert(v_result is not null, 'booking not found');
  return v_result;
end;
$$;

create or replace function public.get_my_business_sports_bookings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_result jsonb;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'customer_id', b.customer_id, 'customer_name', p.full_name,
    'owner_id', v.owner_id, 'business_role', public._business_role(v.owner_id),
    'venue_id', v.id, 'venue_name', v.name, 'payment_modes', v.payment_modes,
    'online_payment_ready', coalesce(
      public._sports_feature('sports_online_payments')
      and 'online' = any(v.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts pa
         where pa.provider_id = v.owner_id and pa.activation_status = 'activated'
      ),
      false
    ),
    'resource_id', r.id, 'resource_name', r.name, 'activity_name', a.name,
    'booking_mode', r.booking_mode, 'capacity', r.capacity,
    'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
    'price_paise', b.price_paise, 'total_paise', b.total_paise,
    'customer_fee_paise', b.customer_fee_paise, 'refund_paise', b.refund_paise,
    'payment_mode', b.payment_mode, 'participants', b.participants,
    'hold_expires_at', b.hold_expires_at, 'pay_by', b.pay_by, 'paid_at', b.paid_at,
    'note', b.note, 'decision_reason', b.decision_reason,
    'expires_at', b.expires_at, 'decided_at', b.decided_at, 'created_at', b.created_at
  ) order by b.starts_at desc), '[]'::jsonb)
    into v_result
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
    join public.sports_resources r on r.id = b.resource_id
    join public.sports_activities a on a.id = r.activity_id
    join public.profiles p on p.id = b.customer_id
   where b.customer_id = v_uid or public._acts_for(v.owner_id, 'staff');
  return v_result;
end;
$$;

create or replace function public.get_business_sports_booking(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_result jsonb;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  select jsonb_build_object(
    'id', b.id, 'customer_id', b.customer_id, 'customer_name', p.full_name,
    'owner_id', v.owner_id, 'business_role', public._business_role(v.owner_id),
    'venue_id', v.id, 'venue_name', v.name, 'payment_modes', v.payment_modes,
    'online_payment_ready', coalesce(
      public._sports_feature('sports_online_payments')
      and 'online' = any(v.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts pa
         where pa.provider_id = v.owner_id and pa.activation_status = 'activated'
      ),
      false
    ),
    'resource_id', r.id, 'resource_name', r.name, 'activity_name', a.name,
    'booking_mode', r.booking_mode, 'capacity', r.capacity,
    'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
    'price_paise', b.price_paise, 'total_paise', b.total_paise,
    'customer_fee_paise', b.customer_fee_paise, 'refund_paise', b.refund_paise,
    'payment_mode', b.payment_mode, 'participants', b.participants,
    'hold_expires_at', b.hold_expires_at, 'pay_by', b.pay_by, 'paid_at', b.paid_at,
    'note', b.note, 'decision_reason', b.decision_reason,
    'expires_at', b.expires_at, 'decided_at', b.decided_at, 'created_at', b.created_at
  ) into v_result
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
    join public.sports_resources r on r.id = b.resource_id
    join public.sports_activities a on a.id = r.activity_id
    join public.profiles p on p.id = b.customer_id
   where b.id = p_id and (b.customer_id = v_uid or public._acts_for(v.owner_id, 'staff'));
  perform public._assert(v_result is not null, 'booking not found');
  return v_result;
end;
$$;

drop function if exists public.get_sports_slots(uuid, date);
create function public.get_sports_slots(p_resource_id uuid, p_date date)
returns table (starts_at timestamptz, ends_at timestamptz, state text, price_paise int, remaining int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(p_date is not null and p_date between (now() at time zone 'Asia/Kolkata')::date
                         and (now() at time zone 'Asia/Kolkata')::date + 30,
                         'date must be within the next 30 days');
  return query
    with scope as (
      select r.id resource_id, r.slot_minutes, r.capacity, h.opens, h.closes,
             extract(dow from p_date)::smallint weekday
        from public.sports_resources r
        join public.sports_venues v on v.id = r.venue_id
        join public.sports_activities a on a.id = r.activity_id
        join public.sports_hours h on h.venue_id = v.id and h.weekday = extract(dow from p_date)::smallint
       where r.id = p_resource_id and r.active and a.active and v.status = 'verified'
    ), slots as (
      select s.resource_id, s.capacity, s.slot_minutes, s.weekday, gs as slot_start,
             gs + make_interval(mins => s.slot_minutes) as slot_end,
             (gs at time zone 'Asia/Kolkata')::time as local_start,
             ((gs + make_interval(mins => s.slot_minutes)) at time zone 'Asia/Kolkata')::time as local_end
        from scope s
        cross join lateral generate_series(
          (p_date + s.opens) at time zone 'Asia/Kolkata',
          (p_date + s.closes) at time zone 'Asia/Kolkata' - make_interval(mins => s.slot_minutes),
          make_interval(mins => s.slot_minutes)
        ) gs
    )
    select s.slot_start, s.slot_end,
           case
             when s.slot_start <= now() then 'past'
             when exists (
               select 1 from public.sports_blocks b
                where b.resource_id = s.resource_id and b.starts_at < s.slot_end and b.ends_at > s.slot_start
             ) then 'blocked'
             when used.participants >= s.capacity then 'taken'
             when price.price_paise is null then 'blocked'
             else 'free'
           end,
           price.price_paise,
           greatest(s.capacity - used.participants, 0)::int
      from slots s
      left join lateral (
        select coalesce(sum(b.participants), 0)::int participants
          from public.sports_bookings b
         where b.resource_id = s.resource_id
           and b.starts_at < s.slot_end and b.ends_at > s.slot_start
           and (
             b.status = 'accepted'
             or (b.status = 'requested' and b.expires_at > now())
             or (b.status = 'awaiting_payment' and b.pay_by > now())
             or (b.status = 'pending_payment' and b.hold_expires_at > now())
           )
      ) used on true
      left join lateral (
        select pr.price_paise::int price_paise
          from public.sports_price_rules pr
         where pr.resource_id = s.resource_id
           and (pr.weekday = s.weekday or pr.weekday is null)
           and pr.starts <= s.local_start and pr.ends >= s.local_end
         order by (pr.weekday is null), pr.starts
         limit 1
      ) price on true
     order by s.slot_start;
end;
$$;

create or replace function public.request_sports_slot(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_slots int default 1,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_resource record;
  v_start_local timestamp;
  v_end_local timestamp;
  v_day smallint;
  v_hours public.sports_hours;
  v_end_at timestamptz;
  v_expires_at timestamptz;
  v_price int;
  v_total bigint := 0;
  v_used int;
  v_slot_start timestamptz;
  v_slot_local time;
  v_slot_end_local time;
  v_booking_id uuid;
  i int;
begin
  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  perform pg_advisory_xact_lock(hashtext(p_resource_id::text));
  select r.id, r.venue_id, r.slot_minutes, r.capacity, v.owner_id, v.name venue_name,
         v.status, v.payment_modes, a.active
    into v_resource
    from public.sports_resources r
    join public.sports_venues v on v.id = r.venue_id
    join public.sports_activities a on a.id = r.activity_id
   where r.id = p_resource_id and r.active;
  perform public._assert(found and v_resource.status = 'verified' and v_resource.active, 'resource is unavailable');
  perform public._assert('pay_at_venue' = any(v_resource.payment_modes),
                         'This venue does not accept pay-at-venue booking yet');
  perform public._assert(v_resource.owner_id <> v_uid, 'venue owners cannot book their own venue');
  perform public._assert(p_starts_at > now() and p_starts_at <= now() + interval '30 days',
                         'start time must be within the next 30 days');
  perform public._assert(p_slots between 1 and 48, 'slot count must be between 1 and 48');
  perform public._assert(char_length(coalesce(p_note, '')) <= 500, 'request note is too long');
  perform public._assert(extract(second from (p_starts_at at time zone 'Asia/Kolkata')) = 0,
                         'start time must align to a slot boundary');

  v_start_local := p_starts_at at time zone 'Asia/Kolkata';
  v_end_at := p_starts_at + make_interval(mins => v_resource.slot_minutes * p_slots);
  v_end_local := v_end_at at time zone 'Asia/Kolkata';
  v_day := extract(dow from v_start_local)::smallint;
  select * into v_hours from public.sports_hours h
   where h.venue_id = v_resource.venue_id and h.weekday = v_day;
  perform public._assert(found, 'venue is closed on that day');
  perform public._assert(v_start_local::date = v_end_local::date
                         and v_start_local::time >= v_hours.opens
                         and v_end_local::time <= v_hours.closes,
                         'requested time is outside opening hours');
  perform public._assert(
    mod(extract(epoch from (v_start_local::time - v_hours.opens))::int, v_resource.slot_minutes * 60) = 0,
    'start time is not aligned to the venue slot schedule'
  );
  v_expires_at := least(p_starts_at - interval '30 minutes', now() + interval '2 hours');
  perform public._assert(v_expires_at > now(), 'slot must start more than 30 minutes from now');
  perform public._assert(not exists (
    select 1 from public.sports_blocks b
     where b.resource_id = p_resource_id and b.starts_at < v_end_at and b.ends_at > p_starts_at
  ), 'slot is blocked by the venue');
  select coalesce(sum(b.participants), 0)::int into v_used
    from public.sports_bookings b
   where b.resource_id = p_resource_id and b.starts_at < v_end_at and b.ends_at > p_starts_at
     and (
       b.status = 'accepted'
       or (b.status = 'requested' and b.expires_at > now())
       or (b.status = 'awaiting_payment' and b.pay_by > now())
       or (b.status = 'pending_payment' and b.hold_expires_at > now())
     );
  perform public._assert(v_used + 1 <= v_resource.capacity, 'slot is no longer available');

  for i in 0 .. p_slots - 1 loop
    v_slot_start := p_starts_at + make_interval(mins => v_resource.slot_minutes * i);
    v_slot_local := (v_slot_start at time zone 'Asia/Kolkata')::time;
    v_slot_end_local := ((v_slot_start + make_interval(mins => v_resource.slot_minutes)) at time zone 'Asia/Kolkata')::time;
    select r.price_paise into v_price
      from public.sports_price_rules r
     where r.resource_id = p_resource_id
       and (r.weekday = v_day or r.weekday is null)
       and r.starts <= v_slot_local and r.ends >= v_slot_end_local
     order by (r.weekday is null), r.starts
     limit 1;
    perform public._assert(v_price is not null, 'no price rule covers every requested slot');
    v_total := v_total + v_price;
  end loop;
  perform public._assert(v_total <= 2147483647, 'total price is too large');

  insert into public.sports_bookings
    (customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise, note, expires_at,
     payment_mode, participants, total_paise, commission_bp)
  values
    (v_uid, v_resource.venue_id, p_resource_id, p_starts_at, v_end_at, 'requested', v_total::int,
     coalesce(p_note, ''), v_expires_at, 'pay_at_venue', 1, v_total::int,
     nullif(public._sports_rule('commission_bp'), '')::int)
  returning id into v_booking_id;

  insert into public.notifications (user_id, kind, title, body, data, collapse_key)
  values (
    v_resource.owner_id, 'sports_booking_requested', 'New sports venue request',
    v_resource.venue_name || ' has a new booking request.',
    jsonb_build_object('sports_booking_id', v_booking_id, 'url', '/sports-booking/' || v_booking_id::text),
    'sports-booking-request:' || v_booking_id::text
  );
  return v_booking_id;
end;
$$;

create or replace function public.book_sports_slot(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_slots int,
  p_participants int,
  p_payment_mode text,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_existing public.sports_bookings%rowtype;
  v_resource record;
  v_venue_id uuid;
  v_start_local timestamp;
  v_end_local timestamp;
  v_day smallint;
  v_hours public.sports_hours;
  v_end_at timestamptz;
  v_request_expires timestamptz;
  v_hold_expires timestamptz;
  v_price int;
  v_price_total bigint := 0;
  v_fee int := 0;
  v_total bigint;
  v_used int;
  v_hold_minutes int;
  v_commission_bp int;
  v_slot_start timestamptz;
  v_slot_local time;
  v_slot_end_local time;
  v_booking_mode text;
  v_status text;
  v_booking_id uuid;
  i int;
begin
  perform public._assert(char_length(btrim(coalesce(p_idempotency_key, ''))) between 1 and 200,
                         'idempotency key is required');
  perform public._assert(p_payment_mode in ('online', 'pay_at_venue'), 'payment mode must be online or pay_at_venue');

  select * into v_existing from public.sports_bookings
   where customer_id = v_uid and idempotency_key = btrim(p_idempotency_key);
  if found then
    return jsonb_build_object(
      'booking_id', v_existing.id, 'status', v_existing.status,
      'total_paise', coalesce(v_existing.total_paise, v_existing.price_paise),
      'hold_expires_at', v_existing.hold_expires_at, 'pay_by', v_existing.pay_by
    );
  end if;

  perform public._assert(public._sports_feature('sports'), 'Sports & venues are turned off right now.');
  if p_payment_mode = 'online' then
    perform public._assert(public._sports_feature('sports_online_payments'),
                           'Sports online payments are turned off right now.');
  end if;
  perform public._assert(p_starts_at > now() and p_starts_at <= now() + interval '30 days',
                         'start time must be within the next 30 days');
  perform public._assert(p_slots between 1 and 4, 'slot count must be between 1 and 4');
  perform public._assert(p_participants between 1 and 50, 'participant count must be between 1 and 50');
  perform public._assert(char_length(coalesce(p_note, '')) <= 500, 'request note is too long');
  perform public._assert(extract(second from (p_starts_at at time zone 'Asia/Kolkata')) = 0,
                         'start time must align to a slot boundary');
  perform public._assert(p_slots = 1 or public._sports_feature('sports_multi_slot'),
                         'Sports multi-slot booking is turned off right now.');
  perform public._assert(p_participants = 1 or public._sports_feature('sports_capacity_slots'),
                         'Sports capacity booking is turned off right now.');

  select r.venue_id into v_venue_id
    from public.sports_resources r
   where r.id = p_resource_id and r.active;
  perform public._assert(found, 'resource is unavailable');
  perform pg_advisory_xact_lock(hashtext('sports-venue:' || v_venue_id::text));
  perform pg_advisory_xact_lock(hashtext(p_resource_id::text));
  select r.id, r.venue_id, r.slot_minutes, r.capacity, r.booking_mode,
         v.owner_id, v.name venue_name, v.status venue_status, v.payment_modes,
         a.active activity_active
    into v_resource
    from public.sports_resources r
    join public.sports_venues v on v.id = r.venue_id
    join public.sports_activities a on a.id = r.activity_id
   where r.id = p_resource_id and r.active;
  perform public._assert(found and v_resource.venue_status = 'verified' and v_resource.activity_active,
                         'resource is unavailable');
  perform public._assert(v_resource.owner_id <> v_uid, 'venue owners cannot book their own venue');
  if p_payment_mode = 'online' then
    perform public._assert(
      'online' = any(v_resource.payment_modes)
      and exists (
        select 1 from public.provider_payout_accounts pa
         where pa.provider_id = v_resource.owner_id and pa.activation_status = 'activated'
      ),
      'This venue does not accept online payment yet'
    );
  else
    perform public._assert('pay_at_venue' = any(v_resource.payment_modes),
                           'This venue does not accept pay-at-venue booking yet');
  end if;

  select * into v_existing from public.sports_bookings
   where customer_id = v_uid and idempotency_key = btrim(p_idempotency_key);
  if found then
    return jsonb_build_object(
      'booking_id', v_existing.id, 'status', v_existing.status,
      'total_paise', coalesce(v_existing.total_paise, v_existing.price_paise),
      'hold_expires_at', v_existing.hold_expires_at, 'pay_by', v_existing.pay_by
    );
  end if;

  v_start_local := p_starts_at at time zone 'Asia/Kolkata';
  v_end_at := p_starts_at + make_interval(mins => v_resource.slot_minutes * p_slots);
  v_end_local := v_end_at at time zone 'Asia/Kolkata';
  v_day := extract(dow from v_start_local)::smallint;
  select * into v_hours from public.sports_hours h
   where h.venue_id = v_resource.venue_id and h.weekday = v_day;
  perform public._assert(found, 'venue is closed on that day');
  perform public._assert(v_start_local::date = v_end_local::date
                         and v_start_local::time >= v_hours.opens
                         and v_end_local::time <= v_hours.closes,
                         'requested time is outside opening hours');
  perform public._assert(
    mod(extract(epoch from (v_start_local::time - v_hours.opens))::int, v_resource.slot_minutes * 60) = 0,
    'start time is not aligned to the venue slot schedule'
  );
  perform public._assert(not exists (
    select 1 from public.sports_blocks b
     where b.resource_id = p_resource_id and b.starts_at < v_end_at and b.ends_at > p_starts_at
  ), 'slot is blocked by the venue');
  select coalesce(sum(b.participants), 0)::int into v_used
    from public.sports_bookings b
   where b.resource_id = p_resource_id and b.starts_at < v_end_at and b.ends_at > p_starts_at
     and (
       b.status = 'accepted'
       or (b.status = 'requested' and b.expires_at > now())
       or (b.status = 'awaiting_payment' and b.pay_by > now())
       or (b.status = 'pending_payment' and b.hold_expires_at > now())
     );
  perform public._assert(v_used + p_participants <= v_resource.capacity, 'slot is no longer available');

  for i in 0 .. p_slots - 1 loop
    v_slot_start := p_starts_at + make_interval(mins => v_resource.slot_minutes * i);
    v_slot_local := (v_slot_start at time zone 'Asia/Kolkata')::time;
    v_slot_end_local := ((v_slot_start + make_interval(mins => v_resource.slot_minutes)) at time zone 'Asia/Kolkata')::time;
    select r.price_paise into v_price
      from public.sports_price_rules r
     where r.resource_id = p_resource_id
       and (r.weekday = v_day or r.weekday is null)
       and r.starts <= v_slot_local and r.ends >= v_slot_end_local
     order by (r.weekday is null), r.starts
     limit 1;
    perform public._assert(v_price is not null, 'no price rule covers every requested slot');
    v_price_total := v_price_total + v_price;
  end loop;
  perform public._assert(v_price_total between 1 and 2147483647, 'total price is too large');

  v_commission_bp := coalesce(nullif(public._sports_rule('commission_bp'), '')::int, -1);
  perform public._assert(v_commission_bp between 0 and 5000, 'sports commission rule is unavailable');
  if p_payment_mode = 'online' then
    v_fee := coalesce(nullif(public._sports_rule('customer_fee_paise'), '')::int, -1);
    v_hold_minutes := coalesce(nullif(public._sports_rule('payment_hold_minutes'), '')::int, -1);
    perform public._assert(v_fee >= 0 and v_hold_minutes between 5 and 1440,
                           'sports payment rules are unavailable');
  end if;
  v_total := v_price_total + v_fee;
  perform public._assert(v_total between 1 and 2147483647, 'total price is too large');

  v_booking_mode := case
    when v_resource.booking_mode = 'instant' and public._sports_feature('sports_instant_booking') then 'instant'
    else 'approval'
  end;
  v_request_expires := least(p_starts_at - interval '30 minutes', now() + interval '2 hours');
  perform public._assert(v_request_expires > now(), 'slot must start more than 30 minutes from now');
  if p_payment_mode = 'online' and v_booking_mode = 'instant' then
    v_status := 'pending_payment';
    v_hold_expires := now() + make_interval(mins => v_hold_minutes);
  elsif p_payment_mode = 'pay_at_venue' and v_booking_mode = 'instant' then
    v_status := 'accepted';
  else
    v_status := 'requested';
  end if;

  insert into public.sports_bookings
    (customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise, note, expires_at,
     payment_mode, participants, hold_expires_at, customer_fee_paise, total_paise, commission_bp,
     idempotency_key, decided_at)
  values
    (v_uid, v_resource.venue_id, p_resource_id, p_starts_at, v_end_at, v_status, v_price_total::int,
     coalesce(p_note, ''), coalesce(v_hold_expires, v_request_expires), p_payment_mode,
     p_participants, v_hold_expires, v_fee, v_total::int, v_commission_bp,
     btrim(p_idempotency_key), case when v_status = 'accepted' then now() else null end)
  on conflict (customer_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_booking_id;

  if v_booking_id is null then
    select * into v_existing from public.sports_bookings
     where customer_id = v_uid and idempotency_key = btrim(p_idempotency_key);
    perform public._assert(found, 'booking could not be created');
    return jsonb_build_object(
      'booking_id', v_existing.id, 'status', v_existing.status,
      'total_paise', coalesce(v_existing.total_paise, v_existing.price_paise),
      'hold_expires_at', v_existing.hold_expires_at, 'pay_by', v_existing.pay_by
    );
  end if;

  if v_status = 'requested' then
    insert into public.notifications (user_id, kind, title, body, data, collapse_key)
    values (
      v_resource.owner_id, 'sports_booking_requested', 'New sports venue request',
      v_resource.venue_name || ' has a new booking request.',
      jsonb_build_object('sports_booking_id', v_booking_id, 'url', '/sports-booking/' || v_booking_id::text),
      'sports-booking-request:' || v_booking_id::text
    );
  elsif v_status = 'accepted' then
    insert into public.notifications (user_id, kind, title, body, data, collapse_key)
    values
      (v_uid, 'sports_booking_confirmed', 'Sports booking confirmed',
       v_resource.venue_name || ' booking confirmed.',
       jsonb_build_object('sports_booking_id', v_booking_id, 'url', '/sports-booking/' || v_booking_id::text),
       'sports-booking-confirmed:' || v_booking_id::text),
      (v_resource.owner_id, 'sports_booking_confirmed', 'Sports booking confirmed',
       v_resource.venue_name || ' has a confirmed booking.',
       jsonb_build_object('sports_booking_id', v_booking_id, 'url', '/sports-booking/' || v_booking_id::text),
       'sports-booking-confirmed:' || v_booking_id::text);
  end if;

  return jsonb_build_object(
    'booking_id', v_booking_id, 'status', v_status, 'total_paise', v_total::int,
    'hold_expires_at', v_hold_expires, 'pay_by', null
  );
end;
$$;

create or replace function public.decide_sports_booking(p_id uuid, p_accept boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_booking record;
  v_pay_by timestamptz;
  v_window_minutes int;
  v_status text;
  v_kind text;
  v_title text;
  v_body text;
begin
  perform public._assert(p_accept is not null, 'decision is required');
  perform public._assert(p_accept or char_length(btrim(coalesce(p_reason, ''))) between 3 and 500,
                         'a decline reason is required');
  select resource_id into v_booking from public.sports_bookings where id = p_id;
  perform public._assert(found, 'booking not found');
  perform pg_advisory_xact_lock(hashtext(v_booking.resource_id::text));
  select b.*, v.owner_id, v.name venue_name into v_booking
    from public.sports_bookings b join public.sports_venues v on v.id = b.venue_id
   where b.id = p_id for update of b;
  perform public._assert(found and v_booking.owner_id = v_uid, 'booking not found or not owned by you');
  perform public._assert(v_booking.status = 'requested' and v_booking.expires_at > now(),
                         'request is no longer pending');

  if p_accept and v_booking.payment_mode = 'online' then
    v_window_minutes := coalesce(nullif(public._sports_rule('approval_pay_window_minutes'), '')::int, -1);
    perform public._assert(v_window_minutes between 5 and 1440, 'sports approval payment rule is unavailable');
    v_pay_by := least(v_booking.starts_at - interval '30 minutes',
                      now() + make_interval(mins => v_window_minutes));
    perform public._assert(v_pay_by > now(), 'request is no longer payable');
    v_status := 'awaiting_payment';
    v_kind := 'sports_payment_due';
    v_title := 'Payment due for sports booking';
    v_body := v_booking.venue_name || ' approved your booking. Complete payment before the deadline.';
  else
    v_status := case when p_accept then 'accepted' else 'declined' end;
    v_kind := case when p_accept then 'sports_booking_accepted' else 'sports_booking_declined' end;
    v_title := case when p_accept then 'Sports booking accepted' else 'Sports booking declined' end;
    v_body := case when p_accept then v_booking.venue_name || ' accepted your request.'
                   else coalesce(nullif(btrim(p_reason), ''), v_booking.venue_name || ' declined your request.') end;
  end if;

  update public.sports_bookings
     set status = v_status,
         pay_by = v_pay_by,
         decision_reason = case when p_accept then '' else btrim(p_reason) end,
         decided_at = now()
   where id = p_id;
  insert into public.notifications (user_id, kind, title, body, data, collapse_key)
  values (
    v_booking.customer_id, v_kind, v_title, left(v_body, 300),
    jsonb_build_object('sports_booking_id', p_id, 'url', '/sports-booking/' || p_id::text),
    case when v_kind = 'sports_payment_due' then 'sports-payment-due:' || p_id::text
         else 'sports-booking-decision:' || p_id::text end
  );
end;
$$;

create or replace function public.prepare_sports_payment(p_booking_id uuid, p_user_id uuid)
returns table (payment_id uuid, amount int, purpose text, url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resource_id uuid;
  v_booking public.sports_bookings%rowtype;
  v_payment public.payments%rowtype;
begin
  perform public._assert(p_user_id is not null, 'customer is required');
  select resource_id into v_resource_id
    from public.sports_bookings
   where id = p_booking_id and customer_id = p_user_id;
  perform public._assert(found, 'only the customer can pay');
  perform pg_advisory_xact_lock(hashtext(v_resource_id::text));
  select * into v_booking from public.sports_bookings
   where id = p_booking_id and customer_id = p_user_id
   for update;
  perform public._assert(found, 'only the customer can pay');
  perform public._assert(v_booking.payment_mode = 'online', 'booking does not use online payment');
  perform public._assert(
    (v_booking.status = 'pending_payment' and v_booking.hold_expires_at > now())
    or (v_booking.status = 'awaiting_payment' and v_booking.pay_by > now()),
    'booking is not payable'
  );
  perform public._assert(v_booking.total_paise is not null and v_booking.total_paise > 0,
                         'booking total is unavailable');

  select * into v_payment from public.payments p
   where p.sports_booking_id = p_booking_id and p.status = 'created'
     and p.amount = v_booking.total_paise
   order by p.created_at desc limit 1;
  if found then
    return query select v_payment.id, v_payment.amount, v_payment.purpose::text, v_payment.short_url;
    return;
  end if;

  update public.payments p
     set status = 'failed', cancel_link_pending = (p.razorpay_link_id is not null)
   where p.sports_booking_id = p_booking_id and p.status = 'created';
  insert into public.payments (sports_booking_id, purpose, amount)
  values (p_booking_id, 'fixed', v_booking.total_paise)
  returning * into v_payment;
  return query select v_payment.id, v_payment.amount, v_payment.purpose::text, v_payment.short_url;
end;
$$;

create or replace function public._queue_sports_refund(p_booking_id uuid, p_amount int, p_reason text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_remaining int := greatest(coalesce(p_amount, 0), 0);
  v_queued int := 0;
  v_part int;
begin
  for v_payment in
    select p.id, p.amount
      from public.payments p
     where p.sports_booking_id = p_booking_id
       and p.razorpay_payment_id is not null
       and p.status in ('paid', 'refund_pending')
     order by p.paid_at desc, p.id
     for update
  loop
    exit when v_remaining <= 0;
    v_part := public._queue_refund(v_payment.id, v_remaining, p_reason);
    v_queued := v_queued + v_part;
    v_remaining := v_remaining - v_part;
  end loop;
  return v_queued;
end;
$$;

create or replace function public._refund_unmatched_sports_capture(
  p_booking_id uuid,
  p_payment_id text,
  p_amount int,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capture_payment_id uuid;
  v_refunded int;
begin
  if p_amount is null or p_amount <= 0 then
    return 0;
  end if;
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return 0;
  end if;

  insert into public.payments (
    sports_booking_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at
  ) values (
    p_booking_id, 'fixed', p_amount, 'paid', 'sports-capture:' || p_payment_id, p_payment_id, now()
  ) returning id into v_capture_payment_id;

  v_refunded := public._queue_refund(v_capture_payment_id, p_amount, p_reason);
  if v_refunded > 0 then
    insert into public.notifications (user_id, kind, title, body, data, collapse_key)
    select b.customer_id, 'sports_refund_issued', 'Sports payment refunded',
           'An extra or mismatched sports payment has been queued for refund.',
           jsonb_build_object('sports_booking_id', b.id, 'url', '/sports-booking/' || b.id::text),
           'sports-refund-capture:' || p_payment_id
      from public.sports_bookings b
     where b.id = p_booking_id;
  end if;
  return v_refunded;
end;
$$;

create or replace function public.record_sports_payment_paid(
  p_order_id text, p_payment_id text, p_amount int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_booking public.sports_bookings%rowtype;
  v_booking_id uuid;
  v_resource_id uuid;
  v_refunded int;
  v_payable boolean;
  v_owner_id uuid;
  v_venue_name text;
begin
  if nullif(btrim(coalesce(p_order_id, '')), '') is null
     or nullif(btrim(coalesce(p_payment_id, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'payment identifiers are required');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_payment_id));
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'captured amount must be positive');
  end if;
  select p.sports_booking_id into v_booking_id
    from public.payments p where p.razorpay_link_id = p_order_id;
  if not found or v_booking_id is null then
    return jsonb_build_object('ok', false, 'error', 'not a sports payment');
  end if;
  select resource_id into v_resource_id from public.sports_bookings where id = v_booking_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sports booking not found');
  end if;
  perform pg_advisory_xact_lock(hashtext(v_resource_id::text));
  select * into v_booking from public.sports_bookings where id = v_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sports booking not found');
  end if;
  select * into v_payment from public.payments
   where razorpay_link_id = p_order_id and sports_booking_id = v_booking_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not a sports payment');
  end if;
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if v_payment.razorpay_payment_id is not null then
    v_refunded := public._refund_unmatched_sports_capture(
      v_booking_id, p_payment_id, p_amount, 'duplicate sports payment capture'
    );
    return jsonb_build_object(
      'ok', true, 'booking_id', v_booking_id, 'duplicate_capture', true,
      'refund', v_refunded > 0, 'refund_amount', v_refunded
    );
  end if;
  if v_payment.amount <> p_amount then
    update public.payments
       set status = 'failed', cancel_link_pending = false
     where id = v_payment.id and status = 'created';
    v_refunded := public._refund_unmatched_sports_capture(
      v_booking_id, p_payment_id, p_amount, 'sports payment amount mismatch'
    );
    return jsonb_build_object(
      'ok', true, 'booking_id', v_booking_id, 'amount_mismatch', true,
      'refund', v_refunded > 0, 'refund_amount', v_refunded
    );
  end if;

  v_payable :=
    v_payment.status = 'created'
    and v_booking.payment_mode = 'online'
    and v_booking.paid_at is null
    and (
      (v_booking.status = 'pending_payment' and v_booking.hold_expires_at > now())
      or (v_booking.status = 'awaiting_payment' and v_booking.pay_by > now())
    );
  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
   where id = v_payment.id;

  if v_payable then
    update public.sports_bookings set status = 'accepted', paid_at = now()
     where id = v_booking.id;
    select owner_id, name into v_owner_id, v_venue_name
      from public.sports_venues where id = v_booking.venue_id;
    insert into public.notifications (user_id, kind, title, body, data, collapse_key)
    values
      (v_booking.customer_id, 'sports_booking_confirmed', 'Sports booking confirmed',
       v_venue_name || ' booking confirmed.',
       jsonb_build_object('sports_booking_id', v_booking.id, 'url', '/sports-booking/' || v_booking.id::text),
       'sports-booking-confirmed:' || v_booking.id::text),
      (v_owner_id, 'sports_booking_confirmed', 'Sports booking confirmed',
       v_venue_name || ' has a paid booking.',
       jsonb_build_object('sports_booking_id', v_booking.id, 'url', '/sports-booking/' || v_booking.id::text),
       'sports-booking-confirmed:' || v_booking.id::text);
    return jsonb_build_object('ok', true, 'booking_id', v_booking.id);
  end if;

  v_refunded := public._queue_refund(v_payment.id, v_payment.amount, 'late or cancelled sports payment');
  if v_refunded > 0 then
    update public.sports_bookings set refund_paise = refund_paise + v_refunded
     where id = v_booking.id;
    insert into public.notifications (user_id, kind, title, body, data, collapse_key)
    values (
      v_booking.customer_id, 'sports_refund_issued', 'Sports payment refunded',
      'A payment received after the booking could no longer be accepted has been refunded.',
      jsonb_build_object('sports_booking_id', v_booking.id, 'url', '/sports-booking/' || v_booking.id::text),
      'sports-refund:' || v_booking.id::text
    );
  end if;
  return jsonb_build_object('ok', true, 'booking_id', v_booking.id, 'refund', v_refunded > 0);
end;
$$;

create or replace function public.cancel_sports_booking(p_id uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_booking record;
  v_rules jsonb;
  v_full_hours int;
  v_partial_hours int;
  v_partial_bp int;
  v_hours_to_start numeric;
  v_target int := 0;
  v_refunded int := 0;
  v_owner_cancel boolean;
  v_notice_user uuid;
  v_notice_title text;
  v_notice_body text;
begin
  select resource_id into v_booking from public.sports_bookings where id = p_id;
  perform public._assert(found, 'booking not found');
  perform pg_advisory_xact_lock(hashtext(v_booking.resource_id::text));
  select b.*, v.owner_id, v.name venue_name, v.cancellation_rules into v_booking
    from public.sports_bookings b join public.sports_venues v on v.id = b.venue_id
   where b.id = p_id for update of b;
  perform public._assert(found, 'booking not found');
  perform public._assert(v_booking.status in ('requested', 'accepted', 'pending_payment', 'awaiting_payment'),
                         'booking cannot be cancelled');

  if v_booking.customer_id = v_uid then
    perform public._assert(v_booking.starts_at > now(), 'booking can only be cancelled before it starts');
    v_owner_cancel := false;
    v_notice_user := v_booking.owner_id;
    v_notice_title := 'Sports booking cancelled';
    v_notice_body := v_booking.venue_name || ' booking was cancelled by the customer.';
  elsif v_booking.owner_id = v_uid then
    perform public._assert(char_length(btrim(coalesce(p_reason, ''))) between 3 and 500,
                           'a cancellation reason is required');
    v_owner_cancel := true;
    v_notice_user := v_booking.customer_id;
    v_notice_title := 'Sports booking cancelled by venue';
    v_notice_body := coalesce(nullif(btrim(p_reason), ''),
                              v_booking.venue_name || ' cancelled the booking.');
  else
    raise exception 'booking not found' using errcode = 'P0001';
  end if;

  if v_booking.payment_mode = 'online' then
    if v_owner_cancel then
      v_target := coalesce(v_booking.total_paise, v_booking.price_paise + v_booking.customer_fee_paise);
    else
      v_rules := coalesce(v_booking.cancellation_rules,
        (select c.value from public.app_config c where c.key = 'sports_rules'));
      v_full_hours := coalesce(nullif(v_rules ->> 'full_refund_hours', '')::int,
                               nullif(public._sports_rule('full_refund_hours'), '')::int);
      v_partial_hours := coalesce(nullif(v_rules ->> 'partial_refund_hours', '')::int,
                                  nullif(public._sports_rule('partial_refund_hours'), '')::int);
      v_partial_bp := coalesce(nullif(v_rules ->> 'partial_refund_bp', '')::int,
                               nullif(public._sports_rule('partial_refund_bp'), '')::int, -1);
      perform public._assert(v_full_hours is not null and v_partial_hours is not null
                             and v_partial_bp between 0 and 5000,
                             'sports cancellation rules are unavailable');
      v_hours_to_start := extract(epoch from (v_booking.starts_at - now())) / 3600.0;
      if v_hours_to_start >= v_full_hours then
        v_target := v_booking.price_paise;
      elsif v_hours_to_start >= v_partial_hours then
        v_target := round(v_booking.price_paise::numeric * v_partial_bp / 10000)::int;
      else
        v_target := 0;
      end if;
    end if;
    if v_target > 0 then
      v_refunded := public._queue_sports_refund(p_id, v_target,
        case when v_owner_cancel then 'venue cancelled sports booking'
             else 'customer cancelled sports booking' end);
    end if;
  end if;

  update public.payments
     set status = 'failed', cancel_link_pending = (razorpay_link_id is not null)
   where sports_booking_id = p_id and status = 'created';
  update public.sports_bookings
     set status = 'cancelled', refund_paise = refund_paise + v_refunded,
         decision_reason = coalesce(btrim(p_reason), ''), decided_at = now()
   where id = p_id;
  insert into public.notifications (user_id, kind, title, body, data, collapse_key)
  values (
    v_notice_user, 'sports_booking_cancelled', v_notice_title, left(v_notice_body, 300),
    jsonb_build_object('sports_booking_id', p_id, 'url', '/sports-booking/' || p_id::text),
    'sports-booking-cancelled:' || p_id::text
  );
  if v_refunded > 0 then
    insert into public.notifications (user_id, kind, title, body, data, collapse_key)
    values (
      v_booking.customer_id, 'sports_refund_issued', 'Sports refund queued',
      'A refund has been queued according to the sports cancellation policy.',
      jsonb_build_object('sports_booking_id', p_id, 'url', '/sports-booking/' || p_id::text),
      'sports-refund:' || p_id::text
    );
  end if;
end;
$$;

create or replace function public._create_sports_payout(p_sports_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_payout_id uuid;
  v_gross int;
  v_commission_bp int;
  v_commission int;
  v_gst int;
  v_amount int;
  v_release_hours int;
  v_remaining int;
  v_payment record;
  v_available int;
  v_transfer int;
begin
  select b.*, v.owner_id into v_booking
    from public.sports_bookings b
    join public.sports_venues v on v.id = b.venue_id
   where b.id = p_sports_booking_id
   for update of b;
  if not found or v_booking.status <> 'completed'
     or v_booking.payment_mode <> 'online' or v_booking.paid_at is null then
    return;
  end if;
  if exists (select 1 from public.payouts p where p.sports_booking_id = p_sports_booking_id) then
    return;
  end if;

  v_gross := greatest(v_booking.price_paise - v_booking.refund_paise, 0);
  v_commission_bp := coalesce(v_booking.commission_bp,
                              nullif(public._sports_rule('commission_bp'), '')::int, -1);
  v_release_hours := coalesce(nullif(public._sports_rule('release_after_hours'), '')::int, -1);
  perform public._assert(v_commission_bp between 0 and 5000, 'sports commission snapshot is unavailable');
  perform public._assert(v_release_hours between 0 and 720, 'sports payout release rule is unavailable');
  v_commission := round(v_gross::numeric * v_commission_bp / 10000)::int;
  v_gst := round(v_commission::numeric * 18 / 100)::int;
  v_amount := greatest(v_gross - v_commission - v_gst, 0);

  insert into public.payouts
    (booking_id, provider_id, sports_booking_id, payee_id, gross, commission,
     gst_on_commission, amount, release_after)
  values
    (null, null, p_sports_booking_id, v_booking.owner_id, v_gross, v_commission,
     v_gst, v_amount, now() + make_interval(hours => v_release_hours))
  on conflict (sports_booking_id) do nothing
  returning id into v_payout_id;
  if v_payout_id is null or v_amount = 0 then
    return;
  end if;

  v_remaining := v_amount;
  for v_payment in
    select p.id, p.amount
      from public.payments p
     where p.sports_booking_id = p_sports_booking_id
       and p.status = 'paid' and p.razorpay_payment_id is not null
     order by p.paid_at, p.id
     for update
  loop
    exit when v_remaining <= 0;
    v_available := v_payment.amount
      - coalesce((select sum(t.amount) from public.payout_transfers t
                   where t.source_payment_id = v_payment.id), 0)
      - coalesce((select sum(r.amount) from public.refunds r
                   where r.payment_id = v_payment.id and r.status <> 'failed'), 0);
    v_transfer := least(greatest(v_available, 0), v_remaining);
    if v_transfer > 0 then
      insert into public.payout_transfers (payout_id, source_payment_id, amount)
      values (v_payout_id, v_payment.id, v_transfer);
      v_remaining := v_remaining - v_transfer;
    end if;
  end loop;
  perform public._assert(v_remaining = 0, 'paid sports amount does not cover venue payout');
end;
$$;

create or replace function public.expire_sports_requests()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resource record;
  v_booking record;
  v_expired_count int := 0;
begin
  for v_resource in
    select distinct b.resource_id
      from public.sports_bookings b
     where (b.status = 'requested' and b.expires_at <= now())
        or (b.status = 'pending_payment' and b.hold_expires_at <= now())
        or (b.status = 'awaiting_payment' and b.pay_by <= now())
        or (b.status = 'accepted' and b.ends_at <= now())
     order by b.resource_id
  loop
    perform pg_advisory_xact_lock(hashtext(v_resource.resource_id::text));
    for v_booking in
      with expired as (
        update public.sports_bookings b
           set status = 'expired', decided_at = now()
         where b.resource_id = v_resource.resource_id
           and (
             (b.status = 'requested' and b.expires_at <= now())
             or (b.status = 'pending_payment' and b.hold_expires_at <= now())
             or (b.status = 'awaiting_payment' and b.pay_by <= now())
           )
        returning b.id, b.customer_id, b.venue_id
      )
      select e.id, e.customer_id, e.venue_id, v.owner_id, v.name venue_name
        from expired e join public.sports_venues v on v.id = e.venue_id
    loop
      v_expired_count := v_expired_count + 1;
      update public.payments
         set status = 'failed', cancel_link_pending = (razorpay_link_id is not null)
       where sports_booking_id = v_booking.id and status = 'created';
      insert into public.notifications (user_id, kind, title, body, data, collapse_key)
      values (
        v_booking.customer_id, 'sports_booking_expired', 'Sports booking expired',
        v_booking.venue_name || ' booking expired before payment or owner decision.',
        jsonb_build_object('sports_booking_id', v_booking.id, 'url', '/sports-booking/' || v_booking.id::text),
        'sports-booking-expired:' || v_booking.id::text
      );
    end loop;

    for v_booking in
      with completed as (
        update public.sports_bookings b
           set status = 'completed', decided_at = now()
         where b.resource_id = v_resource.resource_id and b.status = 'accepted' and b.ends_at <= now()
        returning b.id, b.payment_mode, b.paid_at
      )
      select * from completed
    loop
      if v_booking.payment_mode = 'online' and v_booking.paid_at is not null then
        perform public._create_sports_payout(v_booking.id);
      end if;
    end loop;
  end loop;
  return v_expired_count;
end;
$$;

create or replace function public.claim_due_transfers(p_limit int default 20)
returns table (
  transfer_id uuid, payout_id uuid, booking_id uuid, provider_id uuid, amount int, gross_amount int, rail text,
  razorpay_payment_id text, account_id text, fund_account_id text, attempts int, idempotency_key text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  c record;
  v_net int;
  v_ids uuid[];
begin
  with claimed as (
    update public.payout_transfers pt
       set status = 'processing'
     where pt.id in (
       select t.id
         from public.payout_transfers t
         join public.payouts po on po.id = t.payout_id
         left join public.bookings b on b.id = po.booking_id
         left join public.providers pr on pr.id = po.provider_id
         left join public.provider_payout_accounts pa
           on pa.provider_id = coalesce(po.provider_id, po.payee_id)
        where t.status = 'pending'
          and (t.next_attempt_at is null or t.next_attempt_at <= now())
          and t.release_after <= now()
          and po.status = 'pending'
          and po.release_after <= now()
          and (po.booking_id is null or b.status <> 'disputed')
          and (
            (coalesce(t.rail, 'route') = 'route'
              and coalesce(pr.razorpay_account_id, pa.razorpay_account_id) is not null
              and (po.provider_id is not null or pa.activation_status = 'activated'))
            or
            (t.rail = 'payouts' and pa.fund_account_id is not null
              and ((po.provider_id is not null and pr.kyc_status = 'verified')
                or (po.payee_id is not null and pa.activation_status = 'activated')))
          )
        order by t.release_after, po.release_after
        limit greatest(p_limit, 0)
        for update of t, po skip locked
     )
    returning pt.id
  )
  select array_agg(claimed.id) into v_ids from claimed;

  for c in
    select cl.id, cl.payout_id, po.booking_id, po.sports_booking_id,
           coalesce(po.provider_id, po.payee_id) payee_id, cl.amount,
           coalesce(cl.rail, 'route') rail, pm.razorpay_payment_id,
           coalesce(pr.razorpay_account_id, pa.razorpay_account_id) account_id,
           pa.fund_account_id, cl.attempts, cl.idempotency_seq
      from public.payout_transfers cl
      join public.payouts po on po.id = cl.payout_id
      left join public.providers pr on pr.id = po.provider_id
      left join public.provider_payout_accounts pa
        on pa.provider_id = coalesce(po.provider_id, po.payee_id)
      join public.payments pm on pm.id = cl.source_payment_id
     where cl.id = any (coalesce(v_ids, '{}'))
  loop
    v_net := c.amount - public._net_receivables(c.id);
    if v_net <= 0 then
      perform public.complete_transfer(c.id, 'netted_' || c.id::text);
      continue;
    end if;
    transfer_id := c.id;
    payout_id := c.payout_id;
    booking_id := coalesce(c.booking_id, c.sports_booking_id);
    provider_id := c.payee_id;
    amount := v_net;
    gross_amount := c.amount;
    rail := c.rail;
    razorpay_payment_id := c.razorpay_payment_id;
    account_id := c.account_id;
    fund_account_id := c.fund_account_id;
    attempts := c.attempts;
    idempotency_key := c.id::text || ':' || c.idempotency_seq::text;
    return next;
  end loop;
end;
$$;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'sports-booking-expiry';
    perform cron.schedule(
      'sports-booking-expiry',
      '*/5 * * * *',
      'select public.expire_sports_requests()'
    );
  end if;
end;
$$;

revoke execute on function
  public._queue_sports_refund(uuid, int, text),
  public._refund_unmatched_sports_capture(uuid, text, int, text),
  public._create_sports_payout(uuid)
from public, anon, authenticated;

revoke execute on function
  public.get_sports_slots(uuid, date),
  public.get_my_business_sports_venues(),
  public.save_sports_venue(uuid, text, text, text, text, text, double precision, double precision, text[], text[], text[]),
  public.save_sports_resource(uuid, uuid, uuid, text, int, boolean, text, int),
  public.book_sports_slot(uuid, timestamptz, int, int, text, text, text),
  public.prepare_sports_payment(uuid, uuid),
  public.record_sports_payment_paid(text, text, int),
  public.sync_venue_payout_status(text, text, jsonb, timestamptz),
  public.decide_sports_booking(uuid, boolean, text),
  public.cancel_sports_booking(uuid, text),
  public.expire_sports_requests(),
  public.claim_due_transfers(int)
from public, anon, authenticated;

grant execute on function public.get_sports_slots(uuid, date) to anon, authenticated;

grant execute on function public.get_my_business_sports_venues() to authenticated;

grant execute on function
  public.save_sports_venue(uuid, text, text, text, text, text, double precision, double precision, text[], text[], text[]),
  public.save_sports_resource(uuid, uuid, uuid, text, int, boolean, text, int),
  public.book_sports_slot(uuid, timestamptz, int, int, text, text, text),
  public.decide_sports_booking(uuid, boolean, text),
  public.cancel_sports_booking(uuid, text)
to authenticated;

grant execute on function public.prepare_sports_payment(uuid, uuid),
  public.record_sports_payment_paid(text, text, int),
  public.sync_venue_payout_status(text, text, jsonb, timestamptz),
  public.expire_sports_requests(),
  public.claim_due_transfers(int)
to service_role;

revoke execute on function
  public.get_my_sports_venues(),
  public.get_my_sports_bookings(),
  public.get_sports_booking(uuid)
from public, anon;
grant execute on function
  public.get_my_sports_venues(),
  public.get_my_sports_bookings(),
  public.get_sports_booking(uuid)
to authenticated;

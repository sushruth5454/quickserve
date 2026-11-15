-- Cancellation policy snapshots, availability reservation and post-transfer payout recovery
-- (docs/07 §3.7-3.10 and binding contracts C1/C7/C9).
--
-- This migration deliberately delegates commission calculation to the existing _create_payout
-- implementation. Do not replace its 0016 settlement logic here.

-- ---------------------------------------------------------------------------
-- Booking configuration and immutable cancellation snapshots
-- ---------------------------------------------------------------------------
alter table public.categories
  add column if not exists cancellation_policy text not null default 'standard_visit',
  add column if not exists exclusive boolean not null default true,
  add column if not exists archetype text not null default 'inspect_quote',
  add column if not exists config_version int not null default 1;

alter table public.bookings
  add column if not exists archetype text not null default 'inspect_quote',
  add column if not exists category_config_version int not null default 1,
  add column if not exists location_mode text not null default 'at_customer',
  add column if not exists pricing_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists payment_template_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists cancellation_snapshot jsonb,
  add column if not exists platform_fee_rule_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists exclusive boolean not null default true,
  add column if not exists cancellation_outcome jsonb;

update public.categories
   set cancellation_policy = 'standard_visit'
 where cancellation_policy is null or btrim(cancellation_policy) = '';

create table if not exists public.cancellation_policies (
  key text primary key,
  label text not null,
  version int not null default 1 check (version > 0),
  rules jsonb not null check (jsonb_typeof(rules) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.cancellation_policies (key, label, rules)
values
  (
    'standard_visit',
    'Standard visit cancellation',
    jsonb_build_object(
      'version', 1,
      'rules', jsonb_build_array(
        jsonb_build_object(
          'name', 'provider_fault_full_refund',
          'priority', 100,
          'match', jsonb_build_object('reasons', jsonb_build_array('provider_fault')),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000)
        ),
        jsonb_build_object(
          'name', 'provider_cancels_full_refund_and_credit',
          'priority', 95,
          'match', jsonb_build_object(
            'actors', jsonb_build_array('provider'),
            'reasons', jsonb_build_array('provider_cancellation', 'provider_no_show')
          ),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000, 'credit_paise', 5000)
        ),
        jsonb_build_object(
          'name', 'platform_cancellation',
          'priority', 90,
          'match', jsonb_build_object('reasons', jsonb_build_array('platform')),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000)
        ),
        jsonb_build_object(
          'name', 'customer_before_trip',
          'priority', 80,
          'match', jsonb_build_object(
            'actors', jsonb_build_array('customer'),
            'reasons', jsonb_build_array('customer_choice'),
            'statuses', jsonb_build_array('pending_payment', 'requested', 'accepted')
          ),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 0)
        ),
        jsonb_build_object(
          'name', 'customer_after_trip_or_no_show',
          'priority', 70,
          'match', jsonb_build_object(
            'reasons', jsonb_build_array('customer_choice', 'customer_no_show', 'customer_payment_default'),
            'statuses', jsonb_build_array(
              'en_route', 'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress',
              'completion_requested', 'confirmed'
            )
          ),
          'result', jsonb_build_object('principal_bp', 0, 'platform_bp', 0)
        )
      )
    )::jsonb
  ),
  (
    'fixed',
    'Fixed service cancellation',
    jsonb_build_object(
      'version', 1,
      'rules', jsonb_build_array(
        jsonb_build_object(
          'name', 'provider_fault_full_refund',
          'priority', 100,
          'match', jsonb_build_object('reasons', jsonb_build_array('provider_fault')),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000)
        ),
        jsonb_build_object(
          'name', 'platform_cancellation',
          'priority', 95,
          'match', jsonb_build_object('reasons', jsonb_build_array('platform')),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000)
        ),
        jsonb_build_object(
          'name', 'full_refund_at_least_three_hours',
          'priority', 80,
          'match', jsonb_build_object('actors', jsonb_build_array('customer'), 'min_hours_before_start', 3),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000)
        ),
        jsonb_build_object(
          'name', 'half_refund_after_arrival_or_no_show',
          'priority', 75,
          'match', jsonb_build_object('reasons', jsonb_build_array('customer_no_show', 'customer_payment_default')),
          'result', jsonb_build_object('principal_bp', 5000, 'platform_bp', 0)
        ),
        jsonb_build_object(
          'name', 'half_refund_after_arrival_status',
          'priority', 74,
          'match', jsonb_build_object(
            'actors', jsonb_build_array('customer'),
            'statuses', jsonb_build_array('inspecting', 'in_progress', 'completion_requested')
          ),
          'result', jsonb_build_object('principal_bp', 5000, 'platform_bp', 0)
        ),
        jsonb_build_object(
          'name', 'late_customer_cancellation_less_fee',
          'priority', 70,
          'match', jsonb_build_object('actors', jsonb_build_array('customer'), 'max_hours_before_start', 3),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000, 'retained_paise_max', 9900, 'retained_principal_bp', 2500)
        )
      )
    )::jsonb
  ),
  (
    'flexible',
    'Flexible cancellation',
    jsonb_build_object(
      'version', 1,
      'rules', jsonb_build_array(
        jsonb_build_object('name', 'provider_fault', 'priority', 100,
          'match', jsonb_build_object('reasons', jsonb_build_array('provider_fault')),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000)),
        jsonb_build_object('name', 'full_before_three_hours', 'priority', 80,
          'match', jsonb_build_object('min_hours_before_start', 3),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000)),
        jsonb_build_object('name', 'after_arrival', 'priority', 75,
          'match', jsonb_build_object('statuses', jsonb_build_array('inspecting', 'in_progress', 'completion_requested')),
          'result', jsonb_build_object('principal_bp', 0, 'platform_bp', 0)),
        jsonb_build_object('name', 'half_inside_three_hours', 'priority', 70,
          'match', jsonb_build_object('max_hours_before_start', 3),
          'result', jsonb_build_object('principal_bp', 5000, 'platform_bp', 0))
      )
    )::jsonb
  ),
  (
    'time_based',
    'Session cancellation',
    jsonb_build_object(
      'version', 1,
      'rules', jsonb_build_array(
        jsonb_build_object('name', 'provider_fault', 'priority', 100,
          'match', jsonb_build_object('reasons', jsonb_build_array('provider_fault')),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000)),
        jsonb_build_object('name', 'free_at_least_twelve_hours', 'priority', 80,
          'match', jsonb_build_object('min_hours_before_start', 12),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000)),
        jsonb_build_object('name', 'session_charged', 'priority', 70,
          'match', jsonb_build_object('max_hours_before_start', 12),
          'result', jsonb_build_object('principal_bp', 0, 'platform_bp', 0))
      )
    )::jsonb
  ),
  (
    'event_moderate',
    'Event moderate cancellation',
    jsonb_build_object(
      'version', 1,
      'rules', jsonb_build_array(
        jsonb_build_object('name', 'provider_fault', 'priority', 100,
          'match', jsonb_build_object('reasons', jsonb_build_array('provider_fault')),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000)),
        jsonb_build_object('name', 'cooling_off_advance', 'priority', 90,
          'match', jsonb_build_object('max_hours_since_booking', 48, 'min_hours_before_start', 720),
          'result', jsonb_build_object('advance_bp', 10000, 'milestone_bp', 10000, 'platform_bp', 10000)),
        jsonb_build_object('name', 'at_least_thirty_days', 'priority', 80,
          'match', jsonb_build_object('min_hours_before_start', 720),
          'result', jsonb_build_object('advance_bp', 0, 'milestone_bp', 10000, 'platform_bp', 0)),
        jsonb_build_object('name', 'seven_to_thirty_days', 'priority', 70,
          'match', jsonb_build_object('min_hours_before_start', 168, 'max_hours_before_start', 720),
          'result', jsonb_build_object('advance_bp', 0, 'milestone_bp', 5000, 'platform_bp', 0)),
        jsonb_build_object('name', 'inside_seven_days', 'priority', 60,
          'match', jsonb_build_object('max_hours_before_start', 168),
          'result', jsonb_build_object('advance_bp', 0, 'milestone_bp', 0, 'platform_bp', 0))
      )
    )::jsonb
  ),
  (
    'event_strict',
    'Event strict cancellation',
    jsonb_build_object(
      'version', 1,
      'rules', jsonb_build_array(
        jsonb_build_object('name', 'provider_fault', 'priority', 100,
          'match', jsonb_build_object('reasons', jsonb_build_array('provider_fault')),
          'result', jsonb_build_object('principal_bp', 10000, 'platform_bp', 10000)),
        jsonb_build_object('name', 'cooling_off_at_least_fifteen_days', 'priority', 95,
          'match', jsonb_build_object('max_hours_since_booking', 48, 'min_hours_before_start', 360),
          'result', jsonb_build_object('advance_bp', 10000, 'milestone_bp', 5000, 'platform_bp', 10000)),
        jsonb_build_object('name', 'cooling_off_inside_fifteen_days', 'priority', 94,
          'match', jsonb_build_object('max_hours_since_booking', 48, 'max_hours_before_start', 360),
          'result', jsonb_build_object('advance_bp', 10000, 'milestone_bp', 0, 'platform_bp', 10000)),
        jsonb_build_object('name', 'at_least_fifteen_days', 'priority', 80,
          'match', jsonb_build_object('min_hours_before_start', 360),
          'result', jsonb_build_object('advance_bp', 0, 'milestone_bp', 5000, 'platform_bp', 0)),
        jsonb_build_object('name', 'inside_fifteen_days', 'priority', 70,
          'match', jsonb_build_object('max_hours_before_start', 360),
          'result', jsonb_build_object('advance_bp', 0, 'milestone_bp', 0, 'platform_bp', 0))
      )
    )::jsonb
  )
on conflict (key) do update
set label = excluded.label,
    version = excluded.version,
    rules = excluded.rules,
    active = excluded.active,
    updated_at = now();

insert into public.cancellation_policies (key, label, rules)
select 'fixed_flexible', 'Flexible fixed-service cancellation', rules
  from public.cancellation_policies
 where key = 'fixed'
on conflict (key) do update
set label = excluded.label,
    rules = excluded.rules,
    active = true,
    updated_at = now();

-- 0018 owns the booking core snapshot trigger. Extend that trigger rather than adding a
-- competing one: future fixed/proposal RPCs must keep their 0018/0020 contract intact.
drop trigger if exists bookings_apply_core_contract on public.bookings;

update public.bookings b
   set cancellation_snapshot = jsonb_build_object(
         'key', cp.key,
         'label', cp.label,
         'version', cp.version,
         'rules', cp.rules -> 'rules'
       ),
       exclusive = c.exclusive
  from public.categories c, public.cancellation_policies cp
 where b.category_id = c.id
   and cp.key = coalesce(b.cancellation_snapshot ->> 'key', c.cancellation_policy, 'standard_visit')
   and cp.active;

alter table public.bookings
  alter column cancellation_snapshot set not null;

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
  perform public._assert_bookable(c.id, new.provider_id, v_city, c.archetype, v_window);
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

create trigger bookings_apply_core_contract
  before insert or update of archetype, category_config_version, location_mode,
    pricing_snapshot, payment_template_snapshot, cancellation_snapshot, platform_fee_rule_snapshot, exclusive
  on public.bookings
  for each row execute function public._apply_booking_core_contract();

alter table public.cancellation_policies enable row level security;
revoke all on public.cancellation_policies from anon, authenticated;
grant select on public.cancellation_policies to anon, authenticated;
drop policy if exists cancellation_policies_read on public.cancellation_policies;
create policy cancellation_policies_read on public.cancellation_policies
  for select to anon, authenticated
  using (active);

-- 0018 owns transition enforcement, so extend its reconciled matrix for the C7 cancellation paths
-- instead of bypassing _set_status. Statuses that are not legal for an archetype still fail inside
-- the individual cancellation RPC and never gain a transition through this seed.
insert into public.archetype_transitions (archetype, from_status, to_status, actor)
select a.archetype, s.status, 'cancelled'::public.booking_status, a.actor
  from unnest(array['inspect_quote', 'fixed', 'proposal', 'time_based', 'remote']::text[]) a_archetype(archetype)
  cross join unnest(array['customer', 'provider', 'system']::text[]) a_actor(actor)
  cross join unnest(array[
    'pending_payment', 'requested', 'accepted', 'confirmed', 'en_route', 'inspecting',
    'quote_sent', 'awaiting_payment', 'in_progress', 'completion_requested'
  ]::public.booking_status[]) s(status)
  cross join lateral (select a_archetype.archetype, a_actor.actor) a
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- One cancellation evaluator: all booking cancellations and release decisions
-- ---------------------------------------------------------------------------
create or replace function public._rule_matches_cancellation(
  p_rule jsonb,
  p_actor text,
  p_reason text,
  p_status public.booking_status,
  p_hours_before_start numeric,
  p_hours_since_booking numeric
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_match jsonb := p_rule -> 'match';
begin
  if v_match ? 'actors'
     and not exists (
       select 1 from jsonb_array_elements_text(v_match -> 'actors') x where x = p_actor
     ) then
    return false;
  end if;
  if v_match ? 'reasons'
     and not exists (
       select 1 from jsonb_array_elements_text(v_match -> 'reasons') x where x = p_reason
     ) then
    return false;
  end if;
  if v_match ? 'statuses'
     and not exists (
       select 1 from jsonb_array_elements_text(v_match -> 'statuses') x where x = p_status::text
     ) then
    return false;
  end if;
  if v_match ? 'min_hours_before_start'
     and (p_hours_before_start is null or p_hours_before_start < (v_match ->> 'min_hours_before_start')::numeric) then
    return false;
  end if;
  if v_match ? 'max_hours_before_start'
     and (p_hours_before_start is null or p_hours_before_start >= (v_match ->> 'max_hours_before_start')::numeric) then
    return false;
  end if;
  if v_match ? 'max_hours_since_booking'
     and (p_hours_since_booking is null or p_hours_since_booking > (v_match ->> 'max_hours_since_booking')::numeric) then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public._cancellation_outcome(
  p_booking_id uuid,
  p_actor text,
  p_reason text,
  p_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_rule jsonb;
  v_result jsonb;
  v_paid int;
  v_explicit_platform int;
  v_platform int := 0;
  v_principal int;
  v_advance int;
  v_milestones int;
  v_prior_refunds int;
  v_service_refund int := 0;
  v_platform_refund int := 0;
  v_refundable int;
  v_hours_before numeric;
  v_hours_since numeric;
  v_retained int;
begin
  select * into b from public.bookings where id = p_booking_id;
  perform public._assert(found, 'booking not found');
  perform public._assert(p_actor in ('customer', 'provider', 'platform', 'system'), 'invalid cancellation actor');
  perform public._assert(
    p_reason in ('customer_choice', 'provider_fault', 'provider_cancellation', 'provider_no_show',
                 'customer_payment_default', 'customer_no_show', 'platform'),
    'invalid cancellation reason'
  );

  select coalesce(sum(p.amount) filter (where p.status = 'paid'), 0)::int,
         coalesce(sum(p.amount) filter (
           where p.status = 'paid' and p.purpose::text = 'platform_fee'
         ), 0)::int,
         coalesce(sum(p.amount) filter (
           where p.status = 'paid' and p.purpose::text = 'advance'
         ), 0)::int
    into v_paid, v_explicit_platform, v_advance
    from public.payments p
   where p.booking_id = b.id;

  if v_explicit_platform > 0 then
    v_platform := least(b.platform_fee, v_explicit_platform);
  elsif b.platform_fee > 0 and b.total_amount is not null then
    v_platform := least(
      b.platform_fee,
      greatest(v_paid - greatest(b.total_amount - b.platform_fee, b.visit_fee, 0), 0)
    );
  end if;
  v_principal := greatest(v_paid - v_platform, 0);
  v_advance := least(v_advance, v_principal);
  v_milestones := greatest(v_principal - v_advance, 0);

  select coalesce(sum(r.amount) filter (where r.status <> 'failed'), 0)::int
    into v_prior_refunds
    from public.refunds r
    join public.payments p on p.id = r.payment_id
   where p.booking_id = b.id;

  v_hours_before := extract(epoch from (b.scheduled_at - p_at)) / 3600.0;
  v_hours_since := greatest(extract(epoch from (p_at - b.created_at)) / 3600.0, 0);

  select x
    into v_rule
    from jsonb_array_elements(coalesce(b.cancellation_snapshot -> 'rules', '[]'::jsonb)) x
   where public._rule_matches_cancellation(x, p_actor, p_reason, b.status, v_hours_before, v_hours_since)
   order by coalesce((x ->> 'priority')::int, 0) desc
   limit 1;
  perform public._assert(found, 'cancellation policy does not define this outcome');
  v_result := v_rule -> 'result';

  if v_result ? 'advance_bp' or v_result ? 'milestone_bp' then
    v_service_refund :=
      floor(v_advance * coalesce((v_result ->> 'advance_bp')::numeric, 0) / 10000)
      + floor(v_milestones * coalesce((v_result ->> 'milestone_bp')::numeric, 0) / 10000);
  else
    v_service_refund :=
      floor(v_principal * coalesce((v_result ->> 'principal_bp')::numeric, 0) / 10000);
  end if;
  v_platform_refund :=
    floor(v_platform * coalesce((v_result ->> 'platform_bp')::numeric, 0) / 10000);

  if v_result ? 'retained_principal_bp' then
    v_retained := floor(v_principal * (v_result ->> 'retained_principal_bp')::numeric / 10000);
    if v_result ? 'retained_paise_max' then
      v_retained := least(v_retained, (v_result ->> 'retained_paise_max')::int);
    end if;
    v_service_refund := least(v_service_refund, greatest(v_principal - v_retained, 0));
  end if;

  -- A cancellation refund can never refund an amount already queued/refunded before this evaluation.
  v_refundable := greatest(v_paid - v_prior_refunds, 0);
  v_service_refund := greatest(least(v_service_refund, v_refundable), 0);
  v_platform_refund := greatest(
    least(v_platform_refund, greatest(v_refundable - v_service_refund, 0)),
    0
  );
  v_principal := greatest(v_principal - least(v_prior_refunds, v_principal), 0);

  return jsonb_build_object(
    'policy_key', b.cancellation_snapshot ->> 'key',
    'policy_version', (b.cancellation_snapshot ->> 'version')::int,
    'rule', v_rule ->> 'name',
    'actor', p_actor,
    'reason', p_reason,
    'evaluated_at', p_at,
    'service_principal_paid', v_principal,
    'platform_fee_paid', v_platform,
    'prior_refunds', v_prior_refunds,
    'service_refund', v_service_refund,
    'platform_refund', v_platform_refund,
    'refund_amount', v_service_refund + v_platform_refund,
    'provider_compensation', greatest(v_principal - v_service_refund, 0),
    'customer_credit', coalesce((v_result ->> 'credit_paise')::int, 0),
    'release_after', p_at + interval '24 hours'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Availability: serialised overlap test for exclusive service windows
-- ---------------------------------------------------------------------------
create or replace function public._reserve_booking_service_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window tstzrange := new.service_window;
begin
  if v_window is null or isempty(v_window) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.provider_id::text));
  if exists (
    select 1
      from public.bookings existing
     where existing.provider_id = new.provider_id
       and existing.id <> new.id
       and existing.service_window && v_window
       and (existing.exclusive or new.exclusive)
       and (
         existing.status::text in (
           'requested', 'accepted', 'confirmed', 'en_route', 'inspecting',
           'quote_sent', 'awaiting_payment', 'in_progress', 'completion_requested'
         )
         or (
           existing.status::text = 'pending_payment'
           and existing.created_at > now() - interval '30 minutes'
         )
       )
  ) then
    raise exception 'provider_unavailable: service window overlaps an existing booking' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_z_reserve_service_window on public.bookings;
create trigger bookings_z_reserve_service_window
  before insert on public.bookings
  for each row execute function public._reserve_booking_service_window();

-- ---------------------------------------------------------------------------
-- Payout release tranches and post-transfer recovery
-- ---------------------------------------------------------------------------
alter table public.payout_transfers
  add column if not exists release_after timestamptz,
  add column if not exists reversed_amount int not null default 0 check (reversed_amount >= 0);
alter table public.payout_transfers
  add constraint payout_transfers_reversed_le_amount check (reversed_amount <= amount);

update public.payout_transfers t
   set release_after = p.release_after
  from public.payouts p
 where t.payout_id = p.id and t.release_after is null;
alter table public.payout_transfers
  alter column release_after set not null;

alter type public.transfer_status add value if not exists 'reversal_pending';
alter type public.transfer_status add value if not exists 'reversed';
alter type public.transfer_status add value if not exists 'partially_reversed';

create or replace function public._payout_transfer_set_rail()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_release_after timestamptz;
begin
  new.rail := coalesce(new.rail, public.get_payout_rail());
  if new.release_after is null then
    select release_after into v_release_after from public.payouts where id = new.payout_id;
    new.release_after := coalesce(v_release_after, now() + interval '24 hours');
  end if;
  return new;
end;
$$;

create table if not exists public.payout_transfer_reversals (
  id uuid primary key default gen_random_uuid(),
  payout_transfer_id uuid not null references public.payout_transfers (id) on delete cascade,
  recovery_key text not null unique,
  amount int not null check (amount > 0),
  rail text not null check (rail in ('route', 'payouts')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'reversed', 'failed', 'debt_recorded')),
  razorpay_reversal_id text unique,
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists payout_transfer_reversals_due_idx
  on public.payout_transfer_reversals (created_at) where status = 'pending';

alter table public.provider_receivables
  add column if not exists recovery_key text,
  add constraint provider_receivables_recovery_key_key unique (recovery_key);

alter table public.payout_transfer_reversals enable row level security;
revoke all on public.payout_transfer_reversals from anon, authenticated;

create or replace function public._record_provider_receivable(
  p_provider_id uuid,
  p_booking_id uuid,
  p_amount int,
  p_reason text,
  p_recovery_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_amount <= 0 then
    return null;
  end if;
  insert into public.provider_receivables (
    provider_id, booking_id, amount, reason, recovery_key
  ) values (
    p_provider_id, p_booking_id, p_amount, left(p_reason, 300), p_recovery_key
  )
  on conflict (recovery_key) do update
    set reason = excluded.reason
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public._queue_transfer_reversals(
  p_booking_id uuid,
  p_amount int,
  p_reason text,
  p_recovery_key text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_remaining int := greatest(p_amount, 0);
  v_available int;
  v_take int;
  v_queued int := 0;
  v_key text;
begin
  for r in
    select t.*, po.provider_id
      from public.payout_transfers t
      join public.payouts po on po.id = t.payout_id
     where po.booking_id = p_booking_id
       and t.status::text in ('transferred', 'partially_reversed')
     order by t.transferred_at nulls last, t.created_at
     for update of t
  loop
    exit when v_remaining <= 0;
    v_available := r.amount - r.reversed_amount
      - coalesce((
          select sum(x.amount) from public.payout_transfer_reversals x
           where x.payout_transfer_id = r.id and x.status in ('pending', 'processing')
        ), 0);
    v_take := least(v_available, v_remaining);
    if v_take <= 0 then
      continue;
    end if;
    v_key := p_recovery_key || ':' || r.id::text;

    if r.rail = 'payouts' then
      insert into public.payout_transfer_reversals (
        payout_transfer_id, recovery_key, amount, rail, status, completed_at, last_error
      ) values (
        r.id, v_key, v_take, r.rail, 'debt_recorded', now(),
        'RazorpayX payout cannot be reversed; provider receivable recorded'
      ) on conflict (recovery_key) do nothing;
      perform public._record_provider_receivable(
        r.provider_id, p_booking_id, v_take, p_reason, v_key
      );
    else
      insert into public.payout_transfer_reversals (
        payout_transfer_id, recovery_key, amount, rail, status
      ) values (
        r.id, v_key, v_take, r.rail, 'pending'
      ) on conflict (recovery_key) do nothing;
    end if;

    v_remaining := v_remaining - v_take;
    v_queued := v_queued + v_take;
  end loop;
  return v_queued;
end;
$$;

drop function if exists public.claim_due_transfer_reversals(int);
create function public.claim_due_transfer_reversals(p_limit int default 20)
returns table (
  reversal_id uuid,
  transfer_id uuid,
  booking_id uuid,
  amount int,
  rail text,
  razorpay_transfer_id text,
  attempts int
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with claimed as (
    update public.payout_transfer_reversals r
       set status = 'processing'
     where r.id in (
       select x.id
         from public.payout_transfer_reversals x
        where x.status = 'pending'
          and x.rail = 'route'
          and (x.next_attempt_at is null or x.next_attempt_at <= now())
        order by x.created_at
        limit p_limit
        for update skip locked
     )
    returning r.*
  )
  select c.id, t.id, po.booking_id, c.amount, c.rail, t.razorpay_transfer_id, c.attempts
    from claimed c
    join public.payout_transfers t on t.id = c.payout_transfer_id
    join public.payouts po on po.id = t.payout_id;
end;
$$;

create or replace function public.complete_transfer_reversal(
  p_reversal_id uuid,
  p_razorpay_reversal_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.payout_transfer_reversals;
  t public.payout_transfers;
begin
  select * into r from public.payout_transfer_reversals where id = p_reversal_id for update;
  if not found or r.status <> 'processing' then
    return;
  end if;
  select * into t from public.payout_transfers where id = r.payout_transfer_id for update;
  update public.payout_transfer_reversals
     set status = 'reversed',
         razorpay_reversal_id = p_razorpay_reversal_id,
         completed_at = now(),
         last_error = null
   where id = r.id;
  update public.payout_transfers
     set reversed_amount = reversed_amount + r.amount,
         status = case
           when reversed_amount + r.amount >= amount then 'reversed'::public.transfer_status
           else 'partially_reversed'::public.transfer_status
         end
   where id = t.id;
  update public.payouts po
     set status = case
       when not exists (
         select 1 from public.payout_transfers x
          where x.payout_id = po.id and x.status::text <> 'reversed'
       ) then 'reversed'::public.payout_status
       else 'partially_reversed'::public.payout_status
     end
   where po.id = t.payout_id;
end;
$$;

create or replace function public.fail_transfer_reversal(p_reversal_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.payout_transfer_reversals;
  v_provider uuid;
  v_booking uuid;
begin
  select * into r from public.payout_transfer_reversals where id = p_reversal_id for update;
  if not found or r.status <> 'processing' then
    return;
  end if;
  if r.attempts + 1 >= 5 then
    select po.provider_id, po.booking_id into v_provider, v_booking
      from public.payout_transfers x
      join public.payouts po on po.id = x.payout_id
     where x.id = r.payout_transfer_id;
    perform public._record_provider_receivable(
      v_provider, v_booking, r.amount, 'Transfer reversal failed after 5 attempts: ' || p_error, r.recovery_key
    );
    update public.payout_transfer_reversals
       set attempts = attempts + 1, status = 'debt_recorded', last_error = left(p_error, 2000),
           completed_at = now()
     where id = r.id;
  else
    update public.payout_transfer_reversals
       set attempts = attempts + 1,
           status = 'pending',
           next_attempt_at = now() + interval '5 minutes' * power(2, attempts),
           last_error = left(p_error, 2000)
     where id = r.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Replace cancellation and post-transfer dispute paths with C9-safe primitives
-- ---------------------------------------------------------------------------
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
    ),
    'booking can no longer be cancelled'
  );

  v_outcome := public._cancellation_outcome(b.id, p_actor, p_reason, p_at);
  update public.payments
     set status = 'failed', cancel_link_pending = true
   where booking_id = b.id and status = 'created';
  perform public._close_open_quotes(b.id);

  -- Customer refunds are queued immediately. They never wait for transfer reversal or provider recovery.
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
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can cancel');
  perform public._cancel_booking_by_policy(
    b.id, 'customer', 'customer_choice', coalesce(nullif(trim(p_reason), ''), 'customer choice'), now()
  );
end;
$$;

create or replace function public.provider_cancel_booking(
  p_booking_id uuid,
  p_reason text default 'provider_cancellation',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can cancel');
  perform public._assert(
    p_reason in ('provider_cancellation', 'provider_no_show', 'customer_payment_default'),
    'invalid provider cancellation reason'
  );
  return public._cancel_booking_by_policy(
    b.id,
    'provider',
    p_reason,
    coalesce(nullif(trim(p_note), ''), replace(p_reason, '_', ' ')),
    now()
  );
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
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can raise a dispute');
  perform public._assert(
    b.status::text in ('in_progress', 'completion_requested', 'completed', 'closed'),
    'dispute not allowed in this state'
  );
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

create or replace function public.resolve_dispute(
  p_booking_id uuid,
  p_outcome public.dispute_outcome,
  p_refund_amount int default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  po public.payouts;
  v_refund int;
  v_refunded int;
  v_recovery_key text;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(b.status = 'disputed', 'booking is not disputed');
  select * into po from public.payouts where booking_id = b.id for update;

  if p_outcome = 'full_refund' then
    v_refund := public._paid_total(b.id) - b.refund_amount;
  elsif p_outcome = 'partial_refund' then
    v_refund := p_refund_amount;
    perform public._assert(v_refund > 0 and v_refund <= po.amount, 'invalid refund amount');
  else
    v_refund := 0;
  end if;

  if v_refund > 0 then
    if p_outcome = 'full_refund' then
      v_refunded := public._refund_booking_payments(b.id, 'dispute: full refund');
    else
      v_refunded := public._refund_partial(b.id, v_refund, 'dispute: partial refund');
    end if;
    perform public._assert(v_refunded = v_refund, 'refund exceeds refundable payments');
    update public.bookings set refund_amount = refund_amount + v_refunded where id = b.id;
    v_recovery_key := 'dispute:' || b.id::text || ':' || (b.refund_amount + v_refunded)::text;
    perform public._queue_transfer_reversals(b.id, v_refund, 'dispute: ' || p_outcome::text, v_recovery_key);
  end if;

  if p_outcome = 'full_refund' then
    update public.payout_transfers
       set status = 'failed', last_error = 'dispute: full refund'
     where status::text in ('pending', 'failed')
       and payout_id in (select id from public.payouts where booking_id = b.id);
    update public.payouts set amount = 0 where id = po.id;
    update public.payouts
       set status = case
         when exists (select 1 from public.payout_transfer_reversals x
                       join public.payout_transfers t on t.id = x.payout_transfer_id
                      where t.payout_id = po.id and x.status in ('pending', 'processing')) then 'frozen'::public.payout_status
         when exists (select 1 from public.provider_receivables r
                      where r.booking_id = b.id and r.status = 'open') then 'partially_reversed'::public.payout_status
         else 'reversed'::public.payout_status
       end
     where id = po.id;
    perform public._set_status(b.id, 'refunded', v_uid, coalesce(p_note, 'dispute: full refund'));
  elsif po.id is null then
    perform public._finalize_completion(b.id, v_uid, 'dispute resolved before completion');
  else
    update public.payouts
       set amount = greatest(amount - v_refund, 0),
           status = case when exists (
             select 1 from public.payout_transfer_reversals x
              join public.payout_transfers t on t.id = x.payout_transfer_id
              where t.payout_id = po.id and x.status in ('pending', 'processing')
           ) then 'frozen'::public.payout_status else 'pending'::public.payout_status end,
           release_after = greatest(release_after, now())
     where id = po.id;
    delete from public.payout_transfers
     where payout_id = po.id and status::text = 'failed' and attempts = 0 and reversed_amount = 0;
    perform public._allocate_payout(po.id);
    perform public._set_status(b.id, 'completed', v_uid, 'dispute resolved');
  end if;

  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'resolve_dispute', b.id,
          jsonb_build_object('outcome', p_outcome, 'refund_amount', v_refund, 'note', p_note));
end;
$$;

-- Use the tranche's own release gate, and hold the booking row while claiming to serialise with cancellation/disputes.
drop function if exists public.claim_due_transfers(int);
create function public.claim_due_transfers(p_limit int default 20)
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
         join public.bookings b on b.id = po.booking_id
         join public.providers pr on pr.id = po.provider_id
         left join public.provider_payout_accounts pa on pa.provider_id = pr.id
        where t.status = 'pending'
          and (t.next_attempt_at is null or t.next_attempt_at <= now())
          and t.release_after <= now()
          and po.status = 'pending'
          and po.release_after <= now()
          and b.status <> 'disputed'
          and ((coalesce(t.rail, 'route') = 'route' and pr.razorpay_account_id is not null)
               or (t.rail = 'payouts' and pa.fund_account_id is not null and pr.kyc_status = 'verified'))
        order by t.release_after, po.release_after
        limit p_limit
        for update of t, po, b skip locked
     )
    returning pt.id
  )
  select array_agg(claimed.id) into v_ids from claimed;

  for c in
    select cl.id, cl.payout_id, po.booking_id, po.provider_id, cl.amount, coalesce(cl.rail, 'route') as rail,
           pm.razorpay_payment_id, pr.razorpay_account_id, pa.fund_account_id, cl.attempts, cl.idempotency_seq
      from public.payout_transfers cl
      join public.payouts po on po.id = cl.payout_id
      join public.providers pr on pr.id = po.provider_id
      left join public.provider_payout_accounts pa on pa.provider_id = pr.id
      join public.payments pm on pm.id = cl.source_payment_id
     where cl.id = any (coalesce(v_ids, '{}'))
  loop
    v_net := c.amount - public._net_receivables(c.id);
    if v_net <= 0 then
      perform public.complete_transfer(c.id, 'netted_' || c.id::text);
      continue;
    end if;
    transfer_id := c.id; payout_id := c.payout_id; booking_id := c.booking_id; provider_id := c.provider_id;
    amount := v_net; gross_amount := c.amount; rail := c.rail; razorpay_payment_id := c.razorpay_payment_id;
    account_id := c.razorpay_account_id; fund_account_id := c.fund_account_id; attempts := c.attempts;
    idempotency_key := c.id::text || ':' || c.idempotency_seq::text;
    return next;
  end loop;
end;
$$;

revoke execute on function
  public._apply_booking_core_contract(),
  public._rule_matches_cancellation(jsonb, text, text, public.booking_status, numeric, numeric),
  public._cancellation_outcome(uuid, text, text, timestamptz),
  public._reserve_booking_service_window(),
  public._record_provider_receivable(uuid, uuid, int, text, text),
  public._queue_transfer_reversals(uuid, int, text, text),
  public._cancel_booking_by_policy(uuid, text, text, text, timestamptz),
  public.claim_due_transfer_reversals(int),
  public.complete_transfer_reversal(uuid, text),
  public.fail_transfer_reversal(uuid, text)
from public, anon, authenticated;

grant execute on function public._cancellation_outcome(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.provider_cancel_booking(uuid, text, text), public.cancel_booking(uuid, text) to authenticated;
grant execute on function
  public.claim_due_transfer_reversals(int),
  public.complete_transfer_reversal(uuid, text),
  public.fail_transfer_reversal(uuid, text)
to service_role;

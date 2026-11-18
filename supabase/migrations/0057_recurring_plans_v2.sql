-- Recurring plan v2: preserve legacy weekly schedules while adding explicit recurrence,
-- provider acceptance, occurrence changes, and idempotent scheduling.

-- Normalize pre-existing invalid/missing payment windows without changing other valid rules.
update public.app_config
   set value = case
     when jsonb_typeof(value) = 'object'
       and jsonb_typeof(value -> 'payment_due_hours_before') = 'number'
       and (value ->> 'payment_due_hours_before') ~ '^[0-9]{1,3}$'
     then case
       when jsonb_typeof(value -> 'billing_grace_hours') = 'number'
         and (value ->> 'billing_grace_hours') ~ '^[0-9]{1,3}$'
       then case
         when (value ->> 'payment_due_hours_before')::int between 0 and 720
           and (value ->> 'billing_grace_hours')::int between 0 and 720
           and (value ->> 'payment_due_hours_before')::int > (value ->> 'billing_grace_hours')::int
           then value
         else jsonb_set(
           jsonb_set(value, '{payment_due_hours_before}', '48'::jsonb, true),
           '{billing_grace_hours}', '24'::jsonb, true
         )
       end
       else jsonb_set(
         jsonb_set(value, '{payment_due_hours_before}', '48'::jsonb, true),
         '{billing_grace_hours}', '24'::jsonb, true
       )
     end
     else jsonb_set(
       jsonb_set('{}'::jsonb, '{payment_due_hours_before}', '48'::jsonb, true),
       '{billing_grace_hours}', '24'::jsonb, true
     )
   end
 where key = 'recurring_rules';

alter table public.recurring_schedules
  add column if not exists interval_count int not null default 1,
  add column if not exists month_day int,
  add column if not exists custom_dates date[] not null default '{}'::date[],
  add column if not exists max_occurrences int,
  add column if not exists occurrences_created int not null default 0,
  add column if not exists archetype text not null default 'time_based',
  add column if not exists package_qty numeric(10,2),
  add column if not exists provider_acceptance text not null default 'pending',
  add column if not exists acceptance_mode text not null default 'plan',
  add column if not exists decided_at timestamptz,
  add column if not exists decline_reason text,
  add column if not exists paused_at timestamptz,
  add column if not exists pause_until date,
  add column if not exists billing_frequency text not null default 'per_visit',
  add column if not exists plan_version text not null default 'legacy';

alter table public.recurring_schedules
  drop constraint if exists recurring_schedules_frequency_check;

do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
    from pg_constraint
   where conrelid = 'public.recurring_schedules'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%array_length(weekdays, 1)%'
   limit 1;
  if v_constraint is not null then
    execute format('alter table public.recurring_schedules drop constraint %I', v_constraint);
  end if;
end;
$$;

alter table public.recurring_schedules
  add constraint recurring_schedules_frequency_v2_check
    check (frequency in ('daily', 'alternate_days', 'weekly', 'monthly', 'custom')),
  add constraint recurring_schedules_interval_count_check
    check (interval_count between 1 and 12),
  add constraint recurring_schedules_month_day_check
    check (month_day is null or month_day between 1 and 28),
  add constraint recurring_schedules_max_occurrences_check
    check (max_occurrences is null or max_occurrences between 1 and 400),
  add constraint recurring_schedules_occurrences_created_check
    check (occurrences_created >= 0),
  add constraint recurring_schedules_archetype_v2_check
    check (archetype in ('time_based', 'fixed')),
  add constraint recurring_schedules_provider_acceptance_check
    check (provider_acceptance in ('pending', 'accepted', 'declined')),
  add constraint recurring_schedules_acceptance_mode_check
    check (acceptance_mode in ('plan', 'occurrence')),
  add constraint recurring_schedules_plan_version_check
    check (plan_version in ('legacy', 'v2')),
  add constraint recurring_schedules_billing_frequency_check
    check (billing_frequency in ('per_visit', 'weekly', 'monthly', 'prepaid_package')),
  add constraint recurring_schedules_weekdays_frequency_check
    check (
      weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
      and (
        (frequency = 'weekly' and cardinality(weekdays) between 1 and 7)
        or (frequency <> 'weekly' and cardinality(weekdays) = 0)
      )
    ),
  add constraint recurring_schedules_frequency_fields_check
    check (
      (frequency = 'monthly' and month_day is not null)
      or (frequency <> 'monthly' and month_day is null)
    ),
  add constraint recurring_schedules_custom_dates_check
    check (
      (frequency = 'custom' and cardinality(custom_dates) between 1 and 120)
      or (frequency <> 'custom' and cardinality(custom_dates) = 0)
    ),
  add constraint recurring_schedules_decline_reason_check
    check (decline_reason is null or char_length(decline_reason) <= 300);

-- Existing rows predate plan-level acceptance; retain their accepted weekly schedule behavior.
update public.recurring_schedules
   set provider_acceptance = 'accepted',
       acceptance_mode = 'occurrence',
       billing_frequency = case payment_mode
         when 'per_session' then 'per_visit'
         when 'pack_prepaid' then 'prepaid_package'
         when 'monthly_prepaid' then 'monthly'
         else 'per_visit'
       end
 where provider_acceptance = 'pending'
    or acceptance_mode = 'plan'
    or billing_frequency = 'per_visit';
update public.recurring_schedules r
   set occurrences_created = counts.created
  from (
    select b.recurring_schedule_id, count(*)::int created
      from public.bookings b
     where b.recurring_schedule_id is not null
     group by b.recurring_schedule_id
  ) counts
 where r.id = counts.recurring_schedule_id;

create or replace function public._guard_recurring_payment_window_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due_hours int;
  v_grace_hours int;
begin
  if tg_op = 'DELETE' then
    perform public._assert(old.key <> 'recurring_rules', 'recurring_rules configuration cannot be deleted');
    return old;
  end if;

  if tg_op = 'UPDATE' and old.key = 'recurring_rules' and new.key <> old.key then
    raise exception 'recurring_rules configuration key cannot be changed';
  end if;
  if new.key is distinct from 'recurring_rules' then
    return new;
  end if;

  perform public._assert(
    coalesce(jsonb_typeof(new.value) = 'object', false),
    'recurring_rules must be a JSON object'
  );
  if not (new.value ? 'payment_due_hours_before') then
    new.value := jsonb_set(new.value, '{payment_due_hours_before}', '48'::jsonb, true);
  end if;
  if not (new.value ? 'billing_grace_hours') then
    new.value := jsonb_set(new.value, '{billing_grace_hours}', '24'::jsonb, true);
  end if;

  perform public._assert(
    jsonb_typeof(new.value -> 'payment_due_hours_before') = 'number'
      and (new.value ->> 'payment_due_hours_before') ~ '^[0-9]{1,3}$',
    'payment_due_hours_before must be a whole-number JSON number'
  );
  perform public._assert(
    jsonb_typeof(new.value -> 'billing_grace_hours') = 'number'
      and (new.value ->> 'billing_grace_hours') ~ '^[0-9]{1,3}$',
    'billing_grace_hours must be a whole-number JSON number'
  );
  v_due_hours := (new.value ->> 'payment_due_hours_before')::int;
  v_grace_hours := (new.value ->> 'billing_grace_hours')::int;
  perform public._assert(v_due_hours between 0 and 720, 'payment_due_hours_before must be between 0 and 720');
  perform public._assert(v_grace_hours between 0 and 720, 'billing_grace_hours must be between 0 and 720');
  perform public._assert(
    v_due_hours > v_grace_hours,
    'payment_due_hours_before must be greater than billing_grace_hours'
  );

  update public.payment_schedule ps
     set due_at = greatest(b.scheduled_at - make_interval(hours => v_due_hours), now()),
         updated_at = now()
    from public.bookings b
    join public.recurring_schedules r on r.id = b.recurring_schedule_id
   where ps.booking_id = b.id
     and r.billing_frequency = 'per_visit'
     and b.status::text = 'pending_payment'
     and ps.status in ('due', 'upcoming')
     and b.scheduled_at is not null;
  return new;
end;
$$;

drop trigger if exists app_config_recurring_payment_window_guard on public.app_config;
create trigger app_config_recurring_payment_window_guard
  before insert or update of key, value on public.app_config
  for each row execute function public._guard_recurring_payment_window_rules();
drop trigger if exists app_config_recurring_rules_delete_guard on public.app_config;
create trigger app_config_recurring_rules_delete_guard
  before delete on public.app_config
  for each row execute function public._guard_recurring_payment_window_rules();

create table public.recurring_occurrence_changes (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.recurring_schedules (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete set null,
  occurrence_date date not null,
  original_at timestamptz not null,
  kind text not null check (kind in (
    'skipped', 'provider_unavailable', 'reschedule_requested', 'rescheduled',
    'reschedule_declined', 'provider_absent', 'cancelled'
  )),
  new_at timestamptz,
  actor_id uuid references public.profiles (id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now()
);
create index recurring_occurrence_changes_schedule_date_idx
  on public.recurring_occurrence_changes (schedule_id, occurrence_date, created_at);
create index recurring_occurrence_changes_booking_idx
  on public.recurring_occurrence_changes (booking_id, created_at desc)
  where booking_id is not null;
create unique index recurring_occurrence_changes_skip_unavailable_uq
  on public.recurring_occurrence_changes (schedule_id, occurrence_date, kind)
  where kind in ('skipped', 'provider_unavailable');

alter table public.recurring_occurrence_changes enable row level security;
revoke all on public.recurring_occurrence_changes from public, anon, authenticated;
grant select on public.recurring_occurrence_changes to authenticated;
grant all on public.recurring_occurrence_changes to service_role;
create or replace function public._can_read_recurring_occurrence_changes(p_schedule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.recurring_schedules r
     where r.id = p_schedule_id
       and (
         r.customer_id = auth.uid()
         or public._acts_for(r.provider_id, 'staff')
         or public._is_admin()
       )
  );
$$;
create policy recurring_occurrence_changes_participants
  on public.recurring_occurrence_changes
  for select to authenticated
  using (public._can_read_recurring_occurrence_changes(schedule_id));

create table public.recurring_expiry_failures (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  schedule_id uuid not null references public.recurring_schedules (id) on delete cascade,
  occurrence_date date not null,
  failure_sqlstate text not null check (char_length(failure_sqlstate) = 5),
  failure_stage text not null check (failure_stage = 'booking_lifecycle'),
  failure_message text not null
    default 'Recurring occurrence expiry failed; booking remains reserved.'
    check (failure_message = 'Recurring occurrence expiry failed; booking remains reserved.'),
  attempts int not null default 1 check (attempts > 0),
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index recurring_expiry_failures_open_idx
  on public.recurring_expiry_failures (last_failed_at)
  where resolved_at is null;
alter table public.recurring_expiry_failures enable row level security;
revoke all on public.recurring_expiry_failures from public, anon, authenticated;
grant select, insert, update on public.recurring_expiry_failures to service_role;

create or replace function public._guard_recurring_pending_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.provider_id is null or new.service_window is null or isempty(new.service_window)
     or new.status::text not in (
       'pending_payment', 'requested', 'accepted', 'confirmed', 'en_route',
       'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress', 'completion_requested'
     ) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.provider_id::text));
  perform public._assert(not exists (
    select 1
      from public.bookings existing
     where existing.id is distinct from new.id
       and existing.provider_id = new.provider_id
       and existing.recurring_schedule_id is not null
       and existing.status::text = 'pending_payment'
       and existing.service_window && new.service_window
       and (existing.exclusive or new.exclusive)
  ), 'provider_unavailable: recurring pending occurrence still reserves this window');
  return new;
end;
$$;
drop trigger if exists bookings_a_recurring_pending_window_guard on public.bookings;
create trigger bookings_a_recurring_pending_window_guard
  before insert or update of provider_id, service_window on public.bookings
  for each row execute function public._guard_recurring_pending_window();

create or replace function public._set_recurring_payment_schedule_due_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scheduled_at timestamptz;
  v_billing_frequency text;
  v_due_hours int;
begin
  select b.scheduled_at, r.billing_frequency
    into v_scheduled_at, v_billing_frequency
    from public.bookings b
    join public.recurring_schedules r on r.id = b.recurring_schedule_id
   where b.id = new.booking_id;
  if not found or v_billing_frequency is distinct from 'per_visit' then
    return new;
  end if;

  select nullif(c.value ->> 'payment_due_hours_before', '')::int
    into v_due_hours
    from public.app_config c
   where c.key = 'recurring_rules'
   for share;
  v_due_hours := coalesce(v_due_hours, 48);
  new.due_at := greatest(v_scheduled_at - make_interval(hours => v_due_hours), now());
  return new;
end;
$$;
drop trigger if exists payment_schedule_recurring_due_at on public.payment_schedule;
create trigger payment_schedule_recurring_due_at
  before insert on public.payment_schedule
  for each row execute function public._set_recurring_payment_schedule_due_at();

create or replace function public._refresh_recurring_payment_due_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_billing_frequency text;
  v_due_hours int;
begin
  select r.billing_frequency
    into v_billing_frequency
    from public.recurring_schedules r
   where r.id = new.recurring_schedule_id;
  if not found or v_billing_frequency is distinct from 'per_visit' then
    return new;
  end if;

  select nullif(c.value ->> 'payment_due_hours_before', '')::int
    into v_due_hours
    from public.app_config c
   where c.key = 'recurring_rules'
   for share;
  v_due_hours := coalesce(v_due_hours, 48);
  update public.payment_schedule
     set due_at = greatest(new.scheduled_at - make_interval(hours => v_due_hours), now()),
         updated_at = now()
   where booking_id = new.id
     and status in ('due', 'upcoming');
  return new;
end;
$$;
drop trigger if exists bookings_recurring_payment_due_at on public.bookings;
create trigger bookings_recurring_payment_due_at
  after update of scheduled_at on public.bookings
  for each row
  when (old.scheduled_at is distinct from new.scheduled_at)
  execute function public._refresh_recurring_payment_due_at();

update public.payment_schedule ps
   set due_at = greatest(
     b.scheduled_at - make_interval(
       hours => coalesce(nullif(c.value ->> 'payment_due_hours_before', '')::int, 48)
     ),
     now()
   )
  from public.bookings b
  join public.recurring_schedules r on r.id = b.recurring_schedule_id
  cross join public.app_config c
 where ps.booking_id = b.id
   and c.key = 'recurring_rules'
   and r.billing_frequency = 'per_visit'
   and b.status::text = 'pending_payment'
   and ps.status in ('due', 'upcoming')
   and b.scheduled_at is not null;

insert into public.archetype_transitions (archetype, from_status, to_status, actor)
values
  ('time_based', 'requested', 'accepted', 'system'),
  ('fixed', 'requested', 'accepted', 'system'),
  ('fixed', 'pending_payment', 'cancelled', 'customer'),
  ('fixed', 'pending_payment', 'cancelled', 'provider'),
  ('fixed', 'requested', 'cancelled', 'provider'),
  ('fixed', 'accepted', 'cancelled', 'provider')
on conflict do nothing;

create or replace function public._recurrence_dates(
  p_schedule public.recurring_schedules,
  p_from date,
  p_to date
)
returns setof date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_max_plan_days int := coalesce(nullif(public._recurring_rule('max_plan_days'), '')::int, 365);
  v_to date;
begin
  if p_schedule.id is null or p_from is null or p_to is null then
    return;
  end if;
  v_to := least(
    p_to,
    coalesce(p_schedule.ends_on, p_schedule.starts_on + v_max_plan_days),
    p_schedule.starts_on + v_max_plan_days
  );
  if greatest(p_from, p_schedule.starts_on) > v_to then
    return;
  end if;

  return query
  select g.day::date
    from generate_series(
      greatest(p_from, p_schedule.starts_on)::timestamp,
      v_to::timestamp,
      interval '1 day'
    ) as g(day)
   where case p_schedule.frequency
     when 'daily' then true
     when 'alternate_days' then ((g.day::date - p_schedule.starts_on) % 2 = 0)
     when 'weekly' then
       extract(isodow from g.day)::smallint = any(p_schedule.weekdays)
       and (
         ((g.day::date - date_trunc('week', p_schedule.starts_on::timestamp)::date) / 7)
         % p_schedule.interval_count = 0
       )
     when 'monthly' then
       extract(day from g.day)::int = p_schedule.month_day
       and (
         (
           (extract(year from g.day)::int - extract(year from p_schedule.starts_on)::int) * 12
           + extract(month from g.day)::int - extract(month from p_schedule.starts_on)::int
         ) % p_schedule.interval_count = 0
       )
     when 'custom' then g.day::date = any(p_schedule.custom_dates)
     else false
   end
   order by g.day;
end;
$$;

create or replace function public._assert_recurring_provider_window(
  p_provider_id uuid,
  p_window tstzrange,
  p_exclude_booking_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timezone text;
  v_max_jobs int;
  v_local_start timestamp;
  v_local_end timestamp;
  v_jobs int;
begin
  select coalesce(p.timezone, 'Asia/Kolkata'), p.max_jobs_per_day
    into v_timezone, v_max_jobs
    from public.providers p
   where p.id = p_provider_id;
  perform public._assert(found and p_window is not null and not isempty(p_window), 'provider window is required');
  v_local_start := lower(p_window) at time zone v_timezone;
  v_local_end := upper(p_window) at time zone v_timezone;
  perform public._assert(
    not exists (
      select 1 from public.provider_time_off t
       where t.provider_id = p_provider_id and t.period && p_window
    ),
    'provider_unavailable: provider time off'
  );
  if exists (select 1 from public.provider_availability a where a.provider_id = p_provider_id) then
    perform public._assert(
      v_local_start::date = v_local_end::date
      and exists (
        select 1
          from public.provider_availability a
         where a.provider_id = p_provider_id
           and a.weekday = extract(dow from v_local_start)::smallint
           and a.start_time <= v_local_start::time
           and a.end_time >= v_local_end::time
      ),
      'provider_unavailable: outside_working_hours'
    );
  end if;
  if v_max_jobs is not null then
    select count(*)::int into v_jobs
      from public.bookings b
     where b.provider_id = p_provider_id
       and b.id is distinct from p_exclude_booking_id
       and (coalesce(b.scheduled_at, b.created_at) at time zone v_timezone)::date = v_local_start::date
       and (
         b.status::text not in ('pending_payment', 'declined', 'expired', 'cancelled', 'refunded', 'closed_no_work')
         or (b.status::text = 'pending_payment' and b.created_at > now() - interval '30 minutes')
       );
    perform public._assert(v_jobs < v_max_jobs, 'provider_unavailable: fully_booked');
  end if;
end;
$$;

create or replace function public._recurring_plan_quote(p jsonb, p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service public.provider_services;
  v_category public.categories;
  v_package public.service_packages;
  v_address public.addresses;
  v_schedule public.recurring_schedules;
  v_rules jsonb;
  v_service_id uuid;
  v_package_id uuid;
  v_address_id uuid;
  v_archetype text;
  v_frequency text;
  v_billing_frequency text;
  v_interval int;
  v_weekdays smallint[] := '{}'::smallint[];
  v_month_day int;
  v_custom_dates date[] := '{}'::date[];
  v_start_date date;
  v_end_date date;
  v_max_occurrences int;
  v_start_time time;
  v_timezone text;
  v_duration int;
  v_package_qty numeric(10,2);
  v_service_paise int;
  v_platform_fee int;
  v_discount_bp int;
  v_discount_per_visit int;
  v_cycle_start date;
  v_cycle_end date;
  v_max_plan_days int;
  v_first_at timestamptz;
  v_visits_first_cycle int;
  v_visits_total int;
  v_first_dates jsonb;
  v_description text;
  v_value text;
  v_count int;
begin
  perform public._assert(p_customer_id is not null, 'authentication required');
  perform public._assert(public._recurring_feature('recurring_bookings'), 'Recurring bookings are turned off right now.');
  perform public._assert(jsonb_typeof(p) = 'object', 'recurring plan input must be an object');
  select value into v_rules from public.app_config where key = 'recurring_rules';
  perform public._assert(v_rules is not null, 'recurring rules are not configured');

  v_service_id := nullif(p ->> 'provider_service_id', '')::uuid;
  v_package_id := nullif(p ->> 'package_id', '')::uuid;
  v_address_id := nullif(p ->> 'address_id', '')::uuid;
  v_archetype := p ->> 'archetype';
  v_frequency := p ->> 'frequency';
  v_billing_frequency := coalesce(p ->> 'billing_frequency', 'per_visit');
  perform public._assert(
    v_billing_frequency = 'per_visit',
    'weekly, monthly, and prepaid recurring billing are unavailable until cycle billing is integrated'
  );
  v_interval := coalesce(nullif(p ->> 'interval_count', '')::int, 1);
  v_month_day := nullif(p ->> 'month_day', '')::int;
  v_start_date := nullif(p ->> 'start_date', '')::date;
  v_end_date := nullif(p ->> 'end_date', '')::date;
  v_max_occurrences := nullif(p ->> 'max_occurrences', '')::int;
  v_start_time := nullif(p ->> 'start_time', '')::time;
  v_timezone := coalesce(nullif(btrim(p ->> 'timezone'), ''), 'Asia/Kolkata');
  v_duration := nullif(p ->> 'duration_min', '')::int;
  v_package_qty := nullif(p ->> 'package_qty', '')::numeric;
  v_description := coalesce(p ->> 'description', '');

  perform public._assert(v_service_id is not null, 'provider service is required');
  perform public._assert(v_address_id is not null, 'saved address is required');
  perform public._assert(v_archetype is not null and v_archetype in ('time_based', 'fixed'),
    'recurrence is not available for this service type');
  perform public._assert(v_frequency is not null and v_frequency in ('daily', 'alternate_days', 'weekly', 'monthly', 'custom'),
    'unsupported recurrence frequency');
  perform public._assert(v_interval between 1 and 12, 'interval_count must be between 1 and 12');
  perform public._assert(v_start_date is not null and v_start_date >= current_date, 'start date must be today or later');
  perform public._assert(v_start_time is not null, 'start time is required');
  perform public._assert(v_end_date is null or v_end_date >= v_start_date, 'end date must be on or after start date');
  perform public._assert(v_max_occurrences is null or v_max_occurrences between 1 and 400, 'max_occurrences must be between 1 and 400');
  perform public._assert(v_end_date is null or v_end_date <= v_start_date + coalesce(nullif(public._recurring_rule('max_plan_days'), '')::int, 365),
    'recurring plan exceeds the configured maximum length');
  perform public._assert(
    coalesce(v_rules -> 'frequencies', '[]'::jsonb) ? v_frequency,
    'frequency is not allowed by recurring rules'
  );
  perform public._assert(
    coalesce(v_rules -> 'payment_frequencies', '[]'::jsonb) ? v_billing_frequency,
    'billing frequency is not allowed by recurring rules'
  );

  select * into v_service
    from public.provider_services
   where id = v_service_id and active
   for share;
  perform public._assert(found, 'service not available');
  select * into v_category
    from public.categories
   where id = v_service.category_id;
  perform public._assert(found and v_category.active, 'service category is not available');
  perform public._assert(v_category.recurrence_allowed, 'recurring plans are not enabled for this category');
  perform public._assert(v_category.archetype = v_archetype, 'archetype does not match the service category');
  perform public._assert(v_frequency = any(v_category.allowed_frequencies), 'frequency is not allowed for this category');
  perform public._assert(
    coalesce((select (value ->> v_archetype)::boolean from public.app_config where key = 'archetype_flags'), false),
    'service type is turned off'
  );
  perform public._assert(v_service.provider_id <> p_customer_id, 'cannot book yourself');
  perform public._assert(public._provider_is_live(v_service.provider_id), 'provider is not available');
  perform public._assert_provider_not_paused(v_service.provider_id);

  select * into v_address
    from public.addresses
   where id = v_address_id and user_id = p_customer_id;
  perform public._assert(found, 'saved address not found');
  perform public._assert_bookable(v_category.id, v_service.provider_id, v_address.city, v_archetype, null);

  if v_frequency = 'weekly' then
    perform public._assert(jsonb_typeof(p -> 'weekdays') = 'array', 'weekdays must be an array for weekly recurrence');
    perform public._assert(
      not exists (
        select 1 from jsonb_array_elements_text(p -> 'weekdays') x(value)
         where value !~ '^[1-7]$'
      ),
      'weekdays must contain ISO days 1 through 7'
    );
    select coalesce(array_agg(value::smallint order by value::smallint), '{}'::smallint[]),
           count(*)::int,
           count(distinct value)::int
      into v_weekdays, v_count, v_visits_first_cycle
      from jsonb_array_elements_text(p -> 'weekdays') x(value);
    perform public._assert(v_count between 1 and 7 and v_visits_first_cycle = v_count,
      'weekly recurrence requires unique weekdays');
  else
    v_weekdays := '{}'::smallint[];
  end if;
  if v_frequency = 'monthly' then
    perform public._assert(v_month_day between 1 and 28, 'monthly recurrence requires month_day 1 through 28');
  else
    perform public._assert(v_month_day is null, 'month_day is only valid for monthly recurrence');
  end if;
  if v_frequency = 'custom' then
    perform public._assert(jsonb_typeof(p -> 'custom_dates') = 'array', 'custom recurrence requires custom_dates');
    perform public._assert(jsonb_array_length(p -> 'custom_dates') between 1 and 120, 'custom recurrence requires 1 to 120 dates');
    perform public._assert(
      not exists (
        select 1 from jsonb_array_elements_text(p -> 'custom_dates') x(value)
         where value is null or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      ),
      'custom dates must use YYYY-MM-DD format'
    );
    select array_agg(value::date order by value::date)
      into v_custom_dates
      from jsonb_array_elements_text(p -> 'custom_dates') x(value);
    perform public._assert(
      cardinality(v_custom_dates) = (select count(distinct value) from unnest(v_custom_dates) x(value))
      and not exists (select 1 from unnest(v_custom_dates) x(value) where value < v_start_date),
      'custom dates must be unique and on or after the start date'
    );
  else
    v_custom_dates := '{}'::date[];
  end if;

  if v_archetype = 'time_based' then
    perform public._assert(v_duration between 15 and 480, 'duration_min must be between 15 and 480');
    if v_package_id is not null then
      v_package := public._assert_session_package(v_service.id, v_package_id);
      v_service_paise := v_package.price;
      v_duration := coalesce(v_package.duration_min, v_duration);
    else
      v_service_paise := greatest(round(v_service.labour_rate::numeric * v_duration / 60.0), 1)::int;
    end if;
    v_platform_fee := 2900;
  else
    perform public._assert(v_package_id is not null, 'fixed recurrence requires a fixed-price service package');
    select * into v_package
      from public.service_packages
     where id = v_package_id
       and provider_service_id = v_service.id
       and active
       and price_type = 'fixed'
     for share;
    perform public._assert(found, 'active fixed package not found');
    v_package_qty := coalesce(v_package_qty, v_package.qty_min);
    perform public._assert(
      v_package_qty between v_package.qty_min and v_package.qty_max
      and (v_package_qty = trunc(v_package_qty) or v_package.qty_max > 1),
      'quantity is outside the package bounds'
    );
    perform public._assert(v_package_qty <= coalesce((public._fixed_booking_config() ->> 'max_quantity')::numeric, 100),
      'quantity exceeds the configured maximum');
    v_service_paise := round(v_package.price::numeric * v_package_qty)::int;
    v_duration := case
      when v_package.qty_min = 1 and v_package.qty_max = 1 then coalesce(v_package.duration_min, 60)
      else coalesce(v_package.duration_min, 60) * ceil(v_package_qty)::int
    end;
    perform public._assert(
      v_duration between 15 and 480,
      'fixed recurring duration must be between 15 and 480 minutes'
    );
    v_platform_fee := greatest(coalesce((public._fixed_booking_config() ->> 'platform_fee_paise')::int, 2900), 0);
  end if;
  perform public._assert(v_service_paise > 0 and v_service_paise <= 100000000, 'invalid per-visit amount');

  v_discount_bp := coalesce(v_category.recurring_discount_bp, nullif(public._recurring_rule('recurring_discount_bp'), '')::int, 0);
  perform public._assert(
    v_discount_bp = 0
      and coalesce(nullif(public._recurring_rule('recurring_discount_bp'), '')::int, 0) = 0,
    'recurring discounts are unavailable until both occurrence charge paths apply them'
  );
  v_discount_per_visit := round(v_service_paise::numeric * v_discount_bp / 10000)::int;
  v_max_plan_days := coalesce(nullif(public._recurring_rule('max_plan_days'), '')::int, 365);

  v_schedule.id := gen_random_uuid();
  v_schedule.frequency := v_frequency;
  v_schedule.interval_count := v_interval;
  v_schedule.weekdays := v_weekdays;
  v_schedule.month_day := v_month_day;
  v_schedule.custom_dates := v_custom_dates;
  v_schedule.starts_on := v_start_date;
  v_schedule.ends_on := v_end_date;

  v_cycle_start := v_start_date;
  v_cycle_end := case v_billing_frequency
    when 'weekly' then v_start_date + 6
    when 'monthly' then (v_start_date + interval '1 month' - interval '1 day')::date
    when 'prepaid_package' then coalesce(v_end_date, v_start_date + v_max_plan_days)
    else v_start_date
  end;
  v_cycle_end := least(v_cycle_end, coalesce(v_end_date, v_cycle_end), v_start_date + v_max_plan_days);
  select count(*)::int into v_visits_first_cycle
    from public._recurrence_dates(v_schedule, v_cycle_start, v_cycle_end);
  if v_max_occurrences is not null then
    v_visits_first_cycle := least(v_visits_first_cycle, v_max_occurrences);
  end if;
  if v_billing_frequency = 'per_visit' then
    v_visits_first_cycle := 1;
  end if;
  select count(*)::int into v_visits_total
    from public._recurrence_dates(
      v_schedule,
      v_start_date,
      coalesce(v_end_date, v_start_date + v_max_plan_days)
    );
  if v_max_occurrences is not null then
    v_visits_total := least(v_visits_total, v_max_occurrences);
  elsif v_end_date is null then
    v_visits_total := null;
  end if;
  select coalesce(jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d), '[]'::jsonb)
    into v_first_dates
    from (
      select d
        from public._recurrence_dates(
          v_schedule,
          v_start_date,
          least(v_start_date + v_max_plan_days, coalesce(v_end_date, v_start_date + v_max_plan_days))
        ) d
       order by d
       limit least(10, coalesce(v_max_occurrences, 10))
    ) dates;
  perform public._assert(jsonb_array_length(v_first_dates) > 0, 'recurrence does not produce a visit within the plan range');
  v_first_at := make_timestamptz(
    extract(year from (v_first_dates ->> 0)::date)::int,
    extract(month from (v_first_dates ->> 0)::date)::int,
    extract(day from (v_first_dates ->> 0)::date)::int,
    extract(hour from v_start_time)::int,
    extract(minute from v_start_time)::int,
    extract(second from v_start_time),
    v_timezone
  );
  perform public._assert(v_first_at >= now() + interval '60 minutes',
    'first recurring visit must be scheduled at least 60 minutes ahead');

  return jsonb_build_object(
    'quote', jsonb_build_object(
      'per_visit_paise', v_service_paise,
      'visits_in_first_cycle', v_visits_first_cycle,
      'visits_total', v_visits_total,
      'discount_bp', v_discount_bp,
      'discount_paise', v_discount_per_visit::bigint * v_visits_first_cycle,
      'platform_fee_paise', v_platform_fee::bigint * v_visits_first_cycle,
      'gst_paise', 0,
      'total_paise_per_cycle', greatest(v_service_paise - v_discount_per_visit, 0)::bigint * v_visits_first_cycle
        + v_platform_fee::bigint * v_visits_first_cycle,
      'billing_frequency', v_billing_frequency,
      'first_dates', v_first_dates
    ),
    'internal', jsonb_build_object(
      'customer_id', p_customer_id,
      'provider_id', v_service.provider_id,
      'provider_service_id', v_service.id,
      'service_package_id', v_package_id,
      'archetype', v_archetype,
      'frequency', v_frequency,
      'interval_count', v_interval,
      'weekdays', to_jsonb(v_weekdays),
      'month_day', v_month_day,
      'custom_dates', to_jsonb(v_custom_dates),
      'starts_on', v_start_date,
      'ends_on', v_end_date,
      'max_occurrences', v_max_occurrences,
      'start_time', v_start_time,
      'timezone', v_timezone,
      'duration_min', v_duration,
      'package_qty', v_package_qty,
      'billing_frequency', v_billing_frequency,
      'address_line', v_address.line1,
      'city', v_address.city,
      'lat', v_address.lat,
      'lng', v_address.lng,
      'description', v_description
    )
  );
end;
$$;

revoke all on function public._recurrence_dates(public.recurring_schedules, date, date),
  public._recurring_plan_quote(jsonb, uuid)
from public, anon, authenticated;

create or replace function public._create_fixed_occurrence(
  p_schedule_id uuid,
  p_scheduled_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.recurring_schedules;
  v_package public.service_packages;
  v_service public.provider_services;
  v_category public.categories;
  v_address_id uuid;
  v_booking_id uuid;
  v_quote_id uuid;
  v_window tstzrange;
  v_quantity numeric(10,2);
  v_service_total int;
  v_platform_fee int;
  v_duration int;
  v_snapshot jsonb;
begin
  select * into r from public.recurring_schedules where id = p_schedule_id;
  perform public._assert(found and r.archetype = 'fixed', 'fixed recurring plan not found');
  select * into v_service from public.provider_services where id = r.provider_service_id and active for share;
  perform public._assert(found, 'service not available');
  select * into v_category from public.categories where id = v_service.category_id;
  perform public._assert(found and v_category.archetype = 'fixed', 'category must use the fixed archetype');
  select * into v_package
    from public.service_packages
   where id = r.service_package_id and provider_service_id = v_service.id and active and price_type = 'fixed'
   for share;
  perform public._assert(found, 'active fixed package not found');
  v_quantity := coalesce(r.package_qty, v_package.qty_min);
  perform public._assert(
    v_quantity between v_package.qty_min and v_package.qty_max
    and (v_quantity = trunc(v_quantity) or v_package.qty_max > 1),
    'quantity is outside the package bounds'
  );
  perform public._assert(
    v_quantity <= coalesce((public._fixed_booking_config() ->> 'max_quantity')::numeric, 100),
    'quantity exceeds the configured maximum'
  );
  perform public._assert(public._provider_is_live(v_service.provider_id), 'provider is not available');
  perform public._assert_provider_not_paused(v_service.provider_id);
  perform public._assert(public._category_docs_ok(v_service.provider_id, v_category.id), 'provider verification is incomplete');
  v_duration := case
    when v_package.qty_min = 1 and v_package.qty_max = 1 then coalesce(v_package.duration_min, 60)
    else coalesce(v_package.duration_min, 60) * ceil(v_quantity)::int
  end;
  v_service_total := round(v_package.price::numeric * v_quantity)::int;
  v_platform_fee := greatest(coalesce((public._fixed_booking_config() ->> 'platform_fee_paise')::int, 2900), 0);
  v_window := tstzrange(p_scheduled_at, p_scheduled_at + make_interval(mins => v_duration), '[)');
  perform public._assert(p_scheduled_at > now() + interval '30 minutes', 'session must be scheduled at least 30 minutes ahead');
  perform public._assert_bookable(v_category.id, v_service.provider_id, r.city, 'fixed', v_window);
  perform public._assert_recurring_provider_window(v_service.provider_id, v_window);
  perform public._assert_provider_window_free(v_service.provider_id, v_window, null, true);

  insert into public.addresses (user_id, label, line1, city, lat, lng)
  values (r.customer_id, 'Booking', r.address_line, r.city, r.lat, r.lng)
  returning id into v_address_id;

  v_snapshot := jsonb_build_object(
    'id', v_package.id,
    'title', v_package.title,
    'description', v_package.description,
    'price_type', v_package.price_type,
    'unit', v_package.unit,
    'quantity', v_quantity,
    'unit_price', v_package.price,
    'duration_min', v_package.duration_min,
    'service_duration_min', v_duration,
    'inclusions', to_jsonb(v_package.inclusions),
    'exclusions', to_jsonb(v_package.exclusions),
    'deliverables', v_package.deliverables,
    'usage_rights', v_package.usage_rights,
    'intake', jsonb_build_object('description', r.description)
  );

  insert into public.bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id,
    description, scheduled_at, service_window, status, visit_fee, platform_fee,
    total_amount, archetype, location_mode, booking_origin, service_package_id,
    recurring_schedule_id
  ) values (
    r.customer_id, v_service.provider_id, v_category.id, v_service.id, v_address_id,
    coalesce(nullif(r.description, ''), v_package.title), p_scheduled_at, v_window, 'pending_payment',
    0, v_platform_fee, v_service_total + v_platform_fee, 'fixed', 'at_customer', 'marketplace',
    v_package.id, r.id
  ) returning id into v_booking_id;

  insert into public.booking_secrets (booking_id, start_otp)
  values (v_booking_id, public._gen_otp());

  insert into public.quotes (
    booking_id, version, status, is_change_order, subtotal_labour, subtotal_parts,
    subtotal_other, total, note, quote_type, source_package_id, package_snapshot
  ) values (
    v_booking_id, 1, 'approved_pending_payment', false, 0, 0,
    v_service_total, v_service_total, 'Fixed recurring package quote', 'package',
    v_package.id, v_snapshot
  ) returning id into v_quote_id;

  insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price)
  values (v_quote_id, 'other', v_package.title, v_quantity, v_package.unit, v_package.price);

  insert into public.payment_schedule (
    booking_id, quote_id, seq, obligation_type, label, amount, due_rule, due_at, status
  ) values
    (v_booking_id, v_quote_id, 1, 'service', 'Package payment', v_service_total, 'at_booking', now(), 'due'),
    (v_booking_id, v_quote_id, 2, 'platform_fee', 'Platform fee', v_platform_fee, 'at_booking', now(), 'due');

  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (v_booking_id, r.customer_id, null, 'pending_payment', 'fixed recurring occurrence created');
  return v_booking_id;
end;
$$;

create or replace function public.quote_recurring_plan(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  return public._recurring_plan_quote(p, v_uid) -> 'quote';
end;
$$;

create or replace function public.create_recurring_plan(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_internal jsonb;
  v_id uuid;
  v_acceptance_mode text;
  v_provider_acceptance text;
  v_horizon int := coalesce(nullif(public._recurring_rule('horizon_days'), '')::int, 28);
begin
  perform public._assert(public._recurring_feature('recurring_bookings'), 'Recurring bookings are turned off right now.');
  v_internal := public._recurring_plan_quote(p, v_uid) -> 'internal';
  v_acceptance_mode := case
    when public._recurring_feature('recurring_plan_acceptance') then 'plan'
    else 'occurrence'
  end;
  v_provider_acceptance := case
    when v_acceptance_mode = 'plan' then 'pending'
    else 'accepted'
  end;

  insert into public.recurring_schedules (
    customer_id, provider_id, provider_service_id, service_package_id, pack_purchase_id,
    frequency, interval_count, weekdays, month_day, custom_dates, start_time, timezone,
    session_duration_min, payment_mode, billing_frequency, archetype, package_qty,
    address_line, city, lat, lng, description, starts_on, ends_on, max_occurrences,
    plan_version, provider_acceptance, acceptance_mode, decided_at
  ) values (
    v_uid, (v_internal ->> 'provider_id')::uuid,
    (v_internal ->> 'provider_service_id')::uuid,
    nullif(v_internal ->> 'service_package_id', '')::uuid,
    null,
    v_internal ->> 'frequency',
    (v_internal ->> 'interval_count')::int,
    array(select value::smallint from jsonb_array_elements_text(v_internal -> 'weekdays') x(value)),
    nullif(v_internal ->> 'month_day', '')::int,
    array(select value::date from jsonb_array_elements_text(v_internal -> 'custom_dates') x(value)),
    (v_internal ->> 'start_time')::time,
    v_internal ->> 'timezone',
    (v_internal ->> 'duration_min')::int,
    'per_session',
    v_internal ->> 'billing_frequency',
    v_internal ->> 'archetype',
    nullif(v_internal ->> 'package_qty', '')::numeric,
    v_internal ->> 'address_line',
    v_internal ->> 'city',
    (v_internal ->> 'lat')::double precision,
    (v_internal ->> 'lng')::double precision,
    v_internal ->> 'description',
    (v_internal ->> 'starts_on')::date,
    nullif(v_internal ->> 'ends_on', '')::date,
    nullif(v_internal ->> 'max_occurrences', '')::int,
    'v2',
    v_provider_acceptance,
    v_acceptance_mode,
    case when v_provider_acceptance = 'accepted' then now() else null end
  ) returning id into v_id;

  if v_provider_acceptance = 'pending' then
    perform public._queue_notification(
      (v_internal ->> 'provider_id')::uuid,
      'recurring_plan_requested',
      null,
      'Recurring plan request',
      'A customer requested a recurring service plan.',
      jsonb_build_object('recurring_schedule_id', v_id),
      'recurring-plan-request:' || v_id
    );
  else
    perform public.materialize_recurring_schedule(v_id, current_date + v_horizon);
  end if;
  return v_id;
end;
$$;

create or replace function public.respond_recurring_plan(
  p_id uuid,
  p_accept boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  r public.recurring_schedules;
  v_horizon int := coalesce(nullif(public._recurring_rule('horizon_days'), '')::int, 28);
begin
  perform public._assert(public._recurring_feature('recurring_bookings'), 'Recurring bookings are turned off right now.');
  select * into r from public.recurring_schedules where id = p_id for update;
  perform public._assert(found and public._acts_for(r.provider_id, 'manager'), 'only the provider manager can respond');
  perform public._assert(r.provider_acceptance = 'pending' and r.status = 'active', 'recurring plan is not pending');

  if p_accept then
    update public.recurring_schedules
       set provider_acceptance = 'accepted', decided_at = now(), decline_reason = null, updated_at = now()
     where id = r.id;
    perform public.materialize_recurring_schedule(r.id, current_date + v_horizon);
    perform public._queue_notification(
      r.customer_id, 'recurring_plan_accepted', null, 'Recurring plan accepted',
      'The provider accepted your recurring plan.',
      jsonb_build_object('recurring_schedule_id', r.id),
      'recurring-plan-accepted:' || r.id
    );
  else
    perform public._assert(char_length(trim(coalesce(p_reason, ''))) between 1 and 300, 'decline reason is required');
    update public.recurring_schedules
       set provider_acceptance = 'declined', decided_at = now(), decline_reason = trim(p_reason),
           status = 'cancelled', cancelled_at = now(), updated_at = now()
     where id = r.id;
    perform public._queue_notification(
      r.customer_id, 'recurring_plan_declined', null, 'Recurring plan declined',
      left(trim(p_reason), 300),
      jsonb_build_object('recurring_schedule_id', r.id, 'reason', trim(p_reason)),
      'recurring-plan-declined:' || r.id
    );
  end if;
end;
$$;

revoke all on function public._create_fixed_occurrence(uuid, timestamptz) from public, anon, authenticated;

create or replace function public._cancel_recurring_occurrence(
  p_booking_id uuid,
  p_actor_id uuid,
  p_provider_fault boolean,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_outcome jsonb;
begin
  b := public._lock_booking(p_booking_id);
  if b.archetype = 'time_based'
     and b.status::text in ('pending_payment', 'requested', 'accepted') then
    return public._cancel_session_booking(
      b.id, p_actor_id, p_provider_fault and p_actor_id = b.provider_id, p_reason
    );
  end if;

  if p_provider_fault and p_actor_id = b.provider_id then
    v_outcome := public._cancel_booking_by_policy(
      b.id, 'provider', 'provider_cancellation', p_reason, now()
    );
  else
    v_outcome := public._cancel_booking_by_policy(
      b.id, 'customer', 'customer_choice', p_reason, now()
    );
  end if;
  return coalesce((v_outcome ->> 'refund_amount')::int, 0);
end;
$$;

create or replace function public.pause_recurring_plan(
  p_id uuid,
  p_until date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  r public.recurring_schedules;
  b record;
  v_cutoff int := coalesce(nullif(public._recurring_rule('skip_cutoff_hours'), '')::int, 12);
begin
  perform public._assert(public._recurring_feature('recurring_skip_pause'), 'Recurring skip and pause are turned off right now.');
  perform public._assert(p_until is null or p_until >= current_date, 'pause end date must be today or later');
  select * into r from public.recurring_schedules where id = p_id for update;
  perform public._assert(found and r.customer_id = v_uid, 'recurring plan not found');
  if r.status = 'paused' then
    return;
  end if;
  perform public._assert(r.status = 'active', 'recurring plan is not active');

  update public.recurring_schedules
     set status = 'paused', paused_at = now(), pause_until = p_until, updated_at = now()
   where id = r.id;

  for b in
    select bk.id, bk.scheduled_at, bk.service_window
      from public.bookings bk
     where bk.recurring_schedule_id = r.id
       and bk.status::text = 'pending_payment'
       and bk.scheduled_at > now() + make_interval(hours => v_cutoff)
       and not exists (
         select 1 from public.payments p where p.booking_id = bk.id and p.status = 'paid'
       )
       and not exists (
         select 1 from public.payment_schedule ps where ps.booking_id = bk.id and ps.status = 'paid'
       )
     for update
  loop
    perform public._cancel_recurring_occurrence(b.id, v_uid, false, 'recurring plan paused');
    insert into public.recurring_occurrence_changes (
      schedule_id, booking_id, occurrence_date, original_at, kind, actor_id, reason
    ) values (
      r.id, b.id, (b.scheduled_at at time zone r.timezone)::date, b.scheduled_at,
      'cancelled', v_uid, 'recurring plan paused'
    );
  end loop;

  perform public._queue_notification(
    r.provider_id, 'recurring_plan_paused', null, 'Recurring plan paused',
    'The customer paused a recurring service plan.',
    jsonb_build_object('recurring_schedule_id', r.id, 'pause_until', p_until),
    'recurring-plan-paused:' || r.id
  );
end;
$$;

create or replace function public.resume_recurring_plan(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  r public.recurring_schedules;
  v_horizon int := coalesce(nullif(public._recurring_rule('horizon_days'), '')::int, 28);
begin
  perform public._assert(public._recurring_feature('recurring_skip_pause'), 'Recurring skip and pause are turned off right now.');
  select * into r from public.recurring_schedules where id = p_id for update;
  perform public._assert(found and r.customer_id = v_uid, 'recurring plan not found');
  if r.status = 'active' then
    return;
  end if;
  perform public._assert(r.status = 'paused', 'recurring plan cannot be resumed');

  update public.recurring_schedules
     set status = 'active', paused_at = null, pause_until = null, updated_at = now()
   where id = r.id;
  perform public.materialize_recurring_schedule(r.id, current_date + v_horizon);
  perform public._queue_notification(
    r.provider_id, 'recurring_plan_resumed', null, 'Recurring plan resumed',
    'The customer resumed a recurring service plan.',
    jsonb_build_object('recurring_schedule_id', r.id),
    'recurring-plan-resumed:' || r.id
  );
end;
$$;

create or replace function public.skip_recurring_visit(
  p_booking_id uuid,
  p_reason text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings;
  r public.recurring_schedules;
  v_cutoff int := coalesce(nullif(public._recurring_rule('skip_cutoff_hours'), '')::int, 12);
begin
  perform public._assert(public._recurring_feature('recurring_skip_pause'), 'Recurring skip and pause are turned off right now.');
  b := public._lock_booking(p_booking_id);
  perform public._assert(b.recurring_schedule_id is not null, 'booking is not a recurring visit');
  select * into r from public.recurring_schedules where id = b.recurring_schedule_id for update;
  perform public._assert(found and r.customer_id = v_uid, 'only the customer can skip this visit');
  if exists (
    select 1 from public.recurring_occurrence_changes c
     where c.schedule_id = r.id
       and c.booking_id = b.id
       and c.kind = 'skipped'
  ) then
    return;
  end if;
  perform public._assert(
    b.status::text in ('pending_payment', 'requested', 'accepted')
      and b.scheduled_at > now() + make_interval(hours => v_cutoff),
    'visit is past the skip cutoff or cannot be skipped'
  );
  perform public._assert(char_length(coalesce(p_reason, '')) <= 300, 'reason must be 300 characters or fewer');

  perform public._cancel_recurring_occurrence(
    b.id, v_uid, false,
    coalesce(nullif(trim(p_reason), ''), 'recurring visit skipped')
  );
  insert into public.recurring_occurrence_changes (
    schedule_id, booking_id, occurrence_date, original_at, kind, actor_id, reason
  ) values (
    r.id, b.id, (b.scheduled_at at time zone r.timezone)::date, b.scheduled_at,
    'skipped', v_uid, left(coalesce(nullif(trim(p_reason), ''), 'recurring visit skipped'), 300)
  );
  perform public._queue_notification(
    r.provider_id, 'recurring_visit_skipped', b.id, 'Recurring visit skipped',
    'The customer skipped an upcoming recurring visit.',
    jsonb_build_object('recurring_schedule_id', r.id, 'occurrence_date', (b.scheduled_at at time zone r.timezone)::date),
    'recurring-visit-skipped:' || b.id
  );
end;
$$;

create or replace function public._cancel_recurring_plan_internal(
  p_id uuid,
  p_customer_id uuid,
  p_cancel_future boolean,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.recurring_schedules;
  b record;
  v_cancelled int := 0;
  v_has_future_open boolean;
  v_reason text := left(coalesce(nullif(trim(p_reason), ''), 'recurring plan cancelled'), 300);
begin
  select * into r from public.recurring_schedules where id = p_id for update;
  perform public._assert(found and r.customer_id = p_customer_id, 'only the customer can cancel this plan');
  if r.status = 'cancelled' then
    return 0;
  end if;
  select exists (
    select 1
      from public.bookings bk
     where bk.recurring_schedule_id = r.id
       and bk.scheduled_at > now()
       and bk.status::text in (
         'pending_payment', 'requested', 'accepted', 'confirmed', 'en_route',
         'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress',
         'completion_requested'
       )
  ) into v_has_future_open;
  perform public._assert(
    r.status in ('active', 'paused') or (r.status = 'completed' and v_has_future_open),
    'recurring plan is already closed'
  );

  update public.recurring_schedules
     set status = 'cancelled', cancelled_at = now(), paused_at = null, pause_until = null, updated_at = now()
   where id = r.id;

  if p_cancel_future then
    for b in
      select bk.id, bk.scheduled_at
        from public.bookings bk
       where bk.recurring_schedule_id = r.id
         and bk.scheduled_at > now()
         and bk.status::text in (
           'pending_payment', 'requested', 'accepted', 'confirmed', 'en_route',
           'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress',
           'completion_requested'
         )
       for update
    loop
      perform public._cancel_recurring_occurrence(b.id, p_customer_id, false, v_reason);
      if not exists (
        select 1 from public.recurring_occurrence_changes c
         where c.schedule_id = r.id and c.booking_id = b.id and c.kind = 'cancelled'
      ) then
        insert into public.recurring_occurrence_changes (
          schedule_id, booking_id, occurrence_date, original_at, kind, actor_id, reason
        ) values (
          r.id, b.id, (b.scheduled_at at time zone r.timezone)::date, b.scheduled_at,
          'cancelled', p_customer_id, v_reason
        );
      end if;
      v_cancelled := v_cancelled + 1;
    end loop;
  end if;

  perform public._queue_notification(
    r.provider_id, 'recurring_plan_cancelled', null, 'Recurring plan cancelled',
    'The customer cancelled a recurring service plan.',
    jsonb_build_object('recurring_schedule_id', r.id, 'reason', v_reason),
    'recurring-plan-cancelled:' || r.id
  );
  return v_cancelled;
end;
$$;

create or replace function public.cancel_recurring_plan(p_id uuid, p_reason text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(p_reason is null or char_length(p_reason) <= 300, 'reason must be 300 characters or fewer');
  return public._cancel_recurring_plan_internal(p_id, v_uid, true, p_reason);
end;
$$;

create or replace function public.cancel_recurring_schedule(
  p_schedule_id uuid,
  p_cancel_future boolean default true
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  return public._cancel_recurring_plan_internal(
    p_schedule_id, v_uid, p_cancel_future, 'recurring schedule cancelled'
  );
end;
$$;

create or replace function public._record_recurring_unavailable(
  p_schedule_id uuid,
  p_occurrence_date date,
  p_original_at timestamptz,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.recurring_schedules;
  v_change_id uuid;
begin
  select * into r from public.recurring_schedules where id = p_schedule_id;
  if not found then
    return false;
  end if;
  insert into public.recurring_occurrence_changes (
    schedule_id, occurrence_date, original_at, kind, reason
  ) values (
    r.id, p_occurrence_date, p_original_at, 'provider_unavailable', left(coalesce(p_reason, 'provider unavailable'), 300)
  )
  on conflict (schedule_id, occurrence_date, kind)
    where kind in ('skipped', 'provider_unavailable')
    do nothing
  returning id into v_change_id;
  if v_change_id is null then
    return false;
  end if;
  perform public._queue_notification(
    r.customer_id, 'recurring_visit_unavailable', null, 'Recurring visit unavailable',
    'A planned recurring visit cannot be provided on this date.',
    jsonb_build_object('recurring_schedule_id', r.id, 'occurrence_date', p_occurrence_date, 'reason', left(coalesce(p_reason, 'provider unavailable'), 300)),
    'recurring-visit-unavailable:' || r.id || ':' || p_occurrence_date
  );
  return true;
end;
$$;

create or replace function public.materialize_recurring_schedule(
  p_schedule_id uuid,
  p_through_date date default (current_date + 28)::date
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
  v_window tstzrange;
  v_duration int;
  v_created int := 0;
  v_occurrences_created int;
  v_horizon_limit date;
  v_reason text;
  v_booking_id uuid;
  v_provider_paused boolean;
begin
  if not public._recurring_feature('recurring_bookings') then
    return 0;
  end if;
  select * into r from public.recurring_schedules where id = p_schedule_id for update;
  perform public._assert(found and r.status = 'active', 'recurring schedule is not active');
  perform public._assert(r.provider_acceptance = 'accepted', 'recurring plan has not been accepted');
  if r.acceptance_mode = 'plan' and not public._recurring_feature('recurring_plan_acceptance') then
    update public.recurring_schedules set acceptance_mode = 'occurrence', updated_at = now() where id = r.id;
    r.acceptance_mode := 'occurrence';
  end if;
  v_horizon_limit := r.starts_on + coalesce(nullif(public._recurring_rule('max_plan_days'), '')::int, 365);
  p_through_date := least(
    p_through_date,
    v_horizon_limit,
    coalesce(r.ends_on, p_through_date)
  );
  d := greatest(r.starts_on, coalesce(r.generated_through + 1, current_date));
  v_occurrences_created := greatest(
    r.occurrences_created,
    (select count(*)::int from public.bookings b where b.recurring_schedule_id = r.id)
  );

  while d <= p_through_date loop
    if r.max_occurrences is not null and v_occurrences_created >= r.max_occurrences then
      exit;
    end if;
    if not exists (
      select 1
        from public._recurrence_dates(r, d, d) occurrence_date
    ) then
      d := d + 1;
      continue;
    end if;
    if exists (
      select 1 from public.recurring_occurrence_changes c
       where c.schedule_id = r.id
         and c.occurrence_date = d
         and c.kind in ('skipped', 'provider_unavailable', 'cancelled', 'provider_absent')
    ) then
      d := d + 1;
      continue;
    end if;
    v_at := make_timestamptz(
      extract(year from d)::int,
      extract(month from d)::int,
      extract(day from d)::int,
      extract(hour from r.start_time)::int,
      extract(minute from r.start_time)::int,
      extract(second from r.start_time),
      r.timezone
    );
    if exists (
      select 1 from public.bookings b
       where b.recurring_schedule_id = r.id and b.scheduled_at = v_at
    ) then
      d := d + 1;
      continue;
    end if;
    if exists (
      select 1 from public.recurring_occurrence_changes c
       where c.schedule_id = r.id
         and c.occurrence_date = d
         and c.kind = 'rescheduled'
    ) then
      d := d + 1;
      continue;
    end if;
    if r.plan_version = 'v2' and not exists (
      select 1
        from public.provider_services ps
        join public.categories c on c.id = ps.category_id
       where ps.id = r.provider_service_id
         and ps.active
         and c.active
         and c.recurrence_allowed
         and c.archetype = r.archetype
         and r.frequency = any(c.allowed_frequencies)
    ) then
      perform public._record_recurring_unavailable(
        r.id, d, v_at, 'recurring service/category is no longer eligible'
      );
      d := d + 1;
      continue;
    end if;

    v_duration := case
      when r.archetype = 'fixed' then coalesce((
        select case
          when sp.qty_min = 1 and sp.qty_max = 1 then coalesce(sp.duration_min, 60)
          else coalesce(sp.duration_min, 60) * ceil(coalesce(r.package_qty, sp.qty_min))::int
        end
        from public.service_packages sp where sp.id = r.service_package_id
      ), 60)
      else coalesce(r.session_duration_min, 60)
    end;
    v_window := tstzrange(v_at, v_at + make_interval(mins => v_duration), '[)');
    if v_at < now() + interval '60 minutes' then
      perform public._record_recurring_unavailable(r.id, d, v_at, 'planned time is less than 60 minutes away');
      d := d + 1;
      continue;
    end if;
    select coalesce(p.paused, false) into v_provider_paused
      from public.providers p where p.id = r.provider_id;
    if coalesce(v_provider_paused, false) then
      perform public._record_recurring_unavailable(r.id, d, v_at, 'provider is paused');
      d := d + 1;
      continue;
    end if;
    if exists (
      select 1 from public.provider_time_off t
       where t.provider_id = r.provider_id and t.period && v_window
    ) then
      perform public._record_recurring_unavailable(r.id, d, v_at, 'provider time off');
      d := d + 1;
      continue;
    end if;

    begin
      perform public._assert_recurring_provider_window(r.provider_id, v_window);
      perform public._assert_provider_window_free(r.provider_id, v_window, null, true);
      if r.archetype = 'time_based' then
        v_booking_id := public._create_session_booking(
          r.customer_id, r.provider_service_id, r.service_package_id, v_at,
          r.session_duration_min, r.address_line, r.city, r.lat, r.lng, r.description,
          case when r.payment_mode in ('pack_prepaid', 'monthly_prepaid') then r.pack_purchase_id else null end,
          r.id
        );
      else
        v_booking_id := public._create_fixed_occurrence(r.id, v_at);
      end if;
      v_created := v_created + 1;
      v_occurrences_created := v_occurrences_created + 1;
    exception
      when unique_violation then
        null;
      when others then
        v_reason := sqlerrm;
        if v_reason ilike 'provider_unavailable%'
           or v_reason ilike '%provider_on_leave%'
           or v_reason ilike '%outside_working_hours%'
           or v_reason ilike '%fully_booked%'
           or v_reason ilike '%provider is not available%'
           or v_reason ilike '%provider is paused%'
           or v_reason ilike '%category_not_bookable%'
           or v_reason ilike '%recurring service/category is no longer eligible%'
           or (r.plan_version = 'legacy' and v_reason = 'service not available')
           or (r.plan_version = 'legacy' and v_reason = 'address is required')
           or v_reason ilike '%provider verification is incomplete%'
           or v_reason ilike '%session package is unavailable%'
           or v_reason ilike '%package does not belong to this service%'
           or v_reason ilike '%session package must be fixed-price%'
           or v_reason ilike '%session package price is required%'
           or v_reason ilike '%active fixed package not found%'
           or v_reason ilike '%category must use the fixed archetype%'
           or v_reason ilike '%quantity is outside the package bounds%'
           or v_reason ilike '%quantity exceeds the configured maximum%'
           or v_reason ilike '%pack is not available for this session%'
           or v_reason ilike '%pack has expired%'
           or v_reason ilike '%pack has no unused sessions%' then
          perform public._record_recurring_unavailable(r.id, d, v_at, v_reason);
        else
          raise;
        end if;
    end;
    d := d + 1;
  end loop;

  update public.recurring_schedules
     set generated_through = greatest(coalesce(generated_through, p_through_date), p_through_date),
         occurrences_created = v_occurrences_created,
         status = case
           when (
             (ends_on is not null and ends_on <= p_through_date)
             or (max_occurrences is not null and v_occurrences_created >= max_occurrences)
           ) and not exists (
               select 1
                 from public.bookings future
                where future.recurring_schedule_id = r.id
                  and future.scheduled_at > now()
                  and future.status::text in (
                    'pending_payment', 'requested', 'accepted', 'confirmed', 'en_route',
                    'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress',
                    'completion_requested'
                  )
             )
             then 'completed'
           else status
         end,
         updated_at = now()
   where id = r.id;
  return v_created;
end;
$$;

create or replace function public.generate_recurring_occurrences(p_limit int default 100)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_total int := 0;
  v_horizon int := coalesce(nullif(public._recurring_rule('horizon_days'), '')::int, 28);
begin
  if not public._recurring_feature('recurring_bookings') then
    return 0;
  end if;
  for r in
    select id
      from public.recurring_schedules
     where status = 'active' and provider_acceptance = 'accepted'
     order by coalesce(generated_through, starts_on), id
     limit greatest(least(coalesce(p_limit, 100), 500), 1)
     for update skip locked
  loop
    v_total := v_total + public.materialize_recurring_schedule(r.id, current_date + v_horizon);
  end loop;
  return v_total;
end;
$$;

create or replace function public.generate_recurring_sessions(p_limit int default 50)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.generate_recurring_occurrences(p_limit);
end;
$$;

create or replace function public.request_visit_reschedule(
  p_booking_id uuid,
  p_new_at timestamptz,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings;
  r public.recurring_schedules;
  v_provider_side boolean;
  v_duration interval;
  v_new_window tstzrange;
  v_change_id uuid;
  v_cutoff int := coalesce(nullif(public._recurring_rule('reschedule_cutoff_hours'), '')::int, 12);
  v_occurrence_date date;
  v_recipient uuid;
begin
  perform public._assert(public._recurring_feature('recurring_reschedule'), 'Recurring rescheduling is turned off right now.');
  perform public._assert(char_length(trim(coalesce(p_reason, ''))) <= 300, 'reason must be 300 characters or fewer');
  b := public._lock_booking(p_booking_id);
  perform public._assert(b.recurring_schedule_id is not null, 'booking is not a recurring visit');
  select * into r from public.recurring_schedules where id = b.recurring_schedule_id for update;
  perform public._assert(found, 'recurring plan not found');
  v_provider_side := public._acts_for(b.provider_id, 'manager');
  perform public._assert(v_uid = b.customer_id or v_provider_side, 'only a plan participant can request a reschedule');
  perform public._assert(
    b.status::text in ('pending_payment', 'requested', 'accepted', 'confirmed')
      and b.scheduled_at > now() + make_interval(hours => v_cutoff),
    'visit is past the reschedule cutoff or cannot be rescheduled'
  );
  perform public._assert(
    p_new_at is not null and p_new_at > now() + interval '60 minutes',
    'new visit time must be more than 60 minutes ahead'
  );
  perform public._assert(char_length(trim(coalesce(p_reason, ''))) > 0, 'reschedule reason is required');

  if exists (
    select 1
      from public.recurring_occurrence_changes c
     where c.booking_id = b.id
       and c.kind = 'reschedule_requested'
       and not exists (
         select 1
           from public.recurring_occurrence_changes outcome
          where outcome.booking_id = c.booking_id
            and outcome.occurrence_date = c.occurrence_date
            and outcome.original_at = c.original_at
            and outcome.new_at = c.new_at
            and outcome.kind in ('rescheduled', 'reschedule_declined')
       )
  ) then
    perform public._assert(false, 'a reschedule request is already pending');
  end if;

  v_duration := coalesce(upper(b.service_window) - lower(b.service_window),
    make_interval(mins => coalesce(b.session_duration_min, 60)));
  v_new_window := tstzrange(p_new_at, p_new_at + v_duration, '[)');
  perform public._assert_provider_not_paused(b.provider_id);
  perform public._assert_recurring_provider_window(b.provider_id, v_new_window, b.id);
  perform public._assert_provider_window_free(b.provider_id, v_new_window, b.id, true);

  v_occurrence_date := (b.scheduled_at at time zone r.timezone)::date;
  insert into public.recurring_occurrence_changes (
    schedule_id, booking_id, occurrence_date, original_at, kind, new_at, actor_id, reason
  ) values (
    r.id, b.id, v_occurrence_date, b.scheduled_at, 'reschedule_requested', p_new_at, v_uid, trim(p_reason)
  ) returning id into v_change_id;
  v_recipient := case when v_uid = b.customer_id then b.provider_id else b.customer_id end;
  perform public._queue_notification(
    v_recipient, 'recurring_visit_reschedule_requested', b.id, 'Visit reschedule requested',
    left(trim(p_reason), 300),
    jsonb_build_object('recurring_schedule_id', r.id, 'change_id', v_change_id, 'new_at', p_new_at),
    'recurring-reschedule-request:' || v_change_id
  );
  return v_change_id;
end;
$$;

create or replace function public.respond_visit_reschedule(
  p_change_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  c public.recurring_occurrence_changes;
  b public.bookings;
  r public.recurring_schedules;
  v_requester_is_customer boolean;
  v_duration interval;
  v_new_window tstzrange;
  v_kind text;
  v_recipient uuid;
begin
  perform public._assert(public._recurring_feature('recurring_reschedule'), 'Recurring rescheduling is turned off right now.');
  perform public._assert(p_accept is not null, 'reschedule decision is required');
  select * into c from public.recurring_occurrence_changes where id = p_change_id for update;
  perform public._assert(found and c.kind = 'reschedule_requested', 'reschedule request not found');
  b := public._lock_booking(c.booking_id);
  select * into r from public.recurring_schedules where id = c.schedule_id for update;
  perform public._assert(found and b.recurring_schedule_id = r.id, 'recurring visit not found');
  v_requester_is_customer := c.actor_id = b.customer_id;
  if v_requester_is_customer then
    perform public._assert(public._acts_for(b.provider_id, 'manager'), 'only the provider manager can respond');
  else
    perform public._assert(v_uid = b.customer_id, 'only the other party can respond');
  end if;

  if exists (
    select 1
      from public.recurring_occurrence_changes outcome
     where outcome.booking_id = c.booking_id
       and outcome.occurrence_date = c.occurrence_date
       and outcome.original_at = c.original_at
       and outcome.new_at = c.new_at
       and outcome.kind in ('rescheduled', 'reschedule_declined')
  ) then
    return;
  end if;
  perform public._assert(b.scheduled_at = c.original_at, 'visit changed after the reschedule request');

  if p_accept then
    perform public._assert(
      c.new_at is not null and c.new_at > now() + interval '60 minutes',
      'reschedule time must remain more than 60 minutes ahead when accepted'
    );
    v_duration := coalesce(upper(b.service_window) - lower(b.service_window),
      make_interval(mins => coalesce(b.session_duration_min, 60)));
    v_new_window := tstzrange(c.new_at, c.new_at + v_duration, '[)');
    perform public._assert_provider_not_paused(b.provider_id);
    perform public._assert_recurring_provider_window(b.provider_id, v_new_window, b.id);
    perform public._assert_provider_window_free(b.provider_id, v_new_window, b.id, true);
    update public.bookings
       set scheduled_at = c.new_at, service_window = v_new_window, updated_at = now()
     where id = b.id;
    v_kind := 'rescheduled';
  else
    v_kind := 'reschedule_declined';
  end if;

  insert into public.recurring_occurrence_changes (
    schedule_id, booking_id, occurrence_date, original_at, kind, new_at, actor_id, reason
  ) values (
    r.id, b.id, c.occurrence_date, c.original_at, v_kind, c.new_at, v_uid, null
  );
  v_recipient := c.actor_id;
  perform public._queue_notification(
    v_recipient,
    case when p_accept then 'recurring_visit_rescheduled' else 'recurring_visit_reschedule_declined' end,
    b.id,
    case when p_accept then 'Visit rescheduled' else 'Reschedule declined' end,
    case when p_accept then 'The recurring visit time was updated.' else 'The reschedule request was declined.' end,
    jsonb_build_object('recurring_schedule_id', r.id, 'change_id', c.id, 'new_at', case when p_accept then c.new_at else null end),
    'recurring-reschedule-response:' || c.id
  );
end;
$$;

create or replace function public.report_provider_absence(
  p_booking_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings;
  r public.recurring_schedules;
begin
  perform public._assert(char_length(trim(coalesce(p_reason, ''))) between 1 and 300, 'absence reason is required');
  b := public._lock_booking(p_booking_id);
  perform public._assert(b.recurring_schedule_id is not null, 'booking is not a recurring visit');
  select * into r from public.recurring_schedules where id = b.recurring_schedule_id for update;
  perform public._assert(found and public._acts_for(b.provider_id, 'manager'), 'only the provider can report an absence');
  perform public._assert(
    b.status::text in ('pending_payment', 'requested', 'accepted', 'confirmed'),
    'visit can no longer be cancelled'
  );
  perform public._cancel_recurring_occurrence(b.id, b.provider_id, true, trim(p_reason));
  insert into public.recurring_occurrence_changes (
    schedule_id, booking_id, occurrence_date, original_at, kind, actor_id, reason
  ) values (
    r.id, b.id, (b.scheduled_at at time zone r.timezone)::date, b.scheduled_at,
    'provider_absent', v_uid, trim(p_reason)
  );
  perform public._queue_notification(
    r.customer_id, 'recurring_visit_cancelled_by_provider', b.id, 'Provider unavailable',
    left(trim(p_reason), 300),
    jsonb_build_object('recurring_schedule_id', r.id, 'reason', trim(p_reason)),
    'recurring-provider-absence:' || b.id
  );
end;
$$;

create or replace function public._recurring_plan_payload(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.recurring_schedules;
  v_plan jsonb;
  v_occurrences jsonb;
  v_changes jsonb;
begin
  select * into r from public.recurring_schedules where id = p_id;
  if not found then
    return null;
  end if;
  select jsonb_build_object(
    'id', r.id,
    'customer_id', r.customer_id,
    'provider_id', r.provider_id,
    'provider_service_id', r.provider_service_id,
    'service_package_id', r.service_package_id,
    'plan_version', r.plan_version,
    'frequency', r.frequency,
    'interval_count', r.interval_count,
    'weekdays', to_jsonb(r.weekdays),
    'month_day', r.month_day,
    'custom_dates', to_jsonb(r.custom_dates),
    'start_time', r.start_time,
    'timezone', r.timezone,
    'session_duration_min', r.session_duration_min,
    'payment_mode', r.payment_mode,
    'billing_frequency', r.billing_frequency,
    'archetype', r.archetype,
    'package_qty', r.package_qty,
    'provider_acceptance', r.provider_acceptance,
    'acceptance_mode', r.acceptance_mode,
    'decided_at', r.decided_at,
    'decline_reason', r.decline_reason,
    'paused_at', r.paused_at,
    'pause_until', r.pause_until,
    'address_line', r.address_line,
    'city', r.city,
    'lat', r.lat,
    'lng', r.lng,
    'description', r.description,
    'starts_on', r.starts_on,
    'ends_on', r.ends_on,
    'generated_through', r.generated_through,
    'max_occurrences', r.max_occurrences,
    'occurrences_created', r.occurrences_created,
    'status', r.status,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'cancelled_at', r.cancelled_at
  ) into v_plan;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'scheduled_at', b.scheduled_at,
    'service_window', b.service_window::text,
    'status', b.status::text,
    'total_amount', b.total_amount,
    'archetype', b.archetype,
    'service_package_id', b.service_package_id
  ) order by b.scheduled_at), '[]'::jsonb)
    into v_occurrences
    from public.bookings b
   where b.recurring_schedule_id = r.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'booking_id', c.booking_id,
    'occurrence_date', c.occurrence_date,
    'original_at', c.original_at,
    'kind', c.kind,
    'new_at', c.new_at,
    'actor_id', c.actor_id,
    'reason', c.reason,
    'created_at', c.created_at
  ) order by c.created_at), '[]'::jsonb)
    into v_changes
    from public.recurring_occurrence_changes c
   where c.schedule_id = r.id;
  return jsonb_build_object(
    'plan', v_plan,
    'occurrences', v_occurrences,
    'changes', v_changes
  );
end;
$$;

create or replace function public.list_my_recurring_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  return coalesce((
    select jsonb_agg(public._recurring_plan_payload(r.id) order by r.created_at desc)
      from public.recurring_schedules r
     where r.customer_id = v_uid or public._acts_for(r.provider_id, 'staff')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_recurring_plan(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  r public.recurring_schedules;
begin
  select * into r from public.recurring_schedules where id = p_id;
  perform public._assert(
    found and (r.customer_id = v_uid or public._acts_for(r.provider_id, 'staff')),
    'recurring plan not found'
  );
  return public._recurring_plan_payload(r.id);
end;
$$;

create or replace function public.list_provider_recurring_schedule(
  p_provider_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_items jsonb;
begin
  perform public._assert(public._feature_enabled('merchant_calendar'), 'Merchant calendar is turned off right now.');
  perform public._assert(public._recurring_feature('recurring_bookings'), 'Recurring bookings are turned off right now.');
  perform public._assert(p_from is not null and p_to >= p_from, 'valid calendar dates are required');
  perform public._assert(public._acts_for(p_provider_id, 'staff'), 'only provider staff can view this schedule');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'recurring_schedule_id', r.id,
    'scheduled_at', b.scheduled_at,
    'service_window', b.service_window::text,
    'status', b.status::text,
    'total_amount', b.total_amount,
    'customer_id', b.customer_id,
    'provider_service_id', r.provider_service_id,
    'service_package_id', b.service_package_id,
    'service_name', coalesce(sp.title, c.name),
    'archetype', b.archetype,
    'frequency', r.frequency
  ) order by b.scheduled_at), '[]'::jsonb)
    into v_items
    from public.bookings b
    join public.recurring_schedules r on r.id = b.recurring_schedule_id
    join public.provider_services ps on ps.id = r.provider_service_id
    join public.categories c on c.id = ps.category_id
    left join public.service_packages sp on sp.id = b.service_package_id
   where r.provider_id = p_provider_id
     and (b.scheduled_at at time zone r.timezone)::date between p_from and p_to;
  return v_items;
end;
$$;

create or replace function public.queue_recurring_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_hours int := coalesce(nullif(public._recurring_rule('reminder_hours_before'), '')::int, 12);
  v_count int := 0;
  v_collapse_key text;
begin
  if not public._recurring_feature('recurring_reminders') then
    return 0;
  end if;
  for b in
    select bk.id, bk.customer_id, bk.provider_id, bk.scheduled_at, r.id schedule_id
      from public.bookings bk
      join public.recurring_schedules r on r.id = bk.recurring_schedule_id
     where r.status = 'active'
       and r.provider_acceptance = 'accepted'
       and bk.status::text in ('pending_payment', 'requested', 'accepted', 'confirmed')
       and bk.scheduled_at > now()
       and bk.scheduled_at <= now() + make_interval(hours => v_hours)
     order by bk.scheduled_at
     limit 1000
     for update of bk skip locked
  loop
    v_collapse_key := 'recurring-reminder:' || b.id;
    if not exists (
      select 1 from public.notifications n
       where n.user_id = b.customer_id
         and n.kind = 'recurring_visit_upcoming'
         and n.collapse_key = v_collapse_key
    ) then
      perform public._queue_notification(
        b.customer_id, 'recurring_visit_upcoming', b.id, 'Upcoming recurring visit',
        'You have an upcoming home-service visit.',
        jsonb_build_object('recurring_schedule_id', b.schedule_id, 'scheduled_at', b.scheduled_at),
        v_collapse_key
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.expire_recurring_occurrences(p_limit int default 100)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  p record;
  v_due_hours int;
  v_grace_hours int;
  v_failure_sqlstate text;
  v_count int := 0;
  v_reason text := 'recurring occurrence payment grace period expired';
begin
  select nullif(c.value ->> 'payment_due_hours_before', '')::int,
         nullif(c.value ->> 'billing_grace_hours', '')::int
    into v_due_hours, v_grace_hours
    from public.app_config c
   where c.key = 'recurring_rules'
   for share;
  v_due_hours := coalesce(v_due_hours, 48);
  v_grace_hours := coalesce(v_grace_hours, 24);
  perform public._assert(
    v_due_hours > v_grace_hours,
    'payment_due_hours_before must be greater than billing_grace_hours'
  );

  -- Retry link cancellation without booking locks after a concurrent webhook held the link row.
  update public.payments pay
     set status = 'failed', cancel_link_pending = true
    from public.bookings bk
    join public.recurring_schedules r on r.id = bk.recurring_schedule_id
   where pay.booking_id = bk.id
     and bk.status::text = 'expired'
     and r.billing_frequency = 'per_visit'
     and pay.status = 'created';

  for b in
    select bk.id, bk.customer_id, bk.provider_id, bk.scheduled_at, r.id schedule_id, r.timezone
      from public.bookings bk
      join public.recurring_schedules r on r.id = bk.recurring_schedule_id
     where bk.status::text = 'pending_payment'
       and r.billing_frequency = 'per_visit'
       and exists (
         select 1 from public.payment_schedule ps
          where ps.booking_id = bk.id and ps.status in ('due', 'upcoming')
       )
       and not exists (
         select 1 from public.payment_schedule ps
          where ps.booking_id = bk.id
            and ps.status in ('due', 'upcoming')
            and (ps.due_at is null or least(
              ps.due_at + make_interval(hours => v_grace_hours),
              bk.scheduled_at - interval '30 minutes'
            ) > now())
       )
     order by bk.scheduled_at, bk.id
     limit greatest(least(coalesce(p_limit, 100), 500), 1)
     for update of bk skip locked
  loop
    begin
      -- Recheck after acquiring the booking lock; only remaining obligations can expire.
      if exists (
        select 1 from public.payment_schedule ps
         where ps.booking_id = b.id and ps.status in ('due', 'upcoming')
      ) and not exists (
        select 1 from public.payment_schedule ps
         where ps.booking_id = b.id and ps.status in ('due', 'upcoming')
           and (ps.due_at is null or least(
             ps.due_at + make_interval(hours => v_grace_hours),
             b.scheduled_at - interval '30 minutes'
           ) > now())
      ) then
        for p in
          select pay.id
            from public.payments pay
           where pay.booking_id = b.id and pay.status = 'created'
           order by pay.id
        loop
          begin
            -- A webhook may hold this link while waiting for the booking lock. Skip rather
            -- than deadlocking; waived obligations make its eventual capture refundable.
            perform 1 from public.payments pay where pay.id = p.id for update nowait;
            update public.payments
               set status = 'failed', cancel_link_pending = true
             where id = p.id and status = 'created';
          exception when lock_not_available then
            null;
          end;
        end loop;

        update public.payment_schedule
           set status = 'waived', updated_at = now()
         where booking_id = b.id and status in ('due', 'upcoming');
        perform public._refund_booking_payments(b.id, v_reason);
        perform public._set_status(b.id, 'expired', null, v_reason);
        insert into public.recurring_occurrence_changes (
          schedule_id, booking_id, occurrence_date, original_at, kind, actor_id, reason
        ) values (
          b.schedule_id, b.id, (b.scheduled_at at time zone b.timezone)::date,
          b.scheduled_at, 'cancelled', null, v_reason
        ) on conflict do nothing;

        perform public._queue_notification(
          b.customer_id, 'recurring_visit_unavailable', b.id, 'Recurring visit expired',
          'The payment window for this recurring visit expired, so the visit was released.',
          jsonb_build_object('booking_id', b.id, 'recurring_schedule_id', b.schedule_id),
          'recurring-unpaid-expiry:' || b.id::text || ':customer'
        );
        perform public._queue_notification(
          b.provider_id, 'recurring_visit_unavailable', b.id, 'Recurring visit expired',
          'The unpaid recurring visit expired and the provider window is available again.',
          jsonb_build_object('booking_id', b.id, 'recurring_schedule_id', b.schedule_id),
          'recurring-unpaid-expiry:' || b.id::text || ':provider'
        );
        update public.recurring_expiry_failures
           set resolved_at = now()
         where booking_id = b.id and resolved_at is null;
        v_count := v_count + 1;
      end if;
    exception when others then
      get stacked diagnostics v_failure_sqlstate = returned_sqlstate;
      insert into public.recurring_expiry_failures as prior_failure (
        booking_id, schedule_id, occurrence_date, failure_sqlstate, failure_stage
      ) values (
        b.id, b.schedule_id, (b.scheduled_at at time zone b.timezone)::date,
        v_failure_sqlstate, 'booking_lifecycle'
      )
      on conflict (booking_id) do update
         set schedule_id = excluded.schedule_id,
             occurrence_date = excluded.occurrence_date,
             failure_sqlstate = excluded.failure_sqlstate,
             failure_stage = excluded.failure_stage,
             attempts = prior_failure.attempts + 1,
             last_failed_at = now(),
             resolved_at = null;
    end;
  end loop;
  return v_count;
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
  v_category public.categories;
  k public.pack_purchases;
  v_schedule public.recurring_schedules;
  v_first_date date;
  v_first_at timestamptz;
  v_id uuid;
  v_horizon int := coalesce(nullif(public._recurring_rule('horizon_days'), '')::int, 28);
begin
  perform public._assert(public._recurring_feature('recurring_bookings'), 'Recurring bookings are turned off right now.');
  select * into ps from public.provider_services where id = p_provider_service_id and active;
  perform public._assert(found, 'service not available');
  select * into v_category from public.categories where id = ps.category_id;
  perform public._assert(found and v_category.active, 'service category is not available');
  perform public._assert(
    v_category.archetype = 'time_based'
      and v_category.recurrence_allowed
      and 'weekly' = any(v_category.allowed_frequencies),
    'weekly recurrence is not enabled for this service category'
  );
  perform public._assert(public._provider_is_live(ps.provider_id), 'provider is not available');
  perform public._assert_provider_not_paused(ps.provider_id);
  perform public._assert(ps.provider_id <> v_uid, 'cannot schedule your own service');
  perform public._assert(p_payment_mode in ('per_session', 'pack_prepaid', 'monthly_prepaid'), 'invalid recurring payment mode');
  perform public._assert(
    coalesce(cardinality(p_weekdays), 0) between 1 and 7
      and p_weekdays <@ array[1,2,3,4,5,6,7]::smallint[],
    'weekdays must be ISO days 1 through 7'
  );
  perform public._assert(p_duration_min between 15 and 480, 'invalid session duration');
  perform public._assert(p_start_time is not null, 'start time is required');
  perform public._assert(p_starts_on >= current_date, 'recurring start date is in the past');
  perform public._assert(p_ends_on is null or p_ends_on <= p_starts_on + interval '366 days',
    'recurring schedule may span at most one year');
  perform public._assert(
    coalesce(trim(p_address_line), '') <> '' and coalesce(trim(p_city), '') <> '',
    'address is required'
  );
  perform public._assert(p_lat is not null and p_lng is not null, 'location is required');
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
    frequency, interval_count, weekdays, month_day, custom_dates, start_time, timezone,
    session_duration_min, payment_mode, billing_frequency, archetype, address_line,
    city, lat, lng, description, starts_on, ends_on, plan_version,
    provider_acceptance, acceptance_mode
  ) values (
    v_uid, ps.provider_id, ps.id, p_service_package_id, p_pack_id,
    'weekly', 1, array(select distinct x from unnest(p_weekdays) x order by x), null, '{}'::date[],
    p_start_time, coalesce(nullif(trim(p_timezone), ''), 'Asia/Kolkata'), p_duration_min,
    p_payment_mode,
    case p_payment_mode
      when 'per_session' then 'per_visit'
      when 'pack_prepaid' then 'prepaid_package'
      when 'monthly_prepaid' then 'monthly'
      else 'per_visit'
    end,
    'time_based', trim(p_address_line), trim(p_city), p_lat, p_lng,
    coalesce(p_description, ''), p_starts_on, p_ends_on, 'legacy', 'accepted', 'occurrence'
  ) returning id into v_id;

  select * into v_schedule from public.recurring_schedules where id = v_id;
  select min(d) into v_first_date
    from public._recurrence_dates(
      v_schedule, v_schedule.starts_on,
      coalesce(v_schedule.ends_on, v_schedule.starts_on + coalesce(nullif(public._recurring_rule('max_plan_days'), '')::int, 365))
    ) d;
  perform public._assert(v_first_date is not null, 'recurring schedule has no occurrence in its date range');
  v_first_at := make_timestamptz(
    extract(year from v_first_date)::int,
    extract(month from v_first_date)::int,
    extract(day from v_first_date)::int,
    extract(hour from v_schedule.start_time)::int,
    extract(minute from v_schedule.start_time)::int,
    extract(second from v_schedule.start_time),
    v_schedule.timezone
  );
  perform public._assert(
    v_first_at >= now() + interval '60 minutes',
    'first recurring visit must be scheduled at least 60 minutes ahead'
  );
  perform public.materialize_recurring_schedule(v_id, current_date + v_horizon);
  return v_id;
end;
$$;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'generate-recurring-occurrences';
    perform cron.schedule(
      'generate-recurring-occurrences',
      '17 * * * *',
      'select case when public._feature_enabled(''recurring_bookings'') then public.generate_recurring_occurrences() end'
    );
    perform cron.unschedule(jobid) from cron.job where jobname = 'recurring-visit-reminders';
    perform cron.schedule(
      'recurring-visit-reminders',
      '*/15 * * * *',
      'select public.queue_recurring_reminders()'
    );
    perform cron.unschedule(jobid) from cron.job where jobname = 'expire-unpaid-recurring-occurrences';
    perform cron.schedule(
      'expire-unpaid-recurring-occurrences',
      '*/5 * * * *',
      'select public.expire_recurring_occurrences(500)'
    );
  end if;
end;
$$;

revoke all on function public._cancel_recurring_occurrence(uuid, uuid, boolean, text),
  public._cancel_recurring_plan_internal(uuid, uuid, boolean, text),
  public._record_recurring_unavailable(uuid, date, timestamptz, text),
  public._recurring_plan_payload(uuid),
  public._assert_recurring_provider_window(uuid, tstzrange, uuid),
  public._guard_recurring_pending_window(),
  public._guard_recurring_payment_window_rules(),
  public._set_recurring_payment_schedule_due_at(),
  public._refresh_recurring_payment_due_at()
from public, anon, authenticated;

revoke execute on function public.quote_recurring_plan(jsonb),
  public.create_recurring_plan(jsonb),
  public.respond_recurring_plan(uuid, boolean, text),
  public.pause_recurring_plan(uuid, date),
  public.resume_recurring_plan(uuid),
  public.skip_recurring_visit(uuid, text),
  public.cancel_recurring_plan(uuid, text),
  public.request_visit_reschedule(uuid, timestamptz, text),
  public.respond_visit_reschedule(uuid, boolean),
  public.report_provider_absence(uuid, text),
  public.list_my_recurring_plans(),
  public.get_recurring_plan(uuid),
  public.list_provider_recurring_schedule(uuid, date, date),
  public._can_read_recurring_occurrence_changes(uuid),
  public.create_recurring_schedule(uuid, uuid, uuid, text, smallint[], time, text, int, date, date, text, text, double precision, double precision, text),
  public.cancel_recurring_schedule(uuid, boolean)
from public, anon;
grant execute on function public.quote_recurring_plan(jsonb),
  public.create_recurring_plan(jsonb),
  public.respond_recurring_plan(uuid, boolean, text),
  public.pause_recurring_plan(uuid, date),
  public.resume_recurring_plan(uuid),
  public.skip_recurring_visit(uuid, text),
  public.cancel_recurring_plan(uuid, text),
  public.request_visit_reschedule(uuid, timestamptz, text),
  public.respond_visit_reschedule(uuid, boolean),
  public.report_provider_absence(uuid, text),
  public.list_my_recurring_plans(),
  public.get_recurring_plan(uuid),
  public.list_provider_recurring_schedule(uuid, date, date),
  public._can_read_recurring_occurrence_changes(uuid),
  public.create_recurring_schedule(uuid, uuid, uuid, text, smallint[], time, text, int, date, date, text, text, double precision, double precision, text),
  public.cancel_recurring_schedule(uuid, boolean)
to authenticated;

revoke execute on function public.materialize_recurring_schedule(uuid, date),
  public.generate_recurring_sessions(int),
  public.generate_recurring_occurrences(int),
  public.queue_recurring_reminders(),
  public.expire_recurring_occurrences(int)
from public, anon, authenticated;
grant execute on function public.materialize_recurring_schedule(uuid, date),
  public.generate_recurring_sessions(int),
  public.generate_recurring_occurrences(int),
  public.queue_recurring_reminders(),
  public.expire_recurring_occurrences(int)
to service_role;

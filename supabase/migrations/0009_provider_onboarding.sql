-- Provider onboarding v2 (docs/08-Provider-Onboarding.md).
--  * Go-live rule in ONE helper, _provider_is_live(provider_id): payout account activated (kyc_status = 'verified')
--    AND profile submitted (server-validated completeness + provider agreement) AND not suspended / deactivated
--    AND at least one active service whose category's required documents are approved and unexpired.
--    search_providers, create_booking and every public RLS predicate now use it (+ _category_docs_ok per service).
--    Existing verified providers are backfilled as submitted, so their behaviour is unchanged.
--  * Weekly availability + time off (doc 07 §3.9 table names), max jobs per day; create_booking validates the slot.
--  * Category config: requires_docs (doc 07 §3.1) + recommended_docs, category_skills (skills/brands/tools/rate items).
--  * Platform trust documents (private bucket provider-docs) with admin review RPCs audited in admin_audit_log.
--  * Payout account record (Razorpay linked account ids + masked bank only; never PAN or full account number).
--  * Column privacy: providers.base_location / razorpay_account_id / kyc_reference / gender are no longer readable
--    by other users; the owner reads them through get_my_provider() / get_my_provider_onboarding().
-- Requires 0008 (kyc_status enum values).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.providers
  add column if not exists gender text check (gender in ('female', 'male', 'non_binary', 'prefer_not_to_say')),
  add column if not exists timezone text not null default 'Asia/Kolkata',
  add column if not exists base_area text check (char_length(base_area) <= 80),
  add column if not exists max_jobs_per_day int check (max_jobs_per_day between 1 and 30),
  add column if not exists paused boolean not null default false,
  add column if not exists deactivated_at timestamptz,
  add column if not exists onboarding_step int not null default 0 check (onboarding_step between 0 and 7),
  add column if not exists submitted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists kyc_reason text,
  add column if not exists kyc_requirements jsonb not null default '[]'::jsonb,
  add column if not exists kyc_updated_at timestamptz,
  add column if not exists review_note text check (char_length(review_note) <= 500);

alter table public.categories
  add column if not exists requires_docs text[] not null default '{}',
  add column if not exists recommended_docs text[] not null default '{}';

alter table public.provider_services
  add column if not exists specialisations text[] not null default '{}',
  add column if not exists brands text[] not null default '{}',
  add column if not exists tools text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- Config tables
-- ---------------------------------------------------------------------------
create table public.document_types (
  code text primary key,
  label text not null,
  description text not null default '',
  has_expiry boolean not null default false,
  sort_order int not null default 0
);
insert into public.document_types (code, label, description, has_expiry, sort_order) values
  ('police_verification', 'Police verification certificate', 'Police clearance / character certificate issued in the last 12 months', true, 1),
  ('electrical_licence', 'Electrical licence', 'State electrical contractor / wireman licence', true, 2),
  ('pest_control_licence', 'Pest control licence', 'Pest control operator licence under the Insecticides Act', true, 3),
  ('fssai', 'FSSAI registration', 'FSSAI registration or licence', true, 4),
  ('driving_licence', 'Driving licence', 'Valid driving licence', true, 5),
  ('trade_certificate', 'Training certificate', 'ITI / brand / skill training certificate', false, 6),
  ('other_certificate', 'Other certificate', 'Any other relevant certificate', false, 7);

-- PM default (doc 07 §9 B3; founder may override): licences are RECOMMENDED, not mandatory, for the current repair
-- categories until a lawyer confirms the list. Making one mandatory is a config change:
--   update categories set requires_docs = '{electrical_licence}' where slug = 'electrician';
update public.categories set recommended_docs = '{electrical_licence}' where slug = 'electrician';
update public.categories set recommended_docs = '{pest_control_licence}' where slug = 'pest-control';
update public.categories set recommended_docs = '{police_verification}' where slug in ('house-cleaning');

create table public.category_skills (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  kind text not null check (kind in ('skill', 'brand', 'tool', 'rate_item')),
  slug text not null,
  label text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  unique (category_id, kind, slug)
);

insert into public.category_skills (category_id, kind, slug, label, sort_order)
select c.id, v.kind, v.slug, v.label, v.ord
  from (values
    ('ac-repair', 'skill', 'split', 'Split AC', 1), ('ac-repair', 'skill', 'window', 'Window AC', 2),
    ('ac-repair', 'skill', 'inverter', 'Inverter AC', 3), ('ac-repair', 'skill', 'gas-refill', 'Gas refill', 4),
    ('ac-repair', 'skill', 'installation', 'Installation / uninstallation', 5), ('ac-repair', 'skill', 'servicing', 'Jet / deep servicing', 6),
    ('ac-repair', 'skill', 'pcb', 'PCB repair', 7), ('ac-repair', 'skill', 'cassette', 'Cassette / central AC', 8),
    ('ac-repair', 'brand', 'daikin', 'Daikin', 1), ('ac-repair', 'brand', 'voltas', 'Voltas', 2), ('ac-repair', 'brand', 'lg', 'LG', 3),
    ('ac-repair', 'brand', 'samsung', 'Samsung', 4), ('ac-repair', 'brand', 'blue-star', 'Blue Star', 5), ('ac-repair', 'brand', 'hitachi', 'Hitachi', 6),
    ('ac-repair', 'tool', 'vacuum-pump', 'Vacuum pump', 1), ('ac-repair', 'tool', 'gauge', 'Manifold gauge', 2), ('ac-repair', 'tool', 'jet-pump', 'Jet pump', 3),
    ('ac-repair', 'rate_item', 'gas-refill', 'Gas refill (full)', 1), ('ac-repair', 'rate_item', 'jet-service', 'Jet service', 2),
    ('ac-repair', 'rate_item', 'install-split', 'Split AC installation', 3), ('ac-repair', 'rate_item', 'capacitor', 'Capacitor replacement', 4),
    ('electrician', 'skill', 'wiring', 'House wiring', 1), ('electrician', 'skill', 'fan', 'Fan installation / repair', 2),
    ('electrician', 'skill', 'switchboard', 'Switchboards & sockets', 3), ('electrician', 'skill', 'inverter', 'Inverter / UPS', 4),
    ('electrician', 'skill', 'lights', 'Lights & fixtures', 5), ('electrician', 'skill', 'mcb', 'MCB / DB board', 6),
    ('electrician', 'tool', 'multimeter', 'Multimeter', 1), ('electrician', 'tool', 'tester', 'Line tester', 2), ('electrician', 'tool', 'drill', 'Drill machine', 3),
    ('electrician', 'rate_item', 'fan-install', 'Ceiling fan installation', 1), ('electrician', 'rate_item', 'switch-replace', 'Switch / socket replacement', 2),
    ('electrician', 'rate_item', 'light-install', 'Light fixture installation', 3),
    ('plumber', 'skill', 'leak', 'Leak repair', 1), ('plumber', 'skill', 'tap', 'Taps & mixers', 2), ('plumber', 'skill', 'blockage', 'Drain blockage', 3),
    ('plumber', 'skill', 'toilet', 'Toilet / flush tank', 4), ('plumber', 'skill', 'motor', 'Water motor / pump', 5), ('plumber', 'skill', 'pipeline', 'Pipeline work', 6),
    ('plumber', 'tool', 'pipe-wrench', 'Pipe wrench', 1), ('plumber', 'tool', 'drain-snake', 'Drain snake', 2),
    ('plumber', 'rate_item', 'tap-replace', 'Tap replacement', 1), ('plumber', 'rate_item', 'blockage', 'Drain blockage removal', 2),
    ('plumber', 'rate_item', 'flush-repair', 'Flush tank repair', 3),
    ('house-cleaning', 'skill', 'deep', 'Full home deep cleaning', 1), ('house-cleaning', 'skill', 'bathroom', 'Bathroom cleaning', 2),
    ('house-cleaning', 'skill', 'kitchen', 'Kitchen cleaning', 3), ('house-cleaning', 'skill', 'sofa', 'Sofa / carpet shampoo', 4),
    ('house-cleaning', 'tool', 'scrubber', 'Scrubbing machine', 1), ('house-cleaning', 'tool', 'vacuum', 'Vacuum cleaner', 2),
    ('house-cleaning', 'rate_item', 'bathroom', 'Bathroom deep clean (per bathroom)', 1), ('house-cleaning', 'rate_item', 'kitchen', 'Kitchen deep clean', 2),
    ('water-tank-cleaning', 'skill', 'overhead', 'Overhead tank', 1), ('water-tank-cleaning', 'skill', 'sump', 'Underground sump', 2),
    ('water-tank-cleaning', 'skill', 'disinfection', 'Disinfection', 3),
    ('water-tank-cleaning', 'tool', 'pump', 'Sludge pump', 1), ('water-tank-cleaning', 'tool', 'pressure-washer', 'Pressure washer', 2),
    ('water-tank-cleaning', 'rate_item', 'tank-1000', 'Tank up to 1000 L', 1), ('water-tank-cleaning', 'rate_item', 'sump', 'Sump cleaning', 2),
    ('car-mechanic', 'skill', 'service', 'General service', 1), ('car-mechanic', 'skill', 'battery', 'Battery', 2), ('car-mechanic', 'skill', 'brakes', 'Brakes', 3),
    ('car-mechanic', 'skill', 'ac', 'Car AC', 4), ('car-mechanic', 'skill', 'electrical', 'Car electricals', 5), ('car-mechanic', 'skill', 'breakdown', 'Breakdown / jump start', 6),
    ('car-mechanic', 'brand', 'maruti', 'Maruti Suzuki', 1), ('car-mechanic', 'brand', 'hyundai', 'Hyundai', 2), ('car-mechanic', 'brand', 'tata', 'Tata', 3),
    ('car-mechanic', 'brand', 'mahindra', 'Mahindra', 4), ('car-mechanic', 'brand', 'honda', 'Honda', 5), ('car-mechanic', 'brand', 'toyota', 'Toyota', 6),
    ('car-mechanic', 'tool', 'obd', 'OBD scanner', 1), ('car-mechanic', 'tool', 'jack', 'Hydraulic jack', 2),
    ('car-mechanic', 'rate_item', 'battery-jump', 'Jump start', 1), ('car-mechanic', 'rate_item', 'brake-pads', 'Brake pad replacement (labour)', 2),
    ('bike-mechanic', 'skill', 'service', 'General service', 1), ('bike-mechanic', 'skill', 'puncture', 'Puncture repair', 2),
    ('bike-mechanic', 'skill', 'engine', 'Engine work', 3), ('bike-mechanic', 'skill', 'electrical', 'Electricals', 4), ('bike-mechanic', 'skill', 'ev', 'Electric scooter', 5),
    ('bike-mechanic', 'brand', 'hero', 'Hero', 1), ('bike-mechanic', 'brand', 'honda', 'Honda', 2), ('bike-mechanic', 'brand', 'bajaj', 'Bajaj', 3),
    ('bike-mechanic', 'brand', 'tvs', 'TVS', 4), ('bike-mechanic', 'brand', 'royal-enfield', 'Royal Enfield', 5),
    ('bike-mechanic', 'rate_item', 'puncture', 'Puncture repair', 1), ('bike-mechanic', 'rate_item', 'oil-change', 'Oil change (labour)', 2),
    ('appliance-repair', 'skill', 'washing-machine', 'Washing machine', 1), ('appliance-repair', 'skill', 'refrigerator', 'Refrigerator', 2),
    ('appliance-repair', 'skill', 'microwave', 'Microwave', 3), ('appliance-repair', 'skill', 'tv', 'Television', 4), ('appliance-repair', 'skill', 'geyser', 'Geyser', 5),
    ('appliance-repair', 'skill', 'ro', 'RO water purifier', 6), ('appliance-repair', 'skill', 'chimney', 'Kitchen chimney', 7),
    ('appliance-repair', 'brand', 'lg', 'LG', 1), ('appliance-repair', 'brand', 'samsung', 'Samsung', 2), ('appliance-repair', 'brand', 'whirlpool', 'Whirlpool', 3),
    ('appliance-repair', 'brand', 'ifb', 'IFB', 4), ('appliance-repair', 'brand', 'godrej', 'Godrej', 5), ('appliance-repair', 'brand', 'bosch', 'Bosch', 6),
    ('appliance-repair', 'rate_item', 'wm-repair', 'Washing machine repair (labour)', 1), ('appliance-repair', 'rate_item', 'fridge-gas', 'Fridge gas charging', 2),
    ('pest-control', 'skill', 'cockroach', 'Cockroach', 1), ('pest-control', 'skill', 'termite', 'Termite', 2), ('pest-control', 'skill', 'bed-bugs', 'Bed bugs', 3),
    ('pest-control', 'skill', 'mosquito', 'Mosquito', 4), ('pest-control', 'skill', 'rodent', 'Rodent', 5),
    ('pest-control', 'tool', 'sprayer', 'Sprayer', 1), ('pest-control', 'tool', 'fogger', 'Fogging machine', 2),
    ('pest-control', 'rate_item', 'cockroach-1bhk', 'Cockroach treatment 1 BHK', 1), ('pest-control', 'rate_item', 'termite-1bhk', 'Termite treatment 1 BHK', 2),
    ('carpenter', 'skill', 'furniture-repair', 'Furniture repair', 1), ('carpenter', 'skill', 'assembly', 'Furniture assembly', 2),
    ('carpenter', 'skill', 'doors', 'Doors & locks', 3), ('carpenter', 'skill', 'modular', 'Modular kitchen / wardrobe', 4),
    ('carpenter', 'tool', 'drill', 'Drill machine', 1), ('carpenter', 'tool', 'saw', 'Power saw', 2),
    ('carpenter', 'rate_item', 'lock-replace', 'Door lock replacement', 1), ('carpenter', 'rate_item', 'bed-assembly', 'Bed assembly', 2),
    ('painter', 'skill', 'interior', 'Interior painting', 1), ('painter', 'skill', 'exterior', 'Exterior painting', 2),
    ('painter', 'skill', 'texture', 'Texture / stencil', 3), ('painter', 'skill', 'waterproofing', 'Waterproofing', 4), ('painter', 'skill', 'wood-polish', 'Wood polish', 5),
    ('painter', 'brand', 'asian-paints', 'Asian Paints', 1), ('painter', 'brand', 'berger', 'Berger', 2), ('painter', 'brand', 'nerolac', 'Nerolac', 3),
    ('painter', 'tool', 'spray', 'Spray machine', 1), ('painter', 'tool', 'sander', 'Sanding machine', 2),
    ('painter', 'rate_item', 'room-repaint', 'Room repaint (labour)', 1), ('painter', 'rate_item', 'waterproof-sqft', 'Waterproofing per sq ft', 2)
  ) as v(slug_cat, kind, slug, label, ord)
  join public.categories c on c.slug = v.slug_cat
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Availability (doc 07 §3.9). weekday follows extract(dow): 0 = Sunday. Times are in providers.timezone.
-- ---------------------------------------------------------------------------
create table public.provider_availability (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index provider_availability_provider_idx on public.provider_availability (provider_id, weekday);

create table public.provider_time_off (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  period tstzrange not null check (not isempty(period) and lower(period) is not null and upper(period) is not null),
  reason text check (char_length(reason) <= 120),
  created_at timestamptz not null default now()
);
create index provider_time_off_provider_idx on public.provider_time_off (provider_id);

-- ---------------------------------------------------------------------------
-- Portfolio, documents, payout account, onboarding events
-- ---------------------------------------------------------------------------
create table public.provider_portfolio (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  file_path text not null,
  caption text not null default '' check (char_length(caption) <= 140),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index provider_portfolio_provider_idx on public.provider_portfolio (provider_id, sort_order);

create table public.provider_documents (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  doc_type text not null references public.document_types (code),
  category_id uuid references public.categories (id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'superseded')),
  reject_reason text check (char_length(reject_reason) <= 300),
  expires_on date,
  file_path text not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index provider_documents_provider_idx on public.provider_documents (provider_id, doc_type);
create index provider_documents_pending_idx on public.provider_documents (created_at) where status = 'pending';

-- Payout beneficiary on the rail chosen at onboarding (docs/03 §5.1): Route linked account ids, or RazorpayX
-- contact / fund account / validation ids. Only identifiers and masked values: never PAN, never full account numbers.
create table public.provider_payout_accounts (
  provider_id uuid primary key references public.providers (id) on delete cascade,
  rail text not null default 'payouts' check (rail in ('route', 'payouts')),
  razorpay_account_id text unique,
  stakeholder_id text,
  product_id text,
  contact_id text,
  fund_account_id text unique,
  validation_id text,
  name_match_score numeric,
  activation_status text not null default 'not_started',
  requirements jsonb not null default '[]'::jsonb,
  beneficiary_name text,
  bank_last4 text check (bank_last4 ~ '^[0-9]{2,4}$'),
  ifsc text check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  email text,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Status history + hook for push/in-app notices (the notifications service can consume this table).
create table public.provider_onboarding_events (
  id bigint generated always as identity primary key,
  provider_id uuid not null references public.providers (id) on delete cascade,
  kind text not null,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index provider_onboarding_events_provider_idx on public.provider_onboarding_events (provider_id, at desc);

-- ---------------------------------------------------------------------------
-- Backfill: currently verified providers stay live exactly as before.
-- ---------------------------------------------------------------------------
update public.providers
   set submitted_at = coalesce(submitted_at, created_at),
       terms_version = coalesce(terms_version, 'legacy'),
       onboarding_step = 7,
       kyc_updated_at = coalesce(kyc_updated_at, created_at)
 where kyc_status = 'verified';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._provider_terms_version()
returns text language sql immutable as $$ select 'provider-agreement-v1-2026-11-14'::text $$;

create or replace function public._provider_local_date(p_provider_id uuid, p_at timestamptz)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (p_at at time zone coalesce((select timezone from public.providers where id = p_provider_id), 'Asia/Kolkata'))::date;
$$;

-- Every required doc of the category is approved and unexpired for this provider.
create or replace function public._category_docs_ok(p_provider_id uuid, p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
      from public.categories c
      cross join lateral unnest(c.requires_docs) as d(doc_type)
     where c.id = p_category_id
       and not exists (
         select 1 from public.provider_documents pd
          where pd.provider_id = p_provider_id
            and pd.doc_type = d.doc_type
            and (pd.category_id is null or pd.category_id = c.id)
            and pd.status = 'approved'
            and (pd.expires_on is null or pd.expires_on >= public._provider_local_date(p_provider_id, now()))
       )
  );
$$;

-- THE go-live rule (searchable / bookable / publicly visible). Paused providers stay visible but are not bookable.
create or replace function public._provider_is_live(p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.providers p
     where p.id = p_provider_id
       and p.kyc_status = 'verified'
       and not p.suspended
       and p.deactivated_at is null
       and p.submitted_at is not null
       and exists (select 1 from public.provider_services ps
                    where ps.provider_id = p.id and ps.active and public._category_docs_ok(p.id, ps.category_id))
  );
$$;

create or replace function public._log_onboarding_event(p_provider_id uuid, p_kind text, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  -- TODO(notifications): the notifications service can fan these out as push/in-app notices
  -- (kinds: submitted, payout_status_changed, payout_setup_failed, document_reviewed, review_note).
  insert into public.provider_onboarding_events (provider_id, kind, details) values (p_provider_id, p_kind, coalesce(p_details, '{}'::jsonb));
$$;

-- Why a booking slot is not available (null = available). Windows are 2 hours (app/src/lib/schedule.ts WINDOW_HOURS).
-- Providers with no weekly hours configured (pre-onboarding-v2 accounts) are treated as always available.
create or replace function public._provider_slot_problem(p_provider_id uuid, p_start timestamptz, p_asap boolean)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_max int;
  v_local timestamp;
  v_dow int;
  v_min numeric;
  v_len numeric := case when p_asap then 0 else 120 end;
  v_count int;
begin
  select coalesce(timezone, 'Asia/Kolkata'), max_jobs_per_day into v_tz, v_max from public.providers where id = p_provider_id;
  v_local := p_start at time zone v_tz;
  v_dow := extract(dow from v_local)::int;
  v_min := extract(epoch from v_local::time) / 60.0;

  if exists (select 1 from public.provider_time_off t
              where t.provider_id = p_provider_id
                and t.period && tstzrange(p_start, p_start + make_interval(mins => greatest(v_len, 1)::int), '[)')) then
    return 'provider_on_leave';
  end if;

  if exists (select 1 from public.provider_availability where provider_id = p_provider_id)
     and not exists (
       select 1 from public.provider_availability a
        where a.provider_id = p_provider_id
          and a.weekday = v_dow
          and extract(epoch from a.start_time) / 60.0 <= v_min
          and (case when p_asap then v_min < extract(epoch from a.end_time) / 60.0
                    else v_min + v_len <= extract(epoch from a.end_time) / 60.0 end)
     ) then
    return 'outside_working_hours';
  end if;

  if v_max is not null then
    select count(*) into v_count
      from public.bookings b
     where b.provider_id = p_provider_id
       and (coalesce(b.scheduled_at, b.created_at) at time zone v_tz)::date = v_local::date
       and (b.status not in ('pending_payment', 'declined', 'expired', 'cancelled', 'refunded', 'closed_no_work')
            or (b.status = 'pending_payment' and b.created_at > now() - interval '30 minutes'));
    if v_count >= v_max then
      return 'fully_booked';
    end if;
  end if;
  return null;
end;
$$;

-- Server-side completeness (mirrored for display in app/src/lib/onboarding/completeness.ts).
create or replace function public._provider_onboarding_checks(p_provider_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'name', 'required', true, 'ok', char_length(trim(coalesce(pf.full_name, ''))) >= 2),
    jsonb_build_object('key', 'photo', 'required', true, 'ok', pf.avatar_url is not null),
    jsonb_build_object('key', 'bio', 'required', true, 'ok', char_length(trim(coalesce(p.bio, ''))) >= 30),
    jsonb_build_object('key', 'languages', 'required', true, 'ok', cardinality(p.languages) >= 1),
    jsonb_build_object('key', 'services', 'required', true,
                       'ok', exists (select 1 from public.provider_services s where s.provider_id = p.id and s.active)),
    jsonb_build_object('key', 'area', 'required', true, 'ok', trim(p.city) <> '' and p.base_location is not null),
    jsonb_build_object('key', 'hours', 'required', true,
                       'ok', exists (select 1 from public.provider_availability a where a.provider_id = p.id)),
    jsonb_build_object('key', 'specialisations', 'required', false,
                       'ok', exists (select 1 from public.provider_services s where s.provider_id = p.id and s.active)
                             and not exists (select 1 from public.provider_services s
                                              where s.provider_id = p.id and s.active and cardinality(s.specialisations) = 0)),
    jsonb_build_object('key', 'portfolio', 'required', false,
                       'ok', (select count(*) from public.provider_portfolio x where x.provider_id = p.id) >= 3),
    jsonb_build_object('key', 'payout', 'required', false,
                       'ok', exists (select 1 from public.provider_payout_accounts pa
                                      where pa.provider_id = p.id
                                        and (pa.razorpay_account_id is not null or pa.fund_account_id is not null)))
  )
    from public.providers p join public.profiles pf on pf.id = p.id
   where p.id = p_provider_id;
$$;

-- Status shown to the provider: draft | under_review | action_needed | live | suspended | deactivated, with reason codes.
create or replace function public._provider_go_live(p_provider_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.providers;
  pa public.provider_payout_accounts;
  v_reasons jsonb := '[]'::jsonb;
  v_state text;
  r record;
begin
  select * into p from public.providers where id = p_provider_id;
  if not found then
    return jsonb_build_object('state', 'draft', 'reasons', '[]'::jsonb, 'paused', false);
  end if;
  select * into pa from public.provider_payout_accounts where provider_id = p_provider_id;

  -- Payout beneficiary (either rail)
  if p.kyc_status = 'verified' then
    null;
  elsif pa.provider_id is not null and pa.last_error = 'gateway_unavailable' then
    v_reasons := v_reasons || jsonb_build_object('code', 'payout_unavailable', 'severity', 'wait');
  elsif pa.provider_id is null or (pa.razorpay_account_id is null and pa.fund_account_id is null) then
    v_reasons := v_reasons || jsonb_build_object('code', 'payout_missing', 'severity', 'action',
                                                 'detail', case when pa.last_error is not null then pa.last_error end);
  elsif p.kyc_status = 'needs_clarification' then
    v_reasons := v_reasons || jsonb_build_object('code', 'payout_needs_clarification', 'severity', 'action',
                                                 'detail', p.kyc_reason, 'requirements', p.kyc_requirements);
  elsif p.kyc_status = 'rejected' then
    v_reasons := v_reasons || jsonb_build_object('code', 'payout_rejected', 'severity', 'action', 'detail', p.kyc_reason);
  elsif p.kyc_status = 'suspended' then
    v_reasons := v_reasons || jsonb_build_object('code', 'payout_suspended', 'severity', 'action', 'detail', p.kyc_reason);
  else
    v_reasons := v_reasons || jsonb_build_object('code', 'payout_pending', 'severity', 'wait');
  end if;

  -- Required documents per active service category
  for r in
    select distinct d.doc_type, c.id as category_id, c.name as category_name,
           (select pd.status from public.provider_documents pd
             where pd.provider_id = p.id and pd.doc_type = d.doc_type and (pd.category_id is null or pd.category_id = c.id)
               and pd.status <> 'superseded'
             order by pd.created_at desc limit 1) as latest_status,
           (select pd.reject_reason from public.provider_documents pd
             where pd.provider_id = p.id and pd.doc_type = d.doc_type and (pd.category_id is null or pd.category_id = c.id)
               and pd.status <> 'superseded'
             order by pd.created_at desc limit 1) as latest_reason
      from public.provider_services s
      join public.categories c on c.id = s.category_id
      cross join lateral unnest(c.requires_docs) as d(doc_type)
     where s.provider_id = p.id and s.active
  loop
    if public._category_docs_ok(p.id, r.category_id) then
      continue;
    elsif r.latest_status is null then
      v_reasons := v_reasons || jsonb_build_object('code', 'doc_missing', 'severity', 'action', 'doc_type', r.doc_type, 'category', r.category_name);
    elsif r.latest_status = 'pending' then
      v_reasons := v_reasons || jsonb_build_object('code', 'doc_pending', 'severity', 'wait', 'doc_type', r.doc_type, 'category', r.category_name);
    elsif r.latest_status = 'rejected' then
      v_reasons := v_reasons || jsonb_build_object('code', 'doc_rejected', 'severity', 'action', 'doc_type', r.doc_type,
                                                   'category', r.category_name, 'detail', r.latest_reason);
    else
      v_reasons := v_reasons || jsonb_build_object('code', 'doc_expired', 'severity', 'action', 'doc_type', r.doc_type, 'category', r.category_name);
    end if;
  end loop;

  if not exists (select 1 from public.provider_services s where s.provider_id = p.id and s.active) then
    v_reasons := v_reasons || jsonb_build_object('code', 'no_active_service', 'severity', 'action');
  end if;
  if p.review_note is not null then
    v_reasons := v_reasons || jsonb_build_object('code', 'admin_note', 'severity', 'action', 'detail', p.review_note);
  end if;

  v_state := case
    when p.deactivated_at is not null then 'deactivated'
    when p.suspended then 'suspended'
    when p.submitted_at is null then 'draft'
    when public._provider_is_live(p.id) then 'live'
    when exists (select 1 from jsonb_array_elements(v_reasons) x where x ->> 'severity' = 'action') then 'action_needed'
    else 'under_review'
  end;
  return jsonb_build_object('state', v_state, 'reasons', v_reasons, 'paused', p.paused,
                            'live', public._provider_is_live(p.id), 'submitted_at', p.submitted_at);
end;
$$;

-- Validates specialisations against category_skills and normalises brand/tool tags on every provider_services write.
create or replace function public._validate_provider_service()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.specialisations := array(select distinct x from unnest(coalesce(new.specialisations, '{}')) x where x <> '' order by x);
  new.brands := array(select distinct trim(x) from unnest(coalesce(new.brands, '{}')) x where trim(x) <> '' order by trim(x));
  new.tools := array(select distinct trim(x) from unnest(coalesce(new.tools, '{}')) x where trim(x) <> '' order by trim(x));
  perform public._assert(cardinality(new.specialisations) <= 20, 'at most 20 specialisations');
  perform public._assert(cardinality(new.brands) <= 15 and cardinality(new.tools) <= 15, 'at most 15 brands and 15 tools');
  perform public._assert(not exists (select 1 from unnest(new.brands || new.tools) x where char_length(x) > 40), 'tag too long (max 40 characters)');
  perform public._assert(not exists (
    select 1 from unnest(new.specialisations) s
     where not exists (select 1 from public.category_skills k
                        where k.category_id = new.category_id and k.kind = 'skill' and k.slug = s and k.active)
  ), 'unknown specialisation for this category');
  return new;
end;
$$;
create trigger provider_services_validate
  before insert or update of specialisations, brands, tools, category_id on public.provider_services
  for each row execute function public._validate_provider_service();

-- ---------------------------------------------------------------------------
-- Provider self-service RPCs
-- ---------------------------------------------------------------------------
create or replace function public.save_provider_basics(
  p_full_name text, p_avatar_url text, p_gender text, p_languages text[], p_years_experience int, p_bio text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(char_length(trim(coalesce(p_full_name, ''))) between 2 and 60, 'name must be 2 to 60 characters');
  perform public._assert(char_length(coalesce(p_bio, '')) <= 500, 'bio must be at most 500 characters');
  perform public._assert(coalesce(p_years_experience, 0) between 0 and 60, 'experience must be 0 to 60 years');
  perform public._assert(cardinality(coalesce(p_languages, '{}')) <= 10
                         and not exists (select 1 from unnest(coalesce(p_languages, '{}')) l where char_length(l) not between 2 and 30),
                         'invalid languages');
  perform public._assert(p_gender is null or p_gender in ('female', 'male', 'non_binary', 'prefer_not_to_say'), 'invalid gender');
  perform public._assert(p_avatar_url is null or p_avatar_url like '%/storage/v1/object/public/avatars/' || v_uid::text || '/%',
                         'photo must be uploaded to your avatars folder');

  update public.profiles
     set full_name = trim(p_full_name), role_provider = true, avatar_url = coalesce(p_avatar_url, avatar_url)
   where id = v_uid;
  insert into public.providers (id, bio, city, years_experience, languages, gender, onboarding_step)
  values (v_uid, trim(coalesce(p_bio, '')), '', coalesce(p_years_experience, 0), coalesce(p_languages, '{}'), p_gender, 1)
  on conflict (id) do update
     set bio = excluded.bio,
         years_experience = excluded.years_experience,
         languages = excluded.languages,
         gender = excluded.gender,
         onboarding_step = greatest(public.providers.onboarding_step, 1);
end;
$$;

create or replace function public.save_provider_service_area(
  p_city text, p_lat double precision, p_lng double precision, p_radius_km int, p_area_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(char_length(trim(coalesce(p_city, ''))) between 2 and 60, 'city is required');
  perform public._assert(p_lat between -90 and 90 and p_lng between -180 and 180, 'set your base location');
  perform public._assert(coalesce(p_radius_km, 0) between 1 and 50, 'radius must be 1 to 50 km');
  update public.providers
     set city = trim(p_city),
         base_location = extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
         service_radius_km = p_radius_km,
         base_area = nullif(left(trim(coalesce(p_area_name, '')), 80), ''),
         onboarding_step = greatest(onboarding_step, 3)
   where id = v_uid;
  perform public._assert(found, 'create your provider profile first');
end;
$$;

create or replace function public.set_provider_onboarding_step(p_step int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  update public.providers set onboarding_step = greatest(onboarding_step, least(greatest(coalesce(p_step, 0), 0), 7)) where id = v_uid;
end;
$$;

-- Replaces the weekly schedule. p_slots: [{"weekday":1,"start":"09:00","end":"19:00"}, ...]; "24:00" allowed as end.
create or replace function public.set_provider_availability(p_slots jsonb, p_max_jobs_per_day int default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_bad int;
begin
  perform public._assert(exists (select 1 from public.providers where id = v_uid), 'create your provider profile first');
  perform public._assert(jsonb_typeof(p_slots) = 'array' and jsonb_array_length(p_slots) between 1 and 28,
                         'add at least one working-hours slot');
  perform public._assert(p_max_jobs_per_day is null or p_max_jobs_per_day between 1 and 30, 'max jobs per day must be 1 to 30');
  perform public._assert(not exists (
    select 1 from jsonb_array_elements(p_slots) e
     where coalesce(e ->> 'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or coalesce(e ->> 'end', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
        or coalesce(e ->> 'weekday', '') !~ '^[0-6]$'
  ), 'invalid slot format');

  -- Slots parsed once; "24:00" end parses to time '24:00:00'.
  perform public._assert(not exists (
    with s as (select (e ->> 'weekday')::smallint as wd, (e ->> 'start')::time as st, (e ->> 'end')::time as en
                 from jsonb_array_elements(p_slots) e)
    select 1 from s where en <= st or en - st < interval '1 hour'
  ), 'each slot must be at least 1 hour long');
  perform public._assert(not exists (
    select 1 from jsonb_array_elements(p_slots) e group by e ->> 'weekday' having count(*) > 4
  ), 'at most 4 slots per day');
  with s as (select row_number() over () as n, (e ->> 'weekday')::smallint as wd, (e ->> 'start')::time as st,
                    (e ->> 'end')::time as en
               from jsonb_array_elements(p_slots) e)
  select count(*) into v_bad from s a join s b on a.wd = b.wd and a.n < b.n and a.st < b.en and b.st < a.en;
  perform public._assert(v_bad = 0, 'slots on the same day overlap');

  delete from public.provider_availability where provider_id = v_uid;
  insert into public.provider_availability (provider_id, weekday, start_time, end_time)
  select v_uid, (e ->> 'weekday')::smallint, (e ->> 'start')::time, (e ->> 'end')::time from jsonb_array_elements(p_slots) e;
  update public.providers set max_jobs_per_day = p_max_jobs_per_day, onboarding_step = greatest(onboarding_step, 4) where id = v_uid;
end;
$$;

-- Time off for whole days [p_from, p_to] in the provider's timezone.
create or replace function public.add_provider_time_off(p_from date, p_to date, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_tz text;
  v_id uuid;
begin
  select timezone into v_tz from public.providers where id = v_uid;
  perform public._assert(v_tz is not null, 'create your provider profile first');
  perform public._assert(p_from is not null and p_to is not null and p_to >= p_from, 'end date must be on or after start date');
  perform public._assert(p_to >= public._provider_local_date(v_uid, now()), 'dates are in the past');
  perform public._assert(p_to - p_from <= 90 and p_from <= public._provider_local_date(v_uid, now()) + 365,
                         'time off can be at most 90 days, within the next year');
  perform public._assert((select count(*) from public.provider_time_off where provider_id = v_uid and upper(period) > now()) < 20,
                         'too many upcoming time-off entries');
  insert into public.provider_time_off (provider_id, period, reason)
  values (v_uid, tstzrange(p_from::timestamp at time zone v_tz, (p_to + 1)::timestamp at time zone v_tz, '[)'),
          nullif(left(trim(coalesce(p_reason, '')), 120), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_provider_time_off(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  delete from public.provider_time_off where id = p_id and provider_id = v_uid;
  perform public._assert(found, 'time off not found');
end;
$$;

create or replace function public.set_provider_paused(p_paused boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  update public.providers
     set paused = coalesce(p_paused, false), is_online = case when coalesce(p_paused, false) then false else is_online end
   where id = v_uid;
  perform public._assert(found, 'provider profile not found');
  perform public._log_onboarding_event(v_uid, case when p_paused then 'paused' else 'resumed' end);
end;
$$;

create or replace function public.deactivate_provider_account(p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(not exists (
    select 1 from public.bookings b where b.provider_id = v_uid
       and b.status in ('requested', 'accepted', 'en_route', 'inspecting', 'quote_sent', 'awaiting_payment',
                        'in_progress', 'completion_requested', 'disputed')), 'finish or cancel your active jobs first');
  update public.providers set deactivated_at = now(), paused = true, is_online = false where id = v_uid;
  perform public._assert(found, 'provider profile not found');
  perform public._log_onboarding_event(v_uid, 'deactivated', jsonb_build_object('reason', left(coalesce(p_reason, ''), 300)));
end;
$$;

create or replace function public.reactivate_provider_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  update public.providers set deactivated_at = null, paused = false where id = v_uid and deactivated_at is not null;
  perform public._assert(found, 'account is not deactivated');
  perform public._log_onboarding_event(v_uid, 'reactivated');
end;
$$;

create or replace function public.add_portfolio_photo(p_file_path text, p_caption text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_id uuid;
begin
  perform public._assert(exists (select 1 from public.providers where id = v_uid), 'create your provider profile first');
  perform public._assert(p_file_path like v_uid::text || '/%' and p_file_path not like '%..%', 'invalid photo path');
  perform public._assert(exists (select 1 from storage.objects o where o.bucket_id = 'portfolio' and o.name = p_file_path),
                         'photo upload not found');
  perform public._assert((select count(*) from public.provider_portfolio where provider_id = v_uid) < 12, 'at most 12 work photos');
  perform public._assert(char_length(coalesce(p_caption, '')) <= 140, 'caption must be at most 140 characters');
  insert into public.provider_portfolio (provider_id, file_path, caption, sort_order)
  values (v_uid, p_file_path, trim(coalesce(p_caption, '')),
          coalesce((select max(sort_order) + 1 from public.provider_portfolio where provider_id = v_uid), 0))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_portfolio_caption(p_id uuid, p_caption text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(char_length(coalesce(p_caption, '')) <= 140, 'caption must be at most 140 characters');
  update public.provider_portfolio set caption = trim(coalesce(p_caption, '')) where id = p_id and provider_id = v_uid;
  perform public._assert(found, 'photo not found');
end;
$$;

create or replace function public.delete_portfolio_photo(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_path text;
begin
  delete from public.provider_portfolio where id = p_id and provider_id = v_uid returning file_path into v_path;
  perform public._assert(v_path is not null, 'photo not found');
  return v_path;
end;
$$;

create or replace function public.submit_provider_document(
  p_doc_type text, p_file_path text, p_category_id uuid default null, p_expires_on date default null
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
  perform public._assert(exists (select 1 from public.providers where id = v_uid), 'create your provider profile first');
  perform public._assert(exists (select 1 from public.document_types where code = p_doc_type), 'unknown document type');
  perform public._assert(p_file_path like v_uid::text || '/%' and p_file_path not like '%..%', 'invalid document path');
  perform public._assert(exists (select 1 from storage.objects o where o.bucket_id = 'provider-docs' and o.name = p_file_path),
                         'document upload not found');
  perform public._assert(p_expires_on is null or p_expires_on > public._provider_local_date(v_uid, now()), 'document has expired');
  perform public._assert(p_category_id is null or exists (select 1 from public.categories where id = p_category_id), 'unknown category');
  update public.provider_documents
     set status = 'superseded'
   where provider_id = v_uid and doc_type = p_doc_type and category_id is not distinct from p_category_id and status = 'pending';
  insert into public.provider_documents (provider_id, doc_type, category_id, file_path, expires_on)
  values (v_uid, p_doc_type, p_category_id, p_file_path, p_expires_on)
  returning id into v_id;
  perform public._log_onboarding_event(v_uid, 'document_submitted', jsonb_build_object('doc_type', p_doc_type));
  return v_id;
end;
$$;

-- Records the provider agreement and submits the profile. Server re-checks every required item.
create or replace function public.submit_provider_profile(p_terms_version text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_missing text;
begin
  perform public._assert(exists (select 1 from public.providers where id = v_uid), 'create your provider profile first');
  perform public._assert(p_terms_version = public._provider_terms_version(), 'please accept the latest provider agreement');
  select string_agg(c ->> 'key', ', ') into v_missing
    from jsonb_array_elements(public._provider_onboarding_checks(v_uid)) c
   where (c ->> 'required')::boolean and not (c ->> 'ok')::boolean;
  perform public._assert(v_missing is null, 'profile incomplete: ' || coalesce(v_missing, ''));
  update public.providers
     set submitted_at = coalesce(submitted_at, now()), terms_version = p_terms_version, terms_accepted_at = now(),
         onboarding_step = 7
   where id = v_uid;
  perform public._log_onboarding_event(v_uid, 'submitted', jsonb_build_object('terms_version', p_terms_version));
  return public._provider_go_live(v_uid);
end;
$$;

-- Own provider row (all columns the owner may see, including base location), replacing select('*').
create or replace function public.get_my_provider()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(p) - 'base_location' - 'kyc_reference'
         || jsonb_build_object(
              'lat', case when p.base_location is not null then extensions.st_y(p.base_location::extensions.geometry) end,
              'lng', case when p.base_location is not null then extensions.st_x(p.base_location::extensions.geometry) end)
    from public.providers p
   where p.id = auth.uid();
$$;

create or replace function public.get_my_provider_onboarding()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  if not exists (select 1 from public.providers where id = v_uid) then
    return jsonb_build_object('provider', null, 'terms_version', public._provider_terms_version(),
                              'go_live', jsonb_build_object('state', 'draft', 'reasons', '[]'::jsonb, 'paused', false));
  end if;
  return jsonb_build_object(
    'provider', public.get_my_provider(),
    'profile', (select jsonb_build_object('full_name', full_name, 'avatar_url', avatar_url) from public.profiles where id = v_uid),
    'payout', (select to_jsonb(pa) - 'email' || jsonb_build_object('has_email', pa.email is not null)
                 from public.provider_payout_accounts pa where pa.provider_id = v_uid),
    'documents', coalesce((select jsonb_agg(to_jsonb(d) - 'reviewed_by' order by d.created_at desc)
                             from public.provider_documents d where d.provider_id = v_uid and d.status <> 'superseded'), '[]'::jsonb),
    'availability', coalesce((select jsonb_agg(jsonb_build_object('weekday', a.weekday, 'start', to_char(a.start_time, 'HH24:MI'),
                                                                  'end', to_char(a.end_time, 'HH24:MI')) order by a.weekday, a.start_time)
                                from public.provider_availability a where a.provider_id = v_uid), '[]'::jsonb),
    'time_off', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'from', lower(t.period), 'to', upper(t.period), 'reason', t.reason)
                                           order by lower(t.period))
                            from public.provider_time_off t where t.provider_id = v_uid and upper(t.period) > now()), '[]'::jsonb),
    'portfolio', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'file_path', x.file_path, 'caption', x.caption) order by x.sort_order)
                             from public.provider_portfolio x where x.provider_id = v_uid), '[]'::jsonb),
    'checks', public._provider_onboarding_checks(v_uid),
    'go_live', public._provider_go_live(v_uid),
    'terms_version', public._provider_terms_version()
  );
end;
$$;

-- Local market price guidance from real data only: live providers' fees in the same city (excluding the caller)
-- plus completed jobs' visit fees. Returns null stats when fewer than 5 data points.
create or replace function public.get_local_price_guidance(p_category_id uuid, p_city text, p_rate_unit public.rate_unit default 'job')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_visit jsonb;
  v_labour jsonb;
begin
  with pts as (
    select ps.visit_fee::numeric as v
      from public.provider_services ps join public.providers pr on pr.id = ps.provider_id
     where ps.category_id = p_category_id and ps.active and pr.id <> v_uid
       and lower(trim(pr.city)) = lower(trim(coalesce(p_city, ''))) and public._provider_is_live(pr.id)
    union all
    select b.visit_fee::numeric
      from public.bookings b join public.addresses a on a.id = b.address_id
     where b.category_id = p_category_id and b.status in ('completed', 'closed') and b.provider_id <> v_uid
       and lower(trim(a.city)) = lower(trim(coalesce(p_city, '')))
  )
  select case when count(*) >= 5 then jsonb_build_object(
           'n', count(*),
           'p25', round(percentile_cont(0.25) within group (order by v) / 100) * 100,
           'median', round(percentile_cont(0.5) within group (order by v) / 100) * 100,
           'p75', round(percentile_cont(0.75) within group (order by v) / 100) * 100) end
    into v_visit from pts;

  with pts as (
    select ps.labour_rate::numeric as v
      from public.provider_services ps join public.providers pr on pr.id = ps.provider_id
     where ps.category_id = p_category_id and ps.active and ps.rate_unit = p_rate_unit and pr.id <> v_uid
       and lower(trim(pr.city)) = lower(trim(coalesce(p_city, ''))) and public._provider_is_live(pr.id)
  )
  select case when count(*) >= 5 then jsonb_build_object(
           'n', count(*),
           'p25', round(percentile_cont(0.25) within group (order by v) / 100) * 100,
           'median', round(percentile_cont(0.5) within group (order by v) / 100) * 100,
           'p75', round(percentile_cont(0.75) within group (order by v) / 100) * 100) end
    into v_labour from pts;

  return jsonb_build_object('visit_fee', v_visit, 'labour_rate', v_labour, 'min_points', 5);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public (customer-facing) reads
-- ---------------------------------------------------------------------------
-- Weekly hours, upcoming leave and fully booked days for the slot picker. Never exposes reasons or exact location.
create or replace function public.get_provider_availability(p_provider_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.providers;
  v_today date;
begin
  select * into p from public.providers where id = p_provider_id;
  if not found or not (public._provider_is_live(p_provider_id) or p_provider_id = auth.uid()) then
    return null;
  end if;
  v_today := public._provider_local_date(p_provider_id, now());
  return jsonb_build_object(
    'timezone', p.timezone,
    'paused', p.paused,
    'max_jobs_per_day', p.max_jobs_per_day,
    'slots', coalesce((select jsonb_agg(jsonb_build_object('weekday', a.weekday, 'start', to_char(a.start_time, 'HH24:MI'),
                                                           'end', to_char(a.end_time, 'HH24:MI')) order by a.weekday, a.start_time)
                         from public.provider_availability a where a.provider_id = p_provider_id), '[]'::jsonb),
    'time_off', coalesce((select jsonb_agg(jsonb_build_object('from', lower(t.period), 'to', upper(t.period)) order by lower(t.period))
                            from public.provider_time_off t
                           where t.provider_id = p_provider_id and upper(t.period) > now() and lower(t.period) < now() + interval '60 days'),
                         '[]'::jsonb),
    'full_days', coalesce((select jsonb_agg(d::date order by d)
                             from generate_series(v_today, v_today + 13, interval '1 day') d
                            where p.max_jobs_per_day is not null
                              and (select count(*) from public.bookings b
                                    where b.provider_id = p_provider_id
                                      and (coalesce(b.scheduled_at, b.created_at) at time zone p.timezone)::date = d::date
                                      and (b.status not in ('pending_payment', 'declined', 'expired', 'cancelled', 'refunded', 'closed_no_work')
                                           or (b.status = 'pending_payment' and b.created_at > now() - interval '30 minutes')))
                                  >= p.max_jobs_per_day), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_provider_public_profile(p_provider_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.providers;
  v_today date;
begin
  select * into p from public.providers where id = p_provider_id;
  if not found or not (public._provider_is_live(p_provider_id) or p_provider_id = auth.uid()) then
    return null;
  end if;
  v_today := public._provider_local_date(p_provider_id, now());
  return jsonb_build_object(
    'id', p.id,
    'base_area', p.base_area,
    'city', p.city,
    'service_radius_km', p.service_radius_km,
    'paused', p.paused,
    'live', public._provider_is_live(p.id),
    'member_since', p.created_at,
    'badges', jsonb_build_object(
      -- Razorpay Route verifies the holder's PAN (stakeholder KYC) before activating a linked account (acc_…). The
      -- RazorpayX payouts rail only validates the bank account holder name, so it earns the payout badge, not the ID badge.
      'id_verified', p.kyc_status = 'verified' and coalesce(p.razorpay_account_id, '') like 'acc\_%',
      'payout_verified', p.kyc_status = 'verified',
      'police_verified', exists (select 1 from public.provider_documents d where d.provider_id = p.id and d.doc_type = 'police_verification'
                                  and d.status = 'approved' and (d.expires_on is null or d.expires_on >= v_today))),
    'credentials', coalesce((select jsonb_agg(distinct dt.label) from public.provider_documents d join public.document_types dt on dt.code = d.doc_type
                              where d.provider_id = p.id and d.status = 'approved' and (d.expires_on is null or d.expires_on >= v_today)),
                            '[]'::jsonb),
    'specialisations', coalesce((select jsonb_agg(jsonb_build_object('category_id', s.category_id, 'labels',
                                         (select coalesce(jsonb_agg(k.label order by k.sort_order), '[]'::jsonb) from public.category_skills k
                                           where k.category_id = s.category_id and k.kind = 'skill' and k.slug = any (s.specialisations)),
                                         'brands', to_jsonb(s.brands)))
                                   from public.provider_services s where s.provider_id = p.id and s.active), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', a.weekday, 'start', to_char(a.start_time, 'HH24:MI'),
                                                           'end', to_char(a.end_time, 'HH24:MI')) order by a.weekday, a.start_time)
                         from public.provider_availability a where a.provider_id = p.id), '[]'::jsonb),
    'on_leave_until', (select max(upper(t.period)) from public.provider_time_off t where t.provider_id = p.id and t.period @> now()),
    'portfolio', coalesce((select jsonb_agg(jsonb_build_object('file_path', x.file_path, 'caption', x.caption) order by x.sort_order)
                             from public.provider_portfolio x where x.provider_id = p.id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Payout status sync (service role; called by razorpay-webhook and provider-payout-account)
-- ---------------------------------------------------------------------------
create or replace function public._map_gateway_status(p_status text)
returns public.kyc_status
language sql
immutable
as $$
  select case p_status
           when 'activated' then 'verified'::public.kyc_status
           when 'under_review' then 'under_review'::public.kyc_status
           when 'needs_clarification' then 'needs_clarification'::public.kyc_status
           when 'suspended' then 'suspended'::public.kyc_status
           when 'rejected' then 'rejected'::public.kyc_status
           else 'pending'::public.kyc_status
         end;
$$;

create or replace function public.sync_provider_payout_status(
  p_account_id text, p_status text, p_requirements jsonb default '[]'::jsonb, p_event_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid;
  -- text, not the enum: a schema-qualified type in a multi-item INTO is parsed as a record by plpgsql tooling.
  v_old text;
  v_new public.kyc_status := public._map_gateway_status(p_status);
  v_seen timestamptz;
  v_reqs jsonb;
  v_reason text;
begin
  select provider_id into v_provider from public.provider_payout_accounts
   where razorpay_account_id = p_account_id or fund_account_id = p_account_id;
  if v_provider is null then
    select id into v_provider from public.providers where razorpay_account_id = p_account_id;
  end if;
  if v_provider is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_account');
  end if;
  select kyc_status::text, kyc_updated_at into v_old, v_seen from public.providers where id = v_provider for update;
  if v_seen is not null and p_event_at < v_seen then
    return jsonb_build_object('ok', true, 'stale', true, 'provider_id', v_provider, 'kyc_status', v_old);
  end if;

  -- Keep only non-sensitive requirement fields.
  select coalesce(jsonb_agg(jsonb_build_object('field_reference', left(r ->> 'field_reference', 80),
                                               'reason_code', left(r ->> 'reason_code', 40),
                                               'description', left(r ->> 'description', 200))), '[]'::jsonb),
         (array_agg(left(r ->> 'description', 200)) filter (where r ->> 'description' is not null))[1]
    into v_reqs, v_reason
    from jsonb_array_elements(case when jsonb_typeof(p_requirements) = 'array' then p_requirements else '[]'::jsonb end) r;

  -- p_account_id is a Route linked account (acc_...) or a RazorpayX fund account (fa_...); only the former is the
  -- Route transfer destination stored on providers.
  update public.providers
     set kyc_status = v_new,
         razorpay_account_id = case when p_account_id like 'acc\_%' then p_account_id else razorpay_account_id end,
         kyc_reference = p_account_id,
         kyc_requirements = v_reqs,
         kyc_reason = case when v_new = 'verified' then null else v_reason end,
         kyc_updated_at = p_event_at
   where id = v_provider;
  update public.provider_payout_accounts
     set activation_status = coalesce(p_status, activation_status), requirements = v_reqs, updated_at = now(),
         last_error = case when v_new = 'verified' then null else last_error end
   where provider_id = v_provider;
  if v_old is distinct from v_new::text then
    perform public._log_onboarding_event(v_provider, 'payout_status_changed',
                                         jsonb_build_object('from', v_old, 'to', v_new, 'gateway_status', p_status));
  end if;
  return jsonb_build_object('ok', true, 'provider_id', v_provider, 'kyc_status', v_new, 'changed', v_old is distinct from v_new::text);
end;
$$;

-- Legacy entry point kept (same signature); now understands the new states.
create or replace function public.sync_provider_kyc(p_provider_id uuid, p_account_id text, p_gateway_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.providers
     set razorpay_account_id = p_account_id,
         kyc_reference = p_account_id,
         kyc_status = public._map_gateway_status(p_gateway_status),
         kyc_updated_at = now()
   where id = p_provider_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin review (audited)
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_document_queue(p_limit int default 100)
returns table (document_id uuid, provider_id uuid, provider_name text, doc_type text, category_id uuid,
               file_path text, expires_on date, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return query
    select d.id, d.provider_id, pf.full_name, d.doc_type, d.category_id, d.file_path, d.expires_on, d.created_at
      from public.provider_documents d join public.profiles pf on pf.id = d.provider_id
     where d.status = 'pending'
     order by d.created_at
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

create or replace function public.admin_review_document(p_document_id uuid, p_approve boolean, p_reason text default null,
                                                        p_expires_on date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._require_uid();
  d public.provider_documents;
  v_has_expiry boolean;
begin
  perform public._assert(public._is_admin(), 'admin only');
  select * into d from public.provider_documents where id = p_document_id for update;
  perform public._assert(found, 'document not found');
  perform public._assert(d.status = 'pending', 'document is not pending review');
  select has_expiry into v_has_expiry from public.document_types where code = d.doc_type;
  if p_approve then
    perform public._assert(not v_has_expiry or coalesce(p_expires_on, d.expires_on) is not null, 'expiry date is required for this document');
    perform public._assert(coalesce(p_expires_on, d.expires_on) is null or coalesce(p_expires_on, d.expires_on) > current_date, 'document has expired');
  else
    perform public._assert(char_length(trim(coalesce(p_reason, ''))) >= 5, 'give the provider a reason');
  end if;
  update public.provider_documents
     set status = case when p_approve then 'approved' else 'rejected' end,
         reject_reason = case when p_approve then null else left(trim(p_reason), 300) end,
         expires_on = coalesce(p_expires_on, expires_on),
         reviewed_by = v_admin, reviewed_at = now()
   where id = p_document_id;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_admin, case when p_approve then 'approve_document' else 'reject_document' end, d.provider_id,
          jsonb_build_object('document_id', d.id, 'doc_type', d.doc_type, 'reason', p_reason, 'expires_on', coalesce(p_expires_on, d.expires_on)));
  perform public._log_onboarding_event(d.provider_id, 'document_reviewed',
                                       jsonb_build_object('doc_type', d.doc_type, 'approved', p_approve, 'reason', p_reason));
end;
$$;

-- "Action needed" note shown to the provider (null clears it).
create or replace function public.admin_set_provider_review_note(p_provider_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._require_uid();
begin
  perform public._assert(public._is_admin(), 'admin only');
  update public.providers set review_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = p_provider_id;
  perform public._assert(found, 'provider not found');
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_admin, 'set_review_note', p_provider_id, jsonb_build_object('note', p_note));
  perform public._log_onboarding_event(p_provider_id, 'review_note', jsonb_build_object('note', p_note));
end;
$$;

-- ---------------------------------------------------------------------------
-- Search + booking now use the shared go-live rule and availability
-- ---------------------------------------------------------------------------
create or replace function public.search_providers(
  p_category_slug text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_sort text default 'recommended',
  p_min_rating numeric default null,
  p_skill_level public.skill_level default null,
  p_max_visit_fee int default null,
  p_online_only boolean default false,
  p_limit int default 50
)
returns table (
  provider_id uuid,
  provider_service_id uuid,
  full_name text,
  avatar_url text,
  city text,
  skill_level public.skill_level,
  visit_fee int,
  labour_rate int,
  rate_unit public.rate_unit,
  rating_avg numeric,
  rating_count int,
  jobs_completed int,
  years_experience int,
  is_online boolean,
  distance_km double precision,
  score double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with origin as (
    select case when p_lat is not null and p_lng is not null
                then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
           end as g
  ),
  city_avg as (
    select p.city, avg(r.rating)::numeric as m
      from public.reviews r join public.providers p on p.id = r.provider_id
     group by p.city
  ),
  stats as (
    select b.provider_id,
           count(*) filter (where b.status in ('completed', 'closed'))::numeric as done,
           count(*) filter (where b.accepted_at is not null)::numeric as accepted,
           avg(extract(epoch from (b.accepted_at - b.created_at)) / 60.0)
             filter (where b.accepted_at is not null) as avg_response_min
      from public.bookings b
     group by b.provider_id
  ),
  base as (
    select pr.id as provider_id,
           ps.id as provider_service_id,
           pf.full_name,
           pf.avatar_url,
           pr.city,
           ps.skill_level,
           ps.visit_fee,
           ps.labour_rate,
           ps.rate_unit,
           pr.rating_avg,
           pr.rating_count,
           pr.jobs_completed,
           pr.years_experience,
           (pr.is_online and not exists (select 1 from public.provider_time_off t
                                          where t.provider_id = pr.id and t.period @> now())) as is_online,
           case when o.g is not null and pr.base_location is not null
                then extensions.st_distance(pr.base_location, o.g) / 1000.0 end as distance_km,
           ((10 * coalesce(ca.m, 4.0) + pr.rating_avg * pr.rating_count) / (10 + pr.rating_count))::double precision as bayes,
           coalesce(s.done / nullif(s.accepted, 0), 0.8)::double precision as completion_rate,
           (case when s.avg_response_min is null then 0.5
                 else 1 - least(s.avg_response_min, 15) / 15.0 end)::double precision as response_speed
      from public.provider_services ps
      join public.categories c on c.id = ps.category_id and c.slug = p_category_slug and c.active
      join public.providers pr on pr.id = ps.provider_id
      join public.profiles pf on pf.id = pr.id
      cross join origin o
      left join city_avg ca on ca.city = pr.city
      left join stats s on s.provider_id = pr.id
     where public._provider_is_live(pr.id)
       and not pr.paused
       and public._category_docs_ok(pr.id, ps.category_id)
       and pr.id is distinct from auth.uid()
       and ps.active
       and (o.g is null or pr.base_location is null
            or extensions.st_dwithin(pr.base_location, o.g, pr.service_radius_km * 1000.0))
       and (p_min_rating is null or pr.rating_avg >= p_min_rating)
       and (p_skill_level is null or ps.skill_level = p_skill_level)
       and (p_max_visit_fee is null or ps.visit_fee <= p_max_visit_fee)
  ),
  filtered as (
    select * from base b where (not coalesce(p_online_only, false) or b.is_online)
  ),
  scored as (
    select b.*,
           0.60 * greatest(least((b.bayes - 1) / 4.0, 1), 0)
         + 0.15 * b.completion_rate
         + 0.15 * (case when b.distance_km is null then 0.5
                        else 1 - b.distance_km / greatest(max(b.distance_km) over (), 1) end)
         + 0.10 * b.response_speed as score
      from filtered b
  )
  select s.provider_id, s.provider_service_id, s.full_name, s.avatar_url, s.city, s.skill_level,
         s.visit_fee, s.labour_rate, s.rate_unit, s.rating_avg, s.rating_count, s.jobs_completed,
         s.years_experience, s.is_online, s.distance_km, s.score
    from scored s
   order by
     case when p_sort = 'rating' then s.rating_avg end desc nulls last,
     case when p_sort = 'rating' then s.rating_count end desc nulls last,
     case when p_sort = 'price' then s.visit_fee end asc nulls last,
     case when p_sort = 'distance' then s.distance_km end asc nulls last,
     case when p_sort = 'experience' then s.years_experience end desc nulls last,
     s.score desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.create_booking(
  p_provider_service_id uuid,
  p_description text,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision,
  p_scheduled_at timestamptz default null,
  p_photos text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_ps record;
  v_address uuid;
  v_booking uuid;
  v_problem text;
  c_platform_fee constant int := 2900;
begin
  select ps.id, ps.provider_id, ps.category_id, ps.visit_fee
    into v_ps
    from public.provider_services ps
    join public.providers pr on pr.id = ps.provider_id
   where ps.id = p_provider_service_id and ps.active
     and public._provider_is_live(pr.id) and not pr.paused and public._category_docs_ok(pr.id, ps.category_id);
  perform public._assert(found, 'service not available');
  perform public._assert(v_ps.provider_id <> v_uid, 'cannot book yourself');
  perform public._assert(coalesce(trim(p_address_line), '') <> '' and coalesce(trim(p_city), '') <> '', 'address is required');
  perform public._assert(p_lat is not null and p_lng is not null, 'location is required');
  perform public._assert(p_scheduled_at is null or p_scheduled_at > now() - interval '5 minutes', 'scheduled time is in the past');
  perform public._assert(coalesce(array_length(p_photos, 1), 0) <= 4, 'at most 4 photos');
  perform public._assert(not exists (select 1 from unnest(coalesce(p_photos, '{}')) ph
                                      where ph not like v_uid::text || '/%'), 'invalid photo path');

  -- Serialise bookings per provider so the max-jobs-per-day check cannot race (doc 07 §3.9 advisory lock).
  perform pg_advisory_xact_lock(hashtext(v_ps.provider_id::text));
  v_problem := public._provider_slot_problem(v_ps.provider_id, coalesce(p_scheduled_at, now()), p_scheduled_at is null);
  perform public._assert(v_problem is null,
    case v_problem
      when 'provider_on_leave' then 'provider_unavailable: the provider is on leave at that time'
      when 'outside_working_hours' then 'provider_unavailable: that time is outside the provider''s working hours'
      when 'fully_booked' then 'provider_unavailable: the provider is fully booked that day'
      else 'provider_unavailable' end);

  insert into public.addresses (user_id, label, line1, city, lat, lng)
  values (v_uid, 'Booking', trim(p_address_line), trim(p_city), p_lat, p_lng)
  returning id into v_address;

  insert into public.bookings (customer_id, provider_id, category_id, provider_service_id, address_id,
                               description, photos, scheduled_at, visit_fee, platform_fee)
  values (v_uid, v_ps.provider_id, v_ps.category_id, v_ps.id, v_address,
          coalesce(p_description, ''), coalesce(p_photos, '{}'), p_scheduled_at, v_ps.visit_fee, c_platform_fee)
  returning id into v_booking;

  insert into public.booking_secrets (booking_id, start_otp) values (v_booking, public._gen_otp());
  insert into public.booking_events (booking_id, actor_id, from_status, to_status)
  values (v_booking, v_uid, null, 'pending_payment');
  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.document_types enable row level security;
alter table public.category_skills enable row level security;
alter table public.provider_availability enable row level security;
alter table public.provider_time_off enable row level security;
alter table public.provider_portfolio enable row level security;
alter table public.provider_documents enable row level security;
alter table public.provider_payout_accounts enable row level security;
alter table public.provider_onboarding_events enable row level security;

revoke all on public.document_types, public.category_skills, public.provider_availability, public.provider_time_off,
  public.provider_portfolio, public.provider_documents, public.provider_payout_accounts, public.provider_onboarding_events
  from anon, authenticated;
grant select on public.document_types, public.category_skills, public.provider_availability, public.provider_portfolio
  to anon, authenticated;
grant select on public.provider_time_off, public.provider_documents, public.provider_payout_accounts,
  public.provider_onboarding_events to authenticated;

create policy document_types_read on public.document_types for select using (true);
create policy category_skills_read on public.category_skills for select using (active);
create policy provider_availability_read on public.provider_availability for select
  using (provider_id = auth.uid() or public._provider_is_live(provider_id));
create policy provider_portfolio_read on public.provider_portfolio for select
  using (provider_id = auth.uid() or public._provider_is_live(provider_id));
create policy provider_time_off_own on public.provider_time_off for select to authenticated
  using (provider_id = auth.uid());
create policy provider_documents_own on public.provider_documents for select to authenticated
  using (provider_id = auth.uid() or public._is_admin());
create policy provider_payout_accounts_own on public.provider_payout_accounts for select to authenticated
  using (provider_id = auth.uid() or public._is_admin());
create policy provider_onboarding_events_own on public.provider_onboarding_events for select to authenticated
  using (provider_id = auth.uid() or public._is_admin());

-- Public predicates switch from "kyc verified" to the shared go-live rule.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or public._provider_is_live(id)
  or exists (select 1 from public.bookings b
              where (b.customer_id = auth.uid() and b.provider_id = profiles.id)
                 or (b.provider_id = auth.uid() and b.customer_id = profiles.id))
);
drop policy if exists providers_read on public.providers;
create policy providers_read on public.providers for select
  using (id = auth.uid() or public._provider_is_live(id));
drop policy if exists provider_services_read on public.provider_services;
create policy provider_services_read on public.provider_services for select using (
  provider_id = auth.uid()
  or (active and public._provider_is_live(provider_id) and public._category_docs_ok(provider_id, category_id))
);
drop policy if exists rate_card_read on public.rate_card_items;
create policy rate_card_read on public.rate_card_items for select using (
  exists (select 1 from public.provider_services ps
           where ps.id = provider_service_id and (ps.provider_id = auth.uid() or public._provider_is_live(ps.provider_id)))
);

-- Column privacy: exact base location, gateway ids, gender and review internals are not readable by other users.
revoke select on public.providers from anon, authenticated;
grant select (id, bio, city, service_radius_km, years_experience, languages, kyc_status, suspended, is_online,
              rating_avg, rating_count, jobs_completed, commission_tier, created_at, paused, base_area, timezone)
  on public.providers to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: avatars (public), provider-docs (private), portfolio limits
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 2097152, '{image/jpeg,image/png,image/webp}'),
  ('provider-docs', 'provider-docs', false, 10485760, '{image/jpeg,image/png,application/pdf}')
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                              allowed_mime_types = excluded.allowed_mime_types;
update storage.buckets set file_size_limit = 5242880, allowed_mime_types = '{image/jpeg,image/png,image/webp}' where id = 'portfolio';

create policy storage_avatars_read on storage.objects for select using (bucket_id = 'avatars');
create policy storage_avatars_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy storage_avatars_delete on storage.objects for delete to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy storage_provider_docs_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'provider-docs' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy storage_provider_docs_read on storage.objects for select to authenticated using (
  bucket_id = 'provider-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public._is_admin())
);

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public._provider_terms_version(),
  public._provider_local_date(uuid, timestamptz),
  public._log_onboarding_event(uuid, text, jsonb),
  public._provider_slot_problem(uuid, timestamptz, boolean),
  public._provider_onboarding_checks(uuid),
  public._provider_go_live(uuid),
  public._validate_provider_service(),
  public._map_gateway_status(text),
  public.sync_provider_payout_status(text, text, jsonb, timestamptz)
from public, anon, authenticated;
grant execute on function public.sync_provider_payout_status(text, text, jsonb, timestamptz) to service_role;

-- Used inside RLS policies (read-only booleans), so callable by every role.
revoke execute on function public._provider_is_live(uuid), public._category_docs_ok(uuid, uuid) from public;
grant execute on function public._provider_is_live(uuid), public._category_docs_ok(uuid, uuid) to anon, authenticated, service_role;

revoke execute on function
  public.save_provider_basics(text, text, text, text[], int, text),
  public.save_provider_service_area(text, double precision, double precision, int, text),
  public.set_provider_onboarding_step(int),
  public.set_provider_availability(jsonb, int),
  public.add_provider_time_off(date, date, text),
  public.delete_provider_time_off(uuid),
  public.set_provider_paused(boolean),
  public.deactivate_provider_account(text),
  public.reactivate_provider_account(),
  public.add_portfolio_photo(text, text),
  public.update_portfolio_caption(uuid, text),
  public.delete_portfolio_photo(uuid),
  public.submit_provider_document(text, text, uuid, date),
  public.submit_provider_profile(text),
  public.get_my_provider(),
  public.get_my_provider_onboarding(),
  public.get_local_price_guidance(uuid, text, public.rate_unit),
  public.admin_list_document_queue(int),
  public.admin_review_document(uuid, boolean, text, date),
  public.admin_set_provider_review_note(uuid, text)
from public, anon;
grant execute on function
  public.save_provider_basics(text, text, text, text[], int, text),
  public.save_provider_service_area(text, double precision, double precision, int, text),
  public.set_provider_onboarding_step(int),
  public.set_provider_availability(jsonb, int),
  public.add_provider_time_off(date, date, text),
  public.delete_provider_time_off(uuid),
  public.set_provider_paused(boolean),
  public.deactivate_provider_account(text),
  public.reactivate_provider_account(),
  public.add_portfolio_photo(text, text),
  public.update_portfolio_caption(uuid, text),
  public.delete_portfolio_photo(uuid),
  public.submit_provider_document(text, text, uuid, date),
  public.submit_provider_profile(text),
  public.get_my_provider(),
  public.get_my_provider_onboarding(),
  public.get_local_price_guidance(uuid, text, public.rate_unit),
  public.admin_list_document_queue(int),
  public.admin_review_document(uuid, boolean, text, date),
  public.admin_set_provider_review_note(uuid, text)
to authenticated;

revoke execute on function public.get_provider_availability(uuid), public.get_provider_public_profile(uuid) from public;
grant execute on function public.get_provider_availability(uuid), public.get_provider_public_profile(uuid) to anon, authenticated;

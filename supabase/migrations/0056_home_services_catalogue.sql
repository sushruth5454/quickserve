-- Expanded Home Services catalogue and admin category configuration.

alter table public.categories
  add column if not exists recurrence_allowed boolean not null default false,
  add column if not exists allowed_frequencies text[] not null default '{}',
  add column if not exists recurring_discount_bp int;

alter table public.categories
  alter column archetype drop not null,
  drop constraint if exists categories_recurring_discount_bp_check,
  drop constraint if exists categories_pricing_units_check;

alter table public.categories
  add constraint categories_recurring_discount_bp_check
    check (recurring_discount_bp is null or recurring_discount_bp between 0 and 5000),
  add constraint categories_pricing_units_check
    check (
      cardinality(pricing_units) between 1 and 12
      and pricing_units <@ array[
        'job', 'hour', 'day', 'session', 'person', 'plate',
        'sqft', 'bhk', 'seat', 'litre', 'event', 'month',
        'visit', 'kg', 'piece'
      ]::text[]
    );

alter table public.service_packages
  drop constraint if exists service_packages_unit_check;

alter table public.service_packages
  add constraint service_packages_unit_check
    check (unit in (
      'job', 'hour', 'day', 'session', 'person', 'plate', 'sqft', 'bhk',
      'seat', 'litre', 'event', 'month', 'visit', 'kg', 'piece'
    ));

insert into public.categories (
  slug, name, icon, pricing_mode, sort_order, active, vertical, parent_id, archetype, pricing_units
)
values
  ('household-help', 'Household help', 'home', 'quote', 30, false, 'household-help', null, null, '{job}'),
  ('home-repairs', 'Repair & maintenance', 'build', 'quote', 40, false, 'home-repairs', null, null, '{job}'),
  ('home-other', 'Other services', 'grid', 'quote', 50, false, 'home-other', null, null, '{job}')
on conflict (slug) do nothing;

insert into public.categories (
  slug, name, icon, pricing_mode, sort_order, active, vertical, parent_id, archetype,
  pricing_units, recurrence_allowed, allowed_frequencies, restricted, requires_docs, intake_schema
)
values
  (
    'house-cleaning', 'Home cleaning', 'home', 'fixed', 1, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'fixed',
    '{visit}', true, '{daily,alternate_days,weekly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'deep-cleaning', 'Deep cleaning', 'sparkles', 'fixed', 200, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'fixed',
    '{bhk}', true, '{monthly}', false, '{}',
    '{"type":"object","properties":{"bhk":{"type":"integer","minimum":1,"maximum":10},"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'bathroom-cleaning', 'Bathroom cleaning', 'water', 'fixed', 210, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'fixed',
    '{piece}', true, '{weekly,monthly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'kitchen-cleaning', 'Kitchen cleaning', 'restaurant', 'fixed', 220, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'fixed',
    '{visit}', true, '{weekly,monthly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'sofa-carpet-cleaning', 'Sofa & carpet cleaning', 'color-palette', 'fixed', 230, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'fixed',
    '{piece}', true, '{monthly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'full-house-cleaning', 'Full house cleaning', 'home', 'fixed', 240, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'fixed',
    '{bhk}', true, '{monthly}', false, '{}',
    '{"type":"object","properties":{"bhk":{"type":"integer","minimum":1,"maximum":10},"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'dishwashing', 'Dishwashing', 'restaurant', 'quote', 250, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'time_based',
    '{hour}', true, '{daily,alternate_days,weekly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'laundry-ironing', 'Laundry & ironing', 'shirt', 'fixed', 260, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'fixed',
    '{kg}', true, '{weekly,alternate_days}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'cooking-meal-prep', 'Cooking & meal prep', 'restaurant', 'quote', 270, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'time_based',
    '{hour}', true, '{daily,weekly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'daily-cook', 'Daily cook', 'restaurant', 'quote', 280, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'time_based',
    '{month}', true, '{daily,weekly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'part-time-cook', 'Part-time cook', 'restaurant', 'quote', 290, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'time_based',
    '{hour}', true, '{daily,weekly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'full-time-cook', 'Full-time cook', 'restaurant', 'quote', 300, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'time_based',
    '{month}', true, '{daily}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'maid-household-helper', 'Maid & household helper', 'people', 'quote', 310, false, 'household-help',
    (select id from public.categories where slug = 'household-help'), 'time_based',
    '{hour}', true, '{daily,alternate_days,weekly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'electrician', 'Electrician', 'zap', 'quote', 10, false, 'home-repairs',
    (select id from public.categories where slug = 'home-repairs'), 'inspect_quote',
    '{job}', false, '{}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'plumber', 'Plumber', 'droplet', 'quote', 20, false, 'home-repairs',
    (select id from public.categories where slug = 'home-repairs'), 'inspect_quote',
    '{job}', false, '{}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'carpenter', 'Carpenter', 'hammer', 'quote', 30, false, 'home-repairs',
    (select id from public.categories where slug = 'home-repairs'), 'inspect_quote',
    '{job}', false, '{}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'painter', 'Painter', 'brush', 'quote', 40, false, 'home-repairs',
    (select id from public.categories where slug = 'home-repairs'), 'inspect_quote',
    '{job}', false, '{}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'ac-repair', 'AC servicing & repair', 'snowflake', 'quote', 50, false, 'home-repairs',
    (select id from public.categories where slug = 'home-repairs'), 'inspect_quote',
    '{job}', false, '{}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'ac-servicing', 'AC servicing', 'snowflake', 'fixed', 320, false, 'home-repairs',
    (select id from public.categories where slug = 'home-repairs'), 'fixed',
    '{visit}', true, '{monthly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'appliance-repair', 'Appliance repair', 'tv', 'quote', 60, false, 'home-repairs',
    (select id from public.categories where slug = 'home-repairs'), 'inspect_quote',
    '{job}', false, '{}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'fridge-washing-machine-repair', 'Fridge & washing machine repair', 'tv', 'quote', 330, false, 'home-repairs',
    (select id from public.categories where slug = 'home-repairs'), 'inspect_quote',
    '{job}', false, '{}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'ro-water-purifier-service', 'RO & water purifier service', 'water', 'fixed', 340, false, 'home-repairs',
    (select id from public.categories where slug = 'home-repairs'), 'fixed',
    '{visit}', true, '{monthly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'pest-control', 'Pest control', 'bug', 'quote', 70, false, 'home-repairs',
    (select id from public.categories where slug = 'home-repairs'), 'fixed',
    '{visit}', true, '{monthly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'water-tank-cleaning', 'Water tank cleaning', 'database', 'fixed', 80, false, 'home-repairs',
    (select id from public.categories where slug = 'home-repairs'), 'fixed',
    '{visit}', true, '{monthly}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'appliance-installation', 'Appliance installation', 'construct', 'fixed', 350, false, 'home-repairs',
    (select id from public.categories where slug = 'home-repairs'), 'fixed',
    '{piece}', false, '{}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'gardening', 'Gardening', 'leaf', 'quote', 100, false, 'home-other',
    (select id from public.categories where slug = 'home-other'), 'time_based',
    '{hour}', true, '{weekly,alternate_days}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'packers-movers', 'Packers & movers', 'cube', 'quote', 110, false, 'home-other',
    (select id from public.categories where slug = 'home-other'), 'inspect_quote',
    '{job}', false, '{}', false, '{}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'home-sanitisation', 'Home sanitisation', 'shield-checkmark', 'fixed', 120, false, 'home-other',
    (select id from public.categories where slug = 'home-other'), 'fixed',
    '{bhk}', true, '{monthly}', false, '{}',
    '{"type":"object","properties":{"bhk":{"type":"integer","minimum":1,"maximum":10},"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'babysitting', 'Babysitting', 'people', 'quote', 130, false, 'home-other',
    (select id from public.categories where slug = 'home-other'), 'time_based',
    '{hour}', true, '{daily,weekly}', true, '{police_verification}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  ),
  (
    'elderly-assistance', 'Elderly assistance', 'people', 'quote', 140, false, 'home-other',
    (select id from public.categories where slug = 'home-other'), 'time_based',
    '{hour}', true, '{daily,weekly}', true, '{police_verification}',
    '{"type":"object","properties":{"brief":{"type":"string"}}}'::jsonb
  )
on conflict (slug) do update
set parent_id = excluded.parent_id;

update public.categories c
   set archetype = 'fixed',
       payment_template = 'full_upfront',
       cancellation_policy = 'fixed_flexible',
       recurrence_allowed = true,
       allowed_frequencies = case c.slug
         when 'house-cleaning' then array['daily', 'alternate_days', 'weekly']::text[]
         else array['monthly']::text[]
       end,
       pricing_units = case
         when 'visit' = any(c.pricing_units) then c.pricing_units
         else array_append(c.pricing_units, 'visit')
       end,
       config_version = c.config_version + 1
 where c.slug in ('house-cleaning', 'pest-control', 'water-tank-cleaning')
   and c.active
   and exists (
     select 1
       from public.provider_services ps
       join public.service_packages sp on sp.provider_service_id = ps.id
      where ps.category_id = c.id
        and ps.active
        and sp.active
        and sp.price_type = 'fixed'
   );

create or replace function public._home_services_catalogue_visible(p_slug text, p_vertical text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._feature_enabled('home_services_catalogue_v2')
      or p_slug = any(array[
        'house-cleaning', 'electrician', 'plumber', 'ac-repair', 'appliance-repair',
        'carpenter', 'painter', 'pest-control', 'water-tank-cleaning',
        'car-mechanic', 'bike-mechanic'
      ]::text[])
      or p_vertical not in (
        'household-help', 'home-repairs', 'home-other', 'cleaning', 'auto'
      );
$$;

revoke execute on function public._home_services_catalogue_visible(text, text)
  from public, anon, authenticated;

create or replace function public.admin_upsert_category(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_id uuid;
  v_existing public.categories%rowtype;
  v_parent public.categories%rowtype;
  v_parent_id uuid;
  v_slug text;
  v_name text;
  v_icon text;
  v_vertical text;
  v_archetype text;
  v_pricing_units text[];
  v_recurrence_allowed boolean;
  v_allowed_frequencies text[];
  v_global_frequencies text[];
  v_global_frequencies_json jsonb;
  v_recurring_discount_bp int;
  v_cancellation_policy text;
  v_requires_docs text[];
  v_restricted boolean;
  v_sort_order int;
  v_intake_schema jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(public._feature_enabled('admin_category_editor'), 'Category editor is turned off right now.');
  perform public._assert(jsonb_typeof(p) = 'object', 'category must be a JSON object');

  if nullif(p ->> 'id', '') is not null then
    v_id := (p ->> 'id')::uuid;
    select * into v_existing from public.categories where id = v_id;
    perform public._assert(found, 'category not found');
    v_slug := v_existing.slug;
    if p ? 'slug' then
      perform public._assert(jsonb_typeof(p -> 'slug') = 'string', 'category slug must be a string');
      perform public._assert(p ->> 'slug' is not distinct from v_slug, 'category slug cannot be changed');
    end if;
  else
    v_slug := nullif(btrim(p ->> 'slug'), '');
    perform public._assert(
      jsonb_typeof(p -> 'slug') = 'string'
        and v_slug is not null and v_slug ~ '^[a-z0-9-]{3,60}$',
      'category slug must match ^[a-z0-9-]{3,60}$'
    );
    perform public._assert(not exists (select 1 from public.categories where slug = v_slug), 'category slug already exists');
  end if;

  if p ? 'name' then
    perform public._assert(jsonb_typeof(p -> 'name') = 'string', 'category name must be a string');
  end if;
  v_name := coalesce(nullif(btrim(p ->> 'name'), ''), v_existing.name);
  perform public._assert(v_name is not null, 'category name is required');
  if p ? 'icon' then
    perform public._assert(jsonb_typeof(p -> 'icon') = 'string', 'category icon must be a string');
  end if;
  v_icon := coalesce(nullif(btrim(p ->> 'icon'), ''), v_existing.icon, 'tool');
  if p ? 'vertical' then
    perform public._assert(jsonb_typeof(p -> 'vertical') = 'string', 'category vertical must be a string');
  end if;
  v_vertical := coalesce(nullif(btrim(p ->> 'vertical'), ''), v_existing.vertical, 'home-other');

  if p ? 'parent_id' then
    if jsonb_typeof(p -> 'parent_id') = 'null' then
      v_parent_id := null;
    else
      perform public._assert(jsonb_typeof(p -> 'parent_id') = 'string', 'parent_id must be a UUID or null');
      v_parent_id := (p ->> 'parent_id')::uuid;
    end if;
  else
    v_parent_id := v_existing.parent_id;
  end if;

  if p ? 'archetype' then
    if jsonb_typeof(p -> 'archetype') = 'null' then
      v_archetype := null;
    else
      perform public._assert(jsonb_typeof(p -> 'archetype') = 'string', 'archetype must be a string or null');
      v_archetype := p ->> 'archetype';
    end if;
  elsif v_id is not null then
    v_archetype := v_existing.archetype;
  else
    v_archetype := 'inspect_quote';
  end if;

  if p ? 'pricing_units' then
    perform public._assert(jsonb_typeof(p -> 'pricing_units') = 'array', 'pricing_units must be an array');
    perform public._assert(
      not exists (
        select 1 from jsonb_array_elements(p -> 'pricing_units') as item(value)
         where jsonb_typeof(item.value) <> 'string'
      ),
      'pricing_units values must be strings'
    );
    select coalesce(array_agg(item.value #>> '{}' order by item.ordinality), '{}'::text[])
      into v_pricing_units
      from jsonb_array_elements(p -> 'pricing_units') with ordinality as item(value, ordinality);
  elsif v_id is not null then
    v_pricing_units := v_existing.pricing_units;
  else
    v_pricing_units := array['job']::text[];
  end if;

  if p ? 'recurrence_allowed' then
    perform public._assert(jsonb_typeof(p -> 'recurrence_allowed') = 'boolean', 'recurrence_allowed must be boolean');
    v_recurrence_allowed := (p ->> 'recurrence_allowed')::boolean;
  else
    v_recurrence_allowed := coalesce(v_existing.recurrence_allowed, false);
  end if;

  if p ? 'allowed_frequencies' then
    perform public._assert(jsonb_typeof(p -> 'allowed_frequencies') = 'array', 'allowed_frequencies must be an array');
    perform public._assert(
      not exists (
        select 1 from jsonb_array_elements(p -> 'allowed_frequencies') as item(value)
         where jsonb_typeof(item.value) <> 'string'
      ),
      'allowed_frequencies values must be strings'
    );
    select coalesce(array_agg(item.value #>> '{}' order by item.ordinality), '{}'::text[])
      into v_allowed_frequencies
      from jsonb_array_elements(p -> 'allowed_frequencies') with ordinality as item(value, ordinality);
  elsif v_id is not null then
    v_allowed_frequencies := v_existing.allowed_frequencies;
  else
    v_allowed_frequencies := '{}'::text[];
  end if;

  select c.value -> 'frequencies'
    into v_global_frequencies_json
    from public.app_config c
   where c.key = 'recurring_rules';
  perform public._assert(jsonb_typeof(v_global_frequencies_json) = 'array', 'recurring frequencies are not configured');
  select coalesce(array_agg(value), '{}'::text[])
    into v_global_frequencies
    from jsonb_array_elements_text(v_global_frequencies_json) as frequencies(value);
  perform public._assert(
    cardinality(v_allowed_frequencies) = (
      select count(distinct value) from unnest(v_allowed_frequencies) as frequencies(value)
    ),
    'allowed_frequencies cannot contain duplicates'
  );
  perform public._assert(
    v_allowed_frequencies <@ v_global_frequencies,
    'allowed_frequencies must be a subset of recurring_rules.frequencies'
  );

  if p ? 'recurring_discount_bp' then
    if jsonb_typeof(p -> 'recurring_discount_bp') = 'null' then
      v_recurring_discount_bp := null;
    else
      perform public._assert(
        jsonb_typeof(p -> 'recurring_discount_bp') = 'number'
          and (p ->> 'recurring_discount_bp') ~ '^[0-9]+$',
        'recurring_discount_bp must be a whole-number JSON number or null'
      );
      v_recurring_discount_bp := (p ->> 'recurring_discount_bp')::int;
      perform public._assert(v_recurring_discount_bp between 0 and 5000, 'recurring_discount_bp must be between 0 and 5000');
    end if;
  else
    v_recurring_discount_bp := v_existing.recurring_discount_bp;
  end if;

  if p ? 'cancellation_policy' then
    perform public._assert(
      jsonb_typeof(p -> 'cancellation_policy') = 'string',
      'cancellation_policy must be a string'
    );
  end if;
  v_cancellation_policy := coalesce(
    nullif(btrim(p ->> 'cancellation_policy'), ''),
    v_existing.cancellation_policy,
    'standard_visit'
  );
  perform public._assert(
    exists (select 1 from public.cancellation_policies where key = v_cancellation_policy),
    'cancellation policy not found'
  );

  if p ? 'requires_docs' then
    perform public._assert(jsonb_typeof(p -> 'requires_docs') = 'array', 'requires_docs must be an array');
    perform public._assert(
      not exists (
        select 1 from jsonb_array_elements(p -> 'requires_docs') as item(value)
         where jsonb_typeof(item.value) <> 'string'
      ),
      'requires_docs values must be strings'
    );
    select coalesce(array_agg(item.value #>> '{}' order by item.ordinality), '{}'::text[])
      into v_requires_docs
      from jsonb_array_elements(p -> 'requires_docs') with ordinality as item(value, ordinality);
  elsif v_id is not null then
    v_requires_docs := v_existing.requires_docs;
  else
    v_requires_docs := '{}'::text[];
  end if;

  if p ? 'restricted' then
    perform public._assert(jsonb_typeof(p -> 'restricted') = 'boolean', 'restricted must be boolean');
    v_restricted := (p ->> 'restricted')::boolean;
  else
    v_restricted := coalesce(v_existing.restricted, false);
  end if;
  if v_id is not null and v_existing.active and v_restricted then
    perform public._assert(
      cardinality(coalesce(v_requires_docs, '{}'::text[])) > 0,
      'restricted categories require documents before they can remain active'
    );
  end if;

  if p ? 'sort_order' then
    perform public._assert(
      jsonb_typeof(p -> 'sort_order') = 'number' and (p ->> 'sort_order') ~ '^-?[0-9]+$',
      'sort_order must be a whole-number JSON number'
    );
    v_sort_order := (p ->> 'sort_order')::int;
  else
    v_sort_order := coalesce(v_existing.sort_order, 0);
  end if;

  if p ? 'intake_schema' then
    v_intake_schema := p -> 'intake_schema';
  else
    v_intake_schema := coalesce(
      v_existing.intake_schema,
      '{"type":"object","properties":{}}'::jsonb
    );
  end if;
  perform public._assert(jsonb_typeof(v_intake_schema) = 'object', 'intake_schema must be a JSON object');
  perform public._assert(
    v_intake_schema -> 'properties' is null or jsonb_typeof(v_intake_schema -> 'properties') = 'object',
    'intake_schema properties must be a JSON object'
  );
  perform public._assert(
    not exists (
      select 1
        from jsonb_object_keys(coalesce(v_intake_schema -> 'properties', '{}'::jsonb)) as property(key)
       where lower(property.key) in ('phone', 'address')
    ),
    'intake_schema cannot collect phone or address'
  );

  perform public._assert(
    cardinality(v_pricing_units) between 1 and 12,
    'pricing_units must contain between 1 and 12 values'
  );
  perform public._assert(
    cardinality(v_pricing_units) = (
      select count(distinct value) from unnest(v_pricing_units) as units(value)
    ),
    'pricing_units cannot contain duplicates'
  );
  perform public._assert(
    v_pricing_units <@ array[
      'job', 'hour', 'day', 'session', 'person', 'plate', 'sqft', 'bhk', 'seat', 'litre',
      'event', 'month', 'visit', 'kg', 'piece'
    ]::text[],
    'pricing_units contains an unsupported value'
  );

  if v_parent_id is not null then
    perform public._assert(v_id is distinct from v_parent_id, 'category parent cycle is not allowed');
    select * into v_parent from public.categories where id = v_parent_id;
    perform public._assert(found, 'category parent not found');
    perform public._assert(
      v_parent.parent_id is null and v_parent.archetype is null,
      'parent_id must identify a top-level group'
    );
    perform public._assert(v_archetype is not null, 'child category requires an archetype');
    perform public._assert(
      not exists (select 1 from public.categories where parent_id = v_id),
      'a group with children cannot be nested'
    );
  elsif v_id is not null and exists (select 1 from public.categories where parent_id = v_id) then
    perform public._assert(v_archetype is null, 'a group with children must remain archetype-free');
  end if;

  if v_id is null then
    insert into public.categories (
      slug, name, icon, sort_order, active, vertical, parent_id, archetype,
      pricing_units, intake_schema, cancellation_policy, restricted, requires_docs,
      recurrence_allowed, allowed_frequencies, recurring_discount_bp
    )
    values (
      v_slug, v_name, v_icon, v_sort_order, false, v_vertical, v_parent_id, v_archetype,
      v_pricing_units, v_intake_schema, v_cancellation_policy, v_restricted, v_requires_docs,
      v_recurrence_allowed, v_allowed_frequencies, v_recurring_discount_bp
    )
    returning id into v_id;
  else
    update public.categories
       set name = v_name,
           icon = v_icon,
           sort_order = v_sort_order,
           vertical = v_vertical,
           parent_id = v_parent_id,
           archetype = v_archetype,
           pricing_units = v_pricing_units,
           intake_schema = v_intake_schema,
           cancellation_policy = v_cancellation_policy,
           restricted = v_restricted,
           requires_docs = v_requires_docs,
           recurrence_allowed = v_recurrence_allowed,
           allowed_frequencies = v_allowed_frequencies,
           recurring_discount_bp = v_recurring_discount_bp,
           config_version = config_version + 1
     where id = v_id;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (
    v_uid,
    'upsert_category',
    v_id,
    jsonb_build_object('slug', v_slug, 'fields', p - 'id')
  );
  return v_id;
end;
$$;

create or replace function public.admin_reorder_categories(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_parent_id uuid;
  v_id_count int;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(public._feature_enabled('admin_category_editor'), 'Category editor is turned off right now.');
  perform public._assert(p_ids is not null and cardinality(p_ids) > 0, 'category ids are required');
  perform public._assert(
    not exists (select 1 from unnest(p_ids) as requested(id) where requested.id is null),
    'category ids cannot contain null'
  );
  select count(distinct id)::int into v_id_count from unnest(p_ids) as requested(id);
  perform public._assert(v_id_count = cardinality(p_ids), 'category ids cannot contain duplicates');

  select c.parent_id into v_parent_id
    from public.categories c
   where c.id = p_ids[1];
  perform public._assert(found, 'category not found');
  perform public._assert(
    not exists (
      select 1
        from unnest(p_ids) as requested(id)
        left join public.categories c on c.id = requested.id
       where c.id is null or c.parent_id is distinct from v_parent_id
    ),
    'categories must have the same parent'
  );
  select count(*)::int
    into v_id_count
    from public.categories c
   where c.parent_id is not distinct from v_parent_id;
  perform public._assert(
    v_id_count = cardinality(p_ids),
    'all categories within the parent must be reordered together'
  );

  with requested as (
    select id, (ordinality * 10)::int as sort_order
      from unnest(p_ids) with ordinality as item(id, ordinality)
  )
  update public.categories c
     set sort_order = requested.sort_order,
         config_version = c.config_version + 1
    from requested
   where c.id = requested.id
     and c.sort_order is distinct from requested.sort_order;

  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (
    v_uid,
    'reorder_categories',
    v_parent_id,
    jsonb_build_object('category_ids', to_jsonb(p_ids))
  );
end;
$$;

revoke execute on function public.admin_upsert_category(jsonb), public.admin_reorder_categories(uuid[])
  from public, anon;
grant execute on function public.admin_upsert_category(jsonb), public.admin_reorder_categories(uuid[])
  to authenticated;

create or replace function public.admin_set_category_active(p_category_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_restricted boolean;
  v_requires_docs text[];
begin
  perform public._assert(public._is_admin(), 'admin only');
  select c.restricted, c.requires_docs
    into v_restricted, v_requires_docs
    from public.categories c
   where c.id = p_category_id;
  perform public._assert(found, 'category not found');
  if p_active and v_restricted then
    perform public._assert(
      cardinality(coalesce(v_requires_docs, '{}'::text[])) > 0,
      'restricted categories require documents before activation'
    );
  end if;

  update public.categories
     set active = p_active,
         config_version = config_version + 1
   where id = p_category_id
     and active is distinct from p_active;

  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_category_active', p_category_id, jsonb_build_object('active', p_active));
end;
$$;

drop function public.admin_list_categories();
create function public.admin_list_categories()
returns table (
  id uuid, name text, slug text, archetype text, active boolean, sort_order int,
  cities jsonb, providers int, bookings_30d int, parent_id uuid, vertical text,
  icon text, pricing_mode public.pricing_mode, location_modes text[], pricing_units text[],
  intake_schema jsonb, payment_template text, cancellation_policy text, commission_bp int,
  min_lead_hours int, max_lead_days int, restricted boolean, config_version int,
  requires_docs text[], recommended_docs text[], recurrence_allowed boolean,
  allowed_frequencies text[], recurring_discount_bp int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return query
  select c.id, c.name, c.slug, c.archetype, c.active, c.sort_order,
         coalesce((select jsonb_agg(jsonb_build_object('city', cc.city, 'live', cc.live) order by cc.city)
                     from public.category_cities cc where cc.category_id = c.id), '[]'::jsonb),
         (select count(distinct ps.provider_id)::int from public.provider_services ps where ps.category_id = c.id and ps.active),
         (select count(*)::int from public.bookings b where b.category_id = c.id and b.created_at > now() - interval '30 days'),
         c.parent_id, c.vertical, c.icon, c.pricing_mode, c.location_modes, c.pricing_units,
         c.intake_schema, c.payment_template, c.cancellation_policy, c.commission_bp,
         c.min_lead_hours, c.max_lead_days, c.restricted, c.config_version,
         c.requires_docs, c.recommended_docs, c.recurrence_allowed,
         c.allowed_frequencies, c.recurring_discount_bp
    from public.categories c
   order by c.archetype nulls first, c.sort_order, c.name;
end;
$$;

revoke execute on function public.admin_list_categories() from public, anon;
grant execute on function public.admin_list_categories() to authenticated;

drop function public.get_catalog(text);
create function public.get_catalog(p_city text default null)
returns table (
  id uuid,
  slug text,
  name text,
  icon text,
  vertical text,
  parent_id uuid,
  archetype text,
  location_modes text[],
  pricing_units text[],
  intake_schema jsonb,
  payment_template text,
  cancellation_policy text,
  commission_bp int,
  min_lead_hours int,
  max_lead_days int,
  requires_docs text[],
  recommended_docs text[],
  restricted boolean,
  config_version int,
  pricing_mode public.pricing_mode,
  sort_order int,
  profile_schema jsonb,
  review_tags text[],
  recurrence_allowed boolean,
  allowed_frequencies text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select coalesce(
      nullif(trim(p_city), ''),
      (select value #>> '{}' from public.app_config where key = 'launch_city')
    ) as city
  ),
  visible as (
    select c.*
      from public.categories c
      join public.category_cities cc
        on cc.category_id = c.id and cc.live
      cross join target t
     where c.active
       and not c.restricted
       and lower(trim(cc.city)) = lower(trim(coalesce(t.city, '')))
       and public._archetype_enabled(c.archetype)
       and public._home_services_catalogue_visible(c.slug, c.vertical)
  ),
  result as (
    select v.*
      from visible v
    union all
    select g.*
      from public.categories g
     where public._feature_enabled('home_services_catalogue_v2')
       and g.parent_id is null
       and g.archetype is null
       and exists (
         select 1 from visible child where child.parent_id = g.id
       )
  )
  select c.id, c.slug, c.name, c.icon, c.vertical, c.parent_id, c.archetype,
         c.location_modes, c.pricing_units, c.intake_schema, c.payment_template,
         c.cancellation_policy, c.commission_bp, c.min_lead_hours, c.max_lead_days,
         c.requires_docs, c.recommended_docs, c.restricted, c.config_version,
         c.pricing_mode, c.sort_order, c.profile_schema, c.review_tags,
         c.recurrence_allowed, c.allowed_frequencies
    from result c
   order by c.sort_order, c.name;
$$;

revoke execute on function public.get_catalog(text) from public;
grant execute on function public.get_catalog(text) to anon, authenticated, service_role;

revoke execute on function public.admin_set_category_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_category_active(uuid, boolean) to authenticated;

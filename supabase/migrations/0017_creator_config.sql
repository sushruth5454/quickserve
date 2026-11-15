-- Creator/event category configuration and the generic package foundation
-- (docs/07 T1.3 and docs/09 M5.1-M5.3). No booking or payment flow is wired.

insert into public.document_types (code, label, description, has_expiry, sort_order)
values
  ('dgca_drone_permission', 'DGCA drone permission', 'Applicable DGCA pilot, operator or location permission for drone services', true, 8),
  ('gst_registration', 'GST registration', 'GST registration certificate for business and event services', false, 9)
on conflict (code) do update
set label = excluded.label,
    description = excluded.description,
    has_expiry = excluded.has_expiry,
    sort_order = excluded.sort_order;

insert into public.categories (
  slug, name, icon, pricing_mode, sort_order, active,
  profile_schema, review_tags, requires_docs, recommended_docs
)
values
  (
    'instagram-influencer', 'Instagram Influencer', 'instagram', 'quote', 120, false,
    '{"type":"object","properties":{"niches":{"type":"array","items":{"type":"string","enum":["food","fashion","beauty","fitness","travel","tech","parenting","local-business"]},"maxItems":8},"languages":{"type":"array","items":{"type":"string","enum":["English","Hindi","Telugu","Tamil","Kannada","Malayalam","Bengali","Marathi"]},"maxItems":8},"followers":{"type":"integer"},"avg_reel_views":{"type":"integer"},"engagement_percent":{"type":"number"},"audience_top_cities":{"type":"string"},"content_styles":{"type":"array","items":{"type":"string","enum":["reel","story","carousel","static-post","live"]},"maxItems":5},"past_brand_collaborations":{"type":"string"}},"required":["niches","languages"]}'::jsonb,
    array['authentic_content','on_time_delivery','clear_disclosure','responsive','engaged_audience'], '{}', '{}'
  ),
  (
    'youtube-creator', 'YouTube Creator', 'youtube', 'quote', 121, false,
    '{"type":"object","properties":{"niches":{"type":"array","items":{"type":"string","enum":["education","food","fashion","beauty","fitness","travel","tech","reviews","entertainment"]},"maxItems":8},"subscribers":{"type":"integer"},"avg_views":{"type":"integer"},"formats":{"type":"array","items":{"type":"string","enum":["shorts","long-form","integration","dedicated-video","live"]},"maxItems":5},"languages":{"type":"array","items":{"type":"string","enum":["English","Hindi","Telugu","Tamil","Kannada","Malayalam","Bengali","Marathi"]},"maxItems":8},"past_brand_collaborations":{"type":"string"}},"required":["niches","formats"]}'::jsonb,
    array['authentic_content','on_time_delivery','clear_disclosure','strong_brief_following','engaged_audience'], '{}', '{}'
  ),
  (
    'ugc-creator', 'UGC Creator', 'video', 'quote', 122, false,
    '{"type":"object","properties":{"styles":{"type":"array","items":{"type":"string","enum":["talking-head","product-demo","testimonial","cinematic","unboxing","voiceover"]},"maxItems":6},"equipment":{"type":"array","items":{"type":"string","enum":["phone","dslr","mirrorless","lighting-kit","microphone","studio"]},"maxItems":6},"editing_software":{"type":"string"},"turnaround_days":{"type":"integer"},"languages":{"type":"array","items":{"type":"string","enum":["English","Hindi","Telugu","Tamil","Kannada","Malayalam","Bengali","Marathi"]},"maxItems":8}},"required":["styles"]}'::jsonb,
    array['brief_followed','high_quality_video','on_time_delivery','good_hook','easy_revisions'], '{}', '{}'
  ),
  (
    'reel-maker', 'Reel Maker / Editor', 'video', 'fixed', 123, false,
    '{"type":"object","properties":{"styles":{"type":"array","items":{"type":"string","enum":["cinematic","fast-cut","talking-head","product","behind-the-scenes","motion-graphics"]},"maxItems":6},"equipment":{"type":"array","items":{"type":"string","enum":["phone","dslr","mirrorless","gimbal","drone","lighting-kit","microphone"]},"maxItems":7},"editing_software":{"type":"array","items":{"type":"string","enum":["premiere-pro","final-cut-pro","davinci-resolve","capcut","after-effects"]},"maxItems":5},"turnaround_days":{"type":"integer"}},"required":["styles"]}'::jsonb,
    array['high_quality_video','on_time_delivery','creative_editing','easy_revisions','good_hook'], '{}', '{}'
  ),
  (
    'wedding-photographer', 'Wedding Photographer', 'camera', 'quote', 130, false,
    '{"type":"object","properties":{"styles":{"type":"array","items":{"type":"string","enum":["candid","traditional","fine-art","documentary","editorial"]},"maxItems":5},"events_covered":{"type":"array","items":{"type":"string","enum":["engagement","haldi","mehendi","sangeet","wedding","reception"]},"maxItems":6},"team_size":{"type":"integer"},"equipment":{"type":"string"},"album_options":{"type":"array","items":{"type":"string","enum":["digital","photo-book","premium-album","wall-print"]},"maxItems":4}},"required":["styles","events_covered"]}'::jsonb,
    array['beautiful_photos','caught_moments','on_time_delivery','professional_team','album_quality'], '{}', '{}'
  ),
  (
    'candid-photographer', 'Candid Photographer', 'camera', 'quote', 131, false,
    '{"type":"object","properties":{"styles":{"type":"array","items":{"type":"string","enum":["candid","documentary","editorial","fine-art"]},"maxItems":4},"events_covered":{"type":"array","items":{"type":"string","enum":["birthday","engagement","pre-wedding","wedding","baby-shower","corporate"]},"maxItems":6},"team_size":{"type":"integer"},"equipment":{"type":"string"}},"required":["styles"]}'::jsonb,
    array['beautiful_photos','caught_moments','on_time_delivery','natural_poses','professional_team'], '{}', '{}'
  ),
  (
    'pre-wedding-shoot', 'Pre-wedding Shoot', 'camera', 'quote', 132, false,
    '{"type":"object","properties":{"styles":{"type":"array","items":{"type":"string","enum":["cinematic","candid","traditional","editorial","vintage"]},"maxItems":5},"locations_covered":{"type":"string"},"team_size":{"type":"integer"},"outfits_supported":{"type":"integer"},"album_options":{"type":"array","items":{"type":"string","enum":["digital","photo-book","premium-album"]},"maxItems":3}},"required":["styles"]}'::jsonb,
    array['beautiful_photos','comfortable_experience','creative_locations','on_time_delivery','editing_quality'], '{}', '{}'
  ),
  (
    'maternity-newborn', 'Maternity & Newborn Photography', 'camera', 'quote', 133, false,
    '{"type":"object","properties":{"styles":{"type":"array","items":{"type":"string","enum":["maternity","newborn","family","lifestyle","fine-art"]},"maxItems":5},"shoot_locations":{"type":"array","items":{"type":"string","enum":["home","studio","outdoor"]},"maxItems":3},"props_provided":{"type":"boolean"},"safety_training":{"type":"boolean"},"team_size":{"type":"integer"}},"required":["styles","shoot_locations"]}'::jsonb,
    array['baby_safety','patient_photographer','beautiful_photos','clean_setup','on_time_delivery'], '{}', '{}'
  ),
  (
    'product-photographer', 'Product Photographer', 'camera', 'quote', 134, false,
    '{"type":"object","properties":{"styles":{"type":"array","items":{"type":"string","enum":["ecommerce","lifestyle","editorial","flat-lay","food","jewellery"]},"maxItems":6},"equipment":{"type":"array","items":{"type":"string","enum":["studio","macro","light-box","dslr","mirrorless"]},"maxItems":5},"backgrounds_provided":{"type":"boolean"},"editing_included":{"type":"boolean"},"turnaround_days":{"type":"integer"}},"required":["styles"]}'::jsonb,
    array['accurate_colours','product_ready','creative_styling','on_time_delivery','easy_revisions'], '{}', '{}'
  ),
  (
    'event-videographer', 'Event Videographer', 'video', 'quote', 135, false,
    '{"type":"object","properties":{"formats":{"type":"array","items":{"type":"string","enum":["highlight-film","full-ceremony","teaser","reels","live-stream"]},"maxItems":5},"resolution":{"type":"array","items":{"type":"string","enum":["1080p","4k","6k"]},"maxItems":3},"same_day_edit":{"type":"boolean"},"team_size":{"type":"integer"},"equipment":{"type":"string"}},"required":["formats"]}'::jsonb,
    array['cinematic_quality','on_time_delivery','caught_moments','clear_audio','easy_revisions'], '{}', '{}'
  ),
  (
    'drone-operator', 'Drone Operator', 'video', 'quote', 136, false,
    '{"type":"object","properties":{"services":{"type":"array","items":{"type":"string","enum":["wedding","real-estate","product","event","construction"]},"maxItems":5},"aircraft_type":{"type":"string"},"resolution":{"type":"array","items":{"type":"string","enum":["1080p","4k","5k","6k"]},"maxItems":4},"pilot_licence_number":{"type":"string"},"night_flying":{"type":"boolean"}},"required":["services","pilot_licence_number"]}'::jsonb,
    array['safe_operation','cinematic_quality','on_time','permission_ready','stable_footage'], array['dgca_drone_permission'], '{}'
  ),
  (
    'photo-booth', 'Photo Booth', 'camera', 'quote', 137, false,
    '{"type":"object","properties":{"booth_styles":{"type":"array","items":{"type":"string","enum":["open-air","enclosed","360-video","mirror","digital"]},"maxItems":5},"props_included":{"type":"boolean"},"instant_prints":{"type":"boolean"},"digital_gallery":{"type":"boolean"},"setup_time_minutes":{"type":"integer"}},"required":["booth_styles"]}'::jsonb,
    array['guest_favourite','quick_setup','print_quality','attendant_helpful','fun_props'], '{}', '{}'
  ),
  (
    'caterer', 'Caterer', 'restaurant', 'quote', 140, false,
    '{"type":"object","properties":{"cuisines":{"type":"array","items":{"type":"string","enum":["south-indian","north-indian","bengali","gujarati","hyderabadi","continental","chinese","mexican","jain","vegan"]},"maxItems":10},"dietary_options":{"type":"array","items":{"type":"string","enum":["veg","non-veg","jain","vegan","gluten-free"]},"maxItems":5},"min_guests":{"type":"integer"},"max_guests":{"type":"integer"},"live_counters":{"type":"array","items":{"type":"string","enum":["chaat","dosa","pasta","dessert","mocktail","grill","none"]},"maxItems":7},"tasting_session":{"type":"boolean"},"service_styles":{"type":"array","items":{"type":"string","enum":["buffet","plated","family-style","live-counter"]},"maxItems":4},"equipment_provided":{"type":"boolean"}},"required":["cuisines","dietary_options","min_guests","max_guests"]}'::jsonb,
    array['tasty_food','hygiene','on_time_service','helpful_staff','fresh_food','good_presentation'], array['fssai'], '{}'
  ),
  (
    'decorator', 'Decorator', 'sparkles', 'quote', 141, false,
    '{"type":"object","properties":{"themes":{"type":"array","items":{"type":"string","enum":["traditional","floral","minimal","royal","rustic","modern","pastel","balloon"]},"maxItems":8},"floral_options":{"type":"array","items":{"type":"string","enum":["fresh-flowers","artificial-flowers","mixed","non-floral"]},"maxItems":4},"venues_worked":{"type":"string"},"setup_time_minutes":{"type":"integer"},"teardown_included":{"type":"boolean"}},"required":["themes"]}'::jsonb,
    array['beautiful_setup','matched_brief','on_time_setup','quality_materials','helpful_team'], '{}', '{}'
  ),
  (
    'bridal-makeup', 'Bridal Makeup', 'beauty', 'fixed', 142, false,
    '{"type":"object","properties":{"skin_types_expert":{"type":"array","items":{"type":"string","enum":["oily","dry","combination","sensitive","acne-prone","mature"]},"maxItems":6},"techniques":{"type":"array","items":{"type":"string","enum":["hd","airbrush","traditional","glass-skin"]},"maxItems":4},"brands_used":{"type":"string"},"bridal_looks":{"type":"array","items":{"type":"string","enum":["south-indian","north-indian","muslim","christian","minimal","glam"]},"maxItems":6},"trial_offered":{"type":"boolean"},"travels_to_venue":{"type":"boolean"}},"required":["skin_types_expert","techniques"]}'::jsonb,
    array['long_lasting','oily_skin','natural_look','punctual','hygiene','beautiful_finishing'], '{}', '{}'
  ),
  (
    'mehendi-artist', 'Mehendi Artist', 'hand-left', 'fixed', 143, false,
    '{"type":"object","properties":{"styles":{"type":"array","items":{"type":"string","enum":["arabic","rajasthani","bridal","indo-western","minimal","pakistani"]},"maxItems":6},"natural_henna":{"type":"boolean"},"cones_per_hand":{"type":"integer"},"bridal_service":{"type":"boolean"},"home_service":{"type":"boolean"}},"required":["styles","natural_henna"]}'::jsonb,
    array['intricate_design','dark_stain','punctual','patient_artist','hygiene'], '{}', '{}'
  ),
  (
    'dj', 'DJ', 'music', 'quote', 144, false,
    '{"type":"object","properties":{"genres":{"type":"array","items":{"type":"string","enum":["bollywood","tollywood","punjabi","edm","hip-hop","retro","classical-fusion"]},"maxItems":7},"languages":{"type":"array","items":{"type":"string","enum":["English","Hindi","Telugu","Tamil","Kannada"]},"maxItems":5},"equipment_provided":{"type":"boolean"},"hours_included":{"type":"integer"},"sample_set_url":{"type":"string"}},"required":["genres"]}'::jsonb,
    array['great_music','read_the_crowd','on_time_setup','good_sound','professional'], '{}', '{}'
  ),
  (
    'live-band', 'Live Band', 'music', 'quote', 145, false,
    '{"type":"object","properties":{"genres":{"type":"array","items":{"type":"string","enum":["bollywood","acoustic","rock","classical","folk","jazz","devotional","fusion"]},"maxItems":8},"members":{"type":"integer"},"languages":{"type":"array","items":{"type":"string","enum":["English","Hindi","Telugu","Tamil","Kannada"]},"maxItems":5},"equipment_provided":{"type":"boolean"},"hours_included":{"type":"integer"},"sample_set_url":{"type":"string"}},"required":["genres","members"]}'::jsonb,
    array['great_performance','audience_engagement','on_time_setup','good_sound','professional'], '{}', '{}'
  ),
  (
    'wedding-planner', 'Wedding Planner', 'briefcase', 'quote', 146, false,
    '{"type":"object","properties":{"planning_modes":{"type":"array","items":{"type":"string","enum":["full-planning","partial-planning","day-coordination","destination","intimate"]},"maxItems":5},"budget_min":{"type":"integer"},"budget_max":{"type":"integer"},"guest_min":{"type":"integer"},"guest_max":{"type":"integer"},"vendor_network":{"type":"string"},"cities_served":{"type":"string"}},"required":["planning_modes"]}'::jsonb,
    array['well_organised','calm_coordination','vendor_quality','within_budget','great_problem_solving'], '{}', array['gst_registration']
  )
on conflict (slug) do update
set name = excluded.name,
    icon = excluded.icon,
    pricing_mode = excluded.pricing_mode,
    sort_order = excluded.sort_order,
    active = false,
    profile_schema = excluded.profile_schema,
    review_tags = excluded.review_tags,
    requires_docs = excluded.requires_docs,
    recommended_docs = excluded.recommended_docs;

-- Category engine columns from doc 07 may land in 0014-0016. Set them when present
-- without coupling this migration to the exact files that own those foundations.
do $$
declare
  v_has_column boolean;
begin
  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'categories' and column_name = 'live')
    into v_has_column;
  if v_has_column then
    update public.categories
       set live = false
     where slug in (
       'instagram-influencer','youtube-creator','ugc-creator','reel-maker',
       'wedding-photographer','candid-photographer','pre-wedding-shoot','maternity-newborn',
       'product-photographer','event-videographer','drone-operator','photo-booth',
       'caterer','decorator','bridal-makeup','mehendi-artist','dj','live-band','wedding-planner'
     );
  end if;

  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'categories' and column_name = 'vertical')
    into v_has_column;
  if v_has_column then
    update public.categories set vertical = case
      when slug in ('instagram-influencer','youtube-creator','ugc-creator','reel-maker') then 'creators'
      when slug in ('wedding-photographer','candid-photographer','pre-wedding-shoot','maternity-newborn','product-photographer','event-videographer','drone-operator','photo-booth') then 'photo-video'
      else 'weddings-events'
    end
    where slug in (
      'instagram-influencer','youtube-creator','ugc-creator','reel-maker',
      'wedding-photographer','candid-photographer','pre-wedding-shoot','maternity-newborn',
      'product-photographer','event-videographer','drone-operator','photo-booth',
      'caterer','decorator','bridal-makeup','mehendi-artist','dj','live-band','wedding-planner'
    );
  end if;

  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'categories' and column_name = 'archetype')
    into v_has_column;
  if v_has_column then
    update public.categories
       set archetype = 'proposal'
     where slug in (
       'instagram-influencer','youtube-creator','ugc-creator','reel-maker',
       'wedding-photographer','candid-photographer','pre-wedding-shoot','maternity-newborn',
       'product-photographer','event-videographer','drone-operator','photo-booth',
       'caterer','decorator','bridal-makeup','mehendi-artist','dj','live-band','wedding-planner'
     );
  end if;

  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'categories' and column_name = 'location_modes')
    into v_has_column;
  if v_has_column then
    update public.categories
       set location_modes = case
         when slug in ('instagram-influencer','youtube-creator','ugc-creator','reel-maker') then array['remote']
         else array['at_customer']
       end
     where slug in (
       'instagram-influencer','youtube-creator','ugc-creator','reel-maker',
       'wedding-photographer','candid-photographer','pre-wedding-shoot','maternity-newborn',
       'product-photographer','event-videographer','drone-operator','photo-booth',
       'caterer','decorator','bridal-makeup','mehendi-artist','dj','live-band','wedding-planner'
     );
  end if;

  select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'categories' and column_name = 'max_lead_days')
    into v_has_column;
  if v_has_column then
    update public.categories
       set max_lead_days = 365,
           min_lead_hours = 24
     where slug in (
       'instagram-influencer','youtube-creator','ugc-creator','reel-maker',
       'wedding-photographer','candid-photographer','pre-wedding-shoot','maternity-newborn',
       'product-photographer','event-videographer','drone-operator','photo-booth',
       'caterer','decorator','bridal-makeup','mehendi-artist','dj','live-band','wedding-planner'
     );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Generic package engine (doc 07 T1.3, extended by doc 09 B2)
-- ---------------------------------------------------------------------------
create table public.package_templates (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 120),
  description text not null default '',
  price_type text not null check (price_type in ('fixed', 'range', 'from', 'quote')),
  price int,
  price_min int,
  price_max int,
  unit text not null default 'job'
    check (unit in ('job','hour','day','session','person','plate','sqft','bhk','seat','litre','event','month')),
  qty_min numeric(10,2) not null default 1 check (qty_min > 0),
  qty_max numeric(10,2) not null default 1 check (qty_max >= qty_min),
  duration_min int check (duration_min is null or duration_min > 0),
  inclusions text[] not null default '{}',
  exclusions text[] not null default '{}',
  deliverables jsonb not null default '[]'::jsonb,
  turnaround_days int check (turnaround_days is null or turnaround_days between 0 and 3650),
  revisions_included int not null default 0 check (revisions_included between 0 and 100),
  raw_files_included boolean not null default false,
  usage_rights jsonb not null default '{}'::jsonb,
  travel_included_km numeric(6,2) not null default 0 check (travel_included_km between 0 and 1000),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, title),
  check (
    (price_type = 'fixed' and price is not null and price > 0 and price_min = price and price_max = price)
    or (price_type = 'range' and price is null and price_min is not null and price_max is not null and price_min > 0 and price_max > price_min)
    or (price_type = 'from' and price is null and price_min is not null and price_min > 0 and price_max is null)
    or (price_type = 'quote' and price is null and price_min is null and price_max is null)
  )
);

create table public.price_bands (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  city text not null check (char_length(trim(city)) between 2 and 120),
  unit text not null
    check (unit in ('job','hour','day','session','person','plate','sqft','bhk','seat','litre','event','month')),
  "min" int not null check ("min" > 0),
  "max" int not null check ("max" >= "min"),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index price_bands_category_city_unit_idx
  on public.price_bands (category_id, lower(trim(city)), unit);

create table public.service_packages (
  id uuid primary key default gen_random_uuid(),
  provider_service_id uuid not null references public.provider_services (id) on delete cascade,
  package_template_id uuid references public.package_templates (id) on delete set null,
  title text not null check (char_length(trim(title)) between 2 and 120),
  description text not null default '',
  price_type text not null check (price_type in ('fixed', 'range', 'from', 'quote')),
  price int,
  price_min int,
  price_max int,
  unit text not null default 'job'
    check (unit in ('job','hour','day','session','person','plate','sqft','bhk','seat','litre','event','month')),
  qty_min numeric(10,2) not null default 1 check (qty_min > 0),
  qty_max numeric(10,2) not null default 1 check (qty_max >= qty_min),
  duration_min int check (duration_min is null or duration_min > 0),
  inclusions text[] not null default '{}',
  exclusions text[] not null default '{}',
  deliverables jsonb not null default '[]'::jsonb,
  turnaround_days int check (turnaround_days is null or turnaround_days between 0 and 3650),
  revisions_included int not null default 0 check (revisions_included between 0 and 100),
  raw_files_included boolean not null default false,
  usage_rights jsonb not null default '{}'::jsonb,
  travel_included_km numeric(6,2) not null default 0 check (travel_included_km between 0 and 1000),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (price_type = 'fixed' and price is not null and price > 0 and price_min = price and price_max = price)
    or (price_type = 'range' and price is null and price_min is not null and price_max is not null and price_min > 0 and price_max > price_min)
    or (price_type = 'from' and price is null and price_min is not null and price_min > 0 and price_max is null)
    or (price_type = 'quote' and price is null and price_min is null and price_max is null)
  )
);
create index service_packages_provider_service_idx
  on public.service_packages (provider_service_id, sort_order) where active;
create index package_templates_category_idx
  on public.package_templates (category_id, sort_order) where active;

create or replace function public._validate_package_content(
  p_deliverables jsonb,
  p_usage_rights jsonb,
  p_inclusions text[],
  p_exclusions text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deliverable jsonb;
  v_key text;
begin
  perform public._assert(jsonb_typeof(coalesce(p_deliverables, '[]'::jsonb)) = 'array', 'deliverables must be an array');
  for v_deliverable in select value from jsonb_array_elements(coalesce(p_deliverables, '[]'::jsonb))
  loop
    perform public._assert(jsonb_typeof(v_deliverable) = 'object', 'each deliverable must be an object');
    perform public._assert(char_length(trim(coalesce(v_deliverable ->> 'type', ''))) between 1 and 60, 'deliverable type is required');
    perform public._assert(
      jsonb_typeof(v_deliverable -> 'qty') = 'number' and (v_deliverable ->> 'qty')::numeric > 0,
      'deliverable qty must be greater than zero'
    );
    perform public._assert(char_length(coalesce(v_deliverable ->> 'spec', '')) between 1 and 500, 'deliverable spec is required');
  end loop;

  perform public._assert(jsonb_typeof(coalesce(p_usage_rights, '{}'::jsonb)) = 'object', 'usage_rights must be an object');
  for v_key in select jsonb_object_keys(coalesce(p_usage_rights, '{}'::jsonb))
  loop
    perform public._assert(v_key in ('organic_posting', 'paid_ads_days', 'exclusivity_days'), 'unsupported usage rights field');
  end loop;
  if p_usage_rights ? 'organic_posting' then
    perform public._assert(jsonb_typeof(p_usage_rights -> 'organic_posting') = 'boolean', 'organic_posting must be boolean');
  end if;
  if p_usage_rights ? 'paid_ads_days' then
    perform public._assert(
      jsonb_typeof(p_usage_rights -> 'paid_ads_days') = 'number'
      and (p_usage_rights ->> 'paid_ads_days')::int in (0, 30, 90, 365),
      'paid_ads_days must be 0, 30, 90 or 365'
    );
  end if;
  if p_usage_rights ? 'exclusivity_days' then
    perform public._assert(
      jsonb_typeof(p_usage_rights -> 'exclusivity_days') = 'number'
      and (p_usage_rights ->> 'exclusivity_days')::int between 0 and 3650,
      'exclusivity_days must be between 0 and 3650'
    );
  end if;

  perform public._assert(cardinality(coalesce(p_inclusions, '{}')) <= 30, 'too many inclusions');
  perform public._assert(cardinality(coalesce(p_exclusions, '{}')) <= 30, 'too many exclusions');
end;
$$;

create or replace function public._validate_package_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.title := trim(new.title);
  new.description := trim(coalesce(new.description, ''));
  new.inclusions := array(select distinct trim(x) from unnest(coalesce(new.inclusions, '{}')) x where trim(x) <> '' order by trim(x));
  new.exclusions := array(select distinct trim(x) from unnest(coalesce(new.exclusions, '{}')) x where trim(x) <> '' order by trim(x));
  new.updated_at := now();
  perform public._assert(
    not exists(select 1 from unnest(new.inclusions) x where char_length(x) > 160),
    'an inclusion is too long'
  );
  perform public._assert(
    not exists(select 1 from unnest(new.exclusions) x where char_length(x) > 160),
    'an exclusion is too long'
  );
  perform public._validate_package_content(new.deliverables, new.usage_rights, new.inclusions, new.exclusions);
  return new;
end;
$$;

create trigger package_templates_validate
  before insert or update on public.package_templates
  for each row execute function public._validate_package_row();

create or replace function public._validate_service_package()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_id uuid;
  v_city text;
  v_band public.price_bands;
  v_template_category uuid;
begin
  select ps.category_id, p.city
    into v_category_id, v_city
    from public.provider_services ps
    join public.providers p on p.id = ps.provider_id
   where ps.id = new.provider_service_id;
  perform public._assert(v_category_id is not null, 'provider service not found');

  if new.package_template_id is not null then
    select category_id into v_template_category
      from public.package_templates
     where id = new.package_template_id;
    perform public._assert(v_template_category = v_category_id, 'package template belongs to another category');
  end if;

  if new.price_type <> 'quote' then
    select *
      into v_band
      from public.price_bands
     where category_id = v_category_id
       and lower(trim(city)) = lower(trim(coalesce(v_city, '')))
       and unit = new.unit
       and active
     order by updated_at desc
     limit 1;
    if found then
      perform public._assert(
        (new.price_min is null or new.price_min between v_band."min" and v_band."max")
        and (new.price_max is null or new.price_max between v_band."min" and v_band."max")
        and (new.price is null or new.price between v_band."min" and v_band."max"),
        format('package price must stay inside the %s band for %s', new.unit, v_city)
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger service_packages_validate
  before insert or update of provider_service_id, package_template_id, title, price_type, price, price_min, price_max,
    unit, qty_min, qty_max, deliverables, usage_rights, inclusions, exclusions
  on public.service_packages
  for each row execute function public._validate_service_package();

create trigger service_packages_validate_content
  before insert or update on public.service_packages
  for each row execute function public._validate_package_row();

insert into public.package_templates (
  category_id, title, description, price_type, unit, qty_min, qty_max, deliverables,
  turnaround_days, revisions_included, raw_files_included, usage_rights, sort_order
)
select c.id, v.title, v.description, 'quote', v.unit, 1, 1, v.deliverables::jsonb, v.turnaround_days,
       v.revisions, v.raw_files, v.usage_rights::jsonb, 1
  from (values
    ('instagram-influencer', 'Brand collaboration package', 'A custom influencer campaign, final scope agreed before payment.', 'job',
      '[{"type":"branded_post","qty":1,"spec":"Final platform, format and caption agreed in proposal"}]', 7, 1, false,
      '{"organic_posting":true,"paid_ads_days":0,"exclusivity_days":0}'),
    ('youtube-creator', 'Sponsored video package', 'A custom YouTube collaboration with disclosure and final deliverables agreed before payment.', 'job',
      '[{"type":"video_integration","qty":1,"spec":"Integration or dedicated format agreed in proposal"}]', 14, 1, false,
      '{"organic_posting":true,"paid_ads_days":0,"exclusivity_days":0}'),
    ('ugc-creator', 'UGC deliverables package', 'Brand-use content created without posting on the provider account.', 'job',
      '[{"type":"ugc_video","qty":1,"spec":"Aspect ratio, script and usage window agreed in proposal"}]', 7, 1, true,
      '{"organic_posting":true,"paid_ads_days":0,"exclusivity_days":0}'),
    ('reel-maker', 'Edited reel package', 'One edited short-form reel; shoot and raw-file terms are agreed in the proposal.', 'job',
      '[{"type":"edited_reel","qty":1,"spec":"Final duration, ratio and resolution agreed in proposal"}]', 5, 2, false,
      '{"organic_posting":true,"paid_ads_days":0,"exclusivity_days":0}'),
    ('wedding-photographer', 'Wedding photography package', 'Custom wedding coverage and final photo deliverables.', 'day',
      '[{"type":"edited_photos","qty":100,"spec":"Minimum count and edit style agreed in proposal"}]', 21, 2, false, '{}'),
    ('candid-photographer', 'Candid photography package', 'Custom candid coverage and edited-photo delivery.', 'day',
      '[{"type":"edited_photos","qty":75,"spec":"Coverage window and final count agreed in proposal"}]', 14, 2, false, '{}'),
    ('pre-wedding-shoot', 'Pre-wedding photo package', 'Custom location shoot with an agreed shortlist and final edits.', 'session',
      '[{"type":"edited_photos","qty":30,"spec":"Locations and outfit count agreed in proposal"}]', 14, 2, false, '{}'),
    ('maternity-newborn', 'Maternity or newborn session', 'A safe, custom photo session for maternity, newborn or family portraits.', 'session',
      '[{"type":"edited_photos","qty":20,"spec":"Session duration and setup agreed in proposal"}]', 14, 2, false, '{}'),
    ('product-photographer', 'Product photography package', 'Product photography with the final shot list, backgrounds and retouching agreed.', 'job',
      '[{"type":"edited_product_photo","qty":10,"spec":"Angles, dimensions and background agreed in proposal"}]', 7, 2, false, '{}'),
    ('event-videographer', 'Event video package', 'Custom event coverage with final formats and delivery length agreed.', 'day',
      '[{"type":"event_film","qty":1,"spec":"Coverage hours and final runtime agreed in proposal"}]', 30, 2, false, '{}'),
    ('drone-operator', 'Drone coverage package', 'Licensed drone coverage subject to location permissions and weather.', 'hour',
      '[{"type":"drone_footage","qty":1,"spec":"Final duration, resolution and raw-footage terms agreed in proposal"}]', 7, 1, false, '{}'),
    ('photo-booth', 'Photo booth package', 'Photo booth setup, attendant and print or digital terms agreed before payment.', 'hour',
      '[{"type":"photo_booth_session","qty":1,"spec":"Hours, print count and props agreed in proposal"}]', 0, 0, false, '{}'),
    ('caterer', 'Custom catering package', 'A menu, per-plate scope, service style and guest range agreed in a proposal.', 'person',
      '[{"type":"meal_service","qty":1,"spec":"Menu tier, guest count and service style agreed per proposal"}]', 0, 0, false, '{}'),
    ('decorator', 'Custom decor package', 'Theme, venue, setup and teardown scope agreed in a proposal.', 'event',
      '[{"type":"decor_setup","qty":1,"spec":"Materials, venue dimensions and teardown agreed in proposal"}]', 0, 0, false, '{}'),
    ('bridal-makeup', 'Bridal makeup package', 'Bridal makeup package with final look, trial and travel terms agreed.', 'session',
      '[{"type":"bridal_look","qty":1,"spec":"Look, products, trial and travel agreed in proposal"}]', 0, 0, false, '{}'),
    ('mehendi-artist', 'Custom mehendi package', 'Mehendi scope and design complexity agreed before the event.', 'event',
      '[{"type":"mehendi_service","qty":1,"spec":"Guest count, hand coverage and design style agreed in proposal"}]', 0, 0, false, '{}'),
    ('dj', 'DJ performance package', 'DJ set, hours, equipment and sound scope agreed in a proposal.', 'hour',
      '[{"type":"dj_performance","qty":1,"spec":"Hours, genres, equipment and venue requirements agreed in proposal"}]', 0, 0, false, '{}'),
    ('live-band', 'Live band performance package', 'Band set, line-up, hours, equipment and sound scope agreed in a proposal.', 'hour',
      '[{"type":"live_performance","qty":1,"spec":"Set count, members, equipment and venue requirements agreed in proposal"}]', 0, 0, false, '{}'),
    ('wedding-planner', 'Wedding planning package', 'Planning mode, budget, guest count, vendor scope and milestones agreed in a proposal.', 'event',
      '[{"type":"planning_service","qty":1,"spec":"Planning mode, vendor scope and milestones agreed in proposal"}]', 0, 1, false, '{}')
  ) as v(slug, title, description, unit, deliverables, turnaround_days, revisions, raw_files, usage_rights)
  join public.categories c on c.slug = v.slug
on conflict (category_id, title) do update
set description = excluded.description,
    price_type = excluded.price_type,
    unit = excluded.unit,
    qty_min = excluded.qty_min,
    qty_max = excluded.qty_max,
    deliverables = excluded.deliverables,
    turnaround_days = excluded.turnaround_days,
    revisions_included = excluded.revisions_included,
    raw_files_included = excluded.raw_files_included,
    usage_rights = excluded.usage_rights,
    active = true;

-- ---------------------------------------------------------------------------
-- RLS and provider/admin APIs
-- ---------------------------------------------------------------------------
alter table public.package_templates enable row level security;
alter table public.price_bands enable row level security;
alter table public.service_packages enable row level security;

revoke all on public.package_templates, public.price_bands, public.service_packages from anon, authenticated;
grant select on public.package_templates, public.price_bands, public.service_packages to anon, authenticated;
grant insert, update, delete on public.package_templates, public.price_bands to authenticated;
grant insert, update, delete on public.service_packages to authenticated;
grant all on public.package_templates, public.price_bands, public.service_packages to service_role;

create policy package_templates_public_read on public.package_templates
  for select to anon, authenticated
  using (
    active and exists (
      select 1 from public.categories c where c.id = package_templates.category_id and c.active
    )
  );
create policy package_templates_admin_all on public.package_templates
  for all to authenticated
  using (public._is_admin())
  with check (public._is_admin());

create policy price_bands_public_read on public.price_bands
  for select to anon, authenticated
  using (
    active and exists (
      select 1 from public.categories c where c.id = price_bands.category_id and c.active
    )
  );
create policy price_bands_admin_all on public.price_bands
  for all to authenticated
  using (public._is_admin())
  with check (public._is_admin());

create policy service_packages_owner_read on public.service_packages
  for select to authenticated
  using (exists (
    select 1 from public.provider_services ps
     where ps.id = service_packages.provider_service_id and ps.provider_id = auth.uid()
  ));
create policy service_packages_public_read on public.service_packages
  for select to anon, authenticated
  using (
    active
    and exists (
      select 1
        from public.provider_services ps
        join public.categories c on c.id = ps.category_id
       where ps.id = service_packages.provider_service_id
         and ps.active
         and c.active
         and public._provider_is_live(ps.provider_id)
         and public._category_docs_ok(ps.provider_id, ps.category_id)
    )
  );
create policy service_packages_owner_insert on public.service_packages
  for insert to authenticated
  with check (exists (
    select 1 from public.provider_services ps
     where ps.id = service_packages.provider_service_id and ps.provider_id = auth.uid()
  ));
create policy service_packages_owner_update on public.service_packages
  for update to authenticated
  using (exists (
    select 1 from public.provider_services ps
     where ps.id = service_packages.provider_service_id and ps.provider_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.provider_services ps
     where ps.id = service_packages.provider_service_id and ps.provider_id = auth.uid()
  ));
create policy service_packages_owner_delete on public.service_packages
  for delete to authenticated
  using (exists (
    select 1 from public.provider_services ps
     where ps.id = service_packages.provider_service_id and ps.provider_id = auth.uid()
  ));

create or replace function public.copy_provider_package_template(
  p_provider_service_id uuid,
  p_template_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_category_id uuid;
  v_id uuid;
begin
  select category_id into v_category_id
    from public.provider_services
   where id = p_provider_service_id and provider_id = v_uid;
  perform public._assert(v_category_id is not null, 'provider service not found');

  insert into public.service_packages (
    provider_service_id, package_template_id, title, description, price_type, price, price_min, price_max,
    unit, qty_min, qty_max, duration_min, inclusions, exclusions, deliverables, turnaround_days,
    revisions_included, raw_files_included, usage_rights, travel_included_km, active, sort_order
  )
  select p_provider_service_id, t.id, t.title, t.description, t.price_type, t.price, t.price_min, t.price_max,
         t.unit, t.qty_min, t.qty_max, t.duration_min, t.inclusions, t.exclusions, t.deliverables, t.turnaround_days,
         t.revisions_included, t.raw_files_included, t.usage_rights, t.travel_included_km, false, t.sort_order
    from public.package_templates t
   where t.id = p_template_id and t.category_id = v_category_id and t.active
  returning id into v_id;
  perform public._assert(v_id is not null, 'package template not found for this service');
  return v_id;
end;
$$;

create or replace function public.save_provider_service_package(
  p_package_id uuid,
  p_provider_service_id uuid,
  p_package jsonb
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
  perform public._assert(jsonb_typeof(coalesce(p_package, '{}'::jsonb)) = 'object', 'package must be an object');
  perform public._assert(
    exists(select 1 from public.provider_services where id = p_provider_service_id and provider_id = v_uid),
    'provider service not found'
  );
  if p_package_id is not null then
    perform public._assert(
      exists(
        select 1
          from public.service_packages sp
          join public.provider_services ps on ps.id = sp.provider_service_id
         where sp.id = p_package_id
           and sp.provider_service_id = p_provider_service_id
           and ps.provider_id = v_uid
      ),
      'package not found'
    );
  end if;

  insert into public.service_packages (
    id, provider_service_id, title, description, price_type, price, price_min, price_max,
    unit, qty_min, qty_max, duration_min, inclusions, exclusions, deliverables, turnaround_days,
    revisions_included, raw_files_included, usage_rights, travel_included_km, active, sort_order
  )
  values (
    coalesce(p_package_id, gen_random_uuid()), p_provider_service_id,
    coalesce(p_package ->> 'title', ''), coalesce(p_package ->> 'description', ''),
    coalesce(p_package ->> 'price_type', 'fixed'),
    case when p_package ? 'price' and p_package ->> 'price' <> '' then (p_package ->> 'price')::int else null end,
    case when p_package ? 'price_min' and p_package ->> 'price_min' <> '' then (p_package ->> 'price_min')::int else null end,
    case when p_package ? 'price_max' and p_package ->> 'price_max' <> '' then (p_package ->> 'price_max')::int else null end,
    coalesce(p_package ->> 'unit', 'job'),
    coalesce((p_package ->> 'qty_min')::numeric, 1), coalesce((p_package ->> 'qty_max')::numeric, 1),
    case when p_package ? 'duration_min' then (p_package ->> 'duration_min')::int else null end,
    coalesce(array(select trim(value) from jsonb_array_elements_text(coalesce(p_package -> 'inclusions', '[]'::jsonb))), '{}'),
    coalesce(array(select trim(value) from jsonb_array_elements_text(coalesce(p_package -> 'exclusions', '[]'::jsonb))), '{}'),
    coalesce(p_package -> 'deliverables', '[]'::jsonb),
    case when p_package ? 'turnaround_days' then (p_package ->> 'turnaround_days')::int else null end,
    coalesce((p_package ->> 'revisions_included')::int, 0),
    coalesce((p_package ->> 'raw_files_included')::boolean, false),
    coalesce(p_package -> 'usage_rights', '{}'::jsonb),
    coalesce((p_package ->> 'travel_included_km')::numeric, 0),
    coalesce((p_package ->> 'active')::boolean, true),
    coalesce((p_package ->> 'sort_order')::int, 0)
  )
  on conflict (id) do update
  set title = excluded.title,
      description = excluded.description,
      price_type = excluded.price_type,
      price = excluded.price,
      price_min = excluded.price_min,
      price_max = excluded.price_max,
      unit = excluded.unit,
      qty_min = excluded.qty_min,
      qty_max = excluded.qty_max,
      duration_min = excluded.duration_min,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      deliverables = excluded.deliverables,
      turnaround_days = excluded.turnaround_days,
      revisions_included = excluded.revisions_included,
      raw_files_included = excluded.raw_files_included,
      usage_rights = excluded.usage_rights,
      travel_included_km = excluded.travel_included_km,
      active = excluded.active,
      sort_order = excluded.sort_order
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_provider_service_package(p_package_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  delete from public.service_packages sp
   where sp.id = p_package_id
     and exists (
       select 1 from public.provider_services ps
        where ps.id = sp.provider_service_id and ps.provider_id = v_uid
     );
  perform public._assert(found, 'package not found');
end;
$$;

revoke execute on function
  public._validate_package_content(jsonb, jsonb, text[], text[]),
  public.copy_provider_package_template(uuid, uuid),
  public.save_provider_service_package(uuid, uuid, jsonb),
  public.delete_provider_service_package(uuid)
from public, anon;
grant execute on function public.copy_provider_package_template(uuid, uuid) to authenticated;
grant execute on function public.save_provider_service_package(uuid, uuid, jsonb) to authenticated;
grant execute on function public.delete_provider_service_package(uuid) to authenticated;

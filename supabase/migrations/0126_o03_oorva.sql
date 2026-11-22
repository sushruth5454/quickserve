-- MIG-O03: fail-closed Oorva controls and immutable, versioned branding publication.

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values
  ('oorva_brand', false, 'Oorva brand & colours', 'Existing bundled identity/palettes remain; native installed assets cannot remotely revert', 'Appearance', 200),
  ('branding_runtime', false, 'Published appearance', 'Use bundled Oorva design when brand is ON, not a half-applied remote config', 'Branding', 201),
  ('branding_editor', false, 'Branding editor', 'No new drafts/uploads/ordinary publishes; current version and admin recovery remain readable', 'Branding', 202),
  ('oorva_launch_animation', false, 'Oorva launch motion', 'No in-app reveal animation; never disable native startup', 'Branding', 203),
  ('oorva_home_ux', false, 'Oorva home and search', 'Existing home/search layout and routing retained', 'Oorva experience', 204),
  ('oorva_auth_ux', false, 'Oorva authentication and location', 'Existing OTP/location layouts retained', 'Oorva experience', 205),
  ('oorva_catalogue_ux', false, 'Oorva service discovery', 'Existing category/provider layouts retained', 'Oorva experience', 206),
  ('oorva_booking_ux', false, 'Oorva booking presentation', 'Existing booking/activity/receipt presentation retained', 'Oorva experience', 207),
  ('oorva_recurring_ux', false, 'Oorva recurring presentation', 'Existing plan/calendar presentation retained', 'Oorva experience', 208),
  ('oorva_shops_ux', false, 'Oorva shops presentation', 'Existing shops/products presentation retained', 'Oorva experience', 209),
  ('oorva_rfq_ux', false, 'Oorva enquiry and RFQ presentation', 'Existing RFQ/enquiry presentation retained', 'Oorva experience', 210),
  ('oorva_sports_ux', false, 'Oorva sports presentation', 'Existing sports presentation retained', 'Oorva experience', 211),
  ('oorva_creators_ux', false, 'Oorva creator presentation', 'Existing creator/proposal presentation retained', 'Oorva experience', 212),
  ('oorva_account_ux', false, 'Oorva account and rewards', 'Existing account/legal/rewards layouts retained', 'Oorva experience', 213),
  ('oorva_comms_ux', false, 'Oorva notifications and support', 'Existing notification/chat/support layouts retained', 'Oorva experience', 214),
  ('oorva_provider_ux', false, 'Oorva provider workspace', 'Existing owner/staff dashboard/job presentation retained', 'Oorva experience', 215),
  ('oorva_onboarding_ux', false, 'Oorva provider onboarding', 'Existing onboarding/edit presentation retained', 'Oorva experience', 216),
  ('oorva_merchant_shop_ux', false, 'Oorva shop workspace', 'Existing shop editor/enquiry presentation retained', 'Oorva experience', 217),
  ('oorva_business_staff_ux', false, 'Oorva business tools', 'Existing membership/invite/supplier workspace retained', 'Oorva experience', 218),
  ('oorva_venue_ops_ux', false, 'Oorva venue workspace', 'Existing venue-management presentation retained', 'Oorva experience', 219),
  ('oorva_admin_ops_ux', false, 'Oorva admin operations', 'Existing overview/review/support queue presentation retained', 'Oorva experience', 220),
  ('oorva_admin_config_ux', false, 'Oorva admin configuration', 'Existing configuration/catalogue presentation retained', 'Oorva experience', 221),
  ('oorva_admin_money_ux', false, 'Oorva admin financial views', 'Existing financial views/controls retained', 'Oorva experience', 222),
  ('oorva_ai_ux', false, 'Oorva AI presentation', 'Existing AI presentation retained; ai_assistant still controls capability', 'Oorva experience', 223),
  ('oorva_external_brand', false, 'Oorva outbound display identity', 'Existing outbound display identity; historical records never rewritten', 'Branding', 224)
on conflict (key) do nothing;

create table public.app_branding_versions (
  id uuid primary key,
  version_number bigint generated always as identity unique,
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  schema_version smallint not null check (schema_version = 1),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  validation_version smallint not null check (validation_version = 1),
  soft_policy_revision bigint not null check (soft_policy_revision >= 1)
);

create index app_branding_versions_created_idx
  on public.app_branding_versions (version_number desc);

create table public.app_branding_state (
  singleton boolean primary key default true check (singleton),
  published_version_id uuid references public.app_branding_versions (id) on delete restrict,
  generation bigint not null default 0 check (generation >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete restrict
);

insert into public.app_branding_state (singleton, published_version_id, generation)
values (true, null, 0)
on conflict (singleton) do nothing;

create table public.app_branding_publications (
  id uuid primary key default gen_random_uuid(),
  generation bigint not null unique check (generation > 0),
  publication_kind text not null check (publication_kind in ('publish', 'rollback')),
  previous_version_id uuid references public.app_branding_versions (id) on delete restrict,
  target_version_id uuid not null references public.app_branding_versions (id) on delete restrict,
  reason text not null check (char_length(reason) between 1 and 500),
  actor_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index app_branding_publications_target_idx
  on public.app_branding_publications (target_version_id, generation desc);

create table public.app_branding_assets (
  id uuid primary key,
  object_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null check (mime_type = 'image/png'),
  byte_length bigint not null check (byte_length between 1 and 2097152),
  width integer not null check (width between 32 and 4096),
  height integer not null check (height between 32 and 4096),
  uploaded_by uuid not null references auth.users (id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  validated_at timestamptz,
  published_once boolean not null default false,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete restrict,
  revoke_reason text,
  constraint app_branding_assets_fixed_path check (object_path = 'branding/' || id::text || '.png'),
  constraint app_branding_assets_pixel_ceiling check (width::bigint * height::bigint <= 16777216),
  constraint app_branding_assets_revocation_pair check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (
      revoked_at is not null and revoked_by is not null and revoke_reason is not null
      and char_length(revoke_reason) between 1 and 500
    )
  )
);

create index app_branding_assets_revoked_idx
  on public.app_branding_assets (revoked_at, id);

insert into public.app_config (key, value)
values (
  'branding_policy',
  '{
    "revision": 1,
    "maxUploadBytes": 2097152,
    "minImageDimension": 32,
    "maxImageDimension": 4096,
    "maxImagePixels": 16777216,
    "maxPromotions": 6,
    "maxAppearanceBytes": 32768,
    "maxDisplayNameLength": 32,
    "maxTaglineLength": 80
  }'::jsonb
)
on conflict (key) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding-assets', 'branding-assets', false, 2097152, array['image/png']::text[])
on conflict (id) do update
  set name = excluded.name,
      public = false,
      file_size_limit = least(coalesce(storage.buckets.file_size_limit, excluded.file_size_limit), excluded.file_size_limit),
      allowed_mime_types = array['image/png']::text[];

drop policy if exists branding_assets_private_guard on storage.objects;
create policy branding_assets_private_guard
  on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id is distinct from 'branding-assets')
  with check (bucket_id is distinct from 'branding-assets');

alter table public.app_branding_versions enable row level security;
alter table public.app_branding_state enable row level security;
alter table public.app_branding_publications enable row level security;
alter table public.app_branding_assets enable row level security;
revoke all on public.app_branding_versions, public.app_branding_state,
  public.app_branding_publications, public.app_branding_assets
  from public, anon, authenticated, service_role;
revoke all on sequence public.app_branding_versions_version_number_seq
  from public, anon, authenticated, service_role;

create or replace function public._oorva_feature_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with recursive feature_parent(key, parent_key) as (
    values
      ('oorva_brand'::text, null::text),
      ('branding_runtime', 'oorva_brand'),
      ('branding_editor', 'branding_runtime'),
      ('oorva_launch_animation', 'oorva_brand'),
      ('oorva_home_ux', 'oorva_brand'),
      ('oorva_auth_ux', 'oorva_brand'),
      ('oorva_catalogue_ux', 'oorva_brand'),
      ('oorva_booking_ux', 'oorva_brand'),
      ('oorva_recurring_ux', 'oorva_brand'),
      ('oorva_shops_ux', 'oorva_brand'),
      ('oorva_rfq_ux', 'oorva_brand'),
      ('oorva_sports_ux', 'oorva_brand'),
      ('oorva_creators_ux', 'oorva_brand'),
      ('oorva_account_ux', 'oorva_brand'),
      ('oorva_comms_ux', 'oorva_brand'),
      ('oorva_provider_ux', 'oorva_brand'),
      ('oorva_onboarding_ux', 'oorva_brand'),
      ('oorva_merchant_shop_ux', 'oorva_brand'),
      ('oorva_business_staff_ux', 'oorva_brand'),
      ('oorva_venue_ops_ux', 'oorva_brand'),
      ('oorva_admin_ops_ux', 'oorva_brand'),
      ('oorva_admin_config_ux', 'oorva_brand'),
      ('oorva_admin_money_ux', 'oorva_brand'),
      ('oorva_ai_ux', 'oorva_brand'),
      ('oorva_external_brand', 'oorva_brand')
  ),
  feature_chain(key, parent_key, enabled) as (
    select p.key, p.parent_key, coalesce(f.enabled, false)
      from feature_parent as p
      left join public.feature_flags as f on f.key = p.key
     where p.key = p_key
    union all
    select p.key, p.parent_key, coalesce(f.enabled, false)
      from feature_chain as c
      join feature_parent as p on p.key = c.parent_key
      left join public.feature_flags as f on f.key = p.key
  )
  select coalesce(bool_and(enabled), false)
    from feature_chain;
$$;

create or replace function public._branding_validate_policy(p_policy jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_key text;
  v_max_upload_bytes integer;
  v_min_dimension integer;
  v_max_dimension integer;
  v_max_pixels integer;
  v_max_promotions integer;
  v_max_appearance_bytes integer;
  v_max_display_name integer;
  v_max_tagline integer;
  v_required text[] := array[
    'maxUploadBytes', 'minImageDimension', 'maxImageDimension', 'maxImagePixels',
    'maxPromotions', 'maxAppearanceBytes', 'maxDisplayNameLength', 'maxTaglineLength'
  ];
begin
  if jsonb_typeof(p_policy) is distinct from 'object' then
    raise exception 'policy must be an object' using errcode = '22023';
  end if;

  foreach v_key in array v_required loop
    if not (p_policy ? v_key) then
      raise exception 'policy.% is required', v_key using errcode = '22023';
    end if;
  end loop;
  for v_key in select key from jsonb_object_keys(p_policy) as keys(key) loop
    if not (v_key = any(v_required)) then
      raise exception 'policy.% is not allowed', v_key using errcode = '22023';
    end if;
  end loop;

  foreach v_key in array v_required loop
    if jsonb_typeof(p_policy -> v_key) is distinct from 'number' then
      raise exception 'policy.% must be an integer', v_key using errcode = '22023';
    end if;
    if (p_policy ->> v_key)::numeric <> trunc((p_policy ->> v_key)::numeric) then
      raise exception 'policy.% must be an integer', v_key using errcode = '22023';
    end if;
  end loop;

  v_max_upload_bytes := (p_policy ->> 'maxUploadBytes')::integer;
  v_min_dimension := (p_policy ->> 'minImageDimension')::integer;
  v_max_dimension := (p_policy ->> 'maxImageDimension')::integer;
  v_max_pixels := (p_policy ->> 'maxImagePixels')::integer;
  v_max_promotions := (p_policy ->> 'maxPromotions')::integer;
  v_max_appearance_bytes := (p_policy ->> 'maxAppearanceBytes')::integer;
  v_max_display_name := (p_policy ->> 'maxDisplayNameLength')::integer;
  v_max_tagline := (p_policy ->> 'maxTaglineLength')::integer;

  if v_max_upload_bytes not between 1 and 2097152 then
    raise exception 'policy.maxUploadBytes must be from 1 to 2097152' using errcode = '22023';
  end if;
  if v_min_dimension not between 32 and 4096 then
    raise exception 'policy.minImageDimension must be from 32 to 4096' using errcode = '22023';
  end if;
  if v_max_dimension not between v_min_dimension and 4096 then
    raise exception 'policy.maxImageDimension must be at least minImageDimension and at most 4096' using errcode = '22023';
  end if;
  if v_max_pixels not between v_min_dimension::bigint * v_min_dimension::bigint and 16777216 then
    raise exception 'policy.maxImagePixels is outside the hard image ceiling' using errcode = '22023';
  end if;
  if v_max_promotions not between 0 and 6 then
    raise exception 'policy.maxPromotions must be from 0 to 6' using errcode = '22023';
  end if;
  if v_max_appearance_bytes not between 1 and 32768 then
    raise exception 'policy.maxAppearanceBytes must be from 1 to 32768' using errcode = '22023';
  end if;
  if v_max_display_name not between 2 and 32 then
    raise exception 'policy.maxDisplayNameLength must be from 2 to 32' using errcode = '22023';
  end if;
  if v_max_tagline not between 0 and 80 then
    raise exception 'policy.maxTaglineLength must be from 0 to 80' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'maxUploadBytes', v_max_upload_bytes,
    'minImageDimension', v_min_dimension,
    'maxImageDimension', v_max_dimension,
    'maxImagePixels', v_max_pixels,
    'maxPromotions', v_max_promotions,
    'maxAppearanceBytes', v_max_appearance_bytes,
    'maxDisplayNameLength', v_max_display_name,
    'maxTaglineLength', v_max_tagline
  );
end;
$$;

create or replace function public._branding_validate_config(p_config jsonb, p_recovery boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_key text;
  v_text text;
  v_value jsonb;
  v_duration numeric;
  v_policy jsonb;
  v_max_appearance_bytes integer := 32768;
  v_max_display_name integer := 32;
  v_max_tagline integer := 80;
  v_max_promotions integer := 6;
  v_promotions integer;
  v_json_stack jsonb[] := array[]::jsonb[];
  v_json_node jsonb;
  v_json_child record;
  v_json_count integer;
  v_compact_bytes integer := 0;
  v_allowed_color_keys text[] := array[
    'primary', 'primaryPressed', 'primarySoft', 'primaryText', 'onPrimary',
    'secondary', 'accent', 'onAccent', 'success', 'successStrong', 'successSoft',
    'successText', 'warning', 'warningSoft', 'warningText', 'danger', 'dangerStrong',
    'dangerPressed', 'onDanger', 'dangerSoft', 'dangerText', 'info', 'infoSoft',
    'infoText', 'text', 'textSecondary', 'muted', 'subtle', 'bg', 'surface',
    'surfaceAlt', 'surfaceRaised', 'surfaceOverlay', 'border', 'borderStrong',
    'outline', 'star', 'skeleton', 'bubbleMine', 'bubbleTheirs', 'heroFrom',
    'heroTo', 'onHero', 'onInverse', 'toastBg', 'toastBorder', 'segmentThumb',
    'catHome', 'catHomeSoft', 'catHomeText', 'catShops', 'catShopsSoft',
    'catShopsText', 'catSports', 'catSportsSoft', 'catSportsText', 'catCreators',
    'catCreatorsSoft', 'catCreatorsText'
  ];
  v_required_root text[] := array[
    'schemaVersion', 'displayName', 'tagline', 'defaultTheme', 'headingFont',
    'assets', 'light', 'dark', 'motion'
  ];
  v_required_assets text[] := array[
    'logoLight', 'logoDark', 'compactLight', 'compactDark', 'promotional'
  ];
  v_light_defaults jsonb := '{
    "text":"#202B29","bg":"#F7F5EF","surface":"#FFFFFF","surfaceAlt":"#F0F2EB",
    "surfaceRaised":"#FFFFFF","surfaceOverlay":"#FFFFFF","segmentThumb":"#FFFFFF",
    "bubbleTheirs":"#E4EFE9","textSecondary":"#344B65","borderStrong":"#D1D8D0",
    "muted":"#606B65","primaryText":"#173D39","primarySoft":"#E4EFE9",
    "onPrimary":"#FFFFFF","primary":"#173D39","primaryPressed":"#102D2A",
    "bubbleMine":"#173D39","successText":"#1F6848","successSoft":"#E5F3EB",
    "warningText":"#765017","warningSoft":"#F7EDDC","dangerText":"#A43737",
    "dangerSoft":"#FBECEC","infoText":"#28577D","infoSoft":"#E7F0F7",
    "onDanger":"#FFFFFF","dangerStrong":"#A43737","dangerPressed":"#852C2C",
    "onAccent":"#173D39","accent":"#D5A65B","onHero":"#F7F5EF",
    "heroFrom":"#173D39","heroTo":"#102D2A","onInverse":"#F7F5EF",
    "toastBg":"#102D2A","catHomeText":"#28593D","catHomeSoft":"#E4F0E9",
    "catShopsText":"#335E8C","catShopsSoft":"#E6EDF6","catSportsText":"#765017",
    "catSportsSoft":"#F7EDDC","catCreatorsText":"#694A80","catCreatorsSoft":"#F0E9F5"
  }'::jsonb;
  v_dark_defaults jsonb := '{
    "text":"#F3F4ED","bg":"#101C18","surface":"#182923","surfaceAlt":"#20352D",
    "surfaceRaised":"#284236","surfaceOverlay":"#284236","segmentThumb":"#284236",
    "bubbleTheirs":"#20352D","textSecondary":"#D5DDD6","borderStrong":"#486556",
    "muted":"#A7B6AC","primaryText":"#B9DAC8","primarySoft":"#1C3B32",
    "onPrimary":"#102D2A","primary":"#A9CFBC","primaryPressed":"#8FBBA6",
    "bubbleMine":"#A9CFBC","successText":"#8BDDB0","successSoft":"#18372A",
    "warningText":"#F0C982","warningSoft":"#3B2E18","dangerText":"#F3B1B1",
    "dangerSoft":"#3A2020","infoText":"#B3D6F1","infoSoft":"#1B3041",
    "onDanger":"#FFFFFF","dangerStrong":"#A43737","dangerPressed":"#852C2C",
    "onAccent":"#102D2A","accent":"#D5A65B","onHero":"#F7F5EF",
    "heroFrom":"#173D39","heroTo":"#102D2A","onInverse":"#F7F5EF",
    "toastBg":"#102D2A","catHomeText":"#B9DEC5","catHomeSoft":"#1B3627",
    "catShopsText":"#BAD3EF","catShopsSoft":"#1D3047","catSportsText":"#F0CB8F",
    "catSportsSoft":"#3B2E18","catCreatorsText":"#D9C2E8","catCreatorsSoft":"#31253C"
  }'::jsonb;
  v_theme record;
  v_pair record;
  v_colors jsonb;
  v_foreground text;
  v_background text;
  v_foreground_luminance double precision;
  v_background_luminance double precision;
  v_contrast double precision;
begin
  if jsonb_typeof(p_config) is distinct from 'object' then
    raise exception 'appearance must be an object' using errcode = '22023';
  end if;
  v_json_stack := array[p_config];
  while cardinality(v_json_stack) > 0 loop
    v_json_node := v_json_stack[cardinality(v_json_stack)];
    v_json_stack := v_json_stack[1:cardinality(v_json_stack) - 1];
    case jsonb_typeof(v_json_node)
      when 'object' then
        select count(*)::integer into v_json_count
          from jsonb_object_keys(v_json_node) as keys(key);
        v_compact_bytes := v_compact_bytes + 2 + greatest(v_json_count - 1, 0);
        for v_json_child in select key, value from jsonb_each(v_json_node) loop
          v_compact_bytes := v_compact_bytes + octet_length(to_jsonb(v_json_child.key)::text) + 1;
          v_json_stack := array_append(v_json_stack, v_json_child.value);
        end loop;
      when 'array' then
        select count(*)::integer into v_json_count
          from jsonb_array_elements(v_json_node) as items(value);
        v_compact_bytes := v_compact_bytes + 2 + greatest(v_json_count - 1, 0);
        for v_json_child in select value from jsonb_array_elements(v_json_node) as items(value) loop
          v_json_stack := array_append(v_json_stack, v_json_child.value);
        end loop;
      when 'string' then
        v_compact_bytes := v_compact_bytes + octet_length(to_jsonb(v_json_node #>> '{}')::text);
      else
        v_compact_bytes := v_compact_bytes + octet_length(v_json_node::text);
    end case;
    if v_compact_bytes > 32768 then
      raise exception 'appearance exceeds the 32 KiB hard limit' using errcode = '22023';
    end if;
  end loop;
  if v_compact_bytes > 32768 then
    raise exception 'appearance exceeds the 32 KiB hard limit' using errcode = '22023';
  end if;

  foreach v_key in array v_required_root loop
    if not (p_config ? v_key) then
      raise exception 'appearance.% is required', v_key using errcode = '22023';
    end if;
  end loop;
  for v_key in select key from jsonb_object_keys(p_config) as keys(key) loop
    if not (v_key = any(v_required_root)) then
      raise exception 'appearance.% is not allowed', v_key using errcode = '22023';
    end if;
  end loop;

  if jsonb_typeof(p_config -> 'schemaVersion') is distinct from 'number'
     or (p_config ->> 'schemaVersion')::numeric <> 1 then
    raise exception 'schemaVersion must be 1' using errcode = '22023';
  end if;

  foreach v_key in array array['displayName', 'tagline'] loop
    if jsonb_typeof(p_config -> v_key) is distinct from 'string' then
      raise exception '% must be text', v_key using errcode = '22023';
    end if;
    v_text := p_config ->> v_key;
    if (v_key = 'displayName' and char_length(v_text) not between 2 and 32)
       or (v_key = 'tagline' and char_length(v_text) not between 0 and 80) then
      raise exception '% has an invalid length', v_key using errcode = '22023';
    end if;
    if v_text <> btrim(v_text)
       or v_text ~ '[[:cntrl:]<>]'
       or v_text ~* '(https?|javascript|data):|www\.'
       or exists (
         select 1
           from generate_series(8234, 8238) as codepoint
          where strpos(v_text, chr(codepoint)) > 0
       )
       or exists (
         select 1
           from generate_series(8294, 8297) as codepoint
          where strpos(v_text, chr(codepoint)) > 0
       ) then
      raise exception '% contains unsafe text', v_key using errcode = '22023';
    end if;
  end loop;

  if jsonb_typeof(p_config -> 'defaultTheme') is distinct from 'string'
     or p_config ->> 'defaultTheme' not in ('system', 'light', 'dark') then
    raise exception 'defaultTheme must be system, light, or dark' using errcode = '22023';
  end if;
  if jsonb_typeof(p_config -> 'headingFont') is distinct from 'string'
     or p_config ->> 'headingFont' not in ('manrope', 'inter') then
    raise exception 'headingFont must be manrope or inter' using errcode = '22023';
  end if;
  if p_config ->> 'headingFont' <> 'inter' then
    raise exception 'headingFont manrope is not bundled' using errcode = '22023';
  end if;

  if jsonb_typeof(p_config -> 'assets') is distinct from 'object' then
    raise exception 'assets must be an object' using errcode = '22023';
  end if;
  foreach v_key in array v_required_assets loop
    if not ((p_config -> 'assets') ? v_key) then
      raise exception 'assets.% is required', v_key using errcode = '22023';
    end if;
  end loop;
  for v_key in select key from jsonb_object_keys(p_config -> 'assets') as keys(key) loop
    if not (v_key = any(v_required_assets)) then
      raise exception 'assets.% is not allowed', v_key using errcode = '22023';
    end if;
  end loop;
  foreach v_key in array array['logoLight', 'logoDark', 'compactLight', 'compactDark'] loop
    v_value := p_config -> 'assets' -> v_key;
    if jsonb_typeof(v_value) is distinct from 'null'
       and (
         jsonb_typeof(v_value) is distinct from 'string'
         or (v_value #>> '{}') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       ) then
      raise exception 'assets.% must be null or an asset UUID', v_key using errcode = '22023';
    end if;
  end loop;
  if jsonb_typeof(p_config -> 'assets' -> 'promotional') is distinct from 'array' then
    raise exception 'assets.promotional must be an array' using errcode = '22023';
  end if;
  v_promotions := jsonb_array_length(p_config -> 'assets' -> 'promotional');
  if v_promotions > 6 then
    raise exception 'assets.promotional must contain at most 6 asset UUIDs' using errcode = '22023';
  end if;
  for v_value in select value from jsonb_array_elements(p_config -> 'assets' -> 'promotional') as items(value) loop
    if jsonb_typeof(v_value) is distinct from 'string'
       or (v_value #>> '{}') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
      raise exception 'assets.promotional items must be asset UUIDs' using errcode = '22023';
    end if;
  end loop;

  if jsonb_typeof(p_config -> 'motion') is distinct from 'object' then
    raise exception 'motion must be an object' using errcode = '22023';
  end if;
  if not ((p_config -> 'motion') ? 'launchDurationMs')
     or exists (
       select 1 from jsonb_object_keys(p_config -> 'motion') as keys(key)
        where key <> 'launchDurationMs'
     ) then
    raise exception 'motion must contain only launchDurationMs' using errcode = '22023';
  end if;
  if jsonb_typeof(p_config -> 'motion' -> 'launchDurationMs') is distinct from 'number' then
    raise exception 'motion.launchDurationMs must be an integer from 0 to 1800' using errcode = '22023';
  end if;
  v_duration := (p_config -> 'motion' ->> 'launchDurationMs')::numeric;
  if v_duration <> trunc(v_duration) or v_duration not between 0 and 1800 then
    raise exception 'motion.launchDurationMs must be an integer from 0 to 1800' using errcode = '22023';
  end if;

  if not p_recovery then
    select c.value into v_policy
      from public.app_config as c
     where c.key = 'branding_policy';
    v_max_appearance_bytes := coalesce((v_policy ->> 'maxAppearanceBytes')::integer, 32768);
    v_max_display_name := coalesce((v_policy ->> 'maxDisplayNameLength')::integer, 32);
    v_max_tagline := coalesce((v_policy ->> 'maxTaglineLength')::integer, 80);
    v_max_promotions := coalesce((v_policy ->> 'maxPromotions')::integer, 6);
    if v_compact_bytes > v_max_appearance_bytes then
      raise exception 'appearance exceeds the current soft size limit' using errcode = '22023';
    end if;
    if char_length(p_config ->> 'displayName') > v_max_display_name then
      raise exception 'displayName exceeds the current soft limit' using errcode = '22023';
    end if;
    if char_length(p_config ->> 'tagline') > v_max_tagline then
      raise exception 'tagline exceeds the current soft limit' using errcode = '22023';
    end if;
    if v_promotions > v_max_promotions then
      raise exception 'assets.promotional exceeds the current soft limit' using errcode = '22023';
    end if;
  end if;

  for v_theme in
    select 'light'::text as mode, v_light_defaults as defaults, p_config -> 'light' as overrides
    union all
    select 'dark'::text as mode, v_dark_defaults as defaults, p_config -> 'dark' as overrides
  loop
    if jsonb_typeof(v_theme.overrides) is distinct from 'object' then
      raise exception '% must be an object', v_theme.mode using errcode = '22023';
    end if;
    for v_key in select key from jsonb_object_keys(v_theme.overrides) as keys(key) loop
      if not (v_key = any(v_allowed_color_keys)) then
        raise exception '%.% is not an allowed color token', v_theme.mode, v_key using errcode = '22023';
      end if;
      if jsonb_typeof(v_theme.overrides -> v_key) is distinct from 'string'
         or (v_theme.overrides ->> v_key) !~* '^#[0-9a-f]{6}$' then
        raise exception '%.% must be a six-digit hex color', v_theme.mode, v_key using errcode = '22023';
      end if;
    end loop;

    v_colors := v_theme.defaults || v_theme.overrides;
    for v_pair in
      select * from (values
        ('text','bg'), ('text','surface'), ('text','surfaceAlt'), ('text','surfaceRaised'),
        ('text','surfaceOverlay'), ('text','segmentThumb'), ('text','bubbleTheirs'),
        ('textSecondary','bg'), ('textSecondary','surface'), ('textSecondary','borderStrong'),
        ('muted','bg'), ('muted','surface'), ('muted','surfaceAlt'),
        ('primaryText','bg'), ('primaryText','surface'), ('primaryText','primarySoft'),
        ('onPrimary','primary'), ('onPrimary','primaryPressed'), ('onPrimary','bubbleMine'),
        ('successText','successSoft'), ('warningText','warningSoft'),
        ('dangerText','dangerSoft'), ('infoText','infoSoft'),
        ('onDanger','dangerStrong'), ('onDanger','dangerPressed'), ('onAccent','accent'),
        ('onHero','heroFrom'), ('onHero','heroTo'), ('onInverse','toastBg'),
        ('catHomeText','catHomeSoft'), ('catShopsText','catShopsSoft'),
        ('catSportsText','catSportsSoft'), ('catCreatorsText','catCreatorsSoft')
      ) as pairs(foreground, background)
    loop
      v_foreground := v_colors ->> v_pair.foreground;
      v_background := v_colors ->> v_pair.background;
      with channel_samples(kind, weight, channel) as (
        select 'foreground', 0.2126::double precision,
               get_byte(decode(substr(v_foreground, 2, 2), 'hex'), 0)::double precision / 255.0
        union all
        select 'foreground', 0.7152::double precision,
               get_byte(decode(substr(v_foreground, 4, 2), 'hex'), 0)::double precision / 255.0
        union all
        select 'foreground', 0.0722::double precision,
               get_byte(decode(substr(v_foreground, 6, 2), 'hex'), 0)::double precision / 255.0
        union all
        select 'background', 0.2126::double precision,
               get_byte(decode(substr(v_background, 2, 2), 'hex'), 0)::double precision / 255.0
        union all
        select 'background', 0.7152::double precision,
               get_byte(decode(substr(v_background, 4, 2), 'hex'), 0)::double precision / 255.0
        union all
        select 'background', 0.0722::double precision,
               get_byte(decode(substr(v_background, 6, 2), 'hex'), 0)::double precision / 255.0
      ),
      linear_samples as (
        select kind, weight,
               case when channel <= 0.04045
                    then channel / 12.92
                    else power((channel + 0.055) / 1.055, 2.4)
               end as linear_channel
          from channel_samples
      ),
      luminance as (
        select kind, sum(weight * linear_channel) as value
          from linear_samples
         group by kind
      )
      select max(value) filter (where kind = 'foreground'),
             max(value) filter (where kind = 'background')
        into v_foreground_luminance, v_background_luminance
        from luminance;

      v_contrast := (greatest(v_foreground_luminance, v_background_luminance) + 0.05)
                    / (least(v_foreground_luminance, v_background_luminance) + 0.05);
      if v_contrast < 4.5 then
        raise exception '%.%/% contrast is %:1; minimum is 4.5:1',
          v_theme.mode, v_pair.foreground, v_pair.background, round(v_contrast::numeric, 4)
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  return p_config;
end;
$$;

create or replace function public._branding_assets_publishable(p_config jsonb, p_recovery boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_config jsonb;
  v_asset_ids uuid[];
  v_asset_id uuid;
  v_asset public.app_branding_assets%rowtype;
  v_policy jsonb;
  v_max_upload_bytes integer := 2097152;
  v_min_dimension integer := 32;
  v_max_dimension integer := 4096;
  v_max_pixels integer := 16777216;
begin
  v_config := public._branding_validate_config(p_config, p_recovery);
  select coalesce(array_agg(distinct asset_id), array[]::uuid[])
    into v_asset_ids
    from (
      select (v_config -> 'assets' ->> slots.key)::uuid as asset_id
        from unnest(array['logoLight', 'logoDark', 'compactLight', 'compactDark']::text[]) as slots(key)
       where jsonb_typeof(v_config -> 'assets' -> slots.key) = 'string'
      union all
      select item.value::uuid
        from jsonb_array_elements_text(v_config -> 'assets' -> 'promotional') as item(value)
    ) as asset_refs;

  if not p_recovery then
    select c.value into v_policy
      from public.app_config as c
     where c.key = 'branding_policy';
    v_max_upload_bytes := coalesce((v_policy ->> 'maxUploadBytes')::integer, 2097152);
    v_min_dimension := coalesce((v_policy ->> 'minImageDimension')::integer, 32);
    v_max_dimension := coalesce((v_policy ->> 'maxImageDimension')::integer, 4096);
    v_max_pixels := coalesce((v_policy ->> 'maxImagePixels')::integer, 16777216);
  end if;

  foreach v_asset_id in array v_asset_ids loop
    select a.* into v_asset
      from public.app_branding_assets as a
     where a.id = v_asset_id;
    if not found then
      raise exception 'branding asset % is missing', v_asset_id using errcode = '22023';
    end if;
    if v_asset.object_path <> 'branding/' || v_asset.id::text || '.png'
       or v_asset.sha256 !~ '^[0-9a-f]{64}$'
       or v_asset.mime_type <> 'image/png'
       or v_asset.validated_at is null
       or v_asset.revoked_at is not null
       or v_asset.byte_length not between 1 and 2097152
       or v_asset.width not between 32 and 4096
       or v_asset.height not between 32 and 4096
       or v_asset.width::bigint * v_asset.height::bigint > 16777216
       or (p_recovery and not v_asset.published_once)
       or not exists (
         select 1 from storage.objects as object
          where object.bucket_id = 'branding-assets'
            and object.name = v_asset.object_path
       ) then
      raise exception 'branding asset % is unsupported, missing, unvalidated, or revoked', v_asset_id
        using errcode = '22023';
    end if;
    if not p_recovery
       and (
         v_asset.byte_length > v_max_upload_bytes
         or v_asset.width < v_min_dimension
         or v_asset.height < v_min_dimension
         or v_asset.width > v_max_dimension
         or v_asset.height > v_max_dimension
         or v_asset.width::bigint * v_asset.height::bigint > v_max_pixels
       ) then
      raise exception 'branding asset % exceeds the current soft policy', v_asset_id
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function public.get_app_branding_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'generation', coalesce(
      (select s.generation::text from public.app_branding_state as s where s.singleton),
      '0'
    ),
    'publishedVersionId', (
      select s.published_version_id
        from public.app_branding_state as s
       where s.singleton
    ),
    'config', (
      select v.config
        from public.app_branding_state as s
        left join public.app_branding_versions as v on v.id = s.published_version_id
       where s.singleton
    ),
    'flags', public.get_app_features()
  );
$$;

create or replace function public.admin_list_branding_versions()
returns table (
  id uuid,
  version_number bigint,
  schema_version smallint,
  created_by uuid,
  created_at timestamptz,
  validation_version smallint,
  soft_policy_revision bigint,
  published boolean,
  is_current boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public._is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
    select v.id, v.version_number, v.schema_version, v.created_by, v.created_at,
           v.validation_version, v.soft_policy_revision,
           exists (
             select 1 from public.app_branding_publications as p
              where p.target_version_id = v.id
           ),
           coalesce(s.published_version_id = v.id, false)
      from public.app_branding_versions as v
      cross join public.app_branding_state as s
     where s.singleton
     order by v.version_number desc;
end;
$$;

create or replace function public.admin_get_branding_version(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_version public.app_branding_versions%rowtype;
  v_is_published boolean;
  v_is_current boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public._is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select v.* into v_version
    from public.app_branding_versions as v
   where v.id = p_version_id;
  if not found then
    raise exception 'branding version not found' using errcode = 'P0002';
  end if;

  select exists (
           select 1 from public.app_branding_publications as p
            where p.target_version_id = v_version.id
         ),
         s.published_version_id = v_version.id
    into v_is_published, v_is_current
    from public.app_branding_state as s
   where s.singleton;

  return jsonb_build_object(
    'id', v_version.id,
    'versionNumber', v_version.version_number,
    'schemaVersion', v_version.schema_version,
    'createdBy', v_version.created_by,
    'createdAt', v_version.created_at,
    'validationVersion', v_version.validation_version,
    'softPolicyRevision', v_version.soft_policy_revision,
    'published', coalesce(v_is_published, false),
    'current', coalesce(v_is_current, false),
    'config', v_version.config
  );
end;
$$;

create or replace function public.admin_save_branding_draft(p_config jsonb, p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin uuid := auth.uid();
  v_config jsonb;
  v_policy jsonb;
  v_policy_revision bigint;
  v_existing public.app_branding_versions%rowtype;
  v_inserted integer;
begin
  if v_admin is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public._is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if not public._oorva_feature_enabled('branding_editor') then
    raise exception 'branding writes are disabled' using errcode = '55000';
  end if;
  if p_version_id is null then
    raise exception 'version id is required' using errcode = '22023';
  end if;

  select c.value into v_policy
    from public.app_config as c
   where c.key = 'branding_policy'
   for share;
  if not found then
    raise exception 'branding policy is not initialized' using errcode = '55000';
  end if;
  v_policy_revision := coalesce((v_policy ->> 'revision')::bigint, 1);
  v_config := public._branding_validate_config(p_config, false);
  perform public._branding_assets_publishable(v_config, false);

  insert into public.app_branding_versions (
    id, config, schema_version, created_by, validation_version, soft_policy_revision
  ) values (
    p_version_id, v_config, 1, v_admin, 1, v_policy_revision
  )
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select v.* into v_existing
      from public.app_branding_versions as v
     where v.id = p_version_id;
    if v_existing.config is distinct from v_config
       or v_existing.schema_version <> 1
       or v_existing.created_by <> v_admin
       or v_existing.validation_version <> 1
       or v_existing.soft_policy_revision <> v_policy_revision then
      raise exception 'branding version id already exists with different immutable content'
        using errcode = '23505';
    end if;
    return p_version_id;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (
    v_admin,
    'branding_draft_saved',
    p_version_id,
    jsonb_build_object('schemaVersion', 1, 'policyRevision', v_policy_revision)
  );
  return p_version_id;
end;
$$;

create or replace function public.admin_publish_branding(
  p_version_id uuid,
  p_expected_generation bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin uuid := auth.uid();
  v_state public.app_branding_state%rowtype;
  v_version public.app_branding_versions%rowtype;
  v_config jsonb;
  v_policy jsonb;
  v_asset_ids uuid[];
  v_next_generation bigint;
  v_updated_assets integer;
begin
  if v_admin is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public._is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if not public._oorva_feature_enabled('branding_editor') then
    raise exception 'branding writes are disabled' using errcode = '55000';
  end if;
  if p_expected_generation is null or p_expected_generation < 0 then
    raise exception 'expected generation must be non-negative' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'publish reason must contain 1..500 characters' using errcode = '22023';
  end if;

  select s.* into v_state
    from public.app_branding_state as s
   where s.singleton
   for update;
  if not found then
    raise exception 'branding state is not initialized' using errcode = '55000';
  end if;
  if v_state.generation <> p_expected_generation then
    raise exception 'stale branding generation: expected %, current %', p_expected_generation, v_state.generation
      using errcode = '40001';
  end if;

  select v.* into v_version
    from public.app_branding_versions as v
   where v.id = p_version_id;
  if not found then
    raise exception 'branding version not found' using errcode = 'P0002';
  end if;

  select c.value into v_policy
    from public.app_config as c
   where c.key = 'branding_policy'
   for share;
  if not found then
    raise exception 'branding policy is not initialized' using errcode = '55000';
  end if;
  v_config := public._branding_validate_config(v_version.config, false);
  perform public._branding_assets_publishable(v_config, false);
  select coalesce(array_agg(distinct asset_id), array[]::uuid[])
    into v_asset_ids
    from (
      select (v_config -> 'assets' ->> slots.key)::uuid as asset_id
        from unnest(array['logoLight', 'logoDark', 'compactLight', 'compactDark']::text[]) as slots(key)
       where jsonb_typeof(v_config -> 'assets' -> slots.key) = 'string'
      union all
      select item.value::uuid
        from jsonb_array_elements_text(v_config -> 'assets' -> 'promotional') as item(value)
    ) as asset_refs;
  if cardinality(v_asset_ids) > 0 then
    update public.app_branding_assets as a
       set published_once = true
     where a.id = any(v_asset_ids)
       and a.validated_at is not null
       and a.revoked_at is null;
    get diagnostics v_updated_assets = row_count;
    if v_updated_assets <> cardinality(v_asset_ids) then
      raise exception 'a branding asset became unavailable before publication' using errcode = '40001';
    end if;
  end if;

  v_next_generation := v_state.generation + 1;
  insert into public.app_branding_publications (
    generation, publication_kind, previous_version_id, target_version_id, reason, actor_id
  ) values (
    v_next_generation, 'publish', v_state.published_version_id, p_version_id, btrim(p_reason), v_admin
  );
  update public.app_branding_state as s
     set published_version_id = p_version_id,
         generation = v_next_generation,
         updated_at = now(),
         updated_by = v_admin
   where s.singleton;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (
    v_admin,
    'branding_published',
    p_version_id,
    jsonb_build_object(
      'previousVersionId', v_state.published_version_id,
      'generation', v_next_generation,
      'reason', btrim(p_reason)
    )
  );
  return public.get_app_branding_snapshot();
end;
$$;

create or replace function public.admin_set_branding_policy(p_policy jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin uuid := auth.uid();
  v_policy jsonb;
  v_current jsonb;
  v_revision bigint;
begin
  if v_admin is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public._is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if not public._oorva_feature_enabled('branding_editor') then
    raise exception 'branding writes are disabled' using errcode = '55000';
  end if;

  v_policy := public._branding_validate_policy(p_policy);
  select c.value into v_current
    from public.app_config as c
   where c.key = 'branding_policy'
   for update;
  if not found then
    raise exception 'branding policy is not initialized' using errcode = '55000';
  end if;
  v_revision := coalesce((v_current ->> 'revision')::bigint, 0) + 1;
  v_policy := v_policy || jsonb_build_object('revision', v_revision);
  update public.app_config as c
     set value = v_policy, updated_at = now(), updated_by = v_admin
   where c.key = 'branding_policy';
  insert into public.admin_audit_log (admin_id, action, details)
  values (
    v_admin,
    'branding_policy_changed',
    jsonb_build_object('revision', v_revision, 'policy', v_policy - 'revision')
  );
  return v_policy;
end;
$$;

create or replace function public.admin_rollback_branding(
  p_version_id uuid,
  p_expected_generation bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin uuid := auth.uid();
  v_state public.app_branding_state%rowtype;
  v_version public.app_branding_versions%rowtype;
  v_config jsonb;
  v_asset_ids uuid[];
  v_next_generation bigint;
  v_updated_assets integer;
begin
  if v_admin is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public._is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_expected_generation is null or p_expected_generation < 0 then
    raise exception 'expected generation must be non-negative' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'rollback reason must contain 1..500 characters' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.app_branding_publications as p
     where p.target_version_id = p_version_id
  ) then
    raise exception 'rollback target was never published' using errcode = '22023';
  end if;

  select s.* into v_state
    from public.app_branding_state as s
   where s.singleton
   for update;
  if not found then
    raise exception 'branding state is not initialized' using errcode = '55000';
  end if;
  if v_state.generation <> p_expected_generation then
    raise exception 'stale branding generation: expected %, current %', p_expected_generation, v_state.generation
      using errcode = '40001';
  end if;

  select v.* into v_version
    from public.app_branding_versions as v
   where v.id = p_version_id;
  if not found then
    raise exception 'branding version not found' using errcode = 'P0002';
  end if;
  v_config := public._branding_validate_config(v_version.config, true);
  perform public._branding_assets_publishable(v_config, true);
  select coalesce(array_agg(distinct asset_id), array[]::uuid[])
    into v_asset_ids
    from (
      select (v_config -> 'assets' ->> slots.key)::uuid as asset_id
        from unnest(array['logoLight', 'logoDark', 'compactLight', 'compactDark']::text[]) as slots(key)
       where jsonb_typeof(v_config -> 'assets' -> slots.key) = 'string'
      union all
      select item.value::uuid
        from jsonb_array_elements_text(v_config -> 'assets' -> 'promotional') as item(value)
    ) as asset_refs;
  if cardinality(v_asset_ids) > 0 then
    update public.app_branding_assets as a
       set published_once = true
     where a.id = any(v_asset_ids)
       and a.validated_at is not null
       and a.revoked_at is null;
    get diagnostics v_updated_assets = row_count;
    if v_updated_assets <> cardinality(v_asset_ids) then
      raise exception 'a branding asset became unavailable during recovery' using errcode = '40001';
    end if;
  end if;

  v_next_generation := v_state.generation + 1;
  insert into public.app_branding_publications (
    generation, publication_kind, previous_version_id, target_version_id, reason, actor_id
  ) values (
    v_next_generation, 'rollback', v_state.published_version_id, p_version_id, btrim(p_reason), v_admin
  );
  update public.app_branding_state as s
     set published_version_id = p_version_id,
         generation = v_next_generation,
         updated_at = now(),
         updated_by = v_admin
   where s.singleton;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (
    v_admin,
    'branding_rolled_back',
    p_version_id,
    jsonb_build_object(
      'previousVersionId', v_state.published_version_id,
      'generation', v_next_generation,
      'reason', btrim(p_reason),
      'softPolicyReapplied', false
    )
  );
  return public.get_app_branding_snapshot();
end;
$$;

create or replace function public.admin_revoke_branding_asset(p_asset_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin uuid := auth.uid();
  v_state public.app_branding_state%rowtype;
  v_asset public.app_branding_assets%rowtype;
  v_current_config jsonb;
  v_is_current_asset boolean := false;
begin
  if v_admin is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public._is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'revocation reason must contain 1..500 characters' using errcode = '22023';
  end if;

  select s.* into v_state
    from public.app_branding_state as s
   where s.singleton
   for update;
  if not found then
    raise exception 'branding state is not initialized' using errcode = '55000';
  end if;
  perform f.key
    from public.feature_flags as f
   where f.key in ('oorva_brand', 'branding_runtime')
   order by f.key
   for share;
  select a.* into v_asset
    from public.app_branding_assets as a
   where a.id = p_asset_id
   for update;
  if not found then
    raise exception 'branding asset is not registered' using errcode = 'P0002';
  end if;
  if v_asset.revoked_at is not null then
    raise exception 'branding asset is already revoked' using errcode = '55000';
  end if;

  if v_state.published_version_id is not null then
    select v.config into v_current_config
      from public.app_branding_versions as v
     where v.id = v_state.published_version_id;
    v_is_current_asset := exists (
      select 1
        from unnest(array['logoLight', 'logoDark', 'compactLight', 'compactDark']::text[]) as slots(key)
       where v_current_config -> 'assets' ->> slots.key = p_asset_id::text
    ) or exists (
      select 1
        from jsonb_array_elements_text(v_current_config -> 'assets' -> 'promotional') as item(value)
       where item.value = p_asset_id::text
    );
  end if;
  if v_is_current_asset and public._oorva_feature_enabled('branding_runtime') then
    raise exception 'recover the current appearance or disable branding_runtime before revoking its asset'
      using errcode = '55000';
  end if;

  update public.app_branding_assets as a
     set revoked_at = now(),
         revoked_by = v_admin,
         revoke_reason = btrim(p_reason)
   where a.id = p_asset_id
     and a.revoked_at is null;
  if not found then
    raise exception 'branding asset was revoked concurrently' using errcode = '40001';
  end if;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (
    v_admin,
    'branding_asset_revoked',
    p_asset_id,
    jsonb_build_object('reason', btrim(p_reason), 'generation', v_state.generation)
  );
  return jsonb_build_object(
    'assetId', p_asset_id,
    'revoked', true,
    'generation', v_state.generation::text
  );
end;
$$;

revoke all on function public._oorva_feature_enabled(text),
  public._branding_validate_policy(jsonb),
  public._branding_validate_config(jsonb, boolean),
  public._branding_assets_publishable(jsonb, boolean)
  from public, anon, authenticated, service_role;

revoke all on function public.get_app_branding_snapshot() from public, anon, authenticated;
grant execute on function public.get_app_branding_snapshot() to anon, authenticated;

revoke all on function public.admin_list_branding_versions(),
  public.admin_get_branding_version(uuid),
  public.admin_save_branding_draft(jsonb, uuid),
  public.admin_publish_branding(uuid, bigint, text),
  public.admin_set_branding_policy(jsonb),
  public.admin_rollback_branding(uuid, bigint, text),
  public.admin_revoke_branding_asset(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_list_branding_versions(),
  public.admin_get_branding_version(uuid),
  public.admin_save_branding_draft(jsonb, uuid),
  public.admin_publish_branding(uuid, bigint, text),
  public.admin_set_branding_policy(jsonb),
  public.admin_rollback_branding(uuid, bigint, text),
  public.admin_revoke_branding_asset(uuid, text)
  to authenticated;

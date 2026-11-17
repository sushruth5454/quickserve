-- 0042: registry-backed feature switches. Archetype availability remains in app_config.archetype_flags.

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,48}$'),
  enabled boolean not null default false,
  label text not null check (char_length(label) between 2 and 60),
  description text not null default '',
  group_name text not null default 'General',
  sort_order int not null default 100,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated;

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
select v.key,
       coalesce((select (cfg.value ->> v.key)::boolean from public.app_config cfg where cfg.key = 'features'), true),
       v.label, v.description, v.group_name, v.sort_order
  from (values
    ('ai_assistant', 'AI assistant', 'Voice/text matching and AI booking drafts.', 'AI', 10),
    ('urgent_requests', 'Urgent creator requests', 'Creator and event requests from 2 hours away.', 'Bookings', 20),
    ('fixed_asap', 'ASAP for fixed-price services', 'Immediate cleaning and similar package bookings.', 'Bookings', 30)
  ) as v(key, label, description, group_name, sort_order)
on conflict (key) do nothing;

create or replace function public._feature_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select f.enabled from public.feature_flags f where f.key = p_key), false);
$$;

create or replace function public.get_app_features()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
           (select jsonb_object_agg(f.key, f.enabled) from public.feature_flags f),
           '{}'::jsonb
         )
         || jsonb_build_object(
           'archetypes',
           coalesce((select c.value from public.app_config c where c.key = 'archetype_flags'), '{}'::jsonb)
         );
$$;

create or replace function public.admin_set_feature(p_key text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._is_admin(), 'admin only');
  if p_key like 'archetype:%' then
    perform public._assert(substr(p_key, 11) in ('inspect_quote', 'fixed', 'time_based', 'proposal', 'remote'), 'unknown service type');
    update public.app_config
       set value = coalesce(value, '{}'::jsonb) || jsonb_build_object(substr(p_key, 11), p_enabled),
           updated_at = now(), updated_by = v_uid
     where key = 'archetype_flags';
    perform public._assert(found, 'service type configuration not found');
  else
    update public.feature_flags
       set enabled = p_enabled, updated_at = now(), updated_by = v_uid
     where key = p_key;
    perform public._assert(found, 'unknown feature');
  end if;
  insert into public.admin_audit_log (admin_id, action, details)
  values (v_uid, 'set_feature', jsonb_build_object('key', p_key, 'enabled', p_enabled));
  return public.get_app_features();
end;
$$;

create or replace function public.admin_list_features()
returns table (
  key text,
  enabled boolean,
  label text,
  description text,
  group_name text,
  sort_order int,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return query
    select f.key, f.enabled, f.label, f.description, f.group_name, f.sort_order, f.updated_at
      from public.feature_flags f
     order by f.group_name, f.sort_order, f.key;
end;
$$;

revoke execute on function public._feature_enabled(text) from public, anon, authenticated;
revoke execute on function public.get_app_features() from public, anon;
revoke execute on function public.admin_set_feature(text, boolean), public.admin_list_features() from public, anon;
grant execute on function public.get_app_features() to anon, authenticated;
grant execute on function public.admin_set_feature(text, boolean), public.admin_list_features() to authenticated;

alter table public.profiles
  add column if not exists preferred_language text not null default 'en'
  check (preferred_language in ('en', 'te'));

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values ('telugu_language', false, 'Telugu language', 'Show the language picker and Telugu text.', 'App', 40)
on conflict (key) do nothing;

create or replace function public.set_preferred_language(p_language text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(p_language in ('en', 'te'), 'invalid language');

  update public.profiles
     set preferred_language = p_language
   where id = v_uid;
  perform public._assert(found, 'profile not found');

  return p_language;
end;
$$;

revoke execute on function public.set_preferred_language(text) from public, anon;
grant execute on function public.set_preferred_language(text) to authenticated;

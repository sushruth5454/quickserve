-- WP X1; owns: public._is_admin(), public._admin_user_ids(); sources: WS8-T01

update public.app_config
   set value = '[]'::jsonb
 where key = 'admin_phones';

create or replace function public._is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.admins
     where user_id = auth.uid()
  );
$$;

create or replace function public._admin_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id
    from public.admins;
$$;

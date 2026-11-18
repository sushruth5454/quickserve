-- WP U3; owns: request_account_deletion; sources: WS1-T07

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'done', 'rejected'))
);

create unique index account_deletion_requests_one_pending_per_user
  on public.account_deletion_requests (user_id)
  where status = 'pending';

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
grant select on public.account_deletion_requests to authenticated;
grant insert (user_id) on public.account_deletion_requests to authenticated;

create policy account_deletion_requests_own_select
  on public.account_deletion_requests for select to authenticated
  using (user_id = auth.uid());

create policy account_deletion_requests_admin_select
  on public.account_deletion_requests for select to authenticated
  using (public._is_admin());

create policy account_deletion_requests_own_insert
  on public.account_deletion_requests for insert to authenticated
  with check (user_id = auth.uid());

create or replace function public.request_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  insert into public.account_deletion_requests (user_id)
  values (v_uid)
  on conflict (user_id) where status = 'pending' do nothing;
end;
$$;

revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;

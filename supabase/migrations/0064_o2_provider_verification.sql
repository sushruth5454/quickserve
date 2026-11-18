-- WP O2; owns: admin_list_providers, admin_set_provider_review, _provider_is_live, admin_set_shop_status; sources: WS7-T03, WS7-T04, WS3-T11

alter table public.providers
  add column if not exists admin_review_status text not null default 'pending'
  check (admin_review_status in ('pending', 'approved', 'rejected', 'needs_clarification'));

update public.providers
   set admin_review_status = 'approved'
 where kyc_status = 'verified'
   and admin_review_status = 'pending';

drop function if exists public.admin_list_providers(text, text);

create function public.admin_list_providers(p_filter text default 'all', p_search text default null)
returns table (
  id uuid, full_name text, phone text, city text, kyc_status text, admin_review_status text,
  has_payout_account boolean, suspended boolean, paused boolean, is_online boolean,
  rating_avg numeric, rating_count int, jobs_completed int, is_creator boolean, categories text[],
  submitted_at timestamptz, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
  perform public._assert(public._is_admin(), 'admin only');
  return query
  select * from (
    select p.id, pr.full_name, u.phone::text, p.city, p.kyc_status::text,
           p.admin_review_status,
           exists (select 1 from public.provider_payout_accounts pa where pa.provider_id = p.id),
           p.suspended, coalesce(p.paused, false), p.is_online,
           p.rating_avg, p.rating_count, p.jobs_completed,
           exists (select 1 from public.provider_services ps join public.categories c on c.id = ps.category_id
                    where ps.provider_id = p.id and ps.active and c.archetype = 'proposal') as is_creator,
           coalesce((select array_agg(c.name order by c.name) from public.provider_services ps
                       join public.categories c on c.id = ps.category_id where ps.provider_id = p.id and ps.active), '{}') as categories,
           p.submitted_at, p.created_at
      from public.providers p
      join public.profiles pr on pr.id = p.id
      left join auth.users u on u.id = p.id
  ) x
  where (coalesce(p_filter, 'all') = 'all'
         or (p_filter = 'creators' and x.is_creator)
         or (p_filter = 'pending' and x.admin_review_status in ('pending', 'needs_clarification')
             and x.submitted_at is not null)
         or (p_filter = 'suspended' and x.suspended))
    and (v_q is null or lower(coalesce(x.full_name, '')) like '%' || v_q || '%' or coalesce(x.phone, '') like '%' || v_q || '%'
         or lower(coalesce(x.city, '')) like '%' || v_q || '%')
  order by x.created_at desc
  limit 300;
end;
$$;

revoke execute on function public.admin_list_providers(text, text) from public, anon;
grant execute on function public.admin_list_providers(text, text) to authenticated;

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
       and p.admin_review_status = 'approved'
       and exists (
         select 1 from public.provider_payout_accounts pa
          where pa.provider_id = p.id and pa.activation_status = 'activated'
       )
       and not p.suspended
       and p.deactivated_at is null
       and p.submitted_at is not null
       and exists (select 1 from public.provider_services ps
                    where ps.provider_id = p.id and ps.active and public._category_docs_ok(p.id, ps.category_id))
  );
$$;

create or replace function public.admin_set_provider_review(
  p_provider_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._require_uid();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_submitted_at timestamptz;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(p_status in ('approved', 'rejected', 'needs_clarification'), 'invalid provider review status');
  perform public._assert(p_status = 'approved' or v_reason is not null, 'reason is required');
  perform public._assert(v_reason is null or char_length(v_reason) <= 500, 'review reason is too long');

  select p.submitted_at into v_submitted_at
    from public.providers p
   where p.id = p_provider_id
   for update;
  perform public._assert(found, 'provider not found');
  perform public._assert(v_submitted_at is not null, 'provider has not been submitted');
  if p_status = 'approved' then
    perform public._assert(
      exists (select 1 from public.provider_payout_accounts pa where pa.provider_id = p_provider_id),
      'payout account is required before approval'
    );
  end if;

  update public.providers
     set admin_review_status = p_status,
         review_note = case when p_status in ('rejected', 'needs_clarification') then v_reason else null end
   where id = p_provider_id;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_admin, 'set_provider_review', p_provider_id,
          jsonb_build_object('status', p_status, 'reason', v_reason));
end;
$$;

revoke execute on function public.admin_set_provider_review(uuid, text, text) from public, anon;
grant execute on function public.admin_set_provider_review(uuid, text, text) to authenticated;
revoke execute on function public.admin_set_provider_kyc(uuid, text, text) from public, anon, authenticated;

create or replace function public.admin_set_shop_status(p_shop_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  s public.shops;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(coalesce(p_status in ('under_review', 'verified', 'rejected', 'suspended'), false), 'invalid shop status');
  perform public._assert(v_reason is null or char_length(v_reason) <= 500, 'status reason is too long');
  select * into s from public.shops where id = p_shop_id for update;
  perform public._assert(found, 'shop not found');
  perform public._assert(p_status <> 'verified' or s.status in ('submitted', 'under_review', 'suspended'),
                         'only submitted or under-review shops can be verified');
  perform public._assert(p_status not in ('rejected', 'suspended') or v_reason is not null,
                         'a reason is required to reject or suspend a shop');
  if p_status = 'verified' then
    perform public._assert(char_length(trim(s.name)) >= 2 and char_length(trim(s.address_line)) >= 5
      and char_length(trim(s.city)) >= 2 and char_length(trim(s.area)) >= 2
      and s.lat is not null and s.lng is not null
      and exists (select 1 from public.shop_categories sc where sc.shop_id = s.id), 'shop profile is incomplete');
  end if;
  update public.shops
     set status = p_status, status_reason = case when p_status in ('rejected', 'suspended') then v_reason else null end,
         updated_at = now()
   where id = s.id;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_shop_status', s.id, jsonb_build_object('status', p_status, 'reason', v_reason));
end;
$$;

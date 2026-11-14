-- AI assistant price estimates ignore stale data: completed/approved job totals only count inside a lookback window
-- (default 180 days, AI_PRICE_LOOKBACK_DAYS in the function). Visit fees always come from currently active pros.
drop function if exists public.ai_price_estimate(text);

create or replace function public.ai_price_estimate(p_category_slug text, p_since timestamptz default now() - interval '180 days')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with cat as (
    select id, slug, name from public.categories where slug = p_category_slug and active
  ),
  fees as (
    select ps.visit_fee::numeric as v
      from public.provider_services ps
      join public.providers pr on pr.id = ps.provider_id
     where ps.category_id = (select id from cat) and ps.active and pr.kyc_status = 'verified' and not pr.suspended
  ),
  totals as (
    select b.total_amount::numeric as v
      from public.bookings b
     where b.category_id = (select id from cat) and b.status in ('completed', 'closed') and b.total_amount is not null
       and coalesce(b.completed_at, b.updated_at) >= p_since
    union all
    select public._required_total(q.total, b.visit_fee, b.platform_fee)::numeric
      from public.quotes q
      join public.bookings b on b.id = q.booking_id
     where b.category_id = (select id from cat) and q.status = 'approved'
       and b.status not in ('completed', 'closed')
       and q.created_at >= p_since
  )
  select case when not exists (select 1 from cat) then null else jsonb_build_object(
    'category_slug', (select slug from cat),
    'category_name', (select name from cat),
    'visit_fee_count', (select count(*) from fees),
    'visit_fee_min', (select min(v)::int from fees),
    'visit_fee_median', (select (percentile_cont(0.5) within group (order by v))::int from fees),
    'visit_fee_max', (select max(v)::int from fees),
    'total_count', (select count(*) from totals),
    'total_p25', (select (percentile_cont(0.25) within group (order by v))::int from totals),
    'total_median', (select (percentile_cont(0.5) within group (order by v))::int from totals),
    'total_p75', (select (percentile_cont(0.75) within group (order by v))::int from totals)
  ) end;
$$;
revoke execute on function public.ai_price_estimate(text, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_price_estimate(text, timestamptz) to service_role;

-- AI booking assistant (supabase/functions/ai-assistant): conversation persistence, per-user usage counting and a
-- data-backed price estimate. Rows are written only by the edge function (service role); owners can read their own.

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

-- role: 'user' rows are the per-day rate-limit counter (input_kind = 'voice' for the voice limit);
-- 'assistant' rows carry the validated reply (cards, quick replies) and token usage in payload; 'error' rows the request id.
create table public.ai_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'error')),
  input_kind text check (input_kind in ('text', 'voice')),
  content text not null default '' check (char_length(content) <= 4000),
  payload jsonb not null default '{}'::jsonb,
  model text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);
create index ai_messages_user_day_idx on public.ai_messages (user_id, created_at desc) where role = 'user';

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
create policy ai_conversations_own_read on public.ai_conversations for select to authenticated using (user_id = auth.uid());
create policy ai_messages_own_read on public.ai_messages for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.ai_conversations, public.ai_messages from anon, authenticated;

-- Typical prices for a category from real data only: active verified pros' visit fees, and what customers actually
-- paid (completed/closed bookings) or approved (accepted quotes, same total formula as _required_total).
-- All amounts in paise; *_count = 0 means "no data" and the assistant must say so instead of guessing.
create or replace function public.ai_price_estimate(p_category_slug text)
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
    union all
    select public._required_total(q.total, b.visit_fee, b.platform_fee)::numeric
      from public.quotes q
      join public.bookings b on b.id = q.booking_id
     where b.category_id = (select id from cat) and q.status = 'approved'
       and b.status not in ('completed', 'closed')
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
revoke execute on function public.ai_price_estimate(text) from public, anon, authenticated;
grant execute on function public.ai_price_estimate(text) to service_role;

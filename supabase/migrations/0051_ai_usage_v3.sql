-- Phase 8: AI product assistance metering and fail-closed feature gates.

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values
  ('ai_product_search', false, 'AI product search', 'Natural-language product search.', 'AI', 20),
  ('ai_quote_extract', false, 'AI quote reading', 'Read uploaded supplier quotations.', 'AI', 30)
on conflict (key) do nothing;

alter table public.ai_usage drop constraint ai_usage_kind_check;
alter table public.ai_usage
  add constraint ai_usage_kind_check
  check (kind in ('transcribe', 'voice_chat', 'photo', 'product_search', 'quote_extract', 'chat'));

alter table public.ai_usage
  add column feature text,
  add column model text,
  add column input_tokens int check (input_tokens is null or input_tokens >= 0),
  add column output_tokens int check (output_tokens is null or output_tokens >= 0),
  add column cost_micros_usd bigint check (cost_micros_usd is null or cost_micros_usd >= 0),
  add column latency_ms int check (latency_ms is null or latency_ms >= 0),
  add column ok boolean;

create index ai_usage_feature_user_day_idx
  on public.ai_usage (feature, user_id, created_at desc);
create index ai_usage_feature_month_cost_idx
  on public.ai_usage (created_at desc, cost_micros_usd)
  where cost_micros_usd is not null;

insert into public.app_config (key, value)
values ('ai_limits', '{"product_search_per_day":30,"quote_extract_per_day":10,"monthly_budget_usd":50}'::jsonb)
on conflict (key) do nothing;

create or replace function public.begin_ai_usage(
  p_user_id uuid,
  p_kind text,
  p_feature text,
  p_request_id uuid,
  p_day_start timestamptz,
  p_month_start timestamptz,
  p_model text,
  p_reserved_cost_micros_usd bigint
)
returns table (usage_id bigint, rejection text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limits jsonb;
  v_limit_key text;
  v_expected_feature text;
  v_daily_limit int;
  v_daily_count bigint;
  v_month_cost bigint;
  v_month_budget bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role only';
  end if;

  v_limit_key := case p_kind
    when 'product_search' then 'product_search_per_day'
    when 'quote_extract' then 'quote_extract_per_day'
    else null
  end;
  v_expected_feature := case p_kind
    when 'product_search' then 'ai_product_search'
    when 'quote_extract' then 'ai_quote_extract'
    else null
  end;
  if v_limit_key is null or p_feature is distinct from v_expected_feature then
    return query select null::bigint, 'invalid_feature'::text;
    return;
  end if;
  if p_user_id is null or p_request_id is null or p_model is null
     or p_day_start is null or p_month_start is null
     or p_reserved_cost_micros_usd is null or p_reserved_cost_micros_usd < 0 then
    return query select null::bigint, 'invalid_request'::text;
    return;
  end if;
  if not public._feature_enabled(p_feature) then
    return query select null::bigint, 'feature_disabled'::text;
    return;
  end if;
  if p_feature = 'ai_product_search' and not public._feature_enabled('products') then
    return query select null::bigint, 'feature_disabled'::text;
    return;
  end if;

  -- Lock the single limits row so concurrent requests cannot oversubscribe the global monthly budget.
  select c.value into v_limits
    from public.app_config c
   where c.key = 'ai_limits'
   for update;
  if v_limits is null then
    raise exception 'AI limits are not configured';
  end if;
  v_daily_limit := coalesce((v_limits ->> v_limit_key)::int, 0);
  v_month_budget := round(coalesce((v_limits ->> 'monthly_budget_usd')::numeric, 0) * 1000000)::bigint;
  if v_daily_limit <= 0 or v_month_budget <= 0 then
    return query select null::bigint, 'limits_disabled'::text;
    return;
  end if;

  select count(*) into v_daily_count
    from public.ai_usage u
   where u.user_id = p_user_id and u.kind = p_kind and u.feature = p_feature
     and u.created_at >= p_day_start;
  if v_daily_count >= v_daily_limit then
    return query select null::bigint, 'daily_limit'::text;
    return;
  end if;

  select coalesce(sum(u.cost_micros_usd), 0)::bigint into v_month_cost
    from public.ai_usage u
   where u.created_at >= p_month_start and u.cost_micros_usd is not null;
  if v_month_cost + p_reserved_cost_micros_usd > v_month_budget then
    return query select null::bigint, 'monthly_budget'::text;
    return;
  end if;

  insert into public.ai_usage (
    user_id, kind, request_id, feature, model, cost_micros_usd, ok
  )
  values (
    p_user_id, p_kind, p_request_id, p_feature, p_model, p_reserved_cost_micros_usd, false
  )
  returning id into usage_id;
  rejection := null;
  return next;
end;
$$;

create or replace function public.finish_ai_usage(
  p_usage_id bigint,
  p_model text,
  p_input_tokens int,
  p_output_tokens int,
  p_cost_micros_usd bigint,
  p_latency_ms int,
  p_ok boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role only';
  end if;
  if p_usage_id is null or (p_input_tokens is not null and p_input_tokens < 0)
     or (p_output_tokens is not null and p_output_tokens < 0)
     or p_cost_micros_usd is null or p_cost_micros_usd < 0
     or p_latency_ms is null or p_latency_ms < 0 or p_ok is null then
    raise exception 'invalid AI usage completion';
  end if;

  update public.ai_usage
     set model = coalesce(nullif(p_model, ''), model),
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         cost_micros_usd = p_cost_micros_usd,
         latency_ms = p_latency_ms,
         ok = p_ok
   where id = p_usage_id and feature in ('ai_product_search', 'ai_quote_extract');
  if not found then
    raise exception 'AI usage reservation not found';
  end if;
end;
$$;

create or replace function public.admin_ai_usage_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_limits jsonb;
  v_features jsonb;
  v_cost bigint;
  v_budget numeric;
begin
  perform public._assert(public._is_admin(), 'admin only');
  select c.value into v_limits from public.app_config c where c.key = 'ai_limits';
  select coalesce(sum(u.cost_micros_usd), 0)::bigint into v_cost
    from public.ai_usage u
   where u.created_at >= v_month_start and u.cost_micros_usd is not null;
  v_budget := coalesce((v_limits ->> 'monthly_budget_usd')::numeric, 0);

  select coalesce(jsonb_agg(jsonb_build_object(
    'feature', feature_key,
    'calls_today', coalesce(requests.calls_today, 0),
    'calls_month', coalesce(requests.calls_month, 0),
    'error_rate_percent', coalesce(requests.error_rate_percent, 0),
    'usage_events_today', coalesce(metrics.usage_events_today, 0),
    'input_tokens_month', coalesce(metrics.input_tokens_month, 0),
    'output_tokens_month', coalesce(metrics.output_tokens_month, 0),
    'cost_month_micros_usd', coalesce(metrics.cost_month_micros_usd, 0)
  ) order by feature_key), '[]'::jsonb)
    into v_features
    from (values ('ai_assistant'), ('ai_product_search'), ('ai_quote_extract')) as features(feature_key)
    left join lateral (
      select count(*) filter (where r.created_at >= v_day_start)::bigint as calls_today,
             count(*) filter (where r.created_at >= v_month_start)::bigint as calls_month,
             round(
               100.0 * count(*) filter (where r.created_at >= v_day_start and not coalesce(r.ok, false))
               / nullif(count(*) filter (where r.created_at >= v_day_start), 0),
               2
             ) as error_rate_percent
        from (
          select u.request_id, min(u.created_at) as created_at, bool_or(u.ok) as ok
            from public.ai_usage u
           where u.feature = features.feature_key
           group by u.request_id
        ) r
    ) requests on true
    left join lateral (
      select count(*) filter (where u.created_at >= v_day_start)::bigint as usage_events_today,
             coalesce(sum(u.input_tokens) filter (where u.created_at >= v_month_start), 0)::bigint as input_tokens_month,
             coalesce(sum(u.output_tokens) filter (where u.created_at >= v_month_start), 0)::bigint as output_tokens_month,
             coalesce(sum(u.cost_micros_usd) filter (where u.created_at >= v_month_start), 0)::bigint as cost_month_micros_usd
        from public.ai_usage u
       where u.feature = features.feature_key
    ) metrics on true;

  return jsonb_build_object(
    'features', v_features,
    'monthly_cost_micros_usd', v_cost,
    'monthly_budget_usd', v_budget,
    'monthly_budget_micros_usd', round(v_budget * 1000000)::bigint
  );
end;
$$;

revoke all on function public.begin_ai_usage(uuid, text, text, uuid, timestamptz, timestamptz, text, bigint)
  from public, anon, authenticated;
revoke all on function public.finish_ai_usage(bigint, text, int, int, bigint, int, boolean)
  from public, anon, authenticated;
revoke all on function public.admin_ai_usage_dashboard() from public, anon;
grant execute on function public.begin_ai_usage(uuid, text, text, uuid, timestamptz, timestamptz, text, bigint)
  to service_role;
grant execute on function public.finish_ai_usage(bigint, text, int, int, bigint, int, boolean)
  to service_role;
grant execute on function public.admin_ai_usage_dashboard() to authenticated;

-- O30-CM07: keep the dashboard pending-review count aligned with the People review predicate.
create or replace function public.admin_dashboard(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 180);
  v_from timestamptz;
  v_totals jsonb;
  v_daily jsonb;
  v_top jsonb;
  v_status jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  v_from := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' - make_interval(days => v_days - 1);

  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'customers', (select count(*) from public.profiles where role_customer),
    'providers', (select count(*) from public.providers),
    'providers_verified', (select count(*) from public.providers where kyc_status = 'verified' and not suspended),
    'providers_online', (select count(*) from public.providers where is_online and not suspended),
    'providers_pending', (select count(*) from public.providers
                           where admin_review_status in ('pending', 'needs_clarification') and submitted_at is not null),
    'creators', (select count(distinct ps.provider_id) from public.provider_services ps
                   join public.categories c on c.id = ps.category_id where c.archetype = 'proposal' and ps.active),
    'bookings', (select count(*) from public.bookings),
    'bookings_active', (select count(*) from public.bookings where status not in
                          ('completed', 'closed', 'closed_no_work', 'declined', 'expired', 'cancelled', 'refunded')),
    'disputes_open', (select count(*) from public.bookings where status = 'disputed'),
    'gmv_paise', (select coalesce(sum(amount), 0) from public.payments where status = 'paid'),
    'gmv_period_paise', (select coalesce(sum(amount), 0) from public.payments where status = 'paid' and coalesce(paid_at, created_at) >= v_from),
    'platform_fees_paise', (select coalesce(sum(amount), 0) from public.payments where status = 'paid' and purpose = 'platform_fee'),
    'requests_open', (select count(*) from public.service_requests where status = 'open' and expires_at > now()),
    'support_open', (select count(*) from public.support_threads where status = 'open'),
    'support_unread', (select coalesce(sum(admin_unread), 0) from public.support_threads)
  ) into v_totals;

  select coalesce(jsonb_agg(jsonb_build_object(
           'day', to_char(d, 'YYYY-MM-DD'),
           'signups', (select count(*) from public.profiles p where p.created_at >= d and p.created_at < d + interval '1 day'),
           'bookings', (select count(*) from public.bookings b where b.created_at >= d and b.created_at < d + interval '1 day'),
           'requests', (select count(*) from public.service_requests r where r.created_at >= d and r.created_at < d + interval '1 day'),
           'paid_paise', (select coalesce(sum(amount), 0) from public.payments pm
                           where pm.status = 'paid' and coalesce(pm.paid_at, pm.created_at) >= d and coalesce(pm.paid_at, pm.created_at) < d + interval '1 day')
         ) order by d), '[]'::jsonb)
    into v_daily
    from generate_series(v_from, v_from + make_interval(days => v_days - 1), interval '1 day') d;

  select coalesce(jsonb_agg(x order by x.bookings desc), '[]'::jsonb) into v_top from (
    select c.name, c.archetype, count(*)::int as bookings
      from public.bookings b join public.categories c on c.id = b.category_id
     where b.created_at >= v_from
     group by c.name, c.archetype
     order by count(*) desc
     limit 5
  ) x;

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_status from (
    select status::text, count(*)::int n from public.bookings where created_at >= v_from group by status
  ) s;

  return jsonb_build_object('days', v_days, 'totals', v_totals, 'daily', v_daily, 'top_categories', v_top, 'status', v_status);
end;
$$;

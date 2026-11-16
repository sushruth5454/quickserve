-- 0041: admin portal + in-app support.
--  * Admins: the existing admins table, plus phone numbers listed in app_config.admin_phones (digits only).
--  * Feature switches in app_config.features (read by everyone through get_app_features, changed by admins).
--  * Admin RPCs for the dashboard, categories per city, providers/creators, bookings.
--  * Support threads: customers and providers message support; admins reply; both sides are notified.

insert into public.app_config (key, value) values ('admin_phones', '["918888888888"]'::jsonb) on conflict (key) do nothing;
insert into public.app_config (key, value)
values ('features', '{"ai_assistant": true, "urgent_requests": true, "fixed_asap": true}'::jsonb)
on conflict (key) do nothing;

create or replace function public._is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
      or exists (
        select 1 from auth.users u
         where u.id = auth.uid()
           and coalesce((select value from public.app_config where key = 'admin_phones'), '[]'::jsonb)
               ? regexp_replace(coalesce(u.phone, ''), '\D', '', 'g')
      );
$$;

create or replace function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public._is_admin(); $$;

-- Every admin's user id (table + phone allowlist), for support notifications.
create or replace function public._admin_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from public.admins
  union
  select u.id from auth.users u
   where coalesce((select value from public.app_config where key = 'admin_phones'), '[]'::jsonb)
         ? regexp_replace(coalesce(u.phone, ''), '\D', '', 'g');
$$;

-- ---------------------------------------------------------------- feature switches

create or replace function public._feature_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value ->> p_key)::boolean from public.app_config where key = 'features'), true);
$$;

create or replace function public.get_app_features()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select '{"ai_assistant": true, "urgent_requests": true, "fixed_asap": true}'::jsonb
         || coalesce((select value from public.app_config where key = 'features'), '{}'::jsonb)
         || jsonb_build_object('archetypes', coalesce((select value from public.app_config where key = 'archetype_flags'), '{}'::jsonb));
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
       set value = coalesce(value, '{}'::jsonb) || jsonb_build_object(substr(p_key, 11), p_enabled), updated_at = now(), updated_by = v_uid
     where key = 'archetype_flags';
  else
    perform public._assert(p_key in ('ai_assistant', 'urgent_requests', 'fixed_asap'), 'unknown feature');
    insert into public.app_config (key, value, updated_at, updated_by)
    values ('features', jsonb_build_object(p_key, p_enabled), now(), v_uid)
    on conflict (key) do update
      set value = public.app_config.value || jsonb_build_object(p_key, p_enabled), updated_at = now(), updated_by = v_uid;
  end if;
  insert into public.admin_audit_log (admin_id, action, details)
  values (v_uid, 'set_feature', jsonb_build_object('key', p_key, 'enabled', p_enabled));
  return public.get_app_features();
end;
$$;

-- Urgent requests can be switched off without touching create_service_request.
create or replace function public._guard_urgent_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.urgent and not public._feature_enabled('urgent_requests') then
    raise exception 'Urgent requests are turned off right now. Pick a later date.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists service_requests_guard_urgent on public.service_requests;
create trigger service_requests_guard_urgent before insert on public.service_requests
  for each row execute function public._guard_urgent_request();

create or replace function public._guard_feature_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archetype text;
begin
  select archetype into v_archetype from public.categories where id = new.category_id;
  if v_archetype = 'fixed'
     and lower(coalesce(new.service_window, tstzrange(new.scheduled_at, new.scheduled_at + interval '2 hours', '[)'))) <= now() + interval '2 hours'
  then
    perform public._assert(public._feature_enabled('fixed_asap'), 'ASAP fixed-price booking is turned off. Choose a later time.');
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_guard_app_features on public.bookings;
create trigger bookings_guard_app_features before insert on public.bookings
  for each row execute function public._guard_feature_booking();

-- ---------------------------------------------------------------- services

create or replace function public.admin_list_categories()
returns table (
  id uuid, name text, slug text, archetype text, active boolean, sort_order int,
  cities jsonb, providers int, bookings_30d int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return query
  select c.id, c.name, c.slug, c.archetype, c.active, c.sort_order,
         coalesce((select jsonb_agg(jsonb_build_object('city', cc.city, 'live', cc.live) order by cc.city)
                     from public.category_cities cc where cc.category_id = c.id), '[]'::jsonb),
         (select count(distinct ps.provider_id)::int from public.provider_services ps where ps.category_id = c.id and ps.active),
         (select count(*)::int from public.bookings b where b.category_id = c.id and b.created_at > now() - interval '30 days')
    from public.categories c
   order by c.archetype, c.sort_order, c.name;
end;
$$;

create or replace function public.admin_set_category_active(p_category_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._is_admin(), 'admin only');
  update public.categories set active = p_active where id = p_category_id;
  perform public._assert(found, 'category not found');
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_category_active', p_category_id, jsonb_build_object('active', p_active));
end;
$$;

create or replace function public.admin_set_category_city(p_category_id uuid, p_city text, p_live boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_city text := trim(coalesce(p_city, ''));
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(char_length(v_city) between 2 and 120, 'city is required');
  perform public._assert(exists (select 1 from public.categories where id = p_category_id), 'category not found');
  update public.category_cities set live = p_live, launched_at = case when p_live then coalesce(launched_at, now()) else launched_at end
   where category_id = p_category_id and lower(trim(city)) = lower(v_city);
  if not found then
    insert into public.category_cities (category_id, city, live, launched_at)
    values (p_category_id, v_city, p_live, case when p_live then now() end);
  end if;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_category_city', p_category_id, jsonb_build_object('city', v_city, 'live', p_live));
end;
$$;

-- ---------------------------------------------------------------- dashboard

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
    'providers_pending', (select count(*) from public.providers where kyc_status in ('pending', 'under_review', 'needs_clarification') and submitted_at is not null),
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
     limit 8
  ) x;

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_status from (
    select status::text, count(*)::int n from public.bookings where created_at >= v_from group by status
  ) s;

  return jsonb_build_object('days', v_days, 'totals', v_totals, 'daily', v_daily, 'top_categories', v_top, 'status', v_status);
end;
$$;

-- ---------------------------------------------------------------- providers & creators

create or replace function public.admin_list_providers(p_filter text default 'all', p_search text default null)
returns table (
  id uuid, full_name text, phone text, city text, kyc_status text, suspended boolean, paused boolean, is_online boolean,
  rating_avg numeric, rating_count int, jobs_completed int, is_creator boolean, categories text[], submitted_at timestamptz,
  created_at timestamptz
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
    select p.id, pr.full_name, u.phone::text, p.city, p.kyc_status::text, p.suspended, coalesce(p.paused, false), p.is_online,
           p.rating_avg, p.rating_count, p.jobs_completed,
           exists (select 1 from public.provider_services ps join public.categories c on c.id = ps.category_id
                    where ps.provider_id = p.id and ps.active and c.archetype = 'proposal'),
           coalesce((select array_agg(c.name order by c.name) from public.provider_services ps
                       join public.categories c on c.id = ps.category_id where ps.provider_id = p.id and ps.active), '{}'),
           p.submitted_at, p.created_at
      from public.providers p
      join public.profiles pr on pr.id = p.id
      left join auth.users u on u.id = p.id
  ) x
  where (coalesce(p_filter, 'all') = 'all'
         or (p_filter = 'creators' and x.is_creator)
         or (p_filter = 'pending' and x.kyc_status in ('pending', 'under_review', 'needs_clarification') and x.submitted_at is not null)
         or (p_filter = 'suspended' and x.suspended))
    and (v_q is null or lower(coalesce(x.full_name, '')) like '%' || v_q || '%' or coalesce(x.phone, '') like '%' || v_q || '%'
         or lower(coalesce(x.city, '')) like '%' || v_q || '%')
  order by x.created_at desc
  limit 300;
end;
$$;

create or replace function public.admin_set_provider_kyc(p_provider_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(p_status in ('verified', 'rejected', 'needs_clarification', 'under_review'), 'invalid status');
  perform public._assert(p_status = 'verified' or coalesce(trim(p_reason), '') <> '', 'reason is required');
  update public.providers
     set kyc_status = p_status::public.kyc_status, kyc_reason = nullif(trim(coalesce(p_reason, '')), ''), kyc_updated_at = now()
   where id = p_provider_id;
  perform public._assert(found, 'provider not found');
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_provider_kyc', p_provider_id, jsonb_build_object('status', p_status, 'reason', p_reason));
end;
$$;

-- ---------------------------------------------------------------- bookings

create or replace function public.admin_list_bookings(p_status text default null, p_search text default null)
returns table (
  id uuid, created_at timestamptz, status text, archetype text, category text, customer text, customer_phone text,
  provider text, total_amount int, paid_paise int, scheduled_at timestamptz, city text
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
  select b.id, b.created_at, b.status::text, b.archetype, c.name, cp.full_name, cu.phone::text, pp.full_name,
         coalesce(b.total_amount, b.visit_fee),
         (select coalesce(sum(pm.amount), 0)::int from public.payments pm where pm.booking_id = b.id and pm.status = 'paid'),
         b.scheduled_at, a.city
    from public.bookings b
    join public.categories c on c.id = b.category_id
    left join public.profiles cp on cp.id = b.customer_id
    left join auth.users cu on cu.id = b.customer_id
    left join public.profiles pp on pp.id = b.provider_id
    left join public.addresses a on a.id = b.address_id
   where (p_status is null or p_status = 'all'
          or (p_status = 'active' and b.status::text not in ('completed', 'closed', 'closed_no_work', 'declined', 'expired', 'cancelled', 'refunded'))
          or b.status::text = p_status)
     and (v_q is null or b.id::text like v_q || '%' or replace(b.id::text, '-', '') like replace(replace(v_q, 'qs-', ''), '-', '') || '%'
          or lower(coalesce(cp.full_name, '')) like '%' || v_q || '%' or lower(coalesce(pp.full_name, '')) like '%' || v_q || '%'
          or lower(c.name) like '%' || v_q || '%')
   order by b.created_at desc
   limit 200;
end;
$$;

create or replace function public.admin_get_booking(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  select jsonb_build_object(
    'booking', to_jsonb(b) - 'service_window',
    'category', c.name,
    'customer', jsonb_build_object('id', b.customer_id, 'name', cp.full_name, 'phone', cu.phone),
    'provider', jsonb_build_object('id', b.provider_id, 'name', pp.full_name, 'phone', pu.phone),
    'address', (select jsonb_build_object('line1', a.line1, 'city', a.city) from public.addresses a where a.id = b.address_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'from', e.from_status, 'to', e.to_status, 'note', e.note) order by e.at)
                          from public.booking_events e where e.booking_id = b.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', pm.id, 'purpose', pm.purpose, 'amount', pm.amount, 'status', pm.status,
                                                              'paid_at', pm.paid_at, 'gateway_id', pm.razorpay_payment_id) order by pm.created_at)
                            from public.payments pm where pm.booking_id = b.id), '[]'::jsonb)
  ) into v
    from public.bookings b
    join public.categories c on c.id = b.category_id
    left join public.profiles cp on cp.id = b.customer_id
    left join auth.users cu on cu.id = b.customer_id
    left join public.profiles pp on pp.id = b.provider_id
    left join auth.users pu on pu.id = b.provider_id
   where b.id = p_booking_id;
  perform public._assert(v is not null, 'booking not found');
  return v;
end;
$$;

-- ---------------------------------------------------------------- support

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'chat_message', 'booking_requested', 'booking_accepted', 'booking_declined', 'booking_expired',
  'booking_cancelled', 'provider_en_route', 'quote_sent', 'change_order_sent', 'completion_requested',
  'travel_request_created', 'travel_request_approved', 'travel_request_declined', 'travel_request_expired',
  'proposal_request_received', 'proposal_received', 'proposal_booked', 'proposal_hold_expired',
  'request_message', 'milestone_due', 'delivery_submitted', 'support_message', 'support_reply'
));

create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 120),
  status text not null default 'open' check (status in ('open', 'closed')),
  user_unread int not null default 0,
  admin_unread int not null default 0,
  last_message text not null default '',
  last_from_admin boolean not null default false,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists support_threads_user_idx on public.support_threads (user_id, last_message_at desc);
create index if not exists support_threads_status_idx on public.support_threads (status, last_message_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  from_admin boolean not null default false,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_thread_idx on public.support_messages (thread_id, created_at);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_threads, public.support_messages from anon, authenticated;
grant select on public.support_threads, public.support_messages to authenticated;
drop policy if exists support_threads_read on public.support_threads;
create policy support_threads_read on public.support_threads for select to authenticated
  using (user_id = auth.uid() or public._is_admin());
drop policy if exists support_messages_read on public.support_messages;
create policy support_messages_read on public.support_messages for select to authenticated
  using (exists (select 1 from public.support_threads t where t.id = thread_id and (t.user_id = auth.uid() or public._is_admin())));

create or replace function public._support_post(p_thread public.support_threads, p_sender uuid, p_from_admin boolean, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := trim(coalesce(p_body, ''));
  v_name text;
begin
  perform public._assert(char_length(v_body) between 1 and 2000, 'message must be 1 to 2000 characters');
  insert into public.support_messages (thread_id, sender_id, from_admin, body) values (p_thread.id, p_sender, p_from_admin, v_body);
  update public.support_threads
     set status = 'open', last_message = left(v_body, 200), last_from_admin = p_from_admin, last_message_at = now(),
         user_unread = case when p_from_admin then user_unread + 1 else 0 end,
         admin_unread = case when p_from_admin then 0 else admin_unread + 1 end
   where id = p_thread.id;
  if p_from_admin then
    perform public._queue_notification(
      p_thread.user_id, 'support_reply', null, 'QuickServe support replied', left(v_body, 300),
      jsonb_build_object('url', '/support/' || p_thread.id, 'thread_id', p_thread.id),
      'support:' || p_thread.id::text);
  else
    select full_name into v_name from public.profiles where id = p_sender;
    perform public._queue_notification(
      a, 'support_message', null, 'Support: ' || coalesce(nullif(v_name, ''), 'a user') || ' · ' || p_thread.subject, left(v_body, 300),
      jsonb_build_object('url', '/admin/support/' || p_thread.id, 'thread_id', p_thread.id),
      'support-admin:' || p_thread.id::text)
      from public._admin_user_ids() a
     where a <> p_sender;
  end if;
end;
$$;

create or replace function public.support_start(p_body text, p_booking_id uuid default null, p_subject text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  t public.support_threads;
  v_subject text;
begin
  if p_booking_id is not null then
    perform public._assert(exists (select 1 from public.bookings b where b.id = p_booking_id
                                     and (b.customer_id = v_uid or b.provider_id = v_uid)), 'booking not found');
    select 'Booking QS-' || upper(left(replace(b.id::text, '-', ''), 8)) || ' · ' || c.name into v_subject
      from public.bookings b join public.categories c on c.id = b.category_id where b.id = p_booking_id;
    select * into t from public.support_threads
     where user_id = v_uid and booking_id = p_booking_id and status = 'open' order by created_at desc limit 1;
  end if;
  if t.id is null then
    insert into public.support_threads (user_id, booking_id, subject)
    values (v_uid, p_booking_id, left(coalesce(nullif(trim(coalesce(p_subject, '')), ''), v_subject, 'General help'), 120))
    returning * into t;
  end if;
  perform public._support_post(t, v_uid, false, p_body);
  return t.id;
end;
$$;

create or replace function public.support_send(p_thread_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  t public.support_threads;
begin
  select * into t from public.support_threads where id = p_thread_id for update;
  perform public._assert(found, 'conversation not found');
  if t.user_id = v_uid then
    perform public._support_post(t, v_uid, false, p_body);
  else
    perform public._assert(public._is_admin(), 'conversation not found');
    perform public._support_post(t, v_uid, true, p_body);
  end if;
end;
$$;

create or replace function public.support_mark_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  update public.support_threads set user_unread = 0 where id = p_thread_id and user_id = v_uid;
  if not found and public._is_admin() then
    update public.support_threads set admin_unread = 0 where id = p_thread_id;
  end if;
end;
$$;

create or replace function public.support_set_status(p_thread_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(p_status in ('open', 'closed'), 'invalid status');
  update public.support_threads set status = p_status
   where id = p_thread_id and (user_id = v_uid or public._is_admin());
  perform public._assert(found, 'conversation not found');
end;
$$;

create or replace function public.admin_list_support_threads(p_status text default 'open')
returns table (
  id uuid, subject text, status text, booking_id uuid, user_id uuid, user_name text, user_phone text, is_provider boolean,
  admin_unread int, last_message text, last_from_admin boolean, last_message_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return query
  select t.id, t.subject, t.status, t.booking_id, t.user_id, p.full_name, u.phone::text, coalesce(p.role_provider, false),
         t.admin_unread, t.last_message, t.last_from_admin, t.last_message_at
    from public.support_threads t
    join public.profiles p on p.id = t.user_id
    left join auth.users u on u.id = t.user_id
   where coalesce(p_status, 'all') = 'all' or t.status = p_status
   order by t.admin_unread > 0 desc, t.last_message_at desc
   limit 200;
end;
$$;

revoke execute on function
  public._admin_user_ids(), public._feature_enabled(text), public._guard_urgent_request(),
  public._guard_feature_booking(), public._support_post(public.support_threads, uuid, boolean, text)
from public, anon, authenticated;
revoke execute on function
  public.am_i_admin(), public.admin_set_feature(text, boolean), public.admin_list_categories(),
  public.admin_set_category_active(uuid, boolean), public.admin_set_category_city(uuid, text, boolean),
  public.admin_dashboard(int), public.admin_list_providers(text, text), public.admin_set_provider_kyc(uuid, text, text),
  public.admin_list_bookings(text, text), public.admin_get_booking(uuid),
  public.support_start(text, uuid, text), public.support_send(uuid, text), public.support_mark_read(uuid),
  public.support_set_status(uuid, text), public.admin_list_support_threads(text)
from public, anon;
grant execute on function
  public.am_i_admin(), public.admin_set_feature(text, boolean), public.admin_list_categories(),
  public.admin_set_category_active(uuid, boolean), public.admin_set_category_city(uuid, text, boolean),
  public.admin_dashboard(int), public.admin_list_providers(text, text), public.admin_set_provider_kyc(uuid, text, text),
  public.admin_list_bookings(text, text), public.admin_get_booking(uuid),
  public.support_start(text, uuid, text), public.support_send(uuid, text), public.support_mark_read(uuid),
  public.support_set_status(uuid, text), public.admin_list_support_threads(text)
to authenticated;
grant execute on function public.get_app_features() to anon, authenticated;

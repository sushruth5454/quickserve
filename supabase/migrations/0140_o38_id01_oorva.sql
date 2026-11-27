-- O38-ID01: per-requirement readiness and safe owner/admin/job projections.

create function public._provider_document_requirement(
  p_provider_id uuid,
  p_doc_type text,
  p_category_id uuid
)
returns table (
  satisfied boolean,
  approved_document_id uuid,
  approved_status text,
  latest_document_id uuid,
  latest_status text,
  effective_latest_status text,
  expires_on date,
  reject_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  with provider_day as (
    select public._provider_local_date(p_provider_id, now()) as local_date
  )
  select approved.id is not null,
         approved.id,
         case when approved.id is not null then 'approved'::text end,
         latest.id,
         latest.status,
         case
           when latest.status = 'approved'
            and latest.expires_on < provider_day.local_date then 'expired'::text
           else latest.status
         end,
         latest.expires_on,
         latest.reject_reason
    from provider_day
    left join lateral (
      select pd.id
        from public.provider_documents pd
       where pd.provider_id = p_provider_id
         and pd.doc_type = p_doc_type
         and (pd.category_id is null or pd.category_id = p_category_id)
         and pd.status = 'approved'
         and (pd.expires_on is null or pd.expires_on >= provider_day.local_date)
       order by pd.created_at desc, pd.id desc
       limit 1
    ) approved on true
    left join lateral (
      select pd.id, pd.status, pd.expires_on, pd.reject_reason
        from public.provider_documents pd
       where pd.provider_id = p_provider_id
         and pd.doc_type = p_doc_type
         and (pd.category_id is null or pd.category_id = p_category_id)
         and pd.status <> 'superseded'
       order by pd.created_at desc, pd.id desc
       limit 1
    ) latest on true;
$$;

revoke all on function public._provider_document_requirement(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public._provider_onboarding_checks(p_provider_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'name', 'required', true, 'ok', char_length(trim(coalesce(pf.full_name, ''))) >= 2),
    jsonb_build_object('key', 'photo', 'required', true, 'ok', pf.avatar_url is not null),
    jsonb_build_object('key', 'bio', 'required', true, 'ok', char_length(trim(coalesce(p.bio, ''))) >= 30),
    jsonb_build_object('key', 'languages', 'required', true, 'ok', cardinality(p.languages) >= 1),
    jsonb_build_object('key', 'services', 'required', true,
                       'ok', exists (select 1 from public.provider_services s where s.provider_id = p.id and s.active)),
    jsonb_build_object('key', 'area', 'required', true, 'ok', trim(p.city) <> '' and p.base_location is not null),
    jsonb_build_object('key', 'hours', 'required', true,
                       'ok', exists (select 1 from public.provider_availability a where a.provider_id = p.id)),
    jsonb_build_object('key', 'specialisations', 'required', false,
                       'ok', exists (select 1 from public.provider_services s where s.provider_id = p.id and s.active)
                             and not exists (select 1 from public.provider_services s
                                              where s.provider_id = p.id and s.active and cardinality(s.specialisations) = 0)),
    jsonb_build_object('key', 'portfolio', 'required', false,
                       'ok', (select count(*) from public.provider_portfolio x where x.provider_id = p.id) >= 3),
    jsonb_build_object('key', 'payout', 'required', false,
                       'ok', p.razorpay_account_id is not null
                             or exists (select 1 from public.provider_payout_accounts pa
                                         where pa.provider_id = p.id
                                           and (pa.razorpay_account_id is not null or pa.fund_account_id is not null)))
  )
    from public.providers p join public.profiles pf on pf.id = p.id
   where p.id = p_provider_id;
$$;

create or replace function public._provider_go_live(p_provider_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.providers;
  pa public.provider_payout_accounts;
  v_reasons jsonb := '[]'::jsonb;
  v_state text;
  r record;
begin
  select * into p from public.providers where id = p_provider_id;
  if not found then
    return jsonb_build_object('state', 'draft', 'reasons', '[]'::jsonb, 'paused', false);
  end if;
  select * into pa from public.provider_payout_accounts where provider_id = p_provider_id;

  -- Payout beneficiary (either rail)
  if p.kyc_status = 'verified' then
    null;
  elsif pa.provider_id is not null and pa.last_error = 'gateway_unavailable' then
    v_reasons := v_reasons || jsonb_build_object('code', 'payout_unavailable', 'severity', 'wait');
  elsif pa.provider_id is null or (pa.razorpay_account_id is null and pa.fund_account_id is null) then
    v_reasons := v_reasons || jsonb_build_object('code', 'payout_missing', 'severity', 'action',
                                                 'detail', case when pa.last_error is not null then pa.last_error end);
  elsif p.kyc_status = 'needs_clarification' then
    v_reasons := v_reasons || jsonb_build_object('code', 'payout_needs_clarification', 'severity', 'action',
                                                 'detail', p.kyc_reason, 'requirements', p.kyc_requirements);
  elsif p.kyc_status = 'rejected' then
    v_reasons := v_reasons || jsonb_build_object('code', 'payout_rejected', 'severity', 'action', 'detail', p.kyc_reason);
  elsif p.kyc_status = 'suspended' then
    v_reasons := v_reasons || jsonb_build_object('code', 'payout_suspended', 'severity', 'action', 'detail', p.kyc_reason);
  else
    v_reasons := v_reasons || jsonb_build_object('code', 'payout_pending', 'severity', 'wait');
  end if;

  -- Required documents are evaluated independently by code and category.
  for r in
    select distinct d.doc_type, c.id as category_id, c.name as category_name,
           requirement.satisfied, requirement.latest_status,
           requirement.effective_latest_status, requirement.reject_reason
      from public.provider_services s
      join public.categories c on c.id = s.category_id
      cross join lateral unnest(c.requires_docs) as d(doc_type)
      cross join lateral public._provider_document_requirement(p.id, d.doc_type, c.id) as requirement
     where s.provider_id = p.id and s.active
  loop
    if r.satisfied then
      continue;
    elsif r.latest_status is null then
      v_reasons := v_reasons || jsonb_build_object('code', 'doc_missing', 'severity', 'action', 'doc_type', r.doc_type, 'category', r.category_name);
    elsif r.effective_latest_status = 'pending' then
      v_reasons := v_reasons || jsonb_build_object('code', 'doc_pending', 'severity', 'wait', 'doc_type', r.doc_type, 'category', r.category_name);
    elsif r.effective_latest_status = 'rejected' then
      v_reasons := v_reasons || jsonb_build_object('code', 'doc_rejected', 'severity', 'action', 'doc_type', r.doc_type,
                                                   'category', r.category_name, 'detail', r.reject_reason);
    else
      v_reasons := v_reasons || jsonb_build_object('code', 'doc_expired', 'severity', 'action', 'doc_type', r.doc_type, 'category', r.category_name);
    end if;
  end loop;

  if not exists (select 1 from public.provider_services s where s.provider_id = p.id and s.active) then
    v_reasons := v_reasons || jsonb_build_object('code', 'no_active_service', 'severity', 'action');
  end if;
  if p.review_note is not null then
    v_reasons := v_reasons || jsonb_build_object('code', 'admin_note', 'severity', 'action', 'detail', p.review_note);
  end if;

  v_state := case
    when p.deactivated_at is not null then 'deactivated'
    when p.suspended then 'suspended'
    when p.submitted_at is null then 'draft'
    when public._provider_is_live(p.id) then 'live'
    when exists (select 1 from jsonb_array_elements(v_reasons) x where x ->> 'severity' = 'action') then 'action_needed'
    else 'under_review'
  end;
  return jsonb_build_object('state', v_state, 'reasons', v_reasons, 'paused', p.paused,
                            'live', public._provider_is_live(p.id), 'submitted_at', p.submitted_at);
end;
$$;

create or replace function public.get_my_provider_onboarding()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  if not exists (select 1 from public.providers where id = v_uid) then
    return jsonb_build_object('provider', null, 'terms_version', public._provider_terms_version(),
                              'go_live', jsonb_build_object('state', 'draft', 'reasons', '[]'::jsonb, 'paused', false),
                              'document_requirements', '[]'::jsonb, 'server_local_date', null);
  end if;
  return jsonb_build_object(
    'provider', public.get_my_provider(),
    'profile', (select jsonb_build_object('full_name', full_name, 'avatar_url', avatar_url) from public.profiles where id = v_uid),
    'payout', (select to_jsonb(pa) - 'email' || jsonb_build_object('has_email', pa.email is not null)
                 from public.provider_payout_accounts pa where pa.provider_id = v_uid),
    'documents', coalesce((select jsonb_agg(to_jsonb(d) - 'reviewed_by' order by d.created_at desc)
                             from public.provider_documents d where d.provider_id = v_uid and d.status <> 'superseded'), '[]'::jsonb),
    'document_requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'doc_type', required.doc_type,
               'category_id', required.category_id,
               'category_name', required.category_name,
               'satisfied', requirement.satisfied,
               'approved_document_id', requirement.approved_document_id,
               'approved_status', requirement.approved_status,
               'latest_document_id', requirement.latest_document_id,
               'latest_status', requirement.latest_status,
               'effective_latest_status', requirement.effective_latest_status,
               'expires_on', requirement.expires_on,
               'reject_reason', requirement.reject_reason
             ) order by required.category_name, required.doc_type, required.category_id)
        from (
          select distinct d.doc_type, c.id as category_id, c.name as category_name
            from public.provider_services s
            join public.categories c on c.id = s.category_id
            cross join lateral unnest(c.requires_docs) as d(doc_type)
           where s.provider_id = v_uid and s.active
        ) required
        cross join lateral public._provider_document_requirement(
          v_uid, required.doc_type, required.category_id
        ) as requirement
    ), '[]'::jsonb),
    'server_local_date', public._provider_local_date(v_uid, now()),
    'availability', coalesce((select jsonb_agg(jsonb_build_object('weekday', a.weekday, 'start', to_char(a.start_time, 'HH24:MI'),
                                                                  'end', to_char(a.end_time, 'HH24:MI')) order by a.weekday, a.start_time)
                                from public.provider_availability a where a.provider_id = v_uid), '[]'::jsonb),
    'time_off', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'from', lower(t.period), 'to', upper(t.period), 'reason', t.reason)
                                           order by lower(t.period))
                            from public.provider_time_off t where t.provider_id = v_uid and upper(t.period) > now()), '[]'::jsonb),
    'portfolio', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'file_path', x.file_path, 'caption', x.caption) order by x.sort_order)
                             from public.provider_portfolio x where x.provider_id = v_uid), '[]'::jsonb),
    'checks', public._provider_onboarding_checks(v_uid),
    'go_live', public._provider_go_live(v_uid),
    'terms_version', public._provider_terms_version()
  );
end;
$$;

drop function if exists public.admin_list_providers(text, text);

create function public.admin_list_providers(p_filter text default 'all', p_search text default null)
returns table (
  id uuid, full_name text, phone text, city text, kyc_status text, admin_review_status text,
  has_payout_account boolean, suspended boolean, paused boolean, is_online boolean,
  rating_avg numeric, rating_count int, jobs_completed int, is_creator boolean, categories text[],
  submitted_at timestamptz, created_at timestamptz, go_live jsonb, review_note text
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
           p.razorpay_account_id is not null
             or exists (select 1 from public.provider_payout_accounts pa where pa.provider_id = p.id),
           p.suspended, coalesce(p.paused, false), p.is_online,
           p.rating_avg, p.rating_count, p.jobs_completed,
           exists (select 1 from public.provider_services ps join public.categories c on c.id = ps.category_id
                    where ps.provider_id = p.id and ps.active and c.archetype = 'proposal') as is_creator,
           coalesce((select array_agg(c.name order by c.name) from public.provider_services ps
                       join public.categories c on c.id = ps.category_id where ps.provider_id = p.id and ps.active), '{}') as categories,
           p.submitted_at, p.created_at, public._provider_go_live(p.id), p.review_note
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

drop function if exists public.admin_list_document_queue(int);

create function public.admin_list_document_queue(p_limit int default 100)
returns table (
  document_id uuid, provider_id uuid, provider_name text, doc_type text, category_id uuid,
  category_name text, file_path text, expires_on date, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return query
    select d.id, d.provider_id, pf.full_name, d.doc_type, d.category_id,
           case when d.category_id is null then 'General' else c.name end,
           d.file_path, d.expires_on, d.created_at
      from public.provider_documents d
      join public.profiles pf on pf.id = d.provider_id
      left join public.categories c on c.id = d.category_id
     where d.status = 'pending'
     order by d.created_at
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke execute on function public.admin_list_document_queue(int) from public, anon;
grant execute on function public.admin_list_document_queue(int) to authenticated;

drop function if exists public.get_provider_jobs();

create function public.get_provider_jobs()
returns table (
  booking_id uuid,
  status public.booking_status,
  category_name text,
  customer_name text,
  description text,
  scheduled_at timestamptz,
  created_at timestamptz,
  visit_fee int,
  area text,
  distance_km double precision,
  address_line text,
  lat double precision,
  lng double precision,
  archetype text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.status, c.name, pf.full_name, b.description, b.scheduled_at, b.created_at, b.visit_fee,
         a.city,
         case when pr.base_location is not null and a.location is not null
              then round((extensions.st_distance(pr.base_location, a.location) / 1000.0)::numeric, 1)::double precision end,
         case when b.accepted_at is not null then a.line1 end,
         case when b.accepted_at is not null then a.lat end,
         case when b.accepted_at is not null then a.lng end,
         b.archetype::text
    from public.bookings b
    join public.categories c on c.id = b.category_id
    join public.profiles pf on pf.id = b.customer_id
    join public.addresses a on a.id = b.address_id
    join public.providers pr on pr.id = b.provider_id
   where b.provider_id = auth.uid()
     and b.status <> 'pending_payment'
   order by b.created_at desc
   limit 200;
$$;

revoke execute on function public.get_provider_jobs() from public, anon;
grant execute on function public.get_provider_jobs() to authenticated;

drop function if exists public.get_my_business_provider_jobs(uuid);

create function public.get_my_business_provider_jobs(p_provider_id uuid)
returns table (
  booking_id uuid,
  status public.booking_status,
  category_name text,
  customer_name text,
  description text,
  scheduled_at timestamptz,
  created_at timestamptz,
  visit_fee int,
  area text,
  distance_km double precision,
  address_line text,
  lat double precision,
  lng double precision,
  archetype text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.status, c.name, pf.full_name, b.description, b.scheduled_at, b.created_at, b.visit_fee,
         a.city,
         case when pr.base_location is not null and a.location is not null
              then round((extensions.st_distance(pr.base_location, a.location) / 1000.0)::numeric, 1)::double precision end,
         case when b.accepted_at is not null then a.line1 end,
         case when b.accepted_at is not null then a.lat end,
         case when b.accepted_at is not null then a.lng end,
         b.archetype::text
    from public.bookings b
    join public.categories c on c.id = b.category_id
    join public.profiles pf on pf.id = b.customer_id
    join public.addresses a on a.id = b.address_id
    join public.providers pr on pr.id = b.provider_id
   where b.provider_id = p_provider_id
     and public._acts_for(p_provider_id, 'staff')
     and b.status <> 'pending_payment'
   order by b.created_at desc
   limit 200;
$$;

revoke execute on function public.get_my_business_provider_jobs(uuid) from public, anon;
grant execute on function public.get_my_business_provider_jobs(uuid) to authenticated;

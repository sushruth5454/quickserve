-- Review-aware matching foundations (docs/09-Smart-Matching-Creators-OnPlatform-Strategy.md, M1).
-- Kept generic so adding makeup, photography or creator categories remains configuration data.

alter table public.categories
  add column if not exists profile_schema jsonb not null default '{"type":"object","properties":{}}'::jsonb,
  add column if not exists review_tags text[] not null default '{}';

alter table public.provider_services
  add column if not exists attributes jsonb not null default '{}'::jsonb;

alter table public.reviews
  add column if not exists tags text[] not null default '{}';

create table public.provider_links (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  kind text not null check (kind in ('instagram', 'youtube', 'facebook', 'website', 'behance', 'google_business', 'other')),
  url text not null check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 2048),
  handle text check (handle is null or char_length(handle) <= 100),
  verified_method text not null default 'none'
    check (verified_method in ('oauth', 'dns', 'manual', 'none')),
  stats jsonb not null default '{}'::jsonb,
  stats_synced_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_reason text check (review_reason is null or char_length(review_reason) <= 500),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider_id, kind)
);

-- Current categories are intentionally configured without making P0 onboarding harder.
update public.categories
   set profile_schema = case slug
     when 'ac-repair' then '{"type":"object","properties":{"equipment":{"type":"array","items":{"type":"string","enum":["split","window","inverter","cassette"]},"maxItems":8},"expertise":{"type":"array","items":{"type":"string","enum":["gas_refill","deep_service","pcb_repair","installation"]},"maxItems":8}}}'::jsonb
     when 'electrician' then '{"type":"object","properties":{"expertise":{"type":"array","items":{"type":"string","enum":["wiring","inverter_ups","fixtures","mcb_db"]},"maxItems":8}}}'::jsonb
     when 'plumber' then '{"type":"object","properties":{"expertise":{"type":"array","items":{"type":"string","enum":["leaks","drainage","motor","pipeline","bathroom"]},"maxItems":8}}}'::jsonb
     when 'house-cleaning' then '{"type":"object","properties":{"specialties":{"type":"array","items":{"type":"string","enum":["full_home","bathroom","kitchen","sofa_carpet"]},"maxItems":8},"supplies_mode":{"type":"string","enum":["included","customer"]}}}'::jsonb
     when 'water-tank-cleaning' then '{"type":"object","properties":{"tank_types":{"type":"array","items":{"type":"string","enum":["overhead","sump","commercial"]},"maxItems":8}}}'::jsonb
     when 'pest-control' then '{"type":"object","properties":{"pests":{"type":"array","items":{"type":"string","enum":["cockroaches","termites","bed_bugs","rats","mosquitoes"]},"maxItems":8}}}'::jsonb
     else profile_schema
   end,
   review_tags = case slug
     when 'ac-repair' then array['clean_work','quick_diagnosis','long_lasting','explained_well']
     when 'electrician' then array['safe_work','clean_wiring','quick_fix','explained_well']
     when 'plumber' then array['leak_fixed','clean_work','came_prepared','explained_well']
     when 'house-cleaning' then array['deep_clean','on_time','supplies_included','careful_handling']
     when 'water-tank-cleaning' then array['on_time','thorough','safe_chemicals','clean_finish']
     when 'pest-control' then array['effective','safe_chemicals','follow_up','explained_well']
     else review_tags
   end
 where slug in ('ac-repair', 'electrician', 'plumber', 'house-cleaning', 'water-tank-cleaning', 'pest-control');

create or replace function public._validate_profile_schema(p_schema jsonb, p_path text default '$')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := coalesce(p_schema ->> 'type', '');
  v_property record;
begin
  perform public._assert(
    v_type in ('object', 'string', 'integer', 'number', 'boolean', 'array'),
    format('%s: unsupported profile schema type', p_path)
  );
  if v_type = 'object' then
    perform public._assert(jsonb_typeof(coalesce(p_schema -> 'properties', '{}'::jsonb)) = 'object', format('%s.properties must be an object', p_path));
    for v_property in select key, value from jsonb_each(coalesce(p_schema -> 'properties', '{}'::jsonb))
    loop
      perform public._validate_profile_schema(v_property.value, p_path || '.' || v_property.key);
    end loop;
  elsif v_type = 'array' then
    perform public._assert(jsonb_typeof(p_schema -> 'items') = 'object', format('%s.items must be an object', p_path));
    perform public._validate_profile_schema(p_schema -> 'items', p_path || '[]');
    perform public._assert(
      p_schema -> 'maxItems' is null
      or (jsonb_typeof(p_schema -> 'maxItems') = 'number' and (p_schema ->> 'maxItems')::int between 1 and 50),
      format('%s.maxItems must be between 1 and 50', p_path)
    );
  elsif p_schema ? 'enum' then
    perform public._assert(jsonb_typeof(p_schema -> 'enum') = 'array' and jsonb_array_length(p_schema -> 'enum') between 1 and 100,
                           format('%s.enum must contain 1 to 100 values', p_path));
  end if;
end;
$$;

create or replace function public._validate_profile_attributes(p_schema jsonb, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_spec jsonb;
  v_value jsonb;
  v_type text;
begin
  perform public._assert(jsonb_typeof(p_value) = 'object', 'attributes must be an object');
  for v_key, v_spec in select key, value from jsonb_each(coalesce(p_schema -> 'properties', '{}'::jsonb))
  loop
    v_value := p_value -> v_key;
    v_type := v_spec ->> 'type';
    if coalesce(p_schema -> 'required', '[]'::jsonb) ? v_key then
      perform public._assert(v_value is not null and v_value <> 'null'::jsonb, format('%s is required', v_key));
    end if;
    continue when v_value is null or v_value = 'null'::jsonb;
    perform public._assert(
      case v_type
        when 'string' then jsonb_typeof(v_value) = 'string'
        when 'integer' then jsonb_typeof(v_value) = 'number' and (v_value #>> '{}') ~ '^-?[0-9]+$'
        when 'number' then jsonb_typeof(v_value) = 'number'
        when 'boolean' then jsonb_typeof(v_value) = 'boolean'
        when 'array' then jsonb_typeof(v_value) = 'array'
        else false
      end,
      format('%s has the wrong type', v_key)
    );
    if v_spec ? 'enum' then
      if v_type = 'array' then
        perform public._assert(not exists (
          select 1 from jsonb_array_elements(v_value) item
          where not ((v_spec -> 'enum') @> jsonb_build_array(item.value))
        ), format('%s contains an unsupported value', v_key));
      else
        perform public._assert((v_spec -> 'enum') @> jsonb_build_array(v_value), format('%s has an unsupported value', v_key));
      end if;
    end if;
    if v_type = 'array' and (v_spec -> 'items') ? 'enum' then
      perform public._assert(not exists (
        select 1 from jsonb_array_elements(v_value) item
        where not ((v_spec -> 'items' -> 'enum') @> jsonb_build_array(item.value))
      ), format('%s contains an unsupported item', v_key));
    end if;
    if v_type = 'array' and v_spec ? 'maxItems' then
      perform public._assert(jsonb_array_length(v_value) <= (v_spec ->> 'maxItems')::int,
                             format('%s has too many values', v_key));
    end if;
  end loop;
  perform public._assert(not exists (
    select 1 from jsonb_each(p_value) v
    where not exists (select 1 from jsonb_each(coalesce(p_schema -> 'properties', '{}'::jsonb)) s where s.key = v.key)
  ), 'attributes contain a field not configured for this category');
end;
$$;

create or replace function public._validate_provider_attributes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schema jsonb;
begin
  select profile_schema into v_schema from public.categories where id = new.category_id;
  perform public._validate_profile_attributes(coalesce(v_schema, '{"type":"object","properties":{}}'::jsonb), coalesce(new.attributes, '{}'::jsonb));
  return new;
end;
$$;

create trigger provider_services_validate_attributes
  before insert or update of attributes, category_id on public.provider_services
  for each row execute function public._validate_provider_attributes();

create or replace function public._validate_review_tags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed text[];
begin
  select c.review_tags into v_allowed
    from public.bookings b join public.categories c on c.id = b.category_id
   where b.id = new.booking_id;
  new.tags := array(select distinct trim(x) from unnest(coalesce(new.tags, '{}')) x where trim(x) <> '' order by trim(x));
  perform public._assert(cardinality(new.tags) <= 5, 'choose at most 5 review tags');
  perform public._assert(not exists (
    select 1 from unnest(new.tags) t
    where not (t = any (coalesce(v_allowed, '{}')))
  ), 'review contains a tag not available for this category');
  return new;
end;
$$;

create trigger reviews_validate_tags
  before insert or update of tags, booking_id on public.reviews
  for each row execute function public._validate_review_tags();

create or replace function public._validate_category_matching_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._validate_profile_schema(coalesce(new.profile_schema, '{"type":"object","properties":{}}'::jsonb));
  new.review_tags := array(select distinct trim(x) from unnest(coalesce(new.review_tags, '{}')) x where trim(x) <> '' order by trim(x));
  perform public._assert(cardinality(new.review_tags) <= 30, 'at most 30 review tags');
  perform public._assert(not exists (select 1 from unnest(new.review_tags) t where char_length(t) > 60), 'review tag is too long');
  return new;
end;
$$;

create trigger categories_validate_matching_config
  before insert or update of profile_schema, review_tags on public.categories
  for each row execute function public._validate_category_matching_config();

create or replace function public._validate_provider_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.url := trim(coalesce(new.url, ''));
  new.handle := nullif(trim(coalesce(new.handle, '')), '');
  perform public._assert(new.url ~ '^https://' and char_length(new.url) <= 2048, 'link must be a full https URL');
  perform public._assert(
    new.url !~* '(wa\.me|whatsapp\.com/send|t\.me|telegram\.me|upi://|linktr\.ee|bit\.ly|tinyurl\.com)',
    'contact and URL-shortener links are not allowed'
  );
  perform public._assert(
    coalesce(new.handle, '') !~* '([6-9][0-9][[:space:]().-]*[0-9][[:space:]().-]*){4}|@[^[:space:]]+|https?://',
    'contact details are not allowed in a link label'
  );
  return new;
end;
$$;

create trigger provider_links_validate
  before insert or update of url, handle, kind on public.provider_links
  for each row execute function public._validate_provider_link();

create or replace function public.admin_review_provider_link(p_link_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._require_uid();
  v_provider uuid;
begin
  perform public._assert(public._is_admin(), 'admin only');
  update public.provider_links
     set status = case when p_approve then 'approved' else 'rejected' end,
         review_reason = nullif(trim(coalesce(p_reason, '')), ''),
         reviewed_by = v_admin,
         reviewed_at = now()
   where id = p_link_id
   returning provider_id into v_provider;
  perform public._assert(found, 'link not found');
  insert into public.admin_audit_log (admin_id, action, details)
  values (v_admin, case when p_approve then 'approve_provider_link' else 'reject_provider_link' end,
          jsonb_build_object('link_id', p_link_id, 'provider_id', v_provider, 'reason', p_reason));
end;
$$;

alter table public.provider_links enable row level security;
revoke all on table public.provider_links from anon, authenticated;
grant select, delete on public.provider_links to authenticated;
grant insert (provider_id, kind, url, handle) on public.provider_links to authenticated;
grant update (url, handle) on public.provider_links to authenticated;
grant select on public.provider_links to anon;
create policy provider_links_owner_read on public.provider_links
  for select to authenticated using (provider_id = auth.uid());
create policy provider_links_public_read on public.provider_links
  for select to anon, authenticated
  using (status = 'approved' and exists (select 1 from public.providers p where p.id = provider_links.provider_id and public._provider_is_live(p.id)));
create policy provider_links_owner_insert on public.provider_links
  for insert to authenticated with check (provider_id = auth.uid());
create policy provider_links_owner_update on public.provider_links
  for update to authenticated using (provider_id = auth.uid()) with check (provider_id = auth.uid());
create policy provider_links_owner_delete on public.provider_links
  for delete to authenticated using (provider_id = auth.uid());

create or replace function public.save_provider_link(p_kind text, p_url text, p_handle text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_id uuid;
begin
  insert into public.provider_links (provider_id, kind, url, handle)
  values (v_uid, p_kind, p_url, p_handle)
  on conflict (provider_id, kind) do update
    set url = excluded.url,
        handle = excluded.handle,
        status = case
          when public.provider_links.url is distinct from excluded.url
            or public.provider_links.handle is distinct from excluded.handle then 'pending'
          else public.provider_links.status
        end,
        review_reason = case
          when public.provider_links.url is distinct from excluded.url
            or public.provider_links.handle is distinct from excluded.handle then null
          else public.provider_links.review_reason
        end,
        reviewed_by = case
          when public.provider_links.url is distinct from excluded.url
            or public.provider_links.handle is distinct from excluded.handle then null
          else public.provider_links.reviewed_by
        end,
        reviewed_at = case
          when public.provider_links.url is distinct from excluded.url
            or public.provider_links.handle is distinct from excluded.handle then null
          else public.provider_links.reviewed_at
        end
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.save_provider_link(text, text, text) to authenticated;
revoke execute on function public.save_provider_link(text, text, text) from public, anon;

-- Extend the review write contract. Existing callers can omit p_tags.
create or replace function public.submit_review(
  p_booking_id uuid, p_rating int, p_punctuality int default null, p_quality int default null,
  p_behaviour int default null, p_pricing int default null, p_comment text default null,
  p_tags text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_id uuid;
begin
  perform public._assert(b.customer_id = v_uid, 'only the customer can review');
  perform public._assert(b.status in ('completed', 'closed'), 'only completed jobs can be reviewed');
  perform public._assert(b.total_amount is not null and public._paid_total(b.id) >= b.total_amount,
                          'only jobs paid in the app can be reviewed');
  perform public._assert(not exists (select 1 from public.reviews where booking_id = b.id), 'already reviewed');
  insert into public.reviews (booking_id, customer_id, provider_id, rating, punctuality, quality, behaviour, pricing, comment, tags)
  values (b.id, v_uid, b.provider_id, p_rating, p_punctuality, p_quality, p_behaviour, p_pricing, nullif(trim(p_comment), ''), coalesce(p_tags, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;

-- Category + public-profile reads include only safe, display-ready matching data.
create or replace function public.get_provider_public_profile(p_provider_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.providers;
  v_today date;
begin
  select * into p from public.providers where id = p_provider_id;
  if not found or not (public._provider_is_live(p_provider_id) or p_provider_id = auth.uid()) then
    return null;
  end if;
  v_today := public._provider_local_date(p_provider_id, now());
  return jsonb_build_object(
    'id', p.id,
    'base_area', p.base_area,
    'city', p.city,
    'service_radius_km', p.service_radius_km,
    'paused', p.paused,
    'live', public._provider_is_live(p.id),
    'member_since', p.created_at,
    'badges', jsonb_build_object(
      'id_verified', p.kyc_status = 'verified' and coalesce(p.razorpay_account_id, '') like 'acc\_%',
      'payout_verified', p.kyc_status = 'verified',
      'police_verified', exists (select 1 from public.provider_documents d where d.provider_id = p.id and d.doc_type = 'police_verification'
                                  and d.status = 'approved' and (d.expires_on is null or d.expires_on >= v_today))),
    'credentials', coalesce((select jsonb_agg(distinct dt.label) from public.provider_documents d join public.document_types dt on dt.code = d.doc_type
                              where d.provider_id = p.id and d.status = 'approved' and (d.expires_on is null or d.expires_on >= v_today)),
                            '[]'::jsonb),
    'specialisations', coalesce((select jsonb_agg(jsonb_build_object(
                                   'category_id', s.category_id,
                                   'labels', (select coalesce(jsonb_agg(k.label order by k.sort_order), '[]'::jsonb) from public.category_skills k
                                               where k.category_id = s.category_id and k.kind = 'skill' and k.slug = any (s.specialisations)),
                                   'brands', to_jsonb(s.brands),
                                   'attributes', s.attributes,
                                   'schema', c.profile_schema))
                                from public.provider_services s
                                join public.categories c on c.id = s.category_id
                               where s.provider_id = p.id and s.active), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', a.weekday, 'start', to_char(a.start_time, 'HH24:MI'),
                                                           'end', to_char(a.end_time, 'HH24:MI')) order by a.weekday, a.start_time)
                         from public.provider_availability a where a.provider_id = p.id), '[]'::jsonb),
    'on_leave_until', (select max(upper(t.period)) from public.provider_time_off t where t.provider_id = p.id and t.period @> now()),
    'portfolio', coalesce((select jsonb_agg(jsonb_build_object('file_path', x.file_path, 'caption', x.caption) order by x.sort_order)
                             from public.provider_portfolio x where x.provider_id = p.id), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'url', l.url, 'handle', l.handle,
                                                           'status', l.status, 'review_reason', l.review_reason,
                                                           'verified', l.verified_method <> 'none', 'verified_method', l.verified_method,
                                                           'stats', l.stats, 'stats_synced_at', l.stats_synced_at)
                                       order by l.created_at) from public.provider_links l
                                      where l.provider_id = p.id and (l.status = 'approved' or p.id = auth.uid())), '[]'::jsonb),
    'review_themes', coalesce((select jsonb_agg(jsonb_build_object('tag', tag, 'count', n) order by n desc, tag)
                                from (select unnest(r.tags) tag, count(*) n
                                        from public.reviews r
                                       where r.provider_id = p.id
                                       group by 1
                                       order by n desc
                                       limit 10) x), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.submit_review(uuid, int, int, int, int, int, text, text[]) to authenticated;
revoke execute on function public.admin_review_provider_link(uuid, boolean, text) from public, anon;

-- Review-aware, deterministic provider matching (docs/09, M2.1/A4 and A5).

insert into public.app_config (key, value)
values (
  'match_weights',
  '{"rating":0.45,"need":0.35,"reliability":0.15,"distance_penalty":0.10,"repeat":0.05,"rating_prior":10,"nearest_good_min_rating":4.3,"nearest_good_min_score":0.65}'::jsonb
)
on conflict (key) do nothing;

alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
grant select, insert, update, delete on public.app_config to service_role;

alter table public.reviews
  add column if not exists insights_claimed_at timestamptz,
  add column if not exists insights_processed_at timestamptz,
  add column if not exists insights_error text;

create table public.review_insights (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews (id) on delete cascade,
  provider_service_id uuid not null references public.provider_services (id) on delete cascade,
  aspect text not null check (char_length(aspect) between 1 and 60),
  sentiment text not null check (sentiment in ('positive', 'negative')),
  quote text check (quote is null or (char_length(quote) between 1 and 140)),
  model text not null check (char_length(model) between 1 and 120),
  policy_version text not null check (char_length(policy_version) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (review_id, aspect)
);
create index review_insights_service_aspect_idx
  on public.review_insights (provider_service_id, aspect, sentiment);

alter table public.review_insights enable row level security;
revoke all on public.review_insights from public, anon, authenticated;
grant select, insert, update, delete on public.review_insights to service_role;

-- Public evidence never exposes review ids, customer ids, comments, or model metadata.
create view public.review_insight_summary as
select i.provider_service_id,
       i.aspect,
       count(*) filter (where i.sentiment = 'positive')::int as positive,
       count(*) filter (where i.sentiment = 'negative')::int as negative,
       coalesce((
         select jsonb_agg(jsonb_build_object('quote', q.quote))
           from (
             select distinct x.quote
               from public.review_insights x
              where x.provider_service_id = i.provider_service_id
                and x.aspect = i.aspect
                and x.sentiment = 'positive'
                and x.quote is not null
              order by x.quote
              limit 3
           ) q
       ), '[]'::jsonb) as evidence
  from public.review_insights i
  join public.provider_services ps on ps.id = i.provider_service_id
 where ps.active
   and public._provider_is_live(ps.provider_id)
   and public._category_docs_ok(ps.provider_id, ps.category_id)
 group by i.provider_service_id, i.aspect;
revoke all on public.review_insight_summary from public, anon, authenticated;
grant select on public.review_insight_summary to anon, authenticated, service_role;

create or replace function public._matching_allowed_aspects(p_category_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select array(
    select distinct x
      from (
        select unnest(c.review_tags) x
          from public.categories c
         where c.id = p_category_id
        union all
        select lower(trim(attribute_item.value))
          from public.categories c
          cross join lateral jsonb_each(coalesce(c.profile_schema -> 'properties', '{}'::jsonb)) property(key, value)
          cross join lateral jsonb_array_elements_text(
            case
              when property.value ->> 'type' = 'array'
               and jsonb_typeof(property.value -> 'items' -> 'enum') = 'array'
                then property.value -> 'items' -> 'enum'
              when property.value ->> 'type' <> 'array'
               and jsonb_typeof(property.value -> 'enum') = 'array'
                then property.value -> 'enum'
              else '[]'::jsonb
            end
          ) attribute_item(value)
         where c.id = p_category_id
      ) allowed
     where x <> ''
     order by x
  );
$$;
revoke execute on function public._matching_allowed_aspects(uuid) from public, anon, authenticated;
grant execute on function public._matching_allowed_aspects(uuid) to service_role;

-- Claiming is an atomic, short lease. Timed-out jobs become eligible for retry after 30 minutes.
create or replace function public.claim_reviews_for_insights(p_limit int default 200)
returns table (
  review_id uuid,
  booking_id uuid,
  provider_service_id uuid,
  category_slug text,
  category_name text,
  allowed_aspects text[],
  comment text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  return query
  with eligible as materialized (
    select r.id as review_id,
           b.id as booking_id,
           b.provider_service_id,
           c.slug as category_slug,
           c.name as category_name,
           public._matching_allowed_aspects(c.id) as allowed_aspects,
           r.comment
      from public.reviews r
      join public.bookings b on b.id = r.booking_id
      join public.categories c on c.id = b.category_id
     where r.insights_processed_at is null
       and (r.insights_claimed_at is null or r.insights_claimed_at < now() - interval '30 minutes')
       and char_length(coalesce(r.comment, '')) >= 20
     order by r.created_at, r.id
     limit greatest(1, least(coalesce(p_limit, 200), 500))
     for update of r skip locked
  ),
  claimed as (
    update public.reviews r
       set insights_claimed_at = now(),
           insights_error = null
      from eligible e
     where r.id = e.review_id
    returning r.id
  )
  select e.review_id, e.booking_id, e.provider_service_id, e.category_slug, e.category_name,
         e.allowed_aspects, e.comment
    from eligible e
    join claimed c on c.id = e.review_id
   order by e.review_id;
end;
$$;

create or replace function public.finish_review_insights(
  p_review_id uuid,
  p_provider_service_id uuid,
  p_rows jsonb,
  p_model text,
  p_policy_version text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comment text;
  v_service_id uuid;
begin
  select b.provider_service_id, r.comment
    into v_service_id, v_comment
    from public.reviews r
    join public.bookings b on b.id = r.booking_id
   where r.id = p_review_id
   for update of r;
  perform public._assert(v_service_id is not null, 'review not found');
  perform public._assert(v_service_id = p_provider_service_id, 'provider service does not belong to review');

  if coalesce(p_error, '') <> '' then
    update public.reviews
       set insights_claimed_at = null,
           insights_processed_at = null,
           insights_error = left(p_error, 1000)
     where id = p_review_id;
    return;
  end if;

  perform public._assert(jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) = 'array', 'review insights must be an array');
  perform public._assert(nullif(trim(coalesce(p_model, '')), '') is not null, 'model is required');
  perform public._assert(nullif(trim(coalesce(p_policy_version, '')), '') is not null, 'policy version is required');

  delete from public.review_insights where review_id = p_review_id;
  insert into public.review_insights (review_id, provider_service_id, aspect, sentiment, quote, model, policy_version)
  select distinct on (lower(trim(x ->> 'aspect')))
         p_review_id,
         v_service_id,
         lower(trim(x ->> 'aspect')),
         x ->> 'sentiment',
         case
           when nullif(trim(x ->> 'quote'), '') is null then null
           when char_length(x ->> 'quote') > 140 then null
           when position(x ->> 'quote' in coalesce(v_comment, '')) = 0 then null
           when x ->> 'quote' ~* '(\+?91[[:space:]-]?)?[6-9][0-9]{9}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|https?://|@[a-z][a-z0-9._-]+' then null
           else trim(x ->> 'quote')
         end,
         left(trim(p_model), 120),
         left(trim(p_policy_version), 120)
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
    join public.reviews r on r.id = p_review_id
    join public.bookings b on b.id = r.booking_id
    join public.categories c on c.id = b.category_id
   where x ->> 'aspect' is not null
     and x ->> 'sentiment' in ('positive', 'negative')
     and lower(trim(x ->> 'aspect')) = any (
       public._matching_allowed_aspects(c.id)
     )
   order by lower(trim(x ->> 'aspect')), r.id;

  update public.reviews
     set insights_claimed_at = null,
         insights_processed_at = now(),
         insights_error = null
   where id = p_review_id;
end;
$$;

revoke execute on function public.claim_reviews_for_insights(int),
  public.finish_review_insights(uuid, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_reviews_for_insights(int),
  public.finish_review_insights(uuid, uuid, jsonb, text, text, text) to service_role;

-- Deterministic score from A4. p_needs accepts only configured values:
-- {"attributes":["gas_refill"],"review_tags":["quick_diagnosis"]}.
create or replace function public.match_providers(
  p_category_slug text,
  p_lat double precision,
  p_lng double precision,
  p_needs jsonb default '{}'::jsonb,
  p_scheduled_at timestamptz default null,
  p_max_visit_fee int default null,
  p_limit int default 6
)
returns table (
  provider_id uuid,
  provider_service_id uuid,
  full_name text,
  avatar_url text,
  city text,
  skill_level public.skill_level,
  visit_fee int,
  labour_rate int,
  rate_unit public.rate_unit,
  rating_avg numeric,
  rating_count int,
  jobs_completed int,
  years_experience int,
  is_online boolean,
  distance_km double precision,
  score double precision,
  tier text,
  score_components jsonb,
  matched_needs text[],
  evidence_quotes jsonb,
  is_new_pro boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with origin as (
    select case
             when p_lat between -90 and 90 and p_lng between -180 and 180
               then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
           end as g,
           p_lat is null and p_lng is null as no_coordinates,
           (p_lat is null) = (p_lng is null)
             and (p_lat is null or (p_lat between -90 and 90 and p_lng between -180 and 180))
             as valid_coordinates
  ),
  config as (
    select coalesce((select value from public.app_config where key = 'match_weights'), '{}'::jsonb) value
  ),
  weights as (
    select coalesce((value ->> 'rating')::double precision, 0.45) as rating_weight,
           coalesce((value ->> 'need')::double precision, 0.35) as need_weight,
           coalesce((value ->> 'reliability')::double precision, 0.15) as reliability_weight,
           coalesce((value ->> 'distance_penalty')::double precision, 0.10) as distance_weight,
           coalesce((value ->> 'repeat')::double precision, 0.05) as repeat_weight,
           coalesce((value ->> 'rating_prior')::double precision, 10) as rating_prior,
           coalesce((value ->> 'nearest_good_min_rating')::double precision, 4.3) as nearest_good_min_rating,
           coalesce((value ->> 'nearest_good_min_score')::double precision, 0.65) as nearest_good_min_score
      from config
  ),
  cat as (
    select id, profile_schema, review_tags
      from public.categories
     where slug = p_category_slug and active
  ),
  category_avg as (
    select avg(r.rating)::numeric as m
      from public.reviews r
      join public.bookings b on b.id = r.booking_id
      join cat c on c.id = b.category_id
  ),
  allowed_needs as (
    select lower(trim(attribute_item.value)) as value, 'attribute'::text as kind
      from cat c
      cross join lateral jsonb_each(coalesce(c.profile_schema -> 'properties', '{}'::jsonb)) property(key, value)
      cross join lateral jsonb_array_elements_text(
        case
          when property.value ->> 'type' = 'array'
           and jsonb_typeof(property.value -> 'items' -> 'enum') = 'array'
            then property.value -> 'items' -> 'enum'
          when property.value ->> 'type' <> 'array'
           and jsonb_typeof(property.value -> 'enum') = 'array'
            then property.value -> 'enum'
          else '[]'::jsonb
        end
      ) attribute_item(value)
     where trim(attribute_item.value) <> ''
    union
    select lower(trim(tag)), 'review_tag'
      from cat c
      cross join lateral unnest(c.review_tags) tag
     where trim(tag) <> ''
  ),
  requested as (
    select distinct lower(trim(raw.value)) as value
      from (
        select value
          from jsonb_array_elements_text(
            case when jsonb_typeof(p_needs -> 'attributes') = 'array'
                 then p_needs -> 'attributes' else '[]'::jsonb end
          )
        union all
        select value
          from jsonb_array_elements_text(
            case when jsonb_typeof(p_needs -> 'review_tags') = 'array'
                 then p_needs -> 'review_tags' else '[]'::jsonb end
          )
      ) raw(value)
      join allowed_needs a on a.value = lower(trim(raw.value))
     where trim(raw.value) <> ''
  ),
  stats as (
    select b.provider_id,
           count(*) filter (where b.status in ('completed', 'closed'))::numeric as done,
           count(*) filter (where b.accepted_at is not null)::numeric as accepted
      from public.bookings b
     where b.created_at >= now() - interval '90 days'
     group by b.provider_id
  ),
  repeat_providers as (
    select distinct b.provider_id
      from public.bookings b
      join public.reviews r on r.booking_id = b.id
     where b.customer_id = auth.uid() and r.rating >= 4
  ),
  flattened_attributes as (
    select ps.id as provider_service_id,
           coalesce(array_agg(distinct lower(trim(item.value #>> '{}')))
                    filter (where jsonb_typeof(item.value) = 'string' and trim(item.value #>> '{}') <> ''), '{}') as values
      from public.provider_services ps
      cross join lateral jsonb_each(coalesce(ps.attributes, '{}'::jsonb)) field(key, value)
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(field.value) = 'array'
             then field.value else jsonb_build_array(field.value) end
      ) item(value)
     group by ps.id
  ),
  evidence_events as (
    select r.id as review_id, b.provider_service_id, lower(trim(tag)) as aspect,
           'positive'::text as sentiment, null::text as quote, r.created_at
      from public.reviews r
      join public.bookings b on b.id = r.booking_id
      cross join lateral unnest(r.tags) tag
    union all
    select i.review_id, i.provider_service_id, i.aspect, i.sentiment, i.quote, i.created_at
      from public.review_insights i
  ),
  evidence_counts as (
    select provider_service_id, aspect,
           count(distinct review_id) filter (where sentiment = 'positive')::int as positive,
           count(distinct review_id) filter (where sentiment = 'negative')::int as negative
      from evidence_events
     group by provider_service_id, aspect
  ),
  evidence_quote_rows as (
    select provider_service_id, aspect, quote
      from (
        select provider_service_id, aspect, quote,
               row_number() over (partition by provider_service_id, aspect order by created_at desc, quote) as rn
          from evidence_events
         where sentiment = 'positive' and quote is not null
      ) q
     where rn <= 2
  ),
  evidence_quotes_by_aspect as (
    select provider_service_id, aspect, array_agg(quote order by quote) as quotes
      from evidence_quote_rows
     group by provider_service_id, aspect
  ),
  evidence as (
    select ec.provider_service_id, ec.aspect, ec.positive, ec.negative,
           coalesce(eq.quotes, '{}') as quotes
      from evidence_counts ec
      left join evidence_quotes_by_aspect eq
        on eq.provider_service_id = ec.provider_service_id and eq.aspect = ec.aspect
  ),
  base as (
    select pr.id as provider_id,
           ps.id as provider_service_id,
           pf.full_name,
           pf.avatar_url,
           pr.city,
           ps.skill_level,
           ps.visit_fee,
           ps.labour_rate,
           ps.rate_unit,
           pr.rating_avg,
           pr.rating_count,
           pr.jobs_completed,
           pr.years_experience,
           pr.is_online,
           case when o.g is not null and pr.base_location is not null
                then extensions.st_distance(pr.base_location, o.g) / 1000.0
           end::double precision as distance_km,
           ((w.rating_prior * coalesce(ca.m, 4.0) + pr.rating_avg * pr.rating_count)
             / (w.rating_prior + pr.rating_count))::double precision as bayes_rating,
           coalesce(s.done / nullif(s.accepted, 0), 0.8)::double precision as reliability,
           case when rp.provider_id is null then 0.0 else 1.0 end::double precision as repeat_bonus,
           coalesce(fa.values, '{}') as attribute_values,
           pr.service_radius_km
      from public.provider_services ps
      join public.categories c on c.id = ps.category_id
      join cat wanted on wanted.id = c.id
      join public.providers pr on pr.id = ps.provider_id
      join public.profiles pf on pf.id = pr.id
      cross join origin o
      cross join category_avg ca
      cross join weights w
      left join flattened_attributes fa on fa.provider_service_id = ps.id
      left join stats s on s.provider_id = pr.id
      left join repeat_providers rp on rp.provider_id = pr.id
     where o.valid_coordinates
       and public._provider_is_live(pr.id)
       and not pr.paused
       and ps.active
       and public._category_docs_ok(pr.id, ps.category_id)
       and pr.id is distinct from auth.uid()
       and (p_max_visit_fee is null or ps.visit_fee <= p_max_visit_fee)
       and (
         o.no_coordinates
         or (
           pr.base_location is not null
           and extensions.st_dwithin(pr.base_location, o.g, pr.service_radius_km * 1000.0)
         )
       )
       and (p_scheduled_at is null or public._provider_slot_problem(pr.id, p_scheduled_at, false) is null)
  ),
  need_rows as (
    select b.provider_service_id,
           r.value,
           least(
             (case when r.value = any(b.attribute_values) then 0.5 else 0.0 end)
             + (case when e.positive >= 3 and e.positive >= 3 * e.negative then 0.5 else 0.0 end),
             1.0
           )::double precision as match_value,
           e.quotes
      from base b
      cross join requested r
      left join evidence e on e.provider_service_id = b.provider_service_id and e.aspect = r.value
  ),
  need_by_provider as (
    select b.provider_service_id,
           case when count(nr.value) = 0 then 0.5
                else avg(nr.match_value)
           end::double precision as need_match,
           coalesce(array_agg(nr.value order by nr.value) filter (where nr.match_value > 0), '{}') as matched_needs,
           coalesce((
             select jsonb_object_agg(q.value, to_jsonb(q.quotes))
               from (
                 select x.value, x.quotes
                   from need_rows x
                  where x.provider_service_id = b.provider_service_id
                    and coalesce(cardinality(x.quotes), 0) > 0
                  order by x.value
               ) q
           ), '{}'::jsonb) as evidence_quotes
      from base b
      left join need_rows nr on nr.provider_service_id = b.provider_service_id
     group by b.provider_service_id
  ),
  scored as (
    select b.*,
           n.need_match,
           n.matched_needs,
           n.evidence_quotes,
           greatest(least(b.bayes_rating / 5.0, 1.0), 0.0)::double precision as rating_norm,
           case
             when b.distance_km is null then 0.5
             else least(b.distance_km / greatest(b.service_radius_km, 1), 2.0)
           end::double precision as distance_ratio
      from base b
      join need_by_provider n on n.provider_service_id = b.provider_service_id
  ),
  with_score as (
    select s.*,
           (w.distance_weight * s.distance_ratio)::double precision as distance_penalty,
           w.rating_weight as configured_rating_weight,
           w.need_weight as configured_need_weight,
           w.reliability_weight as configured_reliability_weight,
           w.distance_weight as configured_distance_weight,
           w.repeat_weight as configured_repeat_weight,
           w.rating_prior as configured_rating_prior,
           w.nearest_good_min_rating as configured_nearest_good_min_rating,
           w.nearest_good_min_score as configured_nearest_good_min_score,
           (
             w.rating_weight * s.rating_norm
             + w.need_weight * s.need_match
             + w.reliability_weight * s.reliability
             - w.distance_weight * s.distance_ratio
             + w.repeat_weight * s.repeat_bonus
           )::double precision as match_score
      from scored s
      cross join weights w
  ),
  ranked as (
    select s.*,
           row_number() over (
             order by s.match_score desc, s.distance_km nulls last, s.provider_service_id
           ) as score_rank,
           (s.rating_count < 3) as is_new_pro
      from with_score s
  ),
  nearest_candidates as (
    select r.provider_service_id,
           row_number() over (
             order by r.distance_km nulls last, r.provider_service_id
           ) as nearest_rank
      from ranked r
      cross join weights w
     where r.score_rank <> 1
       and r.bayes_rating >= w.nearest_good_min_rating
       and r.match_score >= w.nearest_good_min_score
  ),
  tiered as (
    select r.*,
           case
             when r.score_rank = 1 then 'best_match'
             when nc.nearest_rank = 1 then 'nearest_good'
             else 'strong_match'
           end as match_tier
      from ranked r
      left join nearest_candidates nc on nc.provider_service_id = r.provider_service_id
  ),
  fairness_ranked as (
    select t.*,
           case when t.is_new_pro and t.need_match > 0 then row_number() over (
             partition by t.is_new_pro and t.need_match > 0
             order by t.match_score desc, t.distance_km nulls last, t.provider_service_id
           ) end as new_pro_rank
      from tiered t
  )
  select provider_id, provider_service_id, full_name, avatar_url, city, skill_level,
         visit_fee, labour_rate, rate_unit, rating_avg, rating_count, jobs_completed,
         years_experience, is_online, distance_km, match_score, match_tier,
         jsonb_build_object(
           'rating', rating_norm,
           'need', need_match,
           'reliability', reliability,
           'distance_ratio', distance_ratio,
           'distance_penalty', distance_penalty,
           'repeat', repeat_bonus,
           'bayes_rating', bayes_rating,
           'weights', jsonb_build_object(
             'rating', configured_rating_weight,
             'need', configured_need_weight,
             'reliability', configured_reliability_weight,
             'distance_penalty', configured_distance_weight,
             'repeat', configured_repeat_weight,
             'rating_prior', configured_rating_prior
           )
         ),
         matched_needs, evidence_quotes, is_new_pro
    from fairness_ranked
   where not is_new_pro or (need_match > 0 and new_pro_rank = 1)
   order by match_score desc, distance_km nulls last, provider_service_id
   limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

revoke execute on function public.match_providers(
  text, double precision, double precision, jsonb, timestamptz, int, int
) from public;
grant execute on function public.match_providers(
  text, double precision, double precision, jsonb, timestamptz, int, int
) to anon, authenticated, service_role;

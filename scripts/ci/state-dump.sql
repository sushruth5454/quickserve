-- Read-only snapshot of runtime settings that change app behaviour, used to compare the hosted demo
-- project with the local E2E stack. One JSON row; no secrets (app_config values are included only for
-- non-credential keys).
select json_build_object(
  'flags', (select json_object_agg(key, enabled order by key) from public.feature_flags),
  'app_config', (select json_object_agg(key, value order by key) from public.app_config
                  where key !~* '(secret|token|password|key_id|api_key|otp|phone|email|address|contact|admin|identity)'),
  'categories', (select json_object_agg(slug, json_build_object('active', active, 'restricted', restricted,
                   'archetype', archetype) order by slug) from public.categories),
  'live_cities', (select json_object_agg(c.slug, cities order by c.slug) from (
                   select category_id, json_agg(city order by city) as cities
                     from public.category_cities where live group by category_id) cc
                   join public.categories c on c.id = cc.category_id),
  'category_rows', (select json_object_agg(slug, to_jsonb(c) - 'id' - 'created_at' - 'updated_at' order by slug)
                     from public.categories c),
  'admin_count', (select count(*) from public.admins)
) as state;

-- Launch the creator, photo/video and wedding/event categories (proposal archetype) for everyone.
-- Requires 0023 (proposal request/milestone booking) and 0021 (event_moderate cancellation policy).

do $$
begin
  if not exists (
    select 1 from public.cancellation_policies where key = 'event_moderate' and active
  ) then
    raise exception 'event_moderate cancellation policy missing; apply 0021 first';
  end if;
  if to_regclass('public.service_requests') is null then
    raise exception 'service_requests missing; apply 0023 first';
  end if;
end;
$$;

update public.app_config
   set value = jsonb_set(value, '{proposal}', 'true'::jsonb, true)
 where key = 'archetype_flags';

update public.categories
   set active = true,
       config_version = config_version + 1
 where archetype = 'proposal'
   and not active
   and not restricted
   and slug in (
     'instagram-influencer', 'youtube-creator', 'ugc-creator', 'reel-maker',
     'wedding-photographer', 'candid-photographer', 'pre-wedding-shoot', 'maternity-newborn',
     'product-photographer', 'event-videographer', 'drone-operator', 'photo-booth',
     'caterer', 'decorator', 'bridal-makeup', 'mehendi-artist', 'dj',
     'live-band', 'wedding-planner'
   );

-- Same launch-city rule 0018 used for the original categories.
insert into public.category_cities (category_id, city, live, launched_at)
select c.id, trim(config.value #>> '{}'), true, now()
  from public.categories c
  cross join public.app_config config
 where config.key = 'launch_city'
   and c.archetype = 'proposal'
   and c.active
   and nullif(trim(config.value #>> '{}'), '') is not null
on conflict (category_id, city) do update
set live = true,
    launched_at = coalesce(public.category_cities.launched_at, excluded.launched_at);

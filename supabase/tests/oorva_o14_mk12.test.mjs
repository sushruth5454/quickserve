import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const { ok, scenario, finish } = createHarness();
const fixedCreatedAt = '2026-01-15T12:00:00.000Z';
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const check = (condition, label, actual) => ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const one = async (query, params = []) => (await db.query(query, params)).rows[0];

async function createFixture(base) {
  const categorySlug = `mk-t12-inspect-${base}`;
  const providerBio = `MK-T12 fixture ${base}`;
  const cityCategory = await one(`
    insert into public.categories (slug, name, vertical, archetype, active, restricted)
    values ($1::text, 'MK-T12 inspect', 'mk-t12', 'inspect_quote', true, false)
    returning id
  `, [categorySlug]);
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values
      ($1::uuid, 'Mysuru', true, $2::timestamptz),
      ($1::uuid, 'Bengaluru', true, $2::timestamptz)
  `, [cityCategory.id, fixedCreatedAt]);
  await db.query(`
    insert into public.app_config as config (key, value)
    values ('archetype_flags', '{"inspect_quote":true}'::jsonb)
    on conflict (key) do update
      set value = coalesce(config.value, '{}'::jsonb) || excluded.value
  `);

  await db.query(`
    insert into auth.users (id)
    select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
      from generate_series($1::int + 1, $1::int + 52) as n
    union all
    select ('00000000-0000-4000-8000-' || lpad(($1::int + 90)::text, 12, '0'))::uuid
    union all
    select ('00000000-0000-4000-8000-' || lpad(($1::int + 91)::text, 12, '0'))::uuid
  `, [base]);
  await db.query(`
    insert into public.profiles (id, full_name, avatar_url, role_customer, role_provider)
    select id, 'MK-T12 provider ' || right(id::text, 4), null, false, true
      from auth.users
     where id between $1::uuid and $2::uuid
    on conflict (id) do update
      set full_name = excluded.full_name,
          avatar_url = excluded.avatar_url,
          role_customer = excluded.role_customer,
          role_provider = excluded.role_provider
  `, [uuid(base + 1), uuid(base + 91)]);
  await db.query(`
    insert into public.providers (
      id, bio, city, service_radius_km, years_experience, languages, kyc_status,
      suspended, is_online, rating_avg, rating_count, jobs_completed, commission_tier,
      created_at, admin_review_status, submitted_at, paused, timezone, base_area
    )
    select id, $2::text, 'Mysuru', 15, 5, array['en'], 'verified',
           false, true, 4.8, right(id::text, 4)::int - $3::int, 1, 12,
           $1::timestamptz, 'approved', $1::timestamptz, false, 'Asia/Kolkata', 'Public locality'
      from auth.users
     where id between $4::uuid and $5::uuid
        or id in ($6::uuid, $7::uuid)
  `, [fixedCreatedAt, providerBio, base, uuid(base + 1), uuid(base + 52), uuid(base + 90), uuid(base + 91)]);
  await db.query(`
    update public.providers
       set city = 'Bengaluru', rating_count = 99
     where id = $1::uuid
  `, [uuid(base + 90)]);
  await db.query(`
    update public.providers
       set rating_count = 0
     where id = $1::uuid
  `, [uuid(base + 91)]);
  await db.query(`
    insert into public.provider_services (
      provider_id, category_id, skill_level, visit_fee, labour_rate, active, created_at
    )
    select p.id, $1::uuid, 'expert', 19900, 50000, true, $2::timestamptz
      from public.providers as p
     where p.bio = $3::text
  `, [cityCategory.id, fixedCreatedAt, providerBio]);
  const leaveService = await one(`
    select ps.id
      from public.provider_services as ps
     where ps.provider_id = $1::uuid
  `, [uuid(base + 51)]);
  await db.query(`
    insert into public.service_packages (
      provider_service_id, title, description, price_type, price, price_min, price_max,
      unit, active, sort_order, created_at, updated_at
    ) values (
      $1::uuid, 'Public package', 'Fixture', 'fixed', 50000, 50000, 50000,
      'job', true, 1, $2::timestamptz, $2::timestamptz
    )
  `, [leaveService.id, fixedCreatedAt]);
  await db.query(`
    insert into public.provider_time_off (provider_id, period, reason)
    values ($1::uuid, tstzrange(now() - interval '1 hour', now() + interval '1 day', '[)'), 'current leave')
  `, [uuid(base + 51)]);

  return { categoryId: cityCategory.id, categorySlug, leaveProviderId: uuid(base + 51), callerId: uuid(base + 52) };
}

await scenario('MK-PROVIDER-ranked-public-columns', async () => {
  const fixture = await createFixture(1200);
  await db.query(`update public.feature_flags set enabled = true where key = 'guest_browse'`);

  const row = await one(
    `select * from public.list_top_rated_public($1::text, $2::int) where id = $3::uuid`,
    ['Mysuru', 50, fixture.leaveProviderId],
  );
  const profile = await one(
    `select public.get_provider_public_profile($1::uuid) as profile`,
    [fixture.leaveProviderId],
  );
  const rootKeys = row ? Object.keys(row).sort() : [];
  const service = row?.provider_services?.[0] ?? null;
  const packageRow = service?.service_packages?.[0] ?? null;
  const privateNames = ['kyc_status', 'suspended', 'paused', 'razorpay_account_id', 'review_note', 'admin_review_status'];

  check(
    JSON.stringify(rootKeys) === JSON.stringify([
      'city', 'id', 'is_online', 'jobs_completed', 'on_leave_until', 'profiles',
      'provider_services', 'rating_avg', 'rating_count', 'years_experience',
    ]),
    'ranked DTO returns only its declared public columns',
    rootKeys,
  );
  check(
    Boolean(row && row.profiles && JSON.stringify(Object.keys(row.profiles).sort()) === JSON.stringify(['avatar_url', 'full_name'])),
    'profile identity contains only public display fields',
    row?.profiles,
  );
  check(
    Boolean(service
      && JSON.stringify(Object.keys(service).sort()) === JSON.stringify(['active', 'categories', 'id', 'service_packages', 'skill_level', 'visit_fee'])
      && service.categories
      && JSON.stringify(Object.keys(service.categories).sort()) === JSON.stringify(['archetype', 'name', 'slug', 'sort_order'])
      && JSON.stringify(Object.keys(packageRow ?? {}).sort()) === JSON.stringify(['id', 'price', 'price_max', 'price_min', 'price_type', 'sort_order', 'unit'])
      && privateNames.every((key) => !JSON.stringify(row).includes(`"${key}"`))),
    'service and package projections stay explicitly public',
    { service, packageRow, privateNames },
  );
  check(
    Boolean(row && row.is_online === false && row.on_leave_until
      && profile?.profile?.on_leave_until
      && new Date(row.on_leave_until).toISOString() === new Date(profile.profile.on_leave_until).toISOString()),
    'current leave matches public profile and suppresses ranked Online without removing the provider',
    { ranked: row && { is_online: row.is_online, on_leave_until: row.on_leave_until }, profile: profile.profile },
  );
});

await scenario('MK-PROVIDER-ranked-eligibility-city-self', async () => {
  const fixture = await createFixture(1300);
  await db.query(`update public.feature_flags set enabled = true where key = 'guest_browse'`);

  const ranked = await as(
    fixture.callerId,
    'authenticated',
    `select * from public.list_top_rated_public($1::text, $2::int)`,
    [' mysuru ', 100],
  );
  const limited = await as(
    fixture.callerId,
    'authenticated',
    `select id from public.list_top_rated_public($1::text, $2::int)`,
    ['Mysuru', 1],
  );
  const zeroLimit = await as(
    fixture.callerId,
    'authenticated',
    `select id from public.list_top_rated_public($1::text, $2::int)`,
    ['Mysuru', 0],
  );
  const missingCity = await as(
    fixture.callerId,
    'authenticated',
    `select * from public.list_top_rated_public($1::text, $2::int)`,
    ['  ', 10],
  );
  const leaveInSearch = await as(
    fixture.callerId,
    'authenticated',
    `select provider_id, is_online
       from public.search_providers($1::text, null::double precision, null::double precision, 'rating',
                                    null::numeric, null::public.skill_level, null::int, false, 100::int)
      where provider_id = $2::uuid`,
    [fixture.categorySlug, fixture.leaveProviderId],
  );
  const leaveOnlineOnly = await as(
    fixture.callerId,
    'authenticated',
    `select provider_id
       from public.search_providers($1::text, null::double precision, null::double precision, 'rating',
                                    null::numeric, null::public.skill_level, null::int, true, 100::int)
      where provider_id = $2::uuid`,
    [fixture.categorySlug, fixture.leaveProviderId],
  );
  const anonymousWithFlagOn = await as(
    null,
    'anon',
    `select * from public.list_top_rated_public($1::text, $2::int)`,
    ['Mysuru', 10],
  );
  await db.query(`update public.feature_flags set enabled = false where key = 'guest_browse'`);
  const anonymousWithFlagOff = await as(
    null,
    'anon',
    `select * from public.list_top_rated_public($1::text, $2::int)`,
    ['Mysuru', 10],
  );
  const authenticatedWithFlagOff = await as(
    fixture.callerId,
    'authenticated',
    `select * from public.list_top_rated_public($1::text, $2::int)`,
    ['Mysuru', 10],
  );

  check(
    ranked.length === 50
      && !ranked.some((row) => row.id === fixture.callerId)
      && ranked.every((row) => row.rating_count > 0)
      && ranked.every((row) => row.city.trim().toLowerCase() === 'mysuru')
      && ranked[0]?.rating_count === 51,
    'normalized city, self exclusion, rating eligibility/order, and bounded maximum are enforced',
    { count: ranked.length, selfIncluded: ranked.some((row) => row.id === fixture.callerId), first: ranked[0], cities: [...new Set(ranked.map((row) => row.city))] },
  );
  check(
    limited.length === 1 && zeroLimit.length === 1 && missingCity.length === 0,
    'limits are bounded and a blank selected city returns no rows',
    { limited, zeroLimit, missingCity: missingCity.length },
  );
  check(
    leaveInSearch.length === 1
      && leaveInSearch[0].is_online === false
      && leaveOnlineOnly.length === 0
      && ranked.some((row) => row.id === fixture.leaveProviderId && row.is_online === false),
    'search and ranked presence agree while leave does not remove a trusted provider',
    { leaveInSearch, leaveOnlineOnly, rankedLeave: ranked.find((row) => row.id === fixture.leaveProviderId) },
  );
  check(
    anonymousWithFlagOn.length > 0 && anonymousWithFlagOff.length === 0
      && authenticatedWithFlagOff.length > 0,
    'guest_browse OFF denies anon and preserves signed-in reads',
    { anonymousWithFlagOn: anonymousWithFlagOn.length, anonymousWithFlagOff: anonymousWithFlagOff.length, authenticatedWithFlagOff: authenticatedWithFlagOff.length },
  );
});

finish();

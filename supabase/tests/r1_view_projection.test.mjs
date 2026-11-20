import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const h = createHarness();
const customer = '00000000-0000-0000-0000-000000000891';
const provider = '00000000-0000-0000-0000-000000000892';
const stranger = '00000000-0000-0000-0000-000000000893';

await h.scenario('routed providers read public intake without helper execute access', async () => {
  for (const [id, name, phone] of [
    [customer, 'R1 view customer', '+919811000891'],
    [provider, 'R1 view provider', '+919811000892'],
    [stranger, 'R1 view stranger', '+919811000893'],
  ]) {
    await db.query(
      'insert into auth.users (id, phone) values ($1::uuid, $2::text) on conflict (id) do nothing',
      [id, phone],
    );
    await db.query(
      'insert into public.profiles (id, full_name) values ($1::uuid, $2::text) on conflict (id) do update set full_name = excluded.full_name',
      [id, name],
    );
  }

  const intakeSchema = {
    type: 'object',
    properties: {
      brief: { type: 'string' },
      private_note: { type: 'string', 'x-private': true },
    },
    required: ['brief'],
  };
  const category = (await db.query(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version, max_lead_days
    ) values (
      $1::text, 'R1 view proposal', 'quote', true, 'proposal', $2::jsonb, 1, 365
    )
    returning id
  `, ['r1-view-projection-test', JSON.stringify(intakeSchema)])).rows[0].id;

  await db.query(`
    insert into public.providers (
      id, bio, city, base_location, service_radius_km, kyc_status, submitted_at,
      timezone, admin_review_status, is_online, paused, suspended
    ) values (
      $1::uuid, 'R1 view fixture', 'R1 View City',
      extensions.st_setsrid(extensions.st_makepoint(80.6, 16.5), 4326),
      20, 'verified', now(), 'Asia/Kolkata', 'approved', true, false, false
    )
  `, [provider]);
  const providerService = (await db.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 10000, 20000, true)
    returning id
  `, [provider, category])).rows[0].id;
  const request = (await db.query(`
    insert into public.service_requests (
      customer_id, category_id, city, area, event_start, event_end, intake,
      budget_min, budget_max, status, expires_at
    ) values (
      $1::uuid, $2::uuid, 'R1 View City', 'R1 Area',
      $3::timestamptz, $4::timestamptz,
      $5::jsonb, 100000, 200000, 'open', $6::timestamptz
    )
    returning id
  `, [
    customer,
    category,
    '2027-01-15T10:00:00+05:30',
    '2027-01-15T14:00:00+05:30',
    JSON.stringify({ brief: 'Four hour coverage', private_note: 'private value' }),
    '2027-01-14T10:00:00+05:30',
  ])).rows[0].id;
  await db.query(`
    insert into public.request_recipients (request_id, provider_id, provider_service_id)
    values ($1::uuid, $2::uuid, $3::uuid)
  `, [request, provider, providerService]);

  const rows = await as(provider, 'authenticated', `
    select id, provider_id, intake
      from public.service_request_provider_view
     where id = $1::uuid
  `, [request]);
  const row = rows[0];
  h.ok(
    rows.length === 1
      && row.provider_id === provider
      && row.intake.brief === 'Four hour coverage'
      && !Object.hasOwn(row.intake, 'private_note'),
    `provider projection exposes only public intake; actual=${JSON.stringify(rows)}`,
  );

  const strangerRows = await as(stranger, 'authenticated', `
    select id, provider_id, intake
      from public.service_request_provider_view
     where id = $1::uuid
  `, [request]);
  h.ok(strangerRows.length === 0,
    `unrouted stranger cannot read provider projection; actual=${JSON.stringify(strangerRows)}`);

  const helperPrivilege = (await db.query(`
    select has_function_privilege(
      'authenticated', 'public._proposal_public_intake(uuid,jsonb)', 'execute'
    ) as allowed
  `)).rows[0].allowed;
  let helperError;
  try {
    await as(provider, 'authenticated', `
      select public._proposal_public_intake($1::uuid, $2::jsonb)
    `, [category, JSON.stringify({ brief: 'Four hour coverage', private_note: 'private value' })]);
  } catch (error) {
    helperError = error.message;
  }
  h.ok(helperPrivilege === false && /permission denied/i.test(helperError ?? ''),
    `direct helper EXECUTE stays denied; actual=${JSON.stringify({ helperPrivilege, helperError: helperError ?? null })}`);
});

h.finish();

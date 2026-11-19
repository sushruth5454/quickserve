import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const h = createHarness();
const user = '00000000-0000-0000-0000-000000000701';

await h.scenario('R1 internal and user RPC privilege allow-list', async () => {
  await db.query('insert into auth.users (id) values ($1::uuid) on conflict (id) do nothing', [user]);
  await db.query('insert into public.profiles (id) values ($1::uuid) on conflict (id) do nothing', [user]);
  const protectedFunctions = [
    { signature: 'public.route_service_request(uuid,integer)', authenticated: false, anon: false, service: true },
    { signature: 'public.process_proposal_milestones()', authenticated: false, anon: false, service: true },
    { signature: 'public._proposal_public_intake(uuid,jsonb)', authenticated: false, anon: false, service: true },
    { signature: 'public.cancel_session_booking(uuid,text)', authenticated: true, anon: false },
    { signature: 'public.cancel_session_pack(uuid,text)', authenticated: true, anon: false },
    { signature: 'public.confirm_session_completion(uuid)', authenticated: true, anon: false },
    { signature: 'public.complete_session_booking(uuid,text)', authenticated: true, anon: false },
    { signature: 'public.create_session_booking(uuid,uuid,timestamptz,integer,text,text,double precision,double precision,text,uuid)', authenticated: true, anon: false },
    { signature: 'public.decline_session_booking(uuid,text)', authenticated: true, anon: false },
    { signature: 'public.extend_session_pack(uuid)', authenticated: true, anon: false },
    { signature: 'public.purchase_session_pack(uuid,integer)', authenticated: true, anon: false },
    { signature: 'public.request_session_completion(uuid)', authenticated: true, anon: false },
    { signature: 'public.start_session_booking(uuid,text)', authenticated: true, anon: false },
    { signature: 'public.provider_cancel_booking(uuid,text,text)', authenticated: true, anon: false },
    { signature: 'public.submit_review(uuid,integer,integer,integer,integer,integer,text,text[])', authenticated: true, anon: false },
    { signature: 'public.can_read_request_private(uuid)', authenticated: true, anon: false },
    { signature: 'public.create_booking_v2(uuid,text,text,text,double precision,double precision,timestamptz,text[],uuid,text)', authenticated: true, anon: false },
    { signature: 'public.create_service_request_v2(uuid,text,text,timestamptz,timestamptz,jsonb,integer,integer,uuid,text,uuid,double precision,double precision,boolean,text)', authenticated: true, anon: false },
    { signature: 'public.create_rfq_v2(uuid,text,jsonb,text,text,double precision,double precision,boolean,date,text,text)', authenticated: true, anon: false },
  ];
  const actual = [];
  for (const spec of protectedFunctions) {
    const row = (await db.query(`
      select
        $1::text as signature,
        has_function_privilege('authenticated', $1::regprocedure, 'execute') as authenticated,
        has_function_privilege('anon', $1::regprocedure, 'execute') as anon,
        has_function_privilege('service_role', $1::regprocedure, 'execute') as service
    `, [spec.signature])).rows[0];
    actual.push({
      signature: row.signature,
      authenticated: row.authenticated,
      anon: row.anon,
      ...(spec.service === undefined ? {} : { service: row.service }),
    });
  }
  const expected = protectedFunctions.map(({ signature, authenticated, anon, service }) => ({
    signature, authenticated, anon, ...(service === undefined ? {} : { service }),
  }));
  h.ok(JSON.stringify(actual) === JSON.stringify(expected),
    `R1 function privilege allow-list; actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);

  const monthlyCostAccess = await db.query(`
    select has_function_privilege('anon', 'public.ai_monthly_usage_cost(timestamptz)', 'execute') as anon,
           has_function_privilege('authenticated', 'public.ai_monthly_usage_cost(timestamptz)', 'execute') as authenticated,
           has_function_privilege('service_role', 'public.ai_monthly_usage_cost(timestamptz)', 'execute') as service
  `);
  h.ok(
    JSON.stringify(monthlyCostAccess.rows[0]) === JSON.stringify({ anon: false, authenticated: false, service: true }),
    `AI budget aggregation is service-only; actual=${JSON.stringify(monthlyCostAccess.rows[0])}`,
  );
  await db.query(`
    insert into public.ai_usage (user_id, kind, request_id, feature, model, cost_micros_usd)
    values
      ($1::uuid, 'chat', $2::uuid, 'ai_assistant', 'gemini-3.8-flash', 3000000),
      ($1::uuid, 'transcribe', $3::uuid, 'ai_assistant', 'gemini-3.8-flash', 500000)
  `, [user, '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000703']);
  const [monthlyCost] = await as(user, 'service_role', `
    select public.ai_monthly_usage_cost($1::timestamptz) as cost
  `, ['2000-01-01T00:00:00Z']);
  h.ok(monthlyCost.cost === 3500000,
    `AI usage cost includes all model feature types; actual=${JSON.stringify(monthlyCost)}`);
});

await h.scenario('profile role flags cannot be self-updated', async () => {
  await db.query('insert into auth.users (id) values ($1::uuid) on conflict (id) do nothing', [user]);
  await db.query('insert into public.profiles (id) values ($1::uuid) on conflict (id) do nothing', [user]);
  let error;
  try {
    await as(user, 'authenticated', 'update public.profiles set role_provider = true where id = $1::uuid', [user]);
  } catch (caught) {
    error = caught.message;
  }
  h.ok(/permission denied/i.test(error ?? ''),
    `authenticated role_provider update is denied; actual=${JSON.stringify({ error: error ?? null })}`);
  const columns = await db.query(`
    select
      has_column_privilege('authenticated', 'public.profiles', 'role_customer', 'update') as role_customer,
      has_column_privilege('authenticated', 'public.profiles', 'role_provider', 'update') as role_provider
  `);
  h.ok(columns.rows[0].role_customer === false && columns.rows[0].role_provider === false,
    `profile self-role grants are absent; actual=${JSON.stringify(columns.rows[0])}`);
});

h.finish();

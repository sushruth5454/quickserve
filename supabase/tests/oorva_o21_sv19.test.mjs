import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const originalArchetypeFlags = (await db.query(
  "select value from public.app_config where key = 'archetype_flags'",
)).rows[0].value;
const originalDeadlineEnabled = (await db.query(
  "select enabled from public.feature_flags where key = 'creator_delivery_deadline'",
)).rows[0].enabled;
const h = createHarness({
  cleanup: async () => {
    await db.query('update public.app_config set value = $1::jsonb where key = $2::text',
      [JSON.stringify(originalArchetypeFlags), 'archetype_flags']);
    await db.query('update public.feature_flags set enabled = $1::boolean where key = $2::text',
      [originalDeadlineEnabled, 'creator_delivery_deadline']);
  },
});
const check = (condition, label, actual) => h.ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const baseSchema = {
  type: 'object',
  properties: {
    details: { type: 'string', minLength: 2, maxLength: 50 },
    private_note: { type: 'string', 'x-private': true },
  },
  required: ['details'],
};
const nestedSchema = {
  type: 'object',
  properties: {
    project: {
      type: 'object',
      properties: {
        budget: { type: 'number', minimum: 10, maximum: 100 },
        brief_note: { type: 'string', minLength: 2, maxLength: 20 },
        style: { type: 'string', enum: ['classic', 'modern'] },
        tags: { type: 'array', items: { type: 'string', enum: ['photo', 'video', 'audio'] }, minItems: 1, maxItems: 2, uniqueItems: true },
      },
      required: ['budget', 'brief_note', 'style', 'tags'],
    },
    private_note: { type: 'string', 'x-private': true },
  },
  required: ['project', 'private_note'],
};

async function setProposalFlags(parentEnabled, deadlineEnabled) {
  await db.query(`
    update public.app_config
       set value = value || jsonb_build_object('proposal', $1::boolean)
     where key = $2::text
  `, [parentEnabled, 'archetype_flags']);
  await db.query('update public.feature_flags set enabled = $1::boolean where key = $2::text',
    [deadlineEnabled, 'creator_delivery_deadline']);
}

async function user(label) {
  const id = randomUUID();
  const phone = `+1555${randomUUID().replace(/\D/g, '').slice(0, 10)}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, phone]);
  await db.query('update public.profiles set full_name = $2::text where id = $1::uuid', [id, `SV19 ${label}`]);
  return id;
}

async function fixture(label, firstDay, schema = baseSchema) {
  const customer = await user(`${label}-customer`);
  const provider = await user(`${label}-provider`);
  const stranger = await user(`${label}-stranger`);
  const city = `SV19 ${label} City`;
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, admin_review_status, submitted_at, is_online, paused, suspended
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', 'approved', '2026-01-01T00:00:00Z'::timestamptz, true, false, false
    )
  `, [provider, city]);
  const categoryId = (await db.query(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, min_lead_hours, requires_docs
    ) values (
      $1::text, $2::text, 'quote', true, 'proposal', $3::jsonb, 1::int, 365::int, 1::int, '{}'::text[]
    ) returning id
  `, [`sv19-${label}-${randomUUID().replace(/-/g, '')}`, `SV19 ${label}`, JSON.stringify(schema)])).rows[0].id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, '2026-01-01T00:00:00Z'::timestamptz)
  `, [categoryId, city]);
  const serviceId = (await db.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0::int, 0::int, true) returning id
  `, [provider, categoryId])).rows[0].id;
  const addressId = (await db.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Venue', 'SV19 test address', $2::text, 16.50::double precision, 80.60::double precision)
    returning id
  `, [customer, city])).rows[0].id;
  return { customer, provider, stranger, city, categoryId, serviceId, addressId, firstDay };
}

function eventStart(day) {
  const date = new Date(Date.UTC(2027, 3, day, 4, 30));
  return `${date.toISOString().slice(0, 10)}T10:00:00+05:30`;
}

async function createRequest(f, intake, targetProvider = null, day = f.firstDay) {
  const start = new Date(eventStart(day));
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
  return (await as(f.customer, 'authenticated', `
    select public.create_service_request(
      $1::uuid, $2::text, $3::text, $4::timestamptz, $5::timestamptz, $6::jsonb,
      $7::int, $8::int, $9::uuid, $10::text, $11::uuid, $12::double precision, $13::double precision, $14::boolean
    ) as id
  `, [f.categoryId, f.city, 'Service area', start.toISOString(), end.toISOString(), JSON.stringify(intake),
    50000, 200000, f.addressId, 'SV19 event venue', targetProvider, 16.50, 80.60, false]))[0].id;
}

async function sendProposal(f, requestId, sender = f.provider, dueAt = null) {
  return (await as(sender, 'authenticated', `
    select public.send_proposal(
      $1::uuid, $2::jsonb, $3::jsonb, $4::timestamptz, $5::text, $6::jsonb, $7::timestamptz
    ) as id
  `, [requestId, JSON.stringify([{ kind: 'package', title: 'SV19 fixed scope', qty: 1, unit: 'job', unit_price: 100000 }]),
    JSON.stringify([
      { label: 'Booking advance', amount: 25000, due_rule: 'at_booking' },
      { label: 'Final payment', amount: 75000, due_rule: 'on_completion' },
    ]), '2027-12-01T10:00:00Z', 'A clear proposal', JSON.stringify([]), dueAt]))[0].id;
}

async function fails(fn) {
  try { await fn(); return null; } catch (error) { return error?.message ?? String(error); }
}

async function counts(f) {
  return (await db.query(`
    select
      (select count(*)::int from public.service_requests r where r.customer_id = $1::uuid and r.category_id = $2::uuid) as requests,
      (select count(*)::int from public.request_private rp join public.service_requests r on r.id = rp.request_id
        where r.customer_id = $1::uuid and r.category_id = $2::uuid) as private_rows,
      (select count(*)::int from public.request_recipients rr join public.service_requests r on r.id = rr.request_id
        where r.customer_id = $1::uuid and r.category_id = $2::uuid) as recipients,
      (select count(*)::int from public.proposals p join public.service_requests r on r.id = p.request_id
        where r.customer_id = $1::uuid and r.category_id = $2::uuid) as proposals
  `, [f.customer, f.categoryId])).rows[0];
}

const validBaseIntake = { brief: 'A sufficiently detailed service brief', details: 'event scope', private_note: 'private venue context' };
const validNestedIntake = {
  brief: 'A sufficiently detailed nested project brief',
  project: { budget: 75, brief_note: 'event scope', style: 'classic', tags: ['photo'] },
  private_note: 'private venue context',
  package_id: '00000000-0000-4000-8000-000000000001',
  deliver_by: '2027-04-09',
};

await h.scenario('parent-off-blocks-request-send-and-route-while-deadline-child-on', async () => {
  await setProposalFlags(true, true);
  const f = await fixture('parent-off', 10);
  const requestId = await createRequest(f, validBaseIntake, f.provider, 10);
  const proposalId = await sendProposal(f, requestId, f.provider, '2027-04-09T12:00:00+05:30');
  await setProposalFlags(false, true);
  const before = await counts(f);
  const createError = await fails(() => createRequest(f, validBaseIntake, null, 11));
  const sendError = await fails(() => sendProposal(f, requestId));
  const routeError = await fails(() => as(null, 'service_role',
    'select public.route_service_request($1::uuid, $2::int)', [requestId, 8]));
  const after = await counts(f);
  const viewState = (await as(f.customer, 'authenticated',
    'select public.get_proposal_view_state($1::uuid) as state', [proposalId]))[0].state;
  await as(f.customer, 'authenticated', 'select public.cancel_service_request($1::uuid)', [requestId]);
  const status = (await db.query('select r.status from public.service_requests r where r.id = $1::uuid', [requestId])).rows[0].status;
  check(!!createError && !!sendError && !!routeError && JSON.stringify(before) === JSON.stringify(after),
    'parent-off denies raw request/send/routing without new rows despite deadline child ON', { createError, sendError, routeError, before, after });
  check(viewState.viewer_role === 'customer' && viewState.can_message === true && status === 'cancelled',
    'existing request view/message and customer cancellation remain available with parent OFF', { viewState, status });
});

await h.scenario('parent-on-authorized-path-validates-nested-intake-and-redacts-private-answer', async () => {
  await setProposalFlags(true, true);
  const f = await fixture('nested-valid', 12, nestedSchema);
  const requestId = await createRequest(f, validNestedIntake, f.provider, 12);
  const unauthorizedError = await fails(() => sendProposal(f, requestId, f.stranger, '2027-04-11T12:00:00+05:30'));
  const beforeAuthorizedSend = await counts(f);
  const proposalId = await sendProposal(f, requestId, f.provider, '2027-04-11T12:00:00+05:30');
  const providerView = (await as(f.provider, 'authenticated',
    'select v.intake from public.service_request_provider_view v where v.id = $1::uuid', [requestId]))[0]?.intake;
  const after = await counts(f);
  check(!!unauthorizedError && beforeAuthorizedSend.proposals === 0 && after.proposals === 1,
    'only the routed provider may send while the parent is ON', { unauthorizedError, beforeAuthorizedSend, proposalId, after });
  check(providerView?.project?.budget === 75 && !Object.hasOwn(providerView, 'private_note'),
    'valid nested SchemaField values pass and x-private answers remain redacted', providerView);
});

async function rejectedIntakeScenario(name, day, mutate, schema = nestedSchema) {
  await h.scenario(name, async () => {
    await setProposalFlags(true, false);
    const f = await fixture(name, day, schema);
    const intake = JSON.parse(JSON.stringify(validNestedIntake));
    mutate(intake);
    const before = await counts(f);
    const error = await fails(() => createRequest(f, intake, null, day));
    const after = await counts(f);
    check(!!error && JSON.stringify(before) === JSON.stringify(after),
      `${name} rejects before request/private/recipient/proposal writes`, { error, before, after, intake });
  });
}

await rejectedIntakeScenario('required-nested-answer-is-enforced', 13, (intake) => { delete intake.project; });
await rejectedIntakeScenario('nested-answer-type-is-enforced', 14, (intake) => { intake.project.budget = '75'; });
await rejectedIntakeScenario('nested-numeric-bound-is-enforced', 15, (intake) => { intake.project.budget = 101; });
await rejectedIntakeScenario('nested-string-minimum-is-enforced', 16, (intake) => { intake.project.brief_note = 'x'; });
await rejectedIntakeScenario('array-item-type-and-enum-are-enforced', 17, (intake) => { intake.project.tags = [true]; });
await rejectedIntakeScenario('array-enum-is-enforced', 18, (intake) => { intake.project.tags = ['unsupported']; });
await rejectedIntakeScenario('array-uniqueness-is-enforced', 19, (intake) => { intake.project.tags = ['photo', 'photo']; });
await rejectedIntakeScenario('unknown-top-level-answer-is-rejected', 20, (intake) => { intake.unconfigured = 'value'; });
await rejectedIntakeScenario('unknown-nested-answer-is-rejected', 21, (intake) => { intake.project.unconfigured = 'value'; });
await rejectedIntakeScenario('reserved-client-brief-minimum-is-enforced', 22, (intake) => { intake.brief = 'short'; });
await rejectedIntakeScenario('array-minimum-is-enforced', 23, (intake) => { intake.project.tags = []; });
await rejectedIntakeScenario('array-maximum-is-enforced', 24, (intake) => { intake.project.tags = ['photo', 'video', 'audio']; });
await rejectedIntakeScenario('scalar-enum-is-enforced', 25, (intake) => { intake.project.style = 'unconfigured'; });
await rejectedIntakeScenario('nested-string-maximum-is-enforced', 26, (intake) => { intake.project.brief_note = 'abcdefghijklmnopqrstu'; });
await rejectedIntakeScenario('nested-numeric-minimum-is-enforced', 27, (intake) => { intake.project.budget = 9; });

await h.scenario('contact-screening-still-rejects-contact-details-before-inserts', async () => {
  await setProposalFlags(true, false);
  const f = await fixture('contact-screen', 28);
  const intake = { ...validBaseIntake, brief: 'Call +91 9876543210 for the event details' };
  const before = await counts(f);
  const error = await fails(() => createRequest(f, intake, null, 28));
  const after = await counts(f);
  check(!!error && JSON.stringify(before) === JSON.stringify(after),
    'contact screening remains active and runs before inserts', { error, before, after, intake });
});

await h.scenario('open-request-no-match-keeps-honest-success-outcome', async () => {
  await setProposalFlags(true, false);
  const f = await fixture('no-match', 29);
  await db.query('update public.provider_services ps set active = false where ps.id = $1::uuid', [f.serviceId]);
  const requestId = await createRequest(f, validBaseIntake, null, 29);
  const actual = await counts(f);
  const row = (await db.query('select r.status from public.service_requests r where r.id = $1::uuid', [requestId])).rows[0];
  check(actual.requests === 1 && actual.private_rows === 1 && actual.recipients === 0 && row.status === 'open',
    'no-match request remains open with zero recipients instead of failing creation', { actual, row });
});

await h.scenario('targeted-provider-failure-rolls-back-request-and-private-writes', async () => {
  await setProposalFlags(true, false);
  const f = await fixture('targeted-atomic', 30);
  await db.query('update public.providers p set paused = true where p.id = $1::uuid', [f.provider]);
  const before = await counts(f);
  const error = await fails(() => createRequest(f, validBaseIntake, f.provider, 30));
  const after = await counts(f);
  check(!!error && JSON.stringify(before) === JSON.stringify(after),
    'unavailable targeted provider failure is atomic', { error, before, after });
});
async function providerReadinessScenario(name, firstDay, changeProvider) {
  await h.scenario(name, async () => {
    await setProposalFlags(true, false);
    const f = await fixture(name, firstDay);
    const routedRequest = await createRequest(f, validBaseIntake, f.provider, firstDay);
    await changeProvider(f);
    const sendError = await fails(() => sendProposal(f, routedRequest));
    const openRequest = await createRequest(f, validBaseIntake, null, firstDay + 1);
    const openRecipients = (await db.query(`
      select count(*)::int as count from public.request_recipients rr where rr.request_id = $1::uuid
    `, [openRequest])).rows[0].count;
    const actual = await counts(f);
    check(!!sendError && openRecipients === 0 && actual.requests === 2
      && actual.private_rows === 2 && actual.recipients === 1 && actual.proposals === 0,
      `${name}: current provider readiness blocks new routing and send`, { sendError, openRecipients, actual });
  });
}

await providerReadinessScenario('admin-rejected-provider-is-not-routed-or-sent', 31, async (f) => {
  await db.query('update public.providers p set admin_review_status = $1::text where p.id = $2::uuid', ['rejected', f.provider]);
});
await providerReadinessScenario('deactivated-provider-is-not-routed-or-sent', 34, async (f) => {
  await db.query('update public.providers p set deactivated_at = $1::timestamptz where p.id = $2::uuid', ['2026-01-01T00:00:00Z', f.provider]);
});
await providerReadinessScenario('unsubmitted-provider-is-not-routed-or-sent', 37, async (f) => {
  await db.query('update public.providers p set submitted_at = null where p.id = $1::uuid', [f.provider]);
});
await providerReadinessScenario('paused-provider-is-not-routed-or-sent', 40, async (f) => {
  await db.query('update public.providers p set paused = true where p.id = $1::uuid', [f.provider]);
});
await providerReadinessScenario('inactive-provider-service-is-not-routed-or-sent', 43, async (f) => {
  await db.query('update public.provider_services ps set active = false where ps.id = $1::uuid', [f.serviceId]);
});
await providerReadinessScenario('missing-category-document-blocks-routed-send', 46, async (f) => {
  await db.query("update public.categories c set requires_docs = array['photo_id']::text[] where c.id = $1::uuid", [f.categoryId]);
});
await providerReadinessScenario('provider-time-off-blocks-window-routing-and-send', 49, async (f) => {
  await db.query(`
    insert into public.provider_time_off (provider_id, period, reason)
    values ($1::uuid, tstzrange($2::timestamptz, $3::timestamptz, '[)'), $4::text)
  `, [f.provider, new Date(eventStart(49)).toISOString(), new Date(eventStart(51)).toISOString(), 'O21-SV19 test window']);
});

await h.scenario('service-only-routing-privilege-is-preserved', async () => {
  const privileges = (await db.query(`
    select has_function_privilege('authenticated', 'public.route_service_request(uuid,integer)', 'execute') as authenticated,
           has_function_privilege('anon', 'public.route_service_request(uuid,integer)', 'execute') as anon,
           has_function_privilege('service_role', 'public.route_service_request(uuid,integer)', 'execute') as service
  `)).rows[0];
  check(privileges.authenticated === false && privileges.anon === false && privileges.service === true,
    'request routing remains service-only', privileges);
});

h.finish();
import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const originalMerchantStaff = (await db.query(
  "select enabled from public.feature_flags where key = 'merchant_staff'",
)).rows[0].enabled;
const h = createHarness({
  cleanup: async () => {
    await db.query(
      'update public.feature_flags set enabled = $1::boolean where key = $2::text',
      [originalMerchantStaff, 'merchant_staff'],
    );
  },
});
const check = (condition, label, actual) => h.ok(condition, `${label}; actual=${JSON.stringify(actual)}`);

async function user(label) {
  const id = randomUUID();
  const phone = `+1555${randomUUID().replace(/\D/g, '').slice(0, 10)}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, phone]);
  await db.query(
    'update public.profiles set full_name = $2::text where id = $1::uuid',
    [id, `O21-SV06 ${label}`],
  );
  return id;
}

async function provider(ownerId, categoryId, city) {
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, admin_review_status, submitted_at, is_online, paused, suspended
    ) values (
      $1::uuid, $2::text,
      extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', 'approved', now(), true, false, false
    )
  `, [ownerId, city]);
  return (await db.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0::int, 0::int, true)
    returning id
  `, [ownerId, categoryId])).rows[0].id;
}

async function category(label) {
  const id = (await db.query(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version, max_lead_days
    ) values (
      $1::text, $2::text, 'quote', true, 'proposal', '{}'::jsonb, 1::int, 365::int
    )
    returning id
  `, [`sv06-${label}-${randomUUID().replace(/-/g, '')}`, `SV06 ${label}`])).rows[0].id;
  return id;
}

async function request(customerId, categoryId, providerId, providerServiceId, status, dayOffset) {
  const day = String(10 + dayOffset).padStart(2, '0');
  const eventStart = `2032-01-${day}T10:00:00.000Z`;
  const eventEnd = `2032-01-${day}T12:00:00.000Z`;
  const requestId = (await db.query(`
    insert into public.service_requests (
      customer_id, category_id, city, area, event_start, event_end, intake,
      budget_min, budget_max, status, expires_at
    ) values (
      $1::uuid, $2::uuid, $3::text, $4::text,
      $5::timestamptz, $6::timestamptz, '{}'::jsonb,
      500000::int, 1500000::int, $7::text, '2031-12-01T00:00:00.000Z'::timestamptz
    )
    returning id
  `, [customerId, categoryId, `SV06 City ${dayOffset}`, `Area ${dayOffset}`, eventStart, eventEnd, status])).rows[0].id;
  await db.query(`
    insert into public.request_recipients (request_id, provider_id, provider_service_id)
    values ($1::uuid, $2::uuid, $3::uuid)
  `, [requestId, providerId, providerServiceId]);
  return requestId;
}

async function makeFixture(label, status, dayOffset) {
  const customerId = await user(`${label} customer`);
  const providerId = await user(`${label} provider`);
  const categoryId = await category(label);
  const providerServiceId = await provider(providerId, categoryId, `SV06 City ${dayOffset}`);
  const requestId = await request(customerId, categoryId, providerId, providerServiceId, status, dayOffset);
  return { customerId, providerId, requestId };
}

async function deniedSend(userId, requestId, providerId, label, expected) {
  let actual = '<no error>';
  try {
    await as(userId, 'authenticated', `
      select public.send_request_message($1::uuid, $2::uuid, $3::text) as result
    `, [requestId, providerId, 'A request follow-up']);
  } catch (error) {
    actual = error?.message ?? String(error);
  }
  check(expected.test(actual), label, { error: actual, requestId, providerId });
}

await h.scenario('customer send returns its real id, nudge and timestamped thread row', async () => {
  const fixture = await makeFixture('customer-send', 'closed', 1);
  const body = 'Please send payment outside QuickServe';
  const [response] = await as(fixture.customerId, 'authenticated', `
    select public.send_request_message($1::uuid, $2::uuid, $3::text) as result
  `, [fixture.requestId, fixture.providerId, body]);
  const result = response.result;
  const rows = await as(fixture.customerId, 'authenticated', `
    select id, request_id, provider_id, sender_id, body, created_at
      from public.request_messages
     where request_id = $1::uuid and provider_id = $2::uuid and id = $3::uuid
  `, [fixture.requestId, fixture.providerId, result.message_id]);
  const [readback] = rows;
  check(
    typeof result.message_id === 'string' && result.nudge === true
      && readback?.id === result.message_id
      && readback.request_id === fixture.requestId
      && readback.provider_id === fixture.providerId
      && readback.sender_id === fixture.customerId
      && readback.body === body
      && readback.created_at != null
      && Number.isFinite(new Date(readback.created_at).getTime()),
    'RPC result and exact request/provider readback retain id, timestamp and leakage nudge',
    { result, readback, requestId: fixture.requestId, providerId: fixture.providerId },
  );
});

await h.scenario('business staff can message and unrelated identities cannot read or send the thread', async () => {
  const fixture = await makeFixture('staff-send', 'open', 2);
  const staffId = await user('authorized business staff');
  const unrelatedId = await user('unrelated reader');
  await db.query(
    "update public.feature_flags set enabled = true where key = 'merchant_staff'",
  );
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values ($1::uuid, $2::uuid, 'staff', true)
  `, [fixture.providerId, staffId]);

  const [response] = await as(staffId, 'authenticated', `
    select public.send_request_message($1::uuid, $2::uuid, $3::text) as result
  `, [fixture.requestId, fixture.providerId, 'Staff reply']);
  const staffReadback = await as(staffId, 'authenticated', `
    select id, request_id, provider_id, sender_id, body, created_at
      from public.request_messages
     where request_id = $1::uuid and provider_id = $2::uuid and id = $3::uuid
  `, [fixture.requestId, fixture.providerId, response.result.message_id]);
  const unrelatedReadback = await as(unrelatedId, 'authenticated', `
    select id from public.request_messages
     where request_id = $1::uuid and provider_id = $2::uuid
  `, [fixture.requestId, fixture.providerId]);
  check(
    staffReadback.length === 1 && staffReadback[0].sender_id === staffId
      && staffReadback[0].created_at != null
      && Number.isFinite(new Date(staffReadback[0].created_at).getTime()),
    'authorized business staff can send and read their exact routed thread',
    { response: response.result, staffReadback },
  );
  check(unrelatedReadback.length === 0, 'unrelated identity cannot read the routed thread', unrelatedReadback);
  await deniedSend(
    unrelatedId,
    fixture.requestId,
    fixture.providerId,
    'unrelated identity cannot send to the routed thread',
    /not a request participant/i,
  );
});

for (const [status, dayOffset] of [['booked', 3], ['cancelled', 4], ['expired', 5]]) {
  await h.scenario(`${status} request rejects direct message RPC`, async () => {
    const fixture = await makeFixture(`${status}-read-only`, status, dayOffset);
    await deniedSend(
      fixture.customerId,
      fixture.requestId,
      fixture.providerId,
      `${status} thread remains server read-only`,
      /request conversation is closed/i,
    );
  });
}

h.finish();

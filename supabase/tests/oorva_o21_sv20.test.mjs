import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const originalArchetypeFlags = (await db.query(
  "select value from public.app_config where key = 'archetype_flags'",
)).rows[0].value;
const h = createHarness({
  cleanup: async () => {
    await db.query(
      'update public.app_config set value = $1::jsonb where key = $2::text',
      [JSON.stringify(originalArchetypeFlags), 'archetype_flags'],
    );
  },
});
const check = (condition, label, actual) => h.ok(condition, `${label}; actual=${JSON.stringify(actual)}`);

async function setProposalEnabled(enabled) {
  await db.query(`
    update public.app_config
       set value = value || jsonb_build_object('proposal', $1::boolean)
     where key = $2::text
  `, [enabled, 'archetype_flags']);
}

async function user(label) {
  const id = randomUUID();
  const phone = `+1555${randomUUID().replace(/\D/g, '').slice(0, 10)}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, phone]);
  await db.query(
    'update public.profiles set full_name = $2::text where id = $1::uuid',
    [id, `SV20 ${label}`],
  );
  return id;
}

async function fixture(label) {
  await setProposalEnabled(true);
  const customer = await user(`${label}-customer`);
  const owner = await user(`${label}-owner`);
  const otherOwner = await user(`${label}-other-owner`);
  const stranger = await user(`${label}-stranger`);
  const city = `SV20 ${label} City`;
  const categoryId = (await db.query(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version, max_lead_days
    ) values (
      $1::text, $2::text, 'quote', true, 'proposal', '{}'::jsonb, 1::int, 365::int
    )
    returning id
  `, [`sv20-${randomUUID().replace(/-/g, '')}`, `SV20 ${label}`])).rows[0].id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, '2026-01-01T00:00:00Z'::timestamptz)
  `, [categoryId, city]);

  async function addProvider(providerId, providerLabel) {
    await db.query(`
      insert into public.providers (
        id, city, base_location, kyc_status, admin_review_status, submitted_at, is_online, paused, suspended
      ) values (
        $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
        'verified', 'approved', '2026-01-01T00:00:00Z'::timestamptz, true, false, false
      )
    `, [providerId, city]);
    return (await db.query(`
      insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
      values ($1::uuid, $2::uuid, 0::int, 0::int, true)
      returning id
    `, [providerId, categoryId])).rows[0].id;
  }

  const ownerService = await addProvider(owner, 'owner');
  const otherOwnerService = await addProvider(otherOwner, 'other-owner');
  const addressId = (await db.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Venue', 'SV20 test address', $2::text, 16.50::double precision, 80.60::double precision)
    returning id
  `, [customer, city])).rows[0].id;

  return {
    customer,
    owner,
    otherOwner,
    stranger,
    city,
    categoryId,
    ownerService,
    otherOwnerService,
    addressId,
  };
}

async function createRequest(f, label, status = 'open') {
  const requestId = (await db.query(`
    insert into public.service_requests (
      customer_id, category_id, city, area, event_start, event_end, intake,
      budget_min, budget_max, status, expires_at
    ) values (
      $1::uuid, $2::uuid, $3::text, $4::text,
      '2027-04-14T10:00:00+05:30'::timestamptz,
      '2027-04-14T14:00:00+05:30'::timestamptz,
      '{}'::jsonb, 50000::int, 200000::int, $5::text, '2027-04-13T18:00:00Z'::timestamptz
    )
    returning id
  `, [f.customer, f.categoryId, f.city, `Area ${label}`, status])).rows[0].id;
  await db.query(`
    insert into public.request_private (request_id, address_id, venue_text)
    values ($1::uuid, $2::uuid, $3::text)
  `, [requestId, f.addressId, `SV20 ${label} venue`]);
  return requestId;
}

async function addRecipient(requestId, providerId, providerServiceId) {
  await db.query(`
    insert into public.request_recipients (request_id, provider_id, provider_service_id)
    values ($1::uuid, $2::uuid, $3::uuid)
  `, [requestId, providerId, providerServiceId]);
}

async function addProposal(requestId, providerId, providerServiceId, version, status) {
  return (await db.query(`
    insert into public.proposals (
      request_id, provider_id, provider_service_id, version, status, total, valid_until, note, deliverables
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::int, $5::text, 100000::int,
      '2027-04-13T18:00:00Z'::timestamptz, 'SV20 cancellation fixture', '[]'::jsonb
    )
    returning id
  `, [requestId, providerId, providerServiceId, version, status])).rows[0].id;
}

async function addBooking(f, requestId, proposalId, status, createdAt) {
  return (await db.query(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, status, visit_fee, platform_fee, total_amount,
      service_window, service_request_id, proposal_id, archetype,
      payment_hold_expires_at, delivery_status, created_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      'SV20 request lifecycle fixture', '2027-04-14T10:00:00+05:30'::timestamptz,
      $6::public.booking_status, 0::int, 0::int, 100000::int,
      tstzrange('2027-04-14T10:00:00+05:30'::timestamptz, '2027-04-14T14:00:00+05:30'::timestamptz, '[)'),
      $7::uuid, $8::uuid, 'proposal',
      '2027-04-14T10:30:00+05:30'::timestamptz, 'not_applicable', $9::timestamptz
    )
    returning id
  `, [f.customer, f.owner, f.categoryId, f.ownerService, f.addressId, status, requestId, proposalId, createdAt])).rows[0].id;
}

async function snapshot(requestId) {
  return (await db.query(`
    select jsonb_build_object(
      'request', (select to_jsonb(r) from public.service_requests r where r.id = $1::uuid),
      'proposals', coalesce((
        select jsonb_agg(to_jsonb(p) order by p.id)
          from public.proposals p
         where p.request_id = $1::uuid
      ), '[]'::jsonb),
      'bookings', coalesce((
        select jsonb_agg(to_jsonb(b) order by b.id)
          from public.bookings b
         where b.service_request_id = $1::uuid
      ), '[]'::jsonb)
    ) as state
  `, [requestId])).rows[0].state;
}

async function fails(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error?.message ?? String(error);
  }
}

await h.scenario('active-payment-hold-rejects-request-only-cancellation-without-row-changes', async () => {
  const f = await fixture('active-hold');
  const requestId = await createRequest(f, 'active-hold', 'closed');
  await addRecipient(requestId, f.owner, f.ownerService);
  await addRecipient(requestId, f.otherOwner, f.otherOwnerService);
  const acceptedProposalId = await addProposal(requestId, f.owner, f.ownerService, 1, 'accepted');
  await addProposal(requestId, f.otherOwner, f.otherOwnerService, 1, 'sent');
  const bookingId = await addBooking(
    f, requestId, acceptedProposalId, 'pending_payment', '2027-04-14T09:00:00Z',
  );
  const before = await snapshot(requestId);
  const error = await fails(() => as(f.customer, 'authenticated', `
    select public.cancel_service_request($1::uuid)
  `, [requestId]));
  const after = await snapshot(requestId);
  const viewState = (await as(f.customer, 'authenticated', `
    select public.get_proposal_view_state($1::uuid) as state
  `, [acceptedProposalId]))[0].state;
  check(/active booking/i.test(error ?? '') && JSON.stringify(before) === JSON.stringify(after),
    'active hold is rejected before request, proposal, or booking rows change',
    { error, before, after, requestId, bookingId });
  check(viewState.current_booking_id === bookingId
      && viewState.current_booking_status === 'pending_payment'
      && viewState.payment_hold_expires_at !== null,
    'the existing T05 proposal view state exposes the current active hold for management',
    viewState);
});

await h.scenario('open-request-without-active-booking-cancels-and-rejects-sent-offers', async () => {
  const f = await fixture('open-no-hold');
  const requestId = await createRequest(f, 'open-no-hold', 'open');
  await addRecipient(requestId, f.owner, f.ownerService);
  await addRecipient(requestId, f.otherOwner, f.otherOwnerService);
  const firstProposalId = await addProposal(requestId, f.owner, f.ownerService, 1, 'sent');
  const secondProposalId = await addProposal(requestId, f.otherOwner, f.otherOwnerService, 1, 'sent');
  await as(f.customer, 'authenticated', `
    select public.cancel_service_request($1::uuid)
  `, [requestId]);
  const after = await snapshot(requestId);
  const statuses = after.proposals.map(({ status }) => status);
  check(after.request.status === 'cancelled'
      && statuses.length === 2
      && statuses.every((status) => status === 'rejected')
      && after.bookings.length === 0,
    'open request without an active booking still cancels and rejects all sent offers',
    { after, proposalIds: [firstProposalId, secondProposalId] });
});

await h.scenario('closed-request-history-does-not-block-cancellation', async () => {
  const f = await fixture('closed-history');
  const requestId = await createRequest(f, 'closed-history', 'closed');
  await addRecipient(requestId, f.owner, f.ownerService);
  await addRecipient(requestId, f.otherOwner, f.otherOwnerService);
  const expiredProposalId = await addProposal(requestId, f.owner, f.ownerService, 1, 'accepted');
  const cancelledProposalId = await addProposal(requestId, f.owner, f.ownerService, 2, 'accepted');
  const sentProposalId = await addProposal(requestId, f.otherOwner, f.otherOwnerService, 1, 'sent');
  const expiredBookingId = await addBooking(
    f, requestId, expiredProposalId, 'expired', '2027-04-14T09:00:00Z',
  );
  const cancelledBookingId = await addBooking(
    f, requestId, cancelledProposalId, 'cancelled', '2027-04-14T09:01:00Z',
  );
  await as(f.customer, 'authenticated', `
    select public.cancel_service_request($1::uuid)
  `, [requestId]);
  const after = await snapshot(requestId);
  const bookingStates = after.bookings.map(({ id, status }) => ({ id, status }));
  const proposalStates = after.proposals.map(({ id, status }) => ({ id, status }));
  check(after.request.status === 'cancelled'
      && bookingStates.some(({ id, status }) => id === expiredBookingId && status === 'expired')
      && bookingStates.some(({ id, status }) => id === cancelledBookingId && status === 'cancelled')
      && proposalStates.some(({ id, status }) => id === sentProposalId && status === 'rejected'),
    'closed request cancels despite expired/cancelled history while preserving history and rejecting sent offers',
    { after, bookingStates, proposalStates, expiredProposalId, cancelledProposalId });
});

await h.scenario('existing-booking-cancellation-remains-available-with-proposal-acquisition-off', async () => {
  await setProposalEnabled(true);
  const f = await fixture('existing-booking-off');
  const requestId = await createRequest(f, 'existing-booking-off', 'closed');
  await addRecipient(requestId, f.owner, f.ownerService);
  const proposalId = await addProposal(requestId, f.owner, f.ownerService, 1, 'accepted');
  const bookingId = await addBooking(
    f, requestId, proposalId, 'pending_payment', '2027-04-14T09:00:00Z',
  );
  await setProposalEnabled(false);
  const error = await fails(() => as(f.customer, 'authenticated', `
    select public.cancel_booking($1::uuid, $2::text)
  `, [bookingId, 'Existing booking resolution']));
  const actual = (await db.query(`
    select b.status::text as booking_status, r.status as request_status,
           (select c.value #>> '{proposal}' from public.app_config c where c.key = $2::text) as proposal_enabled
      from public.bookings b
      join public.service_requests r on r.id = b.service_request_id
     where b.id = $1::uuid
  `, [bookingId, 'archetype_flags'])).rows[0];
  check(error === null
      && actual.booking_status === 'cancelled'
      && actual.request_status === 'closed'
      && actual.proposal_enabled === 'false',
    'customer resolves an existing booking through cancel_booking while proposal acquisition is OFF',
    { error, actual, requestId });
});

await h.scenario('only-the-request-customer-may-cancel', async () => {
  const f = await fixture('unauthorized');
  const requestId = await createRequest(f, 'unauthorized', 'open');
  const before = await snapshot(requestId);
  const error = await fails(() => as(f.stranger, 'authenticated', `
    select public.cancel_service_request($1::uuid)
  `, [requestId]));
  const after = await snapshot(requestId);
  check(/only the customer/i.test(error ?? '') && JSON.stringify(before) === JSON.stringify(after),
    'unauthorized request cancellation is denied without row changes', { error, before, after });
});

h.finish();

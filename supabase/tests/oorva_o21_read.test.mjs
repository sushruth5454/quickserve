import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const originalMerchantStaff = (await db.query(
  "select enabled from public.feature_flags where key = 'merchant_staff'",
)).rows[0].enabled;
const originalArchetypeFlags = (await db.query(
  "select value from public.app_config where key = 'archetype_flags'",
)).rows[0].value;
const h = createHarness({
  cleanup: async () => {
    await db.query(
      'update public.feature_flags set enabled = $1::boolean where key = $2::text',
      [originalMerchantStaff, 'merchant_staff'],
    );
    await db.query(
      'update public.app_config set value = $1::jsonb where key = $2::text',
      [JSON.stringify(originalArchetypeFlags), 'archetype_flags'],
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
    [id, `O21 ${label}`],
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

async function category(label, city) {
  const intakeSchema = {
    type: 'object',
    properties: {
      brief: { type: 'string' },
      private_note: { type: 'string', 'x-private': true },
    },
    required: ['brief'],
  };
  const id = (await db.query(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version, max_lead_days
    ) values (
      $1::text, $2::text, 'quote', true, 'proposal', $3::jsonb, 1::int, 365::int
    )
    returning id
  `, [`o21-${label}-${randomUUID().replace(/-/g, '')}`, `O21 ${label}`, JSON.stringify(intakeSchema)])).rows[0].id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
    on conflict (category_id, city) do update set live = true
  `, [id, city]);
  await db.query(`
    update public.app_config
       set value = value || '{"proposal":true}'::jsonb
     where key = 'archetype_flags'
  `);
  return id;
}

async function request(customerId, categoryId, label, city, eventStart, eventEnd, expiresAt) {
  return (await db.query(`
    insert into public.service_requests (
      customer_id, category_id, city, area, event_start, event_end, intake,
      budget_min, budget_max, status, expires_at
    ) values (
      $1::uuid, $2::uuid, $3::text, $4::text,
      $5::timestamptz, $6::timestamptz,
      $7::jsonb, 500000::int, 1500000::int, 'open', $8::timestamptz
    )
    returning id
  `, [customerId, categoryId, city, `Area ${label}`, eventStart, eventEnd, JSON.stringify({
    brief: `O21 ${label} proposal brief`,
    private_note: `O21 ${label} private venue note`,
  }), expiresAt])).rows[0].id;
}

async function recipient(requestId, ownerId, providerServiceId) {
  await db.query(`
    insert into public.request_recipients (request_id, provider_id, provider_service_id)
    values ($1::uuid, $2::uuid, $3::uuid)
  `, [requestId, ownerId, providerServiceId]);
}

async function proposal(requestId, ownerId, providerServiceId, version, status, validUntil) {
  return (await db.query(`
    insert into public.proposals (
      request_id, provider_id, provider_service_id, version, status, total, valid_until, note, deliverables
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::int, $5::text, 100000::int,
      $6::timestamptz, 'O21 status fixture', '[]'::jsonb
    )
    returning id
  `, [requestId, ownerId, providerServiceId, version, status, validUntil])).rows[0].id;
}

async function booking(customerId, ownerId, categoryId, providerServiceId, addressId, requestId, proposalId, status, eventStart, eventEnd, createdAt) {
  return (await db.query(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, status, visit_fee, platform_fee, total_amount,
      service_window, service_request_id, proposal_id, archetype,
      payment_hold_expires_at, delivery_status, created_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      'O21 read-state fixture', $6::timestamptz,
      $7::public.booking_status, 0::int, 0::int, 100000::int,
      tstzrange($8::timestamptz, $9::timestamptz, '[)'),
      $10::uuid, $11::uuid, 'proposal', $6::timestamptz + interval '30 minutes',
      'not_applicable', $12::timestamptz
    )
    returning id
  `, [customerId, ownerId, categoryId, providerServiceId, addressId, eventStart, status, eventStart, eventEnd, requestId, proposalId, createdAt])).rows[0].id;
}

async function viewState(userId, proposalId) {
  return (await as(userId, 'authenticated', `
    select public.get_proposal_view_state($1::uuid) as state
  `, [proposalId]))[0].state;
}

async function expectDenied(userId, proposalId, label) {
  let actual = '<no error>';
  try {
    await viewState(userId, proposalId);
  } catch (error) {
    actual = error?.message ?? String(error);
  }
  check(/proposal not found/i.test(actual), label, { error: actual, proposalId });
}

await h.scenario('O21-ID02-delegated-request-view-gates-and-ambiguity', async () => {
  const customerId = await user('customer');
  const ownerId = await user('owner');
  const secondOwnerId = await user('second-owner');
  const managerId = await user('manager');
  const staffId = await user('staff');
  const inactiveManagerId = await user('inactive-manager');
  const strangerId = await user('stranger');
  const city = 'O21 Delegation City';
  const eventStart = '2027-03-17T10:00:00+05:30';
  const eventEnd = '2027-03-17T14:00:00+05:30';
  const categoryId = await category('delegation', city);
  const ownerServiceId = await provider(ownerId, categoryId, city);
  const secondServiceId = await provider(secondOwnerId, categoryId, city);
  const requestId = await request(
    customerId, categoryId, 'delegation', city, eventStart, eventEnd, '2027-03-16T18:00:00+05:30',
  );
  await recipient(requestId, ownerId, ownerServiceId);
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values
      ($1::uuid, $2::uuid, 'manager', true),
      ($1::uuid, $3::uuid, 'staff', true),
      ($1::uuid, $4::uuid, 'manager', false)
  `, [ownerId, managerId, staffId, inactiveManagerId]);
  await db.query(`
    update public.feature_flags set enabled = true where key = 'merchant_staff'
  `);

  const delegated = await as(managerId, 'authenticated', `
    select id, provider_id, intake from public.service_request_provider_view where id = $1::uuid
  `, [requestId]);
  check(delegated.length === 1
      && delegated[0].provider_id === ownerId
      && delegated[0].intake.brief === 'O21 delegation proposal brief'
      && !Object.hasOwn(delegated[0].intake, 'private_note'),
    'active manager sees one sanitized delegated request while merchant_staff is ON', delegated);

  const ownerRows = await as(ownerId, 'authenticated', `
    select id, provider_id, intake from public.service_request_provider_view where id = $1::uuid
  `, [requestId]);
  check(ownerRows.length === 1 && ownerRows[0].provider_id === ownerId,
    'actual provider owner sees its own request while merchant_staff is ON', ownerRows);

  const staffRows = await as(staffId, 'authenticated', `
    select id from public.service_request_provider_view where id = $1::uuid
  `, [requestId]);
  const inactiveRows = await as(inactiveManagerId, 'authenticated', `
    select id from public.service_request_provider_view where id = $1::uuid
  `, [requestId]);
  const strangerRows = await as(strangerId, 'authenticated', `
    select id from public.service_request_provider_view where id = $1::uuid
  `, [requestId]);
  check(staffRows.length === 0 && inactiveRows.length === 0 && strangerRows.length === 0,
    'staff, inactive manager, and stranger do not gain manager request access',
    { staffRows, inactiveRows, strangerRows });

  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values ($1::uuid, $2::uuid, 'manager', true)
  `, [secondOwnerId, managerId]);
  await recipient(requestId, secondOwnerId, secondServiceId);
  const ambiguousRows = await as(managerId, 'authenticated', `
    select id from public.service_request_provider_view where id = $1::uuid
  `, [requestId]);
  check(ambiguousRows.length === 0, 'ambiguous routing to two managed providers is suppressed', ambiguousRows);

  await db.query(`
    delete from public.request_recipients
     where request_id = $1::uuid and provider_id = $2::uuid
  `, [requestId, secondOwnerId]);
  await db.query(`
    update public.business_members set active = false
     where owner_id = $1::uuid and member_id = $2::uuid
  `, [ownerId, managerId]);
  const removedRows = await as(managerId, 'authenticated', `
    select id from public.service_request_provider_view where id = $1::uuid
  `, [requestId]);
  const ownerAfterRemoval = await as(ownerId, 'authenticated', `
    select id from public.service_request_provider_view where id = $1::uuid
  `, [requestId]);
  check(removedRows.length === 0 && ownerAfterRemoval.length === 1,
    'membership removal denies delegated view immediately while owner branch remains', { removedRows, ownerAfterRemoval });

  await db.query(`
    update public.business_members set active = true
     where owner_id = $1::uuid and member_id = $2::uuid
  `, [ownerId, managerId]);
  await db.query(`
    update public.feature_flags set enabled = false where key = 'merchant_staff'
  `);
  const managerOffRows = await as(managerId, 'authenticated', `
    select id from public.service_request_provider_view where id = $1::uuid
  `, [requestId]);
  const ownerOffRows = await as(ownerId, 'authenticated', `
    select id from public.service_request_provider_view where id = $1::uuid
  `, [requestId]);
  check(managerOffRows.length === 0 && ownerOffRows.length === 1,
    'merchant_staff OFF denies delegated view but preserves the owner own-request branch',
    { managerOffRows, ownerOffRows });
});

await h.scenario('O21-SV05-authorized-proposal-state-and-booking-history', async () => {
  const customerId = await user('state-customer');
  const ownerId = await user('state-owner');
  const managerId = await user('state-manager');
  const staffId = await user('state-staff');
  const adminId = await user('state-admin');
  const strangerId = await user('state-stranger');
  const city = 'O21 Proposal State City';
  const eventStart = '2027-04-14T10:00:00+05:30';
  const eventEnd = '2027-04-14T14:00:00+05:30';
  const categoryId = await category('proposal-state', city);
  const providerServiceId = await provider(ownerId, categoryId, city);
  const requestId = await request(
    customerId, categoryId, 'state', city, eventStart, eventEnd, '2027-04-13T18:00:00+05:30',
  );
  await recipient(requestId, ownerId, providerServiceId);
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values
      ($1::uuid, $2::uuid, 'manager', true),
      ($1::uuid, $3::uuid, 'staff', true)
  `, [ownerId, managerId, staffId]);
  await db.query(`insert into public.admins (user_id) values ($1::uuid)`, [adminId]);
  await db.query(`update public.feature_flags set enabled = true where key = 'merchant_staff'`);

  const addressId = (await db.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Venue', 'Private exact venue', $2::text, 16.5::double precision, 80.6::double precision)
    returning id
  `, [customerId, city])).rows[0].id;
  const sentId = await proposal(requestId, ownerId, providerServiceId, 1, 'sent', '2027-04-13T18:00:00+05:30');
  const sentCustomer = await viewState(customerId, sentId);
  const expectedKeys = [
    'proposal_id', 'viewer_role', 'request_status', 'request_expires_at', 'current_booking_id',
    'current_booking_status', 'current_booking_created_at', 'payment_hold_expires_at', 'delivery_status',
    'can_accept', 'can_withdraw', 'can_send_new', 'can_message',
  ].sort();
  check(sentCustomer.viewer_role === 'customer' && sentCustomer.can_accept && sentCustomer.can_message
      && !sentCustomer.can_withdraw
      && JSON.stringify(Object.keys(sentCustomer).sort()) === JSON.stringify(expectedKeys),
    'customer receives only the redacted state contract and valid sent Accept capability',
    { sentCustomer, expectedKeys });

  await db.query('update public.categories set active = false where id = $1::uuid', [categoryId]);
  const unavailableCategoryState = await viewState(customerId, sentId);
  check(!unavailableCategoryState.can_accept,
    'inactive proposal category suppresses the customer Accept capability', unavailableCategoryState);
  await db.query('update public.categories set active = true where id = $1::uuid', [categoryId]);

  const ownerState = await viewState(ownerId, sentId);
  const managerState = await viewState(managerId, sentId);
  const adminState = await viewState(adminId, sentId);
  check(ownerState.viewer_role === 'owner' && !ownerState.can_accept && ownerState.can_withdraw,
    'owner is never treated as customer and retains the existing withdraw guard', ownerState);
  check(managerState.viewer_role === 'manager' && !managerState.can_accept && managerState.can_withdraw,
    'manager is read-only for customer Accept and retains manager proposal access', managerState);
  check(adminState.viewer_role === 'admin' && !adminState.can_accept && !adminState.can_withdraw && !adminState.can_message,
    'permitted admin reads do not inherit customer or provider write capabilities', adminState);
  await expectDenied(staffId, sentId, 'staff does not gain proposal read access');
  await expectDenied(strangerId, sentId, 'stranger does not gain proposal read access');

  await db.query(`update public.feature_flags set enabled = false where key = 'merchant_staff'`);
  await expectDenied(managerId, sentId, 'merchant_staff OFF removes manager proposal read access');
  const ownerOff = await viewState(ownerId, sentId);
  check(ownerOff.viewer_role === 'owner', 'owner proposal read remains available with merchant_staff OFF', ownerOff);
  await db.query(`update public.feature_flags set enabled = true where key = 'merchant_staff'`);

  const disputedProposal = await proposal(requestId, ownerId, providerServiceId, 2, 'accepted', '2027-04-13T18:00:00+05:30');
  const historyProposal = await proposal(requestId, ownerId, providerServiceId, 3, 'accepted', '2027-04-13T18:00:00+05:30');
  await booking(customerId, ownerId, categoryId, providerServiceId, addressId, requestId, disputedProposal,
    'disputed', eventStart, eventEnd, '2027-04-14T15:00:00+05:30');
  await booking(customerId, ownerId, categoryId, providerServiceId, addressId, requestId, disputedProposal,
    'expired', eventStart, eventEnd, '2027-04-15T15:00:00+05:30');
  const disputedState = await viewState(customerId, disputedProposal);
  check(disputedState.current_booking_status === 'disputed'
      && disputedState.current_booking_id !== null
      && !disputedState.can_accept,
    'active disputed booking wins over later expired-hold history and is not reported as confirmed',
    disputedState);

  const olderHistory = await booking(customerId, ownerId, categoryId, providerServiceId, addressId, requestId, historyProposal,
    'cancelled', eventStart, eventEnd, '2027-04-14T15:00:00+05:30');
  const newerHistory = await booking(customerId, ownerId, categoryId, providerServiceId, addressId, requestId, historyProposal,
    'refunded', eventStart, eventEnd, '2027-04-16T15:00:00+05:30');
  const historyState = await viewState(customerId, historyProposal);
  check(historyState.current_booking_id === newerHistory
      && historyState.current_booking_id !== olderHistory
      && historyState.current_booking_status === 'refunded',
    'without an active booking the latest history is selected deterministically by created_at and id',
    historyState);

  const busyCustomerId = await user('busy-customer');
  const targetCustomerId = await user('busy-target-customer');
  const busyRequestId = await request(
    busyCustomerId, categoryId, 'busy', city, eventStart, eventEnd, '2027-04-13T18:00:00+05:30',
  );
  const targetRequestId = await request(
    targetCustomerId, categoryId, 'busy-target', city, eventStart, eventEnd, '2027-04-13T18:00:00+05:30',
  );
  await recipient(busyRequestId, ownerId, providerServiceId);
  await recipient(targetRequestId, ownerId, providerServiceId);
  const busyProposalId = await proposal(
    busyRequestId, ownerId, providerServiceId, 1, 'accepted', '2027-04-13T18:00:00+05:30',
  );
  const targetProposalId = await proposal(
    targetRequestId, ownerId, providerServiceId, 1, 'sent', '2027-04-13T18:00:00+05:30',
  );
  const busyAddressId = (await db.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Busy venue', 'Busy booking venue', $2::text, 16.5::double precision, 80.6::double precision)
    returning id
  `, [busyCustomerId, city])).rows[0].id;
  await booking(busyCustomerId, ownerId, categoryId, providerServiceId, busyAddressId, busyRequestId, busyProposalId,
    'confirmed', eventStart, eventEnd, '2027-04-14T15:00:00+05:30');
  const providerBusyState = await viewState(targetCustomerId, targetProposalId);
  check(providerBusyState.current_booking_id === null && !providerBusyState.can_accept,
    'overlapping active booking suppresses Accept for another request to the same provider', providerBusyState);
});

h.finish();

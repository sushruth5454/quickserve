import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const authenticated = (userId, sql, params = []) => as(userId, 'authenticated', sql, params);

async function makeUser(label) {
  const id = randomUUID();
  const phone = `+1555${randomUUID().replace(/\D/g, '').slice(0, 10)}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, phone]);
  await db.query(
    'update public.profiles as p set full_name = $2::text where p.id = $1::uuid',
    [id, `SV12 ${label}`],
  );
  return id;
}

async function makeFixture(label) {
  const actors = {
    customer: await makeUser(`${label}-customer`),
    owner: await makeUser(`${label}-owner`),
    manager: await makeUser(`${label}-manager`),
    stranger: await makeUser(`${label}-stranger`),
  };
  const city = `SV12 ${label} City`;
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended
    ) values (
      $1::uuid, $2::text,
      extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified'::text, now(), 'approved'::text, true, false, false
    )
  `, [actors.owner, city]);
  const categoryId = (await one(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, location_modes, pricing_units,
      min_lead_hours, max_lead_days, restricted
    ) values (
      $1::text, $2::text, 'quote'::public.pricing_mode, true, 'time_based'::text,
      array['at_customer']::text[], array['session']::text[], 0::int, 365::int, false
    )
    returning id
  `, [`sv12-${randomUUID().replace(/-/g, '')}`, `SV12 ${label}`])).id;
  const serviceId = (await one(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0::int, 0::int, true)
    returning id
  `, [actors.owner, categoryId])).id;
  const addressId = (await one(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Home'::text, $2::text, $3::text, 16.50::double precision, 80.60::double precision)
    returning id
  `, [actors.customer, `SV12 ${label} Road`, city])).id;
  return { ...actors, categoryId, serviceId, addressId, city };
}

async function makeRecurringSchedule(fixture, label) {
  return (await one(`
    insert into public.recurring_schedules (
      customer_id, provider_id, provider_service_id, frequency, weekdays, start_time,
      session_duration_min, payment_mode, address_line, city, lat, lng, description, starts_on
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'weekly'::text, array[2]::smallint[], time '10:00',
      60::int, 'per_session'::text, $4::text, $5::text, 16.50::double precision,
      80.60::double precision, $6::text, date '2027-03-16'
    )
    returning id
  `, [
    fixture.customer, fixture.owner, fixture.serviceId, `SV12 ${label} address`,
    fixture.city, `SV12 ${label} session`,
  ])).id;
}

async function makeRequestedBooking(fixture, { scheduledAt, recurringScheduleId = null, ageMinutes = 0 }) {
  return (await one(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, service_window, status, visit_fee, platform_fee, total_amount,
      archetype, booking_origin, recurring_schedule_id, session_duration_min, created_at, updated_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'SV12 requested session'::text,
      $6::timestamptz,
      tstzrange($6::timestamptz, $6::timestamptz + interval '1 hour', '[)'),
      'requested'::public.booking_status, 0::int, 0::int, 0::int,
      'time_based'::text, 'marketplace'::text, $7::uuid, 60::int,
      now() - interval '1 day', now() - ($8::int * interval '1 minute')
    )
    returning id
  `, [
    fixture.customer, fixture.owner, fixture.categoryId, fixture.serviceId, fixture.addressId,
    scheduledAt, recurringScheduleId, ageMinutes,
  ])).id;
}

async function fixtureCleanup(fixture, bookingIds = [], scheduleIds = []) {
  await db.query(`
    delete from public.notifications as n
     where n.data ->> 'booking_id' = any($1::text[])
  `, [bookingIds]);
  await db.query('delete from public.bookings as b where b.id = any($1::uuid[])', [bookingIds]);
  await db.query('delete from public.recurring_schedules as r where r.id = any($1::uuid[])', [scheduleIds]);
  await db.query('delete from public.addresses as a where a.id = $1::uuid', [fixture.addressId]);
  await db.query('delete from public.provider_services as ps where ps.id = $1::uuid', [fixture.serviceId]);
  await db.query('delete from public.categories as c where c.id = $1::uuid', [fixture.categoryId]);
  await db.query('delete from public.providers as p where p.id = $1::uuid', [fixture.owner]);
  await db.query('delete from auth.users as u where u.id = any($1::uuid[])', [[
    fixture.customer, fixture.owner, fixture.manager, fixture.stranger,
  ]]);
}

const originalMerchantStaff = (await one(`
  select f.enabled from public.feature_flags as f where f.key = 'merchant_staff'::text
`)).enabled;
const scenarioFixtures = [];
const h = createHarness({ cleanup: async () => {
  for (const tracked of scenarioFixtures.splice(0)) {
    await fixtureCleanup(tracked.fixture, tracked.bookingIds, tracked.scheduleIds);
  }
  await db.query(
    'update public.feature_flags as f set enabled = $1::boolean where f.key = $2::text',
    [originalMerchantStaff, 'merchant_staff'],
  );
} });
const check = (condition, label, actual) => h.ok(condition, `${label}; actual=${JSON.stringify(actual)}`);

await h.scenario('SV-REQUEST-CARD-01 server deadline, family and owner action projection', async () => {
  const fixture = await makeFixture('projection');
  const tracked = { fixture, bookingIds: [], scheduleIds: [] };
  scenarioFixtures.push(tracked);
  const recurringScheduleId = await makeRecurringSchedule(fixture, 'projection');
  tracked.scheduleIds.push(recurringScheduleId);
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values ($1::uuid, $2::uuid, 'manager'::text, true)
  `, [fixture.owner, fixture.manager]);
  await db.query(`
    update public.feature_flags as f set enabled = true
     where f.key = 'merchant_staff'::text
  `);
  const ordinaryId = await makeRequestedBooking(fixture, {
    scheduledAt: '2027-03-16T10:00:00+05:30',
  });
  tracked.bookingIds.push(ordinaryId);
  const recurringId = await makeRequestedBooking(fixture, {
    scheduledAt: '2027-03-23T10:00:00+05:30',
    recurringScheduleId,
    ageMinutes: 45,
  });
  tracked.bookingIds.push(recurringId);
  const ownerRows = await authenticated(fixture.owner, `
    select j.booking_id::text as booking_id, j.status::text as status, j.archetype,
           j.booking_origin, j.recurring_schedule_id::text as recurring_schedule_id,
           j.request_expires_at, j.can_accept, j.can_decline, j.address_line,
           b.updated_at + interval '15 minutes' as expected_deadline
      from public.get_my_business_provider_jobs($1::uuid) as j
      join public.bookings as b on b.id = j.booking_id
     where j.booking_id = any($2::uuid[])
     order by j.booking_id
  `, [fixture.owner, [ordinaryId, recurringId]]);
  const managerRows = await authenticated(fixture.manager, `
    select j.booking_id::text as booking_id, j.can_accept, j.can_decline, j.address_line
      from public.get_my_business_provider_jobs($1::uuid) as j
     where j.booking_id = any($2::uuid[])
  `, [fixture.owner, [ordinaryId, recurringId]]);
  const strangerRows = await authenticated(fixture.stranger, `
    select j.booking_id::text as booking_id
      from public.get_my_business_provider_jobs($1::uuid) as j
  `, [fixture.owner]);
  const customerRows = await authenticated(fixture.customer, `
    select j.booking_id::text as booking_id
      from public.get_my_business_provider_jobs($1::uuid) as j
  `, [fixture.owner]);
  const ordinary = ownerRows.find((row) => row.booking_id === ordinaryId);
  const recurring = ownerRows.find((row) => row.booking_id === recurringId);
  const ordinaryExpected = ordinary && Date.parse(ordinary.request_expires_at) === Date.parse(ordinary.expected_deadline);
  const flagOff = await one(`
    select f.enabled from public.feature_flags as f where f.key = 'oorva_provider_ux'::text
  `);
  const actual = { ownerRows, managerRows, strangerRows, customerRows, flagOff };
  check(
    ownerRows.length === 2
      && ordinary?.status === 'requested'
      && ordinary.archetype === 'time_based'
      && ordinary.booking_origin === 'marketplace'
      && ordinary.recurring_schedule_id === null
      && ordinaryExpected
      && ordinary.can_accept === true
      && ordinary.can_decline === true
      && ordinary.address_line === null
      && recurring?.recurring_schedule_id === recurringScheduleId
      && recurring.request_expires_at === null
      && recurring.can_accept === true
      && recurring.can_decline === true
      && recurring.address_line === null
      && managerRows.length === 2
      && managerRows.every((row) => row.can_accept === false && row.can_decline === false && row.address_line === null)
      && strangerRows.length === 0
      && customerRows.length === 0
      && flagOff?.enabled === false,
    'safe response exposes current ordinary deadline and family while recurring requests have no false timer and only the owner gets actions',
    actual,
  );
});

await h.scenario('SV-REQUEST-CARD-ROLE-02 acceptance deadline and assigned owner resolution', async () => {
  const fixture = await makeFixture('actions');
  const tracked = { fixture, bookingIds: [], scheduleIds: [] };
  scenarioFixtures.push(tracked);
  const recurringScheduleId = await makeRecurringSchedule(fixture, 'actions');
  tracked.scheduleIds.push(recurringScheduleId);
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values ($1::uuid, $2::uuid, 'manager'::text, true)
  `, [fixture.owner, fixture.manager]);
  await db.query(`
    update public.feature_flags as f set enabled = true
     where f.key = 'merchant_staff'::text
  `);
  const recentlyFundedOldBooking = await makeRequestedBooking(fixture, {
    scheduledAt: '2027-03-30T10:00:00+05:30',
  });
  tracked.bookingIds.push(recentlyFundedOldBooking);
  const ownerDeclineBooking = await makeRequestedBooking(fixture, {
    scheduledAt: '2027-04-02T10:00:00+05:30',
  });
  tracked.bookingIds.push(ownerDeclineBooking);
  const expiredOrdinary = await makeRequestedBooking(fixture, {
    scheduledAt: '2027-04-06T10:00:00+05:30',
    ageMinutes: 16,
  });
  tracked.bookingIds.push(expiredOrdinary);
  const recurringOccurrence = await makeRequestedBooking(fixture, {
    scheduledAt: '2027-04-13T10:00:00+05:30',
    recurringScheduleId,
    ageMinutes: 45,
  });
  tracked.bookingIds.push(recurringOccurrence);
  const managerAccept = await (async () => {
    try {
      await authenticated(fixture.manager, 'select public.accept_booking($1::uuid)', [recentlyFundedOldBooking]);
      return '<no error>';
    } catch (error) {
      return error?.message ?? String(error);
    }
  })();
  const managerDecline = await (async () => {
    try {
      await authenticated(fixture.manager, 'select public.decline_booking($1::uuid, $2::text)', [recentlyFundedOldBooking, 'not owner']);
      return '<no error>';
    } catch (error) {
      return error?.message ?? String(error);
    }
  })();
  await authenticated(fixture.owner, 'select public.accept_booking($1::uuid)', [recentlyFundedOldBooking]);
  await authenticated(fixture.owner, 'select public.decline_booking($1::uuid, $2::text)', [ownerDeclineBooking, 'owner decline']);
  const freshReadback = await one(`
    select b.id::text as booking_id, b.status::text as status
      from public.bookings as b where b.id = $1::uuid
  `, [recentlyFundedOldBooking]);
  const ownerDeclineReadback = await one(`
    select b.id::text as booking_id, b.status::text as status
      from public.bookings as b where b.id = $1::uuid
  `, [ownerDeclineBooking]);
  const expiredError = await (async () => {
    try {
      await authenticated(fixture.owner, 'select public.accept_booking($1::uuid)', [expiredOrdinary]);
      return '<no error>';
    } catch (error) {
      return error?.message ?? String(error);
    }
  })();
  await authenticated(fixture.owner, 'select public.accept_booking($1::uuid)', [recurringOccurrence]);
  const recurringReadback = await one(`
    select b.id::text as booking_id, b.status::text as status
      from public.bookings as b where b.id = $1::uuid
  `, [recurringOccurrence]);
  const actual = { managerAccept, managerDecline, freshReadback, ownerDeclineReadback, expiredError, recurringReadback };
  check(
    /only the provider/i.test(managerAccept)
      && /only the provider/i.test(managerDecline)
      && freshReadback?.booking_id === recentlyFundedOldBooking
      && freshReadback.status === 'accepted'
      && ownerDeclineReadback?.booking_id === ownerDeclineBooking
      && ownerDeclineReadback.status === 'declined'
      && /expired|no longer open/i.test(expiredError)
      && recurringReadback?.booking_id === recurringOccurrence
      && recurringReadback.status === 'accepted',
    'old creation time gets a fresh ordinary response window, stale ordinary requests expire, recurring occurrences remain exempt, and only the assigned owner resolves',
    actual,
  );
});

h.finish();

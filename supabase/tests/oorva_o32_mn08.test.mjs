import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const { ok, scenario, finish } = createHarness();
const check = (condition, label, actual) =>
  ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const one = async (query, params = []) => (await db.query(query, params)).rows[0];
const errorMessage = async (fn) => {
  try { await fn(); return null; } catch (error) { return error.message; }
};

let nextSlotDay = 1;
let nextPhone = 1;

async function createFixture() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const customer = randomUUID();
  const provider = randomUUID();
  const admin = randomUUID();
  const other = randomUUID();
  const city = `MN08 City ${suffix}`;
  const category = randomUUID();
  const service = randomUUID();
  const servicePackage = randomUUID();
  const address = randomUUID();

  const phone = () => `+1555${String(nextPhone++).padStart(10, '0')}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb),
           ($3::uuid, $4::text, '{}'::jsonb),
           ($5::uuid, $6::text, '{}'::jsonb),
           ($7::uuid, $8::text, '{}'::jsonb)
  `, [customer, phone(), provider, phone(), admin, phone(), other, phone()]);
  await db.query(`insert into public.admins (user_id) values ($1::uuid)`, [admin]);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended, razorpay_account_id, jobs_completed
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.6, 16.5), 4326),
      'verified', now(), 'approved', true, false, false, $3::text, 0
    )
  `, [provider, city, `acc_mn08_${suffix}`]);
  await db.query(`
    insert into public.categories (
      id, slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::uuid, $2::text, $3::text, 'quote', true, 'time_based', '{}'::jsonb, 1,
      365, true, array['daily','alternate_days','weekly','monthly','custom']::text[], 0
    )
  `, [category, `mn08-${suffix}`, `MN08 Service ${suffix}`]);
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [category, city]);
  await db.query(`
    insert into public.app_config (key, value)
    values ('archetype_flags', '{"time_based":true}'::jsonb)
    on conflict (key) do update
      set value = public.app_config.value || excluded.value
  `);
  await db.query(`
    insert into public.provider_services (id, provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, $3::uuid, 0, 10000, true)
  `, [service, provider, category]);
  await db.query(`
    insert into public.service_packages (
      id, provider_service_id, title, description, price_type, price, price_min, price_max,
      unit, qty_min, qty_max, duration_min, active
    ) values (
      $1::uuid, $2::uuid, 'Two-session pack', '', 'fixed', 20000, 20000, 20000,
      'session', 2, 2, 60, true
    )
  `, [servicePackage, service]);
  await db.query(`
    insert into public.addresses (id, user_id, label, line1, city, lat, lng)
    values ($1::uuid, $2::uuid, 'Home', '1 MN08 Test Road', $3::text, 16.5, 80.6)
  `, [address, customer, city]);
  return {
    customer, provider, admin, other, city, category, service, servicePackage, address,
  };
}

async function createServiceBooking(fixture) {
  const booking = randomUUID();
  const slot = new Date(Date.UTC(2027, 1, nextSlotDay++, 10)).toISOString();
  await db.query(`
    insert into public.bookings (
      id, customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, service_window, status, visit_fee, platform_fee,
      total_amount, archetype, exclusive, session_duration_min, service_package_id,
      commission_bp_snapshot
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
      'MN08 admin projection fixture', $7::timestamptz,
      tstzrange($7::timestamptz, $7::timestamptz + interval '1 hour', '[)'),
      'requested', 0, 0, 10000, 'time_based', true, 60, $8::uuid, 1000
    )
  `, [
    booking, fixture.customer, fixture.provider, fixture.category, fixture.service,
    fixture.address, slot, fixture.servicePackage,
  ]);
  return { id: booking, slot };
}

async function createPayment({
  bookingId = null,
  sportsBookingId = null,
  packPurchaseId = null,
  purpose = 'balance',
  amount,
  status = 'paid',
  fundingSource = 'customer',
  gatewayId = null,
  paidAt = '2030-01-15T10:00:00Z',
}) {
  return (await one(`
    insert into public.payments (
      booking_id, sports_booking_id, pack_purchase_id, purpose, amount, status,
      funding_source, razorpay_payment_id, paid_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::public.payment_purpose, $5::int,
      $6::public.payment_status, $7::text, $8::text, $9::timestamptz
    ) returning id
  `, [
    bookingId, sportsBookingId, packPurchaseId, purpose, amount, status,
    fundingSource, gatewayId, paidAt,
  ])).id;
}

async function createRefund(paymentId, amount, status, processingStartedAt = null) {
  return (await one(`
    insert into public.refunds (payment_id, amount, status, processing_started_at)
    values ($1::uuid, $2::int, $3::public.refund_status, $4::timestamptz)
    returning id
  `, [paymentId, amount, status, processingStartedAt])).id;
}

async function createSportsBooking(fixture) {
  const activity = randomUUID();
  const venue = randomUUID();
  const resource = randomUUID();
  const booking = randomUUID();
  const slot = new Date(Date.UTC(2027, 1, nextSlotDay++, 13)).toISOString();
  await db.query(`
    insert into public.sports_activities (id, slug, name, active)
    values ($1::uuid, $2::text, 'MN08 Activity', true)
  `, [activity, `mn08-${randomUUID().replaceAll('-', '').slice(0, 10)}`]);
  await db.query(`
    insert into public.sports_venues (
      id, owner_id, name, address_line, city, area, lat, lng, status
    ) values (
      $1::uuid, $2::uuid, 'MN08 Venue', '1 Sports Road', $3::text, 'Central',
      16.5, 80.6, 'verified'
    )
  `, [venue, fixture.provider, fixture.city]);
  await db.query(`
    insert into public.sports_resources (id, venue_id, activity_id, name)
    values ($1::uuid, $2::uuid, $3::uuid, 'MN08 Court')
  `, [resource, venue, activity]);
  await db.query(`
    insert into public.sports_bookings (
      id, customer_id, venue_id, resource_id, starts_at, ends_at, status,
      price_paise, expires_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz,
      $5::timestamptz + interval '1 hour', 'accepted', 5000,
      '2030-02-01T10:00:00Z'::timestamptz
    )
  `, [booking, fixture.customer, venue, resource, slot]);
  return booking;
}

async function createPackPurchase(fixture) {
  const pack = randomUUID();
  await db.query(`
    insert into public.pack_purchases (
      id, customer_id, provider_id, provider_service_id, service_package_id,
      sessions_total, price, platform_fee, status, expires_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      2, 20000, 4900, 'active', '2035-01-01T00:00:00Z'::timestamptz
    )
  `, [pack, fixture.customer, fixture.provider, fixture.service, fixture.servicePackage]);
  return pack;
}

async function createPayout(fixture, bookingId, status, createdAt) {
  return (await one(`
    insert into public.payouts (
      booking_id, provider_id, gross, commission, gst_on_commission, amount,
      status, release_after, created_at
    ) values (
      $1::uuid, $2::uuid, 12000, 1200, 216, 10584,
      $3::public.payout_status, '2031-01-01T00:00:00Z'::timestamptz, $4::timestamptz
    ) returning id
  `, [bookingId, fixture.provider, status, createdAt])).id;
}

async function createSportsPayout(fixture, sportsBookingId, status, createdAt) {
  return (await one(`
    insert into public.payouts (
      sports_booking_id, payee_id, gross, commission, gst_on_commission, amount,
      status, release_after, created_at
    ) values (
      $1::uuid, $2::uuid, 5000, 500, 90, 4410,
      $3::public.payout_status, '2031-01-01T00:00:00Z'::timestamptz, $4::timestamptz
    ) returning id
  `, [sportsBookingId, fixture.provider, status, createdAt])).id;
}

async function createTransfer(payoutId, paymentId, {
  status = 'processing',
  lastError = null,
  processingStartedAt,
  rail = 'payouts',
  gatewayStatus = 'processing',
}) {
  return (await one(`
    insert into public.payout_transfers (
      payout_id, source_payment_id, amount, status, attempts, last_error,
      processing_started_at, rail, gateway_status
    ) values (
      $1::uuid, $2::uuid, 10584, $3::public.transfer_status, 1, $4::text,
      $5::timestamptz, $6::text, $7::text
    ) returning id
  `, [payoutId, paymentId, status, lastError, processingStartedAt, rail, gatewayStatus])).id;
}

await scenario('MN-ADMIN-CAPTURE-REFUND-COIN', async () => {
  const fixture = await createFixture();
  const booking = await createServiceBooking(fixture);
  const cashPaymentA = await createPayment({
    bookingId: booking.id, amount: 7000, gatewayId: `pay_mn08_${randomUUID()}`,
  });
  const cashPaymentB = await createPayment({
    bookingId: booking.id, amount: 5000, gatewayId: `pay_mn08_${randomUUID()}`,
  });
  await createPayment({
    bookingId: booking.id, amount: 3000, fundingSource: 'coins',
  });
  await createRefund(cashPaymentA, 1200, 'pending');
  await createRefund(cashPaymentA, 800, 'pending');
  await createRefund(cashPaymentB, 500, 'failed');

  const flagState = await one(`
    with disabled as (
      update public.feature_flags
         set enabled = false
       where left(key, 6) = 'oorva_'
       returning key, enabled
    )
    select jsonb_agg(to_jsonb(disabled) order by key) as flags,
           count(*)::int as count
      from disabled
  `);
  const row = (await as(
    fixture.admin,
    'authenticated',
    `select * from public.admin_list_bookings($1::text, $2::text) where id = $3::uuid`,
    ['all', null, booking.id],
  ))[0];
  const actual = { row, flags: flagState };
  check(
    row
      && row.cash_captured_paise === 12000
      && row.coins_applied_paise === 3000
      && row.demo_captured_paise === 0
      && row.refund_pending_paise === 2000
      && row.refund_processing_paise === 0
      && row.refund_completed_paise === 0
      && row.refund_failed_paise === 500
      && row.net_held_paise === 13000
      && row.paid_paise === 15000
      && flagState.count > 0
      && flagState.flags.every((flag) => flag.enabled === false),
    'Oorva-off booking projection separates funding, refunds and existing net-held arithmetic',
    actual,
  );
});

await scenario('MN-ADMIN-FULL-REFUND-CASH', async () => {
  const fixture = await createFixture();
  const booking = await createServiceBooking(fixture);
  const paymentId = await createPayment({
    bookingId: booking.id,
    amount: 12000,
    status: 'refund_pending',
    gatewayId: `pay_mn08_${randomUUID()}`,
  });
  await createRefund(paymentId, 12000, 'pending');
  const row = (await as(
    fixture.admin,
    'authenticated',
    `select * from public.admin_list_bookings($1::text, $2::text) where id = $3::uuid`,
    ['all', null, booking.id],
  ))[0];
  check(
    row
      && row.cash_captured_paise === 12000
      && row.refund_pending_paise === 12000
      && row.paid_paise === 0
      && row.net_held_paise === 0,
    'full refund reservation retains historical captured cash with separate pending status',
    row,
  );
});

await scenario('MN-ADMIN-DEMO-NOT-CASH', async () => {
  const fixture = await createFixture();
  const demoBooking = await createServiceBooking(fixture);
  await createPayment({
    bookingId: demoBooking.id,
    amount: 2500,
    gatewayId: `pay_demo_mn08_${randomUUID()}`,
  });
  const demoRow = (await as(
    fixture.admin,
    'authenticated',
    `select * from public.admin_list_bookings($1::text, $2::text) where id = $3::uuid`,
    ['all', null, demoBooking.id],
  ))[0];
  check(
    demoRow && demoRow.cash_captured_paise === 0 && demoRow.demo_captured_paise === 2500,
    'demo gateway reference is never labelled as cash',
    demoRow,
  );
});

await scenario('MN-ADMIN-MISSING-GATEWAY-REF', async () => {
  const fixture = await createFixture();
  const noReferenceBooking = await createServiceBooking(fixture);
  await createPayment({
    bookingId: noReferenceBooking.id,
    amount: 4000,
    gatewayId: null,
  });
  const noReferenceRow = (await as(
    fixture.admin,
    'authenticated',
    `select * from public.admin_list_bookings($1::text, $2::text) where id = $3::uuid`,
    ['all', null, noReferenceBooking.id],
  ))[0];
  check(
    noReferenceRow && noReferenceRow.cash_captured_paise === 0 && noReferenceRow.paid_paise === 4000,
    'customer payment without a gateway reference stays out of cash-captured projection',
    noReferenceRow,
  );
});

await scenario('MN-ADMIN-REFUND-PROCESSING', async () => {
  const fixture = await createFixture();
  const processingBooking = await createServiceBooking(fixture);
  const processingPayment = await createPayment({
    bookingId: processingBooking.id,
    amount: 4500,
    status: 'refund_processing',
    gatewayId: `pay_mn08_${randomUUID()}`,
  });
  await createRefund(processingPayment, 4500, 'processing');
  const processingRow = (await as(
    fixture.admin,
    'authenticated',
    `select * from public.admin_list_bookings($1::text, $2::text) where id = $3::uuid`,
    ['all', null, processingBooking.id],
  ))[0];
  check(
    processingRow
      && processingRow.cash_captured_paise === 4500
      && processingRow.refund_processing_paise === 4500,
    'processing refund retains captured cash and its separate refund bucket',
    processingRow,
  );
});

await scenario('MN-ADMIN-REFUND-COMPLETED', async () => {
  const fixture = await createFixture();
  const completedBooking = await createServiceBooking(fixture);
  const completedPayment = await createPayment({
    bookingId: completedBooking.id,
    amount: 6000,
    status: 'refunded',
    gatewayId: `pay_mn08_${randomUUID()}`,
  });
  await createRefund(completedPayment, 6000, 'refunded');
  const completedRow = (await as(
    fixture.admin,
    'authenticated',
    `select * from public.admin_list_bookings($1::text, $2::text) where id = $3::uuid`,
    ['all', null, completedBooking.id],
  ))[0];
  check(
    completedRow
      && completedRow.cash_captured_paise === 6000
      && completedRow.refund_completed_paise === 6000
      && completedRow.net_held_paise === 0,
    'completed refund remains separate from original captured cash',
    completedRow,
  );
});

await scenario('MN-ADMIN-PARENT-XOR', async () => {
  const fixture = await createFixture();
  const serviceBooking = await createServiceBooking(fixture);
  const servicePayment = await createPayment({
    bookingId: serviceBooking.id,
    amount: 7000,
    gatewayId: `pay_mn08_${randomUUID()}`,
  });
  const sportsBookingId = await createSportsBooking(fixture);
  const sportsPayment = await createPayment({
    sportsBookingId,
    amount: 5000,
    gatewayId: `pay_mn08_${randomUUID()}`,
  });
  const packPurchaseId = await createPackPurchase(fixture);
  const packPayment = await createPayment({
    packPurchaseId,
    purpose: 'package',
    amount: 24900,
    gatewayId: `pay_mn08_${randomUUID()}`,
  });
  await db.query(
    `update public.pack_purchases set payment_id = $1::uuid where id = $2::uuid`,
    [packPayment, packPurchaseId],
  );
  const refundIds = {
    service: await createRefund(servicePayment, 1000, 'failed'),
    sports: await createRefund(sportsPayment, 1000, 'failed'),
    pack: await createRefund(packPayment, 1000, 'failed'),
  };
  const sportsPayoutId = await createSportsPayout(
    fixture, sportsBookingId, 'pending', '2030-01-01T10:00:00Z',
  );
  const sportsTransferId = await createTransfer(sportsPayoutId, sportsPayment, {
    status: 'failed',
    lastError: 'sports gateway failure',
    processingStartedAt: null,
    gatewayStatus: 'failed',
  });
  const data = (await as(
    fixture.admin,
    'authenticated',
    `select public.admin_list_stuck_money() as data`,
  ))[0].data;
  const refundRows = Object.fromEntries(data.refunds.map((refund) => [refund.refund_id, refund]));
  const transferRows = Object.fromEntries(data.transfers.map((transfer) => [transfer.transfer_id, transfer]));
  const actual = {
    service: refundRows[refundIds.service],
    sports: refundRows[refundIds.sports],
    pack: refundRows[refundIds.pack],
    sportsTransfer: transferRows[sportsTransferId],
  };
  check(
    actual.service?.booking_id === serviceBooking.id
      && actual.service?.sports_booking_id === null
      && actual.service?.pack_purchase_id === null
      && actual.sports?.booking_id === null
      && actual.sports?.sports_booking_id === sportsBookingId
      && actual.sports?.pack_purchase_id === null
      && actual.pack?.booking_id === null
      && actual.pack?.sports_booking_id === null
      && actual.pack?.pack_purchase_id === packPurchaseId
      && actual.sportsTransfer?.booking_id === null
      && actual.sportsTransfer?.sports_booking_id === sportsBookingId
      && actual.sportsTransfer?.pack_purchase_id === null
      && actual.sportsTransfer?.rail === 'payouts'
      && actual.sportsTransfer?.gateway_status === 'failed',
    'stuck money parents preserve service, sports and pack identity without cross-routing',
    actual,
  );

  const problemPayouts = (await as(
    fixture.admin,
    'authenticated',
    `select public.admin_list_problem_payouts() as data`,
  ))[0].data.payouts;
  const sportsProblem = problemPayouts.find((payout) => payout.id === sportsPayoutId);
  check(
    sportsProblem?.sports_booking_id === sportsBookingId
      && sportsProblem?.transfers.some((transfer) =>
        transfer.id === sportsTransferId && transfer.sports_booking_id === sportsBookingId),
    'problem payout transfer retains its sports parent identity',
    { sportsPayoutId, sportsBookingId, sportsTransferId, sportsProblem },
  );

});

await scenario('MN-ADMIN-STALE-TRANSFER-READ-ONLY', async () => {
  const fixture = await createFixture();
  const staleBooking = await createServiceBooking(fixture);
  const freshBooking = await createServiceBooking(fixture);
  const errorBooking = await createServiceBooking(fixture);
  const failedBooking = await createServiceBooking(fixture);
  const stalePayment = await createPayment({
    bookingId: staleBooking.id, amount: 12000, gatewayId: `pay_mn08_${randomUUID()}`,
  });
  const freshPayment = await createPayment({
    bookingId: freshBooking.id, amount: 12000, gatewayId: `pay_mn08_${randomUUID()}`,
  });
  const errorPayment = await createPayment({
    bookingId: errorBooking.id, amount: 12000, gatewayId: `pay_mn08_${randomUUID()}`,
  });
  const stalePayout = await createPayout(fixture, staleBooking.id, 'pending', '2030-01-01T10:00:00Z');
  const freshPayout = await createPayout(fixture, freshBooking.id, 'pending', '2030-01-02T10:00:00Z');
  const errorPayout = await createPayout(fixture, errorBooking.id, 'pending', '2030-01-03T10:00:00Z');
  const failedPayout = await createPayout(fixture, failedBooking.id, 'failed', '2030-01-04T10:00:00Z');
  const staleStartedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  const freshStartedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const staleTransfer = await createTransfer(stalePayout, stalePayment, {
    processingStartedAt: staleStartedAt, rail: 'payouts', gatewayStatus: 'processing',
  });
  const freshTransfer = await createTransfer(freshPayout, freshPayment, {
    processingStartedAt: freshStartedAt,
  });
  const errorTransfer = await createTransfer(errorPayout, errorPayment, {
    processingStartedAt: freshStartedAt, lastError: 'gateway timeout',
  });

  const data = (await as(
    fixture.admin,
    'authenticated',
    `select public.admin_list_problem_payouts() as data`,
  ))[0].data;
  const ids = data.payouts.map((payout) => payout.id);
  const byId = Object.fromEntries(data.payouts.map((payout) => [payout.id, payout]));
  const staleRow = byId[stalePayout];
  const actual = {
    payoutIds: ids,
    stale: staleRow,
    fresh: byId[freshPayout] ?? null,
    error: byId[errorPayout],
    failed: byId[failedPayout],
    transferIds: { staleTransfer, freshTransfer, errorTransfer },
    timestamps: { staleStartedAt, freshStartedAt },
  };
  check(
    ids.includes(stalePayout)
      && !ids.includes(freshPayout)
      && ids.includes(errorPayout)
      && ids.includes(failedPayout)
      && staleRow?.transfers.some((transfer) =>
        transfer.id === staleTransfer
        && Date.parse(transfer.processing_started_at) === Date.parse(staleStartedAt)
        && transfer.booking_id === staleBooking.id
        && transfer.sports_booking_id === null
        && transfer.rail === 'payouts'
        && transfer.gateway_status === 'processing')
      && byId[errorPayout]?.transfers.some((transfer) => transfer.last_error === 'gateway timeout'),
    'problem payouts include stale null-error and existing error/failed rows but omit fresh processing',
    actual,
  );

  const stuck = (await as(
    fixture.admin,
    'authenticated',
    `select public.admin_list_stuck_money() as data`,
  ))[0].data;
  const stuckTransfer = stuck.transfers.find((transfer) => transfer.transfer_id === staleTransfer);
  check(
    stuckTransfer
      && stuckTransfer.booking_id === staleBooking.id
      && Date.parse(stuckTransfer.processing_started_at) === Date.parse(staleStartedAt)
      && stuckTransfer.rail === 'payouts'
      && stuckTransfer.gateway_status === 'processing',
    'stuck transfer projection includes parent and read-only processing diagnostics',
    { stuckTransfer, staleBookingId: staleBooking.id, staleStartedAt },
  );
});

await scenario('MN-ROLES-SAME-PK', async () => {
  const fixture = await createFixture();
  const booking = await createServiceBooking(fixture);
  const adminRows = await as(
    fixture.admin,
    'authenticated',
    `select * from public.admin_list_bookings($1::text, $2::text) where id = $3::uuid`,
    ['all', null, booking.id],
  );
  const deniedBookings = await errorMessage(() => as(
    fixture.other,
    'authenticated',
    `select * from public.admin_list_bookings($1::text, $2::text) where id = $3::uuid`,
    ['all', null, booking.id],
  ));
  const deniedStuck = await errorMessage(() => as(
    fixture.other, 'authenticated', `select public.admin_list_stuck_money()`,
  ));
  const deniedPayouts = await errorMessage(() => as(
    fixture.other, 'authenticated', `select public.admin_list_problem_payouts()`,
  ));
  const actual = { adminRows, deniedBookings, deniedStuck, deniedPayouts, bookingId: booking.id };
  check(
    adminRows.some((row) => row.id === booking.id)
      && /admin only/i.test(deniedBookings ?? '')
      && /admin only/i.test(deniedStuck ?? '')
      && /admin only/i.test(deniedPayouts ?? ''),
    'admin money reads return the target row only to an authorized admin',
    actual,
  );
});

await scenario('MN-PAYOUT-RETRY-GUARDS', async () => {
  const fixture = await createFixture();
  const staleBooking = await createServiceBooking(fixture);
  const failedProcessingBooking = await createServiceBooking(fixture);
  const failedChildBooking = await createServiceBooking(fixture);
  const stalePayment = await createPayment({
    bookingId: staleBooking.id, amount: 12000, gatewayId: `pay_mn08_${randomUUID()}`,
  });
  const failedProcessingPayment = await createPayment({
    bookingId: failedProcessingBooking.id, amount: 12000, gatewayId: `pay_mn08_${randomUUID()}`,
  });
  const failedChildPayment = await createPayment({
    bookingId: failedChildBooking.id, amount: 12000, gatewayId: `pay_mn08_${randomUUID()}`,
  });
  const stalePayout = await createPayout(fixture, staleBooking.id, 'pending', '2030-01-01T10:00:00Z');
  const failedProcessingPayout = await createPayout(
    fixture, failedProcessingBooking.id, 'failed', '2030-01-02T10:00:00Z',
  );
  const failedChildPayout = await createPayout(
    fixture, failedChildBooking.id, 'failed', '2030-01-03T10:00:00Z',
  );
  const staleTransfer = await createTransfer(stalePayout, stalePayment, {
    processingStartedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
  });
  const processingTransfer = await createTransfer(failedProcessingPayout, failedProcessingPayment, {
    processingStartedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
  });
  const failedTransfer = await createTransfer(failedChildPayout, failedChildPayment, {
    status: 'failed',
    lastError: 'gateway declined',
    processingStartedAt: null,
    gatewayStatus: 'failed',
  });
  const deniedPendingParent = await errorMessage(() => as(
    fixture.admin,
    'authenticated',
    `select public.admin_retry_payout($1::uuid, $2::text)`,
    [stalePayout, 'MN08 stale read-only eligibility check'],
  ));
  const deniedProcessingChild = await errorMessage(() => as(
    fixture.admin,
    'authenticated',
    `select public.admin_retry_payout($1::uuid, $2::text)`,
    [failedProcessingPayout, 'MN08 processing child eligibility check'],
  ));
  const retryResult = (await as(
    fixture.admin,
    'authenticated',
    `select public.admin_retry_payout($1::uuid, $2::text) as result`,
    [failedChildPayout, 'MN08 failed parent and child eligibility check'],
  ))[0].result;
  const afterRetry = await one(`
    select po.status::text as payout_status, t.status::text as transfer_status
      from public.payouts po
      join public.payout_transfers t on t.payout_id = po.id
     where po.id = $1::uuid and t.id = $2::uuid
  `, [failedChildPayout, failedTransfer]);
  const actual = {
    deniedPendingParent,
    deniedProcessingChild,
    retryResult,
    afterRetry,
    payoutIds: { stalePayout, failedProcessingPayout, failedChildPayout },
    transferIds: { staleTransfer, processingTransfer, failedTransfer },
  };
  check(
    /only a failed payout/i.test(deniedPendingParent ?? '')
      && /no failed transfer/i.test(deniedProcessingChild ?? '')
      && retryResult?.payout_id === failedChildPayout
      && retryResult?.status === 'pending'
      && afterRetry?.payout_status === 'pending'
      && afterRetry?.transfer_status === 'pending',
    'retry remains restricted to a failed payout with a failed transfer',
    actual,
  );
});

finish();

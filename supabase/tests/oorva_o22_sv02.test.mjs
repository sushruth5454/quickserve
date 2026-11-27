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
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const authenticated = (userId, sql, params = []) => as(userId, 'authenticated', sql, params);
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const sameJson = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

async function enableFixtureFeatures(archetype) {
  await db.query("update public.feature_flags set enabled = true where key = 'merchant_staff'");
  await db.query(`
    update public.app_config
       set value = value || jsonb_build_object($1::text, true::boolean)
     where key = 'archetype_flags'
  `, [archetype]);
}

async function makeUser(label) {
  const id = randomUUID();
  const phone = `+1555${randomUUID().replace(/\D/g, '').slice(0, 10)}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, phone]);
  await db.query(
    'update public.profiles set full_name = $2::text where id = $1::uuid',
    [id, `O22 ${label}`],
  );
  return id;
}

async function makeFixture(label, archetype) {
  await enableFixtureFeatures(archetype);
  const actors = {
    customer: await makeUser(`${label}-customer`),
    owner: await makeUser(`${label}-owner`),
    manager: await makeUser(`${label}-manager`),
    staff: await makeUser(`${label}-staff`),
  };
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values
      ($1::uuid, $2::uuid, 'manager', true),
      ($1::uuid, $3::uuid, 'staff', true)
  `, [actors.owner, actors.manager, actors.staff]);

  const city = `O22 ${label} City`;
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended
    ) values (
      $1::uuid, $2::text,
      extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', now(), 'approved', true, false, false
    )
  `, [actors.owner, city]);
  const categoryId = (await one(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, location_modes, pricing_units,
      min_lead_hours, max_lead_days, restricted
    ) values (
      $1::text, $2::text, $3::public.pricing_mode, true, $4::text,
      array['at_customer']::text[], array['job']::text[], 0, 365, false
    )
    returning id
  `, [
    `o22-${randomUUID().replace(/-/g, '')}`,
    `O22 ${label}`,
    archetype === 'fixed' ? 'fixed' : 'quote',
    archetype,
  ])).id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [categoryId, city]);
  const serviceId = (await one(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0::int, 0::int, true)
    returning id
  `, [actors.owner, categoryId])).id;
  await db.query(`
    insert into public.provider_availability (provider_id, weekday, start_time, end_time)
    select $1::uuid, day::int, time '00:00', time '23:59'
      from generate_series(0, 6) day
  `, [actors.owner]);
  const addressId = (await one(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Home', $2::text, $3::text, 16.50::double precision, 80.60::double precision)
    returning id
  `, [actors.customer, `O22 ${label} Road`, city])).id;
  let packageId = null;
  if (archetype === 'fixed') {
    packageId = (await one(`
      insert into public.service_packages (
        provider_service_id, title, description, price_type, price, price_min, price_max,
        unit, qty_min, qty_max, duration_min, inclusions, active
      ) values (
        $1::uuid, 'Deep clean', 'Base package', 'fixed', 12000::int, 12000::int, 12000::int,
        'job', 1::numeric, 1::numeric, 90::int, array['Kitchen']::text[], true
      )
      returning id
    `, [serviceId])).id;
  }
  return { ...actors, categoryId, serviceId, addressId, packageId, city, archetype };
}

async function makeBooking(fixture, { status, origin = 'marketplace', day }) {
  const start = `${day}T10:00:00+05:30`;
  const end = `${day}T12:00:00+05:30`;
  const platformFee = fixture.archetype === 'fixed' ? 2900 : 0;
  const sessionDuration = fixture.archetype === 'time_based' ? 60 : null;
  return (await one(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, service_window, status, visit_fee, platform_fee, total_amount,
      archetype, booking_origin, service_package_id, session_duration_min
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      'O22 quote fixture', $6::timestamptz, tstzrange($6::timestamptz, $7::timestamptz, '[)'),
      $8::public.booking_status, 0::int, $9::int, $10::int,
      $11::text, $12::text, $13::uuid, $14::int
    )
    returning id
  `, [
    fixture.customer, fixture.owner, fixture.categoryId, fixture.serviceId, fixture.addressId,
    start, end, status, platformFee, fixture.archetype === 'fixed' ? 14900 : 0,
    fixture.archetype, origin, null, sessionDuration,
  ])).id;
}

async function makeQuote({
  bookingId,
  version,
  total,
  status = 'sent',
  changeOrder = false,
  type = 'itemized',
  sourcePackageId = null,
  snapshot = {},
  coinDiscount = 0,
  coinFunder = null,
  subtotalLabour = total,
  subtotalOther = 0,
}) {
  return (await one(`
    insert into public.quotes (
      booking_id, version, status, is_change_order, subtotal_labour, subtotal_parts,
      subtotal_other, subtotal_commissionable, total, note, quote_type, source_package_id,
      package_snapshot, coin_discount, coin_discount_funder
    ) values (
      $1::uuid, $2::int, $3::public.quote_status, $4::boolean, $5::int, 0::int,
      $6::int, $5::int, $7::int, 'O22 test quote', $8::text, $9::uuid,
      $10::jsonb, $11::int, $12::text
    )
    returning id
  `, [
    bookingId, version, status, changeOrder, subtotalLabour, subtotalOther, total,
    type, sourcePackageId, JSON.stringify(snapshot), coinDiscount, coinFunder,
  ])).id;
}

async function makeItem(quoteId, { kind = 'labour', title, qty = 1, unit = null, unitPrice }) {
  return one(`
    insert into public.quote_items (quote_id, kind, title, qty, unit, unit_price)
    values ($1::uuid, $2::public.quote_item_kind, $3::text, $4::numeric, $5::text, $6::int)
    returning id
  `, [quoteId, kind, title, qty, unit, unitPrice]);
}

async function setApprovedQuote(bookingId, quoteId, total, coinDiscount = 0) {
  await db.query(`
    update public.bookings
       set approved_quote_id = $1::uuid, total_amount = $2::int, coin_discount = $3::int
     where id = $4::uuid
  `, [quoteId, total, coinDiscount, bookingId]);
}

async function makePaidPayment(bookingId, quoteId, amount, purpose = 'balance', fundingSource = 'customer') {
  return (await one(`
    insert into public.payments (
      booking_id, quote_id, purpose, amount, status, funding_source,
      paid_at, razorpay_payment_id
    ) values (
      $1::uuid, $2::uuid, $3::public.payment_purpose, $4::int,
      'paid'::public.payment_status, $5::text, now(), $6::text
    )
    returning id
  `, [bookingId, quoteId, purpose, amount, fundingSource, fundingSource === 'customer' ? `pay-${randomUUID()}` : null])).id;
}

async function sendQuote(userId, bookingId, items, note = 'O22 revision') {
  return (await authenticated(userId, `
    select public.send_quote($1::uuid, $2::jsonb, $3::text) as id
  `, [bookingId, JSON.stringify(items), note]))[0].id;
}

async function failure(action) {
  try {
    await action();
    return '<no error>';
  } catch (error) {
    return error?.message ?? String(error);
  }
}

await h.scenario('SV-QUOTE-FAMILY-01-fixed-addon-preserves-package-and-creates-obligation-on-approval', async () => {
  const fixture = await makeFixture('fixed-addon', 'fixed');
  const bookingId = await makeBooking(fixture, { status: 'in_progress', day: '2027-01-15' });
  const snapshot = { title: 'Deep clean', quantity: 1, unit_price: 12000, inclusions: ['Kitchen'] };
  const baseQuoteId = await makeQuote({
    bookingId,
    version: 1,
    total: 12000,
    status: 'approved',
    type: 'package',
    sourcePackageId: fixture.packageId,
    snapshot,
    subtotalLabour: 12000,
  });
  await makeItem(baseQuoteId, { kind: 'package', title: 'Deep clean', unit: 'job', unitPrice: 12000 });
  await setApprovedQuote(bookingId, baseQuoteId, 14900);
  await makePaidPayment(bookingId, baseQuoteId, 14900, 'package');

  const before = await one(`
    select q.version, q.total, q.package_snapshot,
           (select count(*)::int from public.quote_items qi where qi.quote_id = q.id) as item_count,
           (select count(*)::int from public.payment_schedule ps where ps.booking_id = q.booking_id) as schedule_count
      from public.quotes q where q.id = $1::uuid
  `, [baseQuoteId]);
  const addonQuoteId = await (async () => (
    await authenticated(fixture.manager, `
      select public.send_fixed_addons($1::uuid, $2::jsonb, $3::text) as id
    `, [bookingId, JSON.stringify([{ title: 'Extra room', qty: 1, unit: 'room', unit_price: 3500 }]), 'Extra room'])
  )[0].id)();
  const sentQuote = await one(`
    select version, status, is_change_order, quote_type, source_package_id, package_snapshot, total
      from public.quotes where id = $1::uuid
  `, [addonQuoteId]);
  const copiedItems = (await db.query(`
    select kind, title, qty, unit, unit_price
      from public.quote_items
     where quote_id = $1::uuid
     order by case when kind = 'package' then 0 else 1 end, title
  `, [addonQuoteId])).rows;
  const scheduleBeforeApproval = (await db.query(`
    select obligation_type, amount, status
      from public.payment_schedule where booking_id = $1::uuid
  `, [bookingId])).rows;
  const approval = (await authenticated(fixture.customer, `
    select public.approve_fixed_change_order($1::uuid, $2::uuid) as result
  `, [bookingId, addonQuoteId]))[0].result;
  const scheduleAfterApproval = (await db.query(`
    select obligation_type, amount, status
      from public.payment_schedule where booking_id = $1::uuid
  `, [bookingId])).rows;
  const baseAfter = await one(`
    select q.version, q.total, q.package_snapshot,
           (select count(*)::int from public.quote_items qi where qi.quote_id = q.id) as item_count
      from public.quotes q where q.id = $1::uuid
  `, [baseQuoteId]);
  const addonAfter = await one(`
    select status from public.quotes where id = $1::uuid
  `, [addonQuoteId]);
  const actual = {
    before,
    sentQuote,
    copiedItems,
    scheduleBeforeApproval,
    approval,
    scheduleAfterApproval,
    baseAfter,
    addonAfter,
  };

  check(before.item_count === 1 && before.schedule_count === 0,
    'fixed package starts with its immutable base and no add-on obligation', actual);
  check(sentQuote.version === 2 && sentQuote.status === 'sent' && sentQuote.is_change_order
      && sentQuote.quote_type === 'package' && sentQuote.source_package_id === fixture.packageId
      && sameJson(sentQuote.package_snapshot, snapshot) && sentQuote.total === 15500,
    'fixed add-on quote increments version and copies the original package snapshot', actual);
  check(copiedItems.length === 2 && copiedItems[0].kind === 'package'
      && copiedItems[0].title === 'Deep clean' && copiedItems[1].kind === 'addon'
      && copiedItems[1].title === 'Extra room' && copiedItems[1].unit_price === 3500,
    'fixed add-on quote preserves package lines and appends only the positive add-on', actual);
  check(scheduleBeforeApproval.length === 0 && approval.amount_due === 3500,
    'no add-on obligation exists before customer approval and approval computes only the delta', actual);
  check(scheduleAfterApproval.length === 1 && scheduleAfterApproval[0].obligation_type === 'addon'
      && scheduleAfterApproval[0].amount === 3500 && scheduleAfterApproval[0].status === 'due'
      && addonAfter.status === 'approved_pending_payment'
      && baseAfter.version === 1 && baseAfter.total === 12000
      && sameJson(baseAfter.package_snapshot, snapshot) && baseAfter.item_count === 1,
    'customer approval creates one due add-on obligation without changing the accepted package', actual);
});

await h.scenario('SV-QUOTE-GUARD-02-owner-manager-access-and-stale-link-close', async () => {
  const fixture = await makeFixture('inspect-roles', 'inspect_quote');
  const bookingId = await makeBooking(fixture, { status: 'inspecting', day: '2027-01-16' });
  const firstQuoteId = await sendQuote(fixture.owner, bookingId, [
    { kind: 'labour', title: 'Initial inspection', qty: 1, unit_price: 10000 },
  ]);
  const staleLink = `o22-stale-${randomUUID()}`;
  await db.query(`
    insert into public.payments (
      booking_id, quote_id, purpose, amount, status, razorpay_link_id, short_url
    ) values (
      $1::uuid, $2::uuid, 'balance'::public.payment_purpose, 10000::int,
      'created'::public.payment_status, $3::text, 'https://example.invalid/quote'
    )
  `, [bookingId, firstQuoteId, staleLink]);
  const secondQuoteId = await sendQuote(fixture.manager, bookingId, [
    { kind: 'labour', title: 'Revised full scope', qty: 1, unit_price: 12000 },
  ]);
  const customerError = await failure(() => sendQuote(fixture.customer, bookingId, [
    { kind: 'labour', title: 'Customer attempt', qty: 1, unit_price: 1 },
  ]));
  const staffError = await failure(() => sendQuote(fixture.staff, bookingId, [
    { kind: 'labour', title: 'Staff attempt', qty: 1, unit_price: 1 },
  ]));
  const state = await one(`
    select (select count(*)::int from public.quotes where booking_id = $1::uuid) as quote_count,
           (select status from public.quotes where id = $2::uuid) as first_status,
           (select status from public.quotes where id = $3::uuid) as second_status,
           (select status from public.payments where razorpay_link_id = $4::text) as payment_status,
           (select cancel_link_pending from public.payments where razorpay_link_id = $4::text) as cancel_link_pending
  `, [bookingId, firstQuoteId, secondQuoteId, staleLink]);
  const actual = { customerError, staffError, state };
  check(customerError !== '<no error>' && /manager role required/i.test(customerError)
      && staffError !== '<no error>' && /manager role required/i.test(staffError),
    'customer and staff cannot send generic quotes', actual);
  check(state.quote_count === 2 && state.first_status === 'superseded'
      && state.second_status === 'sent' && state.payment_status === 'failed'
      && state.cancel_link_pending === true,
    'owner and manager sends remain allowed and replacing a quote safely closes its stale payment link', actual);
});

await h.scenario('SV-QUOTE-COINS-03-inspect-positive-delta-preserves-existing-coins', async () => {
  const fixture = await makeFixture('inspect-coins', 'inspect_quote');
  const bookingId = await makeBooking(fixture, { status: 'in_progress', day: '2027-01-17' });
  const baseQuoteId = await makeQuote({
    bookingId,
    version: 1,
    total: 10000,
    status: 'approved',
    subtotalLabour: 10000,
  });
  await makeItem(baseQuoteId, { title: 'Approved full scope', unitPrice: 10000 });
  await setApprovedQuote(bookingId, baseQuoteId, 10000);
  await makePaidPayment(bookingId, baseQuoteId, 10000);
  const nextQuoteId = await sendQuote(fixture.owner, bookingId, [
    { kind: 'labour', title: 'Revised full scope', qty: 1, unit_price: 12000 },
  ]);
  await db.query(`
    update public.quotes
       set coin_discount = 1000, coin_discount_funder = 'platform'
     where id = $1::uuid
  `, [nextQuoteId]);
  await db.query(`
    update public.bookings set coin_discount = 1000 where id = $1::uuid
  `, [bookingId]);
  await makePaidPayment(bookingId, nextQuoteId, 1000, 'balance', 'coins');

  const approval = (await authenticated(fixture.customer, `
    select public.approve_quote_with_coins($1::uuid, $2::uuid, true) as result
  `, [bookingId, nextQuoteId]))[0].result;
  const result = await one(`
    select b.status as booking_status, b.approved_quote_id, b.coin_discount,
           q.status as quote_status, q.total,
           (select count(*)::int from public.payments p
             where p.booking_id = b.id and p.funding_source = 'coins' and p.status = 'paid') as coin_payments
      from public.bookings b
      join public.quotes q on q.id = $2::uuid
     where b.id = $1::uuid
  `, [bookingId, nextQuoteId]);
  const actual = { approval, result };
  check(approval.amount_due === 1000 && approval.coins_redeemed_paise === 1000,
    'inspect itemized approval keeps the existing coin redemption and charges only the positive difference', actual);
  check(result.booking_status === 'in_progress' && result.approved_quote_id === baseQuoteId
      && result.coin_discount === 1000 && result.quote_status === 'approved_pending_payment'
      && result.total === 12000 && result.coin_payments === 1,
    'positive inspect change order retains its pending state and does not redeem coins twice', actual);
});

await h.scenario('SV-QUOTE-COINS-03-inspect-reduction-queues-only-the-overpayment-refund', async () => {
  const fixture = await makeFixture('inspect-reduction', 'inspect_quote');
  const bookingId = await makeBooking(fixture, { status: 'in_progress', day: '2027-01-22' });
  const baseQuoteId = await makeQuote({
    bookingId,
    version: 1,
    total: 10000,
    status: 'approved',
    subtotalLabour: 10000,
  });
  await makeItem(baseQuoteId, { title: 'Approved full scope', unitPrice: 10000 });
  await setApprovedQuote(bookingId, baseQuoteId, 10000);
  await makePaidPayment(bookingId, baseQuoteId, 10000);
  const reducedQuoteId = await sendQuote(fixture.manager, bookingId, [
    { kind: 'labour', title: 'Reduced full scope', qty: 1, unit_price: 8000 },
  ]);
  const approval = (await authenticated(fixture.customer, `
    select public.approve_quote_with_coins($1::uuid, $2::uuid, false) as result
  `, [bookingId, reducedQuoteId]))[0].result;
  const result = await one(`
    select b.approved_quote_id, b.refund_amount, q.status as quote_status,
           (select coalesce(sum(r.amount), 0)::int
              from public.refunds r join public.payments p on p.id = r.payment_id
             where p.booking_id = b.id and r.status <> 'failed') as refund_rows
      from public.bookings b
      join public.quotes q on q.id = $2::uuid
     where b.id = $1::uuid
  `, [bookingId, reducedQuoteId]);
  const actual = { approval, result };
  check(approval.amount_due === 0 && result.approved_quote_id === reducedQuoteId
      && result.quote_status === 'approved' && result.refund_amount === 2000
      && result.refund_rows === 2000,
    'inspect reduction activates the revised full scope and queues only its 2000-paise overpayment refund', actual);
});

await h.scenario('SV-QUOTE-BYO-04-explicit-byo-itemized-agreement-route', async () => {
  const fixture = await makeFixture('byo-itemized', 'fixed');
  const bookingId = await makeBooking(fixture, {
    status: 'in_progress',
    origin: 'byo',
    day: '2027-01-18',
  });
  const agreementId = await makeQuote({
    bookingId,
    version: 1,
    total: 8000,
    status: 'approved',
    type: 'itemized',
    subtotalLabour: 8000,
  });
  await makeItem(agreementId, { title: 'Existing BYO agreement', unitPrice: 8000 });
  await setApprovedQuote(bookingId, agreementId, 8000);
  await makePaidPayment(bookingId, agreementId, 8000);
  const revisedId = await sendQuote(fixture.manager, bookingId, [
    { kind: 'labour', title: 'Full revised BYO scope', qty: 1, unit_price: 9000 },
  ]);
  const approval = (await authenticated(fixture.customer, `
    select public.approve_quote_with_coins($1::uuid, $2::uuid, false) as result
  `, [bookingId, revisedId]))[0].result;
  const revised = await one(`
    select version, status, is_change_order, quote_type, total
      from public.quotes where id = $1::uuid
  `, [revisedId]);
  const revisedItems = (await db.query(`
    select title, kind, unit_price from public.quote_items where quote_id = $1::uuid
  `, [revisedId])).rows;
  const actual = { bookingOrigin: 'byo', approval, revised, revisedItems };
  check(revised.version === 2 && revised.status === 'approved_pending_payment'
      && revised.is_change_order && revised.quote_type === 'itemized' && revised.total === 9000
      && revisedItems.length === 1 && revisedItems[0].title === 'Full revised BYO scope'
      && approval.amount_due === 1000,
    'BYO itemized agreement remains explicitly supported as a full-scope revision', actual);
});

for (const [archetype, day] of [
  ['fixed', '2027-01-19'],
  ['proposal', '2027-01-20'],
  ['time_based', '2027-01-21'],
]) {
  await h.scenario(`SV-QUOTE-GUARD-02-${archetype}-generic-rpcs-fail-atomically`, async () => {
    const fixture = await makeFixture(`unsupported-${archetype}`, archetype);
    const bookingId = await makeBooking(fixture, { status: 'in_progress', day });
    let approvedPackageId = null;
    if (archetype === 'fixed') {
      approvedPackageId = await makeQuote({
        bookingId,
        version: 1,
        total: 12000,
        status: 'approved',
        type: 'package',
        sourcePackageId: fixture.packageId,
        snapshot: { title: 'Deep clean', quantity: 1, unit_price: 12000 },
        subtotalLabour: 12000,
      });
      await makeItem(approvedPackageId, { kind: 'package', title: 'Deep clean', unit: 'job', unitPrice: 12000 });
      await setApprovedQuote(bookingId, approvedPackageId, 14900);
    }
    const openQuoteId = await makeQuote({
      bookingId,
      version: archetype === 'fixed' ? 2 : 1,
      total: 10000,
      status: 'sent',
      changeOrder: true,
      type: 'itemized',
    });
    const before = await one(`
      select b.status as booking_status, b.approved_quote_id, b.coin_discount,
             q.status as quote_status, q.coin_discount as quote_coin_discount,
             (select count(*)::int from public.quotes x where x.booking_id = b.id) as quote_count,
             (select count(*)::int from public.payments p where p.booking_id = b.id) as payment_count,
             (select count(*)::int from public.payment_schedule ps where ps.booking_id = b.id) as schedule_count,
             (select count(*)::int from public.refunds r join public.payments p on p.id = r.payment_id
               where p.booking_id = b.id) as refund_count,
             (select count(*)::int from public.coin_ledger l where l.user_id = b.customer_id) as ledger_count
        from public.bookings b join public.quotes q on q.id = $2::uuid
       where b.id = $1::uuid
    `, [bookingId, openQuoteId]);
    const sendError = await failure(() => sendQuote(fixture.owner, bookingId, [
      { kind: 'labour', title: 'Unsupported replacement', qty: 1, unit_price: 11000 },
    ]));
    const approveDirectError = await failure(() => authenticated(fixture.customer, `
      select public.approve_quote($1::uuid, $2::uuid)
    `, [bookingId, openQuoteId]));
    const approveError = await failure(() => authenticated(fixture.customer, `
      select public.approve_quote_with_coins($1::uuid, $2::uuid, true)
    `, [bookingId, openQuoteId]));
    const rejectError = await failure(() => authenticated(fixture.customer, `
      select public.reject_quote($1::uuid, $2::uuid)
    `, [bookingId, openQuoteId]));
    const after = await one(`
      select b.status as booking_status, b.approved_quote_id, b.coin_discount,
             q.status as quote_status, q.coin_discount as quote_coin_discount,
             (select count(*)::int from public.quotes x where x.booking_id = b.id) as quote_count,
             (select count(*)::int from public.payments p where p.booking_id = b.id) as payment_count,
             (select count(*)::int from public.payment_schedule ps where ps.booking_id = b.id) as schedule_count,
             (select count(*)::int from public.refunds r join public.payments p on p.id = r.payment_id
               where p.booking_id = b.id) as refund_count,
             (select count(*)::int from public.coin_ledger l where l.user_id = b.customer_id) as ledger_count
        from public.bookings b join public.quotes q on q.id = $2::uuid
       where b.id = $1::uuid
    `, [bookingId, openQuoteId]);
    const actual = { archetype, sendError, approveDirectError, approveError, rejectError, before, after };
    check(/not supported/i.test(sendError) && /not supported/i.test(approveDirectError)
        && /not supported/i.test(approveError) && /not supported/i.test(rejectError),
      'marketplace fixed, proposal and time-based generic send/approve/approve-with-coins/reject are rejected by family', actual);
    check(JSON.stringify(after) === JSON.stringify(before)
        && (approvedPackageId === null || after.approved_quote_id === approvedPackageId),
      'unsupported direct RPC attempts leave quote, payment, coin and booking state unchanged', actual);
  });
}

h.finish();

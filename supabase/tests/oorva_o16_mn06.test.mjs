import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const { ok, scenario, finish } = createHarness();
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const check = (condition, label, actual) => ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const one = async (query, params = []) => (await db.query(query, params)).rows[0];
const receiptQuery = `
  select id, receipt_no, payment_id, booking_id, issued_at, snapshot,
         current_payment_status::text as current_payment_status,
         current_refunds, current_payment_is_demo, read_at
    from public.get_receipt($1::uuid)
`;

async function createFixture(seed) {
  const customer = uuid(seed * 100 + 1);
  const provider = uuid(seed * 100 + 2);
  const admin = uuid(seed * 100 + 3);
  const stranger = uuid(seed * 100 + 4);
  const manager = uuid(seed * 100 + 5);
  const staff = uuid(seed * 100 + 6);
  await db.query(`
    insert into auth.users (id) values
      ($1::uuid), ($2::uuid), ($3::uuid), ($4::uuid), ($5::uuid), ($6::uuid)
  `, [customer, provider, admin, stranger, manager, staff]);
  await db.query('update public.profiles set role_provider = true where id = $1::uuid', [provider]);
  await db.query('insert into public.admins (user_id) values ($1::uuid)', [admin]);
  await db.query(`
    insert into public.providers (
      id, city, kyc_status, admin_review_status, submitted_at, is_online, paused, suspended
    ) values ($1::uuid, $2::text, 'verified', 'approved', now(), true, false, false)
  `, [provider, `O16 Receipt City ${seed}`]);
  await db.query(`
    update public.feature_flags set enabled = true where key = 'merchant_staff'
  `);
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active) values
      ($1::uuid, $2::uuid, 'manager', true),
      ($1::uuid, $3::uuid, 'staff', true)
  `, [provider, manager, staff]);

  const category = (await one(`
    insert into public.categories (slug, name, pricing_mode, active)
    values ($1::text, $2::text, 'quote'::public.pricing_mode, true)
    returning id
  `, [`o16-receipt-${seed}`, `O16 receipt service ${seed}`])).id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [category, `O16 Receipt City ${seed}`]);
  const service = (await one(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, $3::int, 0, true)
    returning id
  `, [provider, category, 1000])).id;
  const address = (await one(`
    insert into public.addresses (user_id, line1, city, lat, lng)
    values ($1::uuid, $2::text, $3::text, $4::double precision, $5::double precision)
    returning id
  `, [customer, `22 O16 Receipt Road ${seed}`, `O16 Receipt City ${seed}`, 18.5, 73.8])).id;
  const booking = (await one(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, status, visit_fee, platform_fee, total_amount, coin_discount
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      'Receipt test service', 'awaiting_payment'::public.booking_status, 1000, 0, 10000, 0
    )
    returning id
  `, [customer, provider, category, service, address])).id;
  const quote = (await one(`
    insert into public.quotes (booking_id, version, status, subtotal_other, total)
    values ($1::uuid, 1, 'approved'::public.quote_status, 10000, 10000)
    returning id
  `, [booking])).id;
  await db.query(`
    insert into public.quote_items (quote_id, kind, title, qty, unit_price)
    values ($1::uuid, 'other'::public.quote_item_kind, 'Receipt test service', 1, 10000)
  `, [quote]);
  await db.query('update public.bookings set approved_quote_id = $2::uuid where id = $1::uuid', [booking, quote]);
  return { customer, provider, admin, stranger, manager, staff, booking, quote, service };
}

async function markPaid(fixture, paymentId, amount, gatewayId, purpose = 'balance') {
  await db.query(`
    insert into public.payments (
      id, booking_id, quote_id, purpose, amount, status, funding_source
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::public.payment_purpose, $5::int,
      'created'::public.payment_status, 'customer'
    )
  `, [paymentId, fixture.booking, fixture.quote, purpose, amount]);
  await db.query(`
    update public.payments
       set status = 'paid'::public.payment_status,
           paid_at = '2026-11-19T15:00:00Z'::timestamptz,
           razorpay_payment_id = $2::text
     where id = $1::uuid
  `, [paymentId, gatewayId]);
}

await scenario('MN-RECEIPT-POST-ISSUE-REFUND', async () => {
  const fixture = await createFixture(1601);
  const flag = await one(`select enabled from public.feature_flags where key = 'payment_receipts'`);
  await db.query(`update public.feature_flags set enabled = true where key = 'payment_receipts'`);
  const priorPaymentId = uuid(160111);
  const paymentId = uuid(160112);
  const otherRefundId = uuid(160113);
  const refundId = uuid(160114);
  await markPaid(fixture, priorPaymentId, 1000, 'pay_o16_prior', 'visit_fee');
  await markPaid(fixture, paymentId, 10000, 'pay_demo_o16_current');
  const original = await one(`
    select id, receipt_no, payment_id, booking_id, issued_at, snapshot
      from public.payment_receipts
     where payment_id = $1::uuid
  `, [paymentId]);

  await db.query(`
    insert into public.refunds (id, payment_id, amount, status, created_at)
    values ($1::uuid, $2::uuid, 100, 'pending'::public.refund_status, '2026-11-20T10:00:00Z'::timestamptz),
           ($3::uuid, $4::uuid, 2500, 'pending'::public.refund_status, '2026-11-20T11:00:00Z'::timestamptz)
  `, [otherRefundId, priorPaymentId, refundId, paymentId]);
  await db.query(`
    update public.payments set status = 'refund_pending'::public.payment_status where id = $1::uuid
  `, [paymentId]);
  const pending = (await as(fixture.customer, 'authenticated', receiptQuery, [paymentId]))[0];
  await db.query(`
    update public.refunds set status = 'processing'::public.refund_status where id = $1::uuid
  `, [refundId]);
  await db.query(`
    update public.payments set status = 'refund_processing'::public.payment_status where id = $1::uuid
  `, [paymentId]);
  const processing = (await as(fixture.customer, 'authenticated', receiptQuery, [paymentId]))[0];
  await db.query(`
    update public.refunds
       set status = 'refunded'::public.refund_status,
           processed_at = '2026-11-20T12:00:00Z'::timestamptz
     where id = $1::uuid
  `, [refundId]);
  await db.query(`
    update public.payments set status = 'refunded'::public.payment_status where id = $1::uuid
  `, [paymentId]);
  const refunded = (await as(fixture.customer, 'authenticated', receiptQuery, [paymentId]))[0];
  const persisted = await one(`
    select id, receipt_no, payment_id, booking_id, issued_at, snapshot
      from public.payment_receipts
     where payment_id = $1::uuid
  `, [paymentId]);
  const currentRefund = refunded?.current_refunds?.[0] ?? null;

  check(flag?.enabled === false, 'receipt capability remains default-off before explicit enablement', flag);
  check(
    pending?.current_payment_status === 'refund_pending'
      && pending?.current_refunds?.length === 1
      && pending.current_refunds[0]?.id === refundId
      && pending.current_refunds[0]?.payment_id === paymentId
      && pending.current_refunds[0]?.amount === 2500
      && pending?.current_payment_is_demo === true
      && pending?.read_at != null,
    'pending overlay is current, payment-scoped and derives demo provenance from pay_demo_ reference',
    pending,
  );
  check(
    processing?.current_payment_status === 'refund_processing'
      && processing?.current_refunds?.[0]?.status === 'processing',
    'processing transition is visible without rewriting the receipt snapshot',
    processing,
  );
  check(
    refunded?.current_payment_status === 'refunded'
      && refunded?.current_refunds?.length === 1
      && currentRefund?.status === 'refunded'
      && currentRefund?.amount === 2500
      && currentRefund?.payment_id === paymentId
      && JSON.stringify(Object.keys(currentRefund).sort()) === JSON.stringify([
        'amount', 'created_at', 'id', 'payment_id', 'processed_at', 'status',
      ]),
    'partial refund remains a scoped current child and exposes no private refund fields',
    { refunded, currentRefund },
  );
  check(
    Boolean(original
      && persisted
      && original.id === persisted.id
      && original.receipt_no === persisted.receipt_no
      && original.payment_id === persisted.payment_id
      && original.booking_id === persisted.booking_id
      && original.issued_at === persisted.issued_at
      && JSON.stringify(original.snapshot) === JSON.stringify(persisted.snapshot)
      && JSON.stringify(refunded?.snapshot) === JSON.stringify(original.snapshot)),
    'receipt identity, issue time and original snapshot remain byte-for-byte unchanged',
    { original, persisted, refunded },
  );
  await db.query(`update public.feature_flags set enabled = false where key = 'payment_receipts'`);
  const hidden = await as(fixture.customer, 'authenticated', receiptQuery, [paymentId]);
  const stillRefunded = await one(`
    select p.status::text as payment_status, r.status::text as refund_status
      from public.payments as p
      join public.refunds as r on r.payment_id = p.id
     where p.id = $1::uuid and r.id = $2::uuid
  `, [paymentId, refundId]);
  check(hidden.length === 0, 'receipt OFF hides the read without changing the existing refund record', {
    hidden,
    stillRefunded,
  });
  check(
    stillRefunded?.payment_status === 'refunded' && stillRefunded?.refund_status === 'refunded',
    'receipt OFF leaves the payment and refund resolution states intact',
    stillRefunded,
  );
});

await scenario('MN-ROLES-SAME-PK', async () => {
  await db.query(`update public.feature_flags set enabled = true where key = 'payment_receipts'`);
  const fixture = await createFixture(1602);
  const paymentId = uuid(160221);
  await markPaid(fixture, paymentId, 10000, 'pay_o16_roles');
  const customerRows = await as(fixture.customer, 'authenticated', receiptQuery, [paymentId]);
  const providerRows = await as(fixture.provider, 'authenticated', receiptQuery, [paymentId]);
  const adminRows = await as(fixture.admin, 'authenticated', receiptQuery, [paymentId]);
  const managerRows = await as(fixture.manager, 'authenticated', receiptQuery, [paymentId]);
  const staffRows = await as(fixture.staff, 'authenticated', receiptQuery, [paymentId]);
  const strangerRows = await as(fixture.stranger, 'authenticated', receiptQuery, [paymentId]);
  let anonymousError = '';
  try {
    await as(null, 'anon', receiptQuery, [paymentId]);
  } catch (error) {
    anonymousError = error?.message ?? String(error);
  }
  const authorized = [customerRows[0] ?? null, providerRows[0] ?? null, adminRows[0] ?? null];
  const denied = [managerRows, staffRows, strangerRows];

  check(
    authorized.every((row) => row?.id === authorized[0]?.id)
      && authorized.every((row) => row?.payment_id === paymentId)
      && authorized.every((row) => row?.current_payment_status === 'paid')
      && authorized.every((row) => row?.current_payment_is_demo === false),
    'customer, provider and admin receive the same receipt primary key and live overlay',
    { customer: authorized[0], provider: authorized[1], admin: authorized[2] },
  );
  check(
    denied.every((rows) => rows.length === 0),
    'manager, staff and unrelated authenticated user cannot read the same receipt/payment key',
    { manager: managerRows, staff: staffRows, stranger: strangerRows },
  );
  check(
    anonymousError.toLowerCase().includes('permission denied'),
    'anonymous caller cannot execute the receipt RPC',
    { anonymousError, paymentId },
  );
});

await scenario('MN-RECEIPT-TRIGGER-RETAIN', async () => {
  const fixture = await createFixture(1603);
  await db.query(`update public.feature_flags set enabled = false where key = 'payment_receipts'`);
  const paymentId = uuid(160331);
  await markPaid(fixture, paymentId, 10000, 'pay_o16_flag_off');
  const stored = await one(`
    select count(*)::int as count
      from public.payment_receipts
     where payment_id = $1::uuid
  `, [paymentId]);
  const hidden = await as(fixture.customer, 'authenticated', receiptQuery, [paymentId]);
  const trigger = await one(`
    select pg_get_triggerdef(t.oid) as definition
      from pg_catalog.pg_trigger as t
     where t.tgrelid = 'public.payments'::regclass
       and t.tgname = 'payment_receipts_on_payment_paid'
       and not t.tgisinternal
  `);
  const packageId = uuid(160332);
  const packId = uuid(160333);
  const packPaymentId = uuid(160334);
  await db.query(`
    insert into public.service_packages (
      id, provider_service_id, title, price_type, price, unit, active
    ) values (
      $1::uuid, $2::uuid, 'O16 test pack', 'fixed', 10000, 'session', true
    )
  `, [packageId, fixture.service]);
  await db.query(`
    insert into public.pack_purchases (
      id, customer_id, provider_id, provider_service_id, service_package_id,
      sessions_total, price, platform_fee, expires_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      2, 10000, 4900, '2026-12-01T00:00:00Z'::timestamptz
    )
  `, [packId, fixture.customer, fixture.provider, fixture.service, packageId]);
  await db.query(`
    insert into public.payments (
      id, pack_purchase_id, purpose, amount, status, funding_source
    ) values (
      $1::uuid, $2::uuid, 'package'::public.payment_purpose, 14900,
      'created'::public.payment_status, 'customer'
    )
  `, [packPaymentId, packId]);
  await db.query(`
    update public.payments
       set status = 'paid'::public.payment_status,
           paid_at = '2026-11-20T13:00:00Z'::timestamptz,
           razorpay_payment_id = 'pay_o16_pack'
     where id = $1::uuid
  `, [packPaymentId]);
  const packReceiptCount = await one(`
    select count(*)::int as count
      from public.payment_receipts
     where payment_id = $1::uuid
  `, [packPaymentId]);

  check(stored?.count === 1 && hidden.length === 0, 'receipt issue trigger remains independent of receipt read capability', {
    stored,
    hidden,
  });
  check(
    packReceiptCount?.count === 0,
    'pack capture without a booking does not invoke the booking-only receipt trigger',
    { packPaymentId, packReceiptCount },
  );
  check(
    String(trigger?.definition ?? '').toLowerCase().includes('new.booking_id is not null')
      && String(trigger?.definition ?? '').toLowerCase().includes("new.status = 'paid'")
      && String(trigger?.definition ?? '').toLowerCase().includes("new.funding_source = 'customer'"),
    'latest booking-only trigger guard still excludes sports and pack payment rows',
    trigger,
  );
});

finish();

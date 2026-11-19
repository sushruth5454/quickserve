import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const { ok, scenario, finish } = createHarness();
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const check = (condition, label, actual) => ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
const one = async (query, params = []) => (await db.query(query, params)).rows[0];

async function createFixture(seed) {
  const customer = uuid(seed * 100 + 1);
  const provider = uuid(seed * 100 + 2);
  const admin = uuid(seed * 100 + 3);
  const stranger = uuid(seed * 100 + 4);
  await db.query(`
    insert into auth.users (id) values
      ($1::uuid), ($2::uuid), ($3::uuid), ($4::uuid)
  `, [customer, provider, admin, stranger]);
  await db.query(`
    update public.profiles
       set full_name = case id
         when $1::uuid then 'Receipt Customer'
         when $2::uuid then 'Receipt Provider'
         else full_name
       end
     where id in ($1::uuid, $2::uuid)
  `, [customer, provider]);
  await db.query('insert into public.admins (user_id) values ($1::uuid)', [admin]);
  await db.query(
    `insert into public.providers (id, city) values ($1::uuid, $2::text)`,
    [provider, `Receipt City ${seed}`],
  );
  const category = (await one(`
    insert into public.categories (slug, name, pricing_mode, active)
    values ($1::text, $2::text, 'quote'::public.pricing_mode, true)
    returning id
  `, [`b2-receipt-${seed}`, `Receipt service ${seed}`])).id;
  const service = (await one(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, $3::int, 0, true)
    returning id
  `, [provider, category, 19900])).id;
  const address = (await one(`
    insert into public.addresses (user_id, line1, city, lat, lng)
    values ($1::uuid, $2::text, $3::text, $4::double precision, $5::double precision)
    returning id
  `, [customer, `22 Receipt Road ${seed}`, `Receipt City ${seed}`, 18.5, 73.8])).id;
  const booking = (await one(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, status, visit_fee, platform_fee, total_amount, coin_discount
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      'AC repair', 'awaiting_payment'::public.booking_status, 19900, 2900, 217900, 5000
    )
    returning id
  `, [customer, provider, category, service, address])).id;
  const quote = (await one(`
    insert into public.quotes (
      booking_id, version, status, subtotal_other, total
    ) values (
      $1::uuid, 1, 'approved'::public.quote_status, 215000, 215000
    )
    returning id
  `, [booking])).id;
  await db.query(`
    insert into public.quote_items (quote_id, kind, title, qty, unit_price)
    values ($1::uuid, 'other'::public.quote_item_kind, 'AC repair', 1, 215000)
  `, [quote]);
  await db.query(`
    update public.bookings
       set approved_quote_id = $2::uuid, total_amount = 217900
     where id = $1::uuid
  `, [booking, quote]);
  return { customer, provider, admin, stranger, booking, quote };
}

async function markPaid(fixture, paymentId, amount, purpose, fundingSource = 'customer', quoteId = null, gatewayId = null) {
  await db.query(`
    insert into public.payments (
      id, booking_id, quote_id, purpose, amount, status, funding_source
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::public.payment_purpose, $5::int,
      'created'::public.payment_status, $6::text
    )
  `, [paymentId, fixture.booking, quoteId, purpose, amount, fundingSource]);
  await db.query(`
    update public.payments
       set status = 'paid'::public.payment_status,
           paid_at = '2026-11-19T15:00:00Z'::timestamptz,
           razorpay_payment_id = $2::text
     where id = $1::uuid
  `, [paymentId, gatewayId]);
}

await scenario('B2 creates one receipt per customer payment while receipt access is off', async () => {
  const fixture = await createFixture(8401);
  const flag = await one(`select enabled from public.feature_flags where key = 'payment_receipts'`);
  const paymentId = uuid(84011);
  await markPaid(fixture, paymentId, 19900, 'visit_fee', 'customer', null, 'pay_b2_off');
  const stored = await one(`
    select count(*)::int as count
      from public.payment_receipts
     where payment_id = $1::uuid
  `, [paymentId]);
  const hidden = await as(fixture.customer, 'authenticated', `
    select receipt_no, snapshot from public.get_receipt($1::uuid)
  `, [paymentId]);
  check(flag?.enabled === false, 'payment receipt feature defaults off', flag);
  check(stored?.count === 1, 'payment is receipted even while the feature is off', stored);
  check(hidden.length === 0, 'feature-off RPC returns no receipt data', hidden);
});

await scenario('B2 receipt is idempotent, non-tax, and visible only to booking parties or admins', async () => {
  await db.query(`
    update public.feature_flags set enabled = true where key = 'payment_receipts'
  `);
  const fixture = await createFixture(8402);
  const priorId = uuid(84021);
  const coinId = uuid(84022);
  const paymentId = uuid(84023);
  await markPaid(fixture, priorId, 19900, 'visit_fee', 'customer', null, 'pay_b2_prior');
  await markPaid(fixture, coinId, 5000, 'balance', 'coins', fixture.quote, null);
  await markPaid(fixture, paymentId, 193000, 'balance', 'customer', fixture.quote, 'pay_b2_current');
  await db.query(`
    update public.payments set status = 'paid'::public.payment_status where id = $1::uuid
  `, [paymentId]);

  const receipts = (await db.query(`
    select id, receipt_no, payment_id, booking_id, issued_at, snapshot
      from public.payment_receipts
     where booking_id = $1::uuid
     order by payment_id
  `, [fixture.booking])).rows;
  const receipt = receipts.find((row) => row.payment_id === paymentId);
  const customerRows = await as(fixture.customer, 'authenticated', `
    select receipt_no, snapshot from public.get_receipt($1::uuid)
  `, [paymentId]);
  const providerRows = await as(fixture.provider, 'authenticated', `
    select receipt_no from public.get_receipt($1::uuid)
  `, [paymentId]);
  const adminRows = await as(fixture.admin, 'authenticated', `
    select receipt_no from public.get_receipt($1::uuid)
  `, [paymentId]);
  const strangerRows = await as(fixture.stranger, 'authenticated', `
    select receipt_no from public.get_receipt($1::uuid)
  `, [paymentId]);
  const strangerTableRows = await as(fixture.stranger, 'authenticated', `
    select receipt_no from public.payment_receipts where payment_id = $1::uuid
  `, [paymentId]);
  const snapshot = receipt?.snapshot;
  const storedIds = receipts.map((row) => row.payment_id).sort();

  check(receipts.length === 2 && storedIds.join(',') === [priorId, paymentId].sort().join(','),
    'one receipt per customer payment and none for coin payments', { receipts: storedIds, expected: [priorId, paymentId] });
  check(receipt?.receipt_no?.match(/^NR-[0-9]{4}-[0-9]{6}$/) != null,
    'receipt number uses the required series format', receipt?.receipt_no);
  check(Number(snapshot?.subtotal) === 215000 && Number(snapshot?.platform_fee) === 2900
    && Number(snapshot?.coins_discount) === 5000 && Number(snapshot?.total) === 212900
    && Number(snapshot?.this_payment?.amount) === 193000 && Number(snapshot?.balance_due) === 0,
  'receipt snapshot preserves the exact non-tax paise totals', snapshot);
  check(Array.isArray(snapshot?.tax_lines) && snapshot.tax_lines.length === 0
    && snapshot?.tax_invoice_url === null,
  'payment receipt does not claim tax lines or an issued tax invoice', snapshot);
  check(customerRows.length === 1 && providerRows.length === 1 && adminRows.length === 1
    && strangerRows.length === 0 && strangerTableRows.length === 0,
  'receipt reads are limited to customer, provider, or admin', {
    customerRows, providerRows, adminRows, strangerRows, strangerTableRows,
  });
  check(receipts.filter((row) => row.payment_id === paymentId).length === 1,
    'replaying the paid status does not duplicate the receipt', receipts);
});

finish();

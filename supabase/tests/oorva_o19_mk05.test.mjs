import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const originalFlags = (await db.query(`
  select key, enabled from public.feature_flags
   where key in ('products', 'product_enquiries', 'product_rfq')
`)).rows;
const { ok, scenario, finish } = createHarness({
  cleanup: async () => {
    for (const flag of originalFlags) {
      await db.query(
        'update public.feature_flags set enabled = $2::boolean where key = $1::text',
        [flag.key, flag.enabled],
      );
    }
  },
});
const check = (condition, label, actual) => ok(condition, `${label}; actual=${JSON.stringify(actual)}`);

async function one(query, params = []) {
  return (await db.query(query, params)).rows[0];
}

async function setFlags({ products, enquiries, rfq }) {
  await db.query(`
    update public.feature_flags
       set enabled = case key
         when 'products' then $1::boolean
         when 'product_enquiries' then $2::boolean
         when 'product_rfq' then $3::boolean
         else enabled
       end
     where key in ('products', 'product_enquiries', 'product_rfq')
  `, [products, enquiries, rfq]);
}

async function expectDenied(run, pattern, label, actualState) {
  let actual = '<no error>';
  try {
    await run();
  } catch (error) {
    actual = error?.message ?? String(error);
  }
  check(pattern.test(actual), label, { error: actual, state: actualState });
}

async function makeUser() {
  const id = randomUUID();
  const digits = randomUUID().replace(/\D/g, '').slice(0, 10);
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, `+1555${digits}`]);
  return id;
}

async function makeCategory(label) {
  return (await one(`
    insert into public.product_categories (slug, name, attribute_schema)
    values ($1::text, $2::text, '{}'::jsonb)
    returning id
  `, [`o19-${randomUUID().replace(/-/g, '')}`, `O19 ${label}`])).id;
}

async function makeShop(ownerId, categoryId, label, mapped = true) {
  const shop = await one(`
    insert into public.shops (
      owner_id, name, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, status
    ) values (
      $1::uuid, $2::text, '1 O19 Market Road', 'Vijayawada', 'Benz Circle',
      16.5::double precision, 80.6::double precision, 20::int, true, true, 'verified'
    ) returning id
  `, [ownerId, `O19 ${label} ${randomUUID()}`]);
  if (mapped) {
    await db.query(`
      insert into public.shop_categories (shop_id, category_id)
      values ($1::uuid, $2::uuid)
    `, [shop.id, categoryId]);
  }
  return shop.id;
}

async function makeFixture(label, { inStock = true } = {}) {
  await setFlags({ products: true, enquiries: true, rfq: true });
  const customerId = await makeUser();
  const ownerId = await makeUser();
  const outsiderId = await makeUser();
  const categoryId = await makeCategory(label);
  const shopId = await makeShop(ownerId, categoryId, label);
  const product = await one(`
    insert into public.products (
      shop_id, category_id, name, brand, model, description, in_stock
    ) values (
      $1::uuid, $2::uuid, $3::text, 'O19', '', 'O19 eligibility fixture', $4::boolean
    ) returning id
  `, [shopId, categoryId, `O19 product ${randomUUID()}`, inStock]);
  return { customerId, ownerId, outsiderId, categoryId, shopId, productId: product.id };
}

async function createRfq(fixture, itemCount = 1) {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    description: `O19 requested item ${index + 1}`,
    specs: {},
    quantity: index + 2,
    unit: 'piece',
  }));
  const result = await as(fixture.customerId, 'authenticated', `
    select public.create_rfq(
      $1::uuid, $2::text, $3::jsonb, $4::text, $5::text,
      $6::double precision, $7::double precision, $8::boolean, $9::date, $10::text
    ) as id
  `, [
    fixture.categoryId,
    `O19 request ${randomUUID()}`,
    JSON.stringify(items),
    'Vijayawada',
    'Benz Circle',
    16.5,
    80.6,
    true,
    '2027-01-15',
    'O19 supplier eligibility fixture',
  ]);
  return result[0].id;
}

async function sendQuote(fixture, rfqId, shopId = fixture.shopId, partial = false) {
  const items = (await db.query(`
    select id from public.rfq_items
     where rfq_id = $1::uuid
     order by seq
  `, [rfqId])).rows;
  const quoteItems = items.map((item, index) => ({
    rfq_item_id: item.id,
    brand: 'O19',
    model: `Offer ${index + 1}`,
    specs: {},
    unit_price_paise: index === 0 ? 1250 : 0,
    gst_rate_bp: 0,
    available: !(partial && index === 1),
  }));
  const result = await as(fixture.ownerId, 'authenticated', `
    select public.send_supplier_quote_for_business(
      $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int,
      $6::timestamptz, $7::text
    ) as id
  `, [rfqId, shopId, JSON.stringify(quoteItems), 0, null, null, 'O19 quote']);
  return result[0].id;
}

async function state(rfqId) {
  return (await one(`
    select jsonb_build_object(
      'rfq', (
        select jsonb_build_object('id', r.id, 'status', r.status, 'updated_at', r.updated_at)
          from public.rfqs as r where r.id = $1::uuid
      ),
      'quotes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', q.id, 'shop_id', q.shop_id, 'status', q.status,
          'version', q.version, 'updated_at', q.updated_at
        ) order by q.id)
          from public.supplier_quotes as q where q.rfq_id = $1::uuid
      ), '[]'::jsonb),
      'enquiries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'product_id', e.product_id, 'status', e.status,
          'last_message_at', e.last_message_at, 'customer_unread', e.customer_unread,
          'shop_unread', e.shop_unread
        ) order by e.id)
          from public.product_enquiries as e where e.customer_id = (
            select r.customer_id from public.rfqs as r where r.id = $1::uuid
          )
      ), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'enquiry_id', m.enquiry_id, 'sender_id', m.sender_id, 'body', m.body
        ) order by m.id)
          from public.product_enquiry_messages as m
         where m.enquiry_id in (
           select e.id from public.product_enquiries as e
            where e.customer_id = (
              select r.customer_id from public.rfqs as r where r.id = $1::uuid
            )
         )
      ), '[]'::jsonb)
    ) as value
  `, [rfqId])).value;
}

await scenario('MK-SELECT-suspended-shop-atomic-denial', async () => {
  const fixture = await makeFixture('suspended-selection');
  const rfqId = await createRfq(fixture);
  const quoteId = await sendQuote(fixture, rfqId);
  await db.query(`
    update public.shops set status = 'suspended', updated_at = now()
     where id = $1::uuid
  `, [fixture.shopId]);
  const before = await state(rfqId);
  const comparison = await as(fixture.customerId, 'authenticated', `
    select quote_id, can_select, selection_block_reason
      from public.compare_rfq_quotes($1::uuid)
     where quote_id = $2::uuid
  `, [rfqId, quoteId]);
  check(comparison.length === 1 && comparison[0].can_select === false
    && comparison[0].selection_block_reason === 'shop_unavailable',
  'suspended shop remains in history but is not selectable', comparison);
  await expectDenied(
    () => as(fixture.customerId, 'authenticated', `
      select public.select_supplier_quote($1::uuid)
    `, [quoteId]),
    /verified shop not found|shop or product unavailable/i,
    'suspended shop selection is rejected before writes',
    before,
  );
  const after = await state(rfqId);
  check(JSON.stringify(after) === JSON.stringify(before),
    'denied selection leaves RFQ, quote, enquiry and message state unchanged',
    { before, after });
});

await scenario('MK-ENQUIRY-public-eligibility', async () => {
  const inactive = await makeFixture('inactive-category');
  await db.query(`
    update public.product_categories set active = false where id = $1::uuid
  `, [inactive.categoryId]);
  const inactiveBefore = await one(`
    select count(*)::int as count from public.product_enquiries where shop_id = $1::uuid
  `, [inactive.shopId]);
  await expectDenied(
    () => as(inactive.customerId, 'authenticated', `
      select public.start_product_enquiry($1::uuid, $2::uuid, $3::text)
    `, [inactive.shopId, inactive.productId, 'O19 inactive category']),
    /product not found/i,
    'inactive category cannot start a product enquiry',
    inactiveBefore,
  );
  const inactiveAfter = await one(`
    select count(*)::int as count from public.product_enquiries where shop_id = $1::uuid
  `, [inactive.shopId]);
  check(inactiveAfter.count === inactiveBefore.count,
    'inactive category denial creates no enquiry', { inactiveBefore, inactiveAfter });

  const unmapped = await makeFixture('removed-mapping');
  await db.query(`
    delete from public.shop_categories
     where shop_id = $1::uuid and category_id = $2::uuid
  `, [unmapped.shopId, unmapped.categoryId]);
  const mappingBefore = await one(`
    select count(*)::int as count from public.product_enquiries where shop_id = $1::uuid
  `, [unmapped.shopId]);
  await expectDenied(
    () => as(unmapped.customerId, 'authenticated', `
      select public.start_product_enquiry($1::uuid, $2::uuid, $3::text)
    `, [unmapped.shopId, unmapped.productId, 'O19 removed mapping']),
    /product not found/i,
    'removed shop-category mapping cannot start a product enquiry',
    mappingBefore,
  );
  const mappingAfter = await one(`
    select count(*)::int as count from public.product_enquiries where shop_id = $1::uuid
  `, [unmapped.shopId]);
  check(mappingAfter.count === mappingBefore.count,
    'removed mapping denial creates no enquiry', { mappingBefore, mappingAfter });

  const outOfStock = await makeFixture('out-of-stock', { inStock: false });
  const outOfStockEnquiry = await as(outOfStock.customerId, 'authenticated', `
    select public.start_product_enquiry($1::uuid, $2::uuid, $3::text) as id
  `, [outOfStock.shopId, outOfStock.productId, 'O19 active mapped out-of-stock product']);
  const outOfStockRow = await one(`
    select id, product_id, status from public.product_enquiries where id = $1::uuid
  `, [outOfStockEnquiry[0].id]);
  check(outOfStockRow?.product_id === outOfStock.productId && outOfStockRow.status === 'open',
    'active mapped out-of-stock product remains eligible', outOfStockRow);

  const general = await makeFixture('general-enquiry');
  const generalEnquiry = await as(general.customerId, 'authenticated', `
    select public.start_product_enquiry($1::uuid, null::uuid, $2::text) as id
  `, [general.shopId, 'O19 genuine general enquiry']);
  const generalRow = await one(`
    select id, product_id, status from public.product_enquiries where id = $1::uuid
  `, [generalEnquiry[0].id]);
  check(generalRow?.product_id === null && generalRow.status === 'open',
    'genuine general enquiry remains supported', generalRow);
});

await scenario('MK-SELECT-live-partial-allowed', async () => {
  const fixture = await makeFixture('live-partial');
  const rfqId = await createRfq(fixture, 2);
  const quoteId = await sendQuote(fixture, rfqId, fixture.shopId, true);
  const comparison = await as(fixture.customerId, 'authenticated', `
    select to_jsonb(c) as value
      from public.compare_rfq_quotes($1::uuid) as c
     where c.quote_id = $2::uuid
  `, [rfqId, quoteId]);
  const comparedQuote = comparison[0]?.value;
  const privateFields = ['owner_id', 'status_reason', 'gstin', 'address_line', 'city', 'area'];
  const allowedReasons = [null, 'closed', 'rfq_expired', 'quote_expired', 'shop_unavailable', 'feature_off'];
  check(comparison.length === 1 && comparedQuote.status === 'sent'
    && Number(comparedQuote.unavailable_count) === 1
    && comparedQuote.can_select === true
    && comparedQuote.selection_block_reason === null,
  'live partial quote is selectable with no block reason', comparedQuote);
  check(!privateFields.some((field) => Object.hasOwn(comparedQuote ?? {}, field)),
    'quote comparison exposes no private shop fields', comparedQuote);
  check(allowedReasons.includes(comparedQuote?.selection_block_reason ?? null),
    'quote comparison uses only documented selection block reasons', comparedQuote);
  const selected = await as(fixture.customerId, 'authenticated', `
    select public.select_supplier_quote($1::uuid) as result
  `, [quoteId]);
  const after = await state(rfqId);
  check(after.rfq.status === 'closed'
    && after.quotes.filter((quote) => quote.status === 'selected').length === 1
    && after.enquiries.length === 1
    && after.enquiries[0].product_id === null
    && after.messages.length === 1
    && selected[0].result.enquiry_id === after.enquiries[0].id,
  'partial selection closes the RFQ and creates only its general enquiry message',
  { selected, after });
  const closedQuote = await as(fixture.customerId, 'authenticated', `
    select can_select, selection_block_reason
      from public.compare_rfq_quotes($1::uuid)
     where quote_id = $2::uuid
  `, [rfqId, quoteId]);
  check(closedQuote.length === 1 && closedQuote[0].can_select === false
    && closedQuote[0].selection_block_reason === 'closed',
  'closed RFQ remains readable with the documented closed reason', closedQuote);
});

await scenario('MK-SELECT-role-denials-retained', async () => {
  const fixture = await makeFixture('role-denials');
  const rfqId = await createRfq(fixture);
  const quoteId = await sendQuote(fixture, rfqId);
  const before = await state(rfqId);
  await expectDenied(
    () => as(fixture.outsiderId, 'authenticated', `
      select public.select_supplier_quote($1::uuid)
    `, [quoteId]),
    /quote not found|RFQ not found/i,
    'non-owner cannot select another customer RFQ quote',
    before,
  );
  const otherOwner = await makeUser();
  const nonRecipientShopId = await makeShop(otherOwner, fixture.categoryId, 'non-recipient', false);
  const rfqItem = await one(`
    select id from public.rfq_items where rfq_id = $1::uuid order by seq limit 1
  `, [rfqId]);
  await expectDenied(
    () => as(otherOwner, 'authenticated', `
      select public.send_supplier_quote_for_business(
        $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int,
        $6::timestamptz, $7::text
      )
    `, [
      rfqId,
      nonRecipientShopId,
      JSON.stringify([{
        rfq_item_id: rfqItem.id,
        brand: 'O19',
        model: 'Unauthorized',
        specs: {},
        unit_price_paise: 1000,
        gst_rate_bp: 0,
        available: true,
      }]),
      0,
      null,
      null,
      'O19 non-recipient attempt',
    ]),
    /shop is not a recipient/i,
    'non-recipient shop cannot send a quote',
    before,
  );
  const after = await state(rfqId);
  check(JSON.stringify(after) === JSON.stringify(before),
    'role denials preserve RFQ and quote state', { before, after });
});

await scenario('MK-ENQUIRY-capability-parent-and-private-helper', async () => {
  const fixture = await makeFixture('capability-parent');
  const rfqId = await createRfq(fixture);
  const quoteId = await sendQuote(fixture, rfqId);
  const privileges = await one(`
    select
      has_function_privilege('anon', 'public._can_start_product_enquiry(uuid,uuid)', 'execute') as anon_exec,
      has_function_privilege('authenticated', 'public._can_start_product_enquiry(uuid,uuid)', 'execute') as authenticated_exec
  `);
  check(privileges.anon_exec === false && privileges.authenticated_exec === false,
    'private eligibility helper is not directly executable by API roles', privileges);

  await setFlags({ products: false, enquiries: true, rfq: true });
  await expectDenied(
    () => as(fixture.customerId, 'authenticated', `
      select public.start_product_enquiry($1::uuid, $2::uuid, $3::text)
    `, [fixture.shopId, fixture.productId, 'O19 parent capability disabled']),
    /disabled|unavailable|not found/i,
    'disabled product parent rejects a child-enabled enquiry',
    await state(rfqId),
  );
  let comparison = await as(fixture.customerId, 'authenticated', `
    select can_select, selection_block_reason
      from public.compare_rfq_quotes($1::uuid)
     where quote_id = $2::uuid
  `, [rfqId, quoteId]);
  check(comparison.length === 1 && comparison[0].can_select === false
    && comparison[0].selection_block_reason === 'feature_off',
  'comparison remains readable and reports effective parent OFF', comparison);

  await setFlags({ products: true, enquiries: false, rfq: true });
  await expectDenied(
    () => as(fixture.customerId, 'authenticated', `
      select public.start_product_enquiry($1::uuid, $2::uuid, $3::text)
    `, [fixture.shopId, fixture.productId, 'O19 enquiry child disabled']),
    /disabled|unavailable|not found/i,
    'disabled enquiry capability rejects new product enquiry',
    await state(rfqId),
  );
  comparison = await as(fixture.customerId, 'authenticated', `
    select can_select, selection_block_reason
      from public.compare_rfq_quotes($1::uuid)
     where quote_id = $2::uuid
  `, [rfqId, quoteId]);
  check(comparison.length === 1 && comparison[0].can_select === false
    && comparison[0].selection_block_reason === 'feature_off',
  'comparison exposes only the documented feature-off reason', comparison);
});

finish();

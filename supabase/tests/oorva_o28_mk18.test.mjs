import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const originalFlags = (await db.query(`
  select key, enabled from public.feature_flags
   where key in ('products', 'product_rfq', 'merchant_staff')
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

async function makeUser() {
  const id = randomUUID();
  const digits = randomUUID().replace(/\D/g, '').slice(0, 10);
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, `+1555${digits}`]);
  return id;
}

async function makeCategory(name) {
  const slug = `o28-mk18-${randomUUID().replace(/-/g, '')}`;
  return (await one(`
    insert into public.product_categories (slug, name, attribute_schema)
    values ($1::text, $2::text, '{}'::jsonb)
    returning id
  `, [slug, name])).id;
}

async function makeShop(ownerId, categoryId) {
  const shop = await one(`
    insert into public.shops (
      owner_id, name, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, status
    ) values (
      $1::uuid, 'O28 Shared Shop', '1 O28 Market Road', 'Pune', 'Shivaji Nagar',
      18.52::double precision, 73.85::double precision, 20::int, true, true, 'verified'
    ) returning id
  `, [ownerId]);
  await db.query(`
    insert into public.shop_categories (shop_id, category_id)
    values ($1::uuid, $2::uuid)
  `, [shop.id, categoryId]);
  return shop.id;
}

async function createRfq(customerId, categoryId) {
  const result = await as(customerId, 'authenticated', `
    select public.create_rfq(
      $1::uuid, $2::text, $3::jsonb, $4::text, $5::text,
      $6::double precision, $7::double precision, $8::boolean, $9::date, $10::text
    ) as id
  `, [
    categoryId,
    `O28 MK18 shared request ${randomUUID()}`,
    JSON.stringify([{
      description: 'Ceramic tile',
      specs: { finish: 'matte' },
      quantity: 2,
      unit: 'box',
    }]),
    'Pune',
    'Shivaji Nagar',
    18.52,
    73.85,
    true,
    '2027-01-15',
    'O28 MK18 two-shop identity fixture',
  ]);
  return result[0].id;
}

async function sendQuote(actorId, rfqId, shopId, brand, notes) {
  const item = await one(`
    select id from public.rfq_items where rfq_id = $1::uuid order by seq limit 1
  `, [rfqId]);
  const items = [{
    rfq_item_id: item.id,
    brand,
    model: 'MK18 private model',
    specs: { finish: 'matte' },
    unit_price_paise: 1234,
    gst_rate_bp: 0,
    available: true,
    offered_quantity: 2,
  }];
  const result = await as(actorId, 'authenticated', `
    select public.send_supplier_quote_for_business(
      $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int,
      $6::timestamptz, $7::text
    ) as id
  `, [rfqId, shopId, JSON.stringify(items), 0, null, null, notes]);
  return result[0].id;
}

async function readSupplierRfq(actorId, rfqId, shopId) {
  const result = await as(actorId, 'authenticated', `
    select public.get_supplier_rfq_for_business($1::uuid, $2::uuid) as value
  `, [rfqId, shopId]);
  return result[0].value;
}

await scenario('MK-BUSINESS-two-shop-same-RFQ', async () => {
  await db.query(`
    update public.feature_flags
       set enabled = true
     where key in ('products', 'product_rfq', 'merchant_staff')
  `);

  const [customerId, ownerAId, ownerBId, activeMemberId, inactiveMemberId] = await Promise.all([
    makeUser(), makeUser(), makeUser(), makeUser(), makeUser(),
  ]);
  const categoryId = await makeCategory('O28 Shared Category');
  const duplicateCategoryId = await makeCategory('O28 Shared Category');
  const shopAId = await makeShop(ownerAId, categoryId);
  const shopBId = await makeShop(ownerBId, categoryId);
  const rfqId = await createRfq(customerId, categoryId);

  await db.query(`
    insert into public.rfq_recipients (rfq_id, shop_id)
    values ($1::uuid, $2::uuid), ($1::uuid, $3::uuid)
    on conflict (rfq_id, shop_id) do nothing
  `, [rfqId, shopAId, shopBId]);
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values
      ($1::uuid, $3::uuid, 'staff', true),
      ($2::uuid, $3::uuid, 'staff', true),
      ($1::uuid, $4::uuid, 'staff', false),
      ($2::uuid, $4::uuid, 'staff', false)
  `, [ownerAId, ownerBId, activeMemberId, inactiveMemberId]);

  const quoteAId = await sendQuote(ownerAId, rfqId, shopAId, 'Private brand alpha', 'Alpha private quote');
  const quoteBId = await sendQuote(ownerBId, rfqId, shopBId, 'Private brand beta', 'Beta private quote');
  const rows = await as(activeMemberId, 'authenticated', `
    select summary.shop_id, summary.shop_name, summary.rfq_id,
           summary.business_role, summary.quote_status, summary.my_outcome
      from public.list_my_supplier_rfqs() as summary
     where summary.rfq_id = $1::uuid
     order by summary.shop_id
  `, [rfqId]);
  const expectedShopIds = [shopAId, shopBId].sort();
  const actualShopIds = rows.map((row) => row.shop_id);
  check(rows.length === 2
    && JSON.stringify(actualShopIds) === JSON.stringify(expectedShopIds)
    && rows.every((row) => row.rfq_id === rfqId && row.shop_name === 'O28 Shared Shop'
      && row.business_role === 'staff' && row.quote_status === 'sent' && row.my_outcome === 'sent'),
  'same RFQ returns separately named rows keyed by each exact shop ID despite duplicate shop/category names', {
    rows,
    expectedShopIds,
    actualShopIds,
    duplicateCategoryIds: [categoryId, duplicateCategoryId],
  });

  const detailA = await readSupplierRfq(activeMemberId, rfqId, shopAId);
  const detailB = await readSupplierRfq(activeMemberId, rfqId, shopBId);
  const detailAJson = JSON.stringify(detailA);
  const detailBJson = JSON.stringify(detailB);
  check(detailA.shop_id === shopAId && detailA.my_quote?.id === quoteAId
    && detailA.my_quote?.notes === 'Alpha private quote'
    && detailA.my_quote?.items?.length === 1
    && detailA.my_quote.items[0]?.brand === 'Private brand alpha'
    && !detailAJson.includes('Beta private quote')
    && !detailAJson.includes('Private brand beta')
    && detailB.shop_id === shopBId && detailB.my_quote?.id === quoteBId
    && detailB.my_quote?.notes === 'Beta private quote'
    && detailB.my_quote?.items?.length === 1
    && detailB.my_quote.items[0]?.brand === 'Private brand beta'
    && !detailBJson.includes('Alpha private quote')
    && !detailBJson.includes('Private brand alpha'),
  'each exact shop context returns only its own saved quote lines', {
    shopAId,
    shopBId,
    detailA: { shop_id: detailA.shop_id, my_quote: detailA.my_quote },
    detailB: { shop_id: detailB.shop_id, my_quote: detailB.my_quote },
  });

  const inactiveRows = await as(inactiveMemberId, 'authenticated', `
    select summary.shop_id, summary.shop_name, summary.rfq_id
      from public.list_my_supplier_rfqs() as summary
     where summary.rfq_id = $1::uuid
  `, [rfqId]);
  check(inactiveRows.length === 0, 'inactive business member receives no supplier RFQ rows', {
    inactiveMemberId,
    rfqId,
    rows: inactiveRows,
  });

  let inactiveDetailError = '<no error>';
  try {
    await readSupplierRfq(inactiveMemberId, rfqId, shopAId);
  } catch (error) {
    inactiveDetailError = error?.message ?? String(error);
  }
  check(/shop not found/i.test(inactiveDetailError), 'inactive member cannot read a chosen shop RFQ detail', {
    inactiveMemberId,
    rfqId,
    shopId: shopAId,
    error: inactiveDetailError,
  });

  await db.query(`
    update public.feature_flags set enabled = false where key in ('products', 'product_rfq')
  `);
  const offRows = await as(activeMemberId, 'authenticated', `
    select summary.shop_id, summary.shop_name, summary.rfq_id
      from public.list_my_supplier_rfqs() as summary
     where summary.rfq_id = $1::uuid
     order by summary.shop_id
  `, [rfqId]);
  check(offRows.length === 2 && offRows.every((row) => row.shop_name === 'O28 Shared Shop')
    && JSON.stringify(offRows.map((row) => row.shop_id)) === JSON.stringify(expectedShopIds),
  'authorized historic business labels remain visible with RFQ and parent product features off', {
    offRows,
    expectedShopIds,
    flags: { products: false, product_rfq: false, merchant_staff: true },
  });

  const privileges = await one(`
    select
      has_function_privilege('anon', 'public.list_my_supplier_rfqs()', 'execute') as anon_exec,
      has_function_privilege('authenticated', 'public.list_my_supplier_rfqs()', 'execute') as authenticated_exec
  `);
  check(privileges.anon_exec === false && privileges.authenticated_exec === true,
    'supplier RFQ list RPC remains executable only by authenticated users', privileges);
});

finish();

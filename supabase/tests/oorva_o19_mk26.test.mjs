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

async function expectDenied(run, pattern, label, state) {
  let actual = '<no error>';
  try {
    await run();
  } catch (error) {
    actual = error?.message ?? String(error);
  }
  check(pattern.test(actual), label, { error: actual, state });
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

async function makeFixture(label) {
  await setFlags({ products: true, enquiries: true, rfq: true });
  const customerId = await makeUser();
  const ownerId = await makeUser();
  const outsiderId = await makeUser();
  const categoryId = (await one(`
    insert into public.product_categories (slug, name, attribute_schema)
    values ($1::text, $2::text, '{}'::jsonb)
    returning id
  `, [`o19-${randomUUID().replace(/-/g, '')}`, `O19 ${label}`])).id;
  const shopId = (await one(`
    insert into public.shops (
      owner_id, name, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, status
    ) values (
      $1::uuid, $2::text, '1 O19 Market Road', 'Vijayawada', 'Benz Circle',
      16.5::double precision, 80.6::double precision, 20::int, true, true, 'verified'
    ) returning id
  `, [ownerId, `O19 ${label} ${randomUUID()}`])).id;
  await mapShopCategory(shopId, categoryId);
  const productId = await makeProduct(shopId, categoryId, `${label} primary`);
  return { customerId, ownerId, outsiderId, categoryId, shopId, productId };
}

async function mapShopCategory(shopId, categoryId) {
  await db.query(`
    insert into public.shop_categories (shop_id, category_id)
    values ($1::uuid, $2::uuid)
  `, [shopId, categoryId]);
}

async function makeShop(ownerId, label) {
  return (await one(`
    insert into public.shops (
      owner_id, name, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, status
    ) values (
      $1::uuid, $2::text, '2 O19 Market Road', 'Vijayawada', 'Benz Circle',
      16.5::double precision, 80.6::double precision, 20::int, true, true, 'verified'
    ) returning id
  `, [ownerId, `O19 ${label} ${randomUUID()}`])).id;
}

async function makeProduct(shopId, categoryId, label) {
  return (await one(`
    insert into public.products (
      shop_id, category_id, name, brand, model, description, in_stock
    ) values (
      $1::uuid, $2::uuid, $3::text, 'O19', '', 'O19 context fixture', true
    ) returning id
  `, [shopId, categoryId, `O19 product ${label} ${randomUUID()}`])).id;
}

async function startEnquiry(fixture, productId, body) {
  const result = await as(fixture.customerId, 'authenticated', `
    select public.start_product_enquiry(
      $1::uuid, $2::uuid, $3::text
    ) as id
  `, [fixture.shopId, productId, body]);
  return result[0].id;
}

async function setEnquiryStatus(uid, enquiryId, status) {
  return as(uid, 'authenticated', `
    select public.set_product_enquiry_status($1::uuid, $2::text)
  `, [enquiryId, status]);
}

async function createRfq(fixture) {
  const result = await as(fixture.customerId, 'authenticated', `
    select public.create_rfq(
      $1::uuid, $2::text, $3::jsonb, $4::text, $5::text,
      $6::double precision, $7::double precision, $8::boolean, $9::date, $10::text
    ) as id
  `, [
    fixture.categoryId,
    `O19 request ${randomUUID()}`,
    JSON.stringify([{
      description: 'O19 requested item',
      specs: {},
      quantity: 2,
      unit: 'piece',
    }]),
    'Vijayawada',
    'Benz Circle',
    16.5,
    80.6,
    true,
    '2027-01-15',
    'O19 stable enquiry-context fixture',
  ]);
  return result[0].id;
}

async function sendQuote(fixture, rfqId) {
  const item = await one(`
    select id from public.rfq_items
     where rfq_id = $1::uuid
     order by seq
     limit 1
  `, [rfqId]);
  const quote = await as(fixture.ownerId, 'authenticated', `
    select public.send_supplier_quote_for_business(
      $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int,
      $6::timestamptz, $7::text
    ) as id
  `, [
    rfqId,
    fixture.shopId,
    JSON.stringify([{
      rfq_item_id: item.id,
      brand: 'O19',
      model: 'Stable context offer',
      specs: {},
      unit_price_paise: 1250,
      gst_rate_bp: 0,
      available: true,
    }]),
    0,
    null,
    null,
    'O19 stable context quote',
  ]);
  return quote[0].id;
}

await scenario('MK-DELETE-product-plus-general-open-preserves-history', async () => {
  const fixture = await makeFixture('product-general-delete');
  const productEnquiryId = await startEnquiry(
    fixture,
    fixture.productId,
    'O19 product-specific enquiry',
  );
  const generalEnquiryId = await startEnquiry(
    fixture,
    null,
    'O19 genuine general enquiry',
  );
  const imagePath = `${fixture.shopId}/${randomUUID()}.jpg`;
  await db.query(
    `insert into storage.objects (bucket_id, name) values ('product-images'::text, $1::text)`,
    [imagePath],
  );
  await db.query(`
    insert into public.product_images (product_id, path, sort_order)
    values ($1::uuid, $2::text, $3::int)
  `, [fixture.productId, imagePath, 0]);

  const messagesBefore = (await db.query(`
    select id, enquiry_id, sender_id, body
      from public.product_enquiry_messages
     where enquiry_id = any($1::uuid[])
     order by id
  `, [[productEnquiryId, generalEnquiryId]])).rows;
  const deleted = await as(fixture.ownerId, 'authenticated', `
    select public.delete_product($1::uuid) as paths
  `, [fixture.productId]);
  const productRows = (await db.query(`
    select id from public.products where id = $1::uuid
  `, [fixture.productId])).rows;
  const imageRows = (await db.query(`
    select id from public.product_images where product_id = $1::uuid
  `, [fixture.productId])).rows;
  const threads = (await db.query(`
    select id, product_id, product_context_id, status
      from public.product_enquiries
     where id = any($1::uuid[])
     order by id
  `, [[productEnquiryId, generalEnquiryId]])).rows;
  const messagesAfter = (await db.query(`
    select id, enquiry_id, sender_id, body
      from public.product_enquiry_messages
     where enquiry_id = any($1::uuid[])
     order by id
  `, [[productEnquiryId, generalEnquiryId]])).rows;
  const productThread = threads.find((thread) => thread.id === productEnquiryId);
  const generalThread = threads.find((thread) => thread.id === generalEnquiryId);
  const actual = {
    deletedPaths: deleted[0].paths,
    productRows,
    imageRows,
    threads,
    messagesBefore,
    messagesAfter,
  };

  check(productRows.length === 0 && imageRows.length === 0
    && deleted[0].paths.includes(imagePath)
    && threads.length === 2
    && productThread?.product_id === null
    && productThread?.product_context_id === fixture.productId
    && productThread.status === 'open'
    && generalThread?.product_id === null
    && generalThread?.product_context_id === null
    && generalThread.status === 'open'
    && JSON.stringify(messagesAfter) === JSON.stringify(messagesBefore),
  'hard delete preserves distinct open product/general contexts, thread IDs and messages', actual);
});

await scenario('MK-DELETE-two-products-and-general-reuse', async () => {
  const fixture = await makeFixture('two-product-delete');
  const secondProductId = await makeProduct(
    fixture.shopId,
    fixture.categoryId,
    'second',
  );
  const firstProductThreadId = await startEnquiry(
    fixture,
    fixture.productId,
    'O19 first product enquiry',
  );
  const secondProductThreadId = await startEnquiry(
    fixture,
    secondProductId,
    'O19 second product enquiry',
  );
  const generalThreadId = await startEnquiry(
    fixture,
    null,
    'O19 general enquiry',
  );

  const firstDelete = await as(fixture.ownerId, 'authenticated', `
    select public.delete_product($1::uuid) as paths
  `, [fixture.productId]);
  const secondDelete = await as(fixture.ownerId, 'authenticated', `
    select public.delete_product($1::uuid) as paths
  `, [secondProductId]);
  const reusedGeneralId = await startEnquiry(
    fixture,
    null,
    'O19 reuse general enquiry after product deletion',
  );
  const rfqId = await createRfq(fixture);
  const quoteId = await sendQuote(fixture, rfqId);
  const selected = await as(fixture.customerId, 'authenticated', `
    select public.select_supplier_quote($1::uuid) as result
  `, [quoteId]);
  const threads = (await db.query(`
    select id, product_id, product_context_id, status
      from public.product_enquiries
     where shop_id = $1::uuid and customer_id = $2::uuid
     order by id
  `, [fixture.shopId, fixture.customerId])).rows;
  const messageCounts = (await db.query(`
    select e.id, count(m.id)::int as count
      from public.product_enquiries e
      left join public.product_enquiry_messages m on m.enquiry_id = e.id
     where e.shop_id = $1::uuid and e.customer_id = $2::uuid
     group by e.id
     order by e.id
  `, [fixture.shopId, fixture.customerId])).rows;
  const productThreadA = threads.find((thread) => thread.id === firstProductThreadId);
  const productThreadB = threads.find((thread) => thread.id === secondProductThreadId);
  const generalThread = threads.find((thread) => thread.id === generalThreadId);
  const actual = {
    firstDelete: firstDelete[0],
    secondDelete: secondDelete[0],
    selected: selected[0].result,
    threads,
    messageCounts,
  };

  check(new Set(threads.map((thread) => thread.id)).size === 3
    && threads.length === 3
    && productThreadA?.product_id === null
    && productThreadA?.product_context_id === fixture.productId
    && productThreadA.status === 'open'
    && productThreadB?.product_id === null
    && productThreadB?.product_context_id === secondProductId
    && productThreadB.status === 'open'
    && generalThread?.product_id === null
    && generalThread?.product_context_id === null
    && generalThread.status === 'open'
    && reusedGeneralId === generalThreadId
    && selected[0].result.enquiry_id === generalThreadId
    && messageCounts.find((row) => row.id === generalThreadId)?.count === 3,
  'two deletes preserve each product history and both general paths reuse only the general thread', actual);
});

await scenario('MK-REOPEN-context-immutability-and-authorization', async () => {
  const fixture = await makeFixture('reopen-authorization');
  const secondProductId = await makeProduct(
    fixture.shopId,
    fixture.categoryId,
    'reopen second',
  );
  const firstClosedThreadId = await startEnquiry(
    fixture,
    fixture.productId,
    'O19 first thread',
  );
  await setEnquiryStatus(fixture.customerId, firstClosedThreadId, 'closed');
  const sameContextOpenThreadId = await startEnquiry(
    fixture,
    fixture.productId,
    'O19 replacement same-context thread',
  );
  const otherContextThreadId = await startEnquiry(
    fixture,
    secondProductId,
    'O19 other-context thread',
  );
  const beforeDeniedReopen = (await db.query(`
    select id, product_id, product_context_id, status
      from public.product_enquiries
     where id = any($1::uuid[])
     order by id
  `, [[firstClosedThreadId, sameContextOpenThreadId, otherContextThreadId]])).rows;

  await expectDenied(
    () => setEnquiryStatus(fixture.customerId, firstClosedThreadId, 'open'),
    /another open enquiry already exists for this product context/i,
    'reopen is rejected only when another open thread has the same stable context',
    beforeDeniedReopen,
  );
  await setEnquiryStatus(fixture.customerId, sameContextOpenThreadId, 'closed');
  await setEnquiryStatus(fixture.customerId, firstClosedThreadId, 'open');

  const spoofContext = randomUUID();
  await expectDenied(
    () => db.query(`
      update public.product_enquiries
         set product_context_id = $2::uuid
       where id = $1::uuid
    `, [firstClosedThreadId, spoofContext]),
    /product enquiry context is immutable/i,
    'stored product context cannot be spoofed',
    beforeDeniedReopen,
  );
  await expectDenied(
    () => db.query(`
      update public.product_enquiries
         set product_context_id = null
       where id = $1::uuid
    `, [firstClosedThreadId]),
    /product enquiry context is immutable/i,
    'stored product context cannot be cleared',
    beforeDeniedReopen,
  );
  await expectDenied(
    () => db.query(`
      insert into public.product_enquiries (
        shop_id, product_id, product_context_id, customer_id, status
      ) values (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'closed'::text
      )
    `, [fixture.shopId, fixture.productId, spoofContext, fixture.outsiderId]),
    /product enquiry context is immutable/i,
    'new enquiry cannot spoof a different product context',
    beforeDeniedReopen,
  );
  await expectDenied(
    () => as(fixture.outsiderId, 'authenticated', `
      select * from public.get_product_enquiry($1::uuid)
    `, [firstClosedThreadId]),
    /enquiry not found/i,
    'outsider cannot read private enquiry history',
    beforeDeniedReopen,
  );
  await makeShop(fixture.outsiderId, 'outsider-owned');
  await expectDenied(
    () => as(fixture.outsiderId, 'authenticated', `
      select public.delete_product($1::uuid)
    `, [fixture.productId]),
    /product not found/i,
    'non-owner cannot delete the product',
    beforeDeniedReopen,
  );
  await expectDenied(
    () => as(fixture.customerId, 'authenticated', `
      select product_context_id
        from public.product_enquiries
       where id = $1::uuid
    `, [firstClosedThreadId]),
    /permission denied/i,
    'private stable context is not directly selectable by API users',
    beforeDeniedReopen,
  );
  const readableColumns = await as(fixture.customerId, 'authenticated', `
    select id, product_id, status
      from public.product_enquiries
     where id = $1::uuid
  `, [firstClosedThreadId]);
  const productRows = (await db.query(`
    select id from public.products where id = $1::uuid
  `, [fixture.productId])).rows;
  const finalThreads = (await db.query(`
    select id, product_id, product_context_id, status
      from public.product_enquiries
     where id = any($1::uuid[])
     order by id
  `, [[firstClosedThreadId, sameContextOpenThreadId, otherContextThreadId]])).rows;
  const reopenedThread = finalThreads.find((thread) => thread.id === firstClosedThreadId);
  const closedTwin = finalThreads.find((thread) => thread.id === sameContextOpenThreadId);
  const otherContext = finalThreads.find((thread) => thread.id === otherContextThreadId);
  const actual = { readableColumns, productRows, finalThreads, spoofContext };

  check(readableColumns.length === 1
    && productRows.length === 1
    && reopenedThread?.product_context_id === fixture.productId
    && reopenedThread.status === 'open'
    && closedTwin?.product_context_id === fixture.productId
    && closedTwin.status === 'closed'
    && otherContext?.product_context_id === secondProductId
    && otherContext.status === 'open',
  'authorized same-context reopen succeeds after conflict is removed while other context stays open', actual);
});

await scenario('MK-LEGACY-surviving-product-pointer-reuses-context', async () => {
  const fixture = await makeFixture('legacy-surviving-pointer');
  const originalThreadId = await startEnquiry(
    fixture,
    fixture.productId,
    'O19 legacy compatibility thread',
  );

  await db.exec('alter table public.product_enquiries disable trigger product_enquiries_preserve_context');
  try {
    await db.query(`
      update public.product_enquiries
         set product_context_id = null
       where id = $1::uuid
    `, [originalThreadId]);
  } finally {
    await db.exec('alter table public.product_enquiries enable trigger product_enquiries_preserve_context');
  }

  const reusedThreadId = await startEnquiry(
    fixture,
    fixture.productId,
    'O19 legacy pointer reuse',
  );
  const threads = (await db.query(`
    select id, product_id, product_context_id, status
      from public.product_enquiries
     where shop_id = $1::uuid and customer_id = $2::uuid
  `, [fixture.shopId, fixture.customerId])).rows;
  const messageCount = await one(`
    select count(*)::int as count
      from public.product_enquiry_messages
     where enquiry_id = $1::uuid
  `, [originalThreadId]);
  check(reusedThreadId === originalThreadId
    && threads.length === 1
    && threads[0].product_context_id === fixture.productId
    && threads[0].product_id === fixture.productId
    && threads[0].status === 'open'
    && messageCount.count === 2,
  'legacy surviving product pointer is used for lookup then lazily preserved without a duplicate thread',
  { reusedThreadId, threads, messageCount });
});

finish();

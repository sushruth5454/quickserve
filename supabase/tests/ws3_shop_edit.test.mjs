import { createHarness } from './harness.mjs';
import { createWs3TestContext, USERS } from './ws3-test-support.mjs';

const { ok, scenario, finish } = createHarness();
const { db, as, saveShop, createVerifiedShop, createProduct } = await createWs3TestContext();

await scenario('verified description edits keep the shop and products live', async () => {
  const shopId = await createVerifiedShop(USERS.ownerA);
  const productId = await createProduct(USERS.ownerA, { name: 'Porcelain wall tile', pricePaise: 25000 });

  await saveShop(USERS.ownerA, { description: 'Updated tile supplier profile' });
  const [shop] = await db.query(
    'select status, description from public.shops where id = $1::uuid',
    [shopId],
  ).then((result) => result.rows);
  const products = await as(USERS.customer, 'authenticated', `
    select id, shop_id from public.search_products(
      $1::text, $2::text, $3::double precision, $4::double precision, $5::int,
      $6::int, $7::boolean, $8::int
    )
  `, ['Porcelain', 'tiles', null, null, 15, null, false, 30]);

  ok(shop.status === 'verified' && shop.description === 'Updated tile supplier profile'
    && products.some((product) => product.id === productId && product.shop_id === shopId),
  `description edit state ${JSON.stringify({ shop, products })}`);
});

await scenario('identity edits send a verified shop to the submitted queue', async () => {
  const shopId = await createVerifiedShop(USERS.ownerB);

  await saveShop(USERS.ownerB, { addressLine: '28 New Market Road' });
  const [shop] = await db.query(
    'select status, address_line from public.shops where id = $1::uuid',
    [shopId],
  ).then((result) => result.rows);

  ok(shop.status === 'submitted' && shop.address_line === '28 New Market Road',
    `identity edit state ${JSON.stringify({ shop })}`);
});

await scenario('identity edits do not reactivate suspended shops', async () => {
  const shopId = await createVerifiedShop(USERS.ownerC);
  await as(USERS.admin, 'authenticated',
    'select public.admin_set_shop_status($1::uuid, $2::text, $3::text)',
    [shopId, 'suspended', 'Review required']);

  await saveShop(USERS.ownerC, { name: 'North Tiles Annex' });
  const [shop] = await db.query(
    'select status, status_reason, name from public.shops where id = $1::uuid',
    [shopId],
  ).then((result) => result.rows);
  ok(shop.status === 'suspended' && shop.status_reason === 'Review required' && shop.name === 'North Tiles Annex',
    `suspended shop state ${JSON.stringify({ shop })}`);
});

finish();
await db.close();

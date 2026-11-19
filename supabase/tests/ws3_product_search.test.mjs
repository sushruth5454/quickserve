import { createHarness } from './harness.mjs';
import { createWs3TestContext, USERS } from './ws3-test-support.mjs';

const { ok, scenario, finish } = createHarness();
const { db, as, createVerifiedShop, createProduct } = await createWs3TestContext();

async function search(query, options = {}) {
  return as(USERS.customer, 'authenticated', `
    select id, shop_id, name, distance_km from public.search_products(
      $1::text, $2::text, $3::double precision, $4::double precision, $5::int,
      $6::int, $7::boolean, $8::int
    )
  `, [
    query, options.category === undefined ? 'tiles' : options.category, options.lat ?? null, options.lng ?? null,
    options.radius ?? 100, null, false, 30,
  ]);
}

await scenario('English search matches a plural against a singular product name', async () => {
  const shopId = await createVerifiedShop(USERS.ownerA, { categorySlugs: ['other'] });
  const productId = await createProduct(USERS.ownerA, { name: 'Ceramic floor tile', categorySlug: 'other' });
  const products = await search('tiles', { category: null });

  ok(products.some((product) => product.id === productId && product.shop_id === shopId),
    `plural search results ${JSON.stringify({ expectedProductId: productId, products })}`);
});

await scenario('prefix search matches the start of a product word', async () => {
  await createVerifiedShop(USERS.ownerB);
  const productId = await createProduct(USERS.ownerB, { name: 'Porcelain wall tile' });
  const products = await search('porc');

  ok(products.some((product) => product.id === productId),
    `prefix search results ${JSON.stringify({ expectedProductId: productId, products })}`);
});

await scenario('search includes product descriptions', async () => {
  await createVerifiedShop(USERS.ownerC);
  const productId = await createProduct(USERS.ownerC, {
    name: 'Roofing membrane',
    description: 'Waterproof protection for outdoor roofs',
  });
  const products = await search('waterproof');

  ok(products.some((product) => product.id === productId),
    `description search results ${JSON.stringify({ expectedProductId: productId, products })}`);
});

await scenario('search includes product category names', async () => {
  await createVerifiedShop(USERS.ownerF, { categorySlugs: ['paints'] });
  const productId = await createProduct(USERS.ownerF, { name: 'Interior coating', categorySlug: 'paints' });
  const products = await search('paint', { category: null });

  ok(products.some((product) => product.id === productId),
    `category search results ${JSON.stringify({ expectedProductId: productId, products })}`);
});

await scenario('distance ordering remains intact after product search changes', async () => {
  const nearShopId = await createVerifiedShop(USERS.ownerD, { name: 'Near Tile Shop', lat: 16.5, lng: 80.6 });
  const nearProductId = await createProduct(USERS.ownerD, { name: 'Near floor tile' });
  const farShopId = await createVerifiedShop(USERS.ownerE, { name: 'Far Tile Shop', lat: 16.54, lng: 80.64 });
  const farProductId = await createProduct(USERS.ownerE, { name: 'Far floor tile' });

  const products = await search('floor', { lat: 16.5, lng: 80.6, radius: 100 });
  ok(products[0]?.id === nearProductId && products[0]?.shop_id === nearShopId
    && products.some((product) => product.id === farProductId && product.shop_id === farShopId)
    && products[0].distance_km <= (products.find((product) => product.id === farProductId)?.distance_km ?? Infinity),
  `distance-ordered results ${JSON.stringify({ nearProductId, farProductId, products })}`);
});

finish();
await db.close();

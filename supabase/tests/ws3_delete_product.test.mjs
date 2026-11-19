import { createHarness } from './harness.mjs';
import { createWs3TestContext, expectError, USERS } from './ws3-test-support.mjs';

const { ok, scenario, finish } = createHarness();
const { db, as, createVerifiedShop, createProduct } = await createWs3TestContext();

await scenario('hard deletion keeps enquiry history and cascades product image rows', async () => {
  const shopId = await createVerifiedShop(USERS.ownerA);
  const productId = await createProduct(USERS.ownerA, { name: 'Vitrified floor tile' });
  const imagePath = `${shopId}/catalogue-photo.jpg`;
  await db.query(
    `insert into storage.objects (bucket_id, name) values ('product-images'::text, $1::text)`,
    [imagePath],
  );
  await db.query(
    'insert into public.product_images (product_id, path, sort_order) values ($1::uuid, $2::text, $3::int)',
    [productId, imagePath, 0],
  );
  const [enquiry] = await as(USERS.customer, 'authenticated', `
    select public.start_product_enquiry($1::uuid, $2::uuid, $3::text) as id
  `, [shopId, productId, 'Is this available?']);

  const [deleted] = await as(USERS.ownerA, 'authenticated',
    'select public.delete_product($1::uuid) as paths', [productId]);
  const productRows = await db.query(
    'select id from public.products where id = $1::uuid',
    [productId],
  ).then((result) => result.rows);
  const imageRows = await db.query(
    'select id from public.product_images where product_id = $1::uuid',
    [productId],
  ).then((result) => result.rows);
  const [thread] = await db.query(`
    select e.product_id, e.status, p.name as product_name
      from public.product_enquiries e
      left join public.products p on p.id = e.product_id
     where e.id = $1::uuid
  `, [enquiry.id]).then((result) => result.rows);

  ok(productRows.length === 0 && imageRows.length === 0 && deleted.paths.includes(imagePath)
    && thread.product_id === null && thread.product_name === null && thread.status === 'open',
  `delete outcome ${JSON.stringify({ deletedPaths: deleted.paths, productRows, imageRows, thread })}`);
});

await scenario('a different shop owner cannot delete another shop product', async () => {
  await createVerifiedShop(USERS.ownerB, { name: 'Other Owner Tile Shop' });
  await createVerifiedShop(USERS.ownerC, { name: 'Deleting Owner Tile Shop' });
  const productId = await createProduct(USERS.ownerB, { name: 'Other owner product' });

  await expectError(ok,
    () => as(USERS.ownerC, 'authenticated', 'select public.delete_product($1::uuid)', [productId]),
    /product not found/,
    `cross-owner product delete ${JSON.stringify({ productId })}`);
  const products = await db.query(
    'select id from public.products where id = $1::uuid',
    [productId],
  ).then((result) => result.rows);
  ok(products.length === 1, `cross-owner product remains ${JSON.stringify({ productId, products })}`);
});

finish();
await db.close();

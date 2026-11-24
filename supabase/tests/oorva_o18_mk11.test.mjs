import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const { ok, scenario, finish } = createHarness();
let phoneSequence = 0;
const check = (condition, label, actual) => ok(condition, `${label}; actual=${JSON.stringify(actual)}`);

async function one(query, params = []) {
  return (await db.query(query, params)).rows[0];
}

async function expectDenied(run, pattern, label) {
  let actual = '<no error>';
  try {
    await run();
  } catch (error) {
    actual = error?.message ?? String(error);
  }
  check(pattern.test(actual), label, actual);
}

async function setFlags(products, enquiries) {
  await db.query(`
    update public.feature_flags as ff
       set enabled = case ff.key
         when 'products' then $1::boolean
         when 'product_enquiries' then $2::boolean
         else ff.enabled
       end
     where ff.key in ('products', 'product_enquiries')
  `, [products, enquiries]);
}

async function makeUser() {
  phoneSequence += 1;
  const id = randomUUID();
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, `+1556${String(phoneSequence).padStart(7, '0')}`]);
  return id;
}

async function makeFixture() {
  await setFlags(true, true);
  const ownerId = await makeUser();
  const customerId = await makeUser();
  const shop = await one(`
    insert into public.shops (
      owner_id, name, description, address_line, city, area, lat, lng,
      delivery_radius_km, offers_delivery, offers_pickup, status, gstin
    ) values (
      $1::uuid, $2::text, 'Public description', '1 O18 Private Road', 'Vijayawada', 'Benz Circle',
      16.5::double precision, 80.6::double precision, 20::int, true, true, 'verified', '29ABCDE1234F1Z5'
    ) returning id
  `, [ownerId, `O18 shop ${randomUUID()}`]);
  const category = await one(`
    select pc.id
      from public.product_categories as pc
     where pc.slug = $1::text
  `, ['tiles']);
  await db.query(`
    insert into public.shop_categories (shop_id, category_id)
    values ($1::uuid, $2::uuid)
  `, [shop.id, category.id]);
  const product = await one(`
    insert into public.products (
      shop_id, category_id, name, brand, model, description, in_stock
    ) values ($1::uuid, $2::uuid, $3::text, 'O18', '', 'Public product', false)
    returning id
  `, [shop.id, category.id, `O18 product ${randomUUID()}`]);
  return { ownerId, customerId, shopId: shop.id, productId: product.id };
}

await scenario('MK-ACTOR-safe-public-action-projection', async () => {
  const fixture = await makeFixture();
  const guestShop = await as(null, 'anon', `
    select * from public.get_shop($1::uuid)
  `, [fixture.shopId]);
  const guestProduct = await as(null, 'anon', `
    select * from public.get_product($1::uuid)
  `, [fixture.productId]);
  const shopRow = guestShop[0];
  const productRow = guestProduct[0];
  const privateColumns = ['owner_id', 'gstin', 'status_reason', 'payout_account', 'admin_reason'];
  const actual = {
    guestShop: shopRow,
    guestProduct: productRow,
    shopPrivateColumns: Object.keys(shopRow ?? {}).filter((key) => privateColumns.includes(key)),
    productPrivateColumns: Object.keys(productRow ?? {}).filter((key) => privateColumns.includes(key)),
  };
  check(guestShop.length === 1
    && shopRow.address_line === null && shopRow.lat === null && shopRow.lng === null
    && shopRow.can_enquire === false && shopRow.enquiry_block_reason === 'sign_in'
    && guestProduct.length === 1
    && productRow.can_enquire === false && productRow.enquiry_block_reason === 'sign_in'
    && actual.shopPrivateColumns.length === 0 && actual.productPrivateColumns.length === 0,
  'guest shop/product DTOs redact address, coordinates, owner/admin fields and expose only a safe sign-in action reason',
  actual);

  const ownerShop = await as(fixture.ownerId, 'authenticated', `
    select address_line, lat, lng, can_enquire, enquiry_block_reason
      from public.get_shop($1::uuid)
  `, [fixture.shopId]);
  check(ownerShop.length === 1
    && ownerShop[0].address_line === '1 O18 Private Road'
    && ownerShop[0].lat === 16.5 && ownerShop[0].lng === 80.6
    && ownerShop[0].can_enquire === false && ownerShop[0].enquiry_block_reason === 'own_shop',
  'owner retains authenticated shop details but receives no self-enquiry capability',
  ownerShop);

  await setFlags(true, false);
  const disabled = await as(fixture.customerId, 'authenticated', `
    select can_enquire, enquiry_block_reason
      from public.get_product($1::uuid)
  `, [fixture.productId]);
  check(disabled.length === 1 && disabled[0].can_enquire === false
    && disabled[0].enquiry_block_reason === 'feature_off',
  'feature-off projection fails closed with the safe reason', disabled);

  const grants = await one(`
    select has_function_privilege('anon', 'public.get_shop(uuid)', 'execute') as anon_shop,
           has_function_privilege('authenticated', 'public.get_shop(uuid)', 'execute') as user_shop,
           has_function_privilege('anon', 'public.get_product(uuid)', 'execute') as anon_product,
           has_function_privilege('authenticated', 'public.get_product(uuid)', 'execute') as user_product
  `);
  check(grants.anon_shop && grants.user_shop && grants.anon_product && grants.user_product,
    'public read RPC grants are explicitly restored after return-table replacement', grants);
});

await scenario('MK-ACTOR-no-guest-or-owner-mutation-and-out-of-stock-customer-allowed', async () => {
  const fixture = await makeFixture();
  const before = await one(`
    select count(*)::int as enquiries,
           (select count(*)::int from public.product_enquiry_messages as pem) as messages
      from public.product_enquiries as pe
     where pe.shop_id = $1::uuid
  `, [fixture.shopId]);

  await expectDenied(() => as(null, 'anon', `
    select public.start_product_enquiry($1::uuid, $2::uuid, $3::text)
  `, [fixture.shopId, fixture.productId, 'Guest must sign in']), /permission denied|not authenticated|sign in/i,
  'guest cannot invoke a mutation before sign-in');
  const afterGuest = await one(`
    select count(*)::int as enquiries,
           (select count(*)::int from public.product_enquiry_messages as pem) as messages
      from public.product_enquiries as pe
     where pe.shop_id = $1::uuid
  `, [fixture.shopId]);
  check(before.enquiries === afterGuest.enquiries && before.messages === afterGuest.messages,
    'guest mutation count remains zero before authentication', { before, afterGuest });

  await expectDenied(() => as(fixture.ownerId, 'authenticated', `
    select public.start_product_enquiry($1::uuid, $2::uuid, $3::text)
  `, [fixture.shopId, fixture.productId, 'Owner cannot self-enquire']), /cannot enquire with your own shop/i,
  'owner direct SQL self-enquiry is denied');
  const afterOwner = await one(`
    select count(*)::int as enquiries,
           (select count(*)::int from public.product_enquiry_messages as pem) as messages
      from public.product_enquiries as pe
     where pe.shop_id = $1::uuid
  `, [fixture.shopId]);
  check(before.enquiries === afterOwner.enquiries && before.messages === afterOwner.messages,
    'owner denial creates no enquiry or message', { before, afterOwner });

  const eligible = await as(fixture.customerId, 'authenticated', `
    select p.in_stock, g.can_enquire, g.enquiry_block_reason
      from public.get_product($1::uuid) as g
      join public.products as p on p.id = g.id
  `, [fixture.productId]);
  const created = await as(fixture.customerId, 'authenticated', `
    select public.start_product_enquiry($1::uuid, $2::uuid, $3::text) as id
  `, [fixture.shopId, fixture.productId, 'Is this available next week?']);
  const message = await one(`
    select pem.body
      from public.product_enquiry_messages as pem
     where pem.enquiry_id = $1::uuid
  `, [created[0].id]);
  check(eligible.length === 1 && eligible[0].in_stock === false
    && eligible[0].can_enquire === true && eligible[0].enquiry_block_reason === null
    && !!created[0].id && message.body === 'Is this available next week?',
  'authorized customer can enquire about an out-of-stock product and the server records the message',
  { eligible, created, message });
});

finish();

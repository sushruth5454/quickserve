import { createHarness } from './harness.mjs';
import { db } from './r1-test-harness.mjs';

const { ok, scenario, finish } = createHarness();
let nextFixture = 1;

async function as(uid, role, query, params = [], extraClaims = {}) {
  await db.exec('reset role');
  await db.query(`
    select set_config('request.jwt.claim.sub', $1::text, false),
           set_config('request.jwt.claim.role', $2::text, false),
           set_config('request.jwt.claims', $3::text, false)
  `, [uid ?? '', role, JSON.stringify({ sub: uid, role, ...extraClaims })]);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function createUser(label) {
  const sequence = nextFixture++;
  const userId = `d0270000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data, raw_app_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb, '{}'::jsonb)
    on conflict (id) do nothing
  `, [userId, `+91900100${String(sequence).padStart(4, '0')}`]);
  await db.query(`
    insert into public.profiles (id, full_name)
    values ($1::uuid, $2::text)
    on conflict (id) do update set full_name = excluded.full_name
  `, [userId, label]);
  return userId;
}

async function enableFlag(key, enabled) {
  await db.query(`
    update public.feature_flags as f
       set enabled = $1::boolean
     where f.key = $2::text
  `, [enabled, key]);
}

async function createShop(ownerId, overrides = {}) {
  await enableFlag('products', true);
  const shop = {
    name: `O27 Shop ${ownerId.slice(-6)}`,
    description: 'Original shop description',
    addressLine: '12 Market Road',
    city: 'Vijayawada',
    area: 'Benz Circle',
    lat: 16.5,
    lng: 80.6,
    deliveryRadiusKm: 20,
    offersDelivery: true,
    offersPickup: true,
    whatsappContact: false,
    gstin: null,
    categorySlugs: ['tiles'],
    ...overrides,
  };
  const [row] = await as(ownerId, 'authenticated', `
    select public.save_shop(
      $1::text, $2::text, $3::text, $4::text, $5::text, $6::double precision, $7::double precision,
      $8::int, $9::boolean, $10::boolean, $11::boolean, $12::text, $13::text[]
    ) as id
  `, [
    shop.name, shop.description, shop.addressLine, shop.city, shop.area, shop.lat, shop.lng,
    shop.deliveryRadiusKm, shop.offersDelivery, shop.offersPickup, shop.whatsappContact,
    shop.gstin, shop.categorySlugs,
  ]);
  return row.id;
}

async function setShopState(shopId, status, reason = null) {
  await db.query(`
    update public.shops as s
       set status = $2::text, status_reason = $3::text, updated_at = now()
     where s.id = $1::uuid
  `, [shopId, status, reason]);
}

async function readShop(shopId) {
  const [row] = await db.query(`
    select s.id::text as id, s.owner_id::text as owner_id, s.status::text as status,
           s.status_reason as status_reason, s.updated_at::text as updated_at,
           s.name as name, s.description as description, s.address_line as address_line
      from public.shops as s
     where s.id = $1::uuid
  `, [shopId]).then((result) => result.rows);
  return row;
}

async function captureFailure(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error?.message ?? String(error);
  }
}

async function submit(ownerId, shopId, extraClaims = {}) {
  return as(ownerId, 'authenticated', 'select public.submit_shop($1::uuid)', [shopId], extraClaims);
}

async function createAdmin(label = 'O27 Shop Admin') {
  const adminId = await createUser(label);
  await db.query(`
    insert into public.admins (user_id)
    values ($1::uuid)
    on conflict (user_id) do nothing
  `, [adminId]);
  return adminId;
}

await scenario('MK-SHOP-owner-submit-allowed: complete draft', async () => {
  const ownerId = await createUser('O27 Draft Owner');
  const shopId = await createShop(ownerId);
  await submit(ownerId, shopId);
  const shop = await readShop(shopId);

  ok(shop.status === 'submitted' && shop.status_reason === null,
    `complete owner draft is submitted with no reason ${JSON.stringify({ shop })}`);
});

await scenario('MK-SHOP-owner-submit-allowed: complete rejected shop clears reason', async () => {
  const ownerId = await createUser('O27 Rejected Owner');
  const shopId = await createShop(ownerId);
  await setShopState(shopId, 'rejected', 'Please update shop details');
  await submit(ownerId, shopId);
  const shop = await readShop(shopId);

  ok(shop.status === 'submitted' && shop.status_reason === null,
    `complete owner rejected shop is resubmitted and reason cleared ${JSON.stringify({ shop })}`);
});

for (const status of ['verified', 'submitted', 'under_review', 'suspended']) {
  await scenario(`MK-SHOP-reviewed-reset-denied: ${status}`, async () => {
    const ownerId = await createUser(`O27 ${status} Owner`);
    const shopId = await createShop(ownerId);
    await setShopState(shopId, status, status === 'suspended' ? 'Review required' : null);
    const before = await readShop(shopId);
    const error = await captureFailure(() => submit(ownerId, shopId));
    const after = await readShop(shopId);

    ok(error?.includes('only draft or rejected shops can be submitted')
      && JSON.stringify(before) === JSON.stringify(after),
    `owner ${status} resubmission is denied without row changes ${JSON.stringify({ error, before, after })}`);
  });
}

for (const businessRole of ['manager', 'staff']) {
  await scenario(`MK-SHOP-submit-roles-and-parent: ${businessRole} cannot submit for owner`, async () => {
    const ownerId = await createUser(`O27 ${businessRole} Shop Owner`);
    const memberId = await createUser(`O27 ${businessRole} Member`);
    const shopId = await createShop(ownerId);
    await createShop(memberId);
    await enableFlag('merchant_staff', true);
    await db.query(`
      insert into public.business_members (owner_id, member_id, role, active)
      values ($1::uuid, $2::uuid, $3::text, true)
      on conflict (owner_id, member_id)
      do update set role = excluded.role, active = true
    `, [ownerId, memberId, businessRole]);
    const [membership] = await db.query(`
      select bm.role as role
        from public.business_members as bm
       where bm.owner_id = $1::uuid and bm.member_id = $2::uuid
    `, [ownerId, memberId]).then((result) => result.rows);
    const before = await readShop(shopId);
    const error = await captureFailure(() => submit(memberId, shopId, {
      business_role: 'owner',
      user_metadata: { business_role: 'owner' },
      app_metadata: { business_role: 'owner' },
    }));
    const after = await readShop(shopId);

    ok(membership?.role === businessRole && error?.includes('shop not found')
      && JSON.stringify(before) === JSON.stringify(after),
    `${businessRole} with fabricated owner claims cannot submit ${JSON.stringify({ membership, error, before, after })}`);
  });
}

await scenario('MK-SHOP-submit-roles-and-parent: another owner cannot submit this shop', async () => {
  const ownerId = await createUser('O27 Target Shop Owner');
  const otherOwnerId = await createUser('O27 Other Shop Owner');
  const shopId = await createShop(ownerId);
  await createShop(otherOwnerId);
  const before = await readShop(shopId);
  const error = await captureFailure(() => submit(otherOwnerId, shopId, {
    business_role: 'owner',
    user_metadata: { business_role: 'owner' },
  }));
  const after = await readShop(shopId);

  ok(error?.includes('shop not found') && JSON.stringify(before) === JSON.stringify(after),
    `different owner with fabricated owner claim is denied ${JSON.stringify({ error, before, after })}`);
});

await scenario('MK-SHOP-save-regression: verified description-only edit stays verified', async () => {
  const ownerId = await createUser('O27 Verified Description Owner');
  const shopId = await createShop(ownerId);
  await setShopState(shopId, 'verified');
  const before = await readShop(shopId);
  const [saved] = await as(ownerId, 'authenticated', `
    select public.save_shop(
      $1::text, $2::text, $3::text, $4::text, $5::text, $6::double precision, $7::double precision,
      $8::int, $9::boolean, $10::boolean, $11::boolean, $12::text, $13::text[]
    ) as id
  `, [
    before.name, 'Description changed', before.address_line, 'Vijayawada', 'Benz Circle',
    16.5, 80.6, 20, true, true, false, null, ['tiles'],
  ]);
  const shop = await readShop(saved.id);

  ok(saved.id === shopId && shop.status === 'verified' && shop.description === 'Description changed',
    `verified description-only save preserves verification ${JSON.stringify({ saved, shop })}`);
});

await scenario('MK-SHOP-save-regression: verified identity edit still submits', async () => {
  const ownerId = await createUser('O27 Verified Identity Owner');
  const shopId = await createShop(ownerId);
  await setShopState(shopId, 'verified');
  const before = await readShop(shopId);
  const [saved] = await as(ownerId, 'authenticated', `
    select public.save_shop(
      $1::text, $2::text, $3::text, $4::text, $5::text, $6::double precision, $7::double precision,
      $8::int, $9::boolean, $10::boolean, $11::boolean, $12::text, $13::text[]
    ) as id
  `, [
    before.name, 'Original shop description', '28 New Market Road', 'Vijayawada', 'Benz Circle',
    16.5, 80.6, 20, true, true, false, null, ['tiles'],
  ]);
  const shop = await readShop(saved.id);

  ok(saved.id === shopId && shop.status === 'submitted' && shop.address_line === '28 New Market Road',
    `verified identity edit still returns the shop to submitted ${JSON.stringify({ saved, shop })}`);
});

await scenario('MK-SHOP-submit-roles-and-parent: products OFF blocks new submit but admin history remains readable', async () => {
  const ownerId = await createUser('O27 Products Off Owner');
  const adminId = await createAdmin('O27 Products Off Admin');
  const shopId = await createShop(ownerId);
  const before = await readShop(shopId);
  await enableFlag('products', false);
  const error = await captureFailure(() => submit(ownerId, shopId));
  const after = await readShop(shopId);
  const [existingRead] = await as(adminId, 'authenticated', `
    select s.id::text as id, s.status::text as status
      from public.admin_list_shops($1::text) as s
     where s.id = $2::uuid
  `, ['all', shopId]);

  ok(error?.includes('products are disabled') && JSON.stringify(before) === JSON.stringify(after)
    && existingRead?.id === shopId && existingRead.status === 'draft',
  `products OFF rejects new submission and preserves authorized admin history read ${JSON.stringify({
    error, before, after, existingRead,
  })}`);
});

await scenario('MK-SHOP-submit-validation: incomplete address remains denied', async () => {
  const ownerId = await createUser('O27 Incomplete Address Owner');
  const shopId = await createShop(ownerId, { addressLine: '', lat: null, lng: null });
  const before = await readShop(shopId);
  const error = await captureFailure(() => submit(ownerId, shopId));
  const after = await readShop(shopId);

  ok(error?.includes('complete the shop address and map location before submitting')
    && JSON.stringify(before) === JSON.stringify(after),
  `incomplete shop cannot submit ${JSON.stringify({ error, before, after })}`);
});

await scenario('MK-SHOP-submit-validation: missing category remains denied', async () => {
  const ownerId = await createUser('O27 No Category Owner');
  const shopId = await createShop(ownerId);
  await db.query(`
    delete from public.shop_categories as sc
     where sc.shop_id = $1::uuid
  `, [shopId]);
  const before = await readShop(shopId);
  const error = await captureFailure(() => submit(ownerId, shopId));
  const after = await readShop(shopId);

  ok(error?.includes('choose at least one product category')
    && JSON.stringify(before) === JSON.stringify(after),
  `shop without an effective category cannot submit ${JSON.stringify({ error, before, after })}`);
});

await scenario('MK-SHOP-submit-grants: authenticated execution remains granted', async () => {
  const [privileges] = await db.query(`
    select has_function_privilege(
             'authenticated'::name, 'public.submit_shop(uuid)'::regprocedure, 'EXECUTE'
           ) as authenticated,
           has_function_privilege(
             'anon'::name, 'public.submit_shop(uuid)'::regprocedure, 'EXECUTE'
           ) as anon
  `).then((result) => result.rows);

  ok(privileges.authenticated === true && privileges.anon === false,
    `submit_shop authenticated grant is retained and anon remains denied ${JSON.stringify({ privileges })}`);
});

finish();
await db.close();

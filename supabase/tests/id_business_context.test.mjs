import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const originalFlags = (await db.query(`
  select key, enabled from public.feature_flags
   where key in ('merchant_staff', 'products')
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
const safeShopKeys = [
  'address_line', 'area', 'business_role', 'category_slugs', 'city', 'delivery_radius_km', 'description',
  'gstin', 'id', 'lat', 'lng', 'name', 'offers_delivery', 'offers_pickup', 'owner_id', 'status',
  'status_reason', 'whatsapp_contact',
].sort();

async function one(query, params = []) {
  return (await db.query(query, params)).rows[0];
}

async function makeUser() {
  const id = randomUUID();
  const digits = randomUUID().replace(/\D/g, '').padEnd(10, '0').slice(0, 10);
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, `+1555${digits}`]);
  return id;
}

async function setFlags(merchantStaff, products) {
  await db.query(`
    update public.feature_flags
       set enabled = case key
         when 'merchant_staff' then $1::boolean
         when 'products' then $2::boolean
         else enabled
       end
     where key in ('merchant_staff', 'products')
  `, [merchantStaff, products]);
}

async function addMembership(ownerId, memberId, role = 'manager', active = true) {
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values ($1::uuid, $2::uuid, $3::text, $4::boolean)
  `, [ownerId, memberId, role, active]);
}

async function addShop(ownerId, name, gstin = null) {
  return (await one(`
    insert into public.shops (
      owner_id, name, description, address_line, city, area, lat, lng, gstin, status
    ) values (
      $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
      $7::double precision, $8::double precision, $9::text, $10::text
    ) returning id::text as id
  `, [
    ownerId,
    name,
    `Description for ${name}`,
    '1 Context Road',
    'Vijayawada',
    'Benz Circle',
    16.5,
    80.6,
    gstin,
    'verified',
  ])).id;
}

async function addVenue(ownerId, name) {
  return (await one(`
    insert into public.sports_venues (owner_id, name, address_line, city, area, lat, lng)
    values ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::double precision, $7::double precision)
    returning id::text as id
  `, [ownerId, name, '2 Venue Road', 'Vijayawada', 'Benz Circle', 16.5, 80.6])).id;
}

async function getSelectedShop(uid, ownerId) {
  return (await as(uid, 'authenticated', `
    select public.get_business_shop_context($1::uuid) as context
  `, [ownerId]))[0].context;
}

async function expectDenied(run, label, expectedMessage, state) {
  let actual = '<no error>';
  try {
    await run();
  } catch (error) {
    actual = error?.message ?? String(error);
  }
  check(actual.toLowerCase().includes(expectedMessage.toLowerCase()), label, { error: actual, state });
}

await scenario('ID-MEM-BUSINESS-PKS', async () => {
  await setFlags(true, true);
  const ownerId = await makeUser();
  const memberId = await makeUser();
  const providerId = (await one(`
    insert into public.providers (id, city) values ($1::uuid, $2::text)
    returning id::text as id
  `, [ownerId, `O28 provider ${randomUUID()}`])).id;
  const shopId = await addShop(ownerId, `O28 PK shop ${randomUUID()}`);
  const venueId = await addVenue(ownerId, `O28 PK venue ${randomUUID()}`);
  await addMembership(ownerId, memberId);

  const rows = await as(memberId, 'authenticated', `
    select business_id::text as business_id, owner_id::text as owner_id, role, business_type, business_name
      from public.list_my_business_memberships()
  `);
  const byType = Object.fromEntries(rows.map((row) => [row.business_type, row]));
  check(
    rows.length === 3
      && byType.provider?.business_id === providerId
      && byType.shop?.business_id === shopId
      && byType.sports?.business_id === venueId
      && rows.every((row) => row.owner_id === ownerId && row.role === 'manager'),
    'ID-MEM-BUSINESS-PKS: provider, shop and venue identities use their actual primary keys',
    { rows, expected: { providerId, shopId, venueId, ownerId } },
  );
});

await scenario('ID-MULTI-VENUE-SAME-NAME', async () => {
  await setFlags(true, true);
  const ownerId = await makeUser();
  const memberId = await makeUser();
  const venueName = `O28 Shared venue ${randomUUID()}`;
  const firstVenueId = await addVenue(ownerId, venueName);
  const secondVenueId = await addVenue(ownerId, venueName);
  await addMembership(ownerId, memberId);

  const rows = await as(memberId, 'authenticated', `
    select business_id::text as business_id, owner_id::text as owner_id, role, business_type, business_name
      from public.list_my_business_memberships()
     where business_type = $1::text
     order by business_id
  `, ['sports']);
  const ids = rows.map((row) => row.business_id);
  check(
    rows.length === 2
      && new Set(ids).size === 2
      && ids.includes(firstVenueId)
      && ids.includes(secondVenueId)
      && rows.every((row) => row.owner_id === ownerId && row.business_name === venueName),
    'ID-MULTI-VENUE-SAME-NAME: owner-wide membership retains both same-name venue PKs',
    { rows, expectedIds: [firstVenueId, secondVenueId], ownerId, venueName },
  );
});

await scenario('ID-SHOP-SELECT-B', async () => {
  await setFlags(true, true);
  const actorId = await makeUser();
  const ownerAId = await makeUser();
  const ownerBId = await makeUser();
  const shopAName = `O28 Shop A ${randomUUID()}`;
  const shopBName = `O28 Shop B ${randomUUID()}`;
  const shopAId = await addShop(ownerAId, shopAName);
  const shopBId = await addShop(ownerBId, shopBName);
  await addMembership(ownerAId, actorId);
  await addMembership(ownerBId, actorId);

  const context = await getSelectedShop(actorId, ownerBId);
  check(
    context?.id === shopBId
      && context?.owner_id === ownerBId
      && context?.name === shopBName
      && context?.business_role === 'manager'
      && context?.gstin === null
      && JSON.stringify(Object.keys(context ?? {}).sort()) === JSON.stringify(safeShopKeys),
    'ID-SHOP-SELECT-B: explicit owner B returns only its safe shop context',
    { context, shopAId, shopAName, shopBId, shopBName, ownerAId, ownerBId, safeShopKeys },
  );
});

await scenario('ID-SHOP-DENY', async () => {
  await setFlags(true, true);
  const ownerId = await makeUser();
  const activeMemberId = await makeUser();
  const inactiveMemberId = await makeUser();
  const strangerId = await makeUser();
  const shopId = await addShop(ownerId, `O28 Denial shop ${randomUUID()}`, '27ABCDE1234F1Z5');
  await addMembership(ownerId, activeMemberId, 'manager', true);
  await addMembership(ownerId, inactiveMemberId, 'manager', false);

  await expectDenied(
    () => getSelectedShop(strangerId, ownerId),
    'ID-SHOP-DENY: stranger cannot read selected private shop context',
    'business access denied',
    { shopId, ownerId, actorId: strangerId, merchantStaff: true },
  );
  await expectDenied(
    () => getSelectedShop(inactiveMemberId, ownerId),
    'ID-SHOP-DENY: inactive membership cannot read selected private shop context',
    'business access denied',
    { shopId, ownerId, actorId: inactiveMemberId, merchantStaff: true },
  );

  await setFlags(false, true);
  await expectDenied(
    () => getSelectedShop(activeMemberId, ownerId),
    'ID-SHOP-DENY: delegated member is denied when merchant_staff is OFF',
    'business access denied',
    { shopId, ownerId, actorId: activeMemberId, merchantStaff: false },
  );
  const ownerContext = await getSelectedShop(ownerId, ownerId);
  check(
    ownerContext?.id === shopId && ownerContext?.business_role === 'owner' && ownerContext?.gstin === '27ABCDE1234F1Z5',
    'ID-SHOP-DENY: actual owner retains owner-rank GSTIN access when merchant_staff is OFF',
    { ownerContext, shopId, ownerId, merchantStaff: false },
  );
});

await scenario('ID-SHOP-FLAG-PARENTS', async () => {
  await setFlags(true, false);
  const ownerId = await makeUser();
  const staffId = await makeUser();
  const shopId = await addShop(ownerId, `O28 History while products OFF ${randomUUID()}`);
  await addMembership(ownerId, staffId, 'staff', true);

  const ownerContext = await getSelectedShop(ownerId, ownerId);
  const staffContext = await getSelectedShop(staffId, ownerId);
  check(
    ownerContext?.id === shopId
      && staffContext?.id === shopId
      && ownerContext?.category_slugs?.length === 0
      && staffContext?.category_slugs?.length === 0,
    'ID-SHOP-FLAG-PARENTS: authorized existing history remains readable with products OFF',
    { ownerContext, staffContext, shopId, merchantStaff: true, products: false },
  );

  const categoryId = randomUUID();
  await expectDenied(
    () => as(ownerId, 'authenticated', `
      select public.save_product(
        null::uuid, $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::jsonb,
        $7::text, $8::int, $9::boolean, $10::boolean, $11::text[]
      )
    `, [categoryId, 'O28 disabled product', '', '', '', '{}', 'piece', 100, true, true, []]),
    'ID-SHOP-FLAG-PARENTS: new product work remains denied with products OFF',
    'products are disabled',
    { shopId, ownerId, products: false, categoryId },
  );
});

await scenario('ID-LEGACY-SHOP-READ', async () => {
  await setFlags(false, false);
  const ownerId = await makeUser();
  const shopId = await addShop(ownerId, `O28 Legacy shop ${randomUUID()}`, '27ABCDE1234F1Z5');
  const rows = await as(ownerId, 'authenticated', `
    select public.get_my_business_shop() as context
  `);
  const context = rows[0].context;
  check(
    context?.id === shopId
      && context?.owner_id === ownerId
      && context?.business_role === 'owner'
      && context?.gstin === '27ABCDE1234F1Z5'
      && context?.category_slugs?.length === 0
      && JSON.stringify(Object.keys(context ?? {}).sort()) === JSON.stringify(safeShopKeys),
    'ID-LEGACY-SHOP-READ: legacy no-argument history remains available and safe with features OFF',
    { context, shopId, ownerId, merchantStaff: false, products: false, safeShopKeys },
  );
});

finish();

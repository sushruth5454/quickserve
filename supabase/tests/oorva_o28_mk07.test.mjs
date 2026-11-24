import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const originalFlags = (await db.query(`
  select key, enabled from public.feature_flags
   where key in ('products', 'product_enquiries', 'product_rfq', 'merchant_staff')
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

async function setFlags({ products = true, enquiries = true, rfq = true, staff = true } = {}) {
  await db.query(`
    update public.feature_flags
       set enabled = case key
         when 'products' then $1::boolean
         when 'product_enquiries' then $2::boolean
         when 'product_rfq' then $3::boolean
         when 'merchant_staff' then $4::boolean
         else enabled
       end
     where key in ('products', 'product_enquiries', 'product_rfq', 'merchant_staff')
  `, [products, enquiries, rfq, staff]);
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

async function makeCategory(name) {
  return (await one(`
    insert into public.product_categories (slug, name, attribute_schema)
    values ($1::text, $2::text, $3::jsonb)
    returning id
  `, [
    `o28-${randomUUID().replace(/-/g, '')}`,
    name,
    JSON.stringify({ properties: { finish: { type: 'string' } } }),
  ])).id;
}

async function makeShop(ownerId, categoryId, label, mapped = true) {
  const shop = await one(`
    insert into public.shops (
      owner_id, name, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, status
    ) values (
      $1::uuid, $2::text, '1 O28 Market Road', 'Pune', 'Shivaji Nagar',
      18.52::double precision, 73.85::double precision, 20::int, true, true, 'verified'
    ) returning id
  `, [ownerId, `O28 ${label} ${randomUUID()}`]);
  if (mapped) {
    await db.query(`
      insert into public.shop_categories (shop_id, category_id)
      values ($1::uuid, $2::uuid)
    `, [shop.id, categoryId]);
  }
  return shop.id;
}

async function makeFixture(label) {
  await setFlags();
  const customerId = await makeUser();
  const ownerId = await makeUser();
  const managerId = await makeUser();
  const staffId = await makeUser();
  const outsiderId = await makeUser();
  const categoryId = await makeCategory(`O28 ${label}`);
  const shopId = await makeShop(ownerId, categoryId, label);
  return { customerId, ownerId, managerId, staffId, outsiderId, categoryId, shopId };
}

async function createRfq(fixture) {
  const result = await as(fixture.customerId, 'authenticated', `
    select public.create_rfq(
      $1::uuid, $2::text, $3::jsonb, $4::text, $5::text,
      $6::double precision, $7::double precision, $8::boolean, $9::date, $10::text
    ) as id
  `, [
    fixture.categoryId,
    `O28 request ${randomUUID()}`,
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
    'O28 supplier detail fixture',
  ]);
  return result[0].id;
}

async function sendQuote(fixture, rfqId, shopId = fixture.shopId, notes = 'O28 own saved terms') {
  const items = (await db.query(`
    select id from public.rfq_items where rfq_id = $1::uuid order by seq
  `, [rfqId])).rows;
  const quoteItems = items.map((item) => ({
    rfq_item_id: item.id,
    brand: 'Aster',
    model: 'A-7',
    specs: { finish: 'matte' },
    unit_price_paise: 1234,
    gst_rate_bp: 0,
    available: true,
    offered_quantity: 3,
  }));
  const owner = shopId === fixture.shopId
    ? fixture.ownerId
    : (await one('select owner_id from public.shops where id = $1::uuid', [shopId])).owner_id;
  const result = await as(owner, 'authenticated', `
    select public.send_supplier_quote_for_business(
      $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int,
      $6::timestamptz, $7::text
    ) as id
  `, [rfqId, shopId, JSON.stringify(quoteItems), 234, 5, null, notes]);
  return result[0].id;
}

async function readSupplierRfq(actorId, rfqId, shopId) {
  const result = await as(actorId, 'authenticated', `
    select public.get_supplier_rfq_for_business($1::uuid, $2::uuid) as value
  `, [rfqId, shopId]);
  return result[0].value;
}

await scenario('MK-SUPPLIER-latest-terminal-own-read', async () => {
  const fixture = await makeFixture('latest-terminal');
  const secondOwnerId = await makeUser();
  const thirdOwnerId = await makeUser();
  const secondShopId = await makeShop(secondOwnerId, fixture.categoryId, 'competitor');
  const thirdShopId = await makeShop(thirdOwnerId, fixture.categoryId, 'expired-competitor');
  const duplicateNameCategoryId = await makeCategory(`O28 ${'latest-terminal'}`);
  const rfqId = await createRfq(fixture);
  await sendQuote(fixture, rfqId, fixture.shopId, 'O28 previous own version');
  const ownQuoteId = await sendQuote(fixture, rfqId, fixture.shopId, 'O28 own saved terms');
  const rejectedQuoteId = await sendQuote(fixture, rfqId, secondShopId, 'O28 competitor private terms');
  const expiredQuoteId = await sendQuote(fixture, rfqId, thirdShopId, 'O28 expired competitor private terms');
  await db.query(`
    update public.supplier_quotes set status = 'expired', updated_at = now()
     where id = $1::uuid
  `, [expiredQuoteId]);
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values
      ($1::uuid, $2::uuid, 'manager', true),
      ($1::uuid, $3::uuid, 'staff', true),
      ($1::uuid, $4::uuid, 'manager', false)
  `, [fixture.ownerId, fixture.managerId, fixture.staffId, fixture.outsiderId]);

  const manager = await readSupplierRfq(fixture.managerId, rfqId, fixture.shopId);
  check(manager.business_role === 'manager' && manager.can_send_quote === true
    && manager.send_block_reason === null,
  'authorized manager can send while shop and RFQ are eligible', {
    role: manager.business_role,
    can_send_quote: manager.can_send_quote,
    send_block_reason: manager.send_block_reason,
  });

  const staff = await readSupplierRfq(fixture.staffId, rfqId, fixture.shopId);
  check(staff.business_role === 'staff' && staff.can_send_quote === false
    && staff.send_block_reason === 'role_not_permitted'
    && staff.my_quote.id === ownQuoteId,
  'staff can read own quote but cannot send', {
    role: staff.business_role,
    can_send_quote: staff.can_send_quote,
    send_block_reason: staff.send_block_reason,
    quote_id: staff.my_quote?.id,
  });
  const rfqItem = await one('select id from public.rfq_items where rfq_id = $1::uuid', [rfqId]);
  await expectDenied(
    () => as(fixture.staffId, 'authenticated', `
      select public.send_supplier_quote_for_business(
        $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int, $6::timestamptz, $7::text
      )
    `, [
      rfqId,
      fixture.shopId,
      JSON.stringify([{
        rfq_item_id: rfqItem.id,
        brand: 'Aster',
        model: 'A-7',
        specs: { finish: 'matte' },
        unit_price_paise: 1234,
        gst_rate_bp: 0,
        available: true,
      }]),
      0,
      null,
      null,
      'O28 staff send attempt',
    ]),
    /manager role required/i,
    'server send RPC independently denies a staff member',
    { rfqId, shopId: fixture.shopId, role: staff.business_role },
  );
  await expectDenied(
    () => readSupplierRfq(fixture.outsiderId, rfqId, fixture.shopId),
    /shop not found/i,
    'inactive business member cannot read the RFQ',
    { rfqId, shopId: fixture.shopId, memberId: fixture.outsiderId, active: false },
  );

  const ownerView = await readSupplierRfq(fixture.ownerId, rfqId, fixture.shopId);
  const line = ownerView.my_quote?.items?.[0];
  const privileges = await one(`
    select
      has_function_privilege('anon', 'public.get_supplier_rfq_for_business(uuid,uuid)', 'execute') as anon_exec,
      has_function_privilege('authenticated', 'public.get_supplier_rfq_for_business(uuid,uuid)', 'execute') as authenticated_exec
  `);
  check(privileges.anon_exec === false && privileges.authenticated_exec === true,
    'supplier detail RPC is executable only by authenticated users', privileges);
  check(ownerView.category_id === fixture.categoryId
    && ownerView.shop_id === fixture.shopId
    && typeof ownerView.shop_name === 'string'
    && ownerView.my_quote?.id === ownQuoteId
    && ownerView.my_quote?.version === 2
    && ownerView.my_quote?.status === 'sent'
    && line?.rfq_item_id === (await one('select id from public.rfq_items where rfq_id=$1::uuid', [rfqId])).id
    && Number(line?.quantity) === 3
    && Number(line?.unit_price_paise) === 1234
    && line?.brand === 'Aster'
    && line?.model === 'A-7'
    && line?.specs?.finish === 'matte'
    && Number(line?.gst_rate_bp) === 0
    && line?.available === true
    && Number(line?.line_total_paise) === 3702
    && Number(ownerView.my_quote?.delivery_charge_paise) === 234
    && Number(ownerView.my_quote?.delivery_days) === 5
    && ownerView.my_quote?.notes === 'O28 own saved terms'
    && typeof ownerView.my_quote?.valid_until === 'string'
    && Number(ownerView.my_quote?.subtotal_paise) === 3702
    && Number(ownerView.my_quote?.gst_paise) === 0
    && Number(ownerView.my_quote?.total_paise) === 3936,
  'detail readback returns exact own saved version, lines and server totals', {
    category_id: ownerView.category_id,
    shop_id: ownerView.shop_id,
    shop_name: ownerView.shop_name,
    my_quote: ownerView.my_quote,
  });
  check(!Object.hasOwn(ownerView, 'customer_id')
    && !Object.hasOwn(ownerView, 'lat')
    && !Object.hasOwn(ownerView, 'lng')
    && !JSON.stringify(ownerView).includes('O28 competitor private terms')
    && !JSON.stringify(ownerView).includes('O28 expired competitor private terms')
    && duplicateNameCategoryId !== fixture.categoryId,
  'projection contains neither customer coordinates nor competing terms and retains category identity', {
    keys: Object.keys(ownerView),
    duplicateNameCategoryId,
    categoryId: fixture.categoryId,
    containsCompetitorTerms: JSON.stringify(ownerView).includes('O28 competitor private terms'),
  });

  await expectDenied(
    () => readSupplierRfq(fixture.ownerId, rfqId, secondShopId),
    /shop not found/i,
    'one shop owner cannot read another recipient shop quote',
    { rfqId, ownShopId: fixture.shopId, requestedShopId: secondShopId },
  );

  await as(fixture.customerId, 'authenticated', `
    select public.select_supplier_quote($1::uuid)
  `, [ownQuoteId]);
  const selected = await readSupplierRfq(fixture.ownerId, rfqId, fixture.shopId);
  check(selected.my_quote?.id === ownQuoteId && selected.my_quote?.status === 'selected'
    && selected.can_send_quote === false && selected.send_block_reason === 'closed',
  'terminal selected quote remains readable and read-only', {
    quote: selected.my_quote,
    can_send_quote: selected.can_send_quote,
    send_block_reason: selected.send_block_reason,
  });
  const rejected = await readSupplierRfq(secondOwnerId, rfqId, secondShopId);
  const expired = await readSupplierRfq(thirdOwnerId, rfqId, thirdShopId);
  check(rejected.my_quote?.id === rejectedQuoteId && rejected.my_quote?.status === 'rejected'
    && expired.my_quote?.id === expiredQuoteId && expired.my_quote?.status === 'expired',
  'rejected and expired own quotes remain readable after RFQ closure', {
    rejected: rejected.my_quote,
    expired: expired.my_quote,
  });
});

await scenario('MK-SUPPLIER-history-feature-off-read-send-denied', async () => {
  const fixture = await makeFixture('feature-off-history');
  const rfqId = await createRfq(fixture);
  const quoteId = await sendQuote(fixture, rfqId);
  await setFlags({ products: true, enquiries: true, rfq: false, staff: true });

  const history = await readSupplierRfq(fixture.ownerId, rfqId, fixture.shopId);
  check(history.my_quote?.id === quoteId
    && history.can_send_quote === false
    && history.send_block_reason === 'feature_off',
  'feature-off preserves authorized saved quote read while blocking new sends', {
    quote_id: history.my_quote?.id,
    can_send_quote: history.can_send_quote,
    send_block_reason: history.send_block_reason,
  });

  const item = await one('select id from public.rfq_items where rfq_id = $1::uuid', [rfqId]);
  await expectDenied(
    () => as(fixture.ownerId, 'authenticated', `
      select public.send_supplier_quote_for_business(
        $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int, $6::timestamptz, $7::text
      )
    `, [
      rfqId,
      fixture.shopId,
      JSON.stringify([{
        rfq_item_id: item.id,
        brand: 'Aster',
        model: 'A-7',
        specs: { finish: 'matte' },
        unit_price_paise: 1234,
        gst_rate_bp: 0,
        available: true,
      }]),
      0,
      null,
      null,
      'O28 feature-off send attempt',
    ]),
    /product RFQs are disabled/i,
    'server rejects a new quote while effective RFQ feature is off',
    { rfqId, quoteId, flags: 'products=on,product_enquiries=on,product_rfq=off' },
  );

  await setFlags({ products: false, enquiries: true, rfq: true, staff: true });
  const parentOff = await readSupplierRfq(fixture.ownerId, rfqId, fixture.shopId);
  check(parentOff.my_quote?.id === quoteId
    && parentOff.can_send_quote === false
    && parentOff.send_block_reason === 'feature_off',
  'disabled products parent also blocks sending without hiding saved history', {
    quote_id: parentOff.my_quote?.id,
    can_send_quote: parentOff.can_send_quote,
    send_block_reason: parentOff.send_block_reason,
  });
});

await scenario('MK-SUPPLIER-raw-deadline-and-shop-eligibility', async () => {
  const fixture = await makeFixture('deadline-shop-state');
  const rfqId = await createRfq(fixture);
  const quoteId = await sendQuote(fixture, rfqId);
  await db.query(`
    update public.rfqs set status = 'open', expires_at = now() - interval '1 minute'
     where id = $1::uuid
  `, [rfqId]);
  const expiredOpen = await readSupplierRfq(fixture.ownerId, rfqId, fixture.shopId);
  check(expiredOpen.status === 'open' && expiredOpen.can_send_quote === false
    && expiredOpen.send_block_reason === 'rfq_expired'
    && expiredOpen.my_quote?.id === quoteId,
  'raw-open RFQ past its deadline is readable but not sendable', {
    status: expiredOpen.status,
    can_send_quote: expiredOpen.can_send_quote,
    send_block_reason: expiredOpen.send_block_reason,
    quote_id: expiredOpen.my_quote?.id,
  });

  await db.query(`
    update public.rfqs set expires_at = now() + interval '1 day' where id = $1::uuid
  `, [rfqId]);
  await db.query(`
    update public.shops set status = 'suspended' where id = $1::uuid
  `, [fixture.shopId]);
  const unavailableShop = await readSupplierRfq(fixture.ownerId, rfqId, fixture.shopId);
  check(unavailableShop.can_send_quote === false
    && unavailableShop.send_block_reason === 'shop_unavailable'
    && unavailableShop.my_quote?.id === quoteId,
  'unverified shop retains its own quote history but cannot send', {
    can_send_quote: unavailableShop.can_send_quote,
    send_block_reason: unavailableShop.send_block_reason,
    quote_id: unavailableShop.my_quote?.id,
  });
});

finish();

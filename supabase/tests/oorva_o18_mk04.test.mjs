import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const { ok, scenario, finish } = createHarness();
const check = (condition, label, actual) => ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
let phoneSequence = 0;

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

async function setFlags({ products, enquiries, rfq, merchantStaff = true }) {
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
  `, [products, enquiries, rfq, merchantStaff]);
}

async function makeUser() {
  const id = randomUUID();
  phoneSequence += 1;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, `+1555${String(phoneSequence).padStart(7, '0')}`]);
  return id;
}

async function makeShop(ownerId, label, { mapTiles = true } = {}) {
  const shop = await one(`
    insert into public.shops (
      owner_id, name, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, status
    ) values (
      $1::uuid, $2::text, '1 O18 Market Road', 'Vijayawada', 'Benz Circle', 16.5, 80.6, 20,
      true, true, 'verified'
    ) returning id
  `, [ownerId, `O18 ${label} ${randomUUID()}`]);
  const category = await one(`
    select pc.id
      from public.product_categories as pc
     where pc.slug = $1::text
  `, ['tiles']);
  if (mapTiles) {
    await db.query(`
      insert into public.shop_categories (shop_id, category_id)
      values ($1::uuid, $2::uuid)
    `, [shop.id, category.id]);
  }
  return { id: shop.id, categoryId: category.id };
}

async function makeFixture(label) {
  await setFlags({ products: true, enquiries: true, rfq: true, merchantStaff: true });
  const [customer, owner, outsider, manager, staff, inactiveMember] = await Promise.all([
    makeUser(), makeUser(), makeUser(), makeUser(), makeUser(), makeUser(),
  ]);
  const shop = await makeShop(owner, label);
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values
      ($1::uuid, $2::uuid, 'manager', true),
      ($1::uuid, $3::uuid, 'staff', true),
      ($1::uuid, $4::uuid, 'manager', false)
  `, [owner, manager, staff, inactiveMember]);
  const product = await one(`
    insert into public.products (shop_id, category_id, name, brand, model, description)
    values ($1::uuid, $2::uuid, $3::text, 'O18', '', 'Existing product history fixture')
    returning id
  `, [shop.id, shop.categoryId, `O18 product ${randomUUID()}`]);
  return { customer, owner, outsider, manager, staff, inactiveMember, shop, productId: product.id };
}

async function createEnquiry(fixture) {
  const result = await as(fixture.customer, 'authenticated', `
    select public.start_product_enquiry(
      $1::uuid, $2::uuid, $3::text
    ) as id
  `, [fixture.shop.id, fixture.productId, 'Existing enquiry history']);
  return result[0].id;
}

async function createRfq(fixture) {
  const result = await as(fixture.customer, 'authenticated', `
    select public.create_rfq(
      $1::uuid, $2::text, $3::jsonb, $4::text, $5::text, $6::double precision,
      $7::double precision, $8::boolean, $9::date, $10::text
    ) as id
  `, [
    fixture.shop.categoryId,
    `O18 request ${randomUUID()}`,
    JSON.stringify([{ description: 'Existing material', specs: { size: '10x10' }, quantity: 2, unit: 'box' }]),
    'Vijayawada',
    'Benz Circle',
    16.5,
    80.6,
    true,
    '2027-01-15',
    'Existing RFQ history',
  ]);
  return result[0].id;
}

async function sendQuote(fixture, rfqId) {
  const item = await one(`
    select ri.id
      from public.rfq_items as ri
     where ri.rfq_id = $1::uuid
     order by ri.seq
     limit 1
  `, [rfqId]);
  const result = await as(fixture.owner, 'authenticated', `
    select public.send_supplier_quote_for_business(
      $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int, $6::timestamptz, $7::text
    ) as id
  `, [
    rfqId,
    fixture.shop.id,
    JSON.stringify([{
      rfq_item_id: item.id,
      brand: 'O18',
      model: 'History',
      specs: { size: '10x10' },
      unit_price_paise: 1000,
      gst_rate_bp: 0,
      available: true,
    }]),
    0,
    null,
    null,
    'Existing quote history',
  ]);
  return result[0].id;
}

await scenario('MK-OFF-existing-enquiry-role-matrix', async () => {
  const fixture = await makeFixture('enquiry-matrix');
  const enquiryId = await createEnquiry(fixture);
  await as(fixture.owner, 'authenticated', `
    select public.send_enquiry_message($1::uuid, $2::text)
  `, [enquiryId, 'Existing owner reply']);
  await setFlags({ products: false, enquiries: true, rfq: true, merchantStaff: true });

  const customerThread = await as(fixture.customer, 'authenticated', `
    select id, product_id, status, from_shop_user, business_role
      from public.get_product_enquiry($1::uuid)
  `, [enquiryId]);
  const customerMessages = await as(fixture.customer, 'authenticated', `
    select pem.id, pem.sender_id, pem.from_shop, pem.body
      from public.list_product_enquiry_messages($1::uuid) as pem
     order by pem.created_at
  `, [enquiryId]);
  const customerList = await as(fixture.customer, 'authenticated', `
    select e.id, e.product_name, e.status
      from public.list_my_product_enquiries() as e
     where e.id = $1::uuid
  `, [enquiryId]);
  check(customerThread.length === 1 && customerThread[0].id === enquiryId
    && customerThread[0].product_id === fixture.productId
    && customerThread[0].from_shop_user === false
    && customerMessages.length === 2 && customerList.length === 1,
  'customer retains own existing enquiry metadata and messages with the products parent OFF',
  { customerThread, customerMessages, customerList });

  const ownerThread = await as(fixture.owner, 'authenticated', `
    select id, from_shop_user, business_role from public.get_product_enquiry($1::uuid)
  `, [enquiryId]);
  const managerRows = await as(fixture.manager, 'authenticated', `
    select e.id, e.customer_name
      from public.list_shop_product_enquiries() as e
     where e.id = $1::uuid
  `, [enquiryId]);
  const staffThread = await as(fixture.staff, 'authenticated', `
    select id, from_shop_user, business_role from public.get_product_enquiry($1::uuid)
  `, [enquiryId]);
  const inactiveAllowed = await as(fixture.inactiveMember, 'authenticated', `
    select public._product_enquiry_participant($1::uuid) as allowed
  `, [enquiryId]);
  const outsiderAllowed = await as(fixture.outsider, 'authenticated', `
    select public._product_enquiry_participant($1::uuid) as allowed
  `, [enquiryId]);
  const outsiderRows = await as(fixture.outsider, 'authenticated', `
    select e.id from public.list_shop_product_enquiries() as e where e.id = $1::uuid
  `, [enquiryId]);
  check(ownerThread.length === 1 && ownerThread[0].from_shop_user
    && managerRows.length === 1 && staffThread.length === 1
    && staffThread[0].business_role === 'staff'
    && inactiveAllowed[0].allowed === false
    && outsiderAllowed[0].allowed === false
    && outsiderRows.length === 0,
  'owner and active shop members retain history while inactive members and outsiders do not',
  { ownerThread, managerRows, staffThread, inactiveAllowed, outsiderAllowed, outsiderRows });
  await expectDenied(
    () => as(fixture.inactiveMember, 'authenticated', `
      select * from public.get_product_enquiry($1::uuid)
    `, [enquiryId]),
    /enquiry not found/i,
    'inactive shop member cannot read private enquiry detail',
  );

  await setFlags({ products: true, enquiries: false, rfq: true, merchantStaff: true });
  const childOffOwnerRead = await as(fixture.owner, 'authenticated', `
    select id from public.get_product_enquiry($1::uuid)
  `, [enquiryId]);
  const memberSwitchOff = await as(fixture.staff, 'authenticated', `
    select public._product_enquiry_participant($1::uuid) as allowed
  `, [enquiryId]);
  const ownerMarkRead = await as(fixture.owner, 'authenticated', `
    select public.mark_enquiry_read($1::uuid)
  `, [enquiryId]);
  const customerUnreadAfterOwnerRead = await one(`
    select pe.shop_unread, pe.customer_unread
      from public.product_enquiries as pe
     where pe.id = $1::uuid
  `, [enquiryId]);
  await setFlags({ products: true, enquiries: false, rfq: true, merchantStaff: false });
  const staffAllowedWithSwitchOff = await as(fixture.staff, 'authenticated', `
    select public._product_enquiry_participant($1::uuid) as allowed
  `, [enquiryId]);
  const guestAllowed = await as(null, 'anon', `
    select public._product_enquiry_participant($1::uuid) as allowed
  `, [enquiryId]);
  const guestList = await as(null, 'anon', `
    select e.id from public.list_my_product_enquiries() as e
  `);
  check(childOffOwnerRead.length === 1 && memberSwitchOff[0].allowed === true
    && ownerMarkRead.length === 1 && customerUnreadAfterOwnerRead.shop_unread === 0
    && staffAllowedWithSwitchOff[0].allowed === false && guestAllowed[0].allowed === false
    && guestList.length === 0,
  'authorized reads and safe mark-read survive child OFF while staff switch and guest privacy remain enforced',
  { childOffOwnerRead, memberSwitchOff, ownerMarkRead, customerUnreadAfterOwnerRead, staffAllowedWithSwitchOff, guestAllowed, guestList });
  await expectDenied(
    () => as(null, 'anon', `select * from public.get_product_enquiry($1::uuid)`, [enquiryId]),
    /authentication required|enquiry not found|permission denied/i,
    'guest cannot read a private enquiry detail',
  );
});

await scenario('MK-OFF-existing-RFQ-role-matrix', async () => {
  const fixture = await makeFixture('rfq-matrix');
  const foreignShop = await makeShop(fixture.outsider, 'unrouted-shop', { mapTiles: false });
  const rfqId = await createRfq(fixture);
  const quoteId = await sendQuote(fixture, rfqId);
  await setFlags({ products: false, enquiries: true, rfq: true, merchantStaff: true });

  const customerRfq = await as(fixture.customer, 'authenticated', `
    select public.get_rfq($1::uuid) as value
  `, [rfqId]);
  const customerList = await as(fixture.customer, 'authenticated', `
    select r.id, r.status
      from public.list_my_customer_rfqs() as r
     where r.id = $1::uuid
  `, [rfqId]);
  const comparison = await as(fixture.customer, 'authenticated', `
    select q.quote_id, q.status
      from public.compare_rfq_quotes($1::uuid) as q
     where q.quote_id = $2::uuid
  `, [rfqId, quoteId]);
  const customerAccess = await as(fixture.customer, 'authenticated', `
    select public._rfq_is_customer($1::uuid) as customer,
           public._rfq_can_read($1::uuid) as can_read,
           public._rfq_quote_can_read($2::uuid) as can_read_quote
  `, [rfqId, quoteId]);

  const ownerRead = await as(fixture.owner, 'authenticated', `
    select public.get_supplier_rfq_for_business($1::uuid, $2::uuid) as value
  `, [rfqId, fixture.shop.id]);
  const managerRead = await as(fixture.manager, 'authenticated', `
    select public.get_supplier_rfq_for_business($1::uuid, $2::uuid) as value
  `, [rfqId, fixture.shop.id]);
  const staffList = await as(fixture.staff, 'authenticated', `
    select r.rfq_id, r.business_role, r.my_outcome
      from public.list_my_supplier_rfqs() as r
     where r.rfq_id = $1::uuid
  `, [rfqId]);
  const staffAccess = await as(fixture.staff, 'authenticated', `
    select public._rfq_shop_recipient($1::uuid, $2::uuid) as recipient,
           public._rfq_can_read($1::uuid) as can_read,
           public._rfq_quote_can_read($3::uuid) as can_read_quote
  `, [rfqId, fixture.shop.id, quoteId]);
  const inactiveAccess = await as(fixture.inactiveMember, 'authenticated', `
    select public._rfq_shop_recipient($1::uuid, $2::uuid) as recipient,
           public._rfq_can_read($1::uuid) as can_read
  `, [rfqId, fixture.shop.id]);
  const outsiderAccess = await as(fixture.outsider, 'authenticated', `
    select public._rfq_is_customer($1::uuid) as customer,
           public._rfq_can_read($1::uuid) as can_read,
           public._rfq_quote_can_read($2::uuid) as can_read_quote
  `, [rfqId, quoteId]);

  check(customerRfq[0]?.value?.id === rfqId && customerList.length === 1
    && comparison.length === 1 && comparison[0].quote_id === quoteId
    && customerAccess[0].customer && customerAccess[0].can_read && customerAccess[0].can_read_quote
    && ownerRead[0]?.value?.id === rfqId && managerRead[0]?.value?.id === rfqId
    && staffList.length === 1 && staffList[0].business_role === 'staff'
    && staffAccess[0].recipient && staffAccess[0].can_read && staffAccess[0].can_read_quote
    && inactiveAccess[0].recipient === false && inactiveAccess[0].can_read === false
    && outsiderAccess[0].customer === false && outsiderAccess[0].can_read === false
    && outsiderAccess[0].can_read_quote === false,
  'customer, recipient owner, and active members retain their own RFQ/quote history with products OFF',
  { customerRfq, customerList, comparison, customerAccess, ownerRead, managerRead, staffList, staffAccess, inactiveAccess, outsiderAccess });

  await expectDenied(
    () => as(fixture.outsider, 'authenticated', `
      select public.get_supplier_rfq_for_business($1::uuid, $2::uuid)
    `, [rfqId, fixture.shop.id]),
    /shop not found|RFQ not found/i,
    'non-recipient cannot read supplier RFQ detail',
  );
  await expectDenied(
    () => as(fixture.inactiveMember, 'authenticated', `
      select public.get_supplier_rfq_for_business($1::uuid, $2::uuid)
    `, [rfqId, fixture.shop.id]),
    /shop not found|RFQ not found/i,
    'inactive member cannot read private supplier RFQ detail',
  );
  const foreignShopAccess = await as(fixture.outsider, 'authenticated', `
    select public._rfq_shop_recipient($1::uuid, $2::uuid) as recipient
  `, [rfqId, foreignShop.id]);
  check(foreignShopAccess[0].recipient === false,
    'an authorized member of a different shop cannot read this RFQ recipient history',
    foreignShopAccess);
  await expectDenied(
    () => as(fixture.outsider, 'authenticated', `select public.get_rfq($1::uuid)`, [rfqId]),
    /RFQ not found/i,
    'different customer cannot read customer RFQ detail',
  );

  await setFlags({ products: true, enquiries: true, rfq: false, merchantStaff: true });
  const childOffOwnerRead = await as(fixture.owner, 'authenticated', `
    select public.get_supplier_rfq_for_business($1::uuid, $2::uuid) as value
  `, [rfqId, fixture.shop.id]);
  await setFlags({ products: true, enquiries: true, rfq: false, merchantStaff: false });
  const switchOffMember = await as(fixture.staff, 'authenticated', `
    select public._rfq_shop_recipient($1::uuid, $2::uuid) as recipient
  `, [rfqId, fixture.shop.id]);
  check(childOffOwnerRead[0]?.value?.id === rfqId
    && switchOffMember[0].recipient === false,
  'existing RFQ read survives child OFF without bypassing merchant membership or guest-private denial',
  { childOffOwnerRead, switchOffMember });
  await expectDenied(
    () => as(null, 'anon', `select public.get_rfq($1::uuid)`, [rfqId]),
    /authentication required|RFQ not found|permission denied/i,
    'guest cannot read private customer RFQ detail',
  );
});

await scenario('MK-OFF-cancel-owner-not-outsider', async () => {
  const fixture = await makeFixture('cancel');
  const otherCustomer = await makeUser();
  const rfqId = await createRfq(fixture);
  const quoteId = await sendQuote(fixture, rfqId);
  await setFlags({ products: false, enquiries: true, rfq: true, merchantStaff: true });

  await expectDenied(
    () => as(otherCustomer, 'authenticated', `select public.cancel_rfq($1::uuid)`, [rfqId]),
    /RFQ not found/i,
    'different customer cannot cancel another customer RFQ while capabilities are OFF',
  );
  const afterOutsiderAttempt = await one(`
    select r.status as rfq_status, q.status as quote_status
      from public.rfqs as r
      join public.supplier_quotes as q on q.rfq_id = r.id
     where r.id = $1::uuid and q.id = $2::uuid
  `, [rfqId, quoteId]);
  await as(fixture.customer, 'authenticated', `select public.cancel_rfq($1::uuid)`, [rfqId]);
  const afterOwnerCancel = await one(`
    select r.status as rfq_status, q.status as quote_status
      from public.rfqs as r
      join public.supplier_quotes as q on q.rfq_id = r.id
     where r.id = $1::uuid and q.id = $2::uuid
  `, [rfqId, quoteId]);
  await expectDenied(
    () => as(fixture.customer, 'authenticated', `select public.cancel_rfq($1::uuid)`, [rfqId]),
    /RFQ is not open/i,
    'owner cannot cancel an already terminal RFQ',
  );
  const afterTerminalAttempt = await one(`
    select r.status as rfq_status, q.status as quote_status
      from public.rfqs as r
      join public.supplier_quotes as q on q.rfq_id = r.id
     where r.id = $1::uuid and q.id = $2::uuid
  `, [rfqId, quoteId]);
  check(afterOutsiderAttempt.rfq_status === 'open' && afterOutsiderAttempt.quote_status === 'sent'
    && afterOwnerCancel.rfq_status === 'cancelled' && afterOwnerCancel.quote_status === 'rejected'
    && afterTerminalAttempt.rfq_status === 'cancelled' && afterTerminalAttempt.quote_status === 'rejected',
  'only the owner can atomically cancel a raw-open RFQ and reject sent quotes while OFF',
  { afterOutsiderAttempt, afterOwnerCancel, afterTerminalAttempt });
});

await scenario('MK-OFF-new-work-denied', async () => {
  const fixture = await makeFixture('new-work');
  const enquiryId = await createEnquiry(fixture);
  const rfqId = await createRfq(fixture);
  const quoteId = await sendQuote(fixture, rfqId);
  await setFlags({ products: false, enquiries: true, rfq: true, merchantStaff: true });

  await expectDenied(
    () => as(fixture.customer, 'authenticated', `
      select public.start_product_enquiry($1::uuid, $2::uuid, $3::text)
    `, [fixture.shop.id, fixture.productId, 'New enquiry']),
    /product enquiries are disabled/i,
    'new product enquiry remains denied with products parent OFF',
  );
  await expectDenied(
    () => as(fixture.customer, 'authenticated', `
      select public.create_rfq(
        $1::uuid, $2::text, $3::jsonb, $4::text, $5::text, $6::double precision,
        $7::double precision, $8::boolean, $9::date, $10::text
      )
    `, [
      fixture.shop.categoryId,
      'New RFQ',
      JSON.stringify([{ description: 'New material', specs: {}, quantity: 1, unit: 'piece' }]),
      'Vijayawada',
      'Benz Circle',
      16.5,
      80.6,
      false,
      '2027-01-15',
      '',
    ]),
    /product RFQs are disabled/i,
    'new RFQ creation remains denied with products parent OFF',
  );
  await expectDenied(
    () => as(fixture.customer, 'authenticated', `
      select public.send_enquiry_message($1::uuid, $2::text)
    `, [enquiryId, 'New message']),
    /product enquiries are disabled/i,
    'new enquiry message remains denied while history is readable',
  );
  await expectDenied(
    () => as(fixture.owner, 'authenticated', `
      select public.send_supplier_quote_for_business(
        $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int, $6::timestamptz, $7::text
      )
    `, [rfqId, fixture.shop.id, '[]', 0, null, null, 'New quote']),
    /product RFQs are disabled/i,
    'new supplier quote remains denied while RFQ history is readable',
  );
  await expectDenied(
    () => as(fixture.customer, 'authenticated', `
      select public.select_supplier_quote($1::uuid)
    `, [quoteId]),
    /product RFQs are disabled/i,
    'new supplier selection remains denied with products parent OFF',
  );
  await expectDenied(
    () => as(fixture.owner, 'authenticated', `
      select public.save_product(
        null::uuid, $1::uuid, $2::text, ''::text, ''::text, ''::text, '{}'::jsonb,
        'piece'::text, null::int, true::boolean, true::boolean, '{}'::text[]
      )
    `, [fixture.shop.categoryId, 'New product']),
    /products are disabled/i,
    'catalogue create/edit remains denied with products OFF',
  );
  await expectDenied(
    () => as(fixture.owner, 'authenticated', `
      select public.set_product_enquiry_status($1::uuid, 'closed'::text)
    `, [enquiryId]),
    /product enquiries are disabled/i,
    'enquiry status mutation remains denied with products OFF',
  );

  const ownerShop = await as(fixture.owner, 'authenticated', `
    select public.get_my_business_shop() as value
  `);
  const ownerProducts = await as(fixture.owner, 'authenticated', `
    select p.id, p.name
      from public.list_my_products() as p
     where p.id = $1::uuid
  `, [fixture.productId]);
  const imagePath = `${fixture.shop.id}/historic-image.jpg`;
  await db.query(`
    insert into public.product_images (product_id, path)
    values ($1::uuid, $2::text)
  `, [fixture.productId, imagePath]);
  const historicOwnerRead = await as(fixture.owner, 'authenticated', `
    select public._product_image_access($1::text, false::boolean) as allowed
  `, [imagePath]);
  const ownerManageOff = await as(fixture.owner, 'authenticated', `
    select public._product_image_access($1::text, true::boolean) as allowed
  `, [imagePath]);
  const publicImageOff = await as(fixture.customer, 'authenticated', `
    select public._product_image_access($1::text, false::boolean) as allowed
  `, [imagePath]);
  check(ownerShop[0]?.value?.id === fixture.shop.id
    && JSON.stringify(ownerShop[0]?.value?.category_slugs) === '[]'
    && ownerProducts.length === 1 && ownerProducts[0].id === fixture.productId
    && historicOwnerRead[0].allowed === true && ownerManageOff[0].allowed === false
    && publicImageOff[0].allowed === false,
  'owner workspace and historic image read survive OFF while management and public discovery stay disabled',
  { ownerShop, ownerProducts, historicOwnerRead, ownerManageOff, publicImageOff });
  await expectDenied(
    () => as(fixture.customer, 'authenticated', `
      select public.search_products(null::text, null::text, null::double precision, null::double precision,
                                    15::int, null::int, false::boolean, 10::int)
    `),
    /products are disabled/i,
    'public product discovery remains closed with the products parent OFF',
  );
});

await scenario('MK-OFF-shop-unread', async () => {
  const fixture = await makeFixture('unread');
  const enquiryId = await createEnquiry(fixture);
  await as(fixture.owner, 'authenticated', `
    select public.send_enquiry_message($1::uuid, $2::text)
  `, [enquiryId, 'Unread customer reply']);
  const rfqId = await createRfq(fixture);
  await sendQuote(fixture, rfqId);
  await setFlags({ products: false, enquiries: true, rfq: true, merchantStaff: true });

  const beforeRead = await as(fixture.customer, 'authenticated', `
    select ac.shop from public.get_my_activity_unread_counts() as ac
  `);
  const ownerUnread = await as(fixture.owner, 'authenticated', `
    select e.shop_unread
      from public.list_shop_product_enquiries() as e
     where e.id = $1::uuid
  `, [enquiryId]);
  `);
  await as(fixture.customer, 'authenticated', `
    select public.mark_enquiry_read($1::uuid)
  `, [enquiryId]);
  const rfqReadCount = await as(fixture.customer, 'authenticated', `
    select public.mark_my_activity_notification_read('rfq'::text, $1::uuid) as count
  `, [rfqId]);
  const afterRead = await as(fixture.customer, 'authenticated', `
    select ac.shop from public.get_my_activity_unread_counts() as ac
  `);
  await as(fixture.owner, 'authenticated', `
    select public.mark_enquiry_read($1::uuid)
  `, [enquiryId]);
  const ownerUnreadAfterRead = await as(fixture.owner, 'authenticated', `
    select e.shop_unread
      from public.list_shop_product_enquiries() as e
     where e.id = $1::uuid
  `, [enquiryId]);
  `);
  await expectDenied(
    () => as(fixture.outsider, 'authenticated', `
      select public.mark_my_activity_notification_read('rfq'::text, $1::uuid)
    `, [rfqId]),
    /activity not found/i,
    'shop unread mark-read still requires the owning RFQ customer while OFF',
  );
  check(beforeRead[0]?.shop === 2 && ownerUnread[0]?.shop_unread === 1
    && rfqReadCount[0]?.count === 1 && afterRead[0]?.shop === 0
    && ownerUnreadAfterRead[0]?.shop_unread === 0,
  'shop enquiry and RFQ unread counts remain accurate and owner-scoped with capabilities OFF',
  { beforeRead, ownerUnread, rfqReadCount, afterRead, ownerUnreadAfterRead });
});

finish();

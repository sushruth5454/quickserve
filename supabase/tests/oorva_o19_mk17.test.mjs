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

async function setFlags({ products, enquiries, rfq, merchantStaff }) {
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
  const digits = randomUUID().replace(/\D/g, '').padEnd(10, '0').slice(0, 10);
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, `+1555${digits}`]);
  return id;
}

async function makeFixture(label) {
  await setFlags({ products: true, enquiries: true, rfq: true, merchantStaff: true });
  const [customer, owner, outsider, manager, staff, inactiveMember] = await Promise.all([
    makeUser(), makeUser(), makeUser(), makeUser(), makeUser(), makeUser(),
  ]);
  const categoryId = (await one(`
    insert into public.product_categories (slug, name, attribute_schema)
    values ($1::text, $2::text, '{}'::jsonb)
    returning id
  `, [`o19-mk17-${randomUUID().replace(/-/g, '')}`, `O19 MK17 ${label}`])).id;
  const shopId = (await one(`
    insert into public.shops (
      owner_id, name, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, status
    ) values (
      $1::uuid, $2::text, '1 MK17 Market Road', 'Vijayawada', 'Benz Circle',
      16.5::double precision, 80.6::double precision, 20::int, true, true, 'verified'
    ) returning id
  `, [owner, `O19 MK17 ${label} ${randomUUID()}`])).id;
  await db.query(`
    insert into public.shop_categories (shop_id, category_id)
    values ($1::uuid, $2::uuid)
  `, [shopId, categoryId]);
  const productId = (await one(`
    insert into public.products (
      shop_id, category_id, name, brand, model, description, in_stock
    ) values (
      $1::uuid, $2::uuid, $3::text, 'MK17', '', 'Enquiry status fixture', true
    ) returning id
  `, [shopId, categoryId, `O19 MK17 product ${label} ${randomUUID()}`])).id;
  await db.query(`
    insert into public.business_members (owner_id, member_id, role, active)
    values
      ($1::uuid, $2::uuid, 'manager'::text, true),
      ($1::uuid, $3::uuid, 'staff'::text, true),
      ($1::uuid, $4::uuid, 'manager'::text, false)
  `, [owner, manager, staff, inactiveMember]);
  return { customer, owner, outsider, manager, staff, inactiveMember, shopId, productId };
}

async function startEnquiry(fixture, body = 'MK17 initial enquiry') {
  const result = await as(fixture.customer, 'authenticated', `
    select public.start_product_enquiry($1::uuid, $2::uuid, $3::text) as id
  `, [fixture.shopId, fixture.productId, body]);
  return result[0].id;
}

async function setEnquiryStatus(uid, enquiryId, status) {
  return as(uid, 'authenticated', `
    select public.set_product_enquiry_status($1::uuid, $2::text)
  `, [enquiryId, status]);
}

async function readEnquiry(uid, enquiryId) {
  return as(uid, 'authenticated', `
    select * from public.get_product_enquiry($1::uuid)
  `, [enquiryId]).then((rows) => rows[0]);
}

await scenario('MK-ENQUIRY-reopen-role-context', async () => {
  const fixture = await makeFixture('role-context');
  const closedId = await startEnquiry(fixture);
  await setEnquiryStatus(fixture.customer, closedId, 'closed');

  const customerClosed = await readEnquiry(fixture.customer, closedId);
  const ownerClosed = await readEnquiry(fixture.owner, closedId);
  const managerClosed = await readEnquiry(fixture.manager, closedId);
  const staffClosed = await readEnquiry(fixture.staff, closedId);
  check(customerClosed.can_change_status && customerClosed.can_reopen
    && ownerClosed.can_change_status && ownerClosed.can_reopen
    && managerClosed.can_change_status === false && managerClosed.can_reopen === false
    && staffClosed.can_change_status === false && staffClosed.can_reopen === false
    && customerClosed.active_enquiry_id === null,
  'only the actual customer and shop owner can reopen a closed enquiry',
  { customerClosed, ownerClosed, managerClosed, staffClosed });

  await expectDenied(
    () => setEnquiryStatus(fixture.manager, closedId, 'open'),
    /enquiry not found/i,
    'active manager cannot reopen a closed enquiry',
    { managerClosed },
  );
  await expectDenied(
    () => readEnquiry(fixture.outsider, closedId),
    /enquiry not found/i,
    'outsider cannot read participant-safe state',
    { closedId },
  );
  await expectDenied(
    () => readEnquiry(fixture.inactiveMember, closedId),
    /enquiry not found/i,
    'inactive shop member cannot read participant-safe state',
    { closedId },
  );

  const activeId = await startEnquiry(fixture, 'MK17 active twin');
  const customerTwin = await readEnquiry(fixture.customer, closedId);
  const managerTwin = await readEnquiry(fixture.manager, closedId);
  check(customerTwin.active_enquiry_id === activeId
    && customerTwin.can_reopen === false
    && managerTwin.active_enquiry_id === activeId
    && managerTwin.can_change_status === false
    && managerTwin.can_reopen === false
    && !Object.keys(managerTwin).some((key) => /active_(customer|message|body)/i.test(key)),
  'same-context twin exposes only its id and suppresses reopen for every participant',
  { activeId, customerTwin, managerTwin });
  await expectDenied(
    () => setEnquiryStatus(fixture.customer, closedId, 'open'),
    /another open enquiry already exists for this product context/i,
    'duplicate-open conflict is normalized while the unique index remains authoritative',
    { activeId, customerTwin },
  );
  await expectDenied(
    () => as(fixture.inactiveMember, 'authenticated', `
      select * from public.list_product_enquiry_messages($1::uuid)
    `, [closedId]),
    /enquiry not found/i,
    'inactive member cannot read sibling conversation contents',
    { closedId },
  );
  await expectDenied(
    () => as(fixture.inactiveMember, 'authenticated', `
      select public.mark_enquiry_read($1::uuid)
    `, [closedId]),
    /enquiry not found/i,
    'inactive member cannot clear either participant unread counter',
    { closedId },
  );
  await expectDenied(
    () => as(fixture.inactiveMember, 'authenticated', `
      select public.send_enquiry_message($1::uuid, $2::text)
    `, [closedId, 'Inactive member message']),
    /enquiry not found/i,
    'inactive member cannot send into private enquiry history',
    { closedId },
  );
  await expectDenied(
    () => setEnquiryStatus(fixture.inactiveMember, closedId, 'open'),
    /enquiry not found/i,
    'inactive member cannot change enquiry status',
    { closedId },
  );
  await setEnquiryStatus(fixture.owner, activeId, 'closed');
  await setEnquiryStatus(fixture.customer, closedId, 'open');
  const reopenedByCustomer = await readEnquiry(fixture.customer, closedId);
  check(reopenedByCustomer.status === 'open' && reopenedByCustomer.can_change_status,
    'the actual customer can reopen after the active twin is closed',
    { activeId, reopenedByCustomer });
});

await scenario('MK-ENQUIRY-unread-side', async () => {
  const fixture = await makeFixture('unread-side');
  const enquiryId = await startEnquiry(fixture);
  await as(fixture.owner, 'authenticated', `
    select public.send_enquiry_message($1::uuid, $2::text)
  `, [enquiryId, 'Owner response']);

  await setFlags({ products: true, enquiries: false, rfq: true, merchantStaff: true });
  const customerHistory = await readEnquiry(fixture.customer, enquiryId);
  await as(fixture.owner, 'authenticated', `
    select public.mark_enquiry_read($1::uuid)
  `, [enquiryId]);
  const afterOwnerRead = await one(`
    select shop_unread, customer_unread
      from public.product_enquiries
     where id = $1::uuid
  `, [enquiryId]);
  await as(fixture.customer, 'authenticated', `
    select public.mark_enquiry_read($1::uuid)
  `, [enquiryId]);
  const afterCustomerRead = await one(`
    select shop_unread, customer_unread
      from public.product_enquiries
     where id = $1::uuid
  `, [enquiryId]);

  check(customerHistory.id === enquiryId
    && customerHistory.can_change_status === false
    && customerHistory.can_reopen === false
    && afterOwnerRead.shop_unread === 0 && afterOwnerRead.customer_unread === 1
    && afterCustomerRead.shop_unread === 0 && afterCustomerRead.customer_unread === 0,
  'readback and mark-read work while enquiries are OFF and clear only the current actor side',
  { customerHistory, afterOwnerRead, afterCustomerRead });
  await expectDenied(
    () => setEnquiryStatus(fixture.customer, enquiryId, 'closed'),
    /product enquiries are disabled/i,
    'status changes remain disabled when the feature is OFF',
    { enquiryId, customerHistory },
  );
  await expectDenied(
    () => as(fixture.outsider, 'authenticated', `
      select public.mark_enquiry_read($1::uuid)
    `, [enquiryId]),
    /enquiry not found/i,
    'feature-off mark-read remains participant-scoped',
    { enquiryId },
  );
});

finish();

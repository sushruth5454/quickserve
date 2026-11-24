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

async function setFlags({ products = true, enquiries = true, rfq = true } = {}) {
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
  await setFlags();
  const customerId = await makeUser();
  const ownerId = await makeUser();
  const categoryId = await one(`
    insert into public.product_categories (slug, name, attribute_schema)
    values ($1::text, $2::text, '{}'::jsonb)
    returning id
  `, [`o19-mk06-${randomUUID().replace(/-/g, '')}`, `O19 MK06 ${label}`]).then((row) => row.id);
  const shop = await one(`
    insert into public.shops (
      owner_id, name, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, status
    ) values (
      $1::uuid, $2::text, '1 O19 MK06 Market Road', 'Vijayawada', 'Benz Circle',
      16.5::double precision, 80.6::double precision, 20::int, true, true, 'verified'
    ) returning id
  `, [ownerId, `O19 MK06 ${label} ${randomUUID()}`]);
  await db.query(`
    insert into public.shop_categories (shop_id, category_id)
    values ($1::uuid, $2::uuid)
  `, [shop.id, categoryId]);
  return { customerId, ownerId, categoryId, shopId: shop.id };
}

async function createRfq(fixture, title) {
  const result = await as(fixture.customerId, 'authenticated', `
    select public.create_rfq(
      $1::uuid, $2::text, $3::jsonb, $4::text, $5::text,
      $6::double precision, $7::double precision, $8::boolean, $9::date, $10::text
    ) as id
  `, [
    fixture.categoryId,
    `O19 MK06 ${title} ${randomUUID()}`,
    JSON.stringify([{ description: 'Ceramic tile', specs: {}, quantity: 2, unit: 'box' }]),
    'Vijayawada',
    'Benz Circle',
    16.5,
    80.6,
    true,
    '2027-01-15',
    'O19 MK06 deadline fixture',
  ]);
  return result[0].id;
}

async function sendQuote(fixture, rfqId) {
  const item = await one(`
    select id from public.rfq_items where rfq_id = $1::uuid order by seq limit 1
  `, [rfqId]);
  const items = [{
    rfq_item_id: item.id,
    brand: 'Aster',
    model: 'A-7',
    specs: {},
    unit_price_paise: 1234,
    gst_rate_bp: 1800,
    available: true,
  }];
  const result = await as(fixture.ownerId, 'authenticated', `
    select public.send_supplier_quote_for_business(
      $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int,
      $6::timestamptz, $7::text
    ) as id
  `, [rfqId, fixture.shopId, JSON.stringify(items), 234, 5, null, 'O19 MK06 money fixture']);
  return result[0].id;
}

await scenario('MK-ADMIN-effective-open-deadline', async () => {
  const fixture = await makeFixture('admin-effective-open');
  const liveRfqId = await createRfq(fixture, 'live');
  const pastRfqId = await createRfq(fixture, 'past-deadline');
  await db.query(`
    update public.rfqs
       set expires_at = case id
         when $1::uuid then now() + interval '1 day'
         when $2::uuid then now() - interval '1 day'
       end
     where id in ($1::uuid, $2::uuid)
  `, [liveRfqId, pastRfqId]);

  const adminId = await makeUser();
  await db.query('insert into public.admins (user_id) values ($1::uuid)', [adminId]);
  const dashboard = await as(adminId, 'authenticated', `
    select public.admin_rfq_dashboard() as value
  `).then((rows) => rows[0].value);
  const recent = dashboard.recent_rfqs ?? [];
  const live = recent.find((row) => row.id === liveRfqId);
  const past = recent.find((row) => row.id === pastRfqId);
  const storedPast = await one(`
    select status, expires_at from public.rfqs where id = $1::uuid
  `, [pastRfqId]);

  check(Number(dashboard.open_rfqs) === 1
    && live?.status === 'open'
    && typeof live?.expires_at === 'string'
    && past?.status === 'open'
    && typeof past?.expires_at === 'string'
    && storedPast.status === 'open',
  'effective Open counts only future deadlines and keeps raw status/deadline visible without persisting expiry', {
    open_rfqs: dashboard.open_rfqs,
    live,
    past,
    storedPast,
  });
});

await scenario('MK-COMPARE-deadline-action-projection-preserves-money', async () => {
  const fixture = await makeFixture('comparison-deadlines');
  const rfqId = await createRfq(fixture, 'comparison');
  const quoteId = await sendQuote(fixture, rfqId);
  const readComparison = async () => as(fixture.customerId, 'authenticated', `
    select can_select, selection_block_reason, subtotal_paise, gst_paise,
           delivery_charge_paise, total_paise, status, valid_until
      from public.compare_rfq_quotes($1::uuid)
     where quote_id = $2::uuid
  `, [rfqId, quoteId]).then((rows) => rows[0]);

  await db.query(`
    update public.rfqs set expires_at = now() + interval '1 day' where id = $1::uuid
  `, [rfqId]);
  await db.query(`
    update public.supplier_quotes set valid_until = now() + interval '1 day' where id = $1::uuid
  `, [quoteId]);
  const live = await readComparison();
  const savedMoney = await one(`
    select subtotal_paise, gst_paise, delivery_charge_paise, total_paise
      from public.supplier_quotes where id = $1::uuid
  `, [quoteId]);

  await db.query('update public.rfqs set expires_at = now() where id = $1::uuid', [rfqId]);
  const atRfqDeadline = await readComparison();
  await db.query(`
    update public.rfqs set expires_at = now() + interval '1 day' where id = $1::uuid
  `, [rfqId]);
  await db.query('update public.supplier_quotes set valid_until = now() where id = $1::uuid', [quoteId]);
  const atQuoteDeadline = await readComparison();

  await setFlags({ products: false, enquiries: true, rfq: true });
  const parentFeatureOff = await readComparison();

  check(live?.can_select === true
    && atRfqDeadline?.can_select === false
    && atRfqDeadline?.selection_block_reason === 'rfq_expired'
    && atQuoteDeadline?.can_select === false
    && atQuoteDeadline?.selection_block_reason === 'quote_expired'
    && parentFeatureOff?.can_select === false
    && parentFeatureOff?.selection_block_reason === 'feature_off'
    && Number(live.subtotal_paise) === Number(savedMoney.subtotal_paise)
    && Number(live.gst_paise) === Number(savedMoney.gst_paise)
    && Number(live.delivery_charge_paise) === Number(savedMoney.delivery_charge_paise)
    && Number(live.total_paise) === Number(savedMoney.total_paise),
  'selection projection fails closed at both deadlines and capability-off while server money remains exact', {
    live,
    atRfqDeadline,
    atQuoteDeadline,
    parentFeatureOff,
    savedMoney,
  });
});

finish();

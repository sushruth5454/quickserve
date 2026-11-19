// P1b RFQ checks on the full real migration chain, including the reserved migration.
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const migration = (file) =>
  fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    .replace('create extension if not exists postgis with schema extensions;', '')
    .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
    .replaceAll('using gist', 'using btree');

const prelude = `
create schema if not exists extensions;
create type extensions.geography as (lng float8, lat float8);
create type extensions.geometry as (lng float8, lat float8);
create function extensions.st_makepoint(x float8, y float8) returns extensions.geography language sql immutable as $$ select row(x, y)::extensions.geography $$;
create function extensions.st_setsrid(g extensions.geography, srid int) returns extensions.geography language sql immutable as $$ select g $$;
create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8 language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(b.lat - a.lat) / 2), 2) + cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - a.lng) / 2), 2))) $$;
create function extensions.st_dwithin(a extensions.geography, b extensions.geography, d float8) returns boolean language sql immutable as $$ select extensions.st_distance(a, b) <= d $$;
create function extensions.geog_to_geom(g extensions.geography) returns extensions.geometry language sql immutable as $$ select row(g.lng, g.lat)::extensions.geometry $$;
create cast (extensions.geography as extensions.geometry) with function extensions.geog_to_geom(extensions.geography);
create function extensions.st_x(g extensions.geometry) returns float8 language sql immutable as $$ select g.lng $$;
create function extensions.st_y(g extensions.geometry) returns float8 language sql immutable as $$ select g.lat $$;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public, extensions to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (instance_id uuid, id uuid primary key, aud text, role text, phone text, phone_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}', created_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated, anon, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(prelude);
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter((file) => /^\d{4}[a-z]?_.*\.sql$/i.test(file) && Number(file.slice(0, 4)) <= 74)
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
for (const file of migrationFiles) {
  await db.exec(migration(file));
}
await db.exec("set timezone = 'UTC'");

const { ok, scenario, finish } = createHarness();
const check = (condition, message, actual) =>
  ok(condition, `${message}; actual=${JSON.stringify(actual)}`);
let userNumber = 0;

async function as(uid, role, query, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [uid ?? '']);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function expectError(run, pattern, message) {
  let actual = '';
  try {
    await run();
  } catch (error) {
    actual = error?.message ?? String(error);
  }
  check(pattern.test(actual), message, actual);
}

async function makeUser() {
  const id = randomUUID();
  const phone = `+1555${String(++userNumber).padStart(7, '0')}`;
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, phone]);
  return id;
}

async function makeShop(ownerId, name, gstin = null) {
  const row = (await db.query(`
    insert into public.shops (
      owner_id, name, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, gstin, status
    ) values (
      $1::uuid, $2::text, '1 Market Road', 'Vijayawada', 'Benz Circle', 16.5, 80.6, 20,
      true, true, $3::text, 'verified'
    ) returning id
  `, [ownerId, name, gstin])).rows[0];
  const category = (await db.query(`
    select id from public.product_categories where slug = 'tiles'
  `)).rows[0];
  await db.query(`
    insert into public.shop_categories (shop_id, category_id)
    values ($1::uuid, $2::uuid)
  `, [row.id, category.id]);
  return row.id;
}

async function createRfq(customerId, items, needsDelivery = true) {
  const category = (await db.query(`
    select id from public.product_categories where slug = 'tiles'
  `)).rows[0];
  const [row] = await as(customerId, 'authenticated', `
    select public.create_rfq(
      $1::uuid, $2::text, $3::jsonb, $4::text, $5::text, $6::double precision,
      $7::double precision, $8::boolean, $9::date, $10::text
    ) as id
  `, [
    category.id, 'Tiles for renovation', JSON.stringify(items),
    'Vijayawada', 'Benz Circle', 16.5, 80.6, needsDelivery, '2027-01-01', '',
  ]);
  return row.id;
}

function quoteLine(rfqItemId, values = {}) {
  return {
    rfq_item_id: rfqItemId,
    brand: 'Acme',
    model: '',
    specs: {},
    unit_price_paise: 1000,
    gst_rate_bp: 0,
    available: true,
    ...values,
  };
}

async function sendBusinessQuote(ownerId, shopId, rfqId, items, deliveryCharge = 0, deliveryDays = null, validUntil = null) {
  const [row] = await as(ownerId, 'authenticated', `
    select public.send_supplier_quote_for_business(
      $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int, $6::timestamptz, $7::text
    ) as id
  `, [rfqId, shopId, JSON.stringify(items), deliveryCharge, deliveryDays, validUntil, 'Offer']);
  return row.id;
}

async function turnOnRfqFlags() {
  await db.query(`
    update public.feature_flags set enabled = true
    where key in ('products', 'product_enquiries', 'product_rfq')
  `);
}

await turnOnRfqFlags();

await scenario('P1b exact quote math and no-payment enquiry selection', async () => {
  const customer = await makeUser();
  const ownerA = await makeUser();
  const ownerB = await makeUser();
  const shopA = await makeShop(ownerA, 'GST Registered Tile Shop', '29ABCDE1234F1Z5');
  const shopB = await makeShop(ownerB, 'Incomplete Tile Shop');
  const rfqId = await createRfq(customer, [
    { description: 'Floor tile', brand_pref: 'Acme', specs: { size: '10x10', finish: 'glossy' }, quantity: 2.5, unit: 'box' },
    { description: 'Wall tile', brand_pref: '', specs: { size: '20x20' }, quantity: 2, unit: 'piece' },
  ]);
  const rfqItems = (await db.query(`
    select id, seq from public.rfq_items where rfq_id = $1::uuid order by seq
  `, [rfqId])).rows;
  const completeItems = [
    quoteLine(rfqItems[0].id, {
      brand: 'Acme Plus', model: 'A-10', specs: { size: '20x20', finish: 'Glossy' },
      unit_price_paise: 101, gst_rate_bp: 500, quantity: 900, line_total_paise: 9000000,
    }),
    quoteLine(rfqItems[1].id, {
      brand: 'Plain', model: 'W-20', specs: { size: '20x20' },
      unit_price_paise: 1000, gst_rate_bp: 1200, quantity: 1, line_total_paise: 1,
    }),
  ];
  const completeQuoteId = await sendBusinessQuote(
    ownerA, shopA, rfqId, completeItems, 100, 100, '2050-01-01T00:00:00.000Z',
  );
  const incompleteQuoteId = await sendBusinessQuote(ownerB, shopB, rfqId, [
    quoteLine(rfqItems[0].id, { unit_price_paise: 1 }),
    quoteLine(rfqItems[1].id, { available: false, unit_price_paise: 0, gst_rate_bp: 0, specs: {} }),
  ]);
  const totals = (await db.query(`
    select subtotal_paise, gst_paise, total_paise from public.supplier_quotes
    where id = $1::uuid
  `, [completeQuoteId])).rows[0];
  check(Number(totals.subtotal_paise) === 2253 && Number(totals.gst_paise) === 253
    && Number(totals.total_paise) === 2606,
  'business RPC uses exact per-line paise rounding and ignores client totals/quantities', totals);
  const computedLines = (await db.query(`
    select qi.quantity, qi.line_total_paise
    from public.supplier_quote_items qi
    where qi.quote_id = $1::uuid
    order by qi.rfq_item_id
  `, [completeQuoteId])).rows;
  check(computedLines.some((line) => Number(line.quantity) === 2.5 && Number(line.line_total_paise) === 253)
    && computedLines.some((line) => Number(line.quantity) === 2 && Number(line.line_total_paise) === 2000),
  'quote lines retain RFQ quantities and compute their line totals server-side', computedLines);
  const cappedValidity = (await db.query(`
    select q.valid_until, r.expires_at
    from public.supplier_quotes q
    join public.rfqs r on r.id = q.rfq_id
    where q.id = $1::uuid
  `, [completeQuoteId])).rows[0];
  check(new Date(cappedValidity.valid_until).getTime() === new Date(cappedValidity.expires_at).getTime(),
    'supplier quote validity cannot exceed the RFQ expiry', cappedValidity);
  const unavailableLine = (await db.query(`
    select qi.available, qi.unit_price_paise, qi.line_total_paise
    from public.supplier_quote_items qi
    where qi.quote_id = $1::uuid and qi.rfq_item_id = $2::uuid
  `, [incompleteQuoteId, rfqItems[1].id])).rows[0];
  check(unavailableLine.available === false && Number(unavailableLine.unit_price_paise) === 0
    && Number(unavailableLine.line_total_paise) === 0,
  'unavailable quote lines contribute no item price', unavailableLine);

  const comparisons = await as(customer, 'authenticated', `
    select quote_id, complete, arrives_after_needed_by, delivery_terms_missing,
      unavailable_count, total_paise, items
    from public.compare_rfq_quotes($1::uuid)
  `, [rfqId]);
  const firstItem = comparisons[0]?.items?.find((item) => item.rfq_item_id === rfqItems[0].id);
  const unavailableItem = comparisons.find((quote) => quote.quote_id === incompleteQuoteId)
    ?.items?.find((item) => item.rfq_item_id === rfqItems[1].id);
  check(comparisons[0]?.quote_id === completeQuoteId && comparisons[0]?.complete === true
    && comparisons[1]?.quote_id === incompleteQuoteId && comparisons[1]?.complete === false,
  'complete quote sorts ahead of a cheaper incomplete quote', comparisons.map(({ quote_id, complete, total_paise }) => ({ quote_id, complete, total_paise })));
  check(firstItem?.specs_differ === true && JSON.stringify(firstItem?.differing_spec_keys) === JSON.stringify(['size']),
    'comparison flags only the requested value that differs after trim/case normalization', firstItem);
  check(comparisons[0]?.arrives_after_needed_by === true && comparisons[0]?.delivery_terms_missing === false,
    'comparison flags a delivery date later than needed-by', comparisons[0]);
  check(comparisons[1]?.delivery_terms_missing === true && unavailableItem?.specs_missing === false,
    'delivery terms are flagged and unavailable lines are not marked missing specs', { quote: comparisons[1], unavailableItem });

  const [wrapperRow] = await as(ownerA, 'authenticated', `
    select public.send_supplier_quote(
      $1::uuid, $2::jsonb, $3::bigint, $4::int, $5::timestamptz, $6::text
    ) as id
  `, [rfqId, JSON.stringify(completeItems), 100, 100, null, 'Owner wrapper']);
  const wrapperTotals = (await db.query(`
    select subtotal_paise, gst_paise, total_paise from public.supplier_quotes
    where id = $1::uuid
  `, [wrapperRow.id])).rows[0];
  check(Number(wrapperTotals.subtotal_paise) === 2253 && Number(wrapperTotals.gst_paise) === 253
    && Number(wrapperTotals.total_paise) === 2606,
  'owner quote RPC delegates to the same exact money calculation', wrapperTotals);

  await as(customer, 'authenticated', `select public.select_supplier_quote($1::uuid)`, [wrapperRow.id]);
  const selection = (await db.query(`
    select r.status as rfq_status, e.id as enquiry_id, e.customer_id, e.shop_id,
      m.body, (select count(*)::int from public.payments) as payment_count
    from public.rfqs r
    join public.product_enquiries e on e.customer_id = r.customer_id
    join public.product_enquiry_messages m on m.enquiry_id = e.id
    where r.id = $1::uuid
    order by m.created_at desc limit 1
  `, [rfqId])).rows[0];
  check(selection?.rfq_status === 'closed' && selection?.customer_id === customer
    && selection?.shop_id === shopA && selection?.body?.includes('no payment was taken')
    && selection?.payment_count === 0,
  'selection still opens the customer-shop enquiry and records no payment', selection);
  const rejectedOutcome = await as(ownerB, 'authenticated', `
    select rfq_status, my_outcome
    from public.list_my_supplier_rfqs() where rfq_id = $1::uuid
  `, [rfqId]);
  check(rejectedOutcome.length === 1 && rejectedOutcome[0].rfq_status === 'closed'
    && rejectedOutcome[0].my_outcome === 'rejected',
  'the competing supplier sees a rejected outcome after selection', rejectedOutcome);
});

await scenario('P1b GSTIN enforcement and pack quantity bounds', async () => {
  const customer = await makeUser();
  const owner = await makeUser();
  const shop = await makeShop(owner, 'No GSTIN Tile Shop');
  const gstRfqId = await createRfq(customer, [
    { description: 'Floor tile', specs: {}, quantity: 2, unit: 'box' },
  ], false);
  const [gstItem] = (await db.query(`
    select id from public.rfq_items where rfq_id = $1::uuid
  `, [gstRfqId])).rows;
  const [supplierRfqRow] = await as(owner, 'authenticated', `
    select public.get_supplier_rfq_for_business($1::uuid, $2::uuid) as value
  `, [gstRfqId, shop]);
  const supplierRfq = supplierRfqRow.value;
  check(supplierRfq.shop_has_gstin === false, 'supplier RFQ payload reports no GSTIN', supplierRfq);
  await expectError(
    () => sendBusinessQuote(owner, shop, gstRfqId, [quoteLine(gstItem.id, { gst_rate_bp: 1800 })]),
    /Add your GSTIN in My shop before charging GST/,
    'GST above 0% is rejected when the shop has no GSTIN',
  );
  const zeroGstQuoteId = await sendBusinessQuote(owner, shop, gstRfqId, [quoteLine(gstItem.id)]);
  const zeroGstQuote = (await db.query(`
    select gst_paise, total_paise from public.supplier_quotes where id = $1::uuid
  `, [zeroGstQuoteId])).rows[0];
  check(Number(zeroGstQuote.gst_paise) === 0 && Number(zeroGstQuote.total_paise) === 2000,
    'a shop without GSTIN can send a 0% quote', zeroGstQuote);

  const packCustomer = await makeUser();
  const packOwner = await makeUser();
  const packShop = await makeShop(packOwner, 'Pack Rounding Tile Shop');
  const packRfqId = await createRfq(packCustomer, [
    { description: 'Vitrified tile', specs: {}, quantity: 500, unit: 'sqft' },
  ], false);
  const [packItem] = (await db.query(`
    select id from public.rfq_items where rfq_id = $1::uuid
  `, [packRfqId])).rows;
  const roundedQuoteId = await sendBusinessQuote(packOwner, packShop, packRfqId, [
    quoteLine(packItem.id, { unit_price_paise: 1000, offered_quantity: 511.5 }),
  ]);
  const roundedLine = (await db.query(`
    select quantity, line_total_paise from public.supplier_quote_items
    where quote_id = $1::uuid
  `, [roundedQuoteId])).rows[0];
  const roundedComparison = (await as(packCustomer, 'authenticated', `
    select items from public.compare_rfq_quotes($1::uuid) where quote_id = $2::uuid
  `, [packRfqId, roundedQuoteId]))[0]?.items?.[0];
  check(Number(roundedLine.quantity) === 511.5 && Number(roundedLine.line_total_paise) === 511500
    && roundedComparison?.quantity_rounded_up === true,
  'offered pack quantity is used in totals and comparison', { line: roundedLine, comparison: roundedComparison });
  await expectError(
    () => sendBusinessQuote(packOwner, packShop, packRfqId, [
      quoteLine(packItem.id, { offered_quantity: 499 }),
    ]),
    /offered quantity must be at least the requested quantity and at most double it/,
    'offered quantity below the request is rejected',
  );
  await expectError(
    () => sendBusinessQuote(packOwner, packShop, packRfqId, [
      quoteLine(packItem.id, { offered_quantity: 1000.5 }),
    ]),
    /offered quantity must be at least the requested quantity and at most double it/,
    'offered quantity above double the request is rejected',
  );
  const omittedQuoteId = await sendBusinessQuote(packOwner, packShop, packRfqId, [
    quoteLine(packItem.id),
  ]);
  const omittedLine = (await db.query(`
    select quantity, line_total_paise from public.supplier_quote_items
    where quote_id = $1::uuid
  `, [omittedQuoteId])).rows[0];
  check(Number(omittedLine.quantity) === 500 && Number(omittedLine.line_total_paise) === 500000,
    'omitting offered quantity preserves the requested quantity', omittedLine);
});

await scenario('P1b cancellation and supplier outcomes', async () => {
  const customer = await makeUser();
  const nonOwner = await makeUser();
  const ownerA = await makeUser();
  const ownerB = await makeUser();
  const shopA = await makeShop(ownerA, 'Cancel Outcome Shop A');
  const shopB = await makeShop(ownerB, 'Cancel Outcome Shop B');
  const rfqId = await createRfq(customer, [
    { description: 'Wall tile', specs: {}, quantity: 1, unit: 'box' },
  ], false);
  const [rfqItem] = (await db.query(`
    select id from public.rfq_items where rfq_id = $1::uuid
  `, [rfqId])).rows;
  await sendBusinessQuote(ownerA, shopA, rfqId, [quoteLine(rfqItem.id)]);
  await sendBusinessQuote(ownerB, shopB, rfqId, [quoteLine(rfqItem.id)]);
  await expectError(
    () => as(nonOwner, 'authenticated', `select public.cancel_rfq($1::uuid)`, [rfqId]),
    /RFQ not found/i,
    'a different customer cannot cancel the RFQ',
  );
  await as(customer, 'authenticated', `select public.cancel_rfq($1::uuid)`, [rfqId]);
  const cancelled = (await db.query(`
    select r.status, array_agg(q.status order by q.shop_id) as quote_statuses
    from public.rfqs r
    join public.supplier_quotes q on q.rfq_id = r.id
    where r.id = $1::uuid
    group by r.status
  `, [rfqId])).rows[0];
  check(cancelled.status === 'cancelled' && cancelled.quote_statuses.every((status) => status === 'rejected'),
    'customer cancellation closes the RFQ and rejects outstanding quotes', cancelled);
  const supplierA = await as(ownerA, 'authenticated', `
    select rfq_status, my_outcome, quote_status
    from public.list_my_supplier_rfqs() where rfq_id = $1::uuid
  `, [rfqId]);
  const supplierB = await as(ownerB, 'authenticated', `
    select rfq_status, my_outcome, quote_status
    from public.list_my_supplier_rfqs() where rfq_id = $1::uuid
  `, [rfqId]);
  check(supplierA.length === 1 && supplierA[0].rfq_status === 'cancelled'
    && supplierA[0].my_outcome === 'rejected' && supplierA[0].quote_status === null,
  'supplier A sees the cancellation and latest quote outcome for 30 days', supplierA);
  check(supplierB.length === 1 && supplierB[0].rfq_status === 'cancelled'
    && supplierB[0].my_outcome === 'rejected' && supplierB[0].quote_status === null,
  'supplier B sees the cancellation and latest quote outcome for 30 days', supplierB);
  await expectError(
    () => sendBusinessQuote(ownerA, shopA, rfqId, [quoteLine(rfqItem.id)]),
    /RFQ is closed or expired/,
    'a cancelled RFQ refuses new supplier quotes',
  );
});

await scenario('P1b RFQ parent switch remains fail-closed', async () => {
  const customer = await makeUser();
  const owner = await makeUser();
  await makeShop(owner, 'Feature Switch Tile Shop');
  const rfqId = await createRfq(customer, [
    { description: 'Floor tile', specs: {}, quantity: 1, unit: 'box' },
  ], false);
  await db.query(`update public.feature_flags set enabled = false where key = 'products'`);
  await expectError(
    () => as(customer, 'authenticated', `select public.cancel_rfq($1::uuid)`, [rfqId]),
    /product RFQs are disabled/,
    'the product parent switch disables cancellation server-side',
  );
  await db.query(`update public.feature_flags set enabled = true where key = 'products'`);
});

finish();
await db.close();

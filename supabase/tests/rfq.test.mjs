import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create table auth.users (id uuid primary key);
  create table public.profiles (id uuid primary key references auth.users(id), full_name text not null default '');
  create table public.feature_flags (
    key text primary key, enabled boolean not null default false, label text not null,
    description text not null default '', group_name text not null default 'General',
    sort_order int not null default 100, updated_at timestamptz not null default now(), updated_by uuid
  );
  create table public.admins (user_id uuid primary key references public.profiles(id));
  create table public.notifications (
    id uuid primary key default gen_random_uuid(), user_id uuid not null,
    kind text not null check (kind in ('chat_message', 'product_enquiry', 'product_enquiry_reply')),
    booking_id uuid, title text not null, body text not null, data jsonb not null default '{}'::jsonb,
    collapse_key text, status text not null default 'pending', count int not null default 1,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create unique index notifications_pending_collapse_idx
    on public.notifications (user_id, collapse_key)
    where status = 'pending' and collapse_key is not null;
  create table public.product_categories (
    id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null,
    active boolean not null default true,
    attribute_schema jsonb not null default '{"type":"object","properties":{}}'::jsonb
  );
  create table public.shops (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references public.profiles(id),
    name text not null, city text not null, area text not null, lat double precision, lng double precision,
    delivery_radius_km int not null default 10, offers_delivery boolean not null default false,
    status text not null default 'draft'
  );
  create table public.shop_categories (
    shop_id uuid not null references public.shops(id) on delete cascade,
    category_id uuid not null references public.product_categories(id),
    primary key (shop_id, category_id)
  );
  create table public.products (id uuid primary key default gen_random_uuid());
  create table public.product_enquiries (
    id uuid primary key default gen_random_uuid(), shop_id uuid not null references public.shops(id),
    product_id uuid references public.products(id), customer_id uuid not null references public.profiles(id),
    status text not null default 'open', last_message_at timestamptz not null default now(),
    shop_unread int not null default 0, customer_unread int not null default 0
  );
  create unique index product_enquiries_one_open_idx
    on public.product_enquiries (shop_id, customer_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid))
    where status = 'open';
  create table public.product_enquiry_messages (
    id uuid primary key default gen_random_uuid(), enquiry_id uuid not null references public.product_enquiries(id),
    sender_id uuid not null references public.profiles(id), from_shop boolean not null, body text not null,
    created_at timestamptz not null default now()
  );
  create table public.payments (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
  create function public._require_uid() returns uuid language plpgsql stable as $$
  declare v_uid uuid := auth.uid();
  begin
    if v_uid is null then raise exception 'not authenticated'; end if;
    return v_uid;
  end $$;
  create function public._assert(p_ok boolean, p_message text) returns void language plpgsql immutable as $$
  begin
    if not coalesce(p_ok, false) then raise exception '%', p_message; end if;
  end $$;
  create function public._feature_enabled(p_key text) returns boolean language sql stable security definer set search_path = public as $$
    select coalesce((select enabled from public.feature_flags where key = p_key), false)
  $$;
  create function public._is_admin() returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.admins where user_id = auth.uid())
  $$;
  create function public._shops_products_enabled() returns boolean language sql stable security definer set search_path = public as $$
    select public._feature_enabled('products')
  $$;
  create function public._shops_enquiries_enabled() returns boolean language sql stable security definer set search_path = public as $$
    select public._feature_enabled('products') and public._feature_enabled('product_enquiries')
  $$;
  create function public._shop_is_owner(p_shop_id uuid) returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.shops where id = p_shop_id and owner_id = auth.uid())
  $$;
  create function public._queue_notification(
    p_user uuid, p_kind text, p_booking uuid, p_title text, p_body text, p_data jsonb, p_collapse_key text default null
  ) returns void language plpgsql security definer set search_path = public as $$
  begin
    insert into public.notifications (user_id, kind, booking_id, title, body, data, collapse_key)
    values (p_user, p_kind, p_booking, left(p_title, 120), left(p_body, 300), coalesce(p_data, '{}'::jsonb), p_collapse_key)
    on conflict (user_id, collapse_key) where status = 'pending' and collapse_key is not null
    do update set count = notifications.count + 1, title = excluded.title, body = excluded.body,
      data = excluded.data, updated_at = now();
  end $$;
  create function public._product_enquiry_post(
    p_enquiry_id uuid, p_sender_id uuid, p_from_shop boolean, p_body text, p_initial boolean default false
  ) returns void language plpgsql security definer set search_path = public as $$
  declare e public.product_enquiries; s public.shops;
  begin
    select * into e from public.product_enquiries where id = p_enquiry_id for update;
    if not found or e.status <> 'open' then raise exception 'enquiry is closed or unavailable'; end if;
    select * into s from public.shops where id = e.shop_id;
    insert into public.product_enquiry_messages (enquiry_id, sender_id, from_shop, body)
    values (e.id, p_sender_id, p_from_shop, p_body);
    update public.product_enquiries set shop_unread = case when p_from_shop then 0 else shop_unread + 1 end,
      customer_unread = case when p_from_shop then customer_unread + 1 else 0 end, last_message_at = now()
    where id = e.id;
    perform public._queue_notification(s.owner_id, 'product_enquiry', null, 'New product enquiry', p_body,
      jsonb_build_object('url', '/enquiry/' || e.id, 'enquiry_id', e.id), null);
  end $$;
  create function public._validate_product_specs(p_category_id uuid, p_specs jsonb)
  returns void language plpgsql stable security definer set search_path = public as $$
  begin
    perform public._assert(jsonb_typeof(coalesce(p_specs, '{}'::jsonb)) = 'object', 'product specifications must be an object');
  end $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant execute on all functions in schema public to anon, authenticated, service_role;
`);

const customer = '00000000-0000-0000-0000-0000000000c1';
const otherCustomer = '00000000-0000-0000-0000-0000000000c2';
const merchants = Array.from({ length: 17 }, (_, index) =>
  `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
);
const users = [customer, otherCustomer, ...merchants];
await db.query(`insert into auth.users (id) values ${users.map((id) => `('${id}')`).join(',')}`);
await db.query(`insert into public.profiles (id, full_name) values ${users.map((id, i) => `('${id}', 'User ${i + 1}')`).join(',')}`);

await db.query(`insert into public.product_categories (slug, name, attribute_schema) values
  ('tiles', 'Tiles', '{"type":"object","properties":{"size":{"type":"string"},"finish":{"type":"string"}}}'::jsonb),
  ('electrical', 'Electrical', '{"type":"object","properties":{}}'::jsonb)`);
await db.query(`insert into public.feature_flags (key, enabled, label) values
  ('products', false, 'Products'), ('product_enquiries', false, 'Product enquiries')`);

const migrationUrl = new URL('../migrations/0050_rfq.sql', import.meta.url);
await db.exec(fs.readFileSync(migrationUrl, 'utf8'));

let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log(`ok  : ${message}`);
  else { failures++; console.error(`FAIL: ${message}`); }
};
async function as(uid, role, query, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return (await db.query(query, params)).rows; }
  finally { await db.exec('reset role;'); }
}
async function expectError(fn, pattern, message) {
  try { await fn(); ok(false, `${message} (no error)`); }
  catch (error) { ok(pattern.test(error.message), `${message} -> ${error.message}`); }
}

const flag = await db.query(`select enabled from public.feature_flags where key = 'product_rfq'`).then((result) => result.rows[0]);
ok(flag?.enabled === false, 'product_rfq is seeded disabled');
await db.query(`update public.feature_flags set enabled = true where key = 'products'`);
const categoryIds = await db.query(`select id, slug from public.product_categories order by slug`).then((result) => result.rows);
const tiles = categoryIds.find((category) => category.slug === 'tiles').id;
const electrical = categoryIds.find((category) => category.slug === 'electrical').id;
const requestItems = [
  { description: 'Floor tile', brand_pref: 'Acme', specs: { size: '10x10', finish: 'glossy' }, quantity: 2.5, unit: 'box' },
  { description: 'Wall tile', brand_pref: '', specs: { size: '20x20' }, quantity: 2, unit: 'piece' },
];
async function createRfq(owner = customer, items = requestItems) {
  const [row] = await as(owner, 'authenticated', `
    select public.create_rfq($1, 'Tiles for renovation', $2::jsonb, 'Vijayawada', 'Benz Circle',
      16.5, 80.6, true, current_date + 14, 'Please include current availability.') as id
  `, [tiles, JSON.stringify(items)]);
  return row.id;
}
async function makeShop(owner, name, options = {}) {
  const [shop] = await db.query(`
    insert into public.shops (owner_id, name, city, area, lat, lng, delivery_radius_km, offers_delivery, status)
    values ($1, $2, 'Vijayawada', 'Benz Circle', $3, $4, $5, $6, $7) returning id
  `, [owner, name, options.lat ?? 16.5, options.lng ?? 80.6, options.radius ?? 20, options.delivery ?? true, options.status ?? 'verified'])
    .then((result) => result.rows);
  await db.query(`insert into public.shop_categories (shop_id, category_id) values ($1, $2)`,
    [shop.id, options.category ?? tiles]);
  return shop.id;
}
for (let index = 0; index < 12; index++) {
  await makeShop(merchants[index], `Tile Shop ${index + 1}`, { lat: 16.5 + index * 0.001 });
}
const unverifiedShop = await makeShop(merchants[12], 'Unverified Tile Shop', { status: 'submitted' });
const wrongCategoryShop = await makeShop(merchants[13], 'Electrical Shop', { category: electrical });
const outsideRadiusShop = await makeShop(merchants[14], 'Distant Tile Shop', { lat: 17.5, radius: 5 });
const deliveryShop = await makeShop(merchants[15], 'Electrical Delivery Shop', { category: electrical });
const pickupOnlyShop = await makeShop(merchants[16], 'Electrical Pickup Shop', { category: electrical, delivery: false });

await expectError(
  () => as(customer, 'authenticated', `select public.create_rfq($1, 'Disabled', $2::jsonb, 'Vijayawada', 'Benz Circle', 16.5, 80.6, true, current_date + 14, null)`, [tiles, JSON.stringify(requestItems)]),
  /product RFQs are disabled/,
  'RFQ creation is refused while the product_rfq flag is off',
);
await expectError(
  () => as(merchants[0], 'authenticated', `select * from public.list_my_supplier_rfqs()`),
  /product RFQs are disabled/,
  'supplier RFQ access is refused while the product_rfq flag is off',
);
await db.query(`update public.feature_flags set enabled = true where key = 'product_rfq'`);
await db.query(`update public.feature_flags set enabled = true where key = 'product_enquiries'`);

const rfqId = await createRfq();
const recipients = await db.query(`select shop_id from public.rfq_recipients where rfq_id = $1`, [rfqId]).then((result) => result.rows);
ok(recipients.length === 10, 'routing is capped at ten eligible verified shops');
ok(!recipients.some((recipient) => [unverifiedShop, wrongCategoryShop, outsideRadiusShop].includes(recipient.shop_id)),
  'routing excludes unverified, wrong-category, and out-of-radius shops');
const routedIds = recipients.map((recipient) => recipient.shop_id);
const nonRecipient = (await db.query(`select id, owner_id from public.shops order by id`).then((result) => result.rows))
  .find((shop) => !routedIds.includes(shop.id));
ok((await db.query(`select count(*)::int as count from public.notifications where kind = 'rfq_received' and data->>'rfq_id' = $1`, [rfqId])).rows[0].count === 10,
  'each routed shop owner receives an RFQ notification');
const rfqNotificationUrl = (await db.query(`
  select data->>'url' as url from public.notifications
  where kind = 'rfq_received' and data->>'rfq_id' = $1 limit 1
`, [rfqId])).rows[0].url;
ok(rfqNotificationUrl === `/rfq/merchant/${rfqId}`, 'RFQ notifications deep-link to the routed supplier request');
const deliveryRfq = (await as(customer, 'authenticated', `
  select public.create_rfq($1, 'Electrical delivery request', $2::jsonb, 'Vijayawada', 'Benz Circle',
    16.5, 80.6, true, current_date + 14, null) as id
`, [electrical, JSON.stringify([{ description: 'Electrical cable', quantity: 1, unit: 'piece', specs: {} }])]))[0].id;
const deliveryRecipients = await db.query(`select shop_id from public.rfq_recipients where rfq_id = $1`, [deliveryRfq]).then((result) => result.rows.map((row) => row.shop_id));
ok(deliveryRecipients.length === 2 && deliveryRecipients.includes(deliveryShop)
  && deliveryRecipients.includes(wrongCategoryShop) && !deliveryRecipients.includes(pickupOnlyShop),
  'delivery requests route only to category shops that offer delivery');
const deliveryDetails = (await as(customer, 'authenticated', `select public.get_rfq($1) as data`, [deliveryRfq]))[0].data;
const [deliveryItem] = deliveryDetails.items;
const [shortQuote] = await as(merchants[15], 'authenticated', `
  select public.send_supplier_quote($1, $2::jsonb, 0, 1, now() + interval '1 day', null) as id
`, [deliveryRfq, JSON.stringify([{
  rfq_item_id: deliveryItem.id, brand: 'CableCo', model: '', specs: {}, unit_price_paise: 1000,
  gst_rate_bp: 1800, available: true,
}])]);
await db.query(`update public.supplier_quotes set valid_until = now() - interval '1 minute' where id = $1`, [shortQuote.id]);
const [quoteExpiryCount] = await as(null, 'service_role', `select public.expire_rfqs() as count`);
const shortQuoteStatus = await db.query(`
  select q.status as quote_status, r.status as rfq_status
  from public.supplier_quotes q join public.rfqs r on r.id = q.rfq_id where q.id = $1
`, [shortQuote.id]).then((result) => result.rows[0]);
ok(quoteExpiryCount.count === 0 && shortQuoteStatus.quote_status === 'expired' && shortQuoteStatus.rfq_status === 'open',
  'an expired quote closes independently while its RFQ remains open');
const hiddenFromOther = await as(otherCustomer, 'authenticated', `select id from public.rfqs where id = $1`, [rfqId]);
ok(hiddenFromOther.length === 0, 'another customer cannot read the RFQ row through RLS');
const hiddenFromUnroutedShop = await as(nonRecipient.owner_id, 'authenticated', `select id from public.rfqs where id = $1`, [rfqId]);
ok(hiddenFromUnroutedShop.length === 0, 'an unrouted shop cannot read RFQ rows through RLS');
await expectError(
  () => as(otherCustomer, 'authenticated', `select public.get_rfq($1)`, [rfqId]),
  /rfq not found/i,
  'another customer cannot read RFQ details',
);
await expectError(
  () => as(merchants[13], 'authenticated', `select public.send_supplier_quote($1, '[]'::jsonb, 0, 0, null, null)`, [rfqId]),
  /shop is not a recipient/,
  'a shop outside the recipient list cannot quote',
);

const [firstRouted] = await db.query(`
  select s.id, s.owner_id from public.rfq_recipients r join public.shops s on s.id = r.shop_id
  where r.rfq_id = $1 order by s.id limit 2
`, [rfqId]).then((result) => result.rows);
const secondRouted = (await db.query(`
  select s.id, s.owner_id from public.rfq_recipients r join public.shops s on s.id = r.shop_id
  where r.rfq_id = $1 and s.id <> $2 order by s.id limit 1
`, [rfqId, firstRouted.id])).rows[0];
const rfqDetails = (await as(customer, 'authenticated', `select public.get_rfq($1) as data`, [rfqId]))[0].data;
const [firstItem, secondItem] = rfqDetails.items;
const quoteItems = [
  {
    rfq_item_id: firstItem.id, brand: 'Acme Plus', model: 'A-10', specs: { size: '10x10' },
    unit_price_paise: 101, gst_rate_bp: 500, available: true, quantity: 900,
    line_total_paise: 9000000, subtotal_paise: 9000000, gst_paise: 0, total_paise: 1,
  },
  {
    rfq_item_id: secondItem.id, brand: 'Plain', model: 'W-20', specs: { size: '20x20' },
    unit_price_paise: 1000, gst_rate_bp: 1200, available: true, quantity: 1,
    line_total_paise: 1,
  },
];
async function sendQuote(owner, shopItems = quoteItems) {
  return (await as(owner, 'authenticated', `
    select public.send_supplier_quote($1, $2::jsonb, 100, 4, now() + interval '30 days', 'Offer') as id
  `, [rfqId, JSON.stringify(shopItems)]))[0].id;
}
const originalQuoteId = await sendQuote(firstRouted.owner_id);
const selectedQuoteId = await sendQuote(firstRouted.owner_id);
const competitorItems = quoteItems.map((item, index) => index === 1
  ? { rfq_item_id: item.rfq_item_id, brand: '', model: '', specs: {}, available: false }
  : { ...item, brand: 'Acme', specs: { size: '10x10', finish: 'glossy' }, unit_price_paise: item.unit_price_paise + 500 });
const competitorQuoteId = await sendQuote(secondRouted.owner_id, competitorItems);
const unavailableLine = await db.query(`select available, unit_price_paise, gst_rate_bp, line_total_paise from public.supplier_quote_items where quote_id = $1 and rfq_item_id = $2`, [competitorQuoteId, secondItem.id])
  .then((result) => result.rows[0]);
ok(unavailableLine.available === false && Number(unavailableLine.unit_price_paise) === 0 && Number(unavailableLine.line_total_paise) === 0,
  'an unavailable quote line is accepted without a price or GST input and contributes zero');
const quoteRows = await db.query(`
  select id, version, status, subtotal_paise, gst_paise, total_paise, valid_until
  from public.supplier_quotes where rfq_id = $1 and shop_id = $2 order by version
`, [rfqId, firstRouted.id]).then((result) => result.rows);
ok(quoteRows.length === 2 && quoteRows[0].id === originalQuoteId && quoteRows[0].status === 'withdrawn' && quoteRows[1].status === 'sent',
  'a newer supplier quote withdraws the previous sent version');
ok(
  Number(quoteRows[1].subtotal_paise) === 2253 && Number(quoteRows[1].gst_paise) === 253 && Number(quoteRows[1].total_paise) === 2606,
  'subtotal, per-line GST, and total are computed from RFQ quantities and server rules, ignoring client totals',
);
const lineRows = await db.query(`
  select qi.quantity, qi.line_total_paise, qi.gst_rate_bp
    from public.supplier_quote_items qi join public.rfq_items i on i.id = qi.rfq_item_id
   where qi.quote_id = $1 order by i.seq
`, [selectedQuoteId]).then((result) => result.rows);
ok(Number(lineRows[0].quantity) === 2.5 && Number(lineRows[0].line_total_paise) === 253 && Number(lineRows[1].quantity) === 2,
  'quote quantities are copied from RFQ items and client-supplied quantities are ignored');
const cappedQuote = await db.query(`select valid_until, (select expires_at from public.rfqs where id = $1) as rfq_expires_at from public.supplier_quotes where id = $2`, [rfqId, selectedQuoteId])
  .then((result) => result.rows[0]);
ok(new Date(cappedQuote.valid_until).getTime() === new Date(cappedQuote.rfq_expires_at).getTime(),
  'quote validity cannot extend beyond the RFQ expiry');
const comparisons = await as(customer, 'authenticated', `select * from public.compare_rfq_quotes($1)`, [rfqId]);
const comparedQuote = comparisons.find((quote) => quote.quote_id === selectedQuoteId);
const comparedItem = comparedQuote.items.find((item) => item.rfq_item_id === firstItem.id);
ok(comparedItem.brand_differs && comparedItem.specs_missing && comparedItem.missing_spec_keys.includes('finish'),
  'comparison marks case-insensitive brand differences and absent requested spec keys');
ok(!Object.hasOwn(comparedItem, 'equivalent'), 'comparison does not infer item equivalence');
await expectError(
  () => as(otherCustomer, 'authenticated', `select * from public.compare_rfq_quotes($1)`, [rfqId]),
  /rfq not found/i,
  'comparison results are private to the RFQ customer',
);

const [selection] = await as(customer, 'authenticated', `select public.select_supplier_quote($1) as result`, [selectedQuoteId]);
const selectionResult = selection.result;
const statuses = await db.query(`select id, status from public.supplier_quotes where id in ($1, $2) order by id`, [selectedQuoteId, competitorQuoteId])
  .then((result) => result.rows);
ok(statuses.find((quote) => quote.id === selectedQuoteId)?.status === 'selected'
  && statuses.find((quote) => quote.id === competitorQuoteId)?.status === 'rejected',
  'selection keeps the chosen quote and rejects competing sent quotes');
const closed = await db.query(`select status from public.rfqs where id = $1`, [rfqId]).then((result) => result.rows[0].status);
const enquiry = await db.query(`select id, shop_id, customer_id from public.product_enquiries where id = $1`, [selectionResult.enquiry_id])
  .then((result) => result.rows[0]);
const enquiryMessage = await db.query(`select body, from_shop from public.product_enquiry_messages where enquiry_id = $1`, [selectionResult.enquiry_id])
  .then((result) => result.rows[0]);
ok(closed === 'closed' && enquiry?.shop_id === firstRouted.id && enquiry.customer_id === customer
  && enquiryMessage?.from_shop === false,
  'selection closes the RFQ and opens a customer-to-selected-shop enquiry for next steps');
ok((await db.query(`select count(*)::int as count from public.payments`).then((result) => result.rows[0].count)) === 0,
  'selecting a supplier creates no payment');

const expiryRfqId = await createRfq(otherCustomer, [
  { description: 'Urgent electrical part', brand_pref: '', specs: {}, quantity: 1, unit: 'piece' },
]);
const expiryDetails = (await as(otherCustomer, 'authenticated', `select public.get_rfq($1) as data`, [expiryRfqId]))[0].data;
const [expiryItem] = expiryDetails.items;
const expiryShop = (await db.query(`select s.id, s.owner_id from public.rfq_recipients r join public.shops s on s.id = r.shop_id where r.rfq_id = $1 limit 1`, [expiryRfqId])).rows[0];
const [expiryQuote] = await as(expiryShop.owner_id, 'authenticated', `
  select public.send_supplier_quote($1, $2::jsonb, 0, 2, null, null) as id
`, [expiryRfqId, JSON.stringify([{
  rfq_item_id: expiryItem.id, brand: 'Generic', model: '', specs: {}, unit_price_paise: 500,
  gst_rate_bp: 0, available: true,
}])]);
await db.query(`update public.rfqs set expires_at = now() - interval '1 minute' where id = $1`, [expiryRfqId]);
const [expiredCount] = await as(null, 'service_role', `select public.expire_rfqs() as count`);
const expiryStatuses = await db.query(`
  select r.status as rfq_status, q.status as quote_status
  from public.rfqs r join public.supplier_quotes q on q.rfq_id = r.id
  where r.id = $1 and q.id = $2
`, [expiryRfqId, expiryQuote.id]).then((result) => result.rows[0]);
ok(expiredCount.count === 1 && expiryStatuses.rfq_status === 'expired' && expiryStatuses.quote_status === 'expired',
  'expiry job expires overdue RFQs and their outstanding sent quotes');

await expectError(
  () => as(otherCustomer, 'authenticated', `select public.admin_rfq_dashboard()`),
  /admin only/,
  'RFQ activity metrics are restricted to administrators',
);
await db.query(`insert into public.admins (user_id) values ($1)`, [merchants[0]]);
const adminDashboard = (await as(merchants[0], 'authenticated', `select public.admin_rfq_dashboard() as data`))[0].data;
ok(adminDashboard.total_rfqs === 3 && adminDashboard.recent_rfqs.length === 3
  && typeof adminDashboard.average_response_minutes === 'number',
  'administrators receive open-request, quote-count, and first-response metrics');

if (failures) process.exitCode = 1;
await db.close();

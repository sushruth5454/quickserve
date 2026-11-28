import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const h = createHarness();
const customers = [
  '00000000-0000-0000-0000-000000000711',
  '00000000-0000-0000-0000-000000000712',
  '00000000-0000-0000-0000-000000000713',
  '00000000-0000-0000-0000-000000000714',
];
const providers = [
  '00000000-0000-0000-0000-000000000721',
  '00000000-0000-0000-0000-000000000722',
];

async function addUser(id, name) {
  await db.query('insert into auth.users (id, phone) values ($1::uuid, $2::text) on conflict (id) do nothing', [id, `+919700000${id.slice(-3)}`]);
  await db.query('insert into public.profiles (id, full_name) values ($1::uuid, $2::text) on conflict (id) do update set full_name = excluded.full_name', [id, name]);
}

async function addBookingService(customer, provider, label) {
  await addUser(customer, `${label} customer`);
  await addUser(provider, `${label} provider`);
  await db.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, is_online, suspended, paused, timezone, admin_review_status
    )
    values ($1::uuid, 'R1 City', extensions.st_setsrid(extensions.st_makepoint(80.6, 16.5), 4326),
      'verified', now(), true, false, false, 'Asia/Kolkata', 'approved')
    on conflict (id) do nothing
  `, [provider]);
  const category = (await db.query("select id from public.categories where slug = 'ac-repair'")).rows[0].id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, 'R1 City', true, now())
    on conflict (category_id, city) do update set live = true
  `, [category]);
  await db.query('update public.categories set max_lead_days = 365 where id = $1::uuid', [category]);
  await db.query(`
    insert into public.provider_availability (provider_id, weekday, start_time, end_time)
    select $1::uuid, day::smallint, '08:00'::time, '18:00'::time
      from generate_series(0, 6) day
  `, [provider]);
  const service = (await db.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 19900, 50000, true)
    returning id
  `, [provider, category])).rows[0].id;
  return service;
}

async function booking(customer, service, scheduledAt, key) {
  return (await as(customer, 'authenticated', `
    select public.create_booking_v2(
      $1::uuid, $2::text, $3::text, $4::text, $5::double precision, $6::double precision,
      $7::timestamptz, $8::text[], $9::uuid, $10::text
    ) as id
  `, [service, 'R1 idempotency', '1 R1 Road', 'R1 City', 16.5, 80.6, scheduledAt, [], null, key]))[0].id;
}

await h.scenario('same booking key reuses the booking and its address', async () => {
  const service = await addBookingService(customers[0], providers[0], 'same-key');
  const slot = '2027-01-15T10:00:00+05:30';
  const first = await booking(customers[0], service, slot, 'same-booking-key');
  const duplicate = await booking(customers[0], service, slot, 'same-booking-key');
  const different = await booking(customers[0], service, '2027-01-16T10:00:00+05:30', 'different-booking-key');
  const state = (await db.query(`
    select
      (select count(*)::int from public.bookings b where b.customer_id = $1::uuid) as bookings,
      (select count(*)::int from public.addresses a where a.user_id = $1::uuid and a.label = 'Booking') as addresses,
      (select count(*)::int from public.bookings b where b.customer_id = $1::uuid and b.idempotency_key = 'same-booking-key') as keyed
  `, [customers[0]])).rows[0];
  h.ok(first === duplicate && different !== first && state.bookings === 2 && state.addresses === 2 && state.keyed === 1,
    `same key reuses one booking/address and distinct key creates another; actual=${JSON.stringify({ first, duplicate, different, state })}`);
});

await h.scenario('concurrent booking submissions with one key converge', async () => {
  const service = await addBookingService(customers[1], providers[1], 'concurrent');
  const slot = '2027-01-17T10:00:00+05:30';
  const results = await Promise.all([
    booking(customers[1], service, slot, 'concurrent-booking-key'),
    booking(customers[1], service, slot, 'concurrent-booking-key'),
  ]);
  const state = (await db.query(`
    select
      (select count(*)::int from public.bookings b where b.customer_id = $1::uuid) as bookings,
      (select count(*)::int from public.addresses a where a.user_id = $1::uuid and a.label = 'Booking') as addresses
  `, [customers[1]])).rows[0];
  h.ok(results[0] === results[1] && state.bookings === 1 && state.addresses === 1,
    `concurrent same-key calls converge; actual=${JSON.stringify({ results, state })}`);
});

await h.scenario('service-request key reuses request and private details', async () => {
  await addUser(customers[2], 'request customer');
  const category = (await db.query(`
    insert into public.categories (slug, name, pricing_mode, active, archetype, intake_schema, config_version, max_lead_days)
    values ('r1-request-test', 'R1 request test', 'quote', true, 'proposal', '{"type":"object","properties":{}}'::jsonb, 1, 365)
    on conflict (slug) do update set active = true
    returning id
  `)).rows[0].id;
  const slot = '2027-01-20T10:00:00+05:30';
  const createRequest = () => as(customers[2], 'authenticated', `
    select public.create_service_request_v2(
      $1::uuid, 'R1 City', 'R1 Area', $2::timestamptz, $3::timestamptz, '{"brief":"A sufficiently detailed request brief"}'::jsonb,
      100000, 200000, null::uuid, 'Private venue details', null::uuid, null::double precision,
      null::double precision, false, 'same-request-key'
    ) as id
  `, [category, slot, '2027-01-20T14:00:00+05:30']);
  const first = (await createRequest())[0].id;
  const duplicate = (await createRequest())[0].id;
  const state = (await db.query(`
    select
      (select count(*)::int from public.service_requests r where r.customer_id = $1::uuid and r.idempotency_key = 'same-request-key') as requests,
      (select count(*)::int from public.request_private p join public.service_requests r on r.id = p.request_id where r.customer_id = $1::uuid) as private_rows
  `, [customers[2]])).rows[0];
  h.ok(first === duplicate && state.requests === 1 && state.private_rows === 1,
    `same request key reuses one request/private row; actual=${JSON.stringify({ first, duplicate, state })}`);
});

await h.scenario('RFQ key reuses the existing RFQ and items', async () => {
  await addUser(customers[3], 'RFQ customer');
  const merchant = '00000000-0000-0000-0000-000000000731';
  await addUser(merchant, 'RFQ merchant');
  await db.query(`
    insert into public.feature_flags (key, enabled, label, description)
    values ('products', true, 'Products', ''), ('product_rfq', true, 'Product RFQ', '')
    on conflict (key) do update set enabled = true
  `);
  const category = (await db.query(`
    insert into public.product_categories (slug, name, attribute_schema)
    values ('r1-idempotency-tiles', 'R1 idempotency tiles', '{"type":"object","properties":{}}'::jsonb)
    on conflict (slug) do update set active = true
    returning id
  `)).rows[0].id;
  const shop = (await db.query(`
    insert into public.shops (owner_id, name, city, area, lat, lng, delivery_radius_km, offers_delivery, status)
    values ($1::uuid, 'R1 idempotency shop', 'R1 City', 'R1 Area', 16.5, 80.6, 20, false, 'verified')
    returning id
  `, [merchant])).rows[0].id;
  await db.query('insert into public.shop_categories (shop_id, category_id) values ($1::uuid, $2::uuid)', [shop, category]);
  const createRfq = () => as(customers[3], 'authenticated', `
    select public.create_rfq_v2(
      $1::uuid, 'R1 supply request', $2::jsonb, 'R1 City', 'R1 Area', 16.5, 80.6, false,
      date '2027-01-30', 'R1 idempotency test', 'same-rfq-key'
    ) as id
  `, [category, JSON.stringify([{ description: 'Tile', brand_pref: '', specs: {}, quantity: 2, unit: 'piece' }])]);
  const first = (await createRfq())[0].id;
  const duplicate = (await createRfq())[0].id;
  const state = (await db.query(`
    select
      (select count(*)::int from public.rfqs r where r.customer_id = $1::uuid and r.idempotency_key = 'same-rfq-key') as rfqs,
      (select count(*)::int from public.rfq_items i where i.rfq_id = $2::uuid) as items
  `, [customers[3], first])).rows[0];
  h.ok(first === duplicate && state.rfqs === 1 && state.items === 1,
    `same RFQ key reuses one RFQ/item set; actual=${JSON.stringify({ first, duplicate, state })}`);
});

h.finish();

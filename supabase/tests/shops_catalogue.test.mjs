import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  create schema storage;
  create table auth.users (id uuid primary key);
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text not null default ''
  );
  create table public.admins (user_id uuid primary key references public.profiles(id));
  create table public.admin_audit_log (
    id bigint generated always as identity primary key,
    admin_id uuid not null,
    action text not null,
    target_id uuid,
    details jsonb not null default '{}'::jsonb,
    at timestamptz not null default now()
  );
  create table public.feature_flags (
    key text primary key,
    enabled boolean not null default false,
    label text not null,
    description text not null default '',
    group_name text not null default 'General',
    sort_order int not null default 100,
    updated_at timestamptz not null default now(),
    updated_by uuid
  );
  create table public.notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    kind text not null check (kind in ('chat_message')),
    booking_id uuid,
    title text not null,
    body text not null,
    data jsonb not null default '{}'::jsonb,
    collapse_key text,
    status text not null default 'pending',
    count int not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index notifications_pending_collapse_idx
    on public.notifications (user_id, collapse_key)
    where status = 'pending' and collapse_key is not null;
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
  create function public._is_admin() returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.admins where user_id = auth.uid())
  $$;
  create function public._feature_enabled(p_key text) returns boolean language sql stable security definer set search_path = public as $$
    select coalesce((select enabled from public.feature_flags where key = p_key), false)
  $$;
  create function public._queue_notification(
    p_user uuid, p_kind text, p_booking uuid, p_title text, p_body text, p_data jsonb, p_collapse_key text default null
  ) returns void language plpgsql security definer set search_path = public as $$
  begin
    insert into public.notifications (user_id, kind, booking_id, title, body, data, collapse_key)
    values (p_user, p_kind, p_booking, p_title, p_body, coalesce(p_data, '{}'::jsonb), p_collapse_key)
    on conflict (user_id, collapse_key) where status = 'pending' and collapse_key is not null
    do update set count = notifications.count + 1, title = excluded.title, body = excluded.body,
      data = excluded.data, updated_at = now();
  end $$;
  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text
  );
  grant usage on schema auth, public, storage to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant all on all tables in schema public, storage to anon, authenticated;
`);

const customer = '00000000-0000-0000-0000-0000000000c1';
const otherCustomer = '00000000-0000-0000-0000-0000000000c2';
const merchantA = '00000000-0000-0000-0000-0000000000a1';
const merchantB = '00000000-0000-0000-0000-0000000000a2';
const merchantC = '00000000-0000-0000-0000-0000000000a3';
const admin = '00000000-0000-0000-0000-0000000000b1';
await db.exec(`
  insert into auth.users (id) values
    ('${customer}'), ('${otherCustomer}'), ('${merchantA}'), ('${merchantB}'), ('${merchantC}'), ('${admin}');
  insert into public.profiles (id, full_name) values
    ('${customer}', 'Customer One'), ('${otherCustomer}', 'Customer Two'),
    ('${merchantA}', 'North Shop'), ('${merchantB}', 'South Shop'),
    ('${merchantC}', 'Pending Shop'), ('${admin}', 'Admin User');
  insert into public.admins (user_id) values ('${admin}');
`);

const migrationUrl = new URL('../migrations/0049_shops_catalogue.sql', import.meta.url);
const fs = await import('node:fs');
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

const flags = await db.query(`select key, enabled from public.feature_flags where key in ('products', 'product_enquiries') order by key`);
ok(flags.rows.length === 2 && flags.rows.every((flag) => flag.enabled === false), 'both marketplace flags default off');
await expectError(
  () => as(customer, 'authenticated', `select * from public.search_products()`),
  /products are disabled/,
  'search is refused while the products feature is off',
);
await db.query(`update public.feature_flags set enabled = true where key in ('products', 'product_enquiries')`);

const tiles = (await db.query(`select id from public.product_categories where slug = 'tiles'`)).rows[0].id;
async function makeShop(owner, name, lat, lng, verify) {
  const [created] = await as(owner, 'authenticated', `
    select public.save_shop($1, $2, $3, $4, $5, $6, $7, 10, true, true, false, null, array['tiles']::text[]) as id
  `, [name, `${name} supplies`, '12 Market Road', 'Vijayawada', 'Benz Circle', lat, lng]);
  await as(owner, 'authenticated', `select public.submit_shop($1)`, [created.id]);
  if (verify) await as(admin, 'authenticated', `select public.admin_set_shop_status($1, 'verified', null)`, [created.id]);
  return created.id;
}
async function makeProduct(owner, shopId, name, price, stock = true, specs = {}) {
  const [created] = await as(owner, 'authenticated', `
    select public.save_product(null, $1, $2, 'QuickBuild', '', '', $3::jsonb, 'box', $4, $5, true, '{}'::text[]) as id
  `, [tiles, name, JSON.stringify(specs), price, stock]);
  return created.id;
}

const shopA = await makeShop(merchantA, 'North Tiles', 16.5000, 80.6000, true);
const shopB = await makeShop(merchantB, 'South Tiles', 16.5400, 80.6400, true);
const shopC = await makeShop(merchantC, 'Pending Tiles', 16.5100, 80.6100, false);
const productA = await makeProduct(merchantA, shopA, 'Porcelain wall tile', 25000, true, { size: '600x600' });
await makeProduct(merchantB, shopB, 'Ceramic floor tile', 15000, false);
await makeProduct(merchantC, shopC, 'Pending wall tile', 5000);

const nearby = await as(customer, 'authenticated', `
  select id, shop_id, distance_km from public.search_products('tile', 'tiles', 16.5, 80.6, 100, null, false, 30)
`);
ok(nearby.length === 2 && nearby[0].shop_id === shopA && nearby[0].distance_km <= nearby[1].distance_km,
  'search hides unverified shops and orders results by server-computed distance');
const textMatch = await as(customer, 'authenticated', `select id from public.search_products('porcelain')`);
ok(textMatch.length === 1 && textMatch[0].id === productA, 'trigger-maintained tsvector supports websearch product matching');
const stockFiltered = await as(customer, 'authenticated', `select * from public.search_products(null, null, null, null, 15, 20000, true)`);
ok(stockFiltered.length === 0, 'price and in-stock filters are applied by the server');
const priceFiltered = await as(customer, 'authenticated', `select * from public.search_products(null, null, null, null, 15, 20000, false)`);
ok(priceFiltered.length === 1 && priceFiltered[0].shop_id === shopB, 'maximum indicative price filter excludes unknown or higher prices');

await expectError(
  () => as(otherCustomer, 'authenticated', `select public.save_product(null, $1, 'Bad', '', '', '', '{}'::jsonb, 'piece', 0, true, true, '{}'::text[])`, [tiles]),
  /shop not found/,
  'a non-owner cannot create catalogue products',
);
await expectError(
  () => as(merchantA, 'authenticated', `select public.save_product(null, $1, 'Bad spec', '', '', '', '{"color":"blue"}'::jsonb, 'piece', 0, true, true, '{}'::text[])`, [tiles]),
  /unsupported product specification/,
  'product specifications are checked against the selected category schema',
);
await expectError(
  () => as(merchantA, 'authenticated', `
    select public.save_product(null, $1, 'Too many images', '', '', '', '{}'::jsonb, 'piece', null, true, true,
      array['a','b','c','d','e','f','g']::text[])
  `, [tiles]),
  /at most 6 images/,
  'a product cannot exceed six images',
);

const [started] = await as(customer, 'authenticated', `select public.start_product_enquiry($1, $2, 'Is this available?') as id`, [shopA, productA]);
const [unreadShop] = await as(merchantA, 'authenticated', `select shop_unread from public.product_enquiries where id = $1`, [started.id]);
ok(unreadShop.shop_unread === 1, 'a new customer enquiry increments shop unread');
const [notification] = await db.query(`select kind, data->>'url' as url from public.notifications where user_id = $1`, [merchantA]).then((result) => result.rows);
ok(notification.kind === 'product_enquiry' && notification.url === `/enquiry/${started.id}`, 'new enquiries queue a routed notification for the shop owner');
const hiddenFromOther = await as(otherCustomer, 'authenticated', `select id from public.product_enquiries where id = $1`, [started.id]);
ok(hiddenFromOther.length === 0, 'enquiry rows are isolated to the customer and shop owner');
await expectError(
  () => as(otherCustomer, 'authenticated', `select public.send_enquiry_message($1, 'Not my enquiry')`, [started.id]),
  /enquiry not found/,
  'a different customer cannot send a message',
);

await as(merchantA, 'authenticated', `select public.mark_enquiry_read($1)`, [started.id]);
await as(merchantA, 'authenticated', `select public.send_enquiry_message($1, 'Yes, it is in stock.')`, [started.id]);
const [unreadCustomer] = await as(customer, 'authenticated', `select customer_unread from public.product_enquiries where id = $1`, [started.id]);
ok(unreadCustomer.customer_unread === 1, 'shop replies increment customer unread');
const replyNotice = await db.query(`select kind from public.notifications where user_id = $1 order by created_at desc limit 1`, [customer]).then((result) => result.rows[0]);
ok(replyNotice?.kind === 'product_enquiry_reply', 'shop replies queue a product enquiry reply notification');
await as(customer, 'authenticated', `select public.mark_enquiry_read($1)`, [started.id]);
const messages = await as(customer, 'authenticated', `select body, from_shop from public.product_enquiry_messages where enquiry_id = $1 order by created_at`, [started.id]);
ok(messages.length === 2 && messages[1].from_shop, 'thread reads expose the server-authenticated shop sender');
await as(customer, 'authenticated', `select public.set_product_enquiry_status($1, 'closed')`, [started.id]);
await expectError(
  () => as(merchantA, 'authenticated', `select public.send_enquiry_message($1, 'Closed thread')`, [started.id]),
  /closed or unavailable/,
  'closed enquiries cannot receive messages',
);

await db.query(`
  insert into public.products (shop_id, category_id, name)
  select $1, $2, 'Capacity item ' || n from generate_series(1, 499) n
`, [shopA, tiles]);
const [{ products: count }] = await db.query(`select count(*)::int as products from public.products where shop_id = $1`, [shopA]).then((result) => result.rows);
ok(count === 500, 'test fixture reaches the per-shop product cap');
await expectError(
  () => as(merchantA, 'authenticated', `select public.save_product(null, $1, 'One too many', '', '', '', '{}'::jsonb, 'piece', null, true, true, '{}'::text[])`, [tiles]),
  /at most 500 products/,
  'a shop cannot exceed 500 catalogue products',
);

await db.query(`update public.feature_flags set enabled = false where key = 'product_enquiries'`);
await expectError(
  () => as(customer, 'authenticated', `select public.start_product_enquiry($1, null, 'Are you open?')`, [shopA]),
  /product enquiries are disabled/,
  'enquiry writes are refused while the enquiry feature is off',
);

if (failures) process.exitCode = 1;
await db.close();

import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const db = new PGlite();
await db.exec(`
  create schema auth;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role', true), '')
  $$;
  create table public.profiles (id uuid primary key);
  create table public.admins (user_id uuid primary key references public.profiles(id));
  create table public.feature_flags (
    key text primary key, enabled boolean not null default false, label text not null,
    description text not null default '', group_name text not null default 'General',
    sort_order int not null default 100, updated_at timestamptz not null default now(), updated_by uuid
  );
  create table public.app_config (
    key text primary key, value jsonb not null, updated_at timestamptz not null default now(), updated_by uuid
  );
  create table public.ai_usage (
    id bigint generated always as identity primary key,
    user_id uuid not null references public.profiles(id),
    kind text not null check (kind in ('transcribe', 'voice_chat', 'photo')),
    request_id uuid,
    created_at timestamptz not null default now()
  );
  create function public._feature_enabled(p_key text) returns boolean language sql stable security definer set search_path = public as $$
    select coalesce((select enabled from public.feature_flags where key = p_key), false)
  $$;
  create function public._assert(p_ok boolean, p_message text) returns void language plpgsql immutable as $$
  begin
    if not coalesce(p_ok, false) then raise exception '%', p_message; end if;
  end $$;
  create function public._is_admin() returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.admins where user_id = auth.uid())
  $$;
  insert into public.feature_flags (key, enabled, label) values ('products', false, 'Products');
  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant execute on all functions in schema public to anon, authenticated, service_role;
`);

const customer = '00000000-0000-0000-0000-000000000001';
const anotherCustomer = '00000000-0000-0000-0000-000000000002';
const thirdCustomer = '00000000-0000-0000-0000-000000000003';
const admin = '00000000-0000-0000-0000-000000000004';
await db.query('insert into public.profiles (id) values ($1), ($2), ($3), ($4)', [customer, anotherCustomer, thirdCustomer, admin]);
await db.query('insert into public.admins (user_id) values ($1)', [admin]);
await db.exec(fs.readFileSync(new URL('../migrations/0051_ai_usage_v3.sql', import.meta.url), 'utf8'));

async function as(uid, role, query, params = []) {
  await db.exec(`
    reset role;
    select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);
    select set_config('request.jwt.claim.role', '${role}', false);
    set role ${role};
  `);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

const now = new Date();
const dayStart = '2000-01-01T00:00:00.000Z';
const monthStart = '2000-01-01T00:00:00.000Z';
const begin = (user, requestId, cost = 40) => as(user, 'service_role', `
  select * from public.begin_ai_usage($1, 'product_search', 'ai_product_search', $2, $3, $4, 'gemini-3.8-flash', $5)
`, [user, requestId, dayStart, monthStart, cost]);

assert.equal((await db.query(`select enabled from public.feature_flags where key = 'ai_product_search'`)).rows[0].enabled, false);
assert.equal((await db.query(`select enabled from public.feature_flags where key = 'ai_quote_extract'`)).rows[0].enabled, false);
assert.equal((await begin(customer, '00000000-0000-0000-0000-000000000101'))[0].rejection, 'feature_disabled');

await db.query(`update public.feature_flags set enabled = true where key = 'ai_product_search'`);
await db.query(`update public.feature_flags set enabled = true where key = 'products'`);
await db.query(`insert into public.app_config (key, value) values
  ('ai_limits', '{"product_search_per_day":1,"quote_extract_per_day":10,"monthly_budget_usd":0.00005}'::jsonb)
  on conflict (key) do update set value = excluded.value`);

const [first] = await begin(customer, '00000000-0000-0000-0000-000000000102');
assert.equal(first.rejection, null);
await as(null, 'service_role', `
  select public.finish_ai_usage($1, 'gemini-3.8-flash', 100, 10, 5, 35, true)
`, [first.usage_id]);
assert.equal((await begin(customer, '00000000-0000-0000-0000-000000000103'))[0].rejection, 'daily_limit');

await as(customer, 'service_role', `
  insert into public.ai_usage (
    user_id, kind, request_id, feature, model, input_tokens, output_tokens, cost_micros_usd, latency_ms, ok
  ) values
    ($1, 'chat', $2, 'ai_assistant', 'gemini-3.8-flash', null, null, null, 12, false),
    ($1, 'chat', $2, 'ai_assistant', 'gemini-3.5-flash-lite', 100, 10, 55, 20, true)
`, [customer, '00000000-0000-0000-0000-000000000104']);

const [second] = await begin(anotherCustomer, '00000000-0000-0000-0000-000000000105');
assert.equal(second.rejection, 'monthly_budget', 'chat cost remains included in the global monthly budget');
await db.query(`update public.app_config set value = '{"product_search_per_day":1,"quote_extract_per_day":10,"monthly_budget_usd":0.1}'::jsonb where key = 'ai_limits'`);
const [secondAfterBudgetIncrease] = await begin(anotherCustomer, '00000000-0000-0000-0000-000000000108');
assert.equal(secondAfterBudgetIncrease.rejection, null);
await as(null, 'service_role', `
  select public.finish_ai_usage($1, 'gemini-3.5-flash-lite', 50, 5, 25, 20, false)
`, [secondAfterBudgetIncrease.usage_id]);
assert.equal((await begin(thirdCustomer, '00000000-0000-0000-0000-000000000106'))[0].rejection, 'monthly_budget');

await db.query(`update public.app_config set value = '{"product_search_per_day":1,"quote_extract_per_day":10,"monthly_budget_usd":0.2}'::jsonb where key = 'ai_limits'`);
const [third] = await begin(thirdCustomer, '00000000-0000-0000-0000-000000000107');
await as(null, 'service_role', `
  select public.finish_ai_usage($1, 'gemini-3.5-flash-lite', 50, 5, 25, 20, false)
`, [third.usage_id]);

const dashboard = (await as(admin, 'authenticated', `select public.admin_ai_usage_dashboard() as value`))[0].value;
const productSearch = dashboard.features.find((feature) => feature.feature === 'ai_product_search');
const chat = dashboard.features.find((feature) => feature.feature === 'ai_assistant');
assert.equal(productSearch.calls_today, 3);
assert.equal(productSearch.error_rate_percent, 66.67);
assert.equal(productSearch.cost_month_micros_usd, 55);
assert.equal(chat.calls_today, 1);
assert.equal(chat.usage_events_today, 2);
assert.equal(chat.error_rate_percent, 0);
assert.equal(chat.input_tokens_month, 100);
assert.equal(chat.output_tokens_month, 10);
assert.equal(chat.cost_month_micros_usd, 55);
assert.equal(dashboard.monthly_cost_micros_usd, 110);
await assert.rejects(() => as(customer, 'authenticated', `select public.admin_ai_usage_dashboard()`), /admin only/);
await assert.rejects(() => as(customer, 'authenticated', `select * from public.begin_ai_usage($1, 'product_search', 'ai_product_search', $2, $3, $4, 'gemini-3.8-flash', 1)`, [
  customer, '00000000-0000-0000-0000-000000000108', dayStart, monthStart,
]), /permission denied/);

console.log('AI usage migration tests passed');

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.join(here, '..', 'migrations');
const migration = (file) => fs.readFileSync(path.join(migrationDir, file), 'utf8')
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
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated, anon, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const migrations = fs.readdirSync(migrationDir)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file) && file !== '0064_o2_provider_verification.sql')
  .sort();
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(prelude);
for (const file of migrations) {
  const sql = migration(file);
  try {
    if (file === '0023_proposal_milestone_booking.sql') {
      const split = sql.indexOf('alter table public.categories');
      await db.exec(sql.slice(0, split));
      await db.exec('drop policy if exists payment_schedule_participants on public.payment_schedule;');
      await db.exec(sql.slice(split)
        .replaceAll("'confirmed'::public.booking_status", "'accepted'::public.booking_status")
        .replaceAll("'delivery_pending'::public.booking_status", "'accepted'::public.booking_status"));
    } else {
      await db.exec(sql);
    }
  } catch (error) {
    throw new Error(`migration ${file} failed: ${error.message}`, { cause: error });
  }
}

const { ok, scenario, finish } = createHarness();
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const NON_ADMIN = '00000000-0000-0000-0000-0000000000a2';
const APPROVABLE = '00000000-0000-0000-0000-0000000000b1';
const REJECTED = '00000000-0000-0000-0000-0000000000b2';
const UNSUBMITTED = '00000000-0000-0000-0000-0000000000b3';
const NO_PAYOUT = '00000000-0000-0000-0000-0000000000b4';
const LEGACY = '00000000-0000-0000-0000-0000000000b5';
const SHOP_OWNER_A = '00000000-0000-0000-0000-0000000000c1';
const SHOP_OWNER_B = '00000000-0000-0000-0000-0000000000c2';
const SHOP_OWNER_C = '00000000-0000-0000-0000-0000000000c3';

async function as(uid, role, query, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [uid ?? '']);
  await db.exec(`set role ${role}`);
  try { return (await db.query(query, params)).rows; }
  finally { await db.exec('reset role'); }
}

async function expectError(fn, pattern, message) {
  try {
    const result = await fn();
    ok(false, `${message}: expected error, got ${JSON.stringify(result)}`);
  } catch (error) {
    ok(pattern.test(error.message), `${message}: ${error.message}`);
  }
}

async function makeShop(ownerId, name, submit) {
  const [created] = await as(ownerId, 'authenticated', `
    select public.save_shop($1::text, $2::text, $3::text, $4::text, $5::text,
      $6::double precision, $7::double precision, 10, true, true, false, null, array['tiles']::text[]) as id
  `, [name, `${name} supplies`, '12 Market Road', 'Vijayawada', 'Benz Circle', 16.5, 80.6]);
  if (submit) await as(ownerId, 'authenticated', `select public.submit_shop($1::uuid)`, [created.id]);
  return created.id;
}

try {
  await db.exec(`
    insert into auth.users (id, phone) values
      ('${ADMIN}', '+919999000001'), ('${NON_ADMIN}', '+919999000002'),
      ('${APPROVABLE}', '+919999000003'), ('${REJECTED}', '+919999000004'),
      ('${UNSUBMITTED}', '+919999000005'), ('${NO_PAYOUT}', '+919999000006'),
      ('${LEGACY}', '+919999000007'), ('${SHOP_OWNER_A}', '+919999000008'),
      ('${SHOP_OWNER_B}', '+919999000009'), ('${SHOP_OWNER_C}', '+919999000010');
    insert into public.admins (user_id) values ('${ADMIN}');
    insert into public.providers (id, city, submitted_at, kyc_status, razorpay_account_id) values
      ('${APPROVABLE}', 'Testcity', now(), 'pending', null),
      ('${REJECTED}', 'Testcity', now(), 'pending', null),
      ('${UNSUBMITTED}', 'Testcity', null, 'pending', null),
      ('${NO_PAYOUT}', 'Testcity', now(), 'pending', null),
      ('${LEGACY}', 'Testcity', now(), 'verified', 'acc_o2_legacy');
    insert into public.provider_payout_accounts (provider_id, fund_account_id) values
      ('${APPROVABLE}', 'fa_o2_approvable'),
      ('${REJECTED}', 'fa_o2_rejected'),
      ('${UNSUBMITTED}', 'fa_o2_unsubmitted');
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate)
      select p.id, c.id, 1000, 1000
        from public.providers p
        cross join public.categories c
       where p.id in ('${APPROVABLE}', '${REJECTED}', '${NO_PAYOUT}', '${LEGACY}')
         and c.slug = 'plumber';
  `);
  await db.exec(migration('0064_o2_provider_verification.sql'));
  await db.query(`update public.feature_flags set enabled = true where key in ('products', 'product_enquiries')`);

  await scenario('provider approval is separate from gateway KYC', async () => {
    await expectError(
      () => as(NON_ADMIN, 'authenticated',
        `select public.admin_set_provider_review($1::uuid, $2::text, $3::text)`,
        [APPROVABLE, 'approved', null]),
      /admin only/,
      'provider admin-review RPC rejects non-admin',
    );
    await expectError(
      () => as(ADMIN, 'authenticated',
        `select public.admin_set_provider_kyc($1::uuid, $2::text, $3::text)`,
        [APPROVABLE, 'verified', null]),
      /permission denied/,
      'legacy admin KYC RPC is no longer callable',
    );
    await expectError(
      () => as(ADMIN, 'authenticated',
        `select public.admin_set_provider_review($1::uuid, $2::text, $3::text)`,
        [UNSUBMITTED, 'approved', null]),
      /not been submitted/,
      'provider admin-review RPC rejects unsubmitted provider',
    );
    await expectError(
      () => as(ADMIN, 'authenticated',
        `select public.admin_set_provider_review($1::uuid, $2::text, $3::text)`,
        [NO_PAYOUT, 'approved', null]),
      /payout account/,
      'provider admin-review RPC rejects approval without payout account',
    );
    const [notApprovedWithoutPayout] = await as(ADMIN, 'authenticated',
      `select ap.admin_review_status, public._provider_is_live(ap.id) as is_live
         from public.admin_list_providers($1::text, $2::text) ap
        where ap.id = $3::uuid`,
      ['all', null, NO_PAYOUT]);
    ok(notApprovedWithoutPayout.admin_review_status === 'pending' && !notApprovedWithoutPayout.is_live,
      `payout-less provider remains unapproved and not live: ${JSON.stringify(notApprovedWithoutPayout)}`);

    await as(ADMIN, 'authenticated',
      `select public.admin_set_provider_review($1::uuid, $2::text, $3::text)`,
      [APPROVABLE, 'approved', null]);
    const [approvedPendingKyc] = await as(ADMIN, 'authenticated',
      `select ap.admin_review_status, ap.kyc_status,
              public._provider_is_live(ap.id) as is_live
         from public.admin_list_providers($1::text, $2::text) ap
        where ap.id = $3::uuid`,
      ['all', null, APPROVABLE]);
    ok(approvedPendingKyc.admin_review_status === 'approved' && approvedPendingKyc.kyc_status === 'pending'
      && !approvedPendingKyc.is_live,
    `approval leaves KYC pending and provider not live: ${JSON.stringify(approvedPendingKyc)}`);
    const [reviewAudit] = await db.query(
      `select action, details from public.admin_audit_log
        where action = $1::text and target_id = $2::uuid`,
      ['set_provider_review', APPROVABLE],
    ).then((result) => result.rows);
    ok(reviewAudit.action === 'set_provider_review' && reviewAudit.details.status === 'approved',
      `provider review is audited: ${JSON.stringify(reviewAudit)}`);

    await as(ADMIN, 'authenticated',
      `select public.admin_set_provider_review($1::uuid, $2::text, $3::text)`,
      [APPROVABLE, 'needs_clarification', 'Please update your documents']);
    const [clarification] = await as(APPROVABLE, 'authenticated',
      `select public.get_my_provider_onboarding() as onboarding`);
    const reviewNote = clarification.onboarding.go_live.reasons.find((item) => item.code === 'admin_note');
    ok(!!reviewNote && reviewNote.detail === 'Please update your documents',
      `clarification reason is visible to the provider: ${JSON.stringify(clarification.onboarding.go_live.reasons)}`);

    await as(ADMIN, 'authenticated',
      `select public.admin_set_provider_review($1::uuid, $2::text, $3::text)`,
      [REJECTED, 'rejected', 'Documents do not match']);
    await as(null, 'service_role',
      `select public.sync_provider_payout_status($1::text, $2::text)`,
      ['fa_o2_rejected', 'activated']);
    const [afterGateway] = await as(ADMIN, 'authenticated',
      `select ap.admin_review_status, ap.kyc_status,
              public._provider_is_live(ap.id) as is_live
         from public.admin_list_providers($1::text, $2::text) ap
        where ap.id = $3::uuid`,
      ['all', null, REJECTED]);
    ok(afterGateway.admin_review_status === 'rejected' && afterGateway.kyc_status === 'verified'
      && !afterGateway.is_live,
    `gateway activation preserves admin rejection: ${JSON.stringify(afterGateway)}`);

    const [legacy] = await as(ADMIN, 'authenticated',
      `select ap.admin_review_status, ap.has_payout_account,
              public._provider_is_live(ap.id) as is_live
         from public.admin_list_providers($1::text, $2::text)
              ap
        where ap.id = $3::uuid`,
      ['all', null, LEGACY]);
    ok(legacy.admin_review_status === 'approved' && legacy.has_payout_account && legacy.is_live,
      `legacy payout account remains live after KYC status is backfilled: ${JSON.stringify(legacy)}`);

    await expectError(
      () => as(ADMIN, 'authenticated',
        `select public.admin_set_provider_review($1::uuid, $2::text, $3::text)`,
        [APPROVABLE, 'rejected', '  ']),
      /reason is required/,
      'rejecting a provider requires a reason',
    );
  });

  await scenario('shop review requires an eligible state and a per-shop reason', async () => {
    const draftShopId = await makeShop(SHOP_OWNER_A, 'O2 Draft Shop', false);
    const submittedShopId = await makeShop(SHOP_OWNER_B, 'O2 Submitted Shop', true);
    const underReviewShopId = await makeShop(SHOP_OWNER_C, 'O2 Under Review Shop', true);
    await expectError(
      () => as(SHOP_OWNER_A, 'authenticated',
        `select public.admin_set_shop_status($1::uuid, $2::text, $3::text)`,
        [draftShopId, 'verified', null]),
      /admin only/,
      'shop status RPC rejects non-admin',
    );
    await expectError(
      () => as(ADMIN, 'authenticated',
        `select public.admin_set_shop_status($1::uuid, $2::text, $3::text)`,
        [draftShopId, 'verified', null]),
      /only submitted or under-review shops can be verified/,
      'draft shop cannot be verified',
    );
    await as(ADMIN, 'authenticated',
      `select public.admin_set_shop_status($1::uuid, $2::text, $3::text)`,
      [submittedShopId, 'verified', null]);
    const [verified] = await db.query(
      `select status from public.shops where id = $1::uuid`, [submittedShopId],
    ).then((result) => result.rows);
    ok(verified.status === 'verified', `submitted shop can be verified: ${JSON.stringify(verified)}`);
    await expectError(
      () => as(ADMIN, 'authenticated',
        `select public.admin_set_shop_status($1::uuid, $2::text, $3::text)`,
        [submittedShopId, 'suspended', null]),
      /reason is required/,
      'suspending a shop requires a reason',
    );
    await as(ADMIN, 'authenticated',
      `select public.admin_set_shop_status($1::uuid, $2::text, $3::text)`,
      [submittedShopId, 'suspended', 'Temporary safety review']);
    await as(ADMIN, 'authenticated',
      `select public.admin_set_shop_status($1::uuid, $2::text, $3::text)`,
      [submittedShopId, 'verified', null]);
    const [restored] = await db.query(
      `select status from public.shops where id = $1::uuid`, [submittedShopId],
    ).then((result) => result.rows);
    ok(restored.status === 'verified', `suspended shop can return to verified: ${JSON.stringify(restored)}`);
    await as(ADMIN, 'authenticated',
      `select public.admin_set_shop_status($1::uuid, $2::text, $3::text)`,
      [underReviewShopId, 'under_review', null]);
    await as(ADMIN, 'authenticated',
      `select public.admin_set_shop_status($1::uuid, $2::text, $3::text)`,
      [underReviewShopId, 'verified', null]);
    const [reviewed] = await db.query(
      `select status from public.shops where id = $1::uuid`, [underReviewShopId],
    ).then((result) => result.rows);
    ok(reviewed.status === 'verified', `under-review shop can be verified: ${JSON.stringify(reviewed)}`);

    await expectError(
      () => as(ADMIN, 'authenticated',
        `select public.admin_set_shop_status($1::uuid, $2::text, $3::text)`,
        [draftShopId, 'rejected', null]),
      /reason is required/,
      'rejecting a shop requires a reason',
    );
    await as(ADMIN, 'authenticated',
      `select public.admin_set_shop_status($1::uuid, $2::text, $3::text)`,
      [draftShopId, 'rejected', 'Missing required details']);
    const [rejected] = await db.query(
      `select status, status_reason from public.shops where id = $1::uuid`, [draftShopId],
    ).then((result) => result.rows);
    ok(rejected.status === 'rejected' && rejected.status_reason === 'Missing required details',
      `shop rejection stores its own reason: ${JSON.stringify(rejected)}`);
  });
} finally {
  await db.close();
}

finish();

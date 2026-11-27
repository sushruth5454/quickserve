import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const originalAdminPhones = (await db.query(
  'select ac.value from public.app_config as ac where ac.key = $1::text',
  ['admin_phones'],
)).rows[0].value;
const harness = createHarness({
  cleanup: async () => {
    await db.query(
      'update public.app_config as ac set value = $1::jsonb where ac.key = $2::text',
      [JSON.stringify(originalAdminPhones), 'admin_phones'],
    );
  },
});
const { ok, scenario, finish } = harness;
const ADMIN = randomUUID();

function check(condition, label, actual) {
  ok(condition, `${label}; actual=${JSON.stringify(actual)}`);
}

async function createUser(id, phone = `+1555${randomUUID().replace(/\D/g, '').slice(0, 10)}`, fullName = 'CM07 user') {
  await db.query(
    `insert into auth.users (id, phone, raw_user_meta_data)
     values ($1::uuid, $2::text, jsonb_build_object('full_name', $3::text))`,
    [id, phone, fullName],
  );
}

async function makeProvider({ id = randomUUID(), kycStatus, reviewStatus, submittedAt, createdAt = '2026-11-30T00:00:00.000Z' }) {
  await createUser(id, undefined, `CM07 provider ${id}`);
  await db.query(`
    insert into public.providers (id, city, kyc_status, submitted_at, admin_review_status, created_at)
    values ($1::uuid, $2::text, $3::public.kyc_status, $4::timestamptz, $5::text, $6::timestamptz)
  `, [id, 'CM07 City', kycStatus, submittedAt, reviewStatus, createdAt]);
  return id;
}

async function errorOf(run) {
  try {
    const result = await run();
    return { result, error: null };
  } catch (error) {
    return { result: null, error: error?.message ?? String(error) };
  }
}

await createUser(ADMIN, '+15550000001', 'CM07 admin');
await db.query('insert into public.admins (user_id) values ($1::uuid)', [ADMIN]);

await scenario('CM_SQL_DASHBOARD_REVIEW_PARITY', async () => {
  const submittedAt = '2026-11-29T10:00:00.000Z';
  const verifiedPending = await makeProvider({ kycStatus: 'verified', reviewStatus: 'pending', submittedAt });
  const pendingApproved = await makeProvider({ kycStatus: 'pending', reviewStatus: 'approved', submittedAt });
  const verifiedUnsubmitted = await makeProvider({ kycStatus: 'verified', reviewStatus: 'needs_clarification', submittedAt: null });
  const verifiedNeedsChanges = await makeProvider({ kycStatus: 'verified', reviewStatus: 'needs_clarification', submittedAt });
  const fixtureIds = [verifiedPending, pendingApproved, verifiedUnsubmitted, verifiedNeedsChanges];
  const idParams = fixtureIds.map((_, index) => `$${index + 3}::uuid`).join(', ');

  async function assertMembership(expectedIds, label) {
    const direct = (await db.query(`
      select p.id::text as id
        from public.providers as p
       where p.id in (${fixtureIds.map((_, index) => `$${index + 1}::uuid`).join(', ')})
         and p.admin_review_status in ('pending', 'needs_clarification')
         and p.submitted_at is not null
       order by p.id
    `, fixtureIds)).rows.map((row) => row.id);
    const peopleRows = await as(ADMIN, 'authenticated', `
      select ap.id::text as id, ap.admin_review_status, ap.submitted_at
        from public.admin_list_providers($1::text, $2::text) as ap
       where ap.id in (${idParams})
    `, ['all', null, ...fixtureIds]);
    const peoplePending = peopleRows
      .filter((row) => row.submitted_at != null && ['pending', 'needs_clarification'].includes(row.admin_review_status))
      .map((row) => row.id)
      .sort();
    const dashboard = (await as(ADMIN, 'authenticated',
      'select public.admin_dashboard($1::int) as dashboard', [30]))[0].dashboard;
    const actual = { direct, peoplePending, dashboardPending: dashboard.totals.providers_pending, expectedIds };
    const expected = [...expectedIds].sort();
    check(JSON.stringify(direct) === JSON.stringify(expected), `${label}: SQL membership uses admin review plus submitted state`, actual);
    check(JSON.stringify(peoplePending) === JSON.stringify(expected), `${label}: matches the People pending predicate`, actual);
    check(dashboard.totals.providers_pending === expected.length, `${label}: dashboard count matches pending membership`, actual);
  }

  await assertMembership([verifiedPending, verifiedNeedsChanges], 'initial state');
  await db.query(`
    update public.providers as p
       set kyc_status = $2::public.kyc_status, admin_review_status = $3::text
     where p.id = $1::uuid
  `, [verifiedPending, 'pending', 'approved']);
  await assertMembership([verifiedNeedsChanges], 'same provider id after review approval');
  await db.query(`
    update public.providers as p
       set kyc_status = $2::public.kyc_status, admin_review_status = $3::text
     where p.id = $1::uuid
  `, [verifiedPending, 'verified', 'needs_clarification']);
  await assertMembership([verifiedPending, verifiedNeedsChanges], 'same provider id after needs-clarification transition');
});

await scenario('CM_SQL_DASHBOARD_NO_PAGE_CAP', async () => {
  await db.exec(`
    with generated as (
      select gen_random_uuid() as id, series.n
        from generate_series(1, 305) as series(n)
    )
    insert into auth.users (id, phone, raw_user_meta_data)
    select generated.id,
           '+9198777' || lpad(generated.n::text, 6, '0'),
           jsonb_build_object('full_name', 'CM07 page-cap provider')
      from generated
  `);
  await db.exec(`
    insert into public.providers (id, city, kyc_status, submitted_at, admin_review_status, created_at)
    select u.id, 'CM07 page cap', 'verified'::public.kyc_status,
           '2026-11-20T10:00:00.000Z'::timestamptz, 'pending'::text,
           '2026-11-20T10:00:00.000Z'::timestamptz
      from auth.users as u
     where u.raw_user_meta_data->>'full_name' = 'CM07 page-cap provider'
  `);
  const allPending = (await db.query(`
    select count(*)::int as count
      from public.providers as p
     where p.admin_review_status in ('pending', 'needs_clarification')
       and p.submitted_at is not null
  `)).rows[0].count;
  const page = await as(ADMIN, 'authenticated',
    'select ap.id from public.admin_list_providers($1::text, $2::text) as ap', ['pending', null]);
  const dashboard = (await as(ADMIN, 'authenticated',
    'select public.admin_dashboard($1::int) as dashboard', [30]))[0].dashboard;
  const actual = { directPending: allPending, peoplePageRows: page.length, dashboardPending: dashboard.totals.providers_pending };
  check(allPending > 300, 'fixture exceeds the People endpoint page limit', actual);
  check(page.length === 300, 'People endpoint page is capped at 300 rows in this fixture', actual);
  check(dashboard.totals.providers_pending === allPending, 'dashboard counts all matching providers, not the capped page', actual);
});

await scenario('CM_SQL_DASHBOARD_GROSS_LABEL', async () => {
  const customerId = randomUUID();
  const providerId = randomUUID();
  await createUser(customerId, undefined, 'CM07 payment customer');
  await createUser(providerId, undefined, 'CM07 payment provider');
  await db.query(`
    insert into public.providers (id, city, kyc_status, admin_review_status, submitted_at)
    values ($1::uuid, 'CM07 payment city'::text, 'verified'::public.kyc_status, 'approved'::text, $2::timestamptz)
  `, [providerId, '2026-11-01T10:00:00.000Z']);
  const categoryId = (await db.query(
    'select c.id from public.categories as c order by c.id limit 1',
  )).rows[0].id;
  const addressId = (await db.query(`
    insert into public.addresses (user_id, line1, city, lat, lng)
    values ($1::uuid, $2::text, $3::text, $4::float8, $5::float8)
    returning id
  `, [customerId, 'CM07 Test Road', 'CM07 City', 16.5, 80.6])).rows[0].id;
  const serviceId = (await db.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate)
    values ($1::uuid, $2::uuid, $3::int, $4::int)
    returning id
  `, [providerId, categoryId, 0, 0])).rows[0].id;
  const bookingId = (await db.query(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      visit_fee, platform_fee, created_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      $6::int, $7::int, $8::timestamptz
    ) returning id
  `, [customerId, providerId, categoryId, serviceId, addressId, 0, 0, '2026-11-20T10:00:00.000Z'])).rows[0].id;
  await db.query(`
    insert into public.payments (booking_id, purpose, amount, status, paid_at, created_at)
    values
      ($1::uuid, $2::public.payment_purpose, $3::int, $4::public.payment_status, $5::timestamptz, $5::timestamptz),
      ($1::uuid, $6::public.payment_purpose, $7::int, $4::public.payment_status, $5::timestamptz, $5::timestamptz)
  `, [bookingId, 'balance', 193760, 'paid', new Date().toISOString(), 'platform_fee', 2900]);
  const dashboard = (await as(ADMIN, 'authenticated',
    'select public.admin_dashboard($1::int) as dashboard', [30]))[0].dashboard;
  const actual = { totals: dashboard.totals, paymentAmounts: [193760, 2900] };
  check(dashboard.totals.gmv_paise === 196660, 'gross payment total remains the unchanged sum of paid amounts', actual);
  check(dashboard.totals.gmv_period_paise === 196660, 'period gross paise remains unchanged', actual);
  check(dashboard.totals.platform_fees_paise === 2900, 'platform fee total remains separately unchanged', actual);
});

await scenario('CM_SQL_ADMIN_ENDPOINT_DENIED', async () => {
  const nonAdminId = randomUUID();
  const allowlistedId = randomUUID();
  const allowlistedPhone = '+918888777666';
  await createUser(nonAdminId, '+15550000002', 'CM07 non-admin');
  await createUser(allowlistedId, allowlistedPhone, 'CM07 legacy allowlist');
  await db.query(
    'update public.app_config as ac set value = $1::jsonb where ac.key = $2::text',
    [JSON.stringify(['918888777666']), 'admin_phones'],
  );

  const nonAdmin = await errorOf(() => as(nonAdminId, 'authenticated',
    'select public.admin_dashboard($1::int) as dashboard', [30]));
  const guest = await errorOf(() => as(null, 'anon',
    'select public.admin_dashboard($1::int) as dashboard', [30]));
  const allowlistIdentity = (await as(allowlistedId, 'authenticated',
    'select public.am_i_admin() as is_admin'))[0];
  const allowlistedDashboard = await errorOf(() => as(allowlistedId, 'authenticated',
    'select public.admin_dashboard($1::int) as dashboard', [30]));
  const legacyKycRpc = await errorOf(() => as(ADMIN, 'authenticated', `
    select public.admin_set_provider_kyc($1::uuid, $2::text, $3::text)
  `, [nonAdminId, 'verified', null]));
  const actual = { nonAdmin, guest, allowlistIdentity, allowlistedDashboard, legacyKycRpc };
  check(/admin only/i.test(nonAdmin.error ?? ''), 'non-admin is denied the privileged dashboard', actual);
  check(/permission denied/i.test(guest.error ?? ''), 'guest cannot execute the privileged dashboard', actual);
  check(allowlistIdentity.is_admin === false, 'obsolete phone allowlist grants no admin authority', actual);
  check(/admin only/i.test(allowlistedDashboard.error ?? ''), 'allowlisted phone cannot use the dashboard', actual);
  check(/permission denied/i.test(legacyKycRpc.error ?? ''), 'legacy admin KYC RPC remains unavailable', actual);
});

finish();

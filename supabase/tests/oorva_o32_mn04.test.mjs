import { randomUUID } from 'node:crypto';
import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const { ok, scenario, finish } = createHarness();
const check = (condition, label, actual) =>
  ok(condition, `${label}; actual=${JSON.stringify(actual)}`);

const one = async (query, params = []) => (await db.query(query, params)).rows[0];
let nextSlot = 0;

async function makeUser() {
  const id = randomUUID();
  const digits = randomUUID().replace(/\D/g, '').slice(0, 10);
  await db.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, `+1555${digits}`]);
  return id;
}

async function makePaymentFixture(label) {
  const customerId = await makeUser();
  const providerId = await makeUser();
  const adminId = await makeUser();
  await db.query(
    'insert into public.admins (user_id) values ($1::uuid)',
    [adminId],
  );
  const city = `MN04 ${label} ${randomUUID().slice(0, 8)}`;
  await db.query(`
    insert into public.providers (
      id, city, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended, razorpay_account_id
    ) values (
      $1::uuid, $2::text, 'verified', $3::timestamptz, 'approved',
      true, false, false, $4::text
    )
  `, [providerId, city, '2035-01-01T00:00:00Z', `acc_mn04_${providerId.slice(0, 8)}`]);
  const categoryId = (await one(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::text, $2::text, 'quote', true, 'time_based', '{}'::jsonb, 1,
      365, true, array['daily','alternate_days','weekly','monthly','custom']::text[], 0
    ) returning id
  `, [`mn04-${randomUUID().replace(/-/g, '')}`, `MN04 ${label}`])).id;
  await db.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, $3::timestamptz)
  `, [categoryId, city, '2035-01-01T00:00:00Z']);
  await db.query(`
    insert into public.app_config (key, value)
    values ('archetype_flags', '{"time_based":true}'::jsonb)
    on conflict (key) do update
      set value = public.app_config.value || excluded.value
  `);
  const serviceId = (await one(`
    insert into public.provider_services (
      provider_id, category_id, visit_fee, labour_rate, active
    ) values ($1::uuid, $2::uuid, 0, 10000, true)
    returning id
  `, [providerId, categoryId])).id;
  const packageId = (await one(`
    insert into public.service_packages (
      provider_service_id, title, description, price_type, price, price_min,
      price_max, unit, qty_min, qty_max, duration_min, active
    ) values (
      $1::uuid, 'Single session', '', 'fixed', 20000, 20000,
      20000, 'session', 1, 1, 60, true
    ) returning id
  `, [serviceId])).id;
  const addressId = (await one(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Home', '1 MN04 Test Road', $2::text, 16.5, 80.6)
    returning id
  `, [customerId, city])).id;
  nextSlot += 1;
  const slot = new Date(Date.UTC(2035, 0, 1 + nextSlot, 10)).toISOString();
  const bookingId = (await one(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, service_window, status, visit_fee, platform_fee,
      total_amount, archetype, exclusive, session_duration_min, service_package_id,
      commission_bp_snapshot
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      $6::text, $7::timestamptz,
      tstzrange($7::timestamptz, $7::timestamptz + interval '1 hour', '[)'),
      'completion_requested', 0, 0, 20000, 'time_based', true, 60, $8::uuid, 1000
    ) returning id
  `, [customerId, providerId, categoryId, serviceId, addressId, `MN04 ${label}`, slot, packageId])).id;
  const paymentId = (await one(`
    insert into public.payments (
      booking_id, purpose, amount, status, razorpay_payment_id, paid_at
    ) values (
      $1::uuid, 'balance', 20000, 'paid', $2::text, $3::timestamptz
    ) returning id
  `, [bookingId, `mn04-${randomUUID()}`, slot])).id;
  return { customerId, providerId, adminId, bookingId, paymentId };
}

async function makeRefund(paymentId, amount, status = 'failed', attempts = 3) {
  return (await one(`
    insert into public.refunds (
      payment_id, amount, status, attempts, next_attempt_at,
      processing_started_at, last_error
    ) values (
      $1::uuid, $2::int, $3::public.refund_status, $4::int,
      $5::timestamptz, $6::timestamptz, $7::text
    ) returning id
  `, [
    paymentId,
    amount,
    status,
    attempts,
    status === 'pending' ? '2035-01-01T10:00:00Z' : null,
    status === 'processing' ? '2035-01-01T10:00:00Z' : null,
    status === 'failed' ? 'retry after a transient gateway error' : null,
  ])).id;
}

async function retryAs(uid, refundId) {
  try {
    const rows = await as(
      uid,
      'authenticated',
      'select public.admin_retry_refund($1::uuid) as result',
      [refundId],
    );
    return { error: null, result: rows[0]?.result ?? null };
  } catch (error) {
    return { error: error?.message ?? String(error), result: null };
  }
}

async function snapshot(paymentId, refundId) {
  const [payment, target, refunds, audit] = await Promise.all([
    one(`
      select id, amount, status::text as status
        from public.payments where id = $1::uuid
    `, [paymentId]),
    one(`
      select id, payment_id, amount, status::text as status, attempts,
             next_attempt_at, processing_started_at, last_error
        from public.refunds where id = $1::uuid
    `, [refundId]),
    db.query(`
      select id, amount, status::text as status, attempts
        from public.refunds where payment_id = $1::uuid order by id
    `, [paymentId]).then(({ rows }) => rows),
    db.query(`
      select id, admin_id, action, target_id, details
        from public.admin_audit_log
       where action = 'admin_retry_refund' and target_id = $1::uuid
       order by id
    `, [refundId]).then(({ rows }) => rows),
  ]);
  const reserved = await one(`
    select coalesce(sum(amount), 0)::bigint as amount
      from public.refunds
     where payment_id = $1::uuid and status <> 'failed'
  `, [paymentId]);
  return { payment, target, refunds, audit, reserved: Number(reserved.amount) };
}

await scenario('MN-REFUND-RETRY-CAP', async () => {
  const fixture = await makePaymentFixture('capacity rejection');
  const targetId = await makeRefund(fixture.paymentId, 12500, 'failed');
  await makeRefund(fixture.paymentId, 20000, 'pending', 1);
  const before = await snapshot(fixture.paymentId, targetId);
  const outcome = await retryAs(fixture.adminId, targetId);
  const after = await snapshot(fixture.paymentId, targetId);
  check(
    outcome.error?.toLowerCase().includes('capacity')
      && after.reserved === 20000
      && after.target?.status === 'failed'
      && after.audit.length === 0
      && JSON.stringify(after.payment) === JSON.stringify(before.payment)
      && JSON.stringify(after.refunds) === JSON.stringify(before.refunds),
    'stale failed retry is rejected without changing refunds, payment or audit',
    { outcome, before, after },
  );
});

await scenario('MN-REFUND-RETRY-ALLOW', async () => {
  const fixture = await makePaymentFixture('allowed retry');
  const targetId = await makeRefund(fixture.paymentId, 5000, 'failed', 4);
  await makeRefund(fixture.paymentId, 10000, 'pending', 1);
  const outcome = await retryAs(fixture.adminId, targetId);
  const after = await snapshot(fixture.paymentId, targetId);
  check(
    outcome.error === null
      && outcome.result?.refund_id === targetId
      && outcome.result?.status === 'pending'
      && outcome.result?.attempts === 0
      && after.target?.id === targetId
      && after.target?.status === 'pending'
      && after.target?.attempts === 0
      && after.target?.next_attempt_at === null
      && after.target?.processing_started_at === null
      && after.target?.last_error === null
      && after.reserved === 15000
      && after.audit.length === 1
      && after.audit[0]?.admin_id === fixture.adminId
      && after.audit[0]?.target_id === targetId
      && after.audit[0]?.details?.amount_paise === 5000,
    'allowed retry preserves the refund PK, resets retry state and writes one audit row',
    { outcome, after },
  );
});

await scenario('MN-ROLES-SAME-PK', async () => {
  const fixture = await makePaymentFixture('non-admin rejection');
  const targetId = await makeRefund(fixture.paymentId, 5000, 'failed');
  const before = await snapshot(fixture.paymentId, targetId);
  const outcome = await retryAs(fixture.customerId, targetId);
  const after = await snapshot(fixture.paymentId, targetId);
  check(
    outcome.error?.includes('admin only')
      && after.target?.status === 'failed'
      && after.audit.length === 0
      && JSON.stringify(after.payment) === JSON.stringify(before.payment)
      && JSON.stringify(after.refunds) === JSON.stringify(before.refunds),
    'non-admin retry is rejected without mutation',
    { outcome, before, after },
  );
});

await scenario('MN-REFUND-RETRY-MISSING', async () => {
  const fixture = await makePaymentFixture('missing retry target');
  const missingId = randomUUID();
  const beforePayment = await one(`
    select id, amount, status::text as status
      from public.payments where id = $1::uuid
  `, [fixture.paymentId]);
  const outcome = await retryAs(fixture.adminId, missingId);
  const afterPayment = await one(`
    select id, amount, status::text as status
      from public.payments where id = $1::uuid
  `, [fixture.paymentId]);
  const rows = await db.query(
    'select id from public.refunds where id = $1::uuid',
    [missingId],
  );
  const audits = await db.query(`
    select id from public.admin_audit_log
     where action = 'admin_retry_refund' and target_id = $1::uuid
  `, [missingId]);
  check(
    outcome.error?.includes('refund not found')
      && rows.rows.length === 0
      && audits.rows.length === 0
      && JSON.stringify(afterPayment) === JSON.stringify(beforePayment),
    'missing refund target is rejected without mutation',
    { outcome, beforePayment, afterPayment, rows: rows.rows, audits: audits.rows },
  );
});

for (const status of ['pending', 'processing', 'refunded']) {
  await scenario(`MN-REFUND-RETRY-STATE-${status.toUpperCase()}`, async () => {
    const fixture = await makePaymentFixture(`${status} target rejection`);
    const targetId = await makeRefund(fixture.paymentId, 5000, status, 2);
    const before = await snapshot(fixture.paymentId, targetId);
    const outcome = await retryAs(fixture.adminId, targetId);
    const after = await snapshot(fixture.paymentId, targetId);
    check(
      outcome.error?.includes('only a failed refund can be retried')
        && JSON.stringify(after) === JSON.stringify(before),
      `${status} refund is rejected without state or audit mutation`,
      { outcome, before, after },
    );
  });
}

await scenario('MN-OFF-SAFETY', async () => {
  const blockedFixture = await makePaymentFixture('all flags off capacity guard');
  const blockedTargetId = await makeRefund(blockedFixture.paymentId, 12500, 'failed');
  await makeRefund(blockedFixture.paymentId, 20000, 'pending', 1);
  const allowedFixture = await makePaymentFixture('all flags off safe retry');
  const allowedTargetId = await makeRefund(allowedFixture.paymentId, 5000, 'failed');
  await makeRefund(allowedFixture.paymentId, 10000, 'pending', 1);
  await db.query('update public.feature_flags set enabled = false');
  const flagState = await one(`
    select count(*)::int as total,
           count(*) filter (where enabled)::int as enabled
      from public.feature_flags
  `);
  const blockedOutcome = await retryAs(blockedFixture.adminId, blockedTargetId);
  const blockedAfter = await snapshot(blockedFixture.paymentId, blockedTargetId);
  const allowedOutcome = await retryAs(allowedFixture.adminId, allowedTargetId);
  const allowedAfter = await snapshot(allowedFixture.paymentId, allowedTargetId);
  check(
    flagState.total > 0
      && flagState.enabled === 0
      && blockedOutcome.error?.toLowerCase().includes('capacity')
      && blockedAfter.target?.status === 'failed'
      && blockedAfter.reserved === 20000
      && blockedAfter.audit.length === 0
      && allowedOutcome.error === null
      && allowedAfter.target?.id === allowedTargetId
      && allowedAfter.target?.status === 'pending'
      && allowedAfter.reserved === 15000
      && allowedAfter.audit.length === 1,
    'all feature flags off preserves capacity rejection and safe retry',
    { flagState, blockedOutcome, blockedAfter, allowedOutcome, allowedAfter },
  );
});

finish();

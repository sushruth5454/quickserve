import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

let nextSlot = 0;

async function bookingFixtureState(client, categoryId, providerId, serviceId, addressId, slot) {
  return (await client.query(`
    select jsonb_build_object(
      'category', to_jsonb(c),
      'provider', to_jsonb(p),
      'provider_service', to_jsonb(ps),
      'address', jsonb_build_object('id', a.id, 'city', a.city),
      'category_cities', coalesce((
        select jsonb_agg(to_jsonb(cc))
          from public.category_cities cc
         where cc.category_id = c.id
      ), '[]'::jsonb),
      'provider_documents', coalesce((
        select jsonb_agg(to_jsonb(pd))
          from public.provider_documents pd
         where pd.provider_id = p.id
           and (pd.category_id is null or pd.category_id = c.id)
      ), '[]'::jsonb),
      'archetype_flags', (
        select config.value
          from public.app_config config
         where config.key = 'archetype_flags'
      ),
      'bookability_checks', jsonb_build_object(
        'category_active', c.active,
        'category_not_restricted', not c.restricted,
        'archetype_matches_time_based', c.archetype = 'time_based',
        'archetype_enabled', public._archetype_enabled(c.archetype),
        'category_city_live_match', exists (
          select 1
            from public.category_cities cc
           where cc.category_id = c.id
             and cc.live
             and lower(trim(cc.city)) = lower(trim(coalesce(a.city, '')))
        ),
        'provider_is_live', public._provider_is_live(p.id),
        'provider_not_paused', not p.paused,
        'category_docs_ok', public._category_docs_ok(p.id, c.id),
        'active_provider_service_match', exists (
          select 1
            from public.provider_services active_service
           where active_service.provider_id = p.id
             and active_service.category_id = c.id
             and active_service.active
        ),
        'window_min_lead_ok',
          $5::timestamptz >= now() + make_interval(hours => c.min_lead_hours) - interval '5 minutes',
        'window_max_lead_ok',
          $5::timestamptz <= now() + make_interval(days => c.max_lead_days),
        'is_bookable',
          public._is_bookable(
            c.id,
            p.id,
            a.city,
            c.archetype,
            tstzrange($5::timestamptz, $5::timestamptz + interval '1 hour', '[)')
          )
      )
    ) as actual
      from public.categories c
      left join public.providers p on p.id = $2::uuid
      left join public.provider_services ps
        on ps.id = $3::uuid
       and ps.provider_id = p.id
       and ps.category_id = c.id
      left join public.addresses a on a.id = $4::uuid
     where c.id = $1::uuid
  `, [categoryId, providerId, serviceId, addressId, slot])).rows[0]?.actual;
}

async function makeUser(client) {
  const id = randomUUID();
  const digits = randomUUID().replace(/\D/g, '').slice(0, 10);
  await client.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, `+1555${digits}`]);
  return id;
}

async function makePaymentFixture(client) {
  const customerId = await makeUser(client);
  const providerId = await makeUser(client);
  const adminId = await makeUser(client);
  await client.query(
    'insert into public.admins (user_id) values ($1::uuid)',
    [adminId],
  );
  const city = `MN04 PostgreSQL ${randomUUID().slice(0, 8)}`;
  await client.query(`
    insert into public.providers (
      id, city, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended, razorpay_account_id
    ) values (
      $1::uuid, $2::text, 'verified', $3::timestamptz, 'approved',
      true, false, false, $4::text
    )
  `, [providerId, city, '2035-01-01T00:00:00Z', `acc_mn04_${providerId.slice(0, 8)}`]);
  const categoryId = (await client.query(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::text, 'MN04 PostgreSQL refund retry', 'quote', true, 'time_based',
      '{}'::jsonb, 1, 365, true,
      array['daily','alternate_days','weekly','monthly','custom']::text[], 0
    ) returning id
  `, [`mn04-${randomUUID().replace(/-/g, '')}`])).rows[0].id;
  await client.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, $3::timestamptz)
  `, [categoryId, city, '2035-01-01T00:00:00Z']);
  await client.query(`
    insert into public.app_config (key, value)
    values ('archetype_flags', '{"time_based":true}'::jsonb)
    on conflict (key) do update
      set value = public.app_config.value || excluded.value
  `);
  const serviceId = (await client.query(`
    insert into public.provider_services (
      provider_id, category_id, visit_fee, labour_rate, active
    ) values ($1::uuid, $2::uuid, 0, 10000, true)
    returning id
  `, [providerId, categoryId])).rows[0].id;
  const packageId = (await client.query(`
    insert into public.service_packages (
      provider_service_id, title, description, price_type, price, price_min,
      price_max, unit, qty_min, qty_max, duration_min, active
    ) values (
      $1::uuid, 'Single session', '', 'fixed', 20000, 20000,
      20000, 'session', 1, 1, 60, true
    ) returning id
  `, [serviceId])).rows[0].id;
  const addressId = (await client.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Home', '1 MN04 Test Road', $2::text, 16.5, 80.6)
    returning id
  `, [customerId, city])).rows[0].id;
  nextSlot += 1;
  const slotDate = new Date();
  slotDate.setUTCDate(slotDate.getUTCDate() + 14 + nextSlot);
  slotDate.setUTCHours(10, 0, 0, 0);
  const slot = slotDate.toISOString();
  const fixtureState = await bookingFixtureState(
    client, categoryId, providerId, serviceId, addressId, slot,
  );
  if (!fixtureState?.bookability_checks?.is_bookable) {
    throw new Error(`booking fixture is not bookable; actual=${JSON.stringify(fixtureState)}`);
  }
  let bookingId;
  try {
    bookingId = (await client.query(`
      insert into public.bookings (
        customer_id, provider_id, category_id, provider_service_id, address_id,
        description, scheduled_at, service_window, status, visit_fee, platform_fee,
        total_amount, archetype, exclusive, session_duration_min, service_package_id,
        commission_bp_snapshot
      ) values (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        'MN04 PostgreSQL retry concurrency', $6::timestamptz,
        tstzrange($6::timestamptz, $6::timestamptz + interval '1 hour', '[)'),
        'completion_requested', 0, 0, 20000, 'time_based', true, 60, $7::uuid, 1000
      ) returning id
    `, [customerId, providerId, categoryId, serviceId, addressId, slot, packageId])).rows[0].id;
  } catch (error) {
    let actual;
    try {
      actual = await bookingFixtureState(
        client, categoryId, providerId, serviceId, addressId, slot,
      );
    } catch (diagnosticError) {
      actual = { diagnostic_error: diagnosticError?.message ?? String(diagnosticError) };
    }
    const failure = {
      message: error?.message ?? String(error),
      code: error?.code ?? null,
      where: error?.where ?? null,
      query: error?.query ?? null,
      booking_fixture: actual,
    };
    throw new Error(`booking insert failed; actual=${JSON.stringify(failure)}`, { cause: error });
  }
  const paymentId = (await client.query(`
    insert into public.payments (
      booking_id, purpose, amount, status, razorpay_payment_id, paid_at
    ) values (
      $1::uuid, 'balance', 20000, 'paid', $2::text, $3::timestamptz
    ) returning id
  `, [bookingId, `mn04-${randomUUID()}`, slot])).rows[0].id;
  return { adminId, paymentId };
}

async function makeRefund(client, paymentId, amount) {
  return (await client.query(`
    insert into public.refunds (payment_id, amount, status, attempts, last_error)
    values ($1::uuid, $2::int, 'failed', 3, 'concurrent retry fixture')
    returning id
  `, [paymentId, amount])).rows[0].id;
}

async function prepareAs(client, uid) {
  await client.query(
    'select set_config(\'request.jwt.claim.sub\', $1::text, false)',
    [uid],
  );
  await client.query('set role authenticated');
}

async function as(client, uid, sql, params = []) {
  await prepareAs(client, uid);
  try {
    return await client.query(sql, params);
  } finally {
    await client.query('reset role');
  }
}

async function waitForLockWait(observer, blockedPid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let actual = null;
  while (Date.now() < deadline) {
    actual = (await observer.query(`
      select pid, state, wait_event_type, wait_event, query,
             pg_blocking_pids(pid) as blockers
        from pg_stat_activity
       where pid = $1::int
    `, [blockedPid])).rows[0] ?? null;
    if (
      actual?.wait_event_type === 'Lock'
      && /admin_retry_refund/i.test(actual.query ?? '')
    ) return actual;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return actual;
}

function capture(promise) {
  return promise.then(
    (result) => ({ ok: true, rows: result.rows }),
    (error) => ({
      ok: false,
      code: error?.code ?? null,
      message: error?.message ?? String(error),
    }),
  );
}

async function runChildLockContention(context) {
  const fixture = await context.withClient((client) => makePaymentFixture(client));
  const targetId = await context.withClient((client) => makeRefund(client, fixture.paymentId, 5000));
  await context.withTwoClients(async (worker, retry) => {
    const workerPid = Number((await worker.query('select pg_backend_pid() as pid')).rows[0].pid);
    const retryPid = Number((await retry.query('select pg_backend_pid() as pid')).rows[0].pid);
    const pids = { workerPid, retryPid };
    assert.notEqual(workerPid, retryPid,
      `child-lock contention requires independent backends: ${JSON.stringify(pids)}`);
    await worker.query(`set statement_timeout = '5000ms'`);
    await retry.query(`set statement_timeout = '3000ms'`);

    let workerTransactionOpen = false;
    let retryTransactionOpen = false;
    try {
      await worker.query('begin');
      workerTransactionOpen = true;
      // Model the worker's refund-row-first, payment-row-second lock order.
      await worker.query(`
        select r.id from public.refunds r where r.id = $1::uuid for update
      `, [targetId]);

      await prepareAs(retry, fixture.adminId);
      await retry.query('begin');
      retryTransactionOpen = true;
      const outcome = await capture(retry.query(`
        select public.admin_retry_refund($1::uuid) as result
      `, [targetId]));
      const retryActivity = (await worker.query(`
        select state, wait_event_type, wait_event, query
          from pg_stat_activity
         where pid = $1::int
      `, [retryPid])).rows[0] ?? null;
      const diagnostics = { ...pids, targetId, outcome, retryActivity };
      assert.equal(outcome.ok, false,
        `the retry must fail rather than wait behind the worker-held child row: ${JSON.stringify(diagnostics)}`);
      assert.match(outcome.message?.toLowerCase() ?? '', /refund is changing/,
        `child lock contention must produce the retryable stale-state error: ${JSON.stringify(diagnostics)}`);
      assert.notEqual(retryActivity?.wait_event_type, 'Lock',
        `the retry backend must not remain blocked on the child lock: ${JSON.stringify(diagnostics)}`);

      await retry.query('rollback');
      retryTransactionOpen = false;
      await retry.query('reset role');
      const workerUpdate = await worker.query(`
        update public.payments
           set status = 'refund_processing'
         where id = $1::uuid
      `, [fixture.paymentId]);
      assert.equal(workerUpdate.rowCount, 1,
        `the worker can acquire the payment row after the retry exits: ${JSON.stringify(diagnostics)}`);
      await worker.query('rollback');
      workerTransactionOpen = false;

      const after = await context.withClient(async (client) => {
        const refunds = (await client.query(`
          select r.id, r.status::text as status, r.attempts
            from public.refunds r where r.id = $1::uuid
        `, [targetId])).rows;
        const audit = (await client.query(`
          select a.id from public.admin_audit_log a
           where a.action = 'admin_retry_refund' and a.target_id = $1::uuid
        `, [targetId])).rows;
        const payment = (await client.query(`
          select p.status::text as status
            from public.payments p where p.id = $1::uuid
        `, [fixture.paymentId])).rows[0];
        return { refunds, audit, payment };
      });
      assert.equal(after.refunds[0]?.status, 'failed',
        `contended target must remain failed: ${JSON.stringify({ diagnostics, after })}`);
      assert.equal(after.audit.length, 0,
        `contended retry must not write an audit row: ${JSON.stringify({ diagnostics, after })}`);
      assert.equal(after.payment?.status, 'paid',
        `the worker contention fixture must roll back without changing payment state: ${JSON.stringify({ diagnostics, after })}`);
    } finally {
      if (retryTransactionOpen) {
        await retry.query('rollback').catch(() => undefined);
      }
      if (workerTransactionOpen) {
        await worker.query('rollback').catch(() => undefined);
      }
      await worker.query('reset role').catch(() => undefined);
      await retry.query('reset role').catch(() => undefined);
    }
  });
}

export async function run(context) {
  const fixture = await context.withClient((client) => makePaymentFixture(client));
  const targetA = await context.withClient((client) => makeRefund(client, fixture.paymentId, 12000));
  const targetB = await context.withClient((client) => makeRefund(client, fixture.paymentId, 12000));

  await context.withTwoClients(async (first, second) => {
    const firstPid = Number((await first.query('select pg_backend_pid() as pid')).rows[0].pid);
    const secondPid = Number((await second.query('select pg_backend_pid() as pid')).rows[0].pid);
    const pids = { firstPid, secondPid };
    assert.notEqual(firstPid, secondPid,
      `concurrent retries require distinct PostgreSQL backends: ${JSON.stringify(pids)}`);
    await first.query(`set statement_timeout = '15000ms'`);
    await second.query(`set statement_timeout = '15000ms'`);

    let firstTransactionOpen = false;
    let secondTransactionOpen = false;
    let secondRetryPromise = null;
    try {
      await first.query('begin');
      firstTransactionOpen = true;
      await first.query(`
        select p.id from public.payments p where p.id = $1::uuid for update
      `, [fixture.paymentId]);

      await prepareAs(second, fixture.adminId);
      await second.query('begin');
      secondTransactionOpen = true;
      secondRetryPromise = capture(second.query(`
        select public.admin_retry_refund($1::uuid) as result
      `, [targetB]));

      const blocked = await waitForLockWait(first, secondPid);
      const barrier = { ...pids, blocked, targetA, targetB, paymentId: fixture.paymentId };
      assert.equal(blocked?.wait_event_type, 'Lock',
        `second transaction must overlap and wait on the first payment reservation lock: ${JSON.stringify(barrier)}`);
      assert.match(blocked?.query ?? '', /admin_retry_refund/i,
        `the blocked statement must be the competing retry: ${JSON.stringify(barrier)}`);
      assert.ok(
        (blocked?.blockers ?? []).map(Number).includes(firstPid),
        `the first backend must hold the reservation lock observed by the second: ${JSON.stringify(barrier)}`,
      );

      const firstRetry = await as(first, fixture.adminId, `
        select public.admin_retry_refund($1::uuid) as result
      `, [targetA]);
      await first.query('commit');
      firstTransactionOpen = false;

      const secondRetry = await secondRetryPromise;
      await second.query('rollback');
      secondTransactionOpen = false;
      await second.query('reset role');

      const refunds = (await first.query(`
        select r.id, r.amount, r.status::text as status, r.attempts
          from public.refunds r
         where r.payment_id = $1::uuid
         order by r.id
      `, [fixture.paymentId])).rows;
      const audit = (await first.query(`
        select a.admin_id, a.action, a.target_id, a.details
          from public.admin_audit_log a
         where a.action = 'admin_retry_refund'
           and a.target_id = any($1::uuid[])
         order by a.target_id
      `, [[targetA, targetB]])).rows;
      const totals = (await first.query(`
        select coalesce(sum(r.amount) filter (where r.status <> 'failed'), 0)::bigint as reserved,
               p.amount as captured
          from public.payments p
          left join public.refunds r on r.payment_id = p.id
         where p.id = $1::uuid
         group by p.amount
      `, [fixture.paymentId])).rows[0];
      const diagnostics = {
        ...pids,
        blocked,
        firstRetry: firstRetry.rows,
        secondRetry,
        refunds,
        audit,
        totals,
      };

      assert.equal(firstRetry.rows[0]?.result?.refund_id, targetA,
        `one retry must succeed on its original PK: ${JSON.stringify(diagnostics)}`);
      assert.equal(firstRetry.rows[0]?.result?.status, 'pending',
        `the successful retry must become pending: ${JSON.stringify(diagnostics)}`);
      assert.equal(secondRetry.ok, false,
        `the competing retry must be rejected after rechecking capacity: ${JSON.stringify(diagnostics)}`);
      assert.match(secondRetry.message?.toLowerCase() ?? '', /capacity/,
        `the losing retry must report stale capacity: ${JSON.stringify(diagnostics)}`);
      assert.equal(refunds.filter((refund) => refund.status === 'pending').length, 1,
        `at most one failed 12000 refund may become pending: ${JSON.stringify(diagnostics)}`);
      assert.equal(refunds.find((refund) => refund.id === targetB)?.status, 'failed',
        `the rejected target must remain failed: ${JSON.stringify(diagnostics)}`);
      assert.equal(Number(totals?.reserved), 12000,
        `reserved refunds must remain within the captured 20000: ${JSON.stringify(diagnostics)}`);
      assert.equal(Number(totals?.captured), 20000,
        `the fixture payment must remain the captured 20000 amount: ${JSON.stringify(diagnostics)}`);
      assert.equal(audit.length, 1,
        `only the successful retry may create an audit row: ${JSON.stringify(diagnostics)}`);
      assert.equal(audit[0]?.target_id, targetA,
        `the audit row must point to the successful target: ${JSON.stringify(diagnostics)}`);
    } finally {
      if (firstTransactionOpen) {
        await first.query('rollback').catch(() => undefined);
      }
      if (secondRetryPromise && secondTransactionOpen) {
        await secondRetryPromise;
        await second.query('rollback').catch(() => undefined);
      }
      await first.query('reset role').catch(() => undefined);
      await second.query('reset role').catch(() => undefined);
    }
  });
  await runChildLockContention(context);
}

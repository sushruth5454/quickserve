import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

async function prepareAs(client, uid) {
  await client.query(
    "select set_config('request.jwt.claim.sub', $1::text, false)",
    [uid],
  );
  await client.query('set role authenticated');
}

async function asPrepared(client, sql, params = []) {
  try {
    return await client.query(sql, params);
  } finally {
    await client.query('reset role');
  }
}

async function makeUser(client, label) {
  const id = randomUUID();
  const digits = randomUUID().replace(/\D/g, '').slice(0, 10);
  await client.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, `+1555${digits}`]);
  await client.query(
    'update public.profiles set full_name = $2::text where id = $1::uuid',
    [id, `SV20 ${label}`],
  );
  return id;
}

async function makeAcceptFixture(client) {
  const customerId = await makeUser(client, 'race-customer');
  const providerId = await makeUser(client, 'race-provider');
  const city = `SV20 concurrency ${randomUUID()}`;
  const categoryId = (await client.query(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, min_lead_hours, requires_docs
    ) values (
      $1::text, $2::text, 'quote', true, 'proposal', '{}'::jsonb, 1::int,
      365::int, 1::int, '{}'::text[]
    )
    returning id
  `, [`sv20-${randomUUID().replace(/-/g, '')}`, 'SV20 accept/cancel race'])).rows[0].id;
  await client.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, admin_review_status, submitted_at, is_online, paused, suspended
    ) values (
      $1::uuid, $2::text, extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', 'approved', '2026-01-01T00:00:00Z'::timestamptz, true, false, false
    )
  `, [providerId, city]);
  const providerServiceId = (await client.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0::int, 0::int, true)
    returning id
  `, [providerId, categoryId])).rows[0].id;
  const addressId = (await client.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values ($1::uuid, 'Venue', 'SV20 concurrency address', $2::text, 16.50::double precision, 80.60::double precision)
    returning id
  `, [customerId, city])).rows[0].id;
  const requestId = (await client.query(`
    insert into public.service_requests (
      customer_id, category_id, city, area, event_start, event_end, intake,
      budget_min, budget_max, status, expires_at
    ) values (
      $1::uuid, $2::uuid, $3::text, 'Central'::text,
      '2040-04-14T10:00:00+05:30'::timestamptz,
      '2040-04-14T14:00:00+05:30'::timestamptz,
      '{}'::jsonb, 50000::int, 200000::int, 'open'::text,
      '2039-04-13T18:00:00Z'::timestamptz
    )
    returning id
  `, [customerId, categoryId, city])).rows[0].id;
  await client.query(`
    insert into public.request_private (request_id, address_id, venue_text)
    values ($1::uuid, $2::uuid, 'SV20 concurrency venue'::text)
  `, [requestId, addressId]);
  await client.query(`
    insert into public.request_recipients (request_id, provider_id, provider_service_id)
    values ($1::uuid, $2::uuid, $3::uuid)
  `, [requestId, providerId, providerServiceId]);
  const proposalId = (await client.query(`
    insert into public.proposals (
      request_id, provider_id, provider_service_id, version, status, total, valid_until, note, deliverables
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 1::int, 'sent'::text, 100000::int,
      '2039-04-13T18:00:00Z'::timestamptz, 'SV20 concurrency proposal'::text, '[]'::jsonb
    )
    returning id
  `, [requestId, providerId, providerServiceId])).rows[0].id;
  await client.query(`
    insert into public.proposal_items (
      proposal_id, seq, kind, title, qty, unit, unit_price, metadata
    ) values (
      $1::uuid, 1::int, 'package'::public.quote_item_kind, 'SV20 service'::text,
      1::numeric, 'job'::text, 100000::int, '{}'::jsonb
    )
  `, [proposalId]);
  await client.query(`
    insert into public.proposal_schedule (proposal_id, seq, label, amount, due_rule)
    values
      ($1::uuid, 1::int, 'Booking advance'::text, 25000::int, 'at_booking'::text),
      ($1::uuid, 2::int, 'Final payment'::text, 75000::int, 'on_delivery'::text)
  `, [proposalId]);
  return { customerId, requestId, proposalId, addressId };
}

async function waitForBlockedFunction(observer, pid, blockerPid, functionName, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let actual = null;
  while (Date.now() < deadline) {
    actual = (await observer.query(`
      select sa.state, sa.wait_event_type, sa.wait_event, sa.query,
             pg_blocking_pids(sa.pid) as blockers
        from pg_catalog.pg_stat_activity sa
       where sa.pid = $1::int
    `, [pid])).rows[0] ?? null;
    const blockers = (actual?.blockers ?? []).map(Number);
    if (
      actual?.wait_event_type === 'Lock'
      && new RegExp(functionName, 'i').test(actual.query ?? '')
      && blockers.includes(blockerPid)
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

export async function run(context) {
  await context.withTwoClients(async (first, second) => {
    const [firstPidResult, secondPidResult] = await Promise.all([
      first.query('select pg_backend_pid() as pid'),
      second.query('select pg_backend_pid() as pid'),
    ]);
    const firstPid = Number(firstPidResult.rows[0]?.pid);
    const secondPid = Number(secondPidResult.rows[0]?.pid);
    const pids = { firstPid, secondPid };
    assert.ok(Number.isInteger(firstPid) && Number.isInteger(secondPid) && firstPid !== secondPid,
      `race requires two independent PostgreSQL backend PIDs: ${JSON.stringify(pids)}`);
    await first.query(`set statement_timeout = '20000ms'`);
    await second.query(`set statement_timeout = '20000ms'`);

    const readState = async (fixture) => (await first.query(`
      select jsonb_build_object(
        'request_status', r.status,
        'proposal_status', p.status,
        'bookings', coalesce((
          select jsonb_agg(jsonb_build_object('id', b.id, 'status', b.status::text) order by b.id)
            from public.bookings b
           where b.service_request_id = r.id
        ), '[]'::jsonb),
        'active_count', (
          select count(*)::int
            from public.bookings b
           where b.service_request_id = r.id
             and b.status in ('pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
                              'delivery_pending', 'completion_requested', 'disputed')
        )
      ) as state
        from public.service_requests r
        join public.proposals p on p.request_id = r.id and p.id = $2::uuid
       where r.id = $1::uuid
    `, [fixture.requestId, fixture.proposalId])).rows[0]?.state;

    const firstFixture = await makeAcceptFixture(first);
    let firstTransactionOpen = false;
    let firstCancelPromise;
    try {
      await first.query('begin');
      firstTransactionOpen = true;
      await first.query(`
        select r.id
          from public.service_requests r
         where r.id = $1::uuid
         for update
      `, [firstFixture.requestId]);
      await prepareAs(second, firstFixture.customerId);
      firstCancelPromise = capture(asPrepared(second, `
        select public.cancel_service_request($1::uuid)
      `, [firstFixture.requestId]));
      const cancelBlocked = await waitForBlockedFunction(
        first, secondPid, firstPid, 'cancel_service_request',
      );
      const overlap = { pids, cancelBlocked, requestId: firstFixture.requestId };
      assert.equal(cancelBlocked?.wait_event_type, 'Lock',
        `request cancellation must block first on the service-request row: ${JSON.stringify(overlap)}`);
      assert.ok((cancelBlocked?.blockers ?? []).map(Number).includes(firstPid),
        `request cancellation must be blocked by the request-row barrier: ${JSON.stringify(overlap)}`);
      assert.match(cancelBlocked?.query ?? '', /cancel_service_request/i,
        `the blocked statement must be cancel_service_request: ${JSON.stringify(overlap)}`);

      await prepareAs(first, firstFixture.customerId);
      const accepted = await capture(first.query(`
        select public.accept_proposal($1::uuid, $2::uuid) as booking_id
      `, [firstFixture.proposalId, firstFixture.addressId]));
      if (accepted.ok) {
        await first.query('commit');
      } else {
        await first.query('rollback');
      }
      firstTransactionOpen = false;
      const cancelled = await firstCancelPromise;
      await first.query('reset role');
      await second.query('reset role');
      const state = await readState(firstFixture);
      const diagnostics = { pids, cancelBlocked, accepted, cancelled, state };
      assert.equal(accepted.ok, true,
        `accept_proposal must create a booking while cancellation waits on the request lock: ${JSON.stringify(diagnostics)}`);
      assert.equal(cancelled.ok, false,
        `queued cancellation must reject the active hold after acceptance commits: ${JSON.stringify(diagnostics)}`);
      assert.match(cancelled.message ?? '', /active booking/i,
        `queued cancellation must fail on the active-booking guard: ${JSON.stringify(diagnostics)}`);
      assert.equal(state.request_status, 'closed',
        `accepted active hold must not coexist with a request-cancelled state: ${JSON.stringify(diagnostics)}`);
      assert.equal(state.proposal_status, 'accepted',
        `acceptance leaves its proposal accepted: ${JSON.stringify(diagnostics)}`);
      assert.equal(state.bookings.length, 1,
        `the request has exactly one booking after the race: ${JSON.stringify(diagnostics)}`);
      assert.equal(state.bookings[0]?.status, 'pending_payment',
        `the accepted booking remains a payment hold: ${JSON.stringify(diagnostics)}`);
      assert.equal(state.active_count, 1,
        `the request has one active hold after the race: ${JSON.stringify(diagnostics)}`);
    } finally {
      if (firstTransactionOpen) await first.query('rollback').catch(() => undefined);
      if (firstCancelPromise) await firstCancelPromise;
      await Promise.all([
        first.query('reset role').catch(() => undefined),
        second.query('reset role').catch(() => undefined),
      ]);
    }

    const secondFixture = await makeAcceptFixture(first);
    let secondTransactionOpen = false;
    let secondAcceptPromise;
    try {
      await first.query('begin');
      secondTransactionOpen = true;
      await first.query(`
        select r.id
          from public.service_requests r
         where r.id = $1::uuid
         for update
      `, [secondFixture.requestId]);
      await prepareAs(second, secondFixture.customerId);
      secondAcceptPromise = capture(asPrepared(second, `
        select public.accept_proposal($1::uuid, $2::uuid) as booking_id
      `, [secondFixture.proposalId, secondFixture.addressId]));
      const acceptBlocked = await waitForBlockedFunction(
        first, secondPid, firstPid, 'accept_proposal',
      );
      const overlap = { pids, acceptBlocked, requestId: secondFixture.requestId };
      assert.equal(acceptBlocked?.wait_event_type, 'Lock',
        `acceptance must hold its proposal lock while waiting for the request row: ${JSON.stringify(overlap)}`);
      assert.ok((acceptBlocked?.blockers ?? []).map(Number).includes(firstPid),
        `acceptance must be blocked by the request-row barrier: ${JSON.stringify(overlap)}`);

      await prepareAs(first, secondFixture.customerId);
      await first.query('savepoint sv20_cancel_attempt');
      const cancelled = await capture(first.query(`
        select public.cancel_service_request($1::uuid)
      `, [secondFixture.requestId]));
      await first.query('rollback to savepoint sv20_cancel_attempt');
      await first.query('release savepoint sv20_cancel_attempt');
      await first.query('reset role');
      const beforeAcceptCommit = await readState(secondFixture);
      const cancelDiagnostics = { pids, acceptBlocked, cancelled, beforeAcceptCommit };
      assert.equal(cancelled.ok, false,
        `cancellation must fail fast instead of waiting cyclically on the acceptance-locked proposal: ${JSON.stringify(cancelDiagnostics)}`);
      assert.match(cancelled.message ?? '', /proposal is being accepted/i,
        `cancellation must report retryable proposal-lock contention: ${JSON.stringify(cancelDiagnostics)}`);
      assert.notEqual(cancelled.code, '40P01',
        `the two-connection race must not deadlock: ${JSON.stringify(cancelDiagnostics)}`);
      assert.equal(beforeAcceptCommit.request_status, 'open',
        `fast-failed cancellation leaves the request unchanged: ${JSON.stringify(cancelDiagnostics)}`);
      assert.equal(beforeAcceptCommit.proposal_status, 'sent',
        `fast-failed cancellation leaves the proposal unchanged: ${JSON.stringify(cancelDiagnostics)}`);
      assert.equal(beforeAcceptCommit.bookings.length, 0,
        `no booking is written by the failed cancellation: ${JSON.stringify(cancelDiagnostics)}`);

      await first.query('commit');
      secondTransactionOpen = false;
      const accepted = await secondAcceptPromise;
      await prepareAs(first, secondFixture.customerId);
      const retryCancellation = await capture(asPrepared(first, `
        select public.cancel_service_request($1::uuid)
      `, [secondFixture.requestId]));
      await first.query('reset role');
      const state = await readState(secondFixture);
      const diagnostics = { pids, acceptBlocked, cancelled, accepted, retryCancellation, state };
      assert.equal(accepted.ok, true,
        `acceptance completes after the request-row barrier releases: ${JSON.stringify(diagnostics)}`);
      assert.equal(retryCancellation.ok, false,
        `retry after acceptance must reject the active hold: ${JSON.stringify(diagnostics)}`);
      assert.match(retryCancellation.message ?? '', /active booking/i,
        `retry must reach the active-booking guard: ${JSON.stringify(diagnostics)}`);
      assert.equal(state.request_status, 'closed',
        `accepted hold cannot coexist with a cancelled request: ${JSON.stringify(diagnostics)}`);
      assert.equal(state.proposal_status, 'accepted',
        `the proposal remains accepted after retry rejection: ${JSON.stringify(diagnostics)}`);
      assert.equal(state.bookings.length, 1,
        `the second request has exactly one booking: ${JSON.stringify(diagnostics)}`);
      assert.equal(state.active_count, 1,
        `the second request retains exactly one active hold: ${JSON.stringify(diagnostics)}`);
    } finally {
      if (secondTransactionOpen) await first.query('rollback').catch(() => undefined);
      if (secondAcceptPromise) await secondAcceptPromise;
      await Promise.all([
        first.query('reset role').catch(() => undefined),
        second.query('reset role').catch(() => undefined),
      ]);
    }
  });
}

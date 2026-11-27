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
  const fixture = await context.withClient((client) => makeAcceptFixture(client));
  await context.withClient(async (observer) => {
    await context.withTwoClients(async (acceptClient, cancelClient) => {
      const [observerPid, acceptPid, cancelPid] = await Promise.all([
        observer.query('select pg_backend_pid() as pid'),
        acceptClient.query('select pg_backend_pid() as pid'),
        cancelClient.query('select pg_backend_pid() as pid'),
      ]).then((rows) => rows.map((result) => Number(result.rows[0]?.pid)));
      const pids = { observerPid, acceptPid, cancelPid };
      assert.equal(new Set(Object.values(pids)).size, 3,
        `race requires three distinct PostgreSQL sessions: ${JSON.stringify(pids)}`);
      for (const client of [observer, acceptClient, cancelClient]) {
        await client.query(`set statement_timeout = '20000ms'`);
      }

      let barrierOpen = false;
      let acceptPromise;
      let cancelPromise;
      try {
        await Promise.all([
          prepareAs(acceptClient, fixture.customerId),
          prepareAs(cancelClient, fixture.customerId),
        ]);
        await observer.query('begin');
        barrierOpen = true;
        await observer.query(`
          select r.id
            from public.service_requests r
           where r.id = $1::uuid
           for update
        `, [fixture.requestId]);

        acceptPromise = capture(acceptClient.query(`
          select public.accept_proposal($1::uuid, $2::uuid) as booking_id
        `, [fixture.proposalId, fixture.addressId]).finally(() => acceptClient.query('reset role')));
        const acceptBlocked = await waitForBlockedFunction(
          observer, acceptPid, observerPid, 'accept_proposal',
        );
        cancelPromise = capture(cancelClient.query(`
          select public.cancel_service_request($1::uuid)
        `, [fixture.requestId]).finally(() => cancelClient.query('reset role')));
        const cancelBlocked = await waitForBlockedFunction(
          observer, cancelPid, observerPid, 'cancel_service_request',
        );
        const overlap = { pids, acceptBlocked, cancelBlocked, requestId: fixture.requestId };
        assert.equal(acceptBlocked?.wait_event_type, 'Lock',
          `accept_proposal must overlap while waiting on the service-request lock: ${JSON.stringify(overlap)}`);
        assert.ok((acceptBlocked?.blockers ?? []).map(Number).includes(observerPid),
          `accept_proposal must be blocked by the request-row barrier: ${JSON.stringify(overlap)}`);
        assert.equal(cancelBlocked?.wait_event_type, 'Lock',
          `cancel_service_request must use the existing request-first lock order: ${JSON.stringify(overlap)}`);
        assert.ok((cancelBlocked?.blockers ?? []).map(Number).includes(observerPid),
          `cancel_service_request must wait on the same request-row barrier: ${JSON.stringify(overlap)}`);
        assert.match(cancelBlocked?.query ?? '', /cancel_service_request/i,
          `the blocked request-first statement must be cancel_service_request: ${JSON.stringify(overlap)}`);

        await observer.query('commit');
        barrierOpen = false;
        const [accepted, cancelled] = await Promise.all([acceptPromise, cancelPromise]);
        const finalState = (await observer.query(`
          select r.status as request_status, p.status as proposal_status,
                 b.id as booking_id, b.status::text as booking_status
            from public.service_requests r
            join public.proposals p on p.request_id = r.id
            join public.bookings b on b.service_request_id = r.id and b.proposal_id = p.id
           where r.id = $1::uuid
        `, [fixture.requestId])).rows;
        const activeCount = (await observer.query(`
          select count(*)::int as count
            from public.bookings b
           where b.service_request_id = $1::uuid
             and b.status in ('pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
                              'delivery_pending', 'completion_requested', 'disputed')
        `, [fixture.requestId])).rows[0]?.count;
        const diagnostics = {
          pids,
          acceptBlocked,
          cancelBlocked,
          accepted,
          cancelled,
          finalState,
          activeCount,
        };
        assert.equal(accepted.ok, true,
          `accept_proposal must finish after the request lock is released: ${JSON.stringify(diagnostics)}`);
        assert.equal(cancelled.ok, false,
          `request-only cancellation must reject the newly-created active hold: ${JSON.stringify(diagnostics)}`);
        assert.match(cancelled.message ?? '', /active booking/i,
          `cancellation must report the active booking guard, not an unrelated failure: ${JSON.stringify(diagnostics)}`);
        assert.equal(finalState.length, 1,
          `the accepted proposal must have exactly one booking after the race: ${JSON.stringify(diagnostics)}`);
        assert.equal(finalState[0]?.request_status, 'closed',
          `accepted active hold must not coexist with a cancelled request: ${JSON.stringify(diagnostics)}`);
        assert.equal(finalState[0]?.proposal_status, 'accepted',
          `the winning accept leaves its proposal accepted: ${JSON.stringify(diagnostics)}`);
        assert.equal(finalState[0]?.booking_status, 'pending_payment',
          `the accepted result remains the expected held booking: ${JSON.stringify(diagnostics)}`);
        assert.equal(activeCount, 1,
          `the request has one active hold and no request-cancelled state: ${JSON.stringify(diagnostics)}`);
      } finally {
        if (barrierOpen) await observer.query('rollback').catch(() => undefined);
        if (acceptPromise) await acceptPromise;
        if (cancelPromise) await cancelPromise;
        await Promise.all([
          acceptClient.query('reset role').catch(() => undefined),
          cancelClient.query('reset role').catch(() => undefined),
        ]);
      }
    });
  });
}

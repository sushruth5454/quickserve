import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const newAt = '2027-10-16T10:00:00+05:30';

async function as(client, uid, sql, params = []) {
  await client.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [uid ?? '']);
  await client.query('set role authenticated');
  try {
    return await client.query(sql, params);
  } finally {
    await client.query('reset role');
  }
}

async function createFixture(client, label, startAccepted = false) {
  const customer = randomUUID();
  const provider = randomUUID();
  const manager = randomUUID();
  const staff = randomUUID();
  const otherCustomer = randomUUID();
  const city = `SV07 ${label} ${randomUUID()}`;
  const users = [customer, provider, manager, staff, otherCustomer];
  await client.query(
    `insert into auth.users (id) values ($1::uuid), ($2::uuid), ($3::uuid), ($4::uuid), ($5::uuid)`,
    users,
  );
  await client.query(`
    update feature_flags set enabled = true
     where key in ('recurring_bookings', 'recurring_reschedule', 'recurring_skip_pause', 'merchant_staff')
  `);
  await client.query(`
    insert into providers (
      id, city, base_location, kyc_status, admin_review_status,
      submitted_at, is_online, paused, suspended
    ) values (
      $1::uuid, $2::text,
      extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', 'approved', now(), true, false, false
    )
  `, [provider, city]);
  await client.query(`
    insert into business_members (owner_id, member_id, role, active) values
      ($1::uuid, $2::uuid, 'manager', true),
      ($1::uuid, $3::uuid, 'staff', true)
  `, [provider, manager, staff]);
  const category = (await client.query(`
    insert into categories (
      slug, name, pricing_mode, active, archetype, intake_schema, config_version,
      max_lead_days, recurrence_allowed, allowed_frequencies, recurring_discount_bp
    ) values (
      $1::text, $2::text, 'quote', true, 'time_based', '{}'::jsonb, 1, 365,
      true, array['custom']::text[], 0
    ) returning id
  `, [`sv07-${randomUUID()}`, city])).rows[0].id;
  await client.query(`
    insert into category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [category, city]);
  const service = (await client.query(`
    insert into provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0, 60000, true)
    returning id
  `, [provider, category])).rows[0].id;
  await client.query(`
    insert into provider_availability (provider_id, weekday, start_time, end_time)
    select $1::uuid, d, time '00:00', time '23:59' from generate_series(0, 6) d
  `, [provider]);
  const schedule = (await client.query(`
    insert into recurring_schedules (
      customer_id, provider_id, provider_service_id, frequency, weekdays, start_time, timezone,
      session_duration_min, payment_mode, address_line, city, lat, lng, description,
      starts_on, ends_on, status, custom_dates, max_occurrences, archetype,
      provider_acceptance, acceptance_mode, billing_frequency, plan_version
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'custom', array[]::smallint[], time '10:00',
      'Asia/Kolkata', 60, 'per_session', 'SV07 address', $4::text, 16.50, 80.60,
      $5::text, date '2027-10-15', date '2027-10-15', 'active',
      array[date '2027-10-15'], 1, 'time_based', 'accepted', 'occurrence',
      'per_visit', 'v2'
    ) returning id
  `, [customer, provider, service, city, `SV07 ${label}`])).rows[0].id;
  const materialized = (await client.query(
    `select materialize_recurring_schedule($1::uuid, date '2027-10-15') created`,
    [schedule],
  )).rows[0].created;
  const bookingRows = (await client.query(`
    select id, scheduled_at from bookings where recurring_schedule_id = $1::uuid
  `, [schedule])).rows;
  const materializationDetails = (await client.query(`
    select p.admin_review_status, public._provider_is_live(p.id) provider_live,
           coalesce((
             select jsonb_agg(jsonb_build_object('kind', c.kind, 'reason', c.reason) order by c.created_at)
               from recurring_occurrence_changes c where c.schedule_id = $2::uuid
           ), '[]'::jsonb) occurrence_changes
      from providers p where p.id = $1::uuid
  `, [provider, schedule])).rows[0];
  assert.equal(materialized, 1,
    `materialize fixture must create one visit: ${JSON.stringify({ label, schedule, materialized, materializationDetails })}`);
  assert.equal(bookingRows.length, 1,
    `fixture must have one booking: ${JSON.stringify({ label, bookingRows, materializationDetails })}`);
  const booking = bookingRows[0];
  if (startAccepted) {
    await client.query(`update bookings set status = 'accepted' where id = $1::uuid`, [booking.id]);
    await client.query(`update payment_schedule set status = 'paid' where booking_id = $1::uuid`, [booking.id]);
  }
  const request = await as(
    client,
    customer,
    `select request_visit_reschedule($1::uuid, $2::timestamptz, $3::text) id`,
    [booking.id, newAt, 'SV07 concurrent lifecycle test'],
  );
  return {
    customer, provider, manager, staff, otherCustomer, city, category, service, schedule,
    booking: booking.id, change: request.rows[0].id, users,
  };
}

async function cleanupFixture(client, fixture) {
  await client.query(`delete from bookings where recurring_schedule_id = $1::uuid`, [fixture.schedule]);
  await client.query(`delete from recurring_schedules where id = $1::uuid`, [fixture.schedule]);
  await client.query(`delete from provider_services where id = $1::uuid`, [fixture.service]);
  await client.query(`delete from category_cities where category_id = $1::uuid`, [fixture.category]);
  await client.query(`delete from categories where id = $1::uuid`, [fixture.category]);
  await client.query(`delete from business_members where owner_id = $1::uuid`, [fixture.provider]);
  await client.query(`delete from providers where id = $1::uuid`, [fixture.provider]);
  await client.query(`delete from auth.users where id = any($1::uuid[])`, [fixture.users]);
}

async function state(client, bookingId) {
  return (await client.query(`
    select jsonb_build_object(
      'schedule', (
        select to_jsonb(r)
          from recurring_schedules r
         where r.id = (
           select b.recurring_schedule_id
             from bookings b
            where b.id = $1::uuid
         )
      ),
      'booking', (
        select jsonb_build_object(
          'id', id, 'status', status::text, 'scheduled_at', scheduled_at,
          'service_window', service_window::text
        ) from bookings where id = $1::uuid
      ),
      'due', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'seq', seq, 'amount', amount, 'due_at', due_at, 'status', status
        ) order by seq) from payment_schedule where booking_id = $1::uuid
      ), '[]'::jsonb),
      'ledger', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'schedule_id', schedule_id, 'booking_id', booking_id,
          'occurrence_date', occurrence_date, 'original_at', original_at,
          'kind', kind, 'new_at', new_at, 'actor_id', actor_id, 'reason', reason
        ) order by created_at, id)
          from recurring_occurrence_changes where booking_id = $1::uuid
      ), '[]'::jsonb)
    ) value
  `, [bookingId])).rows[0].value;
}

async function waitForResponseRetry(responsePromise, timeoutMs = 2000) {
  let timer;
  try {
    return await Promise.race([
      responsePromise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runRace(context, status) {
  const startAccepted = status === 'in_progress';
  const fixture = await context.withClient((client) => createFixture(client, `race-${status}`, startAccepted));
  try {
    await context.withTwoClients(async (first, second) => {
      const firstPid = Number((await first.query('select pg_backend_pid() pid')).rows[0].pid);
      const secondPid = Number((await second.query('select pg_backend_pid() pid')).rows[0].pid);
      assert.notEqual(firstPid, secondPid, `race requires independent backends: ${JSON.stringify({ firstPid, secondPid })}`);

      await first.query(`set statement_timeout = '15000ms'`);
      await second.query(`set statement_timeout = '15000ms'`);
      await first.query('begin');
      let firstTransactionOpen = true;
      let responseResult = { settled: false, value: null };
      try {
        await first.query(`select id from bookings where id = $1::uuid for update`, [fixture.booking]);
        await second.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [fixture.manager]);
        await second.query('set role authenticated');
        const responsePromise = second.query(
          `select respond_visit_reschedule($1::uuid, true)`,
          [fixture.change],
        ).then(
          (value) => {
            Object.assign(responseResult, { settled: true, value: { rows: value.rows } });
            return responseResult;
          },
          (error) => {
            Object.assign(responseResult, {
              settled: true,
              value: { code: error?.code ?? null, message: error?.message ?? String(error) },
            });
            return responseResult;
          },
        );
        const responseBeforeRelease = await waitForResponseRetry(responsePromise);
        await first.query(`
          select public._set_status(
            $1::uuid, $2::booking_status, $3::uuid, $4::text
          )
        `, [
          fixture.booking,
          status,
          status === 'cancelled' ? fixture.customer : status === 'in_progress' ? fixture.provider : null,
          `SV07 concurrent ${status} transition`,
        ]);
        const afterTransition = await state(first, fixture.booking);
        assert.equal(
          afterTransition.booking.status,
          status,
          `lifecycle transition must win the row lock: ${JSON.stringify({ status, afterTransition })}`,
        );
        await first.query('commit');
        firstTransactionOpen = false;
        const response = responseBeforeRelease ?? await responsePromise;
        const afterResponse = await state(first, fixture.booking);
        const outcomes = afterResponse.ledger.filter((row) => ['rescheduled', 'reschedule_declined'].includes(row.kind));
        const diagnostics = JSON.stringify({
          status, firstPid, secondPid, responseBeforeRelease, response,
          afterTransition, afterResponse, outcomes,
        });
        assert.ok(responseBeforeRelease,
          `response must promptly report retryable booking contention before the lifecycle commit: ${diagnostics}`);
        assert.equal(response.value?.code, '55P03',
          `response contention must use SQLSTATE 55P03: ${diagnostics}`);
        assert.match(response.value?.message ?? '', /retry reschedule response/i,
          `response contention must explain that the caller can retry: ${diagnostics}`);
        assert.deepEqual(
          afterResponse,
          afterTransition,
          `response must preserve transitioned booking, dues, and ledger: ${diagnostics}`,
        );
        assert.equal(
          outcomes.length,
          0,
          `response must not append a reschedule outcome: ${diagnostics}`,
        );
      } finally {
        if (firstTransactionOpen) await first.query('rollback').catch(() => undefined);
        await second.query('reset role').catch(() => undefined);
      }
    });
  } finally {
    await context.withClient((client) => cleanupFixture(client, fixture));
  }
}

async function waitForBookingFirstScheduleLock(observer, pid, blockerPid, operationResult, fixture, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastActivity = null;
  while (Date.now() < deadline) {
    lastActivity = (await observer.query(`
      select wait_event_type, wait_event, query, pg_blocking_pids(pid) blocking_pids
        from pg_stat_activity where pid = $1::int
    `, [pid])).rows[0] ?? null;
    const blockingPids = (lastActivity?.blocking_pids ?? []).map(Number);
    if (lastActivity?.wait_event_type === 'Lock'
        && blockingPids.includes(Number(blockerPid))
        && String(lastActivity.query).includes('report_provider_absence')) {
      return lastActivity;
    }
    if (operationResult.settled) {
      throw new Error(`booking-first operation completed before the schedule-lock barrier: ${JSON.stringify({
        pid, blockerPid, lastActivity, operation: operationResult.value, fixture,
      })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`booking-first operation did not reach the schedule-lock barrier: ${JSON.stringify({
    pid, blockerPid, lastActivity, operation: operationResult.value, fixture,
  })}`);
}

async function runBookingFirstResponseContention(context) {
  const fixture = await context.withClient((client) => createFixture(client, 'booking-first-response'));
  try {
    return await context.withTwoClients(async (bookingFirst, response) => {
      const bookingFirstPid = Number((await bookingFirst.query('select pg_backend_pid() pid')).rows[0].pid);
      const responsePid = Number((await response.query('select pg_backend_pid() pid')).rows[0].pid);
      assert.notEqual(bookingFirstPid, responsePid,
        `booking-first race requires independent PostgreSQL backends: ${JSON.stringify({ bookingFirstPid, responsePid, fixture })}`);

      const before = await state(response, fixture.booking);
      let bookingFirstTransactionOpen = false;
      let responseTransactionOpen = false;
      let operationResult = { settled: false, value: null };
      let operationPromise = null;
      try {
        await bookingFirst.query(`set statement_timeout = '15000ms'`);
        await response.query(`set statement_timeout = '15000ms'`);
        // Avoid making BEGIN itself part of the schedule-lock race under test.
        await bookingFirst.query('begin');
        bookingFirstTransactionOpen = true;
        await response.query('begin');
        responseTransactionOpen = true;
        await response.query(
          `select id from recurring_schedules where id = $1::uuid for update`,
          [fixture.schedule],
        );

        operationPromise = as(
          bookingFirst,
          fixture.manager,
          `select report_provider_absence($1::uuid, $2::text)`,
          [fixture.booking, 'SV07 booking-first lock barrier'],
        ).then(
          (result) => {
            Object.assign(operationResult, { settled: true, value: { ok: true, rows: result.rows } });
            return operationResult;
          },
          (error) => {
            Object.assign(operationResult, {
              settled: true,
              value: { ok: false, error: { code: error?.code ?? null, message: error?.message ?? String(error) } },
            });
            return operationResult;
          },
        );
        const scheduleBarrier = await waitForBookingFirstScheduleLock(
          response, bookingFirstPid, responsePid, operationResult, fixture,
        );

        await response.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [fixture.manager]);
        await response.query('set role authenticated');
        await response.query('savepoint response_attempt');
        const responseStartedAt = Date.now();
        let responseAttempt;
        try {
          await response.query(`select respond_visit_reschedule($1::uuid, true)`, [fixture.change]);
          responseAttempt = { ok: true };
        } catch (error) {
          responseAttempt = {
            ok: false,
            code: error?.code ?? null,
            message: error?.message ?? String(error),
          };
        }
        const responseDurationMs = Date.now() - responseStartedAt;
        await response.query('rollback to savepoint response_attempt');
        await response.query('release savepoint response_attempt');
        await response.query('reset role');
        const stateWhileBookingFirstBlocked = await state(response, fixture.booking);
        const responseNotificationsWhileBlocked = (await response.query(`
          select id, user_id, kind, booking_id, collapse_key
            from notifications
           where booking_id = $1::uuid
             and kind in ('recurring_visit_rescheduled', 'recurring_visit_reschedule_declined')
        `, [fixture.booking])).rows;
        await response.query('commit');
        responseTransactionOpen = false;

        const bookingFirstResult = await operationPromise;
        await bookingFirst.query('commit');
        bookingFirstTransactionOpen = false;
        const afterBookingFirst = await state(response, fixture.booking);
        const responseNotificationsAfter = (await response.query(`
          select id, user_id, kind, booking_id, collapse_key
            from notifications
           where booking_id = $1::uuid
             and kind in ('recurring_visit_rescheduled', 'recurring_visit_reschedule_declined')
        `, [fixture.booking])).rows;
        const outcomes = afterBookingFirst.ledger.filter((row) => ['rescheduled', 'reschedule_declined'].includes(row.kind));
        const absenceChanges = afterBookingFirst.ledger.filter((row) => row.kind === 'provider_absent');
        const diagnostics = JSON.stringify({
          bookingFirstPid, responsePid, fixture, before, scheduleBarrier,
          responseAttempt, responseDurationMs, stateWhileBookingFirstBlocked,
          responseNotificationsWhileBlocked, bookingFirstResult, afterBookingFirst,
          absenceChanges, outcomes, responseNotificationsAfter,
        });

        assert.equal(scheduleBarrier.wait_event_type, 'Lock',
          `booking-first operation must wait on the response backend's held schedule lock: ${diagnostics}`);
        assert.ok((scheduleBarrier.blocking_pids ?? []).map(Number).includes(responsePid),
          `schedule barrier must identify the distinct response backend: ${diagnostics}`);
        assert.equal(responseAttempt.ok, false, `contended response must be rejected: ${diagnostics}`);
        assert.equal(responseAttempt.code, '55P03',
          `contended response must return retryable SQLSTATE 55P03: ${diagnostics}`);
        assert.match(responseAttempt.message ?? '', /retry reschedule response/i,
          `contended response must tell its caller to retry: ${diagnostics}`);
        assert.ok(responseDurationMs < 2000,
          `contended response must fail promptly rather than wait on the booking: ${diagnostics}`);
        assert.deepEqual(stateWhileBookingFirstBlocked, before,
          `response contention must not change schedule, booking, dues, or occurrence ledger: ${diagnostics}`);
        assert.equal(responseNotificationsWhileBlocked.length, 0,
          `response contention must not enqueue a response notification: ${diagnostics}`);
        assert.equal(bookingFirstResult.value?.ok, true,
          `booking-first absence operation must finish after schedule release: ${diagnostics}`);
        assert.equal(afterBookingFirst.booking.status, 'cancelled',
          `booking-first absence operation must cancel its booking: ${diagnostics}`);
        assert.equal(afterBookingFirst.booking.scheduled_at, before.booking.scheduled_at,
          `booking-first cancellation must retain the original visit time: ${diagnostics}`);
        assert.equal(absenceChanges.length, 1,
          `booking-first operation must write its provider-absence change: ${diagnostics}`);
        assert.equal(absenceChanges[0]?.actor_id, fixture.manager,
          `provider-absence change must retain its actor identity: ${diagnostics}`);
        assert.equal(new Date(absenceChanges[0]?.original_at).toISOString(),
          new Date(before.booking.scheduled_at).toISOString(),
          `provider-absence change must retain the original occurrence time: ${diagnostics}`);
        assert.equal(outcomes.length, 0,
          `response contention must not write a rescheduled or declined outcome: ${diagnostics}`);
        assert.equal(responseNotificationsAfter.length, 0,
          `response contention must not enqueue a response notification after the booking-first commit: ${diagnostics}`);
        return {
          bookingFirstPid, responsePid, scheduleBarrier, responseAttempt, responseDurationMs,
          stateWhileBookingFirstBlocked, bookingFirstResult, afterBookingFirst,
          responseNotificationsAfter,
        };
      } finally {
        if (responseTransactionOpen) await response.query('rollback').catch(() => undefined);
        if (bookingFirstTransactionOpen) await bookingFirst.query('rollback').catch(() => undefined);
        await response.query('reset role').catch(() => undefined);
      }
    });
  } finally {
    await context.withClient((client) => cleanupFixture(client, fixture));
  }
}

async function waitForResponseScheduleLock(observer, pid, blockerPid, responseResult, fixture, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastActivity = null;
  while (Date.now() < deadline) {
    lastActivity = (await observer.query(`
      select wait_event_type, wait_event, query, pg_blocking_pids(pid) blocking_pids
        from pg_stat_activity where pid = $1::int
    `, [pid])).rows[0] ?? null;
    const blockingPids = (lastActivity?.blocking_pids ?? []).map(Number);
    if (lastActivity?.wait_event_type === 'Lock'
        && blockingPids.includes(Number(blockerPid))
        && String(lastActivity.query).includes('respond_visit_reschedule')) {
      return lastActivity;
    }
    if (responseResult.settled) {
      throw new Error(`response completed before the schedule-lock barrier: ${JSON.stringify({
        pid, blockerPid, lastActivity, response: responseResult.value, fixture,
      })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`response did not reach the schedule-lock barrier: ${JSON.stringify({
    pid, blockerPid, lastActivity, response: responseResult.value, fixture,
  })}`);
}

async function runPauseResponseRace(context) {
  const fixture = await context.withClient((client) => createFixture(client, 'pause-response'));
  try {
    return await context.withTwoClients(async (first, second) => {
      const firstPid = Number((await first.query('select pg_backend_pid() pid')).rows[0].pid);
      const secondPid = Number((await second.query('select pg_backend_pid() pid')).rows[0].pid);
      assert.notEqual(firstPid, secondPid,
        `pause/response race requires independent PostgreSQL backends: ${JSON.stringify({ firstPid, secondPid, fixture })}`);

      const before = await state(first, fixture.booking);
      const initialPlanStatus = (await first.query(
        `select status from recurring_schedules where id = $1::uuid`,
        [fixture.schedule],
      )).rows[0]?.status;
      let firstTransactionOpen = false;
      let responseResult = { settled: false, value: null };
      let responsePromise = null;
      let barrier = null;
      let barrierError = null;
      let pauseResult = null;
      let pausedPlanStatus = null;
      let pausedVisitState = null;
      let afterResponse = null;
      let planStatusAfterResponse = null;

      try {
        await first.query(`set statement_timeout = '15000ms'`);
        await second.query(`set statement_timeout = '15000ms'`);
        await first.query('begin');
        firstTransactionOpen = true;
        await first.query(
          `select id from recurring_schedules where id = $1::uuid for update`,
          [fixture.schedule],
        );

        responsePromise = as(
          second,
          fixture.manager,
          `select respond_visit_reschedule($1::uuid, true)`,
          [fixture.change],
        ).then(
          (result) => {
            Object.assign(responseResult, { settled: true, value: { ok: true, rows: result.rows } });
            return responseResult;
          },
          (error) => {
            Object.assign(responseResult, {
              settled: true,
              value: { ok: false, error: { code: error?.code ?? null, message: error?.message ?? String(error) } },
            });
            return responseResult;
          },
        );

        try {
          barrier = await waitForResponseScheduleLock(first, secondPid, firstPid, responseResult, fixture);
        } catch (error) {
          barrierError = error?.message ?? String(error);
        }

        if (!barrierError) {
          try {
            await first.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [fixture.customer]);
            await first.query('set role authenticated');
            const pause = await first.query(
              `select pause_recurring_plan($1::uuid, null::date) result`,
              [fixture.schedule],
            );
            pauseResult = { ok: true, rows: pause.rows };
            await first.query('reset role');
            pausedPlanStatus = (await first.query(
              `select status from recurring_schedules where id = $1::uuid`,
              [fixture.schedule],
            )).rows[0]?.status;
            pausedVisitState = await state(first, fixture.booking);
            await first.query('commit');
            firstTransactionOpen = false;
          } catch (error) {
            pauseResult = {
              ok: false,
              error: { code: error?.code ?? null, message: error?.message ?? String(error) },
            };
            if (firstTransactionOpen) {
              await first.query('rollback').catch(() => undefined);
              firstTransactionOpen = false;
            }
          }
        } else if (firstTransactionOpen) {
          await first.query('rollback');
          firstTransactionOpen = false;
        }

        let responseTimeout;
        if (responsePromise) {
          const completedResponse = await Promise.race([
            responsePromise,
            new Promise((resolve) => {
              responseTimeout = setTimeout(() => resolve(null), 20000);
            }),
          ]);
          clearTimeout(responseTimeout);
          if (completedResponse) responseResult = completedResponse;
        }
        afterResponse = await state(first, fixture.booking);
        planStatusAfterResponse = (await first.query(
          `select status from recurring_schedules where id = $1::uuid`,
          [fixture.schedule],
        )).rows[0]?.status;

        const outcomes = afterResponse.ledger.filter((row) => ['rescheduled', 'reschedule_declined'].includes(row.kind));
        const diagnostics = JSON.stringify({
          firstPid, secondPid, fixture, initialPlanStatus, before, barrier, barrierError,
          pauseResult, pausedPlanStatus, pausedVisitState, response: responseResult.value,
          afterResponse, planStatusAfterResponse, outcomes,
        });
        assert.equal(initialPlanStatus, 'active', `pause-race fixture must begin active: ${diagnostics}`);
        assert.equal(barrierError, null, `response must block on the held schedule before pause: ${diagnostics}`);
        assert.equal(pauseResult?.ok, true, `plan pause must complete without a deadlock: ${diagnostics}`);
        assert.equal(pausedPlanStatus, 'paused', `pause must end the plan before response resumes: ${diagnostics}`);
        assert.equal(pausedVisitState?.booking?.status, 'cancelled',
          `pause must cancel the pending visit before response resumes: ${diagnostics}`);
        assert.equal(responseResult.value?.ok, false, `stale Accept must be rejected after pause: ${diagnostics}`);
        assert.match(responseResult.value?.error?.message ?? '', /visit can no longer be rescheduled/i,
          `response must reject the cancelled visit: ${diagnostics}`);
        assert.equal(afterResponse.booking.status, 'cancelled',
          `the ended visit must remain cancelled and unschedulable: ${diagnostics}`);
        assert.equal(afterResponse.booking.scheduled_at, before.booking.scheduled_at,
          `response must preserve the ended visit's original schedule: ${diagnostics}`);
        assert.equal(outcomes.length, 0,
          `response must not append a rescheduled outcome for the ended visit: ${diagnostics}`);
        assert.deepEqual(afterResponse, pausedVisitState,
          `response must leave the paused/cancelled booking, dues, and ledger unchanged: ${diagnostics}`);
        return {
          firstPid, secondPid, barrier, pauseResult, pausedPlanStatus, pausedVisitState,
          response: responseResult.value, afterResponse, planStatusAfterResponse,
        };
      } finally {
        if (firstTransactionOpen) await first.query('rollback').catch(() => undefined);
        await second.query('reset role').catch(() => undefined);
      }
    });
  } finally {
    await context.withClient((client) => cleanupFixture(client, fixture));
  }
}

export async function run(context) {
  const originalFlags = await context.withClient(async (client) => (await client.query(`
    select key, enabled from feature_flags
     where key in ('recurring_bookings', 'recurring_reschedule', 'recurring_skip_pause', 'merchant_staff')
  `)).rows);
  const originalArchetypeFlags = await context.withClient(async (client) => (await client.query(`
    select value from app_config where key = 'archetype_flags'
  `)).rows[0]?.value);
  const failures = [];
  try {
    await context.withClient((client) => client.query(`
      update app_config
         set value = value || '{"time_based":true,"fixed":true}'::jsonb
       where key = 'archetype_flags'
    `));
    for (const status of ['cancelled', 'expired', 'in_progress']) {
      try {
        await runRace(context, status);
        console.log(`PASS SV-RESCHEDULE-RACE-04 ${status}: independent PostgreSQL backends overlapped at the booking row lock`);
      } catch (error) {
        failures.push(`${status}: ${error?.message ?? error}`);
        console.error(`FAIL SV-RESCHEDULE-RACE-04 ${status}: ${error?.message ?? error}`);
      }
    }
    try {
      const race = await runPauseResponseRace(context);
      console.log(`PASS SV-RESCHEDULE-PAUSE-RACE-05: ${JSON.stringify(race)}`);
    } catch (error) {
      failures.push(`pause-response: ${error?.message ?? error}`);
      console.error(`FAIL SV-RESCHEDULE-PAUSE-RACE-05: ${error?.message ?? error}`);
    }
    try {
      const race = await runBookingFirstResponseContention(context);
      console.log(`PASS SV-RESCHEDULE-BOOKING-FIRST-RACE-06: ${JSON.stringify(race)}`);
    } catch (error) {
      failures.push(`booking-first-response: ${error?.message ?? error}`);
      console.error(`FAIL SV-RESCHEDULE-BOOKING-FIRST-RACE-06: ${error?.message ?? error}`);
    }
  } finally {
    await context.withClient(async (client) => {
      for (const flag of originalFlags) {
        await client.query(`update feature_flags set enabled = $2::boolean where key = $1::text`, [flag.key, flag.enabled]);
      }
      if (originalArchetypeFlags !== undefined) {
        await client.query(`update app_config set value = $1::jsonb where key = 'archetype_flags'`, [
          JSON.stringify(originalArchetypeFlags),
        ]);
      }
    });
  }
  assert.equal(failures.length, 0, `PostgreSQL race failures: ${JSON.stringify(failures)}`);
}

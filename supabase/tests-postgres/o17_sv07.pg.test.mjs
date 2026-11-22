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
     where key in ('recurring_bookings', 'recurring_reschedule', 'merchant_staff')
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

async function waitForResponseLock(observer, pid, blockerPid, responseResult, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastActivity = null;
  while (Date.now() < deadline) {
    lastActivity = (await observer.query(`
      select wait_event_type, wait_event, query, pg_blocking_pids(pid) blocking_pids
        from pg_stat_activity where pid = $1::int
    `, [pid])).rows[0];
    const blockingPids = (lastActivity?.blocking_pids ?? []).map(Number);
    if (lastActivity?.wait_event_type === 'Lock'
        && blockingPids.includes(Number(blockerPid))
        && String(lastActivity.query).includes('respond_visit_reschedule')) {
      return lastActivity;
    }
    if (responseResult.settled) {
      throw new Error(`response finished before the row-lock barrier: ${JSON.stringify({ response: responseResult.value, activity })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`response did not reach the booking row-lock barrier: ${JSON.stringify({ pid, blockerPid, lastActivity, response: responseResult.value })}`);
}

async function runRace(context, status) {
  const startAccepted = status === 'in_progress';
  const fixture = await context.withClient((client) => createFixture(client, `race-${status}`, startAccepted));
  try {
    await context.withTwoClients(async (first, second) => {
      const firstPid = Number((await first.query('select pg_backend_pid() pid')).rows[0].pid);
      const secondPid = Number((await second.query('select pg_backend_pid() pid')).rows[0].pid);
      assert.notEqual(firstPid, secondPid, `race requires independent backends: ${JSON.stringify({ firstPid, secondPid })}`);

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
            Object.assign(responseResult, { settled: true, value: { message: error?.message ?? String(error) } });
            return responseResult;
          },
        );
        const wait = await waitForResponseLock(first, secondPid, firstPid, responseResult);
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
        const response = await responsePromise;
        const afterResponse = await state(first, fixture.booking);
        const outcomes = afterResponse.ledger.filter((row) => ['rescheduled', 'reschedule_declined'].includes(row.kind));
        assert.match(
          response.value?.message ?? '',
          /visit can no longer be rescheduled/i,
          `blocked response must re-read the transitioned row: ${JSON.stringify({ status, response, wait })}`,
        );
        assert.deepEqual(
          afterResponse,
          afterTransition,
          `response must preserve transitioned booking, dues, and ledger: ${JSON.stringify({ status, afterTransition, afterResponse })}`,
        );
        assert.equal(
          outcomes.length,
          0,
          `response must not append a reschedule outcome: ${JSON.stringify({ status, outcomes, afterResponse })}`,
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

export async function run(context) {
  const originalFlags = await context.withClient(async (client) => (await client.query(`
    select key, enabled from feature_flags
     where key in ('recurring_bookings', 'recurring_reschedule', 'merchant_staff')
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

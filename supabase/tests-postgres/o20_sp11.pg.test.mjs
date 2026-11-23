import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const fixedDay = '2026-12-15';

async function setAuthenticated(client, uid) {
  await client.query(
    `select set_config('request.jwt.claim.sub', $1::text, false)`,
    [uid ?? ''],
  );
  await client.query('set role authenticated');
}

async function startsAt(client, time) {
  return (await client.query(`
    select ($1::date + $2::time) at time zone 'Asia/Kolkata' as starts_at
  `, [fixedDay, time])).rows[0].starts_at;
}

async function createFixture(client) {
  const ownerId = randomUUID();
  const customerIds = Array.from({ length: 4 }, () => randomUUID());
  const userIds = [ownerId, ...customerIds];
  await client.query(
    `insert into auth.users (id) select users.user_id from unnest($1::uuid[]) as users(user_id)`,
    [userIds],
  );
  const activityId = (await client.query(`
    select a.id from public.sports_activities as a where a.slug = 'badminton'::text
  `)).rows[0]?.id;
  assert.ok(activityId, `sports activity fixture missing: ${JSON.stringify({ activityId })}`);

  const venueId = (await client.query(`
    insert into public.sports_venues (
      owner_id, name, description, address_line, city, area, lat, lng,
      status, payment_modes, cancellation_rules
    ) values (
      $1::uuid, $2::text, 'SP11 private integration venue'::text, 'SP11 test street'::text,
      'Sangareddy'::text, 'Center'::text, 16.5::double precision, 80.6::double precision,
      'verified'::text, array['pay_at_venue']::text[], '{}'::jsonb
    )
    returning id
  `, [ownerId, `O20-SP11 ${randomUUID()}`])).rows[0].id;
  const suffix = randomUUID().replaceAll('-', '');
  await client.query(`
    insert into public.provider_payout_accounts
      (provider_id, rail, activation_status, razorpay_account_id, fund_account_id)
    values ($1::uuid, 'payouts'::text, 'activated'::text, $2::text, $3::text)
  `, [ownerId, `acc_${suffix}`, `fa_${suffix}`]);
  await client.query(`
    insert into public.sports_hours (venue_id, weekday, opens, closes)
    select $1::uuid, day::smallint, time '08:00', time '20:00'
      from generate_series(0, 6) as day
  `, [venueId]);
  const resourceId = (await client.query(`
    insert into public.sports_resources (
      venue_id, activity_id, name, slot_minutes, active, booking_mode, capacity
    ) values ($1::uuid, $2::uuid, 'SP11 adjacent slots'::text,
      60::int, true, 'approval'::text, 2::int)
    returning id
  `, [venueId, activityId])).rows[0].id;
  await client.query(`
    insert into public.sports_price_rules (resource_id, weekday, starts, ends, price_paise)
    values ($1::uuid, null::smallint, time '08:00', time '20:00', 20000::int)
  `, [resourceId]);

  const seedIds = [];
  for (const [index, time] of ['10:00', '11:00'].entries()) {
    const start = await startsAt(client, time);
    const seed = await client.query(`
      insert into public.sports_bookings (
        customer_id, venue_id, resource_id, starts_at, ends_at, status, price_paise,
        note, expires_at, payment_mode, participants, total_paise
      ) values (
        $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $4::timestamptz + interval '1 hour',
        'accepted'::text, 20000::int, ''::text, now() + interval '1 hour',
        'pay_at_venue'::text, 1::int, 20000::int
      )
      returning id
    `, [customerIds[index], venueId, resourceId, start]);
    seedIds.push(seed.rows[0].id);
  }
  return {
    ownerId, customerIds, userIds, venueId, resourceId, seedIds, capacity: 2,
    start: await startsAt(client, '10:00'),
  };
}

async function saveAndEnableSettings(client) {
  const flags = (await client.query(`
    select f.key, f.enabled
      from public.feature_flags as f
     where f.key = any(array['sports', 'sports_multi_slot']::text[])
     order by f.key
  `)).rows;
  assert.equal(flags.length, 2, `expected both sports flags: ${JSON.stringify({ flags })}`);
  const rules = (await client.query(`
    select c.value from public.app_config as c where c.key = 'sports_rules'::text
  `)).rows[0]?.value;
  assert.ok(rules, `sports_rules config missing: ${JSON.stringify({ rules })}`);

  await client.query(`
    update public.feature_flags as f set enabled = true
     where f.key = any(array['sports', 'sports_multi_slot']::text[])
  `);
  await client.query(`
    update public.app_config as c
       set value = c.value || '{"max_active_holds_per_customer":10}'::jsonb
     where c.key = 'sports_rules'::text
  `);
  return { flags, rules };
}

async function restoreSettings(client, settings) {
  for (const flag of settings.flags) {
    await client.query(`
      update public.feature_flags as f set enabled = $2::boolean where f.key = $1::text
    `, [flag.key, flag.enabled]);
  }
  await client.query(`
    update public.app_config as c set value = $1::jsonb where c.key = 'sports_rules'::text
  `, [JSON.stringify(settings.rules)]);
}

async function cleanupFixture(client, fixture) {
  await client.query('begin');
  try {
    await client.query(`
      delete from public.notifications as n
       where n.user_id = $1::uuid
         and n.kind = 'sports_booking_requested'::text
         and n.data ->> 'sports_booking_id' in (
           select b.id::text from public.sports_bookings as b
            where b.resource_id = $2::uuid
         )
    `, [fixture.ownerId, fixture.resourceId]);
    await client.query(
      `delete from public.sports_bookings as b where b.resource_id = $1::uuid`,
      [fixture.resourceId],
    );
    await client.query(
      `delete from public.sports_price_rules as r where r.resource_id = $1::uuid`,
      [fixture.resourceId],
    );
    await client.query(
      `delete from public.sports_resources as r where r.id = $1::uuid`,
      [fixture.resourceId],
    );
    await client.query(
      `delete from public.sports_hours as h where h.venue_id = $1::uuid`,
      [fixture.venueId],
    );
    await client.query(
      `delete from public.provider_payout_accounts as p where p.provider_id = $1::uuid`,
      [fixture.ownerId],
    );
    await client.query(
      `delete from public.sports_venues as v where v.id = $1::uuid`,
      [fixture.venueId],
    );
    await client.query(`delete from auth.users as u where u.id = any($1::uuid[])`, [fixture.userIds]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function waitForAdvisoryLock(observer, pid, blockerPid, operation, fixture, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastActivity = null;
  while (Date.now() < deadline) {
    lastActivity = (await observer.query(`
      select wait_event_type, wait_event, query, pg_blocking_pids(pid) as blocking_pids
        from pg_stat_activity
       where pid = $1::int
    `, [pid])).rows[0] ?? null;
    const blockingPids = (lastActivity?.blocking_pids ?? []).map(Number);
    if (
      lastActivity?.wait_event_type === 'Lock'
      && lastActivity?.wait_event === 'advisory'
      && blockingPids.includes(Number(blockerPid))
      && String(lastActivity.query).includes('request_sports_slot')
    ) {
      return lastActivity;
    }
    if (operation.settled) {
      throw new Error(`second request completed before observing the function advisory lock: ${JSON.stringify({
        pid, blockerPid, lastActivity, operation: operation.value, fixture,
      })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`second request did not reach the function advisory lock: ${JSON.stringify({
    pid, blockerPid, lastActivity, operation: operation.value, fixture,
  })}`);
}

async function slotOccupancy(client, fixture) {
  return (await client.query(`
    select requested.slot_index::int as slot_index, slot.slot_start,
           coalesce(sum(b.participants), 0)::int as occupied,
           coalesce(jsonb_agg(jsonb_build_object(
             'id', b.id, 'customer_id', b.customer_id, 'participants', b.participants,
             'status', b.status::text, 'starts_at', b.starts_at, 'ends_at', b.ends_at
           ) order by b.starts_at, b.id) filter (where b.id is not null), '[]'::jsonb) as booking_rows
      from generate_series(0, 1) as requested(slot_index)
      cross join lateral (
        select $2::timestamptz
          + make_interval(mins => 60::int * requested.slot_index) as slot_start
      ) as slot
      left join public.sports_bookings as b
        on b.resource_id = $1::uuid
       and b.starts_at < slot.slot_start + interval '60 minutes'
       and b.ends_at > slot.slot_start
       and (
         b.status = 'accepted'
         or (b.status = 'requested' and b.expires_at > now())
         or (b.status = 'awaiting_payment' and b.pay_by > now())
         or (b.status = 'pending_payment' and b.hold_expires_at > now())
       )
     group by requested.slot_index, slot.slot_start
     order by requested.slot_index
  `, [fixture.resourceId, fixture.start])).rows;
}

export async function run(context) {
  let settings;
  let fixture;
  await context.withClient(async (client) => {
    await client.query('begin');
    try {
      settings = await saveAndEnableSettings(client);
      fixture = await createFixture(client);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    }
  });

  try {
    await context.withTwoClients(async (first, second) => {
      const firstPid = Number((await first.query('select pg_backend_pid() as pid')).rows[0].pid);
      const secondPid = Number((await second.query('select pg_backend_pid() as pid')).rows[0].pid);
      const diagnostics = { firstPid, secondPid, fixture };
      assert.notEqual(firstPid, secondPid,
        `race requires two independent PostgreSQL backends: ${JSON.stringify(diagnostics)}`);
      await first.query(`set statement_timeout = '15000ms'`);
      await second.query(`set statement_timeout = '15000ms'`);
      await setAuthenticated(first, fixture.customerIds[2]);
      await setAuthenticated(second, fixture.customerIds[3]);
      await first.query('begin');
      let firstTransactionOpen = true;
      let secondResult = { settled: false, value: null };
      try {
        await first.query('savepoint o20_sp11_request');
        let firstRequest;
        try {
          firstRequest = await first.query(`
            select public.request_sports_slot(
              $1::uuid, $2::timestamptz, 2::int, 'SP11 first concurrent request'::text
            ) as id
          `, [fixture.resourceId, fixture.start]);
          await first.query('release savepoint o20_sp11_request');
        } catch (error) {
          await first.query('rollback to savepoint o20_sp11_request');
          await first.query('release savepoint o20_sp11_request');
          throw error;
        }
        const firstBookingId = firstRequest.rows[0]?.id;
        await first.query('reset role');
        const secondPromise = second.query(`
          select public.request_sports_slot(
            $1::uuid, $2::timestamptz, 2::int, 'SP11 competing concurrent request'::text
          ) as id
        `, [fixture.resourceId, fixture.start]).then(
          (result) => {
            Object.assign(secondResult, { settled: true, value: { ok: true, rows: result.rows } });
            return secondResult;
          },
          (error) => {
            Object.assign(secondResult, {
              settled: true,
              value: {
                ok: false,
                code: error?.code ?? null,
                message: error?.message ?? String(error),
              },
            });
            return secondResult;
          },
        );
        const lockBarrier = await waitForAdvisoryLock(
          first, secondPid, firstPid, secondResult, fixture,
        );
        await first.query('commit');
        firstTransactionOpen = false;
        const completedSecond = await secondPromise;
        const occupancy = await slotOccupancy(first, fixture);
        const bookingRows = (await first.query(`
          select b.id, b.customer_id, b.starts_at, b.ends_at, b.status::text as status,
                 b.payment_mode::text as payment_mode, b.participants, b.price_paise, b.total_paise
            from public.sports_bookings as b
           where b.resource_id = $1::uuid
           order by b.starts_at, b.id
        `, [fixture.resourceId])).rows;
        const competingRows = bookingRows.filter((row) => row.customer_id === fixture.customerIds[3]);
        const notificationRows = (await first.query(`
          select n.id, n.user_id, n.kind, n.data
            from public.notifications as n
           where n.user_id = $1::uuid
             and n.kind = 'sports_booking_requested'::text
        `, [fixture.ownerId])).rows;
        const paymentRows = (await first.query(`
          select p.id, p.sports_booking_id, p.amount, p.status::text as status
            from public.payments as p
            join public.sports_bookings as b on b.id = p.sports_booking_id
           where b.resource_id = $1::uuid
        `, [fixture.resourceId])).rows;
        const actual = {
          firstRequest: firstRequest.rows,
          lockBarrier,
          second: completedSecond.value,
          occupancy,
          bookingRows,
          competingRows,
          notificationRows,
          paymentRows,
        };
        const expected = {
          independentBackends: true,
          secondWaitedOnResourceAdvisoryLock: true,
          secondError: 'slot is no longer available',
          capacity: fixture.capacity,
          occupancy: [2, 2],
          bookingCount: 3,
          competingRequestRows: 0,
          notificationCount: 1,
          paymentCount: 0,
        };

        assert.ok(firstBookingId,
          `first serialized request must succeed: ${JSON.stringify({ expected, actual, fixture })}`);
        assert.equal(lockBarrier.wait_event_type, 'Lock',
          `competing request must wait on a PostgreSQL lock: ${JSON.stringify({ expected, actual, fixture })}`);
        assert.equal(lockBarrier.wait_event, 'advisory',
          `competing request must wait on the function resource advisory lock: ${JSON.stringify({ expected, actual, fixture })}`);
        assert.ok(lockBarrier.blocking_pids.map(Number).includes(firstPid),
          `resource advisory lock must be held by the first request backend: ${JSON.stringify({ expected, actual, fixture })}`);
        assert.equal(completedSecond.value?.ok, false,
          `second request must be refused after the first commits: ${JSON.stringify({ expected, actual, fixture })}`);
        assert.match(completedSecond.value?.message ?? '', /slot is no longer available/,
          `second request must fail at the live capacity check, not deadlock: ${JSON.stringify({ expected, actual, fixture })}`);
        assert.notEqual(completedSecond.value?.code, '40P01',
          `concurrent requests must not deadlock: ${JSON.stringify({ expected, actual, fixture })}`);
        assert.deepEqual(occupancy.map((slot) => slot.occupied), expected.occupancy,
          `committed per-slot occupancy must not exceed capacity: ${JSON.stringify({ expected, actual, fixture })}`);
        assert.ok(occupancy.every((slot) => slot.occupied <= fixture.capacity),
          `no committed slot may exceed resource capacity: ${JSON.stringify({ expected, actual, fixture })}`);
        assert.equal(bookingRows.length, expected.bookingCount,
          `only the two seeds and first request may persist: ${JSON.stringify({ expected, actual, fixture })}`);
        assert.equal(competingRows.length, expected.competingRequestRows,
          `refused request must leave no partial booking row: ${JSON.stringify({ expected, actual, fixture })}`);
        assert.equal(notificationRows.length, expected.notificationCount,
          `refused request must leave no partial notification: ${JSON.stringify({ expected, actual, fixture })}`);
        assert.equal(paymentRows.length, expected.paymentCount,
          `legacy request must not create partial payment rows: ${JSON.stringify({ expected, actual, fixture })}`);
        console.log(`SP11 two-session lock race: ${JSON.stringify({
          firstPid, secondPid, firstBookingId, secondError: completedSecond.value,
          occupancy: occupancy.map((slot) => slot.occupied), bookingCount: bookingRows.length,
          competingRows: competingRows.length, notificationCount: notificationRows.length,
          paymentCount: paymentRows.length,
        })}`);
      } finally {
        if (firstTransactionOpen) await first.query('rollback').catch(() => undefined);
        await second.query('reset role').catch(() => undefined);
      }
    });
  } finally {
    await context.withClient(async (client) => {
      try {
        await cleanupFixture(client, fixture);
      } finally {
        await restoreSettings(client, settings);
      }
    });
  }
}

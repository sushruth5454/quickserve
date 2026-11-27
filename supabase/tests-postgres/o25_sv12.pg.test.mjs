import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setAuthenticated(client, uid) {
  await client.query('select set_config($1::text, $2::text, false)', ['request.jwt.claim.sub', uid]);
  await client.query('set role authenticated');
}

async function waitForLockWait(observer, pid, diagnostics) {
  const deadline = Date.now() + 5000;
  let activity = null;
  while (Date.now() < deadline) {
    activity = (await observer.query(`
      select a.state, a.wait_event_type, a.wait_event, a.query
        from pg_stat_activity as a
       where a.pid = $1::int
    `, [pid])).rows[0] ?? null;
    if (activity?.state === 'active' && activity.wait_event_type === 'Lock') return activity;
    await delay(20);
  }
  throw new Error(`accept_booking did not overlap the expiry lock barrier: ${JSON.stringify({ ...diagnostics, activity })}`);
}

function createFixtureState() {
  return {
    ownerId: randomUUID(),
    customerId: randomUUID(),
    categoryId: randomUUID(),
    serviceId: randomUUID(),
    addressId: randomUUID(),
    city: `SV12 ${randomUUID()} City`,
    originalArchetypeFlags: undefined,
    archetypeFlagsCaptured: false,
  };
}

async function createFixture(client, fixture) {
  const flagRow = (await client.query(`
    select c.value from public.app_config as c where c.key = 'archetype_flags'::text
  `)).rows[0];
  if (flagRow) {
    fixture.originalArchetypeFlags = flagRow.value;
    fixture.archetypeFlagsCaptured = true;
  }
  assert.ok(flagRow, `archetype_flags missing: ${JSON.stringify({ fixture })}`);
  await client.query(`
    update public.app_config as c
       set value = c.value || '{"time_based":true}'::jsonb
     where c.key = 'archetype_flags'::text
  `);
  await client.query(
    'insert into auth.users (id) values ($1::uuid), ($2::uuid)',
    [fixture.ownerId, fixture.customerId],
  );
  await client.query(`
    update public.profiles as p
       set full_name = case p.id
         when $1::uuid then 'SV12 private provider'::text
         when $2::uuid then 'SV12 private customer'::text
       end
     where p.id = any(array[$1::uuid, $2::uuid])
  `, [fixture.ownerId, fixture.customerId]);
  await client.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended
    ) values (
      $1::uuid, $2::text,
      extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified', now(), 'approved', true, false, false
    )
  `, [fixture.ownerId, fixture.city]);
  await client.query(`
    insert into public.categories (
      id, slug, name, pricing_mode, active, archetype, location_modes, pricing_units,
      min_lead_hours, max_lead_days, restricted
    ) values (
      $1::uuid, $2::text, 'SV12 private session'::text, 'quote'::public.pricing_mode,
      true, 'time_based'::text, array['at_customer']::text[],
      array['session']::text[], 0::int, 365::int, false
    )
  `, [fixture.categoryId, `sv12-${randomUUID().replace(/-/g, '')}`]);
  await client.query(`
    insert into public.category_cities (category_id, city, live, launched_at)
    values ($1::uuid, $2::text, true, now())
  `, [fixture.categoryId, fixture.city]);
  await client.query(`
    insert into public.provider_services (id, provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, $3::uuid, 0::int, 0::int, true)
  `, [fixture.serviceId, fixture.ownerId, fixture.categoryId]);
  await client.query(`
    insert into public.provider_availability (provider_id, weekday, start_time, end_time)
    select $1::uuid, day::int, time '00:00', time '23:59'
      from generate_series(0, 6) as days(day)
  `, [fixture.ownerId]);
  await client.query(`
    insert into public.addresses (id, user_id, label, line1, city, lat, lng)
    values (
      $1::uuid, $2::uuid, 'Home'::text, 'SV12 private street'::text, $3::text,
      16.50::double precision, 80.60::double precision
    )
  `, [fixture.addressId, fixture.customerId, fixture.city]);
}

async function createRecurringSchedule(client, fixture, scheduleId) {
  await client.query(`
    insert into public.recurring_schedules (
      id, customer_id, provider_id, provider_service_id, frequency, weekdays, start_time,
      session_duration_min, payment_mode, address_line, city, lat, lng, description, starts_on
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'weekly'::text, array[2]::smallint[], time '10:00',
      60::int, 'per_session'::text, 'SV12 recurring address'::text, $5::text,
      16.50::double precision, 80.60::double precision, 'SV12 recurring session'::text,
      date '2027-03-16'
    )
  `, [scheduleId, fixture.customerId, fixture.ownerId, fixture.serviceId, fixture.city]);
}

async function createRequestedBooking(client, fixture, bookingId, { scheduledAt, recurringScheduleId = null }) {
  await client.query(`
    insert into public.bookings (
      id, customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, service_window, status, visit_fee, platform_fee, total_amount,
      archetype, booking_origin, recurring_schedule_id, session_duration_min
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 'SV12 private request'::text,
      $7::timestamptz,
      tstzrange($7::timestamptz, $7::timestamptz + interval '1 hour', '[)'),
      'requested'::public.booking_status, 0::int, 0::int, 0::int, 'time_based'::text,
      'marketplace'::text, $8::uuid, 60::int
    )
  `, [
    bookingId, fixture.customerId, fixture.ownerId, fixture.categoryId, fixture.serviceId,
    fixture.addressId, scheduledAt, recurringScheduleId,
  ]);
}

async function cleanupFixture(client, fixture, bookingIds, scheduleIds) {
  const cleanupErrors = [];
  const attempt = async (step, query, params = []) => {
    try {
      await client.query(query, params);
    } catch (error) {
      cleanupErrors.push(new Error(`SV12 cleanup failed at ${step}: ${error?.message ?? error}`, { cause: error }));
    }
  };

  await attempt(
    'notifications',
    `
      delete from public.notifications as n
       where n.data ->> 'booking_id' = any($1::text[])
    `,
    [bookingIds],
  );
  await attempt(
    'bookings',
    'delete from public.bookings as b where b.id = any($1::uuid[])',
    [bookingIds],
  );
  await attempt(
    'recurring schedules',
    'delete from public.recurring_schedules as r where r.id = any($1::uuid[])',
    [scheduleIds],
  );
  await attempt('addresses', 'delete from public.addresses as a where a.id = $1::uuid', [fixture.addressId]);
  await attempt('provider availability', 'delete from public.provider_availability as pa where pa.provider_id = $1::uuid', [fixture.ownerId]);
  await attempt('provider services', 'delete from public.provider_services as ps where ps.id = $1::uuid', [fixture.serviceId]);
  await attempt('category cities', 'delete from public.category_cities as cc where cc.category_id = $1::uuid', [fixture.categoryId]);
  await attempt('categories', 'delete from public.categories as c where c.id = $1::uuid', [fixture.categoryId]);
  await attempt('provider', 'delete from public.providers as p where p.id = $1::uuid', [fixture.ownerId]);
  await attempt('auth users', 'delete from auth.users as u where u.id = any($1::uuid[])', [[fixture.ownerId, fixture.customerId]]);
  if (fixture.archetypeFlagsCaptured) {
    await attempt(
      'restore archetype_flags',
      'update public.app_config as c set value = $1::jsonb where c.key = $2::text',
      [JSON.stringify(fixture.originalArchetypeFlags), 'archetype_flags'],
    );
  }
  if (cleanupErrors.length > 0) {
    const details = cleanupErrors.map((error) => error.message).join('; ');
    throw new AggregateError(cleanupErrors, `SV12 fixture cleanup had ${cleanupErrors.length} error(s): ${details}`);
  }
}

async function withFixtureCleanup(context, fixture, bookingIds, scheduleIds, work) {
  let testFailure = null;
  try {
    await work();
  } catch (error) {
    testFailure = error;
  }

  let cleanupFailure = null;
  try {
    await context.withClient((client) => cleanupFixture(client, fixture, bookingIds, scheduleIds));
  } catch (error) {
    cleanupFailure = error;
  }

  if (testFailure && cleanupFailure) {
    throw new AggregateError(
      [testFailure, cleanupFailure],
      `SV12 test and fixture cleanup both failed: ${testFailure.message}; cleanup: ${cleanupFailure.message}`,
    );
  }
  if (testFailure) throw testFailure;
  if (cleanupFailure) throw cleanupFailure;
}

async function verifyPartialSetupCleanup(context) {
  const fixture = createFixtureState();
  const scheduleId = randomUUID();
  const bookingIds = [randomUUID()];
  const injectedMessage = 'SV12 injected setup failure after booking insert';
  let caught = null;

  try {
    await withFixtureCleanup(context, fixture, bookingIds, [scheduleId], async () => {
      await context.withClient(async (client) => {
        await createFixture(client, fixture);
        await createRecurringSchedule(client, fixture, scheduleId);
        await createRequestedBooking(client, fixture, bookingIds[0], {
          scheduledAt: '2027-04-20T10:00:00+05:30',
          recurringScheduleId: scheduleId,
        });
        throw new Error(injectedMessage);
      });
    });
  } catch (error) {
    caught = error;
  }

  assert.equal(
    caught?.message,
    injectedMessage,
    `partial setup failure must propagate after cleanup: ${JSON.stringify({ error: caught?.message ?? null })}`,
  );
  const actual = await context.withClient(async (client) => (await client.query(`
    select
      (select count(*)::int from auth.users as u where u.id = any($1::uuid[])) as user_count,
      (select count(*)::int from public.profiles as p where p.id = any($1::uuid[])) as profile_count,
      (select count(*)::int from public.providers as p where p.id = $2::uuid) as provider_count,
      (select count(*)::int from public.categories as c where c.id = $3::uuid) as category_count,
      (select count(*)::int from public.category_cities as cc where cc.category_id = $3::uuid) as category_city_count,
      (select count(*)::int from public.provider_services as ps where ps.id = $4::uuid) as service_count,
      (select count(*)::int from public.provider_availability as pa where pa.provider_id = $2::uuid) as availability_count,
      (select count(*)::int from public.addresses as a where a.id = $5::uuid) as address_count,
      (select count(*)::int from public.recurring_schedules as r where r.id = $6::uuid) as schedule_count,
      (select count(*)::int from public.bookings as b where b.id = any($7::uuid[])) as booking_count,
      (select count(*)::int from public.notifications as n where n.data ->> 'booking_id' = any($8::text[])) as notification_count,
      coalesce((
        select c.value = $9::jsonb from public.app_config as c
         where c.key = 'archetype_flags'::text
      ), false) as flags_restored
  `, [
    [fixture.ownerId, fixture.customerId],
    fixture.ownerId,
    fixture.categoryId,
    fixture.serviceId,
    fixture.addressId,
    scheduleId,
    bookingIds,
    bookingIds.map(String),
    JSON.stringify(fixture.originalArchetypeFlags),
  ])).rows[0]);
  const expected = {
    user_count: 0,
    profile_count: 0,
    provider_count: 0,
    category_count: 0,
    category_city_count: 0,
    service_count: 0,
    availability_count: 0,
    address_count: 0,
    schedule_count: 0,
    booking_count: 0,
    notification_count: 0,
    flags_restored: true,
  };
  assert.deepEqual(
    actual,
    expected,
    `partial setup cleanup must remove every fixture row and restore app_config: ${JSON.stringify(actual)}`,
  );
}

export async function run(context) {
  await verifyPartialSetupCleanup(context);
  const fixture = createFixtureState();
  const scheduleId = randomUUID();
  const bookingIds = [randomUUID(), randomUUID()];
  await withFixtureCleanup(context, fixture, bookingIds, [scheduleId], async () => {
    await context.withClient(async (client) => {
      await createFixture(client, fixture);
      await createRecurringSchedule(client, fixture, scheduleId);
      await createRequestedBooking(client, fixture, bookingIds[0], {
        scheduledAt: '2027-03-16T10:00:00+05:30',
      });
      await createRequestedBooking(client, fixture, bookingIds[1], {
        scheduledAt: '2027-03-23T10:00:00+05:30',
        recurringScheduleId: scheduleId,
      });
      await client.query(`
        update public.bookings as b
           set updated_at = statement_timestamp() - interval '15 minutes'
         where b.id = $1::uuid
      `, [bookingIds[0]]);
      await client.query(`
        update public.bookings as b
           set updated_at = statement_timestamp() - interval '45 minutes'
         where b.id = $1::uuid
      `, [bookingIds[1]]);
    });

    await context.withTwoClients(async (first, second) => {
      const firstPid = Number((await first.query('select pg_backend_pid() as pid')).rows[0]?.pid);
      const secondPid = Number((await second.query('select pg_backend_pid() as pid')).rows[0]?.pid);
      const diagnostics = { firstPid, secondPid, bookingIds };
      assert(Number.isInteger(firstPid) && Number.isInteger(secondPid),
        `race requires both backend PIDs: ${JSON.stringify(diagnostics)}`);
      assert.notEqual(firstPid, secondPid,
        `race requires two independent PostgreSQL backends: ${JSON.stringify(diagnostics)}`);

      await first.query('begin');
      let transactionOpen = true;
      let raceFailure = null;
      try {
        await first.query(
          'select b.id from public.bookings as b where b.id = $1::uuid for update',
          [bookingIds[0]],
        );
        await setAuthenticated(second, fixture.ownerId);
        const acceptPromise = second.query(
          'select public.accept_booking($1::uuid)',
          [bookingIds[0]],
        ).then(
          (result) => ({ ok: true, rows: result.rows }),
          (error) => ({ ok: false, code: error?.code ?? null, message: error?.message ?? String(error) }),
        );
        const barrier = await waitForLockWait(first, secondPid, diagnostics);
        const otherExpiredRequests = (await first.query(`
          select b.id::text as booking_id
            from public.bookings as b
           where b.status = 'requested'::public.booking_status
             and b.recurring_schedule_id is null
             and b.updated_at < now() - interval '15 minutes'
             and b.id <> $1::uuid
        `, [bookingIds[0]])).rows;
        assert(
          otherExpiredRequests.length === 0,
          `private expiry race must not mutate another request: ${JSON.stringify({ ...diagnostics, otherExpiredRequests })}`,
        );
        const expiry = (await first.query('select public.expire_stale_requests() as expired_count')).rows[0];
        await first.query('commit');
        transactionOpen = false;
        const acceptance = await acceptPromise;
        const expiredBooking = (await first.query(`
          select b.id::text as booking_id, b.status::text as status
            from public.bookings as b where b.id = $1::uuid
        `, [bookingIds[0]])).rows[0];
        const actual = { ...diagnostics, barrier, expiry, acceptance, expiredBooking };
        assert(
          Number(expiry?.expired_count) === 1
            && acceptance.ok === false
            && expiredBooking?.booking_id === bookingIds[0]
            && expiredBooking.status === 'expired',
          `at the ordinary response deadline, expiry wins the locked race and acceptance observes the terminal row: ${JSON.stringify(actual)}`,
        );

        await setAuthenticated(first, fixture.ownerId);
        await first.query('select public.accept_booking($1::uuid)', [bookingIds[1]]);
        await first.query('reset role');
        const recurringBooking = (await first.query(`
          select b.id::text as booking_id, b.status::text as status,
                 b.recurring_schedule_id::text as recurring_schedule_id
            from public.bookings as b where b.id = $1::uuid
        `, [bookingIds[1]])).rows[0];
        assert(
          recurringBooking?.booking_id === bookingIds[1]
            && recurringBooking.status === 'accepted'
            && recurringBooking.recurring_schedule_id === scheduleId,
          `an old recurring occurrence remains exempt from the ordinary 15-minute response deadline: ${JSON.stringify({
            diagnostics, recurringBooking,
          })}`,
        );
      } catch (error) {
        raceFailure = error;
      }

      let rollbackFailure = null;
      if (transactionOpen) {
        try {
          await first.query('rollback');
        } catch (error) {
          rollbackFailure = error;
        }
      }
      if (raceFailure && rollbackFailure) {
        throw new AggregateError(
          [raceFailure, rollbackFailure],
          `SV12 race and rollback both failed: ${raceFailure.message}; rollback: ${rollbackFailure.message}`,
        );
      }
      if (raceFailure) throw raceFailure;
      if (rollbackFailure) throw rollbackFailure;
    });
  });
}

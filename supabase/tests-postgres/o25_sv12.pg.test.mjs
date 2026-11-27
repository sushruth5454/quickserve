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

async function createFixture(client) {
  const ownerId = randomUUID();
  const customerId = randomUUID();
  await client.query(
    'insert into auth.users (id) values ($1::uuid), ($2::uuid)',
    [ownerId, customerId],
  );
  await client.query(`
    update public.profiles as p
       set full_name = case p.id
         when $1::uuid then 'SV12 private provider'::text
         when $2::uuid then 'SV12 private customer'::text
       end
     where p.id = any(array[$1::uuid, $2::uuid])
  `, [ownerId, customerId]);
  await client.query(`
    insert into public.providers (
      id, city, base_location, kyc_status, submitted_at, admin_review_status,
      is_online, paused, suspended
    ) values (
      $1::uuid, $2::text,
      extensions.st_setsrid(extensions.st_makepoint(80.60, 16.50), 4326),
      'verified'::text, now(), 'approved'::text, true, false, false
    )
  `, [ownerId, `SV12 ${randomUUID()} City`]);
  const categoryId = (await client.query(`
    insert into public.categories (
      slug, name, pricing_mode, active, archetype, location_modes, pricing_units,
      min_lead_hours, max_lead_days, restricted
    ) values (
      $1::text, 'SV12 private session'::text, 'quote'::public.pricing_mode,
      true, 'time_based'::text, array['at_customer']::text[],
      array['session']::text[], 0::int, 365::int, false
    )
    returning id
  `, [`sv12-${randomUUID().replace(/-/g, '')}`])).rows[0].id;
  const serviceId = (await client.query(`
    insert into public.provider_services (provider_id, category_id, visit_fee, labour_rate, active)
    values ($1::uuid, $2::uuid, 0::int, 0::int, true)
    returning id
  `, [ownerId, categoryId])).rows[0].id;
  const addressId = (await client.query(`
    insert into public.addresses (user_id, label, line1, city, lat, lng)
    values (
      $1::uuid, 'Home'::text, 'SV12 private street'::text, 'Private City'::text,
      16.50::double precision, 80.60::double precision
    )
    returning id
  `, [customerId])).rows[0].id;
  return { ownerId, customerId, categoryId, serviceId, addressId };
}

async function createRecurringSchedule(client, fixture) {
  return (await client.query(`
    insert into public.recurring_schedules (
      customer_id, provider_id, provider_service_id, frequency, weekdays, start_time,
      session_duration_min, payment_mode, address_line, city, lat, lng, description, starts_on
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'weekly'::text, array[2]::smallint[], time '10:00',
      60::int, 'per_session'::text, 'SV12 recurring address'::text, 'Private City'::text,
      16.50::double precision, 80.60::double precision, 'SV12 recurring session'::text,
      date '2027-03-16'
    )
    returning id
  `, [fixture.customerId, fixture.ownerId, fixture.serviceId])).rows[0].id;
}

async function createRequestedBooking(client, fixture, { scheduledAt, recurringScheduleId = null }) {
  return (await client.query(`
    insert into public.bookings (
      customer_id, provider_id, category_id, provider_service_id, address_id,
      description, scheduled_at, service_window, status, visit_fee, platform_fee, total_amount,
      archetype, booking_origin, recurring_schedule_id, session_duration_min
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'SV12 private request'::text,
      $6::timestamptz,
      tstzrange($6::timestamptz, $6::timestamptz + interval '1 hour', '[)'),
      'requested'::public.booking_status, 0::int, 0::int, 0::int, 'time_based'::text,
      'marketplace'::text, $7::uuid, 60::int
    )
    returning id
  `, [
    fixture.customerId, fixture.ownerId, fixture.categoryId, fixture.serviceId,
    fixture.addressId, scheduledAt, recurringScheduleId,
  ])).rows[0].id;
}

async function cleanupFixture(client, fixture, bookingIds, scheduleId) {
  await client.query('begin');
  try {
    await client.query(`
      delete from public.notifications as n
       where n.data ->> 'booking_id' = any($1::text[])
    `, [bookingIds]);
    await client.query(
      'delete from public.bookings as b where b.id = any($1::uuid[])',
      [bookingIds],
    );
    await client.query(
      'delete from public.recurring_schedules as r where r.id = $1::uuid',
      [scheduleId],
    );
    await client.query('delete from public.addresses as a where a.id = $1::uuid', [fixture.addressId]);
    await client.query('delete from public.provider_services as ps where ps.id = $1::uuid', [fixture.serviceId]);
    await client.query('delete from public.categories as c where c.id = $1::uuid', [fixture.categoryId]);
    await client.query('delete from public.providers as p where p.id = $1::uuid', [fixture.ownerId]);
    await client.query(
      'delete from auth.users as u where u.id = any($1::uuid[])',
      [[fixture.ownerId, fixture.customerId]],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

export async function run(context) {
  let fixture;
  let scheduleId;
  const bookingIds = [];
  try {
    await context.withClient(async (client) => {
      fixture = await createFixture(client);
      scheduleId = await createRecurringSchedule(client, fixture);
      bookingIds.push(await createRequestedBooking(client, fixture, {
        scheduledAt: '2027-03-16T10:00:00+05:30',
      }));
      bookingIds.push(await createRequestedBooking(client, fixture, {
        scheduledAt: '2027-03-23T10:00:00+05:30',
        recurringScheduleId: scheduleId,
      }));
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
      } finally {
        if (transactionOpen) await first.query('rollback').catch(() => undefined);
      }
    });
  } finally {
    if (fixture && scheduleId) {
      await context.withClient((client) => cleanupFixture(client, fixture, bookingIds, scheduleId));
    }
  }
}

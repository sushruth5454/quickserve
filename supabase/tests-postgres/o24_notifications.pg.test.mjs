import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withTwoClients } from './helpers.mjs';

async function createUser(client) {
  const id = randomUUID();
  const phone = `+1555${randomUUID().replace(/\D/g, '').slice(0, 10)}`;
  await client.query(`
    insert into auth.users (id, phone, raw_user_meta_data)
    values ($1::uuid, $2::text, '{}'::jsonb)
  `, [id, phone]);
  return id;
}

async function waitForQueueConflict(observer, pid, blockerPid, operation, details, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastActivity = null;
  while (Date.now() < deadline) {
    lastActivity = (await observer.query(`
      select wait_event_type, wait_event, query, pg_blocking_pids(pid) as blocking_pids
        from pg_stat_activity where pid = $1::int
    `, [pid])).rows[0] ?? null;
    const blockingPids = (lastActivity?.blocking_pids ?? []).map(Number);
    if (
      lastActivity?.wait_event_type === 'Lock'
      && blockingPids.includes(Number(blockerPid))
      && String(lastActivity.query).toLowerCase().includes('_queue_notification')
    ) return lastActivity;
    if (operation.settled) {
      throw new Error(`competing queue operation completed before the pending-row lock was observed: ${JSON.stringify({
        ...details, pid, blockerPid, lastActivity, result: operation.result, error: operation.error?.message,
      })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`competing queue operation did not overlap the pending-row lock: ${JSON.stringify({
    ...details, pid, blockerPid, lastActivity, result: operation.result, error: operation.error?.message,
  })}`);
}

await withTwoClients(async (first, second) => {
  const userId = await createUser(first);
  const collapseKey = `o24-pg-${randomUUID()}`;
  const payload = JSON.stringify({ url: '/booking/o24-pg', private_marker: 'unchanged' });
  const [firstPidRow, secondPidRow] = await Promise.all([
    first.query('select pg_backend_pid() as pid').then((result) => result.rows[0]),
    second.query('select pg_backend_pid() as pid').then((result) => result.rows[0]),
  ]);
  const firstPid = Number(firstPidRow.pid);
  const secondPid = Number(secondPidRow.pid);
  assert(Number.isInteger(firstPid) && Number.isInteger(secondPid), `backend PIDs must be integers: ${JSON.stringify({ firstPidRow, secondPidRow })}`);
  assert.notEqual(firstPid, secondPid, `queue test must use two backend PIDs: ${JSON.stringify({ firstPid, secondPid })}`);

  let firstInTransaction = false;
  let secondInTransaction = false;
  let operationSettled = false;
  let operationResult = null;
  let operationError = null;
  let firstQueueTime = null;
  let secondQueueTime = null;
  let notificationId = null;
  let mergePromise = null;
  try {
    await first.query('begin');
    firstInTransaction = true;
    firstQueueTime = (await first.query('select now() as at')).rows[0].at;
    await first.query(`
      select public._queue_notification(
        $1::uuid, 'booking_accepted'::text, null::uuid, 'First event'::text, 'First body'::text,
        $2::jsonb, $3::text
      )
    `, [userId, payload, collapseKey]);
    notificationId = (await first.query(`
      select id from public.notifications
       where user_id = $1::uuid and collapse_key = $2::text and status = 'pending'::text
    `, [userId, collapseKey])).rows[0]?.id;
    assert(notificationId, `first pending notification must exist: ${JSON.stringify({ userId, collapseKey, notificationId })}`);
    await first.query(`
      update public.notifications set read_at = '2026-11-25T10:00:00Z'::timestamptz
       where id = $1::uuid
    `, [notificationId]);

    await second.query('begin');
    secondInTransaction = true;
    secondQueueTime = (await second.query('select now() as at')).rows[0].at;
    const operation = { get settled() { return operationSettled; }, get result() { return operationResult; }, get error() { return operationError; } };
    mergePromise = second.query(`
      select public._queue_notification(
        $1::uuid, 'booking_accepted'::text, null::uuid, 'Second event'::text, 'Second body'::text,
        $2::jsonb, $3::text
      )
    `, [userId, payload, collapseKey]).then(
      (result) => {
        operationResult = result;
        operationSettled = true;
        return result;
      },
      (error) => {
        operationError = error;
        operationSettled = true;
        throw error;
      },
    );
    const overlap = await waitForQueueConflict(
      first,
      secondPid,
      firstPid,
      operation,
      { userId, collapseKey, notificationId },
    );
    await first.query('commit');
    firstInTransaction = false;
    await mergePromise;
    await second.query('commit');
    secondInTransaction = false;

    const merged = (await first.query(`
      select id, count, read_at, created_at, event_at, updated_at, data
        from public.notifications where user_id = $1::uuid and collapse_key = $2::text
    `, [userId, collapseKey])).rows[0];
    assert.equal(merged.id, notificationId, `pending merge must preserve id: ${JSON.stringify({ merged, notificationId })}`);
    assert.equal(merged.count, 2, `overlapping events must collapse once: ${JSON.stringify({ merged })}`);
    assert.equal(merged.read_at, null, `genuine event must reset read state: ${JSON.stringify({ merged })}`);
    assert.equal(
      new Date(merged.event_at).toISOString(),
      new Date(secondQueueTime).toISOString(),
      `merge must record the queue transaction time: ${JSON.stringify({ merged, secondQueueTime })}`,
    );
    assert.equal(
      new Date(merged.created_at).toISOString(),
      new Date(firstQueueTime).toISOString(),
      `merge must preserve original creation time: ${JSON.stringify({ merged, firstQueueTime })}`,
    );
    assert.equal(merged.data.private_marker, 'unchanged', `payload remains valid JSON: ${JSON.stringify({ merged })}`);

    const token = `ExponentPushToken[O24${randomUUID().replaceAll('-', '').slice(0, 20)}]`;
    await first.query(`
      insert into public.push_devices (user_id, token, platform)
      values ($1::uuid, $2::text, 'web'::text)
    `, [userId, token]);
    const firstClaim = await first.query('select id from public.claim_due_notifications($1::int)', [1000]);
    assert(
      firstClaim.rows.some((row) => row.id === notificationId),
      `worker claim must include the collapsed notification: ${JSON.stringify({ notificationId, claimed: firstClaim.rows })}`,
    );
    await first.query(`
      select public.finish_notification(
        $1::uuid, false::boolean, 'retry'::text, '[]'::jsonb, array[]::text[]
      )
    `, [notificationId]);
    await first.query(`
      update public.notifications set next_attempt_at = now() - interval '1 minute'
       where id = $1::uuid
    `, [notificationId]);
    const retryClaim = await first.query('select id from public.claim_due_notifications($1::int)', [1000]);
    assert(
      retryClaim.rows.some((row) => row.id === notificationId),
      `retry claim must retain the notification: ${JSON.stringify({ notificationId, claimed: retryClaim.rows })}`,
    );
    await first.query(`
      select public.finish_notification(
        $1::uuid, true::boolean, null::text, '[]'::jsonb, array[]::text[]
      )
    `, [notificationId]);

    const afterTransport = (await first.query(`
      select id, count, read_at, created_at, event_at, updated_at, attempts, status, data
        from public.notifications where id = $1::uuid
    `, [notificationId])).rows[0];
    const actual = {
      pids: { firstPid, secondPid },
      overlap: {
        wait_event_type: overlap.wait_event_type,
        blocking_pids: overlap.blocking_pids,
      },
      merged: {
        id: merged.id,
        count: merged.count,
        read_at: merged.read_at,
        created_at: new Date(merged.created_at).toISOString(),
        event_at: new Date(merged.event_at).toISOString(),
      },
      after_transport: {
        id: afterTransport.id,
        count: afterTransport.count,
        read_at: afterTransport.read_at,
        created_at: new Date(afterTransport.created_at).toISOString(),
        event_at: new Date(afterTransport.event_at).toISOString(),
        attempts: afterTransport.attempts,
        status: afterTransport.status,
      },
    };
    assert.equal(
      new Date(afterTransport.created_at).toISOString(),
      new Date(merged.created_at).toISOString(),
      `transport retry must not change created_at: ${JSON.stringify(actual)}`,
    );
    assert.equal(
      new Date(afterTransport.event_at).toISOString(),
      new Date(merged.event_at).toISOString(),
      `transport retry must not change event_at: ${JSON.stringify(actual)}`,
    );
    assert.equal(afterTransport.attempts, 2, `failed and successful sends should be transport-only attempts: ${JSON.stringify(actual)}`);
    assert.equal(afterTransport.status, 'sent', `successful retry should finish delivery: ${JSON.stringify(actual)}`);
  } catch (error) {
    if (firstInTransaction) await first.query('rollback').catch(() => undefined);
    if (secondInTransaction) await second.query('rollback').catch(() => undefined);
    await mergePromise?.catch(() => undefined);
    throw error;
  }
}, { privateTestStack: process.env.PRIVATE_TEST_STACK, connectionString: process.env.LOCAL_DB_URL });

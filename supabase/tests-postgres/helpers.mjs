import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function assertPrivateTestStack({
  connectionString = process.env.LOCAL_DB_URL,
  privateTestStack = process.env.PRIVATE_TEST_STACK,
} = {}) {
  if (privateTestStack !== 'true') {
    throw new Error('PRIVATE_TEST_STACK=true is required for PostgreSQL integration tests');
  }
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new Error('LOCAL_DB_URL is required for PostgreSQL integration tests');
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('LOCAL_DB_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('LOCAL_DB_URL must use the postgres or postgresql protocol');
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('LOCAL_DB_URL must point to a loopback host');
  }
  return url;
}

export function assertLoopbackHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('LOCAL_API_URL must be a valid HTTP URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('LOCAL_API_URL must point to an HTTP loopback host');
  }
  return url;
}

export async function createClient(options = {}) {
  const connectionString = options.connectionString ?? process.env.LOCAL_DB_URL;
  assertPrivateTestStack({
    connectionString,
    privateTestStack: options.privateTestStack ?? process.env.PRIVATE_TEST_STACK,
  });
  const pg = await import('pg');
  const Client = pg.Client ?? pg.default?.Client;
  if (!Client) throw new Error('pg does not export Client');
  return new Client({ connectionString, ...(options.clientOptions ?? {}) });
}

async function closeClient(client) {
  try {
    await client.end();
  } catch {
    // A client that failed to connect has no live session to close.
  }
}

export async function withClient(callback, options = {}) {
  const client = await createClient(options);
  try {
    await client.connect();
    return await callback(client);
  } finally {
    await closeClient(client);
  }
}

export async function withTwoClients(callback, options = {}) {
  const clients = [];
  try {
    clients.push(await createClient(options));
    clients.push(await createClient(options));
    await clients[0].connect();
    await clients[1].connect();
    return await callback(...clients);
  } finally {
    await Promise.all(clients.map(closeClient));
  }
}

export async function verifyTwoConnections(options = {}) {
  return withTwoClients(async (first, second) => {
    const [firstResult, secondResult] = await Promise.all([
      first.query('select pg_backend_pid() as pid'),
      second.query('select pg_backend_pid() as pid'),
    ]);
    const firstPid = Number(firstResult.rows[0]?.pid);
    const secondPid = Number(secondResult.rows[0]?.pid);
    assert(Number.isInteger(firstPid) && Number.isInteger(secondPid), 'PostgreSQL must return both backend PIDs');
    assert.notEqual(firstPid, secondPid, 'two independent pg.Client connections must use distinct backend PIDs');

    const lockKey = randomInt(1, 0x7fffffff);
    let firstHoldsLock = false;
    let secondHoldsLock = false;
    try {
      await first.query('select pg_advisory_lock($1::int4)', [lockKey]);
      firstHoldsLock = true;
      const blocked = await second.query('select pg_try_advisory_lock($1::int4) as acquired', [lockKey]);
      assert.equal(blocked.rows[0]?.acquired, false, 'the second connection must observe the first connection barrier');

      const released = await first.query('select pg_advisory_unlock($1::int4) as released', [lockKey]);
      firstHoldsLock = false;
      assert.equal(released.rows[0]?.released, true, 'the first connection must release the barrier');

      const afterRelease = await second.query('select pg_try_advisory_lock($1::int4) as acquired', [lockKey]);
      secondHoldsLock = afterRelease.rows[0]?.acquired === true;
      assert.equal(secondHoldsLock, true, 'the second connection must acquire the barrier after release');
      const cleanup = await second.query('select pg_advisory_unlock($1::int4) as released', [lockKey]);
      secondHoldsLock = false;
      assert.equal(cleanup.rows[0]?.released, true, 'the second connection must clean up its barrier lock');
    } finally {
      if (firstHoldsLock) await first.query('select pg_advisory_unlock($1::int4)', [lockKey]).catch(() => undefined);
      if (secondHoldsLock) await second.query('select pg_advisory_unlock($1::int4)', [lockKey]).catch(() => undefined);
    }

    return { firstPid, secondPid, barrier: 'blocked-then-released', cleanup: 'verified' };
  }, options);
}

export function runGuardSelftest() {
  const loopback = assertPrivateTestStack({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    privateTestStack: 'true',
  });
  assert.equal(loopback.hostname, '127.0.0.1');
  assert.throws(
    () => assertPrivateTestStack({ connectionString: 'postgres://db.example.test/postgres', privateTestStack: 'true' }),
    /loopback host/,
  );
  assert.throws(
    () => assertPrivateTestStack({ connectionString: 'postgres://127.0.0.1/postgres', privateTestStack: 'false' }),
    /PRIVATE_TEST_STACK=true/,
  );
  assert.throws(
    () => assertPrivateTestStack({ connectionString: 'http://127.0.0.1:5432', privateTestStack: 'true' }),
    /postgres or postgresql protocol/,
  );
  assert.throws(
    () => assertLoopbackHttpUrl('https://api.example.test'),
    /HTTP loopback host/,
  );
  return { cases: 5, passed: true };
}

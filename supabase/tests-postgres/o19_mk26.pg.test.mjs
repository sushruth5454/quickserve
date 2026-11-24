import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

async function as(client, uid, sql, params = []) {
  await client.query(
    'select set_config(\'request.jwt.claim.sub\', $1::text, false)',
    [uid],
  );
  await client.query('set role authenticated');
  try {
    return await client.query(sql, params);
  } finally {
    await client.query('reset role');
  }
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

async function makeFixture(client) {
  await client.query(`
    update public.feature_flags set enabled = true
     where key in ('products', 'product_enquiries', 'product_rfq')
  `);
  const customerId = await makeUser(client);
  const ownerId = await makeUser(client);
  const categoryId = (await client.query(`
    insert into public.product_categories (slug, name, attribute_schema)
    values ($1::text, $2::text, '{}'::jsonb)
    returning id
  `, [`o19-${randomUUID().replace(/-/g, '')}`, 'O19 PostgreSQL context race'])).rows[0].id;
  const shopId = (await client.query(`
    insert into public.shops (
      owner_id, name, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, status
    ) values (
      $1::uuid, $2::text, '1 O19 Market Road', 'Vijayawada', 'Benz Circle',
      16.5::double precision, 80.6::double precision, 20::int, true, true, 'verified'
    ) returning id
  `, [ownerId, `O19 PostgreSQL race ${randomUUID()}`])).rows[0].id;
  await client.query(`
    insert into public.shop_categories (shop_id, category_id)
    values ($1::uuid, $2::uuid)
  `, [shopId, categoryId]);
  const productId = (await client.query(`
    insert into public.products (
      shop_id, category_id, name, brand, model, description, in_stock
    ) values (
      $1::uuid, $2::uuid, $3::text, 'O19', '', 'O19 private concurrency fixture', true
    ) returning id
  `, [shopId, categoryId, `O19 product ${randomUUID()}`])).rows[0].id;
  return { customerId, shopId, productId };
}

async function waitForLockWait(observer, blockedPid, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  let actual = null;
  while (Date.now() < deadline) {
    actual = (await observer.query(`
      select state, wait_event_type, wait_event, query
        from pg_stat_activity
       where pid = $1::int
    `, [blockedPid])).rows[0] ?? null;
    if (actual?.wait_event_type === 'Lock') return actual;
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

async function runConcurrentStart(context) {
  const fixture = await context.withClient((client) => makeFixture(client));
  await context.withTwoClients(async (first, second) => {
    const firstPid = Number((await first.query('select pg_backend_pid() as pid')).rows[0].pid);
    const secondPid = Number((await second.query('select pg_backend_pid() as pid')).rows[0].pid);
    assert.notEqual(firstPid, secondPid,
      `stable-context race requires independent backend PIDs: ${JSON.stringify({ firstPid, secondPid })}`);
    await first.query(`set statement_timeout = '15000ms'`);
    await second.query(`set statement_timeout = '15000ms'`);

    await first.query('begin');
    let firstTransactionOpen = true;
    let secondStartPromise;
    try {
      await first.query(`
        select id from public.shops where id = $1::uuid for update
      `, [fixture.shopId]);
      secondStartPromise = capture(as(second, fixture.customerId, `
        select public.start_product_enquiry(
          $1::uuid, $2::uuid, $3::text
        ) as id
      `, [fixture.shopId, fixture.productId, 'O19 concurrent stable-context start']));

      const blocked = await waitForLockWait(first, secondPid);
      assert.equal(blocked?.wait_event_type, 'Lock',
        `second backend must queue on the locked shop before lookup: ${JSON.stringify({
          firstPid, secondPid, blocked, fixture,
        })}`);
      assert.match(blocked?.query ?? '', /start_product_enquiry/i,
        `blocked backend must be the second start call: ${JSON.stringify({
          firstPid, secondPid, blocked, fixture,
        })}`);

      const firstStart = await as(first, fixture.customerId, `
        select public.start_product_enquiry(
          $1::uuid, $2::uuid, $3::text
        ) as id
      `, [fixture.shopId, fixture.productId, 'O19 first stable-context start']);
      await first.query('commit');
      firstTransactionOpen = false;
      const secondStart = await secondStartPromise;
      const threads = (await first.query(`
        select id, product_id, product_context_id, status
          from public.product_enquiries
         where shop_id = $1::uuid and customer_id = $2::uuid
      `, [fixture.shopId, fixture.customerId])).rows;
      const messages = (await first.query(`
        select id, enquiry_id, sender_id, body
          from public.product_enquiry_messages
         where enquiry_id = any($1::uuid[])
         order by id
      `, [threads.map((thread) => thread.id)])).rows;
      const diagnostics = {
        firstPid,
        secondPid,
        blocked,
        firstStart: firstStart.rows,
        secondStart,
        threads,
        messages,
      };

      assert.equal(secondStart.ok, true,
        `queued second start must complete after the first commit: ${JSON.stringify(diagnostics)}`);
      assert.equal(firstStart.rows[0]?.id, secondStart.rows[0]?.id,
        `both backends must reuse the same stable-context thread: ${JSON.stringify(diagnostics)}`);
      assert.equal(threads.length, 1,
        `only one open thread may exist for the stable context: ${JSON.stringify(diagnostics)}`);
      assert.equal(threads[0]?.product_id, fixture.productId,
        `reused thread keeps the live product pointer: ${JSON.stringify(diagnostics)}`);
      assert.equal(threads[0]?.product_context_id, fixture.productId,
        `reused thread keeps the immutable context: ${JSON.stringify(diagnostics)}`);
      assert.equal(threads[0]?.status, 'open',
        `concurrent starts leave the thread open: ${JSON.stringify(diagnostics)}`);
      assert.equal(messages.length, 2,
        `each successful start posts one message into the same thread: ${JSON.stringify(diagnostics)}`);
      assert.ok(messages.every((message) => message.enquiry_id === firstStart.rows[0]?.id),
        `both messages remain attached to the shared thread: ${JSON.stringify(diagnostics)}`);
    } finally {
      if (firstTransactionOpen) {
        await first.query('rollback').catch(() => undefined);
      }
      if (secondStartPromise) await secondStartPromise;
      await first.query('reset role').catch(() => undefined);
      await second.query('reset role').catch(() => undefined);
    }
  });
}

export async function run(context) {
  const originalFlags = await context.withClient(async (client) => (
    await client.query(`
      select key, enabled from public.feature_flags
       where key in ('products', 'product_enquiries', 'product_rfq')
    `)
  ).rows);
  try {
    await runConcurrentStart(context);
  } finally {
    await context.withClient(async (client) => {
      for (const flag of originalFlags) {
        await client.query(
          'update public.feature_flags set enabled = $2::boolean where key = $1::text',
          [flag.key, flag.enabled],
        );
      }
    });
  }
}

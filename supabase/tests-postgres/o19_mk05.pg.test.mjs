import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const scenarioName = 'MK-SELECT-private-concurrent-revise-select-suspend';

async function as(client, uid, sql, params = []) {
  await client.query(
    `select set_config('request.jwt.claim.sub', $1::text, false)`,
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

async function sendQuote(client, ownerId, rfqId, shopId, itemId, model) {
  return (await as(client, ownerId, `
    select public.send_supplier_quote_for_business(
      $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int,
      $6::timestamptz, $7::text
    ) as id
  `, [
    rfqId,
    shopId,
    JSON.stringify([{
      rfq_item_id: itemId,
      brand: 'O19',
      model,
      specs: {},
      unit_price_paise: 1250,
      gst_rate_bp: 0,
      available: true,
    }]),
    0,
    null,
    null,
    `O19 ${model} quote`,
  ])).rows[0].id;
}

async function createFixture(client, label) {
  await client.query(`
    update public.feature_flags set enabled = true
     where key in ('products', 'product_enquiries', 'product_rfq')
  `);
  const customerId = await makeUser(client);
  const ownerId = await makeUser(client);
  const secondOwnerId = await makeUser(client);
  const categoryId = (await client.query(`
    insert into public.product_categories (slug, name, attribute_schema)
    values ($1::text, $2::text, '{}'::jsonb)
    returning id
  `, [`o19-${randomUUID().replace(/-/g, '')}`, `O19 ${label}`])).rows[0].id;
  const shopId = (await client.query(`
    insert into public.shops (
      owner_id, name, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, status
    ) values (
      $1::uuid, $2::text, '1 O19 Market Road', 'Vijayawada', 'Benz Circle',
      16.5::double precision, 80.6::double precision, 20::int, true, true, 'verified'
    ) returning id
  `, [ownerId, `O19 ${label} ${randomUUID()}`])).rows[0].id;
  const secondShopId = (await client.query(`
    insert into public.shops (
      owner_id, name, address_line, city, area, lat, lng, delivery_radius_km,
      offers_delivery, offers_pickup, status
    ) values (
      $1::uuid, $2::text, '2 O19 Market Road', 'Vijayawada', 'Benz Circle',
      16.5::double precision, 80.6::double precision, 20::int, true, true, 'verified'
    ) returning id
  `, [secondOwnerId, `O19 ${label} other ${randomUUID()}`])).rows[0].id;
  await client.query(`
    insert into public.shop_categories (shop_id, category_id)
    values ($1::uuid, $2::uuid), ($3::uuid, $2::uuid)
  `, [shopId, categoryId, secondShopId]);
  const rfqId = (await as(client, customerId, `
    select public.create_rfq(
      $1::uuid, $2::text, $3::jsonb, $4::text, $5::text,
      $6::double precision, $7::double precision, $8::boolean, $9::date, $10::text
    ) as id
  `, [
    categoryId,
    `O19 request ${randomUUID()}`,
    JSON.stringify([{
      description: 'O19 concurrency item',
      specs: {},
      quantity: 2,
      unit: 'piece',
    }]),
    'Vijayawada',
    'Benz Circle',
    16.5,
    80.6,
    true,
    '2027-01-15',
    'O19 private concurrency fixture',
  ])).rows[0].id;
  const itemId = (await client.query(`
    select id from public.rfq_items where rfq_id = $1::uuid order by seq limit 1
  `, [rfqId])).rows[0].id;
  const quoteId = await sendQuote(client, ownerId, rfqId, shopId, itemId, 'Original');
  const secondQuoteId = await sendQuote(client, secondOwnerId, rfqId, secondShopId, itemId, 'Other');
  return {
    customerId, ownerId, secondOwnerId, categoryId, shopId, secondShopId,
    rfqId, quoteId, secondQuoteId, itemId,
  };
}

async function state(client, fixture) {
  return (await client.query(`
    select jsonb_build_object(
      'rfq', (
        select jsonb_build_object('id', r.id, 'status', r.status, 'updated_at', r.updated_at)
          from public.rfqs as r where r.id = $1::uuid
      ),
      'quotes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', q.id, 'shop_id', q.shop_id, 'status', q.status,
          'version', q.version, 'updated_at', q.updated_at
        ) order by q.id)
          from public.supplier_quotes as q where q.rfq_id = $1::uuid
      ), '[]'::jsonb),
      'enquiries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'product_id', e.product_id, 'status', e.status,
          'last_message_at', e.last_message_at, 'customer_unread', e.customer_unread,
          'shop_unread', e.shop_unread
        ) order by e.id)
          from public.product_enquiries as e
         where e.customer_id = $2::uuid and e.shop_id = $3::uuid
      ), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'enquiry_id', m.enquiry_id, 'sender_id', m.sender_id, 'body', m.body
        ) order by m.id)
          from public.product_enquiry_messages as m
         where m.enquiry_id in (
           select e.id from public.product_enquiries as e
            where e.customer_id = $2::uuid and e.shop_id = $3::uuid
         )
      ), '[]'::jsonb)
    ) as value
  `, [fixture.rfqId, fixture.customerId, fixture.shopId])).rows[0].value;
}

async function waitForLockWait(observer, blockedPid, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  let actual = null;
  while (Date.now() < deadline) {
    actual = (await observer.query(`
      select state, wait_event_type, wait_event, query, pg_blocking_pids(pid) as blocking_pids
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

async function runSendSelect(context) {
  const fixture = await context.withClient((client) => createFixture(client, 'send-select'));
  await context.withTwoClients(async (first, second) => {
    const firstPid = Number((await first.query('select pg_backend_pid() as pid')).rows[0].pid);
    const secondPid = Number((await second.query('select pg_backend_pid() as pid')).rows[0].pid);
    assert.notEqual(firstPid, secondPid, `race requires distinct PostgreSQL backends: ${JSON.stringify({ firstPid, secondPid })}`);
    await first.query(`set statement_timeout = '15000ms'`);
    await second.query(`set statement_timeout = '15000ms'`);
    await second.query(
      `select set_config('request.jwt.claim.sub', $1::text, false)`,
      [fixture.secondOwnerId],
    );
    await second.query('set role authenticated');
    await first.query('begin');
    let firstTransactionOpen = true;
    let sendPromise;
    try {
      await first.query(`
        select id from public.rfqs where id = $1::uuid for update
      `, [fixture.rfqId]);
      sendPromise = capture(second.query(`
        select public.send_supplier_quote_for_business(
          $1::uuid, $2::uuid, $3::jsonb, $4::bigint, $5::int,
          $6::timestamptz, $7::text
        )
      `, [
        fixture.rfqId,
        fixture.secondShopId,
        JSON.stringify([{
          rfq_item_id: fixture.itemId,
          brand: 'O19',
          model: 'Revised',
          specs: {},
          unit_price_paise: 1300,
          gst_rate_bp: 0,
          available: true,
        }]),
        0,
        null,
        null,
        'O19 concurrent revision',
      ]));
      const blocked = await waitForLockWait(first, secondPid);
      assert.equal(blocked?.wait_event_type, 'Lock',
        `${scenarioName}: send must queue behind the locked RFQ before touching the shop/quote: ${JSON.stringify({ firstPid, secondPid, blocked })}`);
      assert.match(blocked?.query ?? '', /send_supplier_quote_for_business/i,
        `${scenarioName}: lock waiter is the quote sender: ${JSON.stringify({ firstPid, secondPid, blocked })}`);
      assert.ok(blocked?.blocking_pids?.includes(firstPid),
        `${scenarioName}: quote sender is blocked by the backend holding the RFQ lock: ${JSON.stringify({ firstPid, secondPid, blocked })}`);

      const selected = await as(first, fixture.customerId, `
        select public.select_supplier_quote($1::uuid) as result
      `, [fixture.quoteId]);
      await first.query('commit');
      firstTransactionOpen = false;
      const sendResult = await sendPromise;
      const after = await state(first, fixture);
      const selectedCount = after.quotes.filter((quote) => quote.status === 'selected').length;
      const diagnostics = { scenarioName, firstPid, secondPid, blocked, selected, sendResult, after, selectedCount };
      assert.equal(selectedCount, 1, `at most one quote is selected: ${JSON.stringify(diagnostics)}`);
      assert.equal(after.rfq.status, 'closed', `selection closes the RFQ: ${JSON.stringify(diagnostics)}`);
      assert.equal(after.quotes.length, 2, `queued revision did not create a partial quote: ${JSON.stringify(diagnostics)}`);
      assert.equal(after.quotes.filter((quote) => quote.status === 'rejected').length, 1,
        `the other live quote is rejected before the queued send can write: ${JSON.stringify(diagnostics)}`);
      assert.equal(after.enquiries.length, 1, `selection creates one general enquiry: ${JSON.stringify(diagnostics)}`);
      assert.equal(after.messages.length, 1, `selection creates one message: ${JSON.stringify(diagnostics)}`);
      assert.equal(sendResult.ok, false, `queued sender observes closed RFQ: ${JSON.stringify(diagnostics)}`);
      assert.match(sendResult.message ?? '', /RFQ is closed or expired/i,
        `queued sender fails before any write: ${JSON.stringify(diagnostics)}`);
      assert.notEqual(sendResult.code, '40P01', `send/select race must not deadlock: ${JSON.stringify(diagnostics)}`);
      assert.notEqual(sendResult.code, '57014', `send/select race must complete within statement timeout: ${JSON.stringify(diagnostics)}`);
    } finally {
      if (firstTransactionOpen) await first.query('rollback').catch(() => undefined);
      if (sendPromise) await sendPromise;
      await second.query('reset role').catch(() => undefined);
    }
  });
}

async function runSuspendSelect(context) {
  const fixture = await context.withClient((client) => createFixture(client, 'suspend-select'));
  await context.withTwoClients(async (first, second) => {
    const firstPid = Number((await first.query('select pg_backend_pid() as pid')).rows[0].pid);
    const secondPid = Number((await second.query('select pg_backend_pid() as pid')).rows[0].pid);
    assert.notEqual(firstPid, secondPid, `race requires distinct PostgreSQL backends: ${JSON.stringify({ firstPid, secondPid })}`);
    await first.query(`set statement_timeout = '15000ms'`);
    await second.query(`set statement_timeout = '15000ms'`);
    await second.query('begin');
    let secondTransactionOpen = true;
    let selectPromise;
    try {
      await second.query(`
        update public.shops set status = 'suspended', updated_at = now()
         where id = $1::uuid
      `, [fixture.shopId]);
      const before = await state(second, fixture);
      selectPromise = capture(as(first, fixture.customerId, `
        select public.select_supplier_quote($1::uuid) as result
      `, [fixture.quoteId]));
      const blocked = await waitForLockWait(second, firstPid);
      assert.equal(blocked?.wait_event_type, 'Lock',
        `${scenarioName}: selection must wait for the shop suspension lock after locking the RFQ: ${JSON.stringify({ firstPid, secondPid, blocked, before })}`);
      assert.match(blocked?.query ?? '', /select public\.select_supplier_quote/i,
        `${scenarioName}: lock waiter is the quote selector: ${JSON.stringify({ firstPid, secondPid, blocked, before })}`);
      await second.query('commit');
      secondTransactionOpen = false;
      const selection = await selectPromise;
      const after = await state(first, fixture);
      const selectedCount = after.quotes.filter((quote) => quote.status === 'selected').length;
      const diagnostics = { scenarioName, firstPid, secondPid, blocked, selection, before, after, selectedCount };
      assert.equal(selection.ok, false, `suspension wins before selection writes: ${JSON.stringify(diagnostics)}`);
      assert.match(selection.message ?? '', /verified shop not found|shop or product unavailable/i,
        `selection rechecks verified-shop state after its lock: ${JSON.stringify(diagnostics)}`);
      assert.deepEqual(after, before,
        `suspended selection leaves RFQ, quote, enquiry and message state unchanged: ${JSON.stringify(diagnostics)}`);
      assert.equal(selectedCount, 0, `suspended shop cannot win selection: ${JSON.stringify(diagnostics)}`);
      assert.equal(after.enquiries.length, 0, `suspended selection creates no enquiry: ${JSON.stringify(diagnostics)}`);
      assert.equal(after.messages.length, 0, `suspended selection creates no message: ${JSON.stringify(diagnostics)}`);
      assert.notEqual(selection.code, '40P01', `suspend/select race must not deadlock: ${JSON.stringify(diagnostics)}`);
      assert.notEqual(selection.code, '57014', `suspend/select race must complete within statement timeout: ${JSON.stringify(diagnostics)}`);
    } finally {
      if (secondTransactionOpen) await second.query('rollback').catch(() => undefined);
      if (selectPromise) await selectPromise;
      await first.query('reset role').catch(() => undefined);
    }
  });
}

export async function run(context) {
  const originalFlags = await context.withClient(async (client) => {
    const result = await client.query(`
      select key, enabled from public.feature_flags
       where key in ('products', 'product_enquiries', 'product_rfq')
    `);
    return result.rows;
  });
  try {
    await runSendSelect(context);
    await runSuspendSelect(context);
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

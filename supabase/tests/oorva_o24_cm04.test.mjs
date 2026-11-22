import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(here, '..', 'migrations', '0041_admin_support.sql'), 'utf8');
const { ok, scenario, finish } = createHarness();
const policyBlock = migration.match(
  /alter table public\.support_threads enable row level security;[\s\S]*?create policy support_messages_read[\s\S]*?;/,
)?.[0];

function supportFunction(name) {
  return migration.match(
    new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`),
  )?.[0];
}

function requireId(row, label) {
  if (typeof row?.id !== 'string') throw new Error(`${label}: ${JSON.stringify(row)}`);
  return row.id;
}

const ids = {
  customer: '00000000-0000-0000-0000-000000000101',
  provider: '00000000-0000-0000-0000-000000000102',
  manager: '00000000-0000-0000-0000-000000000103',
  admin: '00000000-0000-0000-0000-000000000104',
  adminOwner: '00000000-0000-0000-0000-000000000105',
  thread: '00000000-0000-0000-0000-000000000201',
  booking: '00000000-0000-0000-0000-000000000301',
  category: '00000000-0000-0000-0000-000000000401',
};

async function withSupportFixture(run) {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    const required = [
      '_support_post',
      'support_start',
      'support_send',
      'support_mark_read',
      'support_set_status',
      'admin_list_support_threads',
    ];
    const functions = required.map((name) => {
      const source = supportFunction(name);
      if (!source) throw new Error(`0041 support function ${name} was not found`);
      return source;
    });
    if (!policyBlock) throw new Error('0041 support read policies were not found');

    await db.exec(`
      create extension if not exists pgcrypto;
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key, phone text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table public.profiles (id uuid primary key, full_name text, role_provider boolean not null default false);
      create table public.admins (user_id uuid primary key references public.profiles(id));
      create table public.categories (id uuid primary key, name text not null);
      create table public.bookings (
        id uuid primary key,
        customer_id uuid not null,
        provider_id uuid not null,
        category_id uuid not null
      );
      create table public.support_threads (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references public.profiles(id),
        booking_id uuid references public.bookings(id),
        subject text not null,
        status text not null default 'open',
        user_unread int not null default 0,
        admin_unread int not null default 0,
        last_message text not null default '',
        last_from_admin boolean not null default false,
        last_message_at timestamptz not null default now(),
        created_at timestamptz not null default now()
      );
      create table public.support_messages (
        id uuid primary key default gen_random_uuid(),
        thread_id uuid not null references public.support_threads(id),
        sender_id uuid not null references public.profiles(id),
        from_admin boolean not null default false,
        body text not null,
        created_at timestamptz not null default now()
      );
      create function public._assert(p_condition boolean, p_message text) returns void language plpgsql as $$
      begin
        if not coalesce(p_condition, false) then raise exception '%', p_message; end if;
      end;
      $$;
      create function public._require_uid() returns uuid language plpgsql as $$
      declare v_uid uuid := auth.uid();
      begin
        if v_uid is null then raise exception 'sign in required'; end if;
        return v_uid;
      end;
      $$;
      create function public._is_admin() returns boolean language sql stable security definer as $$
        select exists (select 1 from public.admins where user_id = auth.uid())
      $$;
      create function public._admin_user_ids() returns setof uuid language sql stable security definer as $$
        select user_id from public.admins
      $$;
      create function public._queue_notification(uuid, text, uuid, text, text, jsonb, text)
      returns void language plpgsql as $$ begin return; end; $$;
      insert into public.profiles (id, full_name, role_provider) values
        ('${ids.customer}', 'Customer', false),
        ('${ids.provider}', 'Provider', true),
        ('${ids.manager}', 'Manager', false),
        ('${ids.admin}', 'Administrator', false),
        ('${ids.adminOwner}', 'Owner administrator', false);
      insert into public.admins (user_id) values ('${ids.admin}'), ('${ids.adminOwner}');
      insert into auth.users (id, phone) values
        ('${ids.customer}', '+910000000101'),
        ('${ids.provider}', '+910000000102'),
        ('${ids.manager}', '+910000000103'),
        ('${ids.admin}', '+910000000104'),
        ('${ids.adminOwner}', '+910000000105');
      insert into public.categories (id, name) values ('${ids.category}', 'Support category');
      insert into public.bookings (id, customer_id, provider_id, category_id)
        values ('${ids.booking}', '${ids.customer}', '${ids.provider}', '${ids.category}');
      grant usage on schema public, auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      grant execute on function public._assert(boolean, text), public._require_uid(), public._is_admin() to authenticated;
    `);
    await db.exec(policyBlock);
    for (const fn of functions) await db.exec(fn);
    await db.exec(`
      grant execute on function public._admin_user_ids() to authenticated;
      grant execute on function public.support_start(text, uuid, text),
        public.support_send(uuid, text), public.support_mark_read(uuid),
        public.support_set_status(uuid, text), public.admin_list_support_threads(text)
      to authenticated;
    `);

    const as = async (actorId, query, params = []) => {
      await db.exec('reset role');
      await db.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [actorId]);
      await db.exec('set role authenticated');
      try {
        return (await db.query(query, params)).rows;
      } finally {
        await db.exec('reset role');
      }
    };
    const one = async (query, params = []) => (await db.query(query, params)).rows[0];
    const fails = async (work) => {
      try {
        await work();
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    await run({ as, one, fails });
  } finally {
    await db.close();
  }
}

await scenario('CM_SQL_SUPPORT_OWNER_LIFECYCLE', async () => {
  await withSupportFixture(async ({ as, one, fails }) => {
    const started = (await as(
      ids.customer,
      'select public.support_start($1::text, $2::uuid, $3::text) as id',
      ['Please help', null, 'Customer support'],
    ))[0];
    const threadId = requireId(started, 'owner support_start did not return a thread id');
    const initial = await one(
      'select id, user_id, subject, status, user_unread, admin_unread from public.support_threads where id = $1::uuid',
      [threadId],
    );
    ok(!!threadId && initial?.user_id === ids.customer && initial?.status === 'open',
      `owner starts an open personal thread: ${JSON.stringify({ threadId, initial })}`);

    await as(ids.customer, 'select public.support_set_status($1::uuid, $2::text)', [threadId, 'closed']);
    const closed = await one('select status from public.support_threads where id = $1::uuid', [threadId]);
    ok(closed?.status === 'closed', `owner can close the conversation: ${JSON.stringify({ closed })}`);

    await as(ids.customer, 'select public.support_set_status($1::uuid, $2::text)', [threadId, 'open']);
    const reopened = await one('select status from public.support_threads where id = $1::uuid', [threadId]);
    ok(reopened?.status === 'open', `owner can reopen the conversation: ${JSON.stringify({ reopened })}`);

    await as(ids.customer, 'select public.support_set_status($1::uuid, $2::text)', [threadId, 'closed']);
    await as(ids.customer, 'select public.support_send($1::uuid, $2::text)', [threadId, 'Owner follow-up']);
    const ownerReply = await one(`
      select t.status, t.user_unread, t.admin_unread, m.sender_id, m.from_admin, m.body
        from public.support_threads t
        join public.support_messages m on m.thread_id = t.id
       where t.id = $1::uuid order by m.created_at desc limit 1
    `, [threadId]);
    ok(ownerReply?.status === 'open' && ownerReply?.sender_id === ids.customer
      && ownerReply?.from_admin === false && ownerReply?.body === 'Owner follow-up',
    `owner send reopens without taking the admin branch: ${JSON.stringify({ ownerReply })}`);

    await as(ids.admin, 'select public.support_send($1::uuid, $2::text)', [threadId, 'Admin reply']);
    const beforeRead = await one('select user_unread from public.support_threads where id = $1::uuid', [threadId]);
    await as(ids.customer, 'select public.support_mark_read($1::uuid)', [threadId]);
    const afterRead = await one('select user_unread from public.support_threads where id = $1::uuid', [threadId]);
    ok(beforeRead?.user_unread === 1 && afterRead?.user_unread === 0,
      `owner read RPC clears the owner-side unread counter: ${JSON.stringify({ beforeRead, afterRead })}`);

    const outsiderRows = await as(ids.manager, 'select id from public.support_threads where id = $1::uuid', [threadId]);
    const outsiderSend = await fails(() => as(
      ids.manager,
      'select public.support_send($1::uuid, $2::text)',
      [threadId, 'Unauthorized'],
    ));
    ok(outsiderRows.length === 0 && /conversation not found/i.test(outsiderSend ?? ''),
      `non-owner cannot read or send this conversation: ${JSON.stringify({ outsiderRows, outsiderSend })}`);
  });
});

await scenario('CM_SQL_SUPPORT_ADMIN_LIFECYCLE', async () => {
  await withSupportFixture(async ({ as, one }) => {
    const threadId = requireId((await as(
      ids.customer,
      'select public.support_start($1::text, $2::uuid, $3::text) as id',
      ['Need an update', null, 'Admin lifecycle'],
    ))[0], 'admin lifecycle support_start did not return a thread id');
    const adminList = await as(ids.admin, 'select * from public.admin_list_support_threads($1::text)', ['all']);
    const adminDetail = await as(ids.admin, 'select id, user_id from public.support_threads where id = $1::uuid', [threadId]);
    const adminMessages = await as(ids.admin, 'select body from public.support_messages where thread_id = $1::uuid', [threadId]);
    ok(adminList.some((row) => row.id === threadId) && adminDetail.length === 1 && adminMessages.length === 1,
      `non-owner admin has authorized list and detail reads: ${JSON.stringify({ adminList, adminDetail, adminMessages })}`);

    await as(ids.admin, 'select public.support_mark_read($1::uuid)', [threadId]);
    const read = await one('select admin_unread from public.support_threads where id = $1::uuid', [threadId]);
    ok(read?.admin_unread === 0, `admin read RPC clears the admin-side unread counter: ${JSON.stringify({ read })}`);

    await as(ids.admin, 'select public.support_set_status($1::uuid, $2::text)', [threadId, 'closed']);
    await as(ids.admin, 'select public.support_set_status($1::uuid, $2::text)', [threadId, 'open']);
    await as(ids.admin, 'select public.support_set_status($1::uuid, $2::text)', [threadId, 'closed']);
    await as(ids.admin, 'select public.support_send($1::uuid, $2::text)', [threadId, 'Support reply']);
    const reply = await one(`
      select t.status, t.user_unread, t.admin_unread, m.sender_id, m.from_admin, m.body
        from public.support_threads t
        join public.support_messages m on m.thread_id = t.id
       where t.id = $1::uuid order by m.created_at desc limit 1
    `, [threadId]);
    ok(reply?.status === 'open' && reply?.sender_id === ids.admin && reply?.from_admin === true
      && reply?.body === 'Support reply' && reply?.user_unread === 1,
    `admin send reopens and records the admin-side reply: ${JSON.stringify({ reply })}`);

    await as(ids.customer, 'select public.support_mark_read($1::uuid)', [threadId]);
    const ownerReadback = await one('select user_unread from public.support_threads where id = $1::uuid', [threadId]);
    ok(ownerReadback?.user_unread === 0,
      `owner readback clears the counter after an admin reply: ${JSON.stringify({ ownerReadback })}`);
  });
});

await scenario('CM_SQL_SUPPORT_ROLE_NEUTRAL_START', async () => {
  await withSupportFixture(async ({ as, one }) => {
    const customerThread = requireId((await as(
      ids.customer,
      'select public.support_start($1::text, $2::uuid, $3::text) as id',
      ['Customer question', null, 'Customer support'],
    ))[0], 'customer support_start did not return a thread id');
    const providerThread = requireId((await as(
      ids.provider,
      'select public.support_start($1::text, $2::uuid, $3::text) as id',
      ['Provider question', null, 'Provider support'],
    ))[0], 'provider support_start did not return a thread id');
    const rows = await one(`
      select count(*)::int as count,
             count(*) filter (where user_id = $1::uuid)::int as customer_count,
             count(*) filter (where user_id = $2::uuid)::int as provider_count
        from public.support_threads where id in ($3::uuid, $4::uuid)
    `, [ids.customer, ids.provider, customerThread, providerThread]);
    ok(rows?.count === 2 && rows?.customer_count === 1 && rows?.provider_count === 1,
      `customer and provider may each start personal support: ${JSON.stringify({ customerThread, providerThread, rows })}`);
  });
});

await scenario('CM_SQL_SUPPORT_LINKED_PARTICIPANT_ONLY', async () => {
  await withSupportFixture(async ({ as, one, fails }) => {
    const customerThread = requireId((await as(
      ids.customer,
      'select public.support_start($1::text, $2::uuid, $3::text) as id',
      ['Booking assistance', ids.booking, null],
    ))[0], 'linked customer support_start did not return a thread id');
    const managerStart = await fails(() => as(
      ids.manager,
      'select public.support_start($1::text, $2::uuid, $3::text)',
      ['Linked participant request', ids.booking, null],
    ));
    const managerRows = await as(ids.manager, 'select id from public.support_threads where id = $1::uuid', [customerThread]);
    const managerSend = await fails(() => as(
      ids.manager,
      'select public.support_send($1::uuid, $2::text)',
      [customerThread, 'Linked participant reply'],
    ));
    const linkedRow = await one('select id, user_id, booking_id from public.support_threads where booking_id = $1::uuid', [ids.booking]);
    const ownThread = requireId((await as(
      ids.manager,
      'select public.support_start($1::text, $2::uuid, $3::text) as id',
      ['My own support request', null, 'General help'],
    ))[0], 'general support_start did not return a thread id');
    const own = await one('select user_id, booking_id from public.support_threads where id = $1::uuid', [ownThread]);
    ok(!!customerThread && /booking not found/i.test(managerStart ?? '') && managerRows.length === 0
      && /conversation not found/i.test(managerSend ?? '') && linkedRow?.id === customerThread
      && linkedRow?.user_id === ids.customer && linkedRow?.booking_id === ids.booking && own?.user_id === ids.manager
      && own?.booking_id === null,
    `linked booking access remains primary-participant-only while general support is personal: ${JSON.stringify({
      customerThread, managerStart, managerRows, managerSend, linkedRow, ownThread, own,
    })}`);
  });
});

await scenario('CM_SQL_SUPPORT_ADMIN_OWNER_BRANCH', async () => {
  await withSupportFixture(async ({ as, one }) => {
    const threadId = requireId((await as(
      ids.adminOwner,
      'select public.support_start($1::text, $2::uuid, $3::text) as id',
      ['Owner administrator request', null, 'Owner support'],
    ))[0], 'admin-owner support_start did not return a thread id');
    await as(ids.adminOwner, 'select public.support_send($1::uuid, $2::text)', [threadId, 'Owner-side admin follow-up']);
    const ownerFirst = await one(`
      select t.status, t.user_unread, t.admin_unread, m.sender_id, m.from_admin, m.body
        from public.support_threads t
        join public.support_messages m on m.thread_id = t.id
       where t.id = $1::uuid order by m.created_at desc limit 1
    `, [threadId]);
    await as(ids.adminOwner, 'select public.support_mark_read($1::uuid)', [threadId]);
    const afterOwnerRead = await one('select user_unread, admin_unread from public.support_threads where id = $1::uuid', [threadId]);
    ok(ownerFirst?.status === 'open' && ownerFirst?.sender_id === ids.adminOwner
      && ownerFirst?.from_admin === false && ownerFirst?.admin_unread === 2
      && afterOwnerRead?.user_unread === 0 && afterOwnerRead?.admin_unread === 2,
    `admin who owns the thread follows owner-first send/read branches: ${JSON.stringify({ ownerFirst, afterOwnerRead })}`);
  });
});

finish();

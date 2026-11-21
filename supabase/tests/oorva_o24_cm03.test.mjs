import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ok, scenario, finish } = createHarness();
const supportMigration = fs.readFileSync(path.join(here, '..', 'migrations', '0041_admin_support.sql'), 'utf8');

const policyBlock = supportMigration.match(
  /alter table public\.support_threads enable row level security;[\s\S]*?create policy support_messages_read[\s\S]*?;/,
)?.[0];
const supportSend = supportMigration.match(
  /create or replace function public\.support_send\([\s\S]*?\n\$\$;/,
)?.[0];

const owner = '00000000-0000-0000-0000-000000000101';
const outsider = '00000000-0000-0000-0000-000000000102';
const threadId = '00000000-0000-0000-0000-000000000201';
const messageId = '00000000-0000-0000-0000-000000000301';

await scenario('CM_SQL_SUPPORT_OTHER_DENIED', async () => {
  if (!policyBlock || !supportSend) throw new Error('0041 support policies or support_send definition were not found');
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create function public._require_uid() returns uuid language plpgsql stable as $$
      declare v_uid uuid := auth.uid();
      begin
        if v_uid is null then raise exception 'sign in required'; end if;
        return v_uid;
      end;
      $$;
      create function public._assert(p_condition boolean, p_message text) returns void language plpgsql as $$
      begin
        if not coalesce(p_condition, false) then raise exception '%', p_message; end if;
      end;
      $$;
      create function public._is_admin() returns boolean language sql stable as $$ select false $$;
      create table public.profiles (id uuid primary key);
      create table public.support_threads (id uuid primary key, user_id uuid not null);
      create table public.support_messages (
        id uuid primary key,
        thread_id uuid not null references public.support_threads(id),
        sender_id uuid not null references public.profiles(id),
        from_admin boolean not null default false,
        body text not null,
        created_at timestamptz not null default now()
      );
      insert into public.profiles (id) values ('${owner}'), ('${outsider}');
      insert into public.support_threads (id, user_id) values ('${threadId}', '${owner}');
      insert into public.support_messages (id, thread_id, sender_id, body)
        values ('${messageId}', '${threadId}', '${owner}', 'owner message');
      grant usage on schema public, auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    await db.exec(policyBlock);
    await db.exec(supportSend);

    const as = async (actor: string, query: string, params: unknown[] = []) => {
      await db.exec('reset role');
      await db.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [actor]);
      await db.exec('set role authenticated');
      try {
        return await db.query(query, params);
      } finally {
        await db.exec('reset role');
      }
    };

    const outsiderThreads = (await as(outsider, 'select id from public.support_threads')).rows;
    const outsiderMessages = (await as(outsider, 'select id from public.support_messages')).rows;
    const ownerThreads = (await as(owner, 'select id from public.support_threads')).rows;
    let sendError = '';
    try {
      await as(outsider, 'select public.support_send($1::uuid, $2::text)', [threadId, 'unauthorized reply']);
    } catch (error) {
      sendError = error instanceof Error ? error.message : String(error);
    }

    ok(outsiderThreads.length === 0, `outsider cannot read another user's support thread: ${JSON.stringify(outsiderThreads)}`);
    ok(outsiderMessages.length === 0, `outsider cannot read messages from another user's thread: ${JSON.stringify(outsiderMessages)}`);
    ok(ownerThreads.length === 1 && ownerThreads[0]?.id === threadId, `owner can still read their own thread: ${JSON.stringify(ownerThreads)}`);
    ok(/conversation not found/i.test(sendError), `outsider support_send remains denied: ${JSON.stringify({ sendError })}`);
  } finally {
    await db.close();
  }
});

finish();

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(here, '..', 'migrations', '0022_time_based_booking.sql'), 'utf8');
const db = new PGlite({ extensions: { pgcrypto } });
const CUSTOMER = '10000000-0000-0000-0000-000000000001';
const PROVIDER = '10000000-0000-0000-0000-000000000002';
const OTHER = '10000000-0000-0000-0000-000000000003';
let failures = 0;
const ok = (condition, message) => {
  if (condition) console.log(`ok  : ${message}`);
  else { failures += 1; console.log(`FAIL: ${message}`); }
};

await db.exec(`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create type public.booking_status as enum ('pending_payment','requested','accepted','en_route','in_progress','completion_requested','completed','cancelled');
create type public.payment_purpose as enum ('visit_fee','balance','fixed','advance','milestone','final','package','addon','session');
create table public.profiles(id uuid primary key);
create table public.providers(id uuid primary key, created_at timestamptz not null default now(), jobs_completed int not null default 0, suspended boolean not null default false, paused boolean not null default false, kyc_status text not null default 'verified');
create table public.categories(id uuid primary key, archetype text not null);
create table public.provider_services(id uuid primary key, provider_id uuid references providers(id), category_id uuid references categories(id), active boolean not null, labour_rate int not null default 10000);
create table public.service_packages(id uuid primary key, provider_service_id uuid not null references provider_services(id), title text not null default 'Session', unit text not null, price_type text not null, price int, qty_min numeric(10,2), qty_max numeric(10,2), duration_min int, active boolean not null default true);
create table public.addresses(id uuid primary key default gen_random_uuid(), user_id uuid, label text, line1 text, city text, lat double precision, lng double precision);
create table public.bookings(
 id uuid primary key default gen_random_uuid(), customer_id uuid, provider_id uuid, category_id uuid, provider_service_id uuid,
 address_id uuid, description text, scheduled_at timestamptz, status public.booking_status not null default 'pending_payment',
 visit_fee int not null default 0, platform_fee int not null default 0, total_amount int, commission int, gst_on_commission int,
 refund_amount int not null default 0, cancelled_reason text, completed_at timestamptz, updated_at timestamptz default now()
);
create table public.booking_secrets(booking_id uuid primary key references bookings(id), start_otp text not null, start_attempts int not null default 0, end_otp text, end_attempts int not null default 0);
create table public.booking_events(id bigint generated always as identity primary key, booking_id uuid references bookings(id), actor_id uuid, from_status public.booking_status, to_status public.booking_status, note text, at timestamptz default now());
create table public.payment_schedule(id uuid primary key default gen_random_uuid(), booking_id uuid references bookings(id), seq int, label text, amount int, due_rule text, due_at timestamptz, status text, payment_id uuid, unique(booking_id,seq));
create table public.payments(id uuid primary key default gen_random_uuid(), booking_id uuid references bookings(id), schedule_id uuid references payment_schedule(id), purpose public.payment_purpose, amount int, status text not null default 'created', razorpay_link_id text unique, razorpay_payment_id text unique, short_url text, cancel_link_pending boolean not null default false, created_at timestamptz not null default now(), paid_at timestamptz);
create table public.refunds(id uuid primary key default gen_random_uuid(), payment_id uuid references payments(id), amount int, status text not null, reason text);
create table public.payouts(id uuid primary key default gen_random_uuid(), booking_id uuid unique references bookings(id), provider_id uuid, gross int, commission int, gst_on_commission int, amount int, status text, release_after timestamptz);
create table public.payout_transfers(id uuid primary key default gen_random_uuid(), payout_id uuid references payouts(id), source_payment_id uuid references payments(id), amount int);
create table public.admins(user_id uuid primary key);
create function public._assert(condition boolean, message text) returns void language plpgsql as $$ begin if not coalesce(condition,false) then raise exception '%', message; end if; end; $$;
create function public._is_admin() returns boolean language sql stable as $$ select false $$;
create function public._require_uid() returns uuid language sql stable as $$ select auth.uid() $$;
create function public._provider_is_live(id uuid) returns boolean language sql stable as $$ select true $$;
create function public._category_docs_ok(provider_id uuid, category_id uuid) returns boolean language sql stable as $$ select true $$;
create function public._provider_slot_problem(provider_id uuid, at_time timestamptz, asap boolean) returns text language sql immutable as $$ select null::text $$;
create function public._gen_otp() returns text language sql as $$ select '4242'::text $$;
create function public._lock_booking(p_id uuid) returns public.bookings language plpgsql as $$ declare b public.bookings; begin select * into b from public.bookings x where x.id=p_id for update; return b; end; $$;
create function public._set_status(p_id uuid, next public.booking_status, actor uuid, note text default null) returns void language plpgsql as $$
declare prior public.booking_status; begin select status into prior from public.bookings where bookings.id=p_id; update public.bookings set status=next, updated_at=now() where bookings.id=p_id; insert into booking_events(booking_id,actor_id,from_status,to_status,note) values(p_id,actor,prior,next,note); end; $$;
create function public._queue_refund(p_payment uuid, p_amount int, p_reason text) returns int language plpgsql as $$
declare capacity int; begin select pm.amount - coalesce((select sum(r.amount) from refunds r where r.payment_id=p_payment),0) into capacity from payments pm where pm.id=p_payment; capacity:=least(capacity,p_amount); insert into refunds(payment_id,amount,status,reason) values(p_payment,capacity,'pending',p_reason) on conflict do nothing; return capacity; end; $$;
alter default privileges in schema public grant all on tables to authenticated,service_role;
grant all on all tables in schema public to service_role;
`);

await db.exec(migration);

const CATEGORY = '20000000-0000-0000-0000-000000000001';
const SERVICE = '20000000-0000-0000-0000-000000000002';
const PACKAGE = '20000000-0000-0000-0000-000000000003';
await db.exec(`
insert into profiles values ('${CUSTOMER}'),('${PROVIDER}'),('${OTHER}');
insert into providers(id) values ('${PROVIDER}');
insert into categories(id,archetype) values ('${CATEGORY}','time_based');
insert into provider_services(id,provider_id,category_id,active,labour_rate) values ('${SERVICE}','${PROVIDER}','${CATEGORY}',true,75000);
insert into service_packages(id,provider_service_id,title,unit,price_type,price,qty_min,qty_max,duration_min)
values ('${PACKAGE}','${SERVICE}','Five sessions','session','fixed',60000,3,5,60);
grant all on all tables in schema public to authenticated;
`);

async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role;'); }
}

const [{ purchase_session_pack: packId }] = await as(CUSTOMER, 'select purchase_session_pack($1,$2)', [PACKAGE, 5]);
const pack = (await db.query('select * from pack_purchases where id=$1', [packId])).rows[0];
ok(pack.price === 300000 && pack.platform_fee === 4900, 'pack server-prices five ₹600 sessions plus ₹49 fee');
const allocations = (await db.query('select sum(allocated_amount)::int total, count(*) count from pack_sessions where pack_id=$1', [packId])).rows[0];
ok(allocations.total === 300000 && allocations.count === 5, 'immutable pack allocation sums exactly to principal');

const [{ payment_id: paymentId }] = await db.query(`select payment_id from prepare_pack_payment($1,$2)`, [packId, CUSTOMER]).then((r) => r.rows);
await db.exec(`update payments set razorpay_link_id='plink_pack', short_url='https://pay' where id='${paymentId}'`);
await db.query('select record_pack_payment_paid($1,$2,$3)', ['plink_pack','pay_pack',304900]);
const active = (await db.query('select status from pack_purchases where id=$1', [packId])).rows[0].status;
ok(active === 'active', 'pack advances only after matching payment');

const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const [{ create_session_booking: bookingId }] = await as(CUSTOMER, `select create_session_booking($1,$2,$3,60,'1 Road','Vijayawada',16.5,80.6,'', $4)`,
  [SERVICE, PACKAGE, startsAt, packId]);
const session = (await db.query('select * from bookings where id=$1', [bookingId])).rows[0];
ok(session.status === 'requested' && session.total_amount === 60000 && session.platform_fee === 0, 'prepaid pack session preserves allocated money without another fee');
await db.exec(`update bookings set status='accepted', scheduled_at=now() where id='${bookingId}'`);
const start = (await as(PROVIDER, 'select start_session_booking($1,$2) as result', [bookingId, '4242']))[0].result;
ok(start.ok && (await db.query('select status from bookings where id=$1', [bookingId])).rows[0].status === 'in_progress', 'session OTP moves accepted directly to in_progress');

const startsOn = new Date();
startsOn.setDate(startsOn.getDate() + 1);
const [{ create_recurring_schedule: scheduleId }] = await as(CUSTOMER, `select create_recurring_schedule($1,$2,null,'per_session',array[1,3,5]::smallint[],'10:00','Asia/Kolkata',60,$3::date,null,'1 Road','Vijayawada',16.5,80.6,'')`,
  [SERVICE, PACKAGE, startsOn.toISOString().slice(0,10)]);
const created = (await db.query('select materialize_recurring_schedule($1,$2::date) count', [
  scheduleId,
  new Date(Date.now() + 28 * 86400000).toISOString().slice(0,10),
])).rows[0].count;
ok(created >= 8, 'weekly recurrence materializes distinct future session bookings');

let rlsBlocked = false;
try {
  const rows = await as(OTHER, 'select * from pack_purchases');
  rlsBlocked = rows.length === 0;
} catch {
  rlsBlocked = true;
}
ok(rlsBlocked, 'unrelated authenticated user cannot read pack purchases');

await db.exec(`update pack_purchases set expires_at=now()-interval '1 minute' where id='${packId}'`);
const expired = (await db.query('select expire_session_packs() count')).rows[0].count;
ok(expired === 1, 'expired packs use the cron refund path');

if (failures) process.exitCode = 1;

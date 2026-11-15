import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = (file) => fs.readFileSync(path.join(here, '..', 'migrations', file), 'utf8')
  .replace('create extension if not exists postgis with schema extensions;', '')
  .replaceAll('extensions.geography(Point, 4326)', 'extensions.geography')
  .replaceAll('using gist', 'using btree');
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
create schema extensions;
create type extensions.geography as (lng float8, lat float8);
create type extensions.geometry as (lng float8, lat float8);
create function extensions.st_makepoint(x float8,y float8) returns extensions.geography language sql immutable as $$ select row(x,y)::extensions.geography $$;
create function extensions.st_setsrid(g extensions.geography,i int) returns extensions.geography language sql immutable as $$ select g $$;
create function extensions.st_distance(a extensions.geography,b extensions.geography) returns float8 language sql immutable as $$ select 1000 $$;
create function extensions.st_dwithin(a extensions.geography,b extensions.geography,d float8) returns boolean language sql immutable as $$ select true $$;
create function extensions.geog_to_geom(g extensions.geography) returns extensions.geometry language sql immutable as $$ select row(g.lng,g.lat)::extensions.geometry $$;
create cast (extensions.geography as extensions.geometry) with function extensions.geog_to_geom(extensions.geography);
create function extensions.st_x(g extensions.geometry) returns float8 language sql immutable as $$ select g.lng $$;
create function extensions.st_y(g extensions.geometry) returns float8 language sql immutable as $$ select g.lat $$;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public,extensions to anon,authenticated,service_role;
create schema auth; grant usage on schema auth to anon,authenticated,service_role;
create table auth.users(instance_id uuid,id uuid primary key,aud text,role text,phone text,phone_confirmed_at timestamptz,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}',created_at timestamptz,updated_at timestamptz); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant execute on function auth.uid() to anon,authenticated,service_role;
create schema storage; grant usage on schema storage to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant select,insert,delete on storage.objects to authenticated,anon,service_role;
create function storage.foldername(n text) returns text[] language sql immutable as $$ select (string_to_array(n,'/'))[1:array_length(string_to_array(n,'/'),1)-1] $$;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
`);
for (const file of ['0001_init.sql','0002_qa_fixes.sql','0003_payout_transfer_payment_cascade.sql','0007_chat_unread_notifications.sql','0008_provider_kyc_status_values.sql','0009_provider_onboarding.sql','0010_notification_freshness.sql','0011_payout_rails.sql','0012_matching_foundations.sql','0013_review_matching.sql','0014_travel_requests.sql','0015_seva_coins.sql','0016_leakage_programme.sql','0017_creator_config.sql']) await db.exec(sql(file));

const C='00000000-0000-0000-0000-000000000071', P='00000000-0000-0000-0000-000000000072', S='00000000-0000-0000-0000-000000000073';
await db.exec(`insert into auth.users(id,phone) values ('${C}','+9101'),('${P}','+9102'),('${S}','+9103');
update profiles set full_name='Fixed user' where id in ('${C}','${P}','${S}');
insert into providers(id,city,kyc_status,is_online,paused,suspended,submitted_at) values ('${P}','Core City','verified',true,false,false,now());`);
const category=(await db.query(`select id from categories where slug='house-cleaning'`)).rows[0].id;
const service=(await db.query(`insert into provider_services(provider_id,category_id,visit_fee,labour_rate,active) values ('${P}','${category}',0,0,true) returning id`)).rows[0].id;
await db.exec(`insert into app_config(key,value) values ('launch_city','"Core City"') on conflict do nothing;`);
await db.exec(sql('0018_archetype_core.sql'));
await db.exec(`insert into package_templates(category_id,title,price_type,price,price_min,price_max,unit,duration_min,qty_min,qty_max)
select '${category}','Flat clean','fixed',12000,12000,12000,'job',90,1,1 where not exists(select 1 from package_templates where category_id='${category}' and title='Flat clean');`);
const pkg=(await db.query(`insert into service_packages(provider_service_id,title,price_type,price,price_min,price_max,unit,duration_min,qty_min,qty_max,active)
values ('${service}','Deep clean','fixed',12000,12000,12000,'job',90,1,1,true) returning id`)).rows[0].id;
await db.exec(sql('0019_fixed_package_booking.sql'));
await db.exec(`update app_config set value=value||'{"fixed":true}'::jsonb where key='archetype_flags';
update categories set archetype='fixed',payment_template='full_upfront' where id='${category}';
update app_config set value=value||'{"enabled":true}'::jsonb where key='fixed_booking';`);

let failures=0;
const ok=(v,m)=>{console.log(v?'ok  :':'FAIL:',m);if(!v)failures++};
async function as(uid,role,q,p=[]){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${uid??''}',false);set role ${role};`);try{return(await db.query(q,p)).rows}finally{await db.exec('reset role')}}
async function err(fn,re,m){try{await fn();ok(false,m+' (no error)')}catch(e){ok(re.test(e.message),m+' -> '+e.message)}}
const customer=(q,p)=>as(C,'authenticated',q,p), provider=(q,p)=>as(P,'authenticated',q,p), stranger=(q,p)=>as(S,'authenticated',q,p), serviceRole=(q,p)=>as(null,'service_role',q,p);
const start=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+86400000+2*3600000).toISOString();
const booking=(await customer(`select create_fixed_booking($1,1,tstzrange($2::timestamptz,$3::timestamptz,'[)'),
'{"mode":"at_customer","address_line":"1 Test Road","city":"Core City","lat":16.5,"lng":80.6}'::jsonb,'{}'::jsonb) id`,[pkg,start,end]))[0].id;
const q=(await serviceRole(`select b.total_amount,b.platform_fee,b.archetype,q.total,q.quote_type,jsonb_array_length(q.package_snapshot->'inclusions') inclusions from bookings b join quotes q on q.booking_id=b.id where b.id=$1`,[booking]))[0];
ok(q.total===12000&&q.total_amount===14900&&q.platform_fee===2900&&q.archetype==='fixed'&&q.quote_type==='package','server prices package and charges platform fee once');
ok((await serviceRole(`select * from payment_schedule where booking_id=$1 order by seq`,[booking])).map(x=>x.amount).join(',')==='12000,2900','full upfront creates service and platform obligations');
await err(()=>serviceRole(`update quotes set total=1 where booking_id='${booking}'`),/immutable/,'package quote remains immutable');
ok((await stranger(`select * from payment_schedule where booking_id='${booking}'`)).length===0,'payment schedules are participant scoped');

const p1=await serviceRole(`select * from prepare_payment($1,$2)`,[booking,C]);
await serviceRole(`update payments set razorpay_link_id='link-1',short_url='https://x/1' where id='${p1[0].payment_id}'`);
const p2=await serviceRole(`select * from prepare_payment($1,$2)`,[booking,C]);
ok(p1[0].payment_id===p2[0].payment_id&&p1[0].amount===12000,'one live attempt is reused for one schedule');
await serviceRole(`select record_payment_paid('link-1','pay-1',12000)`);
const pFee=await serviceRole(`select * from prepare_payment($1,$2)`,[booking,C]);
await serviceRole(`update payments set razorpay_link_id='link-2',short_url='https://x/2' where id='${pFee[0].payment_id}'`);
await serviceRole(`select record_payment_paid('link-2','pay-2',2900)`);
ok((await serviceRole(`select status from bookings where id='${booking}'`))[0].status==='requested','fixed quote activates only after every upfront obligation is paid');
await provider(`select accept_booking('${booking}')`); await provider(`select start_trip('${booking}')`);
const otp=(await customer(`select * from get_booking_otps('${booking}')`))[0].start_otp;
const arrival=(await provider(`select arrive($1,$2) r`,[booking,otp]))[0].r;
ok(arrival.ok&&(await serviceRole(`select status from bookings where id='${booking}'`))[0].status==='in_progress','fixed OTP arrival skips inspect state');
const addon=(await provider(`select send_fixed_addons($1,$2::jsonb,'extra') id`,[booking,JSON.stringify([{title:'Sanitise',qty:1,unit:'job',unit_price:5000}])]))[0].id;
const approved=(await customer(`select approve_fixed_change_order($1,$2) x`,[booking,addon]))[0].x;
ok(approved.amount_due===5000,'add-on charges only net difference');
await err(()=>customer(`select create_fixed_booking($1,2,tstzrange($2::timestamptz,$3::timestamptz,'[)'),'{\"mode\":\"at_customer\",\"address_line\":\"x\",\"city\":\"Core City\",\"lat\":16.5,\"lng\":80.6}'::jsonb,'{}')`,[pkg,start,end]),/bounds/,'package quantity is server checked');
console.log(failures===0?'\\nALL FIXED BOOKING CHECKS PASSED':`\\n${failures} FAILURE(S)`);
process.exit(failures?1:0);

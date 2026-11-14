-- =====================================================================================================
-- QuickServe FULL demo data (dev/test projects only). Requires migrations/0001_init.sql.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--   (It runs as postgres, so RLS is bypassed. The editor may warn about a destructive operation: the
--    only DELETE removes bookings created by THIS script so they can be re-created fresh.)
--   Safe to re-run at any time: fixed ids + upserts. A re-run RESETS every seeded booking to the state
--   below (and refreshes the 15-minute "requested" countdowns). Data you created in the app is untouched.
--   Works with or without supabase/seed.sql having been run (its 3 provider ids are reused / created).
--
-- LOGINS (Auth -> Sign In / Providers -> Phone -> "Test Phone Numbers and OTPs")
--   Founder (you)               : +91 99999 99999  -> 919999999999=123456
--   Optional extra test numbers : 919000000104=123456   (Venkata Ramana, provider - AC/appliance)
--                                 919000000201=123456   (Anjali Reddy, customer - booked YOUR AC service)
--                                 919000000101=123456   (Ravi Kumar, provider from seed.sql - your AC quote)
--   Paste them comma separated:  919999999999=123456,919000000104=123456,919000000201=123456,919000000101=123456
--   If +91 99999 99999 has never signed in, this script creates that auth user (id f0000000-5eed-5eed-...)
--   so it still runs; signing in later with the test OTP uses that same user.
--
-- YOUR BOOKINGS AS CUSTOMER (booking # = first 8 chars of the id, as shown in the app)
--   #fc000001 pending_payment       Plumber (Suresh)            pay the visit fee to move it on
--   #fc000002 requested             Electrician (Lakshmi)       start OTP 3816 (shown after she accepts)
--   #fc000003 accepted              House Cleaning (Durga)      START OTP 4821 (visible now)
--   #fc000004 en_route              Car Mechanic (Satish)       START OTP 5193 (visible now)
--   #fc000005 inspecting            Pest Control (PestGuard)
--   #fc000006 quote_sent            AC Repair (Ravi)            quote v1: labour 1,500 + capacitor 650 -> you pay 1,980 now
--   #fc000007 awaiting_payment      Appliance Repair (Madhavi)  quote approved, balance due 1,830
--   #fc000008 in_progress           Painter (Colour Craft)      change order v2 waiting for you: +2,200
--   #fc000009 completion_requested  Carpenter (Yesu Babu)       END OTP 7350 (visible now)
--   #fc000010 completed             Electrician (Srinivas Rao)  not reviewed yet -> leave a review
--   #fc000011 closed                Plumber (Nagaraju)          reviewed 5 stars
--   #fc000012 closed_no_work        Bike Mechanic (Shaik)       quote rejected, visit fee kept by pro
--   #fc000013 declined              Water Tank (Ramesh)         visit fee refunded
--   #fc000014 expired               Car Mechanic (Gopi)         visit fee refunded
--   #fc000015 cancelled             House Cleaning (Anitha)     visit fee refunded
--   #fc000016 disputed              AC Repair (Venkata Ramana)  payout frozen
--   #fc000017 refunded              Pest Control (Eswar)        full refund after dispute
-- YOUR JOBS AS PROVIDER (switch role in the app; you offer AC Repair + Electrician)
--   #fb000001 requested             Anjali  (AC)      ~13 min left on the countdown; start OTP 1739
--   #fb000002 requested             Rahul   (Elec.)   ~8 min left;                      start OTP 2604
--   #fb000003 accepted              Kalyan  (AC)      start OTP 6284 (tap Start trip, then enter it)
--   #fb000004 inspecting            Sneha   (Elec.)   send a quote
--   #fb000005 in_progress           Padmavathi (AC)   request completion
--   #fb000006 completion_requested  Fatima  (Elec.)   END OTP 9152 (enter it to complete)
--   #fb000007/#fb000008 completed (payouts pending), #fb000009-#fb000012 closed (paid out),
--   #fb000013 closed_no_work -> Earnings shows today / this week / pending / paid.
--
-- NOTES
--   * "requested" bookings expire 15 min after creation if the release-payouts cron runs, and
--     completion_requested ones auto-confirm after 24 h. Re-run this script to reset them.
--   * Money is integer paise and follows app/src/lib/money.ts + docs/03 exactly: visit fee credited,
--     Rs 29 platform fee once, 12% commission on labour only (0% in a provider's first 30 days),
--     18% GST on commission, payout transfers sourced visit-fee payment first.
--   * New seeded providers have no razorpay_account_id, so the payout cron never tries real transfers
--     for them; payment/refund/transfer ids are fake (pay_seed_*, rfnd_seed_*, trf_seed_*).
-- =====================================================================================================

begin;

-- -----------------------------------------------------------------------------------------------------
-- Session-local helpers (pg_temp: nothing is left behind in the schema)
-- -----------------------------------------------------------------------------------------------------
-- Deterministic seed ids. Group 3 is '5eed', which a gen_random_uuid() (version 4) id can never have.
create or replace function pg_temp.sid(p_key text) returns uuid
language sql immutable as $$
  select (substr(h, 1, 8) || '-5eed-5eed-' || substr(h, 17, 4) || '-' || substr(h, 21, 12))::uuid
    from (select md5('quickserve-seed:' || p_key) as h) x
$$;

create or replace function pg_temp.otp(p_key text) returns text
language sql immutable as $$
  select substr(regexp_replace(md5('otp:' || p_key), '[^0-9]', '', 'g') || '0000', 1, 4)
$$;

create or replace function pg_temp.at_status(p_path text[], p_ts timestamptz[], p_status text) returns timestamptz
language sql immutable as $$
  select p_ts[array_position(p_path, p_status)]
$$;

-- Mirrors public._commission_bp() / money.ts commissionRateBp() at time p_at.
create or replace function pg_temp.bp(p_provider uuid, p_at timestamptz, p_booking uuid) returns int
language sql stable as $$
  select case
           when p_at < p.created_at + interval '30 days' then 0
           when c.jobs >= 200 then 800
           when c.jobs >= 50 then 1000
           else 1200
         end
    from public.providers p
    cross join lateral (select count(*) as jobs from public.bookings b
                         where b.provider_id = p.id and b.completed_at < p_at and b.id <> p_booking) c
   where p.id = p_provider
$$;

-- Inserts quote lines and sets the quote subtotals exactly like public.send_quote().
create or replace function pg_temp.add_items(p_quote uuid, p_items jsonb) returns void
language plpgsql as $$
declare
  v jsonb;
  k int := 0;
  l int := 0;
  pa int := 0;
  o int := 0;
  line int;
begin
  for v in select value from jsonb_array_elements(p_items) loop
    k := k + 1;
    line := round((v ->> 'qty')::numeric * (v ->> 'unit_price')::int);
    case v ->> 'kind'
      when 'labour' then l := l + line;
      when 'part' then pa := pa + line;
      else o := o + line;
    end case;
    insert into public.quote_items (id, quote_id, kind, title, qty, unit_price, bill_photo_url)
    values (pg_temp.sid(p_quote::text || ':item' || k), p_quote, (v ->> 'kind')::public.quote_item_kind,
            v ->> 'title', (v ->> 'qty')::numeric, (v ->> 'unit_price')::int, nullif(v ->> 'bill_photo_url', ''));
  end loop;
  update public.quotes set subtotal_labour = l, subtotal_parts = pa, subtotal_other = o, total = l + pa + o
   where id = p_quote;
end;
$$;

-- Creates one booking already in p_final, with the rows the RPC state machine would have produced on the
-- way there: booking_secrets, visit-fee + balance payments, quote v1 (+items), payout + payout_transfers,
-- refunds and the booking_events audit trail. Step k of the path happens at p_created + k * p_step
-- ('closed' = payout transferred 24h20m after completion; 'expired' = 15 min after the request).
create or replace function pg_temp.mk_booking(
  p_id uuid, p_customer uuid, p_provider uuid, p_slug text, p_final text,
  p_created timestamptz, p_step interval, p_desc text,
  p_items jsonb default null, p_start_otp text default null, p_end_otp text default null,
  p_reason text default null, p_address uuid default null
) returns void
language plpgsql as $$
declare
  c_platform constant int := 2900;
  full_path constant text[] := array['pending_payment', 'requested', 'accepted', 'en_route', 'inspecting', 'quote_sent',
                                     'awaiting_payment', 'in_progress', 'completion_requested', 'completed', 'closed'];
  v_path text[];
  v_ts timestamptz[] := '{}';
  n int;
  i int;
  ps record;
  pm record;
  v_addr uuid;
  v_key text := left(replace(p_id::text, '-', ''), 16);
  v_visit uuid := pg_temp.sid(p_id::text || ':visit');
  v_bal uuid := pg_temp.sid(p_id::text || ':balance');
  v_quote uuid := pg_temp.sid(p_id::text || ':q1');
  v_po uuid := pg_temp.sid(p_id::text || ':payout');
  v_lab int := 0;
  v_tot int := 0;
  v_req int;
  v_qstatus text;
  v_done timestamptz;
  v_gross int;
  v_base int;
  v_bp int;
  v_comm int;
  v_gst int;
  v_amt int;
  v_take int;
  v_released timestamptz;
  v_po_status text;
  v_tr_status text;
  v_refunded int := 0;
  v_actor uuid;
  v_note text;
begin
  if p_final = 'pending_payment' then
    v_path := full_path[1:1];
  elsif p_final = 'requested' then
    v_path := full_path[1:2];
  elsif p_final in ('declined', 'expired', 'cancelled') then
    v_path := full_path[1:2] || p_final;
  elsif p_final = 'closed_no_work' then
    v_path := full_path[1:6] || p_final;
  elsif p_final = 'disputed' then
    v_path := full_path[1:10] || array['disputed'];
  elsif p_final = 'refunded' then
    v_path := full_path[1:10] || array['disputed', 'refunded'];
  else
    i := array_position(full_path, p_final);
    if i is null then
      raise exception 'seed: unknown status %', p_final;
    end if;
    v_path := full_path[1:i];
  end if;
  n := array_length(v_path, 1);
  for i in 1..n loop
    v_ts := v_ts || case v_path[i]
                      when 'closed' then v_ts[i - 1] + interval '24 hours 20 minutes'
                      when 'expired' then v_ts[i - 1] + interval '15 minutes'
                      else p_created + p_step * (i - 1)
                    end;
  end loop;

  select s.id, s.category_id, s.visit_fee into ps
    from public.provider_services s join public.categories c on c.id = s.category_id
   where s.provider_id = p_provider and c.slug = p_slug;
  if not found then
    raise exception 'seed: provider % has no % service', p_provider, p_slug;
  end if;
  v_addr := coalesce(p_address, (select a.id from public.addresses a where a.user_id = p_customer
                                   order by a.is_default desc, a.created_at limit 1));

  insert into public.bookings (id, customer_id, provider_id, category_id, provider_service_id, address_id, description,
                               status, visit_fee, platform_fee, cancelled_reason, created_at, updated_at,
                               accepted_at, completion_requested_at, completed_at)
  values (p_id, p_customer, p_provider, ps.category_id, ps.id, v_addr, p_desc,
          p_final::public.booking_status, ps.visit_fee, c_platform,
          case when p_final in ('declined', 'cancelled') then p_reason end,
          v_ts[1], v_ts[n],
          pg_temp.at_status(v_path, v_ts, 'accepted'),
          pg_temp.at_status(v_path, v_ts, 'completion_requested'),
          pg_temp.at_status(v_path, v_ts, 'completed'));

  insert into public.booking_secrets (booking_id, start_otp, end_otp)
  values (p_id, coalesce(p_start_otp, pg_temp.otp(p_id::text || 's')),
          case when 'completion_requested' = any (v_path) then coalesce(p_end_otp, pg_temp.otp(p_id::text || 'e')) end);

  if 'requested' = any (v_path) then
    insert into public.payments (id, booking_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, created_at, paid_at)
    values (v_visit, p_id, 'visit_fee', ps.visit_fee, 'paid', 'plink_seed_' || v_key || 'v', 'pay_seed_' || v_key || 'v',
            v_ts[1], v_ts[2]);
  end if;

  if 'quote_sent' = any (v_path) then
    if p_items is null then
      raise exception 'seed: booking % needs quote items', p_id;
    end if;
    v_qstatus := case
                   when p_final = 'quote_sent' then 'sent'
                   when p_final = 'closed_no_work' then 'rejected'
                   when p_final = 'awaiting_payment' then 'approved_pending_payment'
                   else 'approved'
                 end;
    insert into public.quotes (id, booking_id, version, status, is_change_order, total, created_at)
    values (v_quote, p_id, 1, v_qstatus::public.quote_status, false, 0, pg_temp.at_status(v_path, v_ts, 'quote_sent'));
    perform pg_temp.add_items(v_quote, p_items);
    select q.subtotal_labour, q.total into v_lab, v_tot from public.quotes q where q.id = v_quote;
    v_req := greatest(v_tot, ps.visit_fee) + c_platform;          -- public._required_total()
  end if;

  if 'in_progress' = any (v_path) then
    insert into public.payments (id, booking_id, quote_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id,
                                 created_at, paid_at)
    values (v_bal, p_id, v_quote, 'balance', v_req - ps.visit_fee, 'paid',
            'plink_seed_' || v_key || 'b', 'pay_seed_' || v_key || 'b',
            pg_temp.at_status(v_path, v_ts, 'awaiting_payment'), pg_temp.at_status(v_path, v_ts, 'in_progress'));
    update public.bookings set approved_quote_id = v_quote, total_amount = v_req where id = p_id;
  end if;

  -- Payout: public._create_payout() on completion, or on quote rejection (closed_no_work).
  v_done := coalesce(pg_temp.at_status(v_path, v_ts, 'completed'), pg_temp.at_status(v_path, v_ts, 'closed_no_work'));
  if v_done is not null then
    if p_final = 'closed_no_work' then
      v_gross := ps.visit_fee;
      v_base := ps.visit_fee;
    else
      v_gross := greatest(v_tot, ps.visit_fee);
      v_base := v_lab;
    end if;
    v_bp := pg_temp.bp(p_provider, v_done, p_id);
    v_comm := round(v_base::numeric * v_bp / 10000);
    v_gst := round(v_comm::numeric * 18 / 100);
    v_amt := greatest(v_gross - v_comm - v_gst, 0);
    v_released := v_done + interval '24 hours 20 minutes';
    v_po_status := case
                     when p_final = 'closed' then 'transferred'
                     when p_final = 'closed_no_work' and v_released <= now() then 'transferred'
                     when p_final = 'disputed' then 'frozen'
                     when p_final = 'refunded' then 'reversed'
                     else 'pending'
                   end;
    v_tr_status := case v_po_status when 'transferred' then 'transferred' when 'reversed' then 'failed' else 'pending' end;
    insert into public.payouts (id, booking_id, provider_id, gross, commission, gst_on_commission, amount, status,
                                release_after, created_at, transferred_at)
    values (v_po, p_id, p_provider, v_gross, v_comm, v_gst, case when v_po_status = 'reversed' then 0 else v_amt end,
            v_po_status::public.payout_status, v_done + interval '24 hours', v_done,
            case when v_po_status = 'transferred' then v_released end);
    update public.bookings set commission = v_comm, gst_on_commission = v_gst where id = p_id;
    -- public._allocate_payout(): visit-fee payment first, then the balance payment.
    v_take := least(ps.visit_fee, v_amt);
    if v_take > 0 then
      insert into public.payout_transfers (id, payout_id, source_payment_id, amount, razorpay_transfer_id, status,
                                           last_error, created_at, transferred_at)
      values (pg_temp.sid(p_id::text || ':tv'), v_po, v_visit, v_take,
              case when v_tr_status = 'transferred' then 'trf_seed_' || v_key || 'v' end,
              v_tr_status::public.transfer_status,
              case when v_tr_status = 'failed' then 'dispute: full refund' end, v_done,
              case when v_tr_status = 'transferred' then v_released end);
    end if;
    if v_amt - v_take > 0 then
      insert into public.payout_transfers (id, payout_id, source_payment_id, amount, razorpay_transfer_id, status,
                                           last_error, created_at, transferred_at)
      values (pg_temp.sid(p_id::text || ':tb'), v_po, v_bal, v_amt - v_take,
              case when v_tr_status = 'transferred' then 'trf_seed_' || v_key || 'b' end,
              v_tr_status::public.transfer_status,
              case when v_tr_status = 'failed' then 'dispute: full refund' end, v_done,
              case when v_tr_status = 'transferred' then v_released end);
    end if;
  end if;

  -- Refunds (already processed at the gateway, so the refund cron has nothing to retry).
  if p_final in ('declined', 'expired', 'cancelled', 'refunded') then
    for pm in select * from public.payments where booking_id = p_id and status = 'paid' order by paid_at loop
      insert into public.refunds (id, payment_id, amount, reason, status, razorpay_refund_id, created_at, processed_at)
      values (pg_temp.sid(pm.id::text || ':refund'), pm.id, pm.amount,
              case p_final when 'declined' then 'declined by provider' when 'expired' then 'request expired'
                           when 'cancelled' then 'cancelled by customer' else 'dispute: full refund' end,
              'refunded', 'rfnd_seed_' || left(replace(pm.id::text, '-', ''), 16), v_ts[n],
              least(v_ts[n] + interval '2 hours', now()));
      update public.payments set status = 'refunded' where id = pm.id;
      v_refunded := v_refunded + pm.amount;
    end loop;
    if p_final = 'refunded' then
      update public.bookings set refund_amount = v_refunded where id = p_id;
    end if;
  end if;

  for i in 1..n loop
    v_actor := case v_path[i]
                 when 'pending_payment' then p_customer
                 when 'awaiting_payment' then p_customer
                 when 'closed_no_work' then p_customer
                 when 'cancelled' then p_customer
                 when 'disputed' then p_customer
                 when 'accepted' then p_provider
                 when 'en_route' then p_provider
                 when 'inspecting' then p_provider
                 when 'quote_sent' then p_provider
                 when 'completion_requested' then p_provider
                 when 'completed' then p_provider
                 when 'declined' then p_provider
               end;
    v_note := case v_path[i]
                when 'requested' then 'visit fee paid'
                when 'quote_sent' then 'quote v1'
                when 'awaiting_payment' then 'quote v1 approved, due ' || (v_req - ps.visit_fee)
                when 'in_progress' then 'balance paid'
                when 'completed' then 'end code verified'
                when 'closed' then 'payout transferred'
                when 'closed_no_work' then 'quote v1 rejected'
                when 'expired' then 'not accepted within 15 minutes'
                when 'refunded' then 'dispute: full refund'
                when 'declined' then p_reason
                when 'cancelled' then p_reason
                when 'disputed' then p_reason
              end;
    insert into public.booking_events (booking_id, actor_id, from_status, to_status, note, at)
    values (p_id, v_actor, case when i > 1 then v_path[i - 1]::public.booking_status end,
            v_path[i]::public.booking_status, v_note, v_ts[i]);
  end loop;
end;
$$;

create or replace function pg_temp.mk_review(
  p_booking uuid, p_rating int, p_punctuality int, p_quality int, p_behaviour int, p_pricing int,
  p_comment text, p_reply text, p_at timestamptz
) returns void
language sql as $$
  insert into public.reviews (id, booking_id, customer_id, provider_id, rating, punctuality, quality, behaviour, pricing,
                              comment, provider_reply, created_at)
  select pg_temp.sid(b.id::text || ':review'), b.id, b.customer_id, b.provider_id, p_rating, p_punctuality, p_quality,
         p_behaviour, p_pricing, p_comment, p_reply, p_at
    from public.bookings b
   where b.id = p_booking
  on conflict (booking_id) do nothing;
$$;

-- Chat lines are 'C: ...' (customer) or 'P: ...' (provider), 3 minutes apart starting at p_start.
create or replace function pg_temp.mk_msgs(p_booking uuid, p_start timestamptz, p_lines text[]) returns void
language plpgsql as $$
declare
  b public.bookings;
  k int;
begin
  select * into b from public.bookings where id = p_booking;
  for k in 1..array_length(p_lines, 1) loop
    insert into public.messages (id, booking_id, sender_id, body, created_at)
    values (pg_temp.sid(p_booking::text || ':msg' || k), p_booking,
            case when left(p_lines[k], 2) = 'C:' then b.customer_id else b.provider_id end,
            trim(substr(p_lines[k], 3)), p_start + interval '3 minutes' * (k - 1))
    on conflict (id) do nothing;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 1. Founder account (+91 99999 99999 is stored as '919999999999')
-- -----------------------------------------------------------------------------------------------------
-- Only if he has never signed in: create the auth user with a fixed id so the script still runs.
insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', 'f0000000-5eed-5eed-8000-000000000000', 'authenticated', 'authenticated',
       '919999999999', now(), '{"provider":"phone","providers":["phone"]}', '{"full_name":"QuickServe Founder"}',
       now() - interval '200 days', now()
 where not exists (select 1 from auth.users where phone in ('919999999999', '+919999999999'))
on conflict do nothing;

create temp table seed_ctx on commit drop as
select id as founder from auth.users where phone in ('919999999999', '+919999999999') order by created_at limit 1;

create or replace function pg_temp.founder() returns uuid
language sql stable as $$ select founder from seed_ctx $$;

-- -----------------------------------------------------------------------------------------------------
-- 2. Reset bookings previously created by this script (children cascade). Re-created below.
-- -----------------------------------------------------------------------------------------------------
delete from public.bookings where id::text like '________-5eed-5eed-%';

-- -----------------------------------------------------------------------------------------------------
-- 3. Reference data for this run
-- -----------------------------------------------------------------------------------------------------
create temp table seed_providers (
  id uuid primary key, nn int, phone text, full_name text, bio text, lat float8, lng float8, radius int, years int,
  languages text[], kyc text, online boolean, created_days int, ratings text, extra int
) on commit drop;

-- ratings = the star rating of each reviewed historical job, in order; extra = completed jobs left unreviewed.
insert into seed_providers values
  ('11111111-1111-1111-1111-111111111111', 1, '919000000101', 'Ravi Kumar', 'Split & window AC specialist. Gas refill, PCB repair.',
   16.5062, 80.6480, 15, 8, '{Telugu,Hindi}', 'verified', true, 420, '5545554', 1),
  ('22222222-2222-2222-2222-222222222222', 2, '919000000102', 'Lakshmi Electricals', 'House wiring, MCB, inverter installation.',
   16.5150, 80.6300, 10, 5, '{Telugu,English}', 'verified', true, 380, '554543', 1),
  ('33333333-3333-3333-3333-333333333333', 3, '919000000103', 'Suresh Plumbing', 'Leak fixing, bathroom fittings, tank connections.',
   16.4990, 80.6600, 12, 3, '{Telugu}', 'verified', false, 300, '45534', 1),
  ('a0000004-5eed-5eed-8000-000000000000', 4, '919000000104', 'Venkata Ramana',
   'Certified HVAC technician (ex-Voltas service partner). Split, window and cassette ACs; washing machines and refrigerators.',
   16.4930, 80.6670, 12, 12, '{Telugu,Hindi,English}', 'verified', true, 600, '5555455', 1),
  ('a0000005-5eed-5eed-8000-000000000000', 5, '919000000105', 'Mohammed Irfan',
   'Quick, tidy AC servicing and home electrical repairs. Available evenings and Sundays.',
   16.5170, 80.6080, 10, 6, '{Urdu,Telugu,Hindi}', 'verified', true, 400, '454453', 1),
  ('a0000006-5eed-5eed-8000-000000000000', 6, '919000000106', 'Srinivas Rao Electricals',
   'Licensed electrical contractor. Full house wiring, DB/MCB upgrades, earthing and inverter setup.',
   16.5120, 80.6250, 12, 15, '{Telugu,English}', 'verified', false, 700, '5455', 1),
  ('a0000007-5eed-5eed-8000-000000000000', 7, '919000000107', 'Prasad Kumar',
   'ITI electrician, also handles small plumbing jobs. Affordable rates.',
   16.5390, 80.6330, 10, 2, '{Telugu}', 'verified', true, 300, '43524', 1),
  ('a0000008-5eed-5eed-8000-000000000000', 8, '919000000108', 'Nagaraju Pipes & Fittings',
   'Bathroom fittings, concealed leaks, motor and sump connections. Water tank cleaning too.',
   16.5310, 80.5990, 15, 11, '{Telugu,Hindi}', 'verified', true, 650, '554554', 1),
  ('a0000009-5eed-5eed-8000-000000000000', 9, '919000000109', 'Durga Bhavani Cleaning Services',
   'Team of 4 women cleaners. Deep cleaning for flats and villas, sofa shampooing, overhead tank cleaning.',
   16.5200, 80.6600, 12, 7, '{Telugu,English}', 'verified', true, 500, '555545', 1),
  ('a0000010-5eed-5eed-8000-000000000000', 10, '919000000110', 'Anitha Home Care',
   'Kitchen and bathroom deep cleaning with eco-friendly chemicals.',
   16.5100, 80.6400, 10, 4, '{Telugu}', 'verified', true, 350, '45545', 1),
  ('a0000011-5eed-5eed-8000-000000000000', 11, '919000000111', 'Kiran Sparkle Cleaners',
   'Budget home cleaning for students and bachelors.',
   16.4850, 80.6950, 8, 1, '{Telugu,Hindi}', 'verified', false, 220, '3421', 0),
  ('a0000012-5eed-5eed-8000-000000000000', 12, '919000000112', 'Ramesh Tank Cleaners',
   'Mechanised tank cleaning with UV disinfection. General pest control for homes.',
   16.5170, 80.6880, 15, 9, '{Telugu}', 'verified', true, 550, '55445', 1),
  ('a0000013-5eed-5eed-8000-000000000000', 13, '919000000113', 'Satish Auto Works',
   'Multi-brand car workshop owner. Doorstep diagnostics, battery, brakes and car AC gas.',
   16.4900, 80.6800, 15, 18, '{Telugu,Hindi,English}', 'verified', true, 800, '554554', 1),
  ('a0000014-5eed-5eed-8000-000000000000', 14, '919000000114', 'Gopi Car Care',
   'Car and bike servicing at your doorstep. Hyundai and Maruti specialist.',
   16.4920, 80.6760, 12, 8, '{Telugu}', 'verified', false, 450, '4535', 1),
  ('a0000015-5eed-5eed-8000-000000000000', 15, '919000000115', 'Shaik Bike Point',
   'Two-wheeler repairs, puncture, chain sets and engine work. Hero, Honda and Bajaj.',
   16.5010, 80.6450, 8, 6, '{Urdu,Telugu}', 'verified', true, 380, '45455', 1),
  ('a0000016-5eed-5eed-8000-000000000000', 16, '919000000116', 'Raju Two Wheeler Clinic',
   'Royal Enfield and KTM specialist. Certified by Bajaj service training.',
   16.5240, 80.6330, 10, 13, '{Telugu}', 'verified', true, 620, '55545', 1),
  ('a0000017-5eed-5eed-8000-000000000000', 17, '919000000117', 'Madhavi Appliance Solutions',
   'Washing machines, fridges, microwaves and RO purifiers. Genuine spares with bill.',
   16.4995, 80.6560, 12, 10, '{Telugu,English}', 'verified', true, 520, '555455', 1),
  ('a0000018-5eed-5eed-8000-000000000000', 18, '919000000118', 'Hari Krishna Electronics',
   'TV, mixer and geyser repairs. Also basic AC servicing.',
   16.5140, 80.6510, 10, 3, '{Telugu}', 'verified', true, 260, '4341', 0),
  ('a0000019-5eed-5eed-8000-000000000000', 19, '919000000119', 'Chandra Sekhar (PestGuard)',
   'Government-licensed pest control. Termite, bed bug, cockroach and mosquito treatments with warranty.',
   16.5010, 80.6600, 15, 14, '{Telugu,English,Hindi}', 'verified', true, 750, '55455', 1),
  ('a0000020-5eed-5eed-8000-000000000000', 20, '919000000120', 'Eswar Pest Control',
   'Odourless herbal pest control, safe for kids and pets.',
   16.4920, 80.6720, 10, 5, '{Telugu}', 'verified', false, 330, '4543', 1),
  ('a0000021-5eed-5eed-8000-000000000000', 21, '919000000121', 'Yesu Babu Woodworks',
   'Furniture repair, modular kitchen fixes, door and window work. Also does painting touch-ups.',
   16.4970, 80.6220, 12, 20, '{Telugu}', 'verified', true, 900, '555545', 1),
  ('a0000022-5eed-5eed-8000-000000000000', 22, '919000000122', 'Appa Rao Carpentry',
   'Wardrobes, shelves and wooden repairs. Polish work available.',
   16.5280, 80.5920, 12, 9, '{Telugu}', 'verified', true, 480, '4545', 1),
  ('a0000023-5eed-5eed-8000-000000000000', 23, '919000000123', 'Naresh (Colour Craft Painters)',
   'Asian Paints certified applicator. Interior, exterior, texture and waterproofing.',
   16.5190, 80.6850, 15, 12, '{Telugu,Hindi}', 'verified', true, 680, '55455', 1),
  ('a0000024-5eed-5eed-8000-000000000000', 24, '919000000124', 'Sai Teja Painting & Carpentry',
   'New on QuickServe! Small painting and carpentry jobs, quick turnaround.',
   16.5260, 80.7180, 12, 2, '{Telugu,English}', 'verified', true, 20, '54', 1),
  -- KYC pending: must NOT appear in search even though one is online.
  ('a0000025-5eed-5eed-8000-000000000000', 25, '919000000125', 'Vamsi Krishna',
   'AC and electrical work. Verification in progress.',
   16.5030, 80.6530, 10, 4, '{Telugu}', 'pending', true, 5, '', 0),
  ('a0000026-5eed-5eed-8000-000000000000', 26, '919000000126', 'Lavanya Cleaning',
   'Home cleaning for apartments. Verification in progress.',
   16.4950, 80.6640, 10, 3, '{Telugu}', 'pending', false, 3, '', 0);

create temp table seed_services (provider_id uuid, slug text, skill text, visit_fee int, labour_rate int, rate_unit text)
  on commit drop;
insert into seed_services values
  ('11111111-1111-1111-1111-111111111111', 'ac-repair', 'expert', 19900, 50000, 'job'),
  ('11111111-1111-1111-1111-111111111111', 'appliance-repair', 'skilled', 14900, 40000, 'job'),
  ('22222222-2222-2222-2222-222222222222', 'electrician', 'certified', 14900, 30000, 'hour'),
  ('33333333-3333-3333-3333-333333333333', 'plumber', 'skilled', 9900, 25000, 'hour'),
  ('a0000004-5eed-5eed-8000-000000000000', 'ac-repair', 'certified', 24900, 60000, 'job'),
  ('a0000004-5eed-5eed-8000-000000000000', 'appliance-repair', 'expert', 19900, 45000, 'job'),
  ('a0000005-5eed-5eed-8000-000000000000', 'ac-repair', 'skilled', 14900, 40000, 'job'),
  ('a0000005-5eed-5eed-8000-000000000000', 'electrician', 'skilled', 12900, 25000, 'hour'),
  ('a0000006-5eed-5eed-8000-000000000000', 'electrician', 'expert', 17900, 35000, 'hour'),
  ('a0000007-5eed-5eed-8000-000000000000', 'electrician', 'beginner', 9900, 20000, 'hour'),
  ('a0000007-5eed-5eed-8000-000000000000', 'plumber', 'beginner', 9900, 20000, 'hour'),
  ('a0000008-5eed-5eed-8000-000000000000', 'plumber', 'expert', 14900, 30000, 'hour'),
  ('a0000008-5eed-5eed-8000-000000000000', 'water-tank-cleaning', 'skilled', 19900, 90000, 'job'),
  ('a0000009-5eed-5eed-8000-000000000000', 'house-cleaning', 'certified', 19900, 250000, 'job'),
  ('a0000009-5eed-5eed-8000-000000000000', 'water-tank-cleaning', 'expert', 24900, 120000, 'job'),
  ('a0000010-5eed-5eed-8000-000000000000', 'house-cleaning', 'skilled', 14900, 180000, 'job'),
  ('a0000011-5eed-5eed-8000-000000000000', 'house-cleaning', 'beginner', 9900, 120000, 'job'),
  ('a0000012-5eed-5eed-8000-000000000000', 'water-tank-cleaning', 'certified', 29900, 150000, 'job'),
  ('a0000012-5eed-5eed-8000-000000000000', 'pest-control', 'skilled', 19900, 150000, 'job'),
  ('a0000013-5eed-5eed-8000-000000000000', 'car-mechanic', 'expert', 29900, 80000, 'hour'),
  ('a0000014-5eed-5eed-8000-000000000000', 'car-mechanic', 'skilled', 24900, 60000, 'hour'),
  ('a0000014-5eed-5eed-8000-000000000000', 'bike-mechanic', 'expert', 14900, 30000, 'job'),
  ('a0000015-5eed-5eed-8000-000000000000', 'bike-mechanic', 'skilled', 9900, 25000, 'job'),
  ('a0000016-5eed-5eed-8000-000000000000', 'bike-mechanic', 'certified', 12900, 35000, 'job'),
  ('a0000017-5eed-5eed-8000-000000000000', 'appliance-repair', 'certified', 19900, 50000, 'job'),
  ('a0000018-5eed-5eed-8000-000000000000', 'appliance-repair', 'skilled', 14900, 35000, 'job'),
  ('a0000018-5eed-5eed-8000-000000000000', 'ac-repair', 'beginner', 9900, 30000, 'job'),
  ('a0000019-5eed-5eed-8000-000000000000', 'pest-control', 'certified', 29900, 200000, 'job'),
  ('a0000020-5eed-5eed-8000-000000000000', 'pest-control', 'skilled', 19900, 120000, 'job'),
  ('a0000021-5eed-5eed-8000-000000000000', 'carpenter', 'expert', 19900, 40000, 'hour'),
  ('a0000021-5eed-5eed-8000-000000000000', 'painter', 'skilled', 14900, 30000, 'hour'),
  ('a0000022-5eed-5eed-8000-000000000000', 'carpenter', 'skilled', 14900, 35000, 'hour'),
  ('a0000023-5eed-5eed-8000-000000000000', 'painter', 'certified', 24900, 40000, 'hour'),
  ('a0000024-5eed-5eed-8000-000000000000', 'painter', 'beginner', 9900, 25000, 'hour'),
  ('a0000024-5eed-5eed-8000-000000000000', 'carpenter', 'beginner', 9900, 25000, 'hour'),
  ('a0000025-5eed-5eed-8000-000000000000', 'ac-repair', 'skilled', 14900, 40000, 'job'),
  ('a0000025-5eed-5eed-8000-000000000000', 'electrician', 'skilled', 12900, 25000, 'hour'),
  ('a0000026-5eed-5eed-8000-000000000000', 'house-cleaning', 'skilled', 12900, 150000, 'job');

create temp table seed_rate_cards (provider_id uuid, slug text, title text, price int) on commit drop;
insert into seed_rate_cards values
  ('11111111-1111-1111-1111-111111111111', 'ac-repair', 'Gas refill (split AC)', 250000),
  ('11111111-1111-1111-1111-111111111111', 'ac-repair', 'Jet service / deep clean', 59900),
  ('11111111-1111-1111-1111-111111111111', 'appliance-repair', 'Washing machine service', 49900),
  ('22222222-2222-2222-2222-222222222222', 'electrician', 'MCB replacement', 35000),
  ('22222222-2222-2222-2222-222222222222', 'electrician', 'Inverter installation', 110000),
  ('33333333-3333-3333-3333-333333333333', 'plumber', 'Tap replacement (labour)', 20000),
  ('a0000004-5eed-5eed-8000-000000000000', 'ac-repair', 'Gas refill (split AC, R32)', 260000),
  ('a0000004-5eed-5eed-8000-000000000000', 'ac-repair', 'Jet service / deep clean', 64900),
  ('a0000004-5eed-5eed-8000-000000000000', 'ac-repair', 'Split AC installation', 150000),
  ('a0000004-5eed-5eed-8000-000000000000', 'appliance-repair', 'Washing machine service', 59900),
  ('a0000004-5eed-5eed-8000-000000000000', 'appliance-repair', 'Refrigerator gas charging', 220000),
  ('a0000005-5eed-5eed-8000-000000000000', 'ac-repair', 'AC general service', 49900),
  ('a0000005-5eed-5eed-8000-000000000000', 'ac-repair', 'Gas top-up', 150000),
  ('a0000005-5eed-5eed-8000-000000000000', 'electrician', 'Ceiling fan installation', 25000),
  ('a0000005-5eed-5eed-8000-000000000000', 'electrician', 'Switchboard repair', 20000),
  ('a0000006-5eed-5eed-8000-000000000000', 'electrician', 'MCB / RCCB replacement', 40000),
  ('a0000006-5eed-5eed-8000-000000000000', 'electrician', 'Inverter + battery installation', 120000),
  ('a0000006-5eed-5eed-8000-000000000000', 'electrician', 'Earthing pit', 350000),
  ('a0000007-5eed-5eed-8000-000000000000', 'electrician', 'Tube light / LED fitting', 15000),
  ('a0000007-5eed-5eed-8000-000000000000', 'plumber', 'Tap washer change', 12000),
  ('a0000008-5eed-5eed-8000-000000000000', 'plumber', 'Leak detection and fix', 60000),
  ('a0000008-5eed-5eed-8000-000000000000', 'plumber', 'Western toilet installation', 150000),
  ('a0000008-5eed-5eed-8000-000000000000', 'water-tank-cleaning', '1000 L tank cleaning', 90000),
  ('a0000008-5eed-5eed-8000-000000000000', 'water-tank-cleaning', '2000 L sump cleaning', 160000),
  ('a0000009-5eed-5eed-8000-000000000000', 'house-cleaning', '1 BHK deep clean', 249900),
  ('a0000009-5eed-5eed-8000-000000000000', 'house-cleaning', '2 BHK deep clean', 349900),
  ('a0000009-5eed-5eed-8000-000000000000', 'house-cleaning', 'Sofa shampoo (5 seats)', 99900),
  ('a0000009-5eed-5eed-8000-000000000000', 'water-tank-cleaning', '1000 L tank cleaning', 120000),
  ('a0000010-5eed-5eed-8000-000000000000', 'house-cleaning', 'Kitchen deep clean', 129900),
  ('a0000010-5eed-5eed-8000-000000000000', 'house-cleaning', 'Bathroom deep clean (2)', 99900),
  ('a0000011-5eed-5eed-8000-000000000000', 'house-cleaning', '1 BHK basic clean', 119900),
  ('a0000012-5eed-5eed-8000-000000000000', 'water-tank-cleaning', '1000 L tank (mechanised + UV)', 150000),
  ('a0000012-5eed-5eed-8000-000000000000', 'water-tank-cleaning', 'Sump up to 5000 L', 300000),
  ('a0000012-5eed-5eed-8000-000000000000', 'pest-control', 'Cockroach treatment (2 BHK)', 140000),
  ('a0000013-5eed-5eed-8000-000000000000', 'car-mechanic', 'Doorstep diagnostics (OBD scan)', 79900),
  ('a0000013-5eed-5eed-8000-000000000000', 'car-mechanic', 'Battery replacement (labour)', 30000),
  ('a0000013-5eed-5eed-8000-000000000000', 'car-mechanic', 'Car AC gas refill', 180000),
  ('a0000014-5eed-5eed-8000-000000000000', 'car-mechanic', 'Periodic service (labour)', 150000),
  ('a0000014-5eed-5eed-8000-000000000000', 'bike-mechanic', 'General service', 49900),
  ('a0000015-5eed-5eed-8000-000000000000', 'bike-mechanic', 'General service', 39900),
  ('a0000015-5eed-5eed-8000-000000000000', 'bike-mechanic', 'Chain set replacement (labour)', 25000),
  ('a0000015-5eed-5eed-8000-000000000000', 'bike-mechanic', 'Puncture (tubeless)', 15000),
  ('a0000016-5eed-5eed-8000-000000000000', 'bike-mechanic', 'Royal Enfield full service', 99900),
  ('a0000016-5eed-5eed-8000-000000000000', 'bike-mechanic', 'Clutch plate replacement (labour)', 60000),
  ('a0000017-5eed-5eed-8000-000000000000', 'appliance-repair', 'Washing machine repair (labour)', 50000),
  ('a0000017-5eed-5eed-8000-000000000000', 'appliance-repair', 'RO service + filter change', 120000),
  ('a0000017-5eed-5eed-8000-000000000000', 'appliance-repair', 'Microwave repair (labour)', 45000),
  ('a0000018-5eed-5eed-8000-000000000000', 'appliance-repair', 'Geyser repair (labour)', 35000),
  ('a0000018-5eed-5eed-8000-000000000000', 'ac-repair', 'AC filter cleaning', 29900),
  ('a0000019-5eed-5eed-8000-000000000000', 'pest-control', 'Termite treatment (2 BHK)', 450000),
  ('a0000019-5eed-5eed-8000-000000000000', 'pest-control', 'Bed bug treatment (2 rooms)', 250000),
  ('a0000019-5eed-5eed-8000-000000000000', 'pest-control', 'Cockroach gel (2 BHK)', 150000),
  ('a0000020-5eed-5eed-8000-000000000000', 'pest-control', 'Cockroach and ant treatment', 120000),
  ('a0000021-5eed-5eed-8000-000000000000', 'carpenter', 'Door lock / handle fitting', 30000),
  ('a0000021-5eed-5eed-8000-000000000000', 'carpenter', 'Bed assembly', 80000),
  ('a0000021-5eed-5eed-8000-000000000000', 'painter', 'Wall touch-up (per room)', 150000),
  ('a0000022-5eed-5eed-8000-000000000000', 'carpenter', 'Shelf installation', 40000),
  ('a0000022-5eed-5eed-8000-000000000000', 'carpenter', 'Wood polish (per sq ft)', 4500),
  ('a0000023-5eed-5eed-8000-000000000000', 'painter', '2 BHK interior painting (labour)', 1200000),
  ('a0000023-5eed-5eed-8000-000000000000', 'painter', 'Terrace waterproofing (per sq ft)', 3500),
  ('a0000023-5eed-5eed-8000-000000000000', 'painter', 'Texture wall (per wall)', 450000),
  ('a0000025-5eed-5eed-8000-000000000000', 'ac-repair', 'AC general service', 49900),
  ('a0000026-5eed-5eed-8000-000000000000', 'house-cleaning', '2 BHK deep clean', 299900);

create temp table seed_customers (id uuid primary key, nn int, phone text, full_name text, line1 text, lat float8, lng float8)
  on commit drop;
insert into seed_customers values
  ('c0000001-5eed-5eed-8000-000000000000', 1, '919000000201', 'Anjali Reddy', 'Plot 14, Sai Nagar, Moghalrajpuram', 16.5105, 80.6395),
  ('c0000002-5eed-5eed-8000-000000000000', 2, '919000000202', 'Kalyan Chakravarthy', 'D.No 7-12, Patamata Lanka', 16.4935, 80.6665),
  ('c0000003-5eed-5eed-8000-000000000000', 3, '919000000203', 'Padmavathi Devi', '23-5-8, Besant Road, Governorpet', 16.5125, 80.6255),
  ('c0000004-5eed-5eed-8000-000000000000', 4, '919000000204', 'Rahul Varma', 'Flat 501, Lakshmi Towers, Benz Circle', 16.4990, 80.6555),
  ('c0000005-5eed-5eed-8000-000000000000', 5, '919000000205', 'Sneha Chowdary', '12-3, Mary Matha Road, Gunadala', 16.5195, 80.6610),
  ('c0000006-5eed-5eed-8000-000000000000', 6, '919000000206', 'Mahesh Koneru', '40-1-52, MG Road, Labbipet', 16.5015, 80.6445),
  ('c0000007-5eed-5eed-8000-000000000000', 7, '919000000207', 'Fatima Begum', '11-24-6, Kothapeta, One Town', 16.5175, 80.6075),
  ('c0000008-5eed-5eed-8000-000000000000', 8, '919000000208', 'Teja Pothineni', 'Flat 2B, Green Meadows, Kanuru', 16.4855, 80.6940),
  ('c0000009-5eed-5eed-8000-000000000000', 9, '919000000209', 'Bhargavi Nallamothu', '5-9-31, Siddhartha Nagar', 16.5005, 80.6605),
  ('c0000010-5eed-5eed-8000-000000000000', 10, '919000000210', 'Vikram Siddabattula', '2-48, Ramavarappadu Ring Road', 16.5165, 80.6875);

create temp table seed_cat_text (slug text primary key, descs text[], labours text[], parts text[]) on commit drop;
insert into seed_cat_text values
  ('ac-repair', '{"AC not cooling properly","Water dripping from the indoor unit","AC making noise and tripping","Yearly AC service before summer"}',
   '{"AC jet service","Gas refill","PCB repair","Indoor unit cleaning","Fan motor repair"}',
   '{"Capacitor 45uF","Copper pipe + flare nuts","Drain pipe 3 m","Outdoor fan motor","Remote sensor board"}'),
  ('electrician', '{"MCB tripping frequently","Ceiling fan not working","Need a new switchboard","Inverter not charging"}',
   '{"Wiring fault repair","Fan installation","Switchboard replacement","Inverter wiring"}',
   '{"Havells MCB 32A","Modular switch plate","Fan capacitor","Copper wire 1.5 sq mm (90 m)"}'),
  ('plumber', '{"Tap leaking continuously","Bathroom wall leakage","Kitchen sink blocked","Motor not pumping water"}',
   '{"Leak repair","Drain unblocking","Tap and mixer fitting","Motor pipe connection"}',
   '{"CPVC pipes and fittings","Jaquar tap","Ball valve","Flush tank kit"}'),
  ('house-cleaning', '{"2 BHK deep cleaning","Kitchen deep cleaning","Move-in cleaning","Bathroom deep cleaning"}',
   '{"Deep cleaning (team of 2)","Kitchen degreasing","Bathroom descaling","Sofa shampooing"}',
   '{"Cleaning chemicals","Disinfectant and consumables"}'),
  ('water-tank-cleaning', '{"Overhead tank cleaning","Sump cleaning","Tank water smells bad"}',
   '{"Tank cleaning (1000 L)","Sump cleaning","Mechanised cleaning + UV"}',
   '{"Disinfectant","Tank lid replacement"}'),
  ('car-mechanic', '{"Car not starting","Brake noise","Car AC not cooling","General service due"}',
   '{"Doorstep diagnostics","Brake pad replacement","Car AC service","Battery replacement"}',
   '{"Brake pads (front)","Amaron battery 45Ah","Engine oil 3.5 L","AC gas (R134a)"}'),
  ('bike-mechanic', '{"Bike not starting","Chain making noise","General service due","Front tyre puncture"}',
   '{"General service","Chain set replacement","Carburettor cleaning","Clutch adjustment"}',
   '{"Chain sprocket kit","Engine oil 1 L","Spark plug","Brake shoe"}'),
  ('appliance-repair', '{"Washing machine not spinning","Fridge not cooling","Microwave not heating","RO purifier leaking"}',
   '{"Washing machine repair","Refrigerator repair","Microwave repair","RO service"}',
   '{"Drain pump","Thermostat","Magnetron","RO membrane"}'),
  ('pest-control', '{"Cockroach problem in the kitchen","Termites in wooden furniture","Bed bugs","Mosquito treatment"}',
   '{"Cockroach gel treatment","Termite treatment","Bed bug treatment","Mosquito fogging"}',
   '{"Gel and spray chemicals","Termiticide"}'),
  ('carpenter', '{"Wardrobe door broken","Bed needs assembly","Door lock not working","Kitchen cabinet hinge loose"}',
   '{"Door repair","Furniture assembly","Lock fitting","Cabinet repair"}',
   '{"Soft-close hinges","Godrej lock","Plywood 6 mm sheet","Drawer channel set"}'),
  ('painter', '{"Repaint the living room","Wall dampness patches","Touch-up after repairs","Exterior wall painting"}',
   '{"Interior painting","Wall putty and primer","Touch-up painting","Waterproof coating"}',
   '{"Asian Paints Tractor Emulsion 10 L","Wall putty 20 kg","Primer 4 L","Dr. Fixit waterproofing"}');

create temp table seed_comments (rating int, ord int, body text) on commit drop;
insert into seed_comments values
  (5, 0, 'Excellent work, very professional and explained everything clearly.'),
  (5, 1, 'Came on time and finished quickly. Highly recommended!'),
  (5, 2, 'Very neat job, cleaned up after the work. Will book again.'),
  (5, 3, 'Reasonable price and genuine spare parts with bill.'),
  (5, 4, 'Super polite and knowledgeable. Problem solved in one visit.'),
  (5, 5, 'Best service I have had in Vijayawada so far.'),
  (5, 6, null),
  (5, 7, 'Arrived within 30 minutes of booking. Great experience.'),
  (4, 0, 'Good work, slightly delayed but informed me in advance.'),
  (4, 1, 'Job done well. Pricing was fair.'),
  (4, 2, 'Knew the work, but had to come back once for a part.'),
  (4, 3, 'Nice behaviour, good quality. Could be a bit faster.'),
  (4, 4, null),
  (4, 5, 'Satisfied overall. The quote was clear and itemised.'),
  (3, 0, 'Work is okay but took longer than expected.'),
  (3, 1, 'Average experience, had to remind twice about the part.'),
  (3, 2, 'Fixed the issue but left some mess behind.'),
  (3, 3, 'Price felt a little high for the work done.'),
  (2, 0, 'Came 2 hours late and the problem came back the next day.'),
  (2, 1, 'Not very careful with the work. Needed a revisit.'),
  (1, 0, 'Very poor. Did not fix the problem and was rude when I complained.'),
  (1, 1, 'Charged for a part that was not replaced. Not recommended.');

-- -----------------------------------------------------------------------------------------------------
-- 4. Auth users, profiles, private accounts (providers + customers)
-- -----------------------------------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.phone, now(),
       '{"provider":"phone","providers":["phone"]}', jsonb_build_object('full_name', u.full_name),
       now() - make_interval(days => u.days), now()
  from (select id, phone, full_name, created_days + 1 as days from seed_providers
        union all
        select id, phone, full_name, 240 - nn * 7 from seed_customers) u
on conflict do nothing;

-- GoTrue scans these token columns as strings; NULLs (from SQL-inserted users) break phone sign-in.
do $$
declare
  c text;
begin
  foreach c in array array['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                           'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token'] loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users' and column_name = c) then
      execute format('update auth.users set %I = '''' where %I is null and (id::text like ''________-5eed-5eed-%%'' '
                     'or id in (''11111111-1111-1111-1111-111111111111'', ''22222222-2222-2222-2222-222222222222'', '
                     '''33333333-3333-3333-3333-333333333333''))', c, c);
    end if;
  end loop;
end;
$$;

-- Phone identities (best effort; the identities schema differs between GoTrue versions).
do $$
begin
  if to_regclass('auth.identities') is not null then
    begin
      execute $q$
        insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'phone', u.phone, 'phone_verified', true),
               'phone', now(), now(), now()
          from auth.users u
         where (u.id::text like '________-5eed-5eed-%'
                or u.id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
                            '33333333-3333-3333-3333-333333333333'))
           and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'phone')
      $q$;
    exception when others then
      raise notice 'seed: skipped auth.identities (%)', sqlerrm;
    end;
  end if;
end;
$$;

insert into public.profiles (id, full_name, role_customer, role_provider, created_at)
select id, full_name, true, true, now() - make_interval(days => created_days + 1) from seed_providers
on conflict (id) do update set full_name = excluded.full_name, role_provider = true;

insert into public.profiles (id, full_name, role_customer, role_provider, created_at)
select id, full_name, true, false, now() - make_interval(days => 240 - nn * 7) from seed_customers
on conflict (id) do update set full_name = excluded.full_name, role_customer = true;

insert into public.private_user_accounts (user_id, phone)
select id, phone from seed_providers
union all
select id, phone from seed_customers
on conflict (user_id) do update set phone = coalesce(public.private_user_accounts.phone, excluded.phone);

insert into public.addresses (id, user_id, label, line1, city, lat, lng, is_default, created_at)
select ('ad0000' || lpad(nn::text, 2, '0') || '-5eed-5eed-8000-000000000000')::uuid, id, 'Home', line1, 'Vijayawada',
       lat, lng, true, now() - interval '200 days'
  from seed_customers
on conflict (id) do update set line1 = excluded.line1, lat = excluded.lat, lng = excluded.lng, is_default = true;

-- -----------------------------------------------------------------------------------------------------
-- 5. Providers, services, rate cards
-- -----------------------------------------------------------------------------------------------------
-- seed.sql's three providers: kept as they are (if present), only back-dated so the history below is
-- plausible and past the 30-day zero-commission period.
insert into public.providers (id, bio, city, service_radius_km, base_location, years_experience, languages, kyc_status,
                              kyc_reference, razorpay_account_id, is_online, created_at)
select id, bio, 'Vijayawada', radius,
       extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography, years, languages,
       'verified', 'acc_demo_' || lower(split_part(full_name, ' ', 1)), 'acc_demo_' || lower(split_part(full_name, ' ', 1)),
       online, now() - make_interval(days => created_days)
  from seed_providers where nn <= 3
on conflict (id) do nothing;
update public.providers p set created_at = now() - make_interval(days => s.created_days)
  from seed_providers s
 where s.nn <= 3 and p.id = s.id and p.created_at > now() - make_interval(days => s.created_days);

-- Seeds bypass "KYC comes from the payment partner" on purpose (demo data only). No razorpay_account_id,
-- so release-payouts never attempts a real Route transfer for these accounts.
insert into public.providers (id, bio, city, service_radius_km, base_location, years_experience, languages, kyc_status,
                              kyc_reference, razorpay_account_id, suspended, is_online, created_at)
select id, bio, 'Vijayawada', radius,
       extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography, years, languages,
       kyc::public.kyc_status, case when kyc = 'verified' then 'acc_seed_' || lpad(nn::text, 3, '0') end, null,
       false, online, now() - make_interval(days => created_days)
  from seed_providers where nn > 3
on conflict (id) do update
   set bio = excluded.bio, city = excluded.city, service_radius_km = excluded.service_radius_km,
       base_location = excluded.base_location, years_experience = excluded.years_experience,
       languages = excluded.languages, kyc_status = excluded.kyc_status, kyc_reference = excluded.kyc_reference,
       suspended = false, is_online = excluded.is_online, created_at = excluded.created_at;

insert into public.provider_services (id, provider_id, category_id, skill_level, visit_fee, labour_rate, rate_unit, active,
                                      created_at)
select pg_temp.sid('ps:' || s.provider_id || ':' || s.slug), s.provider_id, c.id, s.skill::public.skill_level, s.visit_fee,
       s.labour_rate, s.rate_unit::public.rate_unit, true, now() - interval '200 days'
  from seed_services s join public.categories c on c.slug = s.slug
on conflict (provider_id, category_id) do update
   set skill_level = excluded.skill_level, visit_fee = excluded.visit_fee, labour_rate = excluded.labour_rate,
       rate_unit = excluded.rate_unit, active = true;

insert into public.rate_card_items (id, provider_service_id, title, price)
select pg_temp.sid('rc:' || ps.id || ':' || r.title), ps.id, r.title, r.price
  from seed_rate_cards r
  join public.categories c on c.slug = r.slug
  join public.provider_services ps on ps.provider_id = r.provider_id and ps.category_id = c.id
 where not exists (select 1 from public.rate_card_items x where x.provider_service_id = ps.id and x.title = r.title);

-- -----------------------------------------------------------------------------------------------------
-- 6. Founder: both roles, two addresses, a verified online provider profile (AC Repair + Electrician)
-- -----------------------------------------------------------------------------------------------------
insert into public.profiles (id, full_name, role_customer, role_provider)
values (pg_temp.founder(), 'QuickServe Founder', true, true)
on conflict (id) do update
   set role_customer = true, role_provider = true,
       full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name);

insert into public.private_user_accounts (user_id, phone)
values (pg_temp.founder(), '919999999999')
on conflict (user_id) do update set phone = coalesce(public.private_user_accounts.phone, excluded.phone);

insert into public.addresses (id, user_id, label, line1, city, lat, lng, is_default, created_at)
values
  ('adf00001-5eed-5eed-8000-000000000000', pg_temp.founder(), 'Home', 'Flat 302, Sri Sai Residency, Benz Circle',
   'Vijayawada', 16.5000, 80.6510, true, now() - interval '90 days'),
  ('adf00002-5eed-5eed-8000-000000000000', pg_temp.founder(), 'Office', '4th Floor, iHub Towers, MG Road, Labbipet',
   'Vijayawada', 16.5040, 80.6420, false, now() - interval '90 days')
on conflict (id) do update
   set user_id = excluded.user_id, label = excluded.label, line1 = excluded.line1, lat = excluded.lat,
       lng = excluded.lng, is_default = excluded.is_default;
update public.addresses set is_default = false
 where user_id = pg_temp.founder() and id <> 'adf00001-5eed-5eed-8000-000000000000' and is_default;

insert into public.providers (id, bio, city, service_radius_km, base_location, years_experience, languages, kyc_status,
                              kyc_reference, suspended, is_online, created_at)
values (pg_temp.founder(), 'AC servicing and home electrical work. Founder test account.', 'Vijayawada', 15,
        extensions.st_setsrid(extensions.st_makepoint(80.6450, 16.5070), 4326)::extensions.geography, 6,
        '{Telugu,English,Hindi}', 'verified', 'acc_seed_founder', false, true, now() - interval '120 days')
on conflict (id) do update
   set bio = coalesce(nullif(public.providers.bio, ''), excluded.bio),
       city = excluded.city, service_radius_km = excluded.service_radius_km, base_location = excluded.base_location,
       years_experience = greatest(public.providers.years_experience, excluded.years_experience),
       languages = case when cardinality(public.providers.languages) = 0 then excluded.languages
                        else public.providers.languages end,
       kyc_status = 'verified', kyc_reference = coalesce(public.providers.kyc_reference, excluded.kyc_reference),
       suspended = false, is_online = true,
       created_at = least(public.providers.created_at, excluded.created_at);

insert into public.provider_services (id, provider_id, category_id, skill_level, visit_fee, labour_rate, rate_unit, active,
                                      created_at)
select pg_temp.sid('ps:founder:' || v.slug), pg_temp.founder(), c.id, v.skill::public.skill_level, v.visit_fee,
       v.labour_rate, v.unit::public.rate_unit, true, now() - interval '120 days'
  from (values ('ac-repair', 'expert', 19900, 45000, 'job'),
               ('electrician', 'skilled', 14900, 30000, 'hour')) v(slug, skill, visit_fee, labour_rate, unit)
  join public.categories c on c.slug = v.slug
on conflict (provider_id, category_id) do update
   set skill_level = excluded.skill_level, visit_fee = excluded.visit_fee, labour_rate = excluded.labour_rate,
       rate_unit = excluded.rate_unit, active = true;

insert into public.rate_card_items (id, provider_service_id, title, price)
select pg_temp.sid('rc:' || ps.id || ':' || v.title), ps.id, v.title, v.price
  from (values ('ac-repair', 'Split AC jet service', 59900),
               ('ac-repair', 'Gas refill (R32)', 250000),
               ('ac-repair', 'Split AC installation', 140000),
               ('electrician', 'Ceiling fan installation', 25000),
               ('electrician', 'MCB replacement', 35000),
               ('electrician', 'Inverter installation', 120000)) v(slug, title, price)
  join public.categories c on c.slug = v.slug
  join public.provider_services ps on ps.provider_id = pg_temp.founder() and ps.category_id = c.id
 where not exists (select 1 from public.rate_card_items x where x.provider_service_id = ps.id and x.title = v.title);

-- -----------------------------------------------------------------------------------------------------
-- 7. Historical closed jobs for every verified provider (+ ~120 reviews)
-- -----------------------------------------------------------------------------------------------------
do $$
declare
  r record;
  svc record;
  t record;
  j int;
  n int;
  v_nsvc int;
  v_customers uuid[];
  v_id uuid;
  v_done timestamptz;
  v_step interval;
  v_qty int;
  v_price int;
  v_part int;
  v_items jsonb;
  v_rating int;
  v_comment text;
begin
  select array_agg(id order by nn) into v_customers from seed_customers;
  for r in select * from seed_providers where kyc = 'verified' order by nn loop
    n := length(r.ratings) + r.extra;
    select count(*) into v_nsvc from seed_services s2 where s2.provider_id = r.id;
    for j in 1..n loop
      select s.slug, s.labour_rate, s.rate_unit into svc
        from seed_services s join public.categories c on c.slug = s.slug
       where s.provider_id = r.id
       order by c.sort_order
      offset (j - 1) % v_nsvc limit 1;
      select * into t from seed_cat_text where slug = svc.slug;

      if r.created_days < 60 then
        v_done := now() - make_interval(days => 2 + j * 5, hours => j % 6);
      else
        v_done := now() - make_interval(days => 2 + (r.nn * 37 + j * 53) % 175, hours => (r.nn * 7 + j * 3) % 12);
      end if;
      v_step := make_interval(mins => 20 + (j * 7 + r.nn) % 25);

      if svc.rate_unit = 'hour' then
        v_qty := 1 + (j + r.nn) % 3;
        v_price := svc.labour_rate;
        v_items := jsonb_build_array(jsonb_build_object(
          'kind', 'labour', 'title', t.labours[1 + (j + r.nn) % cardinality(t.labours)] || ' (' || v_qty || ' hr)',
          'qty', v_qty, 'unit_price', v_price));
      else
        v_price := svc.labour_rate + ((j + r.nn) % 2) * (svc.labour_rate / 2);
        v_items := jsonb_build_array(jsonb_build_object(
          'kind', 'labour', 'title', t.labours[1 + (j + r.nn) % cardinality(t.labours)], 'qty', 1, 'unit_price', v_price));
      end if;
      v_part := case when (j + r.nn) % 3 = 0 then 0 else 15000 + ((r.nn * 13 + j * 29) % 20) * 2500 end;
      if v_part > 0 then
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'kind', 'part', 'title', t.parts[1 + (j * 2 + r.nn) % cardinality(t.parts)], 'qty', 1, 'unit_price', v_part));
      end if;

      v_id := pg_temp.sid('hist:' || r.id || ':' || j);
      perform pg_temp.mk_booking(v_id, v_customers[1 + (r.nn * 3 + j) % cardinality(v_customers)], r.id, svc.slug,
                                 'closed', v_done - v_step * 9, v_step,
                                 t.descs[1 + (j + r.nn) % cardinality(t.descs)], v_items);

      if j <= length(r.ratings) then
        v_rating := substr(r.ratings, j, 1)::int;
        select body into v_comment from seed_comments
         where rating = v_rating
           and ord = (j + r.nn) % (select count(*) from seed_comments where rating = v_rating);
        perform pg_temp.mk_review(
          v_id, v_rating,
          greatest(1, least(5, v_rating + (j + r.nn) % 3 - 1)),
          greatest(1, v_rating - ((j * 2 + r.nn) % 4 = 0)::int),
          greatest(1, least(5, v_rating + (j * 3 + r.nn) % 3 - 1)),
          case when (j + r.nn) % 5 = 0 then null else greatest(1, least(5, v_rating - (j % 2))) end,
          v_comment,
          case when v_rating <= 2 then 'Sorry for the trouble. I have called you to arrange a free revisit.'
               when v_rating = 5 and (j + r.nn) % 4 = 0 then 'Thank you! Happy to help anytime.' end,
          v_done + make_interval(hours => 2 + (j * 5) % 30));
      end if;
    end loop;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 8. Founder AS CUSTOMER: one booking in every status
-- -----------------------------------------------------------------------------------------------------
do $$
declare
  f uuid := pg_temp.founder();
  home uuid := 'adf00001-5eed-5eed-8000-000000000000';
  office uuid := 'adf00002-5eed-5eed-8000-000000000000';
begin
  perform pg_temp.mk_booking('fc000001-5eed-5eed-8000-000000000000', f, '33333333-3333-3333-3333-333333333333', 'plumber',
    'pending_payment', now() - interval '5 minutes', interval '1 minute', 'Kitchen sink tap leaking continuously',
    null, '1406', null, null, home);
  perform pg_temp.mk_booking('fc000002-5eed-5eed-8000-000000000000', f, '22222222-2222-2222-2222-222222222222', 'electrician',
    'requested', now() - interval '4 minutes', interval '1 minute', 'Two switchboards sparking in the bedroom',
    null, '3816', null, null, home);
  perform pg_temp.mk_booking('fc000003-5eed-5eed-8000-000000000000', f, 'a0000009-5eed-5eed-8000-000000000000', 'house-cleaning',
    'accepted', now() - interval '40 minutes', interval '5 minutes', '2 BHK deep cleaning before Diwali guests arrive',
    null, '4821', null, null, home);
  perform pg_temp.mk_booking('fc000004-5eed-5eed-8000-000000000000', f, 'a0000013-5eed-5eed-8000-000000000000', 'car-mechanic',
    'en_route', now() - interval '50 minutes', interval '8 minutes', 'Car not starting, battery seems dead',
    null, '5193', null, null, office);
  perform pg_temp.mk_booking('fc000005-5eed-5eed-8000-000000000000', f, 'a0000019-5eed-5eed-8000-000000000000', 'pest-control',
    'inspecting', now() - interval '90 minutes', interval '15 minutes', 'Termite marks on wardrobe and door frames',
    null, '2087', null, null, home);
  -- docs/03 worked example: labour 1,500 + part 650; visit fee 199 credited -> customer pays 1,980 now (total 2,179).
  perform pg_temp.mk_booking('fc000006-5eed-5eed-8000-000000000000', f, '11111111-1111-1111-1111-111111111111', 'ac-repair',
    'quote_sent', now() - interval '120 minutes', interval '15 minutes', 'Split AC not cooling, only the fan is running',
    '[{"kind":"labour","title":"Gas refill (R32, split AC)","qty":1,"unit_price":150000},
      {"kind":"part","title":"Capacitor 45uF","qty":1,"unit_price":65000}]', '6342', null, null, home);
  perform pg_temp.mk_booking('fc000007-5eed-5eed-8000-000000000000', f, 'a0000017-5eed-5eed-8000-000000000000', 'appliance-repair',
    'awaiting_payment', now() - interval '180 minutes', interval '20 minutes', 'Washing machine making a loud noise during spin',
    '[{"kind":"labour","title":"Drum bearing replacement","qty":1,"unit_price":80000},
      {"kind":"part","title":"Bearing and seal kit (Samsung 7 kg)","qty":1,"unit_price":120000}]', '7019', null, null, home);
  perform pg_temp.mk_booking('fc000008-5eed-5eed-8000-000000000000', f, 'a0000023-5eed-5eed-8000-000000000000', 'painter',
    'in_progress', now() - interval '24 hours', interval '30 minutes', 'Repaint two bedrooms, walls have dampness patches',
    '[{"kind":"labour","title":"Interior painting - 2 bedrooms","qty":1,"unit_price":600000},
      {"kind":"part","title":"Asian Paints Royale 10 L","qty":2,"unit_price":225000}]', '8253', null, null, home);
  perform pg_temp.mk_booking('fc000009-5eed-5eed-8000-000000000000', f, 'a0000021-5eed-5eed-8000-000000000000', 'carpenter',
    'completion_requested', now() - interval '270 minutes', interval '30 minutes', 'Wardrobe doors sagging, hinges broken',
    '[{"kind":"labour","title":"Wardrobe door realignment and repair","qty":1,"unit_price":120000},
      {"kind":"part","title":"Soft-close hinges (set of 4)","qty":1,"unit_price":35000}]', '2468', '7350', null, home);
  perform pg_temp.mk_booking('fc000010-5eed-5eed-8000-000000000000', f, 'a0000006-5eed-5eed-8000-000000000000', 'electrician',
    'completed', now() - interval '450 minutes', interval '30 minutes', 'Frequent MCB tripping in the kitchen',
    '[{"kind":"labour","title":"Wiring fault tracing and repair (2 hr)","qty":2,"unit_price":35000},
      {"kind":"part","title":"Havells 32A DP MCB","qty":2,"unit_price":22500}]', '1590', '6604', null, office);
  perform pg_temp.mk_booking('fc000011-5eed-5eed-8000-000000000000', f, 'a0000008-5eed-5eed-8000-000000000000', 'plumber',
    'closed', now() - interval '5 days' - interval '405 minutes', interval '45 minutes', 'Water leaking from the bathroom wall',
    '[{"kind":"labour","title":"Concealed pipe leak repair (2 hr)","qty":2,"unit_price":30000},
      {"kind":"part","title":"CPVC pipes and fittings","qty":1,"unit_price":85000}]', '3371', '8846', null, home);
  perform pg_temp.mk_booking('fc000012-5eed-5eed-8000-000000000000', f, 'a0000015-5eed-5eed-8000-000000000000', 'bike-mechanic',
    'closed_no_work', now() - interval '6 days' - interval '150 minutes', interval '25 minutes', 'Bike engine making a knocking noise',
    '[{"kind":"labour","title":"Engine overhaul","qty":1,"unit_price":250000},
      {"kind":"part","title":"Piston kit + gaskets","qty":1,"unit_price":380000}]', '4402', null, null, home);
  perform pg_temp.mk_booking('fc000013-5eed-5eed-8000-000000000000', f, 'a0000012-5eed-5eed-8000-000000000000', 'water-tank-cleaning',
    'declined', now() - interval '2 days', interval '4 minutes', '1000 L overhead tank cleaning',
    null, '5917', null, 'Fully booked today, sorry', home);
  perform pg_temp.mk_booking('fc000014-5eed-5eed-8000-000000000000', f, 'a0000014-5eed-5eed-8000-000000000000', 'car-mechanic',
    'expired', now() - interval '9 days', interval '2 minutes', 'Car AC not cooling',
    null, '6028', null, null, office);
  perform pg_temp.mk_booking('fc000015-5eed-5eed-8000-000000000000', f, 'a0000010-5eed-5eed-8000-000000000000', 'house-cleaning',
    'cancelled', now() - interval '3 days', interval '3 minutes', 'Kitchen deep cleaning',
    null, '7731', null, 'Plans changed, will rebook next week', home);
  perform pg_temp.mk_booking('fc000016-5eed-5eed-8000-000000000000', f, 'a0000004-5eed-5eed-8000-000000000000', 'ac-repair',
    'disputed', now() - interval '15 hours', interval '1 hour', 'AC tripping and not cooling',
    '[{"kind":"labour","title":"PCB repair","qty":1,"unit_price":120000},
      {"kind":"part","title":"Outdoor PCB (refurbished)","qty":1,"unit_price":220000}]', '8164', '2295',
    'AC stopped cooling again the same evening', home);
  perform pg_temp.mk_booking('fc000017-5eed-5eed-8000-000000000000', f, 'a0000020-5eed-5eed-8000-000000000000', 'pest-control',
    'refunded', now() - interval '14 days', interval '1 hour', 'Cockroach problem in the kitchen',
    '[{"kind":"labour","title":"Cockroach and ant gel treatment (2 BHK)","qty":1,"unit_price":150000},
      {"kind":"other","title":"Disposal and travel","qty":1,"unit_price":30000}]', '9036', '4417',
    'Cockroaches back within 2 days, treatment not done properly', home);

  -- In-progress painter job: change order v2 (+2,200) waiting for the founder's approval.
  insert into public.quotes (id, booking_id, version, status, is_change_order, total, note, created_at)
  values (pg_temp.sid('fc000008:q2'), 'fc000008-5eed-5eed-8000-000000000000', 2, 'sent', true, 0,
          'Hall ceiling added as discussed', now() - interval '30 minutes');
  perform pg_temp.add_items(pg_temp.sid('fc000008:q2'),
    '[{"kind":"labour","title":"Interior painting - 2 bedrooms","qty":1,"unit_price":600000},
      {"kind":"labour","title":"Hall ceiling painting","qty":1,"unit_price":150000},
      {"kind":"part","title":"Asian Paints Royale 10 L","qty":2,"unit_price":225000},
      {"kind":"part","title":"Ceiling white 10 L","qty":1,"unit_price":70000}]');
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note, at)
  values ('fc000008-5eed-5eed-8000-000000000000', 'a0000023-5eed-5eed-8000-000000000000', 'in_progress', 'in_progress',
          'change order v2', now() - interval '30 minutes');

  perform pg_temp.mk_review('fc000011-5eed-5eed-8000-000000000000', 5, 5, 5, 5, 4,
    'Found the leak quickly without breaking extra tiles. Very professional.', 'Thank you sir!',
    now() - interval '4 days');
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 9. Founder AS PROVIDER: incoming requests, active jobs and recent earnings
-- -----------------------------------------------------------------------------------------------------
do $$
declare
  f uuid := pg_temp.founder();
begin
  -- created 2 / 7 minutes ago -> the 15-minute countdown is running and expire_stale_requests() skips them.
  perform pg_temp.mk_booking('fb000001-5eed-5eed-8000-000000000000', 'c0000001-5eed-5eed-8000-000000000000', f, 'ac-repair',
    'requested', now() - interval '2 minutes', interval '1 minute', 'AC remote not working and the unit keeps beeping',
    null, '1739');
  perform pg_temp.mk_booking('fb000002-5eed-5eed-8000-000000000000', 'c0000004-5eed-5eed-8000-000000000000', f, 'electrician',
    'requested', now() - interval '7 minutes', interval '1 minute', 'Install 3 ceiling fans in the new flat',
    null, '2604');
  perform pg_temp.mk_booking('fb000003-5eed-5eed-8000-000000000000', 'c0000002-5eed-5eed-8000-000000000000', f, 'ac-repair',
    'accepted', now() - interval '25 minutes', interval '5 minutes', 'Window AC water leaking inside the room',
    null, '6284');
  perform pg_temp.mk_booking('fb000004-5eed-5eed-8000-000000000000', 'c0000005-5eed-5eed-8000-000000000000', f, 'electrician',
    'inspecting', now() - interval '60 minutes', interval '10 minutes', 'Inverter not charging since yesterday',
    null, '3958');
  perform pg_temp.mk_booking('fb000005-5eed-5eed-8000-000000000000', 'c0000003-5eed-5eed-8000-000000000000', f, 'ac-repair',
    'in_progress', now() - interval '180 minutes', interval '20 minutes', 'Yearly AC service before summer',
    '[{"kind":"labour","title":"Split AC jet service","qty":1,"unit_price":60000},
      {"kind":"part","title":"Drain pipe 3 m","qty":1,"unit_price":40000}]', '4176');
  perform pg_temp.mk_booking('fb000006-5eed-5eed-8000-000000000000', 'c0000007-5eed-5eed-8000-000000000000', f, 'electrician',
    'completion_requested', now() - interval '120 minutes', interval '12 minutes', 'Ceiling fan running very slowly',
    '[{"kind":"labour","title":"Fan repair and rewiring (2 hr)","qty":2,"unit_price":30000},
      {"kind":"part","title":"Fan capacitor 2.5uF + regulator","qty":1,"unit_price":40000}]', '5530', '9152');
  perform pg_temp.mk_booking('fb000007-5eed-5eed-8000-000000000000', 'c0000006-5eed-5eed-8000-000000000000', f, 'ac-repair',
    'completed', now() - interval '30 minutes' - interval '90 minutes', interval '10 minutes', 'AC not cooling, needs gas',
    '[{"kind":"labour","title":"Gas refill (R32, split AC)","qty":1,"unit_price":150000},
      {"kind":"part","title":"Capacitor 45uF","qty":1,"unit_price":65000}]');
  perform pg_temp.mk_booking('fb000008-5eed-5eed-8000-000000000000', 'c0000008-5eed-5eed-8000-000000000000', f, 'electrician',
    'completed', now() - interval '20 hours' - interval '135 minutes', interval '15 minutes', 'New switchboard for the TV unit',
    '[{"kind":"labour","title":"Switchboard installation (1.5 hr)","qty":1.5,"unit_price":30000}]');
  perform pg_temp.mk_booking('fb000009-5eed-5eed-8000-000000000000', 'c0000009-5eed-5eed-8000-000000000000', f, 'ac-repair',
    'closed', now() - interval '3 days' - interval '180 minutes', interval '20 minutes', 'AC gas leak, not cooling at all',
    '[{"kind":"labour","title":"Gas refill + leak brazing","qty":1,"unit_price":250000},
      {"kind":"part","title":"Copper pipe 2 m + flare nuts","qty":1,"unit_price":180000}]');
  perform pg_temp.mk_booking('fb000010-5eed-5eed-8000-000000000000', 'c0000010-5eed-5eed-8000-000000000000', f, 'electrician',
    'closed', now() - interval '8 days' - interval '180 minutes', interval '20 minutes', 'Inverter installation for 2 BHK',
    '[{"kind":"labour","title":"Inverter installation","qty":1,"unit_price":120000},
      {"kind":"part","title":"Wires and MCB","qty":1,"unit_price":60000}]');
  perform pg_temp.mk_booking('fb000011-5eed-5eed-8000-000000000000', 'c0000001-5eed-5eed-8000-000000000000', f, 'ac-repair',
    'closed', now() - interval '15 days' - interval '135 minutes', interval '15 minutes', 'AC service',
    '[{"kind":"labour","title":"Split AC jet service","qty":1,"unit_price":59900}]');
  perform pg_temp.mk_booking('fb000012-5eed-5eed-8000-000000000000', 'c0000002-5eed-5eed-8000-000000000000', f, 'electrician',
    'closed', now() - interval '25 days' - interval '180 minutes', interval '20 minutes', 'LED panel lights for the hall',
    '[{"kind":"labour","title":"Panel light installation (3 hr)","qty":3,"unit_price":30000},
      {"kind":"part","title":"LED panel light 18 W","qty":4,"unit_price":45000}]');
  perform pg_temp.mk_booking('fb000013-5eed-5eed-8000-000000000000', 'c0000004-5eed-5eed-8000-000000000000', f, 'electrician',
    'closed_no_work', now() - interval '10 days' - interval '60 minutes', interval '10 minutes', 'Full house rewiring estimate',
    '[{"kind":"labour","title":"Full house rewiring","qty":1,"unit_price":1500000},
      {"kind":"part","title":"Wires, conduits and switches","qty":1,"unit_price":900000}]');

  perform pg_temp.mk_review('fb000009-5eed-5eed-8000-000000000000', 5, 5, 5, 5, 4,
    'Fixed the gas leak properly and showed me the pressure readings. Great job.', 'Thank you madam!', now() - interval '2 days');
  perform pg_temp.mk_review('fb000010-5eed-5eed-8000-000000000000', 4, 4, 5, 4, 4,
    'Neat inverter installation. Came 20 minutes late.', null, now() - interval '7 days');
  perform pg_temp.mk_review('fb000011-5eed-5eed-8000-000000000000', 5, 5, 5, 5, 5,
    'Very clean jet service, AC cooling like new.', null, now() - interval '14 days');
  perform pg_temp.mk_review('fb000012-5eed-5eed-8000-000000000000', 5, 5, 4, 5, 5, null, null, now() - interval '24 days');
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 10. Chat
-- -----------------------------------------------------------------------------------------------------
select pg_temp.mk_msgs('fc000003-5eed-5eed-8000-000000000000', now() - interval '29 minutes', array[
  'P: Namaste! I have accepted your booking. Our team of 2 will reach by 11 AM.',
  'C: Great, thanks. Please bring your own vacuum cleaner.',
  'P: Yes, all equipment and chemicals are included.',
  'C: Perfect. I will share the start code when you arrive.']);
select pg_temp.mk_msgs('fc000004-5eed-5eed-8000-000000000000', now() - interval '25 minutes', array[
  'P: Started from Auto Nagar, ETA 20 minutes.',
  'C: The car is parked in the basement, slot B-12.',
  'P: Okay sir, I will call when I reach the gate.']);
select pg_temp.mk_msgs('fc000006-5eed-5eed-8000-000000000000', now() - interval '44 minutes', array[
  'P: Checked the AC. Gas pressure is very low and the capacitor is weak.',
  'P: Sent you the quote: gas refill 1,500 + capacitor 650. The visit fee is adjusted in the total.',
  'C: Is the capacitor really needed?',
  'P: Yes sir, it reads 30uF instead of 45uF. AC will trip again without it.',
  'C: Okay, let me check and approve.']);
select pg_temp.mk_msgs('fc000008-5eed-5eed-8000-000000000000', now() - interval '40 minutes', array[
  'C: Can you also paint the hall ceiling?',
  'P: Sure, I have sent a change order for the ceiling with 10 L ceiling white.',
  'C: Will review it tonight.']);
select pg_temp.mk_msgs('fc000009-5eed-5eed-8000-000000000000', now() - interval '28 minutes', array[
  'P: Work completed. All three doors aligned and hinges replaced.',
  'C: Looks good, thank you!',
  'P: Please share the completion code shown in the app.']);
select pg_temp.mk_msgs('fc000011-5eed-5eed-8000-000000000000', now() - interval '5 days', array[
  'C: Thank you, no leakage now.',
  'P: Welcome sir. Call me anytime.']);
select pg_temp.mk_msgs('fc000016-5eed-5eed-8000-000000000000', now() - interval '4 hours', array[
  'C: The AC stopped cooling again in the evening.',
  'P: Sorry sir, I can come tomorrow morning to check.',
  'C: I have raised a dispute in the app, please resolve it.']);
select pg_temp.mk_msgs('fb000003-5eed-5eed-8000-000000000000', now() - interval '14 minutes', array[
  'P: Hi, I have accepted. Will start in 10 minutes.',
  'C: Okay, the gate code is 1290.',
  'P: Noted, see you soon.']);
select pg_temp.mk_msgs('fb000005-5eed-5eed-8000-000000000000', now() - interval '35 minutes', array[
  'C: How long will the service take?',
  'P: About 45 minutes, madam.',
  'C: Okay, thank you.']);
select pg_temp.mk_msgs('fb000006-5eed-5eed-8000-000000000000', now() - interval '20 minutes', array[
  'P: Done. The fan is running smoothly now. Please read out the completion code.',
  'C: Thanks! Code is in the app, will tell you.',
  'C: It is showing in my bookings screen now.']);

-- -----------------------------------------------------------------------------------------------------
-- 11. Aggregates (the review trigger only fires on insert; re-runs delete and re-create reviews)
-- -----------------------------------------------------------------------------------------------------
update public.providers p
   set rating_avg = coalesce(s.avg_rating, 0),
       rating_count = s.cnt,
       jobs_completed = (select count(*) from public.bookings b where b.provider_id = p.id and b.completed_at is not null)
  from (select pr.id, (select round(avg(r.rating)::numeric, 2) from public.reviews r where r.provider_id = pr.id) as avg_rating,
               (select count(*)::int from public.reviews r where r.provider_id = pr.id) as cnt
          from public.providers pr) s
 where s.id = p.id
   and (p.id in (select id from seed_providers) or p.id = pg_temp.founder());
update public.providers set commission_tier = public._commission_bp(id, now()) / 100
 where id in (select id from seed_providers) or id = pg_temp.founder();

commit;

-- -----------------------------------------------------------------------------------------------------
-- Summary (the SQL Editor shows this result)
-- -----------------------------------------------------------------------------------------------------
with f as (select id from auth.users where phone in ('919999999999', '+919999999999') order by created_at limit 1)
select section, item, detail
  from (
    select 1 as grp, 0 as k, 'rows' as section, t.name as item, t.n::text as detail
      from (values
        ('providers (verified / pending)', (select count(*) filter (where kyc_status = 'verified') || ' / '
                                                   || count(*) filter (where kyc_status = 'pending') from public.providers)),
        ('provider_services', (select count(*)::text from public.provider_services)),
        ('rate_card_items', (select count(*)::text from public.rate_card_items)),
        ('profiles', (select count(*)::text from public.profiles)),
        ('addresses', (select count(*)::text from public.addresses)),
        ('bookings', (select count(*)::text from public.bookings)),
        ('reviews', (select count(*)::text from public.reviews)),
        ('quotes / quote_items', (select (select count(*) from public.quotes) || ' / ' || (select count(*) from public.quote_items))),
        ('payments', (select count(*)::text from public.payments)),
        ('payouts / payout_transfers', (select (select count(*) from public.payouts) || ' / ' || (select count(*) from public.payout_transfers))),
        ('refunds', (select count(*)::text from public.refunds)),
        ('messages', (select count(*)::text from public.messages)),
        ('booking_events', (select count(*)::text from public.booking_events))
      ) t(name, n)
    union all
    select 2, array_position(enum_range(null::public.booking_status), b.status), 'you as CUSTOMER', b.status::text,
           '#' || left(b.id::text, 8) || '  ' || c.name || ' - ' || pf.full_name
           || case when b.status in ('accepted', 'en_route') then '  | start OTP ' || s.start_otp else '' end
           || case when b.status = 'completion_requested' then '  | END OTP ' || s.end_otp else '' end
      from public.bookings b join f on f.id = b.customer_id
      join public.categories c on c.id = b.category_id
      join public.profiles pf on pf.id = b.provider_id
      join public.booking_secrets s on s.booking_id = b.id
     where b.id::text like '________-5eed-5eed-%'
    union all
    select 3, array_position(enum_range(null::public.booking_status), b.status), 'you as PROVIDER', b.status::text,
           '#' || left(b.id::text, 8) || '  ' || c.name || ' - ' || pf.full_name
           || case when b.status in ('requested', 'accepted', 'en_route') then '  | start OTP ' || s.start_otp else '' end
           || case when b.status = 'completion_requested' then '  | END OTP ' || s.end_otp else '' end
      from public.bookings b join f on f.id = b.provider_id
      join public.categories c on c.id = b.category_id
      join public.profiles pf on pf.id = b.customer_id
      join public.booking_secrets s on s.booking_id = b.id
     where b.id::text like '________-5eed-5eed-%'
  ) x
 order by grp, k, detail;

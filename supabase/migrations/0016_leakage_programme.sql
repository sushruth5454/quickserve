-- Phase M6: repeat-client incentives, bring-your-own-client bookings and leakage signals.
-- All amounts are integer paise. Commission remains provider-paid; BYO uses a 3% customer fee
-- and zero provider commission.

alter table public.bookings
  add column booking_origin text not null default 'marketplace'
    check (booking_origin in ('marketplace', 'byo'));

-- Base provider tier. The four-argument overload below is booking-aware and is the payout
-- source of truth; this overload remains for profile/tier display.
create or replace function public._commission_bp(p_provider_id uuid, p_at timestamptz)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p_at < p.created_at + interval '30 days' then 0
           when p.jobs_completed >= 200 then 800
           when p.jobs_completed >= 50 then 1000
           else 1200
         end
    from public.providers p
   where p.id = p_provider_id;
$$;

-- Repeat discount is applied to the provider tier, then floored at 5%. A prior completed
-- in-app booking proves the pair (not merely an unpaid request), and the current payout is
-- explicitly excluded.
create or replace function public._commission_bp(
  p_provider_id uuid,
  p_customer_id uuid,
  p_booking_id uuid,
  p_at timestamptz
)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bp int := public._commission_bp(p_provider_id, p_at);
  v_repeat boolean;
begin
  select exists (
    select 1
      from public.bookings prior
     where prior.provider_id = p_provider_id
       and prior.customer_id = p_customer_id
       and prior.id <> p_booking_id
       and prior.completed_at is not null
       and prior.completed_at >= p_at - interval '12 months'
       and prior.completed_at <= p_at
       and prior.status in ('completed', 'closed')
  )
    into v_repeat;

  if v_repeat and v_bp > 0 then
    return greatest(v_bp - 400, 500);
  end if;
  return v_bp;
end;
$$;

create or replace function public._create_payout(
  p_booking_id uuid,
  p_gross int,
  p_commissionable int,
  p_release_after timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_bp int;
  v_commission int;
  v_gst int;
  v_payout uuid;
begin
  select * into b from public.bookings where id = p_booking_id;
  perform public._assert(found, 'booking not found');

  -- BYO's 3% fee is funded by the customer through platform_fee. There is no
  -- provider commission and therefore no GST-on-commission deduction.
  v_bp := case
    when b.booking_origin = 'byo' then 0
    else public._commission_bp(b.provider_id, b.customer_id, b.id, now())
  end;
  v_commission := round(p_commissionable::numeric * v_bp / 10000);
  v_gst := round(v_commission::numeric * 18 / 100);

  insert into public.payouts (
    booking_id, provider_id, gross, commission, gst_on_commission, amount, release_after
  )
  values (
    b.id, b.provider_id, p_gross, v_commission, v_gst,
    greatest(p_gross - v_commission - v_gst, 0), p_release_after
  )
  on conflict (booking_id) do nothing
  returning id into v_payout;

  if v_payout is not null then
    update public.bookings set commission = v_commission, gst_on_commission = v_gst where id = b.id;
    perform public._allocate_payout(v_payout);
  end if;
end;
$$;

create or replace function public._contains_contact_hint(p_text text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_text, '') ~* (
    '(^|[^0-9])(\+?91[[:space:]().-]*)?[6-9]([[:space:]().-]*[0-9]){9}([^0-9]|$)'
    || '|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
    || '|\mwhats?[[:space:]]*app\M|\mtelegram\M|\mphonepe\M|\mgpay\M|\mpaytm\M|\mupi\M'
  );
$$;

-- A token is returned once at creation and only its SHA-256 digest is stored.
create table public.byo_invites (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  provider_service_id uuid not null references public.provider_services (id),
  customer_label text not null,
  description text not null default '',
  amount_paise int not null check (amount_paise > 0 and amount_paise <= 10000000),
  fee_bp int not null default 300 check (fee_bp = 300),
  scheduled_at timestamptz,
  token_hash text not null unique,
  status text not null default 'open' check (status in ('open', 'claimed', 'cancelled')),
  expires_at timestamptz not null,
  claimed_by uuid references public.profiles (id),
  booking_id uuid unique references public.bookings (id),
  created_at timestamptz not null default now()
);
create index byo_invites_provider_created_idx on public.byo_invites (provider_id, created_at desc);
create index byo_invites_expiry_idx on public.byo_invites (expires_at) where status = 'open';

create or replace function public.create_byo_invite(
  p_provider_service_id uuid,
  p_customer_label text,
  p_description text,
  p_amount_paise int,
  p_scheduled_at timestamptz default null
)
returns table (invite_id uuid, token text, share_url text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_service public.provider_services;
  v_invite uuid;
  v_token text;
  v_expires timestamptz := now() + interval '7 days';
begin
  select ps.* into v_service
    from public.provider_services ps
    join public.providers p on p.id = ps.provider_id
   where ps.id = p_provider_service_id
     and ps.provider_id = v_uid
     and ps.active
     and p.kyc_status = 'verified'
     and not p.suspended;
  perform public._assert(found, 'provider service not available');
  perform public._assert(char_length(trim(p_customer_label)) between 2 and 80, 'customer name must be 2 to 80 characters');
  perform public._assert(char_length(coalesce(p_description, '')) <= 1000, 'description is too long');
  perform public._assert(
    not public._contains_contact_hint(p_customer_label)
      and not public._contains_contact_hint(coalesce(p_description, '')),
    'do not include phone, email, WhatsApp or payment-handle details'
  );
  perform public._assert(p_amount_paise > 0 and p_amount_paise <= 10000000, 'invalid job amount');
  perform public._assert(
    p_scheduled_at is null or p_scheduled_at > now() - interval '5 minutes',
    'scheduled time is in the past'
  );

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.byo_invites (
    provider_id, provider_service_id, customer_label, description,
    amount_paise, scheduled_at, token_hash, expires_at
  )
  values (
    v_uid, v_service.id, trim(p_customer_label), coalesce(trim(p_description), ''),
    p_amount_paise, p_scheduled_at,
    encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'), v_expires
  )
  returning id into v_invite;

  return query
    select v_invite, v_token, 'quickserve://byo/' || v_token, v_expires;
end;
$$;

create or replace function public.preview_byo_invite(p_token text)
returns table (
  invite_id uuid,
  provider_id uuid,
  provider_name text,
  provider_service_id uuid,
  category_name text,
  customer_label text,
  description text,
  amount_paise int,
  fee_paise int,
  total_paise int,
  scheduled_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.provider_id, pr.full_name, i.provider_service_id, c.name,
         i.customer_label, i.description, i.amount_paise,
         round(i.amount_paise::numeric * i.fee_bp / 10000)::int,
         i.amount_paise + round(i.amount_paise::numeric * i.fee_bp / 10000)::int,
         i.scheduled_at, i.expires_at
    from public.byo_invites i
    join public.profiles pr on pr.id = i.provider_id
    join public.provider_services ps on ps.id = i.provider_service_id
    join public.categories c on c.id = ps.category_id
   where i.token_hash = encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex')
     and i.status = 'open'
     and i.expires_at > now();
$$;

create or replace function public.claim_byo_invite(
  p_token text,
  p_address_line text,
  p_city text,
  p_lat double precision,
  p_lng double precision
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  i public.byo_invites;
  s public.provider_services;
  v_fee int;
  v_address uuid;
  v_booking uuid;
  v_quote uuid;
begin
  select * into i
    from public.byo_invites
   where token_hash = encode(extensions.digest(convert_to(coalesce(p_token, ''), 'UTF8'), 'sha256'), 'hex')
   for update;
  perform public._assert(found, 'invite not found');
  perform public._assert(i.status = 'open', 'invite has already been used');
  perform public._assert(i.expires_at > now(), 'invite has expired');
  perform public._assert(i.provider_id <> v_uid, 'the provider cannot claim their own invite');
  perform public._assert(coalesce(trim(p_address_line), '') <> '' and coalesce(trim(p_city), '') <> '', 'address is required');
  perform public._assert(p_lat is not null and p_lng is not null, 'location is required');

  select ps.* into s
    from public.provider_services ps
    join public.providers p on p.id = ps.provider_id
   where ps.id = i.provider_service_id
     and ps.active
     and p.kyc_status = 'verified'
     and not p.suspended;
  perform public._assert(found, 'provider service not available');

  v_fee := round(i.amount_paise::numeric * i.fee_bp / 10000)::int;
  insert into public.addresses (user_id, label, line1, city, lat, lng)
  values (v_uid, 'Booking', trim(p_address_line), trim(p_city), p_lat, p_lng)
  returning id into v_address;

  insert into public.bookings (
    customer_id, provider_id, category_id, provider_service_id, address_id,
    description, scheduled_at, status, visit_fee, platform_fee, total_amount, booking_origin
  )
  values (
    v_uid, i.provider_id, s.category_id, s.id, v_address,
    i.description, i.scheduled_at, 'pending_payment', 0, v_fee,
    i.amount_paise + v_fee, 'byo'
  )
  returning id into v_booking;

  insert into public.quotes (
    booking_id, version, status, subtotal_labour, subtotal_parts, subtotal_other, total, note
  )
  values (
    v_booking, 1, 'approved', i.amount_paise, 0, 0, i.amount_paise,
    'Provider-created bring-your-own-client agreement'
  )
  returning id into v_quote;

  update public.bookings set approved_quote_id = v_quote where id = v_booking;
  insert into public.booking_secrets (booking_id, start_otp) values (v_booking, public._gen_otp());
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (v_booking, v_uid, null, 'pending_payment', 'BYO invite claimed');
  update public.byo_invites
     set status = 'claimed', claimed_by = v_uid, booking_id = v_booking
   where id = i.id;
  return v_booking;
end;
$$;

create or replace function public.list_my_byo_invites()
returns table (
  invite_id uuid,
  provider_service_id uuid,
  category_name text,
  customer_label text,
  description text,
  amount_paise int,
  fee_paise int,
  total_paise int,
  scheduled_at timestamptz,
  status text,
  booking_id uuid,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.provider_service_id, c.name, i.customer_label, i.description,
         i.amount_paise, round(i.amount_paise::numeric * i.fee_bp / 10000)::int,
         i.amount_paise + round(i.amount_paise::numeric * i.fee_bp / 10000)::int,
         i.scheduled_at,
         case when i.status = 'open' and i.expires_at <= now() then 'expired' else i.status end,
         i.booking_id, i.created_at, i.expires_at
    from public.byo_invites i
    join public.provider_services ps on ps.id = i.provider_service_id
    join public.categories c on c.id = ps.category_id
   where i.provider_id = auth.uid()
   order by i.created_at desc
   limit 100;
$$;

create or replace function public.cancel_byo_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.byo_invites
     set status = 'cancelled'
   where id = p_invite_id and provider_id = auth.uid() and status = 'open';
  perform public._assert(found, 'invite is not open');
end;
$$;

-- A fixed BYO payment is the complete pre-agreed job amount plus the 3% fee.
create or replace function public.prepare_payment(p_booking_id uuid, p_user_id uuid)
returns table (payment_id uuid, amount int, purpose public.payment_purpose, short_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings := public._lock_booking(p_booking_id);
  q public.quotes;
  v_purpose public.payment_purpose;
  v_amount int;
  v_quote uuid;
  p public.payments;
begin
  perform public._assert(b.customer_id = p_user_id, 'only the customer can pay');
  if b.booking_origin = 'byo' and b.status = 'pending_payment' then
    select * into q from public.quotes where id = b.approved_quote_id;
    perform public._assert(q.id is not null and q.status = 'approved', 'BYO agreement is missing');
    v_purpose := 'fixed';
    v_quote := q.id;
    v_amount := b.total_amount - public._net_paid(b.id);
  elsif b.status = 'pending_payment' then
    v_purpose := 'visit_fee';
    v_amount := b.visit_fee;
  elsif b.status in ('awaiting_payment', 'in_progress') then
    select * into q from public.quotes x
     where x.booking_id = b.id and x.status = 'approved_pending_payment'
     order by x.version desc limit 1;
    perform public._assert(q.id is not null, 'nothing to pay');
    v_purpose := 'balance';
    v_quote := q.id;
    v_amount := public._required_total(q.total, b.visit_fee, b.platform_fee) - public._net_paid(b.id);
  else
    raise exception 'nothing to pay in this state' using errcode = 'P0001';
  end if;
  perform public._assert(v_amount > 0, 'nothing to pay');

  select * into p from public.payments x
   where x.booking_id = b.id and x.status = 'created' and x.purpose = v_purpose
     and x.amount = v_amount and x.quote_id is not distinct from v_quote and x.short_url is not null
   order by x.created_at desc limit 1;
  if found then
    return query select p.id, p.amount, p.purpose, p.short_url;
    return;
  end if;

  update public.payments x set status = 'failed', cancel_link_pending = true
   where x.booking_id = b.id and x.status = 'created';
  insert into public.payments (booking_id, quote_id, purpose, amount)
  values (b.id, v_quote, v_purpose, v_amount)
  returning * into p;
  return query select p.id, p.amount, p.purpose, null::text;
end;
$$;

create or replace function public.record_payment_paid(p_link_id text, p_payment_id text, p_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments;
  b public.bookings;
  q public.quotes;
  v_required int;
  v_accept boolean;
begin
  if exists (select 1 from public.payments where razorpay_payment_id = p_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into p from public.payments where razorpay_link_id = p_link_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown link');
  end if;
  if p.amount <> p_amount then
    return jsonb_build_object('ok', false, 'error', 'amount mismatch');
  end if;

  b := public._lock_booking(p.booking_id);
  if p.status = 'created' then
    if p.purpose = 'fixed' and b.booking_origin = 'byo' and b.status = 'pending_payment' then
      select * into q from public.quotes where id = p.quote_id for update;
      if q.status = 'approved' then
        v_required := b.total_amount;
      end if;
    elsif p.purpose = 'visit_fee' and b.status = 'pending_payment' then
      v_required := b.visit_fee;
    elsif p.purpose = 'balance' and p.quote_id is not null then
      select * into q from public.quotes where id = p.quote_id for update;
      if q.status = 'approved_pending_payment' then
        v_required := public._required_total(q.total, b.visit_fee, b.platform_fee);
      end if;
    end if;
  end if;
  v_accept := v_required is not null and public._net_paid(b.id) + p.amount <= v_required;

  update public.payments
     set status = 'paid', razorpay_payment_id = p_payment_id, paid_at = now(), cancel_link_pending = false
   where id = p.id;

  if not v_accept then
    perform public._queue_refund(p.id, p.amount, 'stale or excess payment');
    perform public._log_event(b.id, null, 'payment ' || p_payment_id || ' not owed; queued for refund');
    return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund', true);
  end if;

  if p.purpose = 'fixed' then
    update public.bookings set accepted_at = now() where id = b.id;
    perform public._set_status(b.id, 'accepted', null, 'BYO fixed payment received');
  elsif p.purpose = 'visit_fee' then
    perform public._set_status(b.id, 'requested', null, 'visit fee paid');
  elsif public._net_paid(b.id) >= v_required then
    perform public._activate_quote(b.id, q.id);
    if b.status = 'awaiting_payment' then
      perform public._set_status(b.id, 'in_progress', null, 'balance paid');
    else
      perform public._log_event(b.id, null, 'change order v' || q.version || ' paid');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'booking_id', b.id);
end;
$$;

-- BYO is pre-priced, so the start OTP moves straight from en_route to in_progress;
-- marketplace jobs still enter inspecting and follow quote approval.
create or replace function public.arrive(p_booking_id uuid, p_otp text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  s public.booking_secrets;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can mark arrival');
  perform public._assert(b.status = 'en_route', 'provider is not en route');
  select * into s from public.booking_secrets where booking_id = b.id for update;
  if s.start_attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'locked', 'attempts_left', 0);
  end if;
  if p_otp is distinct from s.start_otp then
    update public.booking_secrets set start_attempts = start_attempts + 1 where booking_id = b.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_otp', 'attempts_left', 4 - s.start_attempts);
  end if;
  update public.booking_secrets set start_attempts = 0 where booking_id = b.id;
  perform public._set_status(
    b.id,
    case when b.booking_origin = 'byo' then 'in_progress'::public.booking_status else 'inspecting'::public.booking_status end,
    v_uid
  );
  return jsonb_build_object('ok', true);
end;
$$;

create table public.leakage_signals (
  id bigint generated always as identity primary key,
  subject_id uuid not null references public.profiles (id),
  kind text not null check (kind in ('contact_details', 'off_platform_payment')),
  booking_id uuid references public.bookings (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index leakage_signals_subject_idx on public.leakage_signals (subject_id, created_at desc);
create index leakage_signals_booking_idx on public.leakage_signals (booking_id, created_at desc);

create or replace function public._leakage_signal_kinds(p_body text)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_kinds text[] := '{}';
begin
  if public._contains_contact_hint(p_body) then
    v_kinds := array_append(v_kinds, 'contact_details');
  end if;
  if coalesce(p_body, '') ~* (
    '\mpay[[:space:]]+(me|directly|outside|offline|cash)\M'
    || '|direct[[:space:]]+payment|cash[[:space:]]+payment|outside[[:space:]]+quickserve'
    || '|avoid[[:space:]]+(the[[:space:]]+)?(fee|commission)|send[[:space:]]+payment'
  ) then
    v_kinds := array_append(v_kinds, 'off_platform_payment');
  end if;
  return v_kinds;
end;
$$;

-- Replaces direct client INSERT so detection runs on the authoritative server path.
-- The message is still delivered. Only an inline nudge is produced; this function never
-- suspends, blocks or changes provider ranking.
create or replace function public.send_booking_message(p_booking_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings;
  v_body text := trim(coalesce(p_body, ''));
  v_message uuid;
  v_kinds text[];
  v_kind text;
begin
  select * into b from public.bookings where id = p_booking_id for share;
  perform public._assert(found, 'booking not found');
  perform public._assert(auth.uid() in (b.customer_id, b.provider_id), 'not a booking participant');
  perform public._assert(
    b.status not in ('pending_payment', 'declined', 'expired', 'cancelled'),
    'chat is closed for this booking'
  );
  perform public._assert(v_body <> '' and char_length(v_body) <= 2000, 'message is invalid');

  insert into public.messages (booking_id, sender_id, body)
  values (b.id, v_uid, v_body)
  returning id into v_message;

  v_kinds := public._leakage_signal_kinds(v_body);
  foreach v_kind in array v_kinds loop
    insert into public.leakage_signals (subject_id, kind, booking_id, message_id, details)
    values (v_uid, v_kind, b.id, v_message, jsonb_build_object('source', 'chat', 'matched', v_kind));
  end loop;

  return jsonb_build_object(
    'message_id', v_message,
    'nudge', coalesce(array_length(v_kinds, 1), 0) > 0
  );
end;
$$;

alter table public.byo_invites enable row level security;
alter table public.leakage_signals enable row level security;
revoke all on public.byo_invites, public.leakage_signals from anon, authenticated;
grant select on public.leakage_signals to authenticated;
create policy leakage_signals_admin_select on public.leakage_signals
  for select to authenticated using (public._is_admin());

revoke insert on public.messages from anon, authenticated;
drop policy if exists messages_insert on public.messages;

revoke execute on function
  public._commission_bp(uuid, uuid, uuid, timestamptz),
  public._contains_contact_hint(text),
  public._leakage_signal_kinds(text),
  public.create_byo_invite(uuid, text, text, int, timestamptz),
  public.preview_byo_invite(text),
  public.claim_byo_invite(text, text, text, double precision, double precision),
  public.list_my_byo_invites(),
  public.cancel_byo_invite(uuid),
  public.send_booking_message(uuid, text)
from public, anon;
grant execute on function
  public.create_byo_invite(uuid, text, text, int, timestamptz),
  public.claim_byo_invite(text, text, text, double precision, double precision),
  public.list_my_byo_invites(),
  public.cancel_byo_invite(uuid),
  public.send_booking_message(uuid, text)
to authenticated;
grant execute on function public.preview_byo_invite(text) to anon, authenticated;

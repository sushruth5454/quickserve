-- WP H3; owns: expire_stalled_bookings, report_no_show, _home_booking_safety_config,
-- admin_get_home_booking_safety_rules, admin_set_home_booking_safety_rules; sources: WS2-T11.

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values (
  'home_no_show_reporting',
  false,
  'Home-service no-show reports',
  'Customers and providers can report a missed home-service visit. Off: no-show reporting is hidden and rejected; stalled-booking cleanup remains active.',
  'Home services',
  71
)
on conflict (key) do nothing;

insert into public.app_config (key, value)
values (
  'home_booking_safety',
  '{"stalled_timeout_hours":48,"no_show_grace_minutes":30}'::jsonb
)
on conflict (key) do nothing;

create or replace function public._home_booking_safety_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with configured as (
    select coalesce(
      (select c.value from public.app_config c where c.key = 'home_booking_safety'),
      '{}'::jsonb
    ) as value
  )
  select jsonb_build_object(
    'stalled_timeout_hours',
    case
      when (value ->> 'stalled_timeout_hours') ~ '^[0-9]{1,3}$' then
        case
          when (value ->> 'stalled_timeout_hours')::int between 24 and 168
          then (value ->> 'stalled_timeout_hours')::int
          else 48
        end
      else 48
    end,
    'no_show_grace_minutes',
    case
      when (value ->> 'no_show_grace_minutes') ~ '^[0-9]{1,4}$' then
        case
          when (value ->> 'no_show_grace_minutes')::int between 15 and 240
          then (value ->> 'no_show_grace_minutes')::int
          else 30
        end
      else 30
    end
  )
  from configured;
$$;

create or replace function public.admin_get_home_booking_safety_rules()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return public._home_booking_safety_config();
end;
$$;

create or replace function public.admin_set_home_booking_safety_rules(
  p_stalled_timeout_hours int,
  p_no_show_grace_minutes int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_config jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(
    p_stalled_timeout_hours between 24 and 168,
    'stalled timeout must be between 24 and 168 hours'
  );
  perform public._assert(
    p_no_show_grace_minutes between 15 and 240,
    'no-show grace must be between 15 and 240 minutes'
  );
  v_config := jsonb_build_object(
    'stalled_timeout_hours', p_stalled_timeout_hours,
    'no_show_grace_minutes', p_no_show_grace_minutes
  );
  insert into public.app_config (key, value, updated_at, updated_by)
  values ('home_booking_safety', v_config, now(), v_uid)
  on conflict (key) do update
    set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  insert into public.admin_audit_log (admin_id, action, details)
  values (v_uid, 'set_home_booking_safety', v_config);
  return v_config;
end;
$$;

create index if not exists bookings_home_stalled_idx
  on public.bookings (updated_at, id)
  where archetype = 'inspect_quote'
    and status in ('quote_sent', 'awaiting_payment');

insert into public.archetype_transitions (archetype, from_status, to_status, actor)
values
  ('inspect_quote', 'quote_sent', 'closed_no_work', 'system'),
  ('inspect_quote', 'awaiting_payment', 'closed_no_work', 'system'),
  ('inspect_quote', 'accepted', 'disputed', 'customer'),
  ('inspect_quote', 'accepted', 'disputed', 'provider'),
  ('inspect_quote', 'en_route', 'disputed', 'customer'),
  ('inspect_quote', 'en_route', 'disputed', 'provider'),
  ('fixed', 'accepted', 'disputed', 'customer'),
  ('fixed', 'accepted', 'disputed', 'provider'),
  ('fixed', 'en_route', 'disputed', 'customer'),
  ('fixed', 'en_route', 'disputed', 'provider'),
  ('time_based', 'accepted', 'disputed', 'customer'),
  ('time_based', 'accepted', 'disputed', 'provider'),
  ('time_based', 'en_route', 'disputed', 'customer'),
  ('time_based', 'en_route', 'disputed', 'provider')
on conflict do nothing;

create or replace function public.expire_stalled_bookings()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired int := 0;
  v_timeout_hours int := (public._home_booking_safety_config() ->> 'stalled_timeout_hours')::int;
  v_paid_visit_fee int;
  b public.bookings;
begin
  for b in
    select *
      from public.bookings
     where archetype = 'inspect_quote'
       and status in ('quote_sent', 'awaiting_payment')
       and updated_at < now() - make_interval(hours => v_timeout_hours)
     order by updated_at, id
     for update skip locked
  loop
    select coalesce(sum(greatest(p.amount - coalesce(r.amount, 0), 0)), 0)::int
      into v_paid_visit_fee
      from public.payments p
      left join lateral (
        select coalesce(sum(refund.amount) filter (where refund.status <> 'failed'), 0)::int as amount
          from public.refunds refund
         where refund.payment_id = p.id
      ) r on true
     where p.booking_id = b.id
       and p.purpose::text = 'visit_fee'
       and p.status = 'paid'
       and p.razorpay_payment_id is not null
       and p.funding_source is distinct from 'coins';
    if b.visit_fee > 0 and v_paid_visit_fee >= b.visit_fee then
      perform public._create_payout(
        b.id, b.visit_fee, b.visit_fee, now() + interval '24 hours'
      );
    end if;
    perform public._set_status(
      b.id, 'closed_no_work', null,
      format('automatically closed after %s hours', v_timeout_hours)
    );
    v_expired := v_expired + 1;
  end loop;
  return v_expired;
end;
$$;

create or replace function public.report_no_show(p_booking_id uuid, p_party text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_grace_minutes int;
  b public.bookings;
begin
  perform public._assert(
    public._feature_enabled('home_no_show_reporting'),
    'home-service no-show reporting is turned off'
  );
  v_uid := public._require_uid();
  b := public._lock_booking(p_booking_id);
  v_grace_minutes := (public._home_booking_safety_config() ->> 'no_show_grace_minutes')::int;
  perform public._assert(p_party in ('customer', 'provider'), 'invalid absent party');
  perform public._assert(
    (p_party = 'provider' and b.customer_id = v_uid)
      or (p_party = 'customer' and b.provider_id = v_uid),
    'only the booking customer or provider can report'
  );
  perform public._assert(
    b.archetype in ('inspect_quote', 'fixed', 'time_based'),
    'no-show reporting is only available for home-service bookings'
  );
  perform public._assert(
    b.status in ('accepted', 'en_route'),
    'no-show reporting is only available for accepted or en_route bookings'
  );
  perform public._assert(
    b.scheduled_at is not null
      and now() > b.scheduled_at + make_interval(mins => v_grace_minutes),
    'a no-show can be reported only after scheduled time plus the configured grace period'
  );

  perform 1
    from public.payouts
   where booking_id = b.id
   for update;
  perform 1
    from public.payout_transfers t
   where t.payout_id in (select id from public.payouts where booking_id = b.id)
   for update;
  update public.payouts
     set status = 'frozen'
   where booking_id = b.id and status = 'pending';
  update public.payout_transfers
     set status = 'failed', last_error = 'dispute: release frozen'
   where status = 'pending'
     and payout_id in (select id from public.payouts where booking_id = b.id);

  perform public._set_status(
    b.id, 'disputed', v_uid, p_party || ' no-show report'
  );
  perform public.support_start(
    format('A %s no-show was reported for home-service booking %s.', p_party, b.id),
    b.id,
    'Home-service no-show report'
  );
end;
$$;

revoke all on function public.expire_stalled_bookings() from public, anon, authenticated;
grant execute on function public.expire_stalled_bookings() to service_role;
revoke all on function public._home_booking_safety_config(),
  public.admin_get_home_booking_safety_rules(),
  public.admin_set_home_booking_safety_rules(int, int)
from public, anon, service_role;
revoke all on function public._home_booking_safety_config() from authenticated;
grant execute on function public.admin_get_home_booking_safety_rules(),
  public.admin_set_home_booking_safety_rules(int, int)
to authenticated;
revoke all on function public.report_no_show(uuid, text) from public, anon, service_role;
grant execute on function public.report_no_show(uuid, text) to authenticated;

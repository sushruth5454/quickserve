-- WP O3; owns: admin_get_booking, admin_list_problem_payouts, admin_retry_payout, admin_list_audit; sources: WS7-T06, WS7-T15.

create or replace function public.admin_get_booking(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  select jsonb_build_object(
    'booking', to_jsonb(b) - 'service_window',
    'category', c.name,
    'customer', jsonb_build_object('id', b.customer_id, 'name', cp.full_name, 'phone', cu.phone),
    'provider', jsonb_build_object('id', b.provider_id, 'name', pp.full_name, 'phone', pu.phone),
    'address', (
      select jsonb_build_object('line1', a.line1, 'city', a.city)
        from public.addresses a
       where a.id = b.address_id
    ),
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'at', e.at,
          'from', e.from_status,
          'to', e.to_status,
          'note', e.note,
          'actor_id', e.actor_id,
          'actor_role', case
            when e.actor_id is null then 'system'
            when e.actor_id = b.customer_id then 'customer'
            when e.actor_id = b.provider_id then 'provider'
            when exists (select 1 from public.admins a where a.user_id = e.actor_id) then 'admin'
            else 'system'
          end
        ) order by e.at, e.id
      )
        from public.booking_events e
       where e.booking_id = b.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pm.id,
          'purpose', pm.purpose,
          'amount', pm.amount,
          'status', pm.status,
          'paid_at', pm.paid_at,
          'gateway_id', pm.razorpay_payment_id,
          'funding_source', pm.funding_source
        ) order by pm.created_at, pm.id
      )
        from public.payments pm
       where pm.booking_id = b.id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'payment_id', r.payment_id,
          'amount', r.amount,
          'status', r.status,
          'attempts', r.attempts,
          'last_error', r.last_error,
          'created_at', r.created_at
        ) order by r.created_at, r.id
      )
        from public.refunds r
        join public.payments pm on pm.id = r.payment_id
       where pm.booking_id = b.id
    ), '[]'::jsonb),
    'payouts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', po.id,
          'gross', po.gross,
          'commission', po.commission,
          'amount', po.amount,
          'status', po.status,
          'release_after', po.release_after,
          'transferred_at', po.transferred_at
        ) order by po.created_at, po.id
      )
        from public.payouts po
       where po.booking_id = b.id
    ), '[]'::jsonb),
    'transfers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'payout_id', t.payout_id,
          'status', t.status,
          'last_error', t.last_error,
          'attempts', t.attempts,
          'amount', t.amount,
          'rail', t.rail,
          'gateway_status', t.gateway_status,
          'transferred_at', t.transferred_at
        ) order by t.created_at, t.id
      )
        from public.payout_transfers t
        join public.payouts po on po.id = t.payout_id
       where po.booking_id = b.id
    ), '[]'::jsonb),
    'reversals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'payout_transfer_id', r.payout_transfer_id,
          'amount', r.amount,
          'rail', r.rail,
          'status', r.status,
          'attempts', r.attempts,
          'last_error', r.last_error,
          'created_at', r.created_at,
          'completed_at', r.completed_at
        ) order by r.created_at, r.id
      )
        from public.payout_transfer_reversals r
        join public.payout_transfers t on t.id = r.payout_transfer_id
        join public.payouts po on po.id = t.payout_id
       where po.booking_id = b.id
    ), '[]'::jsonb),
    'receivables', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'provider_id', r.provider_id,
          'amount', r.amount,
          'recovered', r.recovered,
          'reason', r.reason,
          'status', r.status,
          'created_at', r.created_at
        ) order by r.created_at, r.id
      )
        from public.provider_receivables r
       where r.booking_id = b.id
    ), '[]'::jsonb)
  ) into v
    from public.bookings b
    join public.categories c on c.id = b.category_id
    left join public.profiles cp on cp.id = b.customer_id
    left join auth.users cu on cu.id = b.customer_id
    left join public.profiles pp on pp.id = b.provider_id
    left join auth.users pu on pu.id = b.provider_id
   where b.id = p_booking_id;
  perform public._assert(v is not null, 'booking not found');
  return v;
end;
$$;

create or replace function public.admin_list_problem_payouts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_payouts jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', po.id,
      'booking_id', po.booking_id,
      'sports_booking_id', po.sports_booking_id,
      'provider_id', po.provider_id,
      'payee_id', po.payee_id,
      'provider_name', coalesce(provider.full_name, payee.full_name),
      'gross', po.gross,
      'commission', po.commission,
      'amount', po.amount,
      'status', po.status,
      'release_after', po.release_after,
      'transferred_at', po.transferred_at,
      'transfers', coalesce(tx.transfers, '[]'::jsonb)
    ) order by po.created_at desc, po.id
  ), '[]'::jsonb)
    into v_payouts
    from public.payouts po
    left join public.profiles provider on provider.id = po.provider_id
    left join public.profiles payee on payee.id = po.payee_id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'status', t.status,
          'last_error', t.last_error,
          'attempts', t.attempts,
          'amount', t.amount,
          'rail', t.rail,
          'gateway_status', t.gateway_status,
          'created_at', t.created_at
        ) order by t.created_at, t.id
      ) as transfers
        from public.payout_transfers t
       where t.payout_id = po.id
    ) tx on true
   where po.status = 'failed'
      or exists (
        select 1
          from public.payout_transfers t
         where t.payout_id = po.id
           and t.last_error is not null
      );
  return jsonb_build_object('payouts', v_payouts);
end;
$$;

create or replace function public.admin_retry_payout(p_payout_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public._require_uid();
  v_note text := nullif(btrim(p_note), '');
  po public.payouts;
  v_transfer_count int;
  v_payout_count int;
  v_transfer_ids jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(v_note is not null and char_length(v_note) <= 500, 'a note of 1-500 characters is required');

  perform 1
    from public.payout_transfers t
   where t.payout_id = p_payout_id
     and t.status = 'failed'
   order by t.id
   for update;
  get diagnostics v_transfer_count = row_count;

  select * into po
    from public.payouts p
   where p.id = p_payout_id
   for update;
  perform public._assert(found and po.status = 'failed', 'only a failed payout can be retried');
  perform public._assert(v_transfer_count > 0, 'no failed transfer is available to retry');

  select coalesce(jsonb_agg(t.id order by t.id), '[]'::jsonb)
    into v_transfer_ids
    from public.payout_transfers t
   where t.payout_id = po.id
     and t.status = 'failed';

  update public.payout_transfers
     set status = 'pending',
         next_attempt_at = null,
         razorpay_transfer_id = case
           when rail = 'payouts' and gateway_status in ('failed', 'reversed', 'rejected', 'cancelled')
             then null
           else razorpay_transfer_id
         end,
         idempotency_seq = case
           when rail = 'payouts' and gateway_status in ('failed', 'reversed', 'rejected', 'cancelled')
             then idempotency_seq + 1
           else idempotency_seq
         end,
         gateway_status = case when rail = 'payouts' then null else gateway_status end
   where payout_id = po.id
     and status = 'failed';
  get diagnostics v_transfer_count = row_count;
  perform public._assert(v_transfer_count > 0, 'no failed transfer is available to retry');

  update public.payouts
     set status = 'pending'
   where id = po.id
     and status = 'failed';
  get diagnostics v_payout_count = row_count;
  perform public._assert(v_payout_count = 1, 'payout state changed before retry');

  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (
    v_admin,
    'retry_payout',
    po.id,
    jsonb_build_object(
      'note', v_note,
      'amount_paise', po.amount,
      'transfer_ids', v_transfer_ids
    )
  );
  return jsonb_build_object(
    'payout_id', po.id,
    'status', 'pending',
    'transfer_ids', v_transfer_ids
  );
end;
$$;

create or replace function public.admin_list_audit(p_target uuid default null, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entries jsonb;
begin
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(p_limit is not null and p_limit between 1 and 500, 'limit must be between 1 and 500');
  select coalesce(jsonb_agg(row_data.entry order by row_data.audit_at desc, row_data.audit_id desc), '[]'::jsonb)
    into v_entries
    from (
      select
        l.id as audit_id,
        l.at as audit_at,
        jsonb_build_object(
          'id', l.id::text,
          'admin_id', l.admin_id,
          'admin_name', coalesce(nullif(btrim(p.full_name), ''), 'Admin ' || left(l.admin_id::text, 8)),
          'action', l.action,
          'target_id', l.target_id,
          'details', l.details,
          'created_at', l.at
        ) as entry
        from public.admin_audit_log l
        left join public.profiles p on p.id = l.admin_id
       where p_target is null
          or l.target_id = p_target
       order by l.at desc, l.id desc
       limit p_limit
    ) row_data;
  return v_entries;
end;
$$;

revoke all on function public.admin_list_problem_payouts(),
  public.admin_retry_payout(uuid, text),
  public.admin_list_audit(uuid, int)
from public, anon;
grant execute on function public.admin_list_problem_payouts(),
  public.admin_retry_payout(uuid, text),
  public.admin_list_audit(uuid, int)
to authenticated;

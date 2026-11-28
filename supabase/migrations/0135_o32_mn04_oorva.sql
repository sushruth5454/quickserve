create or replace function public.admin_retry_refund(p_refund_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_payment_id uuid;
  v_payment_amount int;
  v_reserved_amount bigint;
  r public.refunds;
begin
  perform public._assert(public._is_admin(), 'admin only');

  select rf.payment_id
    into v_payment_id
    from public.refunds rf
   where rf.id = p_refund_id;
  perform public._assert(found, 'refund not found');

  select p.amount
    into v_payment_amount
    from public.payments p
   where p.id = v_payment_id
     for update;
  perform public._assert(found, 'refund payment not found');

  begin
    select rf.*
      into r
      from public.refunds rf
     where rf.id = p_refund_id
       for update nowait;
  exception
    when lock_not_available then
      raise exception using
        errcode = 'P0001',
        message = 'refund is changing; reload and retry';
  end;
  perform public._assert(
    found and r.payment_id = v_payment_id and r.status = 'failed',
    'only a failed refund can be retried'
  );
  perform public._assert(r.amount > 0, 'refund amount is invalid');

  select r.amount::bigint + coalesce(sum(sibling.amount), 0)::bigint
    into v_reserved_amount
    from public.refunds sibling
   where sibling.payment_id = v_payment_id
     and sibling.id <> r.id
     and sibling.status <> 'failed';
  perform public._assert(
    v_reserved_amount <= v_payment_amount::bigint,
    'refund capacity is no longer available; reload and review before retrying'
  );

  update public.refunds
     set status = 'pending',
         attempts = 0,
         next_attempt_at = null,
         processing_started_at = null,
         last_error = null
   where id = r.id;
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (
    v_uid, 'admin_retry_refund', r.id,
    jsonb_build_object('payment_id', r.payment_id, 'amount_paise', r.amount)
  );
  return jsonb_build_object('refund_id', r.id, 'status', 'pending', 'attempts', 0);
end;
$$;

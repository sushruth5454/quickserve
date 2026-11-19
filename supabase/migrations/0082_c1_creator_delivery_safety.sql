-- WP C1; owns: request_completion, submit_delivery, cancel_proposal_payment_default,
-- _cancel_booking_by_policy, auto_confirm_completions, _finalize_completion, remind_delivery_acceptance;
-- sources: WS5-T01, WS5-T14. Preserve the C2 screening and overdue-deadline branches.

alter table public.categories
  alter column deliverable_acceptance_hours set default 72;

update public.categories
   set deliverable_acceptance_hours = 72
 where archetype = 'proposal'
   and deliverable_acceptance_hours = 168;

insert into public.app_config (key, value)
values ('proposal', '{"dispute_hours":168}'::jsonb)
on conflict (key) do nothing;

update public.app_config
   set value = value || '{"dispute_hours":168}'::jsonb
 where key = 'proposal'
   and not (value ? 'dispute_hours');

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values (
  'creator_delivery_reminders',
  false,
  'Creator delivery reminders',
  'When off, customers do not receive 72- or 144-hour delivery acceptance reminders. Delivery acceptance, auto-confirmation and payment-default safety continue.',
  'Creators',
  30
)
on conflict (key) do nothing;

do $$
declare
  v_constraint oid;
  v_definition text;
  v_expression text;
begin
  select oid into v_constraint
    from pg_constraint
   where conrelid = 'public.notifications'::regclass
     and conname = 'notifications_kind_check'
     and contype = 'c';
  if v_constraint is not null then
    v_definition := pg_get_constraintdef(v_constraint);
    v_expression := substring(v_definition from 8 for char_length(v_definition) - 8);
    if position('delivery_acceptance_reminder' in v_expression) = 0 then
      alter table public.notifications drop constraint notifications_kind_check;
      execute format(
        'alter table public.notifications add constraint notifications_kind_check check ((%s) or kind = %L)',
        v_expression,
        'delivery_acceptance_reminder'
      );
    end if;
  end if;
end;
$$;

create or replace function public.request_completion(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_milestone record;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can request completion');
  perform public._assert(b.status = 'in_progress', 'job is not in progress');
  if b.archetype = 'proposal' then
    perform public._assert(b.delivery_status = 'not_applicable', 'submit deliverables instead');
    for v_milestone in
      update public.payment_schedule
         set status = 'due',
             due_at = coalesce(due_at, now()),
             reminded_at = now()
       where booking_id = b.id
         and due_rule = 'on_completion'
         and status <> 'paid'
       returning id, label
    loop
      perform public._queue_notification(
        b.customer_id,
        'milestone_due',
        b.id,
        'Payment milestone due',
        v_milestone.label || ' is ready to pay in QuickServe.',
        jsonb_build_object('booking_id', b.id, 'schedule_id', v_milestone.id),
        'milestone:' || v_milestone.id::text
      );
    end loop;
  else
    perform public._assert(not exists (
      select 1 from public.quotes
       where booking_id = b.id and status in ('sent', 'approved_pending_payment')
    ), 'resolve the pending change order first');
  end if;
  update public.booking_secrets
     set end_otp = public._gen_otp(), end_attempts = 0
   where booking_id = b.id;
  update public.bookings set completion_requested_at = now() where id = b.id;
  perform public._set_status(b.id, 'completion_requested', v_uid);
end;
$$;

create or replace function public._finalize_completion(p_booking_id uuid, p_actor uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  q public.quotes;
  v_completed timestamptz := now();
  v_commissionable int;
  v_commission_bp int;
  v_cap_paise int;
  v_dispute_hours int;
  v_config jsonb;
  v_release_after timestamptz;
begin
  select * into b from public.bookings where id = p_booking_id;
  select * into q from public.quotes where id = b.approved_quote_id;
  perform public._assert(q.id is not null, 'no approved quote');
  v_commissionable := coalesce(
    nullif(q.subtotal_commissionable, 0),
    coalesce(q.subtotal_labour, 0) + coalesce(q.subtotal_travel, 0)
  );
  if b.archetype = 'proposal' then
    v_commission_bp := coalesce(
      b.commission_bp_snapshot,
      public._booking_commission_bp(b.id, v_completed)
    );
    select value into v_config from public.app_config where key = 'commission';
    v_cap_paise := coalesce((v_config -> 'proposal' ->> 'cap_paise')::int, 500000);
    if v_commission_bp > 0 then
      v_commissionable := least(
        v_commissionable,
        floor(v_cap_paise::numeric * 10000 / v_commission_bp)::int
      );
    end if;
  end if;

  v_release_after := v_completed + interval '24 hours';
  if b.archetype = 'proposal' and b.delivery_status = 'accepted' then
    select coalesce(nullif(value ->> 'dispute_hours', '')::int, 168)
      into v_dispute_hours
      from public.app_config
     where key = 'proposal';
    v_release_after := v_completed + make_interval(hours => coalesce(v_dispute_hours, 168));
  end if;

  perform public._close_open_quotes(b.id);
  update public.bookings set completed_at = v_completed where id = b.id;
  perform public._create_payout(
    b.id, greatest(q.total, b.visit_fee), v_commissionable, v_release_after
  );
  update public.providers set jobs_completed = jobs_completed + 1 where id = b.provider_id;
  update public.providers set commission_tier = public._commission_bp(id, now()) / 100 where id = b.provider_id;
  perform public._set_status(b.id, 'completed', p_actor, p_note);
end;
$$;

create or replace function public.auto_confirm_completions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_count int := 0;
  v_hours int;
begin
  for b in
    select * from public.bookings where status = 'completion_requested' for update skip locked
  loop
    if b.archetype = 'proposal' and b.delivery_status in ('submitted', 'accepted') then
      select deliverable_acceptance_hours
        into v_hours
        from public.categories
       where id = b.category_id;
      v_hours := coalesce(v_hours, 72);
    else
      v_hours := 24;
    end if;

    if b.delivery_status <> 'revision_requested'
       and b.completion_requested_at <= now() - make_interval(hours => v_hours)
       and (b.archetype <> 'proposal' or not exists (
         select 1 from public.payment_schedule
          where booking_id = b.id and status <> 'paid'
       )) then
      begin
        if b.delivery_status = 'submitted' then
          update public.bookings
             set delivery_status = 'accepted', delivery_accepted_at = now()
           where id = b.id;
        end if;
        if b.archetype = 'time_based' then
          perform public._finalize_session_completion(b.id, null);
        else
          perform public._finalize_completion(b.id, null, 'auto-confirmed after acceptance window');
        end if;
        v_count := v_count + 1;
      exception when others then
        raise warning 'auto_confirm_completions: booking % skipped: %', b.id, sqlerrm;
      end;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.remind_delivery_acceptance()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count int := 0;
  v_collapse_key text;
begin
  if not public._feature_enabled('creator_delivery_reminders') then
    return 0;
  end if;

  for r in
    select b.id, b.customer_id, reminder.day, reminder.hours
      from public.bookings b
      cross join (values (3, 72), (6, 144)) as reminder(day, hours)
     where b.archetype = 'proposal'
       and b.status = 'completion_requested'
       and b.delivery_status = 'submitted'
       and b.delivery_submitted_at is not null
       and b.delivery_submitted_at <= now() - make_interval(hours => reminder.hours)
       and not exists (
         select 1
           from public.notifications n
          where n.user_id = b.customer_id
            and n.kind = 'delivery_acceptance_reminder'
            and n.collapse_key = 'delivery-accept:' || b.id::text || ':' || reminder.day::text
       )
     order by b.id, reminder.day
     for update of b skip locked
  loop
    v_collapse_key := 'delivery-accept:' || r.id::text || ':' || r.day::text;
    perform public._queue_notification(
      r.customer_id,
      'delivery_acceptance_reminder',
      r.id,
      'Review your creator delivery',
      'Open the delivered work, pay any final milestone, and accept or request changes.',
      jsonb_build_object('booking_id', r.id, 'reminder_day', r.day),
      v_collapse_key
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.remind_delivery_acceptance() from public, anon, authenticated;
grant execute on function public.remind_delivery_acceptance() to service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid)
      from cron.job
     where jobname = 'delivery-acceptance-reminders';
    perform cron.schedule(
      'delivery-acceptance-reminders',
      '0 * * * *',
      'select public.remind_delivery_acceptance()'
    );
  end if;
end;
$$;

create or replace function public._cancel_booking_by_policy(
  p_booking_id uuid,
  p_actor text,
  p_reason text,
  p_note text,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_outcome jsonb;
  v_refunded int;
  v_provider int;
  v_commissionable int;
  v_commission_bp int;
  v_cap_paise int;
  v_config jsonb;
  v_paid int;
  v_explicit_platform int;
  v_platform int := 0;
  v_prior_refunds int;
  v_principal int;
  v_creator_payment_default boolean := false;
begin
  b := public._lock_booking(p_booking_id);
  perform public._assert(
    b.status::text in (
      'pending_payment', 'requested', 'accepted', 'confirmed', 'en_route',
      'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress',
      'completion_requested'
    ) or (
      b.archetype = 'proposal'
      and b.status = 'delivery_pending'
      and p_actor = 'customer'
      and p_reason = 'provider_fault'
      and b.delivery_due_at is not null
      and p_at > b.delivery_due_at + interval '48 hours'
    ),
    'booking can no longer be cancelled'
  );

  if p_actor = 'customer'
     and b.archetype = 'proposal'
     and b.delivery_status in ('submitted', 'accepted') then
    perform public._assert(false, 'delivery already submitted; raise a dispute instead');
  end if;

  if b.archetype = 'proposal'
     and b.status in ('confirmed', 'in_progress', 'completion_requested')
     and p_actor = 'provider'
     and p_reason = 'customer_payment_default' then
    perform public._assert(
      b.status <> 'completion_requested' or b.delivery_status = 'submitted',
      'proposal is not active'
    );
    perform public._assert(exists (
      select 1
        from public.payment_schedule ps
       where ps.booking_id = b.id
         and ps.status = 'due'
         and ps.due_at <= p_at - interval '48 hours'
         and ps.reminded_at is not null
    ), 'the milestone is not overdue past the grace period');
    v_creator_payment_default := true;
  end if;

  if v_creator_payment_default then
    select coalesce(sum(pay.amount) filter (where pay.status = 'paid'), 0)::int,
           coalesce(sum(pay.amount) filter (
             where pay.status = 'paid' and pay.purpose::text = 'platform_fee'
           ), 0)::int
      into v_paid, v_explicit_platform
      from public.payments pay
     where pay.booking_id = b.id;

    if v_explicit_platform > 0 then
      v_platform := least(b.platform_fee, v_explicit_platform);
    elsif b.platform_fee > 0 and b.total_amount is not null then
      v_platform := least(
        b.platform_fee,
        greatest(v_paid - greatest(b.total_amount - b.platform_fee, b.visit_fee, 0), 0)
      );
    end if;
    v_principal := greatest(v_paid - v_platform, 0);

    select coalesce(sum(r.amount) filter (where r.status <> 'failed'), 0)::int
      into v_prior_refunds
      from public.refunds r
      join public.payments pay on pay.id = r.payment_id
     where pay.booking_id = b.id;
    v_principal := greatest(v_principal - least(v_prior_refunds, v_principal), 0);
    v_outcome := jsonb_build_object(
      'policy_key', b.cancellation_snapshot ->> 'key',
      'policy_version', coalesce((b.cancellation_snapshot ->> 'version')::int, 1),
      'rule', 'creator_customer_payment_default',
      'actor', p_actor,
      'reason', p_reason,
      'evaluated_at', p_at,
      'service_principal_paid', v_principal,
      'platform_fee_paid', v_platform,
      'prior_refunds', v_prior_refunds,
      'service_refund', 0,
      'platform_refund', 0,
      'refund_amount', 0,
      'provider_compensation', v_principal,
      'customer_credit', 0,
      'release_after', p_at + interval '24 hours'
    );
  else
    v_outcome := public._cancellation_outcome(b.id, p_actor, p_reason, p_at);
  end if;

  update public.payments
     set status = 'failed', cancel_link_pending = true
   where booking_id = b.id and status = 'created';
  perform public._close_open_quotes(b.id);

  v_refunded := public._refund_partial(
    b.id, (v_outcome ->> 'refund_amount')::int, 'cancellation: ' || p_reason
  );
  perform public._assert(
    v_refunded = (v_outcome ->> 'refund_amount')::int,
    'refund exceeds refundable payments'
  );

  v_provider := (v_outcome ->> 'provider_compensation')::int;
  if v_provider > 0 then
    v_commissionable := v_provider;
    if v_creator_payment_default then
      v_commission_bp := coalesce(
        b.commission_bp_snapshot,
        public._booking_commission_bp(b.id, p_at)
      );
      select value into v_config from public.app_config where key = 'commission';
      v_cap_paise := coalesce((v_config -> 'proposal' ->> 'cap_paise')::int, 500000);
      if v_commission_bp > 0 then
        v_commissionable := least(
          v_commissionable,
          floor(v_cap_paise::numeric * 10000 / v_commission_bp)::int
        );
      end if;
    end if;
    perform public._create_payout(
      b.id, v_provider, v_commissionable, (v_outcome ->> 'release_after')::timestamptz
    );
  end if;

  update public.bookings
     set cancelled_reason = p_note,
         refund_amount = refund_amount + v_refunded,
         cancellation_outcome = v_outcome
   where id = b.id;
  perform public._set_status(b.id, 'cancelled', case when p_actor = 'customer' then b.customer_id
                                                     when p_actor = 'provider' then b.provider_id end, p_note);
  return v_outcome;
end;
$$;

create or replace function public.submit_delivery(p_booking_id uuid, p_links jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_link jsonb;
  v_milestone record;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can submit delivery');
  perform public._assert(b.archetype = 'proposal' and b.status = 'delivery_pending', 'delivery is not ready to submit');
  perform public._assert(b.delivery_status in ('pending', 'revision_requested'), 'delivery was already submitted');
  perform public._assert(jsonb_typeof(p_links) = 'array' and jsonb_array_length(p_links) between 1 and 20,
                         'submit 1 to 20 delivery links');
  for v_link in select value from jsonb_array_elements(p_links)
  loop
    perform public._assert(
      jsonb_typeof(v_link) = 'object'
      and coalesce(v_link ->> 'url', '') ~ '^https://[^[:space:]]+$',
      'every delivery item needs a full https URL'
    );
    perform public._assert(
      not public._creator_contact_hint(coalesce(v_link ->> 'title', '')),
      'Remove phone numbers, emails or payment handles from delivery titles'
    );
  end loop;
  update public.bookings
     set delivery_links = p_links, delivery_status = 'submitted', delivery_submitted_at = now(),
         completion_requested_at = now()
   where id = b.id;
  for v_milestone in
    update public.payment_schedule
       set status = case when status = 'paid' then status else 'due' end,
           due_at = coalesce(due_at, now()),
           reminded_at = case when status = 'paid' then reminded_at else now() end
     where booking_id = b.id and due_rule = 'on_delivery'
     returning id, label, status
  loop
    if v_milestone.status <> 'paid' then
      perform public._queue_notification(
        b.customer_id,
        'milestone_due',
        b.id,
        'Payment milestone due',
        v_milestone.label || ' is ready to pay in QuickServe.',
        jsonb_build_object('booking_id', b.id, 'schedule_id', v_milestone.id),
        'milestone:' || v_milestone.id::text
      );
    end if;
  end loop;
  perform public._set_status(b.id, 'completion_requested', v_uid, 'deliverables submitted');
  perform public._queue_notification(
    b.customer_id, 'delivery_submitted', b.id, 'Your deliverables are ready',
    'Review the delivery and pay any final milestone to complete the booking.',
    jsonb_build_object('booking_id', b.id), 'delivery:' || b.id::text
  );
end;
$$;

create or replace function public.cancel_proposal_payment_default(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can report payment default');
  perform public._assert(
    b.archetype = 'proposal'
    and b.status in ('confirmed', 'in_progress', 'completion_requested'),
    'proposal is not active'
  );
  perform public._assert(exists (
    select 1
      from public.payment_schedule ps
     where ps.booking_id = b.id
       and ps.status = 'due'
       and ps.due_at <= now() - interval '48 hours'
       and ps.reminded_at is not null
  ), 'the milestone is not overdue past the grace period');
  perform public._cancel_booking_by_policy(
    b.id, 'provider', 'customer_payment_default', 'customer payment default', now()
  );
end;
$$;

create or replace function public._cancel_booking_by_policy(
  p_booking_id uuid,
  p_actor text,
  p_reason text,
  p_note text,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  v_outcome jsonb;
  v_refunded int;
  v_provider int;
  v_commissionable int;
  v_commission_bp int;
  v_cap_paise int;
  v_config jsonb;
  v_paid int;
  v_explicit_platform int;
  v_platform int := 0;
  v_prior_refunds int;
  v_principal int;
  v_creator_payment_default boolean := false;
begin
  b := public._lock_booking(p_booking_id);
  perform public._assert(
    b.status::text in (
      'pending_payment', 'requested', 'accepted', 'confirmed', 'en_route',
      'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress',
      'completion_requested'
    ) or (
      b.archetype = 'proposal'
      and b.status = 'delivery_pending'
      and p_actor = 'customer'
      and p_reason = 'provider_fault'
      and b.delivery_due_at is not null
      and p_at > b.delivery_due_at + interval '48 hours'
    ),
    'booking can no longer be cancelled'
  );

  if p_actor = 'customer'
     and b.archetype = 'proposal'
     and b.delivery_status in ('submitted', 'accepted') then
    perform public._assert(false, 'delivery already submitted; raise a dispute instead');
  end if;

  if b.archetype = 'proposal'
     and b.status = 'completion_requested'
     and b.delivery_status = 'submitted'
     and p_actor = 'provider'
     and p_reason = 'customer_payment_default' then
    perform public._assert(exists (
      select 1
        from public.payment_schedule ps
       where ps.booking_id = b.id
         and ps.status = 'due'
         and ps.due_at <= p_at - interval '48 hours'
         and ps.reminded_at is not null
    ), 'the milestone is not overdue past the grace period');
    v_creator_payment_default := true;
  end if;

  if v_creator_payment_default then
    select coalesce(sum(pay.amount) filter (where pay.status = 'paid'), 0)::int,
           coalesce(sum(pay.amount) filter (
             where pay.status = 'paid' and pay.purpose::text = 'platform_fee'
           ), 0)::int
      into v_paid, v_explicit_platform
      from public.payments pay
     where pay.booking_id = b.id;

    if v_explicit_platform > 0 then
      v_platform := least(b.platform_fee, v_explicit_platform);
    elsif b.platform_fee > 0 and b.total_amount is not null then
      v_platform := least(
        b.platform_fee,
        greatest(v_paid - greatest(b.total_amount - b.platform_fee, b.visit_fee, 0), 0)
      );
    end if;
    v_principal := greatest(v_paid - v_platform, 0);

    select coalesce(sum(r.amount) filter (where r.status <> 'failed'), 0)::int
      into v_prior_refunds
      from public.refunds r
      join public.payments pay on pay.id = r.payment_id
     where pay.booking_id = b.id;
    v_principal := greatest(v_principal - least(v_prior_refunds, v_principal), 0);
    v_outcome := jsonb_build_object(
      'policy_key', b.cancellation_snapshot ->> 'key',
      'policy_version', coalesce((b.cancellation_snapshot ->> 'version')::int, 1),
      'rule', 'creator_customer_payment_default',
      'actor', p_actor,
      'reason', p_reason,
      'evaluated_at', p_at,
      'service_principal_paid', v_principal,
      'platform_fee_paid', v_platform,
      'prior_refunds', v_prior_refunds,
      'service_refund', 0,
      'platform_refund', 0,
      'refund_amount', 0,
      'provider_compensation', v_principal,
      'customer_credit', 0,
      'release_after', p_at + interval '24 hours'
    );
  else
    v_outcome := public._cancellation_outcome(b.id, p_actor, p_reason, p_at);
  end if;

  update public.payments
     set status = 'failed', cancel_link_pending = true
   where booking_id = b.id and status = 'created';
  perform public._close_open_quotes(b.id);

  v_refunded := public._refund_partial(
    b.id, (v_outcome ->> 'refund_amount')::int, 'cancellation: ' || p_reason
  );
  perform public._assert(
    v_refunded = (v_outcome ->> 'refund_amount')::int,
    'refund exceeds refundable payments'
  );

  v_provider := (v_outcome ->> 'provider_compensation')::int;
  if v_provider > 0 then
    v_commissionable := v_provider;
    if v_creator_payment_default then
      v_commission_bp := coalesce(
        b.commission_bp_snapshot,
        public._booking_commission_bp(b.id, p_at)
      );
      select value into v_config from public.app_config where key = 'commission';
      v_cap_paise := coalesce((v_config -> 'proposal' ->> 'cap_paise')::int, 500000);
      if v_commission_bp > 0 then
        v_commissionable := least(
          v_commissionable,
          floor(v_cap_paise::numeric * 10000 / v_commission_bp)::int
        );
      end if;
    end if;
    perform public._create_payout(
      b.id, v_provider, v_commissionable, (v_outcome ->> 'release_after')::timestamptz
    );
  end if;

  update public.bookings
     set cancelled_reason = p_note,
         refund_amount = refund_amount + v_refunded,
         cancellation_outcome = v_outcome
   where id = b.id;
  perform public._set_status(b.id, 'cancelled', case when p_actor = 'customer' then b.customer_id
                                                     when p_actor = 'provider' then b.provider_id end, p_note);
  return v_outcome;
end;
$$;

create or replace function public.submit_delivery(p_booking_id uuid, p_links jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
  v_link jsonb;
  v_milestone record;
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can submit delivery');
  perform public._assert(b.archetype = 'proposal' and b.status = 'delivery_pending', 'delivery is not ready to submit');
  perform public._assert(b.delivery_status in ('pending', 'revision_requested'), 'delivery was already submitted');
  perform public._assert(jsonb_typeof(p_links) = 'array' and jsonb_array_length(p_links) between 1 and 20,
                         'submit 1 to 20 delivery links');
  for v_link in select value from jsonb_array_elements(p_links)
  loop
    perform public._assert(
      jsonb_typeof(v_link) = 'object'
      and coalesce(v_link ->> 'url', '') ~ '^https://[^[:space:]]+$',
      'every delivery item needs a full https URL'
    );
    perform public._assert(
      not public._creator_contact_hint(coalesce(v_link ->> 'title', '')),
      'Remove phone numbers, emails or payment handles from delivery titles'
    );
  end loop;
  update public.bookings
     set delivery_links = p_links, delivery_status = 'submitted', delivery_submitted_at = now(),
         completion_requested_at = now()
   where id = b.id;
  for v_milestone in
    update public.payment_schedule
       set status = case when status = 'paid' then status else 'due' end,
           due_at = coalesce(due_at, now()),
           reminded_at = case when status = 'paid' then reminded_at else now() end
     where booking_id = b.id and due_rule = 'on_delivery'
     returning id, label, status
  loop
    if v_milestone.status <> 'paid' then
      perform public._queue_notification(
        b.customer_id,
        'milestone_due',
        b.id,
        'Payment milestone due',
        v_milestone.label || ' is ready to pay in QuickServe.',
        jsonb_build_object('booking_id', b.id, 'schedule_id', v_milestone.id),
        'milestone:' || v_milestone.id::text
      );
    end if;
  end loop;
  perform public._set_status(b.id, 'completion_requested', v_uid, 'deliverables submitted');
  perform public._queue_notification(
    b.customer_id, 'delivery_submitted', b.id, 'Your deliverables are ready',
    'Review the delivery and pay any final milestone to complete the booking.',
    jsonb_build_object('booking_id', b.id), 'delivery:' || b.id::text
  );
end;
$$;

create or replace function public.cancel_proposal_payment_default(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  b public.bookings := public._lock_booking(p_booking_id);
begin
  perform public._assert(b.provider_id = v_uid, 'only the provider can report payment default');
  perform public._assert(
    b.archetype = 'proposal'
    and (
      b.status in ('confirmed', 'in_progress')
      or (b.status = 'completion_requested' and b.delivery_status = 'submitted')
    ),
    'proposal is not active'
  );
  perform public._assert(exists (
    select 1
      from public.payment_schedule ps
     where ps.booking_id = b.id
       and ps.status = 'due'
       and ps.due_at <= now() - interval '48 hours'
       and ps.reminded_at is not null
  ), 'the milestone is not overdue past the grace period');
  perform public._cancel_booking_by_policy(
    b.id, 'provider', 'customer_payment_default', 'customer payment default', now()
  );
end;
$$;

-- W0 follow-up: private rule readers and a database-level sports refund cap.
-- Migration 0054 has shipped; keep this correction forward-only.

create or replace function public._recurring_rule(p_path text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.value ->> p_path
    from public.app_config c
   where c.key = 'recurring_rules'
     and p_path = any(array[
       'frequencies', 'horizon_days', 'max_plan_days', 'skip_cutoff_hours',
       'reschedule_cutoff_hours', 'reminder_hours_before', 'payment_due_hours_before',
       'billing_grace_hours', 'payment_frequencies', 'recurring_discount_bp'
     ]::text[]);
$$;

create or replace function public._sports_rule(p_path text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.value ->> p_path
    from public.app_config c
   where c.key = 'sports_rules'
     and p_path = any(array[
       'payment_hold_minutes', 'approval_pay_window_minutes', 'commission_bp',
       'customer_fee_paise', 'full_refund_hours', 'partial_refund_hours',
       'partial_refund_bp', 'release_after_hours'
     ]::text[]);
$$;

create or replace function public._validate_addendum_rules_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partial_refund_bp bigint;
begin
  if new.key <> 'sports_rules' then
    return new;
  end if;

  perform public._assert(
    jsonb_typeof(new.value -> 'partial_refund_bp') = 'number'
      and (new.value ->> 'partial_refund_bp') ~ '^[0-9]+$',
    'partial_refund_bp must be a whole-number JSON number'
  );
  v_partial_refund_bp := (new.value ->> 'partial_refund_bp')::bigint;
  perform public._assert(
    v_partial_refund_bp between 0 and 5000,
    'partial_refund_bp must be between 0 and 5000'
  );
  return new;
end;
$$;

drop trigger if exists app_config_validate_addendum_rules on public.app_config;
create trigger app_config_validate_addendum_rules
  before insert or update of value on public.app_config
  for each row execute function public._validate_addendum_rules_config();

revoke all on function public._recurring_rule(text), public._sports_rule(text),
  public._validate_addendum_rules_config()
from public, anon, authenticated;

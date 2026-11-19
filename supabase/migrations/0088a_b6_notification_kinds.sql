-- WP B6; owns: notifications_kind_check; sources: WS9-T14, WS7-T07
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
    alter table public.notifications drop constraint notifications_kind_check;
    execute format(
      'alter table public.notifications add constraint notifications_kind_check check ((%s) or kind in (%s))',
      v_expression,
      quote_literal('payment_received') || ', ' ||
      quote_literal('refund_completed') || ', ' ||
      quote_literal('quote_approved') || ', ' ||
      quote_literal('job_completed_payout_scheduled') || ', ' ||
      quote_literal('payout_sent') || ', ' ||
      quote_literal('payout_problem') || ', ' ||
      quote_literal('dispute_opened') || ', ' ||
      quote_literal('dispute_resolved') || ', ' ||
      quote_literal('verification_update') || ', ' ||
      quote_literal('account_suspended')
    );
  else
    alter table public.notifications add constraint notifications_kind_check
      check (kind is not null);
  end if;
end;
$$;

-- WP B2; owns: payment_receipts, receipt_no_seq, _issue_payment_receipt, get_receipt; sources: WS9-T06

insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values (
  'payment_receipts',
  false,
  'Customer payment receipts',
  'Show non-tax payment receipts. When off, receipt links are hidden and receipt retrieval is disabled; payment processing is unchanged.',
  'Payments',
  40
)
on conflict (key) do nothing;

create sequence public.receipt_no_seq;

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  payment_id uuid not null unique references public.payments (id),
  booking_id uuid not null references public.bookings (id),
  issued_at timestamptz not null default now(),
  snapshot jsonb not null
);

alter table public.payment_receipts enable row level security;
revoke all on public.payment_receipts from anon, authenticated;
grant select on public.payment_receipts to authenticated;
revoke all on sequence public.receipt_no_seq from anon, authenticated;

create policy payment_receipts_participants_read
  on public.payment_receipts for select to authenticated
  using (
    coalesce((public.get_app_features() ->> 'payment_receipts')::boolean, false)
    and exists (
      select 1
        from public.bookings b
       where b.id = payment_receipts.booking_id
         and (b.customer_id = auth.uid() or b.provider_id = auth.uid())
    )
  );

create or replace function public._issue_payment_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings;
  v_quote public.quotes;
  v_receipt_no text;
  v_items jsonb;
  v_subtotal int;
  v_platform_fee int;
  v_coins_discount int;
  v_gross_total int;
  v_total int;
  v_prior_payments jsonb;
  v_prior_total int;
  v_refunds jsonb;
  v_snapshot jsonb;
begin
  if new.status <> 'paid' or new.funding_source <> 'customer' then
    return new;
  end if;

  select b.*
    into v_booking
    from public.bookings b
   where b.id = new.booking_id;

  select q.*
    into v_quote
    from public.quotes q
   where q.id = coalesce(new.quote_id, v_booking.approved_quote_id)
     and q.booking_id = v_booking.id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'description', qi.title,
               'kind', qi.kind,
               'qty', qi.qty,
               'unit_price', qi.unit_price,
               'amount',
                 case when qi.kind = 'discount'
                      then -round(qi.qty * qi.unit_price)::int
                      else round(qi.qty * qi.unit_price)::int
                  end
             )
             order by qi.id
           ),
           '[]'::jsonb
         ),
         sum(
           case when qi.kind = 'discount'
                then -round(qi.qty * qi.unit_price)::int
                else round(qi.qty * qi.unit_price)::int
            end
         )::int
    into v_items, v_subtotal
    from public.quote_items qi
   where qi.quote_id = coalesce(new.quote_id, v_booking.approved_quote_id);

  if jsonb_array_length(v_items) = 0 and new.purpose = 'visit_fee' then
    v_items := jsonb_build_array(jsonb_build_object(
      'description', 'Visit fee',
      'kind', 'visit_fee',
      'qty', 1,
      'unit_price', new.amount,
      'amount', new.amount
    ));
  end if;

  v_subtotal := coalesce(
    v_subtotal,
    v_quote.total,
    case when new.purpose = 'visit_fee' then new.amount else 0 end
  );
  v_platform_fee := case
    when new.purpose = 'visit_fee' and v_booking.total_amount is null then 0
    else v_booking.platform_fee
  end;
  v_coins_discount := coalesce(v_booking.coin_discount, 0);

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'amount', p.amount,
               'purpose', p.purpose,
               'method', null,
               'gateway_ref', p.razorpay_payment_id,
               'paid_at', p.paid_at
             )
             order by p.paid_at, p.created_at
           ),
           '[]'::jsonb
         ),
         coalesce(sum(p.amount), 0)::int
    into v_prior_payments, v_prior_total
    from public.payments p
   where p.booking_id = v_booking.id
     and p.id <> new.id
     and p.status = 'paid'
     and p.funding_source = 'customer';

  v_gross_total := coalesce(
    v_booking.total_amount,
    case
      when new.purpose = 'visit_fee' and v_quote.id is null
        then v_prior_total + new.amount
      else public._required_total(
        coalesce(v_quote.total, v_subtotal),
        v_booking.visit_fee,
        v_booking.platform_fee
      )
    end
  );
  v_total := greatest(v_gross_total - v_coins_discount, 0);

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'amount', r.amount,
               'status', r.status,
               'processed_at', r.processed_at
             )
             order by r.created_at
           ),
           '[]'::jsonb
         )
    into v_refunds
    from public.refunds r
   where r.payment_id = new.id;

  v_receipt_no := 'NR-' || to_char(now(), 'YYYY') || '-'
    || lpad(nextval('public.receipt_no_seq')::text, 6, '0');

  v_snapshot := jsonb_build_object(
    'receipt_no', v_receipt_no,
    'issued_at', now(),
    'status', 'Paid',
    'booking_ref', 'QS-' || upper(left(replace(v_booking.id::text, '-', ''), 8)),
    'category', (select c.name from public.categories c where c.id = v_booking.category_id),
    'provider_display_name', (select p.full_name from public.profiles p where p.id = v_booking.provider_id),
    'customer_name', (select p.full_name from public.profiles p where p.id = v_booking.customer_id),
    'customer_locality', (
      select nullif(trim(a.city), '')
        from public.addresses a
       where a.id = v_booking.address_id
    ),
    'items', v_items,
    'subtotal', v_subtotal,
    'platform_fee', v_platform_fee,
    'tax_lines', '[]'::jsonb,
    'coins_discount', v_coins_discount,
    'total', v_total,
    'prior_payments', v_prior_payments,
    'this_payment', jsonb_build_object(
      'amount', new.amount,
      'method', null,
      'gateway_ref', new.razorpay_payment_id,
      'paid_at', coalesce(new.paid_at, now())
    ),
    'balance_due', greatest(v_total - v_prior_total - new.amount, 0),
    'refunds', v_refunds,
    'dispute_link', '/booking/' || v_booking.id::text,
    'tax_invoice_url', null
  );

  insert into public.payment_receipts (receipt_no, payment_id, booking_id, snapshot)
  values (v_receipt_no, new.id, v_booking.id, v_snapshot)
  on conflict (payment_id) do nothing;

  return new;
end;
$$;

revoke all on function public._issue_payment_receipt() from public, anon, authenticated;

create trigger payment_receipts_on_payment_paid
after update of status on public.payments
for each row
when (new.status = 'paid' and new.funding_source = 'customer')
execute function public._issue_payment_receipt();

create or replace function public.get_receipt(p_payment_id uuid)
returns setof public.payment_receipts
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.*
    from public.payment_receipts r
    join public.bookings b on b.id = r.booking_id
   where r.payment_id = p_payment_id
     and public._feature_enabled('payment_receipts')
     and (
       b.customer_id = auth.uid()
       or b.provider_id = auth.uid()
       or public._is_admin()
     )
   limit 1;
$$;

revoke all on function public.get_receipt(uuid) from public, anon, authenticated;
grant execute on function public.get_receipt(uuid) to authenticated;

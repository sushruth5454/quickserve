alter table public.product_enquiries
  add column product_context_id uuid;

create or replace function public._preserve_enquiry_product_context()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_effective_context uuid;
begin
  if tg_op = 'INSERT' then
    if new.product_context_id is not null
       and new.product_context_id is distinct from new.product_id then
      raise exception using
        errcode = '22023',
        message = 'product enquiry context is immutable';
    end if;
    new.product_context_id := new.product_id;
    return new;
  end if;

  v_old_effective_context := coalesce(old.product_context_id, old.product_id);
  if new.product_context_id is distinct from old.product_context_id
     and new.product_context_id is distinct from v_old_effective_context then
    raise exception using
      errcode = '22023',
      message = 'product enquiry context is immutable';
  end if;

  new.product_context_id := v_old_effective_context;
  return new;
end;
$$;
revoke all on function public._preserve_enquiry_product_context()
  from public, anon, authenticated;

drop trigger if exists product_enquiries_preserve_context on public.product_enquiries;
create trigger product_enquiries_preserve_context
before insert or update on public.product_enquiries
for each row execute function public._preserve_enquiry_product_context();

revoke select on public.product_enquiries from authenticated;
grant select (
  id, shop_id, product_id, customer_id, status, last_message_at,
  shop_unread, customer_unread, created_at
) on public.product_enquiries to authenticated;

drop index if exists public.product_enquiries_one_open_idx;
create unique index product_enquiries_one_open_idx
  on public.product_enquiries (
    shop_id,
    customer_id,
    coalesce(
      product_context_id,
      product_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  where status = 'open';

create or replace function public.start_product_enquiry(
  p_shop_id uuid,
  p_product_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  s public.shops;
  e public.product_enquiries;
  v_created boolean := false;
begin
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
  select * into s from public.shops where id = p_shop_id for update;
  perform public._assert(found, 'verified shop not found');
  perform public._assert(s.status = 'verified', 'verified shop not found');
  perform public._assert(s.owner_id <> v_uid, 'you cannot enquire with your own shop');
  if p_product_id is null then
    perform public._assert(
      public._can_start_product_enquiry(s.id, null::uuid),
      'product enquiries are disabled or shop is unavailable'
    );
  else
    perform public._assert(
      public._can_start_product_enquiry(s.id, p_product_id),
      'product not found'
    );
  end if;

  select * into e from public.product_enquiries x
   where x.shop_id = s.id
     and x.customer_id = v_uid
     and coalesce(
       x.product_context_id,
       x.product_id,
       '00000000-0000-0000-0000-000000000000'::uuid
     ) = coalesce(
       p_product_id,
       '00000000-0000-0000-0000-000000000000'::uuid
     )
     and x.status = 'open'
   order by x.last_message_at desc
   limit 1
   for update;
  if not found then
    insert into public.product_enquiries (shop_id, product_id, customer_id)
    values (s.id, p_product_id, v_uid)
    returning * into e;
    v_created := true;
  end if;
  perform public._product_enquiry_post(e.id, v_uid, false, p_body, v_created);
  return e.id;
end;
$$;

create or replace function public.select_supplier_quote(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_rfq_id uuid;
  v_shop_id uuid;
  v_quote public.supplier_quotes;
  v_rfq public.rfqs;
  v_shop public.shops;
  v_enquiry public.product_enquiries;
  v_created boolean := false;
begin
  select q.rfq_id, q.shop_id into v_rfq_id, v_shop_id
    from public.supplier_quotes q
   where q.id = p_quote_id;
  perform public._assert(found, 'quote not found');

  select * into v_rfq
    from public.rfqs
   where id = v_rfq_id
   for update;
  perform public._assert(found and v_rfq.id = v_rfq_id and v_rfq.customer_id = v_uid, 'quote not found');

  select * into v_shop
    from public.shops
   where id = v_shop_id
   for update;
  perform public._assert(found and v_shop.id = v_shop_id, 'verified shop not found');

  select * into v_quote
    from public.supplier_quotes
   where id = p_quote_id and rfq_id = v_rfq_id and shop_id = v_shop_id
   for update;
  perform public._assert(
    found and v_quote.rfq_id = v_rfq.id and v_quote.shop_id = v_shop.id,
    'quote not found'
  );
  perform public._assert(v_rfq.status = 'open' and v_rfq.expires_at > now(), 'RFQ is closed or expired');
  perform public._assert(v_quote.status = 'sent' and v_quote.valid_until > now(), 'quote is no longer available');
  perform public._assert(v_shop.status = 'verified', 'verified shop not found');
  perform public._assert(public._product_rfq_enabled(), 'product RFQs are disabled');
  perform public._assert(
    public._can_start_product_enquiry(v_shop.id, null::uuid),
    'product enquiries are disabled or shop is unavailable'
  );

  select * into v_enquiry
    from public.product_enquiries e
   where e.shop_id = v_shop.id
     and e.customer_id = v_uid
     and coalesce(e.product_context_id, e.product_id) is null
     and e.status = 'open'
   order by e.last_message_at desc
   limit 1
   for update;
  if not found then
    insert into public.product_enquiries (shop_id, customer_id, product_id)
    values (v_shop.id, v_uid, null)
    returning * into v_enquiry;
    v_created := true;
  end if;

  update public.supplier_quotes
     set status = 'rejected', updated_at = now()
   where rfq_id = v_rfq.id and id <> v_quote.id and status = 'sent';
  update public.supplier_quotes
     set status = 'selected', updated_at = now()
   where id = v_quote.id and rfq_id = v_rfq.id and shop_id = v_shop.id;
  update public.rfqs set status = 'closed', updated_at = now() where id = v_rfq.id;

  perform public._product_enquiry_post(
    v_enquiry.id, v_uid, false,
    left('I selected your quotation for "' || v_rfq.title || '". Please coordinate the next steps here; no payment was taken.', 2000),
    v_created
  );
  return jsonb_build_object('rfq_id', v_rfq.id, 'enquiry_id', v_enquiry.id);
end;
$$;

create or replace function public.set_product_enquiry_status(
  p_enquiry_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  e public.product_enquiries;
  v_owner uuid;
begin
  perform public._assert(public._shops_enquiries_enabled(), 'product enquiries are disabled');
  perform public._assert(coalesce(p_status in ('open', 'closed'), false), 'invalid enquiry status');
  select * into e from public.product_enquiries where id = p_enquiry_id for update;
  perform public._assert(found, 'enquiry not found');
  select s.owner_id into v_owner from public.shops s where s.id = e.shop_id;
  perform public._assert(e.customer_id = v_uid or v_owner = v_uid, 'enquiry not found');

  if p_status = 'open' and e.status <> 'open' then
    perform public._assert(not exists (
      select 1
        from public.product_enquiries other
       where other.id <> e.id
         and other.shop_id = e.shop_id
         and other.customer_id = e.customer_id
         and other.status = 'open'
         and coalesce(
           other.product_context_id,
           other.product_id,
           '00000000-0000-0000-0000-000000000000'::uuid
         ) = coalesce(
           e.product_context_id,
           e.product_id,
           '00000000-0000-0000-0000-000000000000'::uuid
         )
    ), 'another open enquiry already exists for this product context');
  end if;

  begin
    update public.product_enquiries set status = p_status where id = e.id;
  exception
    when unique_violation then
      raise exception using
        errcode = '23505',
        message = 'another open enquiry already exists for this product context';
  end;
end;
$$;

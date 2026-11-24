begin;

drop function if exists public.get_product_enquiry(uuid);
create function public.get_product_enquiry(p_enquiry_id uuid)
returns table (
  id uuid,
  shop_id uuid,
  product_id uuid,
  customer_id uuid,
  status text,
  shop_name text,
  product_name text,
  shop_unread int,
  customer_unread int,
  last_message_at timestamptz,
  from_shop_user boolean,
  business_role text,
  can_change_status boolean,
  can_reopen boolean,
  active_enquiry_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._product_enquiry_participant(p_enquiry_id), 'enquiry not found');
  return query
    select e.id,
           e.shop_id,
           e.product_id,
           e.customer_id,
           e.status,
           s.name,
           p.name,
           e.shop_unread,
           e.customer_unread,
           e.last_message_at,
           public._acts_for(s.owner_id, 'staff'),
           public._business_role(s.owner_id),
           coalesce(
             public._shops_enquiries_enabled() and (e.customer_id = v_uid or s.owner_id = v_uid),
             false
           ),
           coalesce((
             e.status = 'closed'
             and public._shops_enquiries_enabled()
             and (e.customer_id = v_uid or s.owner_id = v_uid)
             and active.id is null
           ), false),
           active.id
      from public.product_enquiries e
      join public.shops s on s.id = e.shop_id
      left join public.products p on p.id = e.product_id
      left join lateral (
        select other.id
          from public.product_enquiries other
         where e.status = 'closed'
           and other.id <> e.id
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
         order by other.last_message_at desc, other.id
         limit 1
      ) active on true
     where e.id = p_enquiry_id;
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

revoke all on function public.get_product_enquiry(uuid),
  public.set_product_enquiry_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_product_enquiry(uuid),
  public.set_product_enquiry_status(uuid, text)
  to authenticated;

commit;

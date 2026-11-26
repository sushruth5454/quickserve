create or replace view public.service_request_provider_view
with (security_barrier = true) as
  with managed_provider_ids as (
    select auth.uid() as provider_id
     where auth.uid() is not null
    union
    select bm.owner_id
      from public.business_members bm
     where bm.member_id = auth.uid()
       and bm.active
       and bm.role in ('owner', 'manager')
       and public._feature_enabled('merchant_staff')
  )
  select
    r.id,
    r.category_id,
    c.name as category_name,
    c.slug as category_slug,
    r.city,
    r.area,
    r.event_start,
    r.event_end,
    public._proposal_public_intake(r.category_id, r.intake) as intake,
    r.budget_min,
    r.budget_max,
    r.status,
    r.expires_at,
    r.created_at,
    rr.provider_id,
    rr.routed_at,
    r.urgent
  from public.request_recipients rr
  join public.service_requests r on r.id = rr.request_id
  join public.categories c on c.id = r.category_id
  where rr.provider_id in (select m.provider_id from managed_provider_ids m)
    and (select count(*)
           from public.request_recipients routed
          where routed.request_id = rr.request_id
            and routed.provider_id in (select m.provider_id from managed_provider_ids m)) = 1
    and r.status in ('open', 'closed', 'booked');

grant select on public.service_request_provider_view to authenticated;

create or replace function public.get_proposal_view_state(p_proposal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_proposal public.proposals;
  v_request public.service_requests;
  v_category public.categories;
  v_booking public.bookings;
  v_viewer_role text;
  v_request_has_active_booking boolean;
  v_is_latest boolean;
  v_has_one_managed_recipient boolean;
  v_can_accept boolean;
  v_can_withdraw boolean;
  v_can_send_new boolean;
  v_can_message boolean;
begin
  select * into v_proposal
    from public.proposals p
   where p.id = p_proposal_id;
  if not found then
    raise exception 'proposal not found' using errcode = 'P0001';
  end if;

  select * into v_request
    from public.service_requests r
   where r.id = v_proposal.request_id;
  if not found then
    raise exception 'proposal not found' using errcode = 'P0001';
  end if;

  if v_request.customer_id = v_uid then
    v_viewer_role := 'customer';
  elsif v_proposal.provider_id = v_uid then
    v_viewer_role := 'owner';
  elsif public._acts_for(v_proposal.provider_id, 'manager') then
    v_viewer_role := 'manager';
  elsif public._is_admin() then
    v_viewer_role := 'admin';
  else
    raise exception 'proposal not found' using errcode = 'P0001';
  end if;

  select exists (
    select 1
      from public.bookings b
     where b.service_request_id = v_request.id
       and b.status in ('pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
                        'delivery_pending', 'completion_requested', 'disputed')
  ) into v_request_has_active_booking;

  select * into v_booking
    from public.bookings b
   where b.service_request_id = v_request.id
     and b.proposal_id = v_proposal.id
     and b.status in ('pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
                      'delivery_pending', 'completion_requested', 'disputed')
   order by b.created_at desc, b.id desc
   limit 1;

  if not found then
    select * into v_booking
      from public.bookings b
     where b.service_request_id = v_request.id
       and b.proposal_id = v_proposal.id
     order by b.created_at desc, b.id desc
     limit 1;
  end if;

  select coalesce(max(p.version) = v_proposal.version, false)
    into v_is_latest
    from public.proposals p
   where p.request_id = v_request.id
     and p.provider_id = v_proposal.provider_id;

  select count(*) = 1
    into v_has_one_managed_recipient
    from public.request_recipients rr
   where rr.request_id = v_request.id
     and public._acts_for(rr.provider_id, 'manager');

  v_can_accept := v_viewer_role = 'customer'
    and v_request.status = 'open'
    and v_request.expires_at > now()
    and v_proposal.status = 'sent'
    and v_proposal.valid_until > now()
    and not v_request_has_active_booking;
  select * into v_category
    from public.categories c
   where c.id = v_request.category_id;
  v_can_accept := coalesce(v_can_accept, false)
    and coalesce(v_category.active and v_category.archetype = 'proposal', false)
    and not exists (
      select 1
        from public.bookings b
       where b.provider_id = v_proposal.provider_id
         and b.service_window && tstzrange(v_request.event_start, v_request.event_end, '[)')
         and b.status in ('pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
                          'delivery_pending', 'completion_requested')
         and (b.status <> 'pending_payment' or coalesce(b.payment_hold_expires_at, '-infinity') > now())
    );

  v_can_withdraw := v_viewer_role in ('owner', 'manager')
    and v_proposal.status = 'sent';

  v_can_send_new := v_viewer_role in ('owner', 'manager')
    and v_request.status = 'open'
    and v_request.expires_at > now()
    and v_request.expires_at > now() + interval '15 minutes'
    and v_request.event_start >= now() + public._proposal_notice(v_request) - interval '5 minutes'
    and v_proposal.status in ('withdrawn', 'expired', 'rejected')
    and v_is_latest
    and not v_request_has_active_booking
    and v_has_one_managed_recipient
    and exists (
      select 1
        from public.request_recipients rr
       where rr.request_id = v_request.id
         and rr.provider_id = v_proposal.provider_id
         and public._acts_for(rr.provider_id, 'manager')
    );

  v_can_message := v_request.status in ('open', 'closed')
    and (
      v_viewer_role = 'customer'
      or (
        v_viewer_role in ('owner', 'manager')
        and public._acts_for(v_proposal.provider_id, 'staff')
      )
    );

  return jsonb_build_object(
    'proposal_id', v_proposal.id,
    'viewer_role', v_viewer_role,
    'request_status', v_request.status,
    'request_expires_at', v_request.expires_at,
    'current_booking_id', v_booking.id,
    'current_booking_status', v_booking.status,
    'current_booking_created_at', v_booking.created_at,
    'payment_hold_expires_at', v_booking.payment_hold_expires_at,
    'delivery_status', v_booking.delivery_status,
    'can_accept', v_can_accept,
    'can_withdraw', v_can_withdraw,
    'can_send_new', v_can_send_new,
    'can_message', v_can_message
  );
end;
$$;

revoke all on function public.get_proposal_view_state(uuid) from public, anon;
grant execute on function public.get_proposal_view_state(uuid) to authenticated;

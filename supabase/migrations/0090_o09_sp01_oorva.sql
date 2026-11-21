create or replace function public.submit_sports_venue(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_status text;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  select v.status
    into v_status
    from public.sports_venues as v
   where v.id = p_id and v.owner_id = v_uid
   for update;
  perform public._assert(v_status is not null, 'venue not found, suspended, or not owned by you');
  perform public._assert(v_status <> 'suspended', 'venue not found, suspended, or not owned by you');

  if v_status in ('submitted', 'verified') then
    return;
  end if;

  perform public._assert(v_status in ('draft', 'rejected'), 'venue cannot be submitted from this status');
  perform public._assert(exists (
    select 1
      from public.sports_resources as r
      join public.sports_activities as a on a.id = r.activity_id
     where r.venue_id = p_id and r.active and a.active
  ), 'add an active court or resource before submitting');
  perform public._assert(exists (
    select 1 from public.sports_hours as h where h.venue_id = p_id
  ), 'add opening hours before submitting');
  perform public._assert(exists (
    select 1
      from public.sports_price_rules as pr
      join public.sports_resources as r on r.id = pr.resource_id
     where r.venue_id = p_id and r.active
  ), 'add a price rule before submitting');

  update public.sports_venues as v
     set status = 'submitted', status_reason = '', updated_at = now()
   where v.id = p_id and v.owner_id = v_uid;
end;
$$;

create or replace function public.admin_set_venue_status(p_id uuid, p_status text, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_current_status text;
begin
  perform public._assert(public._feature_enabled('sports'), 'Sports & venues are turned off right now.');
  perform public._assert(public._is_admin(), 'admin only');
  perform public._assert(p_status in ('verified', 'rejected', 'suspended'), 'invalid venue status');
  perform public._assert(p_status = 'verified' or char_length(btrim(coalesce(p_reason, ''))) between 3 and 500,
                         'a reason is required unless the venue is verified');

  select v.status
    into v_current_status
    from public.sports_venues as v
   where v.id = p_id
   for update;
  perform public._assert(v_current_status is not null, 'venue not found');
  perform public._assert(v_current_status <> 'draft', 'venue not found');

  if v_current_status = p_status then
    return;
  end if;

  update public.sports_venues as v
     set status = p_status, status_reason = coalesce(btrim(p_reason), ''), updated_at = now()
   where v.id = p_id and v.status = v_current_status;
  perform public._assert(found, 'venue not found');
  insert into public.admin_audit_log (admin_id, action, target_id, details)
  values (v_uid, 'set_sports_venue_status', p_id,
          jsonb_build_object('status', p_status, 'reason', coalesce(p_reason, '')));
end;
$$;
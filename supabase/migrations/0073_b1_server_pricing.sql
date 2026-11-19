-- WP B1; owns: public.get_booking_price_preview, public.get_fixed_booking_fee; sources: WS9-T09, WS2-T04

create or replace function public.get_fixed_booking_fee()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    coalesce((public._fixed_booking_config() ->> 'platform_fee_paise')::int, 2900),
    0
  );
$$;

revoke all on function public.get_fixed_booking_fee() from public, anon;
grant execute on function public.get_fixed_booking_fee() to authenticated, service_role;

create or replace function public.get_booking_price_preview(
  p_provider_service_id uuid,
  p_quantity int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_visit_fee int;
  v_platform_fee int;
  v_package_total int := 0;
  v_total int;
  v_pay_now int;
  v_archetype text;
begin
  perform public._require_uid();
  perform public._assert(p_quantity is not null and p_quantity > 0, 'quantity must be greater than zero');

  select ps.visit_fee, c.archetype
    into v_visit_fee, v_archetype
    from public.provider_services ps
    join public.categories c on c.id = ps.category_id
   where ps.id = p_provider_service_id
     and ps.active;
  perform public._assert(found, 'service not available');

  if v_archetype = 'fixed' then
    v_visit_fee := 0;
    v_platform_fee := public.get_fixed_booking_fee();
  elsif v_archetype in ('inspect_quote', 'time_based') then
    v_platform_fee := 2900;
    if v_archetype = 'time_based' then
      v_visit_fee := 0;
    end if;
  else
    raise exception 'price preview is not available for this booking type' using errcode = 'P0001';
  end if;

  v_total := greatest(v_visit_fee, v_package_total) + v_platform_fee;
  v_pay_now := case when v_archetype = 'inspect_quote' then v_visit_fee else v_total end;

  return jsonb_build_object(
    'visit_fee', v_visit_fee,
    'platform_fee', v_platform_fee,
    'package_total', v_package_total,
    'total', v_total,
    'pay_now', v_pay_now
  );
end;
$$;

revoke all on function public.get_booking_price_preview(uuid, int) from public, anon;
grant execute on function public.get_booking_price_preview(uuid, int) to authenticated, service_role;

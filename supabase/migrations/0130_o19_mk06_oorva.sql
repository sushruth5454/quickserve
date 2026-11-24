begin;

create or replace function public.compare_rfq_quotes(p_rfq_id uuid)
returns table (
  quote_id uuid, shop_id uuid, shop_name text, version int, status text, valid_until timestamptz,
  delivery_charge_paise bigint, delivery_days int, notes text, subtotal_paise bigint, gst_paise bigint,
  total_paise bigint, unavailable_count bigint, complete boolean, arrives_after_needed_by boolean,
  delivery_terms_missing boolean, items jsonb, can_select boolean, selection_block_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(exists (
    select 1 from public.rfqs r where r.id = p_rfq_id and r.customer_id = v_uid
  ), 'RFQ not found');
  return query
    select q.id, q.shop_id, s.name, q.version, q.status, q.valid_until, q.delivery_charge_paise,
           q.delivery_days, q.notes, q.subtotal_paise, q.gst_paise, q.total_paise,
           (select count(*) from public.supplier_quote_items qi where qi.quote_id = q.id and not qi.available),
           not exists (
             select 1 from public.supplier_quote_items qi where qi.quote_id = q.id and not qi.available
           ),
           q.delivery_days is not null and (q.created_at::date + q.delivery_days) > r.needed_by,
           r.needs_delivery and q.delivery_days is null,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'rfq_item_id', i.id, 'seq', i.seq, 'description', i.description,
               'requested_brand', i.brand_pref, 'requested_specs', i.specs,
               'brand', qi.brand, 'model', qi.model, 'specs', qi.specs, 'quantity', qi.quantity,
               'unit', i.unit, 'unit_price_paise', qi.unit_price_paise, 'gst_rate_bp', qi.gst_rate_bp,
               'available', qi.available, 'line_total_paise', qi.line_total_paise,
               'brand_differs', qi.available and nullif(btrim(i.brand_pref), '') is not null
                 and lower(btrim(i.brand_pref)) is distinct from lower(btrim(qi.brand)),
               'specs_missing', case when qi.available then exists (
                 select 1 from jsonb_each(coalesce(i.specs, '{}'::jsonb)) requested(key, value)
                  where not (coalesce(qi.specs, '{}'::jsonb) ? requested.key)
                     or qi.specs ->> requested.key is null
                     or btrim(qi.specs ->> requested.key) = ''
               ) else false end,
               'missing_spec_keys', case when qi.available then coalesce((
                 select jsonb_agg(requested.key order by requested.key)
                   from jsonb_each(coalesce(i.specs, '{}'::jsonb)) requested(key, value)
                  where not (coalesce(qi.specs, '{}'::jsonb) ? requested.key)
                     or qi.specs ->> requested.key is null
                     or btrim(qi.specs ->> requested.key) = ''
               ), '[]'::jsonb) else '[]'::jsonb end,
               'specs_differ', qi.available and exists (
                 select 1
                   from jsonb_each_text(coalesce(i.specs, '{}'::jsonb)) requested(key, value)
                  where coalesce(qi.specs, '{}'::jsonb) ? requested.key
                    and lower(btrim(qi.specs ->> requested.key)) <> lower(btrim(requested.value))
               ),
               'differing_spec_keys', coalesce((
                 select jsonb_agg(requested.key order by requested.key)
                   from jsonb_each_text(coalesce(i.specs, '{}'::jsonb)) requested(key, value)
                  where qi.available
                    and coalesce(qi.specs, '{}'::jsonb) ? requested.key
                    and lower(btrim(qi.specs ->> requested.key)) <> lower(btrim(requested.value))
               ), '[]'::jsonb),
               'quantity_rounded_up', qi.quantity > i.quantity
             ) order by i.seq)
               from public.supplier_quote_items qi
               join public.rfq_items i on i.id = qi.rfq_item_id
              where qi.quote_id = q.id
           ), '[]'::jsonb),
           selection.selection_block_reason is null
             and r.status = 'open'
             and r.expires_at > now()
             and q.status = 'sent'
             and q.valid_until > now(),
           selection.selection_block_reason
      from public.supplier_quotes q
      join public.shops s on s.id = q.shop_id
      join public.rfqs r on r.id = q.rfq_id
      cross join lateral (
        select case
          when r.status <> 'open' then 'closed'::text
          when r.expires_at <= now() then 'rfq_expired'
          when q.status = 'expired' or q.valid_until <= now() then 'quote_expired'
          when q.status <> 'sent' then 'closed'
          when s.status <> 'verified' then 'shop_unavailable'
          when not public._product_rfq_enabled() or not public._shops_enquiries_enabled() then 'feature_off'
          when not public._can_start_product_enquiry(s.id, null::uuid) then 'shop_unavailable'
          else null::text
        end as selection_block_reason
      ) as selection
     where q.rfq_id = p_rfq_id and q.status in ('sent', 'selected', 'rejected', 'expired')
     order by (not exists (
       select 1 from public.supplier_quote_items qi where qi.quote_id = q.id and not qi.available
     )) desc, q.total_paise, q.created_at, q.id;
end;
$$;

revoke all on function public.compare_rfq_quotes(uuid) from public, anon;
grant execute on function public.compare_rfq_quotes(uuid) to authenticated;

create or replace function public.admin_rfq_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._assert(public._is_admin(), 'admin only');
  return (
    with per_rfq as (
      select r.id, r.title, r.city, r.status, r.expires_at, r.created_at,
             (select count(*)::int from public.supplier_quotes q
               where q.rfq_id = r.id and q.status in ('sent', 'selected', 'rejected', 'expired')) as quote_count,
             (select min(q.created_at) from public.supplier_quotes q where q.rfq_id = r.id) as first_response_at
        from public.rfqs r
    ),
    recent as (
      select id, title, city, status, expires_at, created_at, quote_count
        from per_rfq order by created_at desc limit 20
    )
    select jsonb_build_object(
      'open_rfqs', (select count(*) from per_rfq where status = 'open' and expires_at > now()),
      'total_rfqs', (select count(*) from per_rfq),
      'total_quotes', (select coalesce(sum(quote_count), 0) from per_rfq),
      'average_quotes_per_rfq', (select coalesce(round(avg(quote_count)::numeric, 1), 0) from per_rfq),
      'average_response_minutes', (
        select coalesce(round(avg(extract(epoch from (first_response_at - created_at)) / 60.0)::numeric, 1), 0)
          from per_rfq where first_response_at is not null
      ),
      'recent_rfqs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'title', title, 'city', city, 'status', status, 'expires_at', expires_at,
          'created_at', created_at, 'quote_count', quote_count
        ) order by created_at desc) from recent
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.admin_rfq_dashboard() from public, anon;
grant execute on function public.admin_rfq_dashboard() to authenticated;

commit;

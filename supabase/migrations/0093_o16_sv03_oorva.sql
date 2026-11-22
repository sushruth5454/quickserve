begin;

do $$
declare
  v_table text;
begin
  if exists (
    select 1
      from pg_catalog.pg_publication
     where pubname = 'supabase_realtime'
  ) then
    foreach v_table in array array[
      'quotes',
      'payment_schedule',
      'booking_events',
      'payments',
      'reviews',
      'refunds'
    ]
    loop
      if exists (
        select 1
          from pg_catalog.pg_class as c
          join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname = v_table
           and c.relkind in ('r', 'p')
           and c.relrowsecurity
      )
      and not exists (
        select 1
          from pg_catalog.pg_publication_tables as pt
         where pt.pubname = 'supabase_realtime'
           and pt.schemaname = 'public'
           and pt.tablename = v_table
      ) then
        execute format('alter publication %I add table public.%I', 'supabase_realtime', v_table);
      end if;
    end loop;
  end if;
end;
$$;

commit;

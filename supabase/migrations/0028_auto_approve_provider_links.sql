-- Provider social/website links go live immediately (no manual review queue). The save-time guards in
-- _validate_provider_link (https only; no WhatsApp/Telegram/UPI/shortener links; no phone numbers, @handles
-- or URLs in the label) still apply. Admins can still reject a link with admin_review_provider_link; a
-- rejected link stays rejected until the provider changes it.

alter table public.provider_links alter column status set default 'approved';

create or replace function public.save_provider_link(p_kind text, p_url text, p_handle text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
  v_id uuid;
begin
  insert into public.provider_links (provider_id, kind, url, handle, status, reviewed_at)
  values (v_uid, p_kind, p_url, p_handle, 'approved', now())
  on conflict (provider_id, kind) do update
    set url = excluded.url,
        handle = excluded.handle,
        status = case
          when public.provider_links.url is distinct from excluded.url
            or public.provider_links.handle is distinct from excluded.handle then 'approved'
          else public.provider_links.status
        end,
        review_reason = case
          when public.provider_links.url is distinct from excluded.url
            or public.provider_links.handle is distinct from excluded.handle then null
          else public.provider_links.review_reason
        end,
        reviewed_by = case
          when public.provider_links.url is distinct from excluded.url
            or public.provider_links.handle is distinct from excluded.handle then null
          else public.provider_links.reviewed_by
        end,
        reviewed_at = case
          when public.provider_links.url is distinct from excluded.url
            or public.provider_links.handle is distinct from excluded.handle then now()
          else public.provider_links.reviewed_at
        end
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.save_provider_link(text, text, text) to authenticated;
revoke execute on function public.save_provider_link(text, text, text) from public, anon;

-- Links waiting in the old review queue go live too.
update public.provider_links set status = 'approved', reviewed_at = now() where status = 'pending';

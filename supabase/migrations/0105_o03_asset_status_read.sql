create function public.service_get_branding_asset_status(p_asset_id uuid)
returns table (
  id uuid,
  object_path text,
  sha256 text,
  mime_type text,
  byte_length bigint,
  width integer,
  height integer,
  validated_at timestamptz,
  published_once boolean,
  revoked_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select a.id, a.object_path, a.sha256, a.mime_type, a.byte_length,
         a.width, a.height, a.validated_at, a.published_once, a.revoked_at
    from public.app_branding_assets as a
   where a.id = p_asset_id;
$$;

revoke all on function public.service_get_branding_asset_status(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.service_get_branding_asset_status(uuid)
  to service_role;

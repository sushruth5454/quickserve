create function public.admin_register_branding_asset(
  p_asset_id uuid,
  p_sha256 text,
  p_byte_length bigint,
  p_width integer,
  p_height integer,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_object_path text;
  v_policy jsonb;
  v_max_upload_bytes integer;
  v_min_dimension integer;
  v_max_dimension integer;
  v_max_pixels integer;
  v_existing public.app_branding_assets%rowtype;
  v_inserted integer := 0;
begin
  if p_asset_id is null or p_actor_id is null then
    raise exception 'asset id and admin actor are required' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'asset SHA-256 must be normalized lowercase hexadecimal' using errcode = '22023';
  end if;

  perform f.key
    from public.feature_flags as f
   where f.key in ('oorva_brand', 'branding_runtime', 'branding_editor')
   order by f.key
   for share;

  if not public._oorva_feature_enabled('oorva_brand')
     or not public._oorva_feature_enabled('branding_runtime')
     or not public._oorva_feature_enabled('branding_editor') then
    raise exception 'branding asset registration is disabled' using errcode = '55000';
  end if;

  perform 1
    from public.admins as a
   where a.user_id = p_actor_id
   for key share;
  if not found then
    raise exception 'branding asset actor is not an O03 admin' using errcode = '42501';
  end if;

  v_object_path := 'branding/' || p_asset_id::text || '.png';
  perform 1
    from storage.buckets as bucket
   where bucket.id = 'branding-assets'
     and bucket.public is false
   for share;
  if not found then
    raise exception 'private branding bucket is not initialized' using errcode = '55000';
  end if;

  perform 1
    from storage.objects as object
   where object.bucket_id = 'branding-assets'
     and object.name = v_object_path
   for key share;
  if not found then
    raise exception 'private branding object is missing' using errcode = 'P0002';
  end if;

  select a.* into v_existing
    from public.app_branding_assets as a
   where a.id = p_asset_id
   for update;

  if not found then
    select c.value into v_policy
      from public.app_config as c
     where c.key = 'branding_policy'
     for share;
    if not found then
      raise exception 'branding policy is not initialized' using errcode = '55000';
    end if;
    v_policy := public._branding_validate_policy(v_policy);
    v_max_upload_bytes := (v_policy ->> 'maxUploadBytes')::integer;
    v_min_dimension := (v_policy ->> 'minImageDimension')::integer;
    v_max_dimension := (v_policy ->> 'maxImageDimension')::integer;
    v_max_pixels := (v_policy ->> 'maxImagePixels')::integer;

    if p_byte_length is null or p_byte_length not between 1 and v_max_upload_bytes then
      raise exception 'branding asset byte length exceeds the current policy' using errcode = '22023';
    end if;
    if p_width is null or p_height is null
       or p_width not between v_min_dimension and v_max_dimension
       or p_height not between v_min_dimension and v_max_dimension
       or p_width::bigint * p_height::bigint > v_max_pixels then
      raise exception 'branding asset dimensions exceed the current policy' using errcode = '22023';
    end if;

    insert into public.app_branding_assets (
      id, object_path, sha256, mime_type, byte_length, width, height,
      uploaded_by, validated_at
    ) values (
      p_asset_id, v_object_path, p_sha256, 'image/png', p_byte_length, p_width, p_height,
      p_actor_id, now()
    )
    on conflict (id) do nothing;
    get diagnostics v_inserted = row_count;

    if v_inserted = 1 then
      insert into public.admin_audit_log (admin_id, action, target_id, details)
      values (
        p_actor_id,
        'branding_asset_registered',
        p_asset_id,
        jsonb_build_object(
          'objectPath', v_object_path,
          'sha256', p_sha256,
          'mimeType', 'image/png',
          'byteLength', p_byte_length,
          'width', p_width,
          'height', p_height
        )
      );
      return p_asset_id;
    end if;

    select a.* into v_existing
      from public.app_branding_assets as a
     where a.id = p_asset_id
     for update;
    if not found then
      raise exception 'branding asset registration conflicted concurrently' using errcode = '40001';
    end if;
  end if;

  if v_existing.revoked_at is not null then
    raise exception 'branding asset id is already revoked' using errcode = '55000';
  end if;
  if v_existing.object_path is distinct from v_object_path
     or v_existing.sha256 is distinct from p_sha256
     or v_existing.mime_type is distinct from 'image/png'
     or v_existing.byte_length is distinct from p_byte_length
     or v_existing.width is distinct from p_width
     or v_existing.height is distinct from p_height
     or v_existing.uploaded_by is distinct from p_actor_id
     or v_existing.validated_at is null then
    raise exception 'branding asset id already exists with different immutable metadata'
      using errcode = '23505';
  end if;

  return p_asset_id;
end;
$$;

revoke all on function public.admin_register_branding_asset(uuid, text, bigint, integer, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_register_branding_asset(uuid, text, bigint, integer, integer, uuid)
  to service_role;

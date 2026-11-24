import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { assertLoopbackHttpUrl } from './helpers.mjs';

const FLAG_KEYS = ['oorva_brand', 'branding_runtime', 'branding_editor'];
const BUCKET = 'branding-assets';
const MIME = 'image/png';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});

function crc32(type, data) {
  let crc = 0xffffffff;
  for (const byte of type) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name, data) {
  const type = Buffer.from(name, 'ascii');
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(type, data));
  return Buffer.concat([length, type, data, checksum]);
}

function testPng({ metadata = true } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0);
  header.writeUInt32BE(32, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(32 * (1 + 32 * 4));
  const chunks = [pngChunk('IHDR', header)];
  if (metadata) chunks.push(pngChunk('tEXt', Buffer.from('Comment\0private test metadata')));
  chunks.push(
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  );
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

function headers({ anonKey, serviceRoleKey, token, contentType } = {}) {
  return {
    ...(anonKey ? { apikey: anonKey } : {}),
    ...(serviceRoleKey ? { Authorization: `Bearer ${serviceRoleKey}` } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };
}

function functionUrl(apiUrl, action) {
  return `${apiUrl.replace(/\/+$/, '')}/functions/v1/branding-assets${action ? `?action=${encodeURIComponent(action)}` : ''}`;
}

function storageObjectUrl(apiUrl, path, visibility = 'object') {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${apiUrl.replace(/\/+$/, '')}/storage/v1/${visibility}/branding-assets/${encoded}`;
}

async function responseJson(response) {
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = { text: text.slice(0, 512) };
  }
  return value;
}

async function createUser(apiUrl, serviceRoleKey, anonKey, createdUsers) {
  const idHint = randomUUID();
  const email = `o04-${idHint}@example.com`;
  const password = `O04!${idHint}A9`;
  const created = await fetch(`${apiUrl.replace(/\/+$/, '')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...headers({ anonKey, serviceRoleKey }), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const createdBody = await responseJson(created);
  assert.equal(created.ok, true, `local Auth user creation failed; actual=${JSON.stringify({ status: created.status, body: createdBody })}`);
  const id = createdBody.id ?? createdBody.user?.id;
  assert.equal(typeof id, 'string', `local Auth response must include a user id; actual=${JSON.stringify(createdBody)}`);
  createdUsers.push(id);

  const signedIn = await fetch(`${apiUrl.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await responseJson(signedIn);
  assert.equal(signedIn.ok, true, `local Auth sign-in failed; actual=${JSON.stringify({ status: signedIn.status, body: session })}`);
  assert.equal(typeof session.access_token, 'string', `local Auth response must include an access token; actual=${JSON.stringify(session)}`);
  return { id, email, accessToken: session.access_token };
}

async function deleteUser(apiUrl, serviceRoleKey, anonKey, userId) {
  const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: headers({ anonKey, serviceRoleKey }),
  });
  assert.ok(
    response.ok || response.status === 404,
    `local Auth cleanup failed; actual=${JSON.stringify({ userId, status: response.status, body: (await response.text()).slice(0, 256) })}`,
  );
}

async function upload(apiUrl, anonKey, token, bytes, contentType = MIME, extraQuery = '') {
  return fetch(`${functionUrl(apiUrl, 'upload')}${extraQuery}`, {
    method: 'POST',
    headers: headers({ anonKey, token, contentType }),
    body: bytes,
  });
}

async function countObjects(client) {
  const result = await client.query(
    `select count(*)::int as count
       from storage.objects
      where bucket_id = $1::text`,
    [BUCKET],
  );
  return result.rows[0]?.count;
}

async function removeObjects(apiUrl, serviceRoleKey, anonKey, paths) {
  if (paths.length === 0) return;
  const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { ...headers({ anonKey, serviceRoleKey }), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  });
  assert.ok(
    response.ok,
    `private Storage fixture cleanup failed; actual=${JSON.stringify({ paths, status: response.status, body: (await response.text()).slice(0, 512) })}`,
  );
}

export async function run({ withClient, localApiUrl, localServiceRoleKey }) {
  const apiUrl = assertLoopbackHttpUrl(localApiUrl).toString().replace(/\/+$/, '');
  const anonKey = process.env.LOCAL_ANON_KEY;
  const serviceRoleKey = localServiceRoleKey;
  assert.ok(typeof anonKey === 'string' && anonKey.length > 0, 'LOCAL_ANON_KEY is required for the private Edge test');
  assert.ok(
    typeof serviceRoleKey === 'string' && serviceRoleKey.length > 0,
    'LOCAL_SERVICE_ROLE_KEY is required for the private Edge test',
  );
  assert.notEqual(anonKey, serviceRoleKey, 'private Edge test keys must be distinct');

  const createdUsers = [];
  const storagePaths = new Set();
  const assetIds = new Set();
  await withClient(async (client) => {
    const previousFlags = (await client.query(
      `select key, enabled
         from public.feature_flags
        where key = any($1::text[])
        order by key`,
      [FLAG_KEYS],
    )).rows;
    assert.equal(
      previousFlags.length,
      FLAG_KEYS.length,
      `all branding parent flags must be initialized; actual=${JSON.stringify(previousFlags)}`,
    );
    const beforeObjects = await countObjects(client);

    let admin;
    let nonAdmin;
    let adminMemberAdded = false;
    try {
      admin = await createUser(apiUrl, serviceRoleKey, anonKey, createdUsers);
      nonAdmin = await createUser(apiUrl, serviceRoleKey, anonKey, createdUsers);
      await client.query(`insert into public.admins (user_id) values ($1::uuid)`, [admin.id]);
      adminMemberAdded = true;
      await client.query(
        `update public.feature_flags
            set enabled = true
          where key = any($1::text[])`,
        [FLAG_KEYS],
      );

      const noToken = await upload(apiUrl, anonKey, null, testPng());
      assert.equal(noToken.status, 401, `missing JWT must be rejected; actual=${JSON.stringify({ status: noToken.status, body: await responseJson(noToken) })}`);
      const nonAdminResponse = await upload(apiUrl, anonKey, nonAdmin.accessToken, testPng());
      assert.equal(
        nonAdminResponse.status,
        403,
        `valid non-admin JWT must be rejected; actual=${JSON.stringify({ status: nonAdminResponse.status, body: await responseJson(nonAdminResponse) })}`,
      );
      assert.equal(
        await countObjects(client),
        beforeObjects,
        `unauthorized requests must not create Storage objects; actual=${JSON.stringify({ beforeObjects, afterObjects: await countObjects(client) })}`,
      );

      for (const flag of FLAG_KEYS) {
        await client.query(
          `update public.feature_flags
              set enabled = false
            where key = $1::text`,
          [flag],
        );
        const denied = await upload(apiUrl, anonKey, admin.accessToken, testPng());
        assert.equal(
          denied.status,
          403,
          `feature OFF must reject admin upload; flag=${flag}; actual=${JSON.stringify({ status: denied.status, body: await responseJson(denied) })}`,
        );
        assert.equal(
          await countObjects(client),
          beforeObjects,
          `feature OFF must not touch Storage; flag=${flag}; actual=${JSON.stringify({ beforeObjects, afterObjects: await countObjects(client) })}`,
        );
        await client.query(
          `update public.feature_flags
              set enabled = true
            where key = $1::text`,
          [flag],
        );
      }

      const svgResponse = await upload(apiUrl, anonKey, admin.accessToken, Buffer.from('<svg/>'), 'image/svg+xml');
      assert.equal(svgResponse.status, 415, `SVG MIME must be rejected; actual=${JSON.stringify({ status: svgResponse.status, body: await responseJson(svgResponse) })}`);
      const invalidPngResponse = await upload(apiUrl, anonKey, admin.accessToken, Buffer.from('<svg/>'));
      assert.equal(
        invalidPngResponse.status,
        422,
        `invalid PNG bytes must be rejected; actual=${JSON.stringify({ status: invalidPngResponse.status, body: await responseJson(invalidPngResponse) })}`,
      );
      const arbitraryPathResponse = await upload(
        apiUrl,
        anonKey,
        admin.accessToken,
        testPng(),
        MIME,
        '&path=other-bucket%2Fobject',
      );
      assert.equal(
        arbitraryPathResponse.status,
        400,
        `caller-supplied paths must be rejected; actual=${JSON.stringify({ status: arbitraryPathResponse.status, body: await responseJson(arbitraryPathResponse) })}`,
      );
      assert.equal(
        await countObjects(client),
        beforeObjects,
        `invalid input must not create Storage objects; actual=${JSON.stringify({ beforeObjects, afterObjects: await countObjects(client) })}`,
      );

      const sourcePng = testPng();
      const uploadResponse = await upload(apiUrl, anonKey, admin.accessToken, sourcePng);
      const uploaded = await responseJson(uploadResponse);
      assert.equal(
        uploadResponse.status,
        201,
        `authorized enabled upload must succeed; actual=${JSON.stringify({ status: uploadResponse.status, body: uploaded })}`,
      );
      assert.match(uploaded.assetId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const assetId = uploaded.assetId;
      const objectPath = `branding/${assetId}.png`;
      assetIds.add(assetId);
      storagePaths.add(objectPath);
      assert.equal(uploadResponse.headers.get('Cache-Control'), 'no-store, private, max-age=0');

      const registered = await client.query(
        `select id, object_path, sha256, mime_type, byte_length, width, height,
                validated_at, published_once, revoked_at
           from public.app_branding_assets
          where id = $1::uuid`,
        [assetId],
      );
      assert.equal(
        registered.rowCount,
        1,
        `uploaded asset must register once; actual=${JSON.stringify(registered.rows)}`,
      );
      assert.deepEqual(
        {
          object_path: registered.rows[0]?.object_path,
          mime_type: registered.rows[0]?.mime_type,
          width: registered.rows[0]?.width,
          height: registered.rows[0]?.height,
          published_once: registered.rows[0]?.published_once,
          revoked_at: registered.rows[0]?.revoked_at,
          validated: registered.rows[0]?.validated_at !== null,
        },
        {
          object_path: objectPath,
          mime_type: MIME,
          width: 32,
          height: 32,
          published_once: false,
          revoked_at: null,
          validated: true,
        },
        `registered upload metadata mismatch; actual=${JSON.stringify(registered.rows)}`,
      );

      const privateDraftGet = await fetch(
        storageObjectUrl(apiUrl, objectPath, 'object/public'),
        { headers: { apikey: anonKey } },
      );
      assert.equal(
        privateDraftGet.ok,
        false,
        `draft object must remain private; actual=${JSON.stringify({ status: privateDraftGet.status })}`,
      );
      const unpublishedGet = await fetch(`${functionUrl(apiUrl, null)}?assetId=${encodeURIComponent(assetId)}`, {
        headers: { apikey: anonKey },
      });
      assert.equal(
        unpublishedGet.status,
        404,
        `draft asset must not be publicly served; actual=${JSON.stringify({ status: unpublishedGet.status, body: await responseJson(unpublishedGet) })}`,
      );

      const previewStarted = Date.now();
      const previewResponse = await fetch(functionUrl(apiUrl, 'preview'), {
        method: 'POST',
        headers: headers({ anonKey, token: admin.accessToken, contentType: 'application/json' }),
        body: JSON.stringify({ assetId }),
      });
      const preview = await responseJson(previewResponse);
      assert.equal(
        previewResponse.status,
        200,
        `authorized preview must succeed; actual=${JSON.stringify({ status: previewResponse.status, body: preview })}`,
      );
      assert.equal(previewResponse.headers.get('Cache-Control'), 'no-store, private, max-age=0');
      assert.equal(previewResponse.headers.get('Pragma'), 'no-cache');
      assert.equal(previewResponse.headers.get('Referrer-Policy'), 'no-referrer');
      const signed = new URL(preview.url);
      assert.equal(signed.origin, new URL(apiUrl).origin, `preview must use configured project origin; actual=${JSON.stringify({ signedOrigin: signed.origin, apiOrigin: new URL(apiUrl).origin })}`);
      assert.equal(
        signed.pathname,
        `/storage/v1/object/sign/${BUCKET}/${objectPath}`,
        `preview path must be server-derived; actual=${JSON.stringify({ pathname: signed.pathname, objectPath })}`,
      );
      assert.equal(preview.assetId, assetId);
      assert.ok(
        Date.parse(preview.expiresAt) > Date.now() &&
          Date.parse(preview.expiresAt) - previewStarted <= 300_000,
        `preview expiry must be within 300 seconds; actual=${JSON.stringify({ expiresAt: preview.expiresAt, previewStarted, now: Date.now() })}`,
      );
      assert.equal(
        preview.url.includes(admin.accessToken),
        false,
        'preview URL must not contain the caller bearer token',
      );
      const signedImage = await fetch(preview.url);
      const signedBytes = Buffer.from(await signedImage.arrayBuffer());
      assert.equal(
        signedImage.ok,
        true,
        `signed URL should load privately without an Authorization header; actual=${JSON.stringify({ status: signedImage.status })}`,
      );
      assert.equal(signedImage.headers.get('Content-Type')?.split(';')[0], MIME);
      assert.equal(
        signedBytes.includes(Buffer.from('private test metadata')),
        false,
        'stored preview bytes must have metadata removed',
      );

      const publicGetBeforePublish = await fetch(`${functionUrl(apiUrl, null)}?assetId=${encodeURIComponent(assetId)}`, {
        headers: { apikey: anonKey },
      });
      assert.equal(
        publicGetBeforePublish.status,
        404,
        `draft asset must remain unavailable even when request is anonymous; actual=${JSON.stringify({ status: publicGetBeforePublish.status })}`,
      );

      await client.query(
        `update public.app_branding_assets
            set published_once = true
          where id = $1::uuid`,
        [assetId],
      );
      const publicGet = await fetch(`${functionUrl(apiUrl, null)}?assetId=${encodeURIComponent(assetId)}`, {
        headers: { apikey: anonKey },
      });
      const publicBytes = Buffer.from(await publicGet.arrayBuffer());
      assert.equal(
        publicGet.status,
        200,
        `published asset should be public; actual=${JSON.stringify({ status: publicGet.status, contentType: publicGet.headers.get('Content-Type') })}`,
      );
      assert.equal(publicGet.headers.get('Content-Type'), MIME);
      assert.match(publicGet.headers.get('ETag') ?? '', /^"[0-9a-f]{64}"$/);
      const maxAge = Number(/(?:^|, )max-age=(\d+)/.exec(publicGet.headers.get('Cache-Control') ?? '')?.[1]);
      assert.ok(
        Number.isInteger(maxAge) && maxAge >= 0 && maxAge <= 300,
        `public cache must be bounded by 300 seconds; actual=${JSON.stringify({ cacheControl: publicGet.headers.get('Cache-Control'), maxAge })}`,
      );
      assert.equal(publicBytes.includes(Buffer.from('private test metadata')), false);

      await client.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [admin.id]);
      await client.query(
        `select public.admin_revoke_branding_asset($1::uuid, $2::text)`,
        [assetId, 'O04 private HTTP fixture'],
      );
      await client.query(`select set_config('request.jwt.claim.sub', ''::text, false)`);
      const revokedGet = await fetch(`${functionUrl(apiUrl, null)}?assetId=${encodeURIComponent(assetId)}`, {
        headers: { apikey: anonKey },
      });
      assert.equal(
        revokedGet.status,
        404,
        `revoked asset must stop serving on refetch; actual=${JSON.stringify({ status: revokedGet.status, body: await responseJson(revokedGet) })}`,
      );
    } finally {
      await client.query(
        `update public.feature_flags
            set enabled = previous.enabled
           from unnest($1::text[], $2::boolean[]) as previous(key, enabled)
          where public.feature_flags.key = previous.key`,
        [previousFlags.map((row) => row.key), previousFlags.map((row) => row.enabled)],
      );
      if (assetIds.size > 0) {
        const ids = [...assetIds];
        await removeObjects(apiUrl, serviceRoleKey, anonKey, [...storagePaths]);
        await client.query(
          `delete from public.admin_audit_log
            where target_id = any($1::uuid[])
              and action in ('branding_asset_registered', 'branding_asset_revoked')`,
          [ids],
        );
        await client.query(`delete from public.app_branding_assets where id = any($1::uuid[])`, [ids]);
      }
      if (adminMemberAdded && admin) {
        await client.query(`delete from public.admins where user_id = $1::uuid`, [admin.id]);
      }
      for (const userId of createdUsers) await deleteUser(apiUrl, serviceRoleKey, anonKey, userId);
    }
  });
}

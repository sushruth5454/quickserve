import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const FLAG_KEYS = ['oorva_brand', 'branding_runtime', 'branding_editor'];
const HASH_B = 'b'.repeat(64);
const STORAGE_BUCKET = 'branding-assets';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return crc >>> 0;
});

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBytes = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBytes, payload]);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  crc.writeUInt32BE(pngCrc32(crcInput));
  return Buffer.concat([length, typeBytes, payload, crc]);
}

function createPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// The RPC checks metadata and object presence; O04 owns full PNG-byte validation.
const STORAGE_PNG = createPng(32, 32);
const HASH_A = createHash('sha256').update(STORAGE_PNG).digest('hex');

async function asRole(client, role, callback) {
  await client.query(`set role ${role}`);
  try {
    return await callback();
  } finally {
    await client.query('reset role');
  }
}

async function expectPgError(callback, code, message) {
  let actual;
  try {
    await callback();
  } catch (error) {
    actual = error;
  }
  const actualError = actual ? { code: actual.code, message: actual.message } : null;
  assert.ok(actual, `${message} should fail; actual=${JSON.stringify(actualError)}`);
  assert.equal(
    actual.code,
    code,
    `${message} returned unexpected SQLSTATE; actual=${JSON.stringify({ code: actual.code, message: actual.message })}`,
  );
  return actual;
}

async function setFlags(client, enabledKeys) {
  await client.query(
    `update public.feature_flags
        set enabled = key = any($1::text[])
      where key = any($2::text[])`,
    [enabledKeys, FLAG_KEYS],
  );
}

function storageUrl(localApiUrl, path = '') {
  const base = `${localApiUrl.replace(/\/+$/, '')}/storage/v1/object/${STORAGE_BUCKET}`;
  if (!path) return base;
  return `${base}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function storageHeaders(localServiceRoleKey, contentType) {
  return {
    apikey: localServiceRoleKey,
    Authorization: `Bearer ${localServiceRoleKey}`,
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };
}

async function addPrivateObject(storageContext, assetId, createdPaths) {
  const path = `branding/${assetId}.png`;
  const response = await fetch(storageUrl(storageContext.localApiUrl, path), {
    method: 'POST',
    headers: storageHeaders(storageContext.localServiceRoleKey, 'image/png'),
    body: STORAGE_PNG,
  });
  const body = await response.text();
  assert.ok(
    response.ok,
    `private Storage API upload failed; actual=${JSON.stringify({ path, status: response.status, body: body.slice(0, 512) })}`,
  );
  createdPaths.add(path);
}

async function removePrivateObjects(storageContext, paths) {
  if (paths.length === 0) return;
  const response = await fetch(storageUrl(storageContext.localApiUrl), {
    method: 'DELETE',
    headers: storageHeaders(storageContext.localServiceRoleKey, 'application/json'),
    body: JSON.stringify({ prefixes: paths }),
  });
  const body = await response.text();
  assert.ok(
    response.ok,
    `private Storage API cleanup failed; actual=${JSON.stringify({ paths, status: response.status, body: body.slice(0, 512) })}`,
  );
}

async function register(client, actorId, assetId, overrides = {}) {
  const metadata = {
    sha256: HASH_A,
    byteLength: STORAGE_PNG.length,
    width: 32,
    height: 32,
    ...overrides,
  };
  return client.query(
    `select public.admin_register_branding_asset(
       $1::uuid, $2::text, $3::bigint, $4::integer, $5::integer, $6::uuid
     ) as id`,
    [
      assetId,
      metadata.sha256,
      metadata.byteLength,
      metadata.width,
      metadata.height,
      actorId,
    ],
  );
}

async function registerAsService(client, actorId, assetId, overrides = {}) {
  return asRole(client, 'service_role', () => register(client, actorId, assetId, overrides));
}

export async function run({ withClient, withTwoClients, localApiUrl, localServiceRoleKey }) {
  assert.ok(
    localApiUrl,
    `private Storage API URL is required for asset fixtures; actual=${JSON.stringify({ localApiUrl: Boolean(localApiUrl) })}`,
  );
  assert.ok(
    localServiceRoleKey,
    `private Storage service-role key is required for asset fixtures; actual=${JSON.stringify({ localServiceRoleKey: Boolean(localServiceRoleKey) })}`,
  );
  const storageContext = { localApiUrl, localServiceRoleKey };
  const createdStoragePaths = new Set();
  const actorId = randomUUID();
  const nonAdminId = randomUUID();
  const assetIds = {
    valid: randomUUID(),
    invalidActor: randomUUID(),
    parentOff: randomUUID(),
    runtimeOff: randomUUID(),
    editorOff: randomUUID(),
    revoked: randomUUID(),
    concurrent: randomUUID(),
    missingObject: randomUUID(),
    invalidHash: randomUUID(),
    oversizedBytes: randomUUID(),
    undersizedWidth: randomUUID(),
    oversizedDimension: randomUUID(),
    pixelCeiling: randomUUID(),
  };
  const allAssetIds = Object.values(assetIds);

  await withClient(async (client) => {
    const originalFlags = (await client.query(
      `select key, enabled
         from public.feature_flags
        where key = any($1::text[])
        order by key`,
      [FLAG_KEYS],
    )).rows;
    assert.equal(
      originalFlags.length,
      FLAG_KEYS.length,
      `O03 feature flags must exist before registration tests; actual=${JSON.stringify(originalFlags)}`,
    );
    const originalPolicyResult = await client.query(
      `select value, updated_by, updated_at
         from public.app_config
        where key = 'branding_policy'`,
    );
    assert.equal(
      originalPolicyResult.rowCount,
      1,
      `branding policy must be initialized; actual=${JSON.stringify(originalPolicyResult.rows)}`,
    );
    const originalPolicy = originalPolicyResult.rows[0];
    const policyForTest = { ...originalPolicy.value };
    delete policyForTest.revision;
    const policyForRestore = { ...originalPolicy.value };
    delete policyForRestore.revision;
    Object.assign(policyForTest, {
      maxUploadBytes: 4096,
      minImageDimension: 32,
      maxImageDimension: 64,
      maxImagePixels: 1024,
    });

    await client.query(
      `insert into auth.users (id) values ($1::uuid), ($2::uuid)`,
      [actorId, nonAdminId],
    );
    await client.query(
      `insert into public.admins (user_id) values ($1::uuid)`,
      [actorId],
    );

    let policyChanged = false;
    try {
      const grants = await client.query(`
        select
          has_function_privilege(
            'service_role',
            'public.admin_register_branding_asset(uuid,text,bigint,integer,integer,uuid)',
            'EXECUTE'
          ) as service_execute,
          has_function_privilege(
            'anon',
            'public.admin_register_branding_asset(uuid,text,bigint,integer,integer,uuid)',
            'EXECUTE'
          ) as anon_execute,
          has_function_privilege(
            'authenticated',
            'public.admin_register_branding_asset(uuid,text,bigint,integer,integer,uuid)',
            'EXECUTE'
          ) as authenticated_execute,
          has_table_privilege('service_role', 'public.app_branding_assets', 'SELECT') as service_table_select,
          has_table_privilege('service_role', 'public.app_branding_assets', 'INSERT') as service_table_insert,
          has_table_privilege('service_role', 'public.app_branding_assets', 'UPDATE') as service_table_update,
          has_table_privilege('service_role', 'public.app_branding_assets', 'DELETE') as service_table_delete
      `);
      assert.deepEqual(
        grants.rows[0],
        {
          service_execute: true,
          anon_execute: false,
          authenticated_execute: false,
          service_table_select: false,
          service_table_insert: false,
          service_table_update: false,
          service_table_delete: false,
        },
        `registration RPC/table grants must preserve the service-only boundary; actual=${JSON.stringify(grants.rows)}`,
      );
      for (const role of ['anon', 'authenticated']) {
        await asRole(client, role, () => expectPgError(
          () => register(client, actorId, assetIds.missingObject),
          '42501',
          `${role} RPC execution`,
        ));
      }
      await asRole(client, 'service_role', () => expectPgError(
        () => client.query(`select id from public.app_branding_assets limit 1`),
        '42501',
        'service_role direct table read',
      ));

      await setFlags(client, FLAG_KEYS);
      await client.query(
        `select set_config('request.jwt.claim.sub', $1::text, false)`,
        [actorId],
      );
      await client.query(
        `select public.admin_set_branding_policy($1::jsonb)`,
        [JSON.stringify(policyForTest)],
      );
      policyChanged = true;

      await addPrivateObject(storageContext, assetIds.valid, createdStoragePaths);
      const valid = await registerAsService(client, actorId, assetIds.valid);
      assert.equal(
        valid.rows[0]?.id,
        assetIds.valid,
        `valid registration must return its asset id; actual=${JSON.stringify(valid.rows)}`,
      );
      const retry = await registerAsService(client, actorId, assetIds.valid);
      assert.equal(
        retry.rows[0]?.id,
        assetIds.valid,
        `identical retry must return the original asset id; actual=${JSON.stringify(retry.rows)}`,
      );
      const registered = await client.query(
        `select id, object_path, sha256, mime_type, byte_length, width, height,
                uploaded_by, validated_at
           from public.app_branding_assets
          where id = $1::uuid`,
        [assetIds.valid],
      );
      assert.deepEqual(
        registered.rows[0],
        {
          id: assetIds.valid,
          object_path: `branding/${assetIds.valid}.png`,
          sha256: HASH_A,
          mime_type: 'image/png',
          byte_length: String(STORAGE_PNG.length),
          width: 32,
          height: 32,
          uploaded_by: actorId,
          validated_at: registered.rows[0]?.validated_at,
        },
        `registration must derive the private PNG path and record Edge-validated metadata; actual=${JSON.stringify(registered.rows)}`,
      );
      assert.ok(
        registered.rows[0]?.validated_at,
        `successful registration must mark Edge validation; actual=${JSON.stringify(registered.rows)}`,
      );
      const registrationAudit = await client.query(
        `select admin_id, action, target_id, details
           from public.admin_audit_log
          where target_id = $1::uuid
            and action = 'branding_asset_registered'`,
        [assetIds.valid],
      );
      assert.equal(
        registrationAudit.rowCount,
        1,
        `one registration plus an identical retry must create one audit row; actual=${JSON.stringify(registrationAudit.rows)}`,
      );
      assert.equal(
        registrationAudit.rows[0]?.admin_id,
        actorId,
        `audit actor must be the verified O03 admin; actual=${JSON.stringify(registrationAudit.rows)}`,
      );

      await expectPgError(
        () => registerAsService(client, actorId, assetIds.valid, { sha256: HASH_B }),
        '23505',
        'conflicting immutable retry',
      );
      const conflictingRetryAudit = await client.query(
        `select count(*)::integer as count
           from public.admin_audit_log
          where target_id = $1::uuid
            and action = 'branding_asset_registered'`,
        [assetIds.valid],
      );
      assert.equal(
        conflictingRetryAudit.rows[0]?.count,
        1,
        `a conflicting retry must not add another registration audit event; actual=${JSON.stringify(conflictingRetryAudit.rows)}`,
      );

      await addPrivateObject(storageContext, assetIds.invalidActor, createdStoragePaths);
      await expectPgError(
        () => registerAsService(client, nonAdminId, assetIds.invalidActor),
        '42501',
        'unlisted actor registration',
      );

      const invalidMetadata = [
        ['non-normalized SHA-256', assetIds.invalidHash, { sha256: 'A'.repeat(64) }],
        ['oversized bytes', assetIds.oversizedBytes, { byteLength: 4097 }],
        ['undersized width', assetIds.undersizedWidth, { width: 31 }],
        ['oversized dimension', assetIds.oversizedDimension, { width: 65 }],
        ['configured pixel ceiling', assetIds.pixelCeiling, { width: 33 }],
      ];
      for (const [label, assetId, overrides] of invalidMetadata) {
        await addPrivateObject(storageContext, assetId, createdStoragePaths);
        await expectPgError(
          () => registerAsService(client, actorId, assetId, overrides),
          '22023',
          label,
        );
      }
      await expectPgError(
        () => registerAsService(client, actorId, assetIds.missingObject),
        'P0002',
        'missing private Storage object',
      );

      await addPrivateObject(storageContext, assetIds.parentOff, createdStoragePaths);
      await setFlags(client, ['branding_runtime', 'branding_editor']);
      await expectPgError(
        () => registerAsService(client, actorId, assetIds.parentOff),
        '55000',
        'oorva_brand OFF',
      );
      await addPrivateObject(storageContext, assetIds.runtimeOff, createdStoragePaths);
      await setFlags(client, ['oorva_brand', 'branding_editor']);
      await expectPgError(
        () => registerAsService(client, actorId, assetIds.runtimeOff),
        '55000',
        'branding_runtime OFF',
      );
      await addPrivateObject(storageContext, assetIds.editorOff, createdStoragePaths);
      await setFlags(client, ['oorva_brand', 'branding_runtime']);
      await expectPgError(
        () => registerAsService(client, actorId, assetIds.editorOff),
        '55000',
        'branding_editor OFF',
      );

      await setFlags(client, FLAG_KEYS);
      await addPrivateObject(storageContext, assetIds.revoked, createdStoragePaths);
      await registerAsService(client, actorId, assetIds.revoked);
      await client.query(
        `select set_config('request.jwt.claim.sub', $1::text, false)`,
        [actorId],
      );
      await client.query(
        `select public.admin_revoke_branding_asset($1::uuid, $2::text)`,
        [assetIds.revoked, 'Registration test revocation'],
      );
      await expectPgError(
        () => registerAsService(client, actorId, assetIds.revoked),
        '55000',
        'revoked asset id',
      );

      await addPrivateObject(storageContext, assetIds.concurrent, createdStoragePaths);
      await withTwoClients(async (first, second) => {
        const [firstPidResult, secondPidResult] = await Promise.all([
          first.query(`select pg_backend_pid() as pid`),
          second.query(`select pg_backend_pid() as pid`),
        ]);
        const firstPid = Number(firstPidResult.rows[0]?.pid);
        const secondPid = Number(secondPidResult.rows[0]?.pid);
        assert.ok(
          Number.isInteger(firstPid) && Number.isInteger(secondPid) && firstPid !== secondPid,
          `duplicate registration must use distinct PostgreSQL backends; actual=${JSON.stringify({ firstPid, secondPid })}`,
        );

        let transactionOpen = false;
        let firstRoleActive = false;
        let secondRoleActive = false;
        let secondRegistration;
        try {
          await first.query('begin');
          transactionOpen = true;
          await first.query('set role service_role');
          firstRoleActive = true;
          const firstRegistration = await register(first, actorId, assetIds.concurrent);
          assert.equal(
            firstRegistration.rows[0]?.id,
            assetIds.concurrent,
            `first concurrent registration must insert; actual=${JSON.stringify(firstRegistration.rows)}`,
          );
          await first.query('reset role');
          firstRoleActive = false;

          await second.query('set role service_role');
          secondRoleActive = true;
          secondRegistration = register(second, actorId, assetIds.concurrent);

          let blockedByUniqueConflict = false;
          let lastActivity;
          for (let attempt = 0; attempt < 200; attempt += 1) {
            const activity = await first.query(
              `select state, wait_event_type, wait_event
                 from pg_catalog.pg_stat_activity
                where pid = $1::integer`,
              [secondPid],
            );
            lastActivity = activity.rows[0] ?? null;
            if (
              lastActivity?.state === 'active'
              && lastActivity?.wait_event_type === 'Lock'
            ) {
              blockedByUniqueConflict = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          assert.equal(
            blockedByUniqueConflict,
            true,
            `second duplicate must wait on the first insert before commit; actual=${JSON.stringify({ firstPid, secondPid, lastActivity })}`,
          );

          await first.query('commit');
          transactionOpen = false;
          const secondResult = await secondRegistration;
          assert.equal(
            secondResult.rows[0]?.id,
            assetIds.concurrent,
            `concurrent identical retry must return the inserted asset id; actual=${JSON.stringify(secondResult.rows)}`,
          );
          await second.query('reset role');
          secondRoleActive = false;
        } finally {
          if (transactionOpen) await first.query('rollback').catch(() => undefined);
          if (firstRoleActive) await first.query('reset role').catch(() => undefined);
          if (secondRegistration) await secondRegistration.catch(() => undefined);
          if (secondRoleActive) await second.query('reset role').catch(() => undefined);
        }
      });

      const concurrentAudit = await client.query(
        `select count(*)::integer as count
           from public.admin_audit_log
          where target_id = $1::uuid
            and action = 'branding_asset_registered'`,
        [assetIds.concurrent],
      );
      assert.equal(
        concurrentAudit.rows[0]?.count,
        1,
        `concurrent identical registration must create one asset audit row; actual=${JSON.stringify(concurrentAudit.rows)}`,
      );
    } finally {
      if (policyChanged) {
        await setFlags(client, FLAG_KEYS);
        await client.query(
          `select set_config('request.jwt.claim.sub', $1::text, false)`,
          [actorId],
        );
        await client.query(
          `select public.admin_set_branding_policy($1::jsonb)`,
          [JSON.stringify(policyForRestore)],
        );
        await client.query(
          `update public.app_config
              set value = value || jsonb_build_object('revision', $1::bigint),
                  updated_by = $2::uuid,
                  updated_at = $3::timestamptz
            where key = 'branding_policy'`,
          [originalPolicy.value.revision, originalPolicy.updated_by, originalPolicy.updated_at],
        );
      }
      for (const flag of originalFlags) {
        await client.query(
          `update public.feature_flags set enabled = $2::boolean where key = $1::text`,
          [flag.key, flag.enabled],
        );
      }
      await client.query(
        `delete from public.admin_audit_log
          where admin_id = $1::uuid
            and (
              action in ('branding_asset_registered', 'branding_asset_revoked', 'branding_policy_changed')
              and (target_id = any($2::uuid[]) or action = 'branding_policy_changed')
            )`,
        [actorId, allAssetIds],
      );
      await client.query(
        `delete from public.app_branding_assets where id = any($1::uuid[])`,
        [allAssetIds],
      );
      await client.query(`delete from public.admins where user_id = $1::uuid`, [actorId]);
      await client.query(
        `delete from auth.users where id = any($1::uuid[])`,
        [[actorId, nonAdminId]],
      );
      await removePrivateObjects(storageContext, [...createdStoragePaths]);
    }
  });
}

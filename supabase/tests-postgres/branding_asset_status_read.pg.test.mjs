import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const FLAG_KEYS = ['oorva_brand', 'branding_runtime', 'branding_editor'];
const SAFE_COLUMNS = [
  'id',
  'object_path',
  'sha256',
  'mime_type',
  'byte_length',
  'width',
  'height',
  'validated_at',
  'published_once',
  'revoked_at',
];

async function asRole(client, role, callback) {
  await client.query(`set role ${role}`);
  try {
    return await callback();
  } finally {
    await client.query('reset role');
  }
}

async function expectPgError(callback, code, label) {
  let actual;
  try {
    await callback();
  } catch (error) {
    actual = error;
  }
  const details = actual ? { code: actual.code, message: actual.message } : null;
  assert.ok(actual, `${label} should fail; actual=${JSON.stringify(details)}`);
  assert.equal(actual.code, code, `${label} SQLSTATE; actual=${JSON.stringify(details)}`);
}

async function setStatusFlagsOff(client) {
  await client.query(
    `update public.feature_flags
        set enabled = false
      where key = any($1::text[])`,
    [FLAG_KEYS],
  );
}

async function registerFixture(client, actorId, assetId, { revoked = false } = {}) {
  await client.query(
    `insert into public.app_branding_assets (
       id, object_path, sha256, mime_type, byte_length, width, height,
       uploaded_by, validated_at, published_once, revoked_at, revoked_by, revoke_reason
     ) values (
       $1::uuid, $2::text, $3::text, 'image/png', $4::bigint, $5::integer, $6::integer,
       $7::uuid, now(), true,
       case when $8::boolean then now() else null end,
       case when $8::boolean then $7::uuid else null end,
       case when $8::boolean then 'status fixture'::text else null end
     )`,
    [
      assetId,
      `branding/${assetId}.png`,
      revoked ? 'b'.repeat(64) : 'a'.repeat(64),
      256,
      64,
      64,
      actorId,
      revoked,
    ],
  );
}

async function getStatusAsService(client, assetId) {
  return asRole(client, 'service_role', () => client.query(
    `select * from public.service_get_branding_asset_status($1::uuid)`,
    [assetId],
  ));
}

export async function run({ withClient }) {
  const actorId = randomUUID();
  const activeAssetId = randomUUID();
  const revokedAssetId = randomUUID();
  const missingAssetId = randomUUID();

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
      `all status flags must be initialized; actual=${JSON.stringify(previousFlags)}`,
    );

    await client.query(`insert into auth.users (id) values ($1::uuid)`, [actorId]);
    try {
      await registerFixture(client, actorId, activeAssetId);
      await registerFixture(client, actorId, revokedAssetId, { revoked: true });
      await setStatusFlagsOff(client);

      const effectiveFlags = await client.query(
        `select key, public._oorva_feature_enabled(key) as enabled
           from public.feature_flags
          where key = any($1::text[])
          order by key`,
        [FLAG_KEYS],
      );
      assert.deepEqual(
        effectiveFlags.rows,
        FLAG_KEYS.map((key) => ({ key, enabled: false })).sort((left, right) => left.key.localeCompare(right.key)),
        `all effective asset-status flags must be OFF; actual=${JSON.stringify(effectiveFlags.rows)}`,
      );

      const permissions = await client.query(`
        select
          has_function_privilege(
            'service_role',
            'public.service_get_branding_asset_status(uuid)',
            'EXECUTE'
          ) as service_execute,
          has_function_privilege(
            'anon',
            'public.service_get_branding_asset_status(uuid)',
            'EXECUTE'
          ) as anon_execute,
          has_function_privilege(
            'authenticated',
            'public.service_get_branding_asset_status(uuid)',
            'EXECUTE'
          ) as authenticated_execute,
          has_table_privilege('service_role', 'public.app_branding_assets', 'SELECT') as service_table_select,
          has_table_privilege('anon', 'public.app_branding_assets', 'SELECT') as anon_table_select,
          has_table_privilege('authenticated', 'public.app_branding_assets', 'SELECT') as authenticated_table_select
      `);
      assert.deepEqual(
        permissions.rows[0],
        {
          service_execute: true,
          anon_execute: false,
          authenticated_execute: false,
          service_table_select: false,
          anon_table_select: false,
          authenticated_table_select: false,
        },
        `status RPC must be service-role-only with direct table reads revoked; actual=${JSON.stringify(permissions.rows)}`,
      );

      const definition = await client.query(`
        select p.prosecdef, p.proconfig
          from pg_catalog.pg_proc as p
         where p.oid = 'public.service_get_branding_asset_status(uuid)'::regprocedure
      `);
      assert.equal(
        definition.rows[0]?.prosecdef,
        true,
        `status RPC must be SECURITY DEFINER; actual=${JSON.stringify(definition.rows)}`,
      );
      assert.ok(
        definition.rows[0]?.proconfig?.some((entry) => entry.replace(/\s+/g, '') === 'search_path=pg_catalog,public'),
        `status RPC must have a fixed search_path; actual=${JSON.stringify(definition.rows)}`,
      );

      const active = await getStatusAsService(client, activeAssetId);
      assert.equal(active.rowCount, 1, `service status must return the registered UUID while flags are OFF; actual=${JSON.stringify(active.rows)}`);
      assert.deepEqual(
        Object.keys(active.rows[0]).sort(),
        [...SAFE_COLUMNS].sort(),
        `status result must contain only the safe O04 fields; actual=${JSON.stringify(active.rows[0])}`,
      );
      assert.equal(
        JSON.stringify({
          id: active.rows[0]?.id,
          object_path: active.rows[0]?.object_path,
          sha256: active.rows[0]?.sha256,
          mime_type: active.rows[0]?.mime_type,
          byte_length: active.rows[0]?.byte_length,
          width: active.rows[0]?.width,
          height: active.rows[0]?.height,
          validated: active.rows[0]?.validated_at !== null,
          published_once: active.rows[0]?.published_once,
          revoked_at: active.rows[0]?.revoked_at,
        }),
        JSON.stringify({
          id: activeAssetId,
          object_path: `branding/${activeAssetId}.png`,
          sha256: 'a'.repeat(64),
          mime_type: 'image/png',
          byte_length: '256',
          width: 64,
          height: 64,
          validated: true,
          published_once: true,
          revoked_at: null,
        }),
        `active status metadata mismatch; actual=${JSON.stringify(active.rows)}`,
      );

      const revoked = await getStatusAsService(client, revokedAssetId);
      assert.equal(revoked.rowCount, 1, `revoked status must remain readable while flags are OFF; actual=${JSON.stringify(revoked.rows)}`);
      assert.ok(
        revoked.rows[0]?.revoked_at,
        `revoked status must expose revocation time but no actor or reason; actual=${JSON.stringify(revoked.rows)}`,
      );
      assert.deepEqual(
        Object.keys(revoked.rows[0]).sort(),
        [...SAFE_COLUMNS].sort(),
        `revoked status must contain only safe fields; actual=${JSON.stringify(revoked.rows[0])}`,
      );

      const missing = await getStatusAsService(client, missingAssetId);
      assert.equal(
        missing.rowCount,
        0,
        `unknown asset IDs must return no row; actual=${JSON.stringify({ missingAssetId, rows: missing.rows })}`,
      );

      for (const role of ['anon', 'authenticated']) {
        await asRole(client, role, () => expectPgError(
          () => client.query(
            `select * from public.service_get_branding_asset_status($1::uuid)`,
            [activeAssetId],
          ),
          '42501',
          `${role} status RPC execution`,
        ));
        await asRole(client, role, () => expectPgError(
          () => client.query(
            `select id from public.app_branding_assets where id = $1::uuid`,
            [activeAssetId],
          ),
          '42501',
          `${role} direct asset-table read`,
        ));
      }
      await asRole(client, 'service_role', () => expectPgError(
        () => client.query(
          `select id from public.app_branding_assets where id = $1::uuid`,
          [activeAssetId],
        ),
        '42501',
        'service_role direct asset-table read',
      ));
    } finally {
      for (const flag of previousFlags) {
        await client.query(
          `update public.feature_flags set enabled = $2::boolean where key = $1::text`,
          [flag.key, flag.enabled],
        );
      }
      await client.query(
        `delete from public.app_branding_assets where id = any($1::uuid[])`,
        [[activeAssetId, revokedAssetId]],
      );
      await client.query(`delete from auth.users where id = $1::uuid`, [actorId]);
    }
  });
}

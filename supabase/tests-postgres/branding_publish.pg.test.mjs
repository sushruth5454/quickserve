import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const OORVA_KEYS = [
  'oorva_brand', 'branding_runtime', 'branding_editor', 'oorva_launch_animation',
  'oorva_home_ux', 'oorva_auth_ux', 'oorva_catalogue_ux', 'oorva_booking_ux',
  'oorva_recurring_ux', 'oorva_shops_ux', 'oorva_rfq_ux', 'oorva_sports_ux',
  'oorva_creators_ux', 'oorva_account_ux', 'oorva_comms_ux', 'oorva_provider_ux',
  'oorva_onboarding_ux', 'oorva_merchant_shop_ux', 'oorva_business_staff_ux',
  'oorva_venue_ops_ux', 'oorva_admin_ops_ux', 'oorva_admin_config_ux',
  'oorva_admin_money_ux', 'oorva_ai_ux', 'oorva_external_brand',
];

const config = {
  schemaVersion: 1,
  displayName: 'Oorva CAS fixture',
  tagline: 'Your world, closer.',
  defaultTheme: 'system',
  headingFont: 'inter',
  assets: {
    logoLight: null,
    logoDark: null,
    compactLight: null,
    compactDark: null,
    promotional: [],
  },
  light: {},
  dark: {},
  motion: { launchDurationMs: 0 },
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function run({ withClient, withTwoClients }) {
  const adminId = randomUUID();
  const versionId = randomUUID();
  const appNameB = `o03-publish-${randomUUID()}`;
  let versionSaved = false;

  await withClient(async (client) => {
    await client.query(`insert into auth.users (id) values ($1::uuid)`, [adminId]);
    await client.query(`insert into public.admins (user_id) values ($1::uuid)`, [adminId]);
    await client.query(
      `update public.feature_flags
          set enabled = key = any($1::text[])
        where key = any($2::text[])`,
      [['oorva_brand', 'branding_runtime', 'branding_editor'], OORVA_KEYS],
    );
    await client.query(
      `select set_config('request.jwt.claim.sub', $1::text, false)`,
      [adminId],
    );
    const saved = await client.query(
      `select public.admin_save_branding_draft($1::jsonb, $2::uuid) as id`,
      [JSON.stringify(config), versionId],
    );
    assert.equal(
      saved.rows[0]?.id,
      versionId,
      `draft version id mismatch; actual=${JSON.stringify(saved.rows)}`,
    );
    versionSaved = true;
  });

  assert.equal(versionSaved, true, 'the publication fixture must be immutable and saved before the race');

  await withTwoClients(async (first, second) => {
    const [firstPidResult, secondPidResult] = await Promise.all([
      first.query(`select pg_backend_pid() as pid`),
      second.query(`select pg_backend_pid() as pid`),
    ]);
    const firstPid = Number(firstPidResult.rows[0]?.pid);
    const secondPid = Number(secondPidResult.rows[0]?.pid);
    assert.ok(
      Number.isInteger(firstPid) && Number.isInteger(secondPid) && firstPid !== secondPid,
      `publish race must use two distinct PostgreSQL backends; actual=${JSON.stringify({ firstPid, secondPid })}`,
    );

    await Promise.all([
      first.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [adminId]),
      second.query(`select set_config('request.jwt.claim.sub', $1::text, false)`, [adminId]),
      second.query(`select set_config('application_name', $1::text, false)`, [appNameB]),
    ]);

    let firstTransactionOpen = false;
    let secondPublish;
    try {
      await first.query('begin');
      firstTransactionOpen = true;
      const firstPublish = await first.query(
        `select public.admin_publish_branding($1::uuid, $2::bigint, $3::text) as snapshot`,
        [versionId, 0, 'First concurrent publisher'],
      );
      assert.equal(
        firstPublish.rows[0]?.snapshot?.generation,
        '1',
        `first publisher should advance the generation inside its transaction; actual=${JSON.stringify(firstPublish.rows)}`,
      );

      const beforeCommit = await second.query(
        `select public.get_app_branding_snapshot() as snapshot`,
      );
      const beforeSnapshot = beforeCommit.rows[0]?.snapshot;
      assert.equal(
        JSON.stringify({
          generation: beforeSnapshot?.generation,
          publishedVersionId: beforeSnapshot?.publishedVersionId,
          config: beforeSnapshot?.config,
        }),
        JSON.stringify({ generation: '0', publishedVersionId: null, config: null }),
        `reader must observe the old complete snapshot before publisher A commits; actual=${JSON.stringify(beforeSnapshot)}`,
      );

      secondPublish = second.query(
        `select public.admin_publish_branding($1::uuid, $2::bigint, $3::text) as snapshot`,
        [versionId, 0, 'Second publisher with stale expected generation'],
      );
      let blockedByPublicationLock = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const activity = await first.query(
          `select state, wait_event_type, wait_event
             from pg_catalog.pg_stat_activity
            where pid = $1::int`,
          [secondPid],
        );
        if (activity.rows[0]?.state === 'active' && activity.rows[0]?.wait_event_type === 'Lock') {
          blockedByPublicationLock = true;
          break;
        }
        await wait(25);
      }
      assert.equal(
        blockedByPublicationLock,
        true,
        `publisher B must be blocked by A's singleton row lock before A releases it; actual=${JSON.stringify({ firstPid, secondPid })}`,
      );

      await first.query('commit');
      firstTransactionOpen = false;
      const secondError = await secondPublish.then(
        () => null,
        (error) => error,
      );
      assert.ok(
        secondError,
        'exactly one concurrent publisher must fail the stale expected-generation check',
      );
      assert.equal(
        secondError.code,
        '40001',
        `losing publisher must receive the stale-generation SQLSTATE; actual=${JSON.stringify({ message: secondError.message, code: secondError.code })}`,
      );
      assert.match(
        secondError.message,
        /stale branding generation/,
        `losing publisher must receive the stale-generation diagnostic; actual=${JSON.stringify(secondError.message)}`,
      );

      const afterCommit = await second.query(
        `select public.get_app_branding_snapshot() as snapshot`,
      );
      const afterSnapshot = afterCommit.rows[0]?.snapshot;
      assert.equal(
        JSON.stringify({
          generation: afterSnapshot?.generation,
          publishedVersionId: afterSnapshot?.publishedVersionId,
          displayName: afterSnapshot?.config?.displayName,
        }),
        JSON.stringify({
          generation: '1',
          publishedVersionId: versionId,
          displayName: config.displayName,
        }),
        `reader must observe the new complete snapshot after publisher A commits; actual=${JSON.stringify(afterSnapshot)}`,
      );

      const publications = await second.query(
        `select generation, publication_kind, target_version_id
           from public.app_branding_publications
          order by generation`,
      );
      assert.equal(
        JSON.stringify(publications.rows),
        JSON.stringify([{ generation: '1', publication_kind: 'publish', target_version_id: versionId }]),
        `race must commit exactly one publication history row; actual=${JSON.stringify(publications.rows)}`,
      );
    } finally {
      if (firstTransactionOpen) await first.query('rollback').catch(() => undefined);
      if (secondPublish) {
        await secondPublish.catch(() => undefined);
      }
    }
  });
}

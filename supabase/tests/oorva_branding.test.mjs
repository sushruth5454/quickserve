import { createHarness } from './harness.mjs';
import { as, db } from './r1-test-harness.mjs';

const { ok, scenario, finish } = createHarness();
const OORVA_KEYS = [
  'oorva_brand', 'branding_runtime', 'branding_editor', 'oorva_launch_animation',
  'oorva_home_ux', 'oorva_auth_ux', 'oorva_catalogue_ux', 'oorva_booking_ux',
  'oorva_recurring_ux', 'oorva_shops_ux', 'oorva_rfq_ux', 'oorva_sports_ux',
  'oorva_creators_ux', 'oorva_account_ux', 'oorva_comms_ux', 'oorva_provider_ux',
  'oorva_onboarding_ux', 'oorva_merchant_shop_ux', 'oorva_business_staff_ux',
  'oorva_venue_ops_ux', 'oorva_admin_ops_ux', 'oorva_admin_config_ux',
  'oorva_admin_money_ux', 'oorva_ai_ux', 'oorva_external_brand',
];
const STATUS_FLAGS = ['oorva_brand', 'branding_runtime', 'branding_editor'];
const ASSET_STATUS_FIELDS = [
  'id', 'object_path', 'sha256', 'mime_type', 'byte_length',
  'width', 'height', 'validated_at', 'published_once', 'revoked_at',
];
const ASSET_STATUS_FLAGS = ['oorva_brand', 'branding_runtime', 'branding_editor'];
const ASSET_STATUS_FIELDS = [
  'id', 'object_path', 'sha256', 'mime_type', 'byte_length',
  'width', 'height', 'validated_at', 'published_once', 'revoked_at',
];
const ADMIN_ID = '00000000-0000-4000-8000-000000000031';
const NON_ADMIN_ID = '00000000-0000-4000-8000-000000000032';
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const check = (condition, label, actual) => ok(condition, `${label}; actual=${JSON.stringify(actual)}`);

const config = (displayName = 'Oorva', assets = {}) => ({
  schemaVersion: 1,
  displayName,
  tagline: 'Your world, closer.',
  defaultTheme: 'system',
  headingFont: 'inter',
  assets: {
    logoLight: null,
    logoDark: null,
    compactLight: null,
    compactDark: null,
    promotional: [],
    ...assets,
  },
  light: {},
  dark: {},
  motion: { launchDurationMs: 0 },
});

const defaultPolicy = {
  maxUploadBytes: 2097152,
  minImageDimension: 32,
  maxImageDimension: 4096,
  maxImagePixels: 16777216,
  maxPromotions: 6,
  maxAppearanceBytes: 32768,
  maxDisplayNameLength: 32,
  maxTaglineLength: 80,
};

async function setFlags(enabledKeys = []) {
  await db.query(
    `update public.feature_flags set enabled = key = any($1::text[]) where key = any($2::text[])`,
    [enabledKeys, OORVA_KEYS],
  );
}

async function ensureUser(id, admin = false) {
  await db.query(`insert into auth.users (id) values ($1::uuid) on conflict (id) do nothing`, [id]);
  if (admin) {
    await db.query(`insert into public.admins (user_id) values ($1::uuid) on conflict (user_id) do nothing`, [id]);
  }
}

async function expectRejected(action, expression, label) {
  let error;
  try {
    await action();
  } catch (caught) {
    error = caught;
  }
  check(Boolean(error && expression.test(String(error.message))), label, {
    message: error?.message ?? null,
    code: error?.code ?? null,
  });
  return error;
}

async function saveDraft(actorId, value, versionId) {
  return as(
    actorId,
    'authenticated',
    `select public.admin_save_branding_draft($1::jsonb, $2::uuid) as id`,
    [JSON.stringify(value), versionId],
  );
}

await scenario('O03-registry-snapshot-private-surface', async () => {
  const expected = [
    ['oorva_brand', 'Oorva brand & colours', 'Existing bundled identity/palettes remain; native installed assets cannot remotely revert', 'Appearance', 200],
    ['branding_runtime', 'Published appearance', 'Use bundled Oorva design when brand is ON, not a half-applied remote config', 'Branding', 201],
    ['branding_editor', 'Branding editor', 'No new drafts/uploads/ordinary publishes; current version and admin recovery remain readable', 'Branding', 202],
    ['oorva_launch_animation', 'Oorva launch motion', 'No in-app reveal animation; never disable native startup', 'Branding', 203],
    ['oorva_home_ux', 'Oorva home and search', 'Existing home/search layout and routing retained', 'Oorva experience', 204],
    ['oorva_auth_ux', 'Oorva authentication and location', 'Existing OTP/location layouts retained', 'Oorva experience', 205],
    ['oorva_catalogue_ux', 'Oorva service discovery', 'Existing category/provider layouts retained', 'Oorva experience', 206],
    ['oorva_booking_ux', 'Oorva booking presentation', 'Existing booking/activity/receipt presentation retained', 'Oorva experience', 207],
    ['oorva_recurring_ux', 'Oorva recurring presentation', 'Existing plan/calendar presentation retained', 'Oorva experience', 208],
    ['oorva_shops_ux', 'Oorva shops presentation', 'Existing shops/products presentation retained', 'Oorva experience', 209],
    ['oorva_rfq_ux', 'Oorva enquiry and RFQ presentation', 'Existing RFQ/enquiry presentation retained', 'Oorva experience', 210],
    ['oorva_sports_ux', 'Oorva sports presentation', 'Existing sports presentation retained', 'Oorva experience', 211],
    ['oorva_creators_ux', 'Oorva creator presentation', 'Existing creator/proposal presentation retained', 'Oorva experience', 212],
    ['oorva_account_ux', 'Oorva account and rewards', 'Existing account/legal/rewards layouts retained', 'Oorva experience', 213],
    ['oorva_comms_ux', 'Oorva notifications and support', 'Existing notification/chat/support layouts retained', 'Oorva experience', 214],
    ['oorva_provider_ux', 'Oorva provider workspace', 'Existing owner/staff dashboard/job presentation retained', 'Oorva experience', 215],
    ['oorva_onboarding_ux', 'Oorva provider onboarding', 'Existing onboarding/edit presentation retained', 'Oorva experience', 216],
    ['oorva_merchant_shop_ux', 'Oorva shop workspace', 'Existing shop editor/enquiry presentation retained', 'Oorva experience', 217],
    ['oorva_business_staff_ux', 'Oorva business tools', 'Existing membership/invite/supplier workspace retained', 'Oorva experience', 218],
    ['oorva_venue_ops_ux', 'Oorva venue workspace', 'Existing venue-management presentation retained', 'Oorva experience', 219],
    ['oorva_admin_ops_ux', 'Oorva admin operations', 'Existing overview/review/support queue presentation retained', 'Oorva experience', 220],
    ['oorva_admin_config_ux', 'Oorva admin configuration', 'Existing configuration/catalogue presentation retained', 'Oorva experience', 221],
    ['oorva_admin_money_ux', 'Oorva admin financial views', 'Existing financial views/controls retained', 'Oorva experience', 222],
    ['oorva_ai_ux', 'Oorva AI presentation', 'Existing AI presentation retained; ai_assistant still controls capability', 'Oorva experience', 223],
    ['oorva_external_brand', 'Oorva outbound display identity', 'Existing outbound display identity; historical records never rewritten', 'Branding', 224],
  ];
  const rows = await db.query(
    `select key, enabled, label, description, group_name, sort_order
       from public.feature_flags
      where key = any($1::text[])
      order by sort_order`,
    [OORVA_KEYS],
  );
  const actualMetadata = rows.rows.map((row) => [
    row.key, row.label, row.description, row.group_name, row.sort_order,
  ]);
  check(
    JSON.stringify(actualMetadata) === JSON.stringify(expected)
      && rows.rows.every((row) => row.enabled === false),
    'all 25 Oorva registry entries match the OFF contract and exact sort order',
    { actualMetadata, enabled: rows.rows.map((row) => [row.key, row.enabled]), expected },
  );

  await db.query(`
    insert into public.app_config (key, value)
    values ('archetype_flags', '{"fixed":true,"inspect_quote":false,"future_kind":true}'::jsonb)
    on conflict (key) do update set value = excluded.value
  `);
  const legacyFlags = (await as(null, 'anon', `select public.get_app_features() as flags`))[0].flags;
  const snapshot = (await as(null, 'anon', `select public.get_app_branding_snapshot() as snapshot`))[0].snapshot;
  const snapshotJson = JSON.stringify(snapshot);
  check(
    JSON.stringify(snapshot.flags) === JSON.stringify(legacyFlags)
      && snapshot.flags.archetypes.future_kind === true
      && snapshot.generation === '0'
      && snapshot.publishedVersionId === null
      && snapshot.config === null,
    'public snapshot preserves the complete legacy flags/archetypes result independently of appearance',
    { snapshot, legacyFlags },
  );
  check(
    JSON.stringify(Object.keys(snapshot).sort()) === JSON.stringify(['config', 'flags', 'generation', 'publishedVersionId'])
      && !/(object_path|sha256|uploaded_by|revoked_at|actor_id|soft_policy)/i.test(snapshotJson),
    'anonymous snapshot contains no private asset, policy, or actor metadata',
    snapshot,
  );

  const bucket = await db.query(
    `select public, file_size_limit, allowed_mime_types
       from storage.buckets where id = 'branding-assets'`,
  );
  check(
    bucket.rows.length === 1
      && bucket.rows[0].public === false
      && Number(bucket.rows[0].file_size_limit) === 2097152
      && bucket.rows[0].allowed_mime_types.includes('image/png'),
    'branding-assets bucket is private and PNG-bounded',
    bucket.rows,
  );
});

await scenario('O03-effective-parent-role-and-direct-access', async () => {
  await ensureUser(ADMIN_ID, true);
  await ensureUser(NON_ADMIN_ID, false);

  await setFlags(OORVA_KEYS);
  const enabled = await db.query(
    `select key, public._oorva_feature_enabled(key) as effective
       from public.feature_flags where key = any($1::text[]) order by key`,
    [OORVA_KEYS],
  );
  check(enabled.rows.length === 25 && enabled.rows.every((row) => row.effective === true),
    'server parent graph enables every Oorva key when its complete ancestor path is ON', enabled.rows);

  await setFlags(OORVA_KEYS.filter((key) => key !== 'oorva_brand'));
  const rootOff = await db.query(
    `select key, public._oorva_feature_enabled(key) as effective
       from public.feature_flags where key = any($1::text[]) order by key`,
    [OORVA_KEYS],
  );
  check(rootOff.rows.every((row) => row.effective === false),
    'all Oorva children fail closed when the root brand flag is OFF, even when raw children are ON',
    { raw: OORVA_KEYS.filter((key) => key !== 'oorva_brand'), effective: rootOff.rows });

  await setFlags(['oorva_brand', 'branding_editor', 'oorva_home_ux']);
  const intermediateOff = await db.query(
    `select public._oorva_feature_enabled('branding_editor') as editor,
            public._oorva_feature_enabled('oorva_home_ux') as family`,
  );
  check(
    intermediateOff.rows[0].editor === false && intermediateOff.rows[0].family === true,
    'branding editor observes the OFF runtime intermediate while unrelated root children remain effective',
    intermediateOff.rows[0],
  );
  await setFlags(['oorva_brand', 'branding_runtime', 'oorva_home_ux']);
  const childOff = await db.query(
    `select public._oorva_feature_enabled('branding_editor') as editor,
            public._oorva_feature_enabled('oorva_home_ux') as family`,
  );
  check(
    childOff.rows[0].editor === false && childOff.rows[0].family === true,
    'an OFF child stays OFF beneath enabled ancestors',
    childOff.rows[0],
  );
  const unknown = await db.query(`select public._oorva_feature_enabled('future_branding_feature') as enabled`);
  check(unknown.rows[0].enabled === false, 'unknown server feature keys fail closed', unknown.rows[0]);

  const sampleConfig = config();
  await setFlags([]);
  await expectRejected(
    () => saveDraft(ADMIN_ID, sampleConfig, uuid(9001)),
    /branding writes are disabled/,
    'authorized admin cannot save a draft with all Oorva parent flags OFF',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select public.admin_set_branding_policy($1::jsonb)`, [JSON.stringify(defaultPolicy)]),
    /branding writes are disabled/,
    'authorized admin cannot change branding policy with all Oorva parent flags OFF',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select public.admin_publish_branding($1::uuid,$2::bigint,$3::text)`, [uuid(9001), 0, 'disabled']),
    /branding writes are disabled/,
    'authorized admin cannot publish with all Oorva parent flags OFF',
  );
  await setFlags(['branding_runtime', 'branding_editor']);
  await expectRejected(
    () => saveDraft(ADMIN_ID, sampleConfig, uuid(9002)),
    /branding writes are disabled/,
    'parent-OFF rejects a raw ON runtime/editor child combination',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select public.admin_set_branding_policy($1::jsonb)`, [JSON.stringify(defaultPolicy)]),
    /branding writes are disabled/,
    'parent-OFF also rejects ordinary policy writes',
  );
  await setFlags(['oorva_brand', 'branding_runtime']);
  await expectRejected(
    () => saveDraft(ADMIN_ID, sampleConfig, uuid(9003)),
    /branding writes are disabled/,
    'child-OFF rejects ordinary draft writes',
  );
  await setFlags(OORVA_KEYS);
  await expectRejected(
    () => saveDraft(NON_ADMIN_ID, sampleConfig, uuid(9004)),
    /admin only/,
    'authenticated non-admin cannot save a branding draft',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select public._branding_validate_policy($1::jsonb)`, ['{}']),
    /permission denied/,
    'authenticated admin cannot execute private validation helpers directly',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select public._oorva_feature_enabled($1::text)`, ['oorva_brand']),
    /permission denied/,
    'authenticated admin cannot execute the private server feature helper directly',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select public._branding_validate_config($1::jsonb, false)`, ['{}']),
    /permission denied/,
    'authenticated admin cannot execute the private config validator directly',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select public._branding_assets_publishable($1::jsonb, false)`, ['{}']),
    /permission denied/,
    'authenticated admin cannot execute the private asset validator directly',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select * from public.app_branding_versions`),
    /permission denied/,
    'authenticated admin cannot read immutable version rows directly',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `insert into public.app_branding_state (singleton) values (false)`),
    /permission denied|row-level security/,
    'authenticated admin cannot write singleton publication state directly',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `insert into public.app_branding_publications (generation, publication_kind, target_version_id, reason, actor_id) values (1, 'publish', $1::uuid, 'direct', $2::uuid)`, [uuid(9001), ADMIN_ID]),
    /permission denied|row-level security/,
    'authenticated admin cannot append publication history directly',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `insert into public.app_branding_assets (id, object_path, sha256, mime_type, byte_length, width, height, uploaded_by) values ($1::uuid, $2::text, $3::text, 'image/png', 100, 32, 32, $4::uuid)`, [uuid(9007), `branding/${uuid(9007)}.png`, 'b'.repeat(64), ADMIN_ID]),
    /permission denied|row-level security/,
    'authenticated admin cannot register private asset metadata directly',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select value from public.app_config where key = 'branding_policy'`),
    /permission denied|row-level security/,
    'authenticated admin cannot read private soft policy directly',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `update public.app_config set value = '{}'::jsonb where key = 'branding_policy'`),
    /permission denied|row-level security/,
    'authenticated admin must use the authorized policy RPC instead of direct app_config writes',
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `insert into storage.objects (id, bucket_id, name) values ($1::uuid, 'branding-assets', $2::text)`, [uuid(9008), `branding/${uuid(9008)}.png`]),
    /permission denied|row-level security/,
    'authenticated admin cannot write directly to the private branding bucket',
  );
  const privateObjectRead = await as(
    ADMIN_ID,
    'authenticated',
    `select name from storage.objects where bucket_id = 'branding-assets'`,
  );
  check(privateObjectRead.length === 0, 'authenticated storage policy denies direct branding object reads', privateObjectRead);

  const nonAdminCalls = [
    ['list', () => as(NON_ADMIN_ID, 'authenticated', `select * from public.admin_list_branding_versions()`) ],
    ['get', () => as(NON_ADMIN_ID, 'authenticated', `select public.admin_get_branding_version($1::uuid)`, [uuid(9001)])],
    ['save', () => saveDraft(NON_ADMIN_ID, sampleConfig, uuid(9005))],
    ['publish', () => as(NON_ADMIN_ID, 'authenticated', `select public.admin_publish_branding($1::uuid,$2::bigint,$3::text)`, [uuid(9001), 0, 'test'])],
    ['policy', () => as(NON_ADMIN_ID, 'authenticated', `select public.admin_set_branding_policy($1::jsonb)`, [JSON.stringify(defaultPolicy)])],
    ['rollback', () => as(NON_ADMIN_ID, 'authenticated', `select public.admin_rollback_branding($1::uuid,$2::bigint,$3::text)`, [uuid(9001), 0, 'test'])],
    ['revoke', () => as(NON_ADMIN_ID, 'authenticated', `select public.admin_revoke_branding_asset($1::uuid,$2::text)`, [uuid(9006), 'test'])],
  ];
  for (const [name, action] of nonAdminCalls) {
    await expectRejected(action, /admin only/, `non-admin role is rejected by admin ${name} RPC`);
  }
});

await scenario('O03-strict-draft-publication-and-policy-recovery', async () => {
  await ensureUser(ADMIN_ID, true);
  await setFlags(OORVA_KEYS);

  const valid = config();
  const invalidCases = [
    ['schemaVersion', { ...valid, schemaVersion: 2 }, /schemaVersion must be 1/],
    ['unknown root field', { ...valid, unexpected: true }, /unexpected is not allowed/],
    ['unknown color', { ...valid, light: { arbitrary: '#FFFFFF' } }, /not an allowed color token/],
    ['bad color', { ...valid, light: { primary: 'rgba(0,0,0,1)' } }, /six-digit hex color/],
    ['contrast', { ...valid, light: { primary: '#FFFFFF' } }, /contrast is .* minimum is 4.5:1/],
    ['unsafe text', { ...valid, displayName: 'https://example.invalid' }, /contains unsafe text/],
    ['unsupported bundled font', { ...valid, headingFont: 'manrope' }, /not bundled/],
    ['malformed asset id', { ...valid, assets: { ...valid.assets, logoLight: 'not-an-asset-id' } }, /must be null or an asset UUID/],
    ['missing registered asset', { ...valid, assets: { ...valid.assets, logoLight: uuid(9199) } }, /branding asset .* is missing/],
    ['soft promotion ceiling', { ...valid, assets: { ...valid.assets, promotional: Array.from({ length: 7 }, () => uuid(9100)) } }, /at most 6/],
    ['motion hard ceiling', { ...valid, motion: { launchDurationMs: 1801 } }, /integer from 0 to 1800/],
    ['hard serialized size ceiling', { ...valid, extra: 'x'.repeat(33000) }, /32 KiB hard limit/],
  ];
  for (const [label, invalid, expected] of invalidCases) {
    await expectRejected(
      () => saveDraft(ADMIN_ID, invalid, uuid(9200 + invalidCases.indexOf(invalid))),
      expected,
      `strict appearance validator rejects ${label}`,
    );
  }
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select public.admin_set_branding_policy($1::jsonb)`, [
      JSON.stringify({ ...defaultPolicy, maxUploadBytes: 2097153 }),
    ]),
    /maxUploadBytes must be from 1 to 2097152/,
    'policy validator rejects a value above the hard upload ceiling',
  );

  const v1 = uuid(9301);
  const save1 = await saveDraft(ADMIN_ID, valid, v1);
  check(save1[0].id === v1, 'authorized admin saves an immutable valid draft', save1);
  const publish1 = await as(
    ADMIN_ID,
    'authenticated',
    `select public.admin_publish_branding($1::uuid, $2::bigint, $3::text) as snapshot`,
    [v1, 0, 'Initial approved test publication'],
  );
  check(
    publish1[0].snapshot.generation === '1'
      && publish1[0].snapshot.publishedVersionId === v1
      && publish1[0].snapshot.config.displayName === 'Oorva',
    'publish atomically advances generation and returns the complete public snapshot',
    publish1[0].snapshot,
  );

  const v2 = uuid(9302);
  const save2 = await saveDraft(ADMIN_ID, config('Oorva Updated'), v2);
  check(save2[0].id === v2, 'second immutable version is created without updating the first', save2);
  const publish2 = await as(
    ADMIN_ID,
    'authenticated',
    `select public.admin_publish_branding($1::uuid, $2::bigint, $3::text) as snapshot`,
    [v2, 1, 'Second test publication'],
  );
  check(
    publish2[0].snapshot.generation === '2'
      && publish2[0].snapshot.publishedVersionId === v2,
    'second compare-and-swap publish increments rather than reuses the generation',
    publish2[0].snapshot,
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select public.admin_publish_branding($1::uuid,$2::bigint,$3::text)`, [v1, 1, 'stale']),
    /stale branding generation/,
    'stale expected generation is rejected',
  );

  const history = await as(ADMIN_ID, 'authenticated', `select * from public.admin_list_branding_versions()`);
  const details = await as(ADMIN_ID, 'authenticated', `select public.admin_get_branding_version($1::uuid) as version`, [v1]);
  check(
    history.length === 2
      && history.some((row) => row.id === v1 && row.published)
      && details[0].version.config.displayName === 'Oorva',
    'authorized history and version detail expose immutable admin recovery data',
    { history, details: details[0].version },
  );
  check(
    (await db.query(
      `select count(*)::int as count from public.app_branding_versions where id in ($1::uuid,$2::uuid)`,
      [v1, v2],
    )).rows[0].count === 2,
    'both saved versions remain present after subsequent publication',
    { v1, v2 },
  );
});

await scenario('O03-assets-revocation-recovery-and-money-safety', async () => {
  await ensureUser(ADMIN_ID, true);
  await setFlags(OORVA_KEYS);
  const assetId = uuid(9401);
  const objectPath = `branding/${assetId}.png`;
  await db.query(
    `insert into storage.objects (id, bucket_id, name) values ($1::uuid, 'branding-assets', $2::text)`,
    [uuid(9402), objectPath],
  );
  await db.query(
    `insert into public.app_branding_assets (
       id, object_path, sha256, mime_type, byte_length, width, height, uploaded_by, validated_at
     ) values ($1::uuid, $2::text, $3::text, 'image/png', 1024, 128, 128, $4::uuid, now())`,
    [assetId, objectPath, 'a'.repeat(64), ADMIN_ID],
  );
  const assetVersion = uuid(9403);
  const assetConfig = config('Oorva Asset', { logoLight: assetId });
  await saveDraft(ADMIN_ID, assetConfig, assetVersion);
  const publishedAsset = await as(
    ADMIN_ID,
    'authenticated',
    `select public.admin_publish_branding($1::uuid,$2::bigint,$3::text) as snapshot`,
    [assetVersion, 2, 'Asset publication test'],
  );
  check(
    publishedAsset[0].snapshot.generation === '3'
      && publishedAsset[0].snapshot.config.assets.logoLight === assetId,
    'published snapshot references only the registered immutable asset UUID',
    publishedAsset[0].snapshot,
  );
  const assetMetadata = await db.query(
    `select published_once, revoked_at from public.app_branding_assets where id = $1::uuid`,
    [assetId],
  );
  check(
    assetMetadata.rows[0]?.published_once === true
      && assetMetadata.rows[0]?.revoked_at === null,
    'publication marks its validated asset as ever public without exposing private metadata',
    assetMetadata.rows,
  );
  check(
    !/(object_path|sha256|uploaded_by|validated_at|revoked_at)/i.test(JSON.stringify(publishedAsset[0].snapshot)),
    'public snapshot does not contain private asset path, hash, uploader, or validation fields',
    publishedAsset[0].snapshot,
  );
  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select public.admin_revoke_branding_asset($1::uuid,$2::text)`, [assetId, 'unsafe current image']),
    /recover the current appearance or disable branding_runtime/,
    'current published asset cannot be revoked while runtime appearance is effective',
  );

  const tightenedPolicy = {
    ...defaultPolicy,
    maxUploadBytes: 1024,
    maxPromotions: 0,
    maxDisplayNameLength: 2,
    maxTaglineLength: 0,
  };
  const policyResult = await as(
    ADMIN_ID,
    'authenticated',
    `select public.admin_set_branding_policy($1::jsonb) as policy`,
    [JSON.stringify(tightenedPolicy)],
  );
  check(
    policyResult[0].policy.revision === 2
      && policyResult[0].policy.maxDisplayNameLength === 2,
    'admin policy updates are validated, revisioned and audited',
    policyResult[0].policy,
  );
  await expectRejected(
    () => saveDraft(ADMIN_ID, config('Oorva Too Long'), uuid(9404)),
    /displayName exceeds the current soft limit/,
    'new draft is rejected by tightened soft name limit',
  );

  await setFlags(['oorva_brand']);
  const revoked = await as(
    ADMIN_ID,
    'authenticated',
    `select public.admin_revoke_branding_asset($1::uuid,$2::text) as result`,
    [assetId, 'Disable the active runtime before retiring asset'],
  );
  check(
    revoked[0].result.revoked === true
      && revoked[0].result.generation === '3',
    'audited asset revocation remains available with runtime and editor effectively OFF',
    revoked[0].result,
  );
  const revokedRow = await db.query(
    `select revoked_at is not null as revoked, revoked_by = $2::uuid as actor_ok,
            revoke_reason
       from public.app_branding_assets where id = $1::uuid`,
    [assetId, ADMIN_ID],
  );
  check(
    revokedRow.rows[0]?.revoked === true
      && revokedRow.rows[0]?.actor_ok === true
      && revokedRow.rows[0]?.revoke_reason === 'Disable the active runtime before retiring asset',
    'revocation is a reasoned actor-attributed tombstone',
    revokedRow.rows,
  );
  const historyWhenOff = await as(ADMIN_ID, 'authenticated', `select * from public.admin_list_branding_versions()`);
  const versionWhenOff = await as(ADMIN_ID, 'authenticated', `select public.admin_get_branding_version($1::uuid) as version`, [assetVersion]);
  check(
    historyWhenOff.length === 3 && versionWhenOff[0].version.config.displayName === 'Oorva Asset',
    'audited history remains readable to admins with branding editor/runtime OFF',
    { count: historyWhenOff.length, version: versionWhenOff[0].version },
  );

  await expectRejected(
    () => as(ADMIN_ID, 'authenticated', `select public.admin_rollback_branding($1::uuid,$2::bigint,$3::text)`, [assetVersion, 3, 'revoked rollback']),
    /revoked/,
    'recovery never republishes a revoked asset despite bypassing soft policy',
  );
  const flagsBeforeRecovery = (await as(
    ADMIN_ID,
    'authenticated',
    `select public.get_app_features() as flags`,
  ))[0].flags;
  const recovered = await as(
    ADMIN_ID,
    'authenticated',
    `select public.admin_rollback_branding($1::uuid,$2::bigint,$3::text) as snapshot`,
    [uuid(9301), 3, 'Recover previously published bundled-only version'],
  );
  check(
    recovered[0].snapshot.generation === '4'
      && recovered[0].snapshot.publishedVersionId === uuid(9301)
      && recovered[0].snapshot.config.displayName === 'Oorva',
    'recovery ignores tighter soft limits but keeps supported immutable content and advances generation',
    recovered[0].snapshot,
  );
  check(
    OORVA_KEYS.every((key) => flagsBeforeRecovery[key] === recovered[0].snapshot.flags[key]),
    'branding rollback preserves every feature flag without enabling or disabling any',
    {
      before: Object.fromEntries(OORVA_KEYS.map((key) => [key, flagsBeforeRecovery[key]])),
      after: Object.fromEntries(OORVA_KEYS.map((key) => [key, recovered[0].snapshot.flags[key]])),
    },
  );

  const moneyGates = await db.query(`
    select p.proname
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname ~* '(payment|refund|payout|settlement|expire|cancel|recurr)'
       and p.prosrc ~* '(oorva_brand|branding_runtime|branding_editor|app_branding_assets|app_branding_state)'
     order by p.proname
  `);
  check(
    moneyGates.rows.length === 0,
    'existing payment/refund/payout/expiry/cancellation routines have no Oorva appearance gate',
    moneyGates.rows,
  );
});

await scenario('O03-asset-status-service-role-only-works-with-flags-off', async () => {
  const uploadedBy = uuid(9510);
  const activeAssetId = uuid(9511);
  const revokedAssetId = uuid(9512);
  const missingAssetId = uuid(9513);
  const previousFlags = (await db.query(
    `select key, enabled
       from public.feature_flags
      where key = any($1::text[])
      order by key`,
    [OORVA_KEYS],
  )).rows;
  check(
    previousFlags.length === OORVA_KEYS.length,
    'asset-status fixture can snapshot all O03 flag values',
    previousFlags,
  );

  try {
    await ensureUser(uploadedBy);
    await db.query(
      `insert into public.app_branding_assets (
         id, object_path, sha256, mime_type, byte_length, width, height,
         uploaded_by, validated_at, published_once
       ) values (
         $1::uuid, $2::text, $3::text, 'image/png', $4::bigint, $5::integer, $6::integer,
         $7::uuid, now(), true
       )`,
      [activeAssetId, `branding/${activeAssetId}.png`, 'a'.repeat(64), 256, 64, 64, uploadedBy],
    );
    await db.query(
      `insert into public.app_branding_assets (
         id, object_path, sha256, mime_type, byte_length, width, height,
         uploaded_by, validated_at, published_once, revoked_at, revoked_by, revoke_reason
       ) values (
         $1::uuid, $2::text, $3::text, 'image/png', $4::bigint, $5::integer, $6::integer,
         $7::uuid, now(), true, now(), $7::uuid, $8::text
       )`,
      [revokedAssetId, `branding/${revokedAssetId}.png`, 'b'.repeat(64), 512, 64, 64, uploadedBy, 'status fixture'],
    );

    await setFlags([]);
    const effectiveStatusFlags = await db.query(
      `select key, public._oorva_feature_enabled(key) as effective
         from public.feature_flags
        where key = any($1::text[])
        order by key`,
      [STATUS_FLAGS],
    );
    check(
      effectiveStatusFlags.rows.length === STATUS_FLAGS.length
        && effectiveStatusFlags.rows.every((row) => row.effective === false),
      'branding status is queried with every effective O03 flag OFF',
      effectiveStatusFlags.rows,
    );

    const privileges = await db.query(`
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
    check(
      JSON.stringify(privileges.rows[0]) === JSON.stringify({
        service_execute: true,
        anon_execute: false,
        authenticated_execute: false,
        service_table_select: false,
        anon_table_select: false,
        authenticated_table_select: false,
      }),
      'only service_role may execute status RPC and no role receives direct table SELECT',
      privileges.rows,
    );

    const activeStatus = await as(
      '',
      'service_role',
      `select * from public.service_get_branding_asset_status($1::uuid)`,
      [activeAssetId],
    );
    check(
      activeStatus.length === 1
        && activeStatus[0].id === activeAssetId
        && activeStatus[0].object_path === `branding/${activeAssetId}.png`
        && activeStatus[0].sha256 === 'a'.repeat(64)
        && activeStatus[0].mime_type === 'image/png'
        && Number(activeStatus[0].byte_length) === 256
        && activeStatus[0].width === 64
        && activeStatus[0].height === 64
        && Boolean(activeStatus[0].validated_at)
        && activeStatus[0].published_once === true
        && activeStatus[0].revoked_at === null,
      'service status resolves a published asset while all O03 flags are OFF',
      activeStatus,
    );
    check(
      JSON.stringify(Object.keys(activeStatus[0] ?? {}).sort()) === JSON.stringify([...ASSET_STATUS_FIELDS].sort()),
      'asset status exposes only the safe O04 fields and no uploader or revocation actor',
      { keys: Object.keys(activeStatus[0] ?? {}).sort(), row: activeStatus },
    );

    const revokedStatus = await as(
      '',
      'service_role',
      `select * from public.service_get_branding_asset_status($1::uuid)`,
      [revokedAssetId],
    );
    check(
      revokedStatus.length === 1
        && revokedStatus[0].id === revokedAssetId
        && revokedStatus[0].published_once === true
        && Boolean(revokedStatus[0].revoked_at),
      'service status returns revocation state without returning its actor or reason',
      revokedStatus,
    );
    const missingStatus = await as(
      '',
      'service_role',
      `select * from public.service_get_branding_asset_status($1::uuid)`,
      [missingAssetId],
    );
    check(
      missingStatus.length === 0,
      'unknown asset IDs return no status row',
      { missingAssetId, rows: missingStatus },
    );

    for (const role of ['anon', 'authenticated']) {
      await expectRejected(
        () => as('', role, `select * from public.service_get_branding_asset_status($1::uuid)`, [activeAssetId]),
        /permission denied/,
        `${role} cannot execute the service asset-status RPC`,
      );
      await expectRejected(
        () => as('', role, `select id from public.app_branding_assets where id = $1::uuid`, [activeAssetId]),
        /permission denied/,
        `${role} cannot directly read asset metadata`,
      );
    }
    await expectRejected(
      () => as('', 'service_role', `select id from public.app_branding_assets where id = $1::uuid`, [activeAssetId]),
      /permission denied/,
      'service_role cannot directly read asset metadata',
    );
  } finally {
    for (const flag of previousFlags) {
      await db.query(
        `update public.feature_flags set enabled = $2::boolean where key = $1::text`,
        [flag.key, flag.enabled],
      );
    }
    await db.query(
      `delete from public.app_branding_assets where id = any($1::uuid[])`,
      [[activeAssetId, revokedAssetId]],
    );
    await db.query(
      `delete from auth.users where id = $1::uuid`,
      [uploadedBy],
    );
  }
});

await scenario('O03-asset-status-service-role-only-works-with-flags-off', async () => {
  const uploadedBy = uuid(9510);
  const activeAssetId = uuid(9511);
  const revokedAssetId = uuid(9512);
  const missingAssetId = uuid(9513);
  const previousFlags = (await db.query(
    `select key, enabled
       from public.feature_flags
      where key = any($1::text[])
      order by key`,
    [OORVA_KEYS],
  )).rows;
  check(
    previousFlags.length === OORVA_KEYS.length,
    'asset-status fixture can snapshot all O03 flag values',
    previousFlags,
  );

  try {
    await ensureUser(uploadedBy);
    await db.query(
      `insert into public.app_branding_assets (
         id, object_path, sha256, mime_type, byte_length, width, height,
         uploaded_by, validated_at, published_once
       ) values (
         $1::uuid, $2::text, $3::text, 'image/png', $4::bigint, $5::integer, $6::integer,
         $7::uuid, now(), true
       )`,
      [activeAssetId, `branding/${activeAssetId}.png`, 'a'.repeat(64), 256, 64, 64, uploadedBy],
    );
    await db.query(
      `insert into public.app_branding_assets (
         id, object_path, sha256, mime_type, byte_length, width, height,
         uploaded_by, validated_at, published_once, revoked_at, revoked_by, revoke_reason
       ) values (
         $1::uuid, $2::text, $3::text, 'image/png', $4::bigint, $5::integer, $6::integer,
         $7::uuid, now(), true, now(), $7::uuid, $8::text
       )`,
      [revokedAssetId, `branding/${revokedAssetId}.png`, 'b'.repeat(64), 512, 64, 64, uploadedBy, 'status fixture'],
    );

    await setFlags([]);
    const effectiveStatusFlags = await db.query(
      `select key, public._oorva_feature_enabled(key) as effective
         from public.feature_flags
        where key = any($1::text[])
        order by key`,
      [ASSET_STATUS_FLAGS],
    );
    check(
      effectiveStatusFlags.rows.length === ASSET_STATUS_FLAGS.length
        && effectiveStatusFlags.rows.every((row) => row.effective === false),
      'branding status is queried with every effective O03 flag OFF',
      effectiveStatusFlags.rows,
    );

    const privileges = await db.query(`
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
    check(
      JSON.stringify(privileges.rows[0]) === JSON.stringify({
        service_execute: true,
        anon_execute: false,
        authenticated_execute: false,
        service_table_select: false,
        anon_table_select: false,
        authenticated_table_select: false,
      }),
      'only service_role may execute status RPC and no role receives direct table SELECT',
      privileges.rows,
    );

    const activeStatus = await as(
      '',
      'service_role',
      `select * from public.service_get_branding_asset_status($1::uuid)`,
      [activeAssetId],
    );
    check(
      activeStatus.length === 1
        && activeStatus[0].id === activeAssetId
        && activeStatus[0].object_path === `branding/${activeAssetId}.png`
        && activeStatus[0].sha256 === 'a'.repeat(64)
        && activeStatus[0].mime_type === 'image/png'
        && Number(activeStatus[0].byte_length) === 256
        && activeStatus[0].width === 64
        && activeStatus[0].height === 64
        && Boolean(activeStatus[0].validated_at)
        && activeStatus[0].published_once === true
        && activeStatus[0].revoked_at === null,
      'service status resolves a published asset while all O03 flags are OFF',
      activeStatus,
    );
    check(
      JSON.stringify(Object.keys(activeStatus[0] ?? {}).sort()) === JSON.stringify([...ASSET_STATUS_FIELDS].sort()),
      'asset status exposes only the safe O04 fields and no uploader or revocation actor',
      { keys: Object.keys(activeStatus[0] ?? {}).sort(), row: activeStatus },
    );

    const revokedStatus = await as(
      '',
      'service_role',
      `select * from public.service_get_branding_asset_status($1::uuid)`,
      [revokedAssetId],
    );
    check(
      revokedStatus.length === 1
        && revokedStatus[0].id === revokedAssetId
        && revokedStatus[0].published_once === true
        && Boolean(revokedStatus[0].revoked_at),
      'service status returns revocation state without returning its actor or reason',
      revokedStatus,
    );
    const missingStatus = await as(
      '',
      'service_role',
      `select * from public.service_get_branding_asset_status($1::uuid)`,
      [missingAssetId],
    );
    check(
      missingStatus.length === 0,
      'unknown asset IDs return no status row',
      { missingAssetId, rows: missingStatus },
    );

    for (const role of ['anon', 'authenticated']) {
      await expectRejected(
        () => as('', role, `select * from public.service_get_branding_asset_status($1::uuid)`, [activeAssetId]),
        /permission denied/,
        `${role} cannot execute the service asset-status RPC`,
      );
      await expectRejected(
        () => as('', role, `select id from public.app_branding_assets where id = $1::uuid`, [activeAssetId]),
        /permission denied/,
        `${role} cannot directly read asset metadata`,
      );
    }
    await expectRejected(
      () => as('', 'service_role', `select id from public.app_branding_assets where id = $1::uuid`, [activeAssetId]),
      /permission denied/,
      'service_role cannot directly read asset metadata',
    );
  } finally {
    for (const flag of previousFlags) {
      await db.query(
        `update public.feature_flags set enabled = $2::boolean where key = $1::text`,
        [flag.key, flag.enabled],
      );
    }
    await db.query(
      `delete from public.app_branding_assets where id = any($1::uuid[])`,
      [[activeAssetId, revokedAssetId]],
    );
    await db.query(`delete from auth.users where id = $1::uuid`, [uploadedBy]);
  }
});

finish();

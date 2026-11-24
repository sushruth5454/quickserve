import React from 'react';
import validAppearance from '../../../branding/fixtures/appearance-valid.json';
import {
  areDraftsEqual,
  defaultBrandingDraft,
  isBrandingEditorEnabled,
  isBrandingSettingsVisible,
  isPreviewUrlFresh,
  parseSignedAssetPreview,
  PREVIEW_URL_TTL_MS,
  validateBrandingDraft,
} from '../model';

const mockDom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockFocusCallbacks = new Set<() => void>();
const mockInputChanges = new Map<string, (value: string) => void>();
const mockRouter = { push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockGetAppFeatures = jest.fn();
const mockListFeatures = jest.fn();
const mockRefreshFlags = jest.fn();
const mockUseFeatureControlState = jest.fn();
const mockUseAppFeatureFlags = jest.fn();
const mockUseTheme = jest.fn();
let mockSearchParams: Record<string, string> = {};
let mockFlags: Record<string, unknown> = {};
let mockVersions: Array<Record<string, unknown>> = [];
let mockSnapshot: Record<string, unknown> = {};
let mockVersionConfigs: Record<string, unknown> = {};
let mockUnauthorized = false;
let mockPublishConflict = false;
let mockRoot: TestRoot | undefined;

const VERSION_ONE = '00000000-0000-4000-8000-000000000001';
const VERSION_TWO = '00000000-0000-4000-8000-000000000002';
const SUPABASE_URL = 'https://quickserve.example.test';
const initialAppearance = JSON.parse(JSON.stringify(validAppearance)) as Record<string, unknown>;

const mockReact = require('react') as typeof React;
const mockAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;

jest.doMock('expo-router', () => ({
  router: mockRouter,
  useLocalSearchParams: () => mockSearchParams,
  useFocusEffect(callback: () => void | (() => void)) {
    const callbackRef = mockReact.useRef(callback);
    callbackRef.current = callback;
    mockReact.useEffect(() => {
      const focus = () => {
        const cleanup = callbackRef.current();
        if (typeof cleanup === 'function') cleanup();
      };
      mockFocusCallbacks.add(focus);
      focus();
      return () => mockFocusCallbacks.delete(focus);
    }, []);
  },
}));

jest.doMock('react-native', () => ({
  View: 'div',
  Text: 'span',
  Switch: 'input',
  Pressable: ({ children, accessibilityLabel }: { children: React.ReactNode; accessibilityLabel?: string }) =>
    mockReact.createElement('button', { 'aria-label': accessibilityLabel }, children),
}));
jest.doMock('expo-image', () => ({ Image: 'img' }));
jest.doMock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}));
jest.doMock('expo-image-manipulator', () => ({
  SaveFormat: { PNG: 'png' },
  manipulateAsync: jest.fn(),
}));

jest.doMock('../../../components/ui', () => ({
  Button: ({ title, onPress, disabled, loading, accessibilityLabel }: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
    loading?: boolean;
    accessibilityLabel?: string;
  }) => mockReact.createElement('button', {
    type: 'button',
    'aria-label': accessibilityLabel ?? title,
    disabled: disabled || loading,
    onClick: onPress,
  }, title),
  Card: ({ children, onPress, accessibilityLabel }: {
    children: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) => onPress
    ? mockReact.createElement('button', { type: 'button', 'aria-label': accessibilityLabel, onClick: onPress }, children)
    : mockReact.createElement('section', null, children),
  Header: ({ title, subtitle }: { title: string; subtitle?: string }) =>
    mockReact.createElement('header', null, title, subtitle),
  InlineAlert: ({ message }: { message: string }) =>
    mockReact.createElement('div', { role: 'alert' }, message),
  Input: ({ label, value, onChangeText, editable = true, placeholder }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    editable?: boolean;
    placeholder?: string;
  }) => {
    mockInputChanges.set(label, onChangeText);
    return mockReact.createElement('label', null, label,
      mockReact.createElement('input', {
        'aria-label': label,
        value,
        placeholder,
        disabled: !editable,
        onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
      }));
  },
  ListItem: ({ title, onPress }: { title: string; onPress?: () => void }) =>
    mockReact.createElement('button', { type: 'button', 'aria-label': title, onClick: onPress }, title),
  Screen: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) =>
    mockReact.createElement('main', null, header, children),
  Skeleton: () => mockReact.createElement('div', null, 'Loading'),
  Text: ({ children }: { children: React.ReactNode }) => mockReact.createElement('span', null, children),
  TextArea: ({ label, value, onChangeText, editable = true }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    editable?: boolean;
  }) => {
    mockInputChanges.set(label, onChangeText);
    return mockReact.createElement('label', null, label,
      mockReact.createElement('textarea', { 'aria-label': label, value, disabled: !editable }));
  },
}));

jest.doMock('../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => mockUseAppFeatureFlags(),
}));
jest.doMock('../../../branding/FeatureFlagsProvider', () => ({
  useFeatureControlState: () => mockUseFeatureControlState(),
}));
jest.doMock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.doMock('../../../lib/adminApi', () => ({
  getAppFeatures: (...args: unknown[]) => mockGetAppFeatures(...args),
  listFeatures: (...args: unknown[]) => mockListFeatures(...args),
  setFeature: jest.fn(),
}));
jest.doMock('../../../lib/adminFeaturePresentation', () => ({
  getAdminFeaturePresentation: () => ({
    indentLevel: 0,
    disabledByParent: false,
    switchDisabledByParent: false,
    explanation: null,
  }),
}));
jest.doMock('../../../theme', () => ({
  useTheme: () => mockUseTheme(),
}));

const { default: BrandingScreen } = require('../BrandingScreen') as {
  default: React.ComponentType;
};
const { default: SettingsScreen } = require('../SettingsScreen') as {
  default: React.ComponentType;
};
const { BrandingPreview } = require('../BrandingPreview') as {
  BrandingPreview: React.ComponentType<{ config: typeof validAppearance; getAssetPreview: (id: string) => string | null }>;
};
const { default: AdminFeaturesScreen } = require('../../communicationScreens/AdminFeaturesScreen') as {
  default: React.ComponentType;
};

type TestRoot = {
  render: (element: React.ReactElement) => void;
  unmount: () => void;
};

function makeSnapshot(flags = mockFlags, generation = '7', config: unknown = initialAppearance) {
  return {
    generation,
    publishedVersionId: VERSION_TWO,
    config,
    flags,
  };
}

function makeVersions() {
  return [
    { id: VERSION_TWO, version_number: '2', created_at: '2026-11-20T12:00:00.000Z', published: true, is_current: true },
    { id: VERSION_ONE, version_number: '1', created_at: '2026-11-19T12:00:00.000Z', published: true, is_current: false },
  ];
}

function resetServerState() {
  mockFlags = { oorva_brand: true, branding_runtime: true, branding_editor: true, oorva_admin_ops_ux: false };
  mockVersions = makeVersions();
  mockSnapshot = makeSnapshot();
  mockVersionConfigs = {
    [VERSION_ONE]: { config: initialAppearance },
    [VERSION_TWO]: { config: initialAppearance },
  };
  mockUnauthorized = false;
  mockPublishConflict = false;
  mockSearchParams = {};
  mockRpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown> = {}) => {
    if (name === 'admin_list_branding_versions') {
      if (mockUnauthorized) return { data: null, error: { code: '42501', message: 'admin only' } };
      return { data: mockVersions, error: null };
    }
    if (name === 'get_app_branding_snapshot') return { data: mockSnapshot, error: null };
    if (name === 'admin_get_branding_version') {
      return { data: mockVersionConfigs[String(args.p_version_id)], error: null };
    }
    if (name === 'admin_save_branding_draft') {
      const id = String(args.p_version_id);
      mockVersionConfigs[id] = { config: args.p_config };
      mockVersions.unshift({
        id,
        version_number: String(mockVersions.reduce((max, row) => Math.max(max, Number(row.version_number)), 0) + 1),
        created_at: '2026-11-24T00:00:00.000Z',
        published: false,
        is_current: false,
      });
      return { data: id, error: null };
    }
    if (name === 'admin_publish_branding') {
      if (mockPublishConflict) return { data: null, error: { code: '40001', message: 'stale branding generation' } };
      const id = String(args.p_version_id);
      mockVersions = mockVersions.map((row) => ({
        ...row,
        is_current: row.id === id,
        published: row.published === true || row.id === id,
      }));
      mockSnapshot = makeSnapshot(mockFlags, String(Number(mockSnapshot.generation) + 1), mockVersionConfigs[id]?.config);
      mockSnapshot.publishedVersionId = id;
      return { data: mockSnapshot, error: null };
    }
    if (name === 'admin_rollback_branding') {
      const id = String(args.p_version_id);
      mockVersions = mockVersions.map((row) => ({ ...row, is_current: row.id === id }));
      mockSnapshot = makeSnapshot(mockFlags, String(Number(mockSnapshot.generation) + 1), mockVersionConfigs[id]?.config);
      mockSnapshot.publishedVersionId = id;
      return { data: mockSnapshot, error: null };
    }
    return { data: null, error: { code: '42883', message: `unexpected RPC ${String(name)}` } };
  });
  mockInvoke.mockReset().mockResolvedValue({ data: null, error: null });
  mockGetAppFeatures.mockReset().mockResolvedValue({ archetypes: {} });
  mockListFeatures.mockReset().mockResolvedValue([]);
  mockRefreshFlags.mockReset().mockResolvedValue(undefined);
  mockUseFeatureControlState.mockReset().mockImplementation(() => ({ features: mockFlags, refresh: mockRefreshFlags }));
  mockUseAppFeatureFlags.mockReset().mockImplementation(() => mockFlags);
  mockUseTheme.mockReset().mockReturnValue({ spacing: { sm: 8, md: 12, lg: 16 }, radii: { lg: 12 } });
  mockInputChanges.clear();
  mockFocusCallbacks.clear();
  mockRouter.push.mockReset();
  mockRouter.back.mockReset();
}

async function flushMicrotasks() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

async function mount<Props>(Component: React.ComponentType<Props>, props?: Props) {
  await mockAct(async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mockRoot = require('react-dom/client').createRoot(container) as TestRoot;
    mockRoot.render(React.createElement(Component, props));
    await flushMicrotasks();
  });
}

async function unmount() {
  if (!mockRoot) return;
  await mockAct(async () => {
    mockRoot?.unmount();
    await flushMicrotasks();
  });
  mockRoot = undefined;
  document.body.innerHTML = '';
  mockInputChanges.clear();
  mockFocusCallbacks.clear();
}

async function changeInput(label: string, value: string) {
  const change = mockInputChanges.get(label);
  expect(change).toBeDefined();
  await mockAct(() => change?.(value));
}

function inputValue(label: string): string | undefined {
  return document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)?.value;
}

async function press(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  await mockAct(async () => {
    button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flushMicrotasks();
  });
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues: <T extends ArrayBufferView>(array: T): T => {
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(1);
        return array;
      },
    },
  });
  resetServerState();
});

afterEach(async () => {
  await unmount();
});

describe('canonical O10 admin branding stage', () => {
  it('ADMIN-B01 links existing settings and exposes Branding only under its two capability parents', async () => {
    mockFlags = { oorva_brand: true, branding_runtime: true, branding_editor: false, oorva_admin_ops_ux: false };
    await mount(SettingsScreen);

    expect(document.body.textContent).toContain('Booking rules');
    expect(document.body.textContent).toContain('Commission');
    expect(document.body.textContent).toContain('Services');
    expect(document.body.textContent).toContain('Feature controls');
    expect(document.body.textContent).toContain('Branding & appearance');
    await press('Branding & appearance');
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/settings/branding');

    await unmount();
    mockFlags = { oorva_brand: true, branding_runtime: false, branding_editor: true, oorva_admin_ops_ux: true };
    await mount(SettingsScreen);
    expect(document.body.textContent).not.toContain('Branding & appearance');
    expect(isBrandingSettingsVisible(mockFlags)).toBe(false);
    expect(isBrandingEditorEnabled(mockFlags)).toBe(false);
    expect(isBrandingSettingsVisible({ oorva_brand: false, branding_runtime: true })).toBe(false);
    expect(isBrandingEditorEnabled({ oorva_brand: false, branding_runtime: true, branding_editor: true })).toBe(false);
    expect(isBrandingSettingsVisible({})).toBe(false);
    expect(isBrandingEditorEnabled({})).toBe(false);
  });

  it('ADMIN-B02 fails closed for unauthorized history reads and performs no writes', async () => {
    mockUnauthorized = true;
    await mount(BrandingScreen);

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('admin only');
    expect(mockRpc.mock.calls.map(([name]) => name)).toContain('admin_list_branding_versions');
    expect(mockRpc.mock.calls.some(([name]) => String(name).startsWith('admin_save_'))).toBe(false);
    expect(mockRpc.mock.calls.some(([name]) => String(name).startsWith('admin_publish_'))).toBe(false);
  });

  it('ADMIN-B03 keeps history and expected-generation recovery available with a parent off, including its Features entry', async () => {
    mockFlags = { oorva_brand: true, branding_runtime: false, branding_editor: true, oorva_admin_ops_ux: false };
    const configWithAsset = JSON.parse(JSON.stringify(initialAppearance)) as Record<string, unknown>;
    (configWithAsset.assets as Record<string, unknown>).logoLight = VERSION_ONE;
    mockSnapshot = makeSnapshot(mockFlags, '7', configWithAsset);
    mockSearchParams = { section: 'history' };
    await mount(BrandingScreen);

    expect(document.body.textContent).toContain('Published history & recovery');
    expect(document.body.textContent).toContain('Current published appearance');
    expect(document.body.textContent).toContain('Oorva');
    expect(document.body.textContent).toContain('Branding writes are off');
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Upload Light horizontal logo"]')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Publish saved draft"]')?.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Display name"]')?.disabled).toBe(false);
    await changeInput('Display name', 'Local-only edit while off');
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Save immutable draft"]')?.disabled).toBe(true);
    await press('Clear');
    expect(document.body.textContent).not.toContain(`Registered asset · ${VERSION_ONE}`);
    await changeInput('Recovery reason', 'Restore the last approved appearance');
    await press('Recover version 1');
    expect(mockRpc).toHaveBeenCalledWith('admin_rollback_branding', {
      p_version_id: VERSION_ONE,
      p_expected_generation: '7',
      p_reason: 'Restore the last approved appearance',
    });

    await unmount();
    await mount(AdminFeaturesScreen);
    await press('Branding history and recovery');
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/settings/branding?section=history');
  });

  it('ADMIN-B04 saves a new immutable version and publishes with the reviewed generation', async () => {
    await mount(BrandingScreen);
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Upload Light horizontal logo"]')?.disabled).toBe(false);
    await changeInput('Display name', 'Oorva Studio');
    await press('Save immutable draft');

    const saveCall = mockRpc.mock.calls.find(([name]) => name === 'admin_save_branding_draft');
    expect(saveCall).toBeDefined();
    const saveArgs = saveCall?.[1] as Record<string, unknown>;
    expect(saveArgs.p_config).toMatchObject({ displayName: 'Oorva Studio', schemaVersion: 1 });
    expect(typeof saveArgs.p_version_id).toBe('string');
    expect(document.body.textContent).toContain('Immutable draft saved');

    await changeInput('Publish reason', 'Approved brand update');
    await press('Publish saved draft');
    expect(mockRpc).toHaveBeenCalledWith('admin_publish_branding', {
      p_version_id: saveArgs.p_version_id,
      p_expected_generation: '7',
      p_reason: 'Approved brand update',
    });
  });

  it('ADMIN-B05 retains edits and stops after an expected-generation conflict', async () => {
    await mount(BrandingScreen);
    await changeInput('Display name', 'Conflict-safe draft');
    await press('Save immutable draft');
    await changeInput('Publish reason', 'Publish if current');
    mockPublishConflict = true;
    await press('Publish saved draft');

    expect(document.body.textContent).toContain('Another admin published first');
    expect(inputValue('Display name')).toBe('Conflict-safe draft');
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Publish saved draft"]')?.disabled).toBe(true);
    expect(mockRpc.mock.calls.filter(([name]) => name === 'admin_publish_branding')).toHaveLength(1);
  });

  it('ADMIN-B06 preserves dirty form fields when focus refresh reports newer server state', async () => {
    await mount(BrandingScreen);
    await changeInput('Display name', 'Unsaved local draft');
    const nextConfig = { ...(initialAppearance as Record<string, unknown>), displayName: 'Another admin version' };
    mockSnapshot = makeSnapshot(mockFlags, '8', nextConfig);
    await mockAct(async () => {
      for (const focus of [...mockFocusCallbacks]) focus();
      await flushMicrotasks();
    });

    expect(inputValue('Display name')).toBe('Unsaved local draft');
    expect(document.body.textContent).toContain('generation 8');
  });

  it('ADMIN-B07 previews a nested draft without changing global flags, cache, theme or RPC state', async () => {
    const config = JSON.parse(JSON.stringify(validAppearance)) as typeof validAppearance;
    const before = JSON.stringify(config);
    const assetPreview = jest.fn(() => null);
    const flagsCalls = mockUseAppFeatureFlags.mock.calls.length;
    const themeCalls = mockUseTheme.mock.calls.length;
    const rpcCalls = mockRpc.mock.calls.length;
    const invokeCalls = mockInvoke.mock.calls.length;

    await mount(BrandingPreview, { config, getAssetPreview: assetPreview });

    expect(document.body.textContent).toContain('never applied to the app theme');
    expect(JSON.stringify(config)).toBe(before);
    expect(mockUseAppFeatureFlags).toHaveBeenCalledTimes(flagsCalls);
    expect(mockUseTheme).toHaveBeenCalledTimes(themeCalls);
    expect(mockRpc).toHaveBeenCalledTimes(rpcCalls);
    expect(mockInvoke).toHaveBeenCalledTimes(invokeCalls);
  });

  it('ADMIN-B08 requests authenticated short-lived previews and rejects expired or cross-project links', async () => {
    const assetId = VERSION_ONE;
    const now = Date.now();
    const response = {
      assetId,
      url: `${SUPABASE_URL}/storage/v1/object/sign/branding-assets/branding/${assetId}.png?token=short-lived`,
      expiresAt: new Date(now + 60_000).toISOString(),
    };
    const configWithAsset = JSON.parse(JSON.stringify(initialAppearance)) as Record<string, unknown>;
    (configWithAsset.assets as Record<string, unknown>).logoLight = assetId;
    mockSnapshot = makeSnapshot(mockFlags, '7', configWithAsset);
    mockInvoke.mockResolvedValue({ data: response, error: null });
    await mount(BrandingScreen);

    expect(mockInvoke).toHaveBeenCalledWith('branding-assets?action=preview', { body: { assetId } });
    const parsed = parseSignedAssetPreview(response, assetId, SUPABASE_URL, now);

    expect(parsed).not.toBeNull();
    expect(isPreviewUrlFresh(parsed, now)).toBe(true);
    expect(isPreviewUrlFresh(parsed, Date.parse(response.expiresAt))).toBe(false);
    expect(parseSignedAssetPreview({ ...response, url: response.url.replace(SUPABASE_URL, 'https://attacker.example') }, assetId, SUPABASE_URL, now)).toBeNull();
    expect(parseSignedAssetPreview({ ...response, expiresAt: new Date(now - 1).toISOString() }, assetId, SUPABASE_URL, now)).toBeNull();
    expect(parseSignedAssetPreview({
      ...response,
      expiresAt: new Date(now + PREVIEW_URL_TTL_MS + 6_000).toISOString(),
    }, assetId, SUPABASE_URL, now)).toBeNull();
  });

  it('rejects unknown appearance fields before an immutable draft can be submitted', () => {
    const invalid = defaultBrandingDraft();
    const config = { ...invalid.config, unexpected: true } as typeof invalid.config;
    const result = validateBrandingDraft({ ...invalid, config });

    expect(result.config).toBeNull();
    expect(result.errors.join(' ')).toContain('unexpected is not allowed');
    const clean = defaultBrandingDraft();
    expect(areDraftsEqual(clean, { ...clean, config: { ...clean.config } })).toBe(true);
  });
});

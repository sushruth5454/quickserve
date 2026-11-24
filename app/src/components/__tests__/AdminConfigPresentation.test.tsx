import type React from 'react';
import type { AdminAiFeatureUsage } from '../../features/ai/adminApi';
import type { AdminFeature, AdminCategory } from '../../lib/adminApi';
import type { GeographyTree } from '../../lib/geographyApi';

const mockRuntime = {
  cursor: 0,
  stateSlots: [] as unknown[],
  refs: [] as Array<{ current: unknown } | undefined>,
};
const mockFlags: Record<string, boolean> = {};
const mockTheme: Record<string, unknown> = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
  radii: { lg: 12 },
  colors: {},
  shadows: {},
};
const mockToast = jest.fn();
const mockRefresh = jest.fn();
const mockSetFeature = jest.fn();
let mockRulesState: Record<string, unknown> | null = null;

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState(initial: unknown) {
      const index = mockRuntime.cursor++;
      if (!(index in mockRuntime.stateSlots)) mockRuntime.stateSlots[index] = initial;
      return [
        mockRuntime.stateSlots[index],
        (next: unknown) => {
          mockRuntime.stateSlots[index] = typeof next === 'function'
            ? (next as (mockCurrent: unknown) => unknown)(mockRuntime.stateSlots[index])
            : next;
        },
      ];
    },
    useReducer(reducer: (state: unknown, action: unknown) => unknown, initial: unknown) {
      mockRuntime.cursor++;
      const state = mockRulesState ?? initial as Record<string, unknown>;
      return [state, (action: unknown) => {
        mockRulesState = reducer(mockRulesState ?? initial, action) as Record<string, unknown>;
      }];
    },
    useRef(initial: unknown) {
      const index = mockRuntime.cursor++;
      if (!mockRuntime.refs[index]) mockRuntime.refs[index] = { current: initial };
      return mockRuntime.refs[index]!;
    },
    useCallback(callback: unknown) {
      return callback;
    },
    useMemo(callback: () => unknown) {
      mockRuntime.cursor++;
      return callback();
    },
    useEffect() {
      mockRuntime.cursor++;
    },
  };
});

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: () => true, push: jest.fn(), replace: jest.fn() },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ id: 'new' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('react-native', () => ({ Switch: 'Switch', View: 'View' }));
jest.mock('../../components/ui', () => ({
  Badge: 'Badge',
  Button: 'Button',
  Card: 'Card',
  EmptyState: 'EmptyState',
  ErrorState: 'ErrorState',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Input: 'Input',
  ListItem: 'ListItem',
  Screen: 'Screen',
  SegmentedControl: 'SegmentedControl',
  Skeleton: 'Skeleton',
  Text: 'Text',
  TextArea: 'TextArea',
  useConfirm: () => jest.fn().mockResolvedValue(false),
  useToast: () => mockToast,
}));
jest.mock('../../branding/FeatureFlagsProvider', () => ({
  useFeatureControlState: () => ({
    features: mockFlags,
    refresh: mockRefresh,
  }),
}));
jest.mock('../../lib/featureFlags', () => ({
  useFeature: (key: string) => mockFlags[key] === true
    && (key !== 'oorva_admin_config_ux' || mockFlags.oorva_brand === true),
  useAppFeatureFlags: () => ({
    ...mockFlags,
    isOn: (key: string) => mockFlags[key] === true
      && (key !== 'oorva_admin_config_ux' || mockFlags.oorva_brand === true),
  }),
}));
jest.mock('../../theme', () => ({ useTheme: () => mockTheme }));
jest.mock('../../lib/auth', () => ({ useAuth: () => ({ userId: 'admin-user' }) }));
jest.mock('../../lib/api', () => ({ onAuthChange: jest.fn(() => jest.fn()) }));
jest.mock('../../lib/useEntityRefresh', () => ({ useEntityRefresh: jest.fn() }));
jest.mock('../../lib/locationContext', () => ({
  resolvePlace: jest.fn(),
  searchPlaces: jest.fn(),
}));
jest.mock('../../lib/places', () => ({ newPlacesSession: () => 'places-session' }));
jest.mock('../../lib/geographyApi', () => ({
  listGeography: jest.fn(),
  upsertGeo: jest.fn(),
}));
jest.mock('../../lib/adminApi', () => ({
  adminReorderCategories: jest.fn(),
  adminUpsertCategory: jest.fn(),
  getAdminFeaturePresentation: jest.fn(),
  getAppFeatures: jest.fn(),
  listCategories: jest.fn(),
  listFeatures: jest.fn(),
  setCategoryActive: jest.fn(),
  setCategoryCity: jest.fn(),
  setFeature: mockSetFeature,
}));
jest.mock('../../features/ai/adminApi', () => ({ getAdminAiUsageDashboard: jest.fn() }));
jest.mock('../../lib/adminRulesApi', () => ({
  PAYMENT_FREQUENCIES: [{ value: 'monthly', label: 'Monthly' }],
  RECURRING_FREQUENCIES: [{ value: 'weekly', label: 'Weekly' }],
  getAdminRules: jest.fn(),
  parseRecurringRulesDraft: jest.fn(),
  parseSportsRulesDraft: jest.fn(),
  saveAdminRules: jest.fn(),
  toRecurringRulesDraft: jest.fn(),
  toSportsRulesDraft: jest.fn(),
}));
const ReactRuntime = require('react') as typeof import('react');
const {
  ADMIN_AI_PERIOD_CONTEXT,
  formatAdminAiUsd,
  getAdminAiFeatureMeasures,
} = require('../../features/communicationScreens/AdminAiScreen') as typeof import('../../features/communicationScreens/AdminAiScreen');
const {
  AdminCategorySaveFooter,
  getCategoryDraftStatus,
  getCategoryEditorSections,
} = require('../../features/communicationScreens/AdminCategoryDetailScreen') as typeof import('../../features/communicationScreens/AdminCategoryDetailScreen');
const {
  getRulesDraftStatus,
  default: AdminRulesScreen,
} = require('../../features/communicationScreens/AdminRulesScreen') as typeof import('../../features/communicationScreens/AdminRulesScreen');
const { filterAdminFeatureRows } = require('../../features/communicationScreens/AdminFeaturesScreen') as typeof import('../../features/communicationScreens/AdminFeaturesScreen');
const { default: AdminFeaturesScreen } = require('../../features/communicationScreens/AdminFeaturesScreen') as typeof import('../../features/communicationScreens/AdminFeaturesScreen');
const {
  getGeographyAncestry,
  getGeographyPresentationChildren,
  getGeographyPresentationNodes,
  getGeographyVisibilityDescription,
} = require('../../features/communicationScreens/AdminGeographyScreen') as typeof import('../../features/communicationScreens/AdminGeographyScreen');
const { filterAdminCategoryRows } = require('../../features/communicationScreens/AdminServicesScreen') as typeof import('../../features/communicationScreens/AdminServicesScreen');
const { isFeatureOn } = require('../../lib/featureFlagModel') as typeof import('../../lib/featureFlagModel');

function expectJson(actual: unknown, expected: unknown) {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

function findElements(node: unknown, type: string): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, type));
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  if (typeof element.type === 'function') {
    return findElements(
      (element.type as (props: Record<string, unknown>) => unknown)(element.props),
      type,
    );
  }
  const props = element.props;
  return [
    ...(element.type === type ? [element] : []),
    ...findElements(props.children, type),
    ...findElements(props.footer, type),
  ];
}

function renderedText(node: unknown): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(renderedText);
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  if (typeof element.type === 'function') {
    return renderedText((element.type as (props: Record<string, unknown>) => unknown)(element.props));
  }
  return renderedText(element.props.children);
}

function adminCategory(overrides: Partial<AdminCategory> & Pick<AdminCategory, 'id' | 'name' | 'slug'>): AdminCategory {
  const { id, name, slug, ...other } = overrides;
  return {
    id,
    name,
    slug,
    icon: 'construct-outline',
    parent_id: null,
    vertical: 'home',
    archetype: null,
    pricing_units: ['job'],
    recurrence_allowed: false,
    allowed_frequencies: [],
    recurring_discount_bp: null,
    cancellation_policy: 'standard',
    requires_docs: [],
    restricted: false,
    intake_schema: {},
    active: true,
    sort_order: 0,
    cities: [],
    providers: 0,
    bookings_30d: 0,
    ...other,
  };
}

const stateId = '11111111-1111-4111-8111-111111111111';
const districtId = '22222222-2222-4222-8222-222222222222';
const cityId = '33333333-3333-4333-8333-333333333333';
const areaId = '44444444-4444-4444-8444-444444444444';
const geography: GeographyTree = {
  states: [{ id: stateId, name: 'Karnataka', active: true }],
  districts: [{ id: districtId, state_id: stateId, name: 'Bengaluru Urban', active: true }],
  cities: [{ id: cityId, district_id: districtId, name: 'Bengaluru', lat: 12.97, lng: 77.59, active: true }],
  areas: [{ id: areaId, city_id: cityId, name: 'Indiranagar', lat: 12.97, lng: 77.64, active: true, sort_order: 1 }],
};

function recurringDraft(horizonDays: string) {
  return {
    frequencies: ['weekly'],
    horizonDays,
    maxPlanDays: '90',
    skipCutoffHours: '24',
    rescheduleCutoffHours: '24',
    reminderHoursBefore: '24',
    paymentDueHoursBefore: '24',
    billingGraceHours: '24',
    paymentFrequencies: ['monthly'],
    recurringDiscountPercent: '0',
  };
}

function rulesState(overrides: Record<string, unknown> = {}) {
  const recurring = recurringDraft('180');
  const sports = {
    paymentHoldMinutes: '15',
    approvalPayWindowMinutes: '30',
    maxActiveHoldsPerCustomer: '5',
    requestResponseMinutes: '60',
    minLeadMinutes: '30',
    commissionPercent: '10',
    customerFeeRupees: '0',
    fullRefundHours: '24',
    partialRefundHours: '48',
    partialRefundPercent: '50',
    releaseAfterHours: '24',
  };
  return {
    recurring,
    savedRecurring: recurring,
    sports,
    savedSports: sports,
    loadError: null,
    saveError: null,
    saving: false,
    ...overrides,
  };
}

function renderRulesScreen() {
  mockRuntime.cursor = 0;
  return AdminRulesScreen();
}

beforeEach(() => {
  mockRuntime.cursor = 0;
  mockRuntime.stateSlots = [];
  mockRuntime.refs = [];
  Object.keys(mockFlags).forEach((key) => delete mockFlags[key]);
  Object.assign(mockFlags, {
    oorva_brand: true,
    oorva_admin_config_ux: true,
    admin_rules_editor: true,
    admin_category_editor: true,
  });
  mockRulesState = rulesState();
  Object.assign(mockTheme, {
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
    radii: { lg: 12 },
  });
  mockToast.mockReset();
  mockRefresh.mockReset();
  mockSetFeature.mockReset().mockResolvedValue({});
});

describe('admin configuration presentation', () => {
  it('CM_AI_PERIOD_CONTEXT labels the existing today/month windows in IST', () => {
    expect(ADMIN_AI_PERIOD_CONTEXT).toContain('Today and this month');
    expect(ADMIN_AI_PERIOD_CONTEXT).toContain('IST');
  });

  it('CM_AI_REQUEST_VS_EVENT keeps zero requests and assistant model-call events distinct', () => {
    const feature: AdminAiFeatureUsage = {
      feature: 'ai_assistant',
      calls_today: 0,
      calls_month: 0,
      error_rate_percent: 0,
      usage_events_today: 0,
      input_tokens_month: 0,
      output_tokens_month: 0,
      cost_month_micros_usd: 0,
    };
    expectJson(getAdminAiFeatureMeasures(feature), {
      requests: 'Requests today: 0',
      errorRate: 'Error rate: 0.00%',
      modelCalls: 'Model calls today, including fallback calls: 0',
      monthlyUsage: 'This month: 0 input / 0 output tokens · $0.0000',
    });
    expect(getAdminAiFeatureMeasures({ ...feature, feature: 'ai_product_search' }).modelCalls).toBeNull();
  });

  it('CM_AI_UNITS converts micros to USD and preserves token units', () => {
    const feature: AdminAiFeatureUsage = {
      feature: 'ai_quote_extract',
      calls_today: 7,
      calls_month: 12,
      error_rate_percent: 2.5,
      usage_events_today: 9,
      input_tokens_month: 1200,
      output_tokens_month: 340,
      cost_month_micros_usd: 1234,
    };
    expect(formatAdminAiUsd(1_234_567)).toBe('$1.2346');
    expect(getAdminAiFeatureMeasures(feature).monthlyUsage).toBe('This month: 1200 input / 340 output tokens · $0.0012');
  });

  it('CM_CATEGORY_SAVE_FOOTER keeps booking type first only in the enhanced editor and reports dirtiness', () => {
    expect(getCategoryEditorSections(true)).toEqual(['booking-type', 'basics', 'advanced-schema']);
    expect(getCategoryEditorSections(false)).toEqual(['basics', 'booking-type']);
    expect(getCategoryDraftStatus(true)).toBe('Unsaved changes');
    expect(getCategoryDraftStatus(false)).toBe('No unsaved changes');
    const save = jest.fn();
    const refresh = jest.fn();
    const footer = AdminCategorySaveFooter({
      dirty: true,
      formError: 'Validation failed',
      readbackError: 'Canonical readback unavailable',
      operationSlow: false,
      externalMutationPending: false,
      saving: false,
      savingCity: null,
      stale: false,
      onSave: save,
      onRefresh: refresh,
    });
    const footerButtons = findElements(footer, 'Button');
    expect(footerButtons.map((button) => button.props.title)).toEqual(['Refresh category data', 'Save category']);
    expect(footerButtons[1]?.props.disabled).toBe(false);
    expect(findElements(footer, 'InlineAlert').map((alert) => alert.props.message)).toEqual([
      'Validation failed',
      'Canonical readback unavailable',
    ]);
    (footerButtons[1]?.props.onPress as (() => void) | undefined)?.();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('CM_RULES_FOOTER pins save state and retains section drafts through a theme rerender', () => {
    const longValue = 'x'.repeat(300);
    mockRulesState = rulesState({
      recurring: recurringDraft(longValue),
      savedRecurring: recurringDraft('180'),
    });
    const firstTree = renderRulesScreen();
    const firstFooter = findElements(firstTree, 'Screen')[0]?.props.footer;
    expect(renderedText(firstFooter)).toContain('Unsaved changes');
    expect(findElements(firstFooter, 'Button').some((button) => button.props.title === 'Save booking rules')).toBe(true);
    expect(getRulesDraftStatus(true)).toBe('Unsaved changes');

    const horizonInput = findElements(firstTree, 'Input').find((input) => input.props.label === 'Booking horizon (days)');
    expect(horizonInput?.props.value).toBe(longValue);
    Object.assign(mockTheme, { spacing: { xs: 5, sm: 10, md: 14, lg: 18, xl: 22, xxl: 26, xxxl: 34 } });
    const nextTree = renderRulesScreen();
    const nextHorizonInput = findElements(nextTree, 'Input').find((input) => input.props.label === 'Booking horizon (days)');
    expect(nextHorizonInput?.props.value).toBe(longValue);
    expect((mockRulesState?.recurring as ReturnType<typeof recurringDraft>).horizonDays).toBe(longValue);
  });

  it('CM_FLAGS_SEARCH_DYNAMIC finds and operates unknown registry rows by dynamic key and text', () => {
    const unknown: AdminFeature = {
      key: 'future_service_review',
      enabled: false,
      label: 'Future service review',
      description: 'New dynamic review control',
      group_name: 'Novel operations',
      sort_order: 900,
      updated_at: '',
    };
    expect(filterAdminFeatureRows([unknown], 'future_service_review')).toEqual([unknown]);
    expect(filterAdminFeatureRows([unknown], 'dynamic review')).toEqual([unknown]);
    expect(filterAdminFeatureRows([unknown], 'Novel operations')[0]?.key).toBe('future_service_review');
    mockFlags.future_service_review = false;
    mockFlags.archetypes = true;
    mockRuntime.stateSlots = [];
    mockRuntime.stateSlots[0] = mockFlags;
    mockRuntime.stateSlots[1] = [unknown];
    mockRuntime.stateSlots[2] = null;
    mockRuntime.stateSlots[3] = false;
    mockRuntime.stateSlots[6] = 'future_service_review';
    mockRuntime.cursor = 0;
    const tree = AdminFeaturesScreen();
    const row = findElements(tree, 'Card').find((card) => renderedText(card).includes('Future service review'));
    const switchControl = row && findElements(row, 'Switch')[0];
    expect(switchControl?.props.value).toBe(false);
    (switchControl?.props.onValueChange as ((value: boolean) => void) | undefined)?.(true);
    expect(mockSetFeature.mock.calls[0]).toEqual(['future_service_review', true]);
  });

  it('CM_GEO_ANCESTRY follows real parent UUIDs and returns only selected-node children', () => {
    expect(getGeographyAncestry(geography, areaId).map((node) => [node.kind, node.id])).toEqual([
      ['state', stateId],
      ['district', districtId],
      ['city', cityId],
      ['area', areaId],
    ]);
    expect(getGeographyPresentationChildren(geography, getGeographyPresentationNodes(geography).find((node) => node.id === districtId)!))
      .toEqual([expect.objectContaining({ id: cityId, parentId: districtId, kind: 'city' })]);
  });

  it('CM_GEO_PARENT_OFF explains effective visibility without changing the configured child flag', () => {
    const tree = { ...geography, states: [{ ...geography.states[0]!, active: false }] };
    expect(getGeographyVisibilityDescription(tree, cityId)).toContain('not effectively visible because state Karnataka is inactive');
    expect(getGeographyVisibilityDescription(tree, cityId)).toContain('Configured active');
  });

  it('CM_GEO_DISABLE_RETAIN_CHILDREN keeps raw descendant state when an ancestor is disabled', () => {
    const before = getGeographyPresentationNodes(geography).find((node) => node.id === cityId);
    const afterTree = { ...geography, states: [{ ...geography.states[0]!, active: false }] };
    const after = getGeographyPresentationNodes(afterTree).find((node) => node.id === cityId);
    expectJson({ before: before?.active, after: after?.active, parentId: after?.parentId }, {
      before: true,
      after: true,
      parentId: districtId,
    });
    expect(getGeographyVisibilityDescription(afterTree, cityId)).toContain('setting is retained');
  });

  it('CM_SERVICES_FILTERS exposes every current archetype and group filter', () => {
    const group = adminCategory({ id: 'group', name: 'Home repairs', slug: 'home-repairs' });
    const nestedGroup = adminCategory({ id: 'nested-group', name: 'Electrical', slug: 'electrical', parent_id: group.id });
    const types = ['inspect_quote', 'fixed', 'time_based', 'proposal', 'remote'].map((archetype, index) =>
      adminCategory({ id: `type-${index}`, name: `Service ${archetype}`, slug: archetype, archetype, parent_id: group.id, sort_order: index }));
    const rows = [group, nestedGroup, ...types];
    expect(types.map((row) => filterAdminCategoryRows(rows, row.archetype!, '', true).map((item) => item.id))).toEqual(
      types.map((row) => [row.id]),
    );
    expect(filterAdminCategoryRows(rows, 'groups', '', true).map((row) => row.id)).toEqual(['group', 'nested-group']);
    expect(filterAdminCategoryRows(rows, `group:${group.id}`, '', true).map((row) => row.id).sort()).toEqual([
      'group',
      'nested-group',
      ...types.map((row) => row.id),
    ].sort());
    expect(filterAdminCategoryRows(rows, 'all', 'home-repairs', true).map((row) => row.id)).toContain('type-0');
  });

  it('CM_ADMIN_CONFIG_PRESENTATION_MATRIX covers effective flags, access states, load states, empty results, and long dirty drafts', () => {
    expect(isFeatureOn({ oorva_brand: true, oorva_admin_config_ux: true }, 'oorva_admin_config_ux')).toBe(true);
    expect(isFeatureOn({ oorva_brand: true, oorva_admin_config_ux: false }, 'oorva_admin_config_ux')).toBe(false);
    expect(isFeatureOn({ oorva_brand: false, oorva_admin_config_ux: true }, 'oorva_admin_config_ux')).toBe(false);

    let tree = renderRulesScreen();
    expect(findElements(findElements(tree, 'Screen')[0]?.props.footer, 'Button')
      .some((button) => button.props.title === 'Save booking rules')).toBe(true);

    mockFlags.oorva_admin_config_ux = false;
    mockRuntime.cursor = 0;
    tree = renderRulesScreen();
    expect(findElements(tree, 'Screen')[0]?.props.footer).toBeUndefined();
    expect(findElements(tree, 'Card').map(renderedText).flat()).toContain('Sports rules');

    mockFlags.oorva_admin_config_ux = true;
    mockFlags.oorva_brand = false;
    mockRuntime.cursor = 0;
    tree = renderRulesScreen();
    expect(findElements(tree, 'Screen')[0]?.props.footer).toBeUndefined();

    mockFlags.oorva_brand = true;
    mockFlags.admin_rules_editor = false;
    mockRuntime.cursor = 0;
    tree = renderRulesScreen();
    expect(renderedText(tree)).toContain('Booking rules are unavailable');

    mockFlags.admin_rules_editor = true;
    mockRulesState = rulesState({ recurring: null, sports: null });
    mockRuntime.cursor = 0;
    tree = renderRulesScreen();
    expect(findElements(tree, 'Skeleton').length).toBe(1);

    mockRulesState = rulesState({ loadError: 'Policy read denied' });
    mockRuntime.cursor = 0;
    tree = renderRulesScreen();
    expect(findElements(tree, 'ErrorState')[0]?.props.message).toBe('Policy read denied');

    expect(filterAdminFeatureRows([], 'missing')).toEqual([]);
    expect(getGeographyPresentationNodes({ states: [], districts: [], cities: [], areas: [] })).toEqual([]);

    const longValue = 'draft-'.repeat(80);
    mockRulesState = rulesState({
      recurring: recurringDraft(longValue),
      savedRecurring: recurringDraft('180'),
    });
    mockRuntime.stateSlots = [];
    mockRuntime.cursor = 0;
    tree = renderRulesScreen();
    expect(findElements(tree, 'Input').find((input) => input.props.label === 'Booking horizon (days)')?.props.value).toBe(longValue);
    Object.assign(mockTheme, { spacing: { xs: 6, sm: 12, md: 16, lg: 20, xl: 24, xxl: 28, xxxl: 36 } });
    tree = renderRulesScreen();
    expect(findElements(tree, 'Input').find((input) => input.props.label === 'Booking horizon (days)')?.props.value).toBe(longValue);
  });
});

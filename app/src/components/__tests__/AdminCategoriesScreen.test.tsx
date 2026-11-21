import React from 'react';
import AdminServicesScreen, {
  categoryMutationRegistry,
  categoryMutationWarningDelay,
  createCategoryMutationCoordinator as createServicesCoordinator,
  reorderSiblingIds,
} from '../../features/communicationScreens/AdminServicesScreen';
import AdminCategoryEditorScreen, {
  clearSubmittedCityDraft,
  categorySortOrderForSave,
  cleanupCategoryEditorSession,
  clearCategoryEditorSessionsForUser,
  createCategoryMutationCoordinator as createDetailCoordinator,
  getCategoryEditorSession,
  reconcileCategoryDraft,
} from '../../features/communicationScreens/AdminCategoryDetailScreen';
import {
  adminReorderCategories,
  adminUpsertCategory,
  listCategories,
  setCategoryActive,
  setCategoryCity,
  type AdminCategory,
} from '../../lib/adminApi';
import { onAuthChange } from '../../lib/api';
import { useFeature } from '../../lib/featureFlags';

var mockHookState: unknown[] = [];

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (initial: unknown) => [
      mockHookState.length
        ? mockHookState.shift()
        : typeof initial === 'function' ? (initial as () => unknown)() : initial,
      jest.fn(),
    ],
    useRef: (initial: unknown) => ({ current: initial }),
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (callback: unknown) => callback,
    useEffect: jest.fn(),
  };
});

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false }),
  useLocalSearchParams: () => ({ id: 'new' }),
}));
jest.mock('react-native', () => ({ Switch: 'Switch', View: 'View' }));
jest.mock('../../components/ui', () => {
  const React = require('react');
  const passthrough = (name: string) => (props: any) =>
    React.createElement(name, props, props.children);
  return {
    Badge: passthrough('Badge'),
    Button: passthrough('Button'),
    Card: passthrough('Card'),
    EmptyState: passthrough('EmptyState'),
    ErrorState: passthrough('ErrorState'),
    Header: passthrough('Header'),
    InlineAlert: passthrough('InlineAlert'),
    Input: passthrough('Input'),
    Screen: passthrough('Screen'),
    SegmentedControl: passthrough('SegmentedControl'),
    Skeleton: passthrough('Skeleton'),
    Text: passthrough('Text'),
    TextArea: passthrough('TextArea'),
    useToast: () => jest.fn(),
  };
});
jest.mock('../../lib/adminApi', () => ({
  adminReorderCategories: jest.fn(),
  adminUpsertCategory: jest.fn(),
  listCategories: jest.fn(),
  setCategoryActive: jest.fn(),
  setCategoryCity: jest.fn(),
}));
jest.mock('../../lib/featureFlags', () => ({ useFeature: jest.fn() }));
jest.mock('../../lib/auth', () => ({ useAuth: () => ({ userId: 'admin-1' }) }));
jest.mock('../../lib/api', () => ({ onAuthChange: jest.fn() }));
jest.mock('../../theme', () => ({
  useTheme: () => ({
    spacing: { sm: 8, md: 12, lg: 16 },
    radii: { lg: 12 },
  }),
}));

const mockListCategories = listCategories as jest.MockedFunction<typeof listCategories>;
const mockReorderCategories = adminReorderCategories as jest.MockedFunction<typeof adminReorderCategories>;
const mockUpsertCategory = adminUpsertCategory as jest.MockedFunction<typeof adminUpsertCategory>;
const mockSetCategoryActive = setCategoryActive as jest.MockedFunction<typeof setCategoryActive>;
const mockSetCategoryCity = setCategoryCity as jest.MockedFunction<typeof setCategoryCity>;
const mockUseFeature = useFeature as jest.MockedFunction<typeof useFeature>;
const mockOnAuthChange = onAuthChange as jest.MockedFunction<typeof onAuthChange>;

const row = (id: string, name: string, sort_order: number, overrides: Partial<AdminCategory> = {}): AdminCategory => ({
  id,
  name,
  slug: id,
  icon: 'sparkles-outline',
  parent_id: null,
  vertical: 'home',
  archetype: 'fixed',
  pricing_units: ['visit'],
  recurrence_allowed: false,
  allowed_frequencies: [],
  recurring_discount_bp: null,
  cancellation_policy: 'standard',
  requires_docs: [],
  restricted: false,
  intake_schema: {},
  active: true,
  sort_order,
  cities: [{ city: 'Seattle', live: true }],
  providers: 2,
  bookings_30d: 4,
  ...overrides,
});

const draft = (overrides: Partial<{
  slug: string;
  name: string;
  icon: string;
  vertical: string;
  parent_id: string;
  archetype: string;
  pricing_units: string;
  recurrence_allowed: boolean;
  allowed_frequencies: string;
  recurring_discount_bp: string;
  cancellation_policy: string;
  requires_docs: string;
  restricted: boolean;
  intake_schema: string;
}> = {}) => ({
  slug: 'category-one',
  name: 'Submitted name',
  icon: 'sparkles-outline',
  vertical: 'home',
  parent_id: '',
  archetype: 'fixed',
  pricing_units: 'visit',
  recurrence_allowed: false,
  allowed_frequencies: '',
  recurring_discount_bp: '',
  cancellation_policy: 'standard',
  requires_docs: '',
  restricted: false,
  intake_schema: '{}',
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flattenElements(node: unknown): Array<{ type: unknown; props: Record<string, any> }> {
  if (Array.isArray(node)) return node.flatMap(flattenElements);
  if (!React.isValidElement(node)) return [];
  const element = node as React.ReactElement<any>;
  if (typeof element.type === 'function') {
    return flattenElements((element.type as (props: any) => React.ReactNode)(element.props));
  }
  return [
    { type: element.type, props: element.props },
    ...flattenElements(element.props.children),
    ...flattenElements(element.props.header),
  ];
}

describe('admin category canonical readback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHookState = [];
    mockUseFeature.mockReturnValue(true);
    mockReorderCategories.mockResolvedValue(undefined);
    mockUpsertCategory.mockResolvedValue('category-created');
    mockSetCategoryActive.mockResolvedValue(undefined);
    mockSetCategoryCity.mockResolvedValue(undefined);
  });

  it('CM_CATEGORY_ORDER_READBACK: uses server 10/20 positions after reorder and later edit/save', async () => {
    const categoryA = row('category-a', 'Category A', 10);
    const categoryB = row('category-b', 'Category B', 20);
    const canonical = [
      { ...categoryB, sort_order: 10 },
      { ...categoryA, sort_order: 20 },
    ];
    const applied: AdminCategory[][] = [];
    mockListCategories.mockResolvedValue(canonical);
    const coordinator = createServicesCoordinator(mockListCategories, (rows) => applied.push(rows), jest.fn());
    const ids = reorderSiblingIds([categoryA, categoryB], categoryA, 1);

    expect(ids).toEqual(['category-b', 'category-a']);
    const result = await coordinator.mutate(() => mockReorderCategories(ids!), jest.fn());

    expect(result.status).toBe('committed');
    expect(applied[0]?.map((item) => item.sort_order)).toEqual([10, 20]);
    expect(categorySortOrderForSave(applied[0]![1]!, applied[0]!, null)).toBe(20);
    expect(mockListCategories).toHaveBeenCalledTimes(1);
  });

  it('CM_CATEGORY_CANONICAL_READBACK: replaces submitted fields and defaults with the server projection', async () => {
    const canonical = row('category-created', 'Normalized by server', 30, {
      icon: 'server-icon',
      providers: 17,
      bookings_30d: 29,
      active: false,
      pricing_units: ['server-unit'],
    });
    const applied: AdminCategory[][] = [];
    let committedId: string | null = null;
    const coordinator = createDetailCoordinator(
      async () => [canonical],
      (rows) => applied.push(rows),
      jest.fn(),
    );
    const payload = {
      ...draft(),
      sort_order: 0,
      intake_schema: {},
      recurrence_allowed: false,
      allowed_frequencies: [],
      recurring_discount_bp: null,
      requires_docs: [],
      parent_id: null,
      archetype: 'fixed',
      restricted: false,
    };

    const result = await coordinator.mutate(
      () => mockUpsertCategory(payload as never),
      jest.fn(),
      (id) => { committedId = id; },
    );
    const savedDraft = reconcileCategoryDraft(canonical, draft(), new Set()).draft;

    expect(result.status).toBe('committed');
    expect(committedId).toBe('category-created');
    expect(applied[0]).toEqual([canonical]);
    expect(savedDraft).toMatchObject({
      name: 'Normalized by server',
      icon: 'server-icon',
      pricing_units: 'server-unit',
    });
    expect(canonical).toMatchObject({ active: false, providers: 17, bookings_30d: 29 });
  });

  it('preserves only dirty draft fields during a same-category canonical refresh', () => {
    const canonical = row('category-one', 'Server name', 10, { icon: 'server-icon' });
    const reconciled = reconcileCategoryDraft(
      canonical,
      draft({ name: 'Unsaved name', icon: 'old icon' }),
      new Set(['name']),
    );

    expect(reconciled.draft.name).toBe('Unsaved name');
    expect(reconciled.draft.icon).toBe('server-icon');
    expect(reconciled.dirtyFields).toEqual(new Set(['name']));
  });

  it('CM_CATEGORY_AVAILABILITY_READBACK: refetches canonical active and city state after legacy writes', async () => {
    const initial = row('category-one', 'Category One', 10);
    const activeProjection = row('category-one', 'Category One', 10, { active: false });
    const cityProjection = row('category-one', 'Category One', 10, {
      active: false,
      cities: [{ city: 'Seattle', live: false }],
    });
    const applied: AdminCategory[][] = [];
    mockListCategories
      .mockResolvedValueOnce([activeProjection])
      .mockResolvedValueOnce([cityProjection]);
    const coordinator = createServicesCoordinator(mockListCategories, (rows) => applied.push(rows), jest.fn());

    const activeResult = await coordinator.mutate(
      () => mockSetCategoryActive(initial.id, false),
      jest.fn(),
    );
    const cityResult = await coordinator.mutate(
      () => mockSetCategoryCity(initial.id, 'Seattle', false),
      jest.fn(),
    );

    expect(activeResult.status).toBe('committed');
    expect(cityResult.status).toBe('committed');
    expect(applied[0]?.[0]).toEqual(activeProjection);
    expect(applied[1]?.[0]).toEqual(cityProjection);
    expect(mockListCategories).toHaveBeenCalledTimes(2);
  });

  it('keeps new city text typed while a committed availability write is pending', () => {
    expect(clearSubmittedCityDraft('Portland', 'Seattle')).toBe('Portland');
    expect(clearSubmittedCityDraft(' Seattle ', 'Seattle')).toBe('');
  });

  it('shows stale availability state after a committed write whose readback fails', async () => {
    const failure = new Error('readback unavailable');
    const staleMessages: string[] = [];
    const coordinator = createServicesCoordinator(
      async () => { throw failure; },
      jest.fn(),
      jest.fn(),
    );
    const result = await coordinator.mutate(
      () => mockSetCategoryActive('category-one', false),
      (error) => staleMessages.push(`Saved, but stale: ${error.message}`),
    );

    expect(result.status).toBe('committed-readback-failed');
    expect(staleMessages).toEqual(['Saved, but stale: readback unavailable']);
    expect(mockSetCategoryActive).toHaveBeenCalledTimes(1);
  });

  it('CM_CATEGORY_INACTIVE_CREATE: records the committed id and never retries a create when readback fails', async () => {
    const canonical = row('category-created', 'Created inactive', 10, { active: false });
    const list = jest.fn()
      .mockRejectedValueOnce(new Error('readback unavailable'))
      .mockResolvedValueOnce([canonical]);
    const write = jest.fn().mockResolvedValue('category-created');
    const applied = jest.fn();
    const onReadbackFailure = jest.fn();
    let committedId: string | null = null;
    const coordinator = createDetailCoordinator(list, applied, jest.fn());

    const result = await coordinator.mutate(
      write,
      onReadbackFailure,
      (id) => { committedId = id as string; },
    );
    const refresh = await coordinator.refresh();

    expect(result.status).toBe('committed-readback-failed');
    expect(onReadbackFailure).toHaveBeenCalledWith(new Error('readback unavailable'));
    expect(committedId).toBe('category-created');
    expect(refresh.status).toBe('refreshed');
    expect(applied).toHaveBeenCalledWith([canonical]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(canonical.active).toBe(false);
    expect(categoryMutationRegistry.lastOutcome).toMatchObject({
      status: 'readback-failed',
      message: expect.stringContaining('saved'),
    });
  });

  it('distinguishes a rejected write from a committed write with failed readback', async () => {
    const list = jest.fn().mockResolvedValue([]);
    const onReadbackFailure = jest.fn();
    const coordinator = createDetailCoordinator(list, jest.fn(), jest.fn());
    const result = await coordinator.mutate(
      () => Promise.reject(new Error('server rejected write')),
      onReadbackFailure,
    );

    expect(result.status).toBe('write-failed');
    expect(list).not.toHaveBeenCalled();
    expect(onReadbackFailure).not.toHaveBeenCalled();
    expect(categoryMutationRegistry.lastOutcome?.status).toBe('write-failed');
  });

  it('serializes overlapping writes and ignores a stale list response', async () => {
    const oldRead = deferred<AdminCategory[]>();
    const writeGate = deferred<void>();
    const canonical = [row('category-one', 'Canonical', 10)];
    const applied: AdminCategory[][] = [];
    const read = jest.fn()
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(canonical);
    const coordinator = createServicesCoordinator(read, (rows) => applied.push(rows), jest.fn());
    const staleRefresh = coordinator.refresh();
    const firstWrite = coordinator.mutate(() => writeGate.promise, jest.fn());
    const secondWrite = await coordinator.mutate(jest.fn(), jest.fn());

    writeGate.resolve();
    const firstResult = await firstWrite;
    oldRead.resolve([row('category-one', 'Stale', 0)]);
    const staleResult = await staleRefresh;

    expect(secondWrite.status).toBe('busy');
    expect(firstResult.status).toBe('committed');
    expect(staleResult.status).toBe('stale');
    expect(applied).toEqual([canonical]);
  });

  it('CM_SERVICES_EDITOR_OFF: keeps legacy availability controls and hides editor controls', () => {
    mockUseFeature.mockReturnValue(false);
    mockHookState = [[row('category-one', 'Category One', 10)], 'all', '', null, null, null];

    const nodes = flattenElements(AdminServicesScreen());
    const buttonTitles = nodes
      .filter((node) => node.type === 'Button')
      .map((node) => node.props.title);

    expect(buttonTitles).not.toEqual(expect.arrayContaining(['New service', 'Edit', 'Move up', 'Move down']));
    expect(nodes.filter((node) => node.type === 'Switch')).toHaveLength(2);
  });

  it('CM_CATEGORY_CROSS_SCREEN_SERIALIZATION: blocks Services reads and writes until editor readback finishes', async () => {
    const canonical = [row('category-one', 'Canonical', 10)];
    const writeGate = deferred<string>();
    const applied: AdminCategory[][] = [];
    const detail = createDetailCoordinator(async () => canonical, jest.fn(), jest.fn());
    const services = createServicesCoordinator(async () => canonical, (rows) => applied.push(rows), jest.fn());
    const detailWrite = detail.mutate(() => writeGate.promise, jest.fn());
    const servicesRefresh = await services.refresh();
    const servicesWrite = jest.fn().mockResolvedValue(undefined);
    const overlappingWrite = await services.mutate(servicesWrite, jest.fn());

    expect(categoryMutationRegistry.pending).toBe(true);
    expect(servicesRefresh.status).toBe('busy');
    expect(overlappingWrite.status).toBe('busy');
    expect(servicesWrite).not.toHaveBeenCalled();

    writeGate.resolve('category-one');
    expect((await detailWrite).status).toBe('committed');
    expect(categoryMutationRegistry.pending).toBe(false);
    expect((await services.refresh()).status).toBe('refreshed');
    expect(applied).toEqual([canonical]);
  });

  it('retains the committed category id and dirty draft across editor unmount/readback retry', () => {
    const key = 'test:committed-create';
    const session = getCategoryEditorSession(key, true, 'new');
    session.initialized = true;
    session.categoryId = 'category-created';
    session.draft = draft({ name: 'Unsaved name' });
    session.dirtyFields.add('name');
    session.pendingSaveVersions = { name: 1 } as never;
    session.pendingOperation = 'save';
    session.stale = true;
    session.readbackError = 'Category saved, but readback failed.';
    cleanupCategoryEditorSession(key, session);

    const restored = getCategoryEditorSession(key, true, 'new');

    expect(restored).toBe(session);
    expect(restored.categoryId).toBe('category-created');
    expect(restored.draft?.name).toBe('Unsaved name');
    expect(restored.stale).toBe(true);

    restored.pendingSaveVersions = null;
    restored.pendingOperation = null;
    restored.dirtyFields.clear();
    restored.stale = false;
    restored.readbackError = null;
    cleanupCategoryEditorSession(key, restored);
    expect(getCategoryEditorSession(key, true, 'new')).not.toBe(session);
  });

  it('clears departed-account drafts and isolates unresolved sessions by user', () => {
    const previousUser = getCategoryEditorSession('admin-a::new', true, 'new');
    previousUser.draft = draft({ name: 'Private draft' });
    previousUser.dirtyFields.add('name');
    previousUser.pendingOperation = 'save';
    clearCategoryEditorSessionsForUser('admin-a');

    const nextUser = getCategoryEditorSession('admin-b::new', true, 'new');

    expect(previousUser.clearOnCompletion).toBe(true);
    expect(nextUser).not.toBe(previousUser);
    expect(nextUser.draft?.name).toBe('');
    expect(nextUser.categoryId).toBeNull();
  });

  it('clears mutation outcome notices when the authenticated account changes', async () => {
    categoryMutationRegistry.setUser('admin-a');
    const coordinator = createServicesCoordinator(async () => [], jest.fn(), jest.fn(), () => 'admin-a');
    await coordinator.mutate(async () => undefined, jest.fn(), undefined, 'Category change');
    const completedRevision = categoryMutationRegistry.lastOutcome?.revision;

    expect(categoryMutationRegistry.lastOutcome?.userId).toBe('admin-a');
    expect(completedRevision).toBeDefined();
    categoryMutationRegistry.acknowledge(completedRevision!);
    categoryMutationRegistry.setUser('admin-b');

    expect(categoryMutationRegistry.lastOutcome).toBeNull();
    expect(categoryMutationRegistry.acknowledgedRevision).toBe(categoryMutationRegistry.revision);
  });

  it('does not present an empty city state before a committed create is read back', () => {
    const session = getCategoryEditorSession('admin-1::new', true, 'new');
    session.initialized = true;
    session.draft = draft();
    session.categoryId = 'category-created';
    session.readbackError = 'Category saved, but canonical data could not be refreshed.';
    session.stale = true;
    mockHookState = [[], 0, null, false, false];

    const nodes = flattenElements(AdminCategoryEditorScreen());

    expect(nodes.some((node) => node.type === 'EmptyState' && node.props.title === 'No city availability configured')).toBe(false);
    expect(nodes.some((node) => node.type === 'Text'
      && node.props.children === 'Category details are unavailable until refresh completes.')).toBe(true);
  });

  it('uses the auth facade and preserves the slow-warning clock through sign-out', async () => {
    const authListenerRef: { current: Parameters<typeof onAuthChange>[0] | null } = { current: null };
    mockOnAuthChange.mockImplementation((callback) => {
      authListenerRef.current = callback;
      return jest.fn();
    });
    categoryMutationRegistry.startAuthTracking();
    authListenerRef.current?.({ userId: 'admin-a', phone: null });

    const userSessionKey = 'admin-a::new';
    const userSession = getCategoryEditorSession(userSessionKey, true, 'new');
    userSession.draft = draft({ name: 'Private draft' });
    userSession.dirtyFields.add('name');
    userSession.pendingOperation = 'save';
    userSession.pendingOperationToken = Symbol('auth-test');

    const writeGate = deferred<void>();
    const coordinator = createServicesCoordinator(async () => [], jest.fn(), jest.fn(), () => 'admin-a');
    const pendingWrite = coordinator.mutate(() => writeGate.promise, jest.fn());
    const startedAt = categoryMutationRegistry.lastOutcome?.startedAt;
    authListenerRef.current?.(null);

    expect(categoryMutationRegistry.identityKnown).toBe(true);
    expect(categoryMutationRegistry.userId).toBeNull();
    expect(categoryMutationRegistry.lastOutcome).toMatchObject({ pending: true, startedAt });
    expect(userSession.clearOnCompletion).toBe(true);
    expect(categoryMutationWarningDelay(startedAt!, startedAt! + 60_001)).toBe(0);

    writeGate.resolve();
    await pendingWrite;
    userSession.pendingOperation = null;
    userSession.pendingOperationToken = null;
    cleanupCategoryEditorSession(userSessionKey, userSession);
    expect(getCategoryEditorSession(userSessionKey, true, 'new')).not.toBe(userSession);
    expect(categoryMutationRegistry.pending).toBe(false);
  });
});

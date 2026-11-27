import { BasicsSection } from '../BasicsSection';
import { HoursSection } from '../HoursSection';
import { useDraft } from '../useOnboardingData';

let mockCurrentHarness: DraftHarness | null = null;
let mockUserId: string | null = 'owner-a';
let mockDrafts = new Map<string, string>();
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockRemoveItem = jest.fn();
const mockSetAvailability = jest.fn();
const mockSaveBasics = jest.fn();

interface HookSlot {
  value?: unknown;
  dependencies?: readonly unknown[];
  cleanup?: (() => void) | void;
}

interface PendingEffect {
  index: number;
  callback: () => void | (() => void);
  dependencies: readonly unknown[];
}

function sameDependencies(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  return !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

class DraftHarness {
  private slots: HookSlot[] = [];
  private cursor = 0;
  private pendingEffects: PendingEffect[] = [];
  result: unknown;

  render(callback: () => unknown): unknown {
    this.cursor = 0;
    this.pendingEffects = [];
    mockCurrentHarness = this;
    try {
      this.result = callback();
    } finally {
      mockCurrentHarness = null;
    }
    this.flushEffects();
    return this.result;
  }

  useState<T>(initial: T): [T, (next: T | ((current: T) => T)) => void] {
    const index = this.cursor++;
    if (!this.slots[index]) this.slots[index] = { value: initial };
    const slot = this.slots[index]!;
    return [
      slot.value as T,
      (next) => {
        slot.value = typeof next === 'function' ? (next as (current: T) => T)(slot.value as T) : next;
      },
    ];
  }

  useRef<T>(initial: T): { current: T } {
    const index = this.cursor++;
    if (!this.slots[index]) this.slots[index] = { value: { current: initial } };
    return this.slots[index]!.value as { current: T };
  }

  useEffect(callback: () => void | (() => void), dependencies: readonly unknown[]): void {
    const index = this.cursor++;
    const slot = this.slots[index];
    if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
      this.pendingEffects.push({ index, callback, dependencies });
    }
  }

  useMemo<T>(factory: () => T): T {
    this.cursor++;
    return factory();
  }

  unmount(): void {
    for (const slot of [...this.slots].reverse()) slot.cleanup?.();
    this.slots = [];
    this.result = null;
  }

  private flushEffects(): void {
    for (const effect of this.pendingEffects) {
      const previous = this.slots[effect.index];
      previous?.cleanup?.();
      const cleanup = effect.callback();
      this.slots[effect.index] = { value: previous?.value, dependencies: effect.dependencies, cleanup };
    }
  }
}

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (initial: unknown) => mockCurrentHarness!.useState(initial),
    useRef: (initial: unknown) => mockCurrentHarness!.useRef(initial),
    useEffect: (callback: () => void | (() => void), dependencies: readonly unknown[]) =>
      mockCurrentHarness!.useEffect(callback, dependencies),
    useMemo: (factory: () => unknown) => mockCurrentHarness!.useMemo(factory),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: unknown[]) => mockGetItem(...args),
    setItem: (...args: unknown[]) => mockSetItem(...args),
    removeItem: (...args: unknown[]) => mockRemoveItem(...args),
  },
}));

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn() },
  Pressable: 'Pressable',
  View: 'View',
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('../../../lib/api', () => ({ listCategories: jest.fn(), listMyServices: jest.fn() }));

jest.mock('../../../lib/auth', () => ({
  useAuth: () => ({ userId: mockUserId }),
}));

jest.mock('../../../lib/onboarding', () => ({
  onboardingApi: {
    getOnboarding: jest.fn(),
    getCatalog: jest.fn(),
    setAvailability: (...args: unknown[]) => mockSetAvailability(...args),
    saveBasics: (...args: unknown[]) => mockSaveBasics(...args),
    uploadAvatar: jest.fn(),
    addTimeOff: jest.fn(),
    deleteTimeOff: jest.fn(),
  },
}));

jest.mock('../../../components/ui', () => ({
  Avatar: 'Avatar',
  BottomSheet: 'BottomSheet',
  Button: 'Button',
  Card: 'Card',
  Chip: 'Chip',
  InlineAlert: 'InlineAlert',
  Input: 'Input',
  ListItem: 'ListItem',
  Screen: 'Screen',
  Stepper: 'Stepper',
  Text: 'Text',
  TextArea: 'TextArea',
  useConfirm: () => jest.fn().mockResolvedValue(true),
  useToast: () => jest.fn(),
}));

jest.mock('../../../lib/onboarding/validation', () => ({ validateBasics: () => ({}) }));

jest.mock('../../../theme', () => ({
  useTheme: () => ({
    spacing: new Proxy({}, { get: () => 8 }),
    colors: new Proxy({}, { get: () => '#000000' }),
  }),
}));

jest.mock('../media', () => ({ pickPhoto: jest.fn() }));

jest.mock('../parts', () => ({
  addDays: jest.fn(),
  DateStepper: 'DateStepper',
  dateLabel: jest.fn(),
  FieldLabel: 'FieldLabel',
  Intro: 'Intro',
  istToday: () => '2026-01-01',
  SectionFooter: 'SectionFooter',
  TimeStepper: 'TimeStepper',
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function findElements(node: unknown, type: string): Array<{ props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap((item) => findElements(item, type));
  if (!node || typeof node !== 'object') return [];
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  const found = element.type === type ? [element as { props: Record<string, unknown> }] : [];
  return [...found, ...Object.values(element.props ?? {}).flatMap((value) => findElements(value, type))];
}

function assertJsonEqual(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}; actual ${actualJson}`);
  }
}

function sectionData(
  maxJobsPerDay: number | null = 4,
  fullName = 'Provider A',
  availability = [{ weekday: 1, start: '09:00', end: '11:00' }],
) {
  return {
    state: {
      provider: {
        id: 'provider-a',
        bio: 'A provider bio',
        gender: null,
        languages: ['English'],
        years_experience: 2,
        max_jobs_per_day: maxJobsPerDay,
        timezone: 'Asia/Kolkata',
      },
      profile: { full_name: fullName, avatar_url: null },
      payout: { pan_number: 'PAN-MUST-NOT-BE-STORED', bank_account_number: 'BANK-MUST-NOT-BE-STORED' },
      availability,
      time_off: [],
    },
  } as never;
}

function hoursProps(
  maxJobsPerDay: number | null = 4,
  availability = [{ weekday: 1, start: '09:00', end: '11:00' }],
) {
  return {
    data: sectionData(maxJobsPerDay, 'Provider A', availability),
    reload: jest.fn().mockResolvedValue(true),
    header: null,
    mode: 'edit',
    onDone: jest.fn(),
    onBack: jest.fn(),
  } as never;
}

function basicsProps(fullName = 'Provider A') {
  return {
    data: sectionData(4, fullName),
    reload: jest.fn().mockResolvedValue(true),
    header: null,
    mode: 'edit',
    onDone: jest.fn(),
    onBack: jest.fn(),
  } as never;
}

beforeEach(() => {
  jest.useRealTimers();
  mockUserId = 'owner-a';
  mockDrafts = new Map();
  mockGetItem.mockReset().mockImplementation(async (key: string) => mockDrafts.get(key) ?? null);
  mockSetItem.mockReset().mockImplementation(async (key: string, value: string) => {
    mockDrafts.set(key, value);
  });
  mockRemoveItem.mockReset().mockImplementation(async (key: string) => {
    mockDrafts.delete(key);
  });
  mockSetAvailability.mockReset().mockResolvedValue(undefined);
  mockSaveBasics.mockReset().mockResolvedValue(undefined);
  mockCurrentHarness = null;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('provider onboarding draft identity', () => {
  it('ID-DRAFT-A-B restores each authenticated account only from its own section key', async () => {
    const keyA = 'quickserve.draft.owner-a.provider-basics';
    const keyB = 'quickserve.draft.owner-b.provider-basics';
    mockDrafts.set(keyA, JSON.stringify({ fullName: 'Owner A' }));
    mockDrafts.set(keyB, JSON.stringify({ fullName: 'Owner B' }));
    const harness = new DraftHarness();
    const restoredA: unknown[] = [];
    const restoredB: unknown[] = [];

    harness.render(() => useDraft('owner-a', 'provider-basics', {}, (draft) => restoredA.push(draft)));
    await flushPromises();
    harness.render(() => useDraft('owner-b', 'provider-basics', {}, (draft) => restoredB.push(draft)));
    await flushPromises();
    harness.render(() => useDraft('owner-a', 'provider-basics', {}, (draft) => restoredA.push(draft)));
    await flushPromises();

    assertJsonEqual(restoredA, [{ fullName: 'Owner A' }, { fullName: 'Owner A' }], 'owner A restorations');
    assertJsonEqual(restoredB, [{ fullName: 'Owner B' }], 'owner B restorations');
    assertJsonEqual(mockGetItem.mock.calls, [[keyA], [keyB], [keyA]], 'scoped reads');
    harness.unmount();
  });

  it('ID-DRAFT-UID-RACE ignores stale hydration and cancels pending timers on identity or section changes', async () => {
    jest.useFakeTimers();
    const pendingA = deferred<string | null>();
    mockGetItem.mockImplementation((key: string) => (key.includes('owner-a') ? pendingA.promise : Promise.resolve(null)));
    const harness = new DraftHarness();
    const restoredA = jest.fn();
    const restoredB = jest.fn();

    harness.render(() => useDraft('owner-a', 'provider-basics', { fullName: 'A' }, restoredA));
    harness.render(() => useDraft('owner-b', 'provider-basics', { fullName: 'B' }, restoredB));
    await flushPromises();
    pendingA.resolve(JSON.stringify({ fullName: 'stale A' }));
    await flushPromises();
    assertJsonEqual(restoredA.mock.calls, [], 'stale owner A callback calls');
    assertJsonEqual(restoredB.mock.calls, [], 'owner B callback calls before its draft resolves');

    harness.render(() => useDraft('owner-b', 'provider-basics', { fullName: 'updated B' }, restoredB));
    harness.render(() => useDraft('owner-b', 'provider-hours', { slots: [] }, restoredB));
    jest.advanceTimersByTime(400);
    await flushPromises();
    assertJsonEqual(mockSetItem.mock.calls, [], 'writes after key change');
    assertJsonEqual(
      mockGetItem.mock.calls[mockGetItem.mock.calls.length - 1],
      ['quickserve.draft.owner-b.provider-hours'],
      'section-key read',
    );
    harness.unmount();
  });

  it('ID-DRAFT-LEGACY-IGNORE never reads unscoped keys or hydrates or persists while signed out', async () => {
    jest.useFakeTimers();
    mockDrafts.set('quickserve.draft.provider-basics', JSON.stringify({ fullName: 'Legacy owner' }));
    const harness = new DraftHarness();
    const restore = jest.fn();

    harness.render(() => useDraft(null, 'provider-basics', { fullName: 'Signed out' }, restore));
    jest.advanceTimersByTime(500);
    await flushPromises();
    assertJsonEqual(restore.mock.calls, [], 'signed-out restore calls');
    assertJsonEqual(mockGetItem.mock.calls, [], 'signed-out storage reads');
    assertJsonEqual(mockSetItem.mock.calls, [], 'signed-out storage writes');

    harness.render(() => useDraft('owner-a', 'provider-basics', { fullName: 'Owner A' }, restore));
    await flushPromises();
    assertJsonEqual(mockGetItem.mock.calls, [['quickserve.draft.owner-a.provider-basics']], 'account-scoped read after sign-in');
    assertJsonEqual(restore.mock.calls, [], 'legacy draft restoration calls');
    harness.unmount();
  });

  it('ID-DRAFT-UID-BASICS resets unsaved Basics values when the authenticated owner changes', async () => {
    const harness = new DraftHarness();
    harness.render(() => BasicsSection(basicsProps()));
    const fullName = findElements(harness.result, 'Input').find((field) => field.props.label === 'Full name');
    (fullName?.props.onChangeText as ((value: string) => void) | undefined)?.('Unsaved owner A name');
    harness.render(() => BasicsSection(basicsProps()));
    const staleSave = findElements(harness.result, 'SectionFooter')[0]?.props.onPrimary as (() => void) | undefined;

    mockUserId = 'owner-b';
    harness.render(() => BasicsSection(basicsProps('Provider B')));
    await flushPromises();
    const ownerBName = findElements(harness.result, 'Input').find((field) => field.props.label === 'Full name')?.props.value;
    staleSave?.();
    await flushPromises();

    assertJsonEqual(ownerBName, 'Provider B', 'Basics value after owner change');
    assertJsonEqual(mockSaveBasics.mock.calls, [], 'stale owner Basics save attempts');
    harness.unmount();
  });

  it('ID-DRAFT-UID-HOURS resets unsaved Hours values and rejects a stale owner save', async () => {
    const slotsA = [{ weekday: 1, start: '09:00', end: '11:00' }];
    const slotsB = [{ weekday: 2, start: '10:00', end: '12:00' }];
    const propsA = hoursProps(4, slotsA);
    const harness = new DraftHarness();
    harness.render(() => HoursSection(propsA));
    const maxJobsA = findElements(harness.result, 'Stepper').find((field) => field.props.label === 'Maximum jobs per day');
    (maxJobsA?.props.onChange as ((value: number) => void) | undefined)?.(9);
    harness.render(() => HoursSection(propsA));
    const staleSave = findElements(harness.result, 'SectionFooter')[0]?.props.onPrimary as (() => void) | undefined;

    mockUserId = 'owner-b';
    harness.render(() => HoursSection(hoursProps(8, slotsB)));
    await flushPromises();
    const maxJobsB = findElements(harness.result, 'Stepper').find((field) => field.props.label === 'Maximum jobs per day')?.props.value;
    staleSave?.();
    await flushPromises();

    assertJsonEqual(maxJobsB, 8, 'Hours value after owner change');
    assertJsonEqual(mockSetAvailability.mock.calls, [], 'stale owner save attempts');
    harness.unmount();
  });

  it('ID-DRAFT-SAVE-FAIL retains the Hours draft when the server save fails', async () => {
    jest.useFakeTimers();
    mockDrafts.set('quickserve.draft.owner-a.provider-hours', JSON.stringify({ slots: [], maxJobs: 4 }));
    mockSetAvailability.mockRejectedValueOnce(new Error('save failed'));
    const harness = new DraftHarness();

    harness.render(() => HoursSection(hoursProps()));
    await flushPromises();
    const footer = findElements(harness.result, 'SectionFooter')[0];
    (footer?.props.onPrimary as (() => void) | undefined)?.();
    await flushPromises();

    assertJsonEqual(mockSetAvailability.mock.calls.length, 1, 'Hours save attempts');
    assertJsonEqual(mockRemoveItem.mock.calls, [], 'draft removals after failed save');
    assertJsonEqual([...mockDrafts.keys()], ['quickserve.draft.owner-a.provider-hours'], 'draft keys after failed save');
    harness.unmount();
  });

  it('ID-DRAFT-SAVE-OWN clears only the authenticated user Hours draft after a successful save', async () => {
    jest.useFakeTimers();
    mockDrafts.set('quickserve.draft.owner-a.provider-hours', JSON.stringify({ slots: [], maxJobs: 4 }));
    mockDrafts.set('quickserve.draft.owner-b.provider-hours', JSON.stringify({ slots: [], maxJobs: 8 }));
    const harness = new DraftHarness();

    harness.render(() => HoursSection(hoursProps()));
    await flushPromises();
    const maxJobs = findElements(harness.result, 'Stepper').find((field) => field.props.label === 'Maximum jobs per day');
    (maxJobs?.props.onChange as ((value: number) => void) | undefined)?.(7);
    harness.render(() => HoursSection(hoursProps()));
    await flushPromises();
    assertJsonEqual(jest.getTimerCount() > 0, true, 'pending draft timer before successful save');
    const footer = findElements(harness.result, 'SectionFooter')[0];
    (footer?.props.onPrimary as (() => void) | undefined)?.();
    await flushPromises();
    harness.render(() => HoursSection(hoursProps()));
    jest.advanceTimersByTime(400);
    await flushPromises();

    assertJsonEqual(mockRemoveItem.mock.calls, [['quickserve.draft.owner-a.provider-hours']], 'successful save removals');
    assertJsonEqual([...mockDrafts.keys()], ['quickserve.draft.owner-b.provider-hours'], 'draft keys after successful save');
    assertJsonEqual(
      mockSetItem.mock.calls.filter(([key]) => key === 'quickserve.draft.owner-a.provider-hours'),
      [],
      'writes after successful draft clear',
    );
    harness.unmount();
  });

  it('ID-DRAFT-SENSITIVE persists only Basics and Hours form fields, never payout, PAN, or bank data', async () => {
    jest.useFakeTimers();
    const basicsHarness = new DraftHarness();
    basicsHarness.render(() => BasicsSection(basicsProps()));
    await flushPromises();
    const fullName = findElements(basicsHarness.result, 'Input').find((field) => field.props.label === 'Full name');
    (fullName?.props.onChangeText as ((value: string) => void) | undefined)?.('Updated name');
    basicsHarness.render(() => BasicsSection(basicsProps()));
    jest.advanceTimersByTime(400);
    await flushPromises();

    const basicsWrite = mockSetItem.mock.calls.find(([key]) => key === 'quickserve.draft.owner-a.provider-basics');
    expect(basicsWrite).toBeDefined();
    assertJsonEqual(JSON.parse(basicsWrite?.[1] as string), {
      fullName: 'Updated name',
      bio: 'A provider bio',
      languages: ['English'],
      years: 2,
      gender: null,
    }, 'serialized Basics draft');

    basicsHarness.unmount();
    const hoursHarness = new DraftHarness();
    hoursHarness.render(() => HoursSection(hoursProps(null)));
    await flushPromises();
    const setLimit = findElements(hoursHarness.result, 'Chip').find((field) => field.props.label === 'Set a limit');
    (setLimit?.props.onPress as (() => void) | undefined)?.();
    hoursHarness.render(() => HoursSection(hoursProps(null)));
    jest.advanceTimersByTime(400);
    await flushPromises();

    const hoursWrite = mockSetItem.mock.calls.find(([key]) => key === 'quickserve.draft.owner-a.provider-hours');
    expect(hoursWrite).toBeDefined();
    assertJsonEqual(JSON.parse(hoursWrite?.[1] as string), {
      slots: [{ weekday: 1, start: '09:00', end: '11:00' }],
      maxJobs: 6,
    }, 'serialized Hours draft');
    const serializedDrafts = mockSetItem.mock.calls.map(([, value]) => value).join(' ');
    if (/PAN-MUST-NOT-BE-STORED|BANK-MUST-NOT-BE-STORED|pan_number|bank_account_number|payout/i.test(serializedDrafts)) {
      throw new Error(`Sensitive values in serialized drafts: actual ${JSON.stringify(serializedDrafts)}`);
    }
    hoursHarness.unmount();
  });
});

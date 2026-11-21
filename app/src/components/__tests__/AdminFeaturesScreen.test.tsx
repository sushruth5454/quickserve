import type React from 'react';
import type { AdminFeature, AdminFeatures } from '../../lib/adminApi';
import { getAdminFeaturePresentation } from '../../lib/adminFeaturePresentation';

const mockRuntime = {
  hookIndex: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown } | undefined>,
};
const mockToast = jest.fn();
const mockGetAppFeatures = jest.fn();
const mockListFeatures = jest.fn();
const mockSetFeature = jest.fn();
const mockRefresh = jest.fn();
let mockControlFeatures: Record<string, unknown> = {};

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!(index in mockRuntime.states)) mockRuntime.states[index] = initial;
      return [
        mockRuntime.states[index],
        (next: unknown) => {
          mockRuntime.states[index] = typeof next === 'function'
            ? (next as (mockCurrent: unknown) => unknown)(mockRuntime.states[index])
            : next;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!mockRuntime.refs[index]) mockRuntime.refs[index] = { current: initial };
      return mockRuntime.refs[index]!;
    },
    useCallback: (callback: unknown) => callback,
  };
});

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('react-native', () => ({ Switch: 'Switch', View: 'View' }));
jest.mock('../../components/ui', () => ({
  Card: 'Card',
  ErrorState: 'ErrorState',
  Header: 'Header',
  Screen: 'Screen',
  Skeleton: 'Skeleton',
  Text: 'Text',
  useToast: () => mockToast,
}));
jest.mock('../../branding/FeatureFlagsProvider', () => ({
  useFeatureControlState: () => ({ features: mockControlFeatures, refresh: mockRefresh }),
}));
jest.mock('../../lib/adminApi', () => ({
  getAppFeatures: mockGetAppFeatures,
  listFeatures: mockListFeatures,
  setFeature: mockSetFeature,
}));
jest.mock('../../theme', () => ({
  useTheme: () => ({
    spacing: { sm: 8, md: 12, lg: 16 },
    radii: { lg: 12 },
  }),
}));

const ReactRuntime = require('react') as typeof import('react');
const { default: AdminFeaturesScreen } = require('../../features/communicationScreens/AdminFeaturesScreen') as {
  default: () => unknown;
};

const featureRows: AdminFeature[] = [
  {
    key: 'sports',
    enabled: true,
    label: 'Sports',
    description: 'Sports services',
    group_name: 'Services',
    sort_order: 1,
    updated_at: '',
  },
  {
    key: 'sports_online_payments',
    enabled: true,
    label: 'Online payments',
    description: 'Online payment for sports',
    group_name: 'Services',
    sort_order: 2,
    updated_at: '',
  },
];

function featureState(overrides: Partial<AdminFeatures> = {}): AdminFeatures {
  const { archetypes, ...rest } = overrides;
  return {
    sports: true,
    sports_online_payments: true,
    ...rest,
    archetypes: {
      inspect_quote: true,
      fixed: true,
      time_based: true,
      proposal: true,
      remote: false,
      ...archetypes,
    },
  };
}

function renderScreen() {
  mockRuntime.hookIndex = 0;
  return AdminFeaturesScreen();
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
  return [
    ...(element.type === type ? [element] : []),
    ...findElements(element.props.children, type),
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

function switchForLabel(tree: unknown, label: string) {
  const card = findElements(tree, 'Card').find((element) => renderedText(element).includes(label));
  return card ? findElements(card, 'Switch')[0] : undefined;
}

function changeSwitch(tree: unknown, label: string, value: boolean) {
  const onValueChange = switchForLabel(tree, label)?.props.onValueChange;
  if (typeof onValueChange === 'function') (onValueChange as (enabled: boolean) => void)(value);
}

function expectExact(actual: unknown, expected: unknown) {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function drainMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

beforeEach(() => {
  mockRuntime.hookIndex = 0;
  mockRuntime.states = [featureState(), featureRows, null, false];
  mockRuntime.refs = [];
  mockControlFeatures = { oorva_brand: true, oorva_admin_config_ux: true };
  mockToast.mockReset();
  mockGetAppFeatures.mockReset().mockResolvedValue(featureState());
  mockListFeatures.mockReset().mockResolvedValue(featureRows);
  mockSetFeature.mockReset().mockResolvedValue(featureState());
  mockRefresh.mockReset().mockResolvedValue(undefined);
});

describe('AdminFeaturesScreen serialized feature writes', () => {
  it('CM_FLAGS_SERIALIZED blocks synchronous and delayed competing writes until reconciliation', async () => {
    const mutation = deferred<AdminFeatures>();
    const reconciliation = deferred<void>();
    mockSetFeature.mockReturnValueOnce(mutation.promise);
    mockRefresh.mockReturnValueOnce(reconciliation.promise);

    const initialTree = renderScreen();
    changeSwitch(initialTree, 'Sports', false);
    changeSwitch(initialTree, 'Online payments', false);
    expectExact(mockSetFeature.mock.calls, [['sports', false]]);

    const pendingTree = renderScreen();
    expectExact(findElements(pendingTree, 'Switch').map((item) => item.props.disabled), Array(7).fill(true));

    mutation.resolve(featureState({ sports: false }));
    await drainMicrotasks();
    const reconcilingTree = renderScreen();
    expectExact({
      savedValue: switchForLabel(reconcilingTree, 'Sports')?.props.value,
      allDisabled: findElements(reconcilingTree, 'Switch').every((item) => item.props.disabled === true),
      refreshCalls: mockRefresh.mock.calls.length,
    }, { savedValue: false, allDisabled: true, refreshCalls: 1 });

    changeSwitch(reconcilingTree, 'Sports', true);
    expectExact(mockSetFeature.mock.calls, [['sports', false]]);

    reconciliation.resolve(undefined);
    await drainMicrotasks();
    const settledTree = renderScreen();
    expectExact({
      sports: switchForLabel(settledTree, 'Sports')?.props.value,
      child: switchForLabel(settledTree, 'Online payments')?.props.value,
      disabledCount: findElements(settledTree, 'Switch').filter((item) => item.props.disabled === true).length,
    }, { sports: false, child: true, disabledCount: 0 });
  });

  it('CM_FLAGS_FAILURE_RETAINS_STATE keeps the prior canonical value and shows the RPC error', async () => {
    mockSetFeature.mockRejectedValueOnce(new Error('RPC denied by policy'));
    const tree = renderScreen();
    changeSwitch(tree, 'Sports', false);
    await drainMicrotasks();

    const settledTree = renderScreen();
    expectExact({
      value: switchForLabel(settledTree, 'Sports')?.props.value,
      disabled: switchForLabel(settledTree, 'Sports')?.props.disabled,
      toast: mockToast.mock.calls,
      refreshCalls: mockRefresh.mock.calls.length,
    }, {
      value: true,
      disabled: false,
      toast: [[{ message: 'RPC denied by policy', tone: 'error' }]],
      refreshCalls: 0,
    });
  });

  it('CM_FLAGS_REMOTE sends the existing remote archetype key', async () => {
    mockSetFeature.mockResolvedValueOnce(featureState({ archetypes: { remote: true } }));
    const tree = renderScreen();
    changeSwitch(tree, 'Remote services', true);
    await drainMicrotasks();

    const settledTree = renderScreen();
    expectExact({
      request: mockSetFeature.mock.calls,
      remoteEnabled: switchForLabel(settledTree, 'Remote services')?.props.value,
      refreshCalls: mockRefresh.mock.calls.length,
    }, {
      request: [['archetype:remote', true]],
      remoteEnabled: true,
      refreshCalls: 1,
    });
  });

  it('CM_FLAGS_REMOTE_OORVA_OFF keeps remote available in the legacy presentation', async () => {
    mockControlFeatures = { oorva_brand: false, oorva_admin_config_ux: false };
    mockSetFeature.mockResolvedValueOnce(featureState({ archetypes: { remote: true } }));
    const tree = renderScreen();
    changeSwitch(tree, 'Remote services', true);
    await drainMicrotasks();

    expectExact({
      remoteVisible: Boolean(switchForLabel(renderScreen(), 'Remote services')),
      request: mockSetFeature.mock.calls,
      refreshCalls: mockRefresh.mock.calls.length,
    }, {
      remoteVisible: true,
      request: [['archetype:remote', true]],
      refreshCalls: 1,
    });
  });

  it('CM_FLAGS_PARENT_CONTRACT delegates parent explanation and child intent to the shared helper', async () => {
    const state = featureState({ sports: false, sports_online_payments: true });
    mockRuntime.states[0] = state;
    mockSetFeature.mockResolvedValueOnce(featureState({ sports: false, sports_online_payments: false }));
    const tree = renderScreen();
    const child = switchForLabel(tree, 'Online payments');
    const presentation = getAdminFeaturePresentation(featureRows[1]!, featureRows, state);

    expectExact({
      value: child?.props.value,
      disabled: child?.props.disabled,
      helperExplanation: presentation.explanation,
      renderedExplanation: renderedText(findElements(tree, 'Card').find((card) =>
        renderedText(card).includes('Online payments'))).find((text) => text === presentation.explanation),
    }, {
      value: true,
      disabled: presentation.switchDisabledByParent,
      helperExplanation: 'You can turn this child off while Sports is off; enable it first to turn the child back on.',
      renderedExplanation: presentation.explanation,
    });

    changeSwitch(tree, 'Online payments', false);
    await drainMicrotasks();
    expectExact({
      request: mockSetFeature.mock.calls,
      childAfterCanonicalResponse: switchForLabel(renderScreen(), 'Online payments')?.props.value,
    }, {
      request: [['sports_online_payments', false]],
      childAfterCanonicalResponse: false,
    });
  });
});

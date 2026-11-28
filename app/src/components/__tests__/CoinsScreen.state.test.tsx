import type React from 'react';
import { DEFAULT_COINS_CONFIG, type CoinLedgerEntry, type CoinsConfig } from '../../lib/coins';

const mockRuntime = {
  hookIndex: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  focusCallbacks: [] as Array<() => void | (() => void)>,
};
const mockStorage = { getItem: jest.fn(), setItem: jest.fn() };
const mockGetMyCoinBalance = jest.fn();
const mockListCoinHistory = jest.fn();
const mockGetCoinsConfig = jest.fn();

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useCallback: (callback: (...args: never[]) => unknown) => callback,
    useRef: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!mockRuntime.refs[index]) mockRuntime.refs[index] = { current: initial };
      return mockRuntime.refs[index];
    },
    useState: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!(index in mockRuntime.states)) {
        mockRuntime.states[index] = typeof initial === 'function'
          ? (initial as () => unknown)()
          : initial;
      }
      return [
        mockRuntime.states[index],
        (next: unknown) => {
          mockRuntime.states[index] = typeof next === 'function'
            ? Reflect.apply(next, undefined, [mockRuntime.states[index]])
            : next;
        },
      ];
    },
  };
});

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockRuntime.focusCallbacks.push(callback);
  },
}));
jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: unknown[]) => mockStorage.getItem(...args),
    setItem: (...args: unknown[]) => mockStorage.setItem(...args),
  },
}));
jest.mock('../../components/ui', () => ({
  Card: 'Card',
  ErrorState: 'ErrorState',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Screen: 'Screen',
  Skeleton: 'Skeleton',
  Text: 'Text',
}));
jest.mock('../../lib/api', () => ({
  getMyCoinBalance: (...args: unknown[]) => mockGetMyCoinBalance(...args),
  listCoinHistory: (...args: unknown[]) => mockListCoinHistory(...args),
}));
jest.mock('../../lib/coinsConfigApi', () => ({
  getCoinsConfig: (...args: unknown[]) => mockGetCoinsConfig(...args),
}));
jest.mock('../../theme', () => ({
  useTheme: () => ({
    spacing: { section: 1, lg: 2, md: 3, xl: 4, sm: 5, xs: 6 },
    radii: { lg: 8 },
    colors: { primarySoft: 'soft', primaryText: 'primary', border: 'border' },
  }),
}));

const ReactRuntime = require('react') as typeof import('react');
const { default: CoinsScreen } = require('../../features/identityScreens/CoinsScreen') as {
  default: () => React.ReactElement;
};

type TestElement = React.ReactElement<Record<string, unknown>>;

function findElements(node: unknown, type: string): TestElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, type));
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as TestElement;
  return [
    ...(element.type === type ? [element] : []),
    ...findElements(element.props.children, type),
  ];
}

function visibleText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(' ');
  if (ReactRuntime.isValidElement(node)) return visibleText((node.props as { children?: unknown }).children);
  return '';
}

function compactText(node: unknown): string {
  return visibleText(node).replace(/\s+/g, '');
}

function renderCoins() {
  mockRuntime.hookIndex = 0;
  return CoinsScreen();
}

function latestFocusCallback() {
  return mockRuntime.focusCallbacks[mockRuntime.focusCallbacks.length - 1];
}

async function settle() {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
}

function coinConfig(overrides: Partial<CoinsConfig> = {}): CoinsConfig {
  return {
    ...DEFAULT_COINS_CONFIG,
    coins_earning_enabled: true,
    coins_redemption_enabled: true,
    ...overrides,
  };
}

function ledgerEntry(
  id: string,
  kind: CoinLedgerEntry['kind'],
  delta: number,
  reason: string,
): CoinLedgerEntry {
  return {
    id,
    user_id: 'signed-in-user',
    delta,
    kind,
    booking_id: null,
    source_ledger_id: null,
    expires_at: kind === 'earn' ? '2026-03-10T12:00:00.000Z' : null,
    ref: id,
    reason,
    created_by: null,
    created_at: '2026-03-04T12:00:00.000Z',
  };
}

beforeEach(() => {
  mockRuntime.hookIndex = 0;
  mockRuntime.states = [];
  mockRuntime.refs = [];
  mockRuntime.focusCallbacks = [];
  mockStorage.getItem.mockReset().mockResolvedValue('seen');
  mockStorage.setItem.mockReset().mockResolvedValue(undefined);
  mockGetMyCoinBalance.mockReset().mockResolvedValue(0);
  mockListCoinHistory.mockReset().mockResolvedValue([]);
  mockGetCoinsConfig.mockReset().mockResolvedValue(coinConfig());
});

describe('O23-ID12 coin wallet read states', () => {
  it('ID-COIN-LOAD-ERROR does not render a failed first read as zero or empty history', async () => {
    mockGetMyCoinBalance.mockRejectedValueOnce(new Error('balance read failed'));

    renderCoins();
    latestFocusCallback()?.();
    let tree = renderCoins();
    expect(findElements(tree, 'Skeleton')).toHaveLength(1);
    expect(visibleText(tree)).not.toContain('No coin activity yet');

    await settle();
    tree = renderCoins();
    expect(findElements(tree, 'ErrorState')[0]?.props.message).toBe('balance read failed');
    expect(findElements(tree, 'Card')).toHaveLength(0);
    expect(visibleText(tree)).not.toContain('No coin activity yet');
    expect(visibleText(tree)).not.toContain('₹0');
  });

  it('ID-COIN-LOAD-ERROR keeps prior balance and rows visible with a refresh error', async () => {
    const row = ledgerEntry('earn-one', 'earn', 1250, 'Eligible completed booking');
    mockGetMyCoinBalance.mockResolvedValueOnce(2400).mockRejectedValueOnce(new Error('refresh failed'));
    mockGetCoinsConfig.mockResolvedValueOnce(coinConfig({
      coins_earning_enabled: false,
      coins_redemption_enabled: false,
    }));
    mockListCoinHistory.mockResolvedValue([row]);

    renderCoins();
    latestFocusCallback()?.();
    await settle();
    renderCoins();
    expect(visibleText(renderCoins())).toContain('₹24');

    latestFocusCallback()?.();
    await settle();
    const tree = renderCoins();
    expect(findElements(tree, 'ErrorState')[0]?.props.message).toBe('refresh failed');
    expect(visibleText(tree)).toContain('₹24');
    expect(visibleText(tree)).toContain('Booking reward');
    expect(compactText(tree)).toContain('+₹12.50');
    expect(visibleText(tree)).toContain('Earning is paused.');
    expect(visibleText(tree)).toContain('Redemption is paused.');
  });

  it('ID-COIN-NOTICE-OPTIONAL keeps wallet and history when notice reads and writes fail', async () => {
    mockStorage.getItem.mockRejectedValueOnce(new Error('device storage unavailable'));
    mockStorage.setItem.mockRejectedValueOnce(new Error('device storage write failed'));
    mockGetMyCoinBalance.mockResolvedValue(3500);
    mockListCoinHistory.mockResolvedValue([ledgerEntry('earn-two', 'earn', 100, 'Eligible completed booking')]);

    renderCoins();
    latestFocusCallback()?.();
    await settle();

    const tree = renderCoins();
    expect(findElements(tree, 'ErrorState')).toHaveLength(0);
    expect(visibleText(tree)).toContain('₹35');
    expect(visibleText(tree)).toContain('Booking reward');
    expect(findElements(tree, 'InlineAlert').some((element) => element.props.title === 'Coin denomination updated')).toBe(true);

    const notice = findElements(tree, 'InlineAlert').find((element) => element.props.title === 'Coin denomination updated');
    expect(notice).toBeDefined();
    (notice?.props.onAction as () => void)();
    await settle();

    const afterDismiss = renderCoins();
    expect(findElements(afterDismiss, 'ErrorState')).toHaveLength(0);
    expect(findElements(afterDismiss, 'InlineAlert').some((element) => element.props.title === 'Notice preference unavailable')).toBe(true);
    expect(visibleText(afterDismiss)).toContain('₹35');
    expect(visibleText(afterDismiss)).toContain('Booking reward');
  });

  it('ID-COIN-BOTH-OFF keeps positive and negative history readable', async () => {
    mockGetMyCoinBalance.mockResolvedValue(2500);
    mockGetCoinsConfig.mockResolvedValue(coinConfig({
      coins_earning_enabled: false,
      coins_redemption_enabled: false,
    }));
    mockListCoinHistory.mockResolvedValue([
      ledgerEntry('earn-three', 'earn', 500, 'Eligible completed booking'),
      ledgerEntry('refund-three', 'clawback', -200, 'Refund adjustment'),
    ]);

    renderCoins();
    latestFocusCallback()?.();
    await settle();

    const tree = renderCoins();
    const text = visibleText(tree);
    expect(text).toContain('History');
    expect(text).toContain('Earning is paused.');
    expect(text).toContain('Redemption is paused.');
    expect(text).toContain('Booking reward');
    expect(text).toContain('Refund adjustment');
    expect(compactText(tree)).toContain('+₹5');
    expect(compactText(tree)).toContain('-₹2');
  });

  it('ID-COIN-PAUSED-EMPTY treats zero and empty as loaded without encouraging earning', async () => {
    mockGetMyCoinBalance.mockResolvedValue(0);
    mockGetCoinsConfig.mockResolvedValue(coinConfig({
      coins_earning_enabled: false,
      coins_redemption_enabled: false,
    }));
    mockListCoinHistory.mockResolvedValue([]);

    renderCoins();
    latestFocusCallback()?.();
    await settle();

    const tree = renderCoins();
    const text = visibleText(tree);
    expect(findElements(tree, 'ErrorState')).toHaveLength(0);
    expect(text).toContain('₹0');
    expect(text).toContain('No coin activity yet');
    expect(text).toContain('Earning is paused.');
    expect(text).not.toContain('Eligible completed bookings may earn coins.');
    expect(text).not.toContain('earn your first reward');
  });

  it('ID-COIN-DELTA-PRESERVE retains all ledger kinds, signs, dates, reasons and non-cash copy', async () => {
    mockGetMyCoinBalance.mockResolvedValue(600);
    mockGetCoinsConfig.mockResolvedValue(coinConfig({
      coins_earning_enabled: false,
      coins_redemption_enabled: false,
    }));
    mockListCoinHistory.mockResolvedValue([
      ledgerEntry('earn', 'earn', 100, 'Earn reason'),
      ledgerEntry('bonus', 'bonus', 200, 'Bonus reason'),
      ledgerEntry('redeem', 'redeem', -300, 'Redeem reason'),
      ledgerEntry('expire', 'expire', -400, 'Expiry reason'),
      ledgerEntry('clawback', 'clawback', -500, 'Clawback reason'),
      ledgerEntry('admin', 'admin', 600, 'Admin reason'),
    ]);

    renderCoins();
    latestFocusCallback()?.();
    await settle();

    const tree = renderCoins();
    const text = visibleText(tree);
    for (const label of ['Booking reward', 'Bonus', 'Used on booking', 'Expired', 'Refund adjustment', 'Account adjustment']) {
      expect(text).toContain(label);
    }
    for (const amount of ['+₹1', '+₹2', '-₹3', '-₹4', '-₹5', '+₹6']) expect(compactText(tree)).toContain(amount);
    for (const reason of ['Earn reason', 'Bonus reason', 'Redeem reason', 'Expiry reason', 'Clawback reason', 'Admin reason']) {
      expect(text).toContain(reason);
    }
    expect(text).toContain(new Date('2026-03-04T12:00:00.000Z').toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }));
    expect(text).toContain('expires 10 Mar');
    expect(text).toContain('Seva Coins are not cash, are non-transferable, and can only be used inside QuickServe.');
  });

  it('shows eligible completed-booking copy for an enabled earning policy and a loaded-empty wallet', async () => {
    mockGetMyCoinBalance.mockResolvedValue(0);
    mockListCoinHistory.mockResolvedValue([]);
    mockGetCoinsConfig.mockResolvedValue(coinConfig({ coins_earning_enabled: true }));

    renderCoins();
    latestFocusCallback()?.();
    await settle();

    const text = visibleText(renderCoins());
    expect(text).toContain('No coin activity yet');
    expect(text).toContain('Eligible completed bookings may earn coins.');
  });
});

import type React from 'react';
import type { PaymentSchedule } from '../../../lib/types';

const mockRuntime: {
  id: string;
  userId: string;
  status: string;
  archetype: string;
  hookIndex: number;
  states: unknown[];
  effects: Array<() => void | (() => void)>;
  load: ((guard: { isCurrent: () => boolean }) => Promise<void>) | null;
  refresh: (() => Promise<void>) | null;
  lastRefresh: Promise<void> | null;
  subscriptions: Array<{ id: string; paymentIds: string[]; cleanup: jest.Mock }>;
} = {
  id: 'booking-a',
  userId: 'customer-a',
  status: 'quote_sent',
  archetype: 'inspect_quote',
  hookIndex: 0,
  states: [],
  effects: [],
  load: null,
  refresh: null,
  lastRefresh: null,
  subscriptions: [],
};

const mockRealtimeChannel = {
  on: jest.fn(),
  subscribe: jest.fn(),
};
const mockSupabase = {
  channel: jest.fn(() => mockRealtimeChannel),
  removeChannel: jest.fn(async () => 'ok'),
};
mockRealtimeChannel.on.mockReturnValue(mockRealtimeChannel);
mockRealtimeChannel.subscribe.mockReturnValue(mockRealtimeChannel);

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useCallback: (callback: unknown) => {
      mockRuntime.hookIndex++;
      return callback;
    },
    useEffect: (effect: () => void | (() => void)) => {
      mockRuntime.hookIndex++;
      mockRuntime.effects.push(effect);
    },
    useMemo: (factory: () => unknown) => {
      mockRuntime.hookIndex++;
      return factory();
    },
    useRef: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!(index in mockRuntime.states)) mockRuntime.states[index] = { current: initial };
      return mockRuntime.states[index];
    },
    useState: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!(index in mockRuntime.states)) mockRuntime.states[index] = initial;
      return [
        mockRuntime.states[index],
        (next: unknown) => {
          mockRuntime.states[index] = typeof next === 'function'
            ? (next as (previous: unknown) => unknown)(mockRuntime.states[index])
            : next;
        },
      ];
    },
  };
});

jest.mock('react-native', () => ({
  Linking: { openURL: jest.fn() },
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  View: 'View',
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: mockRuntime.id }),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  FadeInDown: { duration: jest.fn() },
}));
jest.mock('../../../components/QuoteView', () => ({ QuoteView: 'QuoteView' }));
jest.mock('../../../components/status', () => ({ statusLabel: new Proxy({}, { get: (_target, key) => String(key) }) }));
jest.mock('../../../components/UnreadChat', () => ({ ChatButton: 'ChatButton' }));
jest.mock('../../../components/ui', () => ({
  Avatar: 'Avatar',
  Button: 'Button',
  Card: 'Card',
  Chip: 'Chip',
  Divider: 'Divider',
  ErrorState: 'ErrorState',
  Header: 'Header',
  IconButton: 'IconButton',
  InlineAlert: 'InlineAlert',
  RatingStars: 'RatingStars',
  Screen: 'Screen',
  Section: 'Section',
  Skeleton: 'Skeleton',
  Text: 'Text',
  TextArea: 'TextArea',
  useConfirm: () => jest.fn(async () => true),
  useToast: () => jest.fn(),
}));
jest.mock('../../../lib/api', () => ({
  getBooking: jest.fn(),
  getQuotes: jest.fn(),
  getPayments: jest.fn(),
  getEvents: jest.fn(),
  getBookingOtps: jest.fn(),
  getBookingAddress: jest.fn(),
  getReviewForBooking: jest.fn(),
  getProfileName: jest.fn(),
  signedPhotoUrls: jest.fn(),
  listPaymentSchedule: jest.fn(),
  getCoinRedemptionPreview: jest.fn(),
  subscribeToBooking: jest.fn(),
  approveQuote: jest.fn(),
}));
jest.mock('../../../lib/auth', () => ({ useAuth: () => ({ userId: mockRuntime.userId }) }));
jest.mock('../../../lib/config', () => ({
  isDemoMode: false,
  supportContact: { email: 'support@example.test' },
}));
jest.mock('../../../lib/creatorRevisions', () => ({
  creatorRevisionsEnabled: jest.fn(),
  requestCreatorRevision: jest.fn(),
}));
jest.mock('../../../lib/haptics', () => ({ haptics: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../../../lib/payments', () => ({ usePayment: () => jest.fn(async () => 'paid') }));
jest.mock('../../../lib/push', () => ({ registerForPush: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({ supabase: mockSupabase }));
jest.mock('../../../lib/unreadContext', () => ({ useUnread: () => ({ countFor: () => 0 }) }));
jest.mock('../../../theme', () => ({
  useTheme: () => ({
    spacing: new Proxy({}, { get: () => 8 }),
    radii: new Proxy({}, { get: () => 12 }),
    colors: new Proxy({}, { get: () => '#222' }),
  }),
}));
jest.mock('../../../lib/useEntityRefresh', () => ({
  useEntityRefresh: (load: (guard: { isCurrent: () => boolean }) => Promise<void>) => {
    mockRuntime.load = load;
    const refresh = () => {
      mockRuntime.lastRefresh = load({ isCurrent: () => true });
      return mockRuntime.lastRefresh;
    };
    mockRuntime.refresh = refresh;
    return { refresh, refreshing: false };
  },
}));
jest.mock('../ActionsRow', () => ({ ActionsRow: 'ActionsRow', OtpCard: 'OtpCard' }));
jest.mock('../CancelSection', () => ({ CancelSection: 'CancelSection' }));
jest.mock('../DeliverySection', () => ({ DeliverySection: 'DeliverySection' }));
jest.mock('../PaymentsSection', () => ({ PaymentsSection: 'PaymentsSection' }));
jest.mock('../StatusHeader', () => ({ StatusHeader: 'StatusHeader' }));

const ReactRuntime = require('react') as typeof React;
const api = require('../../../lib/api') as Record<string, jest.Mock>;
const BookingDetailScreen = require('../BookingDetailScreen').default as typeof import('../BookingDetailScreen').default;
const PaymentScheduleTimeline = require('../../catalogue/PaymentScheduleTimeline').PaymentScheduleTimeline as
  typeof import('../../catalogue/PaymentScheduleTimeline').PaymentScheduleTimeline;
const { subscribeToBooking } = require('../../../lib/supabaseApi') as typeof import('../../../lib/supabaseApi');

function booking(id: string) {
  return {
    id,
    customer_id: mockRuntime.userId,
    provider_id: 'provider-a',
    status: mockRuntime.status,
    archetype: mockRuntime.archetype,
    created_at: '2026-11-20T10:00:00.000Z',
    scheduled_at: '2026-12-15T10:00:00.000Z',
    visit_fee: 19900,
    platform_fee: 2900,
    total_amount: 19900,
    coin_discount: 0,
    refund_amount: 0,
    approved_quote_id: null,
    cancelled_reason: null,
    photos: [],
    delivery_links: [],
    categories: { name: `Service ${id}`, slug: 'repair', review_tags: [] },
    providers: null,
  };
}

function quote(id: string, version: number, total: number) {
  return {
    id,
    booking_id: mockRuntime.id,
    version,
    status: 'sent',
    total,
    is_change_order: false,
    note: `Revision ${version}`,
  };
}

function schedule(id: string, status: PaymentSchedule['status']): PaymentSchedule {
  return {
    id,
    booking_id: mockRuntime.id,
    seq: 1,
    label: 'Milestone',
    amount: 10000,
    due_rule: 'at_booking',
    due_at: '2026-12-15T10:00:00.000Z',
    status,
    purpose: 'milestone',
    obligation_kind: 'service',
    payment_id: '00000000-0000-4000-8000-000000000001',
    reminded_at: null,
    paid_at: status === 'paid' ? '2026-11-20T10:00:00.000Z' : null,
  };
}

function elements(node: unknown, type: string): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  return [
    ...(element.type === type ? [element] : []),
    ...elements(element.props.children, type),
  ];
}

function renderScreen() {
  mockRuntime.hookIndex = 0;
  mockRuntime.effects = [];
  return BookingDetailScreen();
}

function validGuard() {
  return { isCurrent: () => true };
}

beforeEach(() => {
  mockRuntime.id = 'booking-a';
  mockRuntime.userId = 'customer-a';
  mockRuntime.status = 'quote_sent';
  mockRuntime.archetype = 'inspect_quote';
  mockRuntime.hookIndex = 0;
  mockRuntime.states = [];
  mockRuntime.effects = [];
  mockRuntime.load = null;
  mockRuntime.refresh = null;
  mockRuntime.lastRefresh = null;
  mockRuntime.subscriptions = [];
  jest.clearAllMocks();
  mockRealtimeChannel.on.mockReturnValue(mockRealtimeChannel);
  mockRealtimeChannel.subscribe.mockReturnValue(mockRealtimeChannel);
  mockSupabase.channel.mockReturnValue(mockRealtimeChannel);
  mockSupabase.removeChannel.mockResolvedValue('ok');
  api.getBooking.mockImplementation(async (id: string) => booking(id));
  api.getQuotes.mockImplementation(async () => [quote('quote-a', 1, 50000)]);
  api.getPayments.mockResolvedValue([]);
  api.getEvents.mockResolvedValue([]);
  api.getBookingOtps.mockResolvedValue(null);
  api.getBookingAddress.mockResolvedValue(null);
  api.getReviewForBooking.mockResolvedValue(null);
  api.getProfileName.mockResolvedValue('Provider A');
  api.signedPhotoUrls.mockResolvedValue([]);
  api.listPaymentSchedule.mockResolvedValue([]);
  api.getCoinRedemptionPreview.mockResolvedValue(null);
  api.subscribeToBooking.mockImplementation((id: string, _onChange: () => void, paymentIds: string[] = []) => {
    const cleanup = jest.fn();
    mockRuntime.subscriptions.push({ id, paymentIds, cleanup });
    return cleanup;
  });
});

describe('booking detail readback', () => {
  it('sameStatusQuoteRevision', async () => {
    api.getQuotes
      .mockResolvedValueOnce([quote('quote-a', 1, 50000)])
      .mockResolvedValueOnce([quote('quote-a', 2, 65000)]);

    renderScreen();
    await mockRuntime.load!(validGuard());
    const firstTree = renderScreen();
    expect(elements(firstTree, 'QuoteView')[0]?.props.quote).toMatchObject({ version: 1, total: 50000 });

    await mockRuntime.load!(validGuard());
    const revisedTree = renderScreen();
    expect(elements(revisedTree, 'StatusHeader')[0]?.props.status).toBe('quote_sent');
    expect(elements(revisedTree, 'QuoteView')[0]?.props.quote).toMatchObject({ version: 2, total: 65000 });
  });

  it('scheduleFailureRetry', async () => {
    mockRuntime.status = 'pending_payment';
    mockRuntime.archetype = 'proposal';
    api.getQuotes.mockResolvedValue([]);
    api.listPaymentSchedule
      .mockRejectedValueOnce(new Error('schedule unavailable'))
      .mockResolvedValueOnce([schedule('schedule-a', 'due')]);

    renderScreen();
    await mockRuntime.load!(validGuard());
    let tree = renderScreen();
    let header = elements(tree, 'StatusHeader')[0]!;
    expect(header.props.paymentSchedule).toBeNull();
    expect(header.props.scheduleError).toBe('schedule unavailable');
    expect(elements(tree, 'Screen')[0]?.props.footer).toBeUndefined();

    const timeline = PaymentScheduleTimeline({
      bookingId: mockRuntime.id,
      items: null,
      loading: false,
      error: 'schedule unavailable',
      onRetry: header.props.onRetry as () => void,
      canPay: true,
      onPayDue: jest.fn(),
      paying: false,
    });
    const retry = elements(timeline, 'ErrorState')[0];
    expect(retry?.props.message).toBe('schedule unavailable');
    (retry?.props.onRetry as () => void)();
    await mockRuntime.lastRefresh;

    tree = renderScreen();
    header = elements(tree, 'StatusHeader')[0]!;
    expect(header.props.scheduleError).toBeNull();
    expect(header.props.paymentSchedule).toMatchObject([{ id: 'schedule-a', status: 'due' }]);
  });

  it('refundAndReviewReadback', async () => {
    mockRuntime.status = 'completed';
    const payment = {
      id: 'payment-a',
      booking_id: mockRuntime.id,
      amount: 10000,
      status: 'paid',
      refunds: [],
    };
    const review = { id: 'review-a', booking_id: mockRuntime.id, rating: 5, comment: 'Great work' };
    api.getQuotes.mockResolvedValue([]);
    api.getPayments.mockResolvedValueOnce([payment]).mockResolvedValueOnce([{
      ...payment,
      refunds: [{ id: 'refund-a', amount: 2000, status: 'processed' }],
    }]);
    api.getReviewForBooking.mockResolvedValueOnce(null).mockResolvedValueOnce(review);
    api.listPaymentSchedule
      .mockResolvedValueOnce([schedule('schedule-a', 'due')])
      .mockResolvedValueOnce([schedule('schedule-a', 'paid')]);

    renderScreen();
    await mockRuntime.load!(validGuard());
    const initialTree = renderScreen();
    expect(elements(initialTree, 'Section').some((item) => item.props.title === 'Your review')).toBe(false);

    await mockRuntime.load!(validGuard());
    const updatedTree = renderScreen();
    expect(elements(updatedTree, 'PaymentsSection')[0]?.props.payments).toMatchObject([{
      id: 'payment-a',
      refunds: [{ id: 'refund-a', amount: 2000, status: 'processed' }],
    }]);
    expect(elements(updatedTree, 'Section').some((item) => item.props.title === 'Your review')).toBe(true);
    expect(elements(updatedTree, 'StatusHeader')[0]?.props.paymentSchedule).toMatchObject([
      { id: 'schedule-a', status: 'paid' },
    ]);
  });

  it('olderLoadIgnored', async () => {
    let resolveOlder!: (value: ReturnType<typeof booking>) => void;
    const olderBooking = new Promise<ReturnType<typeof booking>>((resolve) => { resolveOlder = resolve; });
    api.getBooking.mockImplementation((id: string) => id === 'booking-a' ? olderBooking : Promise.resolve(booking(id)));

    renderScreen();
    let olderCurrent = true;
    const olderLoad = mockRuntime.load!({ isCurrent: () => olderCurrent });

    mockRuntime.id = 'booking-b';
    olderCurrent = false;
    renderScreen();
    await mockRuntime.load!(validGuard());
    resolveOlder(booking('booking-a'));
    await olderLoad;

    const tree = renderScreen();
    expect(elements(tree, 'Header')[0]?.props.title).toBe('Service booking-b');
    expect(elements(tree, 'Header')[0]?.props.title).not.toBe('Service booking-a');
  });

  it('cleanupSubscriptions', async () => {
    renderScreen();
    const firstCleanup = mockRuntime.effects[1]!();
    expect(mockRuntime.subscriptions[0]).toMatchObject({ id: 'booking-a', paymentIds: [] });

    await mockRuntime.load!(validGuard());
    renderScreen();
    const secondCleanup = mockRuntime.effects[1]!();
    expect(mockRuntime.subscriptions[1]).toMatchObject({
      id: 'booking-a',
      paymentIds: ['00000000-0000-4000-8000-000000000001'],
    });
    (firstCleanup as () => void)();
    (secondCleanup as () => void)();
    expect(mockRuntime.subscriptions.map((subscription) => subscription.cleanup.mock.calls.length)).toEqual([1, 1]);

    const callback = jest.fn();
    const unsubscribe = subscribeToBooking('booking-a', callback, [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
    const bindings = mockRealtimeChannel.on.mock.calls.map((call) => call[1] as {
      table: string;
      filter?: string;
    });
    expect(bindings.map((binding) => binding.table)).toEqual([
      'bookings', 'quotes', 'payment_schedule', 'booking_events', 'payments', 'reviews', 'refunds', 'refunds',
    ]);
    expect(bindings[0]?.filter).toBe('id=eq.booking-a');
    expect(bindings[bindings.length - 2]?.filter).toBe('payment_id=eq.00000000-0000-4000-8000-000000000001');
    expect(bindings[bindings.length - 1]?.filter).toBe('payment_id=eq.00000000-0000-4000-8000-000000000002');
    unsubscribe();
    expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockRealtimeChannel);
  });
});

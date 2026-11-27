import type React from 'react';
import type { ProviderService } from '../../lib/types';

const mockRuntime = { hookIndex: 0, states: [] as unknown[], refs: [] as Array<{ current: unknown } | undefined> };
const mockUseFocusEffect = jest.fn();
const mockRouter = { push: jest.fn() };
const mockListMyServices = jest.fn();
const mockGetProviderDetail = jest.fn();
const mockUpsertService = jest.fn();
const mockDeleteService = jest.fn();
const mockToast = jest.fn();

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

jest.mock('expo-router', () => ({ router: mockRouter, useFocusEffect: mockUseFocusEffect }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  Switch: 'Switch',
  View: 'View',
}));
jest.mock('../../lib/api', () => ({
  deleteService: mockDeleteService,
  getProviderDetail: mockGetProviderDetail,
  listMyServices: mockListMyServices,
  upsertService: mockUpsertService,
}));
jest.mock('../../lib/money', () => ({
  formatINR: (value: number) => `₹${value}`,
  rupeesToPaise: (value: number) => Math.round(value * 100),
}));
jest.mock('../../theme', () => ({
  useTheme: jest.fn(),
}));
jest.mock('../CategoryIcon', () => ({ CategoryIcon: 'CategoryIcon', iconForSlug: () => 'hammer' }));
jest.mock('../ProviderCard', () => ({ skillLabel: { beginner: 'Beginner', skilled: 'Skilled', expert: 'Expert', certified: 'Certified' } }));
jest.mock('../ui', () => ({
  BottomSheet: 'BottomSheet',
  Button: 'Button',
  Card: 'Card',
  Chip: 'Chip',
  Divider: 'Divider',
  InlineAlert: 'InlineAlert',
  Input: 'Input',
  LIST_INSET: 16,
  ListItem: 'ListItem',
  RatingStars: 'RatingStars',
  SegmentedControl: 'SegmentedControl',
  Skeleton: 'Skeleton',
  Text: 'Text',
  useToast: jest.fn(),
}));

const ReactRuntime = require('react') as typeof import('react');
const { router, useFocusEffect } = require('expo-router') as typeof import('expo-router');
const { getProviderDetail, listMyServices, upsertService, deleteService } = require('../../lib/api') as typeof import('../../lib/api');
const { ProviderMeSections } = require('../ProviderMeSections') as typeof import('../ProviderMeSections');
const { useTheme } = require('../../theme') as typeof import('../../theme');
const { useToast } = require('../ui') as typeof import('../ui');
const mockListServices = listMyServices as jest.MockedFunction<typeof import('../../lib/api').listMyServices>;
const mockGetDetails = getProviderDetail as jest.MockedFunction<typeof import('../../lib/api').getProviderDetail>;
const mockSaveService = upsertService as jest.MockedFunction<typeof import('../../lib/api').upsertService>;
const mockRemoveService = deleteService as jest.MockedFunction<typeof import('../../lib/api').deleteService>;
const mockUseTheme = useTheme as jest.Mock;
const mockUseToast = useToast as jest.Mock;

const provider = {
  id: 'owner-1',
  kyc_status: 'verified',
  service_radius_km: 15,
  rating_avg: 4.8,
  rating_count: 2,
} as never;

const service = {
  id: 'service-1',
  category_id: 'category-1',
  skill_level: 'skilled',
  visit_fee: 100,
  labour_rate: 200,
  rate_unit: 'job',
  active: false,
  categories: { name: 'Repair', slug: 'repair' },
} as ProviderService;

function findElements(node: unknown, type: string): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, type));
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  if (typeof element.type === 'function') {
    return findElements((element.type as (props: Record<string, unknown>) => unknown)(element.props), type);
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
  const props = element.props;
  return [
    ...(['title', 'subtitle', 'value', 'message'] as const).flatMap((key) =>
      typeof props[key] === 'string' ? [props[key] as string] : [],
    ),
    ...renderedText(props.children),
  ];
}

function button(tree: unknown, title: string) {
  return findElements(tree, 'Button').find((element) => element.props.title === title);
}

function press(element: React.ReactElement<Record<string, unknown>> | undefined) {
  const onPress = element?.props.onPress;
  if (typeof onPress === 'function') (onPress as () => void)();
}

function renderSections(value: unknown = provider) {
  mockRuntime.hookIndex = 0;
  return ProviderMeSections({ provider: value as never });
}

function runFocusedLoad() {
  const callback = mockUseFocusEffect.mock.calls[mockUseFocusEffect.mock.calls.length - 1]?.[0];
  if (typeof callback === 'function') return (callback as () => unknown)();
  return undefined;
}

async function drainMicrotasks() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

beforeEach(() => {
  mockRuntime.hookIndex = 0;
  mockRuntime.states = [];
  mockRuntime.refs = [];
  mockUseFocusEffect.mockReset();
  mockRouter.push.mockReset();
  mockListServices.mockReset().mockResolvedValue([service]);
  mockGetDetails.mockReset().mockResolvedValue({ reviews: [] } as never);
  mockSaveService.mockReset().mockResolvedValue(undefined);
  mockRemoveService.mockReset().mockResolvedValue(undefined);
  mockToast.mockReset();
  mockUseToast.mockReturnValue(mockToast);
  mockUseTheme.mockReturnValue({
    spacing: { sm: 8, md: 12, lg: 16 },
    radii: { sm: 8, lg: 12 },
    colors: { success: '#0a0', outline: '#ccc', primaryText: '#00f', onPrimary: '#fff', surfaceAlt: '#eee' },
  });
});

describe('ProviderMeSections identity labels and read errors', () => {
  it('ID-SERVICE-ENABLED-NOT-LIVE calls an enabled service enabled, not live', async () => {
    mockListServices.mockResolvedValueOnce([service]).mockResolvedValueOnce([{ ...service, active: true }]);
    renderSections();
    runFocusedLoad();
    await drainMicrotasks();
    const tree = renderSections();
    const toggle = findElements(tree, 'Switch')[0];

    expect(toggle?.props.value).toBe(false);
    const onValueChange = toggle?.props.onValueChange;
    if (typeof onValueChange === 'function') (onValueChange as (value: boolean) => void)(true);
    await drainMicrotasks();

    expect(mockSaveService).toHaveBeenCalledWith({
      categoryId: service.category_id,
      skillLevel: service.skill_level,
      visitFee: service.visit_fee,
      labourRate: service.labour_rate,
      rateUnit: service.rate_unit,
    });
    expect(mockToast).toHaveBeenCalledWith({ message: 'Repair is enabled', tone: 'success' });
    expect(mockToast.mock.calls[0][0].message).not.toContain('live');
  });

  it('ID-REVIEWS-ERROR-NOT-EMPTY shows a review-specific retry without retrying services', async () => {
    mockGetDetails.mockRejectedValueOnce(new Error('Reviews unavailable')).mockResolvedValueOnce({
      reviews: [{ id: 'review-1', rating: 5, created_at: '2026-01-01T00:00:00Z', comment: 'Good work', provider_reply: null }],
    } as never);
    renderSections();
    runFocusedLoad();
    await drainMicrotasks();
    const failed = renderSections();

    expect(renderedText(failed).join(' ')).toContain('Reviews unavailable');
    expect(renderedText(failed).join(' ')).not.toContain('No reviews yet');
    press(button(failed, 'Retry reviews'));
    await drainMicrotasks();
    const retried = renderSections();

    expect(renderedText(retried).join(' ')).toContain('Good work');
    expect(mockListServices).toHaveBeenCalledTimes(1);
    expect(mockGetDetails).toHaveBeenCalledTimes(2);
  });

  it('ID-MEMBER-NO-OWNER-KYC hides payout controls from a delegated business context', async () => {
    const delegatedProvider = {
      id: 'owner-2',
      business_role: 'staff',
      service_radius_km: 15,
      rating_avg: 4.8,
      rating_count: 2,
    };
    renderSections(delegatedProvider);
    runFocusedLoad();
    await drainMicrotasks();
    const tree = renderSections(delegatedProvider);
    const payoutItem = findElements(tree, 'ListItem').find((element) =>
      typeof element.props.title === 'string' && element.props.title.startsWith('Payout account'),
    );

    expect(payoutItem).toBeUndefined();
    expect(renderedText(tree).join(' ')).not.toContain('Payout verified');
  });

  it('ID-SERVICE-READ-ERROR shows a service-specific retry without a false empty state', async () => {
    mockListServices.mockRejectedValueOnce(new Error('Services unavailable')).mockResolvedValueOnce([service]);
    renderSections();
    runFocusedLoad();
    await drainMicrotasks();
    const failed = renderSections();

    expect(renderedText(failed).join(' ')).toContain('Services unavailable');
    expect(renderedText(failed).join(' ')).not.toContain('Add your first service');
    press(button(failed, 'Retry services'));
    await drainMicrotasks();

    expect(mockListServices).toHaveBeenCalledTimes(2);
    expect(mockGetDetails).toHaveBeenCalledTimes(1);
  });

  it('ID-SERVICE-WRITE-ROLLBACK restores the previous service state when saving fails', async () => {
    mockListServices.mockResolvedValueOnce([service]).mockResolvedValueOnce([service]);
    mockSaveService.mockRejectedValueOnce(new Error('Service update denied'));
    renderSections();
    runFocusedLoad();
    await drainMicrotasks();

    const toggle = findElements(renderSections(), 'Switch')[0];
    const onValueChange = toggle?.props.onValueChange;
    if (typeof onValueChange === 'function') (onValueChange as (value: boolean) => void)(true);
    await drainMicrotasks();

    expect(findElements(renderSections(), 'Switch')[0]?.props.value).toBe(false);
    expect(mockToast).toHaveBeenCalledWith({ message: 'Service update denied', tone: 'error' });
  });

  it('labels provider verification as payout verification, independently of service state', async () => {
    mockListServices.mockResolvedValueOnce([]);
    renderSections();
    runFocusedLoad();
    await drainMicrotasks();

    const text = renderedText(renderSections()).join(' ');
    expect(text).toContain('Payout verified');
    expect(text).not.toContain('Payout account & KYC Verified');
  });
});

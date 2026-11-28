jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
}));
jest.mock('../../../components/status', () => ({ StatusPill: 'StatusPill' }));
jest.mock('../../../components/ui', () => ({
  Button: 'Button',
  Card: 'Card',
  Chip: 'Chip',
  EmptyState: 'EmptyState',
  ErrorState: 'ErrorState',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Screen: 'Screen',
  Skeleton: 'Skeleton',
  SkeletonCard: 'SkeletonCard',
  Text: 'Text',
  TextArea: 'TextArea',
  useConfirm: () => jest.fn(),
  useToast: () => jest.fn(),
}));
jest.mock('../../../components/market/BookingStepLayout', () => ({ BookingStepLayout: 'BookingStepLayout' }));
jest.mock('../../../components/market/PriceFooter', () => ({ PriceFooter: 'PriceFooter' }));
jest.mock('../../../branding/useBrandIdentity', () => ({
  useBrandIdentity: () => ({ displayName: 'Nearo' }),
}));
jest.mock('../../../lib/auth', () => ({ useAuth: () => ({ userId: 'customer-1' }) }));
jest.mock('../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({ isOn: () => false }),
  useFeature: () => true,
}));
jest.mock('../../../lib/fixedBooking', () => ({ listFixedPackages: jest.fn() }));
jest.mock('../../../lib/locationContext', () => ({ useSelectedLocation: () => ({ location: {} }) }));
jest.mock('../../../lib/money', () => ({ formatINR: (value: number) => `₹${value}` }));
jest.mock('../../../lib/onboarding', () => ({ onboardingApi: { getProviderSchedule: jest.fn() } }));
jest.mock('../../../lib/payments', () => ({ usePayment: () => jest.fn() }));
jest.mock('../../../lib/schedule', () => ({
  istDateKey: () => '2026-12-01',
  nextDays: () => [],
  WINDOW_START_HOURS: [9],
}));
jest.mock('../../../lib/api', () => ({ getProviderService: jest.fn() }));
jest.mock('../../../i18n', () => ({ useT: () => (key: string) => key }));
jest.mock('../../../theme', () => ({ useTheme: () => ({ spacing: {}, radii: {}, colors: {} }) }));
jest.mock('../../merchantStaff/api', () => ({
  getMyProviderBusinessContext: jest.fn(),
  listMyBusinessMemberships: jest.fn(),
}));
jest.mock('../api', () => ({
  cancelRecurringPlan: jest.fn(),
  createRecurringPlan: jest.fn(),
  getRecurringPlan: jest.fn(),
  pauseRecurringPlan: jest.fn(),
  quoteRecurringPlan: jest.fn(),
  respondVisitReschedule: jest.fn(),
  resumeRecurringPlan: jest.fn(),
  skipRecurringVisit: jest.fn(),
}));
jest.mock('../providerApi', () => ({
  getProviderRecurringPlan: jest.fn(),
  listProviderRecurringSchedule: jest.fn(),
  reportProviderAbsence: jest.fn(),
  requestVisitReschedule: jest.fn(),
  respondVisitReschedule: jest.fn(),
}));
jest.mock('../../serviceLifecycle/useFocusedServiceRefresh', () => ({
  useFocusedServiceRefresh: () => ({ refresh: jest.fn(), refreshing: false }),
}));

import { providerVisitSections } from '../providerPresentation';
import { isFeatureOn } from '../../../lib/featureFlagModel';
import {
  customerPlanLayoutOrder,
  currentDueOccurrence,
} from '../../serviceScreens/RecurringDetailScreen';
import {
  providerBusinessSummary,
  providerPlanLayoutOrder,
} from '../../serviceScreens/RecurringProviderDetailScreen';
import {
  recurringCreationBlocker,
  recurringCreationLayoutOrder,
} from '../../serviceScreens/RecurringNewDetailScreen';
import {
  calendarLayoutOrder,
  providerCalendarPlanRoute,
} from '../../serviceScreens/MerchantCalendarScreen';
import { providerCalendarVisitRoute } from '../providerPresentation';

describe('O17 recurring layout placement', () => {
  it('uses the parent-gated recurring layout leaf and keeps the legacy composition otherwise', () => {
    expect(isFeatureOn({ oorva_brand: true, oorva_recurring_ux: true }, 'oorva_recurring_ux')).toBe(true);
    expect(isFeatureOn({ oorva_brand: false, oorva_recurring_ux: true }, 'oorva_recurring_ux')).toBe(false);
    expect(isFeatureOn({ oorva_brand: true, oorva_recurring_ux: false }, 'oorva_recurring_ux')).toBe(false);
  });

  it('customerActionPriority puts the current payable visit before decisions and history', () => {
    const visits = [
      { id: 'later-due', scheduled_at: '2027-01-03T10:00:00Z', can_pay: true, remaining_due_paise: 4000 },
      { id: 'earlier-not-due', scheduled_at: '2027-01-01T10:00:00Z', can_pay: false, remaining_due_paise: 0 },
      { id: 'current-due', scheduled_at: '2027-01-02T10:00:00Z', can_pay: true, remaining_due_paise: 2500 },
    ];

    expect(currentDueOccurrence(visits)?.id).toBe('current-due');
    expect(customerPlanLayoutOrder(true)).toEqual([
      'plan',
      'due',
      'decisions',
      'upcoming',
      'history',
      'management',
    ]);
    expect(customerPlanLayoutOrder(false)).toEqual([
      'plan',
      'upcoming',
      'history',
      'management',
      'invalidTime',
    ]);
  });

  it('providerBusinessContext places the resolved business and timezone before plan actions', () => {
    expect(providerBusinessSummary('Madhapur Services', 'Hyderabad', 'Asia/Kolkata'))
      .toBe('Madhapur Services · Hyderabad · Asia/Kolkata');
    expect(providerPlanLayoutOrder(true)).toEqual([
      'business',
      'plan',
      'conflicts',
      'decisions',
      'upcoming',
      'completed',
      'history',
    ]);
    expect(providerPlanLayoutOrder(false)).toEqual([
      'conflicts',
      'plan',
      'upcoming',
      'completed',
      'history',
    ]);
  });

  it('exhaustiveHistory retains every occurrence exactly once in the history sections', () => {
    const visits = [
      { id: 'past-open', scheduled_at: '2026-11-20T10:00:00Z', status: 'accepted' },
      { id: 'future-open', scheduled_at: '2026-12-20T10:00:00Z', status: 'requested' },
      { id: 'completed', scheduled_at: '2026-11-21T10:00:00Z', status: 'completed' },
      { id: 'terminal', scheduled_at: '2026-12-21T10:00:00Z', status: 'expired' },
      { id: 'unknown', scheduled_at: '2026-11-22T10:00:00Z', status: 'new_status' },
      { id: 'invalid-time', scheduled_at: 'not-a-date', status: 'accepted' },
    ];
    const sections = providerVisitSections(visits, Date.parse('2026-11-25T00:00:00Z'));
    const shown = [...sections.upcoming, ...sections.completed, ...sections.otherHistory];

    expect(shown.map(({ id }) => id).sort()).toEqual(visits.map(({ id }) => id).sort());
    expect(new Set(shown.map(({ id }) => id)).size).toBe(visits.length);
  });

  it('compactCreationReview keeps a single compact footer and reports the actual request blocker', () => {
    expect(recurringCreationLayoutOrder(true)).toEqual([
      'provider',
      'package',
      'schedule',
      'end',
      'address',
      'review',
      'payment',
      'errors',
      'footer',
    ]);
    expect(recurringCreationLayoutOrder(false)).toEqual([
      'schedule',
      'package',
      'end',
      'address',
      'payment',
      'errors',
      'footer',
    ]);
    expect(recurringCreationBlocker({
      quoteLoading: false,
      quoteReady: true,
      scheduleReady: true,
      addressReady: false,
      instructionsReady: true,
    })).toBe('Add a saved address to continue.');
    expect(recurringCreationBlocker({
      quoteLoading: false,
      quoteReady: true,
      scheduleReady: true,
      addressReady: true,
      instructionsReady: true,
    })).toBeNull();
  });

  it('calendarDayWeekLinks keeps business context first and links each visit and plan by exact id', () => {
    expect(calendarLayoutOrder(true)).toEqual(['business', 'toolbar', 'visits']);
    expect(providerCalendarVisitRoute('occurrence-exact-pk')).toEqual({
      pathname: '/booking/[id]',
      params: { id: 'occurrence-exact-pk' },
    });
    expect(providerCalendarPlanRoute('plan-exact-pk', 'provider-exact-pk')).toEqual({
      pathname: '/recurring/provider/[id]',
      params: { id: 'plan-exact-pk', providerId: 'provider-exact-pk' },
    });
    expect(calendarLayoutOrder(false)).toEqual(['toolbar', 'visits']);
  });
});

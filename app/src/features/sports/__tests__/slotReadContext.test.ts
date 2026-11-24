jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: () => false, replace: jest.fn() },
}));
jest.mock('react-native', () => ({ Pressable: 'Pressable', View: 'View' }));
jest.mock('../../../components/market/PriceFooter', () => ({ PriceFooter: () => null }));
jest.mock('../../../components/ui', () => ({
  Button: () => null,
  Card: () => null,
  EmptyState: () => null,
  ErrorState: () => null,
  Header: () => null,
  InlineAlert: () => null,
  Input: () => null,
  Screen: () => null,
  Skeleton: () => null,
  Text: () => null,
  TextArea: () => null,
  useToast: jest.fn(),
}));
jest.mock('../../../i18n', () => ({ useT: jest.fn() }));
jest.mock('../../../lib/authGate', () => ({ requireSignIn: jest.fn() }));
jest.mock('../../../lib/featureFlags', () => ({ useAppFeatureFlags: jest.fn() }));
jest.mock('../../../lib/money', () => ({ formatINR: jest.fn() }));
jest.mock('../../../theme', () => ({ useTheme: jest.fn() }));
jest.mock('../api', () => ({
  bookSportsSlot: jest.fn(),
  getCustomerSportsVenue: jest.fn(),
  getSportsSlots: jest.fn(),
}));
jest.mock('../bookingPresentation', () => ({ sportsVenueBookingReturnTo: jest.fn() }));
jest.mock('../useSportsReadRefresh', () => ({ useSportsReadRefresh: jest.fn() }));

import {
  areSportsSlotContextIdentitiesEqual,
  createSportsBookingIdempotencyKeyManager,
  createSportsSlotRequestTracker,
  isSportsSlotSelectionCurrent,
  type SportsSlotContextIdentity,
} from '../SportsVenueBookingScreen';

function context(overrides: Partial<SportsSlotContextIdentity> = {}): SportsSlotContextIdentity {
  return {
    venueId: 'venue-a',
    resourceId: 'court-a',
    date: '2026-11-25',
    participants: 1,
    sportsEnabled: true,
    multiSlotEnabled: false,
    ...overrides,
  };
}

const currentGuard = { isCurrent: () => true };

describe('SP-T10 slot read context', () => {
  it('SP-OUT-OF-ORDER-SUCCESS: an older success cannot replace slots from the current request', () => {
    const tracker = createSportsSlotRequestTracker();
    const requestA = tracker.begin(context());
    const requestB = tracker.begin(context({ venueId: 'venue-b', resourceId: 'court-b' }));
    let visibleSlots = 'slots-b';

    const currentApplied = tracker.runIfCurrent(requestB, currentGuard, () => {
      visibleSlots = 'slots-b';
    });
    const staleApplied = tracker.runIfCurrent(requestA, currentGuard, () => {
      visibleSlots = 'slots-a';
    });
    expect(JSON.stringify({ currentApplied, staleApplied, visibleSlots })).toBe(JSON.stringify({
      currentApplied: true,
      staleApplied: false,
      visibleSlots: 'slots-b',
    }));
  });

  it('SP-OUT-OF-ORDER-ERROR: an older error cannot replace current request state', () => {
    const tracker = createSportsSlotRequestTracker();
    const requestA = tracker.begin(context());
    const requestB = tracker.begin(context({ date: '2026-11-26' }));
    let visibleError: string | null = null;

    const currentApplied = tracker.runIfCurrent(requestB, currentGuard, () => {
      visibleError = null;
    });
    const staleApplied = tracker.runIfCurrent(requestA, currentGuard, () => {
      visibleError = 'A failed';
    });
    expect(JSON.stringify({ currentApplied, staleApplied, visibleError })).toBe(JSON.stringify({
      currentApplied: true,
      staleApplied: false,
      visibleError: null,
    }));
  });

  it('SP-SELECTED-CONTEXT-GUARD: venue, resource, date, and participant identity must match booking context', () => {
    const selected = context();
    const tracker = createSportsSlotRequestTracker();
    const readContext = tracker.begin(selected);
    const selection = { startsAt: '2026-11-25T10:00:00.000Z', context: readContext };

    const matchesCurrent = areSportsSlotContextIdentitiesEqual(selected, context());
    const matchesOtherResource = areSportsSlotContextIdentitiesEqual(selected, context({ resourceId: 'court-b' }));
    const matchesOtherParticipants = areSportsSlotContextIdentitiesEqual(selected, context({ participants: 2 }));
    const canBookCurrent = isSportsSlotSelectionCurrent(selection, context(), readContext);
    const canBookOtherVenue = isSportsSlotSelectionCurrent(selection, context({ venueId: 'venue-b' }), readContext);
    expect(JSON.stringify({
      generation: selection.context.generation,
      matchesCurrent,
      matchesOtherResource,
      matchesOtherParticipants,
      canBookCurrent,
      canBookOtherVenue,
    })).toBe(JSON.stringify({
      generation: 1,
      matchesCurrent: true,
      matchesOtherResource: false,
      matchesOtherParticipants: false,
      canBookCurrent: true,
      canBookOtherVenue: false,
    }));
  });

  it('SP-IDEMPOTENT-RETRY: unchanged retries reuse a key and changed requests receive a new key', () => {
    const createKey = jest.fn()
      .mockReturnValueOnce('retry-key')
      .mockReturnValueOnce('changed-request-key');
    const keys = createSportsBookingIdempotencyKeyManager(createKey);

    const first = keys.getFor('same-request');
    const retry = keys.getFor('same-request');
    const changed = keys.getFor('changed-request');
    expect(JSON.stringify({ first, retry, changed, createCalls: createKey.mock.calls.length })).toBe(JSON.stringify({
      first: 'retry-key',
      retry: 'retry-key',
      changed: 'changed-request-key',
      createCalls: 2,
    }));
  });

  it('SP-PARENT-OFF-INVALIDATION: disabling sports invalidates a pending discovery read', () => {
    const tracker = createSportsSlotRequestTracker();
    const pending = tracker.begin(context());
    tracker.invalidate();
    let stateApplied = false;

    const applied = tracker.runIfCurrent(pending, currentGuard, () => {
      stateApplied = true;
    });
    expect(JSON.stringify({ applied, stateApplied })).toBe(JSON.stringify({
      applied: false,
      stateApplied: false,
    }));
  });
});

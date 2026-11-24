jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: () => false, replace: jest.fn() },
}));
jest.mock('react-native', () => ({ Pressable: 'Pressable', View: 'View' }));
jest.mock('../../../../components/market/PriceFooter', () => ({ PriceFooter: () => null }));
jest.mock('../../../../components/ui', () => ({
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
jest.mock('../../../../i18n', () => ({ useT: jest.fn() }));
jest.mock('../../../../lib/authGate', () => ({ requireSignIn: jest.fn() }));
jest.mock('../../../../lib/featureFlags', () => ({ useAppFeatureFlags: jest.fn() }));
jest.mock('../../../../lib/money', () => ({ formatINR: jest.fn() }));
jest.mock('../../../../theme', () => ({ useTheme: jest.fn() }));
jest.mock('../../api', () => ({
  bookSportsSlot: jest.fn(),
  getCustomerSportsVenue: jest.fn(),
  getSportsSlots: jest.fn(),
}));
jest.mock('../../bookingPresentation', () => ({ sportsVenueBookingReturnTo: jest.fn() }));
jest.mock('../../useSportsReadRefresh', () => ({ useSportsReadRefresh: jest.fn() }));

import {
  areSportsSlotContextIdentitiesEqual,
  createSportsBookingIdempotencyKeyManager,
  createSportsSlotRequestTracker,
  isSportsSlotSelectionCurrent,
  type SportsSlotContextIdentity,
} from '../../SportsVenueBookingScreen';

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
  it('SP-OUT-OF-ORDER-SUCCESS: only the latest venue/resource/date/participant request can apply', () => {
    const tracker = createSportsSlotRequestTracker();
    const stale = tracker.begin(context());
    const latest = tracker.begin(context({
      venueId: 'venue-b',
      resourceId: 'court-b',
      date: '2026-11-26',
      participants: 2,
    }));
    let appliedGeneration = 0;

    const latestApplied = tracker.runIfCurrent(latest, currentGuard, () => {
      appliedGeneration = latest.generation;
    });
    const staleApplied = tracker.runIfCurrent(stale, currentGuard, () => {
      appliedGeneration = stale.generation;
    });
    expect(JSON.stringify({ latestApplied, staleApplied, appliedGeneration, latestGeneration: latest.generation })).toBe(
      JSON.stringify({
        latestApplied: true,
        staleApplied: false,
        appliedGeneration: latest.generation,
        latestGeneration: latest.generation,
      }),
    );
  });

  it('SP-OUT-OF-ORDER-ERROR: an old request error is discarded after context changes', () => {
    const tracker = createSportsSlotRequestTracker();
    const stale = tracker.begin(context());
    tracker.begin(context({ participants: 3 }));
    let error: string | null = null;

    const applied = tracker.runIfCurrent(stale, currentGuard, () => {
      error = 'stale failure';
    });
    expect(JSON.stringify({ applied, error })).toBe(JSON.stringify({ applied: false, error: null }));
  });

  it('SP-SELECTED-CONTEXT-GUARD: a selection from another venue or date cannot book', () => {
    const selected = context();
    const read = createSportsSlotRequestTracker().begin(selected);
    const selection = { startsAt: '2026-11-25T10:00:00.000Z', context: read };

    const matchesOtherVenue = areSportsSlotContextIdentitiesEqual(selected, context({ venueId: 'venue-b' }));
    const matchesOtherDate = areSportsSlotContextIdentitiesEqual(selected, context({ date: '2026-11-26' }));
    const matchesCurrent = areSportsSlotContextIdentitiesEqual(selected, context());
    const canBookCurrent = isSportsSlotSelectionCurrent(selection, context(), read);
    const canBookOtherDate = isSportsSlotSelectionCurrent(selection, context({ date: '2026-11-26' }), read);
    expect(JSON.stringify({ matchesOtherVenue, matchesOtherDate, matchesCurrent, canBookCurrent, canBookOtherDate })).toBe(JSON.stringify({
      matchesOtherVenue: false,
      matchesOtherDate: false,
      matchesCurrent: true,
      canBookCurrent: true,
      canBookOtherDate: false,
    }));
  });

  it('SP-IDEMPOTENT-RETRY: resetting after a semantic change does not reuse the previous request key', () => {
    const createKey = jest.fn()
      .mockReturnValueOnce('first-key')
      .mockReturnValueOnce('next-key');
    const keys = createSportsBookingIdempotencyKeyManager(createKey);

    const first = keys.getFor('same-request');
    const retry = keys.getFor('same-request');
    keys.reset();
    const afterReset = keys.getFor('same-request');
    expect(JSON.stringify({ first, retry, afterReset, createCalls: createKey.mock.calls.length })).toBe(JSON.stringify({
      first: 'first-key',
      retry: 'first-key',
      afterReset: 'next-key',
      createCalls: 2,
    }));
  });
});

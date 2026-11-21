jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../lib/adminApi', () => ({ getAppFeatures: jest.fn() }));
jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

import type { AppFeatures } from '../../lib/featureFlags';
import {
  DEFAULT_FEATURES,
  acceptsFeatureControlSequence,
  featureControlAfterRefreshError,
  featureFlagsView,
  getGuestRouteDisposition,
  hasFeatureControlDecision,
  parseAppearanceCache,
  parseFeatureResponse,
  parseFlagsCache,
} from '../FeatureFlagsProvider';

function makeFeatures(overrides: Record<string, unknown> = {}): AppFeatures {
  return {
    ...DEFAULT_FEATURES,
    guest_browse: false,
    oorva_brand: false,
    oorva_home_ux: false,
    ...overrides,
  } as AppFeatures;
}

describe('shared feature-control state', () => {
  it('hydrates cached guest controls offline and preserves archetypes after refresh failure', () => {
    const cached = makeFeatures({
      guest_browse: true,
      archetypes: { inspect_quote: false, fixed: true, time_based: true, proposal: false },
    });
    const hydrated = parseFlagsCache(JSON.stringify({ version: 1, features: cached }));
    expect(hydrated).toEqual(cached);

    const afterFailure = featureControlAfterRefreshError(
      { features: hydrated!, freshness: 'cache', appearanceCandidate: undefined },
      true,
    );
    const flags = featureFlagsView(afterFailure.features);

    expect(afterFailure.freshness).toBe('error');
    expect(flags.isOn('guest_browse')).toBe(true);
    expect(flags.archetypes).toEqual(cached.archetypes);
  });

  it('accepts valid OFF flags while passing an invalid appearance candidate through unchanged', () => {
    const candidate = { schemaVersion: 999, assets: ['missing://logo.png'] };
    const response = parseFeatureResponse({
      features: makeFeatures({ oorva_brand: false, oorva_home_ux: false }),
      appearanceCandidate: candidate,
    });

    expect(response?.appearanceCandidate).toEqual(candidate);
    expect(featureFlagsView(response!.features).isOn('oorva_brand')).toBe(false);
    expect(featureFlagsView(response!.features).isOn('oorva_home_ux')).toBe(false);
    expect(response?.features.archetypes).toEqual(DEFAULT_FEATURES.archetypes);
  });

  it('uses the exact legacy defaults when no valid cache is available', () => {
    const initial = {
      features: DEFAULT_FEATURES,
      freshness: 'fallback' as const,
      appearanceCandidate: undefined,
    };
    const fallback = featureControlAfterRefreshError(initial, false);

    expect(fallback.freshness).toBe('fallback');
    expect(fallback.features).toEqual(DEFAULT_FEATURES);
    expect(featureFlagsView(fallback.features).isOn('ai_assistant')).toBe(true);
    expect(featureFlagsView(fallback.features).isOn('guest_browse')).toBe(false);
    expect(fallback.features.archetypes).toEqual(DEFAULT_FEATURES.archetypes);
  });

  it('waits for delayed saved guest flags after the 250ms deadline, then allows the cached guest', () => {
    const savedFeatures = makeFeatures({ guest_browse: true });
    const delayedCacheValue = JSON.stringify({ version: 1, features: savedFeatures });
    const route = ['category', 'cleaning'];
    const isPotentialGuestEntryRoute = route[0] === 'category';
    const stillPendingAfterDeadline = hasFeatureControlDecision(false, false);

    expect(stillPendingAfterDeadline).toBe(false);
    expect(
      getGuestRouteDisposition({
        controlsReady: stillPendingAfterDeadline,
        restoreStatus: 'known-null',
        inAuthGroup: false,
        onPublicPage: false,
        potentialGuestEntryRoute: isPotentialGuestEntryRoute,
        canEnterAsGuest: false,
      }),
    ).toBe('wait');

    const cachedFeatures = parseFlagsCache(delayedCacheValue)!;
    const cachedGuestBrowse = featureFlagsView(cachedFeatures).isOn('guest_browse');
    expect(cachedGuestBrowse).toBe(true);
    expect(
      getGuestRouteDisposition({
        controlsReady: hasFeatureControlDecision(true, false),
        restoreStatus: 'known-null',
        inAuthGroup: false,
        onPublicPage: false,
        potentialGuestEntryRoute: isPotentialGuestEntryRoute,
        canEnterAsGuest: cachedGuestBrowse && isPotentialGuestEntryRoute,
      }),
    ).toBe('guest');
  });

  it('fails closed once cache resolution confirms there is no valid guest snapshot', () => {
    const controlsReady = hasFeatureControlDecision(true, false);
    const guestBrowse = featureFlagsView(DEFAULT_FEATURES).isOn('guest_browse');

    expect(controlsReady).toBe(true);
    expect(guestBrowse).toBe(false);
    expect(
      getGuestRouteDisposition({
        controlsReady,
        restoreStatus: 'known-null',
        inAuthGroup: false,
        onPublicPage: false,
        potentialGuestEntryRoute: true,
        canEnterAsGuest: false,
      }),
    ).toBe('redirect');
  });

  it('keeps flag and appearance caches separate and ignores invalid cache encodings', () => {
    const features = makeFeatures({ guest_browse: true });
    expect(parseFlagsCache(JSON.stringify({ version: 1, features }))).toEqual(features);
    expect(parseAppearanceCache(JSON.stringify({ version: 1, candidate: { version: 99 } }))).toEqual({
      found: true,
      candidate: { version: 99 },
    });
    expect(parseFlagsCache('not-json')).toBeNull();
    expect(parseAppearanceCache('not-json')).toEqual({ found: false });
  });

  it('rejects stale request results after a newer response has settled', () => {
    expect(acceptsFeatureControlSequence(3, 2)).toBe(true);
    expect(acceptsFeatureControlSequence(2, 3)).toBe(false);
  });
});

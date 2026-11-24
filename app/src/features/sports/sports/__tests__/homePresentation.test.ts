import { getSportsHomePresentation, shouldLoadSportsBusinessVenues } from '../../api';
import { isSportsFamilyUxEnabled } from '../../../sportsScreens/SportsIndexScreen';

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    push: jest.fn(),
    replace: jest.fn(),
  },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('react-native', () => ({
  View: 'View',
  useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../../components/market/ListingCard', () => ({ ListingCard: 'ListingCard' }));
jest.mock('../../../../components/ui', () => ({
  Card: 'Card',
  EmptyState: 'EmptyState',
  ErrorState: 'ErrorState',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Screen: 'Screen',
  Skeleton: 'Skeleton',
  Text: 'Text',
}));
jest.mock('../../../../lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('../../../../lib/featureFlags', () => ({ useAppFeatureFlags: jest.fn() }));
jest.mock('../../../../theme', () => ({ useTheme: jest.fn() }));

jest.mock('../../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

function expectJson(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

function presentation(overrides: Partial<Parameters<typeof getSportsHomePresentation>[0]> = {}) {
  return getSportsHomePresentation({
    userId: 'customer-1',
    sportsEnabled: true,
    familyUxEnabled: false,
    merchantStaffEnabled: false,
    discoveryState: 'ready',
    businessVenuesLoaded: true,
    businessVenues: [],
    ...overrides,
  });
}

describe('sports home independent sections', () => {
  it('SP-HISTORY-INDEPENDENT: keeps signed-in history navigation through discovery OFF, loading, error, and empty states', () => {
    const states = [
      presentation({ sportsEnabled: false }),
      presentation({ discoveryState: 'loading' }),
      presentation({ discoveryState: 'error' }),
      presentation({ discoveryState: 'empty' }),
    ];

    expectJson(states.map((state) => state.showHistoryNavigation), [
      true,
      true,
      true,
      true,
    ]);
    expectJson(states[0], {
      composition: 'legacy',
      showHistoryNavigation: true,
      showDiscovery: false,
      discoveryState: 'off',
      businessActions: [],
    });
  });

  it('SP-GUEST-PRIVATE-DENY: hides history and avoids the private business read for guests', () => {
    const guest = presentation({
      userId: null,
      businessVenues: [{
        venue: { id: 'v1', owner_id: 'owner-1', business_role: 'owner', name: 'Private venue' },
      }],
    });
    const shouldLoadPrivateBusinessRead = shouldLoadSportsBusinessVenues(null, true);

    expectJson(guest.showHistoryNavigation, false);
    expectJson(guest.businessActions, []);
    expectJson(shouldLoadPrivateBusinessRead, false);
  });

  it('does not request business discovery when actual sports is off', () => {
    const shouldLoadPrivateBusinessRead = shouldLoadSportsBusinessVenues('customer-1', false);
    const sportsOff = presentation({ sportsEnabled: false });

    expectJson(shouldLoadPrivateBusinessRead, false);
    expectJson(sportsOff, {
      composition: 'legacy',
      showHistoryNavigation: true,
      showDiscovery: false,
      discoveryState: 'off',
      businessActions: [],
    });
  });

  it('uses the parent-resolved family selector without enabling it by default', () => {
    const legacy = presentation({ familyUxEnabled: false });
    const family = presentation({ familyUxEnabled: true });

    expectJson(legacy.composition, 'legacy');
    expectJson(family.composition, 'family');
  });

  it('SP-FAMILY-PARENT-OFF: selects legacy when either sports UX or the brand parent is off', () => {
    const actual = [
      isSportsFamilyUxEnabled(false, false),
      isSportsFamilyUxEnabled(true, false),
      isSportsFamilyUxEnabled(false, true),
      isSportsFamilyUxEnabled(true, true),
    ];
    const parentOff = presentation({
      familyUxEnabled: isSportsFamilyUxEnabled(true, false),
    });

    expectJson({
      effectiveFamilySelector: actual,
      parentOffComposition: parentOff.composition,
    }, {
      effectiveFamilySelector: [false, false, false, true],
      parentOffComposition: 'legacy',
    });
  });
});

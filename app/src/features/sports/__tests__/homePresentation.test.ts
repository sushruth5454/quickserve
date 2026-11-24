import {
  getSportsHomeBusinessActions,
  listMyBusinessSportsVenues,
  type SportsHomeBusinessVenue,
} from '../api';
import { supabase } from '../../../lib/supabase';
import { getSportsVenueCardPresentation } from '../../sportsScreens/SportsDetailScreen';
import { getSportsActivityGridColumns } from '../../sportsScreens/SportsIndexScreen';
import { getSportsVenueGalleryPresentation } from '../SportsVenueBookingScreen';

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

jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

const rpc = supabase.rpc as jest.Mock;

function expectJson(actual: unknown, expected: unknown): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

function businessVenue(ownerId: string, businessRole: 'owner' | 'manager' | 'staff'): SportsHomeBusinessVenue {
  return {
    venue: {
      id: `${ownerId}-${businessRole}`,
      owner_id: ownerId,
      business_role: businessRole,
      name: `${businessRole} venue`,
    },
  };
}

describe('sports home business navigation', () => {
  beforeEach(() => jest.resetAllMocks());

  it('SP-ACTUAL-OWNER-NAVROLE: uses authorized venue ownership instead of provider activeRole', () => {
    const ownerActions = getSportsHomeBusinessActions({
      userId: 'owner-1',
      sportsEnabled: true,
      merchantStaffEnabled: false,
      businessVenuesLoaded: true,
      businessVenues: [businessVenue('owner-1', 'owner')],
    });
    const providerNonOwnerActions = getSportsHomeBusinessActions({
      userId: 'provider-1',
      sportsEnabled: true,
      merchantStaffEnabled: false,
      businessVenuesLoaded: true,
      businessVenues: [],
    });

    expectJson(ownerActions, [{
      kind: 'owner',
      title: 'My venues',
      subtitle: 'Manage your sports venues',
      href: '/sports/manage',
      readOnly: false,
    }]);
    expectJson(providerNonOwnerActions, [{
      kind: 'onboarding',
      title: 'List a venue',
      subtitle: 'Add a sports venue you own',
      href: '/sports/manage',
      readOnly: false,
    }]);
  });

  it('SP-ASSIGNED-READONLY: exposes assigned work only while effective merchant_staff is on', () => {
    const assignedVenue = businessVenue('owner-1', 'staff');
    const assignedActions = getSportsHomeBusinessActions({
      userId: 'staff-1',
      sportsEnabled: true,
      merchantStaffEnabled: true,
      businessVenuesLoaded: true,
      businessVenues: [assignedVenue],
    });
    const featureOffActions = getSportsHomeBusinessActions({
      userId: 'staff-1',
      sportsEnabled: true,
      merchantStaffEnabled: false,
      businessVenuesLoaded: true,
      businessVenues: [assignedVenue],
    });

    expectJson(assignedActions, [{
      kind: 'assigned',
      title: 'Assigned business work',
      subtitle: 'View read-only sports bookings shared with you',
      href: '/sports/manage',
      readOnly: true,
    }]);
    expectJson(featureOffActions, []);
  });

  it('SP-LIST-VENUE: offers existing self-onboarding only after an authorized empty read', () => {
    const actions = getSportsHomeBusinessActions({
      userId: 'customer-1',
      sportsEnabled: true,
      merchantStaffEnabled: true,
      businessVenuesLoaded: true,
      businessVenues: [],
    });
    const unresolvedActions = getSportsHomeBusinessActions({
      userId: 'customer-1',
      sportsEnabled: true,
      merchantStaffEnabled: true,
      businessVenuesLoaded: false,
      businessVenues: [],
    });

    expectJson(actions, [{
      kind: 'onboarding',
      title: 'List a venue',
      subtitle: 'Add a sports venue you own',
      href: '/sports/manage',
      readOnly: false,
    }]);
    expectJson(unresolvedActions, []);
  });

  it('reads business context through the existing authorized sports RPC', async () => {
    const venues = [businessVenue('owner-1', 'owner')];
    rpc.mockResolvedValueOnce({ data: venues, error: null });

    const result = await listMyBusinessSportsVenues();

    const calls = rpc.mock.calls;
    expectJson(calls, [['get_my_business_sports_venues']]);
    expectJson(result, venues);
  });

  it('SP-T14: keeps sports venue titles and per-slot prices explicit with real compact metadata', () => {
    const title = 'North Court Sports and Recreation Association - Indoor Badminton Centre';
    const familyCard = getSportsVenueCardPresentation({
      id: 'venue-1',
      name: title,
      description: '',
      address_line: '7 Sample Road',
      city: 'Hyderabad',
      area: 'Madhapur',
      photos: ['hero.jpg'],
      distance_km: 0.9,
      min_price_paise: 123456,
    }, true);
    const legacyCard = getSportsVenueCardPresentation({
      id: 'venue-1',
      name: title,
      description: '',
      address_line: '7 Sample Road',
      city: 'Hyderabad',
      area: 'Madhapur',
      photos: ['hero.jpg'],
      distance_km: 0.9,
      min_price_paise: 123456,
    }, false);

    expectJson({
      family: familyCard,
      legacy: {
        presentation: legacyCard.presentation,
        title: legacyCard.title,
        priceLabel: legacyCard.priceLabel,
      },
    }, {
      family: {
        title,
        subtitle: 'Madhapur, Hyderabad · 0.9 km away',
        imageUrl: 'hero.jpg',
        verified: true,
        priceLabel: 'From ₹1,234.56 / slot',
        presentation: 'oorva',
      },
      legacy: {
        presentation: 'legacy',
        title,
        priceLabel: 'From ₹1,234.56 / slot',
      },
    });
  });

  it('SP-T14: keeps booking choice ahead of the expandable gallery and adapts activity cards to narrow or large text', () => {
    const photos = Array.from({ length: 12 }, (_, index) => `photo-${index + 1}.jpg`);
    const familyGallery = getSportsVenueGalleryPresentation(photos, true);
    const legacyGallery = getSportsVenueGalleryPresentation(photos, false);

    expectJson({
      familyGallery: {
        heroImage: familyGallery.heroImage,
        additionalCount: familyGallery.additionalImages.length,
        expandable: familyGallery.expandable,
        legacyImageCount: familyGallery.legacyImages.length,
      },
      legacyGallery: {
        heroImage: legacyGallery.heroImage,
        expandable: legacyGallery.expandable,
        imageCount: legacyGallery.legacyImages.length,
      },
      gridColumns: [
        getSportsActivityGridColumns(320, 1),
        getSportsActivityGridColumns(390, 1),
        getSportsActivityGridColumns(390, 1.4),
      ],
    }, {
      familyGallery: {
        heroImage: 'photo-1.jpg',
        additionalCount: 11,
        expandable: true,
        legacyImageCount: 0,
      },
      legacyGallery: {
        heroImage: null,
        expandable: false,
        imageCount: 12,
      },
      gridColumns: [1, 2, 1],
    });
  });
});

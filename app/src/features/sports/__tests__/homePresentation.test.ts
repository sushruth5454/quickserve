import {
  getSportsHomeBusinessActions,
  listMyBusinessSportsVenues,
  type SportsHomeBusinessVenue,
} from '../api';
import { supabase } from '../../../lib/supabase';

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
});

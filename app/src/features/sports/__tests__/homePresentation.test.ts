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
      businessVenues: [businessVenue('owner-1', 'owner')],
    });

    expect(ownerActions, JSON.stringify(ownerActions)).toEqual([
      expect.objectContaining({ kind: 'owner', title: 'My venues', href: '/sports/manage', readOnly: false }),
    ]);
    expect(providerNonOwnerActions, JSON.stringify(providerNonOwnerActions)).toEqual([
      expect.objectContaining({ kind: 'onboarding', title: 'List a venue', href: '/sports/manage', readOnly: false }),
    ]);
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

    expect(assignedActions, JSON.stringify(assignedActions)).toEqual([
      expect.objectContaining({
        kind: 'assigned',
        title: 'Assigned business work',
        href: '/sports/manage',
        readOnly: true,
      }),
    ]);
    expect(featureOffActions, JSON.stringify(featureOffActions)).toEqual([]);
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

    expect(actions, JSON.stringify(actions)).toEqual([
      expect.objectContaining({ kind: 'onboarding', title: 'List a venue' }),
    ]);
    expect(unresolvedActions, JSON.stringify(unresolvedActions)).toEqual([]);
  });

  it('reads business context through the existing authorized sports RPC', async () => {
    const venues = [businessVenue('owner-1', 'owner')];
    rpc.mockResolvedValueOnce({ data: venues, error: null });

    const result = await listMyBusinessSportsVenues();

    const calls = rpc.mock.calls;
    expect(calls, JSON.stringify(calls)).toContainEqual(['get_my_business_sports_venues']);
    expect(result, JSON.stringify(result)).toEqual(venues);
  });
});

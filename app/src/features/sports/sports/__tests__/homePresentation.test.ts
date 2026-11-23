import { getSportsHomePresentation, shouldLoadSportsBusinessVenues } from '../../api';

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

    expect(states.map((state) => state.showHistoryNavigation), JSON.stringify(states)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(states[0], JSON.stringify(states[0])).toMatchObject({
      composition: 'legacy',
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

    expect(guest.showHistoryNavigation, JSON.stringify(guest)).toBe(false);
    expect(guest.businessActions, JSON.stringify(guest)).toEqual([]);
    expect(shouldLoadPrivateBusinessRead, JSON.stringify({ shouldLoadPrivateBusinessRead })).toBe(false);
  });

  it('does not request business discovery when actual sports is off', () => {
    const shouldLoadPrivateBusinessRead = shouldLoadSportsBusinessVenues('customer-1', false);
    const sportsOff = presentation({ sportsEnabled: false });

    expect(shouldLoadPrivateBusinessRead, JSON.stringify({ shouldLoadPrivateBusinessRead })).toBe(false);
    expect(sportsOff, JSON.stringify(sportsOff)).toMatchObject({
      showHistoryNavigation: true,
      showDiscovery: false,
      discoveryState: 'off',
      businessActions: [],
    });
  });

  it('uses the parent-resolved family selector without enabling it by default', () => {
    const legacy = presentation({ familyUxEnabled: false });
    const family = presentation({ familyUxEnabled: true });

    expect(legacy.composition, JSON.stringify(legacy)).toBe('legacy');
    expect(family.composition, JSON.stringify(family)).toBe('family');
  });
});

import {
  getBookingsForVenue,
  getHoursDraftFromRows,
  getManagementLoadPresentation,
  getManagementScreenMode,
  getResourceDraftFromRecord,
  getResourceSelectionContext,
  getVenueDraftFromRecord,
  isActualVenueOwner,
  mergeResourceDraftWithBaseline,
  mergeVenueDraftWithBaseline,
  resolveSelectedVenueId,
  type HoursDraftValues,
  type ResourceDraftValues,
  type VenueDraftValues,
} from '../useSportsVenueManagementState';
import type { ManagementVenue, Resource, SportsBookingRow } from '../types';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../../../../lib/featureFlags', () => ({ useAppFeatureFlags: jest.fn() }));
jest.mock('../../../../lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('../../../../lib/locationContext', () => ({ useSelectedLocation: jest.fn() }));
jest.mock('../../../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const venueRecord: ManagementVenue['venue'] = {
  id: 'venue-owned',
  owner_id: 'owner-1',
  business_role: 'manager',
  name: 'East Court',
  description: 'Covered',
  address_line: '4 Market Road',
  city: 'Pune',
  area: 'Camp',
  lat: 18.52,
  lng: 73.85,
  amenities: ['Parking', 'Lights'],
  photos: ['https://example.test/court.jpg'],
  status: 'verified',
  status_reason: '',
  payment_modes: ['pay_at_venue'],
};

const venue = (id: string, ownerId: string, businessRole: 'owner' | 'manager' | 'staff'): ManagementVenue => ({
  venue: { ...venueRecord, id, owner_id: ownerId, business_role: businessRole },
  resources: [],
  hours: [],
  price_rules: [],
  blocks: [],
});

describe('SP-AUTOSELECT-HYDRATE', () => {
  it('hydrates every server resource field, including the snake-case booking mode', () => {
    const resource: Resource = {
      id: 'resource-9',
      name: 'Tournament court',
      activity_id: 'activity-2',
      activity_name: 'Tennis',
      slot_minutes: 90,
      active: false,
      booking_mode: 'instant',
      capacity: 8,
    };

    expect(getResourceDraftFromRecord(resource, 'fallback')).toEqual({
      activityId: 'activity-2',
      resourceName: 'Tournament court',
      slotMinutes: '90',
      bookingMode: 'instant',
      capacity: '8',
    });
  });
});

describe('SP-HOURS-CONTEXT', () => {
  it('loads the selected weekday row and treats a missing row as closed only after the read completes', () => {
    const hours = [
      { weekday: 1, opens: '07:30:00', closes: '21:00:00' },
      { weekday: 2, opens: '09:00:00', closes: '18:30:00' },
    ];
    const fallback: HoursDraftValues = { opens: '08:00', closes: '20:00', closed: false };

    expect(getHoursDraftFromRows(hours, 2, true, fallback)).toEqual({
      opens: '09:00',
      closes: '18:30',
      closed: false,
    });
    expect(getHoursDraftFromRows([], 2, false, fallback)).toEqual(fallback);
    expect(getHoursDraftFromRows([], 2, true, fallback)).toEqual({
      opens: '08:00',
      closes: '20:00',
      closed: true,
    });
    expect(getResourceSelectionContext('venue-owned', 'resource-1'))
      .not.toBe(getResourceSelectionContext('venue-owned', 'resource-2'));
    expect(getResourceSelectionContext('venue-owned', 'resource-1'))
      .not.toBe(getResourceSelectionContext('venue-other', 'resource-1'));
  });
});

describe('SP-INITIAL-LOAD and SP-ASSIGNED-ERROR', () => {
  it('shows loading or retryable error instead of Create/no-bookings before the first successful read', () => {
    expect(getManagementLoadPresentation(true, false, null)).toBe('loading');
    expect(getManagementLoadPresentation(false, false, null)).toBe('loading');
    expect(getManagementLoadPresentation(false, false, 'assigned booking read failed')).toBe('error');
    expect(getManagementLoadPresentation(false, true, 'background refresh failed')).toBe('ready');
  });
});

describe('SP-DIRTY-REFRESH', () => {
  it('refreshes clean venue/resource fields while retaining dirty draft text', () => {
    const baseline: VenueDraftValues = {
      ...getVenueDraftFromRecord(venueRecord, {} as VenueDraftValues),
      name: 'Server name after review',
    };
    const draft: VenueDraftValues = { ...baseline, name: 'My unsaved name', description: 'Local note' };
    const merged = mergeVenueDraftWithBaseline(
      baseline,
      draft,
      new Set<keyof VenueDraftValues>(['name', 'description']),
    );
    expect(merged.name).toBe('My unsaved name');
    expect(merged.description).toBe('Local note');
    expect(merged.address).toBe('4 Market Road');

    const resourceBaseline: ResourceDraftValues = {
      activityId: 'activity-2',
      resourceName: 'Server resource',
      slotMinutes: '90',
      bookingMode: 'instant',
      capacity: '8',
    };
    const resourceDraft: ResourceDraftValues = { ...resourceBaseline, resourceName: 'Unsaved court name' };
    expect(mergeResourceDraftWithBaseline(
      resourceBaseline,
      resourceDraft,
      new Set<keyof ResourceDraftValues>(['resourceName']),
    )).toEqual({
      ...resourceBaseline,
      resourceName: 'Unsaved court name',
    });
  });
});

describe('SP-MULTI-ASSIGNED-SELECTOR and SP-MIXED-OWNER-MEMBER', () => {
  it('keeps any selected accessible venue and resolves a removed selection without sorting', () => {
    const venues = [
      venue('assigned-2', 'owner-2', 'staff'),
      venue('owned-1', 'user-1', 'manager'),
      venue('assigned-1', 'owner-3', 'owner'),
    ];
    const ownedVenue = venues.find((item) => item.venue.id === 'owned-1');
    const roleLabelOnlyOwner = venues.find((item) => item.venue.id === 'assigned-1');
    if (!ownedVenue || !roleLabelOnlyOwner) throw new Error('test venues were not constructed');

    expect(resolveSelectedVenueId(venues, 'owned-1', false)).toBe('owned-1');
    expect(resolveSelectedVenueId(venues, 'revoked-membership', false)).toBe('assigned-2');
    expect(resolveSelectedVenueId(venues, '', true)).toBe('');
    expect(isActualVenueOwner(ownedVenue.venue, 'user-1')).toBe(true);
    expect(isActualVenueOwner(roleLabelOnlyOwner.venue, 'user-1')).toBe(false);
    expect(getManagementScreenMode(true, ownedVenue.venue, 'user-1')).toBe('owner');
    expect(getManagementScreenMode(true, roleLabelOnlyOwner.venue, 'user-1')).toBe('assigned');
    expect(getManagementScreenMode(false, ownedVenue.venue, 'user-1')).toBe('existing-bookings');
  });
});

describe('SP-REVOKED-MEMBER', () => {
  it('removes bookings from the revoked venue instead of mixing another venue’s rows', () => {
    const bookings = [
      { id: 'booking-a', venue_id: 'venue-a', owner_id: 'owner-a' },
      { id: 'booking-b', venue_id: 'venue-b', owner_id: 'owner-b' },
    ] as SportsBookingRow[];

    expect(getBookingsForVenue(bookings, 'venue-a').map((booking) => booking.id)).toEqual(['booking-a']);
    expect(getBookingsForVenue(bookings, '')).toEqual([]);
    expect(getBookingsForVenue(bookings, 'revoked-venue')).toEqual([]);
  });
});

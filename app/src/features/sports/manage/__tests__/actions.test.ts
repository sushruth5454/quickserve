import { supabase } from '../../../../lib/supabase';
import { createSportsVenueManagementActions } from '../actions';
import type { useSportsVenueManagementState } from '../useSportsVenueManagementState';

jest.mock('../../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

const savedVenue = {
  id: 'venue-1',
  owner_id: 'owner-1',
  name: 'North Court',
  description: 'Indoor court',
  address_line: '12 Main Road',
  city: 'Pune',
  area: 'Shivaji Nagar',
  lat: 18.52,
  lng: 73.85,
  amenities: ['Parking'],
  photos: ['https://example.test/one.jpg'],
  status: 'verified',
  status_reason: '',
  payment_modes: ['pay_at_venue' as const],
};

function makeState(status = 'verified') {
  const venue = { ...savedVenue, status };
  return {
    selectedId: venue.id,
    selected: { venue, resources: [], hours: [], price_rules: [], blocks: [] },
    name: venue.name,
    description: venue.description,
    address: venue.address_line,
    city: venue.city,
    area: venue.area,
    lat: String(venue.lat),
    lng: String(venue.lng),
    amenities: venue.amenities.join(', '),
    photos: venue.photos.join('\n'),
    paymentModes: ['online' as const],
    settingsVisibility: { canSelectOnlinePayment: true },
    userId: venue.owner_id,
    setBusy: jest.fn(),
    setError: jest.fn(),
    setSelectedId: jest.fn(),
    setResourceId: jest.fn(),
    setPaymentModes: jest.fn(),
    load: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useSportsVenueManagementState>;
}

describe('SP-SAVE-CONFIRM-CANCEL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('cancelling a review reset confirmation sends no save RPC', async () => {
    const state = makeState();
    state.name = 'Updated court';
    const confirm = jest.fn().mockResolvedValue(false);
    const actions = createSportsVenueManagementActions(state, jest.fn());

    await actions.saveVenue(confirm);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(state.setBusy).not.toHaveBeenCalled();
  });

  it('does not warn for unchanged details or payment-only edits', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: savedVenue.id, error: null });
    const state = makeState();
    const confirm = jest.fn().mockResolvedValue(false);
    const actions = createSportsVenueManagementActions(state, jest.fn());

    await actions.saveVenue(confirm);

    expect(confirm).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith(
      'save_sports_venue',
      expect.objectContaining({ p_payment_modes: ['online'] }),
    );
    expect(state.load).toHaveBeenCalledTimes(1);
  });
});

describe('SP-SUSPENDED-DETAIL-READONLY', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not attempt a detail save for a suspended venue', async () => {
    const state = makeState('suspended');
    const confirm = jest.fn().mockResolvedValue(true);
    const actions = createSportsVenueManagementActions(state, jest.fn());

    await actions.saveVenue(confirm);

    expect(confirm).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(state.setBusy).not.toHaveBeenCalled();
  });

  it('does not attempt a detail save for a non-owner business member', async () => {
    const state = makeState();
    (state as unknown as { userId: string }).userId = 'manager-1';
    const confirm = jest.fn().mockResolvedValue(true);
    const actions = createSportsVenueManagementActions(state, jest.fn());

    await actions.saveVenue(confirm);

    expect(confirm).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

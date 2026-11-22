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
    resourceId: 'resource-1',
    activityId: 'activity-1',
    resourceName: 'North court',
    slotMinutes: '90',
    bookingMode: 'approval' as const,
    capacity: '1',
    instantBookingEnabled: false,
    capacitySlotsEnabled: false,
    selectedResource: null,
    editingPriceId: null,
    weekday: '1',
    closed: false,
    busy: false,
    setBusy: jest.fn(),
    setError: jest.fn(),
    setSelectedId: jest.fn(),
    setResourceId: jest.fn(),
    setPaymentModes: jest.fn(),
    setClosed: jest.fn(),
    setEditingPriceId: jest.fn(),
    setPriceRupees: jest.fn(),
    setPriceLabel: jest.fn(),
    clearVenueDraftDirty: jest.fn(),
    clearResourceDraftDirty: jest.fn(),
    clearHoursDraftDirty: jest.fn(),
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

describe('SP-REAL-RESOURCE-SNAKE-CASE-PAYLOAD and SP-CHILD-OFF-PRESERVE', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 'resource-1', error: null });
  });

  it('maps selected resource booking_mode and preserves all stored fields when child controls are off', async () => {
    const state = makeState();
    state.resourceId = 'resource-7';
    state.activityId = 'activity-9';
    state.resourceName = 'Competition court';
    state.slotMinutes = '90';
    state.bookingMode = 'approval';
    state.capacity = '1';
    state.selectedResource = {
      id: 'resource-7',
      name: 'Competition court',
      activity_id: 'activity-9',
      activity_name: 'Tennis',
      slot_minutes: 90,
      active: true,
      booking_mode: 'instant',
      capacity: 8,
    };
    const actions = createSportsVenueManagementActions(state, jest.fn());

    await actions.saveResource();

    expect(supabase.rpc).toHaveBeenCalledWith('save_sports_resource', {
      p_venue_id: state.selectedId,
      p_id: 'resource-7',
      p_activity_id: 'activity-9',
      p_name: 'Competition court',
      p_slot_minutes: 90,
      p_active: true,
      p_booking_mode: 'instant',
      p_capacity: 8,
    });
  });
});

describe('SP-CLOSE-DAY-CONFIRM, SP-DELETE-PRICE-CONFIRM, SP-REMOVE-BLOCK-CONFIRM and SP-CONFIRM-FAILURE', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
  });

  it('cancelling close-day confirmation performs zero writes', async () => {
    const state = makeState();
    const confirm = jest.fn().mockResolvedValue(false);
    const actions = createSportsVenueManagementActions(state, jest.fn(), confirm);

    await actions.closeDay();

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('venue venue-1'),
    }));
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(state.setClosed).not.toHaveBeenCalled();
    expect(state.setBusy).toHaveBeenLastCalledWith(false);
  });

  it('confirming close-day writes the exact venue and weekday once', async () => {
    const state = makeState();
    const confirm = jest.fn().mockResolvedValue(true);
    const actions = createSportsVenueManagementActions(state, jest.fn(), confirm);

    await actions.closeDay();

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('set_sports_hours', {
      p_venue_id: 'venue-1',
      p_weekday: 1,
      p_opens: null,
      p_closes: null,
    });
    expect(state.setClosed).toHaveBeenCalledWith(true);
    expect(state.clearHoursDraftDirty).toHaveBeenCalledTimes(1);
    expect(state.load).toHaveBeenCalledTimes(1);
  });

  it('routes a closed-draft save through the confirmation boundary', async () => {
    const state = makeState();
    state.closed = true;
    const confirm = jest.fn().mockResolvedValue(false);
    const actions = createSportsVenueManagementActions(state, jest.fn(), confirm);

    await actions.saveHours();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('suppresses duplicate close confirmations and writes while the first action is busy', async () => {
    const state = makeState();
    let resolveConfirmation = (_confirmed: boolean) => {};
    const confirm = jest.fn(() => new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve;
    }));
    const actions = createSportsVenueManagementActions(state, jest.fn(), confirm);

    const first = actions.closeDay();
    const duplicate = actions.closeDay();
    expect(confirm).toHaveBeenCalledTimes(1);
    resolveConfirmation(true);
    await Promise.all([first, duplicate]);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(state.load).toHaveBeenCalledTimes(1);
  });

  it('canceling price-rule deletion performs zero writes and confirmation deletes its UUID once', async () => {
    const state = makeState();
    const rule = {
      id: 'price-42',
      resource_id: 'resource-1',
      weekday: 2,
      starts: '09:00:00',
      ends: '11:00:00',
      price_paise: 125000,
      label: 'Weekend rate',
    };
    const cancelActions = createSportsVenueManagementActions(state, jest.fn(), jest.fn().mockResolvedValue(false));
    await cancelActions.deletePrice(rule);
    expect(supabase.rpc).not.toHaveBeenCalled();

    const confirm = jest.fn().mockResolvedValue(true);
    const actions = createSportsVenueManagementActions(state, jest.fn(), confirm);
    await actions.deletePrice(rule);

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('price-42'),
    }));
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('delete_sports_price_rule', { p_id: 'price-42' });
  });

  it('canceling block removal performs zero writes and confirmation removes its UUID once', async () => {
    const state = makeState();
    const block = {
      id: 'block-17',
      resource_id: 'resource-1',
      starts_at: '2026-03-04T04:00:00.000Z',
      ends_at: '2026-03-04T05:00:00.000Z',
      reason: 'Maintenance',
    };
    const cancelActions = createSportsVenueManagementActions(state, jest.fn(), jest.fn().mockResolvedValue(false));
    await cancelActions.removeBlock(block);
    expect(supabase.rpc).not.toHaveBeenCalled();

    const confirm = jest.fn().mockResolvedValue(true);
    const actions = createSportsVenueManagementActions(state, jest.fn(), confirm);
    await actions.removeBlock(block);

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('block-17'),
    }));
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('remove_sports_block', { p_id: 'block-17' });
  });

  it('a failed close write preserves the prior closed state and clears busy state', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'write denied' } });
    const state = makeState();
    const actions = createSportsVenueManagementActions(state, jest.fn(), jest.fn().mockResolvedValue(true));

    await actions.closeDay();

    expect(state.setClosed).not.toHaveBeenCalled();
    expect(state.setError).toHaveBeenCalledWith('write denied');
    expect(state.load).not.toHaveBeenCalled();
    expect(state.setBusy).toHaveBeenLastCalledWith(false);
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

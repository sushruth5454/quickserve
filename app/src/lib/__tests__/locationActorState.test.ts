import type { SavedAddress } from '../types';
import {
  confirmedLocationActor,
  formatSavedAddress,
  initialLocationAddressState,
  locationAddressReducer,
  runPrivateLocationRequest,
  type LocationAddressState,
} from '../locationModel';

const address = (id: string, line1 = `Flat ${id}, Long Residency Road`): SavedAddress => ({
  id,
  label: 'Home',
  line1,
  city: 'Vijayawada',
  lat: 16.5,
  lng: 80.651,
  is_default: false,
  created_at: '2026-01-01T00:00:00Z',
});

describe('location actor state', () => {
  it('makes no private address request without a confirmed actor', async () => {
    const request = jest.fn().mockResolvedValue([address('a1')]);

    await expect(runPrivateLocationRequest(null, request)).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
    await expect(runPrivateLocationRequest('owner-a', request)).resolves.toEqual([address('a1')]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not expose a private address actor while auth is loading or signed out', () => {
    expect(confirmedLocationActor(true, null)).toBeNull();
    expect(confirmedLocationActor(true, 'owner-a')).toBeNull();
    expect(confirmedLocationActor(false, null)).toBeNull();
    expect(confirmedLocationActor(false, 'owner-a')).toBe('owner-a');
  });

  it('clears rows on actor change and ignores a late prior-actor response', () => {
    let state: LocationAddressState = initialLocationAddressState;
    state = locationAddressReducer(state, { type: 'actor-change', actorId: 'owner-a', requestId: 1 });
    state = locationAddressReducer(state, { type: 'load-start', actorId: 'owner-a', requestId: 2 });
    state = locationAddressReducer(state, { type: 'actor-change', actorId: null, requestId: 3 });
    state = locationAddressReducer(state, {
      type: 'load-success',
      actorId: 'owner-a',
      requestId: 2,
      addresses: [address('a1')],
    });
    expect(state).toMatchObject({ actorId: null, addresses: null, error: null });

    state = locationAddressReducer(state, { type: 'actor-change', actorId: 'owner-b', requestId: 4 });
    state = locationAddressReducer(state, {
      type: 'load-success',
      actorId: 'owner-a',
      requestId: 2,
      addresses: [address('a1')],
    });
    state = locationAddressReducer(state, { type: 'address-added', actorId: 'owner-a', address: address('late-save') });
    expect(state).toMatchObject({ actorId: 'owner-b', addresses: null, error: null });
  });

  it('keeps current-actor rows and exposes an error when refresh fails', () => {
    let state: LocationAddressState = {
      actorId: 'owner-a',
      requestId: 1,
      loading: false,
      addresses: [address('a1'), address('a2')],
      error: null,
    };
    state = locationAddressReducer(state, { type: 'load-start', actorId: 'owner-a', requestId: 2 });
    state = locationAddressReducer(state, {
      type: 'load-error',
      actorId: 'owner-a',
      requestId: 2,
      error: 'network unavailable',
    });
    expect(state).toMatchObject({
      addresses: [address('a1'), address('a2')],
      loading: false,
      error: 'network unavailable',
    });
  });

  it('removes a confirmed deletion before a failed reload and preserves full address details', () => {
    let state: LocationAddressState = {
      actorId: 'owner-a',
      requestId: 1,
      loading: false,
      addresses: [address('deleted'), address('remaining')],
      error: null,
    };
    state = locationAddressReducer(state, { type: 'delete', actorId: 'owner-a', addressId: 'deleted', requestId: 2 });
    state = locationAddressReducer(state, { type: 'load-start', actorId: 'owner-a', requestId: 3 });
    state = locationAddressReducer(state, {
      type: 'load-error',
      actorId: 'owner-a',
      requestId: 3,
      error: 'network unavailable',
    });

    expect(state.addresses?.map((row) => row.id)).toEqual(['remaining']);
    expect(state.error).toBe('network unavailable');
    expect(formatSavedAddress(address('long', 'Flat 302, Sri Sai Residency, 4th Lane, Benz Circle'))).toBe(
      'Flat 302, Sri Sai Residency, 4th Lane, Benz Circle, Vijayawada',
    );
  });
});

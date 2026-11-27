jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), auth: { getSession: jest.fn() } },
}));

import { deleteAddress, getProviderJobs, getProviderService, requestAccountDeletion } from '../supabaseApi';
import { supabase } from '../supabase';
import { Linking } from 'react-native';
import { supportContact } from '../config';

const openURL = jest.spyOn(Linking, 'openURL');

beforeEach(() => {
  jest.clearAllMocks();
  openURL.mockResolvedValue(undefined);
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({
    data: { session: { user: { id: 'user-1' } } },
  });
});

describe('getProviderService', () => {
  it('selects category recurrence eligibility from Supabase', async () => {
    const category = {
      name: 'Cleaning',
      slug: 'cleaning',
      archetype: 'time_based',
      recurrence_allowed: true,
      allowed_frequencies: ['weekly'],
    };
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      single: jest.fn().mockResolvedValue({ data: { categories: category }, error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    (supabase.from as jest.Mock).mockReturnValue(query);

    const result = await getProviderService('service-1');

    expect(query.select).toHaveBeenCalledWith(
      expect.stringContaining('categories(name, slug, archetype, recurrence_allowed, allowed_frequencies)'),
    );
    expect(result.categories).toEqual(category);
  });
});

describe('getProviderJobs', () => {
  it('retains the booking key and stored archetype from the safe job projection', async () => {
    const job = {
      booking_id: 'booking-1',
      status: 'accepted',
      category_name: 'Repair',
      customer_name: 'Customer',
      description: 'Repair request',
      scheduled_at: '2026-12-20T10:00:00.000Z',
      created_at: '2026-11-20T10:00:00.000Z',
      visit_fee: 1200,
      area: 'Test city',
      distance_km: 2,
      address_line: null,
      lat: null,
      lng: null,
      archetype: 'proposal',
    };
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [job], error: null });

    const result = await getProviderJobs();

    expect(supabase.rpc).toHaveBeenCalledWith('get_provider_jobs');
    expect(result).toEqual([job]);
    expect(result[0]).toMatchObject({ booking_id: 'booking-1', archetype: 'proposal' });
  });
});

describe('deleteAddress', () => {
  it('scopes deletion to the signed-in owner and excludes booking snapshots', async () => {
    const query = {
      delete: jest.fn(),
      eq: jest.fn(),
      neq: jest.fn().mockResolvedValue({ error: null }),
    };
    query.delete.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    (supabase.from as jest.Mock).mockReturnValue(query);

    await deleteAddress('address-1');

    expect(supabase.from).toHaveBeenCalledWith('addresses');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', 'address-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'user_id', 'user-1');
    expect(query.neq).toHaveBeenCalledWith('label', 'Booking');
  });
});

describe('requestAccountDeletion', () => {
  it('returns recorded when the RPC succeeds', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });

    await expect(requestAccountDeletion()).resolves.toBe('recorded');
    expect(supabase.rpc).toHaveBeenCalledWith('request_account_deletion');
    expect(openURL).not.toHaveBeenCalled();
  });

  it('opens the configured support email only when the RPC fails', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'RPC unavailable' } });
    await expect(requestAccountDeletion()).resolves.toBe('email');
    expect(openURL).toHaveBeenCalledWith(expect.stringContaining(`mailto:${supportContact.email}`));
  });
});

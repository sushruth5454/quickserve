jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), auth: { getSession: jest.fn() } },
}));
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return { ...actual, Linking: { ...actual.Linking, openURL: jest.fn() } };
});

import { deleteAddress, getProviderService, requestAccountDeletion } from '../supabaseApi';
import { supabase } from '../supabase';
import { Linking } from 'react-native';
import { supportContact } from '../config';

beforeEach(() => {
  jest.clearAllMocks();
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
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('opens the configured support email only when the RPC fails', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'RPC unavailable' } });
    (Linking.openURL as jest.Mock).mockResolvedValue(undefined);

    await expect(requestAccountDeletion()).resolves.toBe('email');
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining(`mailto:${supportContact.email}`));
  });
});

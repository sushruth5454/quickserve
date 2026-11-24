jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

import { supabase } from '../../../lib/supabase';
import { getMyShop } from '../../shops/api';
import { getMyProviderBusinessContext, listMyBusinessMemberships } from '../api';

const rpcMock = supabase.rpc as jest.Mock;

describe('merchant business context API', () => {
  beforeEach(() => jest.resetAllMocks());

  it('ID-MEM-BUSINESS-PKS: preserves business IDs and the selected provider ID', async () => {
    const membership = {
      business_id: 'shop-b',
      owner_id: 'owner-b',
      role: 'manager',
      business_type: 'shop',
      business_name: 'Selected shop',
    };
    rpcMock
      .mockResolvedValueOnce({ data: [membership], error: null })
      .mockResolvedValueOnce({ data: { id: 'provider-b', business_role: 'manager' }, error: null });

    await expect(listMyBusinessMemberships()).resolves.toEqual([membership]);
    await expect(getMyProviderBusinessContext('provider-b')).resolves.toMatchObject({ id: 'provider-b' });

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'list_my_business_memberships');
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'get_provider_business_context', { p_provider_id: 'provider-b' });
  });

  it('ID-SHOP-SELECT-B: uses explicit owner context and keeps the legacy no-argument RPC', async () => {
    const selectedShop = { id: 'shop-b', owner_id: 'owner-b', business_role: 'owner' };
    rpcMock
      .mockResolvedValueOnce({ data: selectedShop, error: null })
      .mockResolvedValueOnce({ data: selectedShop, error: null });

    await expect(getMyShop('owner-b')).resolves.toEqual(selectedShop);
    await expect(getMyShop()).resolves.toEqual(selectedShop);

    expect(rpcMock).toHaveBeenNthCalledWith(1, 'get_business_shop_context', { p_owner_id: 'owner-b' });
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'get_my_business_shop');
  });
});

import { searchProductsWithAi, productSearchRequest } from '../productSearch';
import { supabase } from '../../../lib/supabase';

jest.mock('../../../lib/config', () => ({ isDemoMode: false }));
jest.mock('../../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const invoke = supabase.functions.invoke as jest.Mock;

describe('AI product search request', () => {
  beforeEach(() => jest.resetAllMocks());

  it('sends only the product intent and coordinates for database filtering', () => {
    expect(productSearchRequest('LED bulbs', 16.5, 80.6)).toEqual({
      mode: 'product_search',
      query: 'LED bulbs',
      lat: 16.5,
      lng: 80.6,
    });
  });

  it('supports searching without a selected location', () => {
    expect(productSearchRequest('floor tiles', null, null)).toEqual({
      mode: 'product_search',
      query: 'floor tiles',
      lat: null,
      lng: null,
    });
  });

  it('uses the Edge Function and returns its database-search response', async () => {
    const response = {
      filters: { category_slug: 'electrical', query: 'LED bulbs', brand: null, max_price_paise: null, in_stock_only: true },
      products: [{ id: 'database-product-1', name: 'LED bulb', indicative_price_paise: 4500 }],
    };
    invoke.mockResolvedValueOnce({ data: response, error: null });

    await expect(searchProductsWithAi({ query: 'LED bulbs', lat: 16.5, lng: 80.6 })).resolves.toEqual(response);
    expect(invoke).toHaveBeenCalledWith('ai-assistant', {
      body: { mode: 'product_search', query: 'LED bulbs', lat: 16.5, lng: 80.6 },
    });
  });
});

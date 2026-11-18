jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

import { getProviderService } from '../supabaseApi';
import { supabase } from '../supabase';

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

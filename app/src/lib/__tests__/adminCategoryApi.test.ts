jest.mock('../supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

import { supabase } from '../supabase';
import { adminReorderCategories, adminUpsertCategory } from '../adminApi';

const rpc = supabase.rpc as jest.Mock;

const category = {
  slug: 'home-cleaning',
  name: 'Home cleaning',
  icon: 'sparkles-outline',
  parent_id: 'group-household-help',
  vertical: 'household-help',
  archetype: 'fixed',
  pricing_units: ['visit'],
  recurrence_allowed: true,
  allowed_frequencies: ['daily', 'weekly'],
  recurring_discount_bp: null,
  cancellation_policy: 'standard_visit',
  requires_docs: [],
  restricted: false,
  sort_order: 10,
  intake_schema: {},
};

describe('admin category API — HSC-04 category management', () => {
  beforeEach(() => jest.resetAllMocks());

  it('creates a category through the documented JSON RPC argument', async () => {
    rpc.mockResolvedValue({ data: 'category-1', error: null });

    await expect(adminUpsertCategory(category)).resolves.toBe('category-1');
    expect(rpc).toHaveBeenCalledWith('admin_upsert_category', { p: category });
  });

  it('updates a category by id without changing its create-only slug', async () => {
    rpc.mockResolvedValue({ data: 'category-1', error: null });
    const { slug: _createOnlySlug, ...fields } = category;
    const update = { ...fields, id: 'category-1' };

    expect(_createOnlySlug).toBe('home-cleaning');
    await expect(adminUpsertCategory(update)).resolves.toBe('category-1');
    expect(rpc).toHaveBeenCalledWith('admin_upsert_category', { p: update });
  });

  it('reorders the supplied sibling ids through the documented array argument', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await adminReorderCategories(['category-1', 'category-2']);

    expect(rpc).toHaveBeenCalledWith('admin_reorder_categories', {
      p_ids: ['category-1', 'category-2'],
    });
  });
});

describe('admin category API — HSC-05 category policy validation', () => {
  beforeEach(() => jest.resetAllMocks());

  it('surfaces server validation errors without replacing their message', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'allowed frequencies are invalid' } });

    await expect(adminUpsertCategory(category)).rejects.toThrow('allowed frequencies are invalid');
  });
});

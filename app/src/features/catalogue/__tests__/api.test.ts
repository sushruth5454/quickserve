jest.mock('../../../lib/config', () => ({
  isDemoMode: false,
  isSeedDemoMode: true,
  demoSeedCity: 'Vijayawada Demo',
}));
jest.mock('../../../lib/demo/demoApi', () => ({ demoApi: {} }));
jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from '../../../lib/supabase';
import { listCataloguePackages } from '../api';

const fromMock = supabase.from as jest.Mock;

function arrangePackageQuery(rows: unknown[]) {
  const response = { data: rows, error: null };
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    ilike: jest.fn(),
    order: jest.fn(),
    then: (resolve: (value: typeof response) => unknown) => Promise.resolve(response).then(resolve),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.ilike.mockReturnValue(query);
  query.order.mockReturnValue(query);
  fromMock.mockReturnValue(query);
  return query;
}

function packageRow(city: string) {
  return {
    id: `package-${city}`,
    provider_service_id: `service-${city}`,
    active: true,
    sort_order: 1,
    provider_services: {
      id: `service-${city}`,
      provider_id: `provider-${city}`,
      categories: {
        id: 'category-1',
        name: 'Photography',
        slug: 'photography',
        archetype: 'fixed',
      },
      providers: {
        city,
        rating_avg: 4.9,
        rating_count: 12,
        is_online: true,
        paused: false,
        profiles: { full_name: `Provider ${city}` },
      },
    },
  };
}

function fixedSeedPackageRow(city: string, providerName: string) {
  const row = packageRow(city);
  return {
    ...row,
    id: 'seed-package-house-cleaning',
    title: 'Demo 2 BHK deep clean',
    provider_services: {
      ...row.provider_services,
      id: 'seed-service-house-cleaning',
      provider_id: 'seed-provider-house-cleaning',
      categories: {
        ...row.provider_services.categories,
        name: 'House Cleaning',
        slug: 'house-cleaning',
        archetype: 'fixed',
      },
      providers: {
        ...row.provider_services.providers,
        profiles: { full_name: providerName },
      },
    },
  };
}

describe('catalogue package API', () => {
  beforeEach(() => jest.resetAllMocks());

  it('MK-PACKAGE-city-inner-filter: scopes package results to the selected city through an inner provider embed', async () => {
    const query = arrangePackageQuery([packageRow('City A')]);

    const packages = await listCataloguePackages('photography', 'City A');

    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('providers!inner(city,'));
    expect(query.ilike).toHaveBeenCalledWith('provider_services.providers.city', 'City A');
    expect(packages.map((item) => item.city)).toEqual(['City A']);
  });

  it('MK-PACKAGE-city-escaping: escapes LIKE metacharacters in an exact city match', async () => {
    const query = arrangePackageQuery([packageRow('City_%\\West')]);

    await listCataloguePackages('photography', 'City_%\\West');

    expect(query.ilike).toHaveBeenCalledWith('provider_services.providers.city', 'City\\_\\%\\\\West');
  });

  it('MK-PACKAGE-public-projection: keeps active category/package filters and selects only public provider context', async () => {
    const query = arrangePackageQuery([packageRow('City A')]);

    await listCataloguePackages('photography', 'City A');

    const projection = query.select.mock.calls[0][0] as string;
    expect(projection).toContain('provider_services!inner');
    expect(projection).toContain('categories!inner(*)');
    expect(projection).toContain('providers!inner(city, rating_avg, rating_count, is_online, paused, profiles(full_name))');
    expect(projection).not.toMatch(/onboarding|kyc_status|suspended/i);
    expect(query.eq.mock.calls).toEqual([
      ['active', true],
      ['provider_services.active', true],
      ['provider_services.categories.slug', 'photography'],
    ]);
  });

  it.each([
    { selectedCity: 'Vijayawada Demo', providerCity: 'Vijayawada', providerName: 'Durga Demo Home Care' },
    { selectedCity: 'Sangareddy', providerCity: 'Sangareddy', providerName: 'Laxmi Home Cleaning' },
  ])('MK-PACKAGE-city-seeded-fixed-query: filters $selectedCity against its seeded provider city', async ({ selectedCity, providerCity, providerName }) => {
    const query = arrangePackageQuery([fixedSeedPackageRow(providerCity, providerName)]);

    const packages = await listCataloguePackages('house-cleaning', selectedCity);

    expect(query.ilike).toHaveBeenCalledWith('provider_services.providers.city', providerCity);
    expect(query.eq).toHaveBeenCalledWith('provider_services.categories.slug', 'house-cleaning');
    expect(packages).toMatchObject([
      { city: providerCity, providerName, package: { title: 'Demo 2 BHK deep clean' } },
    ]);
  });
});

import { groupResults, type SearchRawResults } from '../searchModel';
import type { Catalogue, CatalogueCategory } from '../../catalogue/model';
import type { SearchProduct, ShopResult } from '../../shops/api';

function category(id: string, slug: string, name: string, vertical: string): CatalogueCategory {
  return { id, slug, name, vertical } as CatalogueCategory;
}

function rawResults(overrides: Partial<SearchRawResults> = {}): SearchRawResults {
  const service = category('service-id', 'tennis-cleaning', 'Tennis cleaning', 'home-repairs');
  const creator = category('creator-id', 'tennis-photo', 'Tennis photography', 'photo-video');
  const catalogue: Catalogue = {
    categories: [service, creator],
    verticals: [
      { slug: 'home-repairs', label: 'Home repairs', categories: [service] },
      { slug: 'photo-video', label: 'Photo & video', categories: [creator] },
    ],
  };
  return {
    catalogue,
    activities: [{ id: 'activity-id', slug: 'tennis', name: 'Tennis', icon: 'tennisball-outline' }],
    products: [{ id: 'product-id', name: 'Tennis racket' } as SearchProduct],
    shops: [{ id: 'shop-id', name: 'Tennis shop' } as ShopResult],
    ...overrides,
  };
}

describe('groupResults', () => {
  it('filters by scope and matches names without case sensitivity', () => {
    const groups = groupResults(rawResults(), 'tEnNiS', 'sports');

    expect(groups.map((group) => [group.key, group.results.map((result) => result.name)])).toEqual([
      ['sports', ['Tennis']],
    ]);
  });

  it('returns no groups for a query shorter than two normalized characters', () => {
    expect(groupResults(rawResults(), '  ', 'all')).toEqual([]);
    expect(groupResults(rawResults(), ' t ', 'all')).toEqual([]);
  });

  it('returns no more than five results in each group', () => {
    const products = Array.from({ length: 6 }, (_, index) => ({
      id: `product-${index}`,
      name: `Desk lamp ${index}`,
    } as SearchProduct));

    const groups = groupResults(rawResults({ products, shops: [] }), 'desk lamp', 'shops');

    expect(groups.map((group) => [group.key, group.results.length])).toEqual([['shops', 5]]);
  });

  it('splits creator categories from services using catalogue families', () => {
    const groups = groupResults(rawResults(), 'tennis', 'all');

    expect(groups.map((group) => [group.key, group.results.map((result) => result.name)])).toEqual([
      ['services', ['Tennis cleaning']],
      ['shops', ['Tennis racket', 'Tennis shop']],
      ['sports', ['Tennis']],
      ['creators', ['Tennis photography']],
    ]);
  });
});
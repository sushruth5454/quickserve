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

  it('MK-SEARCH-scope-cap-order keeps normalized scope, server order, and the five-result cap', () => {
    const products = [3, 1, 4, 0, 2, 5].map((index) => ({
      id: `product-${index}`,
      name: `Desk lamp ${index}`,
    } as SearchProduct));

    const groups = groupResults(rawResults({ products, shops: [] }), '  dEsK   lAmP ', 'shops');

    expect(groups.map((group) => [group.key, group.results.map((result) => result.name)])).toEqual([
      ['shops', ['Desk lamp 3', 'Desk lamp 1', 'Desk lamp 4', 'Desk lamp 0', 'Desk lamp 2']],
    ]);
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

  it('MK-SEARCH-preserve-server-product-match keeps server-matched products when the name does not match', () => {
    const product = {
      id: 'server-product-id',
      name: 'Family Table',
      brand: 'Oak Living',
      model: 'Dining Set',
      description: 'Solid wood furniture',
    } as SearchProduct;

    const groups = groupResults(rawResults({ products: [product], shops: [] }), 'oak dining', 'shops');

    expect(groups.map((group) => [group.key, group.results.map((result) => result.name)])).toEqual([
      ['shops', ['Family Table']],
    ]);
  });

  it('MK-SEARCH-no-group-parent excludes null-archetype parents without changing category routing', () => {
    const groupingParent = {
      id: 'group-parent-id',
      slug: 'tennis-services',
      name: 'Tennis services',
      vertical: 'home-repairs',
      archetype: null,
      parent_id: null,
    } as unknown as CatalogueCategory;
    const catalogue = rawResults().catalogue!;
    catalogue.categories.push(groupingParent);

    const categoryResults = groupResults(rawResults({ catalogue }), 'tennis', 'all')
      .flatMap((group) => group.results)
      .filter((result) => result.kind === 'category')
      .map((result) => [result.id, result.slug, result.group]);

    expect(categoryResults).toEqual([
      ['service-id', 'tennis-cleaning', 'services'],
      ['creator-id', 'tennis-photo', 'creators'],
    ]);
  });
});
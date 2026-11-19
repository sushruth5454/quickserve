import type { Catalogue, CatalogueCategory } from '../../catalogue/model';
import { groupVerticals } from '../../catalogue/model';
import { homeFeatureState, pillarInputs, popularCategories } from '../homeModel';

const category = (
  slug: string,
  vertical: string,
  sort_order: number,
  archetype: CatalogueCategory['archetype'] | null = 'inspect_quote',
): CatalogueCategory => ({
  id: slug,
  slug,
  name: slug,
  icon: 'construct',
  pricing_mode: 'quote',
  sort_order,
  vertical,
  archetype: archetype as never,
});

const asCatalogue = (categories: CatalogueCategory[]): Catalogue => ({
  categories,
  verticals: groupVerticals(categories),
});

describe('home model', () => {
  it('returns service categories in catalogue order and excludes group rows', () => {
    const catalogue = asCatalogue([
      category('group', 'home-repairs', 0, null),
      ...Array.from({ length: 10 }, (_, index) => category(`service-${index}`, 'home-repairs', index + 1)),
    ]);

    expect(popularCategories(catalogue, 3).map((item) => item.slug)).toEqual([
      'service-0',
      'service-1',
      'service-2',
    ]);
  });

  it('limits popular categories to eight by default', () => {
    const catalogue = asCatalogue(
      Array.from({ length: 10 }, (_, index) => category(`service-${index}`, 'home-repairs', index)),
    );

    expect(popularCategories(catalogue).map((item) => item.slug)).toEqual(
      Array.from({ length: 8 }, (_, index) => `service-${index}`),
    );
  });

  it('derives home and creator availability separately from their catalogue verticals', () => {
    const catalogue = asCatalogue([
      category('plumber', 'home-repairs', 1),
      category('photographer', 'photo-video', 2),
    ]);
    const flags = { isOn: (key: string) => key === 'products' || key === 'sports' };

    expect(pillarInputs(catalogue, flags)).toEqual({
      hasHome: true,
      hasCreators: true,
      productsOn: true,
      sportsOn: true,
    });
  });

  it('keeps the home pillar available for non-creator categories outside the legacy home family', () => {
    const catalogue = asCatalogue([category('tutor', 'learning', 1)]);

    expect(pillarInputs(catalogue, { isOn: () => false })).toEqual({
      hasHome: true,
      hasCreators: false,
      productsOn: false,
      sportsOn: false,
    });
  });

  it('does not count creator categories as home-service content', () => {
    const catalogue = asCatalogue([category('photographer', 'photo-video', 1)]);

    expect(pillarInputs(catalogue, { isOn: () => false })).toEqual({
      hasHome: false,
      hasCreators: true,
      productsOn: false,
      sportsOn: false,
    });
  });

  it('keeps content pillars hidden when no catalogue content or marketplace flags exist', () => {
    expect(pillarInputs(null, { isOn: () => false })).toEqual({
      hasHome: false,
      hasCreators: false,
      productsOn: false,
      sportsOn: false,
    });
  });

  it('selects the legacy and inline-search paths when behavior flags are off', () => {
    expect(homeFeatureState({ isOn: () => false })).toEqual({
      homeV2: false,
      unifiedSearch: false,
    });
  });

  it('enables each home behavior independently when its flag is on', () => {
    expect(homeFeatureState({ isOn: (key: string) => key === 'home_v2' })).toEqual({
      homeV2: true,
      unifiedSearch: false,
    });
    expect(homeFeatureState({ isOn: (key: string) => key === 'unified_search' })).toEqual({
      homeV2: false,
      unifiedSearch: true,
    });
    expect(homeFeatureState({ isOn: () => true })).toEqual({
      homeV2: true,
      unifiedSearch: true,
    });
  });
});

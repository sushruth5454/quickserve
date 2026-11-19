import { groupCatalogueFamilies, type Catalogue, type CatalogueCategory } from '../catalogue/model';

export interface HomeFlagReader {
  isOn(key: string): boolean;
}

export function homeFeatureState(flags: HomeFlagReader): { homeV2: boolean; unifiedSearch: boolean } {
  return {
    homeV2: flags.isOn('home_v2'),
    unifiedSearch: flags.isOn('unified_search'),
  };
}

export function popularCategories(catalogue: Catalogue | null | undefined, n = 8): CatalogueCategory[] {
  const limit = Math.max(0, Math.floor(n));
  return (catalogue?.categories ?? [])
    .filter((category) => category.archetype !== null)
    .slice(0, limit);
}

export function pillarInputs(
  catalogue: Catalogue | null | undefined,
  flags: HomeFlagReader,
): { hasHome: boolean; hasCreators: boolean; productsOn: boolean; sportsOn: boolean } {
  const families = catalogue ? groupCatalogueFamilies(catalogue.verticals) : [];
  const creatorVerticals = new Set(
    families.find((family) => family.slug === 'creative-events')?.verticalSlugs ?? [],
  );
  const hasFamilyServices = (slug: string) => {
    const family = families.find((item) => item.slug === slug);
    if (!family) return false;
    const verticalSlugs = new Set(family.verticalSlugs);
    return (catalogue?.categories ?? []).some(
      (category) => category.archetype !== null && verticalSlugs.has(category.vertical ?? 'other'),
    );
  };

  return {
    hasHome: (catalogue?.categories ?? []).some(
      (category) => category.archetype !== null && !creatorVerticals.has(category.vertical ?? 'other'),
    ),
    hasCreators: hasFamilyServices('creative-events'),
    productsOn: flags.isOn('products'),
    sportsOn: flags.isOn('sports'),
  };
}

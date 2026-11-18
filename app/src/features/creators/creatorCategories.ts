import { groupCatalogueFamilies, type Catalogue, type CatalogueCategory } from '../catalogue/model';

export function creatorCategories(catalogue: Catalogue): CatalogueCategory[] {
  const creatorVerticals = new Set(
    groupCatalogueFamilies(catalogue.verticals).find((family) => family.slug === 'creative-events')?.verticalSlugs ?? [],
  );
  return catalogue.categories.filter((category) => category.vertical != null && creatorVerticals.has(category.vertical));
}

import { groupCatalogueFamilies, type Catalogue, type CatalogueCategory } from '../catalogue/model';
import { isSearchable, normalizeQuery } from '../../components/market/searchQuery';
import type { SearchProduct, ShopResult } from '../shops/api';

export type SearchScope = 'all' | 'services' | 'shops' | 'sports' | 'creators';
export type SearchGroupKey = 'services' | 'shops' | 'sports' | 'creators';

export interface SearchActivity {
  id: string;
  slug: string;
  name: string;
  icon?: string;
  sort_order?: number;
}

export interface SearchRawResults {
  catalogue: Catalogue | null;
  activities: SearchActivity[];
  products: SearchProduct[];
  shops: ShopResult[];
}

export type SearchResult =
  | {
      kind: 'category';
      group: 'services' | 'creators';
      id: string;
      slug: string;
      name: string;
      category: CatalogueCategory;
    }
  | {
      kind: 'activity';
      group: 'sports';
      id: string;
      slug: string;
      name: string;
      activity: SearchActivity;
    }
  | {
      kind: 'product';
      group: 'shops';
      id: string;
      name: string;
      product: SearchProduct;
    }
  | {
      kind: 'shop';
      group: 'shops';
      id: string;
      name: string;
      shop: ShopResult;
    };

export interface SearchResultGroup {
  key: SearchGroupKey;
  results: SearchResult[];
}

const GROUP_ORDER: SearchGroupKey[] = ['services', 'shops', 'sports', 'creators'];

export function groupResults(raw: SearchRawResults, q: string, scope: SearchScope): SearchResultGroup[] {
  const query = normalizeQuery(q).toLowerCase();
  if (!isSearchable(query)) return [];

  const creatorVerticals = new Set(
    groupCatalogueFamilies(raw.catalogue?.verticals ?? [])
      .find((family) => family.slug === 'creative-events')
      ?.verticalSlugs ?? [],
  );
  const categories = raw.catalogue?.categories ?? [];
  const grouped: Record<SearchGroupKey, SearchResult[]> = {
    services: [],
    shops: [],
    sports: raw.activities.map((activity) => ({
      kind: 'activity',
      group: 'sports',
      id: activity.id,
      slug: activity.slug,
      name: activity.name,
      activity,
    })),
    creators: [],
  };

  for (const category of categories) {
    if (category.archetype === null) continue;

    const isCreator = category.vertical != null && creatorVerticals.has(category.vertical);
    const group = isCreator ? 'creators' : 'services';
    grouped[group].push({
      kind: 'category',
      group,
      id: category.id,
      slug: category.slug,
      name: category.name,
      category,
    });
  }

  grouped.shops = [
    ...raw.products.map((product) => ({
      kind: 'product' as const,
      group: 'shops' as const,
      id: product.id,
      name: product.name,
      product,
    })),
    ...raw.shops.map((shop) => ({
      kind: 'shop' as const,
      group: 'shops' as const,
      id: shop.id,
      name: shop.name,
      shop,
    })),
  ];

  const scopes: Record<SearchScope, SearchGroupKey[]> = {
    all: GROUP_ORDER,
    services: ['services'],
    shops: ['shops'],
    sports: ['sports'],
    creators: ['creators'],
  };

  return scopes[scope].flatMap((key) => {
    const results = grouped[key]
      .filter((result) => result.kind === 'product' || normalizeQuery(result.name).toLowerCase().includes(query))
      .slice(0, 5);
    return results.length > 0 ? [{ key, results }] : [];
  });
}

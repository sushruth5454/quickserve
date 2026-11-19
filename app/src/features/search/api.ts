import { getCatalogue } from '../catalogue/api';
import type { Catalogue } from '../catalogue/model';
import { searchProducts, searchShops, type SearchProduct, type ShopResult } from '../shops/api';
import { supabase } from '../../lib/supabase';
import type { SearchActivity, SearchGroupKey, SearchRawResults } from './searchModel';

export interface SearchContext {
  city: string;
  lat: number | null;
  lng: number | null;
  sportsOn: boolean;
  productsOn: boolean;
}

export interface SearchResponse {
  raw: SearchRawResults;
  errors: Record<SearchGroupKey, boolean>;
}

type SearchSource = 'catalogue' | 'sports' | 'products' | 'shops';

async function listSportsActivities(): Promise<SearchActivity[]> {
  const { data, error } = await supabase.rpc('list_sports_activities');
  if (error) throw error;
  return (data ?? []) as SearchActivity[];
}

export async function searchEverything(q: string, ctx: SearchContext): Promise<SearchResponse> {
  const raw: SearchRawResults = { catalogue: null, activities: [], products: [], shops: [] };
  const errors: Record<SearchGroupKey, boolean> = {
    services: false,
    shops: false,
    sports: false,
    creators: false,
  };
  const requests: Array<{ source: SearchSource; promise: Promise<unknown> }> = [
    { source: 'catalogue', promise: getCatalogue(ctx.city) },
  ];

  if (ctx.sportsOn) requests.push({ source: 'sports', promise: listSportsActivities() });
  if (ctx.productsOn) {
    requests.push({
      source: 'products',
      promise: searchProducts({ query: q, lat: ctx.lat, lng: ctx.lng }),
    });
    requests.push({ source: 'shops', promise: searchShops(ctx.lat, ctx.lng) });
  }

  const settled = await Promise.allSettled(requests.map(({ promise }) => promise));
  settled.forEach((result, index) => {
    const source = requests[index]!.source;
    if (result.status === 'rejected') {
      if (source === 'catalogue') {
        errors.services = true;
        errors.creators = true;
      } else if (source === 'sports') {
        errors.sports = true;
      } else {
        errors.shops = true;
      }
      return;
    }

    switch (source) {
      case 'catalogue':
        raw.catalogue = result.value as Catalogue;
        break;
      case 'sports':
        raw.activities = result.value as SearchActivity[];
        break;
      case 'products':
        raw.products = (result.value as SearchProduct[] | null) ?? [];
        break;
      case 'shops':
        raw.shops = (result.value as ShopResult[] | null) ?? [];
        break;
    }
  });

  return { raw, errors };
}

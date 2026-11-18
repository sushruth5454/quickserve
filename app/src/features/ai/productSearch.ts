import { isDemoMode } from '../../lib/config';
import { supabase } from '../../lib/supabase';
import type { SearchProduct } from '../shops/api';

export interface AiProductSearchFilters {
  category_slug: string | null;
  query: string | null;
  brand: string | null;
  max_price_paise: number | null;
  in_stock_only: boolean;
}

export interface AiProductSearchResult {
  filters: AiProductSearchFilters;
  products: SearchProduct[];
}

export function productSearchRequest(query: string, lat: number | null, lng: number | null) {
  return { mode: 'product_search', query, lat, lng };
}

export async function searchProductsWithAi(input: {
  query: string;
  lat: number | null;
  lng: number | null;
}): Promise<AiProductSearchResult> {
  if (isDemoMode) throw new Error('AI product search is available only with the live product catalogue.');
  const { data, error } = await supabase.functions.invoke('ai-assistant', {
    body: productSearchRequest(input.query, input.lat, input.lng),
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || !('filters' in data) || !('products' in data) || !Array.isArray(data.products)) {
    throw new Error('AI product search returned an invalid response.');
  }
  return data as AiProductSearchResult;
}

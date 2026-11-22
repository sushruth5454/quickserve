import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { Button, Chip, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text } from '../../components/ui';
import { listProductCategories, searchProducts, signedProductImage, type ProductCategory, type SearchProduct } from '../shops/api';
import { searchProductsWithAi } from '../ai/productSearch';
import { FeatureUnavailable, ShopProductCard, useShopFeatureFlags } from '../shops/components';
import { useRfqFeatureFlags } from '../rfq/components';
import { isDemoMode } from '../../lib/config';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { parseRupees } from '../../lib/onboarding/validation';
import { useSelectedLocation } from '../../lib/locationContext';
import { useTheme } from '../../theme';

export default function ProductsScreen() {
  const t = useTheme();
  const features = useShopFeatureFlags();
  const appFeatures = useAppFeatureFlags();
  const aiProductSearch = !isDemoMode
    && features.products
    && appFeatures.isOn('ai_assistant')
    && appFeatures.isOn('ai_product_search');
  const { rfq: rfqEnabled } = useRfqFeatureFlags();
  const { location } = useSelectedLocation();
  const params = useLocalSearchParams<{ q?: string; category?: string }>();
  const initialQuery = useMemo(() => typeof params.q === 'string' ? params.q : '', [params.q]);
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(typeof params.category === 'string' ? params.category : '');
  const [maxPrice, setMaxPrice] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState({
    query: initialQuery,
    category: typeof params.category === 'string' ? params.category : '',
    maxPrice: '',
    inStockOnly: false,
  });
  const appliedFiltersRef = useRef(appliedFilters);
  appliedFiltersRef.current = appliedFilters;
  const locationScope = JSON.stringify([location.city, location.lat, location.lng]);
  const appliedScope = JSON.stringify([locationScope, appliedFilters]);
  const [categoriesResult, setCategoriesResult] = useState<{ scope: string; value: ProductCategory[] } | null>(null);
  const [searchResult, setSearchResult] = useState<{
    scope: string;
    products: SearchProduct[];
    images: Record<string, string | null>;
  } | null>(null);
  const [searchFailure, setSearchFailure] = useState<{ scope: string; message: string } | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const categories = categoriesResult?.scope === locationScope ? categoriesResult.value : [];
  const currentSearch = searchResult?.scope === appliedScope ? searchResult : null;
  const products = currentSearch?.products ?? [];
  const images = currentSearch?.images ?? {};
  const error = searchFailure?.scope === appliedScope ? searchFailure.message : null;
  const [aiQuery, setAiQuery] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const locationScopeRef = useRef(locationScope);
  locationScopeRef.current = locationScope;
  const aiRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const focusedRef = useRef(false);
  const appActiveRef = useRef(typeof AppState === 'undefined' || AppState.currentState === 'active');
  const runningRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current++;
      aiRequestRef.current++;
    };
  }, []);
  useEffect(() => {
    aiRequestRef.current++;
    setAiLoading(false);
  }, [locationScope]);

  const askAiToSearch = useCallback(async () => {
    if (!aiProductSearch) return;
    if (aiQuery.trim().length < 2) {
      setInputError('Describe the product you need.');
      return;
    }
    const requestId = ++aiRequestRef.current;
    const requestLocationScope = locationScope;
    const requestCoords = { lat: location.lat, lng: location.lng };
    requestIdRef.current++;
    runningRef.current = false;
    setRefreshing(false);
    const isCurrent = () =>
      mountedRef.current
      && requestId === aiRequestRef.current
      && locationScopeRef.current === requestLocationScope;
    setAiLoading(true);
    try {
      const result = await searchProductsWithAi({
        query: aiQuery,
        lat: requestCoords.lat,
        lng: requestCoords.lng,
      });
      if (!isCurrent()) return;
      const nextFilters = {
        query: result.filters.query ?? '',
        category: result.filters.category_slug ?? '',
        maxPrice: result.filters.max_price_paise == null
          ? ''
          : (result.filters.max_price_paise / 100).toFixed(2).replace(/\.?0+$/, ''),
        inStockOnly: result.filters.in_stock_only,
      };
      const nextImages = await Promise.all(result.products.map(async (product) => [
        product.id,
        await signedProductImage(product.image_paths[0]).catch(() => null),
      ] as const));
      if (!isCurrent()) return;
      appliedFiltersRef.current = nextFilters;
      setAppliedFilters(nextFilters);
      setQuery(nextFilters.query);
      setCategory(nextFilters.category);
      setMaxPrice(nextFilters.maxPrice);
      setInStockOnly(nextFilters.inStockOnly);
      setSearchResult({
        scope: JSON.stringify([requestLocationScope, nextFilters]),
        products: result.products,
        images: Object.fromEntries(nextImages),
      });
      setSearchFailure(null);
      setInputError(null);
    } catch (e) {
      if (isCurrent()) setInputError((e as Error).message);
    } finally {
      if (isCurrent()) setAiLoading(false);
    }
  }, [aiProductSearch, aiQuery, location.lat, location.lng, locationScope]);

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    if (!features.products) return;
    const requestLocationScope = locationScope;
    const requestCity = location.city;
    const requestCoords = { lat: location.lat, lng: location.lng };
    const requestFilters = { ...appliedFiltersRef.current };
    const requestScope = JSON.stringify([requestLocationScope, requestFilters]);
    const price = requestFilters.maxPrice.trim() ? parseRupees(requestFilters.maxPrice) : null;
    if (requestFilters.maxPrice.trim() && (price == null || price < 0)) {
      if (guard.isCurrent()) setSearchFailure({ scope: requestScope, message: 'Enter a valid maximum price in rupees.' });
      return;
    }
    setSearchFailure((current) => current?.scope === requestScope ? null : current);
    try {
      const [nextCategories, nextProducts] = await Promise.all([
        listProductCategories(),
        searchProducts({
          query: requestFilters.query,
          categorySlug: requestFilters.category || null,
          lat: requestCoords.lat,
          lng: requestCoords.lng,
          radiusKm: 15,
          maxPricePaise: price,
          inStockOnly: requestFilters.inStockOnly,
        }),
      ]);
      const nextImages = await Promise.all(nextProducts.map(async (product) => [
        product.id,
        await signedProductImage(product.image_paths[0]).catch(() => null),
      ] as const));
      if (guard.isCurrent()) {
        setCategoriesResult({ scope: requestLocationScope, value: nextCategories });
        setSearchResult({
          scope: requestScope,
          products: nextProducts,
          images: Object.fromEntries(nextImages),
        });
        setSearchFailure(null);
      }
    } catch (caught) {
      if (guard.isCurrent()) setSearchFailure({ scope: requestScope, message: (caught as Error).message });
    }
  }, [features.products, location.city, location.lat, location.lng, locationScope]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const runLoad = useCallback(async (explicit = false) => {
    if (!features.products || !appActiveRef.current || (!focusedRef.current && !explicit)) return;
    if (runningRef.current && !explicit) return;
    aiRequestRef.current++;
    setAiLoading(false);
    const requestId = ++requestIdRef.current;
    const requestLocationScope = locationScope;
    const guard = {
      isCurrent: () =>
        mountedRef.current
        && appActiveRef.current
        && (focusedRef.current || explicit)
        && requestIdRef.current === requestId
        && locationScopeRef.current === requestLocationScope,
    };
    runningRef.current = true;
    setRefreshing(true);
    try {
      await loadRef.current(guard);
    } finally {
      if (guard.isCurrent()) {
        runningRef.current = false;
        setRefreshing(false);
      }
    }
  }, [features.products, locationScope]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    void runLoad();
    return () => {
      focusedRef.current = false;
      requestIdRef.current++;
      runningRef.current = false;
    };
  }, [runLoad]));
  useEffect(() => {
    if (typeof AppState === 'undefined') return;
    const synchronizeAppState = (state: string) => {
      const active = state === 'active';
      if (active === appActiveRef.current) return;
      appActiveRef.current = active;
      if (active) {
        if (focusedRef.current) void runLoad();
      } else {
        requestIdRef.current++;
        runningRef.current = false;
        if (mountedRef.current) setRefreshing(false);
      }
    };
    appActiveRef.current = AppState.currentState === 'active';
    const subscription = AppState.addEventListener('change', synchronizeAppState);
    return () => subscription.remove();
  }, [runLoad]);
  const loading = features.products && !currentSearch && !error;
  const applyFilters = () => {
    const price = maxPrice.trim() ? parseRupees(maxPrice) : null;
    if (maxPrice.trim() && (price == null || price < 0)) {
      setInputError('Enter a valid maximum price in rupees.');
      return;
    }
    const next = { query, category, maxPrice, inStockOnly };
    appliedFiltersRef.current = next;
    setAppliedFilters(next);
    setInputError(null);
    void runLoad(true);
  };

  if (!features.products) {
    return <Screen header={<Header title="Products" />}><FeatureUnavailable /></Screen>;
  }

  return (
    <Screen
      header={<Header title="Products" subtitle={`Verified shops near ${location.city}`} />}
      gap={t.spacing.md}
      refreshing={refreshing}
      onRefresh={() => void runLoad(true)}
    >
      <InlineAlert message={inputError} />
      {error && currentSearch ? <InlineAlert message={error} actionLabel="Retry" onAction={() => void runLoad(true)} /> : null}
      {aiProductSearch ? (
        <View style={{ gap: t.spacing.sm }}>
          <Input
            label="Ask in your words"
            value={aiQuery}
            onChangeText={setAiQuery}
            placeholder="e.g. waterproof tiles under ₹500 per box"
            helper="Do not enter contact or address details; recognizable address-like searches are declined."
            multiline
            maxLength={500}
          />
          <Button
            title="Search with AI"
            variant="outline"
            loading={aiLoading}
            disabled={aiQuery.trim().length < 2}
            onPress={() => void askAiToSearch()}
          />
          <Text variant="caption" color="muted">Review and edit the filters below before searching again.</Text>
        </View>
      ) : null}
      <Input label="Search products" value={query} onChangeText={setQuery} placeholder="Name, brand or model" returnKeyType="search" onSubmitEditing={applyFilters} />
      <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Input label="Maximum price (₹)" value={maxPrice} onChangeText={setMaxPrice} keyboardType="decimal-pad" placeholder="Any price" />
        </View>
        <Chip label="In stock only" selected={inStockOnly} onPress={() => setInStockOnly((value) => !value)} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
        <Chip label="All categories" selected={!category} onPress={() => setCategory('')} />
        {categories.map((item) => (
          <Chip key={item.id} label={item.name} selected={category === item.slug} onPress={() => setCategory(category === item.slug ? '' : item.slug)} />
        ))}
      </View>
      <Button title="Apply search and filters" variant="outline" onPress={applyFilters} />
      {rfqEnabled ? (
        <Button title="Request quotes from multiple shops" variant="outline" onPress={() => router.push('/rfq/new')} />
      ) : null}
      {loading || (refreshing && !currentSearch) ? <Skeleton height={100} radius={t.radii.lg} /> : error && !currentSearch ? (
        <ErrorState message={error} onRetry={() => void runLoad(true)} />
      ) : products.length ? products.map((product) => (
        <ShopProductCard key={product.id} product={product} imageUrl={images[product.id] ?? null} onPress={() => router.push(`/product/${product.id}`)} />
      )) : (
        <EmptyState title="No products found" message="Try a different product name, category, price or location." />
      )}
      {!loading && products.length ? <Text variant="caption" color="muted">Showing verified shops, ordered by distance.</Text> : null}
    </Screen>
  );
}

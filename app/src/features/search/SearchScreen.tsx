import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { ChipRow } from '../../components/market/ChipRow';
import { ListingCard } from '../../components/market/ListingCard';
import { normalizeQuery, isSearchable } from '../../components/market/searchQuery';
import { SearchField } from '../../components/market/SearchField';
import { Button, EmptyState, Header, InlineAlert, Screen, Section, Skeleton } from '../../components/ui';
import { signedProductImage } from '../shops/api';
import { ShopProductCard } from '../shops/components';
import { useT } from '../../i18n';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useSelectedLocation } from '../../lib/locationContext';
import { useTheme } from '../../theme';
import { searchEverything, type SearchResponse } from './api';
import { groupResults, type SearchGroupKey, type SearchResult, type SearchScope } from './searchModel';

const EMPTY_RESPONSE: SearchResponse = {
  raw: { catalogue: null, activities: [], products: [], shops: [] },
  errors: { services: false, shops: false, sports: false, creators: false },
};

const GROUPS_BY_SCOPE: Record<SearchScope, SearchGroupKey[]> = {
  all: ['services', 'shops', 'sports', 'creators'],
  services: ['services'],
  shops: ['shops'],
  sports: ['sports'],
  creators: ['creators'],
};

interface SearchSnapshot {
  query: string;
  response: SearchResponse;
}

interface ProductImageSnapshot {
  query: string;
  urls: Record<string, string | null>;
}

export function SearchScreen() {
  const theme = useTheme();
  const t = useT();
  const flags = useAppFeatureFlags();
  const enabled = flags.isOn('unified_search');
  const sportsOn = flags.isOn('sports');
  const productsOn = flags.isOn('products');
  const { location, coords } = useSelectedLocation();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const effectiveScope = isSearchScopeAvailable(scope, productsOn, sportsOn) ? scope : 'all';
  const [snapshot, setSnapshot] = useState<SearchSnapshot>({ query: '', response: EMPTY_RESPONSE });
  const [loading, setLoading] = useState(false);
  const normalizedQuery = normalizeQuery(query);
  const searchable = isSearchable(normalizedQuery);
  const response = snapshot.query === debouncedQuery ? snapshot.response : EMPTY_RESPONSE;
  const resultRaw = useMemo(
    () => ({
      ...response.raw,
      activities: sportsOn ? response.raw.activities : [],
      products: productsOn ? response.raw.products : [],
      shops: productsOn ? response.raw.shops : [],
    }),
    [productsOn, response.raw, sportsOn],
  );
  const groups = useMemo(
    () => groupResults(resultRaw, debouncedQuery, effectiveScope),
    [effectiveScope, resultRaw, debouncedQuery],
  );
  const productResults = useMemo(
    () => enabled && productsOn
      ? groups.flatMap((group) => group.results)
        .filter((result): result is Extract<SearchResult, { kind: 'product' }> => result.kind === 'product')
      : [],
    [enabled, groups, productsOn],
  );
  const [productImages, setProductImages] = useState<ProductImageSnapshot>({ query: '', urls: {} });
  const isPending = searchable && normalizedQuery !== debouncedQuery;
  const isLoading = loading || isPending;
  const visibleGroupKeys = GROUPS_BY_SCOPE[effectiveScope];
  const hasVisibleError = visibleGroupKeys.some((key) => response.errors[key]);

  useEffect(() => {
    if (!isSearchScopeAvailable(scope, productsOn, sportsOn)) setScope('all');
  }, [productsOn, scope, sportsOn]);

  useEffect(() => {
    if (!enabled || !searchable) {
      setDebouncedQuery('');
      return;
    }
    const timeout = setTimeout(() => setDebouncedQuery(normalizedQuery), 300);
    return () => clearTimeout(timeout);
  }, [enabled, normalizedQuery, searchable]);

  useEffect(() => {
    if (!enabled || !isSearchable(debouncedQuery)) {
      setSnapshot({ query: '', response: EMPTY_RESPONSE });
      setLoading(false);
      return;
    }
    let active = true;
    setSnapshot({ query: debouncedQuery, response: EMPTY_RESPONSE });
    setLoading(true);
    void searchEverything(debouncedQuery, {
      city: location.city,
      lat: coords.lat,
      lng: coords.lng,
      sportsOn,
      productsOn,
    })
      .then((next) => {
        if (active) setSnapshot({ query: debouncedQuery, response: next });
      })
      .catch(() => {
        if (active) {
          setSnapshot({
            query: debouncedQuery,
            response: {
              raw: { catalogue: null, activities: [], products: [], shops: [] },
              errors: { services: true, shops: true, sports: true, creators: true },
            },
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [coords.lat, coords.lng, debouncedQuery, enabled, location.city, productsOn, sportsOn]);

  useEffect(() => {
    let active = true;
    const queryForImages = debouncedQuery;
    const requests = productResults.map(async ({ product }) => {
      const path = product.image_paths[0];
      if (!path) return [productImageKey(product.id, path), null] as const;
      try {
        return [productImageKey(product.id, path), await signedProductImage(path)] as const;
      } catch {
        return [productImageKey(product.id, path), null] as const;
      }
    });
    setProductImages({ query: queryForImages, urls: {} });
    void Promise.all(requests).then((entries) => {
      if (active) setProductImages({ query: queryForImages, urls: Object.fromEntries(entries) });
    });
    return () => {
      active = false;
    };
  }, [debouncedQuery, productResults]);

  if (!enabled) {
    return (
      <Screen inTabs header={<Header title={t('search.title')} />}>
        <InlineAlert tone="info" message={t('feature.off', { feature: t('search.title') })} />
        <Button
          title={t('tabs.home')}
          leftIcon="home-outline"
          variant="outline"
          onPress={() => router.replace('/' as Href)}
          fullWidth
        />
      </Screen>
    );
  }

  const scopeOptions: { value: SearchScope; label: string }[] = [
    { value: 'all', label: t('search.scope.all') },
    { value: 'services', label: t('search.scope.services') },
    ...(productsOn ? [{ value: 'shops' as const, label: t('search.scope.shops') }] : []),
    ...(sportsOn ? [{ value: 'sports' as const, label: t('search.scope.sports') }] : []),
    { value: 'creators', label: t('search.scope.creators') },
  ];
  const groupTitles: Record<SearchGroupKey, string> = {
    services: t('search.scope.services'),
    shops: t('search.scope.shops'),
    sports: t('search.scope.sports'),
    creators: t('search.scope.creators'),
  };

  return (
    <Screen inTabs header={<Header title={t('search.title')} />}>
      <SearchField
        mode="input"
        value={query}
        onChangeText={setQuery}
        onSubmit={setQuery}
        placeholder={t('search.placeholder')}
        autoFocus
      />
      <ChipRow options={scopeOptions} value={effectiveScope} onChange={setScope} accessibilityLabel={t('search.title')} />
      {!searchable ? (
        <InlineAlert tone="neutral" message={t('search.minChars')} />
      ) : isLoading ? (
        <View style={{ gap: theme.spacing.md }}>
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} height={112} radius={theme.radii.lg} />
          ))}
        </View>
      ) : (
        <>
          {visibleGroupKeys.map((key) => {
            const group = groups.find((candidate) => candidate.key === key);
            if (!group && !response.errors[key]) return null;
            return (
              <Section key={key} title={groupTitles[key]}>
                {response.errors[key] ? <InlineAlert message={t('error.generic')} /> : null}
                {group?.results.map((result) => renderResult(
                  result,
                  t,
                  result.kind === 'product' && productImages.query === debouncedQuery
                    ? productImages.urls[productImageKey(result.product.id, result.product.image_paths[0])] ?? null
                    : null,
                ))}
              </Section>
            );
          })}
          {groups.length === 0 && !hasVisibleError ? (
            <EmptyState icon="search-outline" title={t('search.noResults', { q: normalizedQuery })} />
          ) : null}
        </>
      )}
    </Screen>
  );
}

function isSearchScopeAvailable(scope: SearchScope, productsOn: boolean, sportsOn: boolean) {
  if (scope === 'shops') return productsOn;
  if (scope === 'sports') return sportsOn;
  return true;
}

function productImageKey(productId: string, imagePath: string | undefined) {
  return JSON.stringify([productId, imagePath ?? '']);
}

function renderResult(result: SearchResult, t: ReturnType<typeof useT>, imageUrl: string | null) {
  switch (result.kind) {
    case 'category':
      return (
        <ListingCard
          key={`${result.kind}-${result.id}`}
          variant={result.group === 'creators' ? 'creator' : 'provider'}
          title={result.name}
          onPress={() => router.push({
            pathname: '/category/[slug]',
            params: { slug: result.slug, name: result.name },
          } as Href)}
        />
      );
    case 'activity':
      return (
        <ListingCard
          key={`${result.kind}-${result.id}`}
          variant="venue"
          title={result.name}
          onPress={() => router.push({ pathname: '/sports/[activity]', params: { activity: result.slug } } as Href)}
        />
      );
    case 'product': {
      const { product } = result;
      return (
        <ShopProductCard
          key={`${result.kind}-${result.id}`}
          product={product}
          imageUrl={imageUrl}
          onPress={() => router.push({ pathname: '/product/[id]', params: { id: product.id } } as Href)}
        />
      );
    }
    case 'shop': {
      const { shop } = result;
      const area = [shop.area, shop.city].filter(Boolean).join(', ');
      const distance = shop.distance_km == null
        ? null
        : t('listing.kmAway', { km: shop.distance_km.toFixed(1) });
      return (
        <ListingCard
          key={`${result.kind}-${result.id}`}
          variant="shop"
          title={result.name}
          subtitle={[area, distance].filter(Boolean).join(' · ')}
          onPress={() => router.push({ pathname: '/shop/[id]', params: { id: shop.id } } as Href)}
        />
      );
    }
  }
}

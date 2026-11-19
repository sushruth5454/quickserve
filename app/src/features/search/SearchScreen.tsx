import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { ChipRow } from '../../components/market/ChipRow';
import { ListingCard } from '../../components/market/ListingCard';
import { normalizeQuery, isSearchable } from '../../components/market/searchQuery';
import { SearchField } from '../../components/market/SearchField';
import { Button, EmptyState, Header, InlineAlert, Screen, Section, Skeleton } from '../../components/ui';
import { useT } from '../../i18n';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useSelectedLocation } from '../../lib/locationContext';
import { formatINR } from '../../lib/money';
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
  const [response, setResponse] = useState<SearchResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(false);
  const normalizedQuery = normalizeQuery(query);
  const searchable = isSearchable(normalizedQuery);
  const groups = useMemo(
    () => groupResults(response.raw, debouncedQuery, scope),
    [response.raw, debouncedQuery, scope],
  );
  const isPending = searchable && normalizedQuery !== debouncedQuery;
  const isLoading = loading || isPending;
  const visibleGroupKeys = GROUPS_BY_SCOPE[scope];
  const hasVisibleError = visibleGroupKeys.some((key) => response.errors[key]);

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
      setResponse(EMPTY_RESPONSE);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void searchEverything(debouncedQuery, {
      city: location.city,
      lat: coords.lat,
      lng: coords.lng,
      sportsOn,
      productsOn,
    })
      .then((next) => {
        if (active) setResponse(next);
      })
      .catch(() => {
        if (active) {
          setResponse({
            raw: { catalogue: null, activities: [], products: [], shops: [] },
            errors: { services: true, shops: true, sports: true, creators: true },
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
    { value: 'shops', label: t('search.scope.shops') },
    { value: 'sports', label: t('search.scope.sports') },
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
      <ChipRow options={scopeOptions} value={scope} onChange={setScope} accessibilityLabel={t('search.title')} />
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
                {group?.results.map((result) => renderResult(result, t))}
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

function renderResult(result: SearchResult, t: ReturnType<typeof useT>) {
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
      const area = [product.area, product.city].filter(Boolean).join(', ');
      const distance = product.distance_km == null
        ? null
        : t('listing.kmAway', { km: product.distance_km.toFixed(1) });
      return (
        <ListingCard
          key={`${result.kind}-${result.id}`}
          variant="product"
          title={result.name}
          subtitle={[product.shop_name, area, distance].filter(Boolean).join(' · ')}
          priceLabel={product.indicative_price_paise == null
            ? null
            : t('listing.from', { price: formatINR(product.indicative_price_paise) })}
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

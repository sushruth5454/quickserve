import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { ProviderCard } from '../../components/ProviderCard';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Section, Skeleton, SkeletonProviderCard, Text } from '../../components/ui';
import { searchProviders } from '../../lib/api';
import { useSelectedLocation } from '../../lib/locationContext';
import type { Category, ProviderSearchResult, SearchFilters } from '../../lib/types';
import { useTheme } from '../../theme';
import { PackageCard } from '../booking/packages/PackageCard';
import { canPayInstantly } from '../booking/packages/packageModel';
import { listCataloguePackages, type CataloguePackage } from './api';
import { useEntityRefresh } from '../../lib/useEntityRefresh';

export function ArchetypeCategory({ category }: { category: Category }) {
  const t = useTheme();
  const { location } = useSelectedLocation();
  const city = location.city;
  const packageScope = JSON.stringify([category.slug, city]);
  const [packageResult, setPackageResult] = useState<{ scope: string; packages: CataloguePackage[] } | null>(null);
  const [packageError, setPackageError] = useState<{ scope: string; message: string } | null>(null);
  const packages = packageResult?.scope === packageScope ? packageResult.packages : null;
  const error = packageError?.scope === packageScope ? packageError.message : null;
  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    const requestScope = packageScope;
    const requestSlug = category.slug;
    const requestCity = city;
    setPackageError((current) => current?.scope === requestScope ? null : current);
    try {
      const packages = await listCataloguePackages(requestSlug, requestCity);
      if (guard.isCurrent()) {
        setPackageResult({ scope: requestScope, packages });
        setPackageError(null);
      }
    } catch (caught) {
      if (guard.isCurrent()) setPackageError({ scope: requestScope, message: (caught as Error).message });
    }
  }, [category.slug, city, packageScope]);
  const { refresh, refreshing } = useEntityRefresh(load, {
    contextKey: packageScope,
    enabled: category.archetype !== 'proposal',
    intervalMs: null,
  });

  if (category.archetype === 'proposal') return <ProposalCategory key={packageScope} category={category} />;

  const fixed = category.archetype === 'fixed';
  const timeBased = category.archetype === 'time_based';
  return (
    <Screen
      header={<Header title={category.name} subtitle={fixed ? 'Choose a package. The price shown is the price you pay.' : 'Book a session or save with a session pack.'} />}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      {error ? <ErrorState message={error} onRetry={() => void refresh()} /> : packages == null ? (
        <View style={{ gap: t.spacing.md }}><Skeleton height={220} radius={t.radii.lg} /><Skeleton height={220} radius={t.radii.lg} /></View>
      ) : packages.length === 0 ? (
        <EmptyState icon="cube-outline" title={fixed ? 'No packages live yet' : 'No sessions available yet'} message="Verified providers add packages before a category opens for booking." actionLabel="Browse other services" onAction={() => router.navigate('/')} />
      ) : (
        packages.map((item) => {
          const instant = canPayInstantly(item.package);
          const action = instant
            ? timeBased ? 'Choose session' : 'Book package'
            : item.package.price_type === 'quote' ? 'Get proposal' : 'Request final quote';
          return (
            <PackageCard
              key={item.package.id}
              servicePackage={item.package}
              providerName={item.providerName}
              rating={item.rating}
              ratingCount={item.ratingCount}
              providerOnline={item.providerOnline}
              providerPaused={item.providerPaused}
              actionLabel={item.providerPaused ? 'On holiday' : action}
              onPress={item.providerPaused ? undefined : () => {
                if (!instant) {
                  router.push({ pathname: '/request/new', params: { categoryId: category.id, name: category.name, package: item.package.id } });
                  return;
                }
                router.push({ pathname: '/book/[providerServiceId]', params: { providerServiceId: item.providerServiceId, packageId: item.package.id, archetype: category.archetype! } });
              }}
            />
          );
        })
      )}
    </Screen>
  );
}

const CREATOR_FILTERS: SearchFilters = { sort: 'recommended', minRating: null, skillLevel: null, maxVisitFee: null, onlineOnly: false };

function ProposalCategory({ category }: { category: Category }) {
  const t = useTheme();
  const { coords, location } = useSelectedLocation();
  const city = location.city;
  const scope = JSON.stringify([category.slug, city, coords.lat, coords.lng]);
  const [proResult, setProResult] = useState<{ scope: string; pros: ProviderSearchResult[] } | null>(null);
  const [packageResult, setPackageResult] = useState<{ scope: string; packages: CataloguePackage[] } | null>(null);
  const [proFailure, setProFailure] = useState<{ scope: string; message: string } | null>(null);
  const [packageFailure, setPackageFailure] = useState<{ scope: string; message: string } | null>(null);
  const pros = proResult?.scope === scope ? proResult.pros : null;
  const packages = packageResult?.scope === scope ? packageResult.packages : null;
  const proError = proFailure?.scope === scope ? proFailure.message : null;
  const packageError = packageFailure?.scope === scope ? packageFailure.message : null;
  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    const requestScope = scope;
    const requestSlug = category.slug;
    const requestCity = city;
    const requestCoords = { lat: coords.lat, lng: coords.lng };
    setProFailure((current) => current?.scope === requestScope ? null : current);
    setPackageFailure((current) => current?.scope === requestScope ? null : current);
    await Promise.all([
      searchProviders(requestSlug, requestCoords, CREATOR_FILTERS)
        .then((value) => {
          if (guard.isCurrent()) setProResult({ scope: requestScope, pros: value });
        })
        .catch((error: Error) => {
          if (guard.isCurrent()) setProFailure({ scope: requestScope, message: error.message });
        }),
      listCataloguePackages(requestSlug, requestCity)
        .then((value) => {
          if (guard.isCurrent()) setPackageResult({ scope: requestScope, packages: value });
        })
        .catch((error: Error) => {
          if (guard.isCurrent()) setPackageFailure({ scope: requestScope, message: error.message });
        }),
    ]);
  }, [category.slug, city, coords.lat, coords.lng, scope]);
  const { refresh, refreshing } = useEntityRefresh(load, {
    contextKey: scope,
    enabled: true,
    intervalMs: null,
  });

  const requestFrom = (pro?: ProviderSearchResult) =>
    router.push({
      pathname: '/request/new',
      params: pro
        ? { categoryId: category.id, name: category.name, providerId: pro.provider_id, providerName: pro.full_name || 'this provider' }
        : { categoryId: category.id, name: category.name },
    });

  return (
    <Screen
      header={<Header title={category.name} subtitle="Browse pros or get several proposals at once" />}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      <Card variant="elevated" gap={t.spacing.md}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="document-text-outline" size={22} color={t.colors.primaryText} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="calloutStrong">Not sure who to pick?</Text>
            <Text variant="footnote" color="muted">Describe it once and compare fixed proposals from up to 8 pros. Pay nothing until you choose one.</Text>
          </View>
        </View>
        <Button title="Get proposals from several pros" variant="outline" leftIcon="people-outline" onPress={() => requestFrom()} fullWidth />
      </Card>

      {packageError ? (
        <InlineAlert message={packageError} actionLabel="Retry" onAction={() => void refresh()} />
      ) : null}
      {packages?.length ? (
        <Section title="Creator packages" subtitle="Choose a package to include its terms in your request.">
          {packages.map((item) => (
            <PackageCard
              key={item.package.id}
              servicePackage={item.package}
              providerName={item.providerName}
              rating={item.rating}
              ratingCount={item.ratingCount}
              providerOnline={item.providerOnline}
              providerPaused={item.providerPaused}
              actionLabel={item.providerPaused ? 'On holiday' : 'Get proposal'}
              onPress={item.providerPaused ? undefined : () => router.push({
                pathname: '/request/new',
                params: {
                  categoryId: category.id,
                  name: category.name,
                  providerId: item.providerId,
                  providerName: item.providerName,
                  package: item.package.id,
                },
              })}
            />
          ))}
        </Section>
      ) : null}

      <Section title={`${category.name} pros near you`} subtitle="Prices depend on your brief. Request a proposal to get a fixed quote.">
        {proError ? (
          <ErrorState message={proError} onRetry={() => void refresh()} />
        ) : pros == null ? (
          <View style={{ gap: t.spacing.md }}><SkeletonProviderCard /><SkeletonProviderCard /></View>
        ) : pros.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="No pros listed nearby yet"
            message="No matching pros were found for this category yet."
            actionLabel="Get proposals"
            onAction={() => requestFrom()}
          />
        ) : (
          pros.map((pro) => (
            <ProviderCard
              key={pro.provider_service_id}
              provider={pro}
              mode="proposal"
              onPress={() => router.push({ pathname: '/provider/[id]', params: { id: pro.provider_id, category: category.slug } })}
              onBook={() => requestFrom(pro)}
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
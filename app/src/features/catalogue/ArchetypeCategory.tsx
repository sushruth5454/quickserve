import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { ProviderCard } from '../../components/ProviderCard';
import { Button, Card, EmptyState, ErrorState, Header, Screen, Section, Skeleton, SkeletonProviderCard, Text } from '../../components/ui';
import { searchProviders } from '../../lib/api';
import { useSelectedLocation } from '../../lib/locationContext';
import type { Category, ProviderSearchResult, SearchFilters } from '../../lib/types';
import { useTheme } from '../../theme';
import { PackageCard } from '../booking/packages/PackageCard';
import { canPayInstantly } from '../booking/packages/packageModel';
import { listCataloguePackages, type CataloguePackage } from './api';

export function ArchetypeCategory({ category }: { category: Category }) {
  const t = useTheme();
  const [packages, setPackages] = useState<CataloguePackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    listCataloguePackages(category.slug).then(setPackages).catch((caught: Error) => setError(caught.message));
  };
  useEffect(load, [category.slug]);

  if (category.archetype === 'proposal') return <ProposalCategory category={category} />;

  const fixed = category.archetype === 'fixed';
  const timeBased = category.archetype === 'time_based';
  return (
    <Screen header={<Header title={category.name} subtitle={fixed ? 'Choose a package. The price shown is the price you pay.' : 'Book a session or save with a session pack.'} />}>
      {error ? <ErrorState message={error} onRetry={load} /> : packages == null ? (
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
  const { coords } = useSelectedLocation();
  const [pros, setPros] = useState<ProviderSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    searchProviders(category.slug, coords, CREATOR_FILTERS).then(setPros).catch((caught: Error) => setError(caught.message));
  }, [category.slug, coords]);
  useEffect(load, [load]);

  const requestFrom = (pro?: ProviderSearchResult) =>
    router.push({
      pathname: '/request/new',
      params: pro
        ? { categoryId: category.id, name: category.name, providerId: pro.provider_id, providerName: pro.full_name || 'this provider' }
        : { categoryId: category.id, name: category.name },
    });

  return (
    <Screen header={<Header title={category.name} subtitle="Browse pros or get several proposals at once" />}>
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

      <Section title={`${category.name} pros near you`} subtitle="Prices depend on your brief. Request a proposal to get a fixed quote.">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : pros == null ? (
          <View style={{ gap: t.spacing.md }}><SkeletonProviderCard /><SkeletonProviderCard /></View>
        ) : pros.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="No pros listed nearby yet"
            message="Post your brief anyway. New pros joining your city will see it."
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
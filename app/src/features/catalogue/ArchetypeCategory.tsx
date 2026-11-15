import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, Screen, Skeleton, Text } from '../../components/ui';
import type { Category } from '../../lib/types';
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

  if (category.archetype === 'proposal') {
    return (
      <Screen header={<Header title={category.name} />}>
        <Card variant="elevated" gap={t.spacing.lg}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="document-text-outline" size={28} color={t.colors.primaryText} />
          </View>
          <View style={{ gap: 4 }}>
            <Text variant="title2">Tell verified pros what you need</Text>
            <Text variant="callout" color="muted">Compare fixed, itemised proposals. Pay nothing until you choose one.</Text>
          </View>
          <View style={{ gap: t.spacing.sm }}>
            {['Describe the event or project', 'Compare price, inclusions and milestones', 'Pay a booking advance to confirm'].map((step, index) => (
              <View key={step} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Text variant="captionStrong">{index + 1}</Text>
                </View>
                <Text variant="callout" color="textSecondary">{step}</Text>
              </View>
            ))}
          </View>
          <Button title="Get proposals" leftIcon="add-circle-outline" onPress={() => router.push({ pathname: '/request/new', params: { category: category.slug } })} fullWidth size="lg" />
        </Card>
      </Screen>
    );
  }

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
              actionLabel={action}
              onPress={() => {
                if (!instant) {
                  router.push({ pathname: '/request/new', params: { category: category.slug, package: item.package.id } });
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

import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { CategoryIcon, iconForCategory } from '../../components/CategoryIcon';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../components/ui';
import { getCatalogue } from '../catalogue/api';
import type { Catalogue } from '../catalogue/model';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useSelectedLocation } from '../../lib/locationContext';
import { useT } from '../../i18n';
import { useTheme } from '../../theme';
import { creatorCategories } from './creatorCategories';

const CREATOR_STEPS = ['creators.step1', 'creators.step2', 'creators.step3', 'creators.step4'] as const;

export function CreatorsScreen() {
  const theme = useTheme();
  const t = useT();
  const enabled = useAppFeatureFlags().isOn('creators_landing');
  const { location } = useSelectedLocation();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setCatalogue(null);
    setLoadError(false);
    try {
      setCatalogue(await getCatalogue(location.city));
    } catch {
      setLoadError(true);
    }
  }, [enabled, location.city]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = catalogue == null ? [] : creatorCategories(catalogue);

  return (
    <Screen header={<Header title={t('creators.title')} />}>
      {!enabled ? (
        <>
          <InlineAlert tone="info" message={t('feature.off', { feature: t('creators.title') })} />
          <Button title={t('tabs.home')} leftIcon="home-outline" variant="outline" onPress={() => router.replace('/')} fullWidth />
        </>
      ) : (
        <>
          {loadError ? (
            <ErrorState message={t('error.generic')} onRetry={() => void load()} />
          ) : catalogue == null ? (
            <View style={{ gap: theme.spacing.md }}>
              <Skeleton height={80} radius={theme.radii.lg} />
              <Skeleton height={80} radius={theme.radii.lg} />
            </View>
          ) : (
            <View style={{ gap: theme.spacing.md }}>
              {categories.length === 0 ? (
                <EmptyState
                  icon="location-outline"
                  title={`No creator categories are available in ${location.city}`}
                  message="Try another location or browse all services."
                  actionLabel="Change location"
                  onAction={() => router.push('/location')}
                  secondaryLabel="Browse services"
                  onSecondary={() => router.push('/')}
                />
              ) : categories.map((category) => (
                <Card
                  key={category.id}
                  accessibilityLabel={category.name}
                  onPress={() => router.push({ pathname: '/category/[slug]', params: { slug: category.slug, name: category.name } })}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, minHeight: 56 }}>
                    <CategoryIcon icon={iconForCategory(category)} size={48} />
                    <Text variant="bodyStrong" numberOfLines={2} style={{ flex: 1 }}>{category.name}</Text>
                  </View>
                </Card>
              ))}
            </View>
          )}
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="title3" accessibilityRole="header">{t('creators.how')}</Text>
            <Card variant="filled">
              {CREATOR_STEPS.map((step, index) => (
                <View key={step} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: theme.radii.pill,
                      backgroundColor: theme.colors.primarySoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text variant="calloutStrong" style={{ color: theme.colors.primaryText }}>{index + 1}</Text>
                  </View>
                  <Text variant="body" style={{ flex: 1 }}>{t(step)}</Text>
                </View>
              ))}
            </Card>
          </View>
        </>
      )}
    </Screen>
  );
}

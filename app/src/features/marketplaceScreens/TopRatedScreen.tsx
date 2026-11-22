import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { TopRatedRow } from '../../components/TopRatedCard';
import { EmptyState, ErrorState, Header, InlineAlert, Screen, SkeletonProviderCard } from '../../components/ui';
import { listTopRated, type TopRatedProvider } from '../../lib/api';
import { useSelectedLocation } from '../../lib/locationContext';
import { useTheme } from '../../theme';
import { topRatedHeaderModel } from '../../components/providerCardModel';
import { useEntityRefresh } from '../../lib/useEntityRefresh';

export default function TopRatedScreen() {
  const t = useTheme();
  const { location } = useSelectedLocation();
  const city = location.city;
  const scope = JSON.stringify([city]);
  const [result, setResult] = useState<{ scope: string; value: TopRatedProvider[] } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const list = result?.scope === scope ? result.value : null;
  const error = failure?.scope === scope ? failure.message : null;

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    const requestScope = scope;
    const requestCity = city;
    setFailure((current) => current?.scope === requestScope ? null : current);
    try {
      const value = await listTopRated(50, requestCity);
      if (guard.isCurrent()) {
        setResult({ scope: requestScope, value });
        setFailure(null);
      }
    } catch (caught) {
      if (guard.isCurrent()) setFailure({ scope: requestScope, message: (caught as Error).message });
    }
  }, [city, scope]);
  const { refresh, refreshing } = useEntityRefresh(load, {
    contextKey: scope,
    enabled: true,
    intervalMs: null,
  });
  const header = topRatedHeaderModel(location.city, list?.length ?? null);

  return (
    <Screen
      header={<Header title={header.title} subtitle={header.subtitle} />}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      gap={t.spacing.md}
    >
      {error && !list ? (
        <ErrorState message={error} onRetry={() => void refresh()} />
      ) : error ? (
        <InlineAlert message={error} actionLabel="Retry" onAction={() => void refresh()} />
      ) : !list ? (
        [0, 1, 2].map((i) => <SkeletonProviderCard key={i} />)
      ) : list.length === 0 ? (
        <EmptyState icon="star-outline" title="No rated pros yet" message="Pros appear here once customers rate their work." />
      ) : (
        list.map((p) => (
          <TopRatedRow
            key={p.id}
            provider={p}
            onPress={() => router.push({ pathname: '/provider/[id]', params: { id: p.id } })}
          />
        ))
      )}
    </Screen>
  );
}

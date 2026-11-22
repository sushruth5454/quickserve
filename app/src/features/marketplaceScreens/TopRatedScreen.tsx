import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { TopRatedRow } from '../../components/TopRatedCard';
import { EmptyState, ErrorState, Header, Screen, SkeletonProviderCard } from '../../components/ui';
import { listTopRated, type TopRatedProvider } from '../../lib/api';
import { useSelectedLocation } from '../../lib/locationContext';
import { useTheme } from '../../theme';
import { topRatedHeaderModel } from '../../components/providerCardModel';

export default function TopRatedScreen() {
  const t = useTheme();
  const { location } = useSelectedLocation();
  const [list, setList] = useState<TopRatedProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await listTopRated(50, location.city));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [location.city]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };
  const header = topRatedHeaderModel(location.city, list?.length ?? null);

  return (
    <Screen
      header={<Header title={header.title} subtitle={header.subtitle} />}
      refreshing={refreshing}
      onRefresh={refresh}
      gap={t.spacing.md}
    >
      {error && !list ? (
        <ErrorState message={error} onRetry={() => void load()} />
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

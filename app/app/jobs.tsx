import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { CategoryIcon } from '../src/components/CategoryIcon';
import { activeStatuses, StatusPill } from '../src/components/status';
import { Card, EmptyState, ErrorState, Header, Screen, SegmentedControl, SkeletonBookingCard, Text } from '../src/components/ui';
import { getProviderJobs, listCategories } from '../src/lib/api';
import { formatINR } from '../src/lib/money';
import type { Category, ProviderJob } from '../src/lib/types';
import { useTheme } from '../src/theme';

type Filter = 'all' | 'active' | 'done';

export default function ProviderJobs() {
  const t = useTheme();
  const [jobs, setJobs] = useState<ProviderJob[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [j, c] = await Promise.all([getProviderJobs(), listCategories()]);
      setJobs(j);
      setCategories(c);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const list = (jobs ?? []).filter((j) =>
    filter === 'all' ? true : filter === 'active' ? activeStatuses.includes(j.status) : !activeStatuses.includes(j.status),
  );

  return (
    <Screen
      header={
        <Header title="Job history" subtitle={jobs ? `${jobs.length} jobs` : undefined}>
          <View style={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.md }}>
            <SegmentedControl<Filter>
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'done', label: 'Closed' },
              ]}
              value={filter}
              onChange={setFilter}
              accessibilityLabel="Job filter"
            />
          </View>
        </Header>
      }
      gap={t.spacing.md}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      {error && !jobs ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !jobs ? (
        Array.from({ length: 5 }).map((_, i) => <SkeletonBookingCard key={i} />)
      ) : list.length === 0 ? (
        <EmptyState icon="briefcase-outline" title="No jobs here yet" message="Stay online to receive requests from customers nearby." />
      ) : (
        list.map((j) => (
          <Card
            key={j.booking_id}
            onPress={() => router.push({ pathname: '/booking/[id]', params: { id: j.booking_id } })}
            accessibilityLabel={`${j.category_name} for ${j.customer_name}`}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md }}
          >
            <CategoryIcon icon={categories.find((c) => c.name === j.category_name)?.icon} size={44} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text variant="calloutStrong" numberOfLines={1}>
                {j.customer_name || 'Customer'}
              </Text>
              <Text variant="footnote" color="muted" numberOfLines={1}>
                {j.category_name} · {new Date(j.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </Text>
              {j.area ? (
                <Text variant="footnote" color="muted" numberOfLines={1}>
                  {j.area}
                </Text>
              ) : null}
              <View style={{ marginTop: 4 }}>
                <StatusPill status={j.status} />
              </View>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text variant="calloutStrong" tabular>
                {formatINR(j.visit_fee)}
              </Text>
              <Text variant="caption" color="muted">
                Visit fee
              </Text>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

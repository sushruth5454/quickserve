import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { CategoryIcon, iconForCategory } from '../../components/CategoryIcon';
import { activeStatuses, StatusPill } from '../../components/status';
import { UnreadMessagesRow } from '../../components/UnreadChat';
import { Card, EmptyState, ErrorState, Header, InlineAlert, Screen, SegmentedControl, SkeletonBookingCard, Text } from '../../components/ui';
import { getProviderJobs, listCategories } from '../../lib/api';
import { formatINR } from '../../lib/money';
import type { Category, ProviderJob } from '../../lib/types';
import { useUnread } from '../../lib/unreadContext';
import { useTheme } from '../../theme';

type Filter = 'all' | 'active' | 'done';

const EMPTY_STATE: Record<Filter, { title: string; message: string }> = {
  all: { title: 'No jobs yet', message: 'New requests and bookings will appear here.' },
  active: { title: 'No active jobs', message: 'Requests and ongoing bookings will appear here.' },
  done: { title: 'No closed jobs yet', message: 'Completed or closed jobs will appear here.' },
};

export default function JobsScreen() {
  const t = useTheme();
  const [jobs, setJobs] = useState<ProviderJob[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unread = useUnread();
  const refreshUnread = unread.refresh;

  const load = useCallback(async () => {
    try {
      const [nextJobs, nextCategories] = await Promise.all([getProviderJobs(), listCategories()]);
      setJobs(nextJobs);
      setCategories(nextCategories);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Could not refresh job history.');
    }
    void refreshUnread();
  }, [refreshUnread]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const list = (jobs ?? []).filter((job) =>
    filter === 'all' ? true : filter === 'active' ? activeStatuses.includes(job.status) : !activeStatuses.includes(job.status),
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
      {error && jobs ? <InlineAlert title="Could not refresh jobs" message={`${error} Previously loaded jobs are still shown.`} /> : null}
      {error && !jobs ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !jobs ? (
        Array.from({ length: 5 }).map((_, i) => <SkeletonBookingCard key={i} />)
      ) : list.length === 0 ? (
        <EmptyState icon="briefcase-outline" title={EMPTY_STATE[filter].title} message={EMPTY_STATE[filter].message} />
      ) : (
        list.map((job) => (
          <Card
            key={job.booking_id}
            onPress={() => router.push({ pathname: '/booking/[id]', params: { id: job.booking_id } })}
            accessibilityLabel={`${job.category_name} for ${job.customer_name}`}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md }}
          >
            <CategoryIcon icon={iconForCategory(categories.find((category) => category.name === job.category_name))} size={44} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text variant="calloutStrong" numberOfLines={1}>
                {job.customer_name || 'Customer'}
              </Text>
              <Text variant="footnote" color="muted" numberOfLines={1}>
                {job.category_name} · {new Date(job.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </Text>
              {job.area ? (
                <Text variant="footnote" color="muted" numberOfLines={1}>
                  {job.area}
                </Text>
              ) : null}
              <View style={{ marginTop: 4 }}>
                <StatusPill status={job.status} />
              </View>
              <UnreadMessagesRow bookingId={job.booking_id} count={unread.countFor(job.booking_id)} />
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text variant="calloutStrong" tabular>
                {formatINR(job.visit_fee)}
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

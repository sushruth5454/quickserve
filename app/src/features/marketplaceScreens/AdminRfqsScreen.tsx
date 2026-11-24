import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Card, EmptyState, ErrorState, Header, InlineAlert, ListItem, Screen, Skeleton, Text } from '../../components/ui';
import { getAdminRfqDashboard, type AdminRfqDashboard } from '../rfq/api';
import { rfqViewState } from '../rfq/rfqStateModel';
import { useTheme } from '../../theme';

type AdminRecentRfq = AdminRfqDashboard['recent_rfqs'][number] & { expires_at: string };
type AdminRfqDashboardWithDeadlines = Omit<AdminRfqDashboard, 'recent_rfqs'> & {
  recent_rfqs: AdminRecentRfq[];
};

export default function AdminRfqsScreen() {
  const t = useTheme();
  const [dashboard, setDashboard] = useState<AdminRfqDashboardWithDeadlines | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setNowMs(Date.now());
    setLoading(true);
    setError(null);
    try {
      setDashboard(await getAdminRfqDashboard() as AdminRfqDashboardWithDeadlines);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen header={<Header title="Product RFQs" subtitle="Marketplace quotation activity" />} gap={t.spacing.md} refreshing={loading} onRefresh={() => void load()}>
      {loading && !dashboard ? <Skeleton height={180} radius={t.radii.lg} /> : null}
      {!loading && error && !dashboard ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {error && dashboard ? <InlineAlert message={`Refresh failed. Showing saved results. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
      {dashboard ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            <Card style={{ flex: 1, minWidth: 140, gap: t.spacing.xs }}>
              <Text variant="caption" color="muted">Open RFQs</Text>
              <Text variant="title2">{dashboard.open_rfqs}</Text>
              <Text variant="caption" color="muted">Raw-open requests past their deadline are excluded.</Text>
            </Card>
            <Card style={{ flex: 1, minWidth: 140, gap: t.spacing.xs }}>
              <Text variant="caption" color="muted">Quotes per RFQ</Text>
              <Text variant="title2">{dashboard.average_quotes_per_rfq}</Text>
              <Text variant="caption" color="muted">{dashboard.total_quotes} current quotes across {dashboard.total_rfqs} requests</Text>
            </Card>
          </View>
          <Card style={{ gap: t.spacing.xs }}>
            <Text variant="caption" color="muted">Average first response time</Text>
            <Text variant="title2">{dashboard.average_response_minutes} min</Text>
          </Card>
          <Text variant="title3">Recent requests</Text>
          {dashboard.recent_rfqs.length ? dashboard.recent_rfqs.map((rfq) => {
            const state = rfqViewState({
              status: rfq.status,
              expiresAt: rfq.expires_at,
              quoteStatus: null,
              myOutcome: null,
              canSendQuote: false,
              nowMs,
            });
            return (
              <ListItem
                key={rfq.id}
                icon="document-text-outline"
                title={rfq.title}
                subtitle={`${rfq.city} · Raw status ${rfq.status} · ${state.rfqLabel} · Deadline ${new Date(rfq.expires_at).toLocaleDateString()} · ${rfq.quote_count} quote(s)`}
                chevron={false}
              />
            );
          }) : <EmptyState title="No product RFQs" message="RFQ activity will appear here when the feature is enabled." />}
        </>
      ) : null}
    </Screen>
  );
}

import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { CategoryIcon, iconForSlug } from '../../../components/CategoryIcon';
import { Card, EmptyState, ErrorState, InlineAlert, Skeleton, Text } from '../../../components/ui';
import { listMyServiceRequests } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import type { ServiceRequest } from '../../../lib/types';
import { useTheme } from '../../../theme';
import { useFocusedServiceRefresh } from '../../serviceLifecycle/useFocusedServiceRefresh';
import type { MarkRead, RegisterRefresh } from './types';

export function requestRefreshErrorState(
  error: string | null,
  requests: ServiceRequest[] | null,
): 'initial-error' | 'stale-warning' | null {
  if (!error) return null;
  return requests === null ? 'initial-error' : 'stale-warning';
}

export function RequestsSegment({ registerRefresh, markRead }: { registerRefresh: RegisterRefresh; markRead: MarkRead }) {
  const t = useTheme();
  const { userId } = useAuth();
  const [requests, setRequests] = useState<ServiceRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    try {
      const next = await listMyServiceRequests();
      if (!guard.isCurrent()) return;
      setRequests(next);
      setError(null);
    } catch (e) {
      if (guard.isCurrent()) setError((e as Error).message);
    }
  }, []);

  const { refresh } = useFocusedServiceRefresh(load, {
    contextKey: `customer-requests:${userId ?? 'anonymous'}`,
    enabled: true,
    intervalMs: 30_000,
  });
  useEffect(() => registerRefresh(refresh), [refresh, registerRefresh]);

  const errorState = requestRefreshErrorState(error, requests);
  if (errorState === 'initial-error') return <ErrorState message={error!} onRetry={() => void refresh()} />;
  if (!requests) return [0, 1, 2].map((index) => <Skeleton key={index} height={94} radius={t.radii.lg} />);
  if (!requests.length) {
    return (
      <View style={{ gap: t.spacing.sm }}>
        {errorState === 'stale-warning' ? <InlineAlert message={error!} /> : null}
        <EmptyState icon="document-text-outline" title="No service requests yet" message="Requests you create for proposals will appear here." />
      </View>
    );
  }

  return (
    <View style={{ gap: t.spacing.sm }}>
      {errorState === 'stale-warning' ? <InlineAlert message={error!} /> : null}
      {requests.map((request) => (
        <Card
          key={request.id}
          onPress={() => {
            void markRead('request', request.id).catch(() => undefined);
            router.push({ pathname: '/request/[id]', params: { id: request.id } });
          }}
          gap={t.spacing.sm}
          accessibilityLabel={`${request.categories?.name ?? 'Service request'}, ${request.status}`}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
            <CategoryIcon icon={iconForSlug(request.categories?.slug)} size={40} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" numberOfLines={1}>{request.categories?.name ?? 'Service request'}</Text>
              <Text variant="footnote" color="muted" numberOfLines={1}>
                {request.area || request.city} · {new Date(request.event_start).toLocaleDateString('en-IN')}
              </Text>
            </View>
            <Text variant="captionStrong" color={request.status === 'open' ? 'primaryText' : 'muted'}>
              {request.status === 'open' ? 'Proposals arriving' : request.status}
            </Text>
          </View>
          <Text variant="caption" color="muted">Expires {new Date(request.expires_at).toLocaleDateString('en-IN')}</Text>
        </Card>
      ))}
    </View>
  );
}

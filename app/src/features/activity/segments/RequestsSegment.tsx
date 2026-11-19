import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { CategoryIcon, iconForSlug } from '../../../components/CategoryIcon';
import { Card, EmptyState, ErrorState, Skeleton, Text } from '../../../components/ui';
import { listMyServiceRequests } from '../../../lib/api';
import type { ServiceRequest } from '../../../lib/types';
import { useTheme } from '../../../theme';
import type { MarkRead, RegisterRefresh } from './types';

export function RequestsSegment({ registerRefresh, markRead }: { registerRefresh: RegisterRefresh; markRead: MarkRead }) {
  const t = useTheme();
  const [requests, setRequests] = useState<ServiceRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests(await listMyServiceRequests());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => registerRefresh(load), [load, registerRefresh]);

  if (error && !requests) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!requests) return [0, 1, 2].map((index) => <Skeleton key={index} height={94} radius={t.radii.lg} />);
  if (!requests.length) {
    return <EmptyState icon="document-text-outline" title="No service requests yet" message="Requests you create for proposals will appear here." />;
  }

  return (
    <View style={{ gap: t.spacing.sm }}>
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

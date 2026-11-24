import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, EmptyState, ErrorState, Header, InlineAlert, ListItem, Screen, Skeleton, Text } from '../../components/ui';
import { listMySupplierRfqs, supplierRfqDetailRouteParams, type SupplierRfqSummary } from '../rfq/api';
import { useRfqFeatureFlags } from '../rfq/components';
import { nearestFutureRfqDeadlineMs, rfqViewState } from '../rfq/rfqStateModel';
import { useTheme } from '../../theme';

export default function MerchantRfqsScreen() {
  const t = useTheme();
  const { rfq: enabled } = useRfqFeatureFlags();
  const [rfqs, setRfqs] = useState<SupplierRfqSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasRead, setHasRead] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const focused = useRef(false);
  const deadlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setNowMs(Date.now());
    setLoading(true);
    setError(null);
    try {
      setRfqs(await listMySupplierRfqs());
      setError(null);
      setHasRead(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    setNowMs(Date.now());
    void load();
    return () => {
      focused.current = false;
      if (deadlineTimer.current) clearTimeout(deadlineTimer.current);
      deadlineTimer.current = null;
    };
  }, [load]));

  useEffect(() => {
    if (deadlineTimer.current) clearTimeout(deadlineTimer.current);
    deadlineTimer.current = null;
    if (!focused.current) return;

    const nearest = nearestFutureRfqDeadlineMs(
      rfqs.filter((rfq) => rfq.rfq_status === 'open').map((rfq) => rfq.expires_at),
      nowMs,
    );
    if (nearest === null) return;
    const delayMs = nearest - Date.now();
    if (delayMs <= 0) {
      setNowMs(Date.now());
      void load();
      return;
    }

    deadlineTimer.current = setTimeout(() => {
      deadlineTimer.current = null;
      if (!focused.current) return;
      setNowMs(Date.now());
      void load();
    }, Math.min(delayMs, 2_147_483_647));
    return () => {
      if (deadlineTimer.current) clearTimeout(deadlineTimer.current);
      deadlineTimer.current = null;
    };
  }, [rfqs, nowMs, load]);

  return (
    <Screen
      header={<Header title="Supplier RFQs" subtitle="Requests routed to your verified shop" />}
      gap={t.spacing.md}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      {error && !hasRead ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {error && hasRead ? <InlineAlert message={`Refresh failed. Showing saved supplier RFQ history. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
      {!enabled ? <Text variant="caption" color="muted">Existing RFQ history is read-only while product RFQs are turned off.</Text> : null}
      {loading && !hasRead ? <Skeleton height={84} radius={t.radii.lg} /> : rfqs.length ? rfqs.map((rfq) => {
        const viewState = rfqViewState({
          status: rfq.rfq_status,
          expiresAt: rfq.expires_at,
          quoteStatus: rfq.quote_status,
          myOutcome: rfq.my_outcome,
          canSendQuote: false,
          nowMs,
        });
        return (
          <ListItem
            key={`${rfq.shop_id}:${rfq.rfq_id}`}
            icon="document-text-outline"
            title={rfq.title}
            subtitle={`${rfq.shop_name} · ${rfq.category_name} · ${rfq.item_count} item(s) · ${rfq.area}, ${rfq.city} · Needed by ${new Date(`${rfq.needed_by}T00:00:00`).toLocaleDateString()}`}
            right={
              <View style={{ alignItems: 'flex-end', gap: t.spacing.xs }}>
                <Text variant="captionStrong">RFQ: {viewState.rfqLabel}</Text>
                <Text variant="captionStrong">Quote: {viewState.quoteLabel}</Text>
              </View>
            }
            chevron
            onPress={() => router.push({
              pathname: '/rfq/merchant/[id]',
              params: supplierRfqDetailRouteParams(rfq),
            })}
          />
        );
      }) : hasRead ? (
        <EmptyState title="No recent RFQs" message="Requests routed to your shop and their outcomes appear here for 30 days." />
      ) : null}
      <Button title="Manage my shop" variant="outline" onPress={() => router.push('/merchant-shop')} />
    </Screen>
  );
}

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, EmptyState, ErrorState, Header, InlineAlert, ListItem, Screen, Skeleton, Text } from '../../components/ui';
import { listMySupplierRfqs, supplierRfqDetailRouteParams, type SupplierRfqSummary } from '../rfq/api';
import { useRfqFeatureFlags } from '../rfq/components';
import { nearestFutureRfqDeadlineMs, rfqViewState } from '../rfq/rfqStateModel';
import { useTheme } from '../../theme';

function routeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readRouteParams<T extends object>(): T {
  const routeHook = useLocalSearchParams as unknown as (() => T) | undefined;
  return (routeHook ?? (() => ({} as T)))();
}

function useRfqDisplayIdentity(): { displayName: string } {
  let useIdentity: ((context: 'rfq') => { displayName: string }) | undefined;
  try {
    const identity = require('../../branding/useBrandIdentity') as {
      useBrandIdentity: (context: 'rfq') => { displayName: string };
    };
    useIdentity = identity.useBrandIdentity;
  } catch {
    return { displayName: 'Nearo' };
  }
  return useIdentity!('rfq');
}

export default function MerchantRfqsScreen() {
  const t = useTheme();
  const params = readRouteParams<{ ownerId?: string | string[]; shopId?: string | string[] }>();
  const ownerId = routeParam(params.ownerId);
  const shopId = routeParam(params.shopId);
  const identity = useRfqDisplayIdentity();
  const { rfq: enabled } = useRfqFeatureFlags();
  const [rfqs, setRfqs] = useState<SupplierRfqSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasRead, setHasRead] = useState(false);
  const [readShopId, setReadShopId] = useState<string | undefined>();
  const requestSequence = useRef(0);
  const hasReadCurrentScope = hasRead && readShopId === shopId;
  const visibleRfqs = hasReadCurrentScope ? rfqs : [];
  const [nowMs, setNowMs] = useState(() => Date.now());
  const focused = useRef(false);
  const deadlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const request = ++requestSequence.current;
    setNowMs(Date.now());
    setLoading(true);
    setError(null);
    try {
      const authorizedRfqs = await listMySupplierRfqs();
      if (request !== requestSequence.current) return;
      setRfqs(shopId ? authorizedRfqs.filter((rfq) => rfq.shop_id === shopId) : authorizedRfqs);
      setError(null);
      setHasRead(true);
      setReadShopId(shopId);
    } catch (e) {
      if (request === requestSequence.current) setError((e as Error).message);
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [shopId]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    setNowMs(Date.now());
    void load();
    return () => {
      requestSequence.current += 1;
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
      visibleRfqs.filter((rfq) => rfq.rfq_status === 'open').map((rfq) => rfq.expires_at),
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
  }, [visibleRfqs, nowMs, load]);
  const manageShop = () => {
    if (ownerId || shopId) {
      router.push({
        pathname: '/merchant-shop',
        params: {
          ...(ownerId ? { ownerId } : {}),
          ...(shopId ? { shopId } : {}),
        },
      });
    } else {
      router.push('/merchant-shop');
    }
  };
  return (
    <Screen
      header={<Header title="Supplier RFQs" subtitle={`Requests routed to your verified ${identity.displayName} shop`} />}
      gap={t.spacing.md}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      {error && !hasReadCurrentScope ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {error && hasReadCurrentScope ? <InlineAlert message={`Refresh failed. Showing saved supplier RFQ history. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
      {!enabled ? <Text variant="caption" color="muted">Existing RFQ history is read-only while product RFQs are turned off.</Text> : null}
      <Text variant="captionStrong">{shopId ? 'Selected shop' : 'All businesses'}</Text>
      {loading && !hasReadCurrentScope ? <Skeleton height={84} radius={t.radii.lg} /> : visibleRfqs.length ? visibleRfqs.map((rfq) => {
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
      }) : hasReadCurrentScope ? (
        <EmptyState
          title={shopId ? 'No recent RFQs for this selected shop' : 'No recent RFQs'}
          message="Requests routed to your shop and their outcomes appear here for 30 days."
        />
      ) : null}
      <Button title="Manage my shop" variant="outline" onPress={manageShop} />
    </Screen>
  );
}

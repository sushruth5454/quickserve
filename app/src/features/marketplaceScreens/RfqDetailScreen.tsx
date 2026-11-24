import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, useWindowDimensions, View } from 'react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text, useConfirm, useToast } from '../../components/ui';
import { sortByPrice } from '../../components/market/compareModel';
import { cancelRfq, compareRfqQuotes, getRfq, selectSupplierQuote, type Rfq, type RfqQuoteComparison } from '../rfq/api';
import { buildComparePresentation } from '../rfq/comparePresentation';
import * as RfqComponents from '../rfq/components';
import { nearestFutureRfqDeadlineMs, rfqViewState } from '../rfq/rfqStateModel';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';

const RfqCompositionSection = RfqComponents.RfqCompositionSection
  ?? (({ children }: { children: ReactNode }) => children);
const RfqSupplierComparisonLayout = RfqComponents.RfqSupplierComparisonLayout
  ?? (({ children }: { children: ReactNode }) => <View>{children}</View>);
const rfqQuoteValidityWarning = RfqComponents.rfqQuoteValidityWarning ?? (() => null);

function ResponsiveRfqComparison({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  return <RfqSupplierComparisonLayout wide={width >= 760}>{children}</RfqSupplierComparisonLayout>;
}

function describeSpecs(specs: Record<string, unknown>) {
  const entries = Object.entries(specs ?? {});
  return entries.length ? entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ') : 'No specifications supplied';
}

export default function RfqDetailScreen() {
  const t = useTheme();
  const confirm = useConfirm();
  const toast = useToast();
  const { rfq: enabled, enquiries: enquiriesEnabled, composition } = RfqComponents.useRfqFeatureFlags();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [quotes, setQuotes] = useState<RfqQuoteComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hasRead, setHasRead] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [expandedQuoteIds, setExpandedQuoteIds] = useState<Record<string, boolean>>({});
  const requestId = useRef(0);
  const focused = useRef(false);
  const deadlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const currentRequestId = ++requestId.current;
    setNowMs(Date.now());
    setLoading(true);
    setError(null);
    try {
      const [nextRfq, nextQuotes] = await Promise.all([getRfq(id), compareRfqQuotes(id)]);
      if (currentRequestId !== requestId.current) return;
      setRfq(nextRfq);
      setQuotes(nextQuotes);
      setError(null);
      setHasRead(true);
    } catch (e) {
      if (currentRequestId !== requestId.current) return;
      setError((e as Error).message);
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    setNowMs(Date.now());
    void load();
    return () => {
      focused.current = false;
      requestId.current += 1;
      if (deadlineTimer.current) clearTimeout(deadlineTimer.current);
      deadlineTimer.current = null;
    };
  }, [load]));

  const activeRfq = rfq?.id === id ? rfq : null;
  const comparePresentation = useMemo(
    () => buildComparePresentation(quotes, {
      rfqStatus: activeRfq?.status ?? 'closed',
      rfqExpiresAt: activeRfq?.expires_at ?? '',
      nowMs,
      enquiriesEnabled: enabled && enquiriesEnabled,
    }),
    [quotes, activeRfq?.status, activeRfq?.expires_at, nowMs, enabled, enquiriesEnabled],
  );
  const sortedQuotes = useMemo(() => {
    const byId = new Map(quotes.map((quote) => [quote.quote_id, quote]));
    return sortByPrice(comparePresentation.rows)
      .flatMap((row) => {
        const quote = byId.get(row.id);
        return quote ? [quote] : [];
      });
  }, [quotes, comparePresentation.rows]);
  const rfqView = activeRfq ? rfqViewState({
    status: activeRfq.status,
    expiresAt: activeRfq.expires_at,
    quoteStatus: null,
    myOutcome: null,
    canSendQuote: false,
    nowMs,
  }) : null;
  const quoteCards = sortedQuotes.map((quote) => {
    const quoteView = rfqViewState({
      status: activeRfq?.status ?? 'closed',
      expiresAt: activeRfq?.expires_at ?? '',
      quoteStatus: quote.status,
      myOutcome: quote.status,
      canSendQuote: false,
      nowMs,
    });
    const expanded = !!expandedQuoteIds[quote.quote_id];
    const warnings = comparePresentation.warnings[quote.quote_id] ?? [];
    const selectable = comparePresentation.selectableQuoteIds.includes(quote.quote_id);
    const validityWarning = rfqQuoteValidityWarning(quote.valid_until, nowMs);
    return (
      <Card key={quote.quote_id} style={{ gap: t.spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.xs }}>
          <Text variant="subheadStrong" style={{ flex: 1 }}>{quote.shop_name}</Text>
          <Badge
            label={quoteView.quoteLabel}
            tone={quote.status === 'selected' ? 'success' : quote.status === 'sent' ? 'primary' : 'neutral'}
          />
        </View>
        {quote.quote_id === comparePresentation.lowestQuoteId ? <Badge label="Lowest complete live total" tone="success" /> : null}
        {composition && validityWarning ? <Badge label={validityWarning} tone="warning" /> : null}
        <Text variant="title3">{formatINR(quote.total_paise)}</Text>
        <Text variant="caption" color="muted">
          Items {formatINR(quote.subtotal_paise)} · {composition ? 'Tax (GST)' : 'GST'} {formatINR(quote.gst_paise)} · Delivery {formatINR(quote.delivery_charge_paise)}
        </Text>
        {composition ? (
          <Text variant="caption" color="muted">
            Tax is shown as quoted; confirm applicable GST with the supplier.
          </Text>
        ) : null}
        <Text variant="caption" color="muted">
          {quote.delivery_days == null ? 'Delivery time not specified' : `${quote.delivery_days} delivery days`} · Valid until {new Date(quote.valid_until).toLocaleDateString()}
        </Text>
        {warnings.map((warning, index) => (
          <Badge key={`${quote.quote_id}-warning-${index}`} label={warning} tone="warning" />
        ))}
        {quote.notes ? <Text variant="caption" color="muted">{quote.notes}</Text> : null}
        <Button
          title={expanded ? 'Hide offer lines' : 'Show offer lines'}
          variant="outline"
          onPress={() => setExpandedQuoteIds((current) => ({ ...current, [quote.quote_id]: !current[quote.quote_id] }))}
        />
        {expanded ? quote.items.map((item) => (
          <View key={item.rfq_item_id} style={{ gap: 3, paddingTop: t.spacing.xs, borderTopWidth: 1, borderTopColor: t.colors.border }}>
            <Text variant="captionStrong">{item.seq}. {item.description}</Text>
            <Text variant="caption" color="muted">
              Requested: {activeRfq?.items.find((requested) => requested.id === item.rfq_item_id)?.quantity ?? item.quantity} {item.unit}
              {item.requested_brand ? ` · ${item.requested_brand}` : ''}
            </Text>
            <Text variant="caption" color="muted">Requested specifications: {describeSpecs(item.requested_specs)}</Text>
            <Text variant="caption">{item.available ? `Offered: ${item.brand || 'Brand not specified'} ${item.model}`.trim() : 'Unavailable'}</Text>
            <Text variant="caption" color="muted">Offered specifications: {describeSpecs(item.specs)}</Text>
            <Text variant="caption" color="muted">
              {item.quantity} {item.unit} · Unit price {formatINR(item.unit_price_paise)}{composition ? ` · GST ${item.gst_rate_bp / 100}%` : ''} · Line total {formatINR(item.line_total_paise)}
            </Text>
          </View>
        )) : null}
        {selectable ? (
          <>
            {!enquiriesEnabled ? <Text variant="caption" color="muted">Product enquiries must be enabled before a supplier can be selected.</Text> : null}
            <Button
              title="Choose this supplier"
              fullWidth
              loading={busyQuoteId === quote.quote_id}
              disabled={!!busyQuoteId || cancelling || !enabled || !enquiriesEnabled || !hasRead || loading || !!error}
              onPress={() => void chooseQuote(quote.quote_id)}
            />
          </>
        ) : null}
      </Card>
    );
  });

  useEffect(() => {
    if (deadlineTimer.current) clearTimeout(deadlineTimer.current);
    deadlineTimer.current = null;
    if (!focused.current || !activeRfq) return;

    const deadlines = activeRfq.status === 'open'
      ? [activeRfq.expires_at, ...quotes.filter((quote) => quote.status === 'sent').map((quote) => quote.valid_until)]
      : [];
    const nextDeadline = nearestFutureRfqDeadlineMs(deadlines, nowMs);
    if (nextDeadline === null) return;

    const delayMs = nextDeadline - Date.now();
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
  }, [activeRfq?.id, activeRfq?.status, activeRfq?.expires_at, quotes, nowMs, load]);

  async function chooseQuote(quoteId: string) {
    if (!enabled || !enquiriesEnabled || !activeRfq || !hasRead || loading || error) return;
    const currentPresentation = buildComparePresentation(quotes, {
      rfqStatus: activeRfq.status,
      rfqExpiresAt: activeRfq.expires_at,
      nowMs: Date.now(),
      enquiriesEnabled: enabled && enquiriesEnabled,
    });
    if (!currentPresentation.selectableQuoteIds.includes(quoteId)) {
      setNowMs(Date.now());
      return;
    }
    setBusyQuoteId(quoteId);
    setActionError(null);
    try {
      const result = await selectSupplierQuote(quoteId);
      toast({ message: 'Supplier selected. Continue in your enquiry; no payment was taken.', tone: 'success' });
      router.replace(`/enquiry/${result.enquiry_id}`);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyQuoteId(null);
    }
  }

  const cancelRequest = async () => {
    if (!id || !hasRead || loading || error) return;
    setCancelling(true);
    setActionError(null);
    try {
      await cancelRfq(id);
      toast({ message: 'RFQ cancelled.', tone: 'success' });
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const confirmCancel = async () => {
    if (Platform.OS === 'web') {
      const accepted = await confirm({
        title: 'Cancel request',
        message: 'This closes your request. Outstanding quotes will not be selected. No payment will be taken.',
        confirmLabel: 'Cancel request',
        cancelLabel: 'Keep request',
        destructive: true,
      });
      if (accepted) await cancelRequest();
      return;
    }

    Alert.alert('Cancel request', 'This closes your request. Outstanding quotes will not be selected. No payment will be taken.', [
      { text: 'Keep request', style: 'cancel' },
      { text: 'Cancel request', style: 'destructive', onPress: () => void cancelRequest() },
    ]);
  };

  return (
    <Screen
      header={<Header title={activeRfq?.title ?? 'Product RFQ'} subtitle={activeRfq ? `${activeRfq.category_name} · ${activeRfq.city}` : undefined} />}
      gap={t.spacing.md}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      {error && !hasRead ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {error && hasRead ? <InlineAlert message={`Refresh failed. Showing saved RFQ history; selection and cancellation are disabled until a successful refresh. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
      <InlineAlert message={actionError} />
      {!enabled ? <Text variant="caption" color="muted">Existing RFQ history is read-only while new RFQs are turned off. You may cancel your own open request.</Text> : null}
      {loading && !hasRead ? <Skeleton height={180} radius={t.radii.lg} /> : null}
      {hasRead && !loading && !error && !activeRfq ? <EmptyState title="RFQ unavailable" message="This request is no longer available." /> : null}
      {activeRfq ? (
        <>
          <RfqCompositionSection enabled={composition} title="Your request">
            <Card style={{ gap: t.spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.sm, alignItems: 'center' }}>
                <RfqComponents.RfqStatusLabel status={activeRfq.status} expiresAt={activeRfq.expires_at} nowMs={nowMs} />
                <Text variant="caption" color="muted">{activeRfq.recipient_count} shops contacted</Text>
              </View>
              <Text variant="subheadStrong">{activeRfq.area}, {activeRfq.city}{activeRfq.needs_delivery ? ' · Delivery needed' : ' · Pickup okay'}</Text>
              <Text variant="caption" color="muted">Needed by {new Date(`${activeRfq.needed_by}T00:00:00`).toLocaleDateString()}</Text>
              <Text variant="caption" color="muted">Quote deadline {new Date(activeRfq.expires_at).toLocaleDateString()}</Text>
              {activeRfq.notes ? <Text>{activeRfq.notes}</Text> : null}
            </Card>
          </RfqCompositionSection>
          <RfqCompositionSection enabled={composition} title="Requested items">
            {!composition ? <Text variant="title3">Requested items</Text> : null}
            {activeRfq.items.map((item) => (
              <Card key={item.id} style={{ gap: t.spacing.xs }}>
                <Text variant="subheadStrong">{item.seq}. {item.description}</Text>
                <Text color="muted">{item.quantity} {item.unit}{item.brand_pref ? ` · Preferred brand: ${item.brand_pref}` : ''}</Text>
                <Text variant="caption">{describeSpecs(item.specs)}</Text>
              </Card>
            ))}
          </RfqCompositionSection>
          <RfqCompositionSection enabled={composition} title="Supplier comparison">
            {!composition ? <Text variant="title3">Supplier comparison</Text> : null}
            <Text variant="caption" color="muted">Quotes describe each supplier's offer. A similar-looking item is never treated as equivalent.</Text>
            {quoteCards.length ? (
              composition
                ? <ResponsiveRfqComparison>{quoteCards}</ResponsiveRfqComparison>
                : quoteCards
            ) : null}
          </RfqCompositionSection>
          {!sortedQuotes.length ? (
            <Card>
              <Text color="muted">
                {rfqView?.blockReason === 'rfq_expired'
                  ? 'No quotes were received before the RFQ deadline. The raw RFQ status is still open.'
                  : activeRfq.status === 'cancelled'
                    ? 'No quotes were received before this request was cancelled.'
                    : activeRfq.status === 'expired'
                      ? 'No quotes were received before this request expired.'
                      : `No quotes yet. Shops you contacted may reply until ${new Date(activeRfq.expires_at).toLocaleDateString()}.`}
              </Text>
            </Card>
          ) : (
            <Text variant="caption" color="muted">Compare the displayed server totals; selecting opens an enquiry only and does not create an order or take payment.</Text>
          )}
          {activeRfq.status === 'open' ? (
            <Card style={{ gap: t.spacing.sm }}>
              <Text variant="captionStrong">Request actions</Text>
              <Text variant="caption" color="muted">Canceling closes this request. Outstanding quotes will not be selected. No payment will be taken.</Text>
              <Button
                title="Cancel request"
                variant="outline"
                loading={cancelling}
                disabled={!!busyQuoteId || !hasRead || loading || !!error}
                onPress={confirmCancel}
              />
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

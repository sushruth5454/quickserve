import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Badge, Button, Card, Header, InlineAlert, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import { compareRfqQuotes, getRfq, selectSupplierQuote, type Rfq, type RfqQuoteComparison } from '../../src/features/rfq/api';
import { RfqFeatureUnavailable, RfqStatusLabel, useRfqFeatureFlags } from '../../src/features/rfq/components';
import { formatINR } from '../../src/lib/money';
import { useTheme } from '../../src/theme';

function describeSpecs(specs: Record<string, unknown>) {
  const entries = Object.entries(specs ?? {});
  return entries.length ? entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ') : 'No specifications supplied';
}

export default function RfqDetailScreen() {
  const t = useTheme();
  const toast = useToast();
  const { rfq: enabled, enquiries: enquiriesEnabled } = useRfqFeatureFlags();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [quotes, setQuotes] = useState<RfqQuoteComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !id) return;
    setLoading(true);
    try {
      const [nextRfq, nextQuotes] = await Promise.all([getRfq(id), compareRfqQuotes(id)]);
      setRfq(nextRfq);
      setQuotes(nextQuotes);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const cheapestQuoteId = useMemo(() => {
    const selectable = quotes.filter((quote) => quote.status === 'sent' || quote.status === 'selected');
    return selectable.reduce<RfqQuoteComparison | null>(
      (cheapest, quote) => !cheapest || quote.total_paise < cheapest.total_paise ? quote : cheapest,
      null,
    )?.quote_id;
  }, [quotes]);

  const chooseQuote = async (quoteId: string) => {
    setBusyQuoteId(quoteId);
    setError(null);
    try {
      const result = await selectSupplierQuote(quoteId);
      toast({ message: 'Supplier selected. Continue in your enquiry; no payment was taken.', tone: 'success' });
      router.replace(`/enquiry/${result.enquiry_id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyQuoteId(null);
    }
  };

  if (!enabled) {
    return <Screen header={<Header title="Product RFQ" />}><RfqFeatureUnavailable /></Screen>;
  }

  return (
    <Screen
      header={<Header title={rfq?.title ?? 'Product RFQ'} subtitle={rfq ? `${rfq.category_name} · ${rfq.city}` : undefined} />}
      gap={t.spacing.md}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      <InlineAlert message={error} />
      {loading && !rfq ? <Skeleton height={180} radius={t.radii.lg} /> : null}
      {rfq ? (
        <>
          <Card style={{ gap: t.spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.sm, alignItems: 'center' }}>
              <RfqStatusLabel status={rfq.status} />
              <Text variant="caption" color="muted">{rfq.recipient_count} shops contacted</Text>
            </View>
            <Text variant="subheadStrong">{rfq.area}, {rfq.city}{rfq.needs_delivery ? ' · Delivery needed' : ' · Pickup okay'}</Text>
            <Text variant="caption" color="muted">Needed by {new Date(`${rfq.needed_by}T00:00:00`).toLocaleDateString()}</Text>
            {rfq.notes ? <Text>{rfq.notes}</Text> : null}
          </Card>
          <Text variant="title3">Requested items</Text>
          {rfq.items.map((item) => (
            <Card key={item.id} style={{ gap: t.spacing.xs }}>
              <Text variant="subheadStrong">{item.seq}. {item.description}</Text>
              <Text color="muted">{item.quantity} {item.unit}{item.brand_pref ? ` · Preferred brand: ${item.brand_pref}` : ''}</Text>
              <Text variant="caption">{describeSpecs(item.specs)}</Text>
            </Card>
          ))}
          <Text variant="title3">Supplier comparison</Text>
          <Text variant="caption" color="muted">Quotes describe each supplier's offer. A similar-looking item is never treated as equivalent.</Text>
          {!quotes.length ? (
            <Card><Text color="muted">No quotes yet. Shops you contacted can reply until {new Date(rfq.expires_at).toLocaleDateString()}.</Text></Card>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ gap: t.spacing.sm, paddingBottom: t.spacing.xs }}>
              {quotes.map((quote) => (
                <Card key={quote.quote_id} style={{ width: 300, gap: t.spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.xs }}>
                    <Text variant="subheadStrong" style={{ flex: 1 }}>{quote.shop_name}</Text>
                    <Badge label={quote.status} tone={quote.status === 'selected' ? 'success' : quote.status === 'sent' ? 'primary' : 'neutral'} />
                  </View>
                  {quote.quote_id === cheapestQuoteId ? <Badge label="Lowest total" tone="success" /> : null}
                  <Text variant="title3">{formatINR(quote.total_paise)}</Text>
                  <Text variant="caption" color="muted">
                    Items {formatINR(quote.subtotal_paise)} · GST {formatINR(quote.gst_paise)} · Delivery {formatINR(quote.delivery_charge_paise)}
                  </Text>
                  <Text variant="caption" color="muted">
                    {quote.delivery_days == null ? 'Delivery time not specified' : `${quote.delivery_days} delivery days`} · Valid until {new Date(quote.valid_until).toLocaleDateString()}
                  </Text>
                  {quote.unavailable_count ? <Badge label={`${quote.unavailable_count} item(s) unavailable`} tone="warning" /> : null}
                  {quote.items.map((item) => (
                    <View key={item.rfq_item_id} style={{ gap: 3, paddingTop: t.spacing.xs, borderTopWidth: 1, borderTopColor: t.colors.border }}>
                      <Text variant="captionStrong">{item.description}</Text>
                      <Text variant="caption">{item.available ? `${item.brand || 'Brand not specified'} ${item.model}`.trim() : 'Unavailable'}</Text>
                      {item.brand_differs ? <Badge label={`Brand differs from ${item.requested_brand}`} tone="warning" /> : null}
                      {item.specs_missing ? <Badge label={`Missing specs: ${item.missing_spec_keys.join(', ')}`} tone="warning" /> : null}
                      <Text variant="caption" color="muted">{describeSpecs(item.specs)}</Text>
                      {item.available ? <Text variant="caption" color="muted">{item.quantity} {item.unit} · {formatINR(item.unit_price_paise)} / unit</Text> : null}
                    </View>
                  ))}
                  {quote.notes ? <Text variant="caption" color="muted">{quote.notes}</Text> : null}
                  {rfq.status === 'open' && quote.status === 'sent' ? (
                    <>
                      <Button
                        title="Choose this supplier"
                        fullWidth
                        loading={busyQuoteId === quote.quote_id}
                        disabled={!!busyQuoteId || !enquiriesEnabled}
                        onPress={() => void chooseQuote(quote.quote_id)}
                      />
                      {!enquiriesEnabled ? <Text variant="caption" color="muted">Product enquiries must be enabled before a supplier can be selected.</Text> : null}
                    </>
                  ) : null}
                </Card>
              ))}
            </ScrollView>
          )}
          <Text variant="caption" color="muted">Choosing a supplier opens an enquiry for next steps. QuickServe does not take payment for this selection.</Text>
        </>
      ) : null}
    </Screen>
  );
}

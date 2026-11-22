import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, TextArea, useToast } from '../../components/ui';
import { SpecFields } from '../shops/SpecFields';
import { listProductCategories, type ProductCategory } from '../shops/api';
import { cleanSpecs } from '../shops/specs';
import {
  getSupplierRfq,
  sendSupplierQuote,
  type SupplierQuoteItemInput,
  type SupplierRfq,
} from '../rfq/api';
import { RfqStatusLabel, useRfqFeatureFlags } from '../rfq/components';
import { estimateQuoteTotals } from '../rfq/quoteMath';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';

type QuoteDraft = {
  rfqItemId: string;
  brand: string;
  model: string;
  specs: Record<string, string>;
  offeredQuantity: string;
  unitPriceRupees: string;
  gstRate: string;
  available: boolean;
};

const gstRates = [0, 500, 1200, 1800, 2800];

export default function MerchantRfqQuoteScreen() {
  const t = useTheme();
  const toast = useToast();
  const { rfq: enabled } = useRfqFeatureFlags();
  const { id, shopId } = useLocalSearchParams<{ id: string; shopId?: string }>();
  const [rfq, setRfq] = useState<SupplierRfq | null>(null);
  const [attributeSchema, setAttributeSchema] = useState<ProductCategory['attribute_schema']>({ properties: {} });
  const [drafts, setDrafts] = useState<QuoteDraft[]>([]);
  const [deliveryCharge, setDeliveryCharge] = useState('0');
  const [deliveryDays, setDeliveryDays] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasRead, setHasRead] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [next, categories] = await Promise.all([
        getSupplierRfq(id, shopId || undefined),
        enabled ? listProductCategories() : Promise.resolve([]),
      ]);
      setRfq(next);
      setAttributeSchema(categories.find((category) => category.name === next.category_name)?.attribute_schema ?? { properties: {} });
      if (!enabled) {
        setDrafts([]);
      } else {
        setDrafts((current) => current.length
          ? next.shop_has_gstin ? current : current.map((draft) => ({ ...draft, gstRate: '0' }))
          : next.items.map((item) => ({
            rfqItemId: item.id,
            brand: '',
            model: '',
            specs: {},
            offeredQuantity: '',
            unitPriceRupees: '',
            gstRate: next.shop_has_gstin ? '1800' : '0',
            available: true,
          })));
      }
      setError(null);
      setHasRead(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled, id, shopId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const updateDraft = (rfqItemId: string, patch: Partial<QuoteDraft>) => {
    setDrafts((current) => current.map((draft) => draft.rfqItemId === rfqItemId ? { ...draft, ...patch } : draft));
  };

  const canQuote = enabled && (rfq?.business_role === 'owner' || rfq?.business_role === 'manager');
  const deliveryRupees = Number(deliveryCharge);
  const estimatedDeliveryPaise = Number.isFinite(deliveryRupees) && deliveryRupees >= 0
    ? Math.round(deliveryRupees * 100)
    : 0;
  const estimatedTotals = useMemo(() => estimateQuoteTotals(
    (rfq?.items ?? []).map((item) => {
      const draft = drafts.find((entry) => entry.rfqItemId === item.id);
      const offeredQuantity = draft?.offeredQuantity.trim() ? Number(draft.offeredQuantity) : Number(item.quantity);
      const unitPriceRupees = Number(draft?.unitPriceRupees ?? '');
      return {
        quantity: Number.isFinite(offeredQuantity) ? offeredQuantity : Number(item.quantity),
        unitPricePaise: Number.isFinite(unitPriceRupees) ? Math.round(unitPriceRupees * 100) : 0,
        gstRateBp: rfq?.shop_has_gstin ? Number(draft?.gstRate ?? 0) : 0,
        available: !!draft?.available,
      };
    }),
    estimatedDeliveryPaise,
  ), [drafts, estimatedDeliveryPaise, rfq]);

  const submit = async () => {
    if (!rfq || rfq.status !== 'open' || !canQuote || !hasRead || loading || error) return;
    setSaving(true);
    setActionError(null);
    try {
      const quoteItems: SupplierQuoteItemInput[] = drafts.map((draft) => {
        const rupees = Number(draft.unitPriceRupees);
        const gstRate = Number(draft.gstRate);
        const offeredQuantity = draft.offeredQuantity.trim() ? Number(draft.offeredQuantity) : undefined;
        if (draft.available && (!draft.unitPriceRupees.trim() || !Number.isFinite(rupees) || rupees < 0)) {
          throw new Error('Enter a non-negative unit price for every available item.');
        }
        if (draft.available && offeredQuantity !== undefined && (!Number.isFinite(offeredQuantity) || offeredQuantity <= 0)) {
          throw new Error('Enter a valid offered quantity or leave it blank.');
        }
        if (!gstRates.includes(gstRate) || (!rfq.shop_has_gstin && gstRate !== 0)) {
          throw new Error('Choose a supported GST rate for each item.');
        }
        return {
          rfq_item_id: draft.rfqItemId,
          brand: draft.brand.trim(),
          model: draft.model.trim(),
          specs: cleanSpecs(draft.specs),
          unit_price_paise: draft.available ? Math.round(rupees * 100) : 0,
          gst_rate_bp: rfq.shop_has_gstin ? gstRate : 0,
          available: draft.available,
          ...(draft.available && offeredQuantity !== undefined ? { offered_quantity: offeredQuantity } : {}),
        };
      });
      const chargeRupees = Number(deliveryCharge);
      const days = deliveryDays.trim() ? Number(deliveryDays) : null;
      if (!Number.isFinite(chargeRupees) || chargeRupees < 0) throw new Error('Delivery charge must be zero or more.');
      if (days != null && (!Number.isInteger(days) || days < 0 || days > 365)) throw new Error('Delivery days must be between 0 and 365.');
      await sendSupplierQuote({
        rfqId: rfq.id,
        shopId: rfq.shop_id,
        items: quoteItems,
        deliveryChargePaise: Math.round(chargeRupees * 100),
        deliveryDays: days,
        notes,
      });
      toast({ message: 'Your quote was sent to the customer.', tone: 'success' });
      router.replace('/merchant-rfqs');
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      header={<Header title={rfq?.title ?? 'Prepare supplier quote'} subtitle={rfq ? `${rfq.category_name} · ${rfq.area}, ${rfq.city}` : undefined} />}
      gap={t.spacing.md}
      footer={rfq?.status === 'open' && canQuote ? (
        <View style={{ gap: t.spacing.sm }}>
          <InlineAlert message={actionError} />
          <Button title="Send quote" fullWidth loading={saving} disabled={!hasRead || loading || !!error} onPress={() => void submit()} />
        </View>
      ) : (
        <View style={{ gap: t.spacing.sm }}>
          <InlineAlert message={error ?? (rfq?.business_role === 'staff'
            ? 'Staff can view RFQs; only owners and managers can send quotes.'
            : !enabled ? 'Existing RFQ history is read-only while product RFQs are turned off.' : null)} />
          <InlineAlert message={actionError} />
        </View>
      )}
    >
      {loading && !hasRead ? <Skeleton height={180} radius={t.radii.lg} /> : null}
      {error && !hasRead ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {error && hasRead ? <InlineAlert message={`Refresh failed. Showing saved supplier RFQ history; quote submission is disabled until a successful refresh. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
      {hasRead && !loading && !error && !rfq ? <EmptyState title="RFQ unavailable" message="This request is no longer available." /> : null}
      {!loading && !rfq && error ? (
        <Button title="Open Supplier RFQs" variant="outline" onPress={() => router.replace('/merchant-rfqs')} />
      ) : null}
      {rfq ? (
        <>
          <Card style={{ gap: t.spacing.xs }}>
            <RfqStatusLabel status={rfq.status} />
            <Text variant="caption" color="muted">Needed by {new Date(`${rfq.needed_by}T00:00:00`).toLocaleDateString()}{rfq.needs_delivery ? ' · Delivery requested' : ' · Pickup okay'}</Text>
            {rfq.notes ? <Text>{rfq.notes}</Text> : null}
            <Text variant="caption" color="muted">Quote validity is capped at {new Date(rfq.expires_at).toLocaleDateString()}.</Text>
            {rfq.my_quote ? <Text variant="caption" color="muted">Sending a new quote version withdraws your previous sent quote.</Text> : null}
          </Card>
          {rfq.items.map((item) => {
            const draft = drafts.find((entry) => entry.rfqItemId === item.id);
            if (!draft && !canQuote) {
              return (
                <Card key={item.id}>
                  <Text variant="subheadStrong">{item.seq}. {item.description}</Text>
                  <Text variant="caption" color="muted">
                    Requested: {item.quantity} {item.unit}{item.brand_pref ? ` · Brand: ${item.brand_pref}` : ''}
                  </Text>
                  <Text variant="caption" color="muted">
                    Specifications: {Object.entries(item.specs).map(([key, value]) => `${key}: ${String(value)}`).join(' · ') || 'None'}
                  </Text>
                </Card>
              );
            }
            if (!draft) return null;
            return (
              <Card key={item.id} style={{ gap: t.spacing.sm }}>
                <Text variant="subheadStrong">{item.seq}. {item.description}</Text>
                <Text variant="caption" color="muted">
                  Requested: {item.quantity} {item.unit}{item.brand_pref ? ` · Brand: ${item.brand_pref}` : ''}
                </Text>
                <Text variant="caption" color="muted">
                  Specifications: {Object.entries(item.specs).map(([key, value]) => `${key}: ${String(value)}`).join(' · ') || 'None'}
                </Text>
                {canQuote ? <View style={{ flexDirection: 'row', gap: t.spacing.xs }}>
                  <Chip label="Available" selected={draft.available} onPress={() => updateDraft(item.id, { available: true })} />
                  <Chip label="Unavailable" selected={!draft.available} onPress={() => updateDraft(item.id, { available: false })} />
                </View> : null}
                {!canQuote ? null : draft.available ? (
                  <>
                    <Input
                      label={`Quantity you will supply (${item.unit}, optional)`}
                      keyboardType="decimal-pad"
                      value={draft.offeredQuantity}
                      onChangeText={(value) => updateDraft(item.id, { offeredQuantity: value })}
                    />
                    <Input
                      label={`Unit price before GST (₹ per ${item.unit})`}
                      prefix="₹"
                      keyboardType="decimal-pad"
                      value={draft.unitPriceRupees}
                      onChangeText={(value) => updateDraft(item.id, { unitPriceRupees: value })}
                    />
                    <Input label="Brand offered" value={draft.brand} onChangeText={(value) => updateDraft(item.id, { brand: value })} maxLength={80} />
                    <Input label="Model (optional)" value={draft.model} onChangeText={(value) => updateDraft(item.id, { model: value })} maxLength={80} />
                    <SpecFields
                      schema={attributeSchema}
                      value={draft.specs}
                      onChange={(value) => updateDraft(item.id, { specs: value })}
                    />
                    <View style={{ gap: t.spacing.xs }}>
                      <Text variant="subhead" color="textSecondary">GST rate</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
                        {(rfq.shop_has_gstin ? gstRates : [0]).map((rate) => (
                          <Chip key={rate} label={`${rate / 100}%`} selected={Number(draft.gstRate) === rate} onPress={() => updateDraft(item.id, { gstRate: String(rate) })} />
                        ))}
                      </View>
                      {!rfq.shop_has_gstin ? (
                        <Text variant="caption" color="muted">Add your GSTIN in My shop to charge GST.</Text>
                      ) : null}
                    </View>
                  </>
                ) : <Text color="muted">This line will be marked unavailable and excluded from the quote subtotal.</Text>}
              </Card>
            );
          })}
          {canQuote ? (
            <>
              <Input label="Delivery charge" prefix="₹" keyboardType="decimal-pad" value={deliveryCharge} onChangeText={setDeliveryCharge} />
              <Input label="Delivery days (optional)" keyboardType="number-pad" value={deliveryDays} onChangeText={setDeliveryDays} />
              <TextArea label="Notes for the customer" value={notes} onChangeText={setNotes} maxLength={2000} />
              <Card style={{ gap: t.spacing.xs }}>
                <Text variant="subheadStrong">Estimated customer total {formatINR(estimatedTotals.total)}</Text>
                <Text variant="caption" color="muted">
                  Items {formatINR(estimatedTotals.subtotal)} + GST {formatINR(estimatedTotals.gst)} + delivery {formatINR(estimatedDeliveryPaise)}
                </Text>
                <Text variant="caption" color="muted">
                  You receive this directly from the customer — Nearo charges no commission on product quotes.
                </Text>
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

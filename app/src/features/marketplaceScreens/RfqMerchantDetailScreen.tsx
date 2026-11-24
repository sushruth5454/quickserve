import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type SupplierQuoteSendBlockReason,
} from '../rfq/api';
import { RfqStatusLabel, useRfqFeatureFlags } from '../rfq/components';
import { nearestFutureRfqDeadlineMs, rfqViewState } from '../rfq/rfqStateModel';
import {
  reconcileSupplierQuoteDraft,
  supplierCategorySchema,
  supplierQuoteContextKey,
  updateSupplierQuoteDraftLine,
  updateSupplierQuoteDraftTerms,
  type SupplierQuoteDraftState,
} from '../rfq/supplierQuoteModel';
import { estimateQuoteTotals } from '../rfq/quoteMath';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';

const gstRates = [0, 500, 1200, 1800, 2800];

function sendBlockMessage(
  reason: SupplierQuoteSendBlockReason | null | undefined,
  role: SupplierRfq['business_role'] | undefined,
  enabled: boolean,
): string | null {
  if (!enabled) return 'Existing RFQ history is read-only while product RFQs are turned off.';
  switch (reason) {
    case 'feature_off':
      return 'Existing RFQ history is read-only while product RFQs are turned off.';
    case 'shop_unavailable':
      return 'Only a verified shop can send a quote.';
    case 'role_not_permitted':
      return role === 'staff'
        ? 'Staff can view saved quote terms; only owners and managers can send quotes.'
        : 'Only shop owners and managers can send quotes.';
    case 'closed':
      return 'This RFQ is closed. Your saved quote remains available to review.';
    case 'rfq_expired':
      return 'This RFQ has passed its deadline. Your saved quote remains available to review.';
    default:
      return role === 'staff'
        ? 'Staff can view saved quote terms; only owners and managers can send quotes.'
        : null;
  }
}

function specsSummary(specs: Record<string, unknown>): string {
  return Object.entries(specs ?? {}).map(([key, value]) => `${key}: ${String(value)}`).join(' · ') || 'None';
}

export default function MerchantRfqQuoteScreen() {
  const t = useTheme();
  const toast = useToast();
  const { rfq: enabled } = useRfqFeatureFlags();
  const { id, shopId } = useLocalSearchParams<{ id: string; shopId?: string }>();
  const requestId = useRef(0);
  const focused = useRef(false);
  const deadlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rfq, setRfq] = useState<SupplierRfq | null>(null);
  const [attributeSchema, setAttributeSchema] = useState<ProductCategory['attribute_schema']>({ properties: {} });
  const [draftState, setDraftState] = useState<SupplierQuoteDraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasRead, setHasRead] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!id) return;
    const currentRequestId = ++requestId.current;
    setNowMs(Date.now());
    setLoading(true);
    setError(null);
    try {
      if (!shopId) {
        setRfq(null);
        setHasRead(false);
        setDraftState(null);
        throw new Error('Open this request from Supplier RFQs to choose a business.');
      }
      const next = await getSupplierRfq(id, shopId);
      if (currentRequestId !== requestId.current) return;
      setRfq(next);
      setHasRead(true);
      const categories = enabled ? await listProductCategories() : [];
      if (currentRequestId !== requestId.current) return;
      setAttributeSchema(supplierCategorySchema(categories, next.category_id));
      setDraftState((current) => reconcileSupplierQuoteDraft(current, next));
      setError(null);
    } catch (e) {
      if (currentRequestId !== requestId.current) return;
      setError((e as Error).message);
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [enabled, id, shopId]);

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

  const activeRfq = rfq && shopId && rfq.id === id && rfq.shop_id === shopId ? rfq : null;
  const viewState = activeRfq ? rfqViewState({
    status: activeRfq.status,
    expiresAt: activeRfq.expires_at,
    quoteStatus: activeRfq.my_quote?.status ?? null,
    myOutcome: activeRfq.my_quote?.status ?? null,
    canSendQuote: activeRfq.can_send_quote,
    nowMs,
  }) : null;
  const activeContextKey = activeRfq ? supplierQuoteContextKey(activeRfq.id, activeRfq.shop_id) : null;
  const currentDraft = draftState?.contextKey === activeContextKey ? draftState : null;
  const canQuote = !!viewState?.canReply && enabled && !!currentDraft && !loading && !error;

  useEffect(() => {
    if (deadlineTimer.current) clearTimeout(deadlineTimer.current);
    deadlineTimer.current = null;
    if (!focused.current || !activeRfq || activeRfq.status !== 'open') return;

    const nextDeadline = nearestFutureRfqDeadlineMs([activeRfq.expires_at], nowMs);
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
  }, [activeRfq?.id, activeRfq?.shop_id, activeRfq?.status, activeRfq?.expires_at, nowMs, load]);
  const deliveryCharge = currentDraft?.deliveryChargeRupees ?? '0';
  const deliveryRupees = Number(deliveryCharge);
  const estimatedDeliveryPaise = Number.isFinite(deliveryRupees) && deliveryRupees >= 0
    ? Math.round(deliveryRupees * 100)
    : 0;
  const estimatedTotals = useMemo(() => estimateQuoteTotals(
    (activeRfq?.items ?? []).map((item) => {
      const draft = currentDraft?.lines.find((entry) => entry.rfqItemId === item.id);
      const offeredQuantity = draft?.offeredQuantity.trim() ? Number(draft.offeredQuantity) : Number(item.quantity);
      const unitPriceRupees = Number(draft?.unitPriceRupees ?? '');
      return {
        quantity: Number.isFinite(offeredQuantity) ? offeredQuantity : Number(item.quantity),
        unitPricePaise: Number.isFinite(unitPriceRupees) ? Math.round(unitPriceRupees * 100) : 0,
        gstRateBp: activeRfq?.shop_has_gstin ? Number(draft?.gstRate ?? 0) : 0,
        available: !!draft?.available,
      };
    }),
    estimatedDeliveryPaise,
  ), [activeRfq, currentDraft, estimatedDeliveryPaise]);

  const updateLine = (rfqItemId: string, patch: Parameters<typeof updateSupplierQuoteDraftLine>[2]) => {
    if (!activeContextKey) return;
    setDraftState((current) => current?.contextKey === activeContextKey
      ? updateSupplierQuoteDraftLine(current, rfqItemId, patch)
      : current);
  };

  const updateTerms = (patch: Parameters<typeof updateSupplierQuoteDraftTerms>[1]) => {
    if (!activeContextKey) return;
    setDraftState((current) => current?.contextKey === activeContextKey
      ? updateSupplierQuoteDraftTerms(current, patch)
      : current);
  };

  const submit = async () => {
    if (!activeRfq || !currentDraft || !canQuote || !hasRead || loading || error) return;
    setSaving(true);
    setActionError(null);
    try {
      const quoteItems: SupplierQuoteItemInput[] = currentDraft.lines.map((draft) => {
        const rupees = Number(draft.unitPriceRupees);
        const gstRate = Number(draft.gstRate);
        const offeredQuantity = draft.offeredQuantity.trim() ? Number(draft.offeredQuantity) : undefined;
        if (draft.available && (!draft.unitPriceRupees.trim() || !Number.isFinite(rupees) || rupees < 0)) {
          throw new Error('Enter a non-negative unit price for every available item.');
        }
        if (draft.available && offeredQuantity !== undefined && (!Number.isFinite(offeredQuantity) || offeredQuantity <= 0)) {
          throw new Error('Enter a valid offered quantity or leave it blank.');
        }
        if (!gstRates.includes(gstRate) || (!activeRfq.shop_has_gstin && gstRate !== 0)) {
          throw new Error('Choose a supported GST rate for each item.');
        }
        return {
          rfq_item_id: draft.rfqItemId,
          brand: draft.brand.trim(),
          model: draft.model.trim(),
          specs: cleanSpecs(draft.specs),
          unit_price_paise: draft.available ? Math.round(rupees * 100) : 0,
          gst_rate_bp: activeRfq.shop_has_gstin ? gstRate : 0,
          available: draft.available,
          ...(draft.available && offeredQuantity !== undefined ? { offered_quantity: offeredQuantity } : {}),
        };
      });
      const chargeRupees = Number(currentDraft.deliveryChargeRupees);
      const days = currentDraft.deliveryDays.trim() ? Number(currentDraft.deliveryDays) : null;
      if (!Number.isFinite(chargeRupees) || chargeRupees < 0) throw new Error('Delivery charge must be zero or more.');
      if (days != null && (!Number.isInteger(days) || days < 0 || days > 365)) throw new Error('Delivery days must be between 0 and 365.');
      await sendSupplierQuote({
        rfqId: activeRfq.id,
        shopId: activeRfq.shop_id,
        items: quoteItems,
        deliveryChargePaise: Math.round(chargeRupees * 100),
        deliveryDays: days,
        notes: currentDraft.notes,
      });
      toast({ message: 'Your quote was sent to the customer.', tone: 'success' });
      router.replace('/merchant-rfqs');
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  let blockMessage = sendBlockMessage(
    activeRfq?.send_block_reason,
    activeRfq?.business_role,
    enabled,
  );
  if (viewState?.blockReason === 'deadline_unavailable') {
    blockMessage = 'The RFQ deadline is unavailable. Refresh before sending a quote.';
  }
  if (viewState?.blockReason === 'rfq_expired' || activeRfq?.status === 'expired') {
    blockMessage = 'This RFQ has passed its deadline. Your saved quote remains available to review.';
  }
  if (viewState?.blockReason === 'closed' && activeRfq?.status === 'closed') {
    blockMessage = 'This RFQ is closed. Your saved quote remains available to review.';
  }
  if (activeRfq?.status === 'cancelled') {
    blockMessage = 'This RFQ was cancelled. Your saved quote remains available to review.';
  }

  return (
    <Screen
      header={<Header title={activeRfq?.title ?? 'Prepare supplier quote'} subtitle={activeRfq ? `${activeRfq.shop_name} · ${activeRfq.category_name} · ${activeRfq.area}, ${activeRfq.city}` : undefined} />}
      gap={t.spacing.md}
      refreshing={loading}
      onRefresh={() => void load()}
      footer={canQuote ? (
        <View style={{ gap: t.spacing.sm }}>
          <InlineAlert message={actionError} />
          <Button title="Send quote" fullWidth loading={saving} disabled={!hasRead || loading || !!error} onPress={() => void submit()} />
        </View>
      ) : (
        <View style={{ gap: t.spacing.sm }}>
          <InlineAlert message={error ?? blockMessage} />
          <InlineAlert message={actionError} />
        </View>
      )}
    >
      {loading && !activeRfq ? <Skeleton height={180} radius={t.radii.lg} /> : null}
      {error && (!hasRead || !activeRfq) ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {error && hasRead && activeRfq ? <InlineAlert message={`Refresh failed. Showing saved supplier RFQ history; quote submission is disabled until a successful refresh. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
      {hasRead && !loading && !error && !activeRfq ? <EmptyState title="RFQ unavailable" message="This request is no longer available." /> : null}
      {!loading && !activeRfq && error ? (
        <Button title="Open Supplier RFQs" variant="outline" onPress={() => router.replace('/merchant-rfqs')} />
      ) : null}
      {activeRfq ? (
        <>
          <Card style={{ gap: t.spacing.xs }}>
            <RfqStatusLabel status={activeRfq.status} expiresAt={activeRfq.expires_at} nowMs={nowMs} />
            <Text variant="caption" color="muted">Needed by {new Date(`${activeRfq.needed_by}T00:00:00`).toLocaleDateString()}{activeRfq.needs_delivery ? ' · Delivery requested' : ' · Pickup okay'}</Text>
            {activeRfq.notes ? <Text>{activeRfq.notes}</Text> : null}
            <Text variant="caption" color="muted">Quote validity is capped at {new Date(activeRfq.expires_at).toLocaleDateString()}.</Text>
            {activeRfq.my_quote ? <Text variant="caption" color="muted">Your latest saved quote is version {activeRfq.my_quote.version} ({activeRfq.my_quote.status}).</Text> : null}
            {canQuote && activeRfq.my_quote?.status === 'sent' ? <Text variant="caption" color="muted">Sending a new quote version withdraws your previous sent quote.</Text> : null}
          </Card>

          {activeRfq.my_quote ? (
            <Card style={{ gap: t.spacing.sm }}>
              <Text variant="subheadStrong">Saved quote · Version {activeRfq.my_quote.version} · {activeRfq.my_quote.status}</Text>
              {activeRfq.my_quote.items.map((item) => (
                <View key={item.rfq_item_id} style={{ gap: t.spacing.xs }}>
                  <Text variant="bodyStrong">{item.seq}. {item.description}</Text>
                  <Text variant="caption" color="muted">
                    {item.available ? 'Available' : 'Unavailable'} · {item.quantity} {item.unit}
                    {item.brand ? ` · ${item.brand}` : ''}{item.model ? ` · ${item.model}` : ''}
                  </Text>
                  <Text variant="caption" color="muted">Specifications: {specsSummary(item.specs)}</Text>
                  <Text variant="caption" color="muted">
                    Unit price {formatINR(item.unit_price_paise)} · GST {item.gst_rate_bp / 100}% · Line total {formatINR(item.line_total_paise)}
                  </Text>
                </View>
              ))}
              <Text variant="caption" color="muted">
                Items {formatINR(activeRfq.my_quote.subtotal_paise)} + GST {formatINR(activeRfq.my_quote.gst_paise)} + delivery {formatINR(activeRfq.my_quote.delivery_charge_paise)}
              </Text>
              <Text variant="subheadStrong">Saved total {formatINR(activeRfq.my_quote.total_paise)}</Text>
              <Text variant="caption" color="muted">
                {activeRfq.my_quote.delivery_days == null ? 'Delivery timing not specified' : `${activeRfq.my_quote.delivery_days} delivery days`}
                {' · Valid until '}{new Date(activeRfq.my_quote.valid_until).toLocaleDateString()}
              </Text>
              {activeRfq.my_quote.notes ? <Text>{activeRfq.my_quote.notes}</Text> : null}
            </Card>
          ) : null}

          {activeRfq.items.map((item) => {
            const draft = currentDraft?.lines.find((entry) => entry.rfqItemId === item.id);
            return (
              <Card key={item.id} style={{ gap: t.spacing.sm }}>
                <Text variant="subheadStrong">{item.seq}. {item.description}</Text>
                <Text variant="caption" color="muted">
                  Requested: {item.quantity} {item.unit}{item.brand_pref ? ` · Brand: ${item.brand_pref}` : ''}
                </Text>
                <Text variant="caption" color="muted">Specifications: {specsSummary(item.specs)}</Text>
                {canQuote && draft ? (
                  <>
                    <View style={{ flexDirection: 'row', gap: t.spacing.xs }}>
                      <Chip label="Available" selected={draft.available} onPress={() => updateLine(item.id, { available: true })} />
                      <Chip label="Unavailable" selected={!draft.available} onPress={() => updateLine(item.id, { available: false })} />
                    </View>
                    {draft.available ? (
                      <>
                        <Input
                          label={`Quantity you will supply (${item.unit}, optional)`}
                          keyboardType="decimal-pad"
                          value={draft.offeredQuantity}
                          onChangeText={(value) => updateLine(item.id, { offeredQuantity: value })}
                        />
                        <Input
                          label={`Unit price before GST (₹ per ${item.unit})`}
                          prefix="₹"
                          keyboardType="decimal-pad"
                          value={draft.unitPriceRupees}
                          onChangeText={(value) => updateLine(item.id, { unitPriceRupees: value })}
                        />
                        <Input label="Brand offered" value={draft.brand} onChangeText={(value) => updateLine(item.id, { brand: value })} maxLength={80} />
                        <Input label="Model (optional)" value={draft.model} onChangeText={(value) => updateLine(item.id, { model: value })} maxLength={80} />
                        <SpecFields
                          schema={attributeSchema}
                          value={draft.specs}
                          onChange={(value) => updateLine(item.id, { specs: value })}
                        />
                        <View style={{ gap: t.spacing.xs }}>
                          <Text variant="subhead" color="textSecondary">GST rate</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
                            {(activeRfq.shop_has_gstin ? gstRates : [0]).map((rate) => (
                              <Chip key={rate} label={`${rate / 100}%`} selected={Number(draft.gstRate) === rate} onPress={() => updateLine(item.id, { gstRate: String(rate) })} />
                            ))}
                          </View>
                          {!activeRfq.shop_has_gstin ? (
                            <Text variant="caption" color="muted">Add your GSTIN in My shop to charge GST.</Text>
                          ) : null}
                        </View>
                      </>
                    ) : <Text color="muted">This line will be marked unavailable and excluded from the quote subtotal.</Text>}
                  </>
                ) : null}
              </Card>
            );
          })}

          {canQuote && currentDraft ? (
            <>
              <Input
                label="Delivery charge"
                prefix="₹"
                keyboardType="decimal-pad"
                value={currentDraft.deliveryChargeRupees}
                onChangeText={(value) => updateTerms({ deliveryChargeRupees: value })}
              />
              <Input
                label="Delivery days (optional)"
                keyboardType="number-pad"
                value={currentDraft.deliveryDays}
                onChangeText={(value) => updateTerms({ deliveryDays: value })}
              />
              <TextArea label="Notes for the customer" value={currentDraft.notes} onChangeText={(value) => updateTerms({ notes: value })} maxLength={2000} />
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

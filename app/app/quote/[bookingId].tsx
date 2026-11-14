import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { kindLabel } from '../../src/components/QuoteView';
import {
  Chip,
  Button,
  Card,
  Divider,
  ErrorState,
  Header,
  IconButton,
  InlineAlert,
  Input,
  PriceRow,
  Screen,
  SegmentedControl,
  Skeleton,
  Stepper,
  Text,
  TextArea,
  useToast,
} from '../../src/components/ui';
import { getBooking, getMyProvider, getQuotes, listMyServices, sendQuote, uploadJobPhoto } from '../../src/lib/api';
import { haptics } from '../../src/lib/haptics';
import { commissionRateBp, formatINR, rupeesToPaise, settleQuotedJob, type LineInput } from '../../src/lib/money';
import type { Booking, Provider, QuoteItemDraft, QuoteItemKind, RateCardItem } from '../../src/lib/types';
import { bookingRef } from '../../src/lib/schedule';
import { useTheme } from '../../src/theme';

interface Line {
  key: string;
  kind: QuoteItemKind;
  title: string;
  qty: number;
  unitPrice: string;
  /** Storage path of the uploaded bill photo (parts). */
  billPath?: string;
  billUri?: string;
}

const KINDS: QuoteItemKind[] = ['labour', 'part', 'other'];
const KIND_ICON: Record<QuoteItemKind, keyof typeof Ionicons.glyphMap> = {
  labour: 'construct-outline',
  part: 'hardware-chip-outline',
  other: 'ellipsis-horizontal-circle-outline',
};
const PLACEHOLDER: Record<QuoteItemKind, string> = {
  labour: 'e.g. Gas refill, wiring work',
  part: 'e.g. Capacitor 45uF',
  other: 'e.g. Disposal, transport',
};

let seq = 0;
const newLine = (kind: QuoteItemKind, title = '', qty = 1, unitPrice = '', billPath?: string): Line => ({
  key: `l${++seq}`,
  kind,
  title,
  qty,
  unitPrice,
  billPath,
});
/** PRD: parts above ₹500 need a bill photo. */
const BILL_PHOTO_MIN_PAISE = 50000;

export default function QuoteEditorScreen() {
  const t = useTheme();
  const toast = useToast();
  const { bookingId, changeOrder } = useLocalSearchParams<{ bookingId: string; changeOrder?: string }>();
  const isChangeOrder = changeOrder === '1';
  const [booking, setBooking] = useState<Booking | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [lines, setLines] = useState<Line[]>([newLine('labour')]);
  const [note, setNote] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [rateCard, setRateCard] = useState<RateCardItem[]>([]);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId) return;
    Promise.all([getBooking(bookingId), getMyProvider(), getQuotes(bookingId), listMyServices().catch(() => [])])
      .then(([b, p, quotes, services]) => {
        setBooking(b);
        setProvider(p);
        setRateCard(services.find((s) => s.category_id === b.category_id)?.rate_card_items ?? []);
        const base = quotes.find((q) => q.status === 'sent') ?? quotes.find((q) => q.id === b.approved_quote_id);
        if (base && base.quote_items.length > 0) {
          setLines(base.quote_items.map((i) => newLine(i.kind, i.title, Number(i.qty), String(i.unit_price / 100), i.bill_photo_url ?? undefined)));
        }
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [bookingId]);

  const parsed = useMemo<QuoteItemDraft[]>(
    () =>
      lines.map((l) => ({
        kind: l.kind,
        title: l.title.trim(),
        qty: l.qty,
        unit_price: rupeesToPaise(Number(l.unitPrice || 'NaN')),
        ...(l.kind === 'part' && l.billPath ? { bill_photo_url: l.billPath } : {}),
      })),
    [lines],
  );

  const rateBp = provider
    ? commissionRateBp({ jobsCompleted: provider.jobs_completed, providerCreatedAt: new Date(provider.created_at), at: new Date() })
    : 1200;

  const settlement = useMemo(() => {
    const items: LineInput[] = parsed
      .filter((p) => Number.isFinite(p.unit_price) && p.qty > 0)
      .map((p) => ({ kind: p.kind, qty: p.qty, unitPrice: p.unit_price }));
    return settleQuotedJob({ items, visitFee: booking?.visit_fee ?? 0, platformFee: booking?.platform_fee ?? 2900, rateBp });
  }, [parsed, booking, rateBp]);

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async () => {
    setShowErrors(true);
    const invalid = parsed.some((p) => !p.title || !(p.qty > 0) || !Number.isFinite(p.unit_price) || p.unit_price < 0);
    if (invalid || parsed.length === 0) {
      haptics.error();
      setError('Every line needs a description, a quantity and a price.');
      return;
    }
    if (settlement.subtotals.total <= 0) {
      haptics.error();
      setError('The quote total is ₹0. Add a price to at least one item.');
      return;
    }
    if (!bookingId) return;
    setSubmitting(true);
    setError(null);
    try {
      await sendQuote(bookingId, parsed, note.trim() || undefined);
      toast({ message: isChangeOrder ? 'Change order sent' : 'Quote sent to the customer', tone: 'success' });
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const title = isChangeOrder ? 'Change order' : 'Itemised quote';
  if (!booking) {
    return (
      <Screen header={<Header title={title} />}>
        {loadError ? (
          <ErrorState message={loadError} />
        ) : (
          <>
            <Skeleton height={160} radius={t.radii.lg} />
            <Skeleton height={160} radius={t.radii.lg} />
          </>
        )}
      </Screen>
    );
  }

  const pct = rateBp / 100;
  const fees = settlement.commission + settlement.gst;

  const attachBill = async (key: string) => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return;
    setUploadingFor(key);
    try {
      const path = await uploadJobPhoto(asset.uri, asset.mimeType ?? 'image/jpeg');
      update(key, { billPath: path, billUri: asset.uri });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setUploadingFor(null);
    }
  };

  return (
    <Screen
      header={<Header title={title} subtitle={`${booking.categories?.name ?? 'Job'} · ${bookingRef(booking.id)}`} />}
      footer={
        <View style={{ gap: t.spacing.md }}>
          <View style={{ gap: 4 }}>
            <SummaryLine label="Quote total" value={formatINR(settlement.subtotals.total)} />
            <SummaryLine label={`Fees · ${pct}% of labour + GST`} value={fees > 0 ? `−${formatINR(fees)}` : formatINR(0)} muted />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
            <View>
              <Text variant="caption" color="muted">
                You receive
              </Text>
              <Text variant="title2" color="successText" tabular>
                {formatINR(settlement.providerPayout)}
              </Text>
            </View>
            <Button
              title={isChangeOrder ? 'Send change order' : 'Send to customer'}
              size="lg"
              onPress={() => void submit()}
              loading={submitting}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      }
    >
      {isChangeOrder ? (
        <InlineAlert tone="info" message="List the full revised scope. The customer only pays the difference over what they already paid." />
      ) : null}

      {rateCard.length > 0 ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="subheadStrong" color="textSecondary">
            Add from my rate card
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {rateCard.map((r) => (
              <Chip
                key={r.id}
                label={`${r.title} · ${formatINR(r.price)}`}
                icon="add"
                accessibilityLabel={`Add ${r.title}, ${formatINR(r.price)}`}
                onPress={() => {
                  haptics.select();
                  setLines((ls) => {
                    // Replace the untouched starter line instead of leaving it empty.
                    const blank = ls.length === 1 && !ls[0]!.title && !ls[0]!.unitPrice;
                    const line = newLine('labour', r.title, 1, String(r.price / 100));
                    return blank ? [line] : [...ls, line];
                  });
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: t.spacing.md }}>
        {lines.map((l, i) => {
          const p = parsed[i]!;
          const lineTotal = Number.isFinite(p.unit_price) ? Math.round(l.qty * p.unit_price) : 0;
          const titleErr = showErrors && !l.title.trim() ? 'Add a description' : null;
          const priceErr = showErrors && !Number.isFinite(p.unit_price) ? 'Enter a price' : null;
          const needsBill = l.kind === 'part' && lineTotal > BILL_PHOTO_MIN_PAISE;
          return (
            <Animated.View key={l.key} entering={FadeInDown.duration(200)} exiting={FadeOut.duration(150)} layout={LinearTransition}>
              <Card gap={t.spacing.md}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                  <SegmentedControl<QuoteItemKind>
                    options={KINDS.map((k) => ({ value: k, label: kindLabel[k] }))}
                    value={l.kind}
                    onChange={(k) => update(l.key, { kind: k })}
                    accessibilityLabel={`Item ${i + 1} type`}
                    style={{ flex: 1 }}
                  />
                  {lines.length > 1 ? (
                    <IconButton
                      icon="trash-outline"
                      accessibilityLabel={`Remove item ${i + 1}`}
                      onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      visualSize={40}
                      color="textSecondary"
                    />
                  ) : null}
                </View>
                <Input
                  placeholder={PLACEHOLDER[l.kind]}
                  value={l.title}
                  onChangeText={(v) => update(l.key, { title: v })}
                  accessibilityLabel={`Line ${i + 1} description`}
                  error={titleErr}
                />
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md }}>
                  <View style={{ gap: 6 }}>
                    <Text variant="subhead" color="textSecondary">
                      Qty
                    </Text>
                    <Stepper value={l.qty} min={1} max={100} onChange={(v) => update(l.key, { qty: v })} label={`Line ${i + 1} quantity`} />
                  </View>
                  <Input
                    label="Unit price"
                    prefix="₹"
                    keyboardType="decimal-pad"
                    placeholder="0"
                    value={l.unitPrice}
                    onChangeText={(v) => update(l.key, { unitPrice: v.replace(/[^\d.]/g, '') })}
                    accessibilityLabel={`Line ${i + 1} unit price in rupees`}
                    containerStyle={{ flex: 1 }}
                    error={priceErr}
                  />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <Ionicons name={KIND_ICON[l.kind]} size={14} color={t.colors.muted} />
                    <Text variant="footnote" color="muted" style={{ flex: 1 }}>
                      {l.kind === 'labour' ? `${pct}% commission applies` : 'No commission · passed through at cost'}
                    </Text>
                  </View>
                  <Text variant="calloutStrong" tabular>
                    {formatINR(lineTotal)}
                  </Text>
                </View>
                {needsBill || (l.kind === 'part' && l.billPath) ? (
                  l.billPath ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: t.spacing.md,
                        padding: t.spacing.sm,
                        borderRadius: t.radii.md,
                        backgroundColor: t.colors.successSoft,
                      }}
                    >
                      {l.billUri ? (
                        <Image source={{ uri: l.billUri }} style={{ width: 40, height: 40, borderRadius: t.radii.sm }} contentFit="cover" />
                      ) : (
                        <Ionicons name="document-attach-outline" size={22} color={t.colors.successText} />
                      )}
                      <Text variant="footnoteStrong" color="successText" style={{ flex: 1 }}>
                        Bill photo attached
                      </Text>
                      <Button title="Replace" variant="ghost" size="sm" onPress={() => void attachBill(l.key)} loading={uploadingFor === l.key} />
                    </View>
                  ) : (
                    <View style={{ gap: t.spacing.sm }}>
                      <InlineAlert tone="warning" icon="camera-outline" message="Parts above ₹500 need a bill photo so the customer can trust the price." />
                      <Button
                        title="Attach bill photo"
                        variant="outline"
                        leftIcon="camera-outline"
                        onPress={() => void attachBill(l.key)}
                        loading={uploadingFor === l.key}
                        fullWidth
                      />
                    </View>
                  )
                ) : null}
              </Card>
            </Animated.View>
          );
        })}

        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          {KINDS.map((k) => (
            <Button
              key={k}
              title={kindLabel[k]}
              leftIcon="add"
              variant="outline"
              size="sm"
              onPress={() => setLines((ls) => [...ls, newLine(k)])}
              accessibilityLabel={`Add ${kindLabel[k].toLowerCase()} line`}
              style={{ flex: 1 }}
            />
          ))}
        </View>
      </View>

      <TextArea label="Note for the customer (optional)" placeholder="Explain what you found and why" value={note} onChangeText={setNote} maxLength={500} />

      <Card gap={10}>
        <Text variant="title3" style={{ marginBottom: 2 }}>
          Breakdown
        </Text>
        <PriceRow label="Labour" amount={settlement.subtotals.labour} />
        <PriceRow label="Parts" amount={settlement.subtotals.parts} hint="No commission" />
        <PriceRow label="Other" amount={settlement.subtotals.other} hint="No commission" />
        <Divider style={{ marginVertical: 2 }} />
        <PriceRow label="Quote total" amount={settlement.subtotals.total} />
        <PriceRow
          label="Customer pays"
          amount={settlement.customerTotal}
          hint={`Incl. ${formatINR(booking.platform_fee)} platform fee; ${formatINR(booking.visit_fee)} visit fee already paid`}
          emphasis="muted"
        />
        <Divider style={{ marginVertical: 2 }} />
        <PriceRow label={`Commission (${pct}% of labour)`} amount={-settlement.commission} emphasis="muted" />
        <PriceRow label="GST on commission (18%)" amount={-settlement.gst} emphasis="muted" />
        <Divider dashed style={{ marginVertical: 2 }} />
        <PriceRow label="You receive" amount={settlement.providerPayout} emphasis="total" />
        <Text variant="footnote" color="muted">
          {rateBp === 0 ? 'You are in your 0% commission period. ' : ''}
          {settlement.subtotals.total < booking.visit_fee ? `Below the ${formatINR(booking.visit_fee)} visit fee, so the visit fee is billed instead. ` : ''}
          Paid to your bank 24 hours after completion, before statutory TDS/TCS.
        </Text>
      </Card>
      <InlineAlert message={error} />
    </Screen>
  );
}

function SummaryLine({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
      <Text variant="footnote" color="muted">
        {label}
      </Text>
      <Text variant="footnoteStrong" color={muted ? 'textSecondary' : 'text'} tabular>
        {value}
      </Text>
    </View>
  );
}
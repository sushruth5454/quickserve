import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { kindLabel } from '../../src/components/QuoteView';
import {
  Badge,
  BottomSheet,
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
  Skeleton,
  Stepper,
  Text,
  TextArea,
  useToast,
} from '../../src/components/ui';
import { getBooking, getMyProvider, getQuotes, sendQuote } from '../../src/lib/api';
import { haptics } from '../../src/lib/haptics';
import { commissionRateBp, formatINR, rupeesToPaise, settleQuotedJob, type LineInput } from '../../src/lib/money';
import type { Booking, Provider, QuoteItemDraft, QuoteItemKind } from '../../src/lib/types';
import { bookingRef } from '../../src/lib/schedule';
import { useTheme } from '../../src/theme';

interface Line {
  key: string;
  kind: QuoteItemKind;
  title: string;
  qty: number;
  unitPrice: string;
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
const newLine = (kind: QuoteItemKind, title = '', qty = 1, unitPrice = ''): Line => ({ key: `l${++seq}`, kind, title, qty, unitPrice });

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
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId) return;
    Promise.all([getBooking(bookingId), getMyProvider(), getQuotes(bookingId)])
      .then(([b, p, quotes]) => {
        setBooking(b);
        setProvider(p);
        const base = quotes.find((q) => q.status === 'sent') ?? quotes.find((q) => q.id === b.approved_quote_id);
        if (base && base.quote_items.length > 0) {
          setLines(base.quote_items.map((i) => newLine(i.kind, i.title, Number(i.qty), String(i.unit_price / 100))));
        }
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [bookingId]);

  const parsed = useMemo<QuoteItemDraft[]>(
    () => lines.map((l) => ({ kind: l.kind, title: l.title.trim(), qty: l.qty, unit_price: rupeesToPaise(Number(l.unitPrice || 'NaN')) })),
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
  const menuLine = lines.find((l) => l.key === menuFor) ?? null;
  const menuIndex = menuLine ? lines.indexOf(menuLine) : -1;

  return (
    <>
      <Screen
        header={<Header title={title} subtitle={`${booking.categories?.name ?? 'Job'} · ${bookingRef(booking.id)}`} />}
        footer={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
            <View>
              <Text variant="caption" color="muted">
                You receive
              </Text>
              <Text variant="title2" tabular>
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
        }
      >
        {isChangeOrder ? (
          <InlineAlert tone="info" message="List the full revised scope. The customer only pays the difference over what they already paid." />
        ) : null}

        <View style={{ gap: t.spacing.md }}>
          {lines.map((l, i) => {
            const p = parsed[i]!;
            const lineTotal = Number.isFinite(p.unit_price) ? Math.round(l.qty * p.unit_price) : 0;
            const titleErr = showErrors && !l.title.trim() ? 'Required' : null;
            const priceErr = showErrors && !Number.isFinite(p.unit_price) ? 'Required' : null;
            return (
              <Animated.View key={l.key} entering={FadeInDown.duration(200)} exiting={FadeOut.duration(150)} layout={LinearTransition}>
                <Card gap={t.spacing.md}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                    <Badge label={kindLabel[l.kind]} icon={KIND_ICON[l.kind]} size="md" />
                    <Text variant="footnote" color="muted" style={{ flex: 1 }}>
                      Item {i + 1}
                    </Text>
                    <IconButton
                      icon="ellipsis-horizontal"
                      accessibilityLabel={`More options for item ${i + 1}`}
                      onPress={() => setMenuFor(l.key)}
                      visualSize={36}
                      color="textSecondary"
                    />
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
                    <Text variant="footnote" color="muted" style={{ flex: 1 }}>
                      {l.kind === 'labour' ? `${pct}% commission applies` : 'No commission · passed through at cost'}
                    </Text>
                    <Text variant="calloutStrong" tabular>
                      {formatINR(lineTotal)}
                    </Text>
                  </View>
                  {l.kind === 'part' && lineTotal > 50000 ? (
                    <InlineAlert tone="warning" icon="camera-outline" message="Parts above ₹500 need a bill photo — share it in the booking chat." />
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

        <Card variant="elevated" gap={10}>
          <Text variant="title3" style={{ marginBottom: 2 }}>
            Summary
          </Text>
          {settlement.subtotals.labour > 0 ? <PriceRow label="Labour" amount={settlement.subtotals.labour} /> : null}
          {settlement.subtotals.parts > 0 ? <PriceRow label="Parts" amount={settlement.subtotals.parts} /> : null}
          {settlement.subtotals.other > 0 ? <PriceRow label="Other" amount={settlement.subtotals.other} /> : null}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="title3">You receive</Text>
            <Text variant="title2" color="successText" tabular>
              {formatINR(settlement.providerPayout)}
            </Text>
          </View>
          <Text variant="footnote" color="muted">
            {rateBp === 0 ? 'You are in your 0% commission period. ' : ''}Paid to your bank 24 hours after completion, before
            statutory TDS/TCS.
          </Text>
        </Card>
        <InlineAlert message={error} />
      </Screen>

      <BottomSheet visible={!!menuLine} onClose={() => setMenuFor(null)} title={menuLine ? `Item ${menuIndex + 1}` : undefined}>
        {menuLine ? (
          <View style={{ gap: t.spacing.md }}>
            <Text variant="subheadStrong" color="textSecondary">
              Type
            </Text>
            <View style={{ marginHorizontal: -t.spacing.sm }}>
              {KINDS.map((k) => {
                const selected = menuLine.kind === k;
                return (
                  <Pressable
                    key={k}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => {
                      haptics.select();
                      update(menuLine.key, { kind: k });
                      setMenuFor(null);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: t.spacing.md,
                      minHeight: 52,
                      paddingHorizontal: t.spacing.sm,
                      borderRadius: t.radii.md,
                      backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
                    })}
                  >
                    <Ionicons name={KIND_ICON[k]} size={20} color={t.colors.textSecondary} />
                    <Text variant={selected ? 'bodyStrong' : 'body'} style={{ flex: 1 }}>
                      {kindLabel[k]}
                    </Text>
                    {selected ? <Ionicons name="checkmark" size={22} color={t.colors.primaryText} /> : null}
                  </Pressable>
                );
              })}
            </View>
            {lines.length > 1 ? (
              <Button
                title="Remove item"
                variant="destructiveGhost"
                leftIcon="trash-outline"
                onPress={() => {
                  setLines((ls) => ls.filter((x) => x.key !== menuLine.key));
                  setMenuFor(null);
                }}
              />
            ) : null}
          </View>
        ) : (
          <View />
        )}
      </BottomSheet>
    </>
  );
}

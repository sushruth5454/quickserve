import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { kindLabel } from '../../src/components/QuoteView';
import {
  Button,
  Card,
  Chip,
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
import { useTheme } from '../../src/theme';

interface Line {
  key: string;
  kind: QuoteItemKind;
  title: string;
  qty: number;
  unitPrice: string;
}

const KINDS: QuoteItemKind[] = ['labour', 'part', 'other'];
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

  return (
    <Screen
      header={<Header title={title} subtitle={`${booking.categories?.name ?? 'Job'} · #${booking.id.slice(0, 8)}`} />}
      footer={
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
            rightIcon="send"
            size="lg"
            onPress={() => void submit()}
            loading={submitting}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      {isChangeOrder ? (
        <InlineAlert
          tone="info"
          message="List the full revised scope. The customer only pays the difference over what they already paid."
        />
      ) : null}

      <View style={{ flexDirection: 'row', gap: t.spacing.sm, flexWrap: 'wrap' }}>
        {KINDS.map((k) => (
          <Chip
            key={k}
            label={kindLabel[k]}
            icon="add"
            onPress={() => setLines((ls) => [...ls, newLine(k)])}
            accessibilityLabel={`Add ${kindLabel[k].toLowerCase()} line`}
          />
        ))}
      </View>

      {lines.map((l, i) => {
        const p = parsed[i]!;
        const lineTotal = Number.isFinite(p.unit_price) ? Math.round(l.qty * p.unit_price) : 0;
        const titleErr = showErrors && !l.title.trim() ? 'Required' : null;
        const priceErr = showErrors && !Number.isFinite(p.unit_price) ? 'Required' : null;
        return (
          <Animated.View key={l.key} entering={FadeInDown.duration(220)} exiting={FadeOut.duration(150)} layout={LinearTransition}>
            <Card gap={t.spacing.md}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs }}>
                <View style={{ flexDirection: 'row', gap: 6, flex: 1, flexWrap: 'wrap' }}>
                  {KINDS.map((k) => (
                    <KindPill key={k} label={kindLabel[k]} selected={l.kind === k} onPress={() => update(l.key, { kind: k })} />
                  ))}
                </View>
                {lines.length > 1 ? (
                  <IconButton
                    icon="trash-outline"
                    color="danger"
                    size={20}
                    accessibilityLabel={`Remove line ${i + 1}`}
                    onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
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
                  <Text variant="captionStrong" color="textSecondary">
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
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="caption" color="muted">
                  {l.kind === 'labour' ? `${pct}% commission applies` : 'No commission · passed through at cost'}
                </Text>
                <Text variant="bodyStrong" tabular>
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

      <TextArea label="Note for the customer (optional)" placeholder="Explain what you found and why" value={note} onChangeText={setNote} maxLength={500} />

      <Card gap={t.spacing.md} elevation="md">
        <Text variant="title3">Summary</Text>
        {settlement.subtotals.labour > 0 ? <PriceRow label="Labour" amount={settlement.subtotals.labour} /> : null}
        {settlement.subtotals.parts > 0 ? <PriceRow label="Parts" amount={settlement.subtotals.parts} /> : null}
        {settlement.subtotals.other > 0 ? <PriceRow label="Other" amount={settlement.subtotals.other} /> : null}
        <PriceRow label="Quote total" amount={settlement.subtotals.total} emphasis="normal" />
        <PriceRow
          label="Customer pays"
          amount={settlement.customerTotal}
          hint={`Incl. ${formatINR(booking.platform_fee)} platform fee; ${formatINR(booking.visit_fee)} visit fee already paid`}
          emphasis="muted"
        />
        <Divider />
        <PriceRow label={`Commission (${pct}% of labour)`} amount={-settlement.commission} emphasis="muted" />
        <PriceRow label="GST on commission (18%)" amount={-settlement.gst} emphasis="muted" />
        <Divider dashed />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="wallet" size={18} color={t.colors.success} />
            <Text variant="title3">You receive</Text>
          </View>
          <Text variant="title2" color="successText" tabular>
            {formatINR(settlement.providerPayout)}
          </Text>
        </View>
        <Text variant="caption" color="muted">
          {rateBp === 0 ? 'You are in your 0% commission period. ' : ''}Paid to your bank 24 hours after completion, before
          statutory TDS/TCS.
        </Text>
      </Card>
      <InlineAlert message={error} />
    </Screen>
  );
}

function KindPill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8 }}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={{
        minHeight: 32,
        paddingHorizontal: 12,
        borderRadius: t.radii.pill,
        justifyContent: 'center',
        backgroundColor: selected ? t.colors.primarySoft : t.colors.surfaceAlt,
        borderWidth: 1,
        borderColor: selected ? t.colors.primary : 'transparent',
      }}
    >
      <Text variant="captionStrong" color={selected ? 'primary' : 'muted'}>
        {label}
      </Text>
    </Pressable>
  );
}

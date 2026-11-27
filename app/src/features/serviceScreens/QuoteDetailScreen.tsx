import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { kindLabel, QuoteView } from '../../components/QuoteView';
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
} from '../../components/ui';
import { getBooking, getQuotes, listMyServices, sendQuote, uploadJobPhoto } from '../../lib/api';
import { buildFixedAddonPayload, canManageServiceQuotes, getQuoteEditorMode, hasPendingFixedAddonQuote, sendFixedAddons } from '../../lib/fixedBooking';
import { useAuth } from '../../lib/auth';
import { isDemoMode } from '../../lib/config';
import { haptics } from '../../lib/haptics';
import { formatINR, rupeesToPaise, type LineKind } from '../../lib/money';
import type { Booking, Quote, QuoteItemDraft, RateCardItem } from '../../lib/types';
import { bookingRef } from '../../lib/schedule';
import { useTheme } from '../../theme';
import { getMyProviderBusinessContext } from '../merchantStaff/api';

interface Line {
  key: string;
  kind: LineKind;
  title: string;
  qty: number;
  unitPrice: string;
  /** Storage path of the uploaded bill photo (parts). */
  billPath?: string;
  billUri?: string;
}

interface AddonLine {
  key: string;
  title: string;
  qty: number;
  unitPrice: string;
  unit?: string;
}

const KINDS: LineKind[] = ['labour', 'part', 'other'];
const KIND_ICON: Partial<Record<LineKind, keyof typeof Ionicons.glyphMap>> = {
  labour: 'construct-outline',
  part: 'hardware-chip-outline',
  other: 'ellipsis-horizontal-circle-outline',
  material: 'hardware-chip-outline',
  package: 'cube-outline',
  per_unit: 'repeat-outline',
  travel: 'navigate-outline',
  rental: 'calendar-outline',
  discount: 'pricetag-outline',
  addon: 'add-circle-outline',
};
const PLACEHOLDER: Partial<Record<LineKind, string>> = {
  labour: 'e.g. Gas refill, wiring work',
  part: 'e.g. Capacitor 45uF',
  other: 'e.g. Disposal, transport',
  material: 'e.g. Consumables or materials',
  package: 'e.g. Package scope',
  per_unit: 'e.g. Additional unit',
  travel: 'e.g. Travel charge',
  rental: 'e.g. Equipment rental',
  discount: 'e.g. Approved discount',
  addon: 'e.g. Extra requested service',
};

let seq = 0;
const newLine = (kind: LineKind, title = '', qty = 1, unitPrice = '', billPath?: string): Line => ({
  key: `l${++seq}`,
  kind,
  title,
  qty,
  unitPrice,
  billPath,
});
const newAddon = (): AddonLine => ({ key: `a${++seq}`, title: '', qty: 1, unitPrice: '' });
/** PRD: parts above ₹500 need a bill photo. */
const BILL_PHOTO_MIN_PAISE = 50000;

export default function QuoteDetailScreen() {
  const t = useTheme();
  const toast = useToast();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { userId } = useAuth();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [lines, setLines] = useState<Line[]>([newLine('labour')]);
  const [addons, setAddons] = useState<AddonLine[]>([newAddon()]);
  const [note, setNote] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [rateCard, setRateCard] = useState<RateCardItem[]>([]);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setBooking(null);
    setQuotes([]);
    setAccessDenied(false);
    setLoadError(null);
    setLines([newLine('labour')]);
    setAddons([newAddon()]);
    setNote('');
    setError(null);
    setShowErrors(false);
    setRateCard([]);
    if (!bookingId || !userId) return () => { active = false; };

    void (async () => {
      try {
        const loadedBooking = await getBooking(bookingId);
        if (!active) return;
        if (loadedBooking.customer_id === userId) {
          setAccessDenied(true);
          return;
        }

        let businessRole: string | null = null;
        let services: Awaited<ReturnType<typeof listMyServices>> = [];
        if (isDemoMode) {
          services = await listMyServices(true).catch(() => []);
          if (services.some((service) => service.provider_id === loadedBooking.provider_id)) businessRole = 'owner';
        } else {
          const business = await getMyProviderBusinessContext(loadedBooking.provider_id).catch(() => null);
          if (business?.id === loadedBooking.provider_id) businessRole = business.business_role;
          if (businessRole === 'owner') services = await listMyServices(true).catch(() => []);
        }
        if (!active) return;
        if (!canManageServiceQuotes(businessRole)) {
          setAccessDenied(true);
          return;
        }

        const loadedQuotes = await getQuotes(loadedBooking.id);
        if (!active) return;
        const effectiveBooking: Booking = isDemoMode
          ? { ...loadedBooking, booking_origin: loadedBooking.booking_origin ?? 'marketplace' }
          : loadedBooking;
        const effectiveQuotes = isDemoMode
          ? loadedQuotes.map((quote) => ({
              ...quote,
              quote_type: quote.quote_type ?? (effectiveBooking.archetype === 'fixed' ? 'package' : 'itemized'),
            }))
          : loadedQuotes;
        setBooking(effectiveBooking);
        setQuotes(effectiveQuotes);
        setRateCard(services.find((service) => service.category_id === effectiveBooking.category_id)?.rate_card_items ?? []);

        const mode = getQuoteEditorMode(effectiveBooking, effectiveQuotes);
        if (mode === 'itemized') {
          const base = effectiveQuotes.find((quote) => quote.status === 'sent')
            ?? effectiveQuotes.find((quote) => quote.id === effectiveBooking.approved_quote_id);
          if (base && base.quote_items.length > 0) {
            setLines(
              base.quote_items
                .filter((item) => !item.travel_request_id && item.kind !== 'travel')
                .map((item) => newLine(item.kind as LineKind, item.title, Number(item.qty), String(item.unit_price / 100), item.bill_photo_url ?? undefined)),
            );
          }
        }
      } catch (e) {
        if (active) setLoadError((e as Error).message);
      }
    })();

    return () => { active = false; };
  }, [bookingId, userId]);

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

  const displaySubtotals = useMemo(() => {
    const result = { labour: 0, parts: 0, other: 0, total: 0 };
    for (const item of parsed) {
      if (!Number.isFinite(item.unit_price) || item.qty <= 0) continue;
      const line = Math.round(item.qty * item.unit_price);
      if (item.kind === 'labour') result.labour += line;
      else if (item.kind === 'part') result.parts += line;
      else result.other += line;
      result.total += line;
    }
    const travelFee = Math.max(0, booking?.travel_requests?.quoted_fee ?? 0);
    result.other += travelFee;
    result.total += travelFee;
    return result;
  }, [parsed, booking]);
  const { quoteMode, approvedPackage, hasPendingAddonPayment, isChangeOrder, title } = useQuoteDetailController(booking, quotes);
  const addonTotal = addons.reduce((sum, addon) => {
    const unitPrice = rupeesToPaise(Number(addon.unitPrice));
    return sum + (Number.isFinite(unitPrice) && addon.qty > 0 ? Math.round(addon.qty * unitPrice) : 0);
  }, 0);

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const updateAddon = (key: string, patch: Partial<AddonLine>) => setAddons((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const submit = async () => {
    setShowErrors(true);
    if (!bookingId || !booking || !quoteMode) {
      setError('This booking is not available for quote editing.');
      return;
    }
    if (quoteMode === 'fixed_addons') {
      if (!approvedPackage) {
        setError('The approved package could not be loaded. Refresh and try again.');
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const payload = buildFixedAddonPayload(
          approvedPackage,
          addons.map(({ title, qty, unit, unitPrice }) => ({ title, qty, unit, unitPrice })),
        );
        await sendFixedAddons(bookingId, payload, note.trim() || undefined);
        toast({ message: 'Add-ons sent to the customer', tone: 'success' });
        router.back();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const invalid = parsed.some((p) => !p.title || !(p.qty > 0) || !Number.isFinite(p.unit_price) || p.unit_price < 0);
    if (invalid || parsed.length === 0) {
      haptics.error();
      setError('Every line needs a description, a quantity and a price.');
      return;
    }
    const missingBill = parsed.some((item, index) =>
      item.kind === 'part'
      && Math.round(item.qty * item.unit_price) > BILL_PHOTO_MIN_PAISE
      && !lines[index]?.billPath,
    );
    if (missingBill) {
      haptics.error();
      setError('Parts above ₹500 need a bill photo before sending.');
      return;
    }
    if (displaySubtotals.total <= 0) {
      haptics.error();
      setError('The quote total is ₹0. Add a price to at least one item.');
      return;
    }
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

  if (!booking) {
    return (
      <Screen header={<Header title="Quote" />}>
        {accessDenied ? (
          <ErrorState message="Only the assigned provider owner or manager can edit quotes for this booking." />
        ) : loadError ? (
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
  if (!quoteMode) {
    return (
      <Screen header={<Header title={title} />}>
        <ErrorState
          message={hasPendingAddonPayment
            ? 'Resolve the pending fixed add-on payment before sending another add-on.'
            : 'This booking does not support itemised quotes or fixed-package add-ons.'}
        />
      </Screen>
    );
  }

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
            <SummaryLine
              label={quoteMode === 'fixed_addons' ? 'Add-on total' : 'Quote total'}
              value={formatINR(quoteMode === 'fixed_addons' ? addonTotal : displaySubtotals.total)}
            />
            <SummaryLine label="Server settlement preview" value="After quote is sent" muted />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
            <View>
              <Text variant="caption" color="muted">
                You receive
              </Text>
              <Text variant="title2" color="successText" tabular>
                After sending
              </Text>
            </View>
            <Button
              title={quoteMode === 'fixed_addons' ? 'Send add-ons' : isChangeOrder ? 'Send change order' : 'Send to customer'}
              size="lg"
              onPress={() => void submit()}
              loading={submitting}
              disabled={submitting}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      }
    >
      {quoteMode === 'fixed_addons' ? (
        <InlineAlert tone="info" message="The approved package and its original scope stay unchanged. Add only positive extras; the customer must approve them before an add-on payment is created." />
      ) : isChangeOrder ? (
        <InlineAlert tone="info" message="List the full revised scope. The customer only pays the difference over what they already paid." />
      ) : null}
      {quoteMode === 'itemized' && booking.travel_requests ? (
        <InlineAlert
          tone="info"
          message={`Travel fee ${formatINR(booking.travel_requests.quoted_fee)} is attached automatically and commission applies to it. The customer sees it as a separate line.`}
        />
      ) : null}
      <InlineAlert tone="info" message="The server calculates commission, GST, and your payout. The settlement breakdown appears after the quote is sent." />

      {quoteMode === 'fixed_addons' && approvedPackage ? (
        <QuoteView
          quote={approvedPackage}
          visitFee={0}
          platformFee={0}
          alreadyPaid={0}
          title="Included package · read-only"
          typical={null}
        />
      ) : null}

      {quoteMode === 'itemized' && rateCard.length > 0 ? (
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

      {quoteMode === 'fixed_addons' ? (
        <View style={{ gap: t.spacing.md }}>
          {addons.map((addon, index) => {
            const titleErr = showErrors && addon.title.trim().length < 2 ? 'Enter at least 2 characters' : null;
            const price = Number(addon.unitPrice);
            const priceErr = showErrors && (!Number.isFinite(price) || price <= 0) ? 'Enter a positive price' : null;
            const lineTotal = Number.isFinite(price) ? Math.round(addon.qty * rupeesToPaise(price)) : 0;
            return (
              <Animated.View key={addon.key} entering={FadeInDown.duration(200)} exiting={FadeOut.duration(150)} layout={LinearTransition}>
                <Card gap={t.spacing.md}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                    <Text variant="subheadStrong" style={{ flex: 1 }}>Add-on {index + 1}</Text>
                    {addons.length > 1 ? (
                      <IconButton
                        icon="trash-outline"
                        accessibilityLabel={`Remove add-on ${index + 1}`}
                        onPress={() => setAddons((items) => items.filter((item) => item.key !== addon.key))}
                        visualSize={40}
                        color="textSecondary"
                      />
                    ) : null}
                  </View>
                  <Input
                    placeholder="e.g. Extra room cleaning"
                    value={addon.title}
                    onChangeText={(value) => updateAddon(addon.key, { title: value })}
                    accessibilityLabel={`Add-on ${index + 1} description`}
                    error={titleErr}
                  />
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md }}>
                    <View style={{ gap: 6 }}>
                      <Text variant="subhead" color="textSecondary">Qty</Text>
                      <Stepper value={addon.qty} min={1} max={100} onChange={(value) => updateAddon(addon.key, { qty: value })} label={`Add-on ${index + 1} quantity`} />
                    </View>
                    <Input
                      label="Unit price"
                      prefix="₹"
                      keyboardType="decimal-pad"
                      placeholder="0"
                      value={addon.unitPrice}
                      onChangeText={(value) => updateAddon(addon.key, { unitPrice: value.replace(/[^\d.]/g, '') })}
                      accessibilityLabel={`Add-on ${index + 1} unit price in rupees`}
                      containerStyle={{ flex: 1 }}
                      error={priceErr}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text variant="footnote" color="muted">Positive add-on · package base is read-only</Text>
                    <Text variant="calloutStrong" tabular>{formatINR(lineTotal)}</Text>
                  </View>
                </Card>
              </Animated.View>
            );
          })}
          {addons.length < 20 ? (
            <Button
              title="Add another add-on"
              leftIcon="add"
              variant="outline"
              onPress={() => setAddons((items) => [...items, newAddon()])}
            />
          ) : null}
        </View>
      ) : (
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
                    <SegmentedControl<LineKind>
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
                    placeholder={PLACEHOLDER[l.kind] ?? 'Add a short description'}
                    value={l.title}
                    onChangeText={(v) => update(l.key, { title: v })}
                    accessibilityLabel={`Line ${i + 1} description`}
                    error={titleErr}
                  />
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md }}>
                    <View style={{ gap: 6 }}>
                      <Text variant="subhead" color="textSecondary">Qty</Text>
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
                      <Ionicons name={KIND_ICON[l.kind] ?? 'ellipsis-horizontal-circle-outline'} size={14} color={t.colors.muted} />
                      <Text variant="footnote" color="muted" style={{ flex: 1 }}>
                        {l.kind === 'labour' ? 'Commissionable · rate calculated by the server' : 'No commission · passed through at cost'}
                      </Text>
                    </View>
                    <Text variant="calloutStrong" tabular>{formatINR(lineTotal)}</Text>
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
                        <Text variant="footnoteStrong" color="successText" style={{ flex: 1 }}>Bill photo attached</Text>
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
      )}

      <TextArea label="Note for the customer (optional)" placeholder="Explain what you found and why" value={note} onChangeText={setNote} maxLength={500} />

      <Card gap={10}>
        <Text variant="title3" style={{ marginBottom: 2 }}>
          Breakdown
        </Text>
        {quoteMode === 'fixed_addons' ? (
          <PriceRow label="Add-ons only" amount={addonTotal} hint="The approved package remains unchanged" />
        ) : (
          <>
            <PriceRow label="Labour" amount={displaySubtotals.labour} />
            {displaySubtotals.parts > 0 ? <PriceRow label="Parts" amount={displaySubtotals.parts} hint="No commission" /> : null}
            {displaySubtotals.other > 0 ? <PriceRow label="Other, including travel" amount={displaySubtotals.other} hint={booking.travel_requests ? 'Travel is included' : 'No commission · passed through at cost'} /> : null}
          </>
        )}
        <Divider style={{ marginVertical: 2 }} />
        <PriceRow label={quoteMode === 'fixed_addons' ? 'Add-on total' : 'Quote total'} amount={quoteMode === 'fixed_addons' ? addonTotal : displaySubtotals.total} />
        <Text variant="footnote" color="muted">
          Commission, GST, and provider payout are calculated by the server and shown on the booking after the quote is sent.
        </Text>
      </Card>
      <InlineAlert message={error} />
    </Screen>
  );
}

function useQuoteDetailController(booking: Booking | null, quotes: Quote[]) {
  return useMemo(() => {
    const quoteMode = booking ? getQuoteEditorMode(booking, quotes) : null;
    const hasPendingAddonPayment = hasPendingFixedAddonQuote(quotes);
    const approvedPackage = booking
      ? quotes.find((quote) => quote.id === booking.approved_quote_id) ?? null
      : null;
    const isChangeOrder = booking?.status === 'in_progress';
    const title = quoteMode === 'fixed_addons'
      ? 'Fixed add-ons'
      : isChangeOrder
        ? 'Change order'
        : booking?.status === 'quote_sent'
          ? 'Revise quote'
          : 'Itemised quote';
    return { quoteMode, approvedPackage, hasPendingAddonPayment, isChangeOrder, title };
  }, [booking, quotes]);
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

import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { PriceFooter } from '../../components/market/PriceFooter';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, TextArea, useToast } from '../../components/ui';
import { useT } from '../../i18n';
import { requireSignIn } from '../../lib/authGate';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';
import {
  bookSportsSlot,
  getCustomerSportsVenue,
  getSportsSlots,
  type CustomerSportsVenue,
  type SportsPaymentMode,
  type SportsSlotAvailability,
} from './api';
import {
  canContinueSportsCheckout,
  getAvailableSportsPaymentModes,
  getAvailableSportsDurations,
  getSportsCancellationPolicyLabel,
  getSportsBookingActionLabel,
  getSportsEstimatedTotal,
  formatSportsDuration,
  isSportsSlotTakenError,
  slotCellState,
} from './model';
import { sportsVenueBookingReturnTo } from './bookingPresentation';
import { useSportsReadRefresh } from './useSportsReadRefresh';

function indiaDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

function formatSlot(value: string) {
  return new Date(value).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function makeIdempotencyKey() {
  return `sports-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getSportsVenueGalleryPresentation(
  photos: readonly string[],
  familyUxEnabled: boolean,
) {
  return familyUxEnabled
    ? {
      heroImage: photos[0] ?? null,
      additionalImages: photos.slice(1),
      expandable: photos.length > 1,
      legacyImages: [] as string[],
    }
    : {
      heroImage: null,
      additionalImages: [] as string[],
      expandable: false,
      legacyImages: [...photos],
    };
}

export type SportsSlotContextIdentity = {
  venueId: string;
  resourceId: string;
  date: string;
  participants: number;
  sportsEnabled: boolean;
  multiSlotEnabled: boolean;
};

export type SportsSlotReadContext = SportsSlotContextIdentity & { generation: number };
export type SportsSlotSelection = { startsAt: string; context: SportsSlotReadContext };

type SportsSlotRequestGuard = { isCurrent: () => boolean };

export function areSportsSlotContextIdentitiesEqual(
  left: SportsSlotContextIdentity,
  right: SportsSlotContextIdentity,
): boolean {
  return left.venueId === right.venueId
    && left.resourceId === right.resourceId
    && left.date === right.date
    && left.participants === right.participants
    && left.sportsEnabled === right.sportsEnabled
    && left.multiSlotEnabled === right.multiSlotEnabled;
}

export function isSportsSlotSelectionCurrent(
  selection: SportsSlotSelection | null,
  bookingContext: SportsSlotContextIdentity,
  currentRead: SportsSlotReadContext | null,
): boolean {
  return !!selection
    && !!currentRead
    && areSportsSlotContextIdentitiesEqual(selection.context, bookingContext)
    && areSportsSlotContextIdentitiesEqual(currentRead, bookingContext);
}

export function createSportsSlotRequestTracker() {
  let generation = 0;
  let activeRequest: SportsSlotReadContext | null = null;
  const isCurrent = (context: SportsSlotReadContext, guard: SportsSlotRequestGuard) =>
    guard.isCurrent()
    && activeRequest?.generation === context.generation
    && areSportsSlotContextIdentitiesEqual(activeRequest, context);

  return {
    begin(identity: SportsSlotContextIdentity): SportsSlotReadContext {
      activeRequest = { ...identity, generation: ++generation };
      return activeRequest;
    },
    invalidate() {
      generation += 1;
      activeRequest = null;
    },
    isCurrent,
    runIfCurrent(
      context: SportsSlotReadContext,
      guard: SportsSlotRequestGuard,
      action: () => void,
    ): boolean {
      if (!isCurrent(context, guard)) return false;
      action();
      return true;
    },
  };
}

export function createSportsBookingIdempotencyKeyManager(
  createKey: () => string = makeIdempotencyKey,
) {
  let requestIdentity: string | null = null;
  let key: string | null = null;

  return {
    getFor(request: string): string {
      if (requestIdentity !== request) {
        requestIdentity = request;
        key = null;
      }
      if (!key) key = createKey();
      return key;
    },
    reset() {
      requestIdentity = null;
      key = null;
    },
  };
}

export function getSportsOnlineCheckoutDisclosure(paymentMode: SportsPaymentMode): string | null {
  return paymentMode === 'online'
    ? 'Any customer fee and the exact total will appear in secure checkout.'
    : null;
}

export function SportsVenueBookingScreen({ venueId }: { venueId: string }) {
  const t = useTheme();
  const translate = useT();
  const toast = useToast();
  const flags = useAppFeatureFlags();
  const sportsEnabled = flags.isOn('sports');
  const familyUxEnabled = flags.isOn('oorva_sports_ux') && flags.isOn('oorva_brand');
  const onlinePaymentsEnabled = flags.isOn('sports_online_payments');
  const instantBookingEnabled = flags.isOn('sports_instant_booking');
  const capacitySlotsEnabled = flags.isOn('sports_capacity_slots');
  const multiSlotEnabled = flags.isOn('sports_multi_slot');
  const [venue, setVenue] = useState<CustomerSportsVenue | null>(null);
  const [resourceId, setResourceId] = useState('');
  const [date, setDate] = useState(() => indiaDate(1));
  const [slotRead, setSlotRead] = useState<{
    context: SportsSlotReadContext;
    slots: SportsSlotAvailability[];
  } | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SportsSlotSelection | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [participants, setParticipants] = useState(1);
  const [photosExpanded, setPhotosExpanded] = useState(false);
  const [paymentMode, setPaymentMode] = useState<SportsPaymentMode>('pay_at_venue');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(createSportsBookingIdempotencyKeyManager());
  const slotRequestTracker = useRef(createSportsSlotRequestTracker());

  const resource = useMemo(
    () => venue?.resources.find((item) => item.id === resourceId) ?? venue?.resources[0],
    [resourceId, venue],
  );
  const capacity = capacitySlotsEnabled ? Math.min(50, Math.max(1, resource?.capacity ?? 1)) : 1;
  const canChooseParticipants = capacitySlotsEnabled && capacity > 1;
  const effectiveParticipants = canChooseParticipants ? Math.min(participants, capacity) : 1;
  const currentSlotContext: SportsSlotContextIdentity = {
    venueId,
    resourceId,
    date,
    participants: effectiveParticipants,
    sportsEnabled,
    multiSlotEnabled,
  };
  const currentSlotContextRef = useRef(currentSlotContext);
  currentSlotContextRef.current = currentSlotContext;
  const selectedSlotRef = useRef(selectedSlot);
  selectedSlotRef.current = selectedSlot;
  const slotReadRef = useRef(slotRead);
  slotReadRef.current = slotRead;
  const availablePaymentModes = getAvailableSportsPaymentModes(venue?.payment_modes, {
    sportsEnabled,
    onlinePaymentsEnabled,
    payoutAccountVerified: venue?.online_payment_ready === true,
  });
  const selectedPaymentMode = availablePaymentModes.includes(paymentMode)
    ? paymentMode
    : availablePaymentModes[0] ?? 'pay_at_venue';
  const selectedStart = selectedSlot
    && areSportsSlotContextIdentitiesEqual(selectedSlot.context, currentSlotContext)
    ? selectedSlot.startsAt
    : null;
  const slots = slotRead
    && areSportsSlotContextIdentitiesEqual(slotRead.context, currentSlotContext)
    ? slotRead.slots
    : null;
  const durationOptions = selectedStart
    ? getAvailableSportsDurations(slots ?? [], selectedStart, effectiveParticipants, multiSlotEnabled ? 4 : 1)
    : [];
  const duration = durationOptions.includes(selectedDuration) ? selectedDuration : durationOptions[0] ?? 1;
  const effectiveBookingMode = resource?.booking_mode === 'instant' && instantBookingEnabled ? 'instant' : 'approval';
  const estimatedTotal = getSportsEstimatedTotal(slots ?? [], selectedStart, duration);
  const cancellationPolicyLabel = getSportsCancellationPolicyLabel(venue?.cancellation_policy);
  const gallery = getSportsVenueGalleryPresentation(venue?.photos ?? [], familyUxEnabled);
  const currentBookingRequest = selectedStart ? {
    resourceId: currentSlotContext.resourceId,
    startsAt: selectedStart,
    slots: duration,
    participants: currentSlotContext.participants,
    paymentMode: selectedPaymentMode,
    note: note.trim(),
  } : null;
  const currentBookingRequestIdentity = currentBookingRequest
    ? JSON.stringify({ ...currentBookingRequest, venueId: currentSlotContext.venueId, date: currentSlotContext.date })
    : null;
  const bookingRequestIdentityRef = useRef(currentBookingRequestIdentity);
  bookingRequestIdentityRef.current = currentBookingRequestIdentity;
  const refreshContextKey = `sports-venue:${venueId}:${resourceId}:${date}:${effectiveParticipants}:${multiSlotEnabled}:${sportsEnabled}`;
  const previousContextKeyRef = useRef(refreshContextKey);
  const invalidateSlotContext = () => {
    slotRequestTracker.current.invalidate();
    selectedSlotRef.current = null;
    slotReadRef.current = null;
    setSelectedSlot(null);
    setSlotRead(null);
  };

  useLayoutEffect(() => {
    if (previousContextKeyRef.current === refreshContextKey) return;
    previousContextKeyRef.current = refreshContextKey;
    invalidateSlotContext();
  }, [refreshContextKey]);

  useEffect(() => () => {
    slotRequestTracker.current.invalidate();
    selectedSlotRef.current = null;
    slotReadRef.current = null;
  }, []);

  const slotCells = (slots ?? [])
    .map((slot) => ({
      slot,
      cell: slotCellState(slot, selectedStart ? [selectedStart] : []),
    }))
    .filter(({ cell }) => cell.visible);
  const dateOptions = Array.from({ length: 14 }, (_, offset) => ({
    value: indiaDate(offset),
    label: offset === 0
      ? 'Today'
      : offset === 1
        ? 'Tomorrow'
        : new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }).format(new Date(`${indiaDate(offset)}T12:00:00+05:30`)),
  }));

  const loadForRefresh = useCallback(async (guard: { isCurrent: () => boolean }) => {
    if (!sportsEnabled || !venueId) return;
    const requestContext = slotRequestTracker.current.begin(currentSlotContextRef.current);
    const requestGuard = {
      isCurrent: () => guard.isCurrent()
        && areSportsSlotContextIdentitiesEqual(currentSlotContextRef.current, requestContext),
    };
    const runIfCurrent = (action: () => void) =>
      slotRequestTracker.current.runIfCurrent(requestContext, requestGuard, action);
    try {
      const nextVenue = await getCustomerSportsVenue(venueId);
      if (!slotRequestTracker.current.isCurrent(requestContext, requestGuard)) return;
      if (!nextVenue) {
        runIfCurrent(() => {
          slotReadRef.current = null;
          selectedSlotRef.current = null;
          setVenue(null);
          setResourceId('');
          setSlotRead(null);
          setSelectedSlot(null);
          setError('This venue is not available.');
        });
        return;
      }

      const currentResourceExists = nextVenue.resources.some((item) => item.id === requestContext.resourceId);
      const nextResourceId = currentResourceExists
        ? requestContext.resourceId
        : nextVenue.resources[0]?.id ?? '';
      if (!currentResourceExists) {
        runIfCurrent(() => {
          slotReadRef.current = null;
          selectedSlotRef.current = null;
          setVenue(nextVenue);
          setResourceId(nextResourceId);
          setSlotRead(null);
          setSelectedSlot(null);
          setError(null);
        });
        return;
      }

      runIfCurrent(() => setVenue(nextVenue));
      const nextSlots = await getSportsSlots(requestContext.resourceId, requestContext.date);
      runIfCurrent(() => {
        const nextRead = { context: requestContext, slots: nextSlots };
        slotReadRef.current = nextRead;
        setSlotRead(nextRead);
        setSelectedSlot((current) => {
          if (!current
            || !areSportsSlotContextIdentitiesEqual(current.context, requestContext)
            || getAvailableSportsDurations(
              nextSlots,
              current.startsAt,
              requestContext.participants,
              requestContext.multiSlotEnabled ? 4 : 1,
            ).length === 0) return null;
          const nextSelection = { ...current, context: requestContext };
          selectedSlotRef.current = nextSelection;
          return nextSelection;
        });
        setError(null);
      });
    } catch (caught) {
      runIfCurrent(() => {
        setSlotRead(null);
        slotReadRef.current = null;
        setSelectedSlot(null);
        selectedSlotRef.current = null;
        setError((caught as Error).message);
      });
    }
  }, [sportsEnabled, venueId]);
  const { refresh } = useSportsReadRefresh(loadForRefresh, {
    contextKey: refreshContextKey,
    enabled: sportsEnabled && !!venueId,
    intervalMs: 30_000,
  });

  const chooseResource = (nextResourceId: string) => {
    idempotencyKey.current.reset();
    invalidateSlotContext();
    setResourceId(nextResourceId);
    setSelectedDuration(1);
    setParticipants(1);
  };

  const chooseDate = (nextDate: string) => {
    idempotencyKey.current.reset();
    invalidateSlotContext();
    setDate(nextDate);
    setSelectedDuration(1);
  };

  const book = async () => {
    const chosenSlot = selectedSlotRef.current;
    const bookingContext = currentSlotContextRef.current;
    const currentRead = slotReadRef.current;
    const request = currentBookingRequest;
    const requestIdentity = bookingRequestIdentityRef.current;
    if (!resource || !chosenSlot || !request || !requestIdentity || durationOptions.length === 0
      || !availablePaymentModes.includes(selectedPaymentMode) || loading
      || !isSportsSlotSelectionCurrent(chosenSlot, bookingContext, currentRead?.context ?? null)) return;
    if (!(await requireSignIn(sportsVenueBookingReturnTo(venueId)))) return;
    if (!areSportsSlotContextIdentitiesEqual(currentSlotContextRef.current, bookingContext)
      || selectedSlotRef.current !== chosenSlot
      || bookingRequestIdentityRef.current !== requestIdentity
      || !isSportsSlotSelectionCurrent(chosenSlot, currentSlotContextRef.current, slotReadRef.current?.context ?? null)) return;
    setLoading(true);
    setError(null);
    try {
      const result = await bookSportsSlot({
        ...request,
        idempotencyKey: idempotencyKey.current.getFor(requestIdentity),
      });
      idempotencyKey.current.reset();
      const successMessage = result.status === 'accepted'
        ? 'Your slot is confirmed.'
        : result.status === 'pending_payment'
          ? 'Your slot is held. Complete payment before the deadline.'
          : result.status === 'awaiting_payment'
            ? 'The venue approved your request. Complete payment before the deadline.'
            : 'Request sent. The venue owner will respond shortly.';
      toast({
        message: successMessage,
        tone: 'success',
      });
      const nextRoute = canContinueSportsCheckout(result.status)
        ? `/sports-checkout/${result.booking_id}`
        : `/sports-booking/${result.booking_id}`;
      router.replace(nextRoute as Href);
    } catch (caught) {
      const message = (caught as Error).message;
      if (isSportsSlotTakenError(message)) {
        if (!areSportsSlotContextIdentitiesEqual(currentSlotContextRef.current, bookingContext)) return;
        await refresh();
        if (!areSportsSlotContextIdentitiesEqual(currentSlotContextRef.current, bookingContext)) return;
        selectedSlotRef.current = null;
        setSelectedSlot(null);
        setError('That slot was just booked. Pick another time.');
      } else if (areSportsSlotContextIdentitiesEqual(currentSlotContextRef.current, bookingContext)) {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen
      header={<Header
        title={venue?.name ?? 'Sports venue'}
        subtitle={venue ? `${venue.area}, ${venue.city}` : undefined}
        onBack={() => router.canGoBack() ? router.back() : router.replace('/sports' as Href)}
      />}
      footer={sportsEnabled && venue ? (
        <PriceFooter
          caption="Slot subtotal (estimate)"
          amountLabel={estimatedTotal === null ? '—' : formatINR(estimatedTotal)}
          cta={{
            title: getSportsBookingActionLabel(effectiveBookingMode, instantBookingEnabled),
            onPress: () => void book(),
            loading,
            disabled: !resource || !selectedStart || durationOptions.length === 0 || availablePaymentModes.length === 0 || loading,
            leftIcon: 'calendar-outline',
          }}
          above={selectedPaymentMode === 'online' ? (
            <View style={{ gap: t.spacing.xs }}>
              <Text variant="caption" color="muted">
                {getSportsOnlineCheckoutDisclosure(selectedPaymentMode)}
              </Text>
              {cancellationPolicyLabel ? (
                <Text variant="caption" color="muted">{cancellationPolicyLabel}</Text>
              ) : null}
            </View>
          ) : undefined}
        />
      ) : undefined}
    >
      {!sportsEnabled ? (
        <InlineAlert message="Sports & venues are turned off right now." />
      ) : error && !venue ? (
        <ErrorState message={error} onRetry={() => void refresh()} />
      ) : !venue ? (
        <Skeleton height={280} radius={t.radii.lg} />
      ) : (
        <>
          {familyUxEnabled ? (
            gallery.heroImage ? (
              <Image
                source={{ uri: gallery.heroImage }}
                contentFit="cover"
                accessibilityLabel={`${venue.name} photo`}
                style={{ width: '100%', height: 220, borderRadius: t.radii.lg }}
              />
            ) : null
          ) : gallery.legacyImages.length ? (
            <View style={{ gap: t.spacing.sm }}>
              {gallery.legacyImages.map((uri) => (
                <Image key={uri} source={{ uri }} contentFit="cover" style={{ height: 190, borderRadius: t.radii.lg }} />
              ))}
            </View>
          ) : null}
          <Card gap={t.spacing.sm}>
            <Text variant="title3">{venue.name}</Text>
            <Text variant="footnote" color="muted">{venue.address_line} · {venue.area}, {venue.city}</Text>
            {!familyUxEnabled && venue.description ? <Text variant="callout" color="textSecondary">{venue.description}</Text> : null}
            {!familyUxEnabled && venue.amenities?.length ? <Text variant="footnote">Amenities · {venue.amenities.join(' · ')}</Text> : null}
          </Card>

          <Card gap={t.spacing.md}>
            <Text variant="title3">Choose an activity and slot</Text>
            {venue.resources.length ? (
              <View style={{ gap: t.spacing.sm }}>
                {venue.resources.map((item) => {
                  const selected = item.id === resource?.id;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="radio"
                      accessibilityLabel={`${item.activity_name} · ${item.name}, ${item.slot_minutes}-minute slots`}
                      accessibilityState={{ checked: selected }}
                      onPress={() => chooseResource(item.id)}
                      style={{
                        padding: t.spacing.md,
                        borderRadius: t.radii.md,
                        borderWidth: selected ? 2 : 1,
                        borderColor: selected ? t.colors.primary : t.colors.border,
                        backgroundColor: selected ? t.colors.primarySoft : t.colors.surface,
                      }}
                    >
                      <Text variant="calloutStrong">{item.activity_name} · {item.name}</Text>
                      <Text variant="caption" color="muted">{item.slot_minutes}-minute slots</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <EmptyState icon="calendar-outline" title="No active courts" message="This venue is not taking requests right now." compact />
            )}
            {resource ? (
              <>
                <View style={{ gap: t.spacing.xs }}>
                  <Text variant="footnoteStrong">Choose a date</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
                    {dateOptions.map((option) => (
                      <Button
                        key={option.value}
                        title={option.label}
                        variant={date === option.value ? undefined : 'outline'}
                        size="sm"
                        onPress={() => chooseDate(option.value)}
                      />
                    ))}
                  </View>
                </View>
                {!slots ? (
                  <Skeleton height={88} radius={t.radii.md} />
                ) : slotCells.length === 0 ? (
                  <EmptyState icon="time-outline" title="No free slots" message="Choose another date or court." compact />
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                    {slotCells.map(({ slot, cell }) => {
                      const hasCapacity = slot.remaining == null || slot.remaining >= effectiveParticipants;
                      const selectable = cell.selectable && hasCapacity;
                      const selected = cell.selected && hasCapacity;
                      const unavailable = cell.unavailable || !hasCapacity;
                      return (
                        <Pressable
                          key={slot.starts_at}
                          accessibilityRole="radio"
                          accessibilityLabel={unavailable
                            ? `${formatSlot(slot.starts_at)}, ${translate('sports.slotUnavailable')}`
                            : formatSlot(slot.starts_at)}
                          accessibilityState={{ checked: selected, disabled: !selectable }}
                          disabled={!selectable}
                          onPress={() => {
                            if (!slotRead
                              || !areSportsSlotContextIdentitiesEqual(slotRead.context, currentSlotContext)) return;
                            idempotencyKey.current.reset();
                            const nextSelection = { startsAt: slot.starts_at, context: slotRead.context };
                            selectedSlotRef.current = nextSelection;
                            setSelectedSlot(nextSelection);
                            setSelectedDuration(1);
                          }}
                          style={{
                            minWidth: 112,
                            padding: t.spacing.sm,
                            borderRadius: t.radii.md,
                            borderWidth: selected ? 2 : 1,
                            borderColor: selected || selectable ? t.colors.primary : t.colors.border,
                            backgroundColor: selected ? t.colors.primary : unavailable ? t.colors.surfaceAlt : t.colors.surface,
                          }}
                        >
                          <Text variant="footnoteStrong" color={selected ? 'onPrimary' : 'text'}>{formatSlot(slot.starts_at)}</Text>
                          {unavailable ? (
                            <Text variant="caption" color="muted">{translate('sports.slotUnavailable')}</Text>
                          ) : slot.price_paise != null ? (
                            <Text variant="caption" color={selected ? 'onPrimary' : 'muted'}>{formatINR(slot.price_paise)} / slot</Text>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {multiSlotEnabled && selectedStart ? (
                  <View style={{ gap: t.spacing.sm }}>
                    <Text variant="footnoteStrong">Duration</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                      {durationOptions.map((count) => (
                        <Button
                          key={count}
                          title={formatSportsDuration(count, resource?.slot_minutes ?? 0)}
                          variant={duration === count ? undefined : 'outline'}
                          size="sm"
                          onPress={() => {
                            idempotencyKey.current.reset();
                            setSelectedDuration(count);
                          }}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
                {canChooseParticipants ? (
                  <View style={{ gap: t.spacing.sm }}>
                    <Text variant="footnoteStrong">Participants</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                      <Button title="−" variant="outline" size="sm" disabled={participants <= 1} onPress={() => {
                        idempotencyKey.current.reset();
                        invalidateSlotContext();
                        setParticipants((value) => Math.max(1, value - 1));
                      }} />
                      <Text variant="calloutStrong">{participants}</Text>
                      <Button title="+" variant="outline" size="sm" disabled={participants >= capacity} onPress={() => {
                        idempotencyKey.current.reset();
                        invalidateSlotContext();
                        setParticipants((value) => Math.min(capacity, value + 1));
                      }} />
                      <Text variant="caption" color="muted">Up to {capacity}</Text>
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}
            {availablePaymentModes.length > 1 ? (
              <View style={{ gap: t.spacing.sm }}>
                <Text variant="footnoteStrong">Payment</Text>
                <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                  {availablePaymentModes.map((mode) => (
                    <Button
                      key={mode}
                      title={mode === 'online' ? 'Pay online' : 'Pay at venue'}
                      variant={selectedPaymentMode === mode ? undefined : 'outline'}
                      size="sm"
                      onPress={() => {
                        idempotencyKey.current.reset();
                        setPaymentMode(mode);
                      }}
                    />
                  ))}
                </View>
              </View>
            ) : availablePaymentModes.length === 1 ? (
              <Text variant="footnote" color="muted">
                {availablePaymentModes[0] === 'online' ? 'Pay online' : 'Pay at the venue'}
              </Text>
            ) : (
              <InlineAlert message="This venue is not accepting bookings right now." />
            )}
            <TextArea label="Note (optional)" value={note} onChangeText={(value) => {
              idempotencyKey.current.reset();
              setNote(value);
            }} maxLength={500} placeholder="Anything the venue should know?" />
            <InlineAlert message={error && venue ? error : null} />
          </Card>
          {familyUxEnabled ? (
            <View style={{ gap: t.spacing.sm }}>
              {gallery.expandable ? (
                <Button
                  title={photosExpanded ? 'Hide additional photos' : `View ${gallery.additionalImages.length} more photos`}
                  variant="outline"
                  onPress={() => setPhotosExpanded((expanded) => !expanded)}
                />
              ) : null}
              {photosExpanded ? (
                <ScrollView horizontal accessibilityLabel={`${venue.name} additional photos`}>
                  <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                    {gallery.additionalImages.map((uri) => (
                      <Image
                        key={uri}
                        source={{ uri }}
                        contentFit="cover"
                        accessibilityLabel={`${venue.name} photo`}
                        style={{ width: 220, height: 160, borderRadius: t.radii.lg }}
                      />
                    ))}
                  </View>
                </ScrollView>
              ) : null}
              {venue.description ? <Text variant="callout" color="textSecondary">{venue.description}</Text> : null}
              {venue.amenities?.length ? <Text variant="footnote">Amenities · {venue.amenities.join(' · ')}</Text> : null}
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

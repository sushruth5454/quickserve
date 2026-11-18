import { Image } from 'expo-image';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, TextArea, useToast } from '../../components/ui';
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
  getSportsBookingActionLabel,
  isSportsSlotTakenError,
} from './model';

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

export function SportsVenueBookingScreen({ venueId }: { venueId: string }) {
  const t = useTheme();
  const toast = useToast();
  const flags = useAppFeatureFlags();
  const sportsEnabled = flags.isOn('sports');
  const onlinePaymentsEnabled = flags.isOn('sports_online_payments');
  const instantBookingEnabled = flags.isOn('sports_instant_booking');
  const capacitySlotsEnabled = flags.isOn('sports_capacity_slots');
  const multiSlotEnabled = flags.isOn('sports_multi_slot');
  const [venue, setVenue] = useState<CustomerSportsVenue | null>(null);
  const [resourceId, setResourceId] = useState('');
  const [date, setDate] = useState(() => indiaDate(1));
  const [slots, setSlots] = useState<SportsSlotAvailability[] | null>(null);
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [participants, setParticipants] = useState(1);
  const [paymentMode, setPaymentMode] = useState<SportsPaymentMode>('pay_at_venue');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  const resource = useMemo(
    () => venue?.resources.find((item) => item.id === resourceId) ?? venue?.resources[0],
    [resourceId, venue],
  );
  const capacity = capacitySlotsEnabled ? Math.min(50, Math.max(1, resource?.capacity ?? 1)) : 1;
  const canChooseParticipants = capacitySlotsEnabled && capacity > 1;
  const effectiveParticipants = canChooseParticipants ? Math.min(participants, capacity) : 1;
  const availablePaymentModes = getAvailableSportsPaymentModes(venue?.payment_modes, {
    sportsEnabled,
    onlinePaymentsEnabled,
    payoutAccountVerified: venue?.online_payment_ready === true,
  });
  const selectedPaymentMode = availablePaymentModes.includes(paymentMode)
    ? paymentMode
    : availablePaymentModes[0] ?? 'pay_at_venue';
  const durationOptions = selectedStart
    ? getAvailableSportsDurations(slots ?? [], selectedStart, effectiveParticipants, multiSlotEnabled ? 4 : 1)
    : [];
  const duration = durationOptions.includes(selectedDuration) ? selectedDuration : durationOptions[0] ?? 1;
  const effectiveBookingMode = resource?.booking_mode === 'instant' && instantBookingEnabled ? 'instant' : 'approval';

  const loadVenue = useCallback(async () => {
    if (!sportsEnabled || !venueId) return;
    try {
      const next = await getCustomerSportsVenue(venueId);
      if (!next) {
        setVenue(null);
        setError('This venue is not available.');
        return;
      }
      setVenue(next);
      setResourceId((current) => next.resources.some((item) => item.id === current) ? current : next.resources[0]?.id ?? '');
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [sportsEnabled, venueId]);

  const loadSlots = useCallback(async () => {
    if (!sportsEnabled || !resource?.id || !date) return;
    try {
      const next = await getSportsSlots(resource.id, date);
      setSlots(next);
      setSelectedStart((current) => current && getAvailableSportsDurations(
        next,
        current,
        effectiveParticipants,
        multiSlotEnabled ? 4 : 1,
      ).length > 0 ? current : null);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [date, effectiveParticipants, multiSlotEnabled, resource?.id, sportsEnabled]);

  useFocusEffect(useCallback(() => {
    if (!sportsEnabled) return;
    void loadVenue();
  }, [loadVenue, sportsEnabled]));

  useFocusEffect(useCallback(() => {
    if (!sportsEnabled) return;
    void loadSlots();
    const refresh = setInterval(() => void loadSlots(), 30_000);
    return () => clearInterval(refresh);
  }, [loadSlots, sportsEnabled]));

  const chooseResource = (nextResourceId: string) => {
    idempotencyKey.current = null;
    setResourceId(nextResourceId);
    setSelectedStart(null);
    setSelectedDuration(1);
    setParticipants(1);
    setSlots(null);
  };

  const chooseDate = (nextDate: string) => {
    idempotencyKey.current = null;
    setDate(nextDate);
    setSelectedStart(null);
    setSelectedDuration(1);
    setSlots(null);
  };

  const book = async () => {
    if (!resource || !selectedStart || durationOptions.length === 0 || !availablePaymentModes.includes(selectedPaymentMode) || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await bookSportsSlot({
        resourceId: resource.id,
        startsAt: selectedStart,
        slots: duration,
        participants: effectiveParticipants,
        paymentMode: selectedPaymentMode,
        note: note.trim(),
        idempotencyKey: idempotencyKey.current ?? (idempotencyKey.current = makeIdempotencyKey()),
      });
      idempotencyKey.current = null;
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
        await loadSlots();
        setSelectedStart(null);
        setError('That slot was just booked. Pick another time.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const selectableSlot = (slot: SportsSlotAvailability) =>
    slot.state === 'free' && (slot.remaining == null || slot.remaining >= effectiveParticipants);

  return (
    <Screen header={<Header
      title={venue?.name ?? 'Sports venue'}
      subtitle={venue ? `${venue.area}, ${venue.city}` : undefined}
      onBack={() => router.canGoBack() ? router.back() : router.replace('/sports' as Href)}
    />}>
      {!sportsEnabled ? (
        <InlineAlert message="Sports & venues are turned off right now." />
      ) : error && !venue ? (
        <ErrorState message={error} onRetry={() => void loadVenue()} />
      ) : !venue ? (
        <Skeleton height={280} radius={t.radii.lg} />
      ) : (
        <>
          {venue.photos?.length ? (
            <View style={{ gap: t.spacing.sm }}>
              {venue.photos.map((uri) => (
                <Image key={uri} source={{ uri }} contentFit="cover" style={{ height: 190, borderRadius: t.radii.lg }} />
              ))}
            </View>
          ) : null}
          <Card gap={t.spacing.sm}>
            <Text variant="title3">{venue.name}</Text>
            <Text variant="footnote" color="muted">{venue.address_line} · {venue.area}, {venue.city}</Text>
            {venue.description ? <Text variant="callout" color="textSecondary">{venue.description}</Text> : null}
            {venue.amenities?.length ? <Text variant="footnote">Amenities · {venue.amenities.join(' · ')}</Text> : null}
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
                <Input
                  label="Date"
                  value={date}
                  onChangeText={(value) => chooseDate(value.trim())}
                  placeholder="YYYY-MM-DD"
                  autoCapitalize="none"
                  helper="Choose a date within the next 30 days."
                />
                <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                  <Button title="Today" variant="outline" size="sm" onPress={() => chooseDate(indiaDate())} />
                  <Button title="Tomorrow" variant="outline" size="sm" onPress={() => chooseDate(indiaDate(1))} />
                  <Button title="Next day" variant="outline" size="sm" onPress={() => chooseDate(indiaDate(2))} />
                </View>
                {!slots ? (
                  <Skeleton height={88} radius={t.radii.md} />
                ) : slots.filter(selectableSlot).length === 0 ? (
                  <EmptyState icon="time-outline" title="No free slots" message="Choose another date or court." compact />
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                    {slots.filter(selectableSlot).map((slot) => {
                      const selected = slot.starts_at === selectedStart;
                      return (
                        <Pressable
                          key={slot.starts_at}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          onPress={() => {
                            idempotencyKey.current = null;
                            setSelectedStart(slot.starts_at);
                            setSelectedDuration(1);
                          }}
                          style={{
                            minWidth: 112,
                            padding: t.spacing.sm,
                            borderRadius: t.radii.md,
                            borderWidth: selected ? 2 : 1,
                            borderColor: selected ? t.colors.primary : t.colors.border,
                            backgroundColor: selected ? t.colors.primarySoft : t.colors.surface,
                          }}
                        >
                          <Text variant="footnoteStrong">{formatSlot(slot.starts_at)}</Text>
                          {slot.price_paise != null ? <Text variant="caption" color="muted">{formatINR(slot.price_paise)} / slot</Text> : null}
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
                          title={`${count} ${count === 1 ? 'slot' : 'slots'}`}
                          variant={duration === count ? undefined : 'outline'}
                          size="sm"
                          onPress={() => {
                            idempotencyKey.current = null;
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
                        idempotencyKey.current = null;
                        setParticipants((value) => Math.max(1, value - 1));
                      }} />
                      <Text variant="calloutStrong">{participants}</Text>
                      <Button title="+" variant="outline" size="sm" disabled={participants >= capacity} onPress={() => {
                        idempotencyKey.current = null;
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
                        idempotencyKey.current = null;
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
              idempotencyKey.current = null;
              setNote(value);
            }} maxLength={500} placeholder="Anything the venue should know?" />
            <InlineAlert message={error && venue ? error : null} />
            <Button
              title={getSportsBookingActionLabel(effectiveBookingMode, instantBookingEnabled)}
              onPress={() => void book()}
              loading={loading}
              disabled={!resource || !selectedStart || durationOptions.length === 0 || availablePaymentModes.length === 0 || loading}
              fullWidth
              leftIcon="calendar-outline"
            />
          </Card>
        </>
      )}
    </Screen>
  );
}

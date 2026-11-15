import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AddressEditorSheet, addressIcon } from '../../src/components/AddressEditor';
import { skillLabel } from '../../src/components/ProviderCard';
import { Avatar, Button, Card, Chip, Divider, ErrorState, Header, InlineAlert, PriceRow, Screen, Skeleton, Text, TextArea, useToast } from '../../src/components/ui';
import {
  createBooking,
  createTravelRequest,
  getProviderService,
  inspectTravelRequest,
  listMyAddresses,
  uploadJobPhoto,
  type ProviderServiceWithProvider,
} from '../../src/lib/api';
import { track } from '../../src/lib/analytics';
import { DESCRIPTION_MAX, readBookPrefill, selectedChips, toggleChip } from '../../src/lib/assistant/prefill';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { fromSavedAddress } from '../../src/lib/locationModel';
import { formatINR, PLATFORM_FEE_PAISE } from '../../src/lib/money';
import { usePayment } from '../../src/lib/payments';
import { typicalRange } from '../../src/lib/pricing';
import { dayLabel, firstAvailableDay, nextDays, WINDOW_START_HOURS, windowAvailable, windowLabel, windowStart } from '../../src/lib/schedule';
import { useTheme } from '../../src/theme';
import { onboardingApi, type ProviderSchedule } from '../../src/lib/onboarding';
import { asapAvailable, windowFits } from '../../src/lib/onboarding/availability';
import type { TravelPreview } from '../../src/lib/types';
import { PackageBookingScreen } from '../../src/features/booking/packages/PackageBookingScreen';

export default function BookScreen() {
  const t = useTheme();
  const toast = useToast();
  const pay = usePayment();
  const { providerServiceId, packageId, archetype, ...prefillParams } = useLocalSearchParams<{
    providerServiceId: string;
    packageId?: string;
    archetype?: 'fixed' | 'time_based';
    from?: string;
    description?: string;
    slot?: string;
    addressId?: string;
  }>();
  const { location, setLocation } = useSelectedLocation();
  const [service, setService] = useState<ProviderServiceWithProvider | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => nextDays(now, 7), [now]);
  // Draft hand-off from QuickServe AI (src/lib/assistant/prefill.ts); read once so the user's edits stick.
  const [prefill] = useState(() => readBookPrefill(prefillParams, days, now));
  const [description, setDescription] = useState(prefill.description ?? '');
  const [photos, setPhotos] = useState<{ uri: string; mimeType: string }[]>([]);
  const [mode, setMode] = useState<'asap' | 'schedule'>(prefill.mode ?? 'asap');
  const [dayIndex, setDayIndex] = useState(() => prefill.dayIndex ?? firstAvailableDay(days, now));
  const [hour, setHour] = useState<number | null>(prefill.hour);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Provider working hours / time off / full days (migration 0009). null = unknown or unrestricted.
  const [sched, setSched] = useState<ProviderSchedule | null>(null);
  const [travel, setTravel] = useState<TravelPreview | null>(null);
  const [travelChecking, setTravelChecking] = useState(false);

  const load = () => {
    if (!providerServiceId) return;
    setLoadError(null);
    getProviderService(providerServiceId)
      .then((s) => {
        setService(s);
        onboardingApi
          .getProviderSchedule(s.provider_id)
          .then(setSched)
          .catch(() => setSched(null));
      })
      .catch((e: Error) => setLoadError(e.message));
  };
  useEffect(load, [providerServiceId]);

  // The draft used a saved address that is not the current selection (e.g. changed since): switch to it.
  useEffect(() => {
    const id = prefill.addressId;
    if (!id || location.addressId === id) return;
    listMyAddresses()
      .then((list) => {
        const a = list.find((x) => x.id === id);
        if (a) setLocation(fromSavedAddress(a));
      })
      .catch(() => undefined);
    // Only on arrival from the assistant.
  }, []);

  const day = days[dayIndex] ?? days[0]!;
  // A window is offered only if it meets the lead time AND lies inside the provider's hours (create_booking re-checks).
  const slotOk = (date: Date, h: number) => windowAvailable(date, h, new Date()) && windowFits(sched, windowStart(date, h));
  const dayOk = (date: Date) => WINDOW_START_HOURS.some((h) => slotOk(date, h));
  const asapOk = asapAvailable(sched, new Date());
  // Drop a picked window that is no longer available on the newly selected day.
  useEffect(() => {
    if (hour != null && !slotOk(day.date, hour)) setHour(null);
  }, [day, hour, sched]);
  // Once the schedule loads: move off ASAP / an unavailable day.
  useEffect(() => {
    if (!sched) return;
    if (!asapAvailable(sched, new Date())) setMode('schedule');
    if (!dayOk(day.date)) {
      const i = days.findIndex((d) => dayOk(d.date));
      if (i >= 0) setDayIndex(i);
    }
  }, [sched]);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    const asset = res.canceled ? null : res.assets[0];
    if (asset) setPhotos((p) => [...p, { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' }].slice(0, 4));
  };

  // Chips live on the first line, so an AI job brief below it is never rewritten (src/lib/assistant/prefill.ts).
  const selectedIssues = selectedChips(description);
  const toggleIssue = (q: string) => setDescription((d) => toggleChip(d, q));

  const hasAddress = !!location.addressId && !!location.line1;
  const scheduledAt = mode === 'asap' ? null : hour != null ? windowStart(day.date, hour) : undefined;
  useEffect(() => {
    if (!service || !hasAddress || scheduledAt === undefined) {
      setTravel(null);
      return;
    }
    let cancelled = false;
    const check = () => {
      setTravelChecking(true);
      inspectTravelRequest(
        service.id,
        { lat: location.lat, lng: location.lng },
        scheduledAt,
      )
        .then((next) => {
          if (cancelled) return;
          setTravel(next);
          if (next.needs_approval && mode === 'asap') setMode('schedule');
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setTravelChecking(false));
    };
    check();
    const timer = setInterval(check, travel?.status === 'pending' ? 10000 : 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [service?.id, hasAddress, location.lat, location.lng, scheduledAt?.getTime(), mode, travel?.status]);

  const travelApproved =
    !!travel &&
    !travel.needs_approval ||
    (!!travel?.needs_approval &&
      travel.status === 'approved' &&
      !!travel.travel_request_id &&
      !!travel.expires_at &&
      new Date(travel.expires_at).getTime() > Date.now());
  const travelPending = !!travel?.needs_approval && travel.status === 'pending';
  const blocker = !description.trim()
    ? 'Describe the issue to continue'
    : !hasAddress
      ? 'Add your full address to continue'
      : scheduledAt === undefined
        ? 'Pick a time slot to continue'
        : travel?.needs_approval && mode === 'asap'
          ? 'Pick a future time for a travel request'
          : travel?.allowed === false
            ? 'This provider does not travel this far'
        : null;

  const submit = async () => {
    if (!service || blocker || !location.line1 || scheduledAt === undefined) return;
    setBusy(true);
    setError(null);
    try {
      if (travel?.needs_approval && !travelApproved && scheduledAt) {
        const requestId = await createTravelRequest(service.id, scheduledAt, {
          lat: location.lat,
          lng: location.lng,
        }, description.trim());
        const next = await inspectTravelRequest(
          service.id,
          { lat: location.lat, lng: location.lng },
          scheduledAt,
        );
        setTravel({ ...next, travel_request_id: next.travel_request_id ?? requestId, status: next.status ?? 'pending' });
        toast({ message: 'Travel request sent. We’ll notify you when the provider replies.', tone: 'success' });
        return;
      }
      const paths = await Promise.all(photos.map((p) => uploadJobPhoto(p.uri, p.mimeType)));
      const bookingId = await createBooking({
        providerServiceId: service.id,
        description: description.trim(),
        addressLine: location.line1,
        city: location.city,
        coords: { lat: location.lat, lng: location.lng },
        scheduledAt,
        photos: paths,
        travelRequestId: travelApproved ? travel?.travel_request_id ?? null : null,
      });
      if (prefill.fromAssistant) track('draft_to_booking_conversion', { category: service.categories?.slug ?? null, edited: description.trim() !== (prefill.description ?? '').trim() });
      const result = await pay(bookingId).catch((e: Error) => {
        toast({ message: e.message, tone: 'error' });
        return 'cancelled' as const;
      });
      if (result === 'paid') toast({ message: 'Booked! The provider has been notified.', tone: 'success' });
      else if (result === 'cancelled') toast({ message: 'Booking saved — pay the visit fee to send it.', tone: 'warning' });
      router.replace({ pathname: '/booking/[id]', params: { id: bookingId } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!service) {
    return (
      <Screen header={<Header title="Book" />}>
        {loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : (
          <>
            <Skeleton height={72} radius={t.radii.lg} />
            <Skeleton height={180} radius={t.radii.lg} />
            <Skeleton height={140} radius={t.radii.lg} />
          </>
        )}
      </Screen>
    );
  }

  const providerName = service.providers?.profiles?.full_name ?? 'Provider';
  if (packageId && (archetype === 'fixed' || archetype === 'time_based')) {
    return <PackageBookingScreen packageId={packageId} archetype={archetype} />;
  }
  const firstName = providerName.split(' ')[0] ?? providerName;
  const slug = service.categories?.slug;
  const range = typicalRange(slug);
  const rating = Number(service.providers?.rating_avg ?? 0);
  const ratingCount = service.providers?.rating_count ?? 0;
  const issues: string[] = [];
  const travelAction = travel?.needs_approval
    ? travelPending
      ? 'Waiting for provider'
      : travelApproved
        ? `Pay ${formatINR(service.visit_fee)} & book`
        : `Request availability${travel.quoted_fee ? ` (+${formatINR(travel.quoted_fee)})` : ''}`
    : `Pay ${formatINR(service.visit_fee)} & book`;

  return (
    <>
      <Screen
        header={<Header title={`Book ${service.categories?.name ?? 'service'}`} />}
        gap={t.spacing.section}
        footer={
          <View style={{ gap: t.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
              <View>
                <Text variant="caption" color="muted">
                  To pay now
                </Text>
                <Text variant="title2" tabular>
                  {formatINR(service.visit_fee)}
                </Text>
              </View>
              <Button
                title={travelChecking ? 'Checking travel…' : travelAction}
                onPress={() => void submit()}
                loading={busy || travelChecking}
                disabled={!!blocker || travelPending}
                size="lg"
                leftIcon="lock-closed"
                style={{ flex: 1 }}
                accessibilityHint={blocker ?? undefined}
              />
            </View>
            <Text variant="caption" color={blocker ? 'warningText' : 'muted'} align="center">
              {blocker ?? `Free cancellation until ${firstName} accepts · full refund if no one does`}
            </Text>
          </View>
        }
      >
        {/* Service summary */}
        {prefill.fromAssistant ? (
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, padding: t.spacing.md, borderRadius: t.radii.md, backgroundColor: t.colors.primarySoft }}
          >
            <Ionicons name="sparkles" size={16} color={t.colors.primaryText} />
            <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
              Pre-filled by QuickServe AI. Check the details, then pay the visit fee to send the request.
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <Avatar name={providerName} size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text variant="calloutStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                {providerName}
              </Text>
              <Ionicons name="checkmark-circle" size={16} color={t.colors.primary} accessibilityLabel="Verified" />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {ratingCount > 0 ? (
                <>
                  <Ionicons name="star" size={13} color={t.colors.star} />
                  <Text variant="footnoteStrong" tabular>
                    {rating.toFixed(1)}
                  </Text>
                  <Text variant="footnote" color="muted">
                    ({ratingCount}) ·
                  </Text>
                </>
              ) : null}
              <Text variant="footnote" color="muted" numberOfLines={1}>
                {service.categories?.name} · {skillLabel[service.skill_level]}
              </Text>
            </View>
          </View>
        </View>

        {/* Issue */}
        <Block title="Describe the issue" hint="Pick what applies or write it in your words">
          {issues.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
              {issues.map((q) => (
                <Chip key={q} label={q} selected={selectedIssues.has(q.toLowerCase())} onPress={() => toggleIssue(q)} />
              ))}
            </View>
          ) : null}
          <TextArea
            placeholder="e.g. Split AC not cooling and making a rattling noise"
            value={description}
            onChangeText={setDescription}
            maxLength={DESCRIPTION_MAX}
            counter={`${description.length}/${DESCRIPTION_MAX}`}
            accessibilityLabel="Describe the problem"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -t.spacing.lg }}
            contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}
          >
            {photos.length < 4 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add photo, ${photos.length} of 4 added`}
                onPress={() => void pickPhoto()}
                style={({ pressed }) => ({
                  width: 72,
                  height: 72,
                  borderRadius: t.radii.md,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: t.colors.outline,
                  backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                })}
              >
                <Ionicons name="camera-outline" size={20} color={t.colors.textSecondary} />
                <Text variant="caption" color="textSecondary">
                  {photos.length ? `${photos.length}/4` : 'Photo'}
                </Text>
              </Pressable>
            ) : null}
            {photos.map((p) => (
              <View key={p.uri}>
                <Image source={{ uri: p.uri }} style={{ width: 72, height: 72, borderRadius: t.radii.md }} contentFit="cover" accessibilityLabel="Problem photo" />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  onPress={() => setPhotos((ps) => ps.filter((x) => x.uri !== p.uri))}
                  hitSlop={10}
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: 'rgba(16,24,40,0.7)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="close" size={14} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </Block>

        {/* When */}
        <Block title="When">
          {travel?.needs_approval ? (
            <InlineAlert
              tone={travelPending ? 'info' : travelApproved ? 'success' : 'warning'}
              title={`${Number(travel.distance_km ?? 0).toFixed(1)} km away`}
              message={
                travelPending
                  ? `Request sent with a ${formatINR(travel.quoted_fee)} travel fee. Approval is valid until ${new Date(travel.expires_at ?? '').toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}.`
                  : travelApproved
                    ? `Travel approved. The ${formatINR(travel.quoted_fee)} fee will appear on your first quote.`
                    : `This pro travels here by approval. The ${formatINR(travel.quoted_fee)} fee is added to the first quote.`
              }
            />
          ) : null}
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <ModeCard
              icon="flash-outline"
              title="As soon as possible"
              subtitle={asapOk ? 'Pros accept in ~15 min' : 'Not available right now'}
              selected={mode === 'asap'}
              disabled={!asapOk}
              onPress={() => setMode('asap')}
            />
            <ModeCard icon="calendar-outline" title="Schedule" subtitle="Pick a day & time" selected={mode === 'schedule'} onPress={() => setMode('schedule')} />
          </View>
          {mode === 'schedule' ? (
            <View style={{ gap: t.spacing.md }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -t.spacing.lg }}
                contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}
              >
                {days.map((d, i) => {
                  const any = dayOk(d.date);
                  const sel = i === dayIndex;
                  return (
                    <Pressable
                      key={d.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: sel, disabled: !any }}
                      accessibilityLabel={`${d.label}, ${dayLabel(d.date)}${any ? '' : ', no slots left'}`}
                      disabled={!any}
                      onPress={() => setDayIndex(i)}
                      style={{
                        width: 76,
                        paddingVertical: t.spacing.sm,
                        borderRadius: t.radii.md,
                        borderWidth: sel ? 1.5 : 1,
                        borderColor: sel ? t.colors.primary : t.colors.border,
                        backgroundColor: sel ? t.colors.primarySoft : t.colors.surface,
                        alignItems: 'center',
                        gap: 2,
                        opacity: any ? 1 : 0.45,
                      }}
                    >
                      <Text variant="caption" color={sel ? 'primaryText' : 'muted'} numberOfLines={1}>
                        {d.label}
                      </Text>
                      <Text variant="title3" color={sel ? 'primaryText' : 'text'} tabular>
                        {d.dayOfMonth}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                {WINDOW_START_HOURS.map((h) => {
                  const ok = slotOk(day.date, h);
                  const sel = hour === h;
                  return (
                    <Pressable
                      key={h}
                      accessibilityRole="button"
                      accessibilityState={{ selected: sel, disabled: !ok }}
                      accessibilityLabel={`${windowLabel(h)}${ok ? '' : ', unavailable'}`}
                      disabled={!ok}
                      onPress={() => setHour(h)}
                      style={{
                        width: '31.5%',
                        height: 44,
                        borderRadius: t.radii.md,
                        borderWidth: sel ? 1.5 : 1,
                        borderColor: sel ? t.colors.primary : t.colors.border,
                        backgroundColor: sel ? t.colors.primarySoft : ok ? t.colors.surface : t.colors.surfaceAlt,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text variant="subheadStrong" color={sel ? 'primaryText' : ok ? 'text' : 'muted'} style={ok ? undefined : { textDecorationLine: 'line-through' }}>
                        {windowLabel(h)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {hour != null ? (
                <Text variant="footnote" color="textSecondary">
                  {firstName} arrives {dayLabel(day.date)}, between {windowLabel(hour)}.
                </Text>
              ) : null}
            </View>
          ) : null}
        </Block>

        {/* Address */}
        <Block title="Address">
          <Card padding={t.spacing.md} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
            <View
              style={{ width: 40, height: 40, borderRadius: t.radii.md, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name={addressIcon(location.label)} size={20} color={t.colors.textSecondary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="calloutStrong">{location.label ?? location.area}</Text>
              <Text variant="footnote" color="textSecondary">
                {location.line1 ? `${location.line1}, ${location.city}` : `${location.area}, ${location.city} · house / flat no. needed`}
              </Text>
            </View>
            <Button title="Change" variant="ghost" size="sm" onPress={() => router.push('/location')} />
          </Card>
          {!hasAddress ? (
            <Button
              title="Add house / flat number"
              variant="outline"
              leftIcon="add"
              onPress={() => setEditorOpen(true)}
              fullWidth
            />
          ) : null}
        </Block>

        {/* Price */}
        <Block title="Price details">
          <Card gap={t.spacing.md}>
            <PriceRow label="Visit / inspection fee" amount={service.visit_fee} hint="Adjusted in your final bill" />
            <PriceRow
              label="Platform fee"
              amount={PLATFORM_FEE_PAISE}
              hint="Added to the final bill — not charged now"
              emphasis="muted"
            />
            <Divider />
            <PriceRow label="To pay now" amount={service.visit_fee} emphasis="total" />
            {range ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                <Ionicons name="analytics-outline" size={16} color={t.colors.muted} />
                <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
                  Typical total for {service.categories?.name ?? 'this job'}: {formatINR(range[0] * 100)}–{formatINR(range[1] * 100)}. {firstName} sends an
                  itemised quote after inspecting — nothing more is charged until you approve it.
                </Text>
              </View>
            ) : null}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.sm,
                paddingTop: t.spacing.md,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: t.colors.border,
              }}
            >
              <Ionicons name="shield-checkmark" size={16} color={t.colors.successText} />
              <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
                Payment held by QuickServe until the job is done.
              </Text>
            </View>
          </Card>
        </Block>
        <InlineAlert message={error} />
      </Screen>

      <AddressEditorSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        pin={location}
        title="Complete your address"
        onSaved={(a) => {
          setEditorOpen(false);
          setLocation(fromSavedAddress(a));
          toast({ message: 'Address saved', tone: 'success' });
        }}
      />
    </>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.md }}>
      <View style={{ gap: 2 }}>
        <Text variant="title3" accessibilityRole="header">
          {title}
        </Text>
        {hint ? (
          <Text variant="footnote" color="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function ModeCard(props: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: !!props.disabled }}
      accessibilityLabel={`${props.title}. ${props.subtitle}`}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        flex: 1,
        padding: t.spacing.md,
        borderRadius: t.radii.md,
        borderWidth: props.selected ? 1.5 : 1,
        borderColor: props.selected ? t.colors.primary : t.colors.border,
        backgroundColor: props.selected ? t.colors.primarySoft : pressed ? t.colors.surfaceAlt : t.colors.surface,
        gap: 4,
        opacity: props.disabled ? 0.45 : 1,
      })}
    >
      <Ionicons name={props.icon} size={20} color={props.selected ? t.colors.primaryText : t.colors.textSecondary} />
      <Text variant="subheadStrong" color={props.selected ? 'primaryText' : 'text'}>
        {props.title}
      </Text>
      <Text variant="caption" color="muted">
        {props.subtitle}
      </Text>
    </Pressable>
  );
}

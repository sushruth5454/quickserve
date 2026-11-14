import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AddressEditorSheet, addressIcon } from '../../src/components/AddressEditor';
import { skillLabel } from '../../src/components/ProviderCard';
import { Avatar, Button, Card, Chip, Divider, ErrorState, Header, InlineAlert, PriceRow, Screen, Skeleton, Text, TextArea, useToast } from '../../src/components/ui';
import { createBooking, getProviderService, uploadJobPhoto, type ProviderServiceWithProvider } from '../../src/lib/api';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { fromSavedAddress } from '../../src/lib/locationModel';
import { formatINR, PLATFORM_FEE_PAISE } from '../../src/lib/money';
import { usePayment } from '../../src/lib/payments';
import { typicalRange } from '../../src/lib/pricing';
import { dayLabel, firstAvailableDay, nextDays, WINDOW_START_HOURS, windowAvailable, windowLabel, windowStart } from '../../src/lib/schedule';
import { useTheme } from '../../src/theme';

const DESCRIPTION_MAX = 500;

const QUICK_ISSUES: Record<string, string[]> = {
  'ac-repair': ['Not cooling', 'Water leaking', 'Making noise', 'Bad smell', 'Gas refill', 'Service due'],
  electrician: ['MCB tripping', 'Fan not working', 'Switch sparking', 'New fitting', 'Wiring issue'],
  plumber: ['Tap leaking', 'Blocked drain', 'Low water pressure', 'Flush not working', 'Pipe burst'],
  'house-cleaning': ['Full home deep clean', 'Kitchen', 'Bathrooms', 'Sofa / carpet'],
  'water-tank-cleaning': ['Overhead tank', 'Sump', 'Bad smell in water'],
  'car-mechanic': ['Not starting', 'Battery', 'Brakes', 'General service'],
  'bike-mechanic': ['Not starting', 'Puncture', 'Brakes', 'General service'],
  'appliance-repair': ['Washing machine', 'Refrigerator', 'Microwave', 'Not powering on'],
  'pest-control': ['Cockroaches', 'Termites', 'Bed bugs', 'Mosquitoes'],
  carpenter: ['Door alignment', 'Hinges / locks', 'Furniture repair', 'New fitting'],
  painter: ['Full home', 'One room', 'Touch-ups', 'Waterproofing'],
};

const parts = (text: string) =>
  text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

export default function BookScreen() {
  const t = useTheme();
  const toast = useToast();
  const pay = usePayment();
  const { providerServiceId } = useLocalSearchParams<{ providerServiceId: string }>();
  const { location, setLocation } = useSelectedLocation();
  const [service, setService] = useState<ProviderServiceWithProvider | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; mimeType: string }[]>([]);
  const [mode, setMode] = useState<'asap' | 'schedule'>('asap');
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => nextDays(now, 7), [now]);
  const [dayIndex, setDayIndex] = useState(() => firstAvailableDay(days, now));
  const [hour, setHour] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!providerServiceId) return;
    setLoadError(null);
    getProviderService(providerServiceId)
      .then(setService)
      .catch((e: Error) => setLoadError(e.message));
  };
  useEffect(load, [providerServiceId]);

  const day = days[dayIndex] ?? days[0]!;
  // Drop a picked window that is no longer available on the newly selected day.
  useEffect(() => {
    if (hour != null && !windowAvailable(day.date, hour, new Date())) setHour(null);
  }, [day, hour]);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    const asset = res.canceled ? null : res.assets[0];
    if (asset) setPhotos((p) => [...p, { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' }].slice(0, 4));
  };

  const selectedIssues = new Set(parts(description).map((p) => p.toLowerCase()));
  const toggleIssue = (q: string) =>
    setDescription((d) => {
      const list = parts(d);
      const on = list.some((p) => p.toLowerCase() === q.toLowerCase());
      const next = on ? list.filter((p) => p.toLowerCase() !== q.toLowerCase()) : [...list, q];
      return next.join(', ').slice(0, DESCRIPTION_MAX);
    });

  const hasAddress = !!location.addressId && !!location.line1;
  const scheduledAt = mode === 'asap' ? null : hour != null ? windowStart(day.date, hour) : undefined;
  const blocker = !description.trim()
    ? 'Describe the issue to continue'
    : !hasAddress
      ? 'Add your full address to continue'
      : scheduledAt === undefined
        ? 'Pick a time slot to continue'
        : null;

  const submit = async () => {
    if (!service || blocker || !location.line1 || scheduledAt === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const paths = await Promise.all(photos.map((p) => uploadJobPhoto(p.uri, p.mimeType)));
      const bookingId = await createBooking({
        providerServiceId: service.id,
        description: description.trim(),
        addressLine: location.line1,
        city: location.city,
        coords: { lat: location.lat, lng: location.lng },
        scheduledAt,
        photos: paths,
      });
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
  const firstName = providerName.split(' ')[0] ?? providerName;
  const slug = service.categories?.slug;
  const range = typicalRange(slug);
  const rating = Number(service.providers?.rating_avg ?? 0);
  const ratingCount = service.providers?.rating_count ?? 0;
  const issues = QUICK_ISSUES[slug ?? ''] ?? [];

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
                title={`Pay ${formatINR(service.visit_fee)} & book`}
                onPress={() => void submit()}
                loading={busy}
                disabled={!!blocker}
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
                    ({ratingCount}) ·{' '}
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
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <ModeCard
              icon="flash-outline"
              title="As soon as possible"
              subtitle="Pros accept in ~15 min"
              selected={mode === 'asap'}
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
                  const any = WINDOW_START_HOURS.some((h) => windowAvailable(d.date, h, new Date()));
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
                        width: 64,
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
                  const ok = windowAvailable(day.date, h, new Date());
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

function ModeCard(props: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      accessibilityLabel={`${props.title}. ${props.subtitle}`}
      onPress={props.onPress}
      style={({ pressed }) => ({
        flex: 1,
        padding: t.spacing.md,
        borderRadius: t.radii.md,
        borderWidth: props.selected ? 1.5 : 1,
        borderColor: props.selected ? t.colors.primary : t.colors.border,
        backgroundColor: props.selected ? t.colors.primarySoft : pressed ? t.colors.surfaceAlt : t.colors.surface,
        gap: 4,
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

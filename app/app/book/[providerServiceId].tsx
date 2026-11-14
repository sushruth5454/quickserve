import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { CategoryIcon, iconForSlug } from '../../src/components/CategoryIcon';
import { SkillBadge } from '../../src/components/ProviderCard';
import {
  Avatar,
  BottomSheet,
  Button,
  Card,
  Chip,
  Divider,
  ErrorState,
  Header,
  InlineAlert,
  Input,
  PriceRow,
  Screen,
  SegmentedControl,
  Skeleton,
  Text,
  TextArea,
  useToast,
} from '../../src/components/ui';
import { createBooking, getProviderService, uploadJobPhoto, type ProviderServiceWithProvider } from '../../src/lib/api';
import { useCurrentLocation } from '../../src/lib/location';
import { formatINR, PLATFORM_FEE_PAISE } from '../../src/lib/money';
import { usePayment } from '../../src/lib/payments';
import { typicalRange } from '../../src/lib/pricing';
import { useTheme } from '../../src/theme';

type Slot = 'today_evening' | 'tomorrow_morning' | 'tomorrow_evening';

const SLOTS: { value: Slot; label: string }[] = [
  { value: 'today_evening', label: 'Today, 6 PM' },
  { value: 'tomorrow_morning', label: 'Tomorrow, 10 AM' },
  { value: 'tomorrow_evening', label: 'Tomorrow, 6 PM' },
];

const QUICK_ISSUES: Record<string, string[]> = {
  'ac-repair': ['Not cooling', 'Water leaking', 'Making noise', 'Service due'],
  electrician: ['MCB tripping', 'Fan not working', 'Switch sparking', 'New fitting'],
  plumber: ['Tap leaking', 'Blocked drain', 'Low water pressure', 'Flush not working'],
  'house-cleaning': ['Full home deep clean', 'Kitchen', 'Bathrooms', 'Sofa / carpet'],
};

function slotToDate(slot: Slot): Date {
  const d = new Date();
  if (slot !== 'today_evening') d.setDate(d.getDate() + 1);
  d.setHours(slot === 'tomorrow_morning' ? 10 : 18, 0, 0, 0);
  return d;
}

export default function BookScreen() {
  const t = useTheme();
  const toast = useToast();
  const pay = usePayment();
  const { providerServiceId } = useLocalSearchParams<{ providerServiceId: string }>();
  const location = useCurrentLocation();
  const [service, setService] = useState<ProviderServiceWithProvider | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [addressOpen, setAddressOpen] = useState(false);
  const [when, setWhen] = useState<'asap' | 'schedule'>('asap');
  const [slot, setSlot] = useState<Slot>('tomorrow_morning');
  const [photos, setPhotos] = useState<{ uri: string; mimeType: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const load = () => {
    if (!providerServiceId) return;
    setLoadError(null);
    getProviderService(providerServiceId)
      .then(setService)
      .catch((e: Error) => setLoadError(e.message));
  };
  useEffect(load, [providerServiceId]);

  useEffect(() => {
    if (location.addressLine && !address) setAddress(location.addressLine);
    if (location.city && !city) setCity(location.city);
  }, [location.addressLine, location.city, address, city]);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    const asset = res.canceled ? null : res.assets[0];
    if (asset) setPhotos((p) => [...p, { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' }].slice(0, 4));
  };

  const descError = touched && !description.trim() ? 'Tell the pro what needs fixing.' : null;
  const addressError = touched && (!address.trim() || !city.trim()) ? 'Enter your address and city.' : null;

  const submit = async () => {
    if (!service) return;
    setTouched(true);
    if (!description.trim() || !address.trim() || !city.trim()) return;
    if (!location.coords) return setError('We need your location to send the provider. Tap "Use current location".');
    setBusy(true);
    setError(null);
    try {
      const paths = await Promise.all(photos.map((p) => uploadJobPhoto(p.uri, p.mimeType)));
      const bookingId = await createBooking({
        providerServiceId: service.id,
        description: description.trim(),
        addressLine: address.trim(),
        city: city.trim(),
        coords: location.coords,
        scheduledAt: when === 'asap' ? null : slotToDate(slot),
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

  const providerName = service?.providers?.profiles?.full_name ?? 'provider';
  const firstName = providerName.split(' ')[0];
  const slug = service?.categories?.slug;
  const range = typicalRange(slug);

  if (!service) {
    return (
      <Screen header={<Header title="Book" />}>
        {loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : (
          <>
            <Skeleton height={76} radius={t.radii.lg} />
            <Skeleton height={140} radius={t.radii.lg} />
            <Skeleton height={120} radius={t.radii.lg} />
          </>
        )}
      </Screen>
    );
  }

  return (
    <>
      <Screen
        header={<Header title={`Book ${service.categories?.name ?? ''}`.trim()} subtitle={`with ${providerName}`} />}
        gap={t.spacing.section}
        footer={
          <>
            <Button
              title={`Pay ${formatINR(service.visit_fee)} & book`}
              onPress={() => void submit()}
              loading={busy}
              size="lg"
              leftIcon="lock-closed"
              fullWidth
            />
            <Text variant="caption" color="muted" align="center">
              Free cancellation until {firstName} accepts
            </Text>
          </>
        }
      >
        <Card padding={t.spacing.md} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <Avatar name={providerName} size={44} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="calloutStrong" numberOfLines={1}>
              {providerName}
            </Text>
            <SkillBadge level={service.skill_level} />
          </View>
          <CategoryIcon icon={iconForSlug(slug)} size={40} />
        </Card>

        <Block title="What's the problem?">
          {QUICK_ISSUES[slug ?? ''] ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -t.spacing.lg }}
              contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm, paddingVertical: 2 }}
            >
              {QUICK_ISSUES[slug ?? '']!.map((q) => (
                <Chip
                  key={q}
                  label={q}
                  icon="add"
                  onPress={() => setDescription((d) => (d.trim() ? `${d.trim()}, ${q.toLowerCase()}` : q))}
                />
              ))}
            </ScrollView>
          ) : null}
          <TextArea
            placeholder="e.g. Split AC not cooling and making a rattling noise"
            value={description}
            onChangeText={setDescription}
            maxLength={1000}
            error={descError}
            accessibilityLabel="Describe the problem"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -t.spacing.lg }}
            contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}
          >
            {photos.map((p) => (
              <View key={p.uri}>
                <Image source={{ uri: p.uri }} style={{ width: 80, height: 80, borderRadius: t.radii.md }} contentFit="cover" accessibilityLabel="Problem photo" />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  onPress={() => setPhotos((ps) => ps.filter((x) => x.uri !== p.uri))}
                  hitSlop={10}
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: 'rgba(16,24,40,0.7)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="close" size={14} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
            {photos.length < 4 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add photo, ${photos.length} of 4 added`}
                onPress={() => void pickPhoto()}
                style={({ pressed }) => ({
                  width: 80,
                  height: 80,
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
                <Ionicons name="camera-outline" size={22} color={t.colors.textSecondary} />
                <Text variant="caption" color="textSecondary">
                  Add photo
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </Block>

        <Block title="Where?">
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
            <View
              style={{ width: 40, height: 40, borderRadius: t.radii.md, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="home-outline" size={20} color={t.colors.textSecondary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="calloutStrong">Home</Text>
              <Text variant="footnote" color="textSecondary" numberOfLines={2}>
                {address.trim() || city.trim() ? [address.trim(), city.trim()].filter(Boolean).join(', ') : 'Add your address'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name={location.coords ? 'location' : 'location-outline'} size={12} color={t.colors.muted} />
                <Text variant="caption" color="muted">
                  {location.loading ? 'Getting your location…' : location.coords ? 'Location pinned on map' : 'Location not set'}
                </Text>
              </View>
            </View>
            <Button title="Change" variant="ghost" size="sm" onPress={() => setAddressOpen(true)} />
          </Card>
          {addressError ? <InlineAlert message={addressError} /> : null}
          {location.error ? <InlineAlert tone="warning" message={location.error} /> : null}
        </Block>

        <Block title="When?">
          <SegmentedControl
            options={[
              { value: 'asap', label: 'As soon as possible' },
              { value: 'schedule', label: 'Schedule' },
            ]}
            value={when}
            onChange={setWhen}
            accessibilityLabel="When do you need the service"
          />
          {when === 'schedule' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
              {SLOTS.map((s) => (
                <Chip key={s.value} label={s.label} selected={slot === s.value} onPress={() => setSlot(s.value)} />
              ))}
            </View>
          ) : (
            <Text variant="footnote" color="muted">
              Pros usually accept within 15 minutes. If nobody accepts, your visit fee is refunded automatically.
            </Text>
          )}
        </Block>

        <Block title="Price">
          <Card gap={t.spacing.md}>
            <PriceRow label="Visit / inspection fee" amount={service.visit_fee} hint="Pay now · adjusted in your final bill" icon="home-outline" />
            <PriceRow label="Platform fee" amount={PLATFORM_FEE_PAISE} hint="Charged once, with the final bill" icon="receipt-outline" emphasis="muted" />
            <Divider />
            <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }}>
              <Ionicons name="information-circle-outline" size={18} color={t.colors.muted} />
              <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
                {firstName} inspects and sends an itemised quote. Nothing more is charged until you approve it.
              </Text>
            </View>
            {range ? (
              <View
                style={{
                  backgroundColor: t.colors.surfaceAlt,
                  borderRadius: t.radii.sm,
                  padding: t.spacing.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t.spacing.md,
                }}
              >
                <Ionicons name="analytics-outline" size={20} color={t.colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text variant="footnote" color="muted">
                    Typical total for {service.categories?.name ?? 'this job'} here
                  </Text>
                  <Text variant="calloutStrong" tabular>
                    {formatINR(range[0] * 100)} – {formatINR(range[1] * 100)}
                  </Text>
                </View>
              </View>
            ) : null}
          </Card>
        </Block>
        <InlineAlert message={error} />
      </Screen>

      <BottomSheet
        visible={addressOpen}
        onClose={() => setAddressOpen(false)}
        title="Service address"
        subtitle={`Shared with ${firstName} only after they accept`}
        footer={<Button title="Save address" onPress={() => setAddressOpen(false)} fullWidth size="lg" />}
      >
        <Button
          title={location.coords ? 'Refresh current location' : 'Use current location'}
          variant="secondary"
          leftIcon="navigate-outline"
          onPress={() => void location.refresh()}
          loading={location.loading}
          fullWidth
        />
        <Input label="House no, street, landmark" value={address} onChangeText={setAddress} accessibilityLabel="Address" />
        <Input label="City" value={city} onChangeText={setCity} accessibilityLabel="City" error={addressError} />
      </BottomSheet>
    </>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.md }}>
      <Text variant="title3" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

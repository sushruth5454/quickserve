import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { Card, Chip, ErrorText, Field, Loading, Screen } from '../../../src/components/Screen';
import { createBooking, createPayment, getProviderService, uploadJobPhoto } from '../../../src/lib/api';
import { useCurrentLocation } from '../../../src/lib/location';
import { formatINR, PLATFORM_FEE_PAISE } from '../../../src/lib/money';
import { font, spacing } from '../../../src/lib/theme';
import type { ProviderService } from '../../../src/lib/types';

type Slot = 'asap' | 'today_evening' | 'tomorrow_morning' | 'tomorrow_evening';

const SLOTS: { value: Slot; label: string }[] = [
  { value: 'asap', label: 'ASAP' },
  { value: 'today_evening', label: 'Today 6 PM' },
  { value: 'tomorrow_morning', label: 'Tomorrow 10 AM' },
  { value: 'tomorrow_evening', label: 'Tomorrow 6 PM' },
];

function slotToDate(slot: Slot): Date | null {
  if (slot === 'asap') return null;
  const d = new Date();
  if (slot !== 'today_evening') d.setDate(d.getDate() + 1);
  d.setHours(slot === 'tomorrow_morning' ? 10 : 18, 0, 0, 0);
  return d;
}

export default function BookScreen() {
  const { providerServiceId } = useLocalSearchParams<{ providerServiceId: string }>();
  const location = useCurrentLocation();
  const [service, setService] = useState<
    (ProviderService & { providers: { profiles: { full_name: string } | null } | null }) | null
  >(null);
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [slot, setSlot] = useState<Slot>('asap');
  const [photos, setPhotos] = useState<{ uri: string; mimeType: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!providerServiceId) return;
    getProviderService(providerServiceId).then(setService).catch((e: Error) => setError(e.message));
  }, [providerServiceId]);

  useEffect(() => {
    if (location.addressLine && !address) setAddress(location.addressLine);
    if (location.city && !city) setCity(location.city);
  }, [location.addressLine, location.city, address, city]);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    const asset = res.canceled ? null : res.assets[0];
    if (asset) setPhotos((p) => [...p, { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' }].slice(0, 4));
  };

  const submit = async () => {
    if (!service) return;
    if (!description.trim()) return setError('Describe the problem.');
    if (!address.trim() || !city.trim()) return setError('Enter your address and city.');
    if (!location.coords) return setError('We need your location to send the provider. Tap "Use my location".');
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
        scheduledAt: slotToDate(slot),
        photos: paths,
      });
      const link = await createPayment(bookingId);
      await WebBrowser.openBrowserAsync(link.short_url);
      router.replace({ pathname: '/booking/[id]', params: { id: bookingId } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!service) return error ? <Screen><ErrorText message={error} /></Screen> : <Loading />;

  return (
    <Screen>
      <Text style={font.title}>
        {service.categories?.name} with {service.providers?.profiles?.full_name ?? 'provider'}
      </Text>
      <Field
        label="Describe the problem"
        placeholder="e.g. Split AC not cooling, making noise"
        multiline
        value={description}
        onChangeText={setDescription}
        maxLength={1000}
      />
      <View style={styles.photos}>
        {photos.map((p) => (
          <Image key={p.uri} source={{ uri: p.uri }} style={styles.thumb} accessibilityLabel="Problem photo" />
        ))}
      </View>
      {photos.length < 4 && <Button title={`Add photo (${photos.length}/4)`} variant="secondary" onPress={pickPhoto} />}
      <Field label="Address" placeholder="House no, street, landmark" value={address} onChangeText={setAddress} />
      <Field label="City" placeholder="Vijayawada" value={city} onChangeText={setCity} />
      <Button
        title={location.coords ? 'Location set ✓ (refresh)' : 'Use my location'}
        variant="ghost"
        onPress={() => void location.refresh()}
        loading={location.loading}
      />
      {location.error && <Text style={font.caption}>{location.error}</Text>}
      <Text style={[font.caption, { fontWeight: '600' }]}>When?</Text>
      <View style={styles.chips}>
        {SLOTS.map((s) => (
          <Chip key={s.value} label={s.label} selected={slot === s.value} onPress={() => setSlot(s.value)} />
        ))}
      </View>
      <Card>
        <Row label="Visit / inspection fee (pay now)" value={formatINR(service.visit_fee)} />
        <Row label="Platform fee (charged with the final bill)" value={formatINR(PLATFORM_FEE_PAISE)} />
        <Text style={font.caption}>
          The visit fee is credited against the final bill if you approve the provider's quote. Free cancellation until
          the provider accepts.
        </Text>
      </Card>
      <ErrorText message={error} />
      <Button title={`Pay ${formatINR(service.visit_fee)} & book`} onPress={submit} loading={busy} />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={[font.body, { flex: 1 }]}>{label}</Text>
      <Text style={[font.body, { fontWeight: '600' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photos: { flexDirection: 'row', gap: spacing.sm },
  thumb: { width: 72, height: 72, borderRadius: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
});

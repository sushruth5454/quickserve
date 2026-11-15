import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import { claimByoInvite, previewByoInvite, type ByoInvitePreview } from '../../src/lib/providerBusiness';
import { useAuth } from '../../src/lib/auth';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { formatINR } from '../../src/lib/money';
import { usePayment } from '../../src/lib/payments';
import { useTheme } from '../../src/theme';

export default function ByoInviteScreen() {
  const t = useTheme();
  const toast = useToast();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { userId, setActiveRole } = useAuth();
  const { location, coords } = useSelectedLocation();
  const pay = usePayment();
  const [preview, setPreview] = useState<ByoInvitePreview | null | undefined>(undefined);
  const [address, setAddress] = useState(location.line1 ?? '');
  const [city, setCity] = useState(location.city);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setPreview(undefined);
    previewByoInvite(token)
      .then(setPreview)
      .catch((e: Error) => {
        setError(e.message);
        setPreview(null);
      });
  }, [token]);

  const claim = async () => {
    if (!token || !preview || !userId) return;
    if (!address.trim() || !city.trim()) {
      setError('Enter the service address before accepting the booking.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const bookingId = await claimByoInvite(token, {
        label: 'Booking',
        line1: address.trim(),
        city: city.trim(),
        lat: coords.lat,
        lng: coords.lng,
      });
      setActiveRole('customer');
      await pay(bookingId);
      router.replace({ pathname: '/booking/[id]', params: { id: bookingId } });
      toast({ message: 'Booking created — complete payment to confirm it.' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header title="Protected client booking" onBack={() => router.canGoBack() ? router.back() : router.replace('/')} />}
      gap={t.spacing.xl}
      footer={
        preview ? (
          userId ? (
            <Button
              title={`Accept & pay ${formatINR(preview.total_paise)}`}
              onPress={() => void claim()}
              loading={busy}
              disabled={!address.trim() || !city.trim()}
              size="lg"
              fullWidth
              leftIcon="lock-closed"
            />
          ) : (
            <Button
              title="Log in to accept this booking"
              onPress={() => router.push({ pathname: '/login', params: { inviteToken: token } })}
              size="lg"
              fullWidth
              leftIcon="log-in-outline"
            />
          )
        ) : undefined
      }
    >
      {preview === undefined ? (
        <View style={{ gap: t.spacing.md }}><Skeleton width="70%" height={28} /><Skeleton width="100%" height={140} /></View>
      ) : preview === null ? (
        <InlineAlert tone="danger" title="Invite unavailable" message="This booking link is invalid, expired or already used." />
      ) : (
        <>
          <Card gap={t.spacing.md}>
            <Text variant="overline" color="primaryText">QUICKSERVE PROTECTED BOOKING</Text>
            <Text variant="title2">{preview.category_name}</Text>
            <Text variant="body" color="textSecondary">{preview.description}</Text>
            <View style={{ height: 1, backgroundColor: t.colors.border }} />
            <PriceRow label="Provider" value={preview.provider_name} />
            <PriceRow label="Client" value={preview.customer_label} />
            {preview.scheduled_at ? <PriceRow label="Scheduled" value={new Date(preview.scheduled_at).toLocaleString('en-IN')} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text variant="callout" color="muted" style={{ flex: 1 }}>Agreed job</Text>
              <Text variant="calloutStrong">{formatINR(preview.amount_paise)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text variant="callout" color="muted" style={{ flex: 1 }}>3% tools fee</Text>
              <Text variant="calloutStrong">{formatINR(preview.fee_paise)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>Total</Text>
              <Text variant="title3">{formatINR(preview.total_paise)}</Text>
            </View>
          </Card>

          <InlineAlert
            tone="success"
            icon="shield-checkmark-outline"
            title="Protected by QuickServe"
            message="Pay in-app, confirm work with a completion code, and qualify for the guarantee and a verified review."
          />

          {userId ? (
            <Card gap={t.spacing.lg}>
              <Text variant="title3">Where should the provider come?</Text>
              <Input label="Address" placeholder="Flat, building and street" value={address} onChangeText={setAddress} autoComplete="street-address" />
              <Input label="City" value={city} onChangeText={setCity} autoComplete="postal-address-locality" />
              <Text variant="caption" color="muted">Your address is shared with this provider only after the booking is paid. No phone number is included.</Text>
            </Card>
          ) : (
            <Text variant="callout" color="muted" align="center">The provider never sees or receives your phone number through this invite.</Text>
          )}
        </>
      )}
      <InlineAlert message={error} />
    </Screen>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text variant="callout" color="muted" style={{ flex: 1 }}>{label}</Text>
      <Text variant="calloutStrong">{value}</Text>
    </View>
  );
}

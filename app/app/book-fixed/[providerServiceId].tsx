import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import { createFixedBooking, listFixedPackages } from '../../src/lib/fixedBooking';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { formatINR } from '../../src/lib/money';
import { usePayment } from '../../src/lib/payments';
import type { ServicePackage } from '../../src/lib/types';
import { useTheme } from '../../src/theme';

export default function FixedPackageBookScreen() {
  const t = useTheme();
  const toast = useToast();
  const pay = usePayment();
  const { providerServiceId } = useLocalSearchParams<{ providerServiceId: string }>();
  const { location } = useSelectedLocation();
  const [packages, setPackages] = useState<ServicePackage[] | null>(null);
  const [selected, setSelected] = useState<ServicePackage | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useMemo(() => new Date(Date.now() + 2 * 60 * 60 * 1000), []);

  useEffect(() => {
    if (!providerServiceId) return;
    listFixedPackages(providerServiceId)
      .then((rows) => {
        setPackages(rows);
        setSelected(rows[0] ?? null);
        setQuantity(Math.max(1, rows[0]?.qty_min ?? 1));
      })
      .catch((e: Error) => setError(e.message));
  }, [providerServiceId]);

  const end = selected
    ? new Date(start.getTime() + Math.max(60, selected.duration_min ?? 60) * Math.max(1, Math.ceil(quantity)) * 60000)
    : start;
  const serviceTotal = selected ? Math.round((selected.price ?? 0) * quantity) : 0;
  const platformFee = 2900;

  const submit = async () => {
    if (!selected || !location.line1) return;
    setBusy(true);
    setError(null);
    try {
      const bookingId = await createFixedBooking({
        packageId: selected.id,
        quantity,
        windowStart: start,
        windowEnd: end,
        location: {
          mode: 'at_customer',
          addressId: location.addressId,
          addressLine: location.line1,
          city: location.city,
          lat: location.lat,
          lng: location.lng,
        },
      });
      const result = await pay(bookingId);
      if (result === 'paid') toast({ message: 'Package booked and paid.', tone: 'success' });
      router.replace({ pathname: '/booking/[id]', params: { id: bookingId } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!packages) {
    return (
      <Screen header={<Header title="Book a package" />}>
        {error ? <ErrorState message={error} onRetry={() => router.replace(`/book-fixed/${providerServiceId}`)} /> : <Skeleton height={240} radius={t.radii.lg} />}
      </Screen>
    );
  }

  if (!packages.length) {
    return <Screen header={<Header title="Book a package" />}><ErrorState title="No fixed packages" message="This provider has no active fixed-price package." /></Screen>;
  }

  return (
    <Screen
      header={<Header title="Book a package" />}
      gap={t.spacing.lg}
      footer={
        <Button
          title={`Pay ${formatINR(serviceTotal + platformFee)} & book`}
          onPress={() => void submit()}
          loading={busy}
          disabled={!selected || !location.line1}
          fullWidth
          size="lg"
          leftIcon="lock-closed"
        />
      }
    >
      <InlineAlert tone="info" title="Fixed price, paid upfront" message="The package price and platform fee are calculated by the server. Any on-site add-on requires your approval." />
      <View style={{ gap: t.spacing.md }}>
        {packages.map((item) => (
          <Pressable key={item.id} onPress={() => { setSelected(item); setQuantity(Math.max(1, item.qty_min)); }}>
            <Card variant="outlined" gap={t.spacing.sm} style={{ borderColor: selected?.id === item.id ? t.colors.primary : t.colors.border, borderWidth: selected?.id === item.id ? 2 : 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.md }}>
                <Text variant="title3" style={{ flex: 1 }}>{item.title}</Text>
                <Text variant="title3" color="primaryText" tabular>{formatINR(item.price ?? 0)}</Text>
              </View>
              {item.description ? <Text variant="footnote" color="textSecondary">{item.description}</Text> : null}
              <Text variant="footnote" color="muted">{item.duration_min ?? 60} min · {item.unit} · 100% due now</Text>
              {item.inclusions.length ? <Text variant="footnote">Includes: {item.inclusions.join(', ')}</Text> : null}
            </Card>
          </Pressable>
        ))}
      </View>
      {selected && selected.qty_max > selected.qty_min ? (
        <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="calloutStrong">Quantity</Text>
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center' }}>
            <Button title="−" variant="secondary" onPress={() => setQuantity((value) => Math.max(selected.qty_min, value - 1))} disabled={quantity <= selected.qty_min} />
            <Text variant="title3" tabular>{quantity}</Text>
            <Button title="+" variant="secondary" onPress={() => setQuantity((value) => Math.min(selected.qty_max, value + 1))} disabled={quantity >= selected.qty_max} />
          </View>
        </View>
      ) : null}
      <Card gap={t.spacing.sm}>
        <Text variant="subheadStrong">Payment summary</Text>
        <Text variant="body" color="textSecondary">Package: {formatINR(serviceTotal)}</Text>
        <Text variant="body" color="textSecondary">Platform fee: {formatINR(platformFee)} (charged once)</Text>
        <Text variant="title3">Total: {formatINR(serviceTotal + platformFee)}</Text>
        <Text variant="caption" color="muted">Slot: {start.toLocaleString('en-IN')} – {end.toLocaleTimeString('en-IN')}</Text>
      </Card>
      {error ? <InlineAlert tone="danger" title="Could not book" message={error} /> : null}
    </Screen>
  );
}

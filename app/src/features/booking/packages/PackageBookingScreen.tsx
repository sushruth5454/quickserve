import * as WebBrowser from 'expo-web-browser';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, ErrorState, Header, IconButton, InlineAlert, Input, PriceRow, Screen, Skeleton, Text, useToast } from '../../../components/ui';
import { useSelectedLocation } from '../../../lib/locationContext';
import { friendlyDbError } from '../../../lib/onboarding/supabaseOnboarding';
import { formatINR, packageCheckoutTotal } from '../../../lib/money';
import { usePayment } from '../../../lib/payments';
import { supabase } from '../../../lib/supabase';
import { asapStart, dayLabel, nextDays, relativeTimeLabel, windowLabel, windowStart } from '../../../lib/schedule';
import { onboardingApi, type ProviderSchedule } from '../../../lib/onboarding';
import { asapAvailable } from '../../../lib/onboarding/availability';
import { useTheme } from '../../../theme';
import { useAppFeatureFlags } from '../../../lib/featureFlags';
import { createFixedPackageBooking, createPackPayment, createTimeBooking, getCataloguePackage, listCataloguePackages, type CataloguePackage } from '../../catalogue/api';
import { isServiceBookingEnabled, type BookPrefill, type ServiceBookingEntry } from '../../../lib/assistant/prefill';
import { SchemaForm } from '../../catalogue/SchemaForm';
import { validateValues } from '../../catalogue/schema';
import { PackageCard } from './PackageCard';
import { canPayInstantly, canPurchaseSessionPack, fixedBookingDuration, getTimeBookingModes, initialPackageAsap, packageDuration, packageRepeatPlanRoute, packageTotal, timeBookingQuantity } from './packageModel';

export function PackageBookingScreen({
  packageId,
  entry,
  prefill,
}: {
  packageId?: string;
  entry: Extract<ServiceBookingEntry, { kind: 'fixed-package' | 'time-package' }>;
  prefill: BookPrefill;
}) {
  const archetype = entry.archetype;
  const providerServiceId = entry.params.providerServiceId!;
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const toast = useToast();
  const pay = usePayment();
  const { location } = useSelectedLocation();
  const [item, setItem] = useState<CataloguePackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packageChoices, setPackageChoices] = useState<CataloguePackage[] | null>(null);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [platformFee, setPlatformFee] = useState<number | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pack, setPack] = useState(false);
  const [dayIndex, setDayIndex] = useState(prefill.dayIndex ?? 0);
  const [hour, setHour] = useState<number | null>(
    prefill.slotInvalid || prefill.mode === 'asap' ? null : prefill.hour ?? 10,
  );
  const [intake, setIntake] = useState<Record<string, unknown>>(() => prefill.description ? { brief: prefill.description } : {});
  const [busy, setBusy] = useState(false);
  const [asap, setAsap] = useState(() => initialPackageAsap(archetype, prefill));
  const [sched, setSched] = useState<ProviderSchedule | null>(null);
  const days = useMemo(() => nextDays(new Date(), 14), []);
  const familyEnabled = isServiceBookingEnabled(entry, flags.archetypes);
  const proposalEnabled = flags.archetypes?.proposal === true;
  const timeBookingModes = getTimeBookingModes(
    flags.isOn('recurring_bookings') && flags.archetypes?.time_based === true,
    item?.category,
  );
  const packAvailable = archetype === 'time_based' && !!item && canPurchaseSessionPack(item.package);
  useEffect(() => {
    if (pack && !packAvailable) {
      setPack(false);
      setQuantity(1);
    }
  }, [pack, packAvailable]);
  const effectiveQuantity = archetype === 'time_based' ? timeBookingQuantity(pack, quantity) : quantity;
  const repeatPlanAvailable = timeBookingModes.includes('repeat') && !pack && effectiveQuantity === 1;
  const day = days[dayIndex] ?? days[0]!;
  useEffect(() => {
    if (!packageId) {
      setItem(null);
      setPlatformFee(null);
      setError(null);
      return;
    }
    let alive = true;
    setItem(null);
    setPlatformFee(null);
    setError(null);
    void getCataloguePackage(packageId)
      .then(async (next) => {
        if (next.providerServiceId !== providerServiceId || next.category.archetype !== archetype) {
          throw new Error('This package is not available for the selected service');
        }
        if (!familyEnabled) {
          if (!alive) return;
          setItem(next);
          setPlatformFee(0);
          return;
        }
        if (!canPayInstantly(next.package)) {
          if (proposalEnabled) {
            router.replace({ pathname: '/request/new', params: { ...entry.params, package: next.package.id } } as Href);
          } else if (alive) {
            setError('Proposal requests are not currently available.');
          }
          return;
        }
        const priceResult = archetype === 'fixed'
          ? await supabase.rpc('get_fixed_booking_fee')
          : await supabase.rpc('get_booking_price_preview', {
              p_provider_service_id: next.providerServiceId,
              p_quantity: 1,
            });
        if (priceResult.error) throw new Error(priceResult.error.message);
        const priceData = priceResult.data as { platform_fee?: unknown } | number | null;
        const rawFee = archetype === 'fixed'
          ? priceData
          : priceData && typeof priceData === 'object'
            ? priceData.platform_fee
            : null;
        if (rawFee == null || typeof rawFee === 'boolean') throw new Error('The booking price is incomplete');
        const fee = Number(rawFee);
        if (!Number.isSafeInteger(fee) || fee < 0) throw new Error('The booking price is invalid');
        if (!alive) return;
        setItem(next);
        setPlatformFee(fee);
        setQuantity(archetype === 'fixed' ? Math.max(1, Number(next.package.qty_min)) : 1);
        if (archetype === 'fixed') {
          void onboardingApi.getProviderSchedule(next.providerId).then((s) => {
            if (!alive) return;
            setSched(s);
            if (!asapAvailable(s, new Date())) setAsap(false);
          }).catch(() => undefined);
        }
      })
      .catch((caught: Error) => alive && setError(caught.message));
    return () => { alive = false; };
  }, [packageId, providerServiceId, archetype, loadAttempt, familyEnabled, proposalEnabled, entry]);

  useEffect(() => {
    if (packageId) return;
    let alive = true;
    setPackageChoices(null);
    setChoiceError(null);
    void listCataloguePackages(entry.params.categorySlug ?? '', location.city)
      .then((rows) => {
        if (!alive) return;
        setPackageChoices(rows.filter((row) => row.providerServiceId === providerServiceId && row.category.archetype === archetype));
      })
      .catch((caught: Error) => alive && setChoiceError(caught.message));
    return () => { alive = false; };
  }, [packageId, entry.params.categorySlug, location.city, providerServiceId, archetype, loadAttempt]);

  if (!packageId) return (
    <Screen header={<Header title={archetype === 'fixed' ? 'Choose a package' : 'Choose a session'} />}>
      {!familyEnabled ? <InlineAlert tone="warning" message="This booking type is not currently available." /> : null}
      {choiceError ? (
        <ErrorState message={choiceError} onRetry={() => setLoadAttempt((attempt) => attempt + 1)} />
      ) : packageChoices === null ? (
        <Skeleton height={260} radius={t.radii.lg} />
      ) : packageChoices.length === 0 ? (
        <InlineAlert message={archetype === 'fixed' ? 'No fixed packages are available for this provider.' : 'No sessions are available for this provider.'} />
      ) : (
        packageChoices.map((choice) => {
          const canSelect = familyEnabled && (canPayInstantly(choice.package) || proposalEnabled);
          return <PackageCard
            key={choice.package.id}
            servicePackage={choice.package}
            providerName={choice.providerName}
            rating={choice.rating}
            ratingCount={choice.ratingCount}
            providerOnline={choice.providerOnline}
            providerPaused={choice.providerPaused}
            actionLabel={canSelect ? 'Choose package' : undefined}
            onPress={canSelect ? () => {
              if (!canPayInstantly(choice.package)) {
                router.push({ pathname: '/request/new', params: { ...entry.params, package: choice.package.id } } as Href);
              } else {
                router.push({
                  pathname: '/book/[providerServiceId]',
                  params: { ...entry.params, providerServiceId, packageId: choice.package.id },
                } as Href);
              }
            } : undefined}
          />;
        })
      )}
    </Screen>
  );

  if (!item || platformFee === null) return (
    <Screen header={<Header title="Book package" />}>
      {error ? <ErrorState message={error} onRetry={() => setLoadAttempt((attempt) => attempt + 1)} /> :
        <Skeleton height={260} radius={t.radii.lg} />}
    </Screen>
  );

  const schema = item.category.intake_schema ?? { type: 'object', properties: {} };
  const schemaIssues = validateValues(schema, intake);
  const total = packageTotal(item.package, effectiveQuantity);
  const dueNow = pack ? total + 4900 : packageCheckoutTotal(item.package, effectiveQuantity, platformFee);
  const totalMinutes = archetype === 'fixed'
    ? fixedBookingDuration(item.package, quantity)
    : packageDuration(item.package, 1);
  const asapOk = archetype === 'fixed' && flags.isOn('fixed_asap') && item.providerOnline && !item.providerPaused && asapAvailable(sched, new Date());
  const useAsap = asap && asapOk;
  const start = useAsap ? asapStart(new Date()) : hour === null ? null : windowStart(day.date, hour);
  const end = start ? new Date(start.getTime() + totalMinutes * 60_000) : null;
  const addressReady = !!location.addressId;
  const blocker = !familyEnabled
    ? 'This booking type is not currently available'
    : pack && !packAvailable
    ? 'Session packs are not available for this package'
    : item.providerPaused
    ? 'This provider is on holiday and is not taking bookings'
    : !canPayInstantly(item.package)
    ? 'This package requires a fixed proposal before payment'
    : !addressReady
      ? 'Choose a full service address to continue'
      : schemaIssues.length
        ? schemaIssues[0]?.message ?? 'Complete the required details'
        : !start || start <= new Date()
          ? 'Choose a future time'
          : null;

  const book = async () => {
    if (!familyEnabled || (pack && !packAvailable) || blocker || !location.addressId || !start || !end) return;
    setBusy(true);
    try {
      if (archetype === 'fixed') {
        const bookingId = await createFixedPackageBooking({
          packageId,
          quantity,
          startsAt: start,
          endsAt: end,
          addressId: location.addressId,
          intake,
        });
        await pay(bookingId);
        router.replace({ pathname: '/booking/[id]', params: { id: bookingId } });
      } else {
        const result = await createTimeBooking({
          packageId,
          quantity: effectiveQuantity,
          durationMin: packageDuration(item.package, 1),
          providerServiceId: item.providerServiceId,
          startsAt: start,
          addressId: location.addressId,
          addressLine: location.line1 ?? '',
          city: location.city,
          lat: location.lat,
          lng: location.lng,
          intake,
          pack,
        });
        if (result.kind === 'pack') {
          const payment = await createPackPayment(result.id);
          await WebBrowser.openBrowserAsync(payment.short_url);
          router.replace('/bookings');
        } else {
          await pay(result.id);
          router.replace({ pathname: '/booking/[id]', params: { id: result.id } });
        }
      }
      toast({ message: archetype === 'fixed' ? 'Package booked' : pack ? 'Pack created. Complete payment to activate it.' : 'Session booked', tone: 'success' });
    } catch (caught) {
      const message = (caught as Error).message;
      setError(/overlaps another booking|not available/i.test(message)
        ? useAsap
          ? `${item.providerName ?? 'This pro'} is busy right now. Choose Schedule and pick a time.`
          : 'That time is already taken. Pick another day or time slot.'
        : friendlyDbError(message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header title={archetype === 'fixed' ? 'Book package' : pack ? 'Buy a session pack' : 'Book a session'} right={<IconButton icon="location-outline" onPress={() => router.push('/location')} accessibilityLabel="Change service address" />} />}
      footer={
        familyEnabled ? <View style={{ gap: t.spacing.sm }}>
          <PriceRow label={archetype === 'fixed' ? 'Package' : pack ? 'Session pack' : 'Session service'} amount={total} />
          <PriceRow
            label={pack ? 'Pack fee' : 'Platform fee'}
            amount={pack ? 4900 : platformFee}
            hint={pack ? undefined : 'Charged once'}
          />
          <PriceRow label={pack ? `${quantity} sessions + ₹49 pack fee` : 'Total'} amount={dueNow} emphasis="total" />
          <Button title={`Pay ${formatINR(dueNow, { alwaysShowPaise: true })}`} onPress={() => void book()} loading={busy} disabled={!!blocker} accessibilityHint={blocker ?? undefined} fullWidth size="lg" leftIcon="lock-closed" />
        </View> : null
      }
    >
      <InlineAlert message={error} />
      {!familyEnabled ? <InlineAlert tone="warning" message="This booking type is not currently available. Existing bookings remain accessible from Bookings." /> : null}
      {item.providerPaused ? (
        <InlineAlert tone="warning" title="On holiday" message="This provider is not taking new bookings. Choose another provider or come back later." />
      ) : !item.providerOnline && archetype === 'fixed' ? (
        <InlineAlert title="Provider is offline" message="You can still choose a future time. ASAP is available only while the provider is online." />
      ) : null}
      <PackageCard servicePackage={item.package} providerName={item.providerName} rating={item.rating} ratingCount={item.ratingCount} />

      {familyEnabled ? (
        <>
          {prefill.fromAssistant && prefill.description ? <InlineAlert tone="info" title="From QuickServe AI" message={prefill.description} /> : null}
          {archetype === 'time_based' ? (
            <View style={{ gap: t.spacing.sm }}>
              <Text variant="title3">Booking type</Text>
              <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                <Choice label="One session" selected={!pack} onPress={() => { setPack(false); setQuantity(1); }} />
                {repeatPlanAvailable ? (
                  <Choice
                    label="Repeat plan"
                    selected={false}
                    onPress={() => router.push(packageRepeatPlanRoute(
                      item.providerServiceId,
                      packageId,
                      packageDuration(item.package, 1),
                      JSON.stringify(intake),
                    ))}
                  />
                ) : null}
                {packAvailable ? (
                  <Choice
                    label="Session pack"
                    selected={pack}
                    onPress={() => { setPack(true); setQuantity(Math.min(item.package.qty_max, Math.max(2, Number(item.package.qty_min)))); }}
                  />
                ) : null}
              </View>
            </View>
          ) : null}

          {(archetype === 'fixed' && item.package.qty_max > item.package.qty_min) || pack ? (
            <View style={{ gap: t.spacing.sm }}>
              <Text variant="title3">{pack ? 'Number of sessions' : 'Quantity'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                <Button title="−" variant="outline" onPress={() => setQuantity((value) => Math.max(Number(item.package.qty_min), value - 1))} disabled={quantity <= Number(item.package.qty_min)} style={{ width: 52 }} />
                <Input
                  value={String(quantity)}
                  onChangeText={(text) => {
                    const parsed = Number(text) || 1;
                    const bounded = Math.min(Number(item.package.qty_max), Math.max(Number(item.package.qty_min), parsed));
                    setQuantity(pack ? Math.round(bounded) : bounded);
                  }}
                  keyboardType="numeric"
                  accessibilityLabel={pack ? 'Number of sessions' : 'Quantity'}
                  containerStyle={{ flex: 1 }}
                />
                <Button title="+" variant="outline" onPress={() => setQuantity((value) => Math.min(Number(item.package.qty_max), value + 1))} disabled={quantity >= Number(item.package.qty_max)} style={{ width: 52 }} />
              </View>
            </View>
          ) : null}

          <View style={{ gap: t.spacing.md }}>
            <Text variant="title3">When</Text>
            {archetype === 'fixed' && flags.isOn('fixed_asap') ? (
              <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                <Choice label={asapOk ? 'ASAP\nwithin ~1 hour' : 'ASAP\nnot available now'} selected={useAsap} onPress={() => asapOk && setAsap(true)} />
                <Choice label={'Schedule\npick a time'} selected={!useAsap} onPress={() => setAsap(false)} />
              </View>
            ) : null}
            {useAsap ? (
              <Text variant="footnote" color="textSecondary">
                {item.providerName ?? 'Your pro'} arrives around {start ? relativeTimeLabel(start, new Date()) : 'soon'}. If they can't take it, you're refunded automatically.
              </Text>
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -t.spacing.lg }} contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}>
                  {days.slice(0, 7).map((dayOption, index) => (
                    <Choice key={dayOption.key} label={`${dayOption.label}\n${dayLabel(dayOption.date)}`} selected={index === dayIndex} onPress={() => setDayIndex(index)} />
                  ))}
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -t.spacing.lg }} contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}>
                  {[8, 10, 12, 14, 16, 18].map((slot) => <Choice key={slot} label={windowLabel(slot)} selected={hour === slot} onPress={() => setHour(slot)} />)}
                </ScrollView>
              </>
            )}
            <Text variant="footnote" color="muted">{pack ? 'This is the first session; later sessions can be scheduled in Bookings.' : `At ${location.area}${location.line1 ? ` · ${location.line1}` : ''}`}</Text>
          </View>

          <View style={{ gap: t.spacing.md }}>
            <Text variant="title3">Service details</Text>
            <SchemaForm
              schema={schema}
              value={intake}
              onChange={(values) => setIntake({ ...values, ...(prefill.description ? { brief: prefill.description } : {}) })}
            />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={{
      flex: 1,
      minWidth: 76,
      minHeight: 48,
      paddingHorizontal: t.spacing.md,
      paddingVertical: t.spacing.sm,
      borderRadius: t.radii.md,
      borderWidth: selected ? 2 : 1,
      borderColor: selected ? t.colors.primary : t.colors.borderStrong,
      backgroundColor: selected ? t.colors.primarySoft : t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Text variant="subheadStrong" color={selected ? 'primaryText' : 'text'} align="center">{label}</Text>
    </Pressable>
  );
}

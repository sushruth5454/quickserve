import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { BookingStepLayout } from '../../../src/components/market/BookingStepLayout';
import { PriceFooter } from '../../../src/components/market/PriceFooter';
import { Button, Card, ErrorState, Header, InlineAlert, Screen, Skeleton, Text, TextArea, useToast } from '../../../src/components/ui';
import { useT } from '../../../src/i18n';
import { getProviderService, type ProviderServiceWithProvider } from '../../../src/lib/api';
import { listFixedPackages } from '../../../src/lib/fixedBooking';
import { useAppFeatureFlags, useFeature } from '../../../src/lib/featureFlags';
import { useSelectedLocation } from '../../../src/lib/locationContext';
import { formatINR } from '../../../src/lib/money';
import type { ServicePackage } from '../../../src/lib/types';
import { istDateKey, nextDays, WINDOW_START_HOURS } from '../../../src/lib/schedule';
import { useTheme } from '../../../src/theme';
import { getBookingStepKeys } from '../../../src/features/booking/book/model';
import {
  createRecurringPlan,
  quoteRecurringPlan,
} from '../../../src/features/recurring/api';
import {
  getRecurringEndDateOptions,
  getRecurringQuoteSummary,
  recurringFourWeekEstimate,
  visibleBillingFrequencies,
} from '../../../src/features/recurring/customerPresentation';
import type {
  BillingFrequency,
  Frequency,
  RecurringPlanInput,
  RecurringQuote,
} from '../../../src/features/recurring/types';

type Archetype = 'time_based' | 'fixed';
type EndMode = 'none' | 'date' | 'count';

const FREQUENCIES: readonly Frequency[] = ['daily', 'alternate_days', 'weekly', 'monthly', 'custom'];
const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'Every day',
  alternate_days: 'Every other day',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Choose dates',
};
const WEEKDAYS = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 7, label: 'Sun' },
] as const;

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00.000Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function timeValue(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function validDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function frequencyLabel(frequency: BillingFrequency) {
  if (frequency === 'per_visit') return 'Pay per visit';
  if (frequency === 'weekly') return 'Weekly';
  if (frequency === 'monthly') return 'Monthly';
  return 'Prepaid package';
}

export default function NewRecurringPlanScreen() {
  const t = useTheme();
  const translate = useT();
  const toast = useToast();
  const { providerServiceId, packageId, packageQty, durationMin: durationMinParam, archetype: archetypeParam, description: descriptionParam, source } =
    useLocalSearchParams<{
      providerServiceId: string;
      packageId?: string;
      packageQty?: string;
      durationMin?: string;
      archetype?: string;
      description?: string;
      source?: string;
    }>();
  const recurringEnabled = useFeature('recurring_bookings');
  const featureFlags = useAppFeatureFlags();
  const stepKeys = getBookingStepKeys(featureFlags.isOn('booking_steps'), recurringEnabled);
  const steps = stepKeys?.map((key) => translate(key)) ?? null;
  const { location } = useSelectedLocation();
  const [service, setService] = useState<ProviderServiceWithProvider | null>(null);
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<ServicePackage | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [description, setDescription] = useState(descriptionParam ?? '');
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [intervalCount, setIntervalCount] = useState('1');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [monthDay, setMonthDay] = useState('1');
  const [customDates, setCustomDates] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [startHour, setStartHour] = useState<number>(WINDOW_START_HOURS[0]);
  const [durationMin, setDurationMin] = useState(durationMinParam ?? (packageId ? '60' : ''));
  const [endMode, setEndMode] = useState<EndMode>('none');
  const [endDate, setEndDate] = useState('');
  const [endDateMonthOffset, setEndDateMonthOffset] = useState(0);
  const [maxOccurrences, setMaxOccurrences] = useState('');
  const [quote, setQuote] = useState<RecurringQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const days = useMemo(() => nextDays(new Date(), 31), []);

  useEffect(() => {
    if (!providerServiceId) return;
    let active = true;
    setLoadError(null);
    getProviderService(providerServiceId)
      .then((row) => active && setService(row))
      .catch((error: Error) => active && setLoadError(error.message));
    if (archetypeParam === 'fixed') {
      setPackagesLoading(true);
      listFixedPackages(providerServiceId)
        .then((rows) => {
          if (!active) return;
          setPackages(rows);
          const preferred = rows.find((row) => row.id === packageId) ?? rows[0] ?? null;
          setSelectedPackage(preferred);
          const requestedQty = Number(packageQty);
          setQuantity(
            preferred
              ? Math.min(preferred.qty_max, Math.max(preferred.qty_min, Number.isInteger(requestedQty) ? requestedQty : preferred.qty_min))
              : 1,
          );
        })
        .catch((error: Error) => active && setLoadError(error.message))
        .finally(() => active && setPackagesLoading(false));
    }
    return () => {
      active = false;
    };
  }, [providerServiceId, archetypeParam, packageId, packageQty]);

  useEffect(() => {
    if (!startDate && days.length) setStartDate(istDateKey(days[1]?.date ?? days[0]!.date));
  }, [days, startDate]);

  useEffect(() => {
    setEndDateMonthOffset(0);
    setEndDate('');
  }, [startDate]);

  const category = service?.categories;
  const archetype: Archetype | null =
    archetypeParam === 'fixed' || category?.archetype === 'fixed'
      ? 'fixed'
      : archetypeParam === 'time_based' || category?.archetype === 'time_based'
        ? 'time_based'
        : null;
  const allowedFrequencies = (category?.allowed_frequencies ?? []).filter((value): value is Frequency =>
    FREQUENCIES.includes(value as Frequency),
  );
  useEffect(() => {
    if (allowedFrequencies.length && !allowedFrequencies.includes(frequency)) {
      setFrequency(allowedFrequencies[0]!);
    }
  }, [allowedFrequencies.join('|'), frequency]);
  const categoryEligible = !!category?.recurrence_allowed && allowedFrequencies.length > 0;
  const archetypeEnabled = !!archetype && featureFlags.archetypes?.[archetype] === true;
  const allowedBillingFrequencies = visibleBillingFrequencies(['per_visit']);
  const parsedInterval = Number(intervalCount);
  const parsedDuration = Number(durationMin);
  const parsedMonthDay = Number(monthDay);
  const parsedMaxOccurrences = Number(maxOccurrences);
  const recurrenceValid =
    (frequency !== 'weekly' || weekdays.length > 0) &&
    (frequency !== 'custom' || customDates.length > 0) &&
    (frequency !== 'monthly' || (Number.isInteger(parsedMonthDay) && parsedMonthDay >= 1 && parsedMonthDay <= 28)) &&
    (frequency !== 'weekly' && frequency !== 'monthly' ||
      Number.isInteger(parsedInterval) && parsedInterval >= 1 && parsedInterval <= 12) &&
    (endMode !== 'date' || (validDateKey(endDate) && endDate >= startDate)) &&
    (endMode !== 'count' || (Number.isInteger(parsedMaxOccurrences) && parsedMaxOccurrences >= 1 && parsedMaxOccurrences <= 400));
  const planInput = useMemo<RecurringPlanInput | null>(() => {
    if (!providerServiceId || !archetype || !startDate || !allowedFrequencies.includes(frequency)) return null;
    return {
      provider_service_id: providerServiceId,
      package_id: archetype === 'fixed' ? selectedPackage?.id ?? null : packageId || null,
      archetype,
      frequency,
      interval_count: frequency === 'weekly' || frequency === 'monthly' ? parsedInterval : 1,
      weekdays: frequency === 'weekly' ? weekdays : [],
      month_day: frequency === 'monthly' ? parsedMonthDay : null,
      custom_dates: frequency === 'custom' ? [...customDates].sort() : [],
      start_date: startDate,
      end_date: endMode === 'date' ? endDate : null,
      max_occurrences: endMode === 'count' ? parsedMaxOccurrences : null,
      start_time: timeValue(startHour),
      duration_min: archetype === 'time_based' && Number.isInteger(parsedDuration) && parsedDuration > 0 ? parsedDuration : null,
      package_qty: archetype === 'fixed' ? quantity : null,
      billing_frequency: allowedBillingFrequencies[0] ?? 'per_visit',
      address_id: location.addressId ?? '',
      description: description.trim(),
    };
  }, [
    providerServiceId,
    archetype,
    startDate,
    allowedFrequencies,
    frequency,
    selectedPackage?.id,
    parsedInterval,
    weekdays,
    parsedMonthDay,
    customDates,
    endMode,
    endDate,
    parsedMaxOccurrences,
    startHour,
    parsedDuration,
    quantity,
    allowedBillingFrequencies,
    location.addressId,
    description,
  ]);
  const canQuote =
    recurringEnabled &&
    categoryEligible &&
    archetypeEnabled &&
    !!planInput &&
    recurrenceValid &&
    (archetype !== 'fixed' || (!!selectedPackage && !packagesLoading)) &&
    allowedBillingFrequencies.includes('per_visit') &&
    (archetype !== 'time_based' || Number.isInteger(parsedDuration) && parsedDuration > 0);
  const quoteKey = planInput
    ? JSON.stringify({
        ...planInput,
        address_id: undefined,
        description: undefined,
      })
    : '';
  const quoteSummary = quote ? getRecurringQuoteSummary(quote) : null;
  const fourWeekEstimate = quoteSummary && planInput
    ? recurringFourWeekEstimate(quoteSummary, planInput)
    : null;
  const endDateOptions = useMemo(
    () => getRecurringEndDateOptions(startDate, endDateMonthOffset),
    [startDate, endDateMonthOffset],
  );

  useEffect(() => {
    if (!canQuote || !planInput) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }
    let active = true;
    setQuote(null);
    setQuoteError(null);
    const timer = setTimeout(() => {
      setQuoteLoading(true);
      void quoteRecurringPlan(planInput)
        .then((next) => {
          if (active) setQuote(next);
        })
        .catch((error: Error) => {
          if (active) {
            setQuote(null);
            setQuoteError(error.message);
          }
        })
        .finally(() => active && setQuoteLoading(false));
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [canQuote, quoteKey, quoteRetry]);

  const backToBooking = () => {
    if (router.canGoBack()) router.back();
    else if (source === 'book-fixed' || archetype === 'fixed') {
      router.replace({ pathname: '/book-fixed/[providerServiceId]', params: { providerServiceId: providerServiceId ?? '' } });
    } else {
      router.replace({ pathname: '/book/[providerServiceId]', params: { providerServiceId: providerServiceId ?? '' } });
    }
  };

  const toggleWeekday = (day: number) => {
    setWeekdays((current) =>
      current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort((a, b) => a - b),
    );
  };

  const submit = async () => {
    if (!planInput || !quote || !location.addressId || !location.line1 || !description.trim()) return;
    if (!recurringEnabled) {
      setQuoteError('Recurring bookings are turned off right now.');
      return;
    }
    setBusy(true);
    setRequestError(null);
    try {
      const id = await createRecurringPlan(planInput);
      toast({ message: 'Repeat plan request sent.', tone: 'success' });
      router.replace({ pathname: '/recurring/[id]', params: { id } });
    } catch (error) {
      setRequestError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!service) {
    const loadingContent = loadError ? (
      <ErrorState message={loadError} onRetry={() => router.replace({ pathname: '/recurring/new/[providerServiceId]', params: { providerServiceId: providerServiceId ?? '' } })} />
    ) : (
      <>
        <Skeleton height={72} radius={t.radii.lg} />
        <Skeleton height={180} radius={t.radii.lg} />
        <Skeleton height={140} radius={t.radii.lg} />
      </>
    );
    return (
      steps
        ? <BookingStepLayout title="Repeat service" steps={steps} current={0} footer={null} onBack={backToBooking}>{loadingContent}</BookingStepLayout>
        : <Screen header={<Header title="Repeat service" onBack={backToBooking} />}>{loadingContent}</Screen>
    );
  }

  const providerName = service.providers?.profiles?.full_name ?? 'provider';
  if (!recurringEnabled || !categoryEligible || !archetype || !archetypeEnabled) {
    return (
      <Screen header={<Header title="Repeat service" onBack={backToBooking} />}>
        <ErrorState title="Repeat plans unavailable" message="This service is not accepting repeat-plan requests right now." />
      </Screen>
    );
  }

  const requestDisabled = !quote || quoteLoading || !location.addressId || !location.line1 || !description.trim() || !planInput;
  const footerAbove = (
    <>
      {quoteSummary ? (
        <Card gap={t.spacing.xs}>
          <Text variant="subheadStrong">Price</Text>
          <Text variant="footnote" color="textSecondary">
            {formatINR(quoteSummary.perVisitPaise)} per visit
          </Text>
          {fourWeekEstimate ? (
            <Text variant="footnote" color="textSecondary">{fourWeekEstimate.label}</Text>
          ) : null}
          {quoteSummary.visitsTotal != null ? <Text variant="footnote" color="textSecondary">{quoteSummary.visitsTotal} visits in total</Text> : null}
          {quoteSummary.discountPaise > 0 ? <Text variant="footnote" color="textSecondary">Discount: −{formatINR(quoteSummary.discountPaise)}</Text> : null}
          <Text variant="footnote" color="textSecondary">Platform fee: {formatINR(quoteSummary.platformFeePaise)}</Text>
          {quoteSummary.gstPaise > 0 ? <Text variant="footnote" color="textSecondary">Taxes: {formatINR(quoteSummary.gstPaise)}</Text> : null}
          <Text variant="title3">
            Total per visit:{' '}
            {formatINR(quoteSummary.totalPaisePerCycle)}
          </Text>
          <Text variant="caption" color="muted">{frequencyLabel(quoteSummary.billingFrequency)}</Text>
          <Text variant="caption" color="muted">
            Next visits: {quoteSummary.firstDates.map(dateLabel).join(' · ')}
          </Text>
        </Card>
      ) : quoteLoading ? (
        <Skeleton height={96} radius={t.radii.lg} />
      ) : null}
      {requestError ? (
        <InlineAlert
          tone="danger"
          title="Could not send request"
          message={requestError}
          actionLabel="Try again"
          onAction={() => void submit()}
        />
      ) : null}
    </>
  );
  const requestAction = {
    title: `Send request to ${providerName}`,
    onPress: () => void submit(),
    loading: busy,
    disabled: requestDisabled,
  };
  const footer = steps ? (
    <PriceFooter
      caption={quoteSummary ? 'Total per visit' : 'Price'}
      amountLabel={quoteSummary ? formatINR(quoteSummary.totalPaisePerCycle) : ''}
      cta={requestAction}
      above={footerAbove}
    />
  ) : (
    <View style={{ gap: t.spacing.sm }}>
      {footerAbove}
      <Button {...requestAction} fullWidth size="lg" />
    </View>
  );
  const content = (
    <>
      <Text variant="footnote" color="textSecondary">
        Choose a schedule. {providerName} will review your repeat-plan request before visits are created.
      </Text>

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="title3">How often?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {allowedFrequencies.map((value) => (
            <Button
              key={value}
              title={FREQUENCY_LABELS[value]}
              variant={frequency === value ? 'primary' : 'outline'}
              onPress={() => setFrequency(value)}
            />
          ))}
        </View>
        {frequency === 'weekly' ? (
          <>
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button title="Mon–Sat" size="sm" variant="secondary" onPress={() => setWeekdays([1, 2, 3, 4, 5, 6])} />
              <Button title="Weekends" size="sm" variant="secondary" onPress={() => setWeekdays([6, 7])} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
              {WEEKDAYS.map(({ day, label }) => (
                <Button
                  key={day}
                  title={label}
                  size="sm"
                  variant={weekdays.includes(day) ? 'primary' : 'outline'}
                  onPress={() => toggleWeekday(day)}
                />
              ))}
            </View>
          </>
        ) : null}
        {frequency === 'weekly' || frequency === 'monthly' ? (
          <View style={{ gap: t.spacing.xs }}>
            <Text variant="footnoteStrong">{frequency === 'weekly' ? 'Every how many weeks?' : 'Every how many months?'}</Text>
            <TextInput
              value={intervalCount}
              onChangeText={setIntervalCount}
              keyboardType="number-pad"
              accessibilityLabel="Recurrence interval"
              style={{ borderWidth: 1, borderColor: t.colors.border, color: t.colors.text, borderRadius: t.radii.md, padding: t.spacing.md }}
            />
          </View>
        ) : null}
        {frequency === 'monthly' ? (
          <View style={{ gap: t.spacing.xs }}>
            <Text variant="footnoteStrong">Day of the month (1–28)</Text>
            <TextInput
              value={monthDay}
              onChangeText={setMonthDay}
              keyboardType="number-pad"
              accessibilityLabel="Day of the month"
              style={{ borderWidth: 1, borderColor: t.colors.border, color: t.colors.text, borderRadius: t.radii.md, padding: t.spacing.md }}
            />
          </View>
        ) : null}
        {frequency === 'custom' ? (
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="footnoteStrong">Choose visit dates</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
              {days.slice(1).map((day) => {
                const key = istDateKey(day.date);
                const selected = customDates.includes(key);
                return (
                  <Pressable key={key} onPress={() => setCustomDates((current) => selected ? current.filter((date) => date !== key) : [...current, key].sort())}>
                    <Card variant="outlined" padding={t.spacing.sm} style={{ borderColor: selected ? t.colors.primary : t.colors.border }}>
                      <Text variant="caption" color={selected ? 'primaryText' : 'text'}>{dateLabel(key)}</Text>
                    </Card>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="title3">When?</Text>
        <Text variant="footnoteStrong">Start date</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {days.slice(1, 15).map((day) => {
            const key = istDateKey(day.date);
            return (
              <Button
                key={key}
                title={dateLabel(key)}
                size="sm"
                variant={startDate === key ? 'primary' : 'outline'}
                onPress={() => setStartDate(key)}
              />
            );
          })}
        </View>
        <Text variant="footnoteStrong">Start time</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {WINDOW_START_HOURS.map((hour) => (
            <Button
              key={hour}
              title={`${String(hour).padStart(2, '0')}:00`}
              size="sm"
              variant={startHour === hour ? 'primary' : 'outline'}
              onPress={() => setStartHour(hour)}
            />
          ))}
        </View>
        {archetype === 'time_based' ? (
          <View style={{ gap: t.spacing.xs }}>
            {packageId ? (
              <>
                <Text variant="footnoteStrong">Selected service package</Text>
                <Text variant="footnote" color="textSecondary">
                  The server validates the package price and applies its configured visit duration.
                </Text>
                <Text variant="caption" color="muted">Visit duration: {durationMin || '60'} minutes</Text>
              </>
            ) : (
              <>
                <Text variant="footnoteStrong">Visit duration (minutes)</Text>
                <TextInput
                  value={durationMin}
                  onChangeText={setDurationMin}
                  keyboardType="number-pad"
                  placeholder="Enter the visit duration"
                  accessibilityLabel="Visit duration in minutes"
                  style={{ borderWidth: 1, borderColor: t.colors.border, color: t.colors.text, borderRadius: t.radii.md, padding: t.spacing.md }}
                />
              </>
            )}
          </View>
        ) : null}
      </View>

      {archetype === 'fixed' ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="title3">Package and quantity</Text>
          {packagesLoading ? <Skeleton height={120} radius={t.radii.lg} /> : null}
          {packages.map((item) => (
            <Pressable key={item.id} onPress={() => { setSelectedPackage(item); setQuantity(item.qty_min); }}>
              <Card variant="outlined" gap={t.spacing.xs} style={{ borderColor: selectedPackage?.id === item.id ? t.colors.primary : t.colors.border }}>
                <Text variant="subheadStrong">{item.title} · {formatINR(item.price ?? 0)}</Text>
                {item.description ? <Text variant="footnote" color="textSecondary">{item.description}</Text> : null}
                <Text variant="caption" color="muted">{item.duration_min ?? 60} min · {item.unit}</Text>
              </Card>
            </Pressable>
          ))}
          {!packagesLoading && packages.length === 0 ? (
            <InlineAlert tone="warning" title="No fixed packages" message="This provider has no active fixed-price package for repeat plans." />
          ) : null}
          {selectedPackage && selectedPackage.qty_max > selectedPackage.qty_min ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="calloutStrong">Quantity</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                <Button title="−" variant="secondary" onPress={() => setQuantity((value) => Math.max(selectedPackage.qty_min, value - 1))} disabled={quantity <= selectedPackage.qty_min} />
                <Text variant="title3">{quantity}</Text>
                <Button title="+" variant="secondary" onPress={() => setQuantity((value) => Math.min(selectedPackage.qty_max, value + 1))} disabled={quantity >= selectedPackage.qty_max} />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="title3">Until?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {([
            ['none', 'No end date'],
            ['date', 'End on a date'],
            ['count', 'Number of visits'],
          ] as const).map(([value, label]) => (
            <Button key={value} title={label} size="sm" variant={endMode === value ? 'primary' : 'outline'} onPress={() => setEndMode(value)} />
          ))}
        </View>
        {endMode === 'date' ? (
          <View style={{ gap: t.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
              <Button
                title="Previous month"
                size="sm"
                variant="outline"
                accessibilityLabel="Show previous month"
                disabled={endDateMonthOffset === 0}
                onPress={() => setEndDateMonthOffset((value) => Math.max(0, value - 1))}
              />
              <Text variant="footnoteStrong" accessibilityRole="header">{endDateOptions.monthLabel}</Text>
              <Button
                title="Next month"
                size="sm"
                variant="outline"
                accessibilityLabel="Show next month"
                disabled={getRecurringEndDateOptions(startDate, endDateMonthOffset + 1).dates.length === 0}
                onPress={() => setEndDateMonthOffset((value) => value + 1)}
              />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
              {endDateOptions.dates.map((date) => (
                <Button
                  key={date}
                  title={dateLabel(date)}
                  size="sm"
                  variant={endDate === date ? 'primary' : 'outline'}
                  accessibilityLabel={`Choose plan end date ${dateLabel(date)}`}
                  onPress={() => setEndDate(date)}
                />
              ))}
            </View>
          </View>
        ) : null}
        {endMode === 'count' ? (
          <TextInput
            value={maxOccurrences}
            onChangeText={setMaxOccurrences}
            keyboardType="number-pad"
            placeholder="Number of visits"
            accessibilityLabel="Maximum visits"
            style={{ borderWidth: 1, borderColor: t.colors.border, color: t.colors.text, borderRadius: t.radii.md, padding: t.spacing.md }}
          />
        ) : null}
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="title3">Address and instructions</Text>
        <Card gap={t.spacing.sm}>
          <Text variant="calloutStrong">{location.label ?? 'Service address'}</Text>
          <Text variant="footnote" color="textSecondary">
            {location.line1 ? `${location.line1}, ${location.city}` : 'Add a saved address to continue.'}
          </Text>
          <Button title="Change address" variant="outline" onPress={() => router.push('/location')} />
        </Card>
        <TextArea
          label="Instructions (required)"
          placeholder="Add instructions for the provider"
          value={description}
          onChangeText={setDescription}
          maxLength={500}
          accessibilityLabel="Instructions for the provider"
        />
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="title3">Payment</Text>
        <Card gap={t.spacing.xs}>
          {allowedBillingFrequencies.map((value) => (
            <Text key={value} variant="calloutStrong">{frequencyLabel(value)}</Text>
          ))}
          <Text variant="caption" color="muted">You pay each visit separately, up to 2 days before it. Unpaid visits are released.</Text>
        </Card>
      </View>

      {quoteError ? (
        <InlineAlert
          tone="danger"
          title="Could not get a quote"
          message={quoteError}
          actionLabel="Retry quote"
          onAction={() => setQuoteRetry((value) => value + 1)}
        />
      ) : null}
      {loadError ? <InlineAlert tone="danger" title="Could not load service" message={loadError} /> : null}
    </>
  );
  return steps ? (
    <BookingStepLayout title="Repeat service" steps={steps} current={0} footer={footer} onBack={backToBooking}>
      {content}
    </BookingStepLayout>
  ) : (
    <Screen header={<Header title="Repeat service" onBack={backToBooking} />} gap={t.spacing.lg} footer={footer}>
      {content}
    </Screen>
  );
}

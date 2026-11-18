import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { StatusPill } from '../src/components/status';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, SkeletonCard, Text } from '../src/components/ui';
import { getMyProviderBusinessContext } from '../src/features/merchantStaff/api';
import { listProviderRecurringSchedule } from '../src/features/recurring/providerApi';
import {
  canShowProviderCalendar,
  providerCalendarRange,
  providerDateKey,
} from '../src/features/recurring/providerPresentation';
import { useAppFeatureFlags } from '../src/lib/featureFlags';
import { onboardingApi } from '../src/lib/onboarding';
import type { BookingStatus } from '../src/lib/types';
import { useTheme } from '../src/theme';
import type { ProviderRecurringScheduleItem } from '../src/features/recurring/providerTypes';

type ViewMode = 'day' | 'week';

function dateTitle(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  return date.toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function normalizedParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function MerchantCalendarScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ providerId?: string | string[] }>();
  const requestedProviderId = normalizedParam(params.providerId);
  const flags = useAppFeatureFlags();
  const calendarEnabled = canShowProviderCalendar({
    merchant_calendar: flags.isOn('merchant_calendar'),
    recurring_bookings: flags.isOn('recurring_bookings'),
  });
  const [mode, setMode] = useState<ViewMode>('week');
  const [offset, setOffset] = useState(0);
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [items, setItems] = useState<ProviderRecurringScheduleItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  const load = useCallback(async () => {
    if (!calendarEnabled) return;
    setLoading(true);
    setError(null);
    setScheduleError(null);
    try {
      const business = await getMyProviderBusinessContext(requestedProviderId);
      if (!business) throw new Error('Provider business was not found.');
      setProviderId(business.id);

      let nextTimezone = 'Asia/Kolkata';
      try {
        const availability = await onboardingApi.getProviderSchedule(business.id);
        nextTimezone = availability?.timezone ?? nextTimezone;
      } catch (scheduleFailure) {
        setScheduleError((scheduleFailure as Error).message);
      }
      setTimezone(nextTimezone);

      const today = providerDateKey(new Date(), nextTimezone);
      const nextRange = providerCalendarRange(today, mode, offset);
      setRange(nextRange);
      setItems(await listProviderRecurringSchedule(business.id, nextRange.from, nextRange.to));
    } catch (loadFailure) {
      setItems(null);
      setError((loadFailure as Error).message);
    } finally {
      setLoading(false);
    }
  }, [calendarEnabled, mode, offset, requestedProviderId]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const groupedItems = useMemo(() => {
    const groups = new Map<string, ProviderRecurringScheduleItem[]>();
    for (const item of items ?? []) {
      const date = providerDateKey(new Date(item.scheduled_at), timezone);
      groups.set(date, [...(groups.get(date) ?? []), item]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items, timezone]);

  const openVisit = (item: ProviderRecurringScheduleItem) => router.push({
    pathname: '/merchant-job/[id]',
    params: { id: item.id },
  });
  const openPlan = (item: ProviderRecurringScheduleItem) => router.push({
    pathname: '/recurring/provider/[id]',
    params: { id: item.recurring_schedule_id, providerId: providerId ?? undefined },
  });

  if (!calendarEnabled) {
    return (
      <Screen header={<Header title="Recurring calendar" onBack={() => router.back()} />}>
        <InlineAlert message="The provider calendar is unavailable while merchant calendar or recurring bookings is turned off." />
      </Screen>
    );
  }

  return (
    <Screen
      header={<Header title="Recurring calendar" subtitle="Provider visits by day or week" onBack={() => router.back()} />}
      gap={t.spacing.md}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      {scheduleError ? <InlineAlert message={`Provider timezone could not be loaded; using Asia/Kolkata. ${scheduleError}`} /> : null}
      <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
        <Button
          title="Day"
          variant={mode === 'day' ? 'primary' : 'outline'}
          accessibilityLabel={mode === 'day' ? 'Day view, selected' : 'Show calendar by day'}
          onPress={() => {
            setMode('day');
            setOffset(0);
          }}
        />
        <Button
          title="Week"
          variant={mode === 'week' ? 'primary' : 'outline'}
          accessibilityLabel={mode === 'week' ? 'Week view, selected' : 'Show calendar by week'}
          onPress={() => {
            setMode('week');
            setOffset(0);
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <Button title="Previous" variant="outline" accessibilityHint={`Go to the previous ${mode}`} onPress={() => setOffset((value) => value - 1)} />
        <Text variant="subheadStrong" align="center" accessibilityRole="header">
          {range ? (range.from === range.to
            ? dateTitle(range.from)
            : `${dateTitle(range.from)} – ${dateTitle(range.to)}`) : 'Loading dates'}
        </Text>
        <Button title="Next" variant="outline" accessibilityHint={`Go to the next ${mode}`} onPress={() => setOffset((value) => value + 1)} />
      </View>

      {loading && items == null ? (
        <SkeletonCard lines={3} />
      ) : error && items == null ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !items?.length ? (
        <EmptyState title="No recurring visits" message="There are no recurring visits in this period." />
      ) : (
        groupedItems.map(([date, dayItems]) => (
          <View key={date} style={{ gap: t.spacing.sm }}>
            <Text variant="title3" accessibilityRole="header">{dateTitle(date)}</Text>
            {dayItems.map((item) => (
              <Card key={item.id} gap={t.spacing.sm}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm }}>
                  <Text variant="calloutStrong" style={{ flex: 1 }}>{item.service_name}</Text>
                  <StatusPill status={item.status as BookingStatus} />
                </View>
                <Text variant="footnote" color="muted">
                  {new Date(item.scheduled_at).toLocaleTimeString('en-IN', {
                    timeZone: timezone,
                    hour: 'numeric',
                    minute: '2-digit',
                  })} · {item.frequency.replace(/_/g, ' ')}
                </Text>
                <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                  <Button
                    title="Open visit"
                    accessibilityHint="Opens the existing merchant job screen"
                    onPress={() => openVisit(item)}
                  />
                  <Button
                    title="Plan details"
                    variant="outline"
                    accessibilityHint="Opens this recurring plan and its visits"
                    onPress={() => openPlan(item)}
                  />
                </View>
              </Card>
            ))}
          </View>
        ))
      )}
      {error && items != null ? <InlineAlert message={error} /> : null}
    </Screen>
  );
}

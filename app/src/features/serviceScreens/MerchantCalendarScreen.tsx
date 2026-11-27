import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { StatusPill } from '../../components/status';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, SkeletonCard, Text } from '../../components/ui';
import { getMyProviderBusinessContext, listMyBusinessMemberships } from '../merchantStaff/api';
import { listProviderRecurringSchedule } from '../recurring/providerApi';
import {
  canShowProviderCalendar,
  providerCalendarVisitRoute,
  providerCalendarRange,
  providerDateKey,
} from '../recurring/providerPresentation';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { formatINR } from '../../lib/money';
import { useAuth } from '../../lib/auth';
import { onboardingApi } from '../../lib/onboarding';
import { useBrandIdentity } from '../../branding/useBrandIdentity';
import type { BookingStatus } from '../../lib/types';
import { useTheme } from '../../theme';
import type { ProviderRecurringScheduleItem } from '../recurring/providerTypes';
import { useFocusedServiceRefresh } from '../serviceLifecycle/useFocusedServiceRefresh';

type ViewMode = 'day' | 'week';
type CalendarSection = 'business' | 'toolbar' | 'visits';

export function calendarLayoutOrder(layoutEnabled: boolean): CalendarSection[] {
  return layoutEnabled
    ? ['business', 'toolbar', 'visits']
    : ['toolbar', 'visits'];
}

export function providerCalendarPlanRoute(recurringScheduleId: string, providerId: string | null) {
  return {
    pathname: '/recurring/provider/[id]' as const,
    params: { id: recurringScheduleId, providerId: providerId ?? undefined },
  };
}

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

function useMerchantCalendarController() {
  const t = useTheme();
  const identity = useBrandIdentity('recurring');
  const { userId } = useAuth();
  const params = useLocalSearchParams<{ providerId?: string | string[] }>();
  const requestedProviderId = normalizedParam(params.providerId);
  const flags = useAppFeatureFlags();
  const layoutEnabled = flags.isOn('oorva_recurring_ux');
  const calendarEnabled = canShowProviderCalendar({
    merchant_calendar: flags.isOn('merchant_calendar'),
    recurring_bookings: flags.isOn('recurring_bookings'),
  });
  const [mode, setMode] = useState<ViewMode>('week');
  const [offset, setOffset] = useState(0);
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [businessCity, setBusinessCity] = useState<string | null>(null);
  const [items, setItems] = useState<ProviderRecurringScheduleItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    if (!guard.isCurrent() || !calendarEnabled) return;
    setLoading(true);
    setError(null);
    setScheduleError(null);
    try {
      const business = await getMyProviderBusinessContext(requestedProviderId);
      if (!guard.isCurrent()) return;
      if (!business) throw new Error('Provider business was not found.');
      const memberships = layoutEnabled
        ? await listMyBusinessMemberships().catch(() => [])
        : [];
      if (!guard.isCurrent()) return;
      const membership = memberships.find(
        (item) => item.business_type === 'provider' && item.business_id === business.id,
      );

      let nextTimezone = 'Asia/Kolkata';
      let nextScheduleError: string | null = null;
      try {
        const availability = await onboardingApi.getProviderSchedule(business.id);
        if (!guard.isCurrent()) return;
        nextTimezone = availability?.timezone ?? nextTimezone;
      } catch (scheduleFailure) {
        if (!guard.isCurrent()) return;
        nextScheduleError = (scheduleFailure as Error).message;
      }

      const today = providerDateKey(new Date(), nextTimezone);
      const nextRange = providerCalendarRange(today, mode, offset);
      const nextItems = await listProviderRecurringSchedule(business.id, nextRange.from, nextRange.to);
      if (!guard.isCurrent()) return;

      setProviderId(business.id);
      setBusinessName(membership?.business_name.trim() || null);
      setBusinessCity(business.city?.trim() || null);
      setTimezone(nextTimezone);
      setRange(nextRange);
      setItems(nextItems);
      setScheduleError(nextScheduleError);
    } catch (loadFailure) {
      if (guard.isCurrent()) setError((loadFailure as Error).message);
    } finally {
      if (guard.isCurrent()) setLoading(false);
    }
  }, [calendarEnabled, layoutEnabled, mode, offset, requestedProviderId]);

  const contextKey = `merchant-calendar:${userId ?? 'anonymous'}:${requestedProviderId ?? ''}:${mode}:${offset}`;
  const { refresh, refreshing } = useFocusedServiceRefresh(load, {
    contextKey,
    enabled: calendarEnabled,
    intervalMs: 30_000,
  });

  const groupedItems = useMemo(() => {
    const groups = new Map<string, ProviderRecurringScheduleItem[]>();
    for (const item of items ?? []) {
      const date = providerDateKey(new Date(item.scheduled_at), timezone);
      groups.set(date, [...(groups.get(date) ?? []), item]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items, timezone]);

  const openVisit = (item: ProviderRecurringScheduleItem) => router.push(providerCalendarVisitRoute(item.id));
  const openPlan = (item: ProviderRecurringScheduleItem) =>
    router.push(providerCalendarPlanRoute(item.recurring_schedule_id, providerId));

  return {
    t,
    identity,
    layoutEnabled,
    calendarEnabled,
    businessName,
    businessCity,
    mode,
    setMode,
    offset,
    setOffset,
    timezone,
    items,
    loading,
    refreshing,
    error,
    scheduleError,
    range,
    groupedItems,
    refresh,
    openVisit,
    openPlan,
  };
}

export default function MerchantCalendarScreen() {
  const calendar = useMerchantCalendarController();
  const { t } = calendar;

  if (!calendar.calendarEnabled) {
    return (
      <Screen header={<Header title="Recurring calendar" onBack={() => router.back()} />}>
        <InlineAlert message="The provider calendar is unavailable while merchant calendar or recurring bookings is turned off." />
      </Screen>
    );
  }

  const legacyToolbar = (
    <View style={{ gap: t.spacing.md }}>
      <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
        <Button
          title="Day"
          variant={calendar.mode === 'day' ? 'primary' : 'outline'}
          accessibilityLabel={calendar.mode === 'day' ? 'Day view, selected' : 'Show calendar by day'}
          onPress={() => {
            calendar.setMode('day');
            calendar.setOffset(0);
          }}
        />
        <Button
          title="Week"
          variant={calendar.mode === 'week' ? 'primary' : 'outline'}
          accessibilityLabel={calendar.mode === 'week' ? 'Week view, selected' : 'Show calendar by week'}
          onPress={() => {
            calendar.setMode('week');
            calendar.setOffset(0);
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <Button title="Previous" variant="outline" accessibilityHint={`Go to the previous ${calendar.mode}`} onPress={() => calendar.setOffset((value) => value - 1)} />
        <Text variant="subheadStrong" align="center" accessibilityRole="header">
          {calendar.range ? (calendar.range.from === calendar.range.to
            ? dateTitle(calendar.range.from)
            : `${dateTitle(calendar.range.from)} – ${dateTitle(calendar.range.to)}`) : 'Loading dates'}
        </Text>
        <Button title="Next" variant="outline" accessibilityHint={`Go to the next ${calendar.mode}`} onPress={() => calendar.setOffset((value) => value + 1)} />
      </View>
    </View>
  );
  const compactToolbar = (
    <Card gap={t.spacing.xs}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: t.spacing.xs }}>
          <Button
            title="Day"
            size="sm"
            variant={calendar.mode === 'day' ? 'primary' : 'outline'}
            accessibilityLabel={calendar.mode === 'day' ? 'Day view, selected' : 'Show calendar by day'}
            onPress={() => {
              calendar.setMode('day');
              calendar.setOffset(0);
            }}
          />
          <Button
            title="Week"
            size="sm"
            variant={calendar.mode === 'week' ? 'primary' : 'outline'}
            accessibilityLabel={calendar.mode === 'week' ? 'Week view, selected' : 'Show calendar by week'}
            onPress={() => {
              calendar.setMode('week');
              calendar.setOffset(0);
            }}
          />
        </View>
        <Text variant="footnoteStrong" accessibilityRole="header">
          {calendar.range ? (calendar.range.from === calendar.range.to
            ? dateTitle(calendar.range.from)
            : `${dateTitle(calendar.range.from)} – ${dateTitle(calendar.range.to)}`) : 'Loading dates'}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <Button title="Previous" size="sm" variant="outline" accessibilityHint={`Go to the previous ${calendar.mode}`} onPress={() => calendar.setOffset((value) => value - 1)} />
        <Button title="Next" size="sm" variant="outline" accessibilityHint={`Go to the next ${calendar.mode}`} onPress={() => calendar.setOffset((value) => value + 1)} />
      </View>
    </Card>
  );
  const businessContext = (
    <Card gap={t.spacing.xs}>
      <Text variant="captionStrong">{calendar.businessName ?? `${calendar.identity.displayName} provider calendar`}</Text>
      <Text variant="footnote" color="muted">
        {[calendar.businessCity, calendar.timezone].filter(Boolean).join(' · ')}
      </Text>
      {calendar.layoutEnabled && calendar.scheduleError ? (
        <InlineAlert message={`Provider timezone could not be loaded; using Asia/Kolkata. ${calendar.scheduleError}`} />
      ) : null}
    </Card>
  );
  const visits = calendar.loading && calendar.items == null ? (
    <SkeletonCard lines={3} />
  ) : calendar.error && calendar.items == null ? (
    <ErrorState message={calendar.error} onRetry={() => void calendar.refresh()} />
  ) : !calendar.items?.length ? (
    <EmptyState title="No recurring visits" message="There are no recurring visits in this period." />
  ) : (
    calendar.groupedItems.map(([date, dayItems]) => (
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
                timeZone: calendar.timezone,
                hour: 'numeric',
                minute: '2-digit',
              })} · {item.frequency.replace(/_/g, ' ')}
            </Text>
            {item.total_amount != null ? (
              <Text variant="footnoteStrong">{formatINR(item.total_amount)}</Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button
                title="Open visit"
                accessibilityHint="Opens the booking workflow with visit actions"
                onPress={() => calendar.openVisit(item)}
              />
              <Button
                title="Plan details"
                variant="outline"
                accessibilityHint="Opens this recurring plan and its visits"
                onPress={() => calendar.openPlan(item)}
              />
            </View>
          </Card>
        ))}
      </View>
    ))
  );
  const sections = {
    business: businessContext,
    toolbar: calendar.layoutEnabled ? compactToolbar : legacyToolbar,
    visits,
  };

  return (
    <Screen
      header={<Header title="Recurring calendar" subtitle="Provider visits by day or week" onBack={() => router.back()} />}
      gap={t.spacing.md}
      refreshing={calendar.loading || calendar.refreshing}
      onRefresh={() => void calendar.refresh()}
    >
      {!calendar.layoutEnabled && calendar.scheduleError ? <InlineAlert message={`Provider timezone could not be loaded; using Asia/Kolkata. ${calendar.scheduleError}`} /> : null}
      {calendarLayoutOrder(calendar.layoutEnabled).map((section) => (
        <View key={section} testID={`calendar-section-${section}`} style={section === 'toolbar' || section === 'visits' ? { gap: t.spacing.md } : undefined}>
          {sections[section]}
        </View>
      ))}
      {calendar.error && calendar.items != null ? <InlineAlert message={calendar.error} /> : null}
    </Screen>
  );
}

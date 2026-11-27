import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { StatusPill } from '../../components/status';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, SkeletonCard, Text, TextArea } from '../../components/ui';
import {
  getMyProviderBusinessContext,
  listMyBusinessMemberships,
  type BusinessProviderContext,
} from '../merchantStaff/api';
import {
  getProviderRecurringPlan,
  reportProviderAbsence,
  requestVisitReschedule,
  respondVisitReschedule,
} from '../recurring/providerApi';
import {
  canUseRecurringReschedule,
  canManageRecurringPlanContext,
  canRequestRecurringReschedule,
  findTimeOffVisits,
  formatRecurrence,
  nextProviderDateKeys,
  providerDateTimeIso,
  providerVisitSections,
  recurringPlanEarningsLabel,
} from '../recurring/providerPresentation';
import type { RecurringOccurrence, RecurringPlanPayload } from '../recurring/providerTypes';
import { useAuth } from '../../lib/auth';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { onboardingApi } from '../../lib/onboarding';
import type { BookingStatus } from '../../lib/types';
import { useTheme } from '../../theme';
import { WINDOW_START_HOURS } from '../../lib/schedule';
import { resolvePendingRescheduleChanges } from '../recurring/customerPresentation';
import { useFocusedServiceRefresh } from '../serviceLifecycle/useFocusedServiceRefresh';
import { useBrandIdentity } from '../../branding/useBrandIdentity';

const REPORTABLE_STATUSES = new Set(['pending_payment', 'requested', 'accepted', 'confirmed']);
type ProviderPlanSection = 'business' | 'plan' | 'conflicts' | 'decisions' | 'upcoming' | 'completed' | 'history';

export function providerPlanLayoutOrder(layoutEnabled: boolean): ProviderPlanSection[] {
  return layoutEnabled
    ? ['business', 'plan', 'conflicts', 'decisions', 'upcoming', 'completed', 'history']
    : ['conflicts', 'plan', 'upcoming', 'completed', 'history'];
}

export function providerBusinessSummary(
  businessName: string | null,
  city: string | null,
  timezone: string,
): string {
  return [businessName || 'Provider business', city, timezone].filter(Boolean).join(' · ');
}

function normalizedParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function visitTime(occurrence: RecurringOccurrence, timezone: string): string {
  if (!Number.isFinite(Date.parse(occurrence.scheduled_at))) return 'Visit time unavailable';
  return new Date(occurrence.scheduled_at).toLocaleString('en-IN', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function dateChipLabel(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00.000Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function useRecurringProviderDetailController() {
  const t = useTheme();
  const identity = useBrandIdentity('recurring');
  const params = useLocalSearchParams<{ id?: string | string[]; providerId?: string | string[] }>();
  const id = normalizedParam(params.id);
  const requestedProviderId = normalizedParam(params.providerId);
  const { userId } = useAuth();
  const flags = useAppFeatureFlags();
  const layoutEnabled = flags.isOn('oorva_recurring_ux');
  const rescheduleEnabled = canUseRecurringReschedule({
    recurring_bookings: flags.isOn('recurring_bookings'),
    recurring_reschedule: flags.isOn('recurring_reschedule'),
  });
  const [payload, setPayload] = useState<RecurringPlanPayload | null>(null);
  const [provider, setProvider] = useState<BusinessProviderContext | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<Awaited<ReturnType<typeof onboardingApi.getProviderSchedule>>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [absenceFor, setAbsenceFor] = useState<string | null>(null);
  const [absenceReason, setAbsenceReason] = useState('');
  const [rescheduleFor, setRescheduleFor] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newHour, setNewHour] = useState<number | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState('');

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    if (!guard.isCurrent()) return;
    if (!id) {
      setError('Recurring plan ID is missing.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setContextError(null);
    setScheduleError(null);
    try {
      const nextPayload = await getProviderRecurringPlan(id);
      if (!guard.isCurrent()) return;
      setPayload(nextPayload);
      if (requestedProviderId && requestedProviderId !== nextPayload.plan.provider_id) {
        setProvider(null);
        setSchedule(null);
        setContextError('The provider route does not match this recurring plan.');
        return;
      }
      const providerId = nextPayload.plan.provider_id;
      const [contextResult, scheduleResult, membershipsResult] = await Promise.allSettled([
        getMyProviderBusinessContext(providerId),
        onboardingApi.getProviderSchedule(nextPayload.plan.provider_id),
        layoutEnabled ? listMyBusinessMemberships() : Promise.resolve([]),
      ]);
      if (!guard.isCurrent()) return;
      if (contextResult.status === 'fulfilled') {
        setProvider(contextResult.value);
      } else {
        setProvider(null);
        setContextError((contextResult.reason as Error).message);
      }
      if (scheduleResult.status === 'fulfilled') {
        setSchedule(scheduleResult.value);
      } else {
        setSchedule(null);
        setScheduleError((scheduleResult.reason as Error).message);
      }
      if (membershipsResult.status === 'fulfilled') {
        const membership = membershipsResult.value.find(
          (item) => item.business_type === 'provider' && item.business_id === providerId,
        );
        setBusinessName(membership?.business_name.trim() || null);
      } else {
        setBusinessName(null);
      }
    } catch (loadFailure) {
      if (guard.isCurrent()) setError((loadFailure as Error).message);
    } finally {
      if (guard.isCurrent()) setLoading(false);
    }
  }, [id, layoutEnabled, requestedProviderId]);

  const { refresh, refreshing } = useFocusedServiceRefresh(load, {
    contextKey: `provider-plan:${userId ?? 'anonymous'}:${id ?? ''}:${requestedProviderId ?? ''}`,
    enabled: true,
    intervalMs: id ? 30_000 : null,
  });

  const plan = payload?.plan;
  const canManage = !!plan && canManageRecurringPlanContext(
    plan.provider_id,
    requestedProviderId,
    provider?.id ?? null,
    provider?.business_role ?? null,
  );
  const timezone = schedule?.timezone ?? plan?.timezone ?? 'Asia/Kolkata';
  const rescheduleDates = useMemo(() => nextProviderDateKeys(timezone, new Date(), 14), [timezone]);
  const visitSections = useMemo(
    () => providerVisitSections(payload?.occurrences ?? []),
    [payload],
  );
  const affected = useMemo(
    () => findTimeOffVisits(payload ? [payload] : [], schedule, Date.now()),
    [payload, schedule],
  );
  const rescheduleRequests = useMemo(
    () => plan
      ? resolvePendingRescheduleChanges(
          payload?.changes ?? [],
          plan.customer_id,
          userId,
          canManage ? 'provider_manager' : 'other',
        )
      : [],
    [payload, plan, userId, canManage],
  );
  const reportableIds = new Set(affected.map(({ occurrence }) => occurrence.id));

  const runAction = async (bookingId: string, action: () => Promise<unknown>) => {
    setBusyId(bookingId);
    setError(null);
    try {
      await action();
      setAbsenceFor(null);
      setAbsenceReason('');
      setRescheduleFor(null);
      setNewDate('');
      setNewHour(null);
      setRescheduleReason('');
      await refresh();
    } catch (actionFailure) {
      setError((actionFailure as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const submitReschedule = (bookingId: string) => {
    const visit = payload?.occurrences.find((occurrence) => occurrence.id === bookingId);
    if (!visit || !canRequestRecurringReschedule(visit)) {
      setError('This visit is past the server reschedule cutoff or cannot be rescheduled.');
      return;
    }
    if (!newDate || newHour == null) {
      setError('Choose a new date and time.');
      return;
    }
    const newAt = providerDateTimeIso(newDate, newHour, timezone);
    const parsed = newAt ? Date.parse(newAt) : Number.NaN;
    if (!newAt || !Number.isFinite(parsed) || parsed <= Date.now() + 60 * 60 * 1000) {
      setError('Choose a provider-local time more than 60 minutes from now.');
      return;
    }
    void runAction(bookingId, () => requestVisitReschedule(bookingId, newAt, rescheduleReason.trim()));
  };

  const openVisit = (bookingId: string) => router.push({
    pathname: '/booking/[id]',
    params: { id: bookingId },
  });

  const renderVisit = (visit: RecurringOccurrence, showDecisionControls = true) => {
    const pendingRequests = rescheduleRequests.filter((request) => request.change.booking_id === visit.id);
    const customerRequest = pendingRequests.find((request) => request.requester === 'customer');
    const providerRequest = pendingRequests.find((request) => request.requester === 'provider');
    const canReport = canManage && REPORTABLE_STATUSES.has(visit.status) && Date.parse(visit.scheduled_at) > Date.now();
    const canRequestReschedule = canManage &&
      rescheduleEnabled &&
      plan?.capabilities?.can_reschedule === true &&
      canRequestRecurringReschedule(visit);
    return (
      <Card key={visit.id} gap={t.spacing.sm}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm }}>
          <Text variant="calloutStrong" style={{ flex: 1 }}>{visitTime(visit, timezone)}</Text>
          <StatusPill status={visit.status as BookingStatus} />
        </View>
        <Button
          title={visit.status === 'in_progress' ? 'Manage / complete visit' : 'Open visit'}
          variant="outline"
          accessibilityHint="Opens the existing booking workflow for this visit"
          onPress={() => openVisit(visit.id)}
        />
        {canReport ? (
          absenceFor === visit.id ? (
            <>
              <TextArea
                label="Reason for provider absence"
                accessibilityLabel="Reason for provider absence"
                value={absenceReason}
                onChangeText={setAbsenceReason}
                maxLength={300}
                placeholder="Tell the customer why you are unavailable"
              />
              <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                <Button
                  title="Cancel"
                  variant="outline"
                  disabled={busyId === visit.id}
                  onPress={() => {
                    setAbsenceFor(null);
                    setAbsenceReason('');
                  }}
                />
                <Button
                  title="Report absence"
                  variant="destructive"
                  loading={busyId === visit.id}
                  disabled={!absenceReason.trim()}
                  onPress={() => void runAction(visit.id, () => reportProviderAbsence(visit.id, absenceReason.trim()))}
                />
              </View>
            </>
          ) : (
            <Button
              title={reportableIds.has(visit.id) ? 'Report time-off absence' : 'Report absence'}
              variant="destructive"
              disabled={!!busyId}
              onPress={() => setAbsenceFor(visit.id)}
            />
          )
        ) : null}
        {canRequestReschedule ? (
          rescheduleFor === visit.id ? (
            <>
              <Text variant="footnoteStrong">New date · {timezone}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                {rescheduleDates.map((date) => (
                  <Button
                    key={date}
                    title={dateChipLabel(date)}
                    size="sm"
                    variant={newDate === date ? 'primary' : 'outline'}
                    accessibilityLabel={`Choose ${dateChipLabel(date)}`}
                    onPress={() => setNewDate(date)}
                  />
                ))}
              </View>
              <Text variant="footnoteStrong">New time · provider local time</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                {WINDOW_START_HOURS.map((hour) => (
                  <Button
                    key={hour}
                    title={`${String(hour).padStart(2, '0')}:00`}
                    size="sm"
                    variant={newHour === hour ? 'primary' : 'outline'}
                    accessibilityLabel={`Choose ${String(hour).padStart(2, '0')}:00 in ${timezone}`}
                    onPress={() => setNewHour(hour)}
                  />
                ))}
              </View>
              <Text variant="caption" color="muted">
                The server rechecks provider hours, conflicts, and the 60-minute lead.
              </Text>
              <TextArea
                label="Reason for rescheduling"
                accessibilityLabel="Reason for rescheduling"
                value={rescheduleReason}
                onChangeText={setRescheduleReason}
                maxLength={300}
                placeholder="Explain the requested change"
              />
              <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                <Button
                  title="Cancel"
                  variant="outline"
                  disabled={busyId === visit.id}
                  onPress={() => {
                    setRescheduleFor(null);
                    setNewDate('');
                    setNewHour(null);
                    setRescheduleReason('');
                  }}
                />
                <Button
                  title="Request reschedule"
                  loading={busyId === visit.id}
                  disabled={!newDate || newHour == null || !rescheduleReason.trim()}
                  onPress={() => submitReschedule(visit.id)}
                />
              </View>
            </>
          ) : (
            <Button
              title="Request reschedule"
              variant="outline"
              disabled={!!busyId}
              onPress={() => setRescheduleFor(visit.id)}
            />
          )
        ) : null}
        {showDecisionControls && customerRequest?.canRespond && rescheduleEnabled && canManage && plan?.capabilities?.can_reschedule === true ? (
          <Card gap={t.spacing.xs}>
            <Text variant="subheadStrong">Customer requested a new time</Text>
            <Text variant="footnote" color="muted">
              {customerRequest.change.new_at ? new Date(customerRequest.change.new_at).toLocaleString('en-IN', { timeZone: timezone }) : 'Requested time unavailable'}
            </Text>
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button
                title="Decline time"
                variant="outline"
                disabled={!!busyId}
                onPress={() => void runAction(visit.id, () => respondVisitReschedule(customerRequest.change.id, false))}
              />
              <Button
                title="Accept time"
                loading={busyId === visit.id}
                disabled={!!busyId}
                onPress={() => void runAction(visit.id, () => respondVisitReschedule(customerRequest.change.id, true))}
              />
            </View>
          </Card>
        ) : showDecisionControls && providerRequest ? (
          <InlineAlert message="Waiting for the customer to respond to your reschedule request." />
        ) : null}
      </Card>
    );
  };

  const businessSection = (
    <Card gap={t.spacing.xs}>
      <Text variant="captionStrong">{identity.displayName} provider business</Text>
      <Text variant="footnote" color="muted">
        {providerBusinessSummary(businessName, provider?.city ?? null, timezone)}
      </Text>
    </Card>
  );
  const planSection = plan ? (
    <Card gap={t.spacing.xs}>
      <Text variant="title3">{formatRecurrence(plan)}</Text>
      <Text variant="footnote" color="muted">Status: {plan.status} · Provider decision: {plan.provider_acceptance}</Text>
      <Text variant="footnote" color="muted">Starts {plan.starts_on} at {plan.start_time} ({timezone})</Text>
      {plan.ends_on ? <Text variant="footnote" color="muted">Ends {plan.ends_on}</Text> : null}
      {layoutEnabled && recurringPlanEarningsLabel(plan) ? (
        <Text variant="footnoteStrong">{recurringPlanEarningsLabel(plan)}</Text>
      ) : null}
    </Card>
  ) : null;
  const conflictsSection = (
    <View style={{ gap: t.spacing.md }}>
      {!flags.isOn('recurring_bookings') ? (
        <InlineAlert message="New recurring actions are turned off. Existing plan and visit records remain available." />
      ) : null}
      {contextError ? <InlineAlert message={`Business permissions could not be loaded: ${contextError}`} /> : null}
      {scheduleError ? <InlineAlert message={`Provider time-off status could not be loaded: ${scheduleError}`} /> : null}
      {error ? <InlineAlert message={error} /> : null}
      {affected.length > 0 ? (
        <InlineAlert
          tone="warning"
          title="Recurring visits overlap provider time off"
          message={`${affected.length} future visit${affected.length === 1 ? '' : 's'} may be affected. Existing visits are not automatically cancelled.`}
        />
      ) : null}
    </View>
  );
  const decisionSection = (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="title3" accessibilityRole="header">Other-party responses</Text>
      {rescheduleRequests.length ? rescheduleRequests.map((request) => (
        <Card key={request.change.id} gap={t.spacing.xs}>
          <Text variant="calloutStrong">
            {request.requester === 'customer'
              ? 'Customer requested a new time'
              : request.requester === 'provider'
                ? 'Waiting for the customer to respond to your request.'
                : 'A visit time change is waiting for a response.'}
          </Text>
          {request.change.new_at ? (
            <Text variant="footnote" color="muted">
              {new Date(request.change.new_at).toLocaleString('en-IN', { timeZone: timezone })}
            </Text>
          ) : null}
          {request.change.booking_id ? (
            <Button
              title="Open affected visit"
              size="sm"
              variant="outline"
              onPress={() => openVisit(request.change.booking_id!)}
            />
          ) : null}
          {request.requester === 'customer' &&
          request.canRespond &&
          rescheduleEnabled &&
          canManage &&
          plan?.capabilities?.can_reschedule === true ? (
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button
                title="Decline time"
                variant="outline"
                disabled={!!busyId}
                onPress={() => void runAction(
                  request.change.booking_id ?? request.change.id,
                  () => respondVisitReschedule(request.change.id, false),
                )}
              />
              <Button
                title="Accept time"
                loading={busyId === request.change.booking_id}
                disabled={!!busyId}
                onPress={() => void runAction(
                  request.change.booking_id ?? request.change.id,
                  () => respondVisitReschedule(request.change.id, true),
                )}
              />
            </View>
          ) : null}
        </Card>
      )) : (
        <Text variant="footnote" color="muted">No pending visit responses.</Text>
      )}
    </View>
  );
  const upcomingSection = (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="title3" accessibilityRole="header">Upcoming visits</Text>
      {visitSections.upcoming.length ? visitSections.upcoming.map((visit) => renderVisit(visit, !layoutEnabled)) : (
        <EmptyState compact title="No upcoming visits" message="This plan has no future visits." />
      )}
    </View>
  );
  const completedSection = (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="title3" accessibilityRole="header">Completed visits</Text>
      {visitSections.completed.length ? visitSections.completed.map((visit) => renderVisit(visit, !layoutEnabled)) : (
        <EmptyState compact title="No completed visits" message="Completed visits will appear here." />
      )}
    </View>
  );
  const historySection = (
    <View style={{ gap: t.spacing.md }}>
      {visitSections.otherHistory.length ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="title3" accessibilityRole="header">Past, ended, and other visit history</Text>
          {visitSections.otherHistory.map((visit) => renderVisit(visit, !layoutEnabled))}
        </View>
      ) : null}
      {payload && !payload.occurrences.length ? (
        <EmptyState title="No visits generated yet" message="Visits are created after provider acceptance and within the server's scheduling horizon." />
      ) : null}
    </View>
  );
  const sections: Record<ProviderPlanSection, ReactNode> = {
    business: businessSection,
    plan: planSection,
    conflicts: conflictsSection,
    decisions: decisionSection,
    upcoming: upcomingSection,
    completed: completedSection,
    history: historySection,
  };
  const content = loading && !payload ? (
    <SkeletonCard lines={4} />
  ) : error && !payload ? (
    <ErrorState message={error} onRetry={() => void refresh()} />
  ) : plan && payload ? (
    providerPlanLayoutOrder(layoutEnabled).map((section) => (
      <View key={section} testID={`recurring-provider-section-${section}`}>
        {sections[section]}
      </View>
    ))
  ) : null;
  return (
    <Screen
      header={<Header title="Recurring plan" subtitle={plan ? formatRecurrence(plan) : undefined} onBack={() => router.back()} />}
      gap={t.spacing.md}
      refreshing={loading || refreshing}
      onRefresh={() => void refresh()}
    >
      {content}
    </Screen>
  );
}

export default function ProviderRecurringPlanScreen() {
  return useRecurringProviderDetailController();
}

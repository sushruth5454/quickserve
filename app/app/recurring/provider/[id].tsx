import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { StatusPill } from '../../../src/components/status';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, SkeletonCard, Text, TextArea } from '../../../src/components/ui';
import { getMyProviderBusinessContext } from '../../../src/features/merchantStaff/api';
import {
  getProviderRecurringPlan,
  reportProviderAbsence,
  requestVisitReschedule,
  respondVisitReschedule,
} from '../../../src/features/recurring/providerApi';
import {
  canUseRecurringReschedule,
  findTimeOffVisits,
  formatRecurrence,
} from '../../../src/features/recurring/providerPresentation';
import type { RecurringOccurrence, RecurringOccurrenceChange, RecurringPlanPayload } from '../../../src/features/recurring/providerTypes';
import { useAppFeatureFlags } from '../../../src/lib/featureFlags';
import { onboardingApi } from '../../../src/lib/onboarding';
import type { BookingStatus } from '../../../src/lib/types';
import { useTheme } from '../../../src/theme';
import type { BusinessProviderContext } from '../../../src/features/merchantStaff/api';

const REPORTABLE_STATUSES = new Set(['pending_payment', 'requested', 'accepted', 'confirmed']);
const COMPLETED_STATUSES = new Set(['completed', 'closed']);

function normalizedParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pendingRescheduleChanges(changes: RecurringOccurrenceChange[]): RecurringOccurrenceChange[] {
  return changes.filter((change) =>
    change.kind === 'reschedule_requested' &&
    !changes.some((outcome) =>
      outcome.booking_id === change.booking_id &&
      outcome.occurrence_date === change.occurrence_date &&
      outcome.original_at === change.original_at &&
      outcome.new_at === change.new_at &&
      (outcome.kind === 'rescheduled' || outcome.kind === 'reschedule_declined'),
    ),
  );
}

function visitTime(occurrence: RecurringOccurrence, timezone: string): string {
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

export default function ProviderRecurringPlanScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ id?: string | string[]; providerId?: string | string[] }>();
  const id = normalizedParam(params.id);
  const requestedProviderId = normalizedParam(params.providerId);
  const flags = useAppFeatureFlags();
  const rescheduleEnabled = canUseRecurringReschedule({
    recurring_bookings: flags.isOn('recurring_bookings'),
    recurring_reschedule: flags.isOn('recurring_reschedule'),
  });
  const [payload, setPayload] = useState<RecurringPlanPayload | null>(null);
  const [provider, setProvider] = useState<BusinessProviderContext | null>(null);
  const [schedule, setSchedule] = useState<Awaited<ReturnType<typeof onboardingApi.getProviderSchedule>>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [absenceFor, setAbsenceFor] = useState<string | null>(null);
  const [absenceReason, setAbsenceReason] = useState('');
  const [rescheduleFor, setRescheduleFor] = useState<string | null>(null);
  const [newTime, setNewTime] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');

  const load = useCallback(async () => {
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
      setPayload(nextPayload);
      const providerId = requestedProviderId ?? nextPayload.plan.provider_id;
      const [contextResult, scheduleResult] = await Promise.allSettled([
        getMyProviderBusinessContext(providerId),
        onboardingApi.getProviderSchedule(nextPayload.plan.provider_id),
      ]);
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
    } catch (loadFailure) {
      setPayload(null);
      setError((loadFailure as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, requestedProviderId]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const plan = payload?.plan;
  const canManage = provider?.business_role === 'owner' || provider?.business_role === 'manager';
  const timezone = schedule?.timezone ?? plan?.timezone ?? 'Asia/Kolkata';
  const upcoming = useMemo(
    () => (payload?.occurrences ?? []).filter((visit) =>
      Date.parse(visit.scheduled_at) > Date.now() &&
      REPORTABLE_STATUSES.has(visit.status),
    ),
    [payload],
  );
  const completed = useMemo(
    () => (payload?.occurrences ?? []).filter((visit) => COMPLETED_STATUSES.has(visit.status)),
    [payload],
  );
  const otherHistory = useMemo(
    () => (payload?.occurrences ?? []).filter((visit) =>
      !REPORTABLE_STATUSES.has(visit.status) &&
      !COMPLETED_STATUSES.has(visit.status),
    ),
    [payload],
  );
  const affected = useMemo(
    () => findTimeOffVisits(payload ? [payload] : [], schedule, Date.now()),
    [payload, schedule],
  );
  const rescheduleRequests = useMemo(
    () => pendingRescheduleChanges(payload?.changes ?? []),
    [payload],
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
      setNewTime('');
      setRescheduleReason('');
      await load();
    } catch (actionFailure) {
      setError((actionFailure as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const submitReschedule = (bookingId: string) => {
    const value = newTime.trim();
    const parsed = Date.parse(value);
    if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(parsed) || parsed <= Date.now() + 60 * 60 * 1000) {
      setError('Enter an ISO 8601 date and time with a timezone, more than 60 minutes from now.');
      return;
    }
    void runAction(bookingId, () => requestVisitReschedule(bookingId, new Date(parsed).toISOString(), rescheduleReason.trim()));
  };

  const openVisit = (bookingId: string) => router.push({
    pathname: '/booking/[id]',
    params: { id: bookingId },
  });

  const renderVisit = (visit: RecurringOccurrence) => {
    const pendingRequests = rescheduleRequests.filter((change) => change.booking_id === visit.id);
    const customerRequest = pendingRequests.find((change) => change.actor_id === plan?.customer_id);
    const providerRequest = pendingRequests.find((change) => change.actor_id !== plan?.customer_id);
    const canReport = canManage && REPORTABLE_STATUSES.has(visit.status) && Date.parse(visit.scheduled_at) > Date.now();
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
        {rescheduleEnabled && canManage && REPORTABLE_STATUSES.has(visit.status) && Date.parse(visit.scheduled_at) > Date.now() ? (
          rescheduleFor === visit.id ? (
            <>
              <TextArea
                label="New time (ISO 8601 with timezone)"
                accessibilityLabel="Requested visit time in ISO 8601 format"
                helper="The server rechecks provider hours, conflicts, and the 60-minute lead."
                value={newTime}
                onChangeText={setNewTime}
                maxLength={40}
                placeholder="2026-11-25T10:00:00+05:30"
              />
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
                    setNewTime('');
                    setRescheduleReason('');
                  }}
                />
                <Button
                  title="Request reschedule"
                  loading={busyId === visit.id}
                  disabled={!newTime.trim() || !rescheduleReason.trim()}
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
        {customerRequest && rescheduleEnabled && canManage ? (
          <Card gap={t.spacing.xs}>
            <Text variant="subheadStrong">Customer requested a new time</Text>
            <Text variant="footnote" color="muted">
              {customerRequest.new_at ? new Date(customerRequest.new_at).toLocaleString('en-IN', { timeZone: timezone }) : 'Requested time unavailable'}
            </Text>
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button
                title="Decline time"
                variant="outline"
                disabled={!!busyId}
                onPress={() => void runAction(visit.id, () => respondVisitReschedule(customerRequest.id, false))}
              />
              <Button
                title="Accept time"
                loading={busyId === visit.id}
                disabled={!!busyId}
                onPress={() => void runAction(visit.id, () => respondVisitReschedule(customerRequest.id, true))}
              />
            </View>
          </Card>
        ) : providerRequest ? (
          <InlineAlert message="Waiting for the customer to respond to your reschedule request." />
        ) : null}
      </Card>
    );
  };

  return (
    <Screen
      header={<Header title="Recurring plan" subtitle={plan ? formatRecurrence(plan) : undefined} onBack={() => router.back()} />}
      gap={t.spacing.md}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      {loading && !payload ? (
        <SkeletonCard lines={4} />
      ) : error && !payload ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : plan && payload ? (
        <>
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
          <Card gap={t.spacing.xs}>
            <Text variant="title3">{formatRecurrence(plan)}</Text>
            <Text variant="footnote" color="muted">Status: {plan.status} · Provider decision: {plan.provider_acceptance}</Text>
            <Text variant="footnote" color="muted">Starts {plan.starts_on} at {plan.start_time} ({timezone})</Text>
            {plan.ends_on ? <Text variant="footnote" color="muted">Ends {plan.ends_on}</Text> : null}
          </Card>
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="title3" accessibilityRole="header">Upcoming visits</Text>
            {upcoming.length ? upcoming.map(renderVisit) : (
              <EmptyState compact title="No upcoming visits" message="This plan has no future open visits." />
            )}
          </View>
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="title3" accessibilityRole="header">Completed visits</Text>
            {completed.length ? completed.map(renderVisit) : (
              <EmptyState compact title="No completed visits" message="Completed visits will appear here." />
            )}
          </View>
          {otherHistory.length ? (
            <View style={{ gap: t.spacing.sm }}>
              <Text variant="title3" accessibilityRole="header">Other visit history</Text>
              {otherHistory.map(renderVisit)}
            </View>
          ) : null}
          {!payload.occurrences.length ? (
            <EmptyState title="No visits generated yet" message="Visits are created after provider acceptance and within the server's scheduling horizon." />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

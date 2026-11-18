import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, InlineAlert, Section, SkeletonCard, Text, TextArea } from '../../components/ui';
import { onboardingApi } from '../../lib/onboarding';
import { getProviderService } from '../../lib/api';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useTheme } from '../../theme';
import type { MerchantRole } from '../merchantStaff/api';
import {
  findTimeOffVisits,
  formatRecurrence,
  firstRecurringDates,
  canShowProviderCalendar,
  canUsePlanAcceptance,
  pendingProviderPlans,
} from './providerPresentation';
import {
  listProviderRecurringPlans,
  reportProviderAbsence,
  respondRecurringPlan,
} from './providerApi';
import type { RecurringPlanPayload } from './providerTypes';

interface ProviderRecurringOverviewProps {
  providerId: string;
  role: MerchantRole;
}

export function ProviderRecurringOverview({ providerId, role }: ProviderRecurringOverviewProps) {
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const recurringEnabled = flags.isOn('recurring_bookings');
  const calendarEnabled = canShowProviderCalendar({
    merchant_calendar: flags.isOn('merchant_calendar'),
    recurring_bookings: flags.isOn('recurring_bookings'),
  });
  const acceptanceEnabled = canUsePlanAcceptance({
    recurring_bookings: flags.isOn('recurring_bookings'),
    recurring_plan_acceptance: flags.isOn('recurring_plan_acceptance'),
  });
  const canManage = role === 'owner' || role === 'manager';
  const [plans, setPlans] = useState<RecurringPlanPayload[] | null>(null);
  const [serviceLabels, setServiceLabels] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState<Awaited<ReturnType<typeof onboardingApi.getProviderSchedule>>>(null);
  const [loading, setLoading] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [absenceReason, setAbsenceReason] = useState('');
  const [absenceBusy, setAbsenceBusy] = useState(false);
  const [absenceMessage, setAbsenceMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setPlanError(null);
    setScheduleError(null);
    const [planResult, scheduleResult] = await Promise.allSettled([
      listProviderRecurringPlans(),
      onboardingApi.getProviderSchedule(providerId),
    ]);
    if (planResult.status === 'fulfilled') {
      setPlans(planResult.value);
      if (recurringEnabled) {
        const requests = pendingProviderPlans(planResult.value, providerId);
        const labelResults = await Promise.allSettled(requests.map(async ({ plan }) => {
          const service = await getProviderService(plan.provider_service_id);
          const packageTitle = service.service_packages?.find((item) => item.id === plan.service_package_id)?.title;
          const label = [service.categories?.name, packageTitle].filter(Boolean).join(' · ');
          return [plan.id, label || 'Recurring service'] as const;
        }));
        setServiceLabels(Object.fromEntries(labelResults.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        )));
      } else {
        setServiceLabels({});
      }
    } else {
      setPlans(null);
      setServiceLabels({});
      setPlanError((planResult.reason as Error).message);
    }
    if (scheduleResult.status === 'fulfilled') {
      setSchedule(scheduleResult.value);
    } else {
      setSchedule(null);
      setScheduleError((scheduleResult.reason as Error).message);
    }
    setLoading(false);
  }, [providerId, recurringEnabled]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const requests = useMemo(
    () => pendingProviderPlans(plans ?? [], providerId),
    [plans, providerId],
  );
  const providerPlans = useMemo(
    () => (plans ?? []).filter(({ plan }) => plan.provider_id === providerId),
    [plans, providerId],
  );
  const existingPlans = useMemo(
    () => providerPlans.filter(({ plan }) =>
      plan.status !== 'cancelled' &&
      !(recurringEnabled && plan.acceptance_mode === 'plan' && plan.provider_acceptance === 'pending'),
    ),
    [providerPlans, recurringEnabled],
  );
  const affectedVisits = useMemo(
    () => findTimeOffVisits(providerPlans, schedule, Date.now()),
    [providerPlans, schedule],
  );

  const decidePlan = async (planId: string, accept: boolean) => {
    setBusyId(planId);
    setPlanError(null);
    try {
      await respondRecurringPlan(planId, accept, declineReason.trim());
      setDecliningId(null);
      setDeclineReason('');
      await load();
    } catch (error) {
      setPlanError((error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const reportAbsences = async () => {
    if (!absenceReason.trim() || affectedVisits.length === 0) return;
    setAbsenceBusy(true);
    setAbsenceMessage(null);
    let reported = 0;
    try {
      for (const { occurrence } of affectedVisits) {
        await reportProviderAbsence(occurrence.id, absenceReason.trim());
        reported += 1;
      }
      setAbsenceReason('');
      setAbsenceMessage(`${reported} visit${reported === 1 ? '' : 's'} reported unavailable.`);
    } catch (error) {
      setAbsenceMessage(
        reported
          ? `Reported ${reported} visit${reported === 1 ? '' : 's'}; the remaining visits could not be updated. ${(error as Error).message}`
          : (error as Error).message,
      );
    } finally {
      await load();
      setAbsenceBusy(false);
    }
  };

  const openPlan = (planId: string) => router.push({
    pathname: '/recurring/provider/[id]',
    params: { id: planId, providerId },
  });

  return (
    <View style={{ gap: t.spacing.md }}>
      {calendarEnabled ? (
        <Button
          title="Open recurring calendar"
          variant="outline"
          accessibilityHint="Shows recurring visits for this business by day or week"
          onPress={() => router.push({ pathname: '/merchant-calendar', params: { providerId } })}
        />
      ) : null}

      {recurringEnabled ? (
        <Section title="Repeat requests" subtitle={requests.length ? `${requests.length} awaiting provider decision` : undefined}>
          {loading && plans == null ? (
            <SkeletonCard lines={3} />
          ) : planError && plans == null ? (
            <ErrorState message={planError} onRetry={() => void load()} compact />
          ) : requests.length === 0 ? (
            <EmptyState compact title="No repeat requests" message="New provider plan requests will appear here." />
          ) : (
            requests.map(({ plan }) => {
              const firstDates = firstRecurringDates(plan);
              return (
                <Card key={plan.id} gap={t.spacing.sm}>
                  <Text variant="calloutStrong">{serviceLabels[plan.id] ?? 'Recurring service'}</Text>
                  <Text variant="footnote" color="muted">{formatRecurrence(plan)}</Text>
                  <Text variant="footnote" color="muted">
                    First dates: {firstDates.length ? firstDates.join(' · ') : 'Not available'} · {plan.start_time} ({plan.timezone})
                  </Text>
                  <Text variant="footnote" color="muted">
                    The pending-plan response does not include per-visit earnings, so no amount is available to display yet.
                  </Text>
                  <Button title="View plan details" variant="outline" onPress={() => openPlan(plan.id)} />
                  {!acceptanceEnabled ? (
                    <InlineAlert message="Plan-level acceptance is off. Per-visit requests remain in your existing jobs list." />
                  ) : !canManage ? (
                    <InlineAlert message="Only the business owner or a manager can accept or decline a plan." />
                  ) : decliningId === plan.id ? (
                    <>
                      <TextArea
                        label="Reason for declining"
                        accessibilityLabel="Reason for declining recurring plan"
                        value={declineReason}
                        onChangeText={setDeclineReason}
                        maxLength={300}
                        placeholder="Tell the customer why you cannot take this plan"
                      />
                      <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                        <Button
                          title="Cancel"
                          variant="outline"
                          disabled={busyId === plan.id}
                          onPress={() => {
                            setDecliningId(null);
                            setDeclineReason('');
                          }}
                        />
                        <Button
                          title="Decline plan"
                          variant="destructive"
                          loading={busyId === plan.id}
                          disabled={!declineReason.trim()}
                          onPress={() => void decidePlan(plan.id, false)}
                        />
                      </View>
                    </>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                      <Button
                        title="Decline"
                        variant="outline"
                        disabled={!!busyId}
                        onPress={() => setDecliningId(plan.id)}
                      />
                      <Button
                        title="Accept plan"
                        loading={busyId === plan.id}
                        disabled={!!busyId}
                        onPress={() => void decidePlan(plan.id, true)}
                      />
                    </View>
                  )}
                </Card>
              );
            })
          )}
          {planError && plans != null ? <InlineAlert message={planError} /> : null}
        </Section>
      ) : null}

      {(existingPlans.length > 0 || !recurringEnabled) ? (
        <Section title="Existing recurring plans">
          {loading && plans == null ? (
            <SkeletonCard lines={2} />
          ) : planError && plans == null ? (
            <ErrorState message={planError} onRetry={() => void load()} compact />
          ) : existingPlans.length === 0 ? (
            <EmptyState compact title="No existing plans" message="Existing provider plans will remain readable here when new recurring plans are turned off." />
          ) : (
            existingPlans.map(({ plan }) => (
              <Card key={plan.id} gap={t.spacing.sm}>
                <Text variant="calloutStrong">{serviceLabels[plan.id] ?? 'Recurring service'}</Text>
                <Text variant="footnote" color="muted">{formatRecurrence(plan)} · {plan.status}</Text>
                <Button title="View plan" variant="outline" onPress={() => openPlan(plan.id)} />
              </Card>
            ))
          )}
        </Section>
      ) : null}

      {scheduleError ? <InlineAlert message={`Time-off conflicts could not be checked: ${scheduleError}`} /> : null}
      {affectedVisits.length > 0 ? (
        <Card gap={t.spacing.sm}>
          <InlineAlert
            tone="warning"
            title={schedule?.paused ? 'Provider is on holiday' : 'Recurring visits overlap time off'}
            message={`${affectedVisits.length} future recurring visit${affectedVisits.length === 1 ? '' : 's'} may be affected. Existing visits are not automatically cancelled.`}
          />
          {affectedVisits.map(({ plan, occurrence }) => (
            <Button
              key={occurrence.id}
              title={`${new Date(occurrence.scheduled_at).toLocaleString('en-IN', {
                timeZone: schedule?.timezone ?? plan.timezone,
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })} · ${formatRecurrence(plan)}`}
              variant="outline"
              accessibilityHint="Opens the recurring plan and visit details"
              onPress={() => openPlan(plan.id)}
            />
          ))}
          {canManage ? (
            <>
              <TextArea
                label="Reason for provider unavailability"
                accessibilityLabel="Reason for provider unavailability"
                value={absenceReason}
                onChangeText={setAbsenceReason}
                maxLength={300}
                placeholder="For example, provider time off"
              />
              <Button
                title="Report absence for these"
                variant="destructive"
                loading={absenceBusy}
                disabled={!absenceReason.trim() || absenceBusy}
                onPress={() => void reportAbsences()}
              />
            </>
          ) : (
            <Text variant="footnote" color="muted">Ask a business manager to report absence for affected visits.</Text>
          )}
          {absenceMessage ? <InlineAlert message={absenceMessage} /> : null}
        </Card>
      ) : null}
    </View>
  );
}

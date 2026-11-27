import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text, useConfirm, useToast } from '../../components/ui';
import { useAppFeatureFlags, useFeature } from '../../lib/featureFlags';
import { formatINR } from '../../lib/money';
import { usePayment } from '../../lib/payments';
import {
  cancelRecurringPlan,
  getRecurringPlan,
  pauseRecurringPlan,
  respondVisitReschedule,
  resumeRecurringPlan,
  skipRecurringVisit,
} from '../recurring/api';
import { getRecurringPlanActions, partitionRecurringOccurrences, resolvePendingRescheduleChanges, visitPaymentLabel } from '../recurring/customerPresentation';
import type { ChangeKind, Frequency, PlanStatus, RecurringPlanCapabilities } from '../recurring/types';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../theme';
import { useFocusedServiceRefresh } from '../serviceLifecycle/useFocusedServiceRefresh';
import { useBrandIdentity } from '../../branding/useBrandIdentity';

type CustomerPlanSection = 'plan' | 'due' | 'decisions' | 'upcoming' | 'history' | 'management' | 'invalidTime';

export function customerPlanLayoutOrder(layoutEnabled: boolean): CustomerPlanSection[] {
  return layoutEnabled
    ? ['plan', 'due', 'decisions', 'upcoming', 'history', 'management']
    : ['plan', 'upcoming', 'history', 'management', 'invalidTime'];
}

export function currentDueOccurrence<T extends {
  id: string;
  scheduled_at: string;
  can_pay?: boolean;
  remaining_due_paise?: number | null;
}>(visits: readonly T[]): T | null {
  return [...visits]
    .filter((visit) =>
      visit.can_pay === true &&
      typeof visit.remaining_due_paise === 'number' &&
      Number.isFinite(visit.remaining_due_paise) &&
      visit.remaining_due_paise > 0,
    )
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || a.id.localeCompare(b.id))[0] ?? null;
}

type PlanFields = Record<string, unknown> & {
  id: string;
  status: PlanStatus;
  customer_id: string;
  provider_acceptance: string;
  acceptance_mode?: string;
  capabilities?: Partial<RecurringPlanCapabilities>;
  frequency?: Frequency;
  interval_count?: number;
  weekdays?: number[];
  month_day?: number | null;
  start_time?: string;
  timezone?: string;
  billing_frequency?: string;
};

type Occurrence = {
  id: string;
  scheduled_at: string;
  status: string;
  total_amount?: number | null;
  service_window?: string | null;
  archetype?: string;
  remaining_due_paise?: number | null;
  payment_due_at?: string | null;
  payment_expires_at?: string | null;
  can_pay?: boolean;
  can_skip?: boolean;
  skip_cutoff_at?: string | null;
};

type PlanChange = {
  id: string;
  booking_id?: string | null;
  occurrence_date?: string | null;
  original_at?: string | null;
  kind: ChangeKind;
  new_at?: string | null;
  actor_id?: string | null;
  reason?: string | null;
  created_at?: string;
};

type PlanEnvelope = {
  plan: PlanFields;
  occurrences: Occurrence[];
  changes: PlanChange[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parsePlanEnvelope(value: unknown): PlanEnvelope | null {
  if (!isRecord(value) || !isRecord(value.plan)) return null;
  const plan = value.plan;
  if (
    typeof plan.id !== 'string' ||
    !['active', 'paused', 'cancelled', 'completed'].includes(String(plan.status)) ||
    typeof plan.provider_acceptance !== 'string' ||
    !Array.isArray(value.occurrences) ||
    !Array.isArray(value.changes)
  ) {
    return null;
  }
  const occurrences = value.occurrences.filter(
    (row): row is Occurrence =>
      isRecord(row) && typeof row.id === 'string' && typeof row.scheduled_at === 'string' && typeof row.status === 'string',
  );
  const changes = value.changes.filter(
    (row): row is PlanChange => isRecord(row) && typeof row.id === 'string' && typeof row.kind === 'string',
  );
  return { plan: plan as PlanFields, occurrences, changes };
}

function scheduleSummary(plan: PlanFields) {
  const names: Record<Frequency, string> = {
    daily: 'Every day',
    alternate_days: 'Every other day',
    weekly: 'Weekly',
    monthly: 'Monthly',
    custom: 'Choose dates',
  };
  const frequency = plan.frequency && names[plan.frequency] ? names[plan.frequency] : 'Repeat schedule';
  const interval = typeof plan.interval_count === 'number' && plan.interval_count > 1
    ? ` · every ${plan.interval_count} ${plan.frequency === 'weekly' ? 'weeks' : 'months'}`
    : '';
  const weekdays = Array.isArray(plan.weekdays)
    ? plan.weekdays
        .map((day) => ({ day, label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1] }))
        .filter((entry) => entry.label)
        .map((entry) => entry.label)
        .join(', ')
    : '';
  const monthlyDay = typeof plan.month_day === 'number' ? ` · day ${plan.month_day}` : '';
  const time = typeof plan.start_time === 'string' ? ` · ${plan.start_time}` : '';
  return `${frequency}${interval}${plan.frequency === 'weekly' && weekdays ? ` · ${weekdays}` : ''}${plan.frequency === 'monthly' ? monthlyDay : ''}${time}`;
}

function formatMoment(value: string) {
  return new Date(value).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function useRecurringDetailController() {
  const t = useTheme();
  const identity = useBrandIdentity('recurring');
  const toast = useToast();
  const confirmDialog = useConfirm();
  const startPayment = usePayment();
  const { userId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const recurringEnabled = useFeature('recurring_bookings');
  const featureFlags = useAppFeatureFlags();
  const layoutEnabled = featureFlags.isOn('oorva_recurring_ux');
  const skipPauseEnabled = featureFlags.isOn('recurring_skip_pause');
  const rescheduleEnabled = featureFlags.isOn('recurring_reschedule');
  const [detail, setDetail] = useState<PlanEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    if (!guard.isCurrent()) return;
    if (!id) {
      setError('Recurring plan ID is missing.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = parsePlanEnvelope(await getRecurringPlan(id));
      if (!guard.isCurrent()) return;
      if (!next) throw new Error('The server returned an invalid repeat plan.');
      setDetail(next);
      setError(null);
    } catch (reason) {
      if (guard.isCurrent()) setError((reason as Error).message);
    } finally {
      if (guard.isCurrent()) setLoading(false);
    }
  }, [id]);

  const { refresh, refreshing } = useFocusedServiceRefresh(load, {
    contextKey: `customer-plan:${userId ?? 'anonymous'}:${id ?? ''}`,
    enabled: true,
    intervalMs: id ? 30_000 : null,
  });

  const partition = useMemo(
    () => detail ? partitionRecurringOccurrences(detail.occurrences) : null,
    [detail?.occurrences],
  );
  const upcoming = partition
    ? [...partition.future.actionable, ...partition.future.resolving, ...partition.future.completed, ...partition.future.terminal, ...partition.future.other]
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.id.localeCompare(b.id))
    : [];
  const past = partition
    ? [...partition.past.actionable, ...partition.past.resolving, ...partition.past.completed, ...partition.past.terminal, ...partition.past.other]
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.id.localeCompare(b.id))
    : [];
  const actions = detail ? getRecurringPlanActions({
    plan: detail.plan,
    actorId: userId,
    skipPauseEnabled,
    rescheduleEnabled,
    occurrences: detail.occurrences,
    changes: detail.changes,
  }) : null;
  const pendingReschedules = detail
    ? resolvePendingRescheduleChanges(
        detail.changes,
        detail.plan.customer_id,
        userId,
        'customer',
      )
    : [];

  const backToPlans = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(customer)/bookings');
  };

  const run = async (key: string, operation: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await operation();
      toast({ message, tone: 'success' });
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const payVisit = async (bookingId: string) => {
    if (busy) return;
    setBusy(bookingId);
    setError(null);
    try {
      const result = await startPayment(bookingId);
      if (result === 'paid') {
        toast({ message: 'Visit payment complete.', tone: 'success' });
        await refresh();
      } else if (result === 'opened') {
        toast({ message: 'Payment opened securely.', tone: 'success' });
      }
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const confirm = async (title: string, message: string, action: () => void) => {
    const accepted = await confirmDialog({
      title,
      message,
      confirmLabel: 'Continue',
      cancelLabel: 'Not now',
      destructive: true,
    });
    if (accepted) action();
  };

  if (loading && !detail) {
    return (
      <Screen
        header={<Header title="Repeat plan" onBack={backToPlans} />}
        gap={t.spacing.md}
        refreshing={loading || refreshing}
        onRefresh={() => void refresh()}
      >
        <Skeleton height={92} radius={t.radii.lg} />
        <Skeleton height={150} radius={t.radii.lg} />
        <Skeleton height={170} radius={t.radii.lg} />
      </Screen>
    );
  }
  if (error && !detail) {
    return <Screen header={<Header title="Repeat plan" onBack={backToPlans} />}><ErrorState message={error} onRetry={() => void refresh()} /></Screen>;
  }
  if (!detail) {
    return <Screen header={<Header title="Repeat plan" onBack={backToPlans} />}><EmptyState title="Plan unavailable" message="This repeat plan could not be found." /></Screen>;
  }

  const { plan } = detail;
  const invalidTimeVisits = partition?.invalidTime ?? [];
  const dueVisit = currentDueOccurrence(upcoming);
  const upcomingWithoutDue = layoutEnabled && dueVisit
    ? upcoming.filter((visit) => visit.id !== dueVisit.id)
    : upcoming;
  const renderUpcomingVisit = (visit: Occurrence) => (
    <Card key={visit.id} gap={t.spacing.xs}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm }}>
        <Text variant="calloutStrong">{formatMoment(visit.scheduled_at)}</Text>
        <Chip label={statusLabel(visit.status)} />
      </View>
      {visit.total_amount != null ? (
        <Text variant="footnote" color="textSecondary">Visit total: {formatINR(visit.total_amount)}</Text>
      ) : null}
      {visit.can_pay === true ? (
        <View style={{ gap: t.spacing.xs }}>
          <Text variant="footnoteStrong" color="warningText">
            {visitPaymentLabel(visit, plan.timezone ?? 'Asia/Kolkata') ?? 'Payment is available; deadline unavailable.'}
          </Text>
          <Button
            title="Pay now"
            leftIcon="lock-closed"
            loading={busy === visit.id}
            disabled={!!busy && busy !== visit.id}
            onPress={() => void payVisit(visit.id)}
          />
        </View>
      ) : null}
      <Button
        title="View visit details"
        variant="outline"
        onPress={() => router.push({ pathname: '/booking/[id]', params: { id: visit.id } })}
      />
    </Card>
  );
  const planSection = (
    <View style={{ gap: t.spacing.md }}>
      {!recurringEnabled ? (
        <InlineAlert tone="warning" title="Paused by Nearo" message="New repeat visits are paused while this feature is off. Your plan and existing visits remain available." />
      ) : null}
      <Card gap={t.spacing.sm}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm }}>
          <Text variant="title3">{layoutEnabled ? `${identity.displayName} repeat plan` : 'Plan status'}</Text>
          <Chip label={statusLabel(plan.status)} selected />
        </View>
        <Text variant="body">{scheduleSummary(plan)}</Text>
        <Text variant="footnote" color="textSecondary">
          Provider response: {statusLabel(plan.provider_acceptance)}
          {plan.acceptance_mode ? ` · ${plan.acceptance_mode === 'plan' ? 'Plan acceptance' : 'Visit-by-visit acceptance'}` : ''}
        </Text>
        {layoutEnabled && plan.timezone ? (
          <Text variant="footnote" color="muted">Plan time · {plan.timezone}</Text>
        ) : null}
        {plan.billing_frequency ? <Text variant="footnote" color="textSecondary">Payment: {statusLabel(plan.billing_frequency)}</Text> : null}
      </Card>
      {error ? <InlineAlert tone="danger" title="Action could not be completed" message={error} /> : null}
    </View>
  );
  const dueSection = dueVisit ? (
    <Card gap={t.spacing.xs}>
      <Text variant="subheadStrong">Current visit payment</Text>
      <Text variant="calloutStrong">{formatMoment(dueVisit.scheduled_at)}</Text>
      <Text variant="footnoteStrong" color="warningText">
        {visitPaymentLabel(dueVisit, plan.timezone ?? 'Asia/Kolkata') ?? 'Payment is available; deadline unavailable.'}
      </Text>
      <Button
        title="Pay now"
        leftIcon="lock-closed"
        loading={busy === dueVisit.id}
        disabled={!!busy && busy !== dueVisit.id}
        onPress={() => void payVisit(dueVisit.id)}
      />
      <Button
        title="View visit details"
        variant="outline"
        onPress={() => router.push({ pathname: '/booking/[id]', params: { id: dueVisit.id } })}
      />
    </Card>
  ) : (
    <Text variant="footnote" color="muted">No current visit payment is due.</Text>
  );
  const decisionSection = (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="title3" accessibilityRole="header">Provider decisions</Text>
      <Card gap={t.spacing.xs}>
        <Text variant="calloutStrong">
          {plan.provider_acceptance === 'pending'
            ? 'Waiting for the provider to review this plan.'
            : plan.provider_acceptance === 'declined'
              ? 'The provider declined this plan.'
              : 'The provider accepted this plan.'}
        </Text>
        {plan.provider_acceptance === 'declined' && typeof plan.decline_reason === 'string' && plan.decline_reason.trim()
          ? <Text variant="footnote" color="textSecondary">{plan.decline_reason}</Text>
          : null}
      </Card>
      {pendingReschedules.map((pending) => (
        <Card key={pending.change.id} gap={t.spacing.xs}>
          <Text variant="calloutStrong">
            {pending.requester === 'customer'
              ? 'Waiting for the provider to respond to your time request.'
              : 'The provider requested a different visit time.'}
          </Text>
          {pending.change.new_at ? (
            <Text variant="footnote" color="textSecondary">{formatMoment(pending.change.new_at)}</Text>
          ) : null}
          {pending.canRespond && actions?.reschedule ? (
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button
                title="Accept new time"
                size="sm"
                variant="secondary"
                onPress={() => confirm(
                  'Accept this time?',
                  'Accepting moves this visit to the proposed time; charges stay governed by your plan.',
                  () => void run('reschedule', () => respondVisitReschedule(pending.change.id, true), 'New visit time accepted.'),
                )}
                loading={busy === 'reschedule'}
                style={{ flex: 1 }}
              />
              <Button
                title="Decline"
                size="sm"
                variant="outline"
                onPress={() => confirm(
                  'Decline this time?',
                  'The visit keeps its original time and no new charge is made.',
                  () => void run('reschedule', () => respondVisitReschedule(pending.change.id, false), 'Reschedule declined.'),
                )}
                disabled={!!busy}
                style={{ flex: 1 }}
              />
            </View>
          ) : null}
        </Card>
      ))}
    </View>
  );
  const upcomingSection = upcomingWithoutDue.length ? (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="title3">Upcoming visits</Text>
      {upcomingWithoutDue.map(renderUpcomingVisit)}
    </View>
  ) : (
    <EmptyState icon="calendar-outline" title="No upcoming visits" message="New visits will appear here when the plan is accepted and scheduled." compact />
  );
  const pastSection = past.length ? (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="title3">Past visits</Text>
      {past.map((visit) => (
        <Card key={visit.id} onPress={() => router.push({ pathname: '/booking/[id]', params: { id: visit.id } })} gap={t.spacing.xs}>
          <Text variant="calloutStrong">{formatMoment(visit.scheduled_at)}</Text>
          <Text variant="footnote" color="textSecondary">{statusLabel(visit.status)}</Text>
        </Card>
      ))}
    </View>
  ) : null;
  const changesSection = (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="title3">Plan changes</Text>
      {detail.changes.length ? detail.changes.map((change) => (
        <Card key={change.id} gap={t.spacing.xs}>
          <Text variant="calloutStrong">{statusLabel(change.kind)}</Text>
          {change.occurrence_date ? <Text variant="footnote" color="textSecondary">{change.occurrence_date}</Text> : null}
          {change.new_at ? <Text variant="footnote" color="textSecondary">Proposed time: {formatMoment(change.new_at)}</Text> : null}
          {change.reason ? <Text variant="footnote" color="textSecondary">{change.reason}</Text> : null}
          {!layoutEnabled && pendingReschedules.some((pending) => pending.change.id === change.id && pending.requester === 'customer') ? (
            <Text variant="footnote" color="muted">Waiting for the provider to respond to your request.</Text>
          ) : null}
          {!layoutEnabled && pendingReschedules.some((pending) => pending.change.id === change.id && pending.canRespond) && actions?.reschedule ? (
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button
                title="Accept new time"
                size="sm"
                variant="secondary"
                onPress={() => confirm(
                  'Accept this time?',
                  'Accepting moves this visit to the proposed time; charges stay governed by your plan.',
                  () => void run('reschedule', () => respondVisitReschedule(change.id, true), 'New visit time accepted.'),
                )}
                loading={busy === 'reschedule'}
                style={{ flex: 1 }}
              />
              <Button
                title="Decline"
                size="sm"
                variant="outline"
                onPress={() => confirm(
                  'Decline this time?',
                  'The visit keeps its original time and no new charge is made.',
                  () => void run('reschedule', () => respondVisitReschedule(change.id, false), 'Reschedule declined.'),
                )}
                disabled={!!busy}
                style={{ flex: 1 }}
              />
            </View>
          ) : null}
          {layoutEnabled && change.booking_id ? (
            <Button
              title="Open affected visit"
              size="sm"
              variant="outline"
              onPress={() => router.push({ pathname: '/booking/[id]', params: { id: change.booking_id! } })}
            />
          ) : null}
        </Card>
      )) : (
        <Text variant="footnote" color="muted">No plan changes yet.</Text>
      )}
    </View>
  );
  const historySection = (
    <View style={{ gap: t.spacing.md }}>
      {pastSection}
      {changesSection}
      {layoutEnabled && invalidTimeVisits.length ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="title3">Visits without a valid time</Text>
          {invalidTimeVisits.map((visit) => (
            <Card key={visit.id} onPress={() => router.push({ pathname: '/booking/[id]', params: { id: visit.id } })} gap={t.spacing.xs}>
              <Text variant="calloutStrong">Visit time unavailable</Text>
              <Text variant="footnote" color="textSecondary">{statusLabel(visit.status)}</Text>
            </Card>
          ))}
        </View>
      ) : null}
    </View>
  );
  const managementSection = (
    <View style={{ gap: t.spacing.md }}>
      {actions?.skip && actions.skipOccurrenceId ? (
        <Button
          title="Skip next visit"
          onPress={() => confirm(
            'Skip the next visit?',
            'The visit will be cancelled and any refund follows the existing plan policy.',
            () => void run('skip', () => skipRecurringVisit(actions.skipOccurrenceId!), 'Next visit skipped.'),
          )}
          loading={busy === 'skip'}
          fullWidth
        />
      ) : null}
      {actions?.pause ? (
        <Button
          title="Pause plan"
          variant="outline"
          onPress={() => confirm(
            'Pause this plan?',
            'Future eligible unpaid visits will be cancelled; charges and refunds follow the existing plan policy.',
            () => void run('pause', () => pauseRecurringPlan(plan.id), 'Plan paused.'),
          )}
          loading={busy === 'pause'}
          fullWidth
        />
      ) : null}
      {actions?.resume ? (
        <Button
          title="Resume plan"
          variant="outline"
          onPress={() => confirm(
            'Resume this plan?',
            'Eligible future visits will be scheduled; no new recurring payment is collected here.',
            () => void run('resume', () => resumeRecurringPlan(plan.id), 'Plan resumed.'),
          )}
          loading={busy === 'resume'}
          fullWidth
        />
      ) : null}
      {actions?.cancel ? (
        <Button
          title="Cancel plan"
          variant="outline"
          onPress={() => confirm(
            'Cancel this plan?',
            'Future visits will be cancelled and charges or refunds follow the existing cancellation policy.',
            () => void run('cancel', () => cancelRecurringPlan(plan.id, 'Customer cancelled recurring plan'), 'Plan cancelled.'),
          )}
          loading={busy === 'cancel'}
          fullWidth
        />
      ) : null}
    </View>
  );
  const invalidTimeSection = invalidTimeVisits.length ? (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="title3">Visits without a valid time</Text>
      {invalidTimeVisits.map((visit) => (
        <Card key={visit.id} onPress={() => router.push({ pathname: '/booking/[id]', params: { id: visit.id } })} gap={t.spacing.xs}>
          <Text variant="calloutStrong">Visit time unavailable</Text>
          <Text variant="footnote" color="textSecondary">{statusLabel(visit.status)}</Text>
        </Card>
      ))}
    </View>
  ) : null;
  const sections: Record<CustomerPlanSection, ReactNode> = {
    plan: planSection,
    due: dueSection,
    decisions: decisionSection,
    upcoming: upcomingSection,
    history: historySection,
    management: managementSection,
    invalidTime: invalidTimeSection,
  };
  return (
    <Screen header={<Header title="Repeat plan" onBack={backToPlans} />} gap={t.spacing.md}>
      {customerPlanLayoutOrder(layoutEnabled).map((section) => (
        <View key={section} testID={`recurring-customer-section-${section}`}>
          {sections[section]}
        </View>
      ))}
    </Screen>
  );
}

export default function RecurringPlanDetailScreen() {
  return useRecurringDetailController();
}

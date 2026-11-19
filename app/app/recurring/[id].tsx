import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text, useConfirm, useToast } from '../../src/components/ui';
import { useAppFeatureFlags, useFeature } from '../../src/lib/featureFlags';
import { formatINR } from '../../src/lib/money';
import { usePayment } from '../../src/lib/payments';
import {
  cancelRecurringPlan,
  getRecurringPlan,
  pauseRecurringPlan,
  respondVisitReschedule,
  resumeRecurringPlan,
  skipRecurringVisit,
} from '../../src/features/recurring/api';
import { getRecurringPlanActions, visitPaymentLabel } from '../../src/features/recurring/customerPresentation';
import type { ChangeKind, Frequency, PlanStatus } from '../../src/features/recurring/types';
import { useTheme } from '../../src/theme';

type PlanFields = Record<string, unknown> & {
  id: string;
  status: PlanStatus;
  provider_acceptance: string;
  acceptance_mode?: string;
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

export default function RecurringPlanDetailScreen() {
  const t = useTheme();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const startPayment = usePayment();
  const { id } = useLocalSearchParams<{ id: string }>();
  const recurringEnabled = useFeature('recurring_bookings');
  const featureFlags = useAppFeatureFlags();
  const skipPauseEnabled = featureFlags.isOn('recurring_skip_pause');
  const rescheduleEnabled = featureFlags.isOn('recurring_reschedule');
  const [detail, setDetail] = useState<PlanEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const next = parsePlanEnvelope(await getRecurringPlan(id));
      if (!next) throw new Error('The server returned an invalid repeat plan.');
      setDetail(next);
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const occurrences = useMemo(
    () => [...(detail?.occurrences ?? [])].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
    [detail?.occurrences],
  );
  const upcoming = occurrences.filter((item) => new Date(item.scheduled_at).getTime() >= Date.now());
  const past = occurrences.filter((item) => new Date(item.scheduled_at).getTime() < Date.now());
  const nextVisit = upcoming.find((item) => !['cancelled', 'completed', 'closed', 'declined'].includes(item.status));
  const actions = detail ? getRecurringPlanActions(detail.plan.status, skipPauseEnabled, rescheduleEnabled) : null;
  const pendingReschedules = (detail?.changes ?? []).filter(
    (change) =>
      change.kind === 'reschedule_requested' &&
      !(detail?.changes ?? []).some(
        (outcome) =>
          outcome.booking_id === change.booking_id &&
          (outcome.kind === 'rescheduled' || outcome.kind === 'reschedule_declined') &&
          (outcome.new_at === change.new_at ||
            (!!outcome.created_at && !!change.created_at && outcome.created_at >= change.created_at)),
      ),
  );

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
      await load();
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
        await load();
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
      <Screen header={<Header title="Repeat plan" onBack={backToPlans} />} gap={t.spacing.md}>
        <Skeleton height={92} radius={t.radii.lg} />
        <Skeleton height={150} radius={t.radii.lg} />
        <Skeleton height={170} radius={t.radii.lg} />
      </Screen>
    );
  }
  if (error && !detail) {
    return <Screen header={<Header title="Repeat plan" onBack={backToPlans} />}><ErrorState message={error} onRetry={() => void load()} /></Screen>;
  }
  if (!detail) {
    return <Screen header={<Header title="Repeat plan" onBack={backToPlans} />}><EmptyState title="Plan unavailable" message="This repeat plan could not be found." /></Screen>;
  }

  const { plan } = detail;
  return (
    <Screen header={<Header title="Repeat plan" onBack={backToPlans} />} gap={t.spacing.md}>
      {!recurringEnabled ? (
        <InlineAlert tone="warning" title="Paused by Nearo" message="New repeat visits are paused while this feature is off. Your plan and existing visits remain available." />
      ) : null}
      <Card gap={t.spacing.sm}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm }}>
          <Text variant="title3">Plan status</Text>
          <Chip label={statusLabel(plan.status)} selected />
        </View>
        <Text variant="body">{scheduleSummary(plan)}</Text>
        <Text variant="footnote" color="textSecondary">
          Provider response: {statusLabel(plan.provider_acceptance)}
          {plan.acceptance_mode ? ` · ${plan.acceptance_mode === 'plan' ? 'Plan acceptance' : 'Visit-by-visit acceptance'}` : ''}
        </Text>
        {plan.billing_frequency ? <Text variant="footnote" color="textSecondary">Payment: {statusLabel(plan.billing_frequency)}</Text> : null}
      </Card>

      {error ? <InlineAlert tone="danger" title="Action could not be completed" message={error} /> : null}

      {upcoming.length ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="title3">Upcoming visits</Text>
          {upcoming.map((visit) => (
            <Card key={visit.id} gap={t.spacing.xs}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm }}>
                <Text variant="calloutStrong">{formatMoment(visit.scheduled_at)}</Text>
                <Chip label={statusLabel(visit.status)} />
              </View>
              {visit.total_amount != null ? (
                <Text variant="footnote" color="textSecondary">Visit total: {formatINR(visit.total_amount)}</Text>
              ) : null}
              {visit.status === 'pending_payment' ? (
                <View style={{ gap: t.spacing.xs }}>
                  <Text variant="footnoteStrong" color="warningText">
                    {visitPaymentLabel(visit, plan.timezone ?? 'Asia/Kolkata') ?? 'Payment is due before this visit.'}
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
          ))}
        </View>
      ) : (
        <EmptyState icon="calendar-outline" title="No upcoming visits" message="New visits will appear here when the plan is accepted and scheduled." compact />
      )}

      {past.length ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="title3">Past visits</Text>
          {past.map((visit) => (
            <Card key={visit.id} onPress={() => router.push({ pathname: '/booking/[id]', params: { id: visit.id } })} gap={t.spacing.xs}>
              <Text variant="calloutStrong">{formatMoment(visit.scheduled_at)}</Text>
              <Text variant="footnote" color="textSecondary">{statusLabel(visit.status)}</Text>
            </Card>
          ))}
        </View>
      ) : null}

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="title3">Plan changes</Text>
        {detail.changes.length ? detail.changes.map((change) => (
          <Card key={change.id} gap={t.spacing.xs}>
            <Text variant="calloutStrong">{statusLabel(change.kind)}</Text>
            {change.occurrence_date ? <Text variant="footnote" color="textSecondary">{change.occurrence_date}</Text> : null}
            {change.new_at ? <Text variant="footnote" color="textSecondary">Proposed time: {formatMoment(change.new_at)}</Text> : null}
            {change.reason ? <Text variant="footnote" color="textSecondary">{change.reason}</Text> : null}
            {pendingReschedules.some((pending) => pending.id === change.id) && actions?.reschedule ? (
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
          </Card>
        )) : (
          <Text variant="footnote" color="muted">No plan changes yet.</Text>
        )}
      </View>

      {actions?.skip && nextVisit ? (
        <Button
          title="Skip next visit"
          onPress={() => confirm(
            'Skip the next visit?',
            'The visit will be cancelled and any refund follows the existing plan policy.',
            () => void run('skip', () => skipRecurringVisit(nextVisit.id), 'Next visit skipped.'),
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
    </Screen>
  );
}

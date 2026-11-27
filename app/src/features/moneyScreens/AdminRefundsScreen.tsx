import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';

interface StuckRefund {
  refund_id: string;
  payment_id: string;
  booking_id: string | null;
  amount: number;
  status: 'failed' | 'processing';
  attempts: number;
  last_error: string | null;
  created_at: string;
  processing_started_at: string | null;
}

interface StuckTransfer {
  transfer_id: string;
  payout_id: string;
  booking_id: string;
  amount: number;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

interface StuckMoney {
  refunds: StuckRefund[];
  transfers: StuckTransfer[];
}

interface DisputeRules {
  max_days_after_close: number | null;
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

function useAdminRefundsController() {
  const t = useTheme();
  const toast = useToast();
  const [money, setMoney] = useState<StuckMoney | null>(null);
  const [days, setDays] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refundActionErrors, setRefundActionErrors] = useState<Record<string, string>>({});
  const [savingRules, setSavingRules] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    setMoney(null);
    void Promise.all([
      rpc<StuckMoney>('admin_list_stuck_money'),
      rpc<DisputeRules>('admin_get_dispute_rules'),
    ]).then(([nextMoney, rules]) => {
      setMoney(nextMoney);
      setDays(rules.max_days_after_close == null ? '' : String(rules.max_days_after_close));
    }).catch((error: Error) => setLoadError(error.message));
  }, []);
  useFocusEffect(load);

  const saveRules = async () => {
    setActionError(null);
    if (!/^\d+$/.test(days.trim())) {
      setActionError('Enter a whole number of days.');
      return;
    }
    const value = Number(days);
    if (!Number.isSafeInteger(value) || value < 1 || value > 3650) {
      setActionError('Dispute window must be between 1 and 3650 days.');
      return;
    }
    setSavingRules(true);
    try {
      const saved = await rpc<DisputeRules>(
        'admin_set_dispute_rules',
        { p_max_days_after_close: value },
      );
      setDays(String(saved.max_days_after_close));
      toast({ message: 'Dispute window saved', tone: 'success' });
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setSavingRules(false);
    }
  };

  const retry = async (refundId: string) => {
    setRetrying(refundId);
    setActionError(null);
    setRefundActionErrors((current) => {
      const next = { ...current };
      delete next[refundId];
      return next;
    });
    try {
      await rpc('admin_retry_refund', { p_refund_id: refundId });
      toast({ message: 'Refund queued for retry', tone: 'success' });
      load();
    } catch (error) {
      setRefundActionErrors((current) => ({
        ...current,
        [refundId]: (error as Error).message,
      }));
      load();
    } finally {
      setRetrying(null);
    }
  };

  return {
    t,
    money,
    days,
    setDays,
    loadError,
    actionError,
    refundActionErrors,
    savingRules,
    retrying,
    load,
    saveRules,
    retry,
  };
}

export default function AdminRefundsScreen() {
  const {
    t,
    money,
    days,
    setDays,
    loadError,
    actionError,
    refundActionErrors,
    savingRules,
    retrying,
    load,
    saveRules,
    retry,
  } = useAdminRefundsController();

  return (
    <Screen header={<Header title="Refunds" subtitle="Stuck refunds and dispute window" />}>
      {loadError ? (
        <>
          <ErrorState title="Refund operations unavailable" message={loadError} onRetry={load} />
          {Object.entries(refundActionErrors).map(([refundId, message]) => (
            <Card key={refundId} gap={t.spacing.sm}>
              <Text variant="caption" color="muted">Refund {refundId.slice(0, 8)} retry result</Text>
              <InlineAlert message={message} />
            </Card>
          ))}
        </>
      ) : !money ? (
        <Skeleton height={420} radius={t.radii.lg} />
      ) : (
        <>
          <Card gap={t.spacing.md}>
            <Text variant="title3">Closed-booking dispute window</Text>
            <Text variant="footnote" color="muted">
              Applies after a booking is closed. Until configured, disputes on closed bookings are rejected.
            </Text>
            <Input
              label="Maximum days after close"
              keyboardType="number-pad"
              value={days}
              onChangeText={setDays}
              helper="Enter 1–3650 days."
            />
            <InlineAlert message={actionError} />
            <Button
              title="Save dispute window"
              loading={savingRules}
              disabled={savingRules}
              onPress={() => void saveRules()}
            />
          </Card>

          <Card gap={t.spacing.md}>
            <Text variant="title3">Refunds needing attention</Text>
            {money.refunds.length === 0 ? (
              <EmptyState compact title="No stuck refunds" message="Failed and stale processing refunds appear here." />
            ) : money.refunds.map((refund) => (
              <Card key={refund.refund_id} gap={t.spacing.sm}>
                <Text variant="calloutStrong">{formatINR(refund.amount)} · {refund.status}</Text>
                <Text variant="caption" color="muted">
                  Refund {refund.refund_id.slice(0, 8)} · {refund.attempts} attempts
                  {refund.booking_id ? ` · Booking ${refund.booking_id.slice(0, 8)}` : ''}
                </Text>
                {refund.last_error ? <Text variant="caption" color="muted">{refund.last_error}</Text> : null}
                <InlineAlert message={refundActionErrors[refund.refund_id] ?? null} />
                {refund.status === 'failed' ? (
                  <Button
                    title="Retry refund"
                    variant="outline"
                    loading={retrying === refund.refund_id}
                    disabled={retrying != null}
                    onPress={() => void retry(refund.refund_id)}
                  />
                ) : (
                  <Text variant="caption" color="muted">The scheduled worker will reconcile this processing refund.</Text>
                )}
              </Card>
            ))}
            {Object.entries(refundActionErrors)
              .filter(([refundId]) => !money.refunds.some((refund) => refund.refund_id === refundId))
              .map(([refundId, message]) => (
                <Card key={refundId} gap={t.spacing.sm}>
                  <Text variant="caption" color="muted">
                    Refund {refundId.slice(0, 8)} is no longer in the refreshed retry list.
                  </Text>
                  <InlineAlert message={message} />
                </Card>
              ))}
          </Card>

          <Card gap={t.spacing.md}>
            <Text variant="title3">Transfers needing attention</Text>
            <Text variant="footnote" color="muted">
              This list is read-only here; transfer reconciliation and retry remain owned by the transfer work package.
            </Text>
            {money.transfers.length === 0 ? (
              <Text variant="callout" color="muted">No failed or processing transfers.</Text>
            ) : money.transfers.map((transfer) => (
              <View key={transfer.transfer_id} style={{ gap: t.spacing.xs }}>
                <Text variant="calloutStrong">{formatINR(transfer.amount)} · {transfer.status}</Text>
                <Text variant="caption" color="muted">
                  Transfer {transfer.transfer_id.slice(0, 8)} · {transfer.attempts} attempts
                </Text>
                {transfer.last_error ? <Text variant="caption" color="muted">{transfer.last_error}</Text> : null}
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

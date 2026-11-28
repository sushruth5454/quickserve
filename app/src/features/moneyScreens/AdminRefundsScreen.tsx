import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../components/ui';
import { listStuckMoney, type AdminStuckMoney } from '../../lib/adminApi';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';

const STALE_TRANSFER_MS = 30 * 60 * 1000;

interface DisputeRules {
  max_days_after_close: number | null;
}

type AdminMoneyParent =
  | { kind: 'pack'; id: string; label: 'Pack purchase' }
  | { kind: 'sports'; id: string; label: 'Sports booking' }
  | { kind: 'service'; id: string; label: 'Service booking' };

function getAdminMoneyParent(value: {
  booking_id: string | null;
  sports_booking_id: string | null;
  pack_purchase_id: string | null;
}): AdminMoneyParent | null {
  if (value.pack_purchase_id) return { kind: 'pack', id: value.pack_purchase_id, label: 'Pack purchase' };
  if (value.sports_booking_id) return { kind: 'sports', id: value.sports_booking_id, label: 'Sports booking' };
  if (value.booking_id) return { kind: 'service', id: value.booking_id, label: 'Service booking' };
  return null;
}

function openAdminMoneyParent(router: ReturnType<typeof useRouter>, parent: AdminMoneyParent) {
  if (parent.kind === 'service') {
    router.push({ pathname: '/admin/booking/[id]', params: { id: parent.id } });
  } else if (parent.kind === 'sports') {
    router.push('/admin/sports');
  }
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

function useAdminRefundsController() {
  const t = useTheme();
  const router = useRouter();
  const toast = useToast();
  const [money, setMoney] = useState<AdminStuckMoney | null>(null);
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
      listStuckMoney(),
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
    router,
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
    router,
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
            <Text variant="caption" color="muted">
              Failed refund amounts are failed attempts, not returned cash.
            </Text>
            {money.refunds.length === 0 ? (
              <EmptyState compact title="No stuck refunds" message="Failed and stale processing refunds appear here." />
            ) : money.refunds.map((refund) => (
              <Card key={refund.refund_id} gap={t.spacing.sm}>
                <Text variant="calloutStrong">
                  {formatINR(refund.amount)} · {refund.status === 'failed' ? 'failed attempt' : refund.status}
                </Text>
                <Text variant="caption" color="muted">
                  Refund {refund.refund_id.slice(0, 8)} · {refund.attempts} attempts
                </Text>
                {(() => {
                  const parent = getAdminMoneyParent(refund);
                  return parent ? (
                    <>
                      <Text variant="caption" color="muted">
                        {parent.label} {parent.id.slice(0, 8)}
                        {parent.kind === 'pack' ? ' · no service-booking route' : ''}
                      </Text>
                      {parent.kind !== 'pack' ? (
                        <Button
                          title={parent.kind === 'service' ? 'Open booking' : 'Open sports administration'}
                          variant="outline"
                          onPress={() => openAdminMoneyParent(router, parent)}
                        />
                      ) : null}
                    </>
                  ) : (
                    <Text variant="caption" color="muted">Parent unavailable</Text>
                  );
                })()}
                {refund.processing_started_at ? (
                  <Text variant="caption" color="muted">
                    Processing since {new Date(refund.processing_started_at).toLocaleString('en-IN')}
                  </Text>
                ) : null}
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
            ) : money.transfers.map((transfer) => {
              const parent = getAdminMoneyParent(transfer);
              const startedMs = transfer.processing_started_at ? Date.parse(transfer.processing_started_at) : NaN;
              const staleProcessing = transfer.status === 'processing'
                && Number.isFinite(startedMs)
                && Date.now() - startedMs >= STALE_TRANSFER_MS;
              return (
                <View key={transfer.transfer_id} style={{ gap: t.spacing.xs }}>
                  <Text variant="calloutStrong">{formatINR(transfer.amount)} · {transfer.status}</Text>
                  <Text variant="caption" color="muted">
                    Transfer {transfer.transfer_id.slice(0, 8)} · {transfer.attempts} attempts
                    {parent ? ` · ${parent.label} ${parent.id.slice(0, 8)}` : ' · Parent unavailable'}
                    {parent?.kind === 'pack' ? ' · no service-booking route' : ''}
                  </Text>
                  {parent && parent.kind !== 'pack' ? (
                    <Button
                      title={parent.kind === 'service' ? 'Open booking' : 'Open sports administration'}
                      variant="outline"
                      onPress={() => openAdminMoneyParent(router, parent)}
                    />
                  ) : null}
                  <Text variant="caption" color={staleProcessing ? 'dangerText' : 'muted'}>
                    Rail {transfer.rail || 'unknown'} · Gateway {transfer.gateway_status || 'unknown'}
                    {transfer.processing_started_at
                      ? ` · ${staleProcessing ? 'Stale processing (30+ minutes)' : 'Processing since'} ${new Date(transfer.processing_started_at).toLocaleString('en-IN')}`
                      : ''}
                  </Text>
                  {transfer.last_error ? <Text variant="caption" color="muted">{transfer.last_error}</Text> : null}
                </View>
              );
            })}
          </Card>
        </>
      )}
    </Screen>
  );
}

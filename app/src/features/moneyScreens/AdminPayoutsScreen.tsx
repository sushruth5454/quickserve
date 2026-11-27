import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, Input, Screen, Skeleton, Text, useToast } from '../../components/ui';
import { listProblemPayouts, retryPayout, type AdminProblemPayout } from '../../lib/adminApi';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';

const STALE_TRANSFER_MS = 30 * 60 * 1000;

function getPayoutParent(payout: AdminProblemPayout) {
  const packPurchaseId = payout.transfers.find((transfer) => transfer.pack_purchase_id)?.pack_purchase_id;
  if (packPurchaseId) return { kind: 'pack' as const, id: packPurchaseId };
  if (payout.sports_booking_id) return { kind: 'sports' as const, id: payout.sports_booking_id };
  if (payout.booking_id) return { kind: 'service' as const, id: payout.booking_id };
  return null;
}

function openPayoutParent(router: ReturnType<typeof useRouter>, parent: NonNullable<ReturnType<typeof getPayoutParent>>) {
  if (parent.kind === 'service') {
    router.push({ pathname: '/admin/booking/[id]', params: { id: parent.id } });
  } else if (parent.kind === 'sports') {
    router.push('/admin/sports');
  }
}

function useAdminPayoutsController() {
  const t = useTheme();
  const toast = useToast();
  const router = useRouter();
  const [payouts, setPayouts] = useState<AdminProblemPayout[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setPayouts(null);
    void listProblemPayouts()
      .then((result) => setPayouts(result.payouts))
      .catch((cause: Error) => setError(cause.message));
  }, []);
  useFocusEffect(load);

  const retry = async (payout: AdminProblemPayout) => {
    const note = (notes[payout.id] ?? '').trim();
    if (!note) {
      setError('A note is required for every payout retry.');
      return;
    }
    setRetrying(payout.id);
    setError(null);
    try {
      await retryPayout(payout.id, note);
      setNotes((current) => ({ ...current, [payout.id]: '' }));
      toast({ message: 'Payout retry queued', tone: 'success' });
      load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setRetrying(null);
    }
  };

  return { t, router, payouts, notes, setNotes, error, retrying, load, retry };
}

export default function AdminPayoutsScreen() {
  const { t, router, payouts, notes, setNotes, error, retrying, load, retry } = useAdminPayoutsController();

  return (
    <Screen header={<Header title="Payout problems" subtitle="Failed payouts, transfer errors and stale transfers" />}>
      <Button title="Audit log" variant="outline" onPress={() => router.push('/admin/audit')} />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!payouts && !error ? <Skeleton height={420} radius={t.radii.lg} /> : null}
      {payouts?.length === 0 ? (
        <EmptyState compact title="No payout problems" message="Failed payouts, transfer errors and stale processing transfers will appear here." />
      ) : null}
      {payouts?.map((payout) => {
        const canRetry = payout.status === 'failed' && payout.transfers.some((transfer) => transfer.status === 'failed');
        const parent = getPayoutParent(payout);
        const parentLabel = parent
          ? `${parent.kind === 'pack' ? 'Pack purchase' : parent.kind === 'sports' ? 'Sports booking' : 'Service booking'} ${parent.id.slice(0, 8)}`
          : 'Parent unavailable';
        return (
          <Card key={payout.id} gap={t.spacing.md}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.sm }}>
              <Text variant="calloutStrong" style={{ flex: 1 }}>
                {payout.provider_name || 'Provider'} · {formatINR(payout.amount)}
              </Text>
              <Text variant="footnoteStrong">{payout.status.replaceAll('_', ' ')}</Text>
            </View>
            <Text variant="caption" color="muted">
              Payout {payout.id.slice(0, 8)} · {parentLabel}
            </Text>
            {parent && parent.kind !== 'pack' ? (
              <Button
                title={parent.kind === 'service' ? 'Open booking' : 'Open sports administration'}
                variant="outline"
                onPress={() => openPayoutParent(router, parent)}
              />
            ) : null}
            <Text variant="footnote" color="muted">
              Gross {formatINR(payout.gross)} · Commission {formatINR(payout.commission)}
            </Text>
            {payout.transfers.map((transfer) => {
              const startedMs = transfer.processing_started_at ? Date.parse(transfer.processing_started_at) : NaN;
              const staleProcessing = transfer.status === 'processing'
                && Number.isFinite(startedMs)
                && Date.now() - startedMs >= STALE_TRANSFER_MS;
              const transferParent = transfer.pack_purchase_id
                ? `Pack purchase ${transfer.pack_purchase_id.slice(0, 8)}`
                : transfer.sports_booking_id
                  ? `Sports booking ${transfer.sports_booking_id.slice(0, 8)}`
                  : transfer.booking_id
                    ? `Service booking ${transfer.booking_id.slice(0, 8)}`
                    : 'Parent unavailable';
              return (
                <View key={transfer.id} style={{ gap: t.spacing.xs }}>
                  <Text variant="footnote">
                    Transfer {transfer.id.slice(0, 8)} · {transfer.status} · {transfer.attempts} attempts
                  </Text>
                  <Text variant="caption" color="muted">
                    {transferParent} · Rail {transfer.rail || 'unknown'} · Gateway {transfer.gateway_status || 'unknown'}
                  </Text>
                  {transfer.processing_started_at ? (
                    <Text variant="caption" color={staleProcessing ? 'dangerText' : 'muted'}>
                      {staleProcessing ? 'Stale processing (30+ minutes)' : 'Processing since'} · {new Date(transfer.processing_started_at).toLocaleString('en-IN')}
                    </Text>
                  ) : null}
                  {transfer.last_error ? <Text variant="caption" color="dangerText">{transfer.last_error}</Text> : null}
                </View>
              );
            })}
            {canRetry ? (
              <>
                <Input
                  label="Retry note (required)"
                  value={notes[payout.id] ?? ''}
                  onChangeText={(value) => setNotes((current) => ({ ...current, [payout.id]: value }))}
                  maxLength={500}
                />
                <Button
                  title="Retry payout"
                  variant="outline"
                  loading={retrying === payout.id}
                  disabled={retrying != null}
                  onPress={() => void retry(payout)}
                />
              </>
            ) : (
              <Text variant="caption" color="muted">
                Retry is available only when the payout and a transfer are both failed.
              </Text>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

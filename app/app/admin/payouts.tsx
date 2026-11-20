import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, Input, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import { listProblemPayouts, retryPayout, type AdminProblemPayout } from '../../src/lib/adminApi';
import { formatINR } from '../../src/lib/money';
import { useTheme } from '../../src/theme';

export default function AdminPayoutsScreen() {
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

  return (
    <Screen header={<Header title="Payout problems" subtitle="Failed payouts and transfer errors" />}>
      <Button title="Audit log" variant="outline" onPress={() => router.push('/admin/audit')} />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!payouts && !error ? <Skeleton height={420} radius={t.radii.lg} /> : null}
      {payouts?.length === 0 ? (
        <EmptyState compact title="No payout problems" message="Failed payouts and transfer errors will appear here." />
      ) : null}
      {payouts?.map((payout) => {
        const canRetry = payout.status === 'failed' && payout.transfers.some((transfer) => transfer.status === 'failed');
        const bookingLabel = payout.booking_id
          ? `Booking ${payout.booking_id.slice(0, 8)}`
          : `Sports booking ${payout.sports_booking_id?.slice(0, 8) ?? '—'}`;
        return (
          <Card key={payout.id} gap={t.spacing.md}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.sm }}>
              <Text variant="calloutStrong" style={{ flex: 1 }}>
                {payout.provider_name || 'Provider'} · {formatINR(payout.amount)}
              </Text>
              <Text variant="footnoteStrong">{payout.status.replaceAll('_', ' ')}</Text>
            </View>
            <Text variant="caption" color="muted">
              Payout {payout.id.slice(0, 8)} · {bookingLabel}
            </Text>
            <Text variant="footnote" color="muted">
              Gross {formatINR(payout.gross)} · Commission {formatINR(payout.commission)}
            </Text>
            {payout.transfers.map((transfer) => (
              <View key={transfer.id} style={{ gap: t.spacing.xs }}>
                <Text variant="footnote">
                  Transfer {transfer.id.slice(0, 8)} · {transfer.status} · {transfer.attempts} attempts
                </Text>
                {transfer.last_error ? <Text variant="caption" color="dangerText">{transfer.last_error}</Text> : null}
              </View>
            ))}
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

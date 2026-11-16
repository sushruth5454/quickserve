import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, Header, PriceRow, Screen, Skeleton, Text, useConfirm, useToast } from '../../../src/components/ui';
import { getBooking, resolveDispute } from '../../../src/lib/adminApi';
import { formatINR } from '../../../src/lib/money';
import { useTheme } from '../../../src/theme';

export default function AdminBookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => {
    if (!id) return;
    void getBooking(id).then(setData).catch(() => setData(null));
  };
  useEffect(load, [id]);
  if (!data) return <Screen header={<Header title="Booking" />}><Skeleton height={450} radius={t.radii.lg} /></Screen>;
  const b = data.booking;
  const disputed = b.status === 'disputed';
  const solve = async (outcome: 'denied' | 'full_refund') => {
    if (!id) return;
    const ok = await confirm({
      title: outcome === 'full_refund' ? 'Refund the customer in full?' : 'Close the dispute without a refund?',
      message: outcome === 'full_refund' ? 'QuickServe will refund all eligible payments and close the dispute.' : 'The provider payout will continue.',
      confirmLabel: outcome === 'full_refund' ? 'Refund & close' : 'Close dispute',
      destructive: outcome === 'full_refund',
    });
    if (!ok) return;
    setBusy(outcome);
    try {
      await resolveDispute(id, outcome, null, outcome === 'full_refund' ? 'Full refund by admin support' : 'Dispute denied by admin support');
      toast({ message: 'Dispute resolved', tone: 'success' });
      load();
    } catch (e) { toast({ message: (e as Error).message, tone: 'error' }); }
    finally { setBusy(null); }
  };
  return (
    <Screen header={<Header title={data.category} subtitle={id?.replaceAll('-', '').slice(0, 8).toUpperCase()} />}>
      <Card gap={t.spacing.md}>
        <Text variant="title2">{b.status?.replaceAll('_', ' ')}</Text>
        <Text>{data.customer?.name} → {data.provider?.name}</Text>
        <Text variant="footnote" color="muted">{data.customer?.phone} · {data.address?.line1}, {data.address?.city}</Text>
        <PriceRow label="Booking total" amount={b.total_amount ?? b.visit_fee ?? 0} emphasis="total" />
      </Card>
      <Card gap={t.spacing.sm}>
        <Text variant="title3">Payments</Text>
        {data.payments?.length ? data.payments.map((p: any) => (
          <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text variant="footnote">{p.purpose} · {p.status}</Text>
            <Text variant="footnoteStrong">{formatINR(p.amount)}</Text>
          </View>
        )) : <EmptyState compact title="No payments" icon="card-outline" />}
      </Card>
      <Card gap={t.spacing.sm}>
        <Text variant="title3">Timeline</Text>
        {data.events?.map((e: any, i: number) => (
          <Text key={`${e.at}-${i}`} variant="caption" color="muted">{new Date(e.at).toLocaleString('en-IN')} · {e.to} · {e.note}</Text>
        ))}
      </Card>
      {disputed ? (
        <Card gap={t.spacing.sm}>
          <Text variant="title3">Resolve dispute</Text>
          <Button title="No refund — release provider" loading={busy === 'denied'} onPress={() => void solve('denied')} />
          <Button title="Full refund — reverse payout" variant="destructiveGhost" loading={busy === 'full_refund'} onPress={() => void solve('full_refund')} />
        </Card>
      ) : null}
    </Screen>
  );
}

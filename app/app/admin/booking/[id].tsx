import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, Input, PriceRow, Screen, Skeleton, Text, useConfirm, useToast } from '../../../src/components/ui';
import { getBooking, resolveDispute, type AdminBookingDetail } from '../../../src/lib/adminApi';
import { parsePartialRefundRupees } from '../../../src/lib/adminMoney';
import { formatINR } from '../../../src/lib/money';
import { useTheme } from '../../../src/theme';

export default function AdminBookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<AdminBookingDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refundRupees, setRefundRupees] = useState('');
  const [refundNote, setRefundNote] = useState('');
  const [refundError, setRefundError] = useState<string | null>(null);
  const load = () => {
    if (!id) return;
    setLoadError(null);
    setData(null);
    void getBooking(id)
      .then(setData)
      .catch((error: Error) => setLoadError(error.message))
      .finally(() => setBusy(null));
  };
  useEffect(load, [id]);
  if (loadError) return <Screen header={<Header title="Booking" />}><ErrorState title="Booking unavailable" message={loadError} onRetry={load} /></Screen>;
  if (!data) return <Screen header={<Header title="Booking" />}><Skeleton height={450} radius={t.radii.lg} /></Screen>;
  const b = data.booking;
  const disputed = b.status === 'disputed';
  const cashPayments = data.payments
    .filter((payment) => payment.status === 'paid' && payment.funding_source !== 'coins' && payment.gateway_id);
  const cashPaymentIds = new Set(cashPayments.map((payment) => payment.id));
  const paidCashPaise = cashPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const priorRefundPaise = data.refunds
    .filter((refund) => refund.status !== 'failed' && cashPaymentIds.has(refund.payment_id))
    .reduce((sum, refund) => sum + refund.amount, 0);
  const refundableCashPaise = Math.max(paidCashPaise - priorRefundPaise, 0);
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
  const solvePartial = async () => {
    if (!id) return;
    setRefundError(null);
    const amountPaise = parsePartialRefundRupees(refundRupees, refundableCashPaise);
    const note = refundNote.trim();
    if (amountPaise == null) {
      setRefundError(`Enter a whole-rupee amount no greater than ${formatINR(refundableCashPaise)}.`);
      return;
    }
    if (!note) {
      setRefundError('A note is required for a partial refund.');
      return;
    }
    const ok = await confirm({
      title: 'Issue a partial refund?',
      message: `Refund ${formatINR(amountPaise)} to the customer. This action will be recorded in the audit log.`,
      confirmLabel: 'Refund & close',
      destructive: true,
    });
    if (!ok) return;
    setBusy('partial_refund');
    try {
      await resolveDispute(id, 'partial_refund', amountPaise, note);
      setRefundRupees('');
      setRefundNote('');
      toast({ message: 'Partial refund submitted', tone: 'success' });
      load();
    } catch (error) {
      setRefundError((error as Error).message);
    } finally { setBusy(null); }
  };
  return (
    <Screen header={<Header title={data.category} subtitle={id?.replaceAll('-', '').slice(0, 8).toUpperCase()} />}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
        <Button title="Payout problems" variant="outline" onPress={() => router.push('/admin/payouts')} />
        <Button
          title="Audit log"
          variant="outline"
          onPress={() => router.push({ pathname: '/admin/audit', params: { target: id } })}
        />
      </View>
      <Card gap={t.spacing.md}>
        <Text variant="title2">{b.status?.replaceAll('_', ' ')}</Text>
        <Text>{data.customer.name} → {data.provider.name}</Text>
        <Text variant="footnote" color="muted">
          {data.customer.phone ?? 'No customer phone'} · {data.address?.line1}, {data.address?.city}
        </Text>
        <PriceRow label="Booking total" amount={b.total_amount ?? b.visit_fee ?? 0} emphasis="total" />
      </Card>
      <Card gap={t.spacing.sm}>
        <Text variant="title3">Payments</Text>
        {data.payments.length ? data.payments.map((p) => (
          <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text variant="footnote">{p.purpose} · {p.status}</Text>
            <Text variant="footnoteStrong">{formatINR(p.amount)}</Text>
          </View>
        )) : <EmptyState compact title="No payments" icon="card-outline" />}
      </Card>
      <Card gap={t.spacing.sm}>
        <Text variant="title3">Timeline</Text>
        {data.events.map((e, i) => (
          <Text key={`${e.at}-${i}`} variant="caption" color="muted">
            {new Date(e.at).toLocaleString('en-IN')} · {e.actor_role} · {e.actor_id ?? 'system'} · {e.to} · {e.note}
          </Text>
        ))}
      </Card>
      <Card gap={t.spacing.sm}>
        <Text variant="title3">Refunds</Text>
        {data.refunds.length ? data.refunds.map((refund) => (
          <View key={refund.id} style={{ gap: 2 }}>
            <Text variant="footnoteStrong">{formatINR(refund.amount)} · {refund.status}</Text>
            <Text variant="caption" color="muted">
              {refund.attempts} attempts · {refund.last_error || 'No recorded error'}
            </Text>
          </View>
        )) : <EmptyState compact title="No refunds" icon="card-outline" />}
      </Card>
      <Card gap={t.spacing.sm}>
        <Text variant="title3">Payouts</Text>
        {data.payouts.length ? data.payouts.map((payout) => (
          <View key={payout.id} style={{ gap: 2 }}>
            <Text variant="footnoteStrong">
              {formatINR(payout.amount)} · {payout.status}
            </Text>
            <Text variant="caption" color="muted">
              Gross {formatINR(payout.gross)} · Commission {formatINR(payout.commission)}
              {' · Release after '}{new Date(payout.release_after).toLocaleString('en-IN')}
              {payout.transferred_at ? ` · Transferred ${new Date(payout.transferred_at).toLocaleString('en-IN')}` : ''}
            </Text>
          </View>
        )) : <EmptyState compact title="No payouts" icon="cash-outline" />}
      </Card>
      <Card gap={t.spacing.sm}>
        <Text variant="title3">Transfers</Text>
        {data.transfers.length ? data.transfers.map((transfer) => (
          <View key={transfer.id} style={{ gap: 2 }}>
            <Text variant="footnoteStrong">
              {formatINR(transfer.amount)} · {transfer.status} · {transfer.attempts} attempts
            </Text>
            {transfer.last_error ? <Text variant="caption" color="dangerText">{transfer.last_error}</Text> : null}
          </View>
        )) : <EmptyState compact title="No transfers" icon="swap-horizontal-outline" />}
      </Card>
      <Card gap={t.spacing.sm}>
        <Text variant="title3">Reversals</Text>
        {data.reversals.length ? data.reversals.map((reversal) => (
          <Text key={reversal.id} variant="footnote">
            {formatINR(reversal.amount)} · {reversal.status} · {reversal.attempts} attempts
            {reversal.last_error ? ` · ${reversal.last_error}` : ''}
          </Text>
        )) : <EmptyState compact title="No reversals" icon="return-down-back-outline" />}
      </Card>
      <Card gap={t.spacing.sm}>
        <Text variant="title3">Provider receivables</Text>
        {data.receivables.length ? data.receivables.map((receivable) => (
          <Text key={receivable.id} variant="footnote">
            {formatINR(receivable.amount - receivable.recovered)} outstanding · {receivable.status} · {receivable.reason}
          </Text>
        )) : <EmptyState compact title="No receivables" icon="wallet-outline" />}
      </Card>
      {disputed ? (
        <Card gap={t.spacing.sm}>
          <Text variant="title3">Resolve dispute</Text>
          <Button title="No refund — release provider" loading={busy === 'denied'} onPress={() => void solve('denied')} />
          <Button title="Full refund — reverse payout" variant="destructiveGhost" loading={busy === 'full_refund'} onPress={() => void solve('full_refund')} />
          <Text variant="calloutStrong">Partial refund</Text>
          <Text variant="caption" color="muted">Cash paid available: {formatINR(refundableCashPaise)}. Enter whole rupees.</Text>
          <Input
            label="Refund amount (rupees)"
            value={refundRupees}
            onChangeText={(value) => {
              setRefundRupees(value);
              setRefundError(null);
            }}
            keyboardType="number-pad"
          />
          <Input
            label="Admin note (required)"
            value={refundNote}
            onChangeText={(value) => {
              setRefundNote(value);
              setRefundError(null);
            }}
            multiline
            maxLength={500}
          />
          {refundError ? <Text variant="footnote" color="dangerText">{refundError}</Text> : null}
          <Button
            title="Partial refund & close"
            variant="destructiveGhost"
            loading={busy === 'partial_refund'}
            disabled={busy != null}
            onPress={() => void solvePartial()}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

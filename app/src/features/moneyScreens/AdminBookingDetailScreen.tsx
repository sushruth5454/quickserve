import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, Input, PriceRow, Screen, Skeleton, Text, useConfirm, useToast } from '../../components/ui';
import { getBooking, resolveDispute, type AdminBookingDetail } from '../../lib/adminApi';
import { parsePartialRefundRupees, partialRefundLimitPaise } from '../../lib/adminMoney';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';

const CAPTURED_PAYMENT_STATUSES = new Set(['paid', 'refund_pending', 'refund_processing', 'refunded']);

function paymentFundingLabel(payment: AdminBookingDetail['payments'][number]) {
  const captured = CAPTURED_PAYMENT_STATUSES.has(payment.status);
  const gatewayId = payment.gateway_id?.trim() ?? '';
  if (payment.funding_source === 'coins') return captured ? 'Coins applied' : 'Coins payment not captured';
  if (payment.funding_source === 'customer' && captured && gatewayId.startsWith('pay_demo_')) return 'Demo captured';
  if (
    payment.funding_source === 'customer'
    && captured
    && gatewayId.length > 0
    && !gatewayId.startsWith('pay_demo_')
  ) return 'Cash captured';
  if (payment.funding_source === 'customer') return 'Customer funding; capture not confirmed';
  return 'Funding source not recorded';
}

export default function AdminBookingDetailScreen() {
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
  const resolveLock = useRef(false);
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
  const partialRefundLimit = partialRefundLimitPaise(data);
  const beginResolve = (action: string) => {
    if (resolveLock.current || busy != null) return false;
    resolveLock.current = true;
    setBusy(action);
    return true;
  };
  const finishResolve = () => {
    resolveLock.current = false;
    setBusy(null);
  };
  const solve = async (outcome: 'denied' | 'full_refund') => {
    if (!id || !beginResolve(outcome)) return;
    try {
      const ok = await confirm({
        title: outcome === 'full_refund' ? 'Refund the customer in full?' : 'Close the dispute without a refund?',
        message: outcome === 'full_refund' ? 'QuickServe will refund all eligible payments and close the dispute.' : 'The provider payout will continue.',
        confirmLabel: outcome === 'full_refund' ? 'Refund & close' : 'Close dispute',
        destructive: outcome === 'full_refund',
      });
      if (!ok) return;
      await resolveDispute(id, outcome, null, outcome === 'full_refund' ? 'Full refund by admin support' : 'Dispute denied by admin support');
      toast({ message: 'Dispute resolved', tone: 'success' });
      load();
    } catch (error) {
      toast({ message: (error as Error).message, tone: 'error' });
    } finally {
      finishResolve();
    }
  };
  const solvePartial = async () => {
    if (!id || resolveLock.current || busy != null) return;
    setRefundError(null);
    const amountPaise = parsePartialRefundRupees(refundRupees, partialRefundLimit);
    const note = refundNote.trim();
    if (amountPaise == null) {
      setRefundError(`Enter a whole-rupee amount no greater than ${formatINR(partialRefundLimit)}.`);
      return;
    }
    if (note.length < 1 || note.length > 500) {
      setRefundError('Enter an admin note between 1 and 500 characters.');
      return;
    }
    if (!beginResolve('partial_refund')) return;
    try {
      const ok = await confirm({
        title: 'Issue a partial refund?',
        message: `Refund ${formatINR(amountPaise)} to the customer. This action will be recorded in the audit log.`,
        confirmLabel: 'Refund & close',
        destructive: true,
      });
      if (!ok) return;
      await resolveDispute(id, 'partial_refund', amountPaise, note);
      setRefundRupees('');
      setRefundNote('');
      toast({ message: 'Partial refund submitted', tone: 'success' });
      load();
    } catch (error) {
      setRefundError((error as Error).message);
    } finally {
      finishResolve();
    }
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
            <View style={{ flex: 1 }}>
              <Text variant="footnote">{p.purpose} · {p.status}</Text>
              <Text variant="caption" color="muted">{paymentFundingLabel(p)}</Text>
            </View>
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
        <Text variant="caption" color="muted">
          Failed refund amounts are failed attempts, not returned cash.
        </Text>
        {data.refunds.length ? data.refunds.map((refund) => (
          <View key={refund.id} style={{ gap: 2 }}>
            <Text variant="footnoteStrong">
              {formatINR(refund.amount)} · {refund.status === 'failed' ? 'failed attempt' : refund.status}
            </Text>
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
            <Text variant="caption" color="muted">
              Rail {transfer.rail || 'unknown'} · Gateway {transfer.gateway_status || 'unknown'}
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
          <Button title="No refund — release provider" loading={busy === 'denied'} disabled={busy != null} onPress={() => void solve('denied')} />
          <Button title="Full refund — reverse payout" variant="destructiveGhost" loading={busy === 'full_refund'} disabled={busy != null} onPress={() => void solve('full_refund')} />
          <Text variant="calloutStrong">Partial refund</Text>
          <Text variant="caption" color="muted">Cash available for partial refund: {formatINR(partialRefundLimit)}. Enter whole rupees.</Text>
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

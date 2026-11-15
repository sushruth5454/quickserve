import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
<<<<<<< HEAD
import { Badge, Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text, useConfirm, useToast } from '../../src/components/ui';
import { acceptProposal, getServiceRequest, type Proposal, type ServiceRequest } from '../../src/features/catalogue/api';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { formatINR } from '../../src/lib/money';
import { usePayment } from '../../src/lib/payments';
import { useTheme } from '../../src/theme';

const statusTone = (status: Proposal['status']) => status === 'sent' ? 'info' : status === 'accepted' ? 'success' : 'neutral';

export default function ServiceRequestDetail() {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const pay = usePayment();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { location } = useSelectedLocation();
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return Promise.resolve();
    return getServiceRequest(id).then(setRequest).catch((caught: Error) => setError(caught.message));
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const accept = async (proposal: Proposal) => {
    const ok = await confirm({
      title: `Accept ${proposal.providers?.profiles?.full_name ?? 'this provider'}?`,
      message: 'The proposal total and milestone schedule will be fixed. Other providers are closed out only after the advance is paid.',
      confirmLabel: `Pay ${formatINR(proposal.proposal_schedule?.[0]?.amount ?? proposal.total)}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const bookingId = await acceptProposal(proposal.id, location.addressId ?? null);
      await pay(bookingId);
      toast({ message: 'Proposal accepted. Complete the advance to confirm.', tone: 'success' });
      router.replace({ pathname: '/booking/[id]', params: { id: bookingId } });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!request) return <Screen header={<Header title="Proposals" />} >{error ? <ErrorState message={error} onRetry={() => void load()} /> : <Skeleton height={280} radius={t.radii.lg} />}</Screen>;
  const active = (request.proposals ?? []).filter((proposal) => proposal.status === 'sent').sort((a, b) => a.total - b.total);
  const selectedProposal = active.find((proposal) => proposal.id === selected);
  return (
    <Screen
      header={<Header title={request.categories?.name ?? 'Service request'} subtitle={`${active.length} proposal${active.length === 1 ? '' : 's'} received`} />}
      footer={selectedProposal ? <Button title={`Accept ${formatINR(selectedProposal.total)} proposal`} onPress={() => void accept(selectedProposal)} loading={busy} fullWidth size="lg" /> : undefined}
    >
      <InlineAlert message={error} />
      <Card variant="outlined" gap={t.spacing.sm}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title3">Your brief</Text>
          <Badge label={request.status.replaceAll('_', ' ')} tone={request.status === 'open' ? 'info' : 'success'} />
        </View>
        <Text variant="callout" color="textSecondary">{request.event_start ? new Date(request.event_start).toLocaleString('en-IN') : request.city}</Text>
        {request.budget_min || request.budget_max ? <Text variant="footnote" color="muted">Budget {formatINR(request.budget_min ?? 0)}–{formatINR(request.budget_max ?? request.budget_min ?? 0)}</Text> : null}
      </Card>
      {active.length === 0 ? (
        <EmptyState icon="hourglass-outline" title="Proposals are on the way" message="Matching, verified providers can respond until this request expires. You will be notified." />
      ) : (
        <>
          <Text variant="title3">Compare proposals</Text>
          <View style={{ gap: t.spacing.md }}>
            {active.map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} selected={proposal.id === selected} onPress={() => setSelected(proposal.id)} />
            ))}
          </View>
=======
import { Button, Card, EmptyState, ErrorState, Header, Screen, Section, Skeleton, Text } from '../../src/components/ui';
import * as api from '../../src/lib/api';
import { formatINR } from '../../src/lib/money';
import type { Proposal, ServiceRequest } from '../../src/lib/types';

export default function ServiceRequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [r, p] = await Promise.all([api.getServiceRequest(id), api.listRequestProposals(id)]);
      setRequest(r); setProposals(p); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  return (
    <Screen header={<Header title={request?.categories?.name ?? 'Your request'} subtitle={request ? new Date(request.event_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : undefined} />}>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : !request ? <Skeleton height={180} /> : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="calloutStrong">{request.status === 'open' ? 'Proposals arriving' : request.status}</Text>
              <Text variant="caption" color="muted">Expires {new Date(request.expires_at).toLocaleDateString('en-IN')}</Text>
            </View>
            <Text color="textSecondary">{request.area || request.city}</Text>
            <Text variant="footnote" color="muted">Your address and contact details stay hidden until the advance is paid.</Text>
          </Card>
          <Section title="Proposals" subtitle="Compare fixed totals, milestones and delivery terms.">
            {proposals.length === 0 ? (
              <EmptyState icon="document-text-outline" title="Waiting for proposals" message="Verified providers will reply here. In-app questions appear in each proposal thread." />
            ) : proposals.map((p) => (
              <Pressable key={p.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/proposal/[id]', params: { id: p.id, requestId: request.id } })}>
                <Card>
                  <Text variant="bodyStrong">{p.providers?.profiles?.full_name ?? 'Verified provider'}</Text>
                  <Text variant="title3">{formatINR(p.total)}</Text>
                  <Text color="muted">{p.proposal_schedule.length} payments · valid until {new Date(p.valid_until).toLocaleDateString('en-IN')}</Text>
                  <Button title="Compare proposal" variant="outline" onPress={() => router.push({ pathname: '/proposal/[id]', params: { id: p.id, requestId: request.id } })} />
                </Card>
              </Pressable>
            ))}
          </Section>
>>>>>>> 3844b2b (feat: add proposal milestone booking engine)
        </>
      )}
    </Screen>
  );
}
<<<<<<< HEAD

function ProposalCard({ proposal, selected, onPress }: { proposal: Proposal; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress}>
      <Card variant={selected ? 'elevated' : 'outlined'} gap={t.spacing.md}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text variant="title3">{proposal.providers?.profiles?.full_name ?? 'Verified provider'}</Text>
            <Text variant="footnote" color="muted">{proposal.providers?.rating_count ? `${Number(proposal.providers.rating_avg).toFixed(1)} ★ (${proposal.providers.rating_count})` : 'New provider'} · Version {proposal.version}</Text>
          </View>
          <Badge label={proposal.status} tone={statusTone(proposal.status) as 'success' | 'info' | 'neutral'} />
        </View>
        <Text variant="title2" color="primaryText">{formatINR(proposal.total)}</Text>
        {(proposal.proposal_items ?? []).length ? (
          <View style={{ gap: 4 }}>
            {(proposal.proposal_items ?? []).map((item) => (
              <View key={item.id} style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>{item.qty} × {item.title}</Text>
                <Text variant="footnoteStrong">{formatINR(item.qty * item.unit_price)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {proposal.note ? <Text variant="footnote" color="textSecondary">{proposal.note}</Text> : null}
        {(proposal.proposal_schedule ?? []).length ? (
          <View style={{ gap: 4, paddingTop: t.spacing.xs }}>
            <Text variant="caption" color="muted">PAYMENT MILESTONES</Text>
            {(proposal.proposal_schedule ?? []).map((milestone) => (
              <View key={milestone.seq} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="footnote">{milestone.label}</Text>
                <Text variant="footnoteStrong">{formatINR(milestone.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}
=======
>>>>>>> 3844b2b (feat: add proposal milestone booking engine)

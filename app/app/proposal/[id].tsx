import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Screen, Section, Skeleton, Text } from '../../src/components/ui';
import * as api from '../../src/lib/api';
import { formatINR } from '../../src/lib/money';
import { usePayment } from '../../src/lib/payments';
import type { Proposal } from '../../src/lib/types';

export default function ProposalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startPayment = usePayment();

  useEffect(() => {
    if (id) void api.getProposal(id).then(setProposal).catch((e: unknown) => setError((e as Error).message));
  }, [id]);

  const accept = async () => {
    if (!proposal) return;
    setBusy(true);
    try {
      const bookingId = await api.acceptProposal(proposal.id);
      await startPayment(bookingId);
      router.replace({ pathname: '/booking/[id]', params: { id: bookingId } });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen
      header={<Header title="Proposal" subtitle={proposal?.providers?.profiles?.full_name ?? undefined} />}
      footer={proposal?.status === 'sent' ? <Button title={`Accept & reserve · ${formatINR(proposal.total)}`} fullWidth size="lg" loading={busy} onPress={() => void accept()} /> : undefined}
    >
      {error ? <ErrorState message={error} onRetry={() => id && void api.getProposal(id).then(setProposal)} /> : !proposal ? <Skeleton height={260} /> : (
        <>
          <InlineAlert title="30-minute payment hold" message="Accepting reserves the provider for 30 minutes. Pay the advance and platform fee in that window to confirm." />
          <Card>
            <Text variant="title2">{formatINR(proposal.total)}</Text>
            {proposal.note ? <Text color="textSecondary">{proposal.note}</Text> : null}
          </Card>
          <Section title="Included work">
            {proposal.proposal_items.map((item) => (
              <Card key={`${proposal.id}-${item.seq}`}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                  <View style={{ flex: 1 }}><Text variant="calloutStrong">{item.title}</Text><Text variant="caption" color="muted">{item.qty} {item.unit ?? ''}</Text></View>
                  <Text variant="calloutStrong" tabular>{formatINR(Math.round(item.qty * item.unit_price))}</Text>
                </View>
              </Card>
            ))}
          </Section>
          <Section title="Payment milestones">
            {proposal.proposal_schedule.map((row) => (
              <Card key={row.id}>
                <Text variant="bodyStrong">{row.label}</Text>
                <Text>{formatINR(row.amount)}</Text>
                <Text variant="caption" color="muted">{row.due_rule.replaceAll('_', ' ')}</Text>
              </Card>
            ))}
          </Section>
          <Section title="Deliverables">
            {(proposal.deliverables as { type?: string; spec?: string }[]).length ? (proposal.deliverables as { type?: string; spec?: string }[]).map((d, i) =>
              <Text key={i}>• {d.type ?? 'Delivery'}{d.spec ? ` — ${d.spec}` : ''}</Text>) : <Text color="muted">No separate post-service deliverables.</Text>}
          </Section>
        </>
      )}
    </Screen>
  );
}

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Screen, Section, Skeleton, Text } from '../../src/components/ui';
import * as api from '../../src/lib/api';
import { formatINR } from '../../src/lib/money';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { useAuth } from '../../src/lib/auth';
import { usePayment } from '../../src/lib/payments';
import type { Proposal } from '../../src/lib/types';
import { deliverableLabel, dueRuleLabel, proposalStatus } from '../../src/lib/proposalStatus';
import {
  acceptProposalWithFeePreview,
  getCreatorProposalConfig,
  getProposalFeePreview,
  proposalWithDeliveryDate,
  type ProposalFeePreview,
} from '../../src/features/proposals/api';
import { RequestQuestionThread } from '../../src/features/proposals/RequestQuestionThread';
import { proposalFeeChanged, proposalFeeLabel } from '../../src/features/proposals/model';

export default function ProposalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [feePreview, setFeePreview] = useState<ProposalFeePreview | null>(null);
  const [feePreviewError, setFeePreviewError] = useState<string | null>(null);
  const [defaultRevisions, setDefaultRevisions] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const startPayment = usePayment();
  const { location } = useSelectedLocation();
  const { userId } = useAuth();
  // The provider who sent it sees the same proposal read-only: accepting is the customer's action.
  const mine = !!proposal && proposal.provider_id === userId;

  useEffect(() => {
    if (!id) return;
    let active = true;
    void api.getProposal(id).then((next) => {
      if (active) setProposal(next);
    }).catch((e: unknown) => {
      if (active) setError((e as Error).message);
    });
    void getProposalFeePreview(id).then((next) => {
      if (active) {
        setFeePreview(next);
        setFeePreviewError(null);
      }
    }).catch((caught: Error) => {
      if (active) {
        setFeePreview(null);
        setFeePreviewError(caught.message);
      }
    });
    void getCreatorProposalConfig().then((config) => {
      if (active) setDefaultRevisions(config.defaultRevisions);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [id]);

  const accept = async () => {
    if (!proposal) return;
    if (!feePreview) {
      setFeePreviewError('Refresh the proposal to load its platform fee before accepting.');
      return;
    }
    setBusy(true);
    setAcceptError(null);
    try {
      const latestFeePreview = await getProposalFeePreview(proposal.id);
      if (proposalFeeChanged(feePreview, latestFeePreview)) {
        setFeePreview(latestFeePreview);
        setAcceptError('The amount due today changed. Review the updated fee and tap Accept again to continue.');
        return;
      }
      // The venue: the request's own address if it has one, otherwise the saved address currently selected.
      const bookingId = await acceptProposalWithFeePreview(proposal.id, location.addressId ?? null, latestFeePreview);
      await startPayment(bookingId);
      router.replace({ pathname: '/booking/[id]', params: { id: bookingId } });
    } catch (e) {
      const message = (e as Error).message;
      if (/fee preview changed/i.test(message)) {
        try {
          setFeePreview(await getProposalFeePreview(proposal.id));
          setAcceptError('The amount due today changed. Review the updated fee and tap Accept again to continue.');
          return;
        } catch {
          setFeePreview(null);
          setFeePreviewError('Refresh the proposal to load its current platform fee.');
          return;
        }
      }
      setAcceptError(/address is required/i.test(message)
        ? 'Choose a saved address for the venue (tap your location at the top of Home), then accept again.'
        : message);
    }
    finally { setBusy(false); }
  };

  const proposalTerms = proposal ? proposalWithDeliveryDate(proposal) : null;
  const deliverables = (proposal?.deliverables ?? []) as Array<{ type?: string; spec?: string; qty?: number }>;
  const revisionsTerm = deliverables.find((item) => item.type === 'revisions');
  const visibleDeliverables = deliverables.filter((item) => item.type !== 'revisions');

  return (
    <Screen
      header={<Header title={mine ? 'Your proposal' : 'Proposal'} subtitle={mine && proposal ? `Status: ${proposalStatus(proposal).label}` : proposal?.providers?.profiles?.full_name ?? undefined} />}
      footer={proposal?.status === 'sent' && !mine ? <Button title={`Accept & reserve · ${formatINR(proposal.total)}`} fullWidth size="lg" loading={busy} disabled={!feePreview} onPress={() => void accept()} /> : undefined}
    >
      {error ? <ErrorState message={error} onRetry={() => id && void api.getProposal(id).then(setProposal)} /> : !proposal ? <Skeleton height={260} /> : (
        <>
          {acceptError ? <InlineAlert title="Could not accept yet" message={acceptError} /> : null}
          {mine && proposal.status === 'accepted' ? (
            <InlineAlert
              title={proposalStatus(proposal).label}
              message={proposalStatus(proposal).label.includes('pending')
                ? 'The customer approved your quote. The booking becomes confirmed only after the advance and platform fee are paid.'
                : undefined}
            />
          ) : mine ? null : <InlineAlert title="30-minute payment hold" message="Accepting reserves the provider for 30 minutes. Pay the advance and platform fee in that window to confirm." />}
          {feePreviewError && proposal.status === 'sent'
            ? <InlineAlert title="Fee preview unavailable" message={feePreviewError} />
            : null}
          <Card>
            <Text variant="title2">{formatINR(proposal.total)}</Text>
            {proposal.note ? <Text color="textSecondary">{proposal.note}</Text> : null}
            {proposalTerms?.delivery_due_at ? (
              <Text variant="footnoteStrong">Delivery by {new Date(proposalTerms.delivery_due_at).toLocaleDateString('en-IN')}</Text>
            ) : null}
            {feePreview && proposal.status === 'sent' ? (
              <Text variant="footnoteStrong">{proposalFeeLabel(feePreview)}</Text>
            ) : null}
          </Card>
          {revisionsTerm || proposal.status === 'sent' ? (
            <Card>
              <Text variant="bodyStrong">Revisions included: {revisionsTerm?.qty ?? defaultRevisions}</Text>
            </Card>
          ) : null}
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
                <Text variant="caption" color="muted">{dueRuleLabel(row.due_rule)}</Text>
              </Card>
            ))}
          </Section>
          <Section title="Deliverables">
            {visibleDeliverables.length ? visibleDeliverables.map((d, i) =>
              <Text key={i}>• {deliverableLabel(d.type ?? 'delivery')}{d.spec ? ` — ${d.spec}` : ''}</Text>)
              : <Text color="muted">No separate post-service deliverables.</Text>}
          </Section>
          <Section title="Questions">
            <RequestQuestionThread
              requestId={proposal.request_id}
              providerId={proposal.provider_id}
              otherPartyLabel={mine ? 'Customer' : 'Creator'}
            />
          </Section>
        </>
      )}
    </Screen>
  );
}

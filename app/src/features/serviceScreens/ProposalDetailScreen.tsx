import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Screen, Section, Skeleton, Text } from '../../components/ui';
import * as api from '../../lib/api';
import { formatINR } from '../../lib/money';
import { useSelectedLocation } from '../../lib/locationContext';
import { usePayment } from '../../lib/payments';
import type { Proposal, ProposalViewState } from '../../lib/types';
import { deliverableLabel, dueRuleLabel, proposalStatus } from '../../lib/proposalStatus';
import {
  acceptProposalWithFeePreview,
  getCreatorProposalConfig,
  getProposalFeePreview,
  getProposalViewState,
  proposalWithDeliveryDate,
  type ProposalFeePreview,
} from '../proposals/api';
import { RequestQuestionThread } from '../proposals/RequestQuestionThread';
import { proposalFeeChanged, proposalFeeLabel } from '../proposals/model';

export default function ProposalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [viewState, setViewState] = useState<ProposalViewState | null>(null);
  const [feePreview, setFeePreview] = useState<ProposalFeePreview | null>(null);
  const [feePreviewError, setFeePreviewError] = useState<string | null>(null);
  const [defaultRevisions, setDefaultRevisions] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const startPayment = usePayment();
  const { location } = useSelectedLocation();
  const providerView = viewState?.viewer_role === 'owner' || viewState?.viewer_role === 'manager';
  const status = proposal && viewState ? proposalStatus(proposal, viewState) : null;

  const refresh = async () => {
    if (!id) return;
    const [nextProposal, nextView] = await Promise.all([api.getProposal(id), getProposalViewState(id)]);
    setProposal(nextProposal);
    setViewState(nextView);
    setError(null);
    setAcceptError(null);
    if (nextView.can_accept) {
      try {
        setFeePreview(await getProposalFeePreview(id));
        setFeePreviewError(null);
      } catch (caught) {
        setFeePreview(null);
        setFeePreviewError((caught as Error).message);
      }
    } else {
      setFeePreview(null);
      setFeePreviewError(null);
    }
  };

  useEffect(() => {
    if (!id) return;
    let active = true;
    void Promise.all([api.getProposal(id), getProposalViewState(id)])
      .then(async ([nextProposal, nextView]) => {
        if (!active) return;
        setProposal(nextProposal);
        setViewState(nextView);
        if (nextView.can_accept) {
          try {
            const preview = await getProposalFeePreview(id);
            if (active) {
              setFeePreview(preview);
              setFeePreviewError(null);
            }
          } catch (caught) {
            if (active) {
              setFeePreview(null);
              setFeePreviewError((caught as Error).message);
            }
          }
        } else {
          setFeePreview(null);
          setFeePreviewError(null);
        }
        if (nextView.viewer_role === 'owner' || nextView.viewer_role === 'manager') {
          void getCreatorProposalConfig().then((config) => {
            if (active) setDefaultRevisions(config.defaultRevisions);
          }).catch(() => undefined);
        }
      })
      .catch((caught: Error) => {
        if (active) setError(caught.message);
      });
    return () => { active = false; };
  }, [id]);

  const accept = async () => {
    if (!proposal || !viewState?.can_accept) return;
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
      const bookingId = await acceptProposalWithFeePreview(proposal.id, location.addressId ?? null, latestFeePreview);
      await startPayment(bookingId);
      router.replace({ pathname: '/booking/[id]', params: { id: bookingId } });
    } catch (caught) {
      const message = (caught as Error).message;
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
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!proposal || !viewState?.can_withdraw || busy) return;
    setBusy(true);
    setAcceptError(null);
    try {
      await api.withdrawProposal(proposal.id);
      await refresh();
    } catch (caught) {
      setAcceptError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const proposalTerms = proposal ? proposalWithDeliveryDate(proposal) : null;
  const deliverables = (proposal?.deliverables ?? []) as Array<{ type?: string; spec?: string; qty?: number }>;
  const revisionsTerm = deliverables.find((item) => item.type === 'revisions');
  const visibleDeliverables = deliverables.filter((item) => item.type !== 'revisions');
  const currentBookingId = viewState?.current_booking_id;

  return (
    <Screen
      header={<Header title={providerView ? 'Your proposal' : 'Proposal'} subtitle={status?.label ?? proposal?.providers?.profiles?.full_name ?? undefined} />}
      footer={proposal?.status === 'sent' && viewState?.can_accept
        ? <Button title={`Accept & reserve · ${formatINR(proposal.total)}`} fullWidth size="lg" loading={busy} disabled={!feePreview} onPress={() => void accept()} />
        : undefined}
    >
      {error ? <ErrorState message={error} onRetry={() => void refresh().catch((caught: Error) => setError(caught.message))} /> : !proposal || !viewState ? <Skeleton height={260} /> : (
        <>
          {acceptError ? <InlineAlert title="Could not continue yet" message={acceptError} /> : null}
          {feePreviewError && viewState.can_accept
            ? <InlineAlert title="Fee preview unavailable" message={feePreviewError} />
            : null}
          {providerView && proposal.status === 'accepted' ? (
            <InlineAlert
              title={status?.label}
              message={status?.label.includes('pending')
                ? 'The customer approved your quote. The booking becomes confirmed only after the advance and platform fee are paid.'
                : undefined}
            />
          ) : null}
          {viewState.viewer_role === 'customer' && viewState.can_accept ? (
            <InlineAlert title="30-minute payment hold" message="Accepting reserves the provider for 30 minutes. Pay the advance and platform fee in that window to confirm." />
          ) : null}
          {currentBookingId && viewState.viewer_role !== 'admin' ? (
            <Card>
              <Text variant="bodyStrong">{status?.label}</Text>
              <Button
                title="View current booking"
                variant="outline"
                onPress={() => router.push({ pathname: '/booking/[id]', params: { id: currentBookingId } })}
              />
            </Card>
          ) : null}
          <Card>
            <Text variant="title2">{formatINR(proposal.total)}</Text>
            {proposal.note ? <Text color="textSecondary">{proposal.note}</Text> : null}
            {proposalTerms?.delivery_due_at ? (
              <Text variant="footnoteStrong">Delivery by {new Date(proposalTerms.delivery_due_at).toLocaleDateString('en-IN')}</Text>
            ) : null}
            {feePreview && proposal.status === 'sent' && viewState.can_accept ? (
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
            {visibleDeliverables.length ? visibleDeliverables.map((item, index) =>
              <Text key={index}>• {deliverableLabel(item.type ?? 'delivery')}{item.spec ? ` — ${item.spec}` : ''}</Text>)
              : <Text color="muted">No separate post-service deliverables.</Text>}
          </Section>
          {viewState.can_withdraw ? <Button title="Withdraw proposal" variant="destructiveGhost" loading={busy} onPress={() => void withdraw()} /> : null}
          {viewState.can_send_new ? (
            <Button title="Send a new proposal" onPress={() => router.push({ pathname: '/proposal/compose/[requestId]', params: { requestId: proposal.request_id } })} />
          ) : null}
          {viewState.can_message ? (
            <Section title="Questions">
              <RequestQuestionThread
                requestId={proposal.request_id}
                providerId={proposal.provider_id}
                otherPartyLabel={viewState.viewer_role === 'customer' ? 'Creator' : 'Customer'}
              />
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Section, Skeleton, Text, useConfirm, useToast } from '../../components/ui';
import * as api from '../../lib/api';
import { formatINR } from '../../lib/money';
import type { Proposal, ProposalViewState, ServiceRequest } from '../../lib/types';
import { QuoteCompareTable } from '../../components/market/QuoteCompareTable';
import { proposalCompareRows } from '../proposals/comparePresentation';
import { getProposalViewState } from '../proposals/api';
import { proposalStatus } from '../../lib/proposalStatus';

export default function RequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [proposalViews, setProposalViews] = useState<Record<string, ProposalViewState>>({});
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [nextRequest, nextProposals] = await Promise.all([api.getServiceRequest(id), api.listRequestProposals(id)]);
      if (!nextRequest) throw new Error('This request is no longer available');
      const viewEntries = await Promise.all(nextProposals.map(async (proposal) => [
        proposal.id,
        await getProposalViewState(proposal.id),
      ] as const));
      setRequest(nextRequest);
      setProposals(nextProposals);
      setProposalViews(Object.fromEntries(viewEntries));
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const cancelRequest = async () => {
    if (!request || !['open', 'closed'].includes(request.status)) return;
    const confirmed = await confirm({
      title: 'Cancel this request?',
      message: 'Providers will no longer be able to send proposals for this brief.',
      confirmLabel: 'Cancel request',
      cancelLabel: 'Keep request',
      destructive: true,
    });
    if (!confirmed) return;
    setActionError(null);
    try {
      await api.cancelServiceRequest(request.id);
      toast({ message: 'Request cancelled', tone: 'success' });
      await load();
    } catch (caught) {
      setActionError((caught as Error).message);
    }
  };

  const openProposal = (proposalId: string) => {
    if (!request) return;
    router.push({ pathname: '/proposal/[id]', params: { id: proposalId, requestId: request.id } });
  };

  return (
    <Screen header={<Header title={request?.categories?.name ?? 'Your request'} subtitle={request ? new Date(request.event_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : undefined} />}>
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !request ? (
        <Skeleton height={180} />
      ) : (
        <>
          {actionError ? <InlineAlert message={actionError} /> : null}
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="calloutStrong">{request.status === 'open' ? 'Proposals arriving' : request.status}</Text>
              <Text variant="caption" color="muted">Expires {new Date(request.expires_at).toLocaleDateString('en-IN')}</Text>
            </View>
            <Text color="textSecondary">{request.area || request.city}</Text>
            {typeof request.intake?.deliver_by === 'string'
              ? <Text variant="footnoteStrong">Deliver by {new Date(request.intake.deliver_by).toLocaleDateString('en-IN')}</Text>
              : null}
            <Text variant="footnote" color="muted">Your address and contact details stay hidden until the advance is paid.</Text>
          </Card>
          <Section title="Proposals" subtitle="Compare fixed totals, milestones and delivery terms.">
            {proposals.length === 0 ? (
              <EmptyState icon="document-text-outline" title="Waiting for proposals" message="Verified providers will reply here. You can ask each provider questions in their proposal thread." />
            ) : (
              <>
                <QuoteCompareTable
                  rows={proposalCompareRows(proposals)}
                  detailHeaders={['Payment milestones', 'Valid until']}
                  selectLabel="Compare proposal"
                  onSelect={openProposal}
                />
                {proposals.map((proposal) => {
                  const state = proposalViews[proposal.id];
                  const stateLabel = proposalStatus(proposal, state ?? null).label;
                  const currentBookingId = state?.current_booking_id;
                  return (
                    <Pressable
                      key={proposal.id}
                      accessibilityRole="button"
                      onPress={() => openProposal(proposal.id)}
                    >
                      <Card>
                        <Text variant="bodyStrong">{proposal.providers?.profiles?.full_name ?? 'Verified provider'}</Text>
                        <Text variant="title3">{formatINR(proposal.total)}</Text>
                        <Text color="muted">{stateLabel}</Text>
                        <Text variant="footnote" color="textSecondary">
                          {proposal.proposal_schedule.length} payments · valid until {new Date(proposal.valid_until).toLocaleDateString('en-IN')}
                        </Text>
                        {currentBookingId && state?.viewer_role === 'customer' ? (
                          <Button
                            title="View current booking"
                            variant="outline"
                            onPress={() => router.push({ pathname: '/booking/[id]', params: { id: currentBookingId } })}
                          />
                        ) : null}
                        <Button title="Compare proposal" variant="outline" onPress={() => openProposal(proposal.id)} />
                      </Card>
                    </Pressable>
                  );
                })}
              </>
            )}
          </Section>
          {['open', 'closed'].includes(request.status) ? (
            <Button title="Cancel request" variant="destructive" onPress={() => void cancelRequest()} />
          ) : null}
        </>
      )}
    </Screen>
  );
}

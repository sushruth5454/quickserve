import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Section, Skeleton, Text, useConfirm, useToast } from '../../components/ui';
import * as api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatINR } from '../../lib/money';
import type { Proposal, ProposalViewState, ServiceRequest } from '../../lib/types';
import { QuoteCompareTable } from '../../components/market/QuoteCompareTable';
import { buildProposalComparison } from '../proposals/comparePresentation';
import { getProposalViewState } from '../proposals/api';
import { proposalStatus } from '../../lib/proposalStatus';
import { useFocusedServiceRefresh } from '../serviceLifecycle/useFocusedServiceRefresh';

export default function RequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [proposalViews, setProposalViews] = useState<Record<string, ProposalViewState>>({});
  const [expandedHistoryProposalId, setExpandedHistoryProposalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    if (!guard.isCurrent()) return;
    if (!id) {
      setUnavailable(true);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const nextRequest = await api.getServiceRequest(id);
      if (!guard.isCurrent()) return;
      if (!nextRequest) {
        setRequest(null);
        setProposals([]);
        setProposalViews({});
        setUnavailable(true);
        setError(null);
        return;
      }
      const nextProposals = await api.listRequestProposals(id);
      if (!guard.isCurrent()) return;
      const viewEntries = await Promise.all(nextProposals.map(async (proposal) => [
        proposal.id,
        await getProposalViewState(proposal.id),
      ] as const));
      if (!guard.isCurrent()) return;
      setRequest(nextRequest);
      setProposals(nextProposals);
      setProposalViews(Object.fromEntries(viewEntries));
      setUnavailable(false);
      setError(null);
    } catch (caught) {
      if (guard.isCurrent()) setError((caught as Error).message);
    } finally {
      if (guard.isCurrent()) setLoading(false);
    }
  }, [id]);

  const { refresh, refreshing } = useFocusedServiceRefresh(load, {
    contextKey: `request:${userId ?? 'anonymous'}:${id ?? ''}`,
    enabled: true,
    intervalMs: id ? 30_000 : null,
  });

  const comparison = request
    ? buildProposalComparison(proposals, proposalViews, request)
    : null;

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
      await refresh();
    } catch (caught) {
      setActionError((caught as Error).message);
    }
  };

  const openProposal = (proposalId: string) => {
    if (!request) return;
    router.push({ pathname: '/proposal/[id]', params: { id: proposalId, requestId: request.id } });
  };

  return (
    <Screen
      header={<Header title={request?.categories?.name ?? 'Your request'} subtitle={request ? new Date(request.event_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : undefined} />}
      refreshing={loading || refreshing}
      onRefresh={() => void refresh()}
    >
      {unavailable ? (
        <EmptyState title="Request unavailable" message="This request may have been removed or you may no longer have access." />
      ) : error && !request ? (
        <ErrorState message={error} onRetry={() => void refresh()} />
      ) : !request ? (
        <Skeleton height={180} />
      ) : (
        <>
          {error ? <InlineAlert title="Request could not be refreshed" message={error} /> : null}
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
          {comparison?.currentBooking ? (
            <Section title="Current booking">
              <Card>
                <Text variant="bodyStrong">This request already has a booking.</Text>
                <Text color="muted">
                  Status: {comparison.currentBooking.state.current_booking_status?.replaceAll('_', ' ') ?? 'Unavailable'}
                </Text>
                <Button
                  title="View current booking"
                  variant="outline"
                  onPress={() => router.push({
                    pathname: '/booking/[id]',
                    params: { id: comparison.currentBooking?.bookingId ?? '' },
                  })}
                />
              </Card>
            </Section>
          ) : null}
          <Section title="Proposals" subtitle="Compare fixed totals, milestones and delivery terms.">
            {proposals.length === 0 ? (
              <EmptyState icon="document-text-outline" title="Waiting for proposals" message="Verified providers will reply here. You can ask each provider questions in their proposal thread." />
            ) : (
              <>
                {comparison ? (
                  <>
                    <QuoteCompareTable
                      rows={comparison.rows}
                      detailHeaders={['Payment milestones', 'Valid until']}
                      selectLabel="View / ask provider"
                      onSelect={openProposal}
                      selectable={(proposalId) => comparison.selectableIds.has(proposalId)}
                      excludeFromLowest={(proposalId) => comparison.excludedFromLowestIds.has(proposalId)}
                      warnings={comparison.warnings}
                    />
                    {comparison.history.length > 0 ? (
                      <Section title="Earlier proposal versions" subtitle="Read-only proposal history.">
                        {comparison.history.map((proposal) => {
                          const state = proposalViews[proposal.id];
                          const expanded = expandedHistoryProposalId === proposal.id;
                          const deliverables = proposal.deliverables as Array<{ type?: string; spec?: string; qty?: number }>;
                          return (
                            <Card key={proposal.id}>
                              <Text variant="bodyStrong">{proposal.providers?.profiles?.full_name ?? 'Verified provider'}</Text>
                              <Text color="muted">
                                Version {proposal.version} · {proposalStatus(proposal, state ?? null).label}
                              </Text>
                              <Text variant="calloutStrong">{formatINR(proposal.total)}</Text>
                              <Button
                                title={expanded ? 'Hide version details' : 'View version details'}
                                variant="outline"
                                onPress={() => setExpandedHistoryProposalId(expanded ? null : proposal.id)}
                              />
                              {expanded ? (
                                <View style={{ gap: 8 }}>
                                  <Text variant="footnote" color="muted">
                                    Valid until {new Date(proposal.valid_until).toLocaleDateString('en-IN')}
                                  </Text>
                                  {proposal.note ? <Text color="textSecondary">{proposal.note}</Text> : null}
                                  {proposal.proposal_items.map((item) => (
                                    <Text key={`${proposal.id}-item-${item.seq}`} variant="footnote">
                                      {item.title} · {item.qty} {item.unit ?? ''} · {formatINR(Math.round(item.qty * item.unit_price))}
                                    </Text>
                                  ))}
                                  {proposal.proposal_schedule.map((payment) => (
                                    <Text key={`${proposal.id}-payment-${payment.seq}`} variant="footnote">
                                      {payment.label} · {formatINR(payment.amount)} · {payment.due_rule.replaceAll('_', ' ')}
                                    </Text>
                                  ))}
                                  {deliverables.map((item, index) => (
                                    <Text key={`${proposal.id}-deliverable-${index}`} variant="footnote">
                                      {item.type?.replaceAll('_', ' ') ?? 'Delivery'}{item.spec ? ` · ${item.spec}` : ''}
                                      {item.qty == null ? '' : ` · ${item.qty}`}
                                    </Text>
                                  ))}
                                </View>
                              ) : null}
                            </Card>
                          );
                        })}
                      </Section>
                    ) : null}
                  </>
                ) : null}
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

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
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
      const [nextRequest, nextProposals] = await Promise.all([api.getServiceRequest(id), api.listRequestProposals(id)]);
      setRequest(nextRequest);
      setProposals(nextProposals);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => void load(), [load]);

  return (
    <Screen header={<Header title={request?.categories?.name ?? 'Your request'} subtitle={request ? new Date(request.event_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : undefined} />}>
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !request ? (
        <Skeleton height={180} />
      ) : (
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
            ) : proposals.map((proposal) => (
              <Pressable
                key={proposal.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/proposal/[id]', params: { id: proposal.id, requestId: request.id } })}
              >
                <Card>
                  <Text variant="bodyStrong">{proposal.providers?.profiles?.full_name ?? 'Verified provider'}</Text>
                  <Text variant="title3">{formatINR(proposal.total)}</Text>
                  <Text color="muted">{proposal.proposal_schedule.length} payments · valid until {new Date(proposal.valid_until).toLocaleDateString('en-IN')}</Text>
                  <Button title="Compare proposal" variant="outline" onPress={() => router.push({ pathname: '/proposal/[id]', params: { id: proposal.id, requestId: request.id } })} />
                </Card>
              </Pressable>
            ))}
          </Section>
        </>
      )}
    </Screen>
  );
}

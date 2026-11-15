import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Card, EmptyState, Section, Text, Button } from '../../components/ui';
import * as api from '../../lib/api';
import type { ProposalRequest } from '../../lib/types';

export function ProviderProposalInbox() {
  const [requests, setRequests] = useState<ProposalRequest[]>([]);
  useFocusEffect(useCallback(() => { void api.listProviderServiceRequests().then(setRequests).catch(() => undefined); }, []));
  return (
    <Section title="Proposal requests" subtitle={requests.length ? 'Reply with a fixed scope and payment plan' : undefined}>
      {requests.length === 0 ? <EmptyState icon="document-text-outline" title="No proposal requests" message="New matched requests appear here privately." /> : requests.map((r) => (
        <Card key={r.id}>
          <Text variant="calloutStrong">{r.category_name}</Text>
          <Text color="textSecondary">{r.area || r.city} · {new Date(r.event_start).toLocaleDateString('en-IN')}</Text>
          <Text variant="caption" color="muted">{String(r.intake?.brief ?? 'Custom event brief')}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Send proposal" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/proposal/compose/[requestId]', params: { requestId: r.id } })} />
          </View>
        </Card>
      ))}
    </Section>
  );
}

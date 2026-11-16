import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Badge, Button, Card, EmptyState, Header, Screen, Text } from '../../src/components/ui';
import { listSupportThreads, type SupportThread } from '../../src/lib/adminApi';

export default function SupportInbox() {
  const [rows, setRows] = useState<SupportThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void listSupportThreads().then(setRows).catch((e: Error) => setError(e.message));
  }, []);
  useFocusEffect(load);
  return (
    <Screen header={<Header title="Help & support" subtitle="Messages stay private between you and QuickServe" />} footer={<Button title="Start a conversation" fullWidth onPress={() => router.push('/support/new')} />}>
      {error ? <EmptyState icon="alert-circle-outline" title="Support unavailable" message={error} /> : rows === null ? null : rows.length === 0 ? (
        <EmptyState icon="help-buoy-outline" title="How can we help?" message="Ask about a payment, booking, provider or your account. We usually reply in the app." />
      ) : rows.map((r) => (
        <Card key={r.id} onPress={() => router.push({ pathname: '/support/[id]', params: { id: r.id } })}>
          <Text variant="calloutStrong">{r.subject}</Text>
          <Text variant="footnote" color="muted" numberOfLines={2}>{r.last_message || 'No messages yet'}</Text>
          <Badge label={r.status === 'closed' ? 'Closed' : r.user_unread ? `${r.user_unread} new` : 'Open'} tone={r.user_unread ? 'danger' : 'neutral'} />
        </Card>
      ))}
    </Screen>
  );
}

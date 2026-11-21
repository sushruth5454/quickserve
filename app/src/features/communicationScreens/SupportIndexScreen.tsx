import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, Header, Screen, Skeleton, Text } from '../../components/ui';
import { listSupportThreads, type SupportThread } from '../../lib/adminApi';
import { useAuth } from '../../lib/auth';

type SupportIndexState = {
  actorId: string | null;
  phase: 'loading' | 'error' | 'success';
  rows: SupportThread[];
  error: string | null;
};

function useSupportIndexController() {
  const { userId, loading: authLoading } = useAuth();
  const [state, setState] = useState<SupportIndexState | null>(null);
  const requestGeneration = useRef(0);
  const actorRef = useRef(userId);

  if (actorRef.current !== userId) {
    actorRef.current = userId;
    requestGeneration.current += 1;
  }

  const load = useCallback(async () => {
    const request = ++requestGeneration.current;
    const actorId = userId;
    if (authLoading) return;
    if (!actorId) {
      setState({ actorId, phase: 'error', rows: [], error: 'Sign in to view your support conversations.' });
      return;
    }

    setState({ actorId, phase: 'loading', rows: [], error: null });
    try {
      const rows = await listSupportThreads(actorId);
      if (requestGeneration.current !== request || actorRef.current !== actorId) return;
      setState({ actorId, phase: 'success', rows, error: null });
    } catch (error) {
      if (requestGeneration.current !== request || actorRef.current !== actorId) return;
      setState({
        actorId,
        phase: 'error',
        rows: [],
        error: error instanceof Error ? error.message : 'Support conversations could not be loaded.',
      });
    }
  }, [authLoading, userId]);

  useFocusEffect(useCallback(() => {
    if (!authLoading) void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [authLoading, load]));

  return { userId, authLoading, state, load };
}

export default function SupportIndexScreen() {
  const { userId, authLoading, state, load } = useSupportIndexController();
  const current = state && state.actorId === userId ? state : null;

  return (
    <Screen
      header={<Header title="Help & support" subtitle="Messages stay private between you and QuickServe" />}
      footer={<Button title="Start a conversation" fullWidth onPress={() => router.push('/support/new')} />}
    >
      {authLoading || !current || current.phase === 'loading' ? (
        <Skeleton height={104} radius={12} />
      ) : current.phase === 'error' ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Support unavailable"
          message={current.error ?? 'Your support conversations could not be loaded.'}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : current.rows.length === 0 ? (
        <EmptyState
          icon="help-buoy-outline"
          title="How can we help?"
          message="Ask about a payment, booking, provider or your account. We usually reply in the app."
        />
      ) : current.rows.map((row) => (
        <Card key={row.id} onPress={() => router.push({ pathname: '/support/[id]', params: { id: row.id } })}>
          <Text variant="calloutStrong">{row.subject}</Text>
          <Text variant="footnote" color="muted" numberOfLines={2}>{row.last_message || 'No messages yet'}</Text>
          <Badge label={row.status === 'closed' ? 'Closed' : row.user_unread ? `${row.user_unread} new` : 'Open'} tone={row.user_unread ? 'danger' : 'neutral'} />
        </Card>
      ))}
    </Screen>
  );
}

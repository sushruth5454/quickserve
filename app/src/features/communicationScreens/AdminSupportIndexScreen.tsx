import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Badge, Card, EmptyState, Header, Screen, SegmentedControl, Skeleton, Text } from '../../components/ui';
import { listAdminSupport, type AdminSupportThread } from '../../lib/adminApi';
import { useAuth } from '../../lib/auth';

type AdminSupportIndexState = {
  actorId: string | null;
  filter: string;
  phase: 'loading' | 'error' | 'success';
  rows: AdminSupportThread[];
  error: string | null;
};

function useAdminSupportIndexController() {
  const { userId, loading: authLoading } = useAuth();
  const [status, setStatus] = useState('open');
  const [state, setState] = useState<AdminSupportIndexState | null>(null);
  const requestGeneration = useRef(0);
  const actorRef = useRef(userId);
  const filterRef = useRef(status);

  if (actorRef.current !== userId) {
    actorRef.current = userId;
    requestGeneration.current += 1;
  }
  if (filterRef.current !== status) {
    filterRef.current = status;
    requestGeneration.current += 1;
  }

  const changeFilter = useCallback((next: string) => {
    if (filterRef.current === next) return;
    filterRef.current = next;
    requestGeneration.current += 1;
    setStatus(next);
  }, []);

  const load = useCallback(async () => {
    const request = ++requestGeneration.current;
    const actorId = userId;
    const filter = status;
    if (authLoading) return;
    if (!actorId) {
      setState({ actorId, filter, phase: 'error', rows: [], error: 'Sign in with an administrator account to view support.' });
      return;
    }

    setState({ actorId, filter, phase: 'loading', rows: [], error: null });
    try {
      const rows = await listAdminSupport(filter);
      if (
        requestGeneration.current !== request
        || actorRef.current !== actorId
        || filterRef.current !== filter
      ) return;
      setState({ actorId, filter, phase: 'success', rows, error: null });
    } catch (error) {
      if (
        requestGeneration.current !== request
        || actorRef.current !== actorId
        || filterRef.current !== filter
      ) return;
      setState({
        actorId,
        filter,
        phase: 'error',
        rows: [],
        error: error instanceof Error ? error.message : 'The support inbox could not be loaded.',
      });
    }
  }, [authLoading, status, userId]);

  useFocusEffect(useCallback(() => {
    if (!authLoading) void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [authLoading, load]));

  return { userId, authLoading, status, changeFilter, state, load };
}

export default function AdminSupportIndexScreen() {
  const { userId, authLoading, status, changeFilter, state, load } = useAdminSupportIndexController();
  const current = state && state.actorId === userId && state.filter === status ? state : null;

  return (
    <Screen header={<Header title="Support inbox" subtitle="Unread conversations first" />}>
      <SegmentedControl
        options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }]}
        value={status}
        onChange={changeFilter}
      />
      {authLoading || !current || current.phase === 'loading' ? (
        <Skeleton height={104} radius={12} />
      ) : current.phase === 'error' ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Support inbox unavailable"
          message={current.error ?? 'The support inbox could not be loaded.'}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : current.rows.length === 0 ? (
        <EmptyState icon="chatbubbles-outline" title="Inbox clear" message="New customer and provider messages will appear here." />
      ) : current.rows.map((row) => (
        <Card key={row.id} onPress={() => router.push({ pathname: '/admin/support/[id]', params: { id: row.id } })}>
          <Text variant="calloutStrong">{row.subject}</Text>
          <Badge label={row.status} tone="neutral" />
          <Badge label={`${row.admin_unread} unread`} tone={row.admin_unread ? 'danger' : 'neutral'} />
          <Text variant="caption" color="muted">{formatAdminSupportTime(row.last_message_at)}</Text>
        </Card>
      ))}
    </Screen>
  );
}

function formatAdminSupportTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Last message time unavailable';
  return `Last message · ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)}`;
}

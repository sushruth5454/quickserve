import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, EmptyState, Header, Screen, Skeleton, Text } from '../../components/ui';
import { listSupportThreads, type SupportThread } from '../../lib/adminApi';
import { useAuth } from '../../lib/auth';
import { supportThreadPresentation } from '../../lib/notificationPresentation';

const useRuntimeFeature: (key: string) => boolean = (() => {
  try {
    return (require('../../lib/featureFlags') as typeof import('../../lib/featureFlags')).useFeature;
  } catch {
    return () => false;
  }
})();

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
  const communicationsComposition = useRuntimeFeature('oorva_comms_ux');
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
      ) : current.rows.map((row) => {
        const presentation = supportThreadPresentation(row);
        const status = (
          <Badge
            label={presentation.statusLabel}
            tone={row.status === 'closed' ? 'neutral' : 'primary'}
          />
        );
        const unread = presentation.unreadLabel ? (
          <Badge label={presentation.unreadLabel} tone="danger" />
        ) : null;
        const time = (
          <Text
            variant="caption"
            color="muted"
            accessibilityLabel={presentation.timeAccessibilityLabel}
          >
            {presentation.timeLabel}
          </Text>
        );
        const context = presentation.bookingLabel ? (
          <Text variant="caption" color="primaryText">{presentation.bookingLabel}</Text>
        ) : null;
        return (
          <Card
            key={row.id}
            variant={communicationsComposition ? 'filled' : 'outlined'}
            onPress={() => router.push({ pathname: '/support/[id]', params: { id: row.id } })}
            accessibilityLabel={`${row.subject}. ${presentation.statusLabel}${presentation.unreadLabel ? `. ${presentation.unreadLabel}` : ''}${presentation.bookingLabel ? `. ${presentation.bookingLabel}` : ''}`}
            accessibilityHint="Opens this support conversation."
          >
            {communicationsComposition ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <Text variant="calloutStrong" style={{ flex: 1 }}>{row.subject}</Text>
                  {time}
                </View>
                {context}
                <Text variant="footnote" color="muted" numberOfLines={2}>{row.last_message || 'No messages yet'}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {status}
                  {unread}
                </View>
              </>
            ) : (
              <>
                <Text variant="calloutStrong">{row.subject}</Text>
                <Text variant="footnote" color="muted" numberOfLines={2}>{row.last_message || 'No messages yet'}</Text>
                {context}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {status}
                    {unread}
                  </View>
                  {time}
                </View>
              </>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

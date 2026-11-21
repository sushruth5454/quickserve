import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import {
  loadSupportConversation,
  markSupportRead,
  sendSupport,
  setSupportStatus,
  type SupportMessage,
  type SupportThread,
} from '../../lib/adminApi';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../theme';
import {
  Button,
  Card,
  EmptyState,
  Header,
  InlineAlert,
  Screen,
  Skeleton,
  Text,
  TextArea,
  useConfirm,
  useToast,
} from '../../components/ui';

type SupportDetailState = {
  actorId: string | null;
  threadId: string;
  phase: 'loading' | 'error' | 'success';
  thread: SupportThread | null;
  messages: SupportMessage[];
  error: string | null;
};

function useSupportDetailController(threadId: string) {
  const { userId, loading: authLoading } = useAuth();
  const [state, setState] = useState<SupportDetailState | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const identityRef = useRef({ actorId: userId, threadId });
  const confirm = useConfirm();
  const toast = useToast();

  if (identityRef.current.actorId !== userId || identityRef.current.threadId !== threadId) {
    identityRef.current = { actorId: userId, threadId };
    requestGeneration.current += 1;
  }

  useEffect(() => {
    setBody('');
    setBusy(false);
    setActionError(null);
  }, [threadId, userId]);

  const load = useCallback(async () => {
    const request = ++requestGeneration.current;
    const actorId = userId;
    if (authLoading) return;
    if (!actorId) {
      setState({
        actorId,
        threadId,
        phase: 'error',
        thread: null,
        messages: [],
        error: 'Sign in to view this support conversation.',
      });
      return;
    }

    setState({ actorId, threadId, phase: 'loading', thread: null, messages: [], error: null });
    setActionError(null);
    try {
      const result = await loadSupportConversation(threadId, 'participant', actorId);
      if (
        requestGeneration.current !== request
        || identityRef.current.actorId !== actorId
        || identityRef.current.threadId !== threadId
      ) return;
      setState({
        actorId,
        threadId,
        phase: 'success',
        thread: result.thread,
        messages: result.messages,
        error: null,
      });
      if (result.thread) {
        try {
          await markSupportRead(threadId);
        } catch (error) {
          if (
            requestGeneration.current === request
            && identityRef.current.actorId === actorId
            && identityRef.current.threadId === threadId
          ) {
            setActionError(error instanceof Error ? error.message : 'The conversation could not be marked as read.');
          }
        }
      }
    } catch (error) {
      if (
        requestGeneration.current !== request
        || identityRef.current.actorId !== actorId
        || identityRef.current.threadId !== threadId
      ) return;
      setState({
        actorId,
        threadId,
        phase: 'error',
        thread: null,
        messages: [],
        error: error instanceof Error ? error.message : 'The support conversation could not be loaded.',
      });
    }
  }, [authLoading, threadId, userId]);

  useFocusEffect(useCallback(() => {
    if (!authLoading) void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [authLoading, load]));

  const send = useCallback(async () => {
    const current = state && state.actorId === userId && state.threadId === threadId ? state : null;
    if (!current?.thread || current.thread.status !== 'open' || !body.trim() || !userId) return;
    const actorId = userId;
    setBusy(true);
    setActionError(null);
    try {
      await sendSupport(threadId, body);
      if (identityRef.current.actorId !== actorId || identityRef.current.threadId !== threadId) return;
      setBody('');
      await load();
    } catch (error) {
      if (identityRef.current.actorId === actorId && identityRef.current.threadId === threadId) {
        setActionError(error instanceof Error ? error.message : 'Your reply could not be sent.');
      }
    } finally {
      if (identityRef.current.actorId === actorId && identityRef.current.threadId === threadId) setBusy(false);
    }
  }, [body, load, state, threadId, userId]);

  const changeStatus = useCallback(async () => {
    const current = state && state.actorId === userId && state.threadId === threadId ? state : null;
    if (!current?.thread || !userId) return;
    const actorId = userId;
    const reopening = current.thread.status === 'closed';
    const confirmed = await confirm({
      title: reopening ? 'Reopen this conversation?' : 'Close this support conversation?',
      message: reopening ? 'The user and support can message here again.' : 'You can reopen it later if needed.',
      confirmLabel: reopening ? 'Reopen' : 'Close',
    });
    if (!confirmed || identityRef.current.actorId !== actorId || identityRef.current.threadId !== threadId) return;
    try {
      await setSupportStatus(threadId, reopening ? 'open' : 'closed');
      if (identityRef.current.actorId !== actorId || identityRef.current.threadId !== threadId) return;
      await load();
      toast({ message: reopening ? 'Conversation reopened' : 'Conversation closed', tone: 'success' });
    } catch (error) {
      if (identityRef.current.actorId === actorId && identityRef.current.threadId === threadId) {
        setActionError(error instanceof Error ? error.message : 'The conversation status could not be updated.');
      }
    }
  }, [confirm, load, state, threadId, toast, userId]);

  return { userId, authLoading, state, load, body, setBody, busy, actionError, send, changeStatus };
}

export default function SupportDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const threadId = typeof params.id === 'string' ? params.id : '';
  const { userId, authLoading, state, load, body, setBody, busy, actionError, send, changeStatus } =
    useSupportDetailController(threadId);
  const t = useTheme();
  const current = state && state.actorId === userId && state.threadId === threadId ? state : null;
  const readyThread = current?.phase === 'success' ? current.thread : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Screen
        header={
          <Header
            title={readyThread?.subject ?? 'Support'}
            subtitle="QuickServe support"
            right={readyThread ? (
              <Button
                title={readyThread.status === 'open' ? 'Close' : 'Reopen'}
                size="sm"
                variant="outline"
                onPress={() => void changeStatus()}
              />
            ) : undefined}
          />
        }
        gap={t.spacing.md}
        footer={readyThread ? (
          <View style={{ gap: 8 }}>
            {actionError ? <InlineAlert message={actionError} /> : null}
            <TextArea
              label={readyThread.status === 'closed' ? 'Reopen to reply' : 'Message'}
              placeholder="Type your message…"
              value={body}
              onChangeText={setBody}
              editable={readyThread.status !== 'closed'}
            />
            <Button
              title="Send"
              fullWidth
              loading={busy}
              disabled={!body.trim() || readyThread.status === 'closed'}
              onPress={() => void send()}
            />
          </View>
        ) : undefined}
      >
        {authLoading || !current || current.phase === 'loading' ? (
          <Skeleton height={300} radius={t.radii.lg} />
        ) : current.phase === 'error' ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Support unavailable"
            message={current.error ?? 'The support conversation could not be loaded.'}
            actionLabel="Retry"
            onAction={() => void load()}
          />
        ) : !current.thread ? (
          <EmptyState icon="chatbubbles-outline" title="Conversation not found" message="This conversation is unavailable in your personal support inbox." />
        ) : current.messages.map((message) => {
          const mine = !message.from_admin && message.sender_id === userId;
          const label = message.from_admin ? 'QuickServe support' : mine ? 'You' : 'Support';
          return (
            <Card
              key={message.id}
              style={{
                alignSelf: mine ? 'flex-end' : 'flex-start',
                width: '88%',
                backgroundColor: mine ? t.colors.primarySoft : t.colors.surface,
              }}
            >
              <Text variant="captionStrong" color={mine ? 'primaryText' : 'muted'}>{label}</Text>
              <Text>{message.body}</Text>
              <Text variant="caption" color="muted" align="right">
                {new Date(message.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
              </Text>
            </Card>
          );
        })}
      </Screen>
    </KeyboardAvoidingView>
  );
}

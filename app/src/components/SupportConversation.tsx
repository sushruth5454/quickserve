import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  loadSupportConversation,
  markSupportRead,
  sendSupport,
  setSupportStatus,
  type SupportMessage,
  type SupportThread,
} from '../lib/adminApi';
import { useAuth } from '../lib/auth';
import { useEntityRefresh } from '../lib/useEntityRefresh';
import { useTheme } from '../theme';
import { useBrandIdentity } from '../branding/useBrandIdentity';
import { Button, Card, EmptyState, Header, InlineAlert, Screen, Skeleton, Text, TextArea, useConfirm, useToast } from './ui';
import { bookingRef } from '../lib/schedule';
import { exactCommunicationTime, supportThreadPresentation } from '../lib/notificationPresentation';

type SupportConversationState =
  | { key: string; phase: 'error'; thread: null; messages: []; error: string }
  | { key: string; phase: 'not-found'; thread: null; messages: []; error: null }
  | { key: string; phase: 'ready'; thread: SupportThread; messages: SupportMessage[]; error: null };

type KeyedText = { key: string; value: string } | null;
type SupportReadback = { key: string; thread: SupportThread | null };

const SUPPORT_REFRESH_INTERVAL_MS = 60_000;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function currentReadback(ref: { current: SupportReadback | null }): SupportReadback | null {
  return ref.current;
}

export function SupportConversation({ threadId, admin = false }: { threadId: string; admin?: boolean }) {
  const { userId, loading: authLoading } = useAuth();
  const t = useTheme();
  const identity = useBrandIdentity('support');
  const toast = useToast();
  const confirm = useConfirm();
  const scope = admin ? 'admin' : 'participant';
  const contextKey = JSON.stringify([userId, scope, threadId]);
  const identityRef = useRef(contextKey);
  identityRef.current = contextKey;

  const [state, setState] = useState<SupportConversationState | null>(null);
  const [draftState, setDraftState] = useState<KeyedText>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());
  const [statusBusyKeys, setStatusBusyKeys] = useState<Set<string>>(() => new Set());
  const [actionErrorState, setActionErrorState] = useState<KeyedText>(null);
  const sendOperationRef = useRef(new Map<string, symbol>());
  const statusOperationRef = useRef(new Map<string, symbol>());
  const readbackRef = useRef<SupportReadback | null>(null);

  useEffect(() => {
    setDraftState(null);
    setActionErrorState(null);
  }, [contextKey]);

  const body = draftState?.key === contextKey ? draftState.value : '';
  const busy = busyKeys.has(contextKey);
  const statusBusy = statusBusyKeys.has(contextKey);
  const actionError = actionErrorState?.key === contextKey ? actionErrorState.value : null;

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    const isCurrent = () => guard.isCurrent() && identityRef.current === contextKey;
    if (!isCurrent() || !userId || !threadId) return;
    setActionErrorState({ key: contextKey, value: '' });
    try {
      let result = await loadSupportConversation(threadId, scope, userId);
      if (!isCurrent()) return;
      if (result.thread) {
        try {
          await markSupportRead(threadId);
        } catch (error) {
          if (isCurrent()) {
            setActionErrorState({
              key: contextKey,
              value: errorMessage(error, 'The conversation could not be marked as read.'),
            });
          }
        }
        if (!isCurrent()) return;
        result = await loadSupportConversation(threadId, scope, userId);
        if (!isCurrent()) return;
      }

      readbackRef.current = { key: contextKey, thread: result.thread };
      if (!result.thread) {
        setState({ key: contextKey, phase: 'not-found', thread: null, messages: [], error: null });
        return;
      }
      setState({
        key: contextKey,
        phase: 'ready',
        thread: result.thread,
        messages: result.messages,
        error: null,
      });
    } catch (error) {
      if (isCurrent()) {
        readbackRef.current = null;
        const message = errorMessage(error, 'The support conversation could not be loaded.');
        setState({ key: contextKey, phase: 'error', thread: null, messages: [], error: message });
      }
      throw error;
    }
  }, [contextKey, scope, threadId, userId]);

  const { refresh, refreshing } = useEntityRefresh(load, {
    contextKey,
    enabled: !authLoading && !!userId && !!threadId,
    intervalMs: SUPPORT_REFRESH_INTERVAL_MS,
  });

  const send = useCallback(async () => {
    const current = state?.key === contextKey && state.phase === 'ready' ? state : null;
    const trimmedBody = body.trim();
    if (
      !current?.thread
      || current.thread.status !== 'open'
      || !trimmedBody
      || !userId
      || authLoading
      || refreshing
      || busy
      || statusBusy
      || sendOperationRef.current.has(contextKey)
      || statusOperationRef.current.has(contextKey)
    ) return;

    const operation = Symbol();
    sendOperationRef.current.set(contextKey, operation);
    setBusyKeys((currentKeys) => new Set(currentKeys).add(contextKey));
    try {
      await sendSupport(threadId, trimmedBody);
      setDraftState((currentDraft) => (
        currentDraft?.key === contextKey ? { key: contextKey, value: '' } : currentDraft
      ));
      if (identityRef.current !== contextKey) return;
      readbackRef.current = null;
      try {
        await refresh();
        if (identityRef.current !== contextKey) return;
        const readback = currentReadback(readbackRef);
        if (!readback || readback.key !== contextKey || !readback.thread) {
          setActionErrorState({
            key: contextKey,
            value: 'Your reply was sent, but the latest conversation could not be confirmed. Retry to refresh it.',
          });
        }
      } catch (error) {
        if (identityRef.current === contextKey) {
          setActionErrorState({
            key: contextKey,
            value: errorMessage(error, 'Your reply was sent, but the latest conversation could not be loaded.'),
          });
        }
      }
    } catch (error) {
      if (identityRef.current === contextKey) {
        setActionErrorState({
          key: contextKey,
          value: errorMessage(error, 'Your reply could not be sent.'),
        });
      }
    } finally {
      if (sendOperationRef.current.get(contextKey) === operation) {
        sendOperationRef.current.delete(contextKey);
        setBusyKeys((currentKeys) => {
          const nextKeys = new Set(currentKeys);
          nextKeys.delete(contextKey);
          return nextKeys;
        });
      }
    }
  }, [authLoading, body, busy, contextKey, refresh, refreshing, state, statusBusy, threadId, userId]);

  const close = useCallback(async () => {
    const current = state?.key === contextKey && state.phase === 'ready' ? state : null;
    if (
      !current?.thread
      || !userId
      || authLoading
      || refreshing
      || busy
      || statusBusy
      || sendOperationRef.current.has(contextKey)
      || statusOperationRef.current.has(contextKey)
    ) return;

    const actorId = userId;
    const thread = current.thread;
    const reopening = thread.status === 'closed';
    const nextStatus = reopening ? 'open' : 'closed';
    const operation = Symbol();
    statusOperationRef.current.set(contextKey, operation);
    setStatusBusyKeys((currentKeys) => new Set(currentKeys).add(contextKey));
    try {
      const ok = await confirm({
        title: reopening ? 'Reopen this conversation?' : 'Close this support conversation?',
        message: reopening ? 'The user and support can message here again.' : 'You can reopen it later if needed.',
        confirmLabel: reopening ? 'Reopen' : 'Close',
      });
      if (!ok || identityRef.current !== contextKey || userId !== actorId) return;
      await setSupportStatus(threadId, nextStatus);
      if (identityRef.current !== contextKey || userId !== actorId) return;
      readbackRef.current = null;
      try {
        await refresh();
        if (identityRef.current !== contextKey) return;
        const readback = currentReadback(readbackRef);
        if (readback && readback.key === contextKey && readback.thread?.status === nextStatus) {
          toast({ message: reopening ? 'Conversation reopened' : 'Conversation closed', tone: 'success' });
        } else {
          setActionErrorState({
            key: contextKey,
            value: 'The status was updated, but the latest conversation could not be confirmed. Retry to refresh it.',
          });
        }
      } catch (error) {
        if (identityRef.current === contextKey) {
          setActionErrorState({
            key: contextKey,
            value: errorMessage(error, 'The status was updated, but the latest conversation could not be loaded.'),
          });
        }
      }
    } catch (error) {
      if (identityRef.current === contextKey) {
        setActionErrorState({
          key: contextKey,
          value: errorMessage(error, 'The conversation status could not be updated.'),
        });
      }
    } finally {
      if (statusOperationRef.current.get(contextKey) === operation) {
        statusOperationRef.current.delete(contextKey);
        setStatusBusyKeys((currentKeys) => {
          const nextKeys = new Set(currentKeys);
          nextKeys.delete(contextKey);
          return nextKeys;
        });
      }
    }
  }, [authLoading, busy, confirm, contextKey, refresh, refreshing, state, statusBusy, threadId, toast, userId]);

  const currentState = state?.key === contextKey ? state : null;
  const phase = authLoading || (!currentState && userId && threadId) ? 'pending' : currentState?.phase;
  const readyThread = currentState?.phase === 'ready' ? currentState.thread : null;
  const readyMessages = currentState?.phase === 'ready' ? currentState.messages : [];
  const supportPresentation = readyThread
    ? supportThreadPresentation(readyThread, admin ? 'admin' : 'participant')
    : null;

  if (!authLoading && !userId) {
    return (
      <Screen header={<Header title="Support" subtitle={admin ? `${identity.displayName} support admin` : `${identity.displayName} support`} />}>
        <EmptyState icon="alert-circle-outline" title="Support unavailable" message="Sign in to view this support conversation." />
      </Screen>
    );
  }

  if (!threadId || phase === 'not-found') {
    return (
      <Screen header={<Header title="Support" subtitle={admin ? `${identity.displayName} support admin` : `${identity.displayName} support`} />}>
        <EmptyState icon="chatbubbles-outline" title="Conversation not found" message="This conversation is unavailable." />
      </Screen>
    );
  }

  if (currentState?.phase === 'error') {
    return (
      <Screen header={<Header title="Support" subtitle={admin ? `${identity.displayName} support admin` : `${identity.displayName} support`} />}>
        <EmptyState
          icon="alert-circle-outline"
          title="Support unavailable"
          message={currentState.error}
          actionLabel="Retry"
          onAction={() => void refresh().catch(() => undefined)}
        />
      </Screen>
    );
  }

  return (
    <Screen
      header={
        <Header
          title={readyThread?.subject ?? 'Support'}
          subtitle={admin ? `${identity.displayName} support admin` : `${identity.displayName} support`}
          right={readyThread ? (
            <Button
              title={readyThread.status === 'open' ? 'Close' : 'Reopen'}
              size="sm"
              variant="outline"
              disabled={busy || statusBusy || refreshing}
              onPress={() => void close()}
            />
          ) : undefined}
        />
      }
      gap={t.spacing.md}
      footer={readyThread ? (
        <View style={{ gap: 8 }}>
          {actionError ? (
            <>
              <InlineAlert message={actionError} />
              <Button
                title="Retry"
                size="sm"
                variant="outline"
                disabled={refreshing}
                onPress={() => void refresh().catch(() => undefined)}
              />
            </>
          ) : null}
          <Text variant="caption" color="muted">
            Messages are limited to 2,000 characters. Don’t include card or UPI details.
          </Text>
          <TextArea
            label={readyThread.status === 'closed' ? 'Reopen to reply' : 'Message'}
            placeholder="Type your message…"
            value={body}
            onChangeText={(value: string) => setDraftState({ key: contextKey, value })}
            maxLength={2000}
            editable={readyThread.status === 'open' && !busy && !statusBusy && !refreshing}
          />
          <Button
            title="Send"
            fullWidth
            loading={busy}
            disabled={
              !body.trim()
              || readyThread.status === 'closed'
              || busy
              || statusBusy
              || refreshing
            }
            onPress={() => void send()}
          />
        </View>
      ) : undefined}
    >
      {phase === 'pending' || !readyThread ? (
        <Skeleton height={300} radius={t.radii.lg} />
      ) : (
        <>
          <View style={{ gap: t.spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: t.spacing.sm }}>
              <Text variant="captionStrong">{`Status: ${supportPresentation!.statusLabel}`}</Text>
              {supportPresentation!.unreadLabel ? (
                <Text variant="captionStrong" color="danger">{`Unread messages: ${supportPresentation!.unreadCount}`}</Text>
              ) : null}
            </View>
            {readyThread.booking_id ? (
              <Text variant="footnote" color="primaryText">
                Linked booking {bookingRef(readyThread.booking_id)}
              </Text>
            ) : null}
            <Text variant="caption" color="muted" accessibilityLabel={supportPresentation!.timeAccessibilityLabel}>
              {supportPresentation!.timeLabel}
            </Text>
          </View>
          {readyMessages.map((m) => {
            const mine = admin ? m.from_admin : m.sender_id === userId;
            return (
              <Card
                key={m.id}
                style={{
                  alignSelf: mine ? 'flex-end' : 'flex-start',
                  width: '88%',
                  backgroundColor: mine ? t.colors.primarySoft : t.colors.surface,
                }}
              >
                <Text variant="captionStrong" color={mine ? 'primaryText' : 'muted'}>{m.from_admin ? `${identity.displayName} support` : admin ? 'User' : 'You'}</Text>
                <Text>{m.body}</Text>
                <Text
                  variant="caption"
                  color="muted"
                  align="right"
                  accessibilityLabel={exactCommunicationTime(m.created_at)}
                >
                  {new Date(m.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                </Text>
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}

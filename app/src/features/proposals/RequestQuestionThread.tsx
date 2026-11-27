import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, InlineAlert, Text, TextArea, useToast } from '../../components/ui';
import * as api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { RequestMessage, ServiceRequestStatus } from '../../lib/types';
import type { SendRequestMessageResult } from '../../lib/supabaseApi';
import { useFocusedServiceRefresh } from '../serviceLifecycle/useFocusedServiceRefresh';
import { getProposalViewState } from './api';

type ThreadAccess = { canMessage: boolean; requestStatus: ServiceRequestStatus | null };
type Keyed<T> = { key: string; value: T };

function isMessageableStatus(status: ServiceRequestStatus | null): boolean {
  return status === 'open' || status === 'closed';
}

function timestampLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

async function resolveThreadAccess(
  requestId: string,
  providerId: string,
  userId: string | null,
  canMessage?: boolean,
  requestStatus?: ServiceRequestStatus | null,
): Promise<ThreadAccess> {
  if (canMessage !== undefined && requestStatus !== undefined) return { canMessage, requestStatus };

  const proposals = await api.listRequestProposals(requestId).catch(() => []);
  const proposal = proposals
    .filter((row) => row.provider_id === providerId)
    .reduce<typeof proposals[number] | null>(
      (latest, row) => !latest || row.version > latest.version ? row : latest,
      null,
    );
  if (proposal) {
    try {
      const state = await getProposalViewState(proposal.id);
      return {
        canMessage: canMessage ?? state.can_message,
        requestStatus: requestStatus === undefined ? state.request_status : requestStatus,
      };
    } catch {
      // Fall through to the scoped request reads; sending still remains server-authorized.
    }
  }

  const providerRequests = await api.listProviderServiceRequests().catch(() => []);
  const routedRequest = providerRequests.find((row) => row.id === requestId && row.provider_id === providerId);
  if (routedRequest) {
    return {
      canMessage: canMessage ?? isMessageableStatus(routedRequest.status),
      requestStatus: requestStatus === undefined ? routedRequest.status : requestStatus,
    };
  }

  const request = await api.getServiceRequest(requestId).catch(() => null);
  if (request && request.customer_id === userId) {
    return {
      canMessage: canMessage ?? isMessageableStatus(request.status),
      requestStatus: requestStatus === undefined ? request.status : requestStatus,
    };
  }

  return { canMessage: canMessage ?? false, requestStatus: requestStatus ?? null };
}

export function RequestQuestionThread({
  requestId,
  providerId,
  otherPartyLabel,
  canMessage,
  requestStatus,
}: {
  requestId: string;
  providerId: string;
  otherPartyLabel: string;
  canMessage?: boolean;
  requestStatus?: ServiceRequestStatus | null;
}) {
  const { userId } = useAuth();
  const toast = useToast();
  const threadKey = JSON.stringify([userId, requestId, providerId]);
  const currentThreadKey = useRef(threadKey);
  currentThreadKey.current = threadKey;
  const initialThreadKey = useRef(threadKey);
  const explicitAccessContextValid = useRef(true);
  if (initialThreadKey.current !== threadKey) explicitAccessContextValid.current = false;
  const useExplicitAccess = explicitAccessContextValid.current;
  const [messagesState, setMessagesState] = useState<Keyed<RequestMessage[]>>({ key: threadKey, value: [] });
  const [bodyState, setBodyState] = useState<Keyed<string>>({ key: threadKey, value: '' });
  const [errorState, setErrorState] = useState<Keyed<string | null>>({ key: threadKey, value: null });
  const [busyState, setBusyState] = useState<Keyed<boolean>>({ key: threadKey, value: false });
  const [nudgeState, setNudgeState] = useState<Keyed<boolean>>({ key: threadKey, value: false });
  const [accessState, setAccessState] = useState<Keyed<ThreadAccess>>({
    key: threadKey,
    value: { canMessage: canMessage ?? false, requestStatus: requestStatus ?? null },
  });
  const messages = messagesState.key === threadKey ? messagesState.value : [];
  const body = bodyState.key === threadKey ? bodyState.value : '';
  const error = errorState.key === threadKey ? errorState.value : null;
  const busy = busyState.key === threadKey && busyState.value;
  const nudge = nudgeState.key === threadKey && nudgeState.value;
  const storedAccess = accessState.key === threadKey
    ? accessState.value
    : { canMessage: false, requestStatus: null };
  const access = useExplicitAccess
    ? {
      canMessage: canMessage ?? storedAccess.canMessage,
      requestStatus: requestStatus === undefined ? storedAccess.requestStatus : requestStatus,
    }
    : storedAccess;
  const canWrite = access.canMessage && isMessageableStatus(access.requestStatus);
  const readOnlyExplanation = access.requestStatus && !isMessageableStatus(access.requestStatus)
    ? 'This conversation is read-only. You can still review previous messages.'
    : access.requestStatus === null
      ? 'This conversation is read-only while its state is unavailable.'
      : !access.canMessage
        ? 'Messaging is not available for this account.'
        : null;

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    const [messagesResult, accessResult] = await Promise.allSettled([
      api.listRequestMessages(requestId, providerId),
      resolveThreadAccess(
        requestId,
        providerId,
        userId,
        useExplicitAccess ? canMessage : undefined,
        useExplicitAccess ? requestStatus : undefined,
      ),
    ]);
    if (!guard.isCurrent()) return;
    if (messagesResult.status === 'fulfilled') {
      setMessagesState({ key: threadKey, value: messagesResult.value });
    }
    if (accessResult.status === 'fulfilled') {
      setAccessState({ key: threadKey, value: accessResult.value });
    } else {
      setAccessState({ key: threadKey, value: { canMessage: false, requestStatus: requestStatus ?? null } });
    }
    const failure = messagesResult.status === 'rejected'
      ? messagesResult.reason
      : accessResult.status === 'rejected'
        ? accessResult.reason
        : null;
    setErrorState({ key: threadKey, value: failure ? (failure as Error).message : null });
  }, [canMessage, providerId, requestId, requestStatus, threadKey, useExplicitAccess, userId]);

  const { refresh } = useFocusedServiceRefresh(load, {
    contextKey: `request-messages:${userId ?? 'anonymous'}:${requestId}:${providerId}`,
    enabled: true,
    intervalMs: 30_000,
  });

  const send = async () => {
    const message = body.trim();
    if (!message || busy || !canWrite) return;
    const key = threadKey;
    setBusyState({ key, value: true });
    setErrorState({ key, value: null });
    setNudgeState({ key, value: false });
    let refreshAfterSend = false;
    try {
      const existing = await api.listRequestMessages(requestId, providerId);
      if (currentThreadKey.current !== key) return;
      const existingIds = new Set(existing.map((row) => row.id));
      const result = await api.sendRequestMessage(requestId, providerId, message) as unknown as
        SendRequestMessageResult | undefined;
      const next = await api.listRequestMessages(requestId, providerId);
      const created = result?.message_id
        ? null
        : next.find((row) => !existingIds.has(row.id)
          && row.request_id === requestId
          && row.provider_id === providerId
          && row.sender_id === userId
          && row.body === message);
      const messageId = result?.message_id ?? created?.id;
      const messageNudge = result?.nudge === true;
      if (!messageId) throw new Error('The sent message could not be confirmed in this conversation.');
      const readBack = next.find((row) => row.id === messageId
        && row.request_id === requestId
        && row.provider_id === providerId
        && row.body === message
        && (userId === null || row.sender_id === userId));
      if (!readBack) throw new Error('The sent message could not be confirmed in this conversation.');
      if (currentThreadKey.current !== key) return;
      setMessagesState({ key, value: next });
      setBodyState({ key, value: '' });
      setErrorState({ key, value: null });
      setNudgeState({ key, value: messageNudge });
      toast({ message: 'Message sent', tone: 'success' });
      refreshAfterSend = true;
    } catch (caught) {
      if (currentThreadKey.current === key) setErrorState({ key, value: (caught as Error).message });
    } finally {
      if (currentThreadKey.current === key) setBusyState({ key, value: false });
    }
    if (refreshAfterSend && currentThreadKey.current === key) await refresh();
  };

  return (
    <View style={{ gap: 10 }}>
      {error ? <InlineAlert message={error} /> : null}
      {nudge ? (
        <InlineAlert
          tone="warning"
          title="Keep this conversation protected"
          message="We noticed contact or payment details. Keep conversations and payments on QuickServe."
        />
      ) : null}
      {messages.length === 0 ? <Text variant="footnote" color="muted">No questions yet.</Text> : messages.map((message) => (
        <Card key={message.id}>
          <Text variant="caption" color="muted">{message.sender_id === userId ? 'You' : otherPartyLabel}</Text>
          <Text>{message.body}</Text>
          {timestampLabel(message.created_at) ? (
            <Text variant="caption" color="muted">{timestampLabel(message.created_at)}</Text>
          ) : null}
        </Card>
      ))}
      {readOnlyExplanation ? <Text variant="footnote" color="muted">{readOnlyExplanation}</Text> : null}
      {canWrite ? (
        <>
          <TextArea
            label="Your question"
            value={body}
            onChangeText={(value) => setBodyState({ key: threadKey, value })}
            maxLength={2000}
          />
          <Button
            title="Send message"
            variant="outline"
            loading={busy}
            disabled={!body.trim()}
            onPress={() => void send()}
          />
        </>
      ) : null}
    </View>
  );
}

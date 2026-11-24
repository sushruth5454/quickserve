import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text, TextArea, useToast } from '../../components/ui';
import {
  getProductEnquiry,
  listProductEnquiryMessages,
  markEnquiryRead,
  sendEnquiryMessage,
  setProductEnquiryStatus,
  type EnquiryMessage,
  type EnquiryThread,
} from '../shops/api';
import { enquiryPresentation } from '../shops/enquiryPresentation';
import { useShopFeatureFlags } from '../shops/components';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../theme';

export default function ProductEnquiryScreen() {
  const t = useTheme();
  const toast = useToast();
  const features = useShopFeatureFlags();
  const { userId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [thread, setThread] = useState<EnquiryThread | null>(null);
  const [messages, setMessages] = useState<EnquiryMessage[] | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasRead, setHasRead] = useState(false);
  const loadSequence = useRef(0);
  const lastUserId = useRef(userId);
  const lastEnquiryId = useRef(id);

  const load = useCallback(async () => {
    if (!id) return;
    const request = ++loadSequence.current;
    if (lastUserId.current !== userId || lastEnquiryId.current !== id) {
      lastUserId.current = userId;
      lastEnquiryId.current = id;
      setThread(null);
      setMessages(null);
      setBody('');
      setHasRead(false);
    }
    if (!userId) {
      setThread(null);
      setMessages(null);
      setBody('');
      setHasRead(false);
      setError('Sign in to view this enquiry.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextThread, nextMessages] = await Promise.all([getProductEnquiry(id), listProductEnquiryMessages(id)]);
      if (request !== loadSequence.current) return;
      setThread(nextThread);
      setMessages(nextMessages);
      setHasRead(true);
      if (nextThread) void markEnquiryRead(id).catch(() => undefined);
    } catch (e) {
      if (request === loadSequence.current) {
        const message = (e as Error).message;
        if (/enquiry not found|authentication required/i.test(message)) {
          setThread(null);
          setMessages(null);
          setBody('');
          setHasRead(false);
        }
        setError(message);
      }
    }
    finally {
      if (request === loadSequence.current) setLoading(false);
    }
  }, [id, userId]);

  useFocusEffect(useCallback(() => {
    void load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      loadSequence.current += 1;
      subscription.remove();
    };
  }, [load]));

  const send = async () => {
    if (!features.enquiries || !hasRead || loading || error || !body.trim() || !thread || thread.status !== 'open') return;
    setBusy(true);
    setActionError(null);
    try {
      await sendEnquiryMessage(thread.id, body);
      setBody('');
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const presentation = thread ? enquiryPresentation({
    status: thread.status,
    fromShopUser: thread.from_shop_user,
    businessRole: thread.business_role,
    canChangeStatus: thread.can_change_status,
    canReopen: thread.can_reopen,
    activeEnquiryId: thread.active_enquiry_id,
  }) : null;
  const statusAction = presentation?.statusAction ?? null;
  const canShowStatusAction = statusAction?.type === 'open_active'
    || (features.enquiries && !!statusAction);

  const performStatusAction = async () => {
    if (!statusAction || !hasRead || loading || error || !thread) return;
    if (statusAction.type === 'open_active') {
      router.replace(`/enquiry/${statusAction.targetId}`);
      return;
    }
    if (!features.enquiries) return;
    const status = statusAction.type === 'close' ? 'closed' : 'open';
    setBusy(true);
    setActionError(null);
    try {
      await setProductEnquiryStatus(thread.id, status);
      await load();
      toast({ message: status === 'open' ? 'Enquiry reopened' : 'Enquiry closed', tone: 'success' });
    } catch (e) {
      const message = (e as Error).message;
      if (status === 'open' && /another open enquiry already exists for this product context/i.test(message)) {
        await load();
        setActionError('An active conversation already exists. Open the active conversation instead.');
      } else {
        setActionError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      refreshing={loading && hasRead}
      onRefresh={() => void load()}
      header={
        <Header
          title={thread?.shop_name ?? 'Product enquiry'}
          subtitle={thread?.product_name ?? 'Shop conversation'}
          right={canShowStatusAction && statusAction ? (
            <Button
              title={statusAction.label}
              size="sm"
              variant="outline"
              loading={busy}
              disabled={!hasRead || loading || !!error}
              onPress={() => void performStatusAction()}
            />
          ) : undefined}
        />
      }
      gap={t.spacing.md}
      footer={
        <View style={{ gap: t.spacing.sm }}>
          {error && !hasRead ? <ErrorState message={error} onRetry={() => void load()} /> : null}
          {error && hasRead ? <InlineAlert message={`Refresh failed. Showing saved conversation history; replies are disabled until a successful refresh. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
          <InlineAlert message={actionError} />
          {features.enquiries && thread?.status === 'open' ? (
            <>
              <TextArea
                label="Message"
                placeholder="Type your message…"
                value={body}
                onChangeText={setBody}
                editable={hasRead && !loading && !error}
                maxLength={2000}
              />
              <Button title="Send message" fullWidth loading={busy} disabled={!body.trim() || !hasRead || loading || !!error} onPress={() => void send()} />
            </>
          ) : !features.enquiries ? (
            <Text variant="caption" color="muted">
              {thread?.status === 'closed' && presentation?.closedExplanation
                ? `${presentation.closedExplanation} Existing enquiry history is read-only while product enquiries are turned off.`
                : 'Existing enquiry history is read-only while product enquiries are turned off.'}
            </Text>
          ) : thread?.status === 'closed' ? (
            <Text variant="caption" color="muted">{presentation?.closedExplanation}</Text>
          ) : null}
        </View>
      }
    >
      {loading && !hasRead ? <Skeleton height={280} radius={t.radii.lg} /> : null}
      {hasRead && !loading && !error && !thread ? <EmptyState title="Enquiry unavailable" message="This enquiry is no longer available." /> : null}
      {thread ? (
        <Card>
          <Text variant="caption" color="muted">{thread.from_shop_user ? 'You are replying as this shop.' : 'You are chatting with the shop.'}</Text>
          <Text variant="caption" color="muted">Conversation status: {thread.status}</Text>
        </Card>
      ) : null}
      {thread && messages == null && !error ? <Skeleton height={280} radius={t.radii.lg} /> : null}
      {thread && messages?.length === 0 ? <EmptyState title="No messages yet" message="Messages in this conversation will appear here." /> : null}
      {thread && messages?.length ? messages.map((message) => {
        const mine = thread?.from_shop_user ? message.from_shop : message.sender_id === userId;
        return (
          <Card
            key={message.id}
            style={{
              alignSelf: mine ? 'flex-end' : 'flex-start',
              width: '88%',
              backgroundColor: mine ? t.colors.primarySoft : t.colors.surface,
            }}
          >
            <Text variant="captionStrong" color={mine ? 'primaryText' : 'muted'}>{message.from_shop ? thread?.shop_name ?? 'Shop' : mine ? 'You' : 'Customer'}</Text>
            <Text>{message.body}</Text>
            <Text variant="caption" color="muted" align="right">{new Date(message.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
          </Card>
        );
      }) : null}
      {thread ? <Button title="Open shop" variant="ghost" onPress={() => router.push(`/shop/${thread.shop_id}`)} /> : null}
    </Screen>
  );
}

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
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

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [nextThread, nextMessages] = await Promise.all([getProductEnquiry(id), listProductEnquiryMessages(id)]);
      setThread(nextThread);
      setMessages(nextMessages);
      setHasRead(true);
      if (nextThread) void markEnquiryRead(id).catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    }
    finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

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

  const toggleStatus = async () => {
    if (!features.enquiries || !hasRead || loading || error || !thread) return;
    const status = thread.status === 'open' ? 'closed' : 'open';
    setBusy(true);
    setActionError(null);
    try {
      await setProductEnquiryStatus(thread.id, status);
      await load();
      toast({ message: status === 'open' ? 'Enquiry reopened' : 'Enquiry closed', tone: 'success' });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const canChangeStatus = features.enquiries && !!thread && (!thread.from_shop_user || thread.business_role === 'owner');

  return (
    <Screen
      header={
        <Header
          title={thread?.shop_name ?? 'Product enquiry'}
          subtitle={thread?.product_name ?? 'Shop conversation'}
          right={canChangeStatus ? <Button title={thread.status === 'open' ? 'Close' : 'Reopen'} size="sm" variant="outline" loading={busy} disabled={!hasRead || loading || !!error} onPress={() => void toggleStatus()} /> : undefined}
        />
      }
      gap={t.spacing.md}
      footer={
        <View style={{ gap: t.spacing.sm }}>
          {error && !hasRead ? <ErrorState message={error} onRetry={() => void load()} /> : null}
          {error && hasRead ? <InlineAlert message={`Refresh failed. Showing saved conversation history; replies are disabled until a successful refresh. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
          <InlineAlert message={actionError} />
          {features.enquiries ? (
            <>
              <TextArea
                label={thread?.status === 'closed' ? 'Reopen this enquiry to reply' : 'Message'}
                placeholder="Type your message…"
                value={body}
                onChangeText={setBody}
                editable={hasRead && !loading && !error && thread?.status === 'open'}
                maxLength={2000}
              />
              <Button title="Send message" fullWidth loading={busy} disabled={!body.trim() || !hasRead || loading || !!error || thread?.status !== 'open'} onPress={() => void send()} />
            </>
          ) : (
            <Text variant="caption" color="muted">Existing enquiry history is read-only while product enquiries are turned off.</Text>
          )}
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

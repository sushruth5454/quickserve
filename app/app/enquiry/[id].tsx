import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Header, InlineAlert, Screen, Skeleton, Text, TextArea, useToast } from '../../src/components/ui';
import {
  getProductEnquiry,
  listProductEnquiryMessages,
  markEnquiryRead,
  sendEnquiryMessage,
  setProductEnquiryStatus,
  type EnquiryMessage,
  type EnquiryThread,
} from '../../src/features/shops/api';
import { FeatureUnavailable, useShopFeatureFlags } from '../../src/features/shops/components';
import { useAuth } from '../../src/lib/auth';
import { useTheme } from '../../src/theme';

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
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!features.enquiries || !id) return;
    try {
      const [nextThread, nextMessages] = await Promise.all([getProductEnquiry(id), listProductEnquiryMessages(id)]);
      setThread(nextThread);
      setMessages(nextMessages);
      if (nextThread) await markEnquiryRead(id);
      setError(nextThread ? null : 'This enquiry is not available.');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [features.enquiries, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const send = async () => {
    if (!body.trim() || !thread || thread.status !== 'open') return;
    setBusy(true);
    try {
      await sendEnquiryMessage(thread.id, body);
      setBody('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async () => {
    if (!thread) return;
    const status = thread.status === 'open' ? 'closed' : 'open';
    setBusy(true);
    try {
      await setProductEnquiryStatus(thread.id, status);
      await load();
      toast({ message: status === 'open' ? 'Enquiry reopened' : 'Enquiry closed', tone: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const canChangeStatus = !!thread && (!thread.from_shop_user || thread.business_role === 'owner');

  if (!features.enquiries) {
    return <Screen header={<Header title="Product enquiry" />}><FeatureUnavailable feature="Product enquiries are not available right now." /></Screen>;
  }

  return (
    <Screen
      header={
        <Header
          title={thread?.shop_name ?? 'Product enquiry'}
          subtitle={thread?.product_name ?? 'Shop conversation'}
          right={canChangeStatus ? <Button title={thread.status === 'open' ? 'Close' : 'Reopen'} size="sm" variant="outline" loading={busy} onPress={() => void toggleStatus()} /> : undefined}
        />
      }
      gap={t.spacing.md}
      footer={
        <View style={{ gap: t.spacing.sm }}>
          <InlineAlert message={error} />
          <TextArea
            label={thread?.status === 'closed' ? 'Reopen this enquiry to reply' : 'Message'}
            placeholder="Type your message…"
            value={body}
            onChangeText={setBody}
            editable={thread?.status === 'open'}
            maxLength={2000}
          />
          <Button title="Send message" fullWidth loading={busy} disabled={!body.trim() || thread?.status !== 'open'} onPress={() => void send()} />
        </View>
      }
    >
      {thread ? (
        <Card>
          <Text variant="caption" color="muted">{thread.from_shop_user ? 'You are replying as this shop.' : 'You are chatting with the shop.'}</Text>
          <Text variant="caption" color="muted">Conversation status: {thread.status}</Text>
        </Card>
      ) : null}
      {messages == null ? <Skeleton height={280} radius={t.radii.lg} /> : messages.map((message) => {
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
      })}
      <Button title="Open shop" variant="ghost" onPress={() => thread && router.push(`/shop/${thread.shop_id}`)} />
    </Screen>
  );
}

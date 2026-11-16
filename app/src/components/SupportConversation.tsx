import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { getSupportThread, listSupportMessages, markSupportRead, sendSupport, setSupportStatus, type SupportMessage, type SupportThread } from '../lib/adminApi';
import { useAuth } from '../lib/auth';
import { useTheme } from '../theme';
import { Button, Card, Header, InlineAlert, Screen, Skeleton, Text, TextArea, useConfirm, useToast } from './ui';

export function SupportConversation({ threadId, admin = false }: { threadId: string; admin?: boolean }) {
  const { userId } = useAuth();
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [nextThread, nextMessages] = await Promise.all([getSupportThread(threadId), listSupportMessages(threadId)]);
      setThread(nextThread);
      setMessages(nextMessages);
      setError(null);
      await markSupportRead(threadId);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [threadId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await sendSupport(threadId, body);
      setBody('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    if (!thread) return;
    const reopening = thread.status === 'closed';
    const ok = await confirm({
      title: reopening ? 'Reopen this conversation?' : 'Close this support conversation?',
      message: reopening ? 'The user and support can message here again.' : 'You can reopen it later if needed.',
      confirmLabel: reopening ? 'Reopen' : 'Close',
    });
    if (!ok) return;
    try {
      await setSupportStatus(threadId, reopening ? 'open' : 'closed');
      await load();
      toast({ message: reopening ? 'Conversation reopened' : 'Conversation closed', tone: 'success' });
    } catch (e) { toast({ message: (e as Error).message, tone: 'error' }); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Screen
        header={
          <Header
            title={thread?.subject ?? 'Support'}
            subtitle={admin ? 'QuickServe support admin' : 'QuickServe support'}
            right={thread ? <Button title={thread.status === 'open' ? 'Close' : 'Reopen'} size="sm" variant="outline" onPress={() => void close()} /> : undefined}
          />
        }
        gap={t.spacing.md}
        footer={
          <View style={{ gap: 8 }}>
            {error ? <InlineAlert message={error} /> : null}
            <TextArea
              label={thread?.status === 'closed' ? 'Reopen to reply' : 'Message'}
              placeholder="Type your message…"
              value={body}
              onChangeText={setBody}
              editable={thread?.status !== 'closed'}
            />
            <Button title="Send" fullWidth loading={busy} disabled={!body.trim() || thread?.status === 'closed'} onPress={() => void send()} />
          </View>
        }
      >
        {!messages ? <Skeleton height={300} radius={t.radii.lg} /> : messages.map((m) => {
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
              <Text variant="captionStrong" color={mine ? 'primaryText' : 'muted'}>{m.from_admin ? 'QuickServe support' : admin ? 'User' : 'You'}</Text>
              <Text>{m.body}</Text>
              <Text variant="caption" color="muted" align="right">{new Date(m.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
            </Card>
          );
        })}
      </Screen>
    </KeyboardAvoidingView>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { listMessages, sendMessage, subscribeToMessages } from '../lib/api';
import { haptics } from '../lib/haptics';
import type { Message } from '../lib/types';
import { useTheme } from '../theme';
import { Avatar, Text } from './ui';

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

function dayOf(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Loads a booking's messages, subscribes to new ones and exposes `send`. */
export function useChat(bookingId: string | undefined) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!bookingId) return;
    let active = true;
    listMessages(bookingId)
      .then((m) => active && setMessages(m))
      .catch((e: Error) => {
        if (!active) return;
        setMessages([]);
        setError(e.message);
      });
    const unsubscribe = subscribeToMessages(bookingId, (m) =>
      setMessages((prev) => ((prev ?? []).some((x) => x.id === m.id) ? prev : [...(prev ?? []), m])),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bookingId]);

  const send = useCallback(
    async (body: string) => {
      const text = body.trim();
      if (!text || !bookingId) return false;
      setSending(true);
      setError(null);
      try {
        await sendMessage(bookingId, text);
        haptics.tap();
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      } finally {
        setSending(false);
      }
    },
    [bookingId],
  );

  return { messages, error, sending, send };
}

export function MessageList({
  messages,
  userId,
  counterpartName,
  newSinceId,
  seenId,
}: {
  messages: Message[];
  userId: string;
  counterpartName: string;
  /** First unread message when the chat was opened: a "New messages" divider goes above it. */
  newSinceId?: string | null;
  /** The user's latest message once the other person has read it ("Seen"). */
  seenId?: string | null;
}) {
  const t = useTheme();
  if (messages.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: t.spacing.huge, paddingHorizontal: t.spacing.xl, gap: t.spacing.sm }}>
        <View
          style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="chatbubbles-outline" size={26} color={t.colors.muted} />
        </View>
        <Text variant="title3" align="center">
          Say hello to {counterpartName.split(' ')[0]}
        </Text>
        <Text variant="callout" color="muted" align="center" style={{ maxWidth: 280 }}>
          Share directions or details about the job. Phone numbers stay private.
        </Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 4 }}>
      {messages.map((m, i) => {
        const mine = m.sender_id === userId;
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const newDay = !prev || dayOf(prev.created_at) !== dayOf(m.created_at);
        const firstOfGroup = newDay || !prev || prev.sender_id !== m.sender_id;
        const lastOfGroup = !next || next.sender_id !== m.sender_id || dayOf(next.created_at) !== dayOf(m.created_at);
        return (
          <View key={m.id}>
            {newDay ? (
              <Text variant="caption" color="muted" align="center" style={{ marginVertical: t.spacing.md }}>
                {dayOf(m.created_at)}
              </Text>
            ) : null}
            {m.id === newSinceId ? <NewMessagesDivider /> : null}
            <Animated.View
              entering={FadeInUp.duration(200)}
              style={{
                flexDirection: 'row',
                justifyContent: mine ? 'flex-end' : 'flex-start',
                alignItems: 'flex-end',
                gap: 8,
                marginTop: firstOfGroup && !newDay && i > 0 ? 8 : 0,
              }}
            >
              {!mine ? lastOfGroup ? <Avatar name={counterpartName} size={28} /> : <View style={{ width: 28 }} /> : null}
              <View
                accessible
                accessibilityLabel={`${mine ? 'You' : counterpartName} at ${timeOf(m.created_at)}: ${m.body ?? ''}`}
                style={{
                  maxWidth: '78%',
                  paddingHorizontal: 14,
                  paddingTop: 8,
                  paddingBottom: 6,
                  borderRadius: 18,
                  borderBottomRightRadius: mine && lastOfGroup ? 4 : 18,
                  borderBottomLeftRadius: !mine && lastOfGroup ? 4 : 18,
                  backgroundColor: mine ? t.colors.bubbleMine : t.colors.bubbleTheirs,
                }}
              >
                <Text variant="body" style={{ color: mine ? '#FFFFFF' : t.colors.text }}>
                  {m.body}
                </Text>
                <Text
                  variant="caption"
                  style={{ color: mine ? 'rgba(255,255,255,0.8)' : t.colors.muted, alignSelf: 'flex-end', fontSize: 11, lineHeight: 14 }}
                >
                  {timeOf(m.created_at)}
                </Text>
              </View>
            </Animated.View>
            {m.id === seenId ? (
              <Text variant="caption" color="muted" accessibilityLabel={`Seen by ${counterpartName}`} style={{ alignSelf: 'flex-end', marginTop: 2, fontSize: 11 }}>
                Seen
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function NewMessagesDivider() {
  const t = useTheme();
  const label = 'New messages';
  return (
    <View accessibilityRole="text" accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, marginVertical: t.spacing.md }}>
      <View style={{ flex: 1, height: 1, backgroundColor: t.colors.primary, opacity: 0.4 }} />
      <Text variant="captionStrong" style={{ color: t.colors.primaryText }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: t.colors.primary, opacity: 0.4 }} />
    </View>
  );
}

export function ChatComposer({
  counterpartName,
  sending,
  onSend,
}: {
  counterpartName: string;
  sending: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const t = useTheme();
  const [text, setText] = useState('');
  const canSend = !!text.trim() && !sending;
  const submit = async () => {
    if (!canSend) return;
    if (await onSend(text)) setText('');
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: t.spacing.sm }}>
      <View
        style={{
          flex: 1,
          minHeight: 44,
          maxHeight: 120,
          justifyContent: 'center',
          borderRadius: 22,
          borderWidth: 1,
          borderColor: t.colors.outline,
          backgroundColor: t.colors.surface,
          paddingHorizontal: t.spacing.lg,
        }}
      >
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={`Message ${counterpartName.split(' ')[0]}`}
          placeholderTextColor={t.colors.muted}
          accessibilityLabel="Message"
          maxLength={2000}
          multiline
          numberOfLines={Platform.OS === 'web' ? 1 : undefined}
          onSubmitEditing={() => void submit()}
          returnKeyType="send"
          submitBehavior="submit"
          style={
            {
              color: t.colors.text,
              fontFamily: t.fontFamily.regular,
              fontSize: 16,
              lineHeight: 22,
              paddingVertical: 10,
              maxHeight: 110,
              outlineStyle: 'none',
            } as never
          }
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send message"
        accessibilityState={{ disabled: !canSend }}
        disabled={!canSend}
        hitSlop={4}
        onPress={() => void submit()}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: canSend ? (pressed ? t.colors.primaryPressed : t.colors.primary) : t.colors.surfaceAlt,
        })}
      >
        <Ionicons name="arrow-up" size={20} color={canSend ? '#FFFFFF' : t.colors.subtle} />
      </Pressable>
    </View>
  );
}

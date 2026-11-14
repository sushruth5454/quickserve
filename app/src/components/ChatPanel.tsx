import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { TextInput, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { listMessages, sendMessage, subscribeToMessages } from '../lib/api';
import { haptics } from '../lib/haptics';
import type { Message } from '../lib/types';
import { useTheme } from '../theme';
import { Avatar, IconButton, InlineAlert, Text } from './ui';

interface Props {
  bookingId: string;
  userId: string;
  counterpartName: string;
  enabled: boolean;
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function ChatPanel({ bookingId, userId, counterpartName, enabled }: Props) {
  const t = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    let active = true;
    listMessages(bookingId)
      .then((m) => active && setMessages(m))
      .catch((e: Error) => active && setError(e.message));
    const unsubscribe = subscribeToMessages(bookingId, (m) =>
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m])),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bookingId]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await sendMessage(bookingId, body);
      haptics.tap();
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ gap: t.spacing.md }}>
      {messages.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: t.spacing.lg, gap: 6 }}>
          <Ionicons name="chatbubbles-outline" size={28} color={t.colors.subtle} />
          <Text variant="callout" color="muted" align="center">
            Say hello to {counterpartName.split(' ')[0]}. Phone numbers stay private.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          {messages.map((m, i) => {
            const mine = m.sender_id === userId;
            const prev = messages[i - 1];
            const firstOfGroup = !prev || prev.sender_id !== m.sender_id;
            return (
              <Animated.View
                key={m.id}
                entering={FadeInUp.duration(220)}
                style={{
                  flexDirection: 'row',
                  justifyContent: mine ? 'flex-end' : 'flex-start',
                  alignItems: 'flex-end',
                  gap: 8,
                  marginTop: firstOfGroup && i > 0 ? 8 : 0,
                }}
              >
                {!mine ? (
                  firstOfGroup ? <Avatar name={counterpartName} size={28} /> : <View style={{ width: 28 }} />
                ) : null}
                <View
                  accessible
                  accessibilityLabel={`${mine ? 'You' : counterpartName} at ${timeOf(m.created_at)}: ${m.body ?? ''}`}
                  style={{
                    maxWidth: '78%',
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                    borderRadius: 18,
                    borderBottomRightRadius: mine ? 6 : 18,
                    borderBottomLeftRadius: mine ? 18 : 6,
                    backgroundColor: mine ? t.colors.bubbleMine : t.colors.bubbleTheirs,
                  }}
                >
                  <Text variant="callout" style={{ color: mine ? '#FFFFFF' : t.colors.text }}>
                    {m.body}
                  </Text>
                  <Text
                    variant="micro"
                    style={{ color: mine ? 'rgba(255,255,255,0.75)' : t.colors.muted, alignSelf: 'flex-end', marginTop: 2, letterSpacing: 0 }}
                  >
                    {timeOf(m.created_at)}
                  </Text>
                </View>
              </Animated.View>
            );
          })}
        </View>
      )}
      <InlineAlert message={error} />
      {enabled ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.spacing.xs,
            borderRadius: t.radii.pill,
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.surfaceAlt,
            paddingLeft: t.spacing.lg,
            paddingRight: 4,
            minHeight: 52,
          }}
        >
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder={`Message ${counterpartName.split(' ')[0]}`}
            placeholderTextColor={t.colors.subtle}
            accessibilityLabel="Message"
            maxLength={2000}
            onSubmitEditing={() => void send()}
            returnKeyType="send"
            style={{ flex: 1, color: t.colors.text, fontFamily: t.fontFamily.regular, fontSize: 15, minHeight: 44 }}
          />
          <IconButton
            icon="arrow-up"
            accessibilityLabel="Send message"
            onPress={() => void send()}
            disabled={!text.trim() || sending}
            variant="tonal"
            color="primary"
            size={20}
          />
        </View>
      ) : (
        <Text variant="caption" color="muted" align="center">
          Chat is closed for this booking.
        </Text>
      )}
    </View>
  );
}

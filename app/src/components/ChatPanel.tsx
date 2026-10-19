import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { listMessages, sendMessage, subscribeToMessages } from '../lib/api';
import { colors, font, minTouch, radius, spacing } from '../lib/theme';
import type { Message } from '../lib/types';
import { Button } from './Button';
import { ErrorText } from './Screen';

interface Props {
  bookingId: string;
  userId: string;
  enabled: boolean;
}

export function ChatPanel({ bookingId, userId, enabled }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.wrap}>
      {messages.length === 0 ? (
        <Text style={font.caption}>No messages yet. Phone numbers stay private.</Text>
      ) : (
        messages.map((item) => {
          const mine = item.sender_id === userId;
          return (
            <View key={item.id} style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <Text style={{ color: mine ? colors.white : colors.text }}>{item.body}</Text>
              <Text style={[styles.time, mine && { color: colors.primarySoft }]}>
                {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          );
        })
      )}
      <ErrorText message={error} />
      {enabled && (
        <View style={styles.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type a message"
            placeholderTextColor={colors.muted}
            style={styles.input}
            accessibilityLabel="Message"
            maxLength={2000}
          />
          <Button title="Send" onPress={send} loading={sending} disabled={!text.trim()} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  bubble: { maxWidth: '80%', padding: spacing.md, borderRadius: radius, marginVertical: spacing.xs },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  time: { fontSize: 11, color: colors.muted, marginTop: 2 },
  composer: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: minTouch,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
  },
});

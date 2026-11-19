import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, InlineAlert, Text, TextArea, useToast } from '../../components/ui';
import * as api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { RequestMessage } from '../../lib/types';

export function RequestQuestionThread({
  requestId,
  providerId,
  otherPartyLabel,
}: {
  requestId: string;
  providerId: string;
  otherPartyLabel: string;
}) {
  const { userId } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState<RequestMessage[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.listRequestMessages(requestId, providerId);
      setMessages(next);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [providerId, requestId]);

  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    const message = body.trim();
    if (!message || busy) return;
    setBusy(true);
    try {
      await api.sendRequestMessage(requestId, providerId, message);
      setBody('');
      await load();
      toast({ message: 'Message sent', tone: 'success' });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      {error ? <InlineAlert message={error} /> : null}
      {messages.length === 0 ? <Text variant="footnote" color="muted">No questions yet.</Text> : messages.map((message) => (
        <Card key={message.id}>
          <Text variant="caption" color="muted">{message.sender_id === userId ? 'You' : otherPartyLabel}</Text>
          <Text>{message.body}</Text>
        </Card>
      ))}
      <TextArea label="Your question" value={body} onChangeText={setBody} maxLength={2000} />
      <Button title="Send message" variant="outline" loading={busy} disabled={!body.trim()} onPress={() => void send()} />
    </View>
  );
}

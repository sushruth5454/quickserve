import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Header, InlineAlert, Input, Screen, Text, TextArea } from '../../src/components/ui';
import { startSupport } from '../../src/lib/adminApi';

export default function NewSupportConversation() {
  const { bookingId } = useLocalSearchParams<{ bookingId?: string }>();
  const [subject, setSubject] = useState(bookingId ? 'Help with this booking' : '');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const id = await startSupport(body, bookingId || null, subject || null);
      router.replace({ pathname: '/support/[id]', params: { id } });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Screen
      header={<Header title="Contact support" subtitle="Customers and providers use the same private inbox" />}
      footer={<Button title="Send to QuickServe support" fullWidth loading={busy} disabled={!body.trim() || (!bookingId && !subject.trim())} onPress={() => void send()} />}
    >
      {error ? <InlineAlert message={error} /> : null}
      {bookingId ? (
        <Text color="textSecondary">This conversation will be linked to the booking, so support sees the booking details.</Text>
      ) : (
        <Input label="What do you need help with?" placeholder="Payment, booking, account…" value={subject} onChangeText={setSubject} maxLength={120} />
      )}
      <TextArea label="Message" placeholder="Tell us what happened. Don't include card or UPI details." value={body} onChangeText={setBody} />
    </Screen>
  );
}

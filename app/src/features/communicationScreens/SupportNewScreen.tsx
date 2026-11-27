import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Header, InlineAlert, Input, Screen, Text, TextArea } from '../../components/ui';
import { startSupport } from '../../lib/adminApi';

export function supportStartRequest(bookingId: string | undefined, subject: string) {
  return {
    bookingId: bookingId || null,
    subject: bookingId ? null : subject || null,
  };
}

function useSupportNewController() {
  const { bookingId } = useLocalSearchParams<{ bookingId?: string }>();
  const [subject, setSubject] = useState(bookingId ? 'Help with this booking' : '');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const request = supportStartRequest(bookingId, subject);
      const id = await startSupport(body, request.bookingId, request.subject);
      router.replace({ pathname: '/support/[id]', params: { id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return { bookingId, subject, setSubject, body, setBody, error, busy, send };
}

export default function SupportNewScreen() {
  const { bookingId, subject, setSubject, body, setBody, error, busy, send } = useSupportNewController();
  return (
    <Screen
      header={<Header title="Contact support" subtitle="Customers and providers use the same private inbox" />}
      footer={(
        <Button
          title="Send to QuickServe support"
          fullWidth
          loading={busy}
          disabled={!body.trim() || (!bookingId && !subject.trim())}
          onPress={() => void send()}
        />
      )}
    >
      {error ? <InlineAlert message={error} /> : null}
      {bookingId ? (
        <Text color="textSecondary">This conversation will be linked to the booking, so support sees the booking details.</Text>
      ) : (
        <Input
          label="What do you need help with?"
          placeholder="Payment, booking, account…"
          value={subject}
          onChangeText={setSubject}
          maxLength={120}
        />
      )}
      <Text variant="caption" color="muted">Messages are limited to 2,000 characters. Don’t include card or UPI details.</Text>
      <TextArea
        label="Message"
        placeholder="Tell us what happened."
        value={body}
        onChangeText={setBody}
        maxLength={2000}
      />
    </Screen>
  );
}

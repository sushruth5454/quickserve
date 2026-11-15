import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Header, InlineAlert, Screen, Section, TextInput } from '../../src/components/ui';
import * as api from '../../src/lib/api';
import { useToast } from '../../src/components/ui';

export default function SubmitDelivery() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (!id || !url.trim()) throw new Error('Add a delivery URL');
      await api.submitDelivery(id, [{ title: title.trim() || 'Final delivery', url: url.trim() }]);
      toast({ message: 'Delivery sent to the customer', tone: 'success' });
      router.back();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Screen header={<Header title="Submit deliverables" />} footer={<Button title="Send to customer" size="lg" fullWidth loading={busy} onPress={() => void submit()} />}>
      {error ? <InlineAlert message={error} /> : null}
      <Section title="Delivery link">
        <TextInput label="Title" value={title} onChangeText={setTitle} placeholder="Edited photos" />
        <TextInput label="HTTPS link" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" />
        <InlineAlert tone="info" title="Use a durable customer-accessible link" message="Do not use expiring private chat links. The customer gets 7 days to accept." />
      </Section>
    </Screen>
  );
}

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Header, InlineAlert, Input, Screen, Section } from '../../src/components/ui';
import * as api from '../../src/lib/api';
import { useToast } from '../../src/components/ui';

type DeliveryLinkDraft = { title: string; url: string };

export default function SubmitDelivery() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const [links, setLinks] = useState<DeliveryLinkDraft[]>([{ title: '', url: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateLink = (index: number, patch: Partial<DeliveryLinkDraft>) => {
    setLinks((current) => current.map((link, i) => i === index ? { ...link, ...patch } : link));
  };
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (!id) throw new Error('Booking not found');
      if (links.length < 1 || links.length > 20) throw new Error('Submit between 1 and 20 delivery links');
      const payload = links.map((link) => ({
        title: link.title.trim() || 'Final delivery',
        url: link.url.trim(),
      }));
      if (payload.some((link) => !/^https:\/\/\S+$/.test(link.url))) {
        throw new Error('Enter a full HTTPS URL for every delivery link');
      }
      await api.submitDelivery(id, payload);
      toast({ message: 'Delivery sent to the customer', tone: 'success' });
      router.back();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Screen header={<Header title="Submit deliverables" />} footer={<Button title="Send to customer" size="lg" fullWidth loading={busy} onPress={() => void submit()} />}>
      {error ? <InlineAlert message={error} /> : null}
      <Section title="Delivery links">
        {links.map((link, index) => (
          <Section key={`delivery-link-${index}`} title={`Link ${index + 1}`}>
            <Input
              label="Title"
              value={link.title}
              onChangeText={(value) => updateLink(index, { title: value })}
              placeholder="Edited photos"
            />
            <Input
              label="HTTPS link"
              value={link.url}
              onChangeText={(value) => updateLink(index, { url: value })}
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://"
            />
            {links.length > 1 ? (
              <Button
                title="Remove link"
                variant="outline"
                disabled={busy}
                onPress={() => setLinks((current) => current.filter((_, i) => i !== index))}
              />
            ) : null}
          </Section>
        ))}
        <Button
          title="Add link"
          variant="outline"
          disabled={busy || links.length >= 20}
          onPress={() => setLinks((current) => current.length < 20 ? [...current, { title: '', url: '' }] : current)}
        />
        <InlineAlert
          tone="info"
          title="Use durable customer-accessible links"
          message="Do not use expiring private chat links. The customer gets 72 hours to review and accept."
        />
      </Section>
    </Screen>
  );
}

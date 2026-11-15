import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Header, InlineAlert, Input, Screen, Section, Text, TextArea } from '../../../src/components/ui';
import * as api from '../../../src/lib/api';
import { rupeesToPaise } from '../../../src/lib/money';
import { useToast } from '../../../src/components/ui';

export default function ComposeProposal() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [total, setTotal] = useState('');
  const [advance, setAdvance] = useState('30');
  const [delivery, setDelivery] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      if (!requestId || !title.trim()) throw new Error('Add a line item title');
      const amount = rupeesToPaise(Number(total));
      const advanceAmount = Math.round(amount * Number(advance) / 100);
      if (amount <= 0 || advanceAmount <= 0 || advanceAmount >= amount) throw new Error('Enter a valid fixed total and advance below 100%');
      await api.sendProposal({
        requestId,
        items: [{ seq: 1, kind: 'package', title: title.trim(), qty: 1, unit: 'job', unit_price: amount, bill_photo_url: null }],
        schedule: [
          { label: 'Booking advance', amount: advanceAmount, due_rule: 'at_booking' },
          { label: delivery ? 'Delivery balance' : 'Final payment', amount: amount - advanceAmount, due_rule: delivery ? 'on_delivery' : 'on_completion' },
        ],
        validUntil: new Date(Date.now() + 7 * 86400000),
        note,
        deliverables: delivery.trim() ? [{ type: 'final_delivery', qty: 1, spec: delivery.trim() }] : [],
      });
      toast({ message: 'Proposal sent', tone: 'success' });
      router.back();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen header={<Header title="Send proposal" />} footer={<Button title="Send fixed proposal" size="lg" fullWidth loading={busy} onPress={() => void send()} />}>
      {error ? <InlineAlert message={error} /> : null}
      <Section title="Scope">
        <Input label="Package / scope" value={title} onChangeText={setTitle} placeholder="Wedding photography · 8 hours" />
        <Input label="Fixed total (₹)" keyboardType="number-pad" value={total} onChangeText={setTotal} />
        <TextArea label="Terms" value={note} onChangeText={setNote} />
      </Section>
      <Section title="Payment plan">
        <Input label="Advance (%)" keyboardType="number-pad" value={advance} onChangeText={setAdvance} />
        <Card><Text color="textSecondary">Remaining balance is due at completion or delivery. The platform fee is collected separately with the advance.</Text></Card>
      </Section>
      <Section title="Deliverables" subtitle="Optional">
        <TextArea label="What will be delivered?" value={delivery} onChangeText={setDelivery} placeholder="Edited gallery, album, turnaround…" />
      </Section>
    </Screen>
  );
}

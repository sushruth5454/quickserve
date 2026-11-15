import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Header, InlineAlert, Screen, Section, Text, TextArea, TextInput } from '../../src/components/ui';
import * as api from '../../src/lib/api';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { rupeesToPaise } from '../../src/lib/money';
import { useToast } from '../../src/components/ui';

export default function NewServiceRequest() {
  const { categoryId, name = 'service' } = useLocalSearchParams<{ categoryId: string; name?: string }>();
  const { location } = useSelectedLocation();
  const toast = useToast();
  const [brief, setBrief] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [budget, setBudget] = useState('');
  const [venue, setVenue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!categoryId) throw new Error('Choose a service category first');
      const start = new Date(`${eventDate}T10:00:00+05:30`);
      if (Number.isNaN(start.getTime()) || brief.trim().length < 10) throw new Error('Add a date and a short brief');
      const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
      const id = await api.createServiceRequest({
        categoryId, city: location.city ?? 'Vijayawada', area: location.area,
        eventStart: start, eventEnd: end, intake: { brief: brief.trim() },
        budgetMin: budget ? rupeesToPaise(Number(budget) * 0.8) : null,
        budgetMax: budget ? rupeesToPaise(Number(budget)) : null,
        addressId: null, venueText: venue.trim() || location.area,
      });
      toast({ message: 'Request sent to matching providers', tone: 'success' });
      router.replace({ pathname: '/request/[id]', params: { id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<Header title={`Get ${name} proposals`} />} footer={<Button title="Request proposals" fullWidth size="lg" loading={busy} onPress={() => void submit()} />}>
      {error ? <InlineAlert title="Check the brief" message={error} /> : null}
      <Section title="Your brief" subtitle="Providers see this before they quote. Never add phone numbers or payment details.">
        <TextArea label="What do you need?" placeholder="Tell providers about the event, style and deliverables…" value={brief} onChangeText={setBrief} minHeight={140} />
      </Section>
      <Section title="Event">
        <TextInput label="Date" placeholder="YYYY-MM-DD" value={eventDate} onChangeText={setEventDate} />
        <TextInput label="Venue / area" placeholder="Venue name and area" value={venue} onChangeText={setVenue} />
      </Section>
      <Section title="Budget">
        <TextInput label="Approximate maximum (₹)" keyboardType="number-pad" value={budget} onChangeText={setBudget} />
        <Text variant="caption" color="muted">Providers quote a fixed proposal with line items. You never pay a range.</Text>
      </Section>
    </Screen>
  );
}

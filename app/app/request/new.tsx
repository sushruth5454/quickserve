import { router, useLocalSearchParams } from 'expo-router';
<<<<<<< HEAD
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import { createServiceRequest, getCatalogueCategory } from '../../src/features/catalogue/api';
import { SchemaForm } from '../../src/features/catalogue/SchemaForm';
import { validateValues } from '../../src/features/catalogue/schema';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { rupeesToPaise } from '../../src/lib/money';
import type { Category } from '../../src/lib/types';
import { useTheme } from '../../src/theme';

export default function NewServiceRequest() {
  const t = useTheme();
  const toast = useToast();
  const { category: slug } = useLocalSearchParams<{ category: string; package?: string }>();
  const { location } = useSelectedLocation();
  const [category, setCategory] = useState<Category | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [intake, setIntake] = useState<Record<string, unknown>>({});
  const [eventStart, setEventStart] = useState('');
  const [eventEnd, setEventEnd] = useState('');
  const [venue, setVenue] = useState(location.line1 ?? '');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!slug) return;
    getCatalogueCategory(slug, location.city).then(setCategory).catch((caught: Error) => setError(caught.message));
  }, [slug, location.city]);

  const schemaIssues = useMemo(() => validateValues(category?.intake_schema ?? { type: 'object', properties: {} }, intake), [category, intake]);
  const start = new Date(eventStart);
  const end = new Date(eventEnd);
  const blocker = !eventStart || Number.isNaN(start.getTime())
    ? 'Choose an event or project start'
    : !eventEnd || Number.isNaN(end.getTime()) || end <= start
      ? 'Choose an end time after the start'
      : schemaIssues.length
        ? schemaIssues[0]?.message ?? 'Complete the brief'
        : !venue.trim() && category?.location_modes?.includes('at_venue')
          ? 'Add the venue or service address'
          : null;

  const submit = async () => {
    if (!category || blocker) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createServiceRequest({
        categoryId: category.id,
        city: location.city,
        addressId: location.addressId ?? null,
        venueText: venue.trim() || null,
        eventStart: start,
        eventEnd: end,
        intake,
        budgetMin: budgetMin ? rupeesToPaise(Number(budgetMin)) : null,
        budgetMax: budgetMax ? rupeesToPaise(Number(budgetMax)) : null,
      });
      toast({ message: 'Request sent to matching providers', tone: 'success' });
      router.replace({ pathname: '/request/[id]', params: { id } });
    } catch (caught) {
      setError((caught as Error).message);
=======
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
>>>>>>> 3844b2b (feat: add proposal milestone booking engine)
    } finally {
      setBusy(false);
    }
  };

<<<<<<< HEAD
  if (category === undefined) return <Screen header={<Header title="Request proposals" />}><Skeleton height={360} radius={t.radii.lg} /></Screen>;
  if (!category) return <Screen header={<Header title="Request proposals" />}><EmptyState icon="storefront-outline" title="Category unavailable" message="This category is not live in your selected city." /></Screen>;

  return (
    <Screen
      header={<Header title={`Request ${category.name}`} subtitle="One brief. Multiple itemised proposals. No contact sharing." />}
      footer={<Button title="Send request" onPress={() => void submit()} loading={busy} disabled={!!blocker} accessibilityHint={blocker ?? undefined} size="lg" fullWidth leftIcon="send" />}
    >
      <InlineAlert message={error} />
      <InlineAlert tone="info" icon="shield-checkmark-outline" message="Providers only receive the service area and brief. Exact venue details remain private until your advance is paid." />
      <Card gap={t.spacing.md} variant="outlined">
        <Text variant="title3">Event or project dates</Text>
        <Input label="Starts" value={eventStart} onChangeText={setEventStart} placeholder="YYYY-MM-DDT10:00" helper="Local date and time, for example 2026-12-15T10:00" />
        <Input label="Ends" value={eventEnd} onChangeText={setEventEnd} placeholder="YYYY-MM-DDT18:00" />
      </Card>
      <Card gap={t.spacing.md} variant="outlined">
        <Text variant="title3">Brief</Text>
        <SchemaForm schema={category.intake_schema ?? { type: 'object', properties: {} }} value={intake} onChange={setIntake} />
      </Card>
      <Card gap={t.spacing.md} variant="outlined">
        <Text variant="title3">Venue & budget</Text>
        <Input label="Venue / service area" value={venue} onChangeText={setVenue} helper="Only your service city or area is shown to providers before you accept." />
        <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
          <Input label="Budget from" prefix="₹" value={budgetMin} onChangeText={setBudgetMin} keyboardType="numeric" containerStyle={{ flex: 1 }} />
          <Input label="Budget to" prefix="₹" value={budgetMax} onChangeText={setBudgetMax} keyboardType="numeric" containerStyle={{ flex: 1 }} />
        </View>
      </Card>
=======
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
>>>>>>> 3844b2b (feat: add proposal milestone booking engine)
    </Screen>
  );
}

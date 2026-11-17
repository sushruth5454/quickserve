import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Header, InlineAlert, Input, Screen, Section, SegmentedControl, Text, TextArea, useToast } from '../../src/components/ui';
import * as api from '../../src/lib/api';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { rupeesToPaise } from '../../src/lib/money';
import { relativeTimeLabel, URGENT_MIN_HOURS, urgentStartOptions } from '../../src/lib/schedule';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';

export default function NewServiceRequest() {
  const { categoryId, name = 'service', providerId, providerName } = useLocalSearchParams<{
    categoryId: string;
    name?: string;
    providerId?: string;
    providerName?: string;
  }>();
  const { location } = useSelectedLocation();
  const toast = useToast();
  const flags = useAppFeatureFlags();
  const [brief, setBrief] = useState('');
  const [when, setWhen] = useState<'date' | 'urgent'>('date');
  const [eventDate, setEventDate] = useState('');
  const urgentOptions = useMemo(() => urgentStartOptions(new Date()), []);
  const [urgentAt, setUrgentAt] = useState<number | null>(null);
  const [budget, setBudget] = useState('');
  const [venue, setVenue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!categoryId) throw new Error('Choose a service category first');
      const urgent = when === 'urgent';
      if (urgent && urgentAt == null) throw new Error('Pick a start time');
      const start = urgent ? new Date(urgentAt!) : new Date(`${eventDate}T10:00:00+05:30`);
      if (Number.isNaN(start.getTime()) || brief.trim().length < 10) throw new Error('Add a date and a short brief');
      const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
      const id = await api.createServiceRequest({
        categoryId,
        city: location.city || 'Vijayawada',
        area: location.area,
        eventStart: start,
        eventEnd: end,
        intake: { brief: brief.trim() },
        budgetMin: budget ? rupeesToPaise(Number(budget) * 0.8) : null,
        budgetMax: budget ? rupeesToPaise(Number(budget)) : null,
        addressId: location.addressId ?? null,
        venueText: venue.trim() || location.area,
        providerId: providerId || null,
        lat: location.lat,
        lng: location.lng,
        urgent,
      });
      toast({
        message: providerName
          ? `${urgent ? 'Urgent request' : 'Request'} sent to ${providerName}`
          : urgent ? 'Urgent request sent — pros nearby are alerted now' : 'Request sent to matching providers',
        tone: 'success',
      });
      router.replace({ pathname: '/request/[id]', params: { id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header title={providerName ? `Request a proposal from ${providerName}` : `Get ${name} proposals`} subtitle={providerName ? name : undefined} />}
      footer={<Button title={providerName ? `Send to ${providerName}` : 'Request proposals'} fullWidth size="lg" loading={busy} onPress={() => void submit()} />}
    >
      {error ? <InlineAlert title="Check the brief" message={error} /> : null}
      <Section
        title="Your brief"
        subtitle={`${providerName ? `Only ${providerName} sees this` : 'Providers see this'} before they quote. Never add phone numbers or payment details.`}
      >
        <TextArea label="What do you need?" placeholder="Tell providers about the event, style and deliverables…" value={brief} onChangeText={setBrief} />
      </Section>
      <Section title="Event">
        <SegmentedControl
          options={[
            { value: 'date', label: 'Pick a date' },
            ...(flags.isOn('urgent_requests') ? [{ value: 'urgent', label: 'Urgent' } as const] : []),
          ]}
          value={when}
          onChange={setWhen}
          accessibilityLabel="When do you need it"
        />
        {when === 'date' ? (
          <Input label="Event date" placeholder="YYYY-MM-DD" value={eventDate} onChangeText={setEventDate} />
        ) : (
          <View style={{ gap: 8 }}>
            <Text variant="footnote" color="textSecondary">
              Need someone today? Pick a start time at least {URGENT_MIN_HOURS} hours away. Nearby pros are alerted right away
              and must reply 30 minutes before it starts.
            </Text>
            {urgentOptions.length === 0 ? (
              <Text variant="footnote" color="muted">No urgent times left today. Pick a date instead.</Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {urgentOptions.map((d) => (
                  <Chip
                    key={d.getTime()}
                    label={relativeTimeLabel(d, new Date())}
                    selected={urgentAt === d.getTime()}
                    onPress={() => setUrgentAt(d.getTime())}
                  />
                ))}
              </View>
            )}
          </View>
        )}
        <Input label="Venue / area" placeholder="Venue name and area" value={venue} onChangeText={setVenue} />
      </Section>
      <Section title="Budget">
        <Input label="Approximate maximum (₹)" keyboardType="number-pad" value={budget} onChangeText={setBudget} />
        <Text variant="caption" color="muted">Providers quote a fixed proposal with line items. You never pay a range.</Text>
      </Section>
    </Screen>
  );
}

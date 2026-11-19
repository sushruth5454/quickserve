import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Header, InlineAlert, Input, Screen, Section, SegmentedControl, Text, TextArea, useToast } from '../../src/components/ui';
import * as api from '../../src/lib/api';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { formatINR, rupeesToPaise } from '../../src/lib/money';
import { relativeTimeLabel, URGENT_MIN_HOURS, urgentStartOptions } from '../../src/lib/schedule';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { getCatalogueCategoryById, getCataloguePackage, type CataloguePackage } from '../../src/features/catalogue/api';
import { SchemaForm } from '../../src/features/catalogue/SchemaForm';
import { validateValues } from '../../src/features/catalogue/schema';
import { getRequestRecipientCount } from '../../src/features/proposals/api';
import type { Category } from '../../src/lib/types';

export default function NewServiceRequest() {
  const { categoryId, name = 'service', providerId, providerName, package: packageId } = useLocalSearchParams<{
    categoryId: string;
    name?: string;
    providerId?: string;
    providerName?: string;
    package?: string;
  }>();
  const { location } = useSelectedLocation();
  const toast = useToast();
  const flags = useAppFeatureFlags();
  const [brief, setBrief] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [packageDetails, setPackageDetails] = useState<CataloguePackage | null>(null);
  const [schemaValues, setSchemaValues] = useState<Record<string, unknown>>({});
  const [when, setWhen] = useState<'date' | 'urgent'>('date');
  const [eventDate, setEventDate] = useState('');
  const urgentOptions = useMemo(() => urgentStartOptions(new Date()), []);
  const [urgentAt, setUrgentAt] = useState<number | null>(null);
  const [budget, setBudget] = useState('');
  const [venue, setVenue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const city = location.city || 'Vijayawada';
  const remoteOnly = category?.location_modes?.length === 1 && category.location_modes[0] === 'remote';

  useEffect(() => {
    let active = true;
    if (!categoryId) return () => { active = false; };
    void Promise.all([
      getCatalogueCategoryById(categoryId, city),
      packageId ? getCataloguePackage(packageId) : Promise.resolve(null),
    ]).then(([nextCategory, nextPackage]) => {
      if (!active) return;
      setCategory(nextCategory);
      setPackageDetails(nextPackage);
    }).catch((caught: Error) => {
      if (active) setError(caught.message);
    });
    return () => { active = false; };
  }, [categoryId, city, packageId]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!categoryId) throw new Error('Choose a service category first');
      const schema = category?.intake_schema;
      if (schema && Object.keys((schema as { properties?: Record<string, unknown> }).properties ?? {}).length > 0) {
        const issues = validateValues(schema, schemaValues);
        if (issues.length) throw new Error(`${issues[0].path}: ${issues[0].message}`);
      }
      const urgent = !remoteOnly && when === 'urgent';
      if (urgent && urgentAt == null) throw new Error('Pick a start time');
      const start = urgent ? new Date(urgentAt!) : new Date(`${eventDate}T10:00:00+05:30`);
      if (Number.isNaN(start.getTime()) || brief.trim().length < 10) throw new Error('Add a date and a short brief');
      const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
      const intake: Record<string, unknown> = {
        brief: brief.trim(),
        ...schemaValues,
        ...(packageId ? { package_id: packageId } : {}),
        ...(!urgent && eventDate ? { deliver_by: eventDate } : {}),
      };
      const id = await api.createServiceRequest({
        categoryId,
        city,
        area: location.area,
        eventStart: start,
        eventEnd: end,
        intake,
        budgetMin: budget ? rupeesToPaise(Number(budget) * 0.8) : null,
        budgetMax: budget ? rupeesToPaise(Number(budget)) : null,
        addressId: location.addressId ?? null,
        venueText: venue.trim() || location.area,
        providerId: providerId || null,
        lat: location.lat,
        lng: location.lng,
        urgent,
      });
      let recipientCount: number | null = null;
      if (!providerId) {
        try {
          recipientCount = await getRequestRecipientCount(id);
        } catch {
          recipientCount = null;
        }
      }
      toast({
        message: providerName
          ? `${urgent ? 'Urgent request' : 'Request'} sent to ${providerName}`
          : recipientCount === 0
            ? 'No pros were found for this request.'
            : recipientCount == null
              ? 'Request submitted. We could not confirm matching pros.'
              : urgent ? 'Urgent request sent — pros nearby are alerted now' : 'Request sent to matching providers',
        tone: recipientCount === 0 ? 'warning' : 'success',
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
      {packageDetails ? (
        <Section title="Selected package">
          <View style={{ gap: 6 }}>
            <Text variant="calloutStrong">{packageDetails.package.title}</Text>
            <Text color="textSecondary">{packageDetails.package.description}</Text>
            <Text variant="footnoteStrong">Starting from {formatINR(packageDetails.package.price_min ?? 0)}</Text>
            {packageDetails.package.inclusions.map((item, index) => <Text key={`inclusion-${index}`}>• {item}</Text>)}
            {packageDetails.package.exclusions.map((item, index) => <Text key={`exclusion-${index}`} color="muted">• Not included: {item}</Text>)}
            {packageDetails.package.deliverables.map((item, index) => (
              <Text key={`deliverable-${index}`}>• {item.qty} {item.type}{item.spec ? ` — ${item.spec}` : ''}</Text>
            ))}
            {packageDetails.package.turnaround_days != null ? <Text>Turnaround: {packageDetails.package.turnaround_days} days</Text> : null}
            <Text>Revisions included: {packageDetails.package.revisions_included}</Text>
            {packageDetails.package.raw_files_included ? <Text>Raw files included</Text> : null}
            {packageDetails.package.usage_rights.organic_posting ? <Text>Organic posting rights included</Text> : null}
            {packageDetails.package.usage_rights.paid_ads_days
              ? <Text>Paid ads rights: {packageDetails.package.usage_rights.paid_ads_days} days</Text>
              : null}
            {packageDetails.package.usage_rights.exclusivity_days
              ? <Text>Exclusivity: {packageDetails.package.usage_rights.exclusivity_days} days</Text>
              : null}
          </View>
        </Section>
      ) : null}
      {category?.intake_schema
        && Object.keys((category.intake_schema as { properties?: Record<string, unknown> }).properties ?? {}).length > 0 ? (
          <Section title={`${category.name} details`}>
            <SchemaForm schema={category.intake_schema} value={schemaValues} onChange={setSchemaValues} />
          </Section>
        ) : null}
      <Section title="Event">
        <SegmentedControl
          options={[
            { value: 'date', label: 'Pick a date' },
            ...(!remoteOnly && flags.isOn('urgent_requests') ? [{ value: 'urgent', label: 'Urgent' } as const] : []),
          ]}
          value={when}
          onChange={setWhen}
          accessibilityLabel="When do you need it"
        />
        {!remoteOnly && when === 'urgent' ? (
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
        ) : (
          <Input label={remoteOnly ? 'Deliver by' : 'Event date'} placeholder="YYYY-MM-DD" value={eventDate} onChangeText={setEventDate} />
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

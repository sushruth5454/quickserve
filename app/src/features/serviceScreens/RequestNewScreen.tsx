import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Header, InlineAlert, Input, Screen, Section, SegmentedControl, Skeleton, Text, TextArea, useToast } from '../../components/ui';
import { useFeatureControlHydrationReady, useFeatureControlState, type FeatureControlFreshness } from '../../branding/FeatureFlagsProvider';
import * as api from '../../lib/api';
import { useSelectedLocation } from '../../lib/locationContext';
import { formatINR, rupeesToPaise } from '../../lib/money';
import { relativeTimeLabel, URGENT_MIN_HOURS, urgentStartOptions } from '../../lib/schedule';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { getCatalogueCategoryById, getCataloguePackage, type CataloguePackage } from '../catalogue/api';
import { SchemaForm } from '../catalogue/SchemaForm';
import { validateSchema, validateValues } from '../catalogue/schema';
import { getRequestRecipientCount } from '../proposals/api';
import type { Category } from '../../lib/types';

export function isProposalRequestReady(input: {
  controlsHydrated: boolean;
  freshness: FeatureControlFreshness;
  proposalEnabled: boolean;
  categoryResolved: boolean;
  categoryValid: boolean;
  packageResolved: boolean;
}): boolean {
  return input.controlsHydrated
    && (input.freshness === 'cache' || input.freshness === 'live')
    && input.proposalEnabled
    && input.categoryResolved
    && input.categoryValid
    && input.packageResolved;
}

export default function RequestNewScreen() {
  const controller = useRequestNewController();
  return <RequestNewView controller={controller} />;
}

function useRequestNewController() {
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
  const featureState = useFeatureControlState();
  const controlsHydrated = useFeatureControlHydrationReady();
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
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [catalogueResolved, setCatalogueResolved] = useState(false);
  const city = location.city || 'Vijayawada';
  const remoteOnly = category?.location_modes?.length === 1 && category.location_modes[0] === 'remote';
  const categoryValid = !!category && category.active !== false && category.archetype === 'proposal'
    && validateSchema(category.intake_schema).length === 0;
  const proposalReady = isProposalRequestReady({
    controlsHydrated,
    freshness: featureState.freshness,
    proposalEnabled: flags.archetypes?.proposal === true,
    categoryResolved: catalogueResolved,
    categoryValid,
    packageResolved: catalogueResolved,
  });

  useEffect(() => {
    let active = true;
    setCatalogueResolved(false);
    setCatalogueError(null);
    setCategory(null);
    setPackageDetails(null);
    setError(null);
    if (!categoryId) {
      setCatalogueError('Choose a service category first');
      return () => { active = false; };
    }
    void Promise.all([
      getCatalogueCategoryById(categoryId, city),
      packageId ? getCataloguePackage(packageId) : Promise.resolve(null),
    ]).then(([nextCategory, nextPackage]) => {
      if (!nextCategory || nextCategory.active === false || nextCategory.archetype !== 'proposal') {
        throw new Error('This proposal category is no longer available');
      }
      if (validateSchema(nextCategory.intake_schema).length > 0) {
        throw new Error('This category intake configuration is unavailable');
      }
      if (nextPackage && (nextPackage.category.id !== categoryId
        || providerId && nextPackage.providerId !== providerId)) {
        throw new Error('The selected package is not available for this service');
      }
      if (!active) return;
      setCategory(nextCategory);
      setPackageDetails(nextPackage);
      setCatalogueResolved(true);
    }).catch((caught: Error) => {
      if (active) setCatalogueError(caught.message);
    });
    return () => { active = false; };
  }, [categoryId, city, packageId, providerId]);

  const submit = async () => {
    if (!proposalReady || !category) {
      setError('Proposal request settings are still loading or unavailable');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!categoryId) throw new Error('Choose a service category first');
      const schema = category.intake_schema;
      if (Object.keys((schema as { properties?: Record<string, unknown> }).properties ?? {}).length > 0) {
        const [firstIssue] = validateValues(schema, schemaValues);
        if (firstIssue) throw new Error(`${firstIssue.path}: ${firstIssue.message}`);
      }
      const urgentRequested = !remoteOnly && when === 'urgent';
      if (urgentRequested && !flags.isOn('urgent_requests')) throw new Error('Urgent requests are currently unavailable');
      const urgent = urgentRequested;
      if (urgent && urgentAt == null) throw new Error('Pick a start time');
      const start = urgent ? new Date(urgentAt!) : new Date(`${eventDate}T10:00:00+05:30`);
      if (Number.isNaN(start.getTime()) || brief.trim().length < 10) throw new Error('Add a date and a short brief');
      const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
      const schemaAnswers = Object.fromEntries(Object.entries(schemaValues)
        .filter(([key]) => !['brief', 'package_id', 'deliver_by'].includes(key)));
      const intake: Record<string, unknown> = {
        ...schemaAnswers,
        brief: brief.trim(),
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
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const controlsReady = controlsHydrated && (featureState.freshness === 'cache' || featureState.freshness === 'live');
  const parentEnabled = controlsReady && flags.archetypes?.proposal === true;

  return {
    name, providerName, category, packageDetails, schemaValues, setSchemaValues, location, flags,
    remoteOnly, when, setWhen, urgentOptions, urgentAt, setUrgentAt, eventDate, setEventDate,
    venue, setVenue, budget, setBudget, brief, setBrief, error, catalogueError, controlsReady,
    parentEnabled, catalogueResolved, proposalReady, busy, submit,
  };
}

function RequestNewView({ controller }: { controller: ReturnType<typeof useRequestNewController> }) {
  const {
    name, providerName, category, packageDetails, schemaValues, setSchemaValues, location, flags,
    remoteOnly, when, setWhen, urgentOptions, urgentAt, setUrgentAt, eventDate, setEventDate,
    venue, setVenue, budget, setBudget, brief, setBrief, error, catalogueError, controlsReady,
    parentEnabled, catalogueResolved, proposalReady, busy, submit,
  } = controller;
  return (
    <Screen
      header={<Header title={providerName ? `Request a proposal from ${providerName}` : `Get ${name} proposals`} subtitle={providerName ? name : undefined} />}
      footer={proposalReady
        ? <Button title={providerName ? `Send to ${providerName}` : 'Request proposals'} fullWidth size="lg" loading={busy} disabled={busy} onPress={() => void submit()} />
        : undefined}
    >
      {error ? <InlineAlert title="Check the brief" message={error} /> : null}
      {!controlsReady ? <InlineAlert title="Proposal settings unavailable" message="Please try again when service settings are available." />
        : !parentEnabled ? <InlineAlert title="Proposal requests unavailable" message="New proposal requests are currently turned off." />
          : !catalogueResolved ? catalogueError
            ? <InlineAlert title="Service unavailable" message={catalogueError} />
            : <Skeleton height={220} />
            : category ? (
              <>
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
                {category.intake_schema
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
              </>
            ) : <InlineAlert title="Service unavailable" message="This proposal category could not be resolved." />}
    </Screen>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { AddressEditorSheet } from '../../../components/AddressEditor';
import { BookingStepLayout } from '../../../components/market/BookingStepLayout';
import { PriceFooter } from '../../../components/market/PriceFooter';
import { skillLabel } from '../../../components/ProviderCard';
import { Avatar, Button, ErrorState, Header, InlineAlert, Screen, SegmentedControl, Skeleton, Text } from '../../../components/ui';
import { useT } from '../../../i18n';
import { fromSavedAddress } from '../../../lib/locationModel';
import { formatINR } from '../../../lib/money';
import { typicalRange } from '../../../lib/pricing';
import { isServiceBookingEnabled } from '../../../lib/assistant/prefill';
import { getBookingModeOptions } from '../../recurring/customerPresentation';
import { PackageBookingScreen } from '../packages/PackageBookingScreen';
import { hasSupportedRecurringFrequency } from '../packages/packageModel';
import { BookAddressPriceSections } from './BookAddressPriceSections';
import { BookIssueSection } from './BookIssueSection';
import { BookScheduleSection } from './BookScheduleSection';
import { getBookingStepKeys } from './model';
import type { BookScreenController } from './useBookScreenController';

export function BookScreenContent({ controller }: { controller: BookScreenController }) {
  const translate = useT();
  const {
    t, toast, location, setLocation, service, loadError, load, pricePreview, priceError,
    setPriceAttempt, packageId, recurringEnabled, featureFlags, description,
    editorOpen, setEditorOpen, travel, travelChecking, busy, blocker, submit, error, bookingEntry,
  } = controller;
  useEffect(() => {
    if (bookingEntry?.kind === 'proposal-request' && featureFlags.archetypes?.proposal === true) {
      router.replace({ pathname: bookingEntry.pathname, params: bookingEntry.params } as Href);
    }
  }, [bookingEntry, featureFlags.archetypes?.proposal]);
  const stepKeys = getBookingStepKeys(featureFlags.isOn('booking_steps'), recurringEnabled);
  const steps = stepKeys?.map((key) => translate(key)) ?? null;

  if (!service) {
    const loadingContent = loadError ? (
      <ErrorState message={loadError} onRetry={load} />
    ) : (
      <>
        <Skeleton height={72} radius={t.radii.lg} />
        <Skeleton height={180} radius={t.radii.lg} />
        <Skeleton height={140} radius={t.radii.lg} />
      </>
    );
    return (
      steps
        ? <BookingStepLayout title="Book" steps={steps} current={0} footer={null}>{loadingContent}</BookingStepLayout>
        : <Screen header={<Header title="Book" />}>{loadingContent}</Screen>
    );
  }

  const providerName = service.providers?.profiles?.full_name ?? 'Provider';
  if (bookingEntry?.kind === 'fixed-package' || bookingEntry?.kind === 'time-package') {
    return <PackageBookingScreen packageId={packageId} entry={bookingEntry} prefill={controller.prefill} />;
  }
  if (bookingEntry?.kind === 'proposal-request') {
    return (
      <Screen header={<Header title="Request proposals" />}>
        {featureFlags.archetypes?.proposal === true
          ? <Skeleton height={180} radius={t.radii.lg} />
          : <InlineAlert tone="warning" message="Proposal requests are not currently available." />}
      </Screen>
    );
  }
  if (bookingEntry?.kind === 'unavailable') {
    return (
      <Screen header={<Header title="Booking unavailable" />}>
        <InlineAlert tone="warning" message="This service does not have a supported booking destination." />
      </Screen>
    );
  }
  if (!pricePreview) {
    const loadingContent = priceError ? (
      <ErrorState message={priceError} onRetry={() => setPriceAttempt((attempt) => attempt + 1)} />
    ) : (
      <>
        <Skeleton height={72} radius={t.radii.lg} />
        <Skeleton height={180} radius={t.radii.lg} />
      </>
    );
    return (
      steps
        ? <BookingStepLayout title={`Book ${service.categories?.name ?? 'service'}`} steps={steps} current={0} footer={null}>{loadingContent}</BookingStepLayout>
        : <Screen header={<Header title={`Book ${service.categories?.name ?? 'service'}`} />}>{loadingContent}</Screen>
    );
  }
  const firstName = providerName.split(' ')[0] ?? providerName;
  const slug = service.categories?.slug;
  const recurrenceCategory = service.categories;
  const serviceArchetype = recurrenceCategory?.archetype;
  const bookingModeOptions = getBookingModeOptions(
    recurringEnabled && !!serviceArchetype && featureFlags.archetypes?.[serviceArchetype] === true,
    !!recurrenceCategory?.recurrence_allowed && hasSupportedRecurringFrequency(recurrenceCategory.allowed_frequencies),
    serviceArchetype,
  );
  const range = typicalRange(slug);
  const rating = Number(service.providers?.rating_avg ?? 0);
  const ratingCount = service.providers?.rating_count ?? 0;
  const familyEnabled = bookingEntry?.kind === 'inspect' && isServiceBookingEnabled(bookingEntry, featureFlags.archetypes);
  const travelAction = travel?.needs_approval
    ? controller.travelPending
      ? 'Waiting for provider'
      : controller.travelApproved
        ? `Pay ${formatINR(pricePreview.pay_now)} & book`
        : `Request availability${travel.quoted_fee ? ` (+${formatINR(travel.quoted_fee)})` : ''}`
    : `Pay ${formatINR(pricePreview.pay_now)} & book`;

  const title = `Book ${service.categories?.name ?? 'service'}`;
  const footer = !familyEnabled ? null : steps ? (
    <PriceFooter
      caption="To pay now"
      amountLabel={formatINR(pricePreview.pay_now)}
      cta={{
        title: travelChecking ? 'Checking travel…' : travelAction,
        onPress: () => void submit(),
        loading: busy || travelChecking,
        disabled: !!blocker || controller.travelPending,
        leftIcon: 'lock-closed',
        accessibilityHint: blocker ?? undefined,
      }}
      note={{
        text: blocker ?? `Free cancellation until ${firstName} accepts · full refund if no one does`,
        tone: blocker ? 'warningText' : 'muted',
      }}
    />
  ) : (
    <View style={{ gap: t.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
        <View>
          <Text variant="caption" color="muted">
            To pay now
          </Text>
          <Text variant="title2" tabular>
            {formatINR(pricePreview.pay_now)}
          </Text>
        </View>
        <Button
          title={travelChecking ? 'Checking travel…' : travelAction}
          onPress={() => void submit()}
          loading={busy || travelChecking}
          disabled={!!blocker || controller.travelPending}
          size="lg"
          leftIcon="lock-closed"
          style={{ flex: 1 }}
          accessibilityHint={blocker ?? undefined}
        />
      </View>
      <Text variant="caption" color={blocker ? 'warningText' : 'muted'} align="center">
        {blocker ?? `Free cancellation until ${firstName} accepts · full refund if no one does`}
      </Text>
    </View>
  );
  const content = (
    <>
      {!familyEnabled ? <InlineAlert tone="warning" message="Inspect bookings are not currently available. Existing bookings remain accessible from Bookings." /> : null}
      {controller.prefill.fromAssistant ? (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, padding: t.spacing.md, borderRadius: t.radii.md, backgroundColor: t.colors.primarySoft }}
        >
          <Ionicons name="sparkles" size={16} color={t.colors.primaryText} />
          <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
            Pre-filled by QuickServe AI. Check the details, then pay the visit fee to send the request.
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <Avatar name={providerName} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="calloutStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {providerName}
            </Text>
            <Ionicons name="checkmark-circle" size={16} color={t.colors.primary} accessibilityLabel="Verified" />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {ratingCount > 0 ? (
              <>
                <Ionicons name="star" size={13} color={t.colors.star} />
                <Text variant="footnoteStrong" tabular>
                  {rating.toFixed(1)}
                </Text>
                <Text variant="footnote" color="muted">
                  ({ratingCount}) ·
                </Text>
              </>
            ) : null}
            <Text variant="footnote" color="muted" numberOfLines={1}>
              {service.categories?.name} · {skillLabel[service.skill_level]}
            </Text>
          </View>
        </View>
      </View>

      {bookingModeOptions.length > 1 ? (
        <SegmentedControl
          options={bookingModeOptions.map((value) => ({
            value,
            label: value === 'one-time' ? 'One-time' : 'Repeat',
          }))}
          value="one-time"
          onChange={(value) => {
            if (value === 'repeat') {
              router.push({
                pathname: '/recurring/new/[providerServiceId]',
                params: {
                  providerServiceId: service.id,
                  archetype: serviceArchetype ?? 'time_based',
                  description: description.trim(),
                  addressId: location.addressId ?? '',
                },
              });
            }
          }}
          accessibilityLabel="Booking frequency"
        />
      ) : null}

      <BookIssueSection controller={controller} />
      <BookScheduleSection controller={controller} firstName={firstName} />
      <BookAddressPriceSections controller={controller} firstName={firstName} range={range} pricePreview={pricePreview} />
      <InlineAlert message={error} />
      {service?.providers?.paused ? (
        <InlineAlert tone="warning" title="On holiday" message="This provider is not taking new bookings. Choose another provider or come back later." />
      ) : !service?.providers?.is_online ? (
        <InlineAlert title="Provider is offline" message="You can choose a future time. ASAP starts only while the provider is online." />
      ) : null}
    </>
  );
  const bookingScreen = steps ? (
    <BookingStepLayout title={title} steps={steps} current={0} footer={footer}>
      {content}
    </BookingStepLayout>
  ) : (
    <Screen header={<Header title={title} />} gap={t.spacing.section} footer={footer}>
      {content}
    </Screen>
  );

  return (
    <>
      {bookingScreen}
      <AddressEditorSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        pin={location}
        title="Complete your address"
        onSaved={(a) => {
          setEditorOpen(false);
          setLocation(fromSavedAddress(a));
          toast({ message: 'Address saved', tone: 'success' });
        }}
      />
    </>
  );
}

import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { Button, Chip, InlineAlert, Input, Text, TextArea } from '../../components/ui';
import { onboardingApi } from '../../lib/onboarding';
import { parseRupees } from '../../lib/onboarding/validation';
import type { PackageDeliverable, PackagePriceType, PackageUnit, ServicePackage } from '../../lib/types';
import { useTheme } from '../../theme';
import { FieldLabel } from './parts';
import { packageHasContactHint } from './serviceEditor';

const PRICE_TYPES: { value: PackagePriceType; label: string }[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'range', label: 'Range' },
  { value: 'from', label: 'From' },
  { value: 'quote', label: 'Quote' },
];
const UNITS: PackageUnit[] = ['job', 'hour', 'day', 'session', 'person', 'plate', 'sqft', 'bhk', 'seat', 'litre', 'event', 'month'];

function moneyText(paise: number | null | undefined) {
  return paise == null ? '' : String(paise / 100);
}

function positiveInt(value: string, fallback: number | null = null) {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function csvLines(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ProviderPackageEditor({
  providerServiceId,
  servicePackage,
  onSaved,
  onCancel,
}: {
  providerServiceId: string;
  servicePackage?: ServicePackage;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const [title, setTitle] = useState(servicePackage?.title ?? '');
  const [description, setDescription] = useState(servicePackage?.description ?? '');
  const [priceType, setPriceType] = useState<PackagePriceType>(servicePackage?.price_type ?? 'fixed');
  const [priceMin, setPriceMin] = useState(moneyText(servicePackage?.price_min ?? servicePackage?.price));
  const [priceMax, setPriceMax] = useState(moneyText(servicePackage?.price_max));
  const [unit, setUnit] = useState<PackageUnit>(servicePackage?.unit ?? 'job');
  const [qtyMin, setQtyMin] = useState(String(servicePackage?.qty_min ?? 1));
  const [qtyMax, setQtyMax] = useState(String(servicePackage?.qty_max ?? 1));
  const [duration, setDuration] = useState(servicePackage?.duration_min == null ? '' : String(servicePackage.duration_min));
  const [turnaround, setTurnaround] = useState(servicePackage?.turnaround_days == null ? '' : String(servicePackage.turnaround_days));
  const [revisions, setRevisions] = useState(String(servicePackage?.revisions_included ?? 0));
  const [rawFiles, setRawFiles] = useState(servicePackage?.raw_files_included ?? false);
  const [active, setActive] = useState(servicePackage?.active ?? true);
  const [organicPosting, setOrganicPosting] = useState(servicePackage?.usage_rights.organic_posting ?? false);
  const [paidAdsDays, setPaidAdsDays] = useState(servicePackage?.usage_rights.paid_ads_days ?? 0);
  const [exclusivity, setExclusivity] = useState(String(servicePackage?.usage_rights.exclusivity_days ?? 0));
  const [travelKm, setTravelKm] = useState(String(servicePackage?.travel_included_km ?? 0));
  const [inclusions, setInclusions] = useState((servicePackage?.inclusions ?? []).join('\n'));
  const [exclusions, setExclusions] = useState((servicePackage?.exclusions ?? []).join('\n'));
  const [deliverables, setDeliverables] = useState<PackageDeliverable[]>(
    servicePackage?.deliverables.length ? servicePackage.deliverables.map((item) => ({ ...item })) : [{ type: '', qty: 1, spec: '' }],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateDeliverable = (index: number, patch: Partial<PackageDeliverable>) =>
    setDeliverables((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));

  const save = async () => {
    setError(null);
    const minPaise = parseRupees(priceMin);
    const maxPaise = parseRupees(priceMax);
    if (title.trim().length < 2) return setError('Add a package title.');
    if (priceType !== 'quote' && (minPaise == null || minPaise <= 0)) return setError('Enter a valid package price.');
    if (priceType === 'range' && (maxPaise == null || maxPaise <= minPaise!)) return setError('The range maximum must be higher than its minimum.');
    const minQty = Number(qtyMin);
    const maxQty = Number(qtyMax);
    if (!Number.isFinite(minQty) || !Number.isFinite(maxQty) || minQty <= 0 || maxQty < minQty) {
      return setError('Enter valid minimum and maximum quantities.');
    }
    const cleanedDeliverables = deliverables.filter((item) => item.type.trim() || item.spec.trim());
    if (cleanedDeliverables.length === 0 || cleanedDeliverables.some((item) => !item.type.trim() || !item.spec.trim() || item.qty <= 0)) {
      return setError('Each deliverable needs a type, quantity and specification.');
    }
    if (packageHasContactHint({
      title,
      description,
      inclusions: csvLines(inclusions),
      exclusions: csvLines(exclusions),
      deliverables: cleanedDeliverables,
    })) return setError('Do not add phone, email, WhatsApp, UPI or other contact details to a package.');

    const durationMin = positiveInt(duration);
    const turnaroundDays = positiveInt(turnaround);
    const revisionsIncluded = positiveInt(revisions, 0);
    const exclusivityDays = positiveInt(exclusivity, 0);
    const travelIncludedKm = positiveInt(travelKm, 0);
    if (
      (duration.trim() !== '' && (durationMin === null || durationMin <= 0)) ||
      (turnaround.trim() !== '' && turnaroundDays === null) ||
      revisionsIncluded === null ||
      exclusivityDays === null ||
      travelIncludedKm === null
    ) {
      return setError('Use whole, non-negative numbers for duration, turnaround, revisions, rights and travel.');
    }

    setSaving(true);
    try {
      await onboardingApi.saveServicePackage(servicePackage?.id ?? null, providerServiceId, {
        title: title.trim(),
        description: description.trim(),
        price_type: priceType,
        price: priceType === 'fixed' ? minPaise : null,
        price_min: priceType === 'quote' ? null : minPaise,
        price_max: priceType === 'range' ? maxPaise : priceType === 'fixed' ? minPaise : null,
        unit,
        qty_min: minQty,
        qty_max: maxQty,
        duration_min: durationMin,
        inclusions: csvLines(inclusions),
        exclusions: csvLines(exclusions),
        deliverables: cleanedDeliverables.map((item) => ({ type: item.type.trim(), qty: item.qty, spec: item.spec.trim() })),
        turnaround_days: turnaroundDays,
        revisions_included: revisionsIncluded!,
        raw_files_included: rawFiles,
        usage_rights: {
          organic_posting: organicPosting,
          paid_ads_days: paidAdsDays,
          exclusivity_days: exclusivityDays!,
        },
        travel_included_km: travelIncludedKm!,
        active,
        sort_order: servicePackage?.sort_order ?? 0,
      });
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: t.spacing.md, gap: t.spacing.md }}>
      <Text variant="title3">{servicePackage ? 'Edit package' : 'Add package'}</Text>
      <InlineAlert message={error} />
      <Input label="Package name" value={title} onChangeText={setTitle} maxLength={120} />
      <TextArea label="Description" value={description} onChangeText={setDescription} maxLength={1000} />

      <View style={{ gap: t.spacing.sm }}>
        <FieldLabel>Price type</FieldLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
          {PRICE_TYPES.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={priceType === option.value}
              onPress={() => {
                setPriceType(option.value);
                if (option.value !== 'range') setPriceMax('');
              }}
            />
          ))}
        </ScrollView>
        {priceType === 'quote' ? (
          <Text variant="footnote" color="muted">
            Shown as “Price on request”. A fixed proposal is required before any future payment.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <Input
              label={priceType === 'fixed' ? 'Price' : priceType === 'from' ? 'Starting price' : 'Minimum'}
              prefix="₹"
              keyboardType="decimal-pad"
              value={priceMin}
              onChangeText={(value) => setPriceMin(value.replace(/[^\d.]/g, ''))}
              containerStyle={{ flex: 1 }}
            />
            {priceType === 'range' ? (
              <Input
                label="Maximum"
                prefix="₹"
                keyboardType="decimal-pad"
                value={priceMax}
                onChangeText={(value) => setPriceMax(value.replace(/[^\d.]/g, ''))}
                containerStyle={{ flex: 1 }}
              />
            ) : null}
          </View>
        )}
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <FieldLabel>Pricing unit</FieldLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
          {UNITS.map((value) => (
            <Chip key={value} label={value} selected={unit === value} onPress={() => setUnit(value)} />
          ))}
        </ScrollView>
      </View>
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Input label="Minimum quantity" keyboardType="decimal-pad" value={qtyMin} onChangeText={setQtyMin} containerStyle={{ flex: 1 }} />
        <Input label="Maximum quantity" keyboardType="decimal-pad" value={qtyMax} onChangeText={setQtyMax} containerStyle={{ flex: 1 }} />
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="callout">Visible on profile</Text>
          <Switch value={active} onValueChange={setActive} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <FieldLabel hint="Shown verbatim on the package card.">Deliverables</FieldLabel>
          <Button
            title="Add"
            size="sm"
            variant="ghost"
            leftIcon="add"
            onPress={() => setDeliverables((current) => [...current, { type: '', qty: 1, spec: '' }])}
          />
        </View>
        {deliverables.map((item, index) => (
          <View key={index} style={{ gap: t.spacing.sm, borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radii.md, padding: t.spacing.md }}>
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Input
                label="Type"
                placeholder="e.g. edited reel"
                value={item.type}
                onChangeText={(value) => updateDeliverable(index, { type: value })}
                containerStyle={{ flex: 2 }}
              />
              <Input
                label="Qty"
                keyboardType="number-pad"
                value={String(item.qty)}
                onChangeText={(value) => updateDeliverable(index, { qty: Number(value.replace(/\D/g, '')) || 0 })}
                containerStyle={{ flex: 1 }}
              />
            </View>
            <Input
              label="Specification"
              placeholder="30-60 sec, 9:16, 1080p"
              value={item.spec}
              onChangeText={(value) => updateDeliverable(index, { spec: value })}
              maxLength={500}
            />
            {deliverables.length > 1 ? (
              <Button
                title="Remove deliverable"
                size="sm"
                variant="destructiveGhost"
                onPress={() => setDeliverables((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              />
            ) : null}
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Input label="Duration (minutes)" keyboardType="number-pad" value={duration} onChangeText={(value) => setDuration(value.replace(/\D/g, ''))} containerStyle={{ flex: 1 }} />
        <Input label="Turnaround (days)" keyboardType="number-pad" value={turnaround} onChangeText={(value) => setTurnaround(value.replace(/\D/g, ''))} containerStyle={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Input label="Revisions included" keyboardType="number-pad" value={revisions} onChangeText={(value) => setRevisions(value.replace(/\D/g, ''))} containerStyle={{ flex: 1 }} />
        <Input label="Travel included (km)" keyboardType="number-pad" value={travelKm} onChangeText={(value) => setTravelKm(value.replace(/\D/g, ''))} containerStyle={{ flex: 1 }} />
      </View>
      <TextArea label="Inclusions" helper="One per line or comma-separated." value={inclusions} onChangeText={setInclusions} maxLength={2000} />
      <TextArea label="Exclusions" helper="One per line or comma-separated." value={exclusions} onChangeText={setExclusions} maxLength={2000} />

      <View style={{ gap: t.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="callout">Raw files included</Text>
          <Switch value={rawFiles} onValueChange={setRawFiles} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="callout">Organic posting allowed</Text>
          <Switch value={organicPosting} onValueChange={setOrganicPosting} />
        </View>
        <FieldLabel>Paid-ad usage window</FieldLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
          {[0, 30, 90, 365].map((days) => (
            <Chip key={days} label={days ? `${days} days` : 'None'} selected={paidAdsDays === days} onPress={() => setPaidAdsDays(days)} />
          ))}
        </ScrollView>
        <Input
          label="Exclusivity (days)"
          keyboardType="number-pad"
          value={exclusivity}
          onChangeText={(value) => setExclusivity(value.replace(/\D/g, ''))}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Button title="Cancel" variant="outline" onPress={onCancel} style={{ flex: 1 }} />
        <Button title={servicePackage ? 'Save package' : 'Create package'} onPress={() => void save()} loading={saving} style={{ flex: 2 }} />
      </View>
    </View>
  );
}

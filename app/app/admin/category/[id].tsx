import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, TextArea, useToast } from '../../../src/components/ui';
import {
  adminUpsertCategory,
  listCategories,
  setCategoryCity,
  type AdminCategory,
  type AdminCategoryUpsert,
} from '../../../src/lib/adminApi';
import { useFeature } from '../../../src/lib/featureFlags';
import { useTheme } from '../../../src/theme';

type CategoryDraft = {
  slug: string;
  name: string;
  icon: string;
  vertical: string;
  parent_id: string;
  archetype: string;
  pricing_units: string;
  recurrence_allowed: boolean;
  allowed_frequencies: string;
  recurring_discount_bp: string;
  cancellation_policy: string;
  requires_docs: string;
  restricted: boolean;
  intake_schema: string;
};

const ARCHETYPES = [
  { value: '', label: 'Group' },
  { value: 'inspect_quote', label: 'Inspect & quote' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'time_based', label: 'Time-based' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'remote', label: 'Remote' },
];

function emptyDraft(): CategoryDraft {
  return {
    slug: '',
    name: '',
    icon: '',
    vertical: '',
    parent_id: '',
    archetype: '',
    pricing_units: '',
    recurrence_allowed: false,
    allowed_frequencies: '',
    recurring_discount_bp: '',
    cancellation_policy: '',
    requires_docs: '',
    restricted: false,
    intake_schema: '{}',
  };
}

function toDraft(category: AdminCategory): CategoryDraft {
  return {
    slug: category.slug,
    name: category.name,
    icon: category.icon,
    vertical: category.vertical,
    parent_id: category.parent_id ?? '',
    archetype: category.archetype ?? '',
    pricing_units: category.pricing_units.join(', '),
    recurrence_allowed: category.recurrence_allowed,
    allowed_frequencies: category.allowed_frequencies.join(', '),
    recurring_discount_bp: category.recurring_discount_bp == null ? '' : String(category.recurring_discount_bp),
    cancellation_policy: category.cancellation_policy,
    requires_docs: category.requires_docs.join(', '),
    restricted: category.restricted,
    intake_schema: JSON.stringify(category.intake_schema, null, 2),
  };
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function parseList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function wholeNumber(value: string, label: string, min: number, max: number): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${label} must be a whole number.`);
  const parsed = Number(value);
  if (parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return parsed;
}

function parseIntakeSchema(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Intake schema must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Intake schema must be a JSON object.');
  }
  const containsSensitiveField = (item: unknown): boolean => {
    if (Array.isArray(item)) return item.some(containsSensitiveField);
    if (!item || typeof item !== 'object') return false;
    return Object.entries(item).some(([key, child]) => /phone|address/i.test(key) || containsSensitiveField(child));
  };
  if (containsSensitiveField(parsed)) {
    throw new Error('Intake schema cannot collect phone numbers or addresses.');
  }
  return parsed as Record<string, unknown>;
}

function nextSortOrder(rows: AdminCategory[], parentId: string | null): number {
  const siblings = rows.filter((row) => row.parent_id === parentId);
  return siblings.length ? Math.max(...siblings.map((row) => row.sort_order)) + 10 : 0;
}

export default function AdminCategoryEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const toast = useToast();
  const canEditCategories = useFeature('admin_category_editor');
  const isNewRoute = id === 'new';
  const [rows, setRows] = useState<AdminCategory[] | null>(null);
  const [draft, setDraft] = useState<CategoryDraft | null>(isNewRoute ? emptyDraft() : null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [cityError, setCityError] = useState<string | null>(null);
  const [cityDraft, setCityDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingCity, setSavingCity] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    setRows(null);
    setCategoryId(isNewRoute ? null : id ?? null);
    setDraft(isNewRoute ? emptyDraft() : null);
    void listCategories()
      .then((categories) => {
        setRows(categories);
        if (isNewRoute) {
          return;
        }
        const category = categories.find((row) => row.id === id);
        if (category) {
          setCategoryId(category.id);
          setDraft(toDraft(category));
        } else {
          setDraft(null);
        }
      })
      .catch((error: Error) => setLoadError(error.message));
  }, [id, isNewRoute]);
  useEffect(() => {
    if (canEditCategories) load();
  }, [canEditCategories, load]);

  const category = useMemo(() => rows?.find((row) => row.id === categoryId) ?? null, [rows, categoryId]);
  const groups = useMemo(
    () => (rows ?? []).filter((row) => row.id !== categoryId && row.parent_id == null && row.archetype == null).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [rows, categoryId],
  );
  const policyKeys = useMemo(
    () => [...new Set((rows ?? []).map((row) => row.cancellation_policy).filter(Boolean))].sort(),
    [rows],
  );

  const backToServices = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/admin/services');
  };

  const update = <K extends keyof CategoryDraft>(key: K, value: CategoryDraft[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const saveCategory = async () => {
    if (!draft || !rows) return;
    setFormError(null);
    let payload: AdminCategoryUpsert;
    try {
      const name = required(draft.name, 'Name');
      const icon = required(draft.icon, 'Icon');
      const vertical = required(draft.vertical, 'Vertical');
      const cancellationPolicy = required(draft.cancellation_policy, 'Cancellation policy');
      const parentId = draft.archetype ? draft.parent_id || null : null;
      const pricingUnits = parseList(draft.pricing_units);
      if (pricingUnits.length === 0) throw new Error('Add at least one pricing unit.');
      const recurrenceSupported = draft.archetype === 'fixed' || draft.archetype === 'time_based';
      const recurrenceAllowed = recurrenceSupported && draft.recurrence_allowed;
      const parentChanged = category != null && category.parent_id !== parentId;
      const base = {
        name,
        icon,
        parent_id: parentId,
        vertical,
        archetype: draft.archetype || null,
        pricing_units: pricingUnits,
        recurrence_allowed: recurrenceAllowed,
        allowed_frequencies: recurrenceAllowed ? parseList(draft.allowed_frequencies) : [],
        recurring_discount_bp: recurrenceAllowed && draft.recurring_discount_bp.trim()
          ? wholeNumber(draft.recurring_discount_bp, 'Recurring discount (bp)', 0, 5000)
          : null,
        cancellation_policy: cancellationPolicy,
        requires_docs: parseList(draft.requires_docs),
        restricted: draft.restricted,
        sort_order: category && !parentChanged ? category.sort_order : nextSortOrder(rows, parentId),
        intake_schema: parseIntakeSchema(draft.intake_schema),
      };
      if (categoryId) {
        payload = { ...base, id: categoryId };
      } else {
        const slug = required(draft.slug, 'Slug');
        if (!/^[a-z0-9-]{3,60}$/.test(slug)) {
          throw new Error('Slug must be 3–60 lowercase letters, numbers, or hyphens.');
        }
        payload = { ...base, slug };
      }
    } catch (error) {
      setFormError((error as Error).message);
      return;
    }

    setSaving(true);
    try {
      const savedId = await adminUpsertCategory(payload);
      const savedCategory: AdminCategory = {
        ...(category ?? {}),
        ...payload,
        id: savedId,
        slug: category?.slug ?? draft.slug.trim(),
        active: category?.active ?? false,
        cities: category?.cities ?? [],
        providers: category?.providers ?? 0,
        bookings_30d: category?.bookings_30d ?? 0,
      };
      setCategoryId(savedId);
      setRows((current) => {
        const existing = current ?? [];
        return existing.some((row) => row.id === savedId)
          ? existing.map((row) => row.id === savedId ? savedCategory : row)
          : [...existing, savedCategory];
      });
      setDraft(toDraft(savedCategory));
      toast({ message: 'Category saved', tone: 'success' });
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addCity = async () => {
    if (!categoryId) return;
    const city = cityDraft.trim();
    if (city.length < 2) {
      setCityError('Enter a city name with at least 2 characters.');
      return;
    }
    setCityError(null);
    setSavingCity(city);
    try {
      await setCategoryCity(categoryId, city, true);
      setRows((current) => current?.map((row) => {
        if (row.id !== categoryId) return row;
        const found = row.cities.some((item) => item.city.toLowerCase() === city.toLowerCase());
        return {
          ...row,
          cities: found
            ? row.cities.map((item) => item.city.toLowerCase() === city.toLowerCase() ? { ...item, live: true } : item)
            : [...row.cities, { city, live: true }],
        };
      }) ?? null);
      setCityDraft('');
      toast({ message: `${city} is available`, tone: 'success' });
    } catch (error) {
      setCityError((error as Error).message);
    } finally {
      setSavingCity(null);
    }
  };

  const toggleCity = async (city: string, live: boolean) => {
    if (!categoryId) return;
    setCityError(null);
    setSavingCity(city);
    try {
      await setCategoryCity(categoryId, city, live);
      setRows((current) => current?.map((row) => row.id === categoryId
        ? { ...row, cities: row.cities.map((item) => item.city === city ? { ...item, live } : item) }
        : row) ?? null);
      toast({ message: `${city} availability updated`, tone: 'success' });
    } catch (error) {
      setCityError((error as Error).message);
    } finally {
      setSavingCity(null);
    }
  };

  if (!canEditCategories) {
    return (
      <Screen header={<Header title="Category editor" onBack={backToServices} />}>
        <EmptyState
          title="Category editor unavailable"
          message="Category editing is turned off. Existing services remain available."
          secondaryLabel="Back to services"
          onSecondary={backToServices}
          icon="construct-outline"
        />
      </Screen>
    );
  }
  if (loadError) {
    return <Screen header={<Header title="Category editor" onBack={backToServices} />}><ErrorState message={loadError} onRetry={load} /></Screen>;
  }
  if (!rows) {
    return <Screen header={<Header title="Category editor" onBack={backToServices} />}><Skeleton height={520} radius={t.radii.lg} /></Screen>;
  }
  if (!draft) {
    return (
      <Screen header={<Header title="Category editor" onBack={backToServices} />}>
        <EmptyState title="Category not found" message="This category may have been removed." actionLabel="Back to services" onAction={backToServices} icon="search-outline" />
      </Screen>
    );
  }

  return (
    <Screen header={<Header title={category ? 'Edit service' : categoryId ? 'Edit service' : 'New service'} subtitle={category?.name ?? undefined} onBack={backToServices} />}>
      <Card gap={t.spacing.md}>
        <Text variant="title3">Basics</Text>
        <Input label="Name" value={draft.name} onChangeText={(value) => update('name', value)} />
        <Input
          label="Slug"
          value={draft.slug}
          editable={!categoryId}
          helper={categoryId ? 'Slug cannot be changed after creation.' : '3–60 lowercase letters, numbers, or hyphens.'}
          onChangeText={(value) => update('slug', value)}
          autoCapitalize="none"
        />
        <Input label="Icon key" value={draft.icon} placeholder="construct-outline" onChangeText={(value) => update('icon', value)} autoCapitalize="none" />
        <Input label="Vertical" value={draft.vertical} placeholder="home-repairs" onChangeText={(value) => update('vertical', value)} autoCapitalize="none" />
        {draft.archetype ? (
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="subhead">Parent group</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
              <Button
                title="No parent"
                size="sm"
                variant={draft.parent_id ? 'outline' : 'secondary'}
                onPress={() => update('parent_id', '')}
              />
              {groups.map((group) => (
                <Button
                  key={group.id}
                  title={group.name}
                  size="sm"
                  variant={draft.parent_id === group.id ? 'secondary' : 'outline'}
                  onPress={() => update('parent_id', group.id)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </Card>

      <Card gap={t.spacing.md}>
        <Text variant="title3">Booking type</Text>
        <Text variant="subhead">Category type</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {ARCHETYPES.map((option) => (
            <Button
              key={option.value || 'group'}
              title={option.label}
              size="sm"
              variant={draft.archetype === option.value ? 'secondary' : 'outline'}
              onPress={() => setDraft((current) => current ? {
                ...current,
                archetype: option.value,
                parent_id: option.value ? current.parent_id : '',
              } : current)}
            />
          ))}
        </View>
        <Input
          label="Pricing units"
          value={draft.pricing_units}
          onChangeText={(value) => update('pricing_units', value)}
          helper="Comma-separated units, such as job, hour, visit, or piece."
          autoCapitalize="none"
        />
        <Input
          label="Cancellation policy key"
          value={draft.cancellation_policy}
          onChangeText={(value) => update('cancellation_policy', value)}
          helper={policyKeys.length ? `Existing keys: ${policyKeys.join(', ')}` : 'Enter an existing policy key.'}
          autoCapitalize="none"
        />
        <TextArea
          label="Intake schema (JSON object)"
          value={draft.intake_schema}
          onChangeText={(value) => update('intake_schema', value)}
          helper="Use safe service-intake fields only; do not include phone numbers or addresses."
          autoCapitalize="none"
          autoCorrect={false}
          showCount={false}
        />
      </Card>

      {draft.archetype === 'fixed' || draft.archetype === 'time_based' ? (
        <Card gap={t.spacing.md}>
          <Text variant="title3">Recurring</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">Allow recurring bookings</Text>
              <Text variant="caption" color="muted">The server enforces the category and global recurrence rules.</Text>
            </View>
            <Switch
              accessibilityLabel="Allow recurring bookings"
              value={draft.recurrence_allowed}
              onValueChange={(value) => update('recurrence_allowed', value)}
            />
          </View>
          {draft.recurrence_allowed ? (
            <>
              <Input
                label="Allowed frequencies"
                value={draft.allowed_frequencies}
                onChangeText={(value) => update('allowed_frequencies', value)}
                helper="Comma-separated; values must be in the global recurring rules."
                autoCapitalize="none"
              />
              <Input
                label="Recurring discount (bp)"
                keyboardType="number-pad"
                value={draft.recurring_discount_bp}
                onChangeText={(value) => update('recurring_discount_bp', value)}
                helper="Leave blank to use the global rule default; maximum 5000 bp."
              />
            </>
          ) : null}
        </Card>
      ) : null}

      <Card gap={t.spacing.md}>
        <Text variant="title3">Verification</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">Restricted category</Text>
            <Text variant="caption" color="muted">Restricted categories need required verification documents before activation.</Text>
          </View>
          <Switch
            accessibilityLabel="Restricted category"
            value={draft.restricted}
            onValueChange={(value) => update('restricted', value)}
          />
        </View>
        <Input
          label="Required documents"
          value={draft.requires_docs}
          onChangeText={(value) => update('requires_docs', value)}
          helper="Comma-separated document keys."
          autoCapitalize="none"
        />
      </Card>

      <Card gap={t.spacing.md}>
        <Text variant="title3">Cities</Text>
        {categoryId ? (
          <>
            <Input
              label="Add city"
              value={cityDraft}
              onChangeText={setCityDraft}
              placeholder="City name"
              autoCapitalize="words"
            />
            <Button
              title="Add city as live"
              size="sm"
              variant="outline"
              disabled={savingCity !== null}
              loading={savingCity === cityDraft.trim()}
              onPress={() => void addCity()}
            />
            {category?.cities.length ? category.cities.map((city) => (
              <View key={city.city} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.md }}>
                <Text variant="footnote">{city.city}</Text>
                <Switch
                  accessibilityLabel={`${city.city} availability`}
                  value={city.live}
                  disabled={savingCity === city.city}
                  onValueChange={(live) => void toggleCity(city.city, live)}
                />
              </View>
            )) : <EmptyState compact title="No city availability configured" icon="location-outline" />}
          </>
        ) : (
          <Text variant="footnote" color="muted">Save the category first, then add its city availability.</Text>
        )}
        <InlineAlert message={cityError} />
      </Card>

      <InlineAlert message={formError} />
      <Button title="Save category" loading={saving} onPress={() => void saveCategory()} />
    </Screen>
  );
}

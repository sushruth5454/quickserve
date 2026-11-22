import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, ErrorState, Header, InlineAlert, Input, Screen, Text, TextArea, useToast } from '../../components/ui';
import { SpecFields } from '../shops/SpecFields';
import { listProductCategories, type ProductCategory } from '../shops/api';
import { cleanSpecs } from '../shops/specs';
import { createRfq, type NewRfqItem, type RfqUnit } from '../rfq/api';
import { RfqFeatureUnavailable, useRfqFeatureFlags } from '../rfq/components';
import { useSelectedLocation } from '../../lib/locationContext';
import { useTheme } from '../../theme';

type ItemDraft = {
  key: string;
  description: string;
  brand: string;
  quantity: string;
  unit: RfqUnit;
  specs: Record<string, string>;
};

const units: RfqUnit[] = ['piece', 'sqft', 'box', 'kg', 'litre', 'bag', 'metre', 'set'];
const newItem = (): ItemDraft => ({
  key: `${Date.now()}-${Math.random()}`,
  description: '',
  brand: '',
  quantity: '',
  unit: 'piece',
  specs: {},
});

function defaultNeededBy(days = 7) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function RfqNewScreen() {
  const t = useTheme();
  const toast = useToast();
  const { rfq: enabled } = useRfqFeatureFlags();
  const { location, ready } = useSelectedLocation();
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([newItem()]);
  const [needsDelivery, setNeedsDelivery] = useState(true);
  const [neededBy, setNeededBy] = useState(defaultNeededBy);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [categoriesCurrent, setCategoriesCurrent] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadCategories = useCallback(async () => {
    if (!enabled) return;
    setLoadingCategories(true);
    setCategoriesCurrent(false);
    setError(null);
    try {
      const next = await listProductCategories();
      setCategories(next);
      setCategoryId((current) => next.some((category) => category.id === current) ? current : next[0]?.id || '');
      setError(null);
      setCategoriesCurrent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingCategories(false);
    }
  }, [enabled]);

  useEffect(() => { void loadCategories(); }, [loadCategories]);

  const selectedCategory = useMemo(() => categories.find((category) => category.id === categoryId), [categories, categoryId]);
  const updateItem = (key: string, patch: Partial<ItemDraft>) => {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  };
  const selectCategory = (id: string) => {
    setCategoryId(id);
    setItems((current) => current.map((item) => ({ ...item, specs: {} })));
  };

  const submit = async () => {
    if (!categoryId || !ready || !categoriesCurrent || loadingCategories) return;
    setSaving(true);
    setError(null);
    try {
      const requestItems: NewRfqItem[] = items.map((item) => {
        const quantity = Number(item.quantity);
        if (!item.description.trim() || !Number.isFinite(quantity) || quantity <= 0) {
          throw new Error('Add a description and a quantity greater than zero for every item.');
        }
        return {
          description: item.description.trim(),
          brand_pref: item.brand.trim(),
          specs: cleanSpecs(item.specs),
          quantity,
          unit: item.unit,
        };
      });
      const id = await createRfq({
        categoryId,
        title,
        items: requestItems,
        city: location.city,
        area: location.area,
        lat: location.lat,
        lng: location.lng,
        needsDelivery,
        neededBy,
        notes,
      });
      toast({ message: 'Your request was sent to nearby verified shops.', tone: 'success' });
      router.replace(`/rfq/${id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!enabled) {
    return <Screen header={<Header title="Request product quotes" />}><RfqFeatureUnavailable /></Screen>;
  }

  return (
    <Screen
      header={<Header title="Request product quotes" subtitle="One request, up to 10 nearby shops" />}
      gap={t.spacing.md}
      footer={
        <View style={{ gap: t.spacing.sm }}>
          <InlineAlert message={categoriesCurrent ? error : null} />
          <Button
            title="Send request"
            fullWidth
            loading={saving}
            disabled={!categoryId || !ready || !categoriesCurrent || loadingCategories || !items.length || items.length > 20}
            onPress={() => void submit()}
          />
        </View>
      }
    >
      <Text variant="caption" color="muted">
        Shops are routed by category and distance. Each supplier decides independently which items they can quote.
      </Text>
      <Text variant="subheadStrong">Product category</Text>
      {loadingCategories ? <Text color="muted">Loading categories…</Text> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
          {categories.map((category) => (
            <Chip key={category.id} label={category.name} selected={category.id === categoryId} onPress={() => selectCategory(category.id)} />
          ))}
        </View>
      )}
      {error && !categoriesCurrent ? <ErrorState message={error} onRetry={() => void loadCategories()} /> : null}
      {error && categoriesCurrent ? <InlineAlert message={error} actionLabel="Retry" onAction={() => void loadCategories()} /> : null}
      {!loadingCategories && categoriesCurrent && !categories.length ? <Text color="muted">No product categories are available.</Text> : null}
      <Input
        label="Request title"
        placeholder="e.g. Floor tiles for 2BHK"
        value={title}
        onChangeText={setTitle}
        maxLength={120}
      />
      <Text variant="subheadStrong">Items ({items.length}/20)</Text>
      {items.map((item, index) => (
        <View key={item.key} style={{ gap: t.spacing.sm, paddingVertical: t.spacing.sm }}>
          <Text variant="captionStrong" color="muted">Item {index + 1}</Text>
          <Input
            label="Description"
            placeholder="For example, anti-skid floor tiles"
            value={item.description}
            onChangeText={(value) => updateItem(item.key, { description: value })}
            maxLength={500}
          />
          <Input
            label="Preferred brand (optional)"
            value={item.brand}
            onChangeText={(value) => updateItem(item.key, { brand: value })}
            maxLength={80}
          />
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <Input
              label="Quantity"
              value={item.quantity}
              onChangeText={(value) => updateItem(item.key, { quantity: value })}
              keyboardType="decimal-pad"
              containerStyle={{ flex: 1 }}
            />
            <View style={{ flex: 1, gap: t.spacing.xs }}>
              <Text variant="subhead" color="textSecondary">Unit</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
                {units.map((unit) => (
                  <Chip key={unit} label={unit} selected={item.unit === unit} onPress={() => updateItem(item.key, { unit })} />
                ))}
              </View>
            </View>
          </View>
          <SpecFields
            schema={selectedCategory?.attribute_schema ?? { properties: {} }}
            value={item.specs}
            onChange={(value) => updateItem(item.key, { specs: value })}
          />
          {items.length > 1 ? (
            <Button title="Remove item" size="sm" variant="ghost" onPress={() => setItems((current) => current.filter((entry) => entry.key !== item.key))} />
          ) : null}
        </View>
      ))}
      <Button title="Add item" variant="outline" disabled={items.length >= 20} onPress={() => setItems((current) => [...current, newItem()])} />
      <View style={{ gap: t.spacing.xs }}>
        <Text variant="subheadStrong">Needed by</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
          <Chip label="In 3 days" selected={neededBy === defaultNeededBy(3)} onPress={() => setNeededBy(defaultNeededBy(3))} />
          <Chip label="In 1 week" selected={neededBy === defaultNeededBy(7)} onPress={() => setNeededBy(defaultNeededBy(7))} />
          <Chip label="In 2 weeks" selected={neededBy === defaultNeededBy(14)} onPress={() => setNeededBy(defaultNeededBy(14))} />
          <Chip label="In 1 month" selected={neededBy === defaultNeededBy(30)} onPress={() => setNeededBy(defaultNeededBy(30))} />
        </View>
        <Text variant="caption" color="muted">
          Needed by {new Date(`${neededBy}T00:00:00`).toLocaleDateString()}
        </Text>
      </View>
      <View style={{ gap: t.spacing.xs }}>
        <Text variant="subheadStrong">Delivery</Text>
        <View style={{ flexDirection: 'row', gap: t.spacing.xs }}>
          <Chip label="Delivery needed" selected={needsDelivery} onPress={() => setNeedsDelivery(true)} />
          <Chip label="Pickup is okay" selected={!needsDelivery} onPress={() => setNeedsDelivery(false)} />
        </View>
        <Text color="muted">{location.area}, {location.city}</Text>
        <Button
          title="Change location"
          size="sm"
          variant="ghost"
          onPress={() => router.push('/location')}
        />
      </View>
      <Input label="Notes for suppliers (optional)" value={notes} onChangeText={setNotes} maxLength={2000} multiline />
      {selectedCategory ? <Text variant="caption" color="muted">Category: {selectedCategory.name}. No product matching or equivalence is assumed.</Text> : null}
    </Screen>
  );
}

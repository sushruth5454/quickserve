import { View } from 'react-native';
import { Button, Card, Chip, Input, ListItem, Text, TextArea } from '../../../components/ui';
import type { PlaceResult } from '../../../lib/locationContext';
import { useTheme } from '../../../theme';
import type { ProductCategory, ShopProfile } from '../api';

export type ShopDraft = Omit<ShopProfile, 'id' | 'owner_id' | 'business_role' | 'status' | 'status_reason'>;

export type ShopDetailsSectionProps = {
  shop: ShopProfile | null;
  draft: ShopDraft;
  categories: ProductCategory[];
  addressQuery: string;
  placeResults: PlaceResult[];
  collapsed: boolean;
  collapsible: boolean;
  readsCurrent: boolean;
  canSaveDetails: boolean;
  busy: boolean;
  onToggle: () => void;
  onUpdateShop: <K extends keyof ShopDraft>(key: K, value: ShopDraft[K]) => void;
  onAddressQueryChange: (value: string) => void;
  onChoosePlace: (result: PlaceResult) => void;
  onSave: () => void;
};

export default function ShopDetailsSection({
  shop,
  draft,
  categories,
  addressQuery,
  placeResults,
  collapsed,
  collapsible,
  readsCurrent,
  canSaveDetails,
  busy,
  onToggle,
  onUpdateShop,
  onAddressQueryChange,
  onChoosePlace,
  onSave,
}: ShopDetailsSectionProps) {
  const t = useTheme();
  const title = shop ? 'Shop details' : 'Set up your shop';

  if (shop && collapsed) {
    return (
      <Card gap={t.spacing.md}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
          <View style={{ flex: 1, gap: t.spacing.xs }}>
            <Text variant="title3">{title}</Text>
            <Text variant="caption" color="muted">Name, address, categories and fulfilment details</Text>
          </View>
          <Button title="Edit shop details" variant="outline" onPress={onToggle} />
        </View>
      </Card>
    );
  }

  return (
    <Card gap={t.spacing.md}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <Text variant="title3">{title}</Text>
        {shop && collapsible ? <Button title="Hide shop details" variant="ghost" onPress={onToggle} /> : null}
      </View>
      <Input label="Shop name" value={draft.name} onChangeText={(value) => onUpdateShop('name', value)} maxLength={100} />
      <TextArea label="Description" value={draft.description} onChangeText={(value) => onUpdateShop('description', value)} maxLength={1500} placeholder="What does your shop specialise in?" />
      <Input label="Find shop address" value={addressQuery} onChangeText={onAddressQueryChange} placeholder="Search a shop, street or landmark" />
      {placeResults.map((result, index) => (
        <ListItem key={`${result.title}-${index}`} title={result.title} subtitle={result.subtitle} chevron onPress={() => onChoosePlace(result)} />
      ))}
      <Input label="Address line" value={draft.address_line} onChangeText={(value) => onUpdateShop('address_line', value)} maxLength={220} />
      <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
        <View style={{ flex: 1 }}><Input label="City" value={draft.city} onChangeText={(value) => onUpdateShop('city', value)} maxLength={100} /></View>
        <View style={{ flex: 1 }}><Input label="Area" value={draft.area} onChangeText={(value) => onUpdateShop('area', value)} maxLength={100} /></View>
      </View>
      <Input label="GSTIN (optional)" value={draft.gstin ?? ''} onChangeText={(value) => onUpdateShop('gstin', value.trim().toUpperCase() || null)} autoCapitalize="characters" maxLength={15} />
      <Text variant="calloutStrong">Product categories</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
        {categories.map((category) => {
          const selected = draft.category_slugs.includes(category.slug);
          return (
            <Chip
              key={category.id}
              label={category.name}
              selected={selected}
              onPress={() => onUpdateShop(
                'category_slugs',
                selected
                  ? draft.category_slugs.filter((slug) => slug !== category.slug)
                  : [...draft.category_slugs, category.slug],
              )}
            />
          );
        })}
      </View>
      <Input
        label="Delivery radius (km)"
        value={String(draft.delivery_radius_km)}
        onChangeText={(value) => onUpdateShop('delivery_radius_km', Number(value) || 0)}
        keyboardType="number-pad"
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
        <Chip label="Offers delivery" selected={draft.offers_delivery} onPress={() => onUpdateShop('offers_delivery', !draft.offers_delivery)} />
        <Chip label="Pickup available" selected={draft.offers_pickup} onPress={() => onUpdateShop('offers_pickup', !draft.offers_pickup)} />
      </View>
      <Button title="Save shop details" loading={busy} disabled={!readsCurrent || !canSaveDetails} onPress={onSave} />
    </Card>
  );
}

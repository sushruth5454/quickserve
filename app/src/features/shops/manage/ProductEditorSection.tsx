import { Image } from 'expo-image';
import { View } from 'react-native';
import { Button, Card, Chip, Input, ListItem, Text, TextArea } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { ProductCategory, ProductPhoto, ProductUnit, ShopProduct } from '../api';
import { IndicativePrice } from '../components';
import { UNIT_LABELS } from '../format';
import { SpecFields } from '../SpecFields';

export type ProductDraft = {
  id: string | null;
  categoryId: string;
  name: string;
  brand: string;
  model: string;
  description: string;
  specs: Record<string, string>;
  unit: ProductUnit;
  priceText: string;
  inStock: boolean;
  active: boolean;
  existingPaths: string[];
  previousPaths: string[];
  newPhotos: ProductPhoto[];
};

export type ProductEditorSectionProps = {
  products: ShopProduct[];
  productImages: Record<string, string | null>;
  productDraft: ProductDraft | null;
  categories: ProductCategory[];
  selectedCategorySlugs: string[];
  loading: boolean;
  readsCurrent: boolean;
  canEditProducts: boolean;
  busy: boolean;
  onOpenEnquiries: () => void;
  onOpenSupplierRfqs: () => void;
  onEditProduct: (product?: ShopProduct) => void;
  onUpdateProduct: <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => void;
  onSelectCategory: (categoryId: string) => void;
  onAddPhoto: () => void;
  onSaveProduct: () => void;
  onCancelProduct: () => void;
  onRemoveProduct: (product: ShopProduct) => void;
};

const UNITS: ProductUnit[] = ['piece', 'sqft', 'box', 'kg', 'litre', 'bag', 'metre', 'set'];

export default function ProductEditorSection({
  products,
  productImages,
  productDraft,
  categories,
  selectedCategorySlugs,
  loading,
  readsCurrent,
  canEditProducts,
  busy,
  onOpenEnquiries,
  onOpenSupplierRfqs,
  onEditProduct,
  onUpdateProduct,
  onSelectCategory,
  onAddPhoto,
  onSaveProduct,
  onCancelProduct,
  onRemoveProduct,
}: ProductEditorSectionProps) {
  const t = useTheme();

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="title3">Product catalogue ({products.length}/500)</Text>
        <Button title="Add product" size="sm" disabled={!readsCurrent || !canEditProducts || products.length >= 500} onPress={() => onEditProduct()} />
      </View>
      <Button title="Open enquiries" variant="outline" onPress={onOpenEnquiries} />
      <Button title="Open supplier RFQs" variant="outline" onPress={onOpenSupplierRfqs} />

      {productDraft && canEditProducts ? (
        <Card gap={t.spacing.md}>
          <Text variant="title3">{productDraft.id ? 'Edit product' : 'New product'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {categories.filter((category) => selectedCategorySlugs.includes(category.slug)).map((category) => (
              <Chip
                key={category.id}
                label={category.name}
                selected={productDraft.categoryId === category.id}
                onPress={() => onSelectCategory(category.id)}
              />
            ))}
          </View>
          <Input label="Product name" value={productDraft.name} onChangeText={(value) => onUpdateProduct('name', value)} maxLength={120} />
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <View style={{ flex: 1 }}><Input label="Brand" value={productDraft.brand} onChangeText={(value) => onUpdateProduct('brand', value)} maxLength={80} /></View>
            <View style={{ flex: 1 }}><Input label="Model" value={productDraft.model} onChangeText={(value) => onUpdateProduct('model', value)} maxLength={80} /></View>
          </View>
          <TextArea label="Description" value={productDraft.description} onChangeText={(value) => onUpdateProduct('description', value)} maxLength={2000} />
          <SpecFields
            schema={categories.find((category) => category.id === productDraft.categoryId)?.attribute_schema ?? { properties: {} }}
            value={productDraft.specs}
            onChange={(value) => onUpdateProduct('specs', value)}
          />
          <Text variant="calloutStrong">Unit</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {UNITS.map((unit) => <Chip key={unit} label={unit} selected={productDraft.unit === unit} onPress={() => onUpdateProduct('unit', unit)} />)}
          </View>
          <Input label={`Indicative price per ${UNIT_LABELS[productDraft.unit]} (₹, optional)`} value={productDraft.priceText} onChangeText={(value) => onUpdateProduct('priceText', value)} keyboardType="decimal-pad" placeholder="Leave blank if not set" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            <Chip label="In stock" selected={productDraft.inStock} onPress={() => onUpdateProduct('inStock', !productDraft.inStock)} />
            <Chip label="Visible in catalogue" selected={productDraft.active} onPress={() => onUpdateProduct('active', !productDraft.active)} />
          </View>
          <Text variant="footnote" color="muted">{productDraft.existingPaths.length + productDraft.newPhotos.length}/6 product photos</Text>
          {productDraft.existingPaths.map((path, index) => (
            <ListItem
              key={path}
              title={`Saved photo ${index + 1}`}
              subtitle={path.split('/').pop()}
              right={<Button title="Remove" size="sm" variant="ghost" onPress={() => onUpdateProduct('existingPaths', productDraft.existingPaths.filter((item) => item !== path))} />}
            />
          ))}
          {productDraft.newPhotos.map((_, index) => <Text key={index} variant="caption" color="muted">{`New photo ${index + 1}`}</Text>)}
          <Button title="Add photo" variant="outline" disabled={productDraft.existingPaths.length + productDraft.newPhotos.length >= 6} onPress={onAddPhoto} />
          <Button title="Save product" loading={busy} onPress={onSaveProduct} disabled={!readsCurrent || !canEditProducts || !productDraft.categoryId} />
          <Button title="Cancel" variant="ghost" onPress={onCancelProduct} />
        </Card>
      ) : null}

      {products.map((product) => (
        <Card key={product.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          {productImages[product.id] ? <Image source={{ uri: productImages[product.id] ?? undefined }} style={{ width: 58, height: 58, borderRadius: t.radii.sm, backgroundColor: t.colors.surfaceAlt }} contentFit="cover" /> : null}
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="calloutStrong">{product.name}</Text>
            <Text variant="caption" color="muted">{product.category_name} · {product.active ? 'Listed' : 'Paused'} · {product.in_stock ? 'In stock' : 'Out of stock'}</Text>
            <IndicativePrice pricePaise={product.indicative_price_paise} unit={product.unit} updatedAt={product.price_updated_at} />
          </View>
          <View style={{ gap: t.spacing.xs }}>
            <Button title="Edit" size="sm" variant="outline" disabled={!readsCurrent || !canEditProducts} onPress={() => onEditProduct(product)} />
            <Button title="Remove" size="sm" variant="ghost" loading={busy} disabled={!readsCurrent} onPress={() => onRemoveProduct(product)} />
          </View>
        </Card>
      ))}
      {!products.length && !loading ? <Text variant="footnote" color="muted">No catalogue items yet. Add your first product after saving the shop.</Text> : null}
    </>
  );
}

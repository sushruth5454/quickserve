import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, ErrorState, Header, InlineAlert, Input, ListItem, Screen, Skeleton, Text, TextArea, useConfirm, useToast } from '../../components/ui';
import { pickPhoto } from '../providerOnboarding/media';
import {
  deleteProduct,
  getMyShop,
  listMyProducts,
  listProductCategories,
  saveProduct,
  saveShop,
  signedProductImage,
  submitShop,
  type ProductCategory,
  type ProductPhoto,
  type ProductUnit,
  type ShopProfile,
  type ShopProduct,
} from '../shops/api';
import { IndicativePrice, ShopStatusLabel, useShopFeatureFlags } from '../shops/components';
import { SpecFields } from '../shops/SpecFields';
import { UNIT_LABELS } from '../shops/format';
import { cleanSpecs } from '../shops/specs';
import { useSelectedLocation, resolvePlace, searchPlaces, type PlaceResult } from '../../lib/locationContext';
import { newPlacesSession } from '../../lib/places';
import { parseRupees } from '../../lib/onboarding/validation';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useRfqFeatureFlags } from '../rfq/components';
import { useTheme } from '../../theme';

type ShopDraft = Omit<ShopProfile, 'id' | 'owner_id' | 'business_role' | 'status' | 'status_reason'>;
type ProductDraft = {
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

const emptyShop = (): ShopDraft => ({
  name: '',
  description: '',
  address_line: '',
  city: '',
  area: '',
  lat: null,
  lng: null,
  delivery_radius_km: 10,
  offers_delivery: false,
  offers_pickup: true,
  whatsapp_contact: false,
  gstin: null,
  category_slugs: [],
});

const emptyProduct = (categoryId = ''): ProductDraft => ({
  id: null,
  categoryId,
  name: '',
  brand: '',
  model: '',
  description: '',
  specs: {},
  unit: 'piece',
  priceText: '',
  inStock: true,
  active: true,
  existingPaths: [],
  previousPaths: [],
  newPhotos: [],
});

const UNITS: ProductUnit[] = ['piece', 'sqft', 'box', 'kg', 'litre', 'bag', 'metre', 'set'];

export function getShopManagementLinks(
  role: ShopProfile['business_role'],
  capabilities: { merchantStaff: boolean; rfq: boolean },
) {
  return {
    staffManagement: role === 'owner' && capabilities.merchantStaff,
    supplierRfqs: role !== 'owner' && capabilities.rfq,
  };
}

export default function MerchantShopScreen() {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const features = useShopFeatureFlags();
  const appFeatures = useAppFeatureFlags();
  const { rfq: rfqEnabled } = useRfqFeatureFlags();
  const { location } = useSelectedLocation();
  const sessionRef = useRef(newPlacesSession());
  const [shop, setShop] = useState<ShopProfile | null>(null);
  const [draft, setDraft] = useState<ShopDraft>(emptyShop());
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [productImages, setProductImages] = useState<Record<string, string | null>>({});
  const [addressQuery, setAddressQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasRead, setHasRead] = useState(false);
  const readsCurrent = hasRead && !loading && !error;

  const load = useCallback(async (): Promise<ShopProfile | null> => {
    setLoading(true);
    setError(null);
    setActionError(null);
    try {
      const [nextShop, nextCategories] = await Promise.all([
        getMyShop(),
        features.products ? listProductCategories() : Promise.resolve([]),
      ]);
      setCategories(nextCategories);
      setShop(nextShop);
      if (nextShop) {
        setDraft({
          name: nextShop.name,
          description: nextShop.description,
          address_line: nextShop.address_line,
          city: nextShop.city,
          area: nextShop.area,
          lat: nextShop.lat,
          lng: nextShop.lng,
          delivery_radius_km: nextShop.delivery_radius_km,
          offers_delivery: nextShop.offers_delivery,
          offers_pickup: nextShop.offers_pickup,
          whatsapp_contact: nextShop.whatsapp_contact,
          gstin: nextShop.gstin,
          category_slugs: nextShop.category_slugs,
        });
        const nextProducts = nextShop.business_role === 'owner' ? await listMyProducts() : [];
        setProducts(nextProducts);
        const nextImages = await Promise.all(nextProducts.map(async (product) => [
          product.id,
          await signedProductImage(product.image_paths[0]).catch(() => null),
        ] as const));
        setProductImages(Object.fromEntries(nextImages));
      } else {
        setDraft(emptyShop());
        setProducts([]);
        setProductImages({});
      }
      setError(null);
      setHasRead(true);
      return nextShop;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [features.products]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (addressQuery.trim().length < 3) {
      setPlaceResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void searchPlaces(addressQuery, null, {
        sessionToken: sessionRef.current,
        near: { lat: location.lat, lng: location.lng },
      }).then((results) => active && setPlaceResults(results))
        .catch((e: Error) => active && setActionError(e.message));
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [addressQuery, location.lat, location.lng]);

  const updateShop = <K extends keyof ShopDraft>(key: K, value: ShopDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const updateProduct = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    setProductDraft((current) => current ? { ...current, [key]: value } : current);

  const choosePlace = async (result: PlaceResult) => {
    setBusy(true);
    try {
      const place = await resolvePlace(result, sessionRef.current);
      updateShop('address_line', place.line1 ?? result.title);
      updateShop('city', place.city);
      updateShop('area', place.area);
      updateShop('lat', place.lat);
      updateShop('lng', place.lng);
      setAddressQuery(place.line1 ?? result.title);
      setPlaceResults([]);
      sessionRef.current = newPlacesSession();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveShopDetails = async () => {
    if (!readsCurrent) return;
    const identityChanged = shop?.status === 'verified' && (
      draft.name !== shop.name
      || draft.address_line !== shop.address_line
      || draft.city !== shop.city
      || draft.area !== shop.area
      || draft.lat !== shop.lat
      || draft.lng !== shop.lng
      || draft.gstin !== shop.gstin
    );
    if (identityChanged && !await confirm({
      title: 'Send your shop for re-verification?',
      message: 'Changing name, address or GSTIN sends your shop for re-verification. Your shop stays hidden until approved. Continue?',
      confirmLabel: 'Continue',
      cancelLabel: 'Cancel',
    })) return;

    setBusy(true);
    setActionError(null);
    try {
      await saveShop(draft);
      const savedShop = await load();
      toast({
        message: savedShop?.status === 'submitted' ? 'Shop details saved. Sent for re-verification.' : 'Shop details saved',
        tone: 'success',
      });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitForReview = async () => {
    if (!shop || !readsCurrent) return;
    setBusy(true);
    try {
      await submitShop(shop.id);
      await load();
      toast({ message: 'Shop submitted for verification', tone: 'success' });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const editProduct = (product?: ShopProduct) => {
    if (!product) {
      const firstShopCategory = categories.find((category) => draft.category_slugs.includes(category.slug));
      setProductDraft(emptyProduct(firstShopCategory?.id));
      return;
    }
    setProductDraft({
      id: product.id,
      categoryId: product.category_id,
      name: product.name,
      brand: product.brand,
      model: product.model,
      description: product.description,
      specs: Object.fromEntries(Object.entries(product.specs ?? {}).map(([key, value]) => [key, String(value)])),
      unit: product.unit,
      priceText: product.indicative_price_paise == null ? '' : (product.indicative_price_paise / 100).toFixed(2),
      inStock: product.in_stock,
      active: product.active,
      existingPaths: product.image_paths,
      previousPaths: product.image_paths,
      newPhotos: [],
    });
  };

  const addProductPhoto = async () => {
    if (!productDraft || productDraft.existingPaths.length + productDraft.newPhotos.length >= 6) {
      setActionError('A product can have at most 6 images.');
      return;
    }
    try {
      const photo = await pickPhoto('portfolio', 'library');
      if (photo) updateProduct('newPhotos', [...productDraft.newPhotos, photo]);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const saveProductDraft = async () => {
    if (!shop || !productDraft || !readsCurrent) return;
    const shopDraft = draft;
    const price = productDraft.priceText.trim() ? parseRupees(productDraft.priceText) : null;
    if (productDraft.priceText.trim() && (price == null || price < 0)) {
      setActionError('Enter a valid indicative price in rupees.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await saveProduct({
        shopId: shop.id,
        productId: productDraft.id,
        categoryId: productDraft.categoryId,
        name: productDraft.name,
        brand: productDraft.brand,
        model: productDraft.model,
        description: productDraft.description,
        specs: cleanSpecs(productDraft.specs),
        unit: productDraft.unit,
        pricePaise: price,
        inStock: productDraft.inStock,
        active: productDraft.active,
        existingPaths: productDraft.existingPaths,
        previousPaths: productDraft.previousPaths,
        newPhotos: productDraft.newPhotos,
      });
      setProductDraft(null);
      await load();
      setDraft(shopDraft);
      toast({ message: 'Product saved', tone: 'success' });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeProduct = async (product: ShopProduct) => {
    if (!readsCurrent) return;
    if (!await confirm({
      title: `Delete ${product.name}?`,
      message: "Customers' past enquiries are kept.",
      confirmLabel: 'Delete',
      destructive: true,
    })) return;

    setBusy(true);
    try {
      await deleteProduct(product.id);
      await load();
      toast({ message: 'Product deleted from your catalogue', tone: 'success' });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (shop && shop.business_role !== 'owner') {
    const managementLinks = getShopManagementLinks(shop.business_role, {
      merchantStaff: appFeatures.isOn('merchant_staff'),
      rfq: rfqEnabled,
    });
    return (
      <Screen
        header={<Header title={shop.name} subtitle={`Read-only ${shop.business_role} access`} />}
        gap={t.spacing.md}
        refreshing={loading}
        onRefresh={() => void load()}
      >
        {error ? <InlineAlert message={`Shop refresh failed. Showing saved read-only access. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
        <Text variant="footnote" color="muted">
          Staff can view shop enquiries and RFQs. Only the owner can change shop details, catalogue prices, or verification.
        </Text>
        <Button title="All assigned business work" variant="outline" onPress={() => router.push('/merchant-work')} />
        <Button title="Open enquiries" onPress={() => router.push('/merchant-enquiries')} />
        <Button title="Open supplier RFQs" variant="outline" onPress={() => router.push('/merchant-rfqs')} />
      </Screen>
    );
  }

  if (!features.products) {
    return (
      <Screen
        header={<Header title={shop?.name ?? 'My shop'} subtitle="Read-only while products and shops are turned off" />}
        gap={t.spacing.md}
        refreshing={loading}
        onRefresh={() => void load()}
      >
        {error && !hasRead ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {error && hasRead ? <InlineAlert message={`Refresh failed. Showing saved shop data; shop and catalogue changes are disabled until a successful refresh. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
        <InlineAlert message={actionError} />
        {loading ? <Skeleton height={160} radius={t.radii.lg} /> : null}
        {shop ? (
          <>
            <Card gap={t.spacing.sm}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="title3">{shop.name}</Text>
                <ShopStatusLabel status={shop.status} />
              </View>
              {shop.status_reason ? <Text color="dangerText">{shop.status_reason}</Text> : null}
              {shop.description ? <Text>{shop.description}</Text> : null}
              <Text variant="footnote" color="muted">{[shop.address_line, shop.area, shop.city].filter(Boolean).join(' · ')}</Text>
              <Text variant="caption" color="muted">
                {shop.offers_delivery ? 'Delivery available' : 'No delivery'} · {shop.offers_pickup ? 'Pickup available' : 'No pickup'}
              </Text>
              <Text variant="footnote" color="muted">Existing shop details and catalogue are available for history only.</Text>
              <Button title="Open enquiries" variant="outline" onPress={() => router.push('/merchant-enquiries')} />
              <Button title="Open supplier RFQs" variant="outline" onPress={() => router.push('/merchant-rfqs')} />
            </Card>
            <Text variant="title3">Existing product catalogue ({products.length})</Text>
            {products.map((product) => (
              <Card key={product.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                {productImages[product.id] ? <Image source={{ uri: productImages[product.id] ?? undefined }} style={{ width: 58, height: 58, borderRadius: t.radii.sm, backgroundColor: t.colors.surfaceAlt }} contentFit="cover" /> : null}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="calloutStrong">{product.name}</Text>
                  <Text variant="caption" color="muted">{product.category_name} · {product.active ? 'Listed' : 'Paused'} · {product.in_stock ? 'In stock' : 'Out of stock'}</Text>
                  <IndicativePrice pricePaise={product.indicative_price_paise} unit={product.unit} updatedAt={product.price_updated_at} />
                </View>
              </Card>
            ))}
            {!products.length && !loading ? <Text variant="footnote" color="muted">No saved catalogue items.</Text> : null}
          </>
        ) : readsCurrent ? (
          <Text variant="footnote" color="muted">No existing shop is available. New shop setup is turned off.</Text>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen header={<Header title="My shop" subtitle="Manage your local shop and catalogue" />} gap={t.spacing.md} refreshing={loading} onRefresh={() => void load()}>
      {error && !hasRead ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {error && hasRead ? <InlineAlert message={`Refresh failed. Showing saved shop data; changes are disabled until a successful refresh. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
      <InlineAlert message={actionError} />
      {loading ? <Skeleton height={160} radius={t.radii.lg} /> : null}
      {shop ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="title3">{shop.name}</Text>
            <ShopStatusLabel status={shop.status} />
          </View>
          {shop.status_reason ? <Text color="dangerText">{shop.status_reason}</Text> : null}
          <Text variant="footnote" color="muted">Shop details and catalogues are public only after verification.</Text>
          {getShopManagementLinks(shop.business_role, {
            merchantStaff: appFeatures.isOn('merchant_staff'),
            rfq: rfqEnabled,
          }).staffManagement ? <Button title="Manage business staff" variant="outline" onPress={() => router.push('/merchant-staff')} /> : null}
          {shop.status !== 'suspended' ? <Button title="Submit for verification" variant="outline" loading={busy} onPress={() => void submitForReview()} disabled={!readsCurrent || !shop.id || shop.status === 'submitted' || shop.status === 'under_review' || shop.status === 'verified'} /> : null}
        </Card>
      ) : null}

      {shop || readsCurrent ? (
        <Card gap={t.spacing.md}>
          <Text variant="title3">{shop ? 'Shop details' : 'Set up your shop'}</Text>
          <Input label="Shop name" value={draft.name} onChangeText={(value) => updateShop('name', value)} maxLength={100} />
          <TextArea label="Description" value={draft.description} onChangeText={(value) => updateShop('description', value)} maxLength={1500} placeholder="What does your shop specialise in?" />
          <Input label="Find shop address" value={addressQuery} onChangeText={setAddressQuery} placeholder="Search a shop, street or landmark" />
          {placeResults.map((result, index) => (
            <ListItem key={`${result.title}-${index}`} title={result.title} subtitle={result.subtitle} chevron onPress={() => void choosePlace(result)} />
          ))}
          <Input label="Address line" value={draft.address_line} onChangeText={(value) => updateShop('address_line', value)} maxLength={220} />
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <View style={{ flex: 1 }}><Input label="City" value={draft.city} onChangeText={(value) => updateShop('city', value)} maxLength={100} /></View>
            <View style={{ flex: 1 }}><Input label="Area" value={draft.area} onChangeText={(value) => updateShop('area', value)} maxLength={100} /></View>
          </View>
          <Input label="GSTIN (optional)" value={draft.gstin ?? ''} onChangeText={(value) => updateShop('gstin', value.trim().toUpperCase() || null)} autoCapitalize="characters" maxLength={15} />
          <Text variant="calloutStrong">Product categories</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {categories.map((category) => {
              const selected = draft.category_slugs.includes(category.slug);
              return <Chip key={category.id} label={category.name} selected={selected} onPress={() => updateShop('category_slugs', selected ? draft.category_slugs.filter((slug) => slug !== category.slug) : [...draft.category_slugs, category.slug])} />;
            })}
          </View>
          <Input
            label="Delivery radius (km)"
            value={String(draft.delivery_radius_km)}
            onChangeText={(value) => updateShop('delivery_radius_km', Number(value) || 0)}
            keyboardType="number-pad"
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            <Chip label="Offers delivery" selected={draft.offers_delivery} onPress={() => updateShop('offers_delivery', !draft.offers_delivery)} />
            <Chip label="Pickup available" selected={draft.offers_pickup} onPress={() => updateShop('offers_pickup', !draft.offers_pickup)} />
          </View>
          <Button title="Save shop details" loading={busy} disabled={!readsCurrent} onPress={() => void saveShopDetails()} />
        </Card>
      ) : null}

      {shop ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="title3">Product catalogue ({products.length}/500)</Text>
            <Button title="Add product" size="sm" disabled={!readsCurrent || products.length >= 500} onPress={() => editProduct()} />
          </View>
          <Button title="Open enquiries" variant="outline" onPress={() => router.push('/merchant-enquiries')} />
          <Button title="Open supplier RFQs" variant="outline" onPress={() => router.push('/merchant-rfqs')} />

          {productDraft ? (
            <Card gap={t.spacing.md}>
              <Text variant="title3">{productDraft.id ? 'Edit product' : 'New product'}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                {categories.filter((category) => draft.category_slugs.includes(category.slug)).map((category) => <Chip key={category.id} label={category.name} selected={productDraft.categoryId === category.id} onPress={() => setProductDraft((current) => current ? { ...current, categoryId: category.id, specs: {} } : current)} />)}
              </View>
              <Input label="Product name" value={productDraft.name} onChangeText={(value) => updateProduct('name', value)} maxLength={120} />
              <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                <View style={{ flex: 1 }}><Input label="Brand" value={productDraft.brand} onChangeText={(value) => updateProduct('brand', value)} maxLength={80} /></View>
                <View style={{ flex: 1 }}><Input label="Model" value={productDraft.model} onChangeText={(value) => updateProduct('model', value)} maxLength={80} /></View>
              </View>
              <TextArea label="Description" value={productDraft.description} onChangeText={(value) => updateProduct('description', value)} maxLength={2000} />
              <SpecFields
                schema={categories.find((category) => category.id === productDraft.categoryId)?.attribute_schema ?? { properties: {} }}
                value={productDraft.specs}
                onChange={(value) => updateProduct('specs', value)}
              />
              <Text variant="calloutStrong">Unit</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                {UNITS.map((unit) => <Chip key={unit} label={unit} selected={productDraft.unit === unit} onPress={() => updateProduct('unit', unit)} />)}
              </View>
              <Input label={`Indicative price per ${UNIT_LABELS[productDraft.unit]} (₹, optional)`} value={productDraft.priceText} onChangeText={(value) => updateProduct('priceText', value)} keyboardType="decimal-pad" placeholder="Leave blank if not set" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                <Chip label="In stock" selected={productDraft.inStock} onPress={() => updateProduct('inStock', !productDraft.inStock)} />
                <Chip label="Visible in catalogue" selected={productDraft.active} onPress={() => updateProduct('active', !productDraft.active)} />
              </View>
              <Text variant="footnote" color="muted">{productDraft.existingPaths.length + productDraft.newPhotos.length}/6 product photos</Text>
              {productDraft.existingPaths.map((path, index) => (
                <ListItem key={path} title={`Saved photo ${index + 1}`} subtitle={path.split('/').pop()} right={<Button title="Remove" size="sm" variant="ghost" onPress={() => updateProduct('existingPaths', productDraft.existingPaths.filter((item) => item !== path))} />} />
              ))}
              {productDraft.newPhotos.map((_, index) => <Text key={index} variant="caption" color="muted">{`New photo ${index + 1}`}</Text>)}
              <Button title="Add photo" variant="outline" disabled={productDraft.existingPaths.length + productDraft.newPhotos.length >= 6} onPress={() => void addProductPhoto()} />
              <Button title="Save product" loading={busy} onPress={() => void saveProductDraft()} disabled={!readsCurrent || !productDraft.categoryId} />
              <Button title="Cancel" variant="ghost" onPress={() => setProductDraft(null)} />
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
                <Button title="Edit" size="sm" variant="outline" disabled={!readsCurrent} onPress={() => editProduct(product)} />
                <Button title="Remove" size="sm" variant="ghost" loading={busy} disabled={!readsCurrent} onPress={() => void removeProduct(product)} />
              </View>
            </Card>
          ))}
          {!products.length && !loading ? <Text variant="footnote" color="muted">No catalogue items yet. Add your first product after saving the shop.</Text> : null}
        </>
      ) : null}
    </Screen>
  );
}

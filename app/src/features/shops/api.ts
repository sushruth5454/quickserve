import { checkUpload } from '../../lib/onboarding/validation';
import { supabase } from '../../lib/supabase';

export type ShopStatus = 'draft' | 'submitted' | 'under_review' | 'verified' | 'rejected' | 'suspended';
export type ProductUnit = 'piece' | 'sqft' | 'box' | 'kg' | 'litre' | 'bag' | 'metre' | 'set';

export interface ProductCategory {
  id: string;
  slug: string;
  name: string;
  icon: string;
  sort_order: number;
  attribute_schema: { properties?: Record<string, { type?: string; enum?: string[]; maxLength?: number }> };
}

export interface ShopProfile {
  id: string;
  owner_id: string;
  business_role: 'owner' | 'manager' | 'staff';
  name: string;
  description: string;
  address_line: string;
  city: string;
  area: string;
  lat: number | null;
  lng: number | null;
  delivery_radius_km: number;
  offers_delivery: boolean;
  offers_pickup: boolean;
  whatsapp_contact: boolean;
  gstin: string | null;
  status: ShopStatus;
  status_reason: string | null;
  category_slugs: string[];
}

export interface ShopResult {
  id: string;
  name: string;
  description: string;
  city: string;
  area: string;
  offers_delivery: boolean;
  offers_pickup: boolean;
  distance_km: number | null;
  category_slugs: string[];
}

export type EnquiryBlockReason = 'sign_in' | 'own_shop' | 'feature_off' | null;

export type ShopDetail = Omit<ShopResult, 'distance_km'> & {
  address_line: string | null;
  lat: number | null;
  lng: number | null;
  delivery_radius_km: number;
  whatsapp_contact: boolean;
  can_enquire: boolean;
  enquiry_block_reason: EnquiryBlockReason;
};

export interface ShopProduct {
  id: string;
  shop_id: string;
  category_id: string;
  category_slug: string;
  category_name: string;
  name: string;
  brand: string;
  model: string;
  description: string;
  specs: Record<string, unknown>;
  unit: ProductUnit;
  indicative_price_paise: number | null;
  price_updated_at: string | null;
  in_stock: boolean;
  active: boolean;
  image_paths: string[];
}

export interface SearchProduct extends ShopProduct {
  shop_name: string;
  city: string;
  area: string;
  distance_km: number | null;
}

export type ProductDetail = Omit<SearchProduct, 'distance_km'> & {
  can_enquire: boolean;
  enquiry_block_reason: EnquiryBlockReason;
};

export interface AdminShop {
  id: string;
  name: string;
  description: string;
  address_line: string;
  city: string;
  area: string;
  lat: number | null;
  lng: number | null;
  gstin: string | null;
  status: ShopStatus;
  status_reason: string | null;
  owner_name: string;
  category_slugs: string[];
  created_at: string;
  updated_at: string;
}

export interface EnquirySummary {
  id: string;
  shop_id: string;
  product_id: string | null;
  shop_name: string;
  product_name: string | null;
  status: 'open' | 'closed';
  customer_name?: string;
  customer_unread?: number;
  shop_unread?: number;
  last_message_at: string;
}

export interface EnquiryThread extends EnquirySummary {
  customer_id: string;
  shop_unread: number;
  customer_unread: number;
  from_shop_user: boolean;
  business_role: 'owner' | 'manager' | 'staff' | null;
  can_change_status: boolean;
  can_reopen: boolean;
  active_enquiry_id: string | null;
}

export interface EnquiryMessage {
  id: string;
  sender_id: string;
  from_shop: boolean;
  body: string;
  created_at: string;
}

export interface ProductPhoto {
  uri: string;
  mimeType: string;
  size: number | null;
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message.replace(/^[a-z_]+: /, ''));
  return data as T;
}

export async function listProductCategories(): Promise<ProductCategory[]> {
  const { data, error } = await supabase.rpc('list_product_categories');
  return unwrap(data as ProductCategory[] | null, error);
}

export async function getMyShop(): Promise<ShopProfile | null> {
  const { data, error } = await supabase.rpc('get_my_business_shop');
  return unwrap(data as ShopProfile | null, error);
}

export async function saveShop(shop: Omit<ShopProfile, 'id' | 'owner_id' | 'business_role' | 'status' | 'status_reason'>): Promise<string> {
  const { data, error } = await supabase.rpc('save_shop', {
    p_name: shop.name,
    p_description: shop.description,
    p_address_line: shop.address_line,
    p_city: shop.city,
    p_area: shop.area,
    p_lat: shop.lat,
    p_lng: shop.lng,
    p_delivery_radius_km: shop.delivery_radius_km,
    p_offers_delivery: shop.offers_delivery,
    p_offers_pickup: shop.offers_pickup,
    p_whatsapp_contact: shop.whatsapp_contact,
    p_gstin: shop.gstin,
    p_category_slugs: shop.category_slugs,
  });
  return unwrap(data as string | null, error);
}

export async function submitShop(shopId: string): Promise<void> {
  const { data, error } = await supabase.rpc('submit_shop', { p_shop_id: shopId });
  unwrap(data, error);
}

export async function searchShops(lat: number | null, lng: number | null): Promise<ShopResult[]> {
  const { data, error } = await supabase.rpc('search_shops', { p_lat: lat, p_lng: lng, p_radius_km: 50, p_limit: 30 });
  return unwrap(data as ShopResult[] | null, error);
}

export async function getShop(shopId: string): Promise<ShopDetail | null> {
  const { data, error } = await supabase.rpc('get_shop', { p_id: shopId });
  return (unwrap(data as ShopDetail[] | null, error) ?? [])[0] ?? null;
}

export async function listShopProducts(shopId: string): Promise<ShopProduct[]> {
  const { data, error } = await supabase.rpc('list_shop_products', { p_shop_id: shopId });
  return unwrap(data as ShopProduct[] | null, error);
}

export async function getProduct(productId: string): Promise<ProductDetail | null> {
  const { data, error } = await supabase.rpc('get_product', { p_id: productId });
  return (unwrap(data as ProductDetail[] | null, error) ?? [])[0] ?? null;
}

export async function searchProducts(input: {
  query?: string;
  categorySlug?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number;
  maxPricePaise?: number | null;
  inStockOnly?: boolean;
}): Promise<SearchProduct[]> {
  const { data, error } = await supabase.rpc('search_products', {
    p_query: input.query?.trim() || null,
    p_category_slug: input.categorySlug || null,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
    p_radius_km: input.radiusKm ?? 15,
    p_max_price_paise: input.maxPricePaise ?? null,
    p_in_stock_only: input.inStockOnly ?? false,
    p_limit: 50,
  });
  return unwrap(data as SearchProduct[] | null, error);
}

export async function listMyProducts(): Promise<ShopProduct[]> {
  const { data, error } = await supabase.rpc('list_my_products');
  return unwrap(data as ShopProduct[] | null, error);
}

const extension = (mimeType: string) => (mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg');

async function uploadProductPhoto(shopId: string, photo: ProductPhoto): Promise<string> {
  const issue = checkUpload('portfolio', photo.mimeType, photo.size);
  if (issue) throw new Error(issue);
  const path = `${shopId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension(photo.mimeType)}`;
  const body = await (await fetch(photo.uri)).arrayBuffer();
  const { error } = await supabase.storage.from('product-images').upload(path, body, {
    contentType: photo.mimeType,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function signedProductImage(path: string | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('product-images').createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function saveProduct(input: {
  shopId: string;
  productId: string | null;
  categoryId: string;
  name: string;
  brand: string;
  model: string;
  description: string;
  specs: Record<string, unknown>;
  unit: ProductUnit;
  pricePaise: number | null;
  inStock: boolean;
  active: boolean;
  existingPaths: string[];
  previousPaths: string[];
  newPhotos: ProductPhoto[];
}): Promise<string> {
  if (input.existingPaths.length + input.newPhotos.length > 6) throw new Error('A product can have at most 6 images.');
  const uploaded: string[] = [];
  try {
    for (const photo of input.newPhotos) uploaded.push(await uploadProductPhoto(input.shopId, photo));
    const paths = [...input.existingPaths, ...uploaded];
    const { data, error } = await supabase.rpc('save_product', {
      p_product_id: input.productId,
      p_category_id: input.categoryId,
      p_name: input.name,
      p_brand: input.brand,
      p_model: input.model,
      p_description: input.description,
      p_specs: input.specs,
      p_unit: input.unit,
      p_indicative_price_paise: input.pricePaise,
      p_in_stock: input.inStock,
      p_active: input.active,
      p_image_paths: paths,
    });
    const id = unwrap(data as string | null, error);
    const removed = input.previousPaths.filter((path) => !paths.includes(path));
    if (removed.length) await supabase.storage.from('product-images').remove(removed).catch(() => undefined);
    return id;
  } catch (error) {
    if (uploaded.length) await supabase.storage.from('product-images').remove(uploaded).catch(() => undefined);
    throw error;
  }
}

export async function deleteProduct(productId: string): Promise<void> {
  const { data, error } = await supabase.rpc('delete_product', { p_product_id: productId });
  const paths = unwrap(data as string[] | null, error) ?? [];
  if (paths.length) await supabase.storage.from('product-images').remove(paths);
}

export async function startProductEnquiry(shopId: string, productId: string | null, body: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_product_enquiry', {
    p_shop_id: shopId,
    p_product_id: productId,
    p_body: body,
  });
  return unwrap(data as string | null, error);
}

export async function sendEnquiryMessage(enquiryId: string, body: string): Promise<void> {
  const { data, error } = await supabase.rpc('send_enquiry_message', { p_enquiry_id: enquiryId, p_body: body });
  unwrap(data, error);
}

export async function getProductEnquiry(enquiryId: string): Promise<EnquiryThread | null> {
  const { data, error } = await supabase.rpc('get_product_enquiry', { p_enquiry_id: enquiryId });
  return (unwrap(data as EnquiryThread[] | null, error) ?? [])[0] ?? null;
}

export async function listProductEnquiryMessages(enquiryId: string): Promise<EnquiryMessage[]> {
  const { data, error } = await supabase.rpc('list_product_enquiry_messages', { p_enquiry_id: enquiryId });
  return unwrap(data as EnquiryMessage[] | null, error);
}

export async function markEnquiryRead(enquiryId: string): Promise<void> {
  const { data, error } = await supabase.rpc('mark_enquiry_read', { p_enquiry_id: enquiryId });
  unwrap(data, error);
}

export async function setProductEnquiryStatus(enquiryId: string, status: 'open' | 'closed'): Promise<void> {
  const { data, error } = await supabase.rpc('set_product_enquiry_status', { p_enquiry_id: enquiryId, p_status: status });
  unwrap(data, error);
}

export async function listMyProductEnquiries(): Promise<EnquirySummary[]> {
  const { data, error } = await supabase.rpc('list_my_product_enquiries');
  return unwrap(data as EnquirySummary[] | null, error);
}

export async function listShopProductEnquiries(): Promise<EnquirySummary[]> {
  const { data, error } = await supabase.rpc('list_shop_product_enquiries');
  return unwrap(data as EnquirySummary[] | null, error);
}

export async function adminListShops(status: string): Promise<AdminShop[]> {
  const { data, error } = await supabase.rpc('admin_list_shops', { p_status: status });
  return unwrap(data as AdminShop[] | null, error);
}

export async function adminSetShopStatus(shopId: string, status: ShopStatus, reason: string): Promise<void> {
  const { data, error } = await supabase.rpc('admin_set_shop_status', {
    p_shop_id: shopId,
    p_status: status,
    p_reason: reason || null,
  });
  unwrap(data, error);
}

export async function adminListProductCategories(): Promise<Array<Pick<ProductCategory, 'id' | 'slug' | 'name' | 'sort_order'> & { active: boolean }>> {
  const { data, error } = await supabase.rpc('admin_list_product_categories');
  return unwrap(data as Array<Pick<ProductCategory, 'id' | 'slug' | 'name' | 'sort_order'> & { active: boolean }> | null, error);
}

export async function adminSetProductCategoryActive(categoryId: string, active: boolean): Promise<void> {
  const { data, error } = await supabase.rpc('admin_set_product_category_active', {
    p_category_id: categoryId,
    p_active: active,
  });
  unwrap(data, error);
}

export async function adminShopDashboard(): Promise<{ shops: number; verified_shops: number; products: number; open_enquiries: number }> {
  const { data, error } = await supabase.rpc('admin_shop_dashboard');
  return unwrap(data as { shops: number; verified_shops: number; products: number; open_enquiries: number } | null, error);
}

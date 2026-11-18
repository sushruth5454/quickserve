import { supabase } from '../../lib/supabase';

export type RfqUnit = 'piece' | 'sqft' | 'box' | 'kg' | 'litre' | 'bag' | 'metre' | 'set';
export type RfqStatus = 'open' | 'closed' | 'expired' | 'cancelled';
export type SupplierQuoteStatus = 'sent' | 'withdrawn' | 'selected' | 'rejected' | 'expired';

export interface RfqItem {
  id: string;
  seq: number;
  description: string;
  brand_pref: string;
  specs: Record<string, unknown>;
  quantity: number;
  unit: RfqUnit;
}

export interface Rfq {
  id: string;
  customer_id: string;
  category_id: string;
  category_name: string;
  title: string;
  city: string;
  area: string;
  lat: number;
  lng: number;
  needs_delivery: boolean;
  needed_by: string;
  notes: string;
  status: RfqStatus;
  expires_at: string;
  created_at: string;
  recipient_count: number;
  items: RfqItem[];
}

export interface CustomerRfqSummary {
  id: string;
  title: string;
  category_name: string;
  city: string;
  area: string;
  needed_by: string;
  expires_at: string;
  created_at: string;
  status: RfqStatus;
  recipient_count: number;
}

export interface RfqQuoteItemComparison {
  rfq_item_id: string;
  seq: number;
  description: string;
  requested_brand: string;
  requested_specs: Record<string, unknown>;
  brand: string;
  model: string;
  specs: Record<string, unknown>;
  quantity: number;
  unit: RfqUnit;
  unit_price_paise: number;
  gst_rate_bp: number;
  available: boolean;
  line_total_paise: number;
  brand_differs: boolean;
  specs_missing: boolean;
  missing_spec_keys: string[];
}

export interface RfqQuoteComparison {
  quote_id: string;
  shop_id: string;
  shop_name: string;
  version: number;
  status: SupplierQuoteStatus;
  valid_until: string;
  delivery_charge_paise: number;
  delivery_days: number | null;
  notes: string;
  subtotal_paise: number;
  gst_paise: number;
  total_paise: number;
  unavailable_count: number;
  items: RfqQuoteItemComparison[];
}

export interface SupplierRfqSummary {
  shop_id: string;
  rfq_id: string;
  title: string;
  category_name: string;
  city: string;
  area: string;
  needs_delivery: boolean;
  needed_by: string;
  expires_at: string;
  created_at: string;
  item_count: number;
  quote_status: SupplierQuoteStatus | null;
  business_role: 'owner' | 'manager' | 'staff';
}

export interface SupplierRfq extends Omit<Rfq, 'customer_id' | 'category_id' | 'lat' | 'lng' | 'recipient_count' | 'created_at'> {
  shop_id: string;
  business_role: 'owner' | 'manager' | 'staff';
  my_quote: {
    id: string;
    version: number;
    status: SupplierQuoteStatus;
    delivery_charge_paise: number;
    delivery_days: number | null;
    valid_until: string;
    notes: string;
  } | null;
}

export interface AdminRfqDashboard {
  open_rfqs: number;
  total_rfqs: number;
  total_quotes: number;
  average_quotes_per_rfq: number;
  average_response_minutes: number;
  recent_rfqs: { id: string; title: string; city: string; status: RfqStatus; created_at: string; quote_count: number }[];
}

export interface NewRfqItem {
  description: string;
  brand_pref: string;
  specs: Record<string, unknown>;
  quantity: number;
  unit: RfqUnit;
}

export interface SupplierQuoteItemInput {
  rfq_item_id: string;
  brand: string;
  model: string;
  specs: Record<string, unknown>;
  unit_price_paise: number;
  gst_rate_bp: number;
  available: boolean;
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message.replace(/^[a-z_]+: /, ''));
  return data as T;
}

export async function createRfq(input: {
  categoryId: string;
  title: string;
  items: NewRfqItem[];
  city: string;
  area: string;
  lat: number;
  lng: number;
  needsDelivery: boolean;
  neededBy: string;
  notes: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_rfq', {
    p_category_id: input.categoryId,
    p_title: input.title.trim(),
    p_items: input.items,
    p_city: input.city,
    p_area: input.area,
    p_lat: input.lat,
    p_lng: input.lng,
    p_needs_delivery: input.needsDelivery,
    p_needed_by: input.neededBy,
    p_notes: input.notes.trim(),
  });
  return unwrap(data as string | null, error);
}

export async function getRfq(rfqId: string): Promise<Rfq> {
  const { data, error } = await supabase.rpc('get_rfq', { p_rfq_id: rfqId });
  return unwrap(data as Rfq | null, error);
}

export async function listMyCustomerRfqs(): Promise<CustomerRfqSummary[]> {
  const { data, error } = await supabase.rpc('list_my_customer_rfqs');
  return unwrap(data as CustomerRfqSummary[] | null, error);
}

export async function compareRfqQuotes(rfqId: string): Promise<RfqQuoteComparison[]> {
  const { data, error } = await supabase.rpc('compare_rfq_quotes', { p_rfq_id: rfqId });
  return unwrap(data as RfqQuoteComparison[] | null, error);
}

export async function selectSupplierQuote(quoteId: string): Promise<{ rfq_id: string; enquiry_id: string }> {
  const { data, error } = await supabase.rpc('select_supplier_quote', { p_quote_id: quoteId });
  return unwrap(data as { rfq_id: string; enquiry_id: string } | null, error);
}

export async function listMySupplierRfqs(): Promise<SupplierRfqSummary[]> {
  const { data, error } = await supabase.rpc('list_my_supplier_rfqs');
  return unwrap(data as SupplierRfqSummary[] | null, error);
}

export async function getSupplierRfq(rfqId: string, shopId?: string): Promise<SupplierRfq> {
  const { data, error } = await supabase.rpc('get_supplier_rfq_for_business', {
    p_rfq_id: rfqId,
    p_shop_id: shopId ?? null,
  });
  return unwrap(data as SupplierRfq | null, error);
}

export async function sendSupplierQuote(input: {
  rfqId: string;
  shopId: string;
  items: SupplierQuoteItemInput[];
  deliveryChargePaise: number;
  deliveryDays: number | null;
  notes: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('send_supplier_quote_for_business', {
    p_rfq_id: input.rfqId,
    p_shop_id: input.shopId,
    p_items: input.items,
    p_delivery_charge_paise: input.deliveryChargePaise,
    p_delivery_days: input.deliveryDays,
    p_valid_until: null,
    p_notes: input.notes.trim(),
  });
  return unwrap(data as string | null, error);
}

export async function getAdminRfqDashboard(): Promise<AdminRfqDashboard> {
  const { data, error } = await supabase.rpc('admin_rfq_dashboard');
  return unwrap(data as AdminRfqDashboard | null, error);
}

import { supabase } from './supabase';

export interface AdminFeatures {
  ai_assistant: boolean;
  urgent_requests: boolean;
  fixed_asap: boolean;
  archetypes: Record<string, boolean>;
}

export interface AdminDashboard {
  days: number;
  totals: {
    users: number;
    customers: number;
    providers: number;
    providers_verified: number;
    providers_online: number;
    providers_pending: number;
    creators: number;
    bookings: number;
    bookings_active: number;
    disputes_open: number;
    gmv_paise: number;
    gmv_period_paise: number;
    platform_fees_paise: number;
    requests_open: number;
    support_open: number;
    support_unread: number;
  };
  daily: { day: string; signups: number; bookings: number; requests: number; paid_paise: number }[];
  top_categories: { name: string; archetype: string; bookings: number }[];
  status: Record<string, number>;
}

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  archetype: string;
  active: boolean;
  sort_order: number;
  cities: { city: string; live: boolean }[];
  providers: number;
  bookings_30d: number;
}

export interface AdminProvider {
  id: string;
  full_name: string;
  phone: string;
  city: string;
  kyc_status: string;
  suspended: boolean;
  paused: boolean;
  is_online: boolean;
  rating_avg: number;
  rating_count: number;
  jobs_completed: number;
  is_creator: boolean;
  categories: string[];
  submitted_at: string | null;
  created_at: string;
}

export interface AdminBooking {
  id: string;
  created_at: string;
  status: string;
  archetype: string;
  category: string;
  customer: string;
  customer_phone: string;
  provider: string;
  total_amount: number;
  paid_paise: number;
  scheduled_at: string | null;
  city: string;
}

export interface AdminSupportThread {
  id: string;
  subject: string;
  status: 'open' | 'closed';
  booking_id: string | null;
  user_id: string;
  user_name: string;
  user_phone: string;
  is_provider: boolean;
  admin_unread: number;
  last_message: string;
  last_from_admin: boolean;
  last_message_at: string;
}

export interface SupportThread {
  id: string;
  user_id: string;
  booking_id: string | null;
  subject: string;
  status: 'open' | 'closed';
  user_unread: number;
  admin_unread: number;
  last_message: string;
  last_from_admin: boolean;
  last_message_at: string;
  created_at: string;
}

export interface SupportMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  from_admin: boolean;
  body: string;
  created_at: string;
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const amIAdmin = () => rpc<boolean>('am_i_admin');
export const getAppFeatures = () => rpc<AdminFeatures>('get_app_features');
export const setFeature = (key: string, enabled: boolean) => rpc<AdminFeatures>('admin_set_feature', { p_key: key, p_enabled: enabled });
export const getDashboard = (days = 30) => rpc<AdminDashboard>('admin_dashboard', { p_days: days });
export const listCategories = () => rpc<AdminCategory[]>('admin_list_categories');
export const setCategoryActive = (id: string, active: boolean) =>
  rpc<void>('admin_set_category_active', { p_category_id: id, p_active: active });
export const setCategoryCity = (id: string, city: string, live: boolean) =>
  rpc<void>('admin_set_category_city', { p_category_id: id, p_city: city, p_live: live });
export const listProviders = (filter = 'all', search: string | null = null) =>
  rpc<AdminProvider[]>('admin_list_providers', { p_filter: filter, p_search: search });
export const setProviderSuspended = (id: string, suspended: boolean, reason: string) =>
  rpc<void>('set_provider_suspended', { p_provider_id: id, p_suspended: suspended, p_reason: reason });
export const setProviderKyc = (id: string, status: string, reason: string | null = null) =>
  rpc<void>('admin_set_provider_kyc', { p_provider_id: id, p_status: status, p_reason: reason });
export const listBookings = (status: string | null = 'all', search: string | null = null) =>
  rpc<AdminBooking[]>('admin_list_bookings', { p_status: status, p_search: search });
export const getBooking = (id: string) => rpc<Record<string, any>>('admin_get_booking', { p_booking_id: id });
export const resolveDispute = (id: string, outcome: 'denied' | 'partial_refund' | 'full_refund', amount: number | null, note: string) =>
  rpc<void>('resolve_dispute', { p_booking_id: id, p_outcome: outcome, p_refund_amount: amount, p_note: note });
export const listAdminSupport = (status = 'open') =>
  rpc<AdminSupportThread[]>('admin_list_support_threads', { p_status: status });

export async function listSupportThreads(): Promise<SupportThread[]> {
  const { data, error } = await supabase.from('support_threads').select('*').order('last_message_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data as SupportThread[];
}

export async function getSupportThread(id: string): Promise<SupportThread | null> {
  const { data, error } = await supabase.from('support_threads').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as SupportThread | null;
}

export async function listSupportMessages(id: string): Promise<SupportMessage[]> {
  const { data, error } = await supabase.from('support_messages').select('*').eq('thread_id', id).order('created_at');
  if (error) throw new Error(error.message);
  return data as SupportMessage[];
}

export const startSupport = (body: string, bookingId: string | null = null, subject: string | null = null) =>
  rpc<string>('support_start', { p_body: body, p_booking_id: bookingId, p_subject: subject });
export const sendSupport = (id: string, body: string) => rpc<void>('support_send', { p_thread_id: id, p_body: body });
export const markSupportRead = (id: string) => rpc<void>('support_mark_read', { p_thread_id: id });
export const setSupportStatus = (id: string, status: 'open' | 'closed') =>
  rpc<void>('support_set_status', { p_thread_id: id, p_status: status });

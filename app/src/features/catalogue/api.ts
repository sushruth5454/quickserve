import { demoSeedCity, isDemoMode, isSeedDemoMode } from '../../lib/config';
import { demoApi } from '../../lib/demo/demoApi';
import { supabase } from '../../lib/supabase';
import { invokeFunction } from '../../lib/invokeFunction';
import { istDateKey } from '../../lib/schedule';
import type { PaymentLinkResponse } from '../../lib/apiTypes';
import type { Category, ServicePackage } from '../../lib/types';
import { normaliseCatalogue, type Catalogue } from './model';

type SupabaseResult<T> = { data?: T | null; error: { message: string } | null };
const unwrap = <T,>(result: SupabaseResult<T>): T => {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
};

export interface CataloguePackage {
  package: ServicePackage;
  providerServiceId: string;
  providerId: string;
  providerName: string;
  city: string;
  providerOnline: boolean;
  providerPaused: boolean;
  rating: number;
  ratingCount: number;
  category: Category;
}

export interface ServiceRequest {
  id: string;
  customer_id: string;
  category_id: string;
  city: string;
  event_start: string | null;
  event_end: string | null;
  intake: Record<string, unknown>;
  budget_min: number | null;
  budget_max: number | null;
  status: 'open' | 'closed' | 'booked' | 'expired' | 'cancelled';
  expires_at: string | null;
  created_at: string;
  categories?: Pick<Category, 'name' | 'slug' | 'archetype' | 'intake_schema'> | null;
  proposals?: Proposal[];
}

export interface Proposal {
  id: string;
  request_id: string;
  provider_id: string;
  version: number;
  status: 'sent' | 'withdrawn' | 'accepted' | 'rejected' | 'expired';
  total: number;
  valid_until: string;
  note: string | null;
  created_at: string;
  providers?: {
    rating_avg: number;
    rating_count: number;
    profiles: { full_name: string } | null;
  } | null;
  proposal_items?: Array<{ id: string; title: string; qty: number; unit_price: number; kind: string }>;
  proposal_schedule?: Array<{ seq: number; label: string; amount: number; due_rule: string; due_at: string | null }>;
}

export interface PaymentScheduleItem {
  id: string;
  booking_id: string;
  seq: number;
  label: string;
  amount: number;
  due_rule: string;
  due_at: string | null;
  status: 'upcoming' | 'due' | 'paid' | 'waived' | 'refunded';
}

export async function getCatalogue(city: string): Promise<Catalogue> {
  if (isDemoMode) {
    const categories = await demoApi.listCategories();
    return normaliseCatalogue(categories);
  }
  return normaliseCatalogue(unwrap(await supabase.rpc('get_catalog', { p_city: city })));
}

export async function getCatalogueCategory(slug: string, city: string): Promise<Category | null> {
  const catalogue = await getCatalogue(city);
  return catalogue.categories.find((category) => category.slug === slug) ?? null;
}

export async function getCatalogueCategoryById(id: string, city: string): Promise<Category | null> {
  const catalogue = await getCatalogue(city);
  return catalogue.categories.find((category) => category.id === id) ?? null;
}

export async function listCataloguePackages(categorySlug: string, city: string): Promise<CataloguePackage[]> {
  if (isDemoMode) return [];
  const selectedCity = city.trim();
  if (!selectedCity) return [];
  const isSeedDemoAlias = isSeedDemoMode && selectedCity.toLowerCase() === demoSeedCity.toLowerCase();
  const providerCity = isSeedDemoAlias
    ? selectedCity.replace(/\s*(?:\(demo\)|demo)$/i, '').trim()
    : selectedCity;
  if (!providerCity) return [];
  const rows = unwrap(await supabase
    .from('service_packages')
    .select('*, provider_services!inner(id, provider_id, active, categories!inner(*), providers!inner(city, rating_avg, rating_count, is_online, paused, profiles(full_name)))')
    .eq('active', true)
    .eq('provider_services.active', true)
    .eq('provider_services.categories.slug', categorySlug)
    .ilike('provider_services.providers.city', providerCity.replace(/[\\%_]/g, (character) => `\\${character}`))
    .order('sort_order')) as Array<ServicePackage & {
    provider_services: {
      id: string;
      provider_id: string;
      categories: Category;
      providers: { city: string; rating_avg: number; rating_count: number; is_online: boolean; paused: boolean; profiles: { full_name: string } | null } | null;
    };
  }>;
  return rows.map((row) => {
    const service = row.provider_services;
    return {
      package: row,
      providerServiceId: service.id,
      providerId: service.provider_id,
      providerName: service.providers?.profiles?.full_name ?? 'Provider',
      city: service.providers?.city ?? '',
      providerOnline: service.providers?.is_online ?? false,
      providerPaused: service.providers?.paused ?? false,
      rating: Number(service.providers?.rating_avg ?? 0),
      ratingCount: service.providers?.rating_count ?? 0,
      category: service.categories,
    };
  });
}

export async function getCataloguePackage(packageId: string): Promise<CataloguePackage> {
  const rows = unwrap(await supabase
    .from('service_packages')
    .select('*, provider_services!inner(id, provider_id, active, categories!inner(*), providers(city, rating_avg, rating_count, is_online, paused, profiles(full_name)))')
    .eq('id', packageId)
    .single<ServicePackage & {
      provider_services: {
        id: string;
        provider_id: string;
        categories: Category;
        providers: { city: string; rating_avg: number; rating_count: number; is_online: boolean; paused: boolean; profiles: { full_name: string } | null } | null;
      };
    }>()) as ServicePackage & {
      provider_services: {
        id: string;
        provider_id: string;
        categories: Category;
        providers: { city: string; rating_avg: number; rating_count: number; is_online: boolean; paused: boolean; profiles: { full_name: string } | null } | null;
      };
    };
  const service = rows.provider_services;
  return {
    package: rows,
    providerServiceId: service.id,
    providerId: service.provider_id,
    providerName: service.providers?.profiles?.full_name ?? 'Provider',
    city: service.providers?.city ?? '',
    providerOnline: service.providers?.is_online ?? false,
    providerPaused: service.providers?.paused ?? false,
    rating: Number(service.providers?.rating_avg ?? 0),
    ratingCount: service.providers?.rating_count ?? 0,
    category: service.categories,
  };
}

export async function createFixedPackageBooking(input: {
  packageId: string;
  quantity: number;
  startsAt: Date;
  endsAt: Date;
  addressId: string;
  intake: Record<string, unknown>;
}): Promise<string> {
  return unwrap(await supabase.rpc('create_fixed_booking', {
    p_package_id: input.packageId,
    p_quantity: input.quantity,
    p_window: `[${input.startsAt.toISOString()},${input.endsAt.toISOString()})`,
    p_location: { address_id: input.addressId },
    p_intake: input.intake,
  })) as string;
}

export async function createTimeBooking(input: {
  packageId: string;
  quantity: number;
  providerServiceId: string;
  startsAt: Date;
  durationMin: number;
  addressId: string;
  addressLine: string;
  city: string;
  lat: number;
  lng: number;
  intake: Record<string, unknown>;
  pack: boolean;
}): Promise<{ kind: 'booking' | 'pack'; id: string }> {
  const result = input.pack
    ? unwrap(await supabase.rpc('purchase_session_pack', {
        p_service_package_id: input.packageId,
        p_sessions: input.quantity,
      }))
    : unwrap(await supabase.rpc('create_session_booking', {
        p_provider_service_id: input.providerServiceId,
        p_service_package_id: input.packageId,
        p_scheduled_at: input.startsAt.toISOString(),
        p_duration_min: input.durationMin,
        p_address_line: input.addressLine,
        p_city: input.city,
        p_lat: input.lat,
        p_lng: input.lng,
        p_description: JSON.stringify(input.intake),
      }));
  return { kind: input.pack ? 'pack' : 'booking', id: result as string };
}

export async function createPackPayment(packId: string): Promise<PaymentLinkResponse> {
  const { data, error } = await invokeFunction<PaymentLinkResponse>('create-payment', {
    body: { pack_id: packId },
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No pack payment link returned');
  return data;
}

export interface RecurringScheduleInput {
  providerServiceId: string;
  packageId: string | null;
  packId: string | null;
  paymentMode: 'per_session' | 'pack_prepaid' | 'monthly_prepaid';
  weekdays: number[];
  startTime: string;
  timezone: string;
  durationMin: number;
  startsOn: Date;
  endsOn: Date | null;
  addressLine: string;
  city: string;
  lat: number;
  lng: number;
  description: string;
}

export async function createRecurringSchedule(input: RecurringScheduleInput): Promise<string> {
  const isoDate = istDateKey;
  return unwrap(await supabase.rpc('create_recurring_schedule', {
    p_provider_service_id: input.providerServiceId,
    p_service_package_id: input.packageId,
    p_pack_id: input.packId,
    p_payment_mode: input.paymentMode,
    p_weekdays: input.weekdays,
    p_start_time: input.startTime,
    p_timezone: input.timezone,
    p_duration_min: input.durationMin,
    p_starts_on: isoDate(input.startsOn),
    p_ends_on: input.endsOn ? isoDate(input.endsOn) : null,
    p_address_line: input.addressLine,
    p_city: input.city,
    p_lat: input.lat,
    p_lng: input.lng,
    p_description: input.description,
  })) as string;
}

export async function cancelRecurringSchedule(scheduleId: string, cancelFuture = true): Promise<number> {
  return unwrap(await supabase.rpc('cancel_recurring_schedule', {
    p_schedule_id: scheduleId,
    p_cancel_future: cancelFuture,
  })) as number;
}

export async function createServiceRequest(input: {
  categoryId: string;
  city: string;
  addressId: string | null;
  venueText: string | null;
  eventStart: Date;
  eventEnd: Date;
  intake: Record<string, unknown>;
  budgetMin: number | null;
  budgetMax: number | null;
}): Promise<string> {
  return unwrap(await supabase.rpc('create_service_request', {
    p_category_id: input.categoryId,
    p_city: input.city,
    p_address_id: input.addressId,
    p_venue_text: input.venueText,
    p_event_start: input.eventStart.toISOString(),
    p_event_end: input.eventEnd.toISOString(),
    p_intake: input.intake,
    p_budget_min: input.budgetMin,
    p_budget_max: input.budgetMax,
  })) as string;
}

export async function getServiceRequest(id: string): Promise<ServiceRequest> {
  return unwrap(await supabase
    .from('service_requests')
    .select('*, categories(name, slug, archetype, intake_schema), proposals(*, proposal_items(*), proposal_schedule(*), providers(rating_avg, rating_count, profiles(full_name)))')
    .eq('id', id)
    .single<ServiceRequest>()) as ServiceRequest;
}

export async function acceptProposal(proposalId: string, addressId: string | null): Promise<string> {
  return unwrap(await supabase.rpc('accept_proposal', {
    p_proposal_id: proposalId,
    p_address_id: addressId,
  })) as string;
}

export async function getPaymentSchedule(bookingId: string): Promise<PaymentScheduleItem[]> {
  return unwrap(await supabase
    .from('payment_schedule')
    .select('*')
    .eq('booking_id', bookingId)
    .order('seq')) as PaymentScheduleItem[];
}


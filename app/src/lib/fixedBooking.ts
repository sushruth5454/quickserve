import type { CreateFixedBookingInput, FixedBookingLocation } from './apiTypes';
import { demoFixedBooking } from './demo/demoFixedBooking';
import { supabase } from './supabase';
import { isDemoMode } from './config';
import { rupeesToPaise } from './money';
import type { Booking, PaymentSchedule, Quote, ServicePackage } from './types';

export type { CreateFixedBookingInput, FixedBookingLocation };

export interface FixedPackageQuote {
  id: string;
  total: number;
  quote_type: 'package';
  source_package_id?: string | null;
  package_snapshot: Record<string, unknown>;
}

export type QuoteEditorMode = 'itemized' | 'fixed_addons';

export function canManageServiceQuotes(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

type QuoteFamilyState = Pick<Booking, 'archetype' | 'booking_origin' | 'status' | 'approved_quote_id'>;
type QuoteFamilyRow = Pick<Quote, 'id' | 'status' | 'is_change_order' | 'quote_type'>;

export function hasPendingFixedAddonQuote(quotes: readonly QuoteFamilyRow[]): boolean {
  return quotes.some((quote) =>
    quote.status === 'approved_pending_payment'
    && quote.is_change_order
    && quote.quote_type === 'package',
  );
}

export function canPayPendingQuoteWithoutSchedule(
  booking: Pick<Booking, 'archetype' | 'booking_origin'>,
  quoteId: string,
  schedules: readonly Pick<PaymentSchedule, 'quote_id' | 'status'>[],
): boolean {
  if (schedules.some((schedule) => schedule.quote_id === quoteId && schedule.status === 'due')) return false;
  return booking.booking_origin === 'byo'
    || (booking.booking_origin === 'marketplace' && booking.archetype === 'inspect_quote');
}

export function getQuoteEditorMode(
  booking: QuoteFamilyState,
  quotes: readonly QuoteFamilyRow[],
): QuoteEditorMode | null {
  const openQuote = quotes.find((quote) => quote.status === 'sent') ?? null;
  const approvedQuote = quotes.find((quote) => quote.id === booking.approved_quote_id) ?? null;

  if (booking.booking_origin === 'byo') {
    if (booking.status === 'quote_sent') {
      const currentQuote = openQuote ?? approvedQuote;
      return currentQuote?.quote_type === 'itemized' ? 'itemized' : null;
    }
    if (booking.status === 'in_progress') {
      return approvedQuote?.quote_type === 'itemized' && (!openQuote || openQuote.quote_type === 'itemized')
        ? 'itemized'
        : null;
    }
    return null;
  }

  if (booking.booking_origin !== 'marketplace') return null;
  if (
    booking.archetype === 'inspect_quote'
    && ['inspecting', 'quote_sent', 'in_progress'].includes(booking.status)
  ) {
    const existingQuote = openQuote ?? approvedQuote;
    return !existingQuote || existingQuote.quote_type === 'itemized' ? 'itemized' : null;
  }
  if (
    booking.archetype === 'fixed'
    && booking.status === 'in_progress'
    && approvedQuote?.quote_type === 'package'
    && !hasPendingFixedAddonQuote(quotes)
  ) {
    return 'fixed_addons';
  }
  return null;
}

export function getQuoteApprovalMode(
  booking: QuoteFamilyState,
  quote: QuoteFamilyRow,
): QuoteEditorMode | null {
  if (quote.status !== 'sent' || !['quote_sent', 'in_progress'].includes(booking.status)) return null;
  if (booking.booking_origin === 'byo' && quote.quote_type === 'itemized') return 'itemized';
  if (
    booking.booking_origin === 'marketplace'
    && booking.archetype === 'inspect_quote'
    && quote.quote_type === 'itemized'
  ) {
    return 'itemized';
  }
  if (
    booking.booking_origin === 'marketplace'
    && booking.archetype === 'fixed'
    && booking.status === 'in_progress'
    && quote.is_change_order
    && quote.quote_type === 'package'
  ) {
    return 'fixed_addons';
  }
  return null;
}

export interface FixedAddonDraft {
  title: string;
  qty: number;
  unit?: string;
  unitPrice: string | number;
}

export interface FixedAddonInput {
  title: string;
  qty: number;
  unit?: string;
  unit_price: number;
}

export function buildFixedAddonPayload(
  approvedPackage: Pick<Quote, 'quote_type'>,
  drafts: readonly FixedAddonDraft[],
): FixedAddonInput[] {
  if (approvedPackage.quote_type !== 'package') {
    throw new Error('Add-ons require an approved fixed package.');
  }
  if (drafts.length < 1 || drafts.length > 20) {
    throw new Error('Add 1 to 20 add-ons.');
  }

  return drafts.map((draft) => {
    const title = draft.title.trim();
    const unitPriceRupees = Number(draft.unitPrice);
    const unit_price = rupeesToPaise(unitPriceRupees);
    if (
      title.length < 2
      || title.length > 160
      || !Number.isFinite(draft.qty)
      || draft.qty <= 0
      || draft.qty > 100
      || !Number.isFinite(unitPriceRupees)
      || unit_price <= 0
      || unit_price > 10000000
    ) {
      throw new Error('Each add-on needs a description, quantity and positive price.');
    }
    const unit = draft.unit?.trim();
    return { title, qty: draft.qty, ...(unit ? { unit } : {}), unit_price };
  });
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data == null) throw new Error('No data returned');
  return result.data;
}

export async function listFixedPackages(providerServiceId: string): Promise<ServicePackage[]> {
  if (isDemoMode) return demoFixedBooking.listPackages(providerServiceId);
  return unwrap(
    await supabase
      .from('service_packages')
      .select('*')
      .eq('provider_service_id', providerServiceId)
      .eq('active', true)
      .eq('price_type', 'fixed')
      .order('sort_order'),
  );
}

export async function createFixedBooking(input: CreateFixedBookingInput): Promise<string> {
  if (isDemoMode) return demoFixedBooking.create(input);
  return unwrap(
    await supabase.rpc('create_fixed_booking', {
      p_package_id: input.packageId,
      p_quantity: input.quantity,
      p_window: `[${input.windowStart.toISOString()},${input.windowEnd.toISOString()})`,
      p_location: {
        mode: input.location.mode,
        address_id: input.location.addressId ?? null,
        address_line: input.location.addressLine ?? null,
        city: input.location.city ?? null,
        lat: input.location.lat ?? null,
        lng: input.location.lng ?? null,
      },
      p_intake: input.intake ?? {},
    }),
  );
}

export async function sendFixedAddons(
  bookingId: string,
  addons: { title: string; qty: number; unit?: string; unit_price: number }[],
  note?: string,
): Promise<string> {
  if (isDemoMode) return demoFixedBooking.sendAddons(bookingId, addons, note);
  return unwrap(
    await supabase.rpc('send_fixed_addons', {
      p_booking_id: bookingId,
      p_addons: addons,
      p_note: note ?? null,
    }),
  );
}

export async function approveFixedChangeOrder(bookingId: string, quoteId: string) {
  if (isDemoMode) return demoFixedBooking.approveChangeOrder(bookingId, quoteId);
  return unwrap(
    await supabase.rpc('approve_fixed_change_order', {
      p_booking_id: bookingId,
      p_quote_id: quoteId,
    }),
  ) as { amount_due: number; refund: number; quote_id: string };
}


import type { CreateFixedBookingInput, FixedBookingLocation } from './apiTypes';
import { demoFixedBooking } from './demo/demoFixedBooking';
import { supabase } from './supabase';
import { isDemoMode } from './config';
import type { ServicePackage } from './types';

export type { CreateFixedBookingInput, FixedBookingLocation };

export interface FixedPackageQuote {
  id: string;
  total: number;
  quote_type: 'package';
  package_snapshot: Record<string, unknown>;
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


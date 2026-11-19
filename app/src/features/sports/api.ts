import { supabase } from '../../lib/supabase';

export type SportsPaymentMode = 'online' | 'pay_at_venue';
export type SportsBookingStatus =
  | 'pending_payment'
  | 'requested'
  | 'awaiting_payment'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'completed'
  | 'expired';

export interface BookSlotResult {
  booking_id: string;
  status: SportsBookingStatus;
  total_paise: number;
  hold_expires_at: string | null;
  pay_by: string | null;
}

export interface SportsSlotAvailability {
  starts_at: string;
  ends_at: string;
  state: 'free' | 'taken' | 'blocked' | 'past';
  price_paise: number | null;
  remaining?: number | null;
}

export interface SportsResource {
  id: string;
  name: string;
  activity_id?: string;
  activity_slug?: string;
  activity_name: string;
  slot_minutes: number;
  booking_mode?: 'instant' | 'approval';
  capacity?: number;
}

export interface CustomerSportsVenue {
  id: string;
  name: string;
  description: string;
  address_line: string;
  city: string;
  area: string;
  amenities: string[];
  photos: string[];
  payment_modes?: SportsPaymentMode[];
  online_payment_ready?: boolean;
  cancellation_policy?: {
    full_refund_hours: number | null;
    partial_refund_hours: number | null;
    partial_refund_bp: number | null;
  };
  resources: SportsResource[];
}

export interface SportsCancellationPreview {
  can_cancel: boolean;
  refund_paise: number;
  retained_paise: number;
  full_refund_hours: number | null;
  partial_refund_hours: number | null;
  partial_refund_bp: number | null;
}

export interface CustomerSportsBooking {
  id: string;
  venue_name: string;
  resource_name: string;
  activity_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price_paise: number;
  expires_at: string;
  payment_mode?: SportsPaymentMode;
  participants?: number;
  customer_fee_paise?: number;
  total_paise?: number | null;
  refund_paise?: number;
  paid_at?: string | null;
  hold_expires_at?: string | null;
  pay_by?: string | null;
}

export interface CustomerSportsBookingDetail extends CustomerSportsBooking {
  customer_id: string;
  customer_name: string;
  owner_id: string;
  venue_id: string;
  resource_id: string;
  note: string;
  decision_reason: string;
  business_role?: 'owner' | 'manager' | 'staff';
}

export async function listMyCustomerSportsBookings(): Promise<CustomerSportsBooking[]> {
  const { data, error } = await supabase.rpc('list_my_customer_sports_bookings');
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerSportsBooking[];
}

export async function getCustomerSportsVenue(id: string): Promise<CustomerSportsVenue | null> {
  const { data, error } = await supabase.rpc('get_sports_venue', { p_id: id });
  if (error) throw new Error(error.message);
  return (data ?? null) as CustomerSportsVenue | null;
}

export async function getSportsSlots(resourceId: string, date: string): Promise<SportsSlotAvailability[]> {
  const { data, error } = await supabase.rpc('get_sports_slots', {
    p_resource_id: resourceId,
    p_date: date,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as SportsSlotAvailability[];
}

export async function bookSportsSlot(input: {
  resourceId: string;
  startsAt: string;
  slots: number;
  participants: number;
  paymentMode: SportsPaymentMode;
  note: string;
  idempotencyKey: string;
}): Promise<BookSlotResult> {
  const { data, error } = await supabase.rpc('book_sports_slot', {
    p_resource_id: input.resourceId,
    p_starts_at: input.startsAt,
    p_slots: input.slots,
    p_participants: input.participants,
    p_payment_mode: input.paymentMode,
    p_note: input.note,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('The server did not return a sports booking.');
  return data as BookSlotResult;
}

export async function getCustomerSportsBooking(id: string): Promise<CustomerSportsBookingDetail | null> {
  const { data, error } = await supabase.rpc('get_business_sports_booking', { p_id: id });
  if (error) throw new Error(error.message);
  return (data ?? null) as CustomerSportsBookingDetail | null;
}

export async function cancelSportsBooking(id: string, reason = ''): Promise<void> {
  const { error } = await supabase.rpc('cancel_sports_booking', { p_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
}

export async function previewSportsCancellation(id: string): Promise<SportsCancellationPreview> {
  const { data, error } = await supabase.rpc('preview_sports_cancellation', { p_id: id });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('The server did not return a cancellation preview.');
  return data as SportsCancellationPreview;
}

export async function decideSportsBooking(id: string, accept: boolean, reason = ''): Promise<void> {
  const { error } = await supabase.rpc('decide_sports_booking', {
    p_id: id,
    p_accept: accept,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export interface SportsPaymentLink {
  short_url: string;
  amount: number;
  purpose: string;
}

export async function createSportsPayment(sportsBookingId: string): Promise<SportsPaymentLink> {
  const { data, error } = await supabase.functions.invoke<SportsPaymentLink>('create-payment', {
    body: { kind: 'sports', booking_id: sportsBookingId },
  });
  if (error) throw new Error(error.message);
  if (!data?.short_url) throw new Error('No sports payment link returned.');
  return data;
}

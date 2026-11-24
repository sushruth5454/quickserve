import type { SportsBookingMode } from '../model';

export interface Activity {
  id: string;
  name: string;
  slug: string;
}

export interface Resource {
  id: string;
  name: string;
  activity_id: string;
  activity_name: string;
  slot_minutes: number;
  active: boolean;
  booking_mode?: SportsBookingMode;
  capacity?: number;
}

export interface ManagementVenue {
  venue: {
    id: string;
    owner_id: string;
    business_role?: 'owner' | 'manager' | 'staff';
    name: string;
    description: string;
    address_line: string;
    city: string;
    area: string;
    lat: number;
    lng: number;
    amenities: string[];
    photos: string[];
    status: string;
    status_reason: string;
    payment_modes?: ('online' | 'pay_at_venue')[];
  };
  payout_account_status?: string | null;
  payout_account_ready?: boolean;
  resources: Resource[];
  hours: { weekday: number; opens: string; closes: string }[];
  price_rules: { id: string; resource_id: string; weekday: number | null; starts: string; ends: string; price_paise: number; label: string }[];
  blocks: { id: string; resource_id: string; starts_at: string; ends_at: string; reason: string }[];
}

export interface SportsBookingRow {
  id: string;
  owner_id: string;
  venue_id: string;
  venue_name: string;
  resource_name: string;
  activity_name: string;
  customer_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price_paise: number;
  total_paise?: number;
  payment_mode?: 'online' | 'pay_at_venue';
  paid_at?: string | null;
  participants?: number | null;
  refund_paise?: number | null;
  expires_at?: string | null;
  hold_expires_at?: string | null;
  pay_by?: string | null;
}

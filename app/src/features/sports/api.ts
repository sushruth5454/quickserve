import { supabase } from '../../lib/supabase';

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
}

export async function listMyCustomerSportsBookings(): Promise<CustomerSportsBooking[]> {
  const { data, error } = await supabase.rpc('list_my_customer_sports_bookings');
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerSportsBooking[];
}

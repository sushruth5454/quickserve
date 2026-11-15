import { isDemoMode, sendMessage } from './api';
import { supabase } from './supabase';

export interface ChatSendResult {
  message_id: string;
  nudge: boolean;
}

const CONTACT_OR_PAYMENT =
  /(?:whats?\s*app|telegram|phonepe|gpay|paytm|upi|[6-9](?:[\s().-]*\d){9}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|pay\s+(?:me|directly|cash|outside)|direct\s+payment)/i;

export function needsLeakageNudge(body: string): boolean {
  return CONTACT_OR_PAYMENT.test(body);
}

export async function sendProtectedBookingMessage(bookingId: string, body: string): Promise<ChatSendResult> {
  if (isDemoMode) {
    await sendMessage(bookingId, body);
    return { message_id: '', nudge: needsLeakageNudge(body) };
  }
  const result = await supabase.rpc('send_booking_message', { p_booking_id: bookingId, p_body: body });
  if (result.error) throw new Error(result.error.message);
  return result.data as ChatSendResult;
}

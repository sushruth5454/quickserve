import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Records a captured Razorpay payment against the payments row whose razorpay_link_id holds the gateway reference
 * (a Razorpay order id, or a payment link id for links created before the switch to Orders). Idempotent: the record
 * RPCs ignore a Razorpay payment id they have already applied.
 * The legacy demo_settle_payment RPC remains a home-service booking path; sports payments use Razorpay checkout.
 */
export async function recordGatewayPayment(
  admin: SupabaseClient,
  reference: string,
  razorpayPaymentId: string,
  amount: number,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const { data: existing, error: lookupError } = await admin
    .from("payments")
    .select("sports_booking_id, pack_purchase_id, booking_id")
    .eq("razorpay_link_id", reference)
    .maybeSingle<{ sports_booking_id: string | null; pack_purchase_id: string | null; booking_id: string | null }>();
  if (lookupError) return { ok: false, error: lookupError.message };
  let archetype: string | null = null;
  if (existing?.booking_id) {
    const { data: booking, error } = await admin.from("bookings").select("archetype").eq("id", existing.booking_id)
      .maybeSingle<{ archetype: string }>();
    if (error) return { ok: false, error: error.message };
    archetype = booking?.archetype ?? null;
  }
  const sportsPayment = !!existing?.sports_booking_id;
  const recordRpc = sportsPayment
    ? "record_sports_payment_paid"
    : existing?.pack_purchase_id || archetype === "time_based"
    ? "record_time_payment_paid"
    : "record_payment_paid";
  const args = sportsPayment
    ? { p_order_id: reference, p_payment_id: razorpayPaymentId, p_amount: amount }
    : { p_link_id: reference, p_payment_id: razorpayPaymentId, p_amount: amount };
  const { data, error } = await admin.rpc(recordRpc, args);
  if (error) return { ok: false, error: error.message };
  if (data && (data as { ok?: boolean }).ok === false) {
    console.warn("payment not applied", reference, data);
    if (sportsPayment) {
      return {
        ok: false,
        error: String((data as { error?: unknown }).error ?? "sports payment was not applied"),
      };
    }
  }
  return { ok: true, result: data };
}

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Records a captured Razorpay payment against the payments row whose razorpay_link_id holds the gateway reference
 * (a Razorpay order id, or a payment link id for links created before the switch to Orders). Idempotent: the record
 * RPCs ignore a Razorpay payment id they have already applied.
 */
export async function recordGatewayPayment(
  admin: SupabaseClient,
  reference: string,
  razorpayPaymentId: string,
  amount: number,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const { data: existing } = await admin
    .from("payments")
    .select("pack_purchase_id, booking_id")
    .eq("razorpay_link_id", reference)
    .maybeSingle<{ pack_purchase_id: string | null; booking_id: string | null }>();
  let archetype: string | null = null;
  if (existing?.booking_id) {
    const { data: booking } = await admin.from("bookings").select("archetype").eq("id", existing.booking_id)
      .maybeSingle<{ archetype: string }>();
    archetype = booking?.archetype ?? null;
  }
  const recordRpc = existing?.pack_purchase_id || archetype === "time_based"
    ? "record_time_payment_paid"
    : "record_payment_paid";
  const { data, error } = await admin.rpc(recordRpc, {
    p_link_id: reference,
    p_payment_id: razorpayPaymentId,
    p_amount: amount,
  });
  if (error) return { ok: false, error: error.message };
  if (data && (data as { ok?: boolean }).ok === false) console.warn("payment not applied", reference, data);
  return { ok: true, result: data };
}

import { hmacSha256Hex, timingSafeEqual } from "../_shared/razorpay.ts";

export type VerificationOutcome =
  | "captured_applied"
  | "captured_refund_queued"
  | "review_required"
  | "confirmation_pending";

export async function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!orderId || !paymentId || !signature || !secret) return false;
  const expected = await hmacSha256Hex(secret, `${orderId}|${paymentId}`);
  return timingSafeEqual(signature, expected);
}

export function verificationOutcome(result: unknown): VerificationOutcome {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return "confirmation_pending";
  }

  const record = result as Record<string, unknown>;
  if (record.exception === true) return "review_required";
  if (record.refund === true) return "captured_refund_queued";
  if (record.ok === true) return "captured_applied";
  return "confirmation_pending";
}

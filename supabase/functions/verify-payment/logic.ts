import { hmacSha256Hex, timingSafeEqual } from "../_shared/razorpay.ts";

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

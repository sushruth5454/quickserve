import { hmacSha256Hex, timingSafeEqual } from "../_shared/razorpay.ts";

export async function verifyWebhook(rawBody: string, signature: string, secrets: string[]): Promise<boolean> {
  if (!signature) return false;
  for (const secret of secrets) {
    if (!secret) continue;
    if (timingSafeEqual(signature, await hmacSha256Hex(secret, rawBody))) return true;
  }
  return false;
}

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const RAZORPAY_API = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 15000;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

export class RazorpayError extends Error {
  /** HTTP status, or 0 for network errors/timeouts. */
  readonly status: number;
  /** True when the request may have been applied at Razorpay (timeout, network error, 5xx). */
  readonly ambiguous: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.ambiguous = status === 0 || status >= 500;
  }
}

export async function razorpayRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const keyId = requireEnv("RAZORPAY_KEY_ID");
  const keySecret = requireEnv("RAZORPAY_KEY_SECRET");
  let res: Response;
  try {
    res = await fetch(`${RAZORPAY_API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new RazorpayError(`Razorpay ${method} ${path} network error: ${e instanceof Error ? e.message : e}`, 0);
  }
  const text = await res.text();
  if (!res.ok) throw new RazorpayError(`Razorpay ${method} ${path} failed (${res.status}): ${text}`, res.status);
  return JSON.parse(text) as T;
}

export function razorpay<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  return razorpayRequest<T>("POST", path, body, extraHeaders);
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/**
 * Cancels payment links whose payments row was retired before being paid
 * (payments.cancel_link_pending). A 400 means the link is already paid/cancelled/expired, so it is
 * cleared too; a late payment on such a link is refunded by record_payment_paid.
 */
export async function cancelRetiredLinks(admin: SupabaseClient, bookingId: string | null = null): Promise<number> {
  const { data, error } = await admin.rpc("claim_link_cancellations", { p_booking_id: bookingId, p_limit: 50 });
  if (error) {
    console.error("claim_link_cancellations", error);
    return 0;
  }
  let cancelled = 0;
  for (const row of (data ?? []) as { payment_id: string; razorpay_link_id: string }[]) {
    try {
      // Orders can't be cancelled at Razorpay and demo-settled links never existed there; a late payment on a
      // retired order is refunded by record_payment_paid.
      if (!row.razorpay_link_id.startsWith("plink_demo_") && !row.razorpay_link_id.startsWith("order_")) {
        await razorpay(`/payment_links/${row.razorpay_link_id}/cancel`, {});
      }
    } catch (e) {
      if (!(e instanceof RazorpayError) || e.status !== 400) {
        console.error("link cancel will be retried", row.razorpay_link_id, e);
        continue;
      }
      console.warn("link not cancellable, clearing", row.razorpay_link_id, e.message);
    }
    const done = await admin.rpc("mark_link_cancelled", { p_payment_id: row.payment_id });
    if (done.error) console.error("mark_link_cancelled", done.error);
    else cancelled++;
  }
  return cancelled;
}

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface SportsPaymentRequest {
  bookingId: string;
  userId: string;
}

export interface LosingSportsOrder {
  bookingId: string;
  purpose: string;
  amount: number;
  orderId: string;
  shortUrl: string;
}

export interface CurrentSportsCheckout {
  short_url: string;
  amount: number;
  purpose: string;
}

export function paymentBookingRef(id: string): string {
  const compact = id.replace(/-/g, "").toUpperCase();
  return compact.startsWith("QS") ? `QS-${compact.slice(2, 10)}` : `QS-${compact.slice(0, 8)}`;
}

export function checkoutPurposeLabel(purpose: string): string {
  if (purpose === "visit_fee") return "Visit fee";
  if (purpose === "addon") return "Approved add-on";
  return "Job payment";
}

export function checkoutDescription(bookingRef: string, purposeLabel: string): string {
  return `Nearo · ${bookingRef} · ${purposeLabel}`;
}

export function buildCheckoutUrl(checkoutPageUrl: string, params: Record<string, string>): string {
  const url = new URL(checkoutPageUrl);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("CHECKOUT_PAGE_URL must be an HTTPS URL without embedded credentials");
  }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export function failedSportsPaymentAttempt(order: LosingSportsOrder) {
  return {
    sports_booking_id: order.bookingId,
    purpose: order.purpose,
    amount: order.amount,
    status: "failed" as const,
    razorpay_link_id: order.orderId,
    short_url: order.shortUrl,
  };
}

export async function recoverSportsCheckoutRace(
  losingOrder: LosingSportsOrder,
  persistFailedAttempt: (attempt: ReturnType<typeof failedSportsPaymentAttempt>) => Promise<void>,
  readCurrentCheckout: () => Promise<CurrentSportsCheckout | null>,
): Promise<CurrentSportsCheckout | null> {
  await persistFailedAttempt(failedSportsPaymentAttempt(losingOrder));
  const current = await readCurrentCheckout();
  return current && current.short_url.trim() ? current : null;
}

export function sportsPaymentPreparation(request: SportsPaymentRequest) {
  return {
    rpc: "prepare_sports_payment",
    args: { p_booking_id: request.bookingId, p_user_id: request.userId },
  } as const;
}

export function resolveSportsPaymentRequest(
  body: Record<string, unknown>,
  userId: string,
): SportsPaymentRequest | { error: string } | null {
  if (body.kind !== "sports") return null;
  if (typeof body.booking_id !== "string" || !body.booking_id) {
    return { error: "sports booking_id is required" };
  }
  if (typeof body.schedule_id === "string") {
    return { error: "sports payments do not support schedule_id" };
  }
  if (typeof body.pack_id === "string") {
    return { error: "sports payments do not support pack_id" };
  }
  return { bookingId: body.booking_id, userId };
}

export async function prepareSportsPaymentForAuthenticatedCustomer<
  TPrepared extends {
    amount: number;
    purpose: string;
    url?: string | null;
    short_url?: string | null;
  },
>(
  admin: Pick<SupabaseClient, "rpc">,
  body: Record<string, unknown>,
  authenticatedUserId: string,
) {
  const sportsRequest = resolveSportsPaymentRequest(body, authenticatedUserId);
  if (!sportsRequest) return { kind: "not_sports" as const };
  if ("error" in sportsRequest) {
    return { kind: "invalid_request" as const, error: sportsRequest.error };
  }

  const preparation = sportsPaymentPreparation(sportsRequest);
  const result = await admin.rpc(preparation.rpc, preparation.args).single<TPrepared>();
  return {
    kind: "prepared" as const,
    sportsRequest,
    prepared: result.data
      ? { ...result.data, short_url: result.data.url ?? null }
      : null,
    prepError: result.error,
  };
}

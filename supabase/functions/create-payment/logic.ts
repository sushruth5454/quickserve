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

export function sportsPaymentsEnabled(features: unknown): boolean {
  if (!features || typeof features !== "object") return false;
  const flags = features as Record<string, unknown>;
  return flags.sports === true && flags.sports_online_payments === true;
}

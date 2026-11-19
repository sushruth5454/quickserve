import type { ChargebackRpcClient } from "./chargeback.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function routeSportsPaymentFailed(
  admin: ChargebackRpcClient,
  input: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!isRecord(input) || input.event !== "payment.failed") {
    return { status: 400, body: { error: "unsupported payment event" } };
  }
  const payload = isRecord(input.payload) ? input.payload : null;
  const payment = payload && isRecord(payload.payment) ? payload.payment : null;
  const entity = payment && isRecord(payment.entity) ? payment.entity : null;
  const orderId = entity?.order_id;
  if (typeof orderId !== "string" || !orderId.trim()) {
    return { status: 400, body: { error: "missing payment order id" } };
  }

  const { data, error } = await admin.rpc("record_sports_payment_failed", { p_order_id: orderId });
  if (error || (isRecord(data) && data.ok === false)) {
    return { status: 500, body: { error: "sports payment failure could not be recorded" } };
  }
  return { status: 200, body: { received: true } };
}

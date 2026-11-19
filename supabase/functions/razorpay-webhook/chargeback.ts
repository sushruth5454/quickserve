// WP F6; owns: dispute/refund webhook routing; sources: WS6-T15, WS8-T09, WS8-T11.

export interface ChargebackRpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

interface RazorpayLifecycleEvent {
  event: string;
  payload?: {
    dispute?: { entity?: { payment_id?: unknown; amount?: unknown } };
    payment?: { entity?: { id?: unknown; amount?: unknown } };
    refund?: { entity?: { id?: unknown; status?: unknown; notes?: unknown } };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lifecycleEvent(value: unknown): RazorpayLifecycleEvent | null {
  if (!isRecord(value) || typeof value.event !== "string") return null;
  return value as RazorpayLifecycleEvent;
}

function invalidPayload() {
  return { status: 400, body: { error: "missing dispute or refund details" } };
}

export async function routeChargebackEvent(
  admin: ChargebackRpcClient,
  input: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const event = lifecycleEvent(input);
  if (!event) return invalidPayload();

  let fn: string;
  let args: Record<string, unknown>;
  if (
    event.event === "payment.dispute.created"
    || event.event === "payment.dispute.lost"
    || event.event === "payment.dispute.won"
  ) {
    const dispute = event.payload?.dispute?.entity;
    const payment = event.payload?.payment?.entity;
    const paymentId = typeof dispute?.payment_id === "string"
      ? dispute.payment_id
      : typeof payment?.id === "string" ? payment.id : "";
    const amount = typeof dispute?.amount === "number"
      ? dispute.amount
      : typeof payment?.amount === "number" ? payment.amount : NaN;
    if (!paymentId || !Number.isSafeInteger(amount) || amount <= 0) return invalidPayload();
    fn = "record_payment_dispute";
    args = {
      p_payment_id: paymentId,
      p_status: event.event.slice("payment.dispute.".length),
      p_amount: amount,
    };
  } else if (event.event === "refund.processed" || event.event === "refund.failed") {
    const refund = event.payload?.refund?.entity;
    if (typeof refund?.id !== "string" || !refund.id) return invalidPayload();
    fn = "record_refund_status";
    args = {
      p_razorpay_refund_id: refund.id,
      p_status: event.event.slice("refund.".length),
    };
    const notes = isRecord(refund.notes) ? refund.notes : null;
    const refundId = notes?.refund_id;
    if (
      typeof refundId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refundId)
    ) {
      args.p_refund_id = refundId;
    }
  } else {
    return { status: 400, body: { error: "unsupported lifecycle event" } };
  }

  const { error } = await admin.rpc(fn, args);
  if (error) return { status: 500, body: { error: "lifecycle update failed" } };
  return { status: 200, body: { received: true } };
}

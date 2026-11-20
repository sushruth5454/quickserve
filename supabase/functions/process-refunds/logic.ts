export interface StaleRefund {
  refund_id: string;
  payment_id: string;
  booking_id: string | null;
  razorpay_payment_id: string;
  amount: number;
  is_full: boolean;
  attempts: number;
}

export interface RazorpayRefund {
  id: string;
  notes?: Record<string, string>;
}

export interface RefundRpcResult {
  error: { message: string } | null;
}

export type StaleRefundResult = {
  refund_id: string;
  ok: boolean;
  action: "completed" | "requeued" | "deferred";
  error?: string;
};

export function isDemoRefund(refund: Pick<StaleRefund, "razorpay_payment_id">): boolean {
  return refund.razorpay_payment_id.startsWith("pay_demo_");
}

export function refundRequest(refund: StaleRefund) {
  return {
    path: `/payments/${refund.razorpay_payment_id}/refund`,
    body: {
      amount: refund.amount,
      speed: "normal" as const,
      receipt: refund.refund_id.slice(0, 40),
      notes: {
        refund_id: refund.refund_id,
        payment_id: refund.payment_id,
        booking_id: refund.booking_id,
      },
    },
    headers: { "X-Refund-Idempotency": refund.refund_id },
  };
}

async function applyRpc(
  refundId: string,
  action: "completed" | "requeued",
  invoke: () => Promise<RefundRpcResult>,
): Promise<StaleRefundResult> {
  try {
    const result = await invoke();
    return result.error
      ? { refund_id: refundId, ok: false, action: "deferred", error: result.error.message }
      : { refund_id: refundId, ok: true, action };
  } catch (error) {
    return {
      refund_id: refundId,
      ok: false,
      action: "deferred",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function reconcileStaleRefund(
  refund: StaleRefund,
  getRefunds: (paymentId: string) => Promise<RazorpayRefund[]>,
  complete: (refundId: string, gatewayRefundId: string) => Promise<RefundRpcResult>,
  requeue: (refundId: string) => Promise<RefundRpcResult>,
): Promise<StaleRefundResult> {
  if (isDemoRefund(refund)) {
    return await applyRpc(
      refund.refund_id,
      "completed",
      () => complete(refund.refund_id, `rfnd_demo_${refund.refund_id.slice(0, 20)}`),
    );
  }

  let refunds: RazorpayRefund[];
  try {
    refunds = await getRefunds(refund.razorpay_payment_id);
  } catch (error) {
    return {
      refund_id: refund.refund_id,
      ok: false,
      action: "deferred",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const match = refunds.find((candidate) => candidate.notes?.refund_id === refund.refund_id);
  if (match) {
    return await applyRpc(
      refund.refund_id,
      "completed",
      () => complete(refund.refund_id, match.id),
    );
  }

  return await applyRpc(
    refund.refund_id,
    "requeued",
    () => requeue(refund.refund_id),
  );
}

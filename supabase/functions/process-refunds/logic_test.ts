import { assertEquals } from "jsr:@std/assert@1";
import { isDemoRefund, reconcileStaleRefund, refundRequest, type StaleRefund } from "./logic.ts";

const row = (overrides: Partial<StaleRefund> = {}): StaleRefund => ({
  refund_id: "refund-1",
  payment_id: "payment-1",
  booking_id: "booking-1",
  razorpay_payment_id: "pay-1",
  amount: 12500,
  is_full: true,
  attempts: 1,
  ...overrides,
});

Deno.test("refund request builder preserves the payment amount and idempotency metadata", () => {
  assertEquals(refundRequest(row({
    refund_id: "refund-123",
    booking_id: null,
    amount: 12500,
    razorpay_payment_id: "pay-1",
  })), {
    path: "/payments/pay-1/refund",
    body: {
      amount: 12500,
      speed: "normal",
      receipt: "refund-123",
      notes: { refund_id: "refund-123", payment_id: "payment-1", booking_id: null },
    },
    headers: { "X-Refund-Idempotency": "refund-123" },
  });
  assertEquals(refundRequest(row({ refund_id: "r".repeat(48) })).body.receipt, "r".repeat(40));
});

Deno.test("demo refund detection matches only demo payment references", () => {
  assertEquals(isDemoRefund(row({ razorpay_payment_id: "pay_demo_123" })), true);
  assertEquals(isDemoRefund(row({ razorpay_payment_id: "pay_123" })), false);
});

Deno.test("stale refund found by notes.refund_id is completed with its gateway id", async () => {
  const completed: [string, string][] = [];
  const requeued: string[] = [];
  const result = await reconcileStaleRefund(
    row(),
    async (paymentId) => {
      assertEquals(paymentId, "pay-1");
      return [{ id: "rfnd-1", notes: { refund_id: "refund-1" } }];
    },
    async (refundId, gatewayId) => {
      completed.push([refundId, gatewayId]);
      return { error: null };
    },
    async (refundId) => {
      requeued.push(refundId);
      return { error: null };
    },
  );
  assertEquals(result, { refund_id: "refund-1", ok: true, action: "completed" });
  assertEquals(completed, [["refund-1", "rfnd-1"]]);
  assertEquals(requeued, []);
});

Deno.test("missing gateway refund is reset to pending for an idempotent retry", async () => {
  const requeued: string[] = [];
  const result = await reconcileStaleRefund(
    row(),
    async () => [],
    async () => ({ error: null }),
    async (refundId) => {
      requeued.push(refundId);
      return { error: null };
    },
  );
  assertEquals(result, { refund_id: "refund-1", ok: true, action: "requeued" });
  assertEquals(requeued, ["refund-1"]);
});

Deno.test("Razorpay lookup failure leaves the refund processing for a later poll", async () => {
  const writes: string[] = [];
  const result = await reconcileStaleRefund(
    row(),
    async () => {
      throw new Error("gateway unavailable");
    },
    async () => {
      writes.push("complete");
      return { error: null };
    },
    async () => {
      writes.push("requeue");
      return { error: null };
    },
  );
  assertEquals(result, {
    refund_id: "refund-1",
    ok: false,
    action: "deferred",
    error: "gateway unavailable",
  });
  assertEquals(writes, []);
});

Deno.test("refund-state RPC failure is deferred without crashing the reconciliation pass", async () => {
  const result = await reconcileStaleRefund(
    row(),
    async () => [{ id: "rfnd-1", notes: { refund_id: "refund-1" } }],
    async () => {
      throw new Error("database unavailable");
    },
    async () => ({ error: null }),
  );
  assertEquals(result, {
    refund_id: "refund-1",
    ok: false,
    action: "deferred",
    error: "database unavailable",
  });
});

Deno.test("demo refund completes without a gateway lookup", async () => {
  let gatewayLookups = 0;
  const completed: [string, string][] = [];
  const result = await reconcileStaleRefund(
    row({ razorpay_payment_id: "pay_demo_123" }),
    async () => {
      gatewayLookups++;
      return [];
    },
    async (refundId, gatewayId) => {
      completed.push([refundId, gatewayId]);
      return { error: null };
    },
    async () => ({ error: null }),
  );
  assertEquals(result, { refund_id: "refund-1", ok: true, action: "completed" });
  assertEquals(completed, [["refund-1", "rfnd_demo_refund-1"]]);
  assertEquals(gatewayLookups, 0);
});

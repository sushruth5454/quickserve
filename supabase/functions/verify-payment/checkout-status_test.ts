import { assertEquals } from "jsr:@std/assert@1";
import { paymentStatus } from "../../../web/checkout/payment-status.js";

const pending = {
  outcome: "confirmation_pending",
  tone: "pending",
  message: "Confirmation pending; return to your booking to check status.",
};

Deno.test("MN-CHECKOUT-UNVERIFIED never turns HTTP or transport failures into success", () => {
  for (const httpStatus of [401, 409, 500]) {
    assertEquals(
      paymentStatus({
        httpStatus,
        body: { ok: true, outcome: "captured_applied" },
      }),
      pending,
    );
  }

  assertEquals(paymentStatus({ transportError: true }), pending);
  assertEquals(paymentStatus({ httpStatus: 200, body: null }), pending);
  assertEquals(
    paymentStatus({
      httpStatus: 200,
      body: { ok: true, outcome: "unknown" },
    }),
    pending,
  );
});

Deno.test("checkout copy distinguishes applied, queued refund, and persisted exception outcomes", () => {
  assertEquals(
    paymentStatus({
      httpStatus: 200,
      body: { ok: true, outcome: "captured_applied" },
    }),
    {
      outcome: "captured_applied",
      tone: "success",
      message: "Payment confirmed. You can close this page and return to QuickServe.",
    },
  );
  assertEquals(
    paymentStatus({
      httpStatus: 200,
      body: { ok: true, outcome: "captured_refund_queued" },
    }),
    {
      outcome: "captured_refund_queued",
      tone: "warning",
      message: "Payment was captured; a refund is queued. Return to your booking to check status.",
    },
  );
  assertEquals(
    paymentStatus({
      httpStatus: 200,
      body: { ok: true, outcome: "review_required" },
    }),
    {
      outcome: "review_required",
      tone: "warning",
      message: "Payment was captured, but needs review. Return to your booking to check status.",
    },
  );
});

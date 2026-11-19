// WP F6; tests: dispute/refund webhook routing and retry behavior.

import { assertEquals } from "jsr:@std/assert@1";
import { routeChargebackEvent } from "./chargeback.ts";

function fakeAdmin(error: { message: string } | null = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    admin: {
      async rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return { data: null, error };
      },
    },
  };
}

Deno.test("chargeback and refund events route to their service RPCs", async () => {
  const cases = [
    {
      event: "payment.dispute.created",
      payload: { dispute: { entity: { payment_id: "pay_created", amount: 12000 } } },
      expected: { fn: "record_payment_dispute", args: { p_payment_id: "pay_created", p_status: "created", p_amount: 12000 } },
    },
    {
      event: "payment.dispute.lost",
      payload: { dispute: { entity: { payment_id: "pay_lost", amount: 12000 } } },
      expected: { fn: "record_payment_dispute", args: { p_payment_id: "pay_lost", p_status: "lost", p_amount: 12000 } },
    },
    {
      event: "payment.dispute.won",
      payload: { dispute: { entity: { payment_id: "pay_won", amount: 12000 } } },
      expected: { fn: "record_payment_dispute", args: { p_payment_id: "pay_won", p_status: "won", p_amount: 12000 } },
    },
    {
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_processed", status: "processed" } } },
      expected: { fn: "record_refund_status", args: { p_razorpay_refund_id: "rfnd_processed", p_status: "processed" } },
    },
    {
      event: "refund.failed",
      payload: {
        refund: {
          entity: {
            id: "rfnd_failed",
            status: "failed",
            notes: { refund_id: "00000000-0000-4000-8000-000000000001" },
          },
        },
      },
      expected: {
        fn: "record_refund_status",
        args: {
          p_razorpay_refund_id: "rfnd_failed",
          p_status: "failed",
          p_refund_id: "00000000-0000-4000-8000-000000000001",
        },
      },
    },
  ];

  const results = [];
  for (const testCase of cases) {
    const { admin, calls } = fakeAdmin();
    const result = await routeChargebackEvent(admin, testCase);
    results.push({ event: testCase.event, result, calls });
    assertEquals(result.status, 200, `event=${testCase.event}; actual=${JSON.stringify({ result, calls })}`);
    assertEquals(calls, [testCase.expected], `event=${testCase.event}; actual=${JSON.stringify({ result, calls })}`);
  }
});

Deno.test("chargeback and refund events reject incomplete payloads and surface RPC failures", async () => {
  const invalid = fakeAdmin();
  const invalidResult = await routeChargebackEvent(invalid.admin, {
    event: "payment.dispute.created",
    payload: { dispute: { entity: { amount: 500 } } },
  });
  assertEquals(
    { status: invalidResult.status, calls: invalid.calls },
    { status: 400, calls: [] },
    `missing payment id must not call an RPC; actual=${JSON.stringify({ invalidResult, calls: invalid.calls })}`,
  );

  const failing = fakeAdmin({ message: "database unavailable" });
  const failedResult = await routeChargebackEvent(failing.admin, {
    event: "refund.failed",
    payload: { refund: { entity: { id: "rfnd_retry", status: "failed" } } },
  });
  assertEquals(
    { status: failedResult.status, calls: failing.calls },
    {
      status: 500,
      calls: [{ fn: "record_refund_status", args: { p_razorpay_refund_id: "rfnd_retry", p_status: "failed" } }],
    },
    `RPC failures must request webhook retry; actual=${JSON.stringify({ failedResult, calls: failing.calls })}`,
  );
});

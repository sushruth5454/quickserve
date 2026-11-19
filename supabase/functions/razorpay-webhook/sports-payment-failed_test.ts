import { assertEquals } from "jsr:@std/assert@1";
import { routeSportsPaymentFailed } from "./sports-payment-failed.ts";

function fakeAdmin(error: { message: string } | null = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    admin: {
      async rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return { data: { ok: true }, error };
      },
    },
  };
}

Deno.test("sports payment.failed routes its order id to the failure recorder", async () => {
  const { admin, calls } = fakeAdmin();
  const result = await routeSportsPaymentFailed(admin, {
    event: "payment.failed",
    payload: { payment: { entity: { order_id: "order_sports_failed" } } },
  });
  assertEquals(result, { status: 200, body: { received: true } }, `actual=${JSON.stringify({ result, calls })}`);
  assertEquals(calls, [
    { fn: "record_sports_payment_failed", args: { p_order_id: "order_sports_failed" } },
  ], `actual=${JSON.stringify({ result, calls })}`);
});

Deno.test("sports payment.failed rejects missing order ids and requests retry on RPC failure", async () => {
  const missing = fakeAdmin();
  const missingResult = await routeSportsPaymentFailed(missing.admin, {
    event: "payment.failed",
    payload: { payment: { entity: {} } },
  });
  assertEquals(
    { status: missingResult.status, calls: missing.calls },
    { status: 400, calls: [] },
    `actual=${JSON.stringify({ missingResult, calls: missing.calls })}`,
  );

  const failing = fakeAdmin({ message: "database unavailable" });
  const failedResult = await routeSportsPaymentFailed(failing.admin, {
    event: "payment.failed",
    payload: { payment: { entity: { order_id: "order_sports_retry" } } },
  });
  assertEquals(
    { status: failedResult.status, calls: failing.calls },
    {
      status: 500,
      calls: [{
        fn: "record_sports_payment_failed",
        args: { p_order_id: "order_sports_retry" },
      }],
    },
    `actual=${JSON.stringify({ failedResult, calls: failing.calls })}`,
  );
});

import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { recordGatewayPayment } from "./record-payment.ts";

interface PaymentParents {
  sports_booking_id?: string | null;
  pack_purchase_id?: string | null;
  booking_id?: string | null;
}

function mockAdmin(row: PaymentParents, archetype: string | null = null, rpcResult: unknown = { ok: true }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const admin = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: table === "payments" ? row : archetype ? { archetype } : null,
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({ data: rpcResult, error: null });
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

Deno.test("sports payments use the sports recorder and its exact order-id contract", async () => {
  const { admin, calls } = mockAdmin({ sports_booking_id: "sports-booking" });
  const result = await recordGatewayPayment(admin, "order_1", "pay_1", 12500);
  assertEquals(result.ok, true);
  assertEquals(calls, [{
    fn: "record_sports_payment_paid",
    args: { p_order_id: "order_1", p_payment_id: "pay_1", p_amount: 12500 },
  }]);
});

Deno.test("existing pack, time-based, and fixed payments keep their recorder routes", async () => {
  const cases = [
    { parents: { pack_purchase_id: "pack" }, archetype: null, fn: "record_time_payment_paid" },
    { parents: { booking_id: "session" }, archetype: "time_based", fn: "record_time_payment_paid" },
    { parents: { booking_id: "booking" }, archetype: "fixed", fn: "record_payment_paid" },
  ];
  for (const testCase of cases) {
    const { admin, calls } = mockAdmin(testCase.parents, testCase.archetype);
    await recordGatewayPayment(admin, "order_1", "pay_1", 500);
    assertEquals(calls[0].fn, testCase.fn);
    assertEquals(calls[0].args, {
      p_link_id: "order_1",
      p_payment_id: "pay_1",
      p_amount: 500,
    });
  }
});

Deno.test("sports recorder rejection is returned to the webhook caller for retry", async () => {
  const { admin } = mockAdmin({ sports_booking_id: "sports-booking" }, null, { ok: false, error: "amount mismatch" });
  assertEquals(await recordGatewayPayment(admin, "order_1", "pay_1", 499), {
    ok: false,
    error: "amount mismatch",
  });
});

Deno.test("non-sports recorder rejection is returned to the webhook caller for retry", async () => {
  const { admin } = mockAdmin({ booking_id: "booking" }, "fixed", { ok: false, error: "unknown link" });
  assertEquals(await recordGatewayPayment(admin, "order_1", "pay_1", 500), {
    ok: false,
    error: "unknown link",
  });
});

Deno.test("persisted payment exception is logged and acknowledged", async () => {
  const { admin } = mockAdmin(
    { booking_id: "booking" },
    "fixed",
    { ok: false, error: "unknown link", exception: true },
  );
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    assertEquals(await recordGatewayPayment(admin, "order_1", "pay_1", 500), {
      ok: true,
      result: { ok: false, error: "unknown link", exception: true },
    });
  } finally {
    console.error = originalError;
  }
  assertEquals(logged.length, 1);
});

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { recordGatewayPayment } from "../_shared/record-payment.ts";
import {
  failedSportsPaymentAttempt,
  recoverSportsCheckoutRace,
  resolveSportsPaymentRequest,
  sportsPaymentPreparation,
  sportsPaymentsEnabled,
} from "./logic.ts";

Deno.test("sports checkout requires both the sports parent and online-payment switch", () => {
  assertEquals(sportsPaymentsEnabled({ sports: true, sports_online_payments: true }), true);
  assertEquals(sportsPaymentsEnabled({ sports: false, sports_online_payments: true }), false);
  assertEquals(sportsPaymentsEnabled({ sports: true, sports_online_payments: false }), false);
  assertEquals(sportsPaymentsEnabled(null), false);
});

Deno.test("sports payment preparation uses only the booking and authenticated user", () => {
  assertEquals(
    resolveSportsPaymentRequest({
      kind: "sports",
      booking_id: "sports-booking",
      amount: 1,
    }, "customer"),
    { bookingId: "sports-booking", userId: "customer" },
  );
  assertEquals(sportsPaymentPreparation({ bookingId: "sports-booking", userId: "customer" }), {
    rpc: "prepare_sports_payment",
    args: { p_booking_id: "sports-booking", p_user_id: "customer" },
  });
  assertEquals(resolveSportsPaymentRequest({ kind: "sports", pack_id: "pack" }, "customer"), {
    error: "sports booking_id is required",
  });
  assertEquals(resolveSportsPaymentRequest({ kind: "sports", booking_id: "sports-booking", schedule_id: "schedule" }, "customer"), {
    error: "sports payments do not support schedule_id",
  });
  assertEquals(resolveSportsPaymentRequest({ kind: "fixed", booking_id: "booking" }, "customer"), null);
});

Deno.test("losing sports checkout persists a failed order and routes its late capture through the sports recorder", async () => {
  const loser = {
    bookingId: "sports-booking",
    purpose: "fixed",
    amount: 12500,
    orderId: "order_loser",
    shortUrl: "https://checkout/loser",
  };
  const failedAttempt = failedSportsPaymentAttempt(loser);
  let persisted: typeof failedAttempt | null = null;
  const winner = await recoverSportsCheckoutRace(
    loser,
    async (row) => {
      persisted = row;
    },
    async () => ({ short_url: "https://checkout/winner", amount: 12500, purpose: "fixed" }),
  );
  assertEquals(persisted, failedAttempt);
  assertEquals(winner, { short_url: "https://checkout/winner", amount: 12500, purpose: "fixed" });

  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              sports_booking_id: failedAttempt.sports_booking_id,
              pack_purchase_id: null,
              booking_id: null,
            },
            error: null,
          }),
        }),
      }),
    }),
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({ data: { ok: true, refund: true }, error: null });
    },
  } as unknown as SupabaseClient;
  const recorded = await recordGatewayPayment(admin, failedAttempt.razorpay_link_id, "pay_late", failedAttempt.amount);
  assertEquals(recorded.result, { ok: true, refund: true });
  assertEquals(calls, [{
    fn: "record_sports_payment_paid",
    args: { p_order_id: "order_loser", p_payment_id: "pay_late", p_amount: 12500 },
  }]);
});

Deno.test("sports checkout race does not return a URL after a persistence or winner-read error", async () => {
  const loser = { bookingId: "sports-booking", purpose: "fixed", amount: 12500, orderId: "order_loser", shortUrl: "loser" };
  await assertRejects(() => recoverSportsCheckoutRace(loser, async () => {
    throw new Error("insert failed");
  }, async () => ({ short_url: "winner", amount: 12500, purpose: "fixed" })));
  await assertRejects(() => recoverSportsCheckoutRace(loser, async () => {}, async () => {
    throw new Error("winner lookup failed");
  }));
  assertEquals(await recoverSportsCheckoutRace(loser, async () => {}, async () => null), null);
});

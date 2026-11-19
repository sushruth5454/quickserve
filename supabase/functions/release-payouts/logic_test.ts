import { assertEquals } from "jsr:@std/assert@1";
import {
  alertOnStuckMoneyOps,
  findExistingTransfer,
  reconcileStaleTransfer,
  toReleaseRequest,
  type DueTransfer,
  type StaleProcessingTransfer,
} from "./logic.ts";

Deno.test("sports transfer release forwards the claim RPC's venue account and sports booking reference", () => {
  const transfer: DueTransfer = {
    transfer_id: "transfer",
    payout_id: "payout",
    booking_id: "sports-booking",
    provider_id: "venue-owner",
    amount: 9000,
    gross_amount: 10000,
    rail: "payouts",
    razorpay_payment_id: "pay_sports",
    account_id: null,
    fund_account_id: "fa_venue_owner",
    attempts: 0,
    idempotency_key: "transfer:0",
  };
  assertEquals(toReleaseRequest(transfer), {
    transferId: "transfer",
    payoutId: "payout",
    bookingId: "sports-booking",
    amount: 9000,
    attempts: 0,
    idempotencyKey: "transfer:0",
    razorpayPaymentId: "pay_sports",
    accountId: null,
    fundAccountId: "fa_venue_owner",
  });
});

Deno.test("provider transfers keep their existing resolved destination and booking reference", () => {
  const transfer: DueTransfer = {
    transfer_id: "transfer",
    payout_id: "payout",
    booking_id: "booking",
    provider_id: "provider",
    amount: 9000,
    gross_amount: 10000,
    rail: "route",
    razorpay_payment_id: "pay_provider",
    account_id: "acc_provider",
    fund_account_id: null,
    attempts: 1,
    idempotency_key: "transfer:1",
  };
  assertEquals(toReleaseRequest(transfer).accountId, "acc_provider");
  assertEquals(toReleaseRequest(transfer).bookingId, "booking");
});

Deno.test("stale Route transfer reconciliation polls by source payment and transfer note", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url: `${url.pathname}${url.search}`, authorization: new Headers(init?.headers).get("Authorization") });
    return Response.json({
      items: [{ id: "trf_recovered", notes: { transfer_id: "transfer_stale" }, status: "processed" }],
    });
  };
  const transfer: StaleProcessingTransfer = {
    transfer_id: "transfer_stale",
    source_payment_id: "payment_local",
    razorpay_payment_id: "pay_source",
    rail: "route",
  };

  const result = await findExistingTransfer(transfer, "test_key", "test_secret", fetcher);
  assertEquals(
    { result, calls },
    {
      result: { id: "trf_recovered", status: "processed" },
      calls: [{
        url: "/v1/payments/pay_source/transfers?count=100&skip=0",
        authorization: `Basic ${btoa("test_key:test_secret")}`,
      }],
    },
    `Route stale transfer must be looked up by source payment and transfer note; actual=${JSON.stringify({ result, calls })}`,
  );
});

Deno.test("stale RazorpayX payout reconciliation polls by transfer reference id", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url: `${url.pathname}${url.search}`, authorization: new Headers(init?.headers).get("Authorization") });
    return Response.json({ items: [{ id: "pout_recovered", reference_id: "transfer_payout", status: "processing" }] });
  };
  const transfer: StaleProcessingTransfer = {
    transfer_id: "transfer_payout",
    source_payment_id: "payment_local",
    razorpay_payment_id: "pay_source",
    rail: "payouts",
  };

  const result = await findExistingTransfer(transfer, "test_key", "test_secret", fetcher);
  assertEquals(
    { result, calls },
    {
      result: { id: "pout_recovered", status: "processing" },
      calls: [{
        url: "/v1/payouts?reference_id=transfer_payout&count=100&skip=0",
        authorization: `Basic ${btoa("test_key:test_secret")}`,
      }],
    },
    `RazorpayX stale payout must be looked up by transfer reference id; actual=${JSON.stringify({ result, calls })}`,
  );
});

Deno.test("stale transfer reconciliation completes a found gateway transfer", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const admin = {
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return { data: null, error: null };
    },
  };
  const transfer: StaleProcessingTransfer = {
    transfer_id: "transfer_complete",
    source_payment_id: "payment_local",
    razorpay_payment_id: "pay_source",
    rail: "route",
  };
  const action = await reconcileStaleTransfer(
    admin,
    transfer,
    "test_key",
    "test_secret",
    async () => Response.json({
      items: [{ id: "trf_recovered", notes: { transfer_id: "transfer_complete" }, status: "processed" }],
    }),
  );
  assertEquals(
    { action, calls },
    {
      action: "completed",
      calls: [{
        fn: "complete_transfer",
        args: { p_transfer_id: "transfer_complete", p_razorpay_transfer_id: "trf_recovered" },
      }],
    },
    `found stale transfer must be recorded with the gateway id; actual=${JSON.stringify({ action, calls })}`,
  );
});

Deno.test("stale transfer reconciliation resets an absent gateway transfer", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const admin = {
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return { data: null, error: null };
    },
  };
  const transfer: StaleProcessingTransfer = {
    transfer_id: "transfer_reset",
    source_payment_id: "payment_local",
    razorpay_payment_id: "pay_source",
    rail: "route",
  };
  const action = await reconcileStaleTransfer(
    admin,
    transfer,
    "test_key",
    "test_secret",
    async () => Response.json({ items: [] }),
  );
  assertEquals(
    { action, calls },
    {
      action: "reset",
      calls: [{ fn: "reset_stale_processing_transfer", args: { p_transfer_id: "transfer_reset" } }],
    },
    `absent stale transfer must be reset for a guarded retry; actual=${JSON.stringify({ action, calls })}`,
  );
});

Deno.test("stale reconciliation never marks a failed gateway payout as transferred", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const admin = {
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return { data: null, error: null };
    },
  };
  const transfer: StaleProcessingTransfer = {
    transfer_id: "transfer_failed",
    source_payment_id: "payment_local",
    razorpay_payment_id: "pay_source",
    rail: "payouts",
  };
  const action = await reconcileStaleTransfer(
    admin,
    transfer,
    "test_key",
    "test_secret",
    async () => Response.json({
      items: [{ id: "pout_failed", reference_id: "transfer_failed", status: "failed" }],
    }),
  );
  assertEquals(
    { action, calls },
    {
      action: "failed",
      calls: [{
        fn: "fail_transfer",
        args: { p_transfer_id: "transfer_failed", p_error: "Razorpay transfer status failed" },
      }],
    },
    `failed gateway payout must be retried/flagged, never marked transferred; actual=${JSON.stringify({ action, calls })}`,
  );
});

Deno.test("payout runner logs and returns the number of stuck money operations", () => {
  const calls: unknown[][] = [];
  const stuck = [{ operation_type: "transfer", operation_id: "transfer_stuck" }];
  const result = alertOnStuckMoneyOps(stuck, (...args: unknown[]) => calls.push(args));
  assertEquals(
    { result, calls },
    { result: { reconciliation_count: 1 }, calls: [["RECONCILE", stuck]] },
    `stuck money alert output must include count and log details; actual=${JSON.stringify({ result, calls })}`,
  );

  const cleanCalls: unknown[][] = [];
  const clean = alertOnStuckMoneyOps([], (...args: unknown[]) => cleanCalls.push(args));
  assertEquals(
    { result: clean, calls: cleanCalls },
    { result: { reconciliation_count: 0 }, calls: [] },
    `clean payout run must report zero without emitting a false alert; actual=${JSON.stringify({ result: clean, calls: cleanCalls })}`,
  );
});

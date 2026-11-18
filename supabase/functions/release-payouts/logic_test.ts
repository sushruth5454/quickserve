import { assertEquals } from "jsr:@std/assert@1";
import { toReleaseRequest, type DueTransfer } from "./logic.ts";

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

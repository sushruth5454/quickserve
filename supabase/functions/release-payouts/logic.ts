import type { RailName } from "../_shared/payout-rail.ts";

export interface DueTransfer {
  transfer_id: string;
  payout_id: string;
  booking_id: string;
  // Migration 0058 aliases coalesce(payout.provider_id, payout.payee_id) into this RPC column.
  provider_id: string;
  amount: number;
  gross_amount: number;
  rail: RailName;
  razorpay_payment_id: string | null;
  account_id: string | null;
  fund_account_id: string | null;
  attempts: number;
  idempotency_key: string;
}

export function toReleaseRequest(t: DueTransfer) {
  return {
    transferId: t.transfer_id,
    payoutId: t.payout_id,
    bookingId: t.booking_id,
    amount: t.amount,
    attempts: t.attempts,
    idempotencyKey: t.idempotency_key,
    razorpayPaymentId: t.razorpay_payment_id,
    accountId: t.account_id,
    fundAccountId: t.fund_account_id,
  };
}

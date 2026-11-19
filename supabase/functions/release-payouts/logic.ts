import type { RailName } from "../_shared/payout-rail.ts";

export interface StaleProcessingTransfer {
  transfer_id: string;
  source_payment_id: string;
  razorpay_payment_id: string | null;
  rail: RailName;
}

export interface ExistingGatewayTransfer {
  id: string;
  status?: string;
}

export interface StuckMoneyOperation {
  operation_type: string;
  operation_id: string;
  booking_id: string | null;
  amount: number;
  status: string;
  age_minutes: number;
  last_error: string | null;
}

export interface TransferReconciliationRpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

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

export async function findExistingTransfer(
  transfer: StaleProcessingTransfer,
  keyId: string,
  keySecret: string,
  fetcher: typeof fetch = fetch,
): Promise<ExistingGatewayTransfer | null> {
  if (transfer.rail === "route" && !transfer.razorpay_payment_id) return null;
  const path = transfer.rail === "route"
    ? `/v1/payments/${encodeURIComponent(transfer.razorpay_payment_id!)}/transfers`
    : `/v1/payouts?reference_id=${encodeURIComponent(transfer.transfer_id)}`;
  const authorization = `Basic ${btoa(`${keyId}:${keySecret}`)}`;

  for (let skip = 0; ; skip += 100) {
    const url = new URL(`https://api.razorpay.com${path}`);
    url.searchParams.set("count", "100");
    url.searchParams.set("skip", String(skip));
    const response = await fetcher(url, {
      method: "GET",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Razorpay transfer lookup failed (${response.status}): ${body.slice(0, 300)}`);
    }

    let items: Record<string, unknown>[];
    try {
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed?.items)) throw new Error("missing items");
      items = parsed.items;
    } catch (error) {
      throw new Error(`Razorpay transfer lookup returned invalid JSON: ${error instanceof Error ? error.message : error}`);
    }

    const match = transfer.rail === "route"
      ? items.find((item) => {
        const notes = item.notes;
        return !Array.isArray(notes)
          && typeof notes === "object"
          && notes !== null
          && (notes as Record<string, unknown>).transfer_id === transfer.transfer_id;
      })
      : items.find((item) => item.reference_id === transfer.transfer_id);
    if (match && typeof match.id === "string" && match.id) {
      return { id: match.id, status: typeof match.status === "string" ? match.status : undefined };
    }
    if (items.length < 100) return null;
  }
}

export async function reconcileStaleTransfer(
  admin: TransferReconciliationRpcClient,
  transfer: StaleProcessingTransfer,
  keyId: string,
  keySecret: string,
  fetcher: typeof fetch = fetch,
): Promise<"completed" | "reset" | "failed"> {
  const existing = await findExistingTransfer(transfer, keyId, keySecret, fetcher);
  if (existing?.status && ["failed", "reversed", "rejected", "cancelled"].includes(existing.status)) {
    const failed = await admin.rpc("fail_transfer", {
      p_transfer_id: transfer.transfer_id,
      p_error: `Razorpay transfer status ${existing.status}`,
    });
    if (failed.error) throw new Error(failed.error.message);
    return "failed";
  }
  if (existing?.status === "partially_reversed") {
    throw new Error("Razorpay transfer is partially reversed; manual reconciliation is required");
  }
  if (
    existing?.status
    && !["created", "pending", "processed", "queued", "processing", "initiated", "attempted", "transferred", "success", "completed"].includes(existing.status)
  ) {
    throw new Error(`Unknown Razorpay transfer status ${existing.status}; manual reconciliation is required`);
  }

  const result = existing
    ? await admin.rpc("complete_transfer", {
      p_transfer_id: transfer.transfer_id,
      p_razorpay_transfer_id: existing.id,
    })
    : await admin.rpc("reset_stale_processing_transfer", { p_transfer_id: transfer.transfer_id });
  if (result.error) throw new Error(result.error.message);
  return existing ? "completed" : "reset";
}

export function alertOnStuckMoneyOps(
  operations: StuckMoneyOperation[],
  log: (...args: unknown[]) => void = console.error,
): { reconciliation_count: number } {
  if (operations.length > 0) log("RECONCILE", operations);
  return { reconciliation_count: operations.length };
}

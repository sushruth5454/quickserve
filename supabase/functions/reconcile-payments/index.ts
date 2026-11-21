// WP F6; owns: daily gateway reconciliation Edge Function; sources: WS6-T16.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { json, requireEnv, timingSafeEqual } from "../_shared/razorpay.ts";
import {
  collectGatewayRecords,
  compareGatewayAndLocal,
  localGatewayRecord,
  type LocalSnapshot,
} from "./logic.ts";

const LOCAL_PAGE_SIZE = 1000;

interface PaymentRow {
  id: string;
  razorpay_payment_id: string | null;
  amount: number;
}

interface RefundRow {
  id: string;
  razorpay_refund_id: string | null;
  amount: number;
}

interface TransferRow {
  id: string;
  razorpay_transfer_id: string | null;
  amount: number;
  recovered_amount: number | null;
}

function previousUtcDay(now: Date): { date: string; from: number; to: number; start: string; end: string } {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startMs = todayStart - 24 * 60 * 60 * 1000;
  const endMs = todayStart;
  return {
    date: new Date(startMs).toISOString().slice(0, 10),
    from: Math.floor(startMs / 1000),
    to: Math.floor(endMs / 1000),
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

async function fetchPages<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += LOCAL_PAGE_SIZE) {
    const { data, error } = await makeQuery(offset, offset + LOCAL_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < LOCAL_PAGE_SIZE) return rows;
  }
}

async function fetchByValues<T>(
  values: string[],
  makeQuery: (
    values: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; start < values.length; start += 500) {
    const batch = values.slice(start, start + 500);
    rows.push(...await fetchPages((from, to) => makeQuery(batch, from, to)));
  }
  return rows;
}

function uniqueRows<T extends { id: string }>(...groups: T[][]): T[] {
  const byId = new Map<string, T>();
  for (const row of groups.flat()) byId.set(row.id, row);
  return [...byId.values()];
}

async function loadLocalSnapshot(
  admin: SupabaseClient,
  start: string,
  end: string,
  gateway: Awaited<ReturnType<typeof collectGatewayRecords>>,
): Promise<LocalSnapshot> {
  const [paymentsByGatewayId, paymentsByPaidAt, refundsByGatewayId, refundsByProcessedAt,
    transfersByGatewayId, transfersByReferenceId, transfersByTransferredAt] = await Promise.all([
    fetchByValues(gateway.payments.map((row) => row.id), (values, from, to) => admin
      .from("payments")
      .select("id,razorpay_payment_id,amount")
      .in("razorpay_payment_id", values)
      .range(from, to)),
    fetchPages<PaymentRow>((from, to) => admin
      .from("payments")
      .select("id,razorpay_payment_id,amount")
      .gte("paid_at", start)
      .lt("paid_at", end)
      .not("razorpay_payment_id", "is", null)
      .range(from, to)),
    fetchByValues(gateway.refunds.map((row) => row.id), (values, from, to) => admin
      .from("refunds")
      .select("id,razorpay_refund_id,amount")
      .in("razorpay_refund_id", values)
      .range(from, to)),
    fetchPages<RefundRow>((from, to) => admin
      .from("refunds")
      .select("id,razorpay_refund_id,amount")
      .eq("status", "refunded")
      .gte("processed_at", start)
      .lt("processed_at", end)
      .not("razorpay_refund_id", "is", null)
      .range(from, to)),
    fetchByValues(gateway.payouts.map((row) => row.id), (values, from, to) => admin
      .from("payout_transfers")
      .select("id,razorpay_transfer_id,amount,recovered_amount")
      .eq("rail", "payouts")
      .in("razorpay_transfer_id", values)
      .range(from, to)),
    fetchByValues(
      gateway.payouts.flatMap((row) => row.reference_id ? [row.reference_id] : []),
      (values, from, to) => admin
        .from("payout_transfers")
        .select("id,razorpay_transfer_id,amount,recovered_amount")
        .eq("rail", "payouts")
        .in("id", values)
        .range(from, to),
    ),
    fetchPages<TransferRow>((from, to) => admin
      .from("payout_transfers")
      .select("id,razorpay_transfer_id,amount,recovered_amount")
      .eq("rail", "payouts")
      .in("status", ["transferred", "failed"])
      .gte("transferred_at", start)
      .lt("transferred_at", end)
      .range(from, to)),
  ]);
  const payments = uniqueRows(paymentsByGatewayId, paymentsByPaidAt);
  const refunds = uniqueRows(refundsByGatewayId, refundsByProcessedAt);
  const transfers = uniqueRows(
    transfersByGatewayId,
    transfersByReferenceId,
    transfersByTransferredAt,
  );

  const paymentRecords = payments.flatMap((row) => {
    const record = localGatewayRecord("payment", row);
    return record ? [record] : [];
  });
  const refundRecords = refunds.flatMap((row) => {
    const record = localGatewayRecord("refund", row);
    return record ? [record] : [];
  });
  const payoutRecords = transfers.flatMap((row) => {
    const record = localGatewayRecord("payout", row);
    return record ? [record] : [];
  });

  return {
    payments: paymentRecords,
    refunds: refundRecords,
    payouts: payoutRecords,
  };
}

async function reconcilePreviousDay(admin: SupabaseClient, now = new Date()) {
  const window = previousUtcDay(now);
  const gateway = await collectGatewayRecords({
    from: window.from,
    to: window.to,
    keyId: requireEnv("RAZORPAY_KEY_ID"),
    keySecret: requireEnv("RAZORPAY_KEY_SECRET"),
  });
  const local = await loadLocalSnapshot(admin, window.start, window.end, gateway);
  const issues = compareGatewayAndLocal(window.date, gateway, local);
  const { data: saved, error } = await admin.rpc("save_reconciliation_report", {
    p_run_date: window.date,
    p_issues: issues,
  });
  if (error) throw new Error(error.message);
  return {
    run_date: window.date,
    checked: {
      payments: gateway.payments.length,
      refunds: gateway.refunds.length,
      payouts: gateway.payouts.length,
    },
    mismatch_count: issues.length,
    issues_saved: saved ?? 0,
    issues,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!timingSafeEqual(secret, requireEnv("CRON_SECRET"))) return json({ error: "unauthorized" }, 401);

  const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  try {
    return json(await reconcilePreviousDay(admin));
  } catch (error) {
    console.error("daily payment reconciliation failed", error instanceof Error ? error.message : String(error));
    return json({ error: "daily reconciliation failed" }, 500);
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  cancelRetiredLinks,
  json,
  razorpay,
  razorpayRequest,
  requireEnv,
  timingSafeEqual,
} from "../_shared/razorpay.ts";

interface DueTransfer {
  transfer_id: string;
  payout_id: string;
  booking_id: string;
  amount: number;
  razorpay_payment_id: string;
  account_id: string;
  attempts: number;
}

interface TransferCollection {
  items: { id: string; notes?: Record<string, string> | unknown[] }[];
}

/** Finds a transfer created by an earlier (possibly timed-out) attempt via notes.transfer_id. */
async function findExistingTransfer(t: DueTransfer): Promise<string | null> {
  const res = await razorpayRequest<TransferCollection>("GET", `/payments/${t.razorpay_payment_id}/transfers`);
  const match = (res.items ?? []).find(
    (item) => !Array.isArray(item.notes) && item.notes?.transfer_id === t.transfer_id,
  );
  return match?.id ?? null;
}

// Cron entry point: see README "Scheduled jobs".
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!timingSafeEqual(secret, requireEnv("CRON_SECRET"))) return json({ error: "unauthorized" }, 401);

  const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const expired = await admin.rpc("expire_stale_requests");
  if (expired.error) console.error("expire_stale_requests", expired.error);
  const confirmed = await admin.rpc("auto_confirm_completions");
  if (confirmed.error) console.error("auto_confirm_completions", confirmed.error);
  const linksCancelled = await cancelRetiredLinks(admin);

  const { data: due, error } = await admin.rpc("claim_due_transfers", { p_limit: 50 });
  if (error) return json({ error: error.message }, 500);

  const results: { transfer_id: string; ok: boolean; error?: string }[] = [];
  for (const t of (due ?? []) as DueTransfer[]) {
    let transferId: string | null = null;
    try {
      // A previous attempt may have succeeded at Razorpay even though we saw an error (e.g. timeout).
      if (t.attempts > 0) transferId = await findExistingTransfer(t);
      if (!transferId) {
        const res = await razorpay<TransferCollection>(`/payments/${t.razorpay_payment_id}/transfers`, {
          transfers: [
            {
              account: t.account_id,
              amount: t.amount,
              currency: "INR",
              notes: { booking_id: t.booking_id, payout_id: t.payout_id, transfer_id: t.transfer_id },
            },
          ],
        });
        transferId = res.items?.[0]?.id ?? null;
        if (!transferId) throw new Error("no transfer id in response");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("transfer attempt failed", t.transfer_id, message);
      const failed = await admin.rpc("fail_transfer", { p_transfer_id: t.transfer_id, p_error: message });
      if (failed.error) console.error("fail_transfer", failed.error);
      results.push({ transfer_id: t.transfer_id, ok: false, error: message });
      continue;
    }
    // The money has moved; if recording fails the row stays 'processing' for reconciliation (never re-POSTed blindly).
    const done = await admin.rpc("complete_transfer", {
      p_transfer_id: t.transfer_id,
      p_razorpay_transfer_id: transferId,
    });
    if (done.error) console.error("complete_transfer failed; needs reconciliation", t.transfer_id, transferId, done.error);
    results.push({ transfer_id: t.transfer_id, ok: !done.error });
  }

  return json({
    expired: expired.data ?? 0,
    auto_confirmed: confirmed.data ?? 0,
    links_cancelled: linksCancelled,
    processed: results.length,
    results,
  });
});

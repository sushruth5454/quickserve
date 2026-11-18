import { createClient } from "npm:@supabase/supabase-js@2";
import { cancelRetiredLinks, json, requireEnv, timingSafeEqual } from "../_shared/razorpay.ts";
import { type RailName } from "../_shared/payout-rail.ts";
import { PAYOUT_ACCOUNT_COLUMNS, railsFromEnv, refreshBeneficiary, type PayoutAccountRow } from "../_shared/payout-beneficiary.ts";
import { toReleaseRequest, type DueTransfer } from "./logic.ts";

interface DueReversal {
  reversal_id: string;
  transfer_id: string;
  booking_id: string;
  amount: number;
  rail: RailName;
  razorpay_transfer_id: string;
  attempts: number;
}

// Cron entry point: see README "Scheduled jobs". Each payout_transfers row is released on the rail snapshotted when it
// was created (docs/03 §5.1); receivables were already netted by claim_due_transfers.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!timingSafeEqual(secret, requireEnv("CRON_SECRET"))) return json({ error: "unauthorized" }, 401);

  const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const rails = railsFromEnv();

  const expired = await admin.rpc("expire_stale_requests");
  if (expired.error) console.error("expire_stale_requests", expired.error);
  const confirmed = await admin.rpc("auto_confirm_completions");
  if (confirmed.error) console.error("auto_confirm_completions", confirmed.error);
  const linksCancelled = await cancelRetiredLinks(admin);

  // Resume beneficiary verifications that were blocked while the gateway product was unavailable.
  let resumed = 0;
  const { data: blocked } = await admin
    .from("provider_payout_accounts")
    .select(PAYOUT_ACCOUNT_COLUMNS)
    .eq("last_error", "gateway_unavailable")
    .limit(10);
  for (const row of (blocked ?? []) as PayoutAccountRow[]) {
    try {
      const r = await refreshBeneficiary(admin, rails, row);
      if (r.state === "updated") resumed++;
      if (r.state === "unavailable") break; // still unavailable for everyone; try again next run
    } catch (e) {
      console.error("resume beneficiary failed", row.provider_id, e instanceof Error ? e.message : e);
    }
  }

  // C9: customer refunds already run independently. Released Route tranches are reversed best-effort;
  // unresolved amounts become provider receivables after bounded retries. A retry polls by reversal_id first.
  const { data: dueReversals, error: reversalError } = await admin.rpc("claim_due_transfer_reversals", { p_limit: 50 });
  if (reversalError) console.error("claim_due_transfer_reversals", reversalError);
  let reversalsProcessed = 0;
  for (const r of (dueReversals ?? []) as DueReversal[]) {
    try {
      const reversalExternalId = await rails[r.rail].reverse(
        r.razorpay_transfer_id,
        r.amount,
        r.reversal_id,
      );
      const done = await admin.rpc("complete_transfer_reversal", {
        p_reversal_id: r.reversal_id,
        p_razorpay_reversal_id: reversalExternalId,
      });
      if (done.error) throw new Error(done.error.message);
      reversalsProcessed++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("reversal attempt failed", r.transfer_id, message);
      const failed = await admin.rpc("fail_transfer_reversal", {
        p_reversal_id: r.reversal_id,
        p_error: message,
      });
      if (failed.error) console.error("fail_transfer_reversal", failed.error);
    }
  }

  const { data: due, error } = await admin.rpc("claim_due_transfers", { p_limit: 50 });
  if (error) return json({ error: error.message }, 500);

  // Migration 0058 resolves both the payee account and the booking reference for sports payouts in claim_due_transfers.
  const results: { transfer_id: string; rail: RailName; ok: boolean; error?: string }[] = [];
  for (const t of (due ?? []) as DueTransfer[]) {
    let externalId: string;
    try {
      const r = await rails[t.rail].release(toReleaseRequest(t));
      externalId = r.externalId;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("release attempt failed", t.rail, t.transfer_id, message);
      const failed = await admin.rpc("fail_transfer", { p_transfer_id: t.transfer_id, p_error: message });
      if (failed.error) console.error("fail_transfer", failed.error);
      results.push({ transfer_id: t.transfer_id, rail: t.rail, ok: false, error: message });
      continue;
    }
    // The money has moved (or is queued at the gateway); if recording fails the row stays 'processing' for
    // reconciliation and is never re-sent blindly.
    const done = await admin.rpc("complete_transfer", { p_transfer_id: t.transfer_id, p_razorpay_transfer_id: externalId });
    if (done.error) console.error("complete_transfer failed; needs reconciliation", t.transfer_id, externalId, done.error);
    results.push({ transfer_id: t.transfer_id, rail: t.rail, ok: !done.error });
  }

  return json({
    expired: expired.data ?? 0,
    auto_confirmed: confirmed.data ?? 0,
    links_cancelled: linksCancelled,
    beneficiaries_resumed: resumed,
    reversals_processed: reversalsProcessed,
    processed: results.length,
    results,
  });
});

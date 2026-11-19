import { createClient } from "npm:@supabase/supabase-js@2";
import {
  cancelRetiredLinks,
  json,
  razorpay,
  razorpayRequest,
  requireEnv,
  timingSafeEqual,
} from "../_shared/razorpay.ts";
import {
  reconcileStaleRefund,
  type StaleRefund,
  type StaleRefundResult,
} from "./logic.ts";

type DueRefund = StaleRefund;

interface RazorpayRefundList {
  items?: { id: string; notes?: Record<string, string> }[];
}

// Cron entry point: see README "Scheduled jobs".
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!timingSafeEqual(secret, requireEnv("CRON_SECRET"))) return json({ error: "unauthorized" }, 401);

  const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const linksCancelled = await cancelRetiredLinks(admin);

  const { data: stale, error: staleError } = await admin.rpc(
    "claim_stale_processing_refunds",
    { p_older_than: "30 minutes" },
  );
  if (staleError) return json({ error: staleError.message }, 500);
  const staleResults: StaleRefundResult[] = [];
  for (const r of (stale ?? []) as DueRefund[]) {
    const result = await reconcileStaleRefund(
      r,
      async (paymentId) => {
        const page = await razorpayRequest<RazorpayRefundList>(
          "GET",
          `/payments/${paymentId}/refunds`,
        );
        return page.items ?? [];
      },
      async (refundId, gatewayRefundId) =>
        await admin.rpc("complete_refund", {
          p_refund_id: refundId,
          p_razorpay_refund_id: gatewayRefundId,
        }),
      async (refundId) =>
        await admin.rpc("requeue_stale_processing_refund", { p_refund_id: refundId }),
    );
    if (!result.ok) console.error("stale refund reconciliation deferred", result.refund_id, result.error);
    staleResults.push(result);
  }

  const { data: due, error } = await admin.rpc("claim_due_refunds", { p_limit: 50 });
  if (error) return json({ error: error.message }, 500);

  const results: { refund_id: string; ok: boolean; error?: string }[] = [];
  for (const r of (due ?? []) as DueRefund[]) {
    let razorpayRefundId: string;
    if (r.razorpay_payment_id.startsWith("pay_demo_")) {
      // Demo-settled payments (demo_settle_payment) moved no money, so there is nothing to refund at Razorpay.
      const done = await admin.rpc("complete_refund", { p_refund_id: r.refund_id, p_razorpay_refund_id: `rfnd_demo_${r.refund_id.slice(0, 20)}` });
      if (done.error) console.error("complete_refund (demo)", r.refund_id, done.error);
      results.push({ refund_id: r.refund_id, ok: !done.error });
      continue;
    }
    try {
      // X-Refund-Idempotency makes retries of the same refund row safe even after an ambiguous failure.
      const res = await razorpay<{ id: string }>(
        `/payments/${r.razorpay_payment_id}/refund`,
        {
          amount: r.amount,
          speed: "normal",
          receipt: r.refund_id.slice(0, 40),
          notes: { refund_id: r.refund_id, payment_id: r.payment_id, booking_id: r.booking_id },
        },
        { "X-Refund-Idempotency": r.refund_id },
      );
      razorpayRefundId = res.id;
      if (!razorpayRefundId) throw new Error("no refund id in response");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("refund attempt failed", r.refund_id, message);
      const failed = await admin.rpc("fail_refund", { p_refund_id: r.refund_id, p_error: message });
      if (failed.error) console.error("fail_refund", failed.error);
      results.push({ refund_id: r.refund_id, ok: false, error: message });
      continue;
    }
    const done = await admin.rpc("complete_refund", {
      p_refund_id: r.refund_id,
      p_razorpay_refund_id: razorpayRefundId,
    });
    if (done.error) console.error("complete_refund failed; needs reconciliation", r.refund_id, razorpayRefundId, done.error);
    results.push({ refund_id: r.refund_id, ok: !done.error });
  }

  return json({
    links_cancelled: linksCancelled,
    stale_checked: staleResults.length,
    stale_results: staleResults,
    processed: results.length,
    results,
  });
});

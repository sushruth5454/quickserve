import { createClient } from "npm:@supabase/supabase-js@2";
import { cancelRetiredLinks, json, razorpay, requireEnv, timingSafeEqual } from "../_shared/razorpay.ts";

interface DueRefund {
  refund_id: string;
  payment_id: string;
  booking_id: string;
  razorpay_payment_id: string;
  amount: number;
  is_full: boolean;
  attempts: number;
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

  const { data: due, error } = await admin.rpc("claim_due_refunds", { p_limit: 50 });
  if (error) return json({ error: error.message }, 500);

  const results: { refund_id: string; ok: boolean; error?: string }[] = [];
  for (const r of (due ?? []) as DueRefund[]) {
    let razorpayRefundId: string;
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

  return json({ links_cancelled: linksCancelled, processed: results.length, results });
});

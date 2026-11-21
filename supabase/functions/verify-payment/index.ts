import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, razorpay, razorpayRequest, RazorpayError, requireEnv } from "../_shared/razorpay.ts";
import { recordGatewayPayment } from "../_shared/record-payment.ts";
import { verificationOutcome, verifyCheckoutSignature } from "./logic.ts";

interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
}

/**
 * Called by the hosted checkout page after Razorpay Checkout succeeds. The body is what Checkout hands its success
 * handler; Razorpay's signature (HMAC-SHA256 of "order_id|payment_id" with the key secret) proves it is genuine, so no
 * user session is required. The payment is captured if it is only authorised, then recorded exactly like the
 * order.paid webhook (both paths are idempotent).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const orderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
    const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
    const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
    if (!/^order_\w+$/.test(orderId) || !/^pay_\w+$/.test(paymentId) || !signature) {
      return json({ error: "invalid payment details" }, 400);
    }

    if (!await verifyCheckoutSignature(orderId, paymentId, signature, requireEnv("RAZORPAY_KEY_SECRET"))) {
      return json({ error: "invalid signature" }, 401);
    }

    let payment = await razorpayRequest<RazorpayPayment>("GET", `/payments/${paymentId}`);
    if (payment.order_id !== orderId) return json({ error: "payment does not belong to this order" }, 400);
    if (payment.status === "authorized") {
      try {
        payment = await razorpay<RazorpayPayment>(`/payments/${paymentId}/capture`, { amount: payment.amount, currency: payment.currency });
      } catch (e) {
        // Already captured by auto-capture or a concurrent call: re-read the current state.
        if (!(e instanceof RazorpayError) || e.status !== 400) throw e;
        payment = await razorpayRequest<RazorpayPayment>("GET", `/payments/${paymentId}`);
      }
    }
    if (payment.status !== "captured") return json({ ok: false, status: payment.status }, 409);

    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
    const r = await recordGatewayPayment(admin, orderId, payment.id, payment.amount);
    if (!r.ok) {
      console.error("verify-payment record failed", r.error);
      return json({ error: "could not record the payment yet; it will be applied automatically" }, 500);
    }
    return json({
      ok: true,
      status: "captured",
      outcome: verificationOutcome(r.result),
    });
  } catch (e) {
    console.error(e);
    return json({ error: "internal error" }, 500);
  }
});

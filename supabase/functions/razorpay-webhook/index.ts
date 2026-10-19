import { createClient } from "npm:@supabase/supabase-js@2";
import { hmacSha256Hex, json, requireEnv, timingSafeEqual } from "../_shared/razorpay.ts";

interface RazorpayEvent {
  event: string;
  payload: {
    payment_link?: { entity: { id: string; status: string } };
    payment?: { entity: { id: string; amount: number; status: string } };
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const rawBody = await req.text();
  const signature = req.headers.get("X-Razorpay-Signature") ?? "";
  const expected = await hmacSha256Hex(requireEnv("RAZORPAY_WEBHOOK_SECRET"), rawBody);
  if (!signature || !timingSafeEqual(signature, expected)) {
    return json({ error: "invalid signature" }, 401);
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid payload" }, 400);
  }

  const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  switch (event.event) {
    case "payment_link.paid": {
      const link = event.payload.payment_link?.entity;
      const payment = event.payload.payment?.entity;
      if (!link || !payment) return json({ error: "missing entities" }, 400);
      const { data, error } = await admin.rpc("record_payment_paid", {
        p_link_id: link.id,
        p_payment_id: payment.id,
        p_amount: payment.amount,
      });
      if (error) {
        console.error(error);
        return json({ error: "processing failed" }, 500);
      }
      if (data && data.ok === false) console.warn("payment_link.paid not applied", data);
      return json({ received: true });
    }
    // TODO(chargebacks): handle payment.dispute.created / payment.dispute.lost by freezing the payout
    // and, if already transferred, reversing it via POST /v1/transfers/{id}/reversals
    // (payouts.status -> reversed / partially_reversed).
    // TODO(kyc): handle linked-account status events and call rpc('sync_provider_kyc', ...).
    default:
      return json({ received: true, ignored: event.event });
  }
});

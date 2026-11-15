import { createClient } from "npm:@supabase/supabase-js@2";
import { hmacSha256Hex, json, requireEnv, timingSafeEqual } from "../_shared/razorpay.ts";
import { handleRailWebhook, isRailEvent, type RailWebhookEvent, type RpcClient } from "../_shared/payout-rail.ts";

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
  // RazorpayX (payouts / fund account validation) webhooks are configured in the X dashboard and may use their own
  // secret (RAZORPAYX_WEBHOOK_SECRET); either valid signature is accepted.
  const secrets = [requireEnv("RAZORPAY_WEBHOOK_SECRET"), Deno.env.get("RAZORPAYX_WEBHOOK_SECRET") ?? ""].filter(Boolean);
  let valid = false;
  for (const s of secrets) {
    if (signature && timingSafeEqual(signature, await hmacSha256Hex(s, rawBody))) valid = true;
  }
  if (!valid) {
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

  if (isRailEvent(event.event)) {
    // Linked-account activation (product.route.*), bank validation (fund_account.validation.*), RazorpayX payout.*.
    const r = await handleRailWebhook(admin as unknown as RpcClient, event as unknown as RailWebhookEvent);
    if (r.status >= 500) console.error("rail webhook failed", event.event, r.body);
    return json(r.body, r.status);
  }

  switch (event.event) {
    case "payment_link.paid": {
      const link = event.payload.payment_link?.entity;
      const payment = event.payload.payment?.entity;
      if (!link || !payment) return json({ error: "missing entities" }, 400);
      const { data: existing } = await admin
        .from("payments")
        .select("pack_purchase_id, booking_id")
        .eq("razorpay_link_id", link.id)
        .maybeSingle<{ pack_purchase_id: string | null; booking_id: string | null }>();
      let archetype: string | null = null;
      if (existing?.booking_id) {
        const { data: booking } = await admin.from("bookings").select("archetype").eq("id", existing.booking_id)
          .maybeSingle<{ archetype: string }>();
        archetype = booking?.archetype ?? null;
      }
      const recordRpc = existing?.pack_purchase_id || archetype === "time_based"
        ? "record_time_payment_paid"
        : "record_payment_paid";
      const { data, error } = await admin.rpc(recordRpc, {
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
    // Linked-account status events are handled above via handleRailWebhook (sync_provider_payout_status).
    default:
      return json({ received: true, ignored: event.event });
  }
});

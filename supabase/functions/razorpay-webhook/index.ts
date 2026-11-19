import { createClient } from "npm:@supabase/supabase-js@2";
import { hmacSha256Hex, json, requireEnv, timingSafeEqual } from "../_shared/razorpay.ts";
import { recordGatewayPayment } from "../_shared/record-payment.ts";
import { handleRailWebhook, isRailEvent, type RailWebhookEvent, type RpcClient } from "../_shared/payout-rail.ts";
import { routeChargebackEvent } from "./chargeback.ts";
import { appendGatewayWebhookLog } from "./webhook-log.ts";
import { routeSportsPaymentFailed } from "./sports-payment-failed.ts";

interface RazorpayEvent {
  event: string;
  payload: {
    payment_link?: { entity: { id: string; status: string } };
    order?: { entity: { id: string; status: string } };
    payment?: { entity: { id: string; amount: number; status: string; order_id?: string | null } };
    dispute?: { entity: { id?: string; payment_id?: string; amount?: number; status?: string } };
    refund?: { entity: { id?: string; payment_id?: string; amount?: number; status?: string } };
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

  const eventName = typeof event.event === "string" ? event.event : "";
  const logResult = await appendGatewayWebhookLog(
    admin,
    req.headers.get("X-Razorpay-Event-Id"),
    eventName,
    event,
  );
  if (!logResult.ok) {
    console.error("webhook log failed", logResult.error);
    return json(
      { error: logResult.status === 409 ? "conflicting webhook event id" : "webhook processing failed" },
      logResult.status,
    );
  }
  if (logResult.duplicate) console.warn("duplicate Razorpay webhook event", eventName);

  if (isRailEvent(event.event)) {
    // Linked-account activation (product.route.*), bank validation (fund_account.validation.*), RazorpayX payout.*.
    const r = await handleRailWebhook(admin as unknown as RpcClient, event as unknown as RailWebhookEvent);
    if (r.status >= 500) console.error("rail webhook failed", event.event, r.body);
    return json(r.body, r.status);
  }

  switch (event.event) {
    case "payment_link.paid":
    case "order.paid": {
      // Orders (current checkout) and payment links (created before the switch) are both keyed by the
      // gateway reference stored in payments.razorpay_link_id.
      const reference = event.event === "order.paid" ? event.payload.order?.entity.id : event.payload.payment_link?.entity.id;
      const payment = event.payload.payment?.entity;
      if (!reference || !payment) return json({ error: "missing entities" }, 400);
      const r = await recordGatewayPayment(admin, reference, payment.id, payment.amount);
      if (!r.ok) {
        console.error(r.error);
        return json({ error: "processing failed" }, 500);
      }
      return json({ received: true });
    }
    case "payment.failed": {
      const r = await routeSportsPaymentFailed(
        admin as unknown as Parameters<typeof routeSportsPaymentFailed>[0],
        event,
      );
      if (r.status >= 500) console.error("sports payment failure webhook failed", r.body);
      return json(r.body, r.status);
    }
    case "payment.dispute.created":
    case "payment.dispute.lost":
    case "payment.dispute.won":
    case "refund.processed":
    case "refund.failed": {
      const r = await routeChargebackEvent(admin as unknown as Parameters<typeof routeChargebackEvent>[0], event);
      if (r.status >= 500) console.error("payment lifecycle webhook failed", event.event, r.body);
      return json(r.body, r.status);
    }
    // Linked-account status events are handled above via handleRailWebhook (sync_provider_payout_status).
    default:
      return json({ received: true, ignored: event.event });
  }
});

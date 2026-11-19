import { createClient } from "npm:@supabase/supabase-js@2";
import { json, requireEnv } from "../_shared/razorpay.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (req.headers.get("x-cron-secret") !== requireEnv("CRON_SECRET")) return json({ error: "unauthorized" }, 401);
  const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const [milestones, expired, deliveryReminders] = await Promise.all([
    admin.rpc("process_proposal_milestones"),
    admin.rpc("expire_proposal_flows"),
    admin.rpc("remind_delivery_acceptance"),
  ]);
  if (milestones.error || expired.error || deliveryReminders.error) {
    return json({
      error: "proposal schedule processing failed",
      milestone_error: milestones.error?.message,
      expiry_error: expired.error?.message,
      delivery_reminder_error: deliveryReminders.error?.message,
    }, 500);
  }
  return json({
    milestones_due: milestones.data ?? 0,
    holds_expired: expired.data ?? 0,
    delivery_acceptance_reminders: deliveryReminders.data ?? 0,
  });
});

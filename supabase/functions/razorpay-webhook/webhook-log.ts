import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function appendGatewayWebhookLog(
  admin: SupabaseClient,
  eventId: string | null,
  event: string,
  payload: unknown,
): Promise<{ ok: true; duplicate: boolean } | { ok: false; error: string }> {
  const { error } = await admin.from("gateway_webhook_log").insert({
    event_id: eventId,
    event,
    payload,
  });
  if (!error) return { ok: true, duplicate: false };
  if (error.code === "23505") return { ok: true, duplicate: true };
  return { ok: false, error: error.message };
}

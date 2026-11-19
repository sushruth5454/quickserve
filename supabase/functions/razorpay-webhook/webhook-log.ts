import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type WebhookLogResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; status: 409 | 500; error: string };

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export async function appendGatewayWebhookLog(
  admin: SupabaseClient,
  eventId: string | null,
  event: string,
  payload: unknown,
): Promise<WebhookLogResult> {
  const { error } = await admin.from("gateway_webhook_log").insert({
    event_id: eventId,
    event,
    payload,
  });
  if (!error) return { ok: true, duplicate: false };
  if (error.code === "23505" && eventId !== null) {
    const { data: existing, error: lookupError } = await admin.from("gateway_webhook_log")
      .select("payload")
      .eq("event_id", eventId)
      .maybeSingle<{ payload: unknown }>();
    if (lookupError) return { ok: false, status: 500, error: lookupError.message };
    if (!existing) return { ok: false, status: 500, error: "duplicate webhook event could not be read" };
    if (canonicalJson(existing.payload) !== canonicalJson(payload)) {
      return { ok: false, status: 409, error: "event id payload mismatch" };
    }
    return { ok: true, duplicate: true };
  }
  return { ok: false, status: 500, error: error.message };
}

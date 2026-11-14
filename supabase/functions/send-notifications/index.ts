import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { json, requireEnv, timingSafeEqual } from "../_shared/razorpay.ts";
import {
  buildMessages,
  chunk,
  type ClaimedNotification,
  type ExpoMessage,
  type ExpoTicket,
  failAll,
  foldReceipts,
  foldTickets,
  type Outcome,
} from "./logic.ts";

const EXPO_SEND = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS = "https://exp.host/--/api/v2/push/getReceipts";
const TIMEOUT_MS = 15000;
const MAX_ROUNDS = 5;

function expoHeaders(): HeadersInit {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
  };
  // Optional: required only when "Enhanced push security" is enabled for the Expo project.
  const token = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function expoPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: expoHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`expo ${res.status}: ${text.slice(0, 300)}`);
  const parsed = JSON.parse(text) as T & { errors?: { code?: string; message?: string }[] };
  if (parsed.errors?.length) throw new Error(`expo: ${parsed.errors.map((e) => e.code ?? e.message).join(", ")}`);
  return parsed;
}

async function sendRound(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("claim_due_notifications", { p_limit: 100 });
  if (error) throw new Error(`claim_due_notifications: ${error.message}`);
  const claimed = (data ?? []) as ClaimedNotification[];
  if (claimed.length === 0) return { claimed: 0, sent: 0, failed: 0 };

  const entries: { notificationId: string; token: string; message: ExpoMessage }[] = [];
  for (const n of claimed) {
    for (const message of buildMessages(n)) entries.push({ notificationId: n.id, token: message.to, message });
  }
  const outcomes = new Map<string, Outcome>();
  for (const batch of chunk(entries)) {
    try {
      const res = await expoPost<{ data: ExpoTicket[] }>(EXPO_SEND, batch.map((e) => e.message));
      foldTickets(batch, res.data ?? [], outcomes);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("expo send failed", message);
      failAll(batch, message, outcomes);
    }
  }

  let sent = 0;
  let failed = 0;
  for (const n of claimed) {
    const o = outcomes.get(n.id) ?? { ok: false, error: "not sent", tickets: [], deadTokens: [] };
    if (o.ok) sent++;
    else failed++;
    const done = await admin.rpc("finish_notification", {
      p_id: n.id,
      p_ok: o.ok,
      p_error: o.ok ? null : o.error,
      p_tickets: o.tickets,
      p_dead_tokens: o.deadTokens,
    });
    // The row stays 'sending' and is re-claimed after 5 minutes (at-least-once, like Expo itself).
    if (done.error) console.error("finish_notification", n.id, done.error.message);
  }
  return { claimed: claimed.length, sent, failed };
}

async function checkReceipts(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("claim_push_receipts", { p_limit: 1000 });
  if (error) throw new Error(`claim_push_receipts: ${error.message}`);
  const tickets = (data ?? []) as { ticket_id: string; token: string }[];
  if (tickets.length === 0) {
    await admin.rpc("resolve_push_receipts", { p_ticket_ids: [], p_dead_tokens: [] });
    return { checked: 0, dead: 0 };
  }
  const res = await expoPost<{ data: Record<string, ExpoTicket> }>(EXPO_RECEIPTS, { ids: tickets.map((t) => t.ticket_id) });
  const r = foldReceipts(tickets, res.data ?? {});
  if (r.errors.length) console.error("push receipt errors", r.errors.slice(0, 20));
  const done = await admin.rpc("resolve_push_receipts", { p_ticket_ids: r.resolved, p_dead_tokens: r.deadTokens });
  if (done.error) console.error("resolve_push_receipts", done.error.message);
  return { checked: r.resolved.length, dead: r.deadTokens.length };
}

// Kicked by a trigger via pg_net on every new outbox row and by a pg_cron safety-net job (README "Scheduled jobs").
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!timingSafeEqual(secret, requireEnv("CRON_SECRET"))) return json({ error: "unauthorized" }, 401);

  const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const totals = { claimed: 0, sent: 0, failed: 0 };
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const r = await sendRound(admin);
      totals.claimed += r.claimed;
      totals.sent += r.sent;
      totals.failed += r.failed;
      if (r.claimed < 100) break;
    }
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e), ...totals }, 500);
  }

  let receipts: { checked: number; dead: number } | { error: string };
  try {
    receipts = await checkReceipts(admin);
  } catch (e) {
    receipts = { error: e instanceof Error ? e.message : String(e) };
    console.error("receipts", receipts.error);
  }
  return json({ ...totals, receipts });
});

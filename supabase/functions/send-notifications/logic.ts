// Pure helpers for send-notifications (no I/O; unit-tested in logic_test.ts): Expo message building, batching and
// ticket/receipt interpretation.

export interface ClaimedNotification {
  id: string;
  user_id: string;
  kind: string;
  booking_id: string | null;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  collapse_key: string | null;
  count: number;
  unread: number;
  badge: number;
  tokens: string[];
  attempts: number;
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  priority: "high" | "default";
  channelId: string;
  badge?: number;
  collapseId?: string;
  tag?: string;
  threadId?: string;
}

export interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface Outcome {
  ok: boolean;
  error: string | null;
  tickets: { id: string; token: string }[];
  deadTokens: string[];
}

/** Android channels the app creates on registration (a message to a missing channel is not displayed). */
export const CHANNELS = { messages: "messages", bookings: "bookings" } as const;
export const EXPO_BATCH = 100;

export function channelFor(kind: string): string {
  return kind === "chat_message" ? CHANNELS.messages : CHANNELS.bookings;
}

/** "Ravi" for one unread message, "Ravi · 3 new messages" when several are waiting in the same chat. */
export function displayTitle(n: Pick<ClaimedNotification, "kind" | "title" | "unread">): string {
  if (n.kind === "chat_message" && n.unread > 1) return `${n.title} · ${n.unread} new messages`;
  return n.title;
}

/** One Expo message per device. Chat pushes share a per-booking collapse id/tag so the newest replaces the older. */
export function buildMessages(n: ClaimedNotification): ExpoMessage[] {
  const group = n.booking_id ? `${n.kind === "chat_message" ? "chat" : "booking"}-${n.booking_id}` : undefined;
  const data = { ...(n.data ?? {}), kind: n.kind, notification_id: n.id };
  return [...new Set(n.tokens)].map((to) => {
    const m: ExpoMessage = {
      to,
      title: displayTitle(n),
      body: n.body,
      data,
      sound: "default",
      priority: "high",
      channelId: channelFor(n.kind),
      badge: Math.max(0, n.badge),
    };
    if (group) {
      m.threadId = group;
      if (n.kind === "chat_message") {
        m.collapseId = group;
        m.tag = group;
      }
    }
    return m;
  });
}

export function chunk<T>(items: T[], size = EXPO_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const emptyOutcome = (): Outcome => ({ ok: false, error: null, tickets: [], deadTokens: [] });

/**
 * Folds Expo tickets (same order as the messages sent) into one outcome per notification: delivered if any device
 * accepted it; DeviceNotRegistered tokens are reported for removal; anything else is a retryable error.
 */
export function foldTickets(
  sent: { notificationId: string; token: string }[],
  tickets: (ExpoTicket | undefined)[],
  into: Map<string, Outcome> = new Map(),
): Map<string, Outcome> {
  sent.forEach((s, i) => {
    const o = into.get(s.notificationId) ?? emptyOutcome();
    const t = tickets[i];
    if (t?.status === "ok") {
      o.ok = true;
      if (t.id) o.tickets.push({ id: t.id, token: s.token });
    } else if (t?.details?.error === "DeviceNotRegistered") {
      o.deadTokens.push(s.token);
      o.error ??= "DeviceNotRegistered";
    } else {
      o.error = t ? (t.details?.error ?? t.message ?? "push error") : "no ticket";
    }
    into.set(s.notificationId, o);
  });
  return into;
}

/** Marks every message of a failed request as a retryable error. */
export function failAll(sent: { notificationId: string }[], error: string, into: Map<string, Outcome>): void {
  for (const s of sent) {
    const o = into.get(s.notificationId) ?? emptyOutcome();
    o.error = error;
    into.set(s.notificationId, o);
  }
}

export interface ReceiptResult {
  resolved: string[];
  deadTokens: string[];
  errors: string[];
}

/** Receipts present in the response are resolved; DeviceNotRegistered tokens are removed. Missing ids stay queued. */
export function foldReceipts(
  tickets: { ticket_id: string; token: string }[],
  receipts: Record<string, ExpoTicket | undefined>,
): ReceiptResult {
  const res: ReceiptResult = { resolved: [], deadTokens: [], errors: [] };
  for (const t of tickets) {
    const r = receipts[t.ticket_id];
    if (!r) continue;
    res.resolved.push(t.ticket_id);
    if (r.status === "error") {
      if (r.details?.error === "DeviceNotRegistered") res.deadTokens.push(t.token);
      else res.errors.push(r.details?.error ?? r.message ?? "receipt error");
    }
  }
  return res;
}

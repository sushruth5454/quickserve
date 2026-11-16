// Run: deno test supabase/functions/send-notifications
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildMessages, chunk, type ClaimedNotification, displayTitle, failAll, foldReceipts, foldTickets, type Outcome } from "./logic.ts";

const base: ClaimedNotification = {
  id: "n1",
  user_id: "u1",
  kind: "chat_message",
  booking_id: "b1",
  title: "Ravi",
  body: "On my way",
  data: { url: "/chat/b1", booking_id: "b1" },
  collapse_key: "chat:b1",
  count: 1,
  unread: 1,
  badge: 4,
  tokens: ["ExponentPushToken[aaaaaaaaaa]", "ExponentPushToken[bbbbbbbbbb]", "ExponentPushToken[aaaaaaaaaa]"],
  attempts: 1,
};

Deno.test("chat push: one message per unique device, collapsed per booking, deep link kept", () => {
  const msgs = buildMessages(base);
  assertEquals(msgs.length, 2);
  for (const m of msgs) {
    assertEquals(m.title, "New message from Ravi");
    assertEquals(m.channelId, "messages");
    assertEquals(m.collapseId, "chat-b1");
    assertEquals(m.tag, "chat-b1");
    assertEquals(m.threadId, "chat-b1");
    assertEquals(m.badge, 4);
    assertEquals(m.data.url, "/chat/b1");
    assertEquals(m.data.kind, "chat_message");
  }
});

Deno.test("chat title summarises several unread messages", () => {
  assertEquals(displayTitle({ ...base, unread: 3 }), "3 new messages from Ravi");
  assertEquals(displayTitle({ ...base, kind: "booking_accepted", title: "Booking accepted", unread: 3 }), "Booking accepted");
});

Deno.test("booking pushes use the bookings channel and are grouped but not collapsed", () => {
  const [m] = buildMessages({ ...base, kind: "quote_sent", title: "Quote received", tokens: ["ExpoPushToken[cccccccccc]"] });
  assertEquals(m.channelId, "bookings");
  assertEquals(m.threadId, "booking-b1");
  assertEquals(m.collapseId, undefined);
});

Deno.test("chunks to Expo's 100-message limit", () => {
  const parts = chunk(Array.from({ length: 205 }, (_, i) => i));
  assertEquals(parts.map((p) => p.length), [100, 100, 5]);
});

Deno.test("tickets: any accepted device = delivered; DeviceNotRegistered tokens removed; other errors retry", () => {
  const sent = [
    { notificationId: "n1", token: "t1" },
    { notificationId: "n1", token: "t2" },
    { notificationId: "n2", token: "t3" },
    { notificationId: "n3", token: "t4" },
  ];
  const out = foldTickets(sent, [
    { status: "ok", id: "r1" },
    { status: "error", details: { error: "DeviceNotRegistered" } },
    { status: "error", message: "rate", details: { error: "MessageRateExceeded" } },
    undefined,
  ]);
  assertEquals(out.get("n1"), { ok: true, error: "DeviceNotRegistered", tickets: [{ id: "r1", token: "t1" }], deadTokens: ["t2"] });
  assertEquals(out.get("n2")?.ok, false);
  assertEquals(out.get("n2")?.error, "MessageRateExceeded");
  assertEquals(out.get("n3")?.error, "no ticket");
});

Deno.test("a failed request fails every notification in it without losing earlier successes", () => {
  const out = new Map<string, Outcome>();
  foldTickets([{ notificationId: "n1", token: "t1" }], [{ status: "ok", id: "r1" }], out);
  failAll([{ notificationId: "n1" }, { notificationId: "n2" }], "expo 503", out);
  assert(out.get("n1")?.ok);
  assertEquals(out.get("n2"), { ok: false, error: "expo 503", tickets: [], deadTokens: [] });
});

Deno.test("receipts: resolved ids, dead tokens, missing receipts stay queued", () => {
  const r = foldReceipts(
    [{ ticket_id: "a", token: "t1" }, { ticket_id: "b", token: "t2" }, { ticket_id: "c", token: "t3" }],
    { a: { status: "ok" }, b: { status: "error", details: { error: "DeviceNotRegistered" } } },
  );
  assertEquals(r.resolved, ["a", "b"]);
  assertEquals(r.deadTokens, ["t2"]);
  assertEquals(r.errors, []);
});

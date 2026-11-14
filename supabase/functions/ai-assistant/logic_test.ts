// Deterministic tests for ai-assistant pure logic: time/slots, PII redaction, service validation, ranking fairness,
// reply assembly from malformed model output and production-shaped edge cases. Run: deno test supabase/functions/ai-assistant
import { assert, assertEquals, assertMatch, assertNotMatch } from "jsr:@std/assert@1";
import {
  composeReply,
  type ComposeInput,
  type DraftCard,
  estimateCard,
  MarketClock,
  normalizeSlot,
  type PastBooking,
  type PriceStats,
  rankProviders,
  redactPII,
  type SearchRow,
  serviceProblem,
  type ServiceRow,
  toContents,
} from "./logic.ts";

const clock = new MarketClock(330, "IST");
const now = new Date("2026-11-14T04:00:00Z"); // Sat 14 Nov 2026, 09:30 IST

const row = (id: string, over: Partial<SearchRow> = {}): SearchRow => ({
  provider_id: `p-${id}`,
  provider_service_id: `ps-${id}`,
  full_name: `Pro ${id}`,
  skill_level: "skilled",
  visit_fee: 19900,
  rating_avg: 4.5,
  rating_count: 10,
  jobs_completed: 20,
  years_experience: 5,
  is_online: true,
  distance_km: 3,
  score: 0.5,
  ...over,
});

const stats = (over: Partial<PriceStats> = {}): PriceStats => ({
  category_slug: "ac-repair",
  category_name: "AC Repair",
  visit_fee_count: 3,
  visit_fee_min: 9900,
  visit_fee_median: 19900,
  visit_fee_max: 24900,
  total_count: 10,
  total_p25: 65350,
  total_median: 87900,
  total_p75: 127900,
  ...over,
});

const draft: DraftCard = {
  type: "draft",
  category_slug: "ac-repair",
  category_name: "AC Repair",
  provider: { provider_id: "p-a", provider_service_id: "ps-a", name: "Pro a", visit_fee: 19900, rating_avg: 4.5, rating_count: 10 },
  description_en: "AC not cooling",
  description_original: "AC not cooling",
  problem_chips: ["Not cooling"],
  slot: { type: "asap", label: "As soon as possible" },
  address: { address_id: null, label: null, area: "Area", city: "City", needs_full_address: true },
};

const input = (over: Partial<ComposeInput>): ComposeInput => ({
  respond: {},
  slug: null,
  categoryName: null,
  draft: null,
  searchRows: null,
  stats: null,
  history: [],
  now,
  clock,
  minPriceSamples: 3,
  priceLookbackDays: 180,
  isVoice: false,
  userText: "hello",
  ...over,
});

Deno.test("market clock: IST day boundaries and labels; other offsets work", () => {
  assertEquals(clock.dateKey(new Date("2026-11-14T18:29:00Z")), "2026-11-14");
  assertEquals(clock.dateKey(new Date("2026-11-14T18:31:00Z")), "2026-11-15");
  assertEquals(clock.midnight(now).toISOString(), "2026-11-13T18:30:00.000Z");
  assertEquals(clock.dayLabel("2026-11-15"), "Sun, 15 Nov");
  assertEquals(new MarketClock(0, "UTC").dateKey(new Date("2026-11-14T23:00:00Z")), "2026-11-14");
});

Deno.test("slots: valid window, snapping, past windows move, out-of-range → asap", () => {
  const s = normalizeSlot({ type: "window", date: "2026-11-15", start_hour: 18 }, now, clock);
  assertEquals(s.type === "window" && [s.start_hour, s.label, s.starts_at], [18, "Sun, 15 Nov · 6–8 pm", "2026-11-15T12:30:00.000Z"]);
  const snapped = normalizeSlot({ type: "window", date: "2026-11-15", start_hour: 19 }, now, clock);
  assertEquals(snapped.type === "window" && [snapped.start_hour, snapped.adjusted], [18, "snapped_to_window"]);
  const past = normalizeSlot({ type: "window", date: "2026-11-14", start_hour: 8 }, now, clock); // 08:00 already gone at 09:30
  assertEquals(past.type === "window" && [past.date, past.start_hour, past.adjusted], ["2026-11-14", 12, "moved_to_next_free_window"]);
  assertEquals(normalizeSlot({ type: "window", date: "2026-12-30", start_hour: 10 }, now, clock).type, "asap");
  assertEquals(normalizeSlot({ type: "window", date: "tomorrow", start_hour: 10 }, now, clock).type, "asap");
  assertEquals(normalizeSlot({ type: "whenever" }, now, clock).type, "asap");
});

Deno.test("PII redaction: phones, emails, UPI; keeps prices, dates and short numbers", () => {
  assertEquals(redactPII("call me on +91 98765 43210 or 9876543210"), "call me on [number] or [number]");
  assertEquals(redactPII("mail ravi.k@gmail.com"), "mail [email]");
  assertEquals(redactPII("pay to ravi@okaxis"), "pay to [upi]");
  assertEquals(redactPII("AC 1.5 ton, ₹1500 budget, flat 302, on 2026-11-15"), "AC 1.5 ton, ₹1500 budget, flat 302, on 2026-11-15");
});

Deno.test("service validation: inactive, unverified, suspended, self, wrong category, ok", () => {
  const ok: ServiceRow = {
    id: "ps-1",
    provider_id: "p-1",
    visit_fee: 100,
    active: true,
    categories: { slug: "plumber", name: "Plumber" },
    providers: { kyc_status: "verified", suspended: false, rating_avg: 4, rating_count: 3, profiles: { full_name: "X" } },
  };
  assertEquals(serviceProblem(ok, "plumber", "me"), null);
  assertMatch(serviceProblem(null, "plumber", "me")!, /not available/);
  assertMatch(serviceProblem({ ...ok, active: false }, "plumber", "me")!, /not available/);
  assertMatch(serviceProblem({ ...ok, providers: { ...ok.providers!, kyc_status: "pending" } }, "plumber", "me")!, /not available/);
  assertMatch(serviceProblem({ ...ok, providers: { ...ok.providers!, suspended: true } }, "plumber", "me")!, /not available/);
  assertMatch(serviceProblem({ ...ok, providers: null }, "plumber", "me")!, /not available/);
  assertMatch(serviceProblem(ok, "plumber", "p-1")!, /cannot book themselves/);
  assertMatch(serviceProblem(ok, "ac-repair", "me")!, /is for Plumber/);
});

Deno.test("ranking: rated ≥4 pros boosted, preferred first, deterministic regardless of input order", () => {
  const rows = [row("a", { score: 0.9 }), row("b", { score: 0.5, rating_avg: 4.9, rating_count: 40 }), row("c", { score: 0.4, distance_km: 0.8 }), row("d", { score: 0.3 })];
  const history: PastBooking[] = [
    { booking_date: "2026-03-10T10:00:00Z", category_slug: "ac-repair", category_name: "AC Repair", provider_id: "p-d", provider_service_id: "ps-d", provider_name: "Pro d", status: "closed", rating: 5 },
  ];
  const picks = rankProviders(rows, history, now, clock);
  assertEquals(picks.map((p) => p.provider_service_id), ["ps-d", "ps-b", "ps-c"]);
  assertEquals(picks[0]!.reason, "You rated Pro ★5 in March");
  assertMatch(picks[1]!.reason, /^Best rated/);
  assertMatch(picks[2]!.reason, /^Nearest expert/);
  assertEquals(rankProviders([...rows].reverse(), history, now, clock), picks);
  assertEquals(rankProviders(rows, history, now, clock, "ps-a")[0]!.provider_service_id, "ps-a");
  // New user (no history): pure data ranking.
  assertEquals(rankProviders(rows, [], now, clock).map((p) => p.provider_service_id), ["ps-b", "ps-c", "ps-a"]);
  // Ties on every metric: id order, not input order.
  const tied = [row("z", { score: 0.5 }), row("y", { score: 0.5 })];
  assertEquals(rankProviders(tied, [], now, clock).map((p) => p.provider_service_id), rankProviders([...tied].reverse(), [], now, clock).map((p) => p.provider_service_id));
  assertEquals(rankProviders([], [], now, clock), []);
});

Deno.test("estimate: below the sample minimum shows no typical total (sparse/stale data)", () => {
  const sparse = estimateCard(stats({ total_count: 2 }), 3, 180);
  assertEquals(sparse.typical_total, null);
  assertMatch(sparse.note, /Not enough recent jobs/);
  const none = estimateCard(stats({ visit_fee_count: 0, total_count: 0 }), 3, 180);
  assertEquals([none.visit_fee, none.typical_total], [null, null]);
  assertEquals(estimateCard(stats(), 3, 180).typical_total, { low: 65000, median: 88000, high: 128000, count: 10 });
});

Deno.test("composeReply: malformed model output degrades safely and never invents cards", () => {
  for (const bad of [null, "garbage", 42, [], { reply_text: 7, language: "klingon", quick_replies: "x", diagnosis: "y", safety: [1] }]) {
    const r = composeReply(input({ respond: bad, userText: "my tap is leaking" }));
    assertEquals(r.cards, []);
    assertEquals(r.language, "en");
    assertMatch(r.reply_text, /describe the problem again/);
  }
  // show_* flags without tool data produce nothing; model numbers never become cards.
  const r = composeReply(input({ respond: { reply_text: "Typical cost is ₹99,999", show_estimate: true, show_providers: true, show_draft: true }, slug: "ac-repair" }));
  assertEquals(r.cards, []);
});

Deno.test("composeReply: guardrails (booking claims, missing safety, links, language fallback, confidence)", () => {
  const claimed = composeReply(input({ respond: { reply_text: "Your booking is confirmed! Visit https://x.y", language: "en" }, draft, slug: "ac-repair" }));
  assertMatch(claimed.reply_text, /booking draft/);
  assertEquals(claimed.guardrails.reply_replaced, true);
  assertEquals(claimed.cards.map((c) => c.type), ["draft"]);

  const te = "ఇంట్లో కరెంట్ పోయింది, స్విచ్ బోర్డ్ నుండి స్పార్క్స్ వస్తున్నాయి";
  const safety = composeReply(input({ respond: { reply_text: "జాగ్రత్తగా ఉండండి" }, userText: te }));
  assertEquals(safety.language, "te");
  assertEquals(safety.cards[0]!.type, "safety");
  assertEquals(safety.cards[0]!.hazard, "electrical");
  assertEquals(safety.guardrails.safety_added, true);
  assert((safety.cards[0]!.emergency as { number: string }[]).some((e) => e.number === "112"));

  const dx = composeReply(input({ respond: { reply_text: "**Likely** the filter", diagnosis: { likely_issues: ["Dirty filter"], pro_checks: ["Gas pressure"], confidence: "certain" } } }));
  assertEquals(dx.reply_text, "Likely the filter");
  assertEquals(dx.cards[0]!.confidence, "low");
});

Deno.test("composeReply: zero provider matches tells the customer; voice transcript only for voice", () => {
  const none = composeReply(input({ respond: { reply_text: "" }, slug: "painter", searchRows: [] }));
  assertMatch(none.reply_text, /no verified pros/);
  const voice = composeReply(input({ respond: { reply_text: "ok", transcript: "tap leaking" }, isVoice: true }));
  assertEquals(voice.transcript, "tap leaking");
  assertEquals(composeReply(input({ respond: { reply_text: "ok", transcript: "x" } })).transcript, null);
});

Deno.test("composeReply: draft + data → estimate, providers (draft pro first) and draft", () => {
  const r = composeReply(input({ respond: { reply_text: "Draft ready", language: "en" }, slug: "ac-repair", categoryName: "AC Repair", draft, searchRows: [row("b"), row("a")], stats: stats() }));
  assertEquals(r.cards.map((c) => c.type), ["estimate", "providers", "draft"]);
  const pros = r.cards[1]!.providers as { provider_service_id: string }[];
  assertEquals(pros[0]!.provider_service_id, "ps-a");
  assertNotMatch(JSON.stringify(r), /5eed|9999999999/);
});

Deno.test("history → model contents: alternating, starts with user, drops unanswered turn", () => {
  const c = toContents([
    { role: "assistant", content: "orphan", payload: null },
    { role: "user", content: "AC broken", payload: null },
    { role: "assistant", content: "Draft ready", payload: { summary: "[shown: draft]" } },
    { role: "error", content: "", payload: null },
    { role: "user", content: "failed turn", payload: null },
  ]);
  assertEquals(c.map((x) => x.role), ["user", "model"]);
  assertEquals(c[1]!.parts[0]!.text, "Draft ready\n[shown: draft]");
});

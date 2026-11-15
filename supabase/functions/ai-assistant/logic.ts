// Pure helpers for the AI assistant (no I/O, unit-tested in logic_test.ts): marketplace time, slot validation, PII
// redaction, provider ranking, service validation and card assembly from tool results + the model's final answer.
import { claimsBooking, draftReadyText } from "./policies/booking.ts";
import type { JobBrief } from "./brief.ts";
import { CONFIDENCE_LEVELS } from "./policies/diagnosis.ts";
import { type HandoffReason, handoffReason, quickRepliesFor } from "./policies/handoff.ts";
import { detectLanguage, type Language, LANGUAGES } from "./policies/language.ts";
import { DEFAULT_SAFETY, detectHazard } from "./policies/safety.ts";
import { sanitizeReply } from "./policies/security.ts";
import { CLARITY_LEVELS } from "./policies/transcription.ts";

/** Start hours of the Book screen's 2-hour windows (app/src/lib/schedule.ts WINDOW_START_HOURS). */
export const WINDOW_START_HOURS = [8, 10, 12, 14, 16, 18] as const;
export const MIN_LEAD_MINUTES = 60;
export const BOOKABLE_DAYS = 7;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Problem chips per category; must match QUICK_ISSUES in app/app/book/[providerServiceId].tsx so they pre-select. */
export const PROBLEM_CHIPS: Record<string, string[]> = {
  "ac-repair": ["Not cooling", "Water leaking", "Making noise", "Bad smell", "Gas refill", "Service due"],
  electrician: ["MCB tripping", "Fan not working", "Switch sparking", "New fitting", "Wiring issue"],
  plumber: ["Tap leaking", "Blocked drain", "Low water pressure", "Flush not working", "Pipe burst"],
  "house-cleaning": ["Full home deep clean", "Kitchen", "Bathrooms", "Sofa / carpet"],
  "water-tank-cleaning": ["Overhead tank", "Sump", "Bad smell in water"],
  "car-mechanic": ["Not starting", "Battery", "Brakes", "General service"],
  "bike-mechanic": ["Not starting", "Puncture", "Brakes", "General service"],
  "appliance-repair": ["Washing machine", "Refrigerator", "Microwave", "Not powering on"],
  "pest-control": ["Cockroaches", "Termites", "Bed bugs", "Mosquitoes"],
  carpenter: ["Door alignment", "Hinges / locks", "Furniture repair", "New fitting"],
  painter: ["Full home", "One room", "Touch-ups", "Waterproofing"],
};

/** National emergency numbers (India), defined server-side so the model never makes them up. */
export const EMERGENCY_NUMBERS: Record<string, { label: string; number: string }[]> = {
  gas: [
    { label: "Emergency", number: "112" },
    { label: "Fire", number: "101" },
    { label: "LPG gas leak helpline", number: "1906" },
  ],
  electrical: [
    { label: "Emergency", number: "112" },
    { label: "Fire", number: "101" },
  ],
  fire: [
    { label: "Fire", number: "101" },
    { label: "Emergency", number: "112" },
  ],
  medical: [
    { label: "Ambulance", number: "108" },
    { label: "Emergency", number: "112" },
  ],
  water: [{ label: "Emergency", number: "112" }],
  other: [{ label: "Emergency", number: "112" }],
};

// ---------- marketplace time (fixed UTC offset, India = +330) ----------
export class MarketClock {
  constructor(
    readonly offsetMin: number,
    readonly label: string,
  ) {}

  parts(at: Date) {
    const x = new Date(at.getTime() + this.offsetMin * 60_000);
    return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(), min: x.getUTCMinutes(), dow: x.getUTCDay() };
  }

  dateKey(at: Date): string {
    const p = this.parts(at);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }

  /** UTC instant of a local wall-clock time on a local date key. */
  instant(dateKey: string, hour: number, minute = 0): Date {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!, hour, minute) - this.offsetMin * 60_000);
  }

  midnight(now: Date): Date {
    return this.instant(this.dateKey(now), 0);
  }

  addDays(dateKey: string, days: number): string {
    return this.dateKey(new Date(this.instant(dateKey, 12).getTime() + days * 86_400_000));
  }

  dayLabel(dateKey: string): string {
    const p = this.parts(this.instant(dateKey, 12));
    return `${WEEKDAY[p.dow]}, ${p.d} ${MONTH[p.m - 1]}`;
  }

  monthLabel(iso: string, now: Date): string {
    const p = this.parts(new Date(iso));
    return p.y === this.parts(now).y ? MONTH_LONG[p.m - 1]! : `${MONTH_LONG[p.m - 1]} ${p.y}`;
  }

  nowLabel(now: Date): string {
    const p = this.parts(now);
    return `${WEEKDAY_LONG[p.dow]} ${p.d} ${MONTH[p.m - 1]} ${p.y}, ${pad(p.h)}:${pad(p.min)} ${this.label}`;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

export function windowLabel(hour: number): string {
  const end = hour + 2;
  const h12 = (h: number) => String(h % 12 === 0 ? 12 : h % 12);
  const a = hour < 12 ? "am" : "pm";
  const b = end < 12 ? "am" : "pm";
  return a === b ? `${h12(hour)}–${h12(end)} ${b}` : `${h12(hour)} ${a}–${h12(end)} ${b}`;
}

// ---------- slots ----------
export type Slot =
  | { type: "asap"; label: string; adjusted?: string }
  | { type: "window"; date: string; start_hour: number; starts_at: string; label: string; adjusted?: string };

const ASAP: Slot = { type: "asap", label: "As soon as possible" };

/**
 * Validates a model-proposed slot against the Book screen's rules: a 2-hour window starting at 8/10/…/18 local time,
 * within the next 7 days and at least 60 minutes away. Off-grid hours snap to the window containing them (19:00 →
 * 6–8 pm); a window that has passed moves to the next free one. Anything unusable becomes ASAP.
 */
export function normalizeSlot(raw: { type?: unknown; date?: unknown; start_hour?: unknown }, now: Date, clock: MarketClock): Slot {
  if (raw.type !== "window") return ASAP;
  const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  const hourIn = typeof raw.start_hour === "number" ? raw.start_hour : Number(raw.start_hour);
  if (!date || !Number.isFinite(hourIn)) return { ...ASAP, adjusted: "invalid_slot" };
  const today = clock.dateKey(now);
  const last = clock.addDays(today, BOOKABLE_DAYS - 1);
  if (date < today || date > last) return { ...ASAP, adjusted: "date_out_of_range" };

  const ok = (d: string, h: number) => clock.instant(d, h).getTime() - now.getTime() >= MIN_LEAD_MINUTES * 60_000;
  const make = (d: string, h: number, adjusted?: string): Slot => ({
    type: "window",
    date: d,
    start_hour: h,
    starts_at: clock.instant(d, h).toISOString(),
    label: `${clock.dayLabel(d)} · ${windowLabel(h)}`,
    ...(adjusted ? { adjusted } : {}),
  });

  let hour = Math.floor(hourIn);
  let adjusted: string | undefined;
  if (!(WINDOW_START_HOURS as readonly number[]).includes(hour)) {
    hour = hour >= 18 ? 18 : ([...WINDOW_START_HOURS].reverse().find((h) => h <= hour) ?? WINDOW_START_HOURS[0]);
    adjusted = "snapped_to_window";
  }
  if (ok(date, hour)) return make(date, hour, adjusted);
  let d = date;
  for (let i = 0; i < BOOKABLE_DAYS && d <= last; i++) {
    for (const h of WINDOW_START_HOURS) {
      if ((d > date || h >= hour) && ok(d, h)) return make(d, h, "moved_to_next_free_window");
    }
    d = clock.addDays(d, 1);
  }
  return { ...ASAP, adjusted: "no_window_left" };
}

// ---------- text helpers ----------
export function clampText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const s = v.replace(/[ \t]+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

export function clampList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => clampText(x, maxLen)).filter(Boolean).slice(0, maxItems);
}

/**
 * Strips contact details a customer may type before the text reaches the model or our logs: phone numbers (8+ digits,
 * optional +91/spaces/dashes), emails, UPI ids and long card/account-like numbers. House numbers inside an address are
 * not detectable reliably; the prompt tells the model never to ask for or repeat them.
 */
export function redactPII(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Za-z0-9._-]{2,}@(ok\w+|ybl|ibl|axl|upi|paytm|apl|icici|sbi|hdfcbank)\b/gi, "[upi]")
    .replace(/(?:\+?\d[\s-]?){8,}\d/g, "[number]");
}

export function filterChips(slug: string, chips: unknown): string[] {
  const allowed = PROBLEM_CHIPS[slug] ?? [];
  const wanted = clampList(chips, 6, 40).map((c) => c.toLowerCase());
  return allowed.filter((a) => wanted.includes(a.toLowerCase())).slice(0, 4);
}

/** Neighbourhood from a saved address line (same rule as app/src/lib/locationModel.ts areaFromLine). */
export function areaFromLine(line1: string, city: string): string {
  const parts = line1
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && p.toLowerCase() !== city.trim().toLowerCase());
  return parts[parts.length - 1] ?? city;
}

// ---------- service validation ----------
export interface ServiceRow {
  id: string;
  provider_id: string;
  visit_fee: number;
  active: boolean;
  categories: { slug: string; name: string } | null;
  providers: { kyc_status: string; suspended: boolean; rating_avg: number | string; rating_count: number; profiles: { full_name: string } | null } | null;
}

/** null when the service can be drafted, else a message for the model. Checked again by create_booking at checkout. */
export function serviceProblem(row: ServiceRow | null, slug: string, uid: string): string | null {
  if (!row || !row.active || !row.providers || row.providers.kyc_status !== "verified" || row.providers.suspended) {
    return "That pro is not available for booking now. Pick another pro from search_providers.";
  }
  if (row.provider_id === uid) return "Customers cannot book themselves. Pick another pro.";
  if (row.categories?.slug !== slug) return `That provider_service_id is for ${row.categories?.name ?? "another service"}, not ${slug}.`;
  return null;
}

// ---------- provider ranking ----------
export interface SearchRow {
  provider_id: string;
  provider_service_id: string;
  full_name: string;
  skill_level: string;
  visit_fee: number;
  rating_avg: number | string;
  rating_count: number;
  jobs_completed: number;
  years_experience: number;
  is_online: boolean;
  distance_km: number | null;
  score: number;
  tier?: "best_match" | "nearest_best" | "strong_match";
  score_components?: Record<string, number>;
  matched_needs?: string[];
  evidence_quotes?: string[] | Record<string, string[]>;
}

export interface PastBooking {
  booking_date: string;
  category_slug: string;
  category_name: string;
  provider_id: string;
  provider_service_id: string;
  provider_name: string;
  status: string;
  rating: number | null;
}

export interface ProviderPick {
  provider_id: string;
  provider_service_id: string;
  name: string;
  skill_level: string;
  visit_fee: number;
  rating_avg: number;
  rating_count: number;
  jobs_completed: number;
  distance_km: number | null;
  is_online: boolean;
  previously_booked: boolean;
  reason: string;
  tier?: "best_match" | "nearest_best" | "strong_match";
  matched_needs?: string[];
  evidence_quotes?: string[];
}

const firstName = (n: string) => n.split(" ")[0] ?? n;

export function evidenceQuotes(value: SearchRow["evidence_quotes"]): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === "string");
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap((quotes) => Array.isArray(quotes) ? quotes.filter((x): x is string => typeof x === "string") : []).slice(0, 2);
}

/**
 * Up to `limit` pros: the drafted pro first, then pros the user rated ≥4 before (boosted), the best rated, the nearest,
 * then the rest by the search score. Each gets a one-line, data-backed reason.
 */
export function rankProviders(rows: SearchRow[], history: PastBooking[], now: Date, clock: MarketClock, preferredServiceId?: string | null, limit = 3): ProviderPick[] {
  if (!rows.length) return [];
  const lastByProvider = new Map<string, PastBooking>();
  const ratedByProvider = new Map<string, PastBooking>();
  for (const h of history) {
    if (!lastByProvider.has(h.provider_id)) lastByProvider.set(h.provider_id, h);
    if (h.rating != null && !ratedByProvider.has(h.provider_id)) ratedByProvider.set(h.provider_id, h);
  }
  const rating = (r: SearchRow) => Number(r.rating_avg) || 0;
  const boosted = rows.filter((r) => (ratedByProvider.get(r.provider_id)?.rating ?? 0) >= 4).sort((a, b) => rating(b) - rating(a) || a.provider_service_id.localeCompare(b.provider_service_id));
  const reviewed = rows.filter((r) => r.rating_count >= 3);
  // Ties break on provider_service_id so the order never depends on input order (deterministic, no hidden favourites).
  const tie = (a: SearchRow, b: SearchRow) => a.provider_service_id.localeCompare(b.provider_service_id);
  const bestRated = [...(reviewed.length ? reviewed : rows)].sort((a, b) => rating(b) - rating(a) || b.rating_count - a.rating_count || tie(a, b))[0];
  const nearest = rows.filter((r) => r.distance_km != null).sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0) || tie(a, b))[0];
  const byScore = [...rows].sort((a, b) => b.score - a.score || tie(a, b));
  const preferred = preferredServiceId ? rows.find((r) => r.provider_service_id === preferredServiceId) : undefined;

  const order: SearchRow[] = [];
  for (const r of [preferred, ...boosted, bestRated, nearest, ...byScore]) {
    if (r && !order.some((o) => o.provider_service_id === r.provider_service_id)) order.push(r);
  }
  return order.slice(0, limit).map((r) => {
    const rated = ratedByProvider.get(r.provider_id);
    const past = lastByProvider.get(r.provider_id);
    const name = firstName(r.full_name);
    let reason: string;
    if (rated && (rated.rating ?? 0) >= 4) reason = `You rated ${name} ★${rated.rating} in ${clock.monthLabel(rated.booking_date, now)}`;
    else if (past) reason = `You booked ${name} in ${clock.monthLabel(past.booking_date, now)}`;
    else if (r.matched_needs?.length) reason = `${r.matched_needs.map((x) => x.replaceAll("_", " ")).slice(0, 2).join(" · ")} mentioned in verified profiles and reviews`;
    else if (r === bestRated && r.rating_count > 0) reason = `Best rated · ★${rating(r).toFixed(1)} (${r.rating_count} reviews)`;
    else if (r === nearest && r.distance_km != null) reason = `Nearest expert · ${r.distance_km.toFixed(1)} km away`;
    else if (r.is_online) reason = "Online now";
    else reason = r.jobs_completed > 0 ? `${r.jobs_completed} jobs done on QuickServe` : "New on QuickServe";
    return {
      provider_id: r.provider_id,
      provider_service_id: r.provider_service_id,
      name: r.full_name,
      skill_level: r.skill_level,
      visit_fee: r.visit_fee,
      rating_avg: Math.round(rating(r) * 10) / 10,
      rating_count: r.rating_count,
      jobs_completed: r.jobs_completed,
      distance_km: r.distance_km == null ? null : Math.round(r.distance_km * 10) / 10,
      is_online: r.is_online,
      previously_booked: !!past,
      reason,
      tier: r.tier,
      matched_needs: r.matched_needs ?? [],
      evidence_quotes: evidenceQuotes(r.evidence_quotes),
    };
  });
}

// ---------- price estimate ----------
export interface PriceStats {
  category_slug: string;
  category_name: string;
  visit_fee_count: number;
  visit_fee_min: number | null;
  visit_fee_median: number | null;
  visit_fee_max: number | null;
  total_count: number;
  total_p25: number | null;
  total_median: number | null;
  total_p75: number | null;
}

/** Rounds paise to the nearest ₹10 for display ranges. */
const round10 = (paise: number | null) => (paise == null ? null : Math.round(paise / 1000) * 1000);

export function estimateCard(s: PriceStats, minSamples: number, lookbackDays: number) {
  const visit = s.visit_fee_count > 0 ? { min: s.visit_fee_min, median: s.visit_fee_median, max: s.visit_fee_max, count: s.visit_fee_count } : null;
  const total =
    s.total_count >= minSamples ? { low: round10(s.total_p25), median: round10(s.total_median), high: round10(s.total_p75), count: s.total_count } : null;
  return {
    type: "estimate" as const,
    category_slug: s.category_slug,
    category_name: s.category_name,
    visit_fee: visit,
    typical_total: total,
    note: total
      ? `Based on ${s.total_count} ${s.category_name} jobs on QuickServe in the last ${lookbackDays} days. The pro sends an itemised quote after inspecting.`
      : "Not enough recent jobs yet to show a typical total. The pro sends an itemised quote after inspecting.",
  };
}

/** Rupee view of the stats for the model (it must quote only these numbers). */
export function estimateForModel(s: PriceStats, minSamples: number) {
  const r = (p: number | null) => (p == null ? null : Math.round(p / 100));
  return {
    category: s.category_name,
    visit_fee_rupees: s.visit_fee_count ? { min: r(s.visit_fee_min), typical: r(s.visit_fee_median), max: r(s.visit_fee_max) } : "no data",
    typical_total_rupees:
      s.total_count >= minSamples
        ? { low: r(round10(s.total_p25)), typical: r(round10(s.total_median)), high: r(round10(s.total_p75)), based_on_jobs: s.total_count }
        : "not enough data",
    platform_fee_rupees: 29,
  };
}

// ---------- reply assembly ----------
export interface DraftCard {
  type: "draft";
  category_slug: string;
  category_name: string;
  provider: { provider_id: string; provider_service_id: string; name: string; visit_fee: number; rating_avg: number; rating_count: number };
  /** Structured job brief for the pro (brief.ts) and its deterministic rendering. */
  brief: JobBrief;
  description: string;
  /** v1 compatibility: same as `description` / the customer's own report. */
  description_en: string;
  description_original: string;
  problem_chips: string[];
  slot: Slot;
  address: { address_id: string | null; label: string | null; area: string; city: string; needs_full_address: boolean };
}

export interface ComposeInput {
  /** The model's `respond` arguments: untrusted, may be malformed. */
  respond: unknown;
  slug: string | null;
  categoryName: string | null;
  draft: DraftCard | null;
  searchRows: SearchRow[] | null;
  stats: PriceStats | null;
  history: PastBooking[];
  now: Date;
  clock: MarketClock;
  minPriceSamples: number;
  priceLookbackDays: number;
  isVoice: boolean;
  /** The customer's latest (redacted) text, for deterministic safety/language guardrails. */
  userText: string;
  /** A photo was attached this turn (diagnosis confidence is capped at medium). */
  hasPhoto?: boolean;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Builds the client reply from tool results (the only source of pros, prices and drafts) plus the model's free text.
 * Malformed or missing model fields degrade to safe defaults; nothing numeric comes from the model.
 */
export function composeReply(i: ComposeInput) {
  const r = obj(i.respond) ?? {};
  const cards: Record<string, unknown>[] = [];
  const voice = i.isVoice ? cleanTranscript(r.transcript_original ?? r.transcript, r.transcript_en) : null;
  const transcript = voice?.transcript_original ?? null;
  const heard = `${i.userText} ${transcript ?? ""}`.trim();
  const language: Language = LANGUAGES.includes(r.language as Language) ? (r.language as Language) : detectLanguage(heard);
  const lang3 = language === "hi" ? "hi" : language === "te" ? "te" : "en";

  const safety = obj(r.safety);
  const safetySteps = clampList(safety?.steps, 5, 180).map(sanitizeReply).filter(Boolean);
  const detected = detectHazard(heard);
  if (safety && safetySteps.length) {
    const hazard = typeof safety.hazard === "string" && safety.hazard in EMERGENCY_NUMBERS ? safety.hazard : (detected ?? "other");
    cards.push({ type: "safety", hazard, title: clampText(safety.title, 80) || "Stay safe first", steps: safetySteps, emergency: EMERGENCY_NUMBERS[hazard] });
  } else if (detected) {
    // Guardrail: the customer described a hazard but the model gave no safety steps.
    const d = DEFAULT_SAFETY[detected][lang3];
    cards.push({ type: "safety", hazard: detected, title: d.title, steps: d.steps, emergency: EMERGENCY_NUMBERS[detected], source: "policy" });
  }

  const dx = obj(r.diagnosis);
  const issues = clampList(dx?.likely_issues, 4, 140).map(sanitizeReply).filter(Boolean);
  const checks = clampList(dx?.pro_checks, 4, 140).map(sanitizeReply).filter(Boolean);
  if (dx && (issues.length || checks.length)) {
    let confidence = (CONFIDENCE_LEVELS as readonly string[]).includes(dx.confidence as string) ? (dx.confidence as string) : "low";
    if (i.hasPhoto && confidence === "high") confidence = "medium"; // a photo is still not an inspection
    cards.push({
      type: "diagnosis",
      title: sanitizeReply(clampText(dx.title, 80)) || "What might be wrong",
      likely_issues: issues,
      pro_checks: checks,
      safety_tip: sanitizeReply(clampText(dx.safety_tip, 220)) || null,
      confidence,
      category_slug: i.slug,
    });
  }

  if (i.slug && i.stats && (r.show_estimate === true || i.draft)) cards.push(estimateCard(i.stats, i.minPriceSamples, i.priceLookbackDays));

  if (i.slug && i.searchRows && (r.show_providers === true || i.draft)) {
    const draftPro = i.draft?.category_slug === i.slug ? i.draft.provider : null;
    let picks = rankProviders(i.searchRows, i.history, i.now, i.clock, draftPro?.provider_service_id);
    if (draftPro && !picks.some((p) => p.provider_service_id === draftPro.provider_service_id)) {
      // Drafted from history but outside today's search radius: still show it first.
      const past = i.history.find((h) => h.provider_id === draftPro.provider_id);
      picks = [
        {
          provider_id: draftPro.provider_id,
          provider_service_id: draftPro.provider_service_id,
          name: draftPro.name,
          skill_level: "",
          visit_fee: draftPro.visit_fee,
          rating_avg: draftPro.rating_avg,
          rating_count: draftPro.rating_count,
          jobs_completed: 0,
          distance_km: null,
          is_online: false,
          previously_booked: !!past,
          reason: past ? `You booked ${firstName(draftPro.name)} before` : "Your pick",
        },
        ...picks,
      ].slice(0, 3);
    }
    if (picks.length) cards.push({ type: "providers", category_slug: i.slug, category_name: i.categoryName ?? i.slug, providers: picks });
  }

  if (i.draft && r.show_draft !== false) cards.push(i.draft as unknown as Record<string, unknown>);

  const noPros = !!i.slug && !!i.searchRows && i.searchRows.length === 0 && !i.draft;
  const fallbackText = noPros
    ? "Sorry, there are no verified pros for this service near your location yet. Try another location or service."
    : i.draft
      ? draftReadyText(language)
      : cards.length
        ? "Here's what I found."
        : "Sorry, I didn't catch that. Could you describe the problem again?";
  let replyText = sanitizeReply(clampText(r.reply_text, 700));
  // Guardrail: the AI never books or charges; replace any reply that claims otherwise.
  const replaced = !!replyText && claimsBooking(replyText);
  if (!replyText || replaced) replyText = fallbackText;
  const diagnosis = cards.find((c) => c.type === "diagnosis");
  const handoff: HandoffReason | null = handoffReason({
    userText: heard,
    hasSafety: cards.some((c) => c.type === "safety"),
    diagnosisConfidence: diagnosis ? String(diagnosis.confidence) : null,
  });
  return {
    reply_text: replyText,
    language,
    quick_replies: quickRepliesFor(clampList(r.quick_replies, 6, 40).map(sanitizeReply).filter(Boolean), {
      hasDraft: cards.some((c) => c.type === "draft"),
      hasProviders: cards.some((c) => c.type === "providers"),
      nothingFound: !cards.length,
      language,
    }),
    transcript,
    transcript_en: voice?.transcript_en ?? null,
    handoff: handoff ? { reason: handoff } : null,
    cards,
    guardrails: { safety_added: cards.some((c) => c.source === "policy"), reply_replaced: replaced },
  };
}

/** Voice transcripts: clamped, PII-redacted; the English line is dropped when empty or identical to the original. */
export function cleanTranscript(original: unknown, english: unknown): { transcript_original: string; transcript_en: string | null } | null {
  const o = redactPII(clampText(original, 600));
  if (!o) return null;
  const en = redactPII(clampText(english, 800));
  return { transcript_original: o, transcript_en: en && en.toLowerCase() !== o.toLowerCase() ? en : null };
}

export type Clarity = (typeof CLARITY_LEVELS)[number];

export interface Transcription {
  transcript_original: string;
  transcript_en: string | null;
  language: Language;
  clarity: Clarity;
}

/**
 * Validates the model's `transcribe` call. Malformed output never becomes a confident transcript: an empty
 * transcript is always "unclear", an invalid clarity is "partial", and English speech gets no translation line.
 */
export function parseTranscription(args: unknown): Transcription {
  const a = obj(args) ?? {};
  const t = cleanTranscript(a.transcript_original, a.transcript_en);
  const original = t?.transcript_original ?? "";
  const language: Language = LANGUAGES.includes(a.language as Language) ? (a.language as Language) : original ? detectLanguage(original) : "other";
  let clarity: Clarity = (CLARITY_LEVELS as readonly string[]).includes(a.clarity as string) ? (a.clarity as Clarity) : "partial";
  if (!original) clarity = "unclear";
  return { transcript_original: original, transcript_en: language === "en" ? null : (t?.transcript_en ?? null), language, clarity };
}

export interface VoiceMeta {
  transcript_original: string;
  transcript_en: string | null;
  edited: boolean;
}

/**
 * A chat message that came from a reviewed voice transcript. The customer may have edited it, so the sent text is the
 * source of truth; the English translation is kept only if they did not edit (it would no longer match).
 */
export function voiceMeta(v: unknown, sentText: string): VoiceMeta | null {
  const o = obj(v);
  if (!o || !sentText) return null;
  const edited = o.edited === true;
  const en = edited ? "" : redactPII(clampText(o.transcript_en, 800));
  return { transcript_original: sentText, transcript_en: en && en.toLowerCase() !== sentText.toLowerCase() ? en : null, edited };
}

/** Short history-list title from the first message (already redacted). */
export function conversationTitle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t;
}

/** Compact memory of what was shown, so follow-ups ("make it 4 pm") can refer back to it. */
export function summarize(cards: Record<string, unknown>[]): string {
  const bits: string[] = [];
  for (const c of cards) {
    if (c.type === "draft") {
      const d = c as unknown as DraftCard;
      bits.push(`draft ${d.category_name} with ${d.provider.name} [provider_service_id ${d.provider.provider_service_id}], ${d.slot.label}, issue: "${d.brief?.issue_summary ?? d.description_en}"`);
    } else if (c.type === "providers") {
      bits.push(`pros: ${(c.providers as ProviderPick[]).map((p) => `${p.name} [${p.provider_service_id}]`).join(", ")}`);
    } else bits.push(String(c.type));
  }
  return bits.length ? `[shown: ${bits.join("; ")}]` : "";
}

export interface HistoryRow {
  role: string;
  content: string;
  payload: Record<string, unknown> | null;
}

/** Stored chat rows → Gemini contents: alternating roles, starting with a user turn, unanswered trailing user turn dropped. */
export function toContents(rows: HistoryRow[]): { role: "user" | "model"; parts: { text: string }[] }[] {
  const out: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const row of rows) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const role = row.role === "assistant" ? "model" : "user";
    const summary = row.role === "assistant" && typeof row.payload?.summary === "string" ? `\n${row.payload.summary}` : "";
    const text = `${row.content}${summary}`.trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.parts.push({ text });
    else out.push({ role, parts: [{ text }] });
  }
  while (out.length && out[0]!.role !== "user") out.shift();
  if (out.length && out[out.length - 1]!.role === "user") out.pop();
  return out;
}

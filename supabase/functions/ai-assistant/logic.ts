// Pure helpers for the AI assistant (no I/O): IST time, slot validation, provider ranking, card assembly.

export const IST_OFFSET_MIN = 330;
/** Start hours of the Book screen's 2-hour windows (app/src/lib/schedule.ts WINDOW_START_HOURS). */
export const WINDOW_START_HOURS = [8, 10, 12, 14, 16, 18] as const;
export const MIN_LEAD_MINUTES = 60;
export const BOOKABLE_DAYS = 7;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

/** Server-defined emergency numbers (India) so the model never makes them up. */
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

// ---------- IST time ----------
interface IstParts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  dow: number;
}

export function istParts(at: Date): IstParts {
  const x = new Date(at.getTime() + IST_OFFSET_MIN * 60_000);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(), min: x.getUTCMinutes(), dow: x.getUTCDay() };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function istDateKey(at: Date): string {
  const p = istParts(at);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** UTC instant of an IST wall-clock time on an IST date key. */
export function istInstant(dateKey: string, hour: number, minute = 0): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, hour, minute) - IST_OFFSET_MIN * 60_000);
}

/** Start of today in IST, as a UTC instant (rate-limit day boundary). */
export function istMidnight(now: Date): Date {
  return istInstant(istDateKey(now), 0);
}

export function addDaysKey(dateKey: string, days: number): string {
  return istDateKey(new Date(istInstant(dateKey, 12).getTime() + days * 86_400_000));
}

export function windowLabel(hour: number): string {
  const end = hour + 2;
  const h12 = (h: number) => String(h % 12 === 0 ? 12 : h % 12);
  const a = hour < 12 ? "am" : "pm";
  const b = end < 12 ? "am" : "pm";
  return a === b ? `${h12(hour)}–${h12(end)} ${b}` : `${h12(hour)} ${a}–${h12(end)} ${b}`;
}

export function dayLabelKey(dateKey: string): string {
  const p = istParts(istInstant(dateKey, 12));
  return `${WEEKDAY[p.dow]}, ${p.d} ${MONTH[p.m - 1]}`;
}

export function monthYearLabel(iso: string, now: Date): string {
  const p = istParts(new Date(iso));
  const n = istParts(now);
  return p.y === n.y ? MONTH_LONG[p.m - 1]! : `${MONTH_LONG[p.m - 1]} ${p.y}`;
}

/** "Saturday 14 Nov 2026, 09:30 IST" for the system prompt. */
export function nowLabel(now: Date): string {
  const p = istParts(now);
  const long = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][p.dow];
  return `${long} ${p.d} ${MONTH[p.m - 1]} ${p.y}, ${pad(p.h)}:${pad(p.min)} IST`;
}

// ---------- slots ----------
export type Slot =
  | { type: "asap"; label: string; adjusted?: string }
  | { type: "window"; date: string; start_hour: number; starts_at: string; label: string; adjusted?: string };

const ASAP: Slot = { type: "asap", label: "As soon as possible" };

function windowOk(dateKey: string, hour: number, now: Date): boolean {
  return istInstant(dateKey, hour).getTime() - now.getTime() >= MIN_LEAD_MINUTES * 60_000;
}

function makeWindow(dateKey: string, hour: number, adjusted?: string): Slot {
  return {
    type: "window",
    date: dateKey,
    start_hour: hour,
    starts_at: istInstant(dateKey, hour).toISOString(),
    label: `${dayLabelKey(dateKey)} · ${windowLabel(hour)}`,
    ...(adjusted ? { adjusted } : {}),
  };
}

/**
 * Validates a model-proposed slot against the Book screen's rules: a 2-hour window starting at 8/10/…/18 IST, within the
 * next 7 days and at least 60 minutes away. Off-grid hours snap to the window containing them (19:00 → 6–8 pm); a
 * window that has already passed moves to the next free one. Anything unusable becomes ASAP.
 */
export function normalizeSlot(raw: { type?: unknown; date?: unknown; start_hour?: unknown }, now: Date): Slot {
  if (raw.type !== "window") return ASAP;
  const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  const hourIn = typeof raw.start_hour === "number" ? raw.start_hour : Number(raw.start_hour);
  if (!date || !Number.isFinite(hourIn)) return { ...ASAP, adjusted: "invalid_slot" };
  const today = istDateKey(now);
  const last = addDaysKey(today, BOOKABLE_DAYS - 1);
  if (date < today || date > last) return { ...ASAP, adjusted: "date_out_of_range" };

  let hour = Math.floor(hourIn);
  let adjusted: string | undefined;
  if (!(WINDOW_START_HOURS as readonly number[]).includes(hour)) {
    hour = hour >= 18 ? 18 : ([...WINDOW_START_HOURS].reverse().find((h) => h <= hour) ?? WINDOW_START_HOURS[0]);
    adjusted = "snapped_to_window";
  }
  if (windowOk(date, hour, now)) return makeWindow(date, hour, adjusted);

  // Next available window from the requested one onwards.
  let d = date;
  for (let i = 0; i < BOOKABLE_DAYS && d <= last; i++) {
    for (const h of WINDOW_START_HOURS) {
      if ((d > date || h >= hour) && windowOk(d, h, now)) return makeWindow(d, h, "moved_to_next_free_window");
    }
    d = addDaysKey(d, 1);
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
}

const firstName = (n: string) => n.split(" ")[0] ?? n;

/**
 * Up to `limit` pros: the drafted pro first, then pros the user rated ≥4 before (boosted), the best rated, the nearest,
 * then the rest by the search score. Each gets a one-line, data-backed reason.
 */
export function rankProviders(rows: SearchRow[], history: PastBooking[], now: Date, preferredServiceId?: string | null, limit = 3): ProviderPick[] {
  if (!rows.length) return [];
  const lastByProvider = new Map<string, PastBooking>();
  const ratedByProvider = new Map<string, PastBooking>();
  for (const h of history) {
    if (!lastByProvider.has(h.provider_id)) lastByProvider.set(h.provider_id, h);
    if (h.rating != null && !ratedByProvider.has(h.provider_id)) ratedByProvider.set(h.provider_id, h);
  }
  const rating = (r: SearchRow) => Number(r.rating_avg) || 0;
  const boosted = rows.filter((r) => (ratedByProvider.get(r.provider_id)?.rating ?? 0) >= 4).sort((a, b) => rating(b) - rating(a));
  const reviewed = rows.filter((r) => r.rating_count >= 3);
  const bestRated = [...(reviewed.length ? reviewed : rows)].sort((a, b) => rating(b) - rating(a) || b.rating_count - a.rating_count)[0];
  const nearest = rows.filter((r) => r.distance_km != null).sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0))[0];
  const byScore = [...rows].sort((a, b) => b.score - a.score);
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
    if (rated && (rated.rating ?? 0) >= 4) reason = `You rated ${name} ★${rated.rating} in ${monthYearLabel(rated.booking_date, now)}`;
    else if (past) reason = `You booked ${name} in ${monthYearLabel(past.booking_date, now)}`;
    else if (r === bestRated && r.rating_count > 0) reason = `Best rated · ★${rating(r).toFixed(1)} (${r.rating_count} reviews)`;
    else if (r === nearest && r.distance_km != null) reason = `Nearest expert · ${r.distance_km.toFixed(1)} km away`;
    else if (r.is_online) reason = "Online now · usually accepts in minutes";
    else reason = `${r.jobs_completed} jobs done on QuickServe`;
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

/** Minimum completed/approved jobs before a typical-total range is shown. */
export const MIN_TOTAL_SAMPLES = 3;

/** Rounds paise to the nearest ₹10 for display ranges. */
const round10 = (paise: number | null) => (paise == null ? null : Math.round(paise / 1000) * 1000);

export function estimateCard(s: PriceStats) {
  const visit = s.visit_fee_count > 0 ? { min: s.visit_fee_min, median: s.visit_fee_median, max: s.visit_fee_max, count: s.visit_fee_count } : null;
  const total =
    s.total_count >= MIN_TOTAL_SAMPLES
      ? { low: round10(s.total_p25), median: round10(s.total_median), high: round10(s.total_p75), count: s.total_count }
      : null;
  return {
    type: "estimate" as const,
    category_slug: s.category_slug,
    category_name: s.category_name,
    visit_fee: visit,
    typical_total: total,
    note: total
      ? `Based on ${s.total_count} recent ${s.category_name} jobs on QuickServe. The pro sends an itemised quote after inspecting.`
      : "Not enough completed jobs yet to show a typical total. The pro sends an itemised quote after inspecting.",
  };
}

/** Rupee view of the stats for the model (it must quote only these numbers). */
export function estimateForModel(s: PriceStats) {
  const r = (p: number | null) => (p == null ? null : Math.round(p / 100));
  return {
    category: s.category_name,
    visit_fee_rupees: s.visit_fee_count ? { min: r(s.visit_fee_min), typical: r(s.visit_fee_median), max: r(s.visit_fee_max) } : "no data",
    typical_total_rupees:
      s.total_count >= MIN_TOTAL_SAMPLES
        ? { low: r(round10(s.total_p25)), typical: r(round10(s.total_median)), high: r(round10(s.total_p75)), based_on_jobs: s.total_count }
        : "not enough data",
    platform_fee_rupees: 29,
  };
}

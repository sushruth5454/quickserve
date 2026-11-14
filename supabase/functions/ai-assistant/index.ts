// QuickServe AI booking assistant. Verifies the caller's JWT, rate-limits per user, runs a Gemini function-calling loop
// over read-only server-side tools and returns a strict JSON contract:
//   { conversation_id, reply_text, language, quick_replies[], cards[], transcript?, usage, limits, request_id }
// The assistant never creates or pays for bookings: draft cards hand off to the app's normal checkout.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, requireEnv } from "../_shared/razorpay.ts";
import { type Content, FALLBACK_MODEL, GeminiError, generateContent, MAX_OUTPUT_TOKENS, MODELS, type Part, THINKING_LEVEL } from "./gemini.ts";
import {
  areaFromLine,
  clampList,
  clampText,
  EMERGENCY_NUMBERS,
  estimateCard,
  estimateForModel,
  filterChips,
  istMidnight,
  normalizeSlot,
  type PastBooking,
  type PriceStats,
  PROBLEM_CHIPS,
  type ProviderPick,
  rankProviders,
  type SearchRow,
  type Slot,
} from "./logic.ts";
import { functionDeclarations, systemPrompt } from "./prompt.ts";

const DAILY_MESSAGE_LIMIT = Number(Deno.env.get("AI_DAILY_MESSAGE_LIMIT") ?? 30);
const DAILY_VOICE_LIMIT = Number(Deno.env.get("AI_DAILY_VOICE_LIMIT") ?? 10);
/** Whole-request budget for the model loop (the client waits up to 60 s). */
const REQUEST_BUDGET_MS = 50_000;
const MAX_STEPS = 6;
const MAX_TEXT = 1000;
/** ~1.5 MB of audio: 60 s of AAC at the HIGH_QUALITY preset is ~1 MB. */
const MAX_AUDIO_B64 = 2_100_000;
const HISTORY_ROWS = 10;
const AUDIO_MIME: Record<string, string> = {
  "audio/m4a": "audio/m4a",
  "audio/x-m4a": "audio/m4a",
  "audio/mp4": "audio/m4a",
  "audio/aac": "audio/aac",
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mp3",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/webm": "audio/webm",
  "audio/ogg": "audio/ogg",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGS = ["en", "hi", "te", "hinglish", "tenglish", "other"];
const SORTS = ["recommended", "rating", "price", "distance", "experience"];
const HAZARDS = Object.keys(EMERGENCY_NUMBERS);
const DEFAULT_LOCATION = { area: "Benz Circle", city: "Vijayawada", lat: 16.4995, lng: 80.656 };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Ctx {
  uid: string;
  now: Date;
  admin: SupabaseClient;
  userClient: SupabaseClient;
  categories: { slug: string; name: string }[];
  history: PastBooking[];
  location: { area: string; city: string; lat: number; lng: number };
  address: { address_id: string | null; label: string | null; area: string; city: string; needs_full_address: boolean };
}

interface DraftCard {
  type: "draft";
  category_slug: string;
  category_name: string;
  provider: { provider_id: string; provider_service_id: string; name: string; visit_fee: number; rating_avg: number; rating_count: number };
  description_en: string;
  description_original: string;
  problem_chips: string[];
  slot: Slot;
  address: Ctx["address"];
}

interface State {
  searches: Map<string, SearchRow[]>;
  estimates: Map<string, PriceStats | null>;
  draft: DraftCard | null;
  lastSlug: string | null;
  tools: { name: string; args: unknown; error?: string }[];
  usage: { input: number; output: number; calls: number };
}

const newState = (): State => ({ searches: new Map(), estimates: new Map(), draft: null, lastSlug: null, tools: [], usage: { input: 0, output: 0, calls: 0 } });

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

// ---------- data loaders (all scoped to the caller) ----------
async function loadHistory(admin: SupabaseClient, uid: string): Promise<PastBooking[]> {
  const { data, error } = await admin
    .from("bookings")
    .select("created_at, status, provider_id, provider_service_id, categories(slug, name), providers(profiles(full_name)), reviews(rating)")
    .eq("customer_id", uid)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((b: any) => {
    const review = Array.isArray(b.reviews) ? b.reviews[0] : b.reviews;
    return {
      booking_date: b.created_at,
      category_slug: b.categories?.slug ?? "",
      category_name: b.categories?.name ?? "",
      provider_id: b.provider_id,
      provider_service_id: b.provider_service_id,
      provider_name: b.providers?.profiles?.full_name ?? "Pro",
      status: b.status,
      rating: review?.rating ?? null,
    };
  });
}

async function searchPros(ctx: Ctx, state: State, slug: string, opts: Record<string, unknown> = {}): Promise<SearchRow[]> {
  const lat = num(opts.lat, -90, 90);
  const lng = num(opts.lng, -180, 180);
  // Model-supplied coordinates are only honoured near the selected location (it has no reason to search elsewhere).
  const useOwn = lat != null && lng != null && Math.abs(lat - ctx.location.lat) < 0.5 && Math.abs(lng - ctx.location.lng) < 0.5;
  const minRating = num(opts.min_rating, 1, 5);
  const maxFee = num(opts.max_visit_fee_rupees, 0, 5000);
  const { data, error } = await ctx.userClient.rpc("search_providers", {
    p_category_slug: slug,
    p_lat: useOwn ? lat : ctx.location.lat,
    p_lng: useOwn ? lng : ctx.location.lng,
    p_sort: SORTS.includes(opts.sort as string) ? opts.sort : "recommended",
    p_min_rating: minRating,
    p_max_visit_fee: maxFee == null ? null : Math.round(maxFee * 100),
    p_online_only: opts.online_only === true,
    p_limit: 10,
  });
  if (error) throw error;
  const rows = (data ?? []) as SearchRow[];
  state.searches.set(slug, rows);
  state.lastSlug = slug;
  return rows;
}

async function priceStats(ctx: Ctx, state: State, slug: string): Promise<PriceStats | null> {
  if (state.estimates.has(slug)) return state.estimates.get(slug) ?? null;
  const { data, error } = await ctx.admin.rpc("ai_price_estimate", { p_category_slug: slug });
  if (error) throw error;
  const stats = (data ?? null) as PriceStats | null;
  state.estimates.set(slug, stats);
  return stats;
}

async function draftBooking(ctx: Ctx, state: State, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const slug = validSlug(ctx, args.category_slug);
  if (!slug) return { error: "Unknown category_slug." };
  const psId = typeof args.provider_service_id === "string" && UUID.test(args.provider_service_id) ? args.provider_service_id : null;
  if (!psId) return { error: "provider_service_id must be one returned by search_providers or the history." };
  const description = clampText(args.description_en, 250);
  if (!description) return { error: "description_en is required." };
  const { data: ps } = await ctx.admin
    .from("provider_services")
    .select("id, provider_id, visit_fee, active, categories!inner(slug, name), providers!inner(kyc_status, suspended, rating_avg, rating_count, profiles(full_name))")
    .eq("id", psId)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const p = ps as any;
  if (!p || !p.active || p.providers?.kyc_status !== "verified" || p.providers?.suspended || p.provider_id === ctx.uid) {
    return { error: "That pro is not available for booking now. Pick another pro from search_providers." };
  }
  if (p.categories?.slug !== slug) return { error: `That provider_service_id is for ${p.categories?.name}, not ${slug}.` };
  const slot = normalizeSlot({ type: args.slot_type, date: args.slot_date, start_hour: args.slot_start_hour }, ctx.now);
  const draft: DraftCard = {
    type: "draft",
    category_slug: slug,
    category_name: p.categories.name,
    provider: {
      provider_id: p.provider_id,
      provider_service_id: p.id,
      name: p.providers?.profiles?.full_name ?? "Pro",
      visit_fee: p.visit_fee,
      rating_avg: Math.round(Number(p.providers?.rating_avg ?? 0) * 10) / 10,
      rating_count: p.providers?.rating_count ?? 0,
    },
    description_en: description,
    description_original: clampText(args.description_original, 300),
    problem_chips: filterChips(slug, args.problem_chips),
    slot,
    address: ctx.address,
  };
  state.draft = draft;
  state.lastSlug = slug;
  return {
    result: {
      ok: true,
      pro: draft.provider.name,
      visit_fee_rupees: draft.provider.visit_fee / 100,
      slot: slot.label,
      ...(slot.adjusted ? { slot_note: `Adjusted (${slot.adjusted}); tell the customer the slot shown.` } : {}),
      address: [ctx.address.label, ctx.address.area].filter(Boolean).join(", "),
      next: "The customer reviews and pays in checkout. Now call respond.",
    },
  };
}

function validSlug(ctx: Ctx, v: unknown): string | null {
  return typeof v === "string" && ctx.categories.some((c) => c.slug === v) ? v : null;
}

async function execTool(ctx: Ctx, state: State, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (name) {
    case "list_categories":
      return { result: ctx.categories };
    case "get_my_history":
      return {
        result: ctx.history.map((h) => ({
          date: h.booking_date.slice(0, 10),
          service: h.category_slug,
          pro: h.provider_name,
          provider_service_id: h.provider_service_id,
          status: h.status,
          customer_rating: h.rating,
        })),
      };
    case "search_providers": {
      const slug = validSlug(ctx, args.category_slug);
      if (!slug) return { error: "Unknown category_slug. Use list_categories." };
      const rows = await searchPros(ctx, state, slug, args);
      const rated = new Map(ctx.history.filter((h) => h.rating != null).map((h) => [h.provider_id, h.rating]));
      const booked = new Set(ctx.history.map((h) => h.provider_id));
      return {
        result: {
          service: slug,
          near: `${ctx.location.area}, ${ctx.location.city}`,
          pros: rows.slice(0, 6).map((r) => ({
            provider_service_id: r.provider_service_id,
            name: r.full_name,
            skill: r.skill_level,
            visit_fee_rupees: r.visit_fee / 100,
            rating: Math.round(Number(r.rating_avg) * 10) / 10,
            reviews: r.rating_count,
            jobs_done: r.jobs_completed,
            distance_km: r.distance_km == null ? null : Math.round(r.distance_km * 10) / 10,
            online_now: r.is_online,
            booked_before: booked.has(r.provider_id),
            customer_rating: rated.get(r.provider_id) ?? null,
          })),
          problem_chips: PROBLEM_CHIPS[slug] ?? [],
          ...(rows.length ? {} : { note: "No verified pros serve this location yet." }),
        },
      };
    }
    case "get_price_estimate": {
      const slug = validSlug(ctx, args.category_slug);
      if (!slug) return { error: "Unknown category_slug." };
      const stats = await priceStats(ctx, state, slug);
      state.lastSlug = slug;
      return stats ? { result: estimateForModel(stats) } : { error: "No price data for this service." };
    }
    case "draft_booking":
      return draftBooking(ctx, state, args);
    default:
      return { error: `Unknown tool ${name}.` };
  }
}

// ---------- model loop ----------
interface Respond {
  args: Record<string, unknown>;
  model: string;
}

async function runAgent(model: string, ctx: Ctx, state: State, system: string, contents: Content[], apiKey: string, deadline: number): Promise<Respond> {
  const tools = [{ functionDeclarations: functionDeclarations(ctx.categories.map((c) => c.slug)) }];
  const convo = [...contents];
  for (let step = 0; step < MAX_STEPS; step++) {
    const last = step === MAX_STEPS - 1;
    const remaining = deadline - Date.now();
    if (remaining < 2000) throw new GeminiError("request budget exhausted", 0, false);
    const res = await generateContent(
      model,
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: convo,
        tools,
        toolConfig: { functionCallingConfig: last ? { mode: "ANY", allowedFunctionNames: ["respond"] } : { mode: "ANY" } },
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: THINKING_LEVEL } },
      },
      apiKey,
      Math.min(remaining, 25_000),
    );
    state.usage.calls += 1;
    state.usage.input += res.usageMetadata?.promptTokenCount ?? 0;
    state.usage.output += (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0);
    const cand = res.candidates?.[0];
    const parts: Part[] = cand?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
      if (text) return { args: { reply_text: text }, model };
      throw new GeminiError(`no output (finishReason ${cand?.finishReason ?? res.promptFeedback?.blockReason ?? "none"})`, 0, true);
    }
    convo.push({ role: "model", parts });
    const others = calls.filter((c) => c.functionCall!.name !== "respond");
    const responses: Part[] = [];
    for (const c of others) {
      const { name, id } = c.functionCall!;
      const args = (c.functionCall!.args ?? {}) as Record<string, unknown>;
      let response: Record<string, unknown>;
      try {
        response = await execTool(ctx, state, name, args);
      } catch (e) {
        console.error(`tool ${name} failed`, (e as Error).message);
        response = { error: "Temporary problem fetching data. Answer without it." };
      }
      state.tools.push({ name, args, ...(typeof response.error === "string" ? { error: response.error } : {}) });
      responses.push({ functionResponse: { name, ...(id ? { id } : {}), response } });
    }
    const respond = calls.find((c) => c.functionCall!.name === "respond");
    if (respond) return { args: (respond.functionCall!.args ?? {}) as Record<string, unknown>, model };
    convo.push({ role: "user", parts: responses });
  }
  throw new GeminiError("no respond call within step limit", 0, true);
}

// ---------- response assembly ----------
async function buildCards(ctx: Ctx, state: State, r: Record<string, unknown>) {
  const slug = validSlug(ctx, r.category_slug) ?? state.draft?.category_slug ?? state.lastSlug;
  const cards: Record<string, unknown>[] = [];

  const safety = (r.safety ?? null) as Record<string, unknown> | null;
  const safetySteps = clampList(safety?.steps, 5, 180);
  if (safety && safetySteps.length) {
    const hazard = HAZARDS.includes(safety.hazard as string) ? (safety.hazard as string) : "other";
    cards.push({ type: "safety", hazard, title: clampText(safety.title, 80) || "Stay safe first", steps: safetySteps, emergency: EMERGENCY_NUMBERS[hazard] });
  }

  const dx = (r.diagnosis ?? null) as Record<string, unknown> | null;
  const issues = clampList(dx?.likely_issues, 4, 140);
  const checks = clampList(dx?.pro_checks, 4, 140);
  if (dx && (issues.length || checks.length)) {
    cards.push({
      type: "diagnosis",
      title: clampText(dx.title, 80) || "What might be wrong",
      likely_issues: issues,
      pro_checks: checks,
      safety_tip: clampText(dx.safety_tip, 220) || null,
      category_slug: slug,
    });
  }

  if (slug && (r.show_estimate === true || state.draft)) {
    const stats = await priceStats(ctx, state, slug).catch(() => null);
    if (stats) cards.push(estimateCard(stats));
  }

  if (slug && (r.show_providers === true || state.draft)) {
    const rows = state.searches.get(slug) ?? (await searchPros(ctx, state, slug).catch(() => [] as SearchRow[]));
    const draftPro = state.draft?.category_slug === slug ? state.draft.provider : null;
    let picks: ProviderPick[] = rankProviders(rows, ctx.history, ctx.now, draftPro?.provider_service_id);
    if (draftPro && !picks.some((p) => p.provider_service_id === draftPro.provider_service_id)) {
      // Drafted from history but outside today's search radius: still show it first.
      const past = ctx.history.find((h) => h.provider_id === draftPro.provider_id);
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
          reason: past ? `You booked ${draftPro.name.split(" ")[0]} before` : "Your pick",
        },
        ...picks,
      ].slice(0, 3);
    }
    if (picks.length) {
      cards.push({ type: "providers", category_slug: slug, category_name: ctx.categories.find((c) => c.slug === slug)?.name ?? slug, providers: picks });
    }
  }

  if (state.draft && r.show_draft !== false) cards.push(state.draft);
  return cards;
}

/** Compact memory of what was shown, so follow-ups ("make it 4 pm") can refer back to it. */
function summarize(cards: Record<string, unknown>[]): string {
  const bits: string[] = [];
  for (const c of cards) {
    if (c.type === "draft") {
      const d = c as unknown as DraftCard;
      bits.push(`draft ${d.category_name} with ${d.provider.name} [provider_service_id ${d.provider.provider_service_id}], ${d.slot.label}, "${d.description_en}"`);
    } else if (c.type === "providers") {
      bits.push(`pros: ${(c.providers as ProviderPick[]).map((p) => `${p.name} [${p.provider_service_id}]`).join(", ")}`);
    } else bits.push(String(c.type));
  }
  return bits.length ? `[shown: ${bits.join("; ")}]` : "";
}

function toContents(rows: { role: string; content: string; payload: Record<string, unknown> | null }[]): Content[] {
  const out: Content[] = [];
  for (const row of rows) {
    const role = row.role === "assistant" ? "model" : "user";
    const summary = row.role === "assistant" && typeof row.payload?.summary === "string" ? `\n${row.payload.summary}` : "";
    const text = `${row.content}${summary}`.trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.parts.push({ text });
    else out.push({ role, parts: [{ text }] });
  }
  // History must start with a user turn.
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const requestId = crypto.randomUUID();
  const started = Date.now();

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const admin = createClient(supabaseUrl, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "unauthorized", "Please sign in again.");
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) throw new HttpError(401, "unauthorized", "Please sign in again.");
    const uid = userData.user.id;
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new HttpError(503, "not_configured", "QuickServe AI is not available right now.");
    const userClient = createClient(supabaseUrl, requireEnv("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // ---- input ----
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = typeof body.message === "string" ? body.message.trim() : "";
    if (text.length > MAX_TEXT) throw new HttpError(400, "too_long", `Please keep messages under ${MAX_TEXT} characters.`);
    const audioIn = (body.audio ?? null) as { data?: unknown; mime_type?: unknown } | null;
    let audio: { data: string; mimeType: string } | null = null;
    if (audioIn) {
      const mime = AUDIO_MIME[String(audioIn.mime_type ?? "").toLowerCase()];
      const data = typeof audioIn.data === "string" ? audioIn.data.replace(/^data:[^,]+,/, "") : "";
      if (!mime || !data || !/^[A-Za-z0-9+/=\r\n]+$/.test(data.slice(0, 2000))) throw new HttpError(400, "bad_audio", "That recording format is not supported.");
      if (data.length > MAX_AUDIO_B64) throw new HttpError(400, "audio_too_long", "Voice messages can be up to 60 seconds.");
      audio = { data, mimeType: mime };
    }
    if (!text && !audio) throw new HttpError(400, "empty", "Type or say what you need help with.");
    const loc = (body.location ?? {}) as Record<string, unknown>;
    const lat = num(loc.lat, -90, 90);
    const lng = num(loc.lng, -180, 180);

    // ---- rate limits (IST day) ----
    const now = new Date();
    const since = istMidnight(now).toISOString();
    const [all, voice] = await Promise.all([
      admin.from("ai_messages").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("role", "user").gte("created_at", since),
      admin.from("ai_messages").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("role", "user").eq("input_kind", "voice").gte("created_at", since),
    ]);
    const usedAll = all.count ?? 0;
    const usedVoice = voice.count ?? 0;
    if (usedAll >= DAILY_MESSAGE_LIMIT) {
      throw new HttpError(429, "rate_limited", `You've used today's ${DAILY_MESSAGE_LIMIT} AI messages. You can still book from the service list, or try again tomorrow.`);
    }
    if (audio && usedVoice >= DAILY_VOICE_LIMIT) {
      throw new HttpError(429, "voice_limited", `You've used today's ${DAILY_VOICE_LIMIT} voice messages. You can keep typing.`);
    }

    // ---- conversation + context ----
    let conversationId = typeof body.conversation_id === "string" && UUID.test(body.conversation_id) ? body.conversation_id : null;
    if (conversationId) {
      const { data } = await admin.from("ai_conversations").select("id").eq("id", conversationId).eq("user_id", uid).maybeSingle();
      if (!data) conversationId = null;
    }
    if (!conversationId) {
      const { data, error } = await admin.from("ai_conversations").insert({ user_id: uid }).select("id").single();
      if (error) throw error;
      conversationId = data.id as string;
    }

    const [cats, history, addrs, prior] = await Promise.all([
      admin.from("categories").select("slug, name").eq("active", true).order("sort_order"),
      loadHistory(admin, uid),
      admin.from("addresses").select("id, label, line1, city, lat, lng, is_default, created_at").eq("user_id", uid).neq("label", "Booking").order("created_at"),
      admin
        .from("ai_messages")
        .select("role, content, payload")
        .eq("conversation_id", conversationId)
        .in("role", ["user", "assistant"])
        .order("created_at", { ascending: false })
        .limit(HISTORY_ROWS),
    ]);
    if (cats.error) throw cats.error;
    const saved = (addrs.data ?? []) as { id: string; label: string; line1: string; city: string; lat: number; lng: number; is_default: boolean }[];
    const chosen = typeof loc.address_id === "string" ? saved.find((a) => a.id === loc.address_id) : undefined;
    const fallback = saved.find((a) => a.is_default) ?? null;
    const location =
      lat != null && lng != null
        ? { area: clampText(loc.area, 60) || "your area", city: clampText(loc.city, 40) || "Vijayawada", lat, lng }
        : fallback
          ? { area: areaFromLine(fallback.line1, fallback.city), city: fallback.city, lat: fallback.lat, lng: fallback.lng }
          : DEFAULT_LOCATION;
    const addressRow = chosen ?? (lat == null ? fallback : undefined);
    const ctx: Ctx = {
      uid,
      now,
      admin,
      userClient,
      categories: cats.data ?? [],
      history,
      location,
      address: addressRow
        ? { address_id: addressRow.id, label: addressRow.label, area: areaFromLine(addressRow.line1, addressRow.city), city: addressRow.city, needs_full_address: false }
        : { address_id: null, label: null, area: location.area, city: location.city, needs_full_address: true },
    };

    const { data: userRow, error: insErr } = await admin
      .from("ai_messages")
      .insert({ conversation_id: conversationId, user_id: uid, role: "user", input_kind: audio ? "voice" : "text", content: text || "(voice message)" })
      .select("id")
      .single();
    if (insErr) throw insErr;

    const system = systemPrompt({
      now,
      categories: ctx.categories,
      location: { area: location.area, city: location.city, label: ctx.address.label },
      savedAddresses: saved.map((a) => ({ label: a.label, area: areaFromLine(a.line1, a.city), city: a.city })),
      history,
    });
    const userParts: Part[] = audio
      ? [
          { inlineData: { mimeType: audio.mimeType, data: audio.data } },
          {
            text: text
              ? `Voice message from the customer (audio above). They also typed: ${text}`
              : "Voice message from the customer (audio above). Put an exact transcript in respond.transcript, then help them.",
          },
        ]
      : [{ text }];
    const contents = toContents(((prior.data ?? []) as { role: string; content: string; payload: Record<string, unknown> }[]).reverse());
    if (contents.length && contents[contents.length - 1]!.role === "user") contents.pop(); // unanswered (failed) turn
    contents.push({ role: "user", parts: userParts });

    // ---- model loop with fallback ----
    const deadline = started + REQUEST_BUDGET_MS;
    let result: Respond | null = null;
    let state = newState();
    let lastErr: GeminiError | null = null;
    const usageTotal = { input: 0, output: 0, calls: 0 };
    for (const model of MODELS) {
      if (deadline - Date.now() < 4000) break;
      state = newState();
      try {
        result = await runAgent(model, ctx, state, system, contents, apiKey, deadline);
        break;
      } catch (e) {
        usageTotal.input += state.usage.input;
        usageTotal.output += state.usage.output;
        usageTotal.calls += state.usage.calls;
        if (!(e instanceof GeminiError)) throw e;
        lastErr = e;
        console.warn(`[ai-assistant ${requestId}] ${model} failed: ${e.message}`);
        if (!e.fallback) break;
      }
    }
    if (!result) {
      const timedOut = Date.now() - started > REQUEST_BUDGET_MS - 5000 || /timeout|budget/.test(lastErr?.message ?? "");
      await admin.from("ai_messages").insert({
        conversation_id: conversationId,
        user_id: uid,
        role: "error",
        payload: { request_id: requestId, error: (lastErr?.message ?? "unknown").slice(0, 300) },
      });
      console.error(`[ai-assistant ${requestId}] all models failed: ${lastErr?.message}`);
      throw new HttpError(
        timedOut ? 504 : 503,
        timedOut ? "timeout" : "ai_unavailable",
        timedOut ? "That took too long. Please try again." : "QuickServe AI is busy right now. Please try again in a minute.",
      );
    }
    usageTotal.input += state.usage.input;
    usageTotal.output += state.usage.output;
    usageTotal.calls += state.usage.calls;

    // ---- validated response ----
    const r = result.args;
    const cards = await buildCards(ctx, state, r);
    const language = LANGS.includes(r.language as string) ? (r.language as string) : "en";
    const replyText = clampText(r.reply_text, 700) || (cards.length ? "Here's what I found." : "Sorry, I didn't catch that. Could you describe the problem again?");
    const quickReplies = clampList(r.quick_replies, 4, 40);
    const transcript = audio ? clampText(r.transcript, 600) || null : null;

    const { data: asstRow } = await admin
      .from("ai_messages")
      .insert({
        conversation_id: conversationId,
        user_id: uid,
        role: "assistant",
        content: replyText,
        payload: { request_id: requestId, language, quick_replies: quickReplies, cards, transcript, summary: summarize(cards), tools: state.tools, calls: usageTotal.calls },
        model: result.model,
        input_tokens: usageTotal.input,
        output_tokens: usageTotal.output,
      })
      .select("id")
      .single();
    await Promise.all([
      transcript ? admin.from("ai_messages").update({ content: transcript }).eq("id", userRow.id) : Promise.resolve(),
      admin.from("ai_conversations").update({ updated_at: new Date().toISOString(), language }).eq("id", conversationId),
    ]);

    return json({
      conversation_id: conversationId,
      message_id: asstRow?.id ?? null,
      request_id: requestId,
      reply_text: replyText,
      language,
      quick_replies: quickReplies,
      cards,
      transcript,
      model: result.model,
      fallback_used: result.model === FALLBACK_MODEL,
      usage: { input_tokens: usageTotal.input, output_tokens: usageTotal.output, model_calls: usageTotal.calls, ms: Date.now() - started },
      limits: { messages_left: Math.max(0, DAILY_MESSAGE_LIMIT - usedAll - 1), voice_left: Math.max(0, DAILY_VOICE_LIMIT - usedVoice - (audio ? 1 : 0)) },
    });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code, request_id: requestId }, e.status);
    console.error(`[ai-assistant ${requestId}]`, e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong. Please try again.", code: "internal", request_id: requestId }, 500);
  }
});

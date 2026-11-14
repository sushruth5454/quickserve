// QuickServe AI booking assistant. Verifies the caller's JWT, applies kill switch / CORS / abuse limits, runs a Gemini
// function-calling loop over read-only tools that query Postgres AS THE USER (RLS), and returns a strict JSON contract:
//   { conversation_id, reply_text, language, quick_replies[], cards[], transcript?, usage, limits, request_id }
// The assistant never creates or pays for bookings: draft cards hand off to the app's normal checkout, where
// create_booking re-validates everything. All tunables come from env (config.ts).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type AiConfig, attemptPlan, corsFor, loadConfig } from "./config.ts";
import { type Content, GeminiError, generateContent, type Part } from "./gemini.ts";
import {
  areaFromLine,
  clampText,
  composeReply,
  type DraftCard,
  estimateForModel,
  filterChips,
  MarketClock,
  normalizeSlot,
  type PastBooking,
  type PriceStats,
  PROBLEM_CHIPS,
  redactPII,
  serviceProblem,
  type ServiceRow,
  type SearchRow,
  summarize,
  toContents,
} from "./logic.ts";
import { functionDeclarations, POLICY_VERSION, systemPrompt } from "./policies/index.ts";
import { INJECTION_REMINDER, looksLikeInjection } from "./policies/security.ts";
import { toolCallAllowed } from "./policies/tools.ts";

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
const SORTS = ["recommended", "rating", "price", "distance", "experience"];

/** Per-instance circuit breaker for the primary model. */
let primaryCooldownUntil = 0;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** One JSON line per request/event; never message text, audio, tokens or keys. */
function log(level: "info" | "warn" | "error", event: Record<string, unknown>) {
  const line = JSON.stringify({ fn: "ai-assistant", level, ...event });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

interface Ctx {
  uid: string;
  now: Date;
  clock: MarketClock;
  cfg: AiConfig;
  admin: SupabaseClient;
  userClient: SupabaseClient;
  categories: { slug: string; name: string }[];
  history: PastBooking[];
  location: { area: string; city: string; lat: number; lng: number } | null;
  address: DraftCard["address"] | null;
}

interface State {
  searches: Map<string, SearchRow[]>;
  estimates: Map<string, PriceStats | null>;
  draft: DraftCard | null;
  lastSlug: string | null;
  tools: { name: string; error?: string }[];
  usage: { input: number; output: number; calls: number };
}

const newState = (): State => ({ searches: new Map(), estimates: new Map(), draft: null, lastSlug: null, tools: [], usage: { input: 0, output: 0, calls: 0 } });

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

// ---------- data loaders: the user's own JWT, so RLS scopes every row ----------
async function loadHistory(db: SupabaseClient, uid: string): Promise<PastBooking[]> {
  const { data, error } = await db
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
  if (!ctx.location) return [];
  const lat = num(opts.lat, -90, 90);
  const lng = num(opts.lng, -180, 180);
  // Model-supplied coordinates are only honoured near the selected location (it has no reason to search elsewhere).
  const useOwn = lat != null && lng != null && Math.abs(lat - ctx.location.lat) < 0.5 && Math.abs(lng - ctx.location.lng) < 0.5;
  const maxFee = num(opts.max_visit_fee_rupees, 0, 100_000);
  const { data, error } = await ctx.userClient.rpc("search_providers", {
    p_category_slug: slug,
    p_lat: useOwn ? lat : ctx.location.lat,
    p_lng: useOwn ? lng : ctx.location.lng,
    p_sort: SORTS.includes(opts.sort as string) ? opts.sort : "recommended",
    p_min_rating: num(opts.min_rating, 1, 5),
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
  const since = new Date(ctx.now.getTime() - ctx.cfg.priceLookbackDays * 86_400_000).toISOString();
  // Aggregates across all customers' jobs, so it runs as service role and returns only counts/percentiles.
  const { data, error } = await ctx.admin.rpc("ai_price_estimate", { p_category_slug: slug, p_since: since });
  if (error) throw error;
  const stats = (data ?? null) as PriceStats | null;
  state.estimates.set(slug, stats);
  return stats;
}

function validSlug(ctx: Ctx, v: unknown): string | null {
  return typeof v === "string" && ctx.categories.some((c) => c.slug === v) ? v : null;
}

async function draftBooking(ctx: Ctx, state: State, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!ctx.address) return { error: "The customer has not set a service location. Ask them to set it first." };
  const slug = validSlug(ctx, args.category_slug);
  if (!slug) return { error: "Unknown category_slug." };
  const psId = typeof args.provider_service_id === "string" && UUID.test(args.provider_service_id) ? args.provider_service_id : null;
  if (!psId) return { error: "provider_service_id must be one returned by search_providers or the history." };
  const description = clampText(redactPII(String(args.description_en ?? "")), 250);
  if (!description) return { error: "description_en is required." };
  const { data } = await ctx.userClient
    .from("provider_services")
    .select("id, provider_id, visit_fee, active, categories(slug, name), providers(kyc_status, suspended, rating_avg, rating_count, profiles(full_name))")
    .eq("id", psId)
    .maybeSingle();
  const row = (data ?? null) as unknown as ServiceRow | null;
  const problem = serviceProblem(row, slug, ctx.uid);
  if (problem || !row) return { error: problem ?? "Not available." };
  const slot = normalizeSlot({ type: args.slot_type, date: args.slot_date, start_hour: args.slot_start_hour }, ctx.now, ctx.clock);
  const draft: DraftCard = {
    type: "draft",
    category_slug: slug,
    category_name: row.categories?.name ?? slug,
    provider: {
      provider_id: row.provider_id,
      provider_service_id: row.id,
      name: row.providers?.profiles?.full_name ?? "Pro",
      visit_fee: row.visit_fee,
      rating_avg: Math.round(Number(row.providers?.rating_avg ?? 0) * 10) / 10,
      rating_count: row.providers?.rating_count ?? 0,
    },
    description_en: description,
    description_original: clampText(redactPII(String(args.description_original ?? "")), 300),
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
      next: "Not booked. The customer reviews and pays in checkout. Now call respond.",
    },
  };
}

async function execTool(ctx: Ctx, state: State, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (name) {
    case "list_categories":
      return { result: ctx.categories };
    case "get_my_history":
      return {
        result: ctx.history.map((h) => ({
          date: ctx.clock.dateKey(new Date(h.booking_date)),
          service: h.category_slug,
          pro: h.provider_name,
          provider_service_id: h.provider_service_id,
          status: h.status,
          customer_rating: h.rating,
        })),
      };
    case "search_providers": {
      if (!ctx.location) return { error: "The customer has not set a service location. Ask them to set it in the app." };
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
          ...(rows.length ? {} : { note: "No verified pros serve this location for this service yet. Tell the customer; do not draft." }),
        },
      };
    }
    case "get_price_estimate": {
      const slug = validSlug(ctx, args.category_slug);
      if (!slug) return { error: "Unknown category_slug." };
      const stats = await priceStats(ctx, state, slug);
      state.lastSlug = slug;
      return stats ? { result: estimateForModel(stats, ctx.cfg.minPriceSamples) } : { error: "No price data for this service." };
    }
    case "draft_booking":
      return draftBooking(ctx, state, args);
    default:
      return { error: `Unknown tool ${name}.` };
  }
}

// ---------- model loop ----------
async function runAgent(
  model: string,
  ctx: Ctx,
  state: State,
  system: string,
  contents: Content[],
  apiKey: string,
  deadline: number,
  callTimeoutMs: number,
): Promise<{ args: Record<string, unknown>; model: string }> {
  const tools = [{ functionDeclarations: functionDeclarations(ctx.categories.map((c) => c.slug)) }];
  const convo = [...contents];
  const used = new Map<string, number>();
  for (let step = 0; step < ctx.cfg.maxSteps; step++) {
    const last = step === ctx.cfg.maxSteps - 1;
    const remaining = deadline - Date.now();
    if (remaining < 2000) throw new GeminiError("request budget exhausted", 0, false);
    const res = await generateContent(
      ctx.cfg.apiBase,
      model,
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: convo,
        tools,
        toolConfig: { functionCallingConfig: last ? { mode: "ANY", allowedFunctionNames: ["respond"] } : { mode: "ANY" } },
        generationConfig: {
          maxOutputTokens: ctx.cfg.maxOutputTokens,
          ...(ctx.cfg.thinkingLevel ? { thinkingConfig: { thinkingLevel: ctx.cfg.thinkingLevel } } : {}),
        },
      },
      apiKey,
      Math.min(remaining, callTimeoutMs),
    );
    state.usage.calls += 1;
    state.usage.input += res.usageMetadata?.promptTokenCount ?? 0;
    state.usage.output += (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0);
    const cand = res.candidates?.[0];
    const parts: Part[] = cand?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall && typeof p.functionCall.name === "string");
    if (!calls.length) {
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
      if (text) return { args: { reply_text: text }, model };
      throw new GeminiError(`no output (${cand?.finishReason ?? res.promptFeedback?.blockReason ?? "empty"})`, 0, true);
    }
    convo.push({ role: "model", parts });
    const responses: Part[] = [];
    for (const c of calls.filter((x) => x.functionCall!.name !== "respond")) {
      const { name, id } = c.functionCall!;
      const args = (c.functionCall!.args && typeof c.functionCall!.args === "object" ? c.functionCall!.args : {}) as Record<string, unknown>;
      let response: Record<string, unknown>;
      const denied = toolCallAllowed(name, used);
      try {
        response = denied ? { error: denied } : await execTool(ctx, state, name, args);
      } catch (e) {
        log("warn", { event: "tool_failed", tool: name, error: (e as Error).message?.slice(0, 160) });
        response = { error: "Temporary problem fetching data. Answer without it." };
      }
      state.tools.push({ name, ...(typeof response.error === "string" ? { error: response.error.slice(0, 120) } : {}) });
      responses.push({ functionResponse: { name, ...(id ? { id } : {}), response } });
    }
    const respond = calls.find((c) => c.functionCall!.name === "respond");
    if (respond) return { args: (respond.functionCall!.args ?? {}) as Record<string, unknown>, model };
    convo.push({ role: "user", parts: responses });
  }
  throw new GeminiError("no respond call within step limit", 0, true);
}

// ---------- handler ----------
Deno.serve(async (req) => {
  const cfg = loadConfig((n) => Deno.env.get(n));
  const cors = corsFor(req.headers.get("Origin"), cfg);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors.headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });

  if (req.method === "OPTIONS") return new Response(cors.allowed ? "ok" : "forbidden", { status: cors.allowed ? 200 : 403, headers: cors.headers });
  const requestId = crypto.randomUUID();
  const started = Date.now();
  let uid: string | null = null;

  try {
    if (!cors.allowed) throw new HttpError(403, "origin_not_allowed", "This origin is not allowed.");
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Method not allowed.");
    if (!cfg.enabled) throw new HttpError(503, "ai_disabled", "QuickServe AI is switched off right now. You can still book from the service list.");
    const declared = Number(req.headers.get("Content-Length") ?? 0);
    if (declared > cfg.maxAudioBase64Chars + 200_000) throw new HttpError(413, "too_large", "That message is too large.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey || !apiKey) {
      log("error", { event: "misconfigured", request_id: requestId, missing: { supabase: !supabaseUrl || !serviceKey || !anonKey, gemini: !apiKey } });
      throw new HttpError(503, "not_configured", "QuickServe AI is not available right now.");
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token || token === anonKey) throw new HttpError(401, "unauthorized", "Please sign in again.");
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) throw new HttpError(401, "unauthorized", "Please sign in again.");
    uid = userData.user.id;
    const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });

    // ---- input ----
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new HttpError(400, "bad_request", "Invalid request.");
    const rawText = typeof body.message === "string" ? body.message.trim() : "";
    if (rawText.length > cfg.maxTextChars) throw new HttpError(400, "too_long", `Please keep messages under ${cfg.maxTextChars} characters.`);
    const text = redactPII(rawText);
    const audioIn = (body.audio ?? null) as { data?: unknown; mime_type?: unknown } | null;
    let audio: { data: string; mimeType: string } | null = null;
    if (audioIn) {
      if (!cfg.voiceEnabled) throw new HttpError(403, "voice_disabled", "Voice messages are switched off right now. Please type instead.");
      const mime = AUDIO_MIME[String(audioIn.mime_type ?? "").toLowerCase()];
      const data = typeof audioIn.data === "string" ? audioIn.data.replace(/^data:[^,]+,/, "").replace(/\s+/g, "") : "";
      if (!mime || !data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(400, "bad_audio", "That recording format is not supported.");
      if (data.length > cfg.maxAudioBase64Chars) throw new HttpError(400, "audio_too_long", "Voice messages can be up to 60 seconds.");
      audio = { data, mimeType: mime };
    }
    if (!text && !audio) throw new HttpError(400, "empty", "Type or say what you need help with.");
    const loc = (body.location && typeof body.location === "object" ? body.location : {}) as Record<string, unknown>;
    const lat = num(loc.lat, -90, 90);
    const lng = num(loc.lng, -180, 180);

    // ---- abuse limits ----
    const now = new Date();
    const clock = new MarketClock(cfg.tzOffsetMinutes, cfg.tzLabel);
    const since = clock.midnight(now).toISOString();
    const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
    const userRows = () => admin.from("ai_messages").select("id", { count: "exact", head: true }).eq("user_id", uid!).eq("role", "user");
    const [all, voice, burst] = await Promise.all([
      userRows().gte("created_at", since),
      userRows().eq("input_kind", "voice").gte("created_at", since),
      userRows().gte("created_at", minuteAgo),
    ]);
    if (all.error || voice.error || burst.error) throw all.error ?? voice.error ?? burst.error;
    const usedAll = all.count ?? 0;
    const usedVoice = voice.count ?? 0;
    if (usedAll >= cfg.dailyMessageLimit) {
      throw new HttpError(429, "rate_limited", `You've used today's ${cfg.dailyMessageLimit} AI messages. You can still book from the service list, or try again tomorrow.`);
    }
    if (audio && usedVoice >= cfg.dailyVoiceLimit) throw new HttpError(429, "voice_limited", `You've used today's ${cfg.dailyVoiceLimit} voice messages. You can keep typing.`);
    if ((burst.count ?? 0) >= cfg.perMinuteLimit) throw new HttpError(429, "slow_down", "You're sending messages very quickly. Please wait a moment.");

    // ---- conversation + context (catalog, history, addresses via RLS) ----
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
      userClient.from("categories").select("slug, name").eq("active", true).order("sort_order"),
      loadHistory(userClient, uid),
      userClient.from("addresses").select("id, label, line1, city, lat, lng, is_default, created_at").eq("user_id", uid).neq("label", "Booking").order("created_at"),
      cfg.historyRows
        ? admin
            .from("ai_messages")
            .select("role, content, payload")
            .eq("conversation_id", conversationId)
            .eq("user_id", uid)
            .in("role", ["user", "assistant"])
            .order("created_at", { ascending: false })
            .limit(cfg.historyRows)
        : Promise.resolve({ data: [] }),
    ]);
    if (cats.error) throw cats.error;
    const saved = (addrs.data ?? []) as { id: string; label: string; line1: string; city: string; lat: number; lng: number; is_default: boolean }[];
    const chosen = typeof loc.address_id === "string" ? saved.find((a) => a.id === loc.address_id) : undefined;
    const fallbackAddr = saved.find((a) => a.is_default) ?? null;
    // Location: what the app sends (validated), else the user's default saved address, else none (no city is assumed).
    const location =
      lat != null && lng != null
        ? { area: clampText(loc.area, 60) || "Selected location", city: clampText(loc.city, 40), lat, lng }
        : fallbackAddr
          ? { area: areaFromLine(fallbackAddr.line1, fallbackAddr.city), city: fallbackAddr.city, lat: fallbackAddr.lat, lng: fallbackAddr.lng }
          : null;
    const addressRow = chosen ?? (lat == null ? fallbackAddr : undefined);
    const ctx: Ctx = {
      uid,
      now,
      clock,
      cfg,
      admin,
      userClient,
      categories: (cats.data ?? []) as { slug: string; name: string }[],
      history,
      location,
      address: addressRow
        ? { address_id: addressRow.id, label: addressRow.label, area: areaFromLine(addressRow.line1, addressRow.city), city: addressRow.city, needs_full_address: false }
        : location
          ? { address_id: null, label: null, area: location.area, city: location.city, needs_full_address: true }
          : null,
    };

    const { data: userRow, error: insErr } = await admin
      .from("ai_messages")
      .insert({ conversation_id: conversationId, user_id: uid, role: "user", input_kind: audio ? "voice" : "text", content: text || "(voice message)" })
      .select("id")
      .single();
    if (insErr) throw insErr;

    const system = systemPrompt({
      now,
      clock,
      categories: ctx.categories,
      location: location ? { area: location.area, city: location.city, label: ctx.address?.label ?? null } : null,
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
    const injection = looksLikeInjection(text);
    if (injection) userParts.push({ text: INJECTION_REMINDER });
    const contents: Content[] = toContents(((prior.data ?? []) as { role: string; content: string; payload: Record<string, unknown> }[]).reverse());
    contents.push({ role: "user", parts: userParts });

    // ---- model loop with fallback ----
    const deadline = started + cfg.requestBudgetMs;
    let result: { args: Record<string, unknown>; model: string } | null = null;
    let state = newState();
    let lastErr: GeminiError | null = null;
    const usageTotal = { input: 0, output: 0, calls: 0 };
    const attempts: { model: string; ms: number; error?: string }[] = [];
    for (const plan of attemptPlan(cfg)) {
      if (plan.model === cfg.primaryModel && cfg.fallbackModel && Date.now() < primaryCooldownUntil) {
        attempts.push({ model: plan.model, ms: 0, error: "skipped (cooldown)" });
        continue;
      }
      if (plan.backoffMs) await new Promise((r) => setTimeout(r, plan.backoffMs));
      if (deadline - Date.now() < 4000) break;
      state = newState();
      const t0 = Date.now();
      try {
        result = await runAgent(plan.model, ctx, state, system, contents, apiKey, deadline, plan.callTimeoutMs);
        attempts.push({ model: plan.model, ms: Date.now() - t0 });
        break;
      } catch (e) {
        usageTotal.input += state.usage.input;
        usageTotal.output += state.usage.output;
        usageTotal.calls += state.usage.calls;
        if (!(e instanceof GeminiError)) throw e;
        lastErr = e;
        attempts.push({ model: plan.model, ms: Date.now() - t0, error: e.message.slice(0, 80) });
        if (plan.model === cfg.primaryModel && cfg.fallbackModel) primaryCooldownUntil = Date.now() + cfg.primaryCooldownMs;
        if (!e.fallback) break;
      }
    }
    if (!result) {
      const timedOut = Date.now() - started > cfg.requestBudgetMs - 5000 || /timeout|budget/.test(lastErr?.message ?? "");
      await admin.from("ai_messages").insert({ conversation_id: conversationId, user_id: uid, role: "error", payload: { request_id: requestId, attempts } });
      log("error", { event: "model_unavailable", request_id: requestId, attempts, ms: Date.now() - started });
      throw new HttpError(
        timedOut ? 504 : 503,
        timedOut ? "timeout" : "ai_unavailable",
        timedOut ? "That took too long. Please try again." : "QuickServe AI is busy right now. Please try again in a minute, or book from the service list.",
      );
    }
    usageTotal.input += state.usage.input;
    usageTotal.output += state.usage.output;
    usageTotal.calls += state.usage.calls;

    // ---- validated reply: pros/prices/drafts only from tool results ----
    const r = result.args;
    const slug = validSlug(ctx, r.category_slug) ?? state.draft?.category_slug ?? state.lastSlug;
    if (slug && (r.show_providers === true || state.draft) && !state.searches.has(slug) && ctx.location) {
      await searchPros(ctx, state, slug).catch(() => undefined);
    }
    const stats = slug && (r.show_estimate === true || state.draft) ? await priceStats(ctx, state, slug).catch(() => null) : null;
    const reply = composeReply({
      respond: r,
      slug,
      categoryName: ctx.categories.find((c) => c.slug === slug)?.name ?? null,
      draft: state.draft,
      searchRows: slug ? (state.searches.get(slug) ?? null) : null,
      stats,
      history,
      now,
      clock,
      minPriceSamples: cfg.minPriceSamples,
      priceLookbackDays: cfg.priceLookbackDays,
      isVoice: !!audio,
      userText: text,
    });
    const transcript = reply.transcript ? redactPII(reply.transcript) : null;

    const { data: asstRow } = await admin
      .from("ai_messages")
      .insert({
        conversation_id: conversationId,
        user_id: uid,
        role: "assistant",
        content: reply.reply_text,
        payload: { request_id: requestId, policy_version: POLICY_VERSION, guardrails: reply.guardrails, injection_flag: injection, language: reply.language, quick_replies: reply.quick_replies, cards: reply.cards, transcript, summary: summarize(reply.cards), tools: state.tools, calls: usageTotal.calls, attempts },
        model: result.model,
        input_tokens: usageTotal.input,
        output_tokens: usageTotal.output,
      })
      .select("id")
      .single();
    await Promise.all([
      transcript ? admin.from("ai_messages").update({ content: transcript }).eq("id", userRow.id) : Promise.resolve(),
      admin.from("ai_conversations").update({ updated_at: new Date().toISOString(), language: reply.language }).eq("id", conversationId),
    ]);
    log("info", {
      event: "reply",
      request_id: requestId,
      user: uid,
      model: result.model,
      attempts,
      calls: usageTotal.calls,
      tokens_in: usageTotal.input,
      tokens_out: usageTotal.output,
      cards: reply.cards.map((c) => c.type),
      tools: state.tools.map((t) => (t.error ? `${t.name}!` : t.name)),
      voice: !!audio,
      has_location: !!location,
      policy_version: POLICY_VERSION,
      guardrails: reply.guardrails,
      injection_flag: injection,
      ms: Date.now() - started,
    });

    const { guardrails: _g, ...publicReply } = reply;
    return json({
      conversation_id: conversationId,
      message_id: asstRow?.id ?? null,
      request_id: requestId,
      policy_version: POLICY_VERSION,
      ...publicReply,
      transcript,
      model: result.model,
      fallback_used: result.model !== cfg.primaryModel,
      attempts: attempts.map((a) => ({ model: a.model, ms: a.ms, ...(a.error ? { error: a.error.split(":")[0] } : {}) })),
      usage: { input_tokens: usageTotal.input, output_tokens: usageTotal.output, model_calls: usageTotal.calls, ms: Date.now() - started },
      limits: { messages_left: Math.max(0, cfg.dailyMessageLimit - usedAll - 1), voice_left: Math.max(0, cfg.dailyVoiceLimit - usedVoice - (audio ? 1 : 0)) },
      location_set: !!location,
    });
  } catch (e) {
    if (e instanceof HttpError) {
      log(e.status >= 500 ? "error" : "info", { event: "rejected", request_id: requestId, user: uid, code: e.code, status: e.status });
      return json({ error: e.message, code: e.code, request_id: requestId }, e.status);
    }
    log("error", { event: "internal", request_id: requestId, user: uid, error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) });
    return json({ error: "Something went wrong. Please try again.", code: "internal", request_id: requestId }, 500);
  }
});

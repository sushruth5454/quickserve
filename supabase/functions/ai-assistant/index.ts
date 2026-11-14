// QuickServe AI booking assistant. Verifies the caller's JWT, applies kill switches / CORS / abuse limits and serves:
//   mode "transcribe": voice clip → { transcript_original, transcript_en, language, clarity } for the customer to review
//   mode "chat" (default): Gemini function calling over read-only tools that query Postgres AS THE USER (RLS); with
//     `Accept: text/event-stream` it streams truthful progress stages ({type:"stage"}) and then {type:"final"}.
// The assistant never creates or pays for bookings: draft cards hand off to the app's normal checkout, where
// create_booking re-validates everything. All tunables come from env (config.ts). Docs: docs/06-AI-Assistant.md.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1/base64";
import { allRejected, type AttemptRecord, runAgent, withFallback } from "./agent.ts";
import { buildJobBrief, renderBrief } from "./brief.ts";
import { type AiConfig, attemptPlan, corsFor, loadConfig } from "./config.ts";
import { AbortedError, type Content, GeminiError, generateContent, type Part } from "./gemini.ts";
import { type ImageMime, ImageFormatError, sniffImage, stripImageMetadata } from "./image.ts";
import {
  areaFromLine,
  clampText,
  composeReply,
  conversationTitle,
  type DraftCard,
  estimateForModel,
  filterChips,
  MarketClock,
  normalizeSlot,
  parseTranscription,
  type PastBooking,
  type PriceStats,
  PROBLEM_CHIPS,
  redactPII,
  serviceProblem,
  type ServiceRow,
  type SearchRow,
  summarize,
  toContents,
  voiceMeta,
  type VoiceMeta,
} from "./logic.ts";
import { functionDeclarations, POLICY_VERSION, systemPrompt } from "./policies/index.ts";
import { INJECTION_REMINDER, looksLikeInjection } from "./policies/security.ts";
import { TRANSCRIBE_DECLARATION, transcriptionPrompt } from "./policies/transcription.ts";
import { type StageEvent, StageTracker } from "./stages.ts";

const MIN_AUDIO_BASE64_CHARS = 1400;
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
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const PHOTO_BUCKET = "ai-photos";

/** Per-instance circuit breaker for the primary model (shared by chat and transcription). */
const primaryCooldown = { until: 0 };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** One JSON line per request/event; never message text, audio, images, tokens or keys. */
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
  /** This conversation's customer messages, oldest first (redacted), for the job brief. */
  customerTexts: string[];
  lastUserText: string;
  /** False when the current turn is a raw voice clip (its words are only known to the model). */
  textsComplete: boolean;
  hasPhoto: boolean;
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
  // The provider's job brief comes from the whole conversation, never just the last message (brief.ts).
  const built = buildJobBrief(args, { customerTexts: ctx.customerTexts, lastUserText: ctx.lastUserText, textsComplete: ctx.textsComplete, hasPhoto: ctx.hasPhoto });
  if ("error" in built) return { error: built.error };
  const description = renderBrief(built.brief);
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
    brief: built.brief,
    description,
    // v1 clients read these two fields.
    description_en: description,
    description_original: built.brief.customer_reported,
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
      issue: built.brief.issue_summary,
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


// ---------- shared request helpers ----------
type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

interface Auth {
  uid: string;
  admin: SupabaseClient;
  userClient: SupabaseClient;
}

function parseAudio(cfg: AiConfig, v: unknown): { data: string; mimeType: string } | null {
  const a = obj(v);
  if (!a) return null;
  if (!cfg.voiceEnabled) throw new HttpError(403, "voice_disabled", "Voice messages are switched off right now. Please type instead.");
  const mime = AUDIO_MIME[String(a.mime_type ?? "").toLowerCase()];
  const data = typeof a.data === "string" ? a.data.replace(/^data:[^,]+,/, "").replace(/\s+/g, "") : "";
  if (!mime || !data || !B64.test(data)) throw new HttpError(400, "bad_audio", "That recording format is not supported.");
  if (data.length > cfg.maxAudioBase64Chars) throw new HttpError(400, "audio_too_long", "Voice messages can be up to 60 seconds.");
  // ~1 KB of audio is well under half a second of any supported codec: reject before spending a model call.
  if (data.length < MIN_AUDIO_BASE64_CHARS) throw new HttpError(400, "bad_audio", "That recording was too short. Hold the mic and speak, or type instead.");
  return { data, mimeType: mime };
}

/** Photo: decoded, size-checked, sniffed (JPEG/PNG only) and stripped of EXIF/GPS/text metadata before any use. */
function parseImage(cfg: AiConfig, v: unknown): { bytes: Uint8Array; mime: ImageMime; removed: string[] } | null {
  const im = obj(v);
  if (!im) return null;
  if (!cfg.photosEnabled) throw new HttpError(403, "photos_disabled", "Photos are switched off right now. Please describe the problem instead.");
  const data = typeof im.data === "string" ? im.data.replace(/^data:[^,]+,/, "").replace(/\s+/g, "") : "";
  if (!data || !B64.test(data)) throw new HttpError(400, "bad_image", "That photo could not be read. Please use a JPG or PNG photo.");
  if (data.length > Math.ceil((cfg.maxImageBytes * 4) / 3) + 4) {
    throw new HttpError(400, "image_too_large", `Photos can be up to ${Math.floor(cfg.maxImageBytes / 1_000_000)} MB.`);
  }
  let raw: Uint8Array;
  try {
    raw = decodeBase64(data);
  } catch {
    throw new HttpError(400, "bad_image", "That photo could not be read. Please use a JPG or PNG photo.");
  }
  const mime = sniffImage(raw);
  if (!mime) throw new HttpError(400, "bad_image", "Please use a JPG or PNG photo.");
  try {
    return { ...stripImageMetadata(raw, mime), mime };
  } catch (e) {
    if (e instanceof ImageFormatError) throw new HttpError(400, "bad_image", "That photo looks damaged. Please take it again.");
    throw e;
  }
}

/** Counts today's (market day) and last-minute usage: chat messages, voice and photo events. */
async function usageCounts(admin: SupabaseClient, uid: string, now: Date, clock: MarketClock) {
  const since = clock.midnight(now).toISOString();
  const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  const msgs = () => admin.from("ai_messages").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("role", "user");
  const usage = (kinds: string[]) => admin.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", uid).in("kind", kinds);
  const [all, voice, photos, burstMsgs, burstVoice] = await Promise.all([
    msgs().gte("created_at", since),
    usage(["transcribe", "voice_chat"]).gte("created_at", since),
    usage(["photo"]).gte("created_at", since),
    msgs().gte("created_at", minuteAgo),
    usage(["transcribe"]).gte("created_at", minuteAgo),
  ]);
  const err = all.error ?? voice.error ?? photos.error ?? burstMsgs.error ?? burstVoice.error;
  if (err) throw err;
  return { messages: all.count ?? 0, voice: voice.count ?? 0, photos: photos.count ?? 0, burst: (burstMsgs.count ?? 0) + (burstVoice.count ?? 0) };
}

function modelFailure(attempts: AttemptRecord[], lastErr: GeminiError | null, started: number, cfg: AiConfig, budgetMs = cfg.requestBudgetMs): HttpError {
  const timedOut = Date.now() - started > budgetMs - 5000 || /timeout|budget/.test(lastErr?.message ?? "");
  return new HttpError(
    timedOut ? 504 : 503,
    timedOut ? "timeout" : "ai_unavailable",
    timedOut ? "That took too long. Please try again." : "QuickServe AI is busy right now. Please try again in a minute, or book from the service list.",
  );
}

// ---------- mode: transcribe (voice preview) ----------
async function transcribe(cfg: AiConfig, auth: Auth, body: Json, apiKey: string, requestId: string, started: number, signal: AbortSignal) {
  const audio = parseAudio(cfg, body.audio);
  if (!audio) throw new HttpError(400, "empty", "Hold the mic and say what you need help with.");
  const now = new Date();
  const clock = new MarketClock(cfg.tzOffsetMinutes, cfg.tzLabel);
  const used = await usageCounts(auth.admin, auth.uid, now, clock);
  if (used.voice >= cfg.dailyVoiceLimit) throw new HttpError(429, "voice_limited", `You've used today's ${cfg.dailyVoiceLimit} voice messages. You can keep typing.`);
  if (used.burst >= cfg.perMinuteLimit) throw new HttpError(429, "slow_down", "You're sending messages very quickly. Please wait a moment.");
  // Counted before the model call so failed or abusive attempts still count. The audio itself is never stored.
  const ins = await auth.admin.from("ai_usage").insert({ user_id: auth.uid, kind: "transcribe", request_id: requestId });
  if (ins.error) throw ins.error;

  const budget = Math.min(cfg.requestBudgetMs, 30_000);
  const usage = { input: 0, output: 0, calls: 0 };
  const fb = await withFallback(
    {
      plan: attemptPlan(cfg),
      primaryModel: cfg.primaryModel,
      hasFallback: !!cfg.fallbackModel,
      cooldown: primaryCooldown,
      cooldownMs: cfg.primaryCooldownMs,
      deadline: started + budget,
      signal,
    },
    async (model, callTimeoutMs) => {
      const res = await generateContent(
        cfg.apiBase,
        model,
        {
          systemInstruction: { parts: [{ text: transcriptionPrompt() }] },
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: audio.mimeType, data: audio.data } }, { text: "Transcribe this voice message." }] }],
          tools: [{ functionDeclarations: [TRANSCRIBE_DECLARATION] }],
          toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["transcribe"] } },
          generationConfig: { maxOutputTokens: 1024, ...(cfg.thinkingLevel ? { thinkingConfig: { thinkingLevel: cfg.thinkingLevel } } : {}) },
        },
        apiKey,
        Math.min(callTimeoutMs, started + budget - Date.now()),
        signal,
      );
      usage.calls += 1;
      usage.input += res.usageMetadata?.promptTokenCount ?? 0;
      usage.output += (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0);
      const call = (res.candidates?.[0]?.content?.parts ?? []).find((p) => p.functionCall?.name === "transcribe");
      if (!call) throw new GeminiError("no transcription", 0, true);
      return parseTranscription(call.functionCall!.args);
    },
  );
  if (!fb.result) {
    if (allRejected(fb.attempts)) {
      log("warn", { event: "audio_rejected", mode: "transcribe", request_id: requestId, attempts: fb.attempts });
      throw new HttpError(400, "bad_audio", "We couldn't understand that recording. Please try again or type your message.");
    }
    log("error", { event: "model_unavailable", mode: "transcribe", request_id: requestId, attempts: fb.attempts, ms: Date.now() - started });
    throw modelFailure(fb.attempts, fb.lastError, started, cfg, budget);
  }
  const t = fb.result;
  log("info", {
    event: "transcribed",
    request_id: requestId,
    user: auth.uid,
    model: fb.model,
    attempts: fb.attempts,
    language: t.language,
    clarity: t.clarity,
    tokens_in: usage.input,
    tokens_out: usage.output,
    ms: Date.now() - started,
  });
  return {
    request_id: requestId,
    policy_version: POLICY_VERSION,
    ...t,
    model: fb.model,
    fallback_used: fb.model !== cfg.primaryModel,
    usage: { input_tokens: usage.input, output_tokens: usage.output, model_calls: usage.calls, ms: Date.now() - started },
    limits: { voice_left: Math.max(0, cfg.dailyVoiceLimit - used.voice - 1) },
  };
}

// ---------- mode: chat ----------
interface Prepared {
  cfg: AiConfig;
  apiKey: string;
  requestId: string;
  started: number;
  uid: string;
  admin: SupabaseClient;
  ctx: Ctx;
  conversationId: string;
  isNewConversation: boolean;
  userRowId: number;
  text: string;
  audio: { data: string; mimeType: string } | null;
  voice: VoiceMeta | null;
  photo: { path: string | null; mime: ImageMime; bytes: number } | null;
  system: string;
  contents: Content[];
  injection: boolean;
  used: { messages: number; voice: number; photos: number };
}

async function prepareChat(cfg: AiConfig, auth: Auth, body: Json, apiKey: string, requestId: string, started: number): Promise<Prepared> {
  const { uid, admin, userClient } = auth;
  const rawText = typeof body.message === "string" ? body.message.trim() : "";
  if (rawText.length > cfg.maxTextChars) throw new HttpError(400, "too_long", `Please keep messages under ${cfg.maxTextChars} characters.`);
  const text = redactPII(rawText);
  const audio = parseAudio(cfg, body.audio);
  const image = parseImage(cfg, body.image);
  if (audio && image) throw new HttpError(400, "bad_request", "Send a photo with text, not with a voice clip.");
  const voice = audio ? null : voiceMeta(body.voice, text);
  if (!text && !audio && !image) throw new HttpError(400, "empty", "Type or say what you need help with.");
  const loc = obj(body.location) ?? {};
  const lat = num(loc.lat, -90, 90);
  const lng = num(loc.lng, -180, 180);

  // ---- abuse limits (before any model call) ----
  const now = new Date();
  const clock = new MarketClock(cfg.tzOffsetMinutes, cfg.tzLabel);
  const used = await usageCounts(admin, uid, now, clock);
  if (used.messages >= cfg.dailyMessageLimit) {
    throw new HttpError(429, "rate_limited", `You've used today's ${cfg.dailyMessageLimit} AI messages. You can still book from the service list, or try again tomorrow.`);
  }
  if (audio && used.voice >= cfg.dailyVoiceLimit) throw new HttpError(429, "voice_limited", `You've used today's ${cfg.dailyVoiceLimit} voice messages. You can keep typing.`);
  if (image && used.photos >= cfg.dailyPhotoLimit) throw new HttpError(429, "photo_limited", `You've used today's ${cfg.dailyPhotoLimit} photos. You can describe the problem instead.`);
  if (used.burst >= cfg.perMinuteLimit) throw new HttpError(429, "slow_down", "You're sending messages very quickly. Please wait a moment.");

  // ---- conversation + context (catalog, history, addresses via RLS) ----
  let conversationId = typeof body.conversation_id === "string" && UUID.test(body.conversation_id) ? body.conversation_id : null;
  if (conversationId) {
    const { data } = await admin.from("ai_conversations").select("id").eq("id", conversationId).eq("user_id", uid).maybeSingle();
    if (!data) conversationId = null;
  }
  const isNewConversation = !conversationId;
  if (!conversationId) {
    const title = conversationTitle(text || (image ? "Photo of the problem" : "Voice message"));
    const { data, error } = await admin.from("ai_conversations").insert({ user_id: uid, title }).select("id").single();
    if (error) throw error;
    conversationId = data.id as string;
  }
  const [cats, history, addrs, prior, customerRows] = await Promise.all([
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
    // Every customer message of this conversation (not just the model's recent window), for the provider job brief.
    admin
      .from("ai_messages")
      .select("content, payload")
      .eq("conversation_id", conversationId)
      .eq("user_id", uid)
      .eq("role", "user")
      .order("created_at", { ascending: true })
      .limit(40),
  ]);
  if (cats.error) throw cats.error;
  const earlier = (customerRows.data ?? []) as { content: string; payload: Json | null }[];
  const customerTexts = [...earlier.map((r) => r.content), text].filter((c) => c && c !== "(photo)" && c !== "(voice message)");
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
    customerTexts,
    lastUserText: text,
    textsComplete: !audio,
    hasPhoto: !!image || earlier.some((r) => !!obj(r.payload)?.photo),
  };

  // ---- photo: stored (metadata-stripped) in the owner's private folder; old photos purged per retention ----
  let photo: Prepared["photo"] = null;
  if (image) {
    const path = `${uid}/${requestId}.${image.mime === "image/png" ? "png" : "jpg"}`;
    const up = await admin.storage.from(PHOTO_BUCKET).upload(path, image.bytes, { contentType: image.mime, upsert: false });
    if (up.error) log("warn", { event: "photo_store_failed", request_id: requestId, error: up.error.message.slice(0, 120) });
    photo = { path: up.error ? null : path, mime: image.mime, bytes: image.bytes.length };
    await admin.from("ai_usage").insert({ user_id: uid, kind: "photo", request_id: requestId });
    void purgeOldPhotos(admin, uid, cfg.photoRetentionDays, requestId);
  }
  if (audio) await admin.from("ai_usage").insert({ user_id: uid, kind: "voice_chat", request_id: requestId });

  const { data: userRow, error: insErr } = await admin
    .from("ai_messages")
    .insert({
      conversation_id: conversationId,
      user_id: uid,
      role: "user",
      input_kind: audio || voice ? "voice" : "text",
      content: text || (image ? "(photo)" : "(voice message)"),
      payload: { request_id: requestId, ...(voice ? { voice } : {}), ...(photo ? { photo } : {}) },
    })
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
            : "Voice message from the customer (audio above). Put their exact words in respond.transcript_original and an English translation in respond.transcript_en, then help them.",
        },
      ]
    : image
      ? [
          { inlineData: { mimeType: image.mime, data: encodeBase64(image.bytes) } },
          { text: text || "Photo from the customer showing the problem (see PHOTOS). Say briefly what is visible and relevant, then help them." },
        ]
      : [{ text }];
  const injection = looksLikeInjection(text);
  if (injection) userParts.push({ text: INJECTION_REMINDER });
  const contents: Content[] = toContents(((prior.data ?? []) as { role: string; content: string; payload: Json }[]).reverse());
  contents.push({ role: "user", parts: userParts });

  return {
    cfg,
    apiKey,
    requestId,
    started,
    uid,
    admin,
    ctx,
    conversationId,
    isNewConversation,
    userRowId: userRow.id as number,
    text,
    audio,
    voice,
    photo,
    system,
    contents,
    injection,
    used,
  };
}

/** Retention: deletes this customer's diagnosis photos older than AI_PHOTO_RETENTION_DAYS (best effort, logged). */
async function purgeOldPhotos(admin: SupabaseClient, uid: string, days: number, requestId: string) {
  try {
    const cutoff = Date.now() - days * 86_400_000;
    const { data, error } = await admin.storage.from(PHOTO_BUCKET).list(uid, { limit: 100, sortBy: { column: "created_at", order: "asc" } });
    if (error) throw error;
    const old = (data ?? []).filter((f) => f.created_at && Date.parse(f.created_at) < cutoff).map((f) => `${uid}/${f.name}`);
    if (old.length) {
      const rm = await admin.storage.from(PHOTO_BUCKET).remove(old);
      if (rm.error) throw rm.error;
      log("info", { event: "photos_purged", request_id: requestId, user: uid, count: old.length });
    }
  } catch (e) {
    log("warn", { event: "photo_purge_failed", request_id: requestId, error: (e as Error).message?.slice(0, 120) });
  }
}

async function runChat(p: Prepared, stages: StageTracker, signal: AbortSignal, streamed: boolean) {
  const { cfg, ctx, admin, uid, requestId, started } = p;
  const deadline = started + cfg.requestBudgetMs;
  let state = newState();
  const usageTotal = { input: 0, output: 0, calls: 0 };
  const fb = await withFallback(
    {
      plan: attemptPlan(cfg),
      primaryModel: cfg.primaryModel,
      hasFallback: !!cfg.fallbackModel,
      cooldown: primaryCooldown,
      cooldownMs: cfg.primaryCooldownMs,
      deadline,
      signal,
    },
    async (model, callTimeoutMs, executedBefore) => {
      state = newState();
      try {
        return await runAgent(
          model,
          p.system,
          p.contents,
          state,
          {
            generate: (m, body, timeoutMs, sig) => generateContent(cfg.apiBase, m, body, p.apiKey, timeoutMs, sig),
            execTool: (name, args) => execTool(ctx, state, name, args),
            stages,
            signal,
            maxSteps: cfg.maxSteps,
            maxOutputTokens: cfg.maxOutputTokens,
            thinkingLevel: cfg.thinkingLevel,
            functionDeclarations: functionDeclarations(ctx.categories.map((c) => c.slug)),
            onToolError: (name, e) => log("warn", { event: "tool_failed", request_id: requestId, tool: name, error: e.message?.slice(0, 160) }),
          },
          deadline,
          callTimeoutMs,
          executedBefore ? "backup" : "understanding",
        );
      } finally {
        usageTotal.input += state.usage.input;
        usageTotal.output += state.usage.output;
        usageTotal.calls += state.usage.calls;
      }
    },
  );
  const attempts = fb.attempts;
  if (!fb.result) {
    if ((p.audio || p.photo) && allRejected(attempts)) {
      log("warn", { event: p.audio ? "audio_rejected" : "image_rejected", request_id: requestId, attempts, ms: Date.now() - started });
      throw p.audio
        ? new HttpError(400, "bad_audio", "We couldn't understand that recording. Please try again or type your message.")
        : new HttpError(400, "bad_image", "That photo couldn't be processed. Please try another photo or describe the problem.");
    }
    await admin.from("ai_messages").insert({ conversation_id: p.conversationId, user_id: uid, role: "error", payload: { request_id: requestId, attempts } });
    log("error", { event: "model_unavailable", request_id: requestId, attempts, ms: Date.now() - started });
    throw modelFailure(attempts, fb.lastError, started, cfg);
  }
  const result = fb.result;

  // ---- validated reply: pros/prices/drafts only from tool results ----
  const r = result.args;
  const slug = validSlug(ctx, r.category_slug) ?? state.draft?.category_slug ?? state.lastSlug;
  if (slug && (r.show_providers === true || state.draft) && !state.searches.has(slug) && ctx.location) {
    await stages.run("pros", () => searchPros(ctx, state, slug)).catch(() => undefined);
  }
  const wantStats = !!slug && (r.show_estimate === true || !!state.draft);
  const stats = wantStats
    ? await (state.estimates.has(slug!) ? priceStats(ctx, state, slug!) : stages.run("pricing", () => priceStats(ctx, state, slug!))).catch(() => null)
    : null;
  const reply = composeReply({
    respond: r,
    slug,
    categoryName: ctx.categories.find((c) => c.slug === slug)?.name ?? null,
    draft: state.draft,
    searchRows: slug ? (state.searches.get(slug) ?? null) : null,
    stats,
    history: ctx.history,
    now: ctx.now,
    clock: ctx.clock,
    minPriceSamples: cfg.minPriceSamples,
    priceLookbackDays: cfg.priceLookbackDays,
    isVoice: !!p.audio,
    userText: p.text,
    hasPhoto: !!p.photo,
  });
  // The customer's turn as shown in the chat: a reviewed transcript (voice preview) or what the model heard (raw clip).
  const turnVoice: VoiceMeta | null = p.voice ??
    (p.audio && reply.transcript ? { transcript_original: reply.transcript, transcript_en: reply.transcript_en, edited: false } : null);
  const stageSummary = stages.summary();

  const { data: asstRow } = await admin
    .from("ai_messages")
    .insert({
      conversation_id: p.conversationId,
      user_id: uid,
      role: "assistant",
      content: reply.reply_text,
      payload: {
        request_id: requestId,
        policy_version: POLICY_VERSION,
        guardrails: reply.guardrails,
        injection_flag: p.injection,
        language: reply.language,
        quick_replies: reply.quick_replies,
        cards: reply.cards,
        handoff: reply.handoff,
        summary: summarize(reply.cards),
        tools: state.tools,
        calls: usageTotal.calls,
        attempts,
        stages: stageSummary,
      },
      model: result.model,
      input_tokens: usageTotal.input,
      output_tokens: usageTotal.output,
    })
    .select("id")
    .single();
  await Promise.all([
    p.audio && turnVoice
      ? admin.from("ai_messages").update({ content: turnVoice.transcript_original, payload: { request_id: requestId, voice: turnVoice } }).eq("id", p.userRowId)
      : Promise.resolve(),
    admin
      .from("ai_conversations")
      .update({
        updated_at: new Date().toISOString(),
        language: reply.language,
        ...(p.isNewConversation && p.audio && turnVoice ? { title: conversationTitle(turnVoice.transcript_original) } : {}),
      })
      .eq("id", p.conversationId),
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
    stages: stageSummary.map((s) => `${s.key}:${s.ms}${s.ok ? "" : "!"}`),
    streamed,
    voice: p.audio ? "clip" : p.voice ? (p.voice.edited ? "transcript_edited" : "transcript") : null,
    photo: !!p.photo,
    handoff: reply.handoff?.reason ?? null,
    has_location: !!ctx.location,
    policy_version: POLICY_VERSION,
    guardrails: reply.guardrails,
    injection_flag: p.injection,
    ms: Date.now() - started,
  });

  const { guardrails: _g, transcript: _t, transcript_en: _te, ...publicReply } = reply;
  return {
    conversation_id: p.conversationId,
    message_id: asstRow?.id ?? null,
    user_message_id: p.userRowId,
    request_id: requestId,
    policy_version: POLICY_VERSION,
    ...publicReply,
    // The customer's own turn: original words (+ English) for voice, so the chat bubble shows what they said.
    user_turn: {
      voice: !!turnVoice,
      transcript_original: turnVoice?.transcript_original ?? null,
      transcript_en: turnVoice?.transcript_en ?? null,
      photo: !!p.photo,
    },
    transcript_original: turnVoice?.transcript_original ?? null,
    transcript_en: turnVoice?.transcript_en ?? null,
    transcript: turnVoice?.transcript_original ?? null, // v1 clients
    model: result.model,
    fallback_used: result.model !== cfg.primaryModel,
    attempts: attempts.map((a) => ({ model: a.model, ms: a.ms, ...(a.error ? { error: a.error.split(":")[0] } : {}) })),
    stages: stageSummary,
    usage: { input_tokens: usageTotal.input, output_tokens: usageTotal.output, model_calls: usageTotal.calls, ms: Date.now() - started },
    limits: {
      messages_left: Math.max(0, cfg.dailyMessageLimit - p.used.messages - 1),
      voice_left: Math.max(0, cfg.dailyVoiceLimit - p.used.voice - (p.audio ? 1 : 0)),
      photos_left: Math.max(0, cfg.dailyPhotoLimit - p.used.photos - (p.photo ? 1 : 0)),
    },
    location_set: !!ctx.location,
  };
}

// ---------- transport ----------
/** Server-sent events: `data: {json}\n\n` per event, comment pings every 10 s; client disconnect aborts the work. */
function sseResponse(headers: Record<string, string>, reqSignal: AbortSignal, run: (send: (e: unknown) => void, signal: AbortSignal) => Promise<void>): Response {
  const enc = new TextEncoder();
  const ctrl = new AbortController();
  let closed = false;
  const onReqAbort = () => ctrl.abort();
  reqSignal.addEventListener("abort", onReqAbort);
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const write = (s: string) => {
        if (closed) return;
        try {
          c.enqueue(enc.encode(s));
        } catch {
          closed = true;
          ctrl.abort();
        }
      };
      const ping = setInterval(() => write(": ping\n\n"), 10_000);
      try {
        await run((e) => write(`data: ${JSON.stringify(e)}\n\n`), ctrl.signal);
      } finally {
        clearInterval(ping);
        reqSignal.removeEventListener("abort", onReqAbort);
        if (!closed) {
          closed = true;
          try {
            c.close();
          } catch {
            // already closed by the runtime
          }
        }
      }
    },
    cancel() {
      closed = true;
      ctrl.abort();
    },
  });
  return new Response(stream, {
    headers: { ...headers, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}

function errorResult(e: unknown, requestId: string, uid: string | null): { status: number; body: Json } {
  if (e instanceof AbortedError) {
    log("info", { event: "client_aborted", request_id: requestId, user: uid });
    return { status: 499, body: { error: "Stopped.", code: "aborted", request_id: requestId } };
  }
  if (e instanceof HttpError) {
    log(e.status >= 500 ? "error" : "info", { event: "rejected", request_id: requestId, user: uid, code: e.code, status: e.status });
    return { status: e.status, body: { error: e.message, code: e.code, request_id: requestId } };
  }
  log("error", { event: "internal", request_id: requestId, user: uid, error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) });
  return { status: 500, body: { error: "Something went wrong. Please try again.", code: "internal", request_id: requestId } };
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
    if (declared > Math.max(cfg.maxAudioBase64Chars, Math.ceil((cfg.maxImageBytes * 4) / 3)) + 200_000) {
      throw new HttpError(413, "too_large", "That message is too large.");
    }

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
    const auth: Auth = {
      uid,
      admin,
      userClient: createClient(supabaseUrl, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } }),
    };

    const body = obj(await req.json().catch(() => null));
    if (!body) throw new HttpError(400, "bad_request", "Invalid request.");
    if (body.mode === "transcribe") return json(await transcribe(cfg, auth, body, apiKey, requestId, started, req.signal));

    // Validation, limits and context happen before streaming starts, so those errors keep real HTTP status codes.
    const prepared = await prepareChat(cfg, auth, body, apiKey, requestId, started);
    const wantsStream = cfg.streamingEnabled && (req.headers.get("Accept") ?? "").includes("text/event-stream");
    if (!wantsStream) return json(await runChat(prepared, new StageTracker(() => {}, started), req.signal, false));

    const userId = uid;
    return sseResponse(cors.headers, req.signal, async (send, signal) => {
      send({ type: "start", request_id: requestId, conversation_id: prepared.conversationId, policy_version: POLICY_VERSION });
      try {
        const out = await runChat(prepared, new StageTracker((e: StageEvent) => send(e), started), signal, true);
        send({ type: "final", ...out });
      } catch (e) {
        const r = errorResult(e, requestId, userId);
        if (r.status !== 499) send({ type: "error", status: r.status, ...r.body });
      }
    });
  } catch (e) {
    const r = errorResult(e, requestId, uid);
    return json(r.body, r.status);
  }
});

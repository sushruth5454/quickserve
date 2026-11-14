// Runtime configuration for ai-assistant, read from function secrets/env with production-safe defaults and clamps.
// Pure (takes a getter) so it can be unit-tested with `deno test`.

export interface AiConfig {
  enabled: boolean;
  voiceEnabled: boolean;
  primaryModel: string;
  fallbackModel: string | null;
  primaryCallTimeoutMs: number;
  callTimeoutMs: number;
  requestBudgetMs: number;
  primaryCooldownMs: number;
  fallbackRetries: number;
  maxSteps: number;
  maxOutputTokens: number;
  thinkingLevel: string | null;
  dailyMessageLimit: number;
  dailyVoiceLimit: number;
  perMinuteLimit: number;
  maxTextChars: number;
  maxAudioBase64Chars: number;
  historyRows: number;
  /** Marketplace time zone as a fixed UTC offset (India: +330). Used for "today", slots and the daily limit. */
  tzOffsetMinutes: number;
  tzLabel: string;
  priceLookbackDays: number;
  minPriceSamples: number;
  /** Exact browser origins allowed by CORS; empty = any origin (auth is a bearer token, never cookies). */
  allowedOrigins: string[];
  apiBase: string;
}

type Get = (name: string) => string | undefined;

const int = (get: Get, name: string, def: number, min: number, max: number): number => {
  const raw = get(name);
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

const bool = (get: Get, name: string, def: boolean): boolean => {
  const raw = (get(name) ?? "").trim().toLowerCase();
  if (!raw) return def;
  return ["1", "true", "yes", "on"].includes(raw);
};

const str = (get: Get, name: string, def: string): string => {
  const raw = (get(name) ?? "").trim();
  return raw || def;
};

const MODEL_ID = /^[a-z0-9][a-z0-9.\-]{2,63}$/;

export function loadConfig(get: Get): AiConfig {
  const primary = str(get, "AI_PRIMARY_MODEL", "gemini-3.8-flash");
  const fallbackRaw = str(get, "AI_FALLBACK_MODEL", "gemini-3.5-flash-lite");
  const fallback = fallbackRaw.toLowerCase() === "none" ? null : fallbackRaw;
  const thinking = str(get, "AI_THINKING_LEVEL", "low").toLowerCase();
  return {
    enabled: bool(get, "AI_ASSISTANT_ENABLED", true),
    voiceEnabled: bool(get, "AI_VOICE_ENABLED", true),
    primaryModel: MODEL_ID.test(primary) ? primary : "gemini-3.8-flash",
    fallbackModel: fallback && MODEL_ID.test(fallback) ? fallback : null,
    primaryCallTimeoutMs: int(get, "AI_PRIMARY_CALL_TIMEOUT_MS", 12_000, 2_000, 60_000),
    callTimeoutMs: int(get, "AI_CALL_TIMEOUT_MS", 15_000, 2_000, 60_000),
    requestBudgetMs: int(get, "AI_REQUEST_BUDGET_MS", 50_000, 5_000, 120_000),
    primaryCooldownMs: int(get, "AI_PRIMARY_COOLDOWN_MS", 300_000, 0, 3_600_000),
    fallbackRetries: int(get, "AI_FALLBACK_RETRIES", 1, 0, 3),
    maxSteps: int(get, "AI_MAX_STEPS", 6, 2, 10),
    maxOutputTokens: int(get, "AI_MAX_OUTPUT_TOKENS", 2048, 256, 8192),
    thinkingLevel: ["none", "off", ""].includes(thinking) ? null : thinking,
    dailyMessageLimit: int(get, "AI_DAILY_MESSAGE_LIMIT", 30, 0, 10_000),
    dailyVoiceLimit: int(get, "AI_DAILY_VOICE_LIMIT", 10, 0, 10_000),
    perMinuteLimit: int(get, "AI_PER_MINUTE_LIMIT", 6, 1, 600),
    maxTextChars: int(get, "AI_MAX_TEXT_CHARS", 1000, 50, 4000),
    // ~1.5 MB of audio: 60 s of AAC at the app's HIGH_QUALITY preset is ~1 MB.
    maxAudioBase64Chars: int(get, "AI_MAX_AUDIO_BASE64_CHARS", 2_100_000, 10_000, 10_000_000),
    historyRows: int(get, "AI_HISTORY_ROWS", 10, 0, 40),
    tzOffsetMinutes: int(get, "APP_TZ_OFFSET_MINUTES", 330, -720, 840),
    tzLabel: str(get, "APP_TZ_LABEL", "IST"),
    priceLookbackDays: int(get, "AI_PRICE_LOOKBACK_DAYS", 180, 7, 1_095),
    minPriceSamples: int(get, "AI_MIN_PRICE_SAMPLES", 3, 1, 100),
    allowedOrigins: (get("AI_ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean),
    apiBase: str(get, "GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta"),
  };
}

/** Attempt plan: primary once, then the fallback (retried after a short pause on 429/503/timeouts). */
export function attemptPlan(c: AiConfig): { model: string; callTimeoutMs: number; backoffMs?: number }[] {
  const plan: { model: string; callTimeoutMs: number; backoffMs?: number }[] = [{ model: c.primaryModel, callTimeoutMs: c.primaryCallTimeoutMs }];
  if (c.fallbackModel) {
    plan.push({ model: c.fallbackModel, callTimeoutMs: c.callTimeoutMs });
    for (let i = 0; i < c.fallbackRetries; i++) plan.push({ model: c.fallbackModel, callTimeoutMs: c.callTimeoutMs, backoffMs: 1200 * (i + 1) });
  } else {
    for (let i = 0; i < c.fallbackRetries; i++) plan.push({ model: c.primaryModel, callTimeoutMs: c.callTimeoutMs, backoffMs: 1200 * (i + 1) });
  }
  return plan;
}

const BASE_CORS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
};

/** CORS headers for a request; `allowed` is false for a browser origin outside AI_ALLOWED_ORIGINS. */
export function corsFor(origin: string | null, c: AiConfig): { headers: Record<string, string>; allowed: boolean } {
  if (!c.allowedOrigins.length) return { headers: { ...BASE_CORS, "Access-Control-Allow-Origin": "*" }, allowed: true };
  if (!origin) return { headers: { ...BASE_CORS }, allowed: true }; // native apps / server-to-server send no Origin
  const ok = c.allowedOrigins.includes(origin.replace(/\/$/, ""));
  return { headers: ok ? { ...BASE_CORS, "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { ...BASE_CORS, Vary: "Origin" }, allowed: ok };
}

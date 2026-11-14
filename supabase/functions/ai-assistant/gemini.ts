// Minimal Gemini generateContent client with model fallback. Request shapes follow the Gemini API REST docs
// (functionDeclarations + toolConfig.functionCallingConfig, inlineData audio parts, thinkingConfig.thinkingLevel).
// Gemini 3 models ignore/deprecate temperature, so determinism comes from the system instruction instead.

export const PRIMARY_MODEL = "gemini-3.8-flash";
export const FALLBACK_MODEL = "gemini-3.5-flash-lite";
export const THINKING_LEVEL = "low";
export const MAX_OUTPUT_TOKENS = 2048;
/** Per generateContent call. The primary gets less time: if it is that slow it is overloaded, and the fallback is fast. */
export const CALL_TIMEOUT_MS = 15_000;
export const PRIMARY_CALL_TIMEOUT_MS = 12_000;
/** After the primary fails, skip it for this long (per function instance) so users don't wait for it again. */
export const PRIMARY_COOLDOWN_MS = 5 * 60_000;

/** Attempt plan: primary once, then the fallback (retried once after a short pause on 429/503/timeouts). */
export const ATTEMPTS: { model: string; callTimeoutMs: number; backoffMs?: number }[] = [
  { model: PRIMARY_MODEL, callTimeoutMs: PRIMARY_CALL_TIMEOUT_MS },
  { model: FALLBACK_MODEL, callTimeoutMs: CALL_TIMEOUT_MS },
  { model: FALLBACK_MODEL, callTimeoutMs: CALL_TIMEOUT_MS, backoffMs: 1200 },
];

const API = "https://generativelanguage.googleapis.com/v1beta/models";

export interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; id?: string; response: Record<string, unknown> };
  thoughtSignature?: string;
  thought?: boolean;
}

export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export interface GenerateResponse {
  candidates?: { content?: Content; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Worth retrying on the fallback model (overload, quota, timeout, transient). */
    readonly fallback: boolean,
  ) {
    super(message);
  }
}

export async function generateContent(model: string, body: unknown, apiKey: string, timeoutMs = CALL_TIMEOUT_MS): Promise<GenerateResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));
  let res: Response;
  try {
    res = await fetch(`${API}/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new GeminiError(ctrl.signal.aborted ? `timeout after ${timeoutMs} ms` : `network: ${(e as Error).message}`, 0, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 400);
    // 429/5xx are the documented transient cases; 400/404 on one model (e.g. a parameter it does not support) is also
    // worth one try on the other model. 401/403 (bad key) is not.
    const fallback = res.status === 429 || res.status >= 500 || res.status === 400 || res.status === 404;
    throw new GeminiError(`HTTP ${res.status}: ${text}`, res.status, fallback);
  }
  return (await res.json()) as GenerateResponse;
}

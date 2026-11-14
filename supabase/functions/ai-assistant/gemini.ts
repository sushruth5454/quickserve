// Minimal Gemini generateContent client. Request shapes follow the Gemini API REST docs (functionDeclarations +
// toolConfig.functionCallingConfig, inlineData audio parts, generationConfig.thinkingConfig.thinkingLevel).
// Gemini 3 models ignore/deprecate temperature, so determinism comes from the system instruction instead.
// Models, timeouts and limits come from config.ts (env).

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
    /** Worth trying the next attempt (overload, quota, timeout, transient, model-specific 400/404). */
    readonly fallback: boolean,
  ) {
    super(message);
  }
}

/** Only status-level detail is kept from provider errors (never request bodies, which may contain user text/audio). */
export function errorSummary(status: number, text: string): string {
  const m = /"status"\s*:\s*"([A-Z_]+)"/.exec(text);
  return `HTTP ${status}${m ? ` ${m[1]}` : ""}`;
}

export async function generateContent(apiBase: string, model: string, body: unknown, apiKey: string, timeoutMs: number): Promise<GenerateResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));
  let res: Response;
  try {
    res = await fetch(`${apiBase}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (_e) {
    throw new GeminiError(ctrl.signal.aborted ? `timeout after ${timeoutMs} ms` : "network error", 0, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 401/403 = bad or missing key: no other model will help.
    const fallback = !(res.status === 401 || res.status === 403);
    throw new GeminiError(errorSummary(res.status, text), res.status, fallback);
  }
  return (await res.json()) as GenerateResponse;
}

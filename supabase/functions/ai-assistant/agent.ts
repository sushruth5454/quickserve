// The Gemini function-calling loop and the model fallback plan, with injected dependencies (model call, tool
// executor, stage tracker, abort signal) so the ordering/truthfulness of progress stages and abort handling are
// unit-tested in agent_test.ts without a network.
import { AbortedError, type Content, GeminiError, type GenerateResponse, type Part } from "./gemini.ts";
import { toolCallAllowed } from "./policies/tools.ts";
import { type StageKey, StageTracker, TOOL_STAGE } from "./stages.ts";

export interface AgentUsage {
  input: number;
  output: number;
  calls: number;
}

export interface AgentState {
  tools: { name: string; error?: string }[];
  usage: AgentUsage;
}

export interface AgentDeps {
  /** One generateContent call (already bound to API base/key). */
  generate: (model: string, body: unknown, timeoutMs: number, signal?: AbortSignal) => Promise<GenerateResponse>;
  execTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  stages: StageTracker;
  signal?: AbortSignal;
  maxSteps: number;
  maxOutputTokens: number;
  thinkingLevel: string | null;
  functionDeclarations: unknown[];
  onToolError?: (name: string, error: Error) => void;
}

const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new AbortedError();
};

/**
 * Runs one attempt with one model until it calls `respond`. Stages: the first model call is `firstStage`
 * ("understanding", or "backup" when an earlier attempt failed), later model calls are "reviewing"; each executed
 * (permitted) tool shows its own stage. Denied tool calls show nothing.
 */
export async function runAgent(
  model: string,
  system: string,
  contents: Content[],
  state: AgentState,
  deps: AgentDeps,
  deadline: number,
  callTimeoutMs: number,
  firstStage: StageKey,
): Promise<{ args: Record<string, unknown>; model: string }> {
  const tools = [{ functionDeclarations: deps.functionDeclarations }];
  const convo = [...contents];
  const used = new Map<string, number>();
  for (let step = 0; step < deps.maxSteps; step++) {
    checkAbort(deps.signal);
    const last = step === deps.maxSteps - 1;
    const remaining = deadline - Date.now();
    if (remaining < 2000) throw new GeminiError("request budget exhausted", 0, false);
    const stage: StageKey = step === 0 ? firstStage : "reviewing";
    const res = await deps.stages.run(stage, () =>
      deps.generate(
        model,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: convo,
          tools,
          toolConfig: { functionCallingConfig: last ? { mode: "ANY", allowedFunctionNames: ["respond"] } : { mode: "ANY" } },
          generationConfig: {
            maxOutputTokens: deps.maxOutputTokens,
            ...(deps.thinkingLevel ? { thinkingConfig: { thinkingLevel: deps.thinkingLevel } } : {}),
          },
        },
        Math.min(remaining, callTimeoutMs),
        deps.signal,
      ),
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
      checkAbort(deps.signal);
      const { name, id } = c.functionCall!;
      const args = (c.functionCall!.args && typeof c.functionCall!.args === "object" ? c.functionCall!.args : {}) as Record<string, unknown>;
      let response: Record<string, unknown>;
      const denied = toolCallAllowed(name, used);
      const toolStage = TOOL_STAGE[name];
      if (denied || !toolStage) {
        response = { error: denied ?? `Unknown tool ${name}.` };
      } else {
        try {
          response = await deps.stages.run(toolStage, () => deps.execTool(name, args), (r) => typeof r.error !== "string");
        } catch (e) {
          deps.onToolError?.(name, e as Error);
          response = { error: "Temporary problem fetching data. Answer without it." };
        }
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

export interface AttemptRecord {
  model: string;
  ms: number;
  error?: string;
}

export interface FallbackOptions {
  plan: { model: string; callTimeoutMs: number; backoffMs?: number }[];
  primaryModel: string;
  hasFallback: boolean;
  /** Shared per-instance circuit breaker for the primary model. */
  cooldown: { until: number };
  cooldownMs: number;
  deadline: number;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface FallbackResult<T> {
  result: T | null;
  model: string | null;
  attempts: AttemptRecord[];
  lastError: GeminiError | null;
}

/**
 * Runs `attempt` over the plan: primary (unless cooling down), then fallback(s) with backoff. `executedBefore` tells
 * the attempt whether an earlier attempt actually ran (so its first stage is "backup" instead of "understanding").
 * AbortedError propagates immediately; non-Gemini errors propagate as bugs.
 */
export async function withFallback<T>(
  o: FallbackOptions,
  attempt: (model: string, callTimeoutMs: number, executedBefore: boolean) => Promise<T>,
): Promise<FallbackResult<T>> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts: AttemptRecord[] = [];
  let lastError: GeminiError | null = null;
  let executed = false;
  for (const p of o.plan) {
    checkAbort(o.signal);
    if (p.model === o.primaryModel && o.hasFallback && now() < o.cooldown.until) {
      attempts.push({ model: p.model, ms: 0, error: "skipped (cooldown)" });
      continue;
    }
    if (p.backoffMs) await sleep(p.backoffMs);
    if (o.deadline - now() < 4000) break;
    const t0 = now();
    try {
      const result = await attempt(p.model, p.callTimeoutMs, executed);
      attempts.push({ model: p.model, ms: now() - t0 });
      return { result, model: p.model, attempts, lastError };
    } catch (e) {
      if (e instanceof AbortedError || !(e instanceof GeminiError)) throw e;
      executed = true;
      lastError = e;
      attempts.push({ model: p.model, ms: now() - t0, error: e.message.slice(0, 80) });
      // A 400 means this request was rejected (bad input), not that the model is overloaded.
      if (p.model === o.primaryModel && o.hasFallback && e.status !== 400) o.cooldown.until = now() + o.cooldownMs;
      if (!e.fallback) break;
    }
  }
  return { result: null, model: null, attempts, lastError };
}

/** Every executed attempt was rejected with HTTP 400 (with audio/images: unreadable input, not an outage). */
export function allRejected(attempts: AttemptRecord[]): boolean {
  const ran = attempts.filter((a) => a.error !== "skipped (cooldown)");
  return ran.length > 0 && ran.every((a) => a.error?.startsWith("HTTP 400"));
}

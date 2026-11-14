// Deterministic tests for the agent loop and fallback plan: progress stages are emitted only around real work, in
// order; denied/unknown tools show no stage; failures show as failed; aborts stop further model calls.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type AgentDeps, allRejected, runAgent, withFallback } from "./agent.ts";
import { AbortedError, GeminiError, type GenerateResponse } from "./gemini.ts";
import { type StageEvent, StageTracker } from "./stages.ts";

type Call = { name: string; args?: Record<string, unknown> };
const reply = (...calls: Call[]): GenerateResponse => ({
  candidates: [{ content: { role: "model", parts: calls.map((c, i) => ({ functionCall: { name: c.name, args: c.args ?? {}, id: `c${i}` } })) } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
});

/** A fake model that returns the scripted responses in order and records each call. */
function harness(script: (GenerateResponse | Error)[], tools: Record<string, Record<string, unknown> | Error> = {}) {
  const events: StageEvent[] = [];
  const modelCalls: string[] = [];
  const toolCalls: string[] = [];
  let clock = 0;
  const stages = new StageTracker((e) => events.push(e), 0, () => (clock += 5));
  const ctrl = new AbortController();
  const deps: AgentDeps = {
    generate: (model) => {
      modelCalls.push(model);
      const next = script.shift();
      if (!next) throw new Error("script exhausted");
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    execTool: (name) => {
      toolCalls.push(name);
      const r = tools[name] ?? { result: "ok" };
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
    stages,
    signal: ctrl.signal,
    maxSteps: 6,
    maxOutputTokens: 256,
    thinkingLevel: null,
    functionDeclarations: [],
  };
  const state = { tools: [] as { name: string; error?: string }[], usage: { input: 0, output: 0, calls: 0 } };
  const seq = () => events.map((e) => `${e.key}:${e.status}`);
  return { events, seq, modelCalls, toolCalls, deps, state, ctrl, stages };
}

const far = () => Date.now() + 60_000;

Deno.test("stages: ordered and truthful — one per real model call / executed tool", async () => {
  const h = harness([
    reply({ name: "search_providers", args: { category_slug: "ac-repair" } }, { name: "get_price_estimate", args: { category_slug: "ac-repair" } }),
    reply({ name: "draft_booking" }),
    reply({ name: "respond", args: { reply_text: "Draft ready" } }),
  ]);
  const out = await runAgent("m1", "sys", [], h.state, h.deps, far(), 5000, "understanding");
  assertEquals(out.args.reply_text, "Draft ready");
  assertEquals(h.seq(), [
    "understanding:active",
    "understanding:done",
    "pros:active",
    "pros:done",
    "pricing:active",
    "pricing:done",
    "reviewing:active",
    "reviewing:done",
    "drafting:active",
    "drafting:done",
    "reviewing:active",
    "reviewing:done",
  ]);
  assertEquals(h.toolCalls, ["search_providers", "get_price_estimate", "draft_booking"]);
  // Every stage that finished had started first, and times only move forward.
  for (let i = 1; i < h.events.length; i++) assert(h.events[i]!.t >= h.events[i - 1]!.t);
  assertEquals(h.stages.summary().map((s) => s.key), ["understanding", "pros", "pricing", "reviewing", "drafting", "reviewing"]);
  assertEquals(h.state.usage.calls, 3);
});

Deno.test("stages: a tool error shows as failed; denied and unknown tools show no stage and never run", async () => {
  const h = harness(
    [
      reply({ name: "get_my_history" }, { name: "get_my_history" }, { name: "delete_everything" }, { name: "get_price_estimate" }),
      reply({ name: "respond", args: { reply_text: "ok" } }),
    ],
    { get_price_estimate: { error: "No price data" } },
  );
  await runAgent("m1", "sys", [], h.state, h.deps, far(), 5000, "understanding");
  assertEquals(h.toolCalls, ["get_my_history", "get_price_estimate"]); // 2nd history call over budget; unknown tool denied
  assertEquals(h.seq(), [
    "understanding:active",
    "understanding:done",
    "history:active",
    "history:done",
    "pricing:active",
    "pricing:failed",
    "reviewing:active",
    "reviewing:done",
  ]);
  assertEquals(h.state.tools.filter((t) => t.error).map((t) => t.name), ["get_my_history", "delete_everything", "get_price_estimate"]);
});

Deno.test("stages: a thrown tool is reported failed and the model gets a neutral error", async () => {
  const h = harness([reply({ name: "search_providers" }), reply({ name: "respond", args: { reply_text: "ok" } })], { search_providers: new Error("db down") });
  await runAgent("m1", "sys", [], h.state, h.deps, far(), 5000, "understanding");
  assert(h.seq().includes("pros:failed"));
  assertEquals(h.state.tools[0], { name: "search_providers", error: "Temporary problem fetching data. Answer without it." });
});

Deno.test("abort: no further model or tool calls after the client stops", async () => {
  const h = harness([reply({ name: "search_providers" }), reply({ name: "respond", args: { reply_text: "late" } })]);
  h.deps.execTool = (name) => {
    h.toolCalls.push(name);
    h.ctrl.abort(); // customer taps Stop while the search runs
    return Promise.resolve({ result: [] });
  };
  await assertRejects(() => runAgent("m1", "sys", [], h.state, h.deps, far(), 5000, "understanding"), AbortedError);
  assertEquals(h.modelCalls.length, 1);
  assertEquals(h.seq().at(-1), "pros:done");
});

Deno.test("abort: an already-aborted request makes no model call at all", async () => {
  const h = harness([reply({ name: "respond" })]);
  h.ctrl.abort();
  await assertRejects(() => runAgent("m1", "sys", [], h.state, h.deps, far(), 5000, "understanding"), AbortedError);
  assertEquals(h.modelCalls.length, 0);
  assertEquals(h.events.length, 0);
});

Deno.test("fallback: failed primary → backup stage on the next model; cooldown set; abort propagates", async () => {
  const h = harness([new GeminiError("HTTP 503 UNAVAILABLE", 503, true), reply({ name: "respond", args: { reply_text: "ok" } })]);
  const cooldown = { until: 0 };
  const opts = {
    plan: [{ model: "primary", callTimeoutMs: 1000 }, { model: "lite", callTimeoutMs: 1000 }],
    primaryModel: "primary",
    hasFallback: true,
    cooldown,
    cooldownMs: 60_000,
    deadline: far(),
    sleep: () => Promise.resolve(),
  };
  const fb = await withFallback(opts, (model, t, executedBefore) =>
    runAgent(model, "sys", [], h.state, h.deps, far(), t, executedBefore ? "backup" : "understanding"));
  assertEquals(fb.model, "lite");
  assertEquals(h.seq(), ["understanding:active", "understanding:failed", "backup:active", "backup:done"]);
  assert(cooldown.until > Date.now());
  assertEquals(fb.attempts.map((a) => a.model), ["primary", "lite"]);

  // While cooling down the primary is skipped: the first real attempt is "understanding", not "backup".
  const h2 = harness([reply({ name: "respond", args: { reply_text: "ok" } })]);
  await withFallback(opts, (model, t, executedBefore) => runAgent(model, "sys", [], h2.state, h2.deps, far(), t, executedBefore ? "backup" : "understanding"));
  assertEquals(h2.seq(), ["understanding:active", "understanding:done"]);
  assertEquals(h2.modelCalls, ["lite"]);

  const ctrl = new AbortController();
  ctrl.abort();
  await assertRejects(() => withFallback({ ...opts, signal: ctrl.signal }, () => Promise.resolve(1)), AbortedError);
});

Deno.test("fallback: a 400 (bad input) does not trip the cooldown; allRejected detects unreadable input", async () => {
  const cooldown = { until: 0 };
  const fb = await withFallback(
    {
      plan: [{ model: "primary", callTimeoutMs: 1000 }, { model: "lite", callTimeoutMs: 1000 }],
      primaryModel: "primary",
      hasFallback: true,
      cooldown,
      cooldownMs: 60_000,
      deadline: far(),
    },
    () => Promise.reject(new GeminiError("HTTP 400 INVALID_ARGUMENT", 400, true)),
  );
  assertEquals(fb.result, null);
  assertEquals(cooldown.until, 0);
  assert(allRejected(fb.attempts));
  assert(!allRejected([{ model: "a", ms: 1, error: "HTTP 503" }, { model: "b", ms: 1, error: "HTTP 400" }]));
  assert(!allRejected([{ model: "a", ms: 0, error: "skipped (cooldown)" }]));
});

Deno.test("stage tracker never emits a 'done' for a stage that did not start", () => {
  const events: StageEvent[] = [];
  const t = new StageTracker((e) => events.push(e), 0, () => 1);
  t.finish("drafting");
  t.start("pros");
  t.start("pros"); // already active: no duplicate
  t.finish("pros");
  assertEquals(events.map((e) => `${e.key}:${e.status}`), ["pros:active", "pros:done"]);
});

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { chatUsageRows, recordChatModelCall, type ChatModelUsage } from "./chat_usage.ts";
import { GeminiError } from "./gemini.ts";

Deno.test("chat metering records failed primary and successful fallback calls independently", async () => {
  const at = new Date("2026-11-17T00:00:00.000Z");
  const records: ChatModelUsage[] = [];
  let time = 100;

  await assertRejects(
    () => recordChatModelCall(
      records,
      "gemini-3.8-flash",
      at,
      async () => {
        time += 12;
        throw new GeminiError("HTTP 503", 503, true);
      },
      () => time,
    ),
    GeminiError,
  );
  await recordChatModelCall(
    records,
    "gemini-3.5-flash-lite",
    at,
    async () => {
      time += 20;
      return { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 2 } };
    },
    () => time,
  );

  assertEquals(records, [
    { model: "gemini-3.8-flash", input_tokens: null, output_tokens: null, cost_micros_usd: null, latency_ms: 12, ok: false },
    { model: "gemini-3.5-flash-lite", input_tokens: 100, output_tokens: 12, cost_micros_usd: 60, latency_ms: 20, ok: true },
  ]);
  assertEquals(chatUsageRows("user-1", "request-1", records).map((row) => [row.kind, row.feature, row.model]), [
    ["chat", "ai_assistant", "gemini-3.8-flash"],
    ["chat", "ai_assistant", "gemini-3.5-flash-lite"],
  ]);
});

Deno.test("chat metering leaves cost unknown when provider token metadata or rate is unavailable", async () => {
  const records: ChatModelUsage[] = [];
  await recordChatModelCall(records, "unpriced-model", new Date(), async () => ({}));
  assertEquals(records[0]?.ok, true);
  assertEquals(records[0]?.input_tokens, null);
  assertEquals(records[0]?.output_tokens, null);
  assertEquals(records[0]?.cost_micros_usd, null);
});

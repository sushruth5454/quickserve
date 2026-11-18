import { estimateTokenCostMicrosUsd } from "./product_search.ts";
import type { GenerateResponse } from "./gemini.ts";

export interface ChatModelUsage {
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_micros_usd: number | null;
  latency_ms: number;
  ok: boolean;
}

export async function recordChatModelCall(
  records: ChatModelUsage[],
  model: string,
  at: Date,
  call: () => Promise<GenerateResponse>,
  now: () => number = Date.now,
): Promise<GenerateResponse> {
  const started = now();
  const record: ChatModelUsage = {
    model,
    input_tokens: null,
    output_tokens: null,
    cost_micros_usd: null,
    latency_ms: 0,
    ok: false,
  };
  records.push(record);
  try {
    const response = await call();
    record.ok = true;
    const input = response.usageMetadata?.promptTokenCount;
    const candidateOutput = response.usageMetadata?.candidatesTokenCount;
    const thoughts = response.usageMetadata?.thoughtsTokenCount ?? 0;
    if (Number.isSafeInteger(input) && Number.isSafeInteger(candidateOutput) && Number.isSafeInteger(thoughts)) {
      record.input_tokens = input!;
      record.output_tokens = candidateOutput! + thoughts;
      record.cost_micros_usd = estimateTokenCostMicrosUsd(model, record.input_tokens, record.output_tokens, at);
    }
    return response;
  } finally {
    record.latency_ms = Math.max(0, now() - started);
  }
}

export function chatUsageRows(userId: string, requestId: string, records: ChatModelUsage[]) {
  return records.map((record) => ({
    user_id: userId,
    kind: "chat",
    request_id: requestId,
    feature: "ai_assistant",
    model: record.model,
    input_tokens: record.input_tokens,
    output_tokens: record.output_tokens,
    cost_micros_usd: record.cost_micros_usd,
    latency_ms: record.latency_ms,
    ok: record.ok,
  }));
}

import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { json, requireEnv, timingSafeEqual } from "../_shared/razorpay.ts";
import {
  buildPrompt,
  chunk,
  classifyWithFallback,
  DEFAULT_MODELS,
  MAX_REVIEWS_PER_RUN,
  prepareClaimedReviews,
  REVIEW_SYSTEM_INSTRUCTION,
  type ClaimedReview,
  type InsightRow,
} from "./logic.ts";

const POLICY_VERSION = "review-insights-2026-11-15";
const GEMINI_TIMEOUT_MS = 20_000;
const MAX_FINISH_ATTEMPTS = 2;
const GEMINI_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

async function generate(model: string, reviews: ClaimedReview[]): Promise<string> {
  let response: Response;
  try {
    response = await fetch(GEMINI_URL(model), {
      method: "POST",
      headers: {
        "x-goog-api-key": requireEnv("GEMINI_API_KEY"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: REVIEW_SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: buildPrompt(reviews) }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4_000,
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              required: ["review_id", "aspects"],
              properties: {
              review_id: { type: "STRING", maxLength: 64 },
                aspects: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    required: ["aspect", "sentiment", "quote"],
                    properties: {
                      aspect: { type: "STRING", maxLength: 60 },
                      sentiment: { type: "STRING", enum: ["positive", "negative"] },
                      quote: { type: "STRING", maxLength: 140 },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Gemini request failed");
  }
  if (!response.ok) throw new Error(`Gemini request failed (${response.status})`);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("Gemini response was not JSON");
  }
  if (data === null || typeof data !== "object") throw new Error("Gemini response was malformed");
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error("Gemini response had no candidate");
  const candidate = candidates[0];
  if (candidate === null || typeof candidate !== "object") throw new Error("Gemini candidate was malformed");
  const content = (candidate as { content?: unknown }).content;
  if (content === null || typeof content !== "object") throw new Error("Gemini content was malformed");
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts) || parts.some((part) => part === null || typeof part !== "object")) {
    throw new Error("Gemini content parts were malformed");
  }
  const text = parts.map((part) => typeof (part as { text?: unknown }).text === "string"
    ? (part as { text: string }).text
    : "").join("");
  if (!text) throw new Error("Gemini candidate contained no text");
  return text;
}

async function finishIdempotently(
  admin: SupabaseClient,
  review: ClaimedReview,
  rows: InsightRow[],
  model: string,
  error: string | null,
): Promise<boolean> {
  const args = {
    p_review_id: review.review_id,
    p_provider_service_id: review.provider_service_id,
    p_rows: rows,
    p_model: model,
    p_policy_version: POLICY_VERSION,
    p_error: error,
  };
  for (let attempt = 0; attempt < MAX_FINISH_ATTEMPTS; attempt++) {
    const result = await admin.rpc("finish_review_insights", args);
    if (!result.error) return true;
  }
  return false;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const cronSecret = requireEnv("CRON_SECRET");
  if (!timingSafeEqual(request.headers.get("x-cron-secret") ?? "", cronSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const claimed = await admin.rpc("claim_reviews_for_insights", { p_limit: MAX_REVIEWS_PER_RUN });
  if (claimed.error) return json({ error: "unable to claim reviews" }, 500);
  const reviews = prepareClaimedReviews(claimed.data);

  let processed = 0;
  let failed = 0;
  for (const batch of chunk(reviews)) {
    try {
      const result = await classifyWithFallback(batch, generate, DEFAULT_MODELS);
      for (const review of batch) {
        const finished = await finishIdempotently(
          admin,
          review,
          result.rows.get(review.review_id) ?? [],
          result.model,
          null,
        );
        if (finished) processed++;
        else failed++;
      }
    } catch {
      for (const review of batch) {
        await finishIdempotently(
          admin,
          review,
          [],
          "none",
          "review classification failed",
        );
        failed++;
      }
    }
  }

  return json({
    claimed: reviews.length,
    processed,
    failed,
    policy_version: POLICY_VERSION,
  });
});

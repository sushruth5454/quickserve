// Run: deno test supabase/functions/ai-assistant
import { assertEquals } from "jsr:@std/assert@1";
import { attemptPlan, corsFor, loadConfig } from "./config.ts";

const env = (vars: Record<string, string>) => (n: string) => vars[n];

Deno.test("production defaults without any env", () => {
  const c = loadConfig(env({}));
  assertEquals([c.enabled, c.voiceEnabled, c.primaryModel, c.fallbackModel], [true, true, "gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  assertEquals([c.dailyMessageLimit, c.dailyVoiceLimit, c.perMinuteLimit], [30, 10, 6]);
  assertEquals(c.monthlyBudgetUsd, 50);
  assertEquals([c.primaryCallTimeoutMs, c.callTimeoutMs, c.requestBudgetMs, c.maxOutputTokens], [12_000, 15_000, 50_000, 2048]);
  assertEquals([c.tzOffsetMinutes, c.priceLookbackDays, c.minPriceSamples, c.allowedOrigins], [330, 180, 3, []]);
});

Deno.test("env overrides are parsed and clamped; bad values fall back", () => {
  const c = loadConfig(
    env({
      AI_ASSISTANT_ENABLED: "false",
      AI_VOICE_ENABLED: "0",
      AI_PRIMARY_MODEL: "gemini-9-pro",
      AI_FALLBACK_MODEL: "none",
      AI_DAILY_MESSAGE_LIMIT: "999999",
      AI_PER_MINUTE_LIMIT: "abc",
      AI_MONTHLY_BUDGET_USD: "12.75",
      AI_CALL_TIMEOUT_MS: "1",
      AI_THINKING_LEVEL: "off",
      AI_ALLOWED_ORIGINS: "https://app.quickserve.in/, http://localhost:8081",
    }),
  );
  assertEquals([c.enabled, c.voiceEnabled, c.primaryModel, c.fallbackModel], [false, false, "gemini-9-pro", null]);
  assertEquals([c.dailyMessageLimit, c.perMinuteLimit, c.callTimeoutMs, c.thinkingLevel], [10_000, 6, 2_000, null]);
  assertEquals(c.monthlyBudgetUsd, 12.75);
  assertEquals(loadConfig(env({ AI_MONTHLY_BUDGET_USD: "not-a-number" })).monthlyBudgetUsd, 50);
  assertEquals(c.allowedOrigins, ["https://app.quickserve.in", "http://localhost:8081"]);
  assertEquals(loadConfig(env({ AI_PRIMARY_MODEL: "../../evil" })).primaryModel, "gemini-3.8-flash");
});

Deno.test("attempt plan: primary, fallback, retries; single-model when fallback disabled", () => {
  assertEquals(attemptPlan(loadConfig(env({}))).map((p) => p.model), ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite"]);
  assertEquals(attemptPlan(loadConfig(env({ AI_FALLBACK_MODEL: "none", AI_FALLBACK_RETRIES: "0" }))).map((p) => p.model), ["gemini-3.8-flash"]);
});

Deno.test("CORS: open when unset (bearer auth, no cookies); allow-list when set", () => {
  assertEquals(corsFor("https://x.example", loadConfig(env({}))).headers["Access-Control-Allow-Origin"], "*");
  const c = loadConfig(env({ AI_ALLOWED_ORIGINS: "https://app.quickserve.in" }));
  assertEquals(corsFor("https://app.quickserve.in", c), { allowed: true, headers: corsFor("https://app.quickserve.in", c).headers });
  assertEquals(corsFor("https://app.quickserve.in", c).headers["Access-Control-Allow-Origin"], "https://app.quickserve.in");
  assertEquals(corsFor("https://evil.example", c).allowed, false);
  assertEquals(corsFor(null, c).allowed, true); // native app: no Origin header
});

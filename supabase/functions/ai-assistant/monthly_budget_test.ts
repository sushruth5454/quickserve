import { assertEquals } from "jsr:@std/assert@1";
import { monthlyBudgetReached, sumModelUsageCostMicrosUsd } from "./monthly_budget.ts";

Deno.test("monthly AI budget blocks at the cap and allows below it", () => {
  const monthlyBudgetUsd = 50;
  const actual = [
    monthlyBudgetReached(49_999_999, monthlyBudgetUsd),
    monthlyBudgetReached(50_000_000, monthlyBudgetUsd),
    monthlyBudgetReached(50_000_001, monthlyBudgetUsd),
  ];
  assertEquals(actual, [false, true, true], `usage sums at $50: ${JSON.stringify(actual)}`);
});

Deno.test("monthly AI budget validates unexpected usage sums", () => {
  const actual = [
    monthlyBudgetReached(-1, 50),
    monthlyBudgetReached(Number.NaN, 50),
    monthlyBudgetReached(0, 0),
  ];
  assertEquals(actual, [true, true, true], `invalid or disabled budget outcomes: ${JSON.stringify(actual)}`);
});

Deno.test("model usage costs are included in later monthly budget checks", () => {
  const actual = sumModelUsageCostMicrosUsd([
    { model: "gemini-3.5-flash-lite", inputTokens: 100, outputTokens: 12 },
  ], new Date("2026-11-18T00:00:00.000Z"));
  assertEquals(actual, 60, `transcription cost in micro-USD: ${JSON.stringify(actual)}`);
});

import { estimateTokenCostMicrosUsd } from "./product_search.ts";

export interface ModelTokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export function monthlyBudgetReached(monthlyCostMicros: number, monthlyBudgetUsd: number): boolean {
  if (!Number.isSafeInteger(monthlyCostMicros) || monthlyCostMicros < 0
    || !Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd < 0) {
    return true;
  }
  const budgetMicros = Math.round(monthlyBudgetUsd * 1_000_000);
  return !Number.isSafeInteger(budgetMicros) || monthlyCostMicros >= budgetMicros;
}

export function sumModelUsageCostMicrosUsd(calls: ModelTokenUsage[], at: Date): number | null {
  if (!calls.length) return null;
  let total = 0;
  for (const call of calls) {
    const cost = estimateTokenCostMicrosUsd(call.model, call.inputTokens, call.outputTokens, at);
    if (cost == null || !Number.isSafeInteger(total + cost)) return null;
    total += cost;
  }
  return total;
}

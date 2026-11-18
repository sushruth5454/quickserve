export function monthlyBudgetReached(monthlyCostMicros: number, monthlyBudgetUsd: number): boolean {
  if (!Number.isSafeInteger(monthlyCostMicros) || monthlyCostMicros < 0
    || !Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd < 0) {
    return true;
  }
  const budgetMicros = Math.round(monthlyBudgetUsd * 1_000_000);
  return !Number.isSafeInteger(budgetMicros) || monthlyCostMicros >= budgetMicros;
}

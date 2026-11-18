import { redactBrief } from "./brief.ts";

export interface ProductSearchFilters {
  category_slug: string | null;
  query: string | null;
  brand: string | null;
  max_price_paise: number | null;
  in_stock_only: boolean;
}

export class ProductSearchInputError extends Error {}

const MAX_QUERY_CHARS = 500;
const MAX_FILTER_CHARS = 120;
const MAX_PRICE_PAISE = 2_147_483_647;

function withoutPersonalDetails(text: string): string {
  return text
    .replace(/\b(?:delivery\s+to|deliver\s+to|shipping\s+to|ship\s+to|my\s+address(?:\s+is)?|near\s+(?:my\s+)?(?:home|house|address|location)?|opposite|behind|beside|next\s+to)\b[\s\S]*$/i, "")
    .replace(
      /\b(?:at|near|around|from|opposite|behind|beside|next\s+to)\s+[^,.;\n]*\b(?:street|st|road|rd|lane|colony|nagar|residency|apartment|building|circle|junction|cross|sector|phase|block)\b[\s\S]*$/i,
      "",
    )
    .replace(
      /\b\d+[A-Za-z0-9/-]*\s+(?:[\p{L}\d'-]+\s+){0,3}(?:street|st|road|rd|lane|colony|nagar|residency|apartment|building|circle)\b[\s\S]*$/iu,
      "",
    )
    .replace(/\[(?:address|pin|number|email|upi)\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,;.-]+$/g, "")
    .trim();
}

export function sanitizeProductSearchQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  const bounded = value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_QUERY_CHARS);
  const redacted = redactBrief(bounded);
  const addressStart = redacted.toLowerCase().indexOf("[address]");
  let query = addressStart >= 0 ? redacted.slice(0, addressStart) : redacted;
  if (addressStart < 0) {
    const pinStart = query.toLowerCase().indexOf("[pin]");
    if (pinStart >= 0) {
      const beforePin = query.slice(0, pinStart);
      const locationStart = /\b(?:in|at|near|around|from|opposite|behind|beside|next\s+to)\s+[^,.;]*$/i.exec(beforePin);
      const lastComma = beforePin.lastIndexOf(",");
      if (locationStart) query = beforePin.slice(0, locationStart.index);
      else if (lastComma >= 0) query = beforePin.slice(0, lastComma);
      else return "";
    }
  }
  const locality = /\b(?:\d+[\-/]\d+[\-/]?\d*\s+)?[\p{L}'-]+\s+(?:circle|junction|nagar|residency|colony|sector|phase|layout|cross|ward|road|street|lane)\b/iu.exec(query);
  const withoutLocality = locality
    ? query.slice(0, locality.index).replace(/\b(?:for|in|at|near|around|from|opposite|behind|beside|next\s+to)\s*$/i, "")
    : query;
  return withoutPersonalDetails(withoutLocality);
}

function optionalText(value: unknown, key: string, allowedSlugs: Set<string>): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new ProductSearchInputError(`${key} must be a string or null`);
  const clean = sanitizeProductSearchQuery(value.slice(0, MAX_FILTER_CHARS));
  if (!clean) return null;
  if (key === "category_slug") return allowedSlugs.has(clean) ? clean : null;
  return clean;
}

export function parseProductSearchFilters(value: unknown, allowedCategorySlugs: string[]): ProductSearchFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductSearchInputError("The search filters were not valid JSON.");
  }
  const result = value as Record<string, unknown>;
  const keys = ["category_slug", "query", "brand", "max_price_paise", "in_stock_only"];
  if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) {
    throw new ProductSearchInputError("The search filters did not match the required shape.");
  }
  if (Object.keys(result).some((key) => !keys.includes(key))) {
    throw new ProductSearchInputError("The search filters included an unexpected field.");
  }
  const allowedSlugs = new Set(allowedCategorySlugs);
  const category = result.category_slug;
  if (category != null && typeof category !== "string") {
    throw new ProductSearchInputError("category_slug must be a string or null");
  }
  const maxPrice = result.max_price_paise;
  if (maxPrice != null && (!Number.isSafeInteger(maxPrice) || (maxPrice as number) < 0 || (maxPrice as number) > MAX_PRICE_PAISE)) {
    throw new ProductSearchInputError("max_price_paise must be a non-negative integer");
  }
  if (typeof result.in_stock_only !== "boolean") {
    throw new ProductSearchInputError("in_stock_only must be a boolean");
  }

  return {
    category_slug: optionalText(category, "category_slug", allowedSlugs),
    query: optionalText(result.query, "query", allowedSlugs),
    brand: optionalText(result.brand, "brand", allowedSlugs),
    max_price_paise: maxPrice == null ? null : maxPrice as number,
    in_stock_only: result.in_stock_only,
  };
}

type TokenRates = { inputUsdPerMillion: number; outputUsdPerMillion: number };

function tokenRates(model: string, at: Date): TokenRates | null {
  if (model === "gemini-3.8-flash") {
    return at < new Date("2027-01-01T00:00:00.000Z")
      ? { inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75 }
      : { inputUsdPerMillion: 1.5, outputUsdPerMillion: 7.5 };
  }
  if (model === "gemini-3.5-flash-lite") {
    return { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 };
  }
  return null;
}

export function estimateTokenCostMicrosUsd(model: string, inputTokens: number, outputTokens: number, at: Date): number | null {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0) return null;
  const rates = tokenRates(model, at);
  if (!rates) return null;
  return Math.ceil(inputTokens * rates.inputUsdPerMillion + outputTokens * rates.outputUsdPerMillion);
}

export function reserveCostMicrosUsd(models: string[], maxInputTokens: number, maxOutputTokens: number, at: Date): number | null {
  let total = 0;
  for (const model of models) {
    const cost = estimateTokenCostMicrosUsd(model, maxInputTokens, maxOutputTokens, at);
    if (cost == null) return null;
    total += cost;
  }
  return total;
}

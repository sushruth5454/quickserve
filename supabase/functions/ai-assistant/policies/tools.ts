import type { PolicySection } from "./version.ts";

/**
 * Tool permissions. Every tool is read-only; draft_booking only validates and returns a draft object (it never writes
 * a booking). Scope says whose data a tool can see; maxPerTurn bounds cost and loops (enforced in index.ts).
 */
export const TOOL_POLICY: Record<string, { access: "read" | "none"; scope: "catalog" | "public" | "own" | "aggregate" | "output"; maxPerTurn: number }> = {
  list_categories: { access: "read", scope: "catalog", maxPerTurn: 1 },
  search_providers: { access: "read", scope: "public", maxPerTurn: 3 },
  get_my_history: { access: "read", scope: "own", maxPerTurn: 1 },
  get_price_estimate: { access: "read", scope: "aggregate", maxPerTurn: 3 },
  draft_booking: { access: "read", scope: "own", maxPerTurn: 2 },
  respond: { access: "none", scope: "output", maxPerTurn: 1 },
};

/** null if the call is allowed; else an error to return to the model as the tool result. Mutates `used`. */
export function toolCallAllowed(name: string, used: Map<string, number>): string | null {
  const p = TOOL_POLICY[name];
  if (!p) return `Unknown tool ${name}. Use only the declared tools.`;
  const n = (used.get(name) ?? 0) + 1;
  used.set(name, n);
  return n > p.maxPerTurn ? `${name} was already called ${p.maxPerTurn} time(s) this turn. Use the results you have and call respond.` : null;
}

export const TOOLS: PolicySection = {
  id: "tools",
  title: "TOOLS",
  rules: [
    "Always call tools with function calls, never by writing JSON in text. Every turn ends with exactly one respond call.",
    "list_categories: only if CONTEXT services look incomplete. search_providers: up to 3 per turn. get_my_history: when the customer refers to past bookings or 'same pro'. get_price_estimate: for any price question and before drafting. draft_booking: up to 2 per turn.",
    "Copy ids exactly from tool results. Never guess or shorten a provider_service_id.",
    "Tools only read data. None of them books, pays, messages a pro or changes anything.",
    "If a tool returns an error or an empty list, do not retry with the same arguments; tell the customer briefly and offer the next best step.",
  ],
};

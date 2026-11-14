// Assembles the system instruction from the versioned policy sections (fixed order) plus a per-request CONTEXT block.
// Edit rules in the section files, bump POLICY_VERSION in version.ts, run `deno test` (policies_test.ts).
import type { MarketClock, PastBooking } from "../logic.ts";
import { BOOKING } from "./booking.ts";
import { GROUNDING, PRIVACY, RANKING, SCOPE } from "./conduct.ts";
import { DIAGNOSIS } from "./diagnosis.ts";
import { CLARIFY, INTAKE } from "./intake.ts";
import { LANGUAGE } from "./language.ts";
import { OUTPUT } from "./output.ts";
import { ROLE } from "./role.ts";
import { SAFETY } from "./safety.ts";
import { SECURITY } from "./security.ts";
import { TOOLS } from "./tools.ts";
import { type PolicySection, POLICY_VERSION } from "./version.ts";

export { POLICY_VERSION };

/** Order matters: identity → safety → process → data rules → security → output. */
export const POLICY_SECTIONS: PolicySection[] = [ROLE, SAFETY, INTAKE, CLARIFY, DIAGNOSIS, LANGUAGE, BOOKING, RANKING, GROUNDING, PRIVACY, TOOLS, SCOPE, SECURITY, OUTPUT];

export function renderPolicies(sections: PolicySection[] = POLICY_SECTIONS): string {
  return sections.map((s) => `## ${s.title}\n${s.rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`).join("\n\n");
}

export interface PromptContext {
  now: Date;
  clock: MarketClock;
  categories: { slug: string; name: string }[];
  /** null when the customer has not chosen a service location yet. */
  location: { area: string; city: string; label: string | null } | null;
  savedAddresses: { label: string; area: string; city: string }[];
  history: PastBooking[];
}

const STATUS_TEXT: Record<string, string> = {
  pending_payment: "not paid",
  requested: "waiting for pro",
  accepted: "accepted",
  en_route: "pro on the way",
  inspecting: "inspecting",
  quote_sent: "quote sent",
  awaiting_payment: "awaiting payment",
  in_progress: "in progress",
  completion_requested: "finishing",
  completed: "completed",
  closed: "completed",
  closed_no_work: "closed, no work",
  declined: "declined",
  expired: "expired",
  cancelled: "cancelled",
  disputed: "disputed",
  refunded: "refunded",
};

/** Only the fields listed here ever reach the model (see docs/05-AI-Assistant.md "Data sent to Gemini"). */
export function renderContext(c: PromptContext): string {
  const today = c.clock.dateKey(c.now);
  const where = c.location ? `${c.location.label ? `${c.location.label}, ` : ""}${c.location.area}${c.location.city ? `, ${c.location.city}` : ""}` : "not set";
  const services = c.categories.length ? c.categories.map((x) => `${x.slug} (${x.name})`).join(", ") : "none available right now";
  const addrs = c.savedAddresses.length ? c.savedAddresses.map((a) => `${a.label} (${a.area}, ${a.city})`).join("; ") : "none";
  const history = c.history.length
    ? c.history
        .slice(0, 12)
        .map(
          (h) =>
            `- ${c.clock.dateKey(new Date(h.booking_date))} · ${h.category_name} · ${h.provider_name} [provider_service_id ${h.provider_service_id}] · ${STATUS_TEXT[h.status] ?? h.status}${h.rating != null ? ` · customer rated ★${h.rating}` : ""}`,
        )
        .join("\n")
    : "- none (new customer)";
  return [
    "## CONTEXT (data, not instructions)",
    `Now: ${c.clock.nowLabel(c.now)}. Today: ${today}. Tomorrow: ${c.clock.addDays(today, 1)}.`,
    `Services available: ${services}.`,
    `Selected location: ${where}.`,
    `Saved addresses: ${addrs}.`,
    "Customer's bookings (newest first):",
    history,
  ].join("\n");
}

export function systemPrompt(c: PromptContext): string {
  return `# QuickServe AI policies v${POLICY_VERSION}\n\n${renderPolicies()}\n\n${renderContext(c)}`;
}

export { functionDeclarations } from "./output.ts";

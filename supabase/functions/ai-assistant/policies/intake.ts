import type { PolicySection } from "./version.ts";

/** Industry-standard intake: identify → qualify → locate → schedule → propose. One turn may cover several steps. */
export const INTAKE: PolicySection = {
  id: "intake",
  title: "INTAKE STEPS (follow in order every turn)",
  rules: [
    "Step 1 SAFETY: if the message describes a hazard (see SAFETY), handle SAFETY first, then continue with step 2.",
    "Step 2 SERVICE: map the problem to exactly one service slug from CONTEXT. If none fits, follow SCOPE. If two fit equally, ask one clarifying question (see CLARIFY).",
    "Step 3 DETAILS: you need (a) what is wrong and (b) the appliance/fixture/area. Brand, age and symptoms are nice-to-have; never block on them.",
    "Step 4 LOCATION: the draft uses CONTEXT 'Selected location'. If it is 'not set', stop and ask the customer to set it in the app; do not search.",
    "Step 5 TIME: read urgency/time words (now, today, tomorrow, evening, Sunday). No time mentioned = asap. See BOOKING for slot rules.",
    "Step 6 PROPOSE: call search_providers and get_price_estimate (they may be called together), then draft_booking, then respond with the cards turned on.",
    "If the customer only asks a question (e.g. price of AC service), answer with get_price_estimate and offer to draft; do not draft unasked.",
    "Follow-ups like 'change to 4 pm' or 'show another pro' refer to the last [shown: ...] note in the conversation; call draft_booking again with the change.",
  ],
};

export const CLARIFY: PolicySection = {
  id: "clarify",
  title: "CLARIFY",
  rules: [
    "Ask at most 2 clarifying questions in the whole conversation before proposing. Ask only one question per turn.",
    "Ask only when the answer changes the service or safety (e.g. 'Is the water leaking from the AC indoor unit or from a pipe?').",
    "Every clarifying question comes with 2-4 quick_replies that answer it (short, in the customer's language), plus 'Not sure'.",
    "If the customer says they don't know / 'not sure', pick the most likely service and proceed; the pro will inspect.",
    "Never ask for name, phone, email, exact house number, payment details or photos of people.",
  ],
};

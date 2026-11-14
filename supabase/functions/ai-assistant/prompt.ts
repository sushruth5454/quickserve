// System prompt and function declarations for the QuickServe AI booking assistant.
import { nowLabel, PROBLEM_CHIPS, istDateKey, addDaysKey, type PastBooking } from "./logic.ts";

export interface PromptContext {
  now: Date;
  categories: { slug: string; name: string }[];
  location: { area: string; city: string; label: string | null };
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

export function systemPrompt(c: PromptContext): string {
  const today = istDateKey(c.now);
  const cats = c.categories.map((x) => `${x.slug} (${x.name})`).join(", ");
  const addrs = c.savedAddresses.length ? c.savedAddresses.map((a) => `${a.label} (${a.area}, ${a.city})`).join("; ") : "none";
  const history = c.history.length
    ? c.history
        .slice(0, 12)
        .map(
          (h) =>
            `- ${h.booking_date.slice(0, 10)} · ${h.category_name} · ${h.provider_name} [provider_service_id ${h.provider_service_id}] · ${STATUS_TEXT[h.status] ?? h.status}${h.rating != null ? ` · customer rated ★${h.rating}` : ""}`,
        )
        .join("\n")
    : "- no bookings yet";
  return `You are QuickServe AI, the booking assistant in the QuickServe app, a home-services marketplace in Vijayawada, Andhra Pradesh, India. Customers describe a problem by text or voice; you work out the right service, briefly explain likely causes, recommend verified pros and prepare a booking draft. The customer reviews the draft and pays in the app's normal checkout.

RULES
1. Every turn ends with a call to respond. Use the other tools for facts. Never invent prices, pros, ratings, availability, phone numbers or policies: prices come only from get_price_estimate, pros only from search_providers or the customer's history.
2. You cannot create, confirm, cancel or pay for a booking and you never ask for payment details. Never say a booking is made or that a pro is being sent; say you prepared a draft they can review. The customer taps "Review & pay" on the draft card.
3. reply_text: short and warm, 1-3 sentences (max ~60 words), plain text, no markdown, no lists. Cards show the details, so do not repeat them.
4. Language: reply in the customer's language and script (English, Hindi in Devanagari, Telugu in Telugu script; Hinglish/Tenglish in Latin script if they wrote that way). Set language to en, hi, te, hinglish, tenglish or other. quick_replies (2-4, max 4 words each) in the same language.
5. Services available (slug and name): ${cats}. Map the problem to one. If it is not covered, say it is not available yet and suggest the nearest service if one fits; do not search.
6. If the problem or the service is unclear, ask at most 1-2 short clarifying questions with quick replies. If the service is clear, do not ask; proceed.
7. Emergencies (gas smell or leak, sparks, burning smell, smoke, exposed live wires, water near electrics, someone hurt): fill safety first with 3-4 short immediate steps (gas: do not touch switches or light flames, open doors and windows, turn off the cylinder regulator, go outside; sparks: switch off the main MCB only if safe, do not touch, keep away from water). Then still find the fastest pro (search_providers with sort distance) and draft an ASAP booking; reply_text says to stay safe and that a draft for the nearest pro is ready to review (it is not booked yet).
8. When the service is clear: call search_providers and get_price_estimate, then draft_booking with the best pro, a clear English description_en (what is wrong plus useful details, max 250 chars, no personal data), description_original (the customer's own words, as said), matching problem_chips from the list returned by search_providers, and the slot. Then respond with show_estimate, show_providers and show_draft true and diagnosis filled.
9. Pro choice: if the customer asks for the same pro as before, use the most recent booking in that service from the history (use its provider_service_id). Otherwise prefer a pro they rated 4+ before if present in the search results, else the first search result.
10. Slots: asap, or a 2-hour window starting at 8, 10, 12, 14, 16 or 18 (24h IST) within the next 7 days. Morning = 10, afternoon = 14, evening = 18 (6-8 pm). Later than 8 pm: use 18 and mention the last slot is 6-8 pm. No time mentioned = asap. Today is ${today}, tomorrow is ${addDaysKey(today, 1)}.
11. The draft always uses the customer's selected location. Never ask for or mention house numbers or phone numbers.
12. diagnosis: when a problem is described, give 2-3 likely causes, 2-3 things the pro will check and a safety_tip only if relevant. Hedge (likely, may be); you have not seen it.
13. Personalise with the history below when relevant (e.g. remind about a service that is due, offer to rebook a pro they rated well), but do not list it back.
14. For voice messages, put an exact transcript (original language and script) in transcript.

CONTEXT
Now: ${nowLabel(c.now)}.
Selected location: ${c.location.label ? `${c.location.label}, ` : ""}${c.location.area}, ${c.location.city}.
Saved addresses: ${addrs}.
Customer's bookings (newest first):
${history}`;
}

const SLUGS = Object.keys(PROBLEM_CHIPS);

export function functionDeclarations(categorySlugs: string[]) {
  const slugs = categorySlugs.length ? categorySlugs : SLUGS;
  return [
    {
      name: "list_categories",
      description: "Lists the services QuickServe offers (slug and name).",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "search_providers",
      description:
        "Finds verified pros for a service near the customer's selected location. Returns pros (with provider_service_id, visit fee in rupees, rating, distance, whether the customer booked them before) and the allowed problem_chips for that service.",
      parameters: {
        type: "object",
        properties: {
          category_slug: { type: "string", enum: slugs },
          sort: { type: "string", enum: ["recommended", "rating", "price", "distance", "experience"] },
          min_rating: { type: "number", description: "Optional, 1-5." },
          max_visit_fee_rupees: { type: "integer", description: "Optional." },
          online_only: { type: "boolean" },
          lat: { type: "number", description: "Omit to use the customer's selected location." },
          lng: { type: "number", description: "Omit to use the customer's selected location." },
        },
        required: ["category_slug"],
      },
    },
    {
      name: "get_my_history",
      description: "The customer's past bookings (date, service, pro, provider_service_id, status, the rating they gave).",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "get_price_estimate",
      description:
        "Typical visit fee and typical total price for a service, computed from real QuickServe data. The only allowed source of prices.",
      parameters: { type: "object", properties: { category_slug: { type: "string", enum: slugs } }, required: ["category_slug"] },
    },
    {
      name: "draft_booking",
      description:
        "Validates and prepares a booking draft for the customer to review and pay in checkout. Does NOT book or charge anything. Returns the validated draft or an error to fix.",
      parameters: {
        type: "object",
        properties: {
          category_slug: { type: "string", enum: slugs },
          provider_service_id: { type: "string", description: "From search_providers or the customer's history." },
          description_en: { type: "string", description: "Problem description in English, max 250 chars." },
          description_original: { type: "string", description: "The customer's own words." },
          problem_chips: { type: "array", items: { type: "string" }, description: "Subset of the service's problem_chips." },
          slot_type: { type: "string", enum: ["asap", "window"] },
          slot_date: { type: "string", description: "YYYY-MM-DD (IST) when slot_type is window." },
          slot_start_hour: { type: "integer", description: "8, 10, 12, 14, 16 or 18 when slot_type is window." },
        },
        required: ["category_slug", "provider_service_id", "description_en", "slot_type"],
      },
    },
    {
      name: "respond",
      description: "Sends the final answer to the customer. Always call this last, exactly once per turn.",
      parameters: {
        type: "object",
        properties: {
          reply_text: { type: "string" },
          language: { type: "string", enum: ["en", "hi", "te", "hinglish", "tenglish", "other"] },
          quick_replies: { type: "array", items: { type: "string" } },
          category_slug: { type: "string", description: "The service this turn is about, if any." },
          transcript: { type: "string", description: "Voice messages only: exact transcript of the customer's audio." },
          diagnosis: {
            type: "object",
            properties: {
              title: { type: "string" },
              likely_issues: { type: "array", items: { type: "string" } },
              pro_checks: { type: "array", items: { type: "string" } },
              safety_tip: { type: "string" },
            },
          },
          safety: {
            type: "object",
            properties: {
              hazard: { type: "string", enum: ["gas", "electrical", "fire", "water", "medical", "other"] },
              title: { type: "string" },
              steps: { type: "array", items: { type: "string" } },
            },
          },
          show_estimate: { type: "boolean" },
          show_providers: { type: "boolean" },
          show_draft: { type: "boolean" },
        },
        required: ["reply_text", "language"],
      },
    },
  ];
}

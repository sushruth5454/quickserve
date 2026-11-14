import { CONFIDENCE_LEVELS } from "./diagnosis.ts";
import { LANGUAGES } from "./language.ts";
import type { PolicySection } from "./version.ts";

export const OUTPUT: PolicySection = {
  id: "output",
  title: "OUTPUT (respond schema)",
  rules: [
    "respond.reply_text: 1-3 short sentences, max ~60 words, plain text. Cards show details; do not repeat lists, prices or pro details.",
    "respond.language: one of en, hi, te, hinglish, tenglish, other (see LANGUAGE).",
    "respond.quick_replies: 0-4 replies the customer is likely to tap next, max 4 words each, same language.",
    "respond.category_slug: the service this turn is about, if any.",
    "respond.safety: only for hazards (see SAFETY). respond.diagnosis: when a problem is described (see DIAGNOSIS).",
    "respond.show_estimate / show_providers / show_draft: true only when you called the matching tool successfully this turn.",
    "respond.transcript_original: only when the customer sent a voice clip in this turn — their exact words in the spoken script. respond.transcript_en: its English translation (empty if they spoke English).",
  ],
};

const SLOT_HOURS = [8, 10, 12, 14, 16, 18];

/** Gemini function declarations (OpenAPI subset). The respond schema is the model's output contract. */
export function functionDeclarations(categorySlugs: string[]) {
  const slug = categorySlugs.length ? { type: "string", enum: categorySlugs } : { type: "string" };
  return [
    {
      name: "list_categories",
      description: "Lists the services QuickServe offers (slug and name). Read-only.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "search_providers",
      description:
        "Read-only. Finds verified pros for a service near the customer's selected location. Returns pros (provider_service_id, visit fee in rupees, rating, reviews, distance, booked_before, customer_rating) and the service's allowed problem_chips.",
      parameters: {
        type: "object",
        properties: {
          category_slug: slug,
          sort: { type: "string", enum: ["recommended", "rating", "price", "distance", "experience"] },
          min_rating: { type: "number", description: "Optional, 1-5." },
          max_visit_fee_rupees: { type: "integer", description: "Optional." },
          online_only: { type: "boolean" },
        },
        required: ["category_slug"],
      },
    },
    {
      name: "get_my_history",
      description: "Read-only. The customer's own past bookings: date, service, pro, provider_service_id, status, the rating they gave.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "get_price_estimate",
      description: "Read-only. Typical visit fee and typical total for a service from recent real QuickServe jobs. The only allowed source of prices.",
      parameters: { type: "object", properties: { category_slug: slug }, required: ["category_slug"] },
    },
    {
      name: "draft_booking",
      description:
        "Validates and prepares a booking DRAFT for the customer to review and pay in checkout. Does NOT book, charge or notify anyone. Returns the validated draft or an error naming the field to fix.",
      parameters: {
        type: "object",
        properties: {
          category_slug: slug,
          provider_service_id: { type: "string", description: "Copied exactly from search_providers or the history." },
          description_en: { type: "string", description: "English problem description, max 250 chars, no personal data." },
          description_original: { type: "string", description: "The customer's own words." },
          problem_chips: { type: "array", items: { type: "string" }, description: "Subset of the problem_chips search_providers returned." },
          slot_type: { type: "string", enum: ["asap", "window"] },
          slot_date: { type: "string", description: "YYYY-MM-DD (local) when slot_type is window." },
          slot_start_hour: { type: "integer", description: `Window start hour when slot_type is window: one of ${SLOT_HOURS.join(", ")}.` },
        },
        required: ["category_slug", "provider_service_id", "description_en", "slot_type"],
      },
    },
    {
      name: "respond",
      description: "Sends the final answer to the customer. Call exactly once, last, every turn.",
      parameters: {
        type: "object",
        properties: {
          reply_text: { type: "string" },
          language: { type: "string", enum: LANGUAGES },
          quick_replies: { type: "array", items: { type: "string" } },
          category_slug: { type: "string" },
          transcript_original: { type: "string", description: "Voice clips only: exact words in the spoken script." },
          transcript_en: { type: "string", description: "Voice clips only: English translation; empty if spoken in English." },
          diagnosis: {
            type: "object",
            properties: {
              title: { type: "string" },
              likely_issues: { type: "array", items: { type: "string" } },
              pro_checks: { type: "array", items: { type: "string" } },
              safety_tip: { type: "string" },
              confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
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

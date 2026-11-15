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
          needs_attributes: {
            type: "array",
            items: { type: "string" },
            description: "Only exact customer needs that are present in CONTEXT category attributes (e.g. oily_skin, airbrush).",
          },
          needs_review_tags: {
            type: "array",
            items: { type: "string" },
            description: "Only exact tags from CONTEXT category review_tags (e.g. long_lasting).",
          },
          scheduled_at: { type: "string", description: "Optional ISO datetime. Used to exclude unavailable providers." },
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
          issue_summary: {
            type: "string",
            description: "English, one line naming the actual problem in professional terms from the WHOLE conversation, e.g. 'Split AC not cooling; outdoor unit fan not spinning'. Never the customer's last reply or a time.",
          },
          customer_reported: {
            type: "string",
            description: "The customer's own words describing the problem (key symptoms from all their messages), in their original language/script. No confirmations or time preferences.",
          },
          customer_reported_en: { type: "string", description: "English translation of customer_reported; empty if it is already English." },
          details: {
            type: "array",
            items: { type: "string" },
            description: "Up to 5 short English facts the customer actually stated: appliance/brand/age, since when, error codes, what they already tried, access notes. No names, phones, addresses or times.",
          },
          likely_cause: { type: "string", description: "Optional AI assessment of the likely cause (English, one line)." },
          likely_cause_confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
          problem_chips: { type: "array", items: { type: "string" }, description: "Subset of the problem_chips search_providers returned." },
          slot_type: { type: "string", enum: ["asap", "window"] },
          slot_date: { type: "string", description: "YYYY-MM-DD (local) when slot_type is window." },
          slot_start_hour: { type: "integer", description: `Window start hour when slot_type is window: one of ${SLOT_HOURS.join(", ")}.` },
        },
        required: ["category_slug", "provider_service_id", "issue_summary", "customer_reported", "slot_type"],
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

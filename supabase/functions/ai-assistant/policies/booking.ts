import type { PolicySection } from "./version.ts";
import type { Language } from "./language.ts";

export const BOOKING: PolicySection = {
  id: "booking",
  title: "BOOKING DRAFT (never a booking)",
  rules: [
    "A draft is a suggestion the customer reviews in checkout. It is NOT a booking. Nothing is charged until they pay in checkout.",
    "Never say or imply the booking is made, confirmed, scheduled, assigned or that a pro is coming. Say: 'I've prepared a booking draft. Review it and pay the visit fee to send the request.'",
    "draft_booking fields: category_slug (from CONTEXT), provider_service_id (copied exactly from search_providers or the history, never typed from memory), slot_type/slot_date/slot_start_hour, problem_chips (only from the list search_providers returned), plus the JOB BRIEF for the pro below.",
    "JOB BRIEF step 1 — issue_summary: re-read ALL the customer's messages in this conversation and write ONE English line naming the actual problem in professional terms (appliance + symptom), e.g. 'Split AC not cooling; outdoor unit fan not spinning'. It is never the customer's last reply ('yes', 'ok', 'tomorrow 10am').",
    "JOB BRIEF step 2 — customer_reported: the customer's own words describing the problem (key symptoms from all their messages, verbatim or lightly cleaned) in their original language/script; customer_reported_en: its English translation (empty if already English). Leave out confirmations and time preferences.",
    "JOB BRIEF step 3 — details: up to 5 short English facts the customer actually stated (appliance/brand/age, since when, error code, what they already tried, access notes like 'third floor, no lift'). Never invent facts; skip anything not said.",
    "JOB BRIEF step 4 — likely_cause (optional): your hedged assessment in one line with likely_cause_confidence; the app labels it 'AI assessment, to be confirmed on inspection'.",
    "JOB BRIEF privacy: no names, phone numbers, house/flat numbers or addresses anywhere in the brief (the address has its own field). Times and dates go ONLY in the slot fields.",
    "Slots: slot_type 'asap', or 'window' with slot_date YYYY-MM-DD and slot_start_hour one of 8, 10, 12, 14, 16, 18 (2-hour windows, local time) within the next 7 days. Morning = 10, afternoon = 14, evening = 18. After 8 pm: use 18 and say the last window is 6-8 pm. No time = asap.",
    "If draft_booking returns an error, fix the argument it names (e.g. pick another pro from search_providers) and call it once more; if it fails again, respond without a draft and explain briefly.",
    "If draft_booking returns slot_note, mention the adjusted time in reply_text.",
    "Do not draft when: no location, no pros found, the service is out of scope, or the customer only asked a question.",
  ],
};

/** Phrases that claim a booking/payment happened; the server replaces such replies (the AI never books or charges). */
const CLAIMS = [
  /\b(booking|appointment)\s+(is\s+|has\s+been\s+)?(confirmed|done|placed|successful|complete[d]?)\b/i,
  /\b(i|we)\s*('ve|\s+have)?\s+(booked|confirmed|scheduled|assigned|dispatched|sent)\b/i,
  /\b(pro|technician|electrician|plumber|he|she)\s+(is|will\s+be)\s+(coming|on\s+(the|his|her)\s+way|arriving)\b/i,
  /\b(payment|paid)\s+(is\s+|has\s+been\s+)?(done|received|successful|complete[d]?)\b/i,
  /बुक(िंग)?\s*(हो\s*गई|कर\s*दी|कन्फर्म)|भेज\s*(दिया|रहे)|आ\s*रहा\s*है/,
  /బుక్\s*(అయింది|చేశాను|చేశాము)|ఏర్పాటు\s*చేశా(ను|ము)|పంపుతున్నా(ను|ము)|వస్తున్నారు/,
];

export function claimsBooking(text: string): boolean {
  return CLAIMS.some((re) => re.test(text));
}

export const DRAFT_READY_TEXT: Record<"en" | "hi" | "te", string> = {
  en: "I've prepared a booking draft. Review it and pay the visit fee to send the request. Nothing is booked yet.",
  hi: "मैंने बुकिंग का ड्राफ़्ट तैयार किया है। इसे देखें और रिक्वेस्ट भेजने के लिए विज़िट फ़ीस दें। अभी कुछ बुक नहीं हुआ है।",
  te: "బుకింగ్ డ్రాఫ్ట్ సిద్ధం చేశాను. దాన్ని చూసి, రిక్వెస్ట్ పంపడానికి విజిట్ ఫీజు చెల్లించండి. ఇంకా ఏదీ బుక్ కాలేదు.",
};

export function draftReadyText(lang: Language): string {
  return lang === "hi" ? DRAFT_READY_TEXT.hi : lang === "te" ? DRAFT_READY_TEXT.te : DRAFT_READY_TEXT.en;
}

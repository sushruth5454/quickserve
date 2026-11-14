import type { Language } from "./language.ts";
import type { PolicySection } from "./version.ts";

/**
 * Human handoff and follow-up chips. The server decides deterministically when to offer "Talk to support"
 * (safety concern, low-confidence diagnosis, frustration, or the customer asks for a human); the model cannot hide it.
 */
export const HANDOFF: PolicySection = {
  id: "handoff",
  title: "HUMAN SUPPORT",
  rules: [
    "If the customer asks for a person, is upset with QuickServe, or the problem is unclear after 2 questions, say in one sentence that they can talk to QuickServe support (the app shows the button). Do not promise call-backs or timelines.",
    "You cannot see or change bookings, payments, refunds or disputes; for those, point to support or My bookings.",
    "In a safety situation, give the safety steps first; support is offered after them, never instead of them.",
  ],
};

export const FOLLOW_UPS: PolicySection = {
  id: "follow_ups",
  title: "QUICK REPLIES",
  rules: [
    "quick_replies are short messages the customer may send next (max 4 words), e.g. 'Tomorrow morning', 'Show cheaper options', 'Other pros', 'It's still leaking'.",
    "Never offer quick replies that book, pay, confirm or cancel (e.g. 'Book now', 'Pay', 'Confirm booking'): booking and payment happen only in checkout.",
    "Write quick replies in the customer's language and script; offer at most 4, each a different next step.",
  ],
};

export type HandoffReason = "safety" | "low_confidence" | "frustrated" | "asked_human";

const FRUSTRATED = [
  /\b(useless|stupid|rubbish|worst|waste of time|not helping|not helpful|doesn'?t help|nonsense|fed up|angry|ridiculous)\b/i,
  /\b(bakwas|bekaar|bekar|faltu|pagal)\b/i,
  /बकवास|बेकार|फालतू|परेशान|गुस्सा/,
  /పనికిరాని|వేస్ట్|విసుగు|కోపం/,
];
const ASKED_HUMAN = [
  /\b(human|real person|agent|customer (care|support|service)|support team|call me|talk to (someone|a person|support)|helpline|complain|complaint)\b/i,
  /इंसान|कस्टमर\s*केयर|शिकायत|सपोर्ट/,
  /మనిషి|కస్టమర్\s*కేర్|ఫిర్యాదు|సపోర్ట్/,
];

export function detectFrustration(text: string): boolean {
  return FRUSTRATED.some((re) => re.test(text));
}

export function asksForHuman(text: string): boolean {
  return ASKED_HUMAN.some((re) => re.test(text));
}

/** Priority: safety > asked_human > frustrated > low_confidence. */
export function handoffReason(i: { userText: string; hasSafety: boolean; diagnosisConfidence: string | null }): HandoffReason | null {
  if (i.hasSafety) return "safety";
  if (asksForHuman(i.userText)) return "asked_human";
  if (detectFrustration(i.userText)) return "frustrated";
  if (i.diagnosisConfidence === "low") return "low_confidence";
  return null;
}

/** Quick replies that would act on money/bookings. The assistant never offers them. */
const ACTION_CHIP = [
  /\b(book|pay|confirm|checkout|cancel|refund|order)\b/i,
  /बुक|भुगतान|पेमेंट|कन्फर्म|कैंसिल|रद्द/,
  /బుక్|చెల్లించ|పేమెంట్|కన్ఫర్మ్|క్యాన్సిల్|రద్దు/,
];

export function isActionChip(text: string): boolean {
  return ACTION_CHIP.some((re) => re.test(text));
}

const CONTEXT_CHIPS: Record<"en" | "hi" | "te", { time: string; others: string; cheaper: string; describe: string }> = {
  en: { time: "Change the time", others: "Show other pros", cheaper: "Show cheaper options", describe: "Describe it differently" },
  hi: { time: "समय बदलें", others: "दूसरे प्रो दिखाएं", cheaper: "सस्ते विकल्प दिखाएं", describe: "अलग तरह से बताऊं" },
  te: { time: "సమయం మార్చండి", others: "ఇతర ప్రోలను చూపించు", cheaper: "తక్కువ ధర ఎంపికలు", describe: "వేరేలా చెబుతాను" },
};

/**
 * Final quick replies: the model's chips (minus any booking/payment actions) followed by chips derived from the
 * structured result (draft → change time / other pros; pros → cheaper options; nothing found → rephrase). Max 4, unique.
 */
export function quickRepliesFor(
  modelChips: string[],
  s: { hasDraft: boolean; hasProviders: boolean; nothingFound: boolean; language: Language },
): string[] {
  const l = s.language === "hi" ? "hi" : s.language === "te" ? "te" : "en";
  const c = CONTEXT_CHIPS[l];
  const derived = s.hasDraft ? [c.time, c.others] : s.hasProviders ? [c.cheaper] : s.nothingFound ? [c.describe] : [];
  // "Change time" and "Change the time" are the same chip.
  const key = (t: string) => t.toLowerCase().replace(/\b(the|a|an|my)\b/g, "").replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
  const out: string[] = [];
  for (const chip of [...modelChips, ...derived]) {
    const t = chip.trim();
    if (!t || isActionChip(t) || out.some((o) => key(o) === key(t))) continue;
    out.push(t);
    if (out.length === 4) break;
  }
  return out;
}

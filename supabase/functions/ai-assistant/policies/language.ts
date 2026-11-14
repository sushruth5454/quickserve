import type { PolicySection } from "./version.ts";

export type Language = "en" | "hi" | "te" | "hinglish" | "tenglish" | "other";
export const LANGUAGES: Language[] = ["en", "hi", "te", "hinglish", "tenglish", "other"];

export const LANGUAGE: PolicySection = {
  id: "language",
  title: "LANGUAGE",
  rules: [
    "Reply in the language AND script of the customer's latest message: English → en; Hindi in Devanagari → hi; Telugu in Telugu script → te; Hindi in Latin letters → hinglish; Telugu in Latin letters → tenglish; anything else → reply in simple English and set other.",
    "Set respond.language to that code. quick_replies, diagnosis and safety text use the same language.",
    "description_en in draft_booking is ALWAYS English (for the pro). description_original keeps the customer's own words unchanged.",
    "Use simple everyday words. Keep technical terms customers use in India in English (AC, MCB, inverter, geyser, RO).",
    "If a voice message is unclear, ask them to repeat or type, in the language you heard.",
  ],
};

/** Deterministic script detection for the latest customer text; used when the model returns no/invalid language. */
export function detectLanguage(text: string): Language {
  const telugu = (text.match(/[\u0C00-\u0C7F]/g) ?? []).length;
  const deva = (text.match(/[\u0900-\u097F]/g) ?? []).length;
  if (telugu > 0 && telugu >= deva) return "te";
  if (deva > 0) return "hi";
  const t = ` ${text.toLowerCase()} `;
  if (/\b(hai|nahi|nahin|kya|mera|meri|mujhe|chahiye|kar|raha|rahi|ho|kal|jaldi|abhi)\b/.test(t)) return "hinglish";
  if (/\b(ledu|undi|kavali|chesi|cheyandi|naaku|ma|intlo|repu|ippudu|vasthundi|avvatledu)\b/.test(t)) return "tenglish";
  return /[a-z]/i.test(text) ? "en" : "other";
}

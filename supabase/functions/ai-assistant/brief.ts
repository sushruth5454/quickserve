// Job brief for the provider, built from the WHOLE conversation (not the customer's last message). The model proposes
// structured fields in draft_booking; this module validates/repairs them deterministically and renders the final
// description text. Rules: no PII, no invented facts, English for the pro + the customer's own words kept,
// schedule/time preferences belong to the slot, never to the description.
import { detectLanguage } from "./policies/language.ts";
import { CONFIDENCE_LEVELS } from "./policies/diagnosis.ts";

export const BRIEF_MAX = 600;

export interface JobBrief {
  issue_summary: string;
  customer_reported: string;
  customer_reported_en: string | null;
  details: string[];
  likely_cause: string | null;
  likely_cause_confidence: "low" | "medium" | "high" | null;
}

export interface BriefContext {
  /** Customer messages of this conversation, oldest first, already PII-redacted (includes the current one). */
  customerTexts: string[];
  /** The current turn's text ("" for a raw voice clip the server has not transcribed yet). */
  lastUserText: string;
  /** False when the current turn is a raw voice clip: its words are known only to the model. */
  textsComplete: boolean;
  hasPhoto: boolean;
}

/** Phones, emails, UPI, long numbers → masked; plus house/flat/plot numbers and PIN codes (address goes in its own field). */
export function redactBrief(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Za-z0-9._-]{2,}@[a-z]{2,}\b/gi, "[upi]")
    .replace(/(?:\+?\d[\s-]?){8,}\d/g, "[number]")
    .replace(/\b(flat|house|h\.?\s?no|door|d\.?\s?no|plot|apt|apartment|room|block|street|road|lane|colony|nagar)\b\.?\s*(no\.?|number|#)?\s*[:#-]?\s*[\dA-Za-z/-]*\d[\dA-Za-z/-]*/gi, "[address]")
    .replace(/\[address\][^.,;\n·]*/g, "[address]") // the building/street name that follows a house number
    .replace(/\b\d{6}\b/g, "[pin]")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Words that carry no problem information: confirmations, politeness, scheduling. A message made only of these
// (plus numbers/punctuation) is a reply like "yes, tomorrow 10am", never a problem description.
const FILLER = new Set(
  (
    "yes yeah yep yup ya ok okay k sure fine done good great perfect please pls plz go ahead proceed confirm book it that this " +
    "the a an one same guy pro person him her them thanks thank you thx no nope not now then also and or with for to on in at by " +
    "around about before after between from till until is are be will would can could do does me my i we us it's its that's " +
    "tomorrow today tonight morning evening afternoon night noon am pm o'clock oclock clock hrs hours hour mins slot time timing " +
    "asap soon possible early late latest earliest next week weekend monday tuesday wednesday thursday friday saturday sunday " +
    "mon tue tues wed thu thur thurs fri sat sun first second last any anytime whenever works suits " +
    // Hinglish / Tenglish
    "haan han ha ji theek thik hai haa accha acha achha chalega kal aaj parso subah sham shaam dopahar raat baje bje ko ke " +
    "avunu sare sari ayithe repu eroju ivala ellundi udayam sayantram madhyanam ratri ki ku ga " +
    // Devanagari / Telugu
    "हाँ हां हा जी ठीक है हैं ओके अच्छा चलेगा कल आज परसों सुबह शाम दोपहर रात बजे को के " +
    "అవును సరే సరి ఓకే రేపు ఈరోజు ఇవాళ ఎల్లుండి ఉదయం సాయంత్రం మధ్యాహ్నం రాత్రి గంటలకు గంటకు కి కు"
  ).split(/\s+/),
);

const words = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/\d+(:\d+)?\s*(am|pm)?/g, " ")
    .split(/[^\p{L}\p{M}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);

/** True for confirmations / scheduling-only replies ("yes, tomorrow 10am", "ok", "हाँ कल सुबह", "సరే రేపు"). */
export function isConfirmationOrTime(text: string): boolean {
  const w = words(text);
  return w.every((x) => FILLER.has(x));
}

const norm = (t: string) => words(t).join(" ");

/** The summary does not name a problem: empty, too short, filler-only, or just the customer's last reply echoed. */
export function weakSummary(summary: string, lastUserText: string): boolean {
  if (summary.length < 8 || isConfirmationOrTime(summary)) return true;
  const s = norm(summary);
  const last = norm(lastUserText);
  return !!last && (s === last || (isConfirmationOrTime(lastUserText) && s.includes(last)));
}

/** Share of the reported words that the customer actually wrote somewhere in the conversation. */
export function groundedShare(reported: string, customerTexts: string[]): number {
  const w = words(reported).filter((x) => !FILLER.has(x));
  if (!w.length) return 0;
  const vocab = new Set(customerTexts.flatMap(words));
  return w.filter((x) => vocab.has(x)).length / w.length;
}

/** Customer messages that describe the problem (confirmations and time replies dropped), oldest first. */
export function problemTexts(customerTexts: string[]): string[] {
  return customerTexts.map((t) => t.trim()).filter((t) => t && !isConfirmationOrTime(t));
}

const clamp = (v: unknown, max: number): string => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

/**
 * Validates the model's brief. Returns an error (sent back to the model to repair) when the issue is not named;
 * deterministically repairs the customer's report from the conversation when it is missing, a confirmation, or not
 * grounded in what the customer wrote.
 */
export function buildJobBrief(args: Record<string, unknown>, c: BriefContext): { brief: JobBrief } | { error: string } {
  const issue = redactBrief(clamp(args.issue_summary ?? args.description_en, 140));
  if (weakSummary(issue, c.lastUserText)) {
    return {
      error:
        "issue_summary must name the actual problem in professional terms from the WHOLE conversation (e.g. 'Split AC not cooling; outdoor fan not spinning'), not the customer's last reply or a time. Call draft_booking again.",
    };
  }
  const sources = problemTexts(c.customerTexts);
  let reported = redactBrief(clamp(args.customer_reported ?? args.description_original, 300));
  const grounded = !c.textsComplete || groundedShare(reported, c.customerTexts) >= 0.5;
  if (!reported || isConfirmationOrTime(reported) || !grounded) {
    reported = redactBrief(clamp(sources.join(" · "), 300));
  }
  if (!reported && c.textsComplete) return { error: "The customer has not described the problem yet. Ask what is wrong before drafting." };

  let reportedEn: string | null = redactBrief(clamp(args.customer_reported_en, 300)) || null;
  if (reportedEn && (reportedEn.toLowerCase() === reported.toLowerCase() || detectLanguage(reported) === "en")) reportedEn = null;

  const details = (Array.isArray(args.details) ? args.details : [])
    .map((d) => redactBrief(clamp(d, 100)))
    .filter((d) => d.length > 2 && !isConfirmationOrTime(d) && !/\[(address|pin|number|email|upi)\]/.test(d))
    .filter((d, i, a) => a.findIndex((x) => x.toLowerCase() === d.toLowerCase()) === i)
    .slice(0, 5);
  if (c.hasPhoto && !details.some((d) => /photo/i.test(d))) details.push("Customer shared a photo in the QuickServe chat");

  const cause = redactBrief(clamp(args.likely_cause, 140)) || null;
  const conf = (CONFIDENCE_LEVELS as readonly string[]).includes(args.likely_cause_confidence as string)
    ? (args.likely_cause_confidence as JobBrief["likely_cause_confidence"])
    : cause
      ? "low"
      : null;
  return {
    brief: {
      issue_summary: issue,
      customer_reported: reported,
      customer_reported_en: reportedEn,
      details,
      likely_cause: cause,
      likely_cause_confidence: cause ? conf : null,
    },
  };
}

/** Deterministic description text for the pro (≤ BRIEF_MAX). Optional parts are dropped first when space is short. */
export function renderBrief(b: JobBrief, max = BRIEF_MAX): string {
  let details = [...b.details];
  let withCause = !!b.likely_cause;
  let withEn = !!b.customer_reported_en;
  const render = () =>
    [
      `Issue: ${b.issue_summary}`,
      `Customer reported: "${b.customer_reported}"`,
      withEn ? `In English: "${b.customer_reported_en}"` : null,
      details.length ? `Details:\n${details.map((d) => `- ${d}`).join("\n")}` : null,
      withCause ? `AI assessment (to be confirmed on inspection, ${b.likely_cause_confidence ?? "low"} confidence): ${b.likely_cause}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  // Shrink order: AI assessment, then details (last first), then the English line; issue and report always stay.
  let text = render();
  if (text.length > max && withCause) {
    withCause = false;
    text = render();
  }
  while (text.length > max && details.length) {
    details = details.slice(0, -1);
    text = render();
  }
  if (text.length > max && withEn) {
    withEn = false;
    text = render();
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
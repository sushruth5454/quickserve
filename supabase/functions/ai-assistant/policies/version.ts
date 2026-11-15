// Versioning for the assistant's skills/policies. Bump POLICY_VERSION on ANY change to a file in policies/ and add a
// changelog line; the version is stored on every assistant message (ai_messages.payload.policy_version) for audit.

export const POLICY_VERSION = "2026.11.15-6";

export const CHANGELOG: { version: string; summary: string }[] = [
  {
    version: "2026.11.15-6",
    summary: "MATCHING: extract only category-configured attributes/review tags, use match_providers, preserve server tier/evidence, and explain needs-based matches without inventing claims.",
  },
  {
    version: "2026.11.14-5",
    summary:
      "BOOKING: structured JOB BRIEF for the pro (issue_summary, customer_reported(+_en), details, likely_cause) from the WHOLE conversation; " +
      "never the last reply; times only in slot fields; brief PII rules. Server validates/repairs and renders the description (brief.ts).",
  },
  {
    version: "2026.11.14-4",
    summary:
      "TRANSCRIPTION policy (voice preview: transcript_original/transcript_en/clarity, transcribe-only), PHOTOS (visible-only, " +
      "no people/documents, confidence ≤ medium), HUMAN SUPPORT handoff, QUICK REPLIES (no book/pay chips); respond.transcript → transcript_original/_en.",
  },
  {
    version: "2026.11.14-3",
    summary: "SCOPE: scope is the live category list (reverts -2's vehicle example — car/bike mechanic are catalog categories).",
  },
  {
    version: "2026.11.14-2",
    summary: "SCOPE: out-of-scope replies must say 'not offered yet', not 'no pros near you'.",
  },
  {
    version: "2026.11.14-1",
    summary:
      "First versioned policy set: role/boundaries, intake steps, safety escalation, clarification, diagnosis confidence, " +
      "language, booking draft, ranking fairness, privacy, tool permissions, prompt-injection, scope, grounding, output schema.",
  },
];

/** A policy section rendered into the system instruction, in a fixed order (see policies/index.ts). */
export interface PolicySection {
  id: string;
  title: string;
  /** Numbered, explicit rules. Keep each rule one line so small models follow them literally. */
  rules: string[];
}

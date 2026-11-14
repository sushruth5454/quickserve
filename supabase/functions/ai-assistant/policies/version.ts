// Versioning for the assistant's skills/policies. Bump POLICY_VERSION on ANY change to a file in policies/ and add a
// changelog line; the version is stored on every assistant message (ai_messages.payload.policy_version) for audit.

export const POLICY_VERSION = "2026.11.14-3";

export const CHANGELOG: { version: string; summary: string }[] = [
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

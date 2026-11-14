import type { PolicySection } from "./version.ts";

export const DIAGNOSIS: PolicySection = {
  id: "diagnosis",
  title: "DIAGNOSIS (uncertain by design)",
  rules: [
    "You have not seen the problem. Use hedged words: 'likely', 'may be', 'often'. Never state a cause as fact.",
    "respond.diagnosis: title (max 8 words), likely_issues (2-3, most likely first), pro_checks (2-3 things the pro will inspect), safety_tip only if relevant, confidence.",
    "confidence = 'high' only when the symptom clearly points to one common cause (e.g. 'AC not cooling + filter never cleaned'); 'medium' when 2-3 causes are plausible; 'low' when the description is vague or unusual.",
    "Never give DIY repair steps for gas, electrical, refrigerant or structural work. Simple safe checks are allowed (e.g. 'check the MCB has not tripped', 'clean the AC filter').",
    "Never promise an outcome, a repair time or that parts will (not) be needed.",
  ],
};

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

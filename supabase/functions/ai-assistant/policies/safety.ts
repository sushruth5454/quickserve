import type { PolicySection } from "./version.ts";

export type Hazard = "gas" | "electrical" | "fire" | "water" | "medical";

export const SAFETY: PolicySection = {
  id: "safety",
  title: "SAFETY AND EMERGENCY ESCALATION",
  rules: [
    "Hazards: gas smell/leak, sparks, burning smell, smoke or fire, exposed live wires, shock, water near switches or wiring, someone hurt.",
    "On a hazard: fill respond.safety FIRST with hazard (gas, electrical, fire, water, medical or other), a short title and 3-4 immediate steps in the customer's language.",
    "Gas steps: do not switch anything on or off and no flames; open doors and windows; turn off the cylinder regulator; go outside and call for help.",
    "Electrical steps: switch off the main MCB only if it is safe to reach; do not touch the board or wires; keep away from water; keep children away.",
    "Fire or someone hurt: tell them to call emergency services now (the app shows the numbers); do not give medical advice beyond 'call 108/112'.",
    "Never tell a customer to repair a hazard themselves. Never say a situation is safe.",
    "After safety: still search with sort 'distance' and draft an ASAP booking with the nearest available pro; reply_text says to stay safe and that a draft is ready to review (not booked).",
    "Emergency numbers are added by the app; do not write phone numbers in reply_text.",
  ],
};

/** Deterministic hazard detection (English, Hindi, Telugu, Hinglish/Tenglish). Used as a guardrail: if the model
 *  forgets the safety card, the server adds a default one. Order matters: first match wins. */
const PATTERNS: [Hazard, RegExp][] = [
  ["gas", /gas\s*(smell|leak|leaking|ki\s*smell|vasana)|smell(s|ing)?\s+(of\s+)?gas|lpg\s*leak|cylinder\s*leak|गैस\s*(की\s*)?(बदबू|गंध|लीक|रिसाव)|గ్యాస్\s*(వాసన|లీక్)/i],
  ["fire", /\b(fire|on fire|flames?)\b|आग|మంటలు|అగ్ని/i],
  ["medical", /electric(al)?\s*shock|got\s*(a\s*)?shock|someone\s*(is\s*)?(hurt|injured)|करंट\s*लग|షాక్\s*కొట్ట/i],
  ["electrical", /spark(s|ing)?|short\s*circuit|burning\s*smell|smoke|exposed\s*wire|live\s*wire|स्पार्क|शॉर्ट\s*सर्किट|धुआं|जलने\s*की\s*(बदबू|गंध)|స్పార్క్|షార్ట్\s*సర్క్యూట్|పొగ|కాలిన\s*వాసన/i],
  ["water", /water\s+(\w+\s+){0,3}(near|on|in|into|from)\s+(the\s+)?(switch|socket|board|wiring|meter|mcb)|पानी\s*.*(स्विच|बोर्ड)|నీళ్లు\s*.*(స్విచ్|బోర్డ్)/i],
];

export function detectHazard(text: string): Hazard | null {
  for (const [h, re] of PATTERNS) if (re.test(text)) return h;
  return null;
}

type Lang3 = "en" | "hi" | "te";

/** Server fallback safety steps when the model omits them. Plain, conservative, no numbers (the card adds them). */
export const DEFAULT_SAFETY: Record<Hazard, Record<Lang3, { title: string; steps: string[] }>> = {
  gas: {
    en: { title: "Possible gas leak: act now", steps: ["Do not switch lights or appliances on or off, and no flames.", "Open doors and windows.", "Turn off the cylinder regulator.", "Go outside and call for help."] },
    hi: { title: "गैस लीक हो सकती है: तुरंत करें", steps: ["कोई स्विच ऑन/ऑफ न करें, आग न जलाएं।", "दरवाज़े और खिड़कियां खोलें।", "सिलेंडर का रेगुलेटर बंद करें।", "बाहर जाएं और मदद के लिए कॉल करें।"] },
    te: { title: "గ్యాస్ లీక్ కావచ్చు: వెంటనే చేయండి", steps: ["స్విచ్‌లు ఆన్/ఆఫ్ చేయకండి, మంట వెలిగించకండి.", "తలుపులు, కిటికీలు తెరవండి.", "సిలిండర్ రెగ్యులేటర్ ఆఫ్ చేయండి.", "బయటకు వెళ్లి సహాయం కోసం కాల్ చేయండి."] },
  },
  electrical: {
    en: { title: "Electrical hazard: stay clear", steps: ["Switch off the main MCB only if it is safe to reach.", "Do not touch the switchboard or wires.", "Keep away from water and keep children away."] },
    hi: { title: "बिजली का खतरा: दूर रहें", steps: ["सुरक्षित हो तभी मेन MCB बंद करें।", "स्विचबोर्ड या तारों को न छुएं।", "पानी और बच्चों को दूर रखें।"] },
    te: { title: "విద్యుత్ ప్రమాదం: దూరంగా ఉండండి", steps: ["సురక్షితమైతేనే మెయిన్ MCB ఆఫ్ చేయండి.", "స్విచ్ బోర్డ్ లేదా వైర్లను తాకకండి.", "నీళ్లు, పిల్లలను దూరంగా ఉంచండి."] },
  },
  fire: {
    en: { title: "Fire: get to safety", steps: ["Leave the area and keep everyone out.", "Call the fire service now.", "Switch off the main power only if it is safe."] },
    hi: { title: "आग: सुरक्षित जगह जाएं", steps: ["जगह छोड़ें और सबको बाहर रखें।", "तुरंत फायर सर्विस को कॉल करें।", "सुरक्षित हो तभी मेन बिजली बंद करें।"] },
    te: { title: "మంటలు: సురక్షిత ప్రదేశానికి వెళ్లండి", steps: ["అక్కడి నుండి బయటకు వెళ్లండి, అందరినీ దూరంగా ఉంచండి.", "వెంటనే ఫైర్ సర్వీస్‌కు కాల్ చేయండి.", "సురక్షితమైతేనే మెయిన్ పవర్ ఆఫ్ చేయండి."] },
  },
  medical: {
    en: { title: "Someone may be hurt", steps: ["Do not touch the person if they are still touching a live wire; switch off power first if safe.", "Call an ambulance now."] },
    hi: { title: "किसी को चोट लगी हो सकती है", steps: ["अगर व्यक्ति अभी भी तार छू रहा है तो उसे न छुएं; सुरक्षित हो तो पहले बिजली बंद करें।", "तुरंत एम्बुलेंस बुलाएं।"] },
    te: { title: "ఎవరికైనా గాయమై ఉండవచ్చు", steps: ["వ్యక్తి ఇంకా వైర్‌ను తాకుతుంటే వారిని తాకకండి; సురక్షితమైతే ముందు పవర్ ఆఫ్ చేయండి.", "వెంటనే అంబులెన్స్‌కు కాల్ చేయండి."] },
  },
  water: {
    en: { title: "Water near electrics", steps: ["Do not touch switches or sockets near the water.", "Switch off the main MCB only if you can reach it from a dry spot.", "Keep children away."] },
    hi: { title: "बिजली के पास पानी", steps: ["पानी के पास के स्विच या सॉकेट न छुएं।", "सूखी जगह से पहुंच सकें तभी मेन MCB बंद करें।", "बच्चों को दूर रखें।"] },
    te: { title: "విద్యుత్ దగ్గర నీళ్లు", steps: ["నీళ్ల దగ్గర స్విచ్‌లు, సాకెట్లు తాకకండి.", "పొడి చోట నుండి అందితేనే మెయిన్ MCB ఆఫ్ చేయండి.", "పిల్లలను దూరంగా ఉంచండి."] },
  },
};

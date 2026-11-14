/**
 * Live progress checklist: localized labels for the server's stage keys (en/hi/te) and the reducer that turns the
 * streamed stage events into checklist rows. Rows only ever come from server events (real work), never timers.
 */
import type { AssistantLanguage, StageEvent } from './types';

export type UiLang = 'en' | 'hi' | 'te';

type Labels = Record<string, string> & { working: string; listening: string; transcribing: string };

const LABELS: Record<UiLang, Labels> = {
  en: {
    understanding: 'Understanding your request',
    backup: 'Switching to a backup AI model',
    services: 'Checking available services',
    history: 'Checking your past bookings',
    pros: 'Finding top-rated pros near you',
    pricing: 'Estimating price from recent jobs',
    drafting: 'Preparing your booking draft',
    reviewing: 'Reviewing what I found',
    working: 'Working on it…',
    listening: 'Listening…',
    transcribing: 'Turning your voice into text…',
  },
  hi: {
    understanding: 'आपकी बात समझ रहे हैं',
    backup: 'बैकअप AI मॉडल पर जा रहे हैं',
    services: 'उपलब्ध सेवाएं देख रहे हैं',
    history: 'आपकी पिछली बुकिंग देख रहे हैं',
    pros: 'आपके पास के टॉप-रेटेड प्रो ढूंढ रहे हैं',
    pricing: 'हाल के कामों से कीमत का अंदाज़ा',
    drafting: 'बुकिंग ड्राफ़्ट तैयार कर रहे हैं',
    reviewing: 'नतीजे जांच रहे हैं',
    working: 'काम चल रहा है…',
    listening: 'सुन रहे हैं…',
    transcribing: 'आपकी आवाज़ को टेक्स्ट में बदल रहे हैं…',
  },
  te: {
    understanding: 'మీ అభ్యర్థనను అర్థం చేసుకుంటున్నాం',
    backup: 'బ్యాకప్ AI మోడల్‌కు మారుతున్నాం',
    services: 'అందుబాటులో ఉన్న సేవలు చూస్తున్నాం',
    history: 'మీ గత బుకింగ్‌లు చూస్తున్నాం',
    pros: 'మీ దగ్గరలోని టాప్-రేటెడ్ ప్రోలను వెతుకుతున్నాం',
    pricing: 'ఇటీవలి పనుల నుండి ధర అంచనా',
    drafting: 'బుకింగ్ డ్రాఫ్ట్ సిద్ధం చేస్తున్నాం',
    reviewing: 'దొరికిన వాటిని పరిశీలిస్తున్నాం',
    working: 'పని జరుగుతోంది…',
    listening: 'వింటున్నాం…',
    transcribing: 'మీ వాయిస్‌ను టెక్స్ట్‌గా మారుస్తున్నాం…',
  },
};

/** Hindi/Telugu script → that language; Hinglish/Tenglish/English → English labels (Latin script readers). */
export function uiLanguage(lang: AssistantLanguage | null | undefined, text = ''): UiLang {
  if (lang === 'hi' || lang === 'te') return lang;
  if (lang) return 'en';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  return 'en';
}

export function uiText(key: 'working' | 'listening' | 'transcribing', lang: UiLang): string {
  return LABELS[lang][key];
}

/** Localized stage label; unknown keys fall back to the server's English label. */
export function stageLabel(key: string, lang: UiLang, serverLabel = ''): string {
  return LABELS[lang][key] ?? (serverLabel || LABELS.en[key] || key);
}

export interface ProgressRow {
  key: string;
  status: 'active' | 'done' | 'failed';
  serverLabel: string;
}

/** Applies one stage event: first appearance appends a row; later events update that row's status. */
export function applyStage(rows: ProgressRow[], e: StageEvent): ProgressRow[] {
  const i = rows.findIndex((r) => r.key === e.key);
  if (i < 0) return [...rows, { key: e.key, status: e.status, serverLabel: e.label }];
  const next = rows.slice();
  next[i] = { ...next[i]!, status: e.status };
  return next;
}

/** "Done in 3.2s · 4 steps" (localized). Steps = distinct stages that completed. */
export function progressSummary(ms: number, rows: { status: string }[], lang: UiLang): string {
  const secs = (Math.max(0, ms) / 1000).toFixed(1);
  const steps = rows.filter((r) => r.status === 'done').length;
  if (lang === 'hi') return `${secs} सेकंड में पूरा · ${steps} चरण`;
  if (lang === 'te') return `${secs} సెకన్లలో పూర్తైంది · ${steps} దశలు`;
  return `Done in ${secs}s · ${steps} step${steps === 1 ? '' : 's'}`;
}

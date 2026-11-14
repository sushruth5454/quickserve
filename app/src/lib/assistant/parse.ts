/**
 * Defensive parsing of assistant replies: the screen only ever renders what passes these checks, so a malformed or
 * partial server/model response degrades to plain text instead of crashing or showing invented data.
 */
import type {
  AssistantCard,
  AssistantLanguage,
  AssistantReply,
  DiagnosisCard,
  DraftCard,
  DraftSlot,
  EstimateCard,
  ProviderPick,
  ProvidersCard,
  SafetyCard,
} from './types';

type Obj = Record<string, unknown>;

const LANGS: AssistantLanguage[] = ['en', 'hi', 'te', 'hinglish', 'tenglish', 'other'];
const WINDOW_HOURS = [8, 10, 12, 14, 16, 18];

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strOrNull = (v: unknown, max = 2000): string | null => str(v, max) || null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= 0 ? Math.round(n) : null;
};
const strList = (v: unknown, maxItems: number, maxLen = 200): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];

function parseSafety(c: Obj): SafetyCard | null {
  const steps = strList(c.steps, 6);
  if (!steps.length) return null;
  const emergency = Array.isArray(c.emergency)
    ? c.emergency
        .filter(isObj)
        .map((e) => ({ label: str(e.label, 40), number: str(e.number, 12) }))
        .filter((e) => e.label && /^\d{3,5}$/.test(e.number))
    : [];
  return { type: 'safety', hazard: str(c.hazard, 20) || 'other', title: str(c.title, 100) || 'Stay safe first', steps, emergency };
}

function parseDiagnosis(c: Obj): DiagnosisCard | null {
  const likely = strList(c.likely_issues, 5);
  const checks = strList(c.pro_checks, 5);
  if (!likely.length && !checks.length) return null;
  return {
    type: 'diagnosis',
    title: str(c.title, 100) || 'What might be wrong',
    likely_issues: likely,
    pro_checks: checks,
    safety_tip: strOrNull(c.safety_tip, 300),
    category_slug: strOrNull(c.category_slug, 40),
  };
}

function range<K extends string>(v: unknown, keys: K[]): Record<K | 'count', number> | null {
  if (!isObj(v)) return null;
  const out = {} as Record<K | 'count', number>;
  for (const k of [...keys, 'count' as const]) {
    const n = int(v[k]);
    if (n == null) return null;
    out[k] = n;
  }
  return out;
}

function parseEstimate(c: Obj): EstimateCard | null {
  const slug = str(c.category_slug, 40);
  if (!slug) return null;
  const visit = range(c.visit_fee, ['min', 'median', 'max']);
  const total = range(c.typical_total, ['low', 'median', 'high']);
  return {
    type: 'estimate',
    category_slug: slug,
    category_name: str(c.category_name, 60) || slug,
    visit_fee: visit,
    typical_total: total,
    note: str(c.note, 300),
  };
}

function parsePick(p: unknown): ProviderPick | null {
  if (!isObj(p)) return null;
  const id = str(p.provider_id, 64);
  const ps = str(p.provider_service_id, 64);
  const fee = int(p.visit_fee);
  if (!id || !ps || fee == null) return null;
  return {
    provider_id: id,
    provider_service_id: ps,
    name: str(p.name, 80) || 'Pro',
    skill_level: str(p.skill_level, 20),
    visit_fee: fee,
    rating_avg: num(p.rating_avg) ?? 0,
    rating_count: int(p.rating_count) ?? 0,
    jobs_completed: int(p.jobs_completed) ?? 0,
    distance_km: num(p.distance_km),
    is_online: p.is_online === true,
    previously_booked: p.previously_booked === true,
    reason: str(p.reason, 120),
  };
}

function parseProviders(c: Obj): ProvidersCard | null {
  const providers = (Array.isArray(c.providers) ? c.providers : []).map(parsePick).filter((p): p is ProviderPick => !!p).slice(0, 3);
  const slug = str(c.category_slug, 40);
  if (!providers.length || !slug) return null;
  return { type: 'providers', category_slug: slug, category_name: str(c.category_name, 60) || slug, providers };
}

export function parseSlot(v: unknown): DraftSlot | null {
  if (!isObj(v)) return null;
  if (v.type === 'asap') return { type: 'asap', label: str(v.label, 60) || 'As soon as possible' };
  if (v.type !== 'window') return null;
  const date = str(v.date, 10);
  const hour = int(v.start_hour);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || hour == null || !WINDOW_HOURS.includes(hour)) return null;
  return { type: 'window', date, start_hour: hour, starts_at: str(v.starts_at, 40), label: str(v.label, 60) || date };
}

function parseDraft(c: Obj): DraftCard | null {
  const p = isObj(c.provider) ? c.provider : null;
  const slot = parseSlot(c.slot);
  const a = isObj(c.address) ? c.address : null;
  const slug = str(c.category_slug, 40);
  const desc = str(c.description_en, 500);
  if (!p || !slot || !a || !slug || !desc) return null;
  const psId = str(p.provider_service_id, 64);
  const fee = int(p.visit_fee);
  if (!psId || fee == null) return null;
  return {
    type: 'draft',
    category_slug: slug,
    category_name: str(c.category_name, 60) || slug,
    provider: {
      provider_id: str(p.provider_id, 64),
      provider_service_id: psId,
      name: str(p.name, 80) || 'Pro',
      visit_fee: fee,
      rating_avg: num(p.rating_avg) ?? 0,
      rating_count: int(p.rating_count) ?? 0,
    },
    description_en: desc,
    description_original: str(c.description_original, 500),
    problem_chips: strList(c.problem_chips, 6, 40),
    slot,
    address: {
      address_id: strOrNull(a.address_id, 64),
      label: strOrNull(a.label, 40),
      area: str(a.area, 80),
      city: str(a.city, 60),
      needs_full_address: a.needs_full_address === true,
    },
  };
}

export function parseCard(v: unknown): AssistantCard | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case 'safety':
      return parseSafety(v);
    case 'diagnosis':
      return parseDiagnosis(v);
    case 'estimate':
      return parseEstimate(v);
    case 'providers':
      return parseProviders(v);
    case 'draft':
      return parseDraft(v);
    default:
      return null;
  }
}

/** Safety cards always render first (spec: safety before anything else in an emergency). */
const ORDER: AssistantCard['type'][] = ['safety', 'diagnosis', 'estimate', 'providers', 'draft'];

export function parseAssistantReply(v: unknown): AssistantReply {
  const o = isObj(v) ? v : {};
  const cards = (Array.isArray(o.cards) ? o.cards : [])
    .map(parseCard)
    .filter((c): c is AssistantCard => !!c)
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  const limits = isObj(o.limits) ? { messages_left: int(o.limits.messages_left) ?? 0, voice_left: int(o.limits.voice_left) ?? 0 } : null;
  return {
    conversation_id: strOrNull(o.conversation_id, 64),
    reply_text: str(o.reply_text, 1200) || (cards.length ? '' : 'Sorry, something went wrong. Please try again.'),
    language: LANGS.includes(o.language as AssistantLanguage) ? (o.language as AssistantLanguage) : 'en',
    quick_replies: strList(o.quick_replies, 4, 40),
    cards,
    transcript: strOrNull(o.transcript, 800),
    limits,
  };
}

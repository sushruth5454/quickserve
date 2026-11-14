/**
 * Offline, scripted stand-in for the ai-assistant edge function (demo mode). Keyword rules instead of Gemini, but the
 * same reply contract and real demo data: pros come from demoApi.searchProviders, prices from the demo seed, history
 * from the demo user's bookings. Never invents numbers: without enough data the estimate says so.
 */
import type { AssistantCard, AssistantLanguage, AssistantReply, AssistantRequest, DraftCard, DraftSlot, ProviderPick } from '../assistant/types';
import { dayLabel, WINDOW_START_HOURS, windowAvailable, windowLabel, windowStart, startOfDay } from '../schedule';
import type { Booking, ProviderSearchResult } from '../types';
import { demoApi } from './demoApi';

interface Rule {
  slug: string;
  name: string;
  re: RegExp;
  chips: [RegExp, string][];
}

const RULES: Rule[] = [
  {
    slug: 'ac-repair',
    name: 'AC Repair',
    re: /\b(ac|a\.c\.?|aircon|air ?condition\w*)\b|cooling|एसी|ఏసీ/i,
    chips: [
      [/cool|ठंड|చల్ల/i, 'Not cooling'],
      [/nois|sound|आवाज़|आवाज|శబ్ద/i, 'Making noise'],
      [/leak|water|पानी|నీళ్ల/i, 'Water leaking'],
      [/smell|बदबू|వాసన/i, 'Bad smell'],
      [/service|servicing/i, 'Service due'],
    ],
  },
  {
    slug: 'electrician',
    name: 'Electrician',
    re: /spark|switch|current|wiring|mcb|\bfan\b|power|electric|bijli|बिजली|करंट|स्पार्क|కరెంట్|స్పార్క్|స్విచ్|ఫ్యాన్/i,
    chips: [
      [/spark|स्पार्क|స్పార్క్/i, 'Switch sparking'],
      [/mcb|trip/i, 'MCB tripping'],
      [/fan|పంఖా|ఫ్యాన్/i, 'Fan not working'],
      [/wiring|current|power|करंट|కరెంట్/i, 'Wiring issue'],
    ],
  },
  {
    slug: 'plumber',
    name: 'Plumber',
    re: /\btap\b|leak|pipe|drain|plumb|flush|\bnal\b|नल|लीक|पाइप|కుళాయి|లీక్|పైప్/i,
    chips: [
      [/tap|nal|नल|కుళాయి/i, 'Tap leaking'],
      [/drain|block/i, 'Blocked drain'],
      [/flush/i, 'Flush not working'],
      [/burst/i, 'Pipe burst'],
    ],
  },
  { slug: 'appliance-repair', name: 'Appliance Repair', re: /washing|fridge|refrigerator|microwave|appliance|फ्रिज|ఫ్రిజ్/i, chips: [] },
  { slug: 'house-cleaning', name: 'House Cleaning', re: /clean|सफाई|శుభ్ర/i, chips: [] },
  { slug: 'pest-control', name: 'Pest Control', re: /cockroach|termite|pest|bed ?bug|mosquito|कीड़े|పురుగ/i, chips: [] },
  { slug: 'carpenter', name: 'Carpenter', re: /door|carpent|furniture|wood|hinge/i, chips: [] },
  { slug: 'painter', name: 'Painter', re: /paint/i, chips: [] },
  { slug: 'water-tank-cleaning', name: 'Water Tank Cleaning', re: /\btank\b|sump/i, chips: [] },
  { slug: 'car-mechanic', name: 'Car Mechanic', re: /\bcar\b/i, chips: [] },
  { slug: 'bike-mechanic', name: 'Bike Mechanic', re: /bike|scooter|scooty/i, chips: [] },
];

const EMERGENCY = /spark|gas smell|gas leak|smoke|burning|fire|स्पार्क|धुआं|गैस|స్పార్క్|పొగ|గ్యాస్/i;
const AGAIN = /same|again|last time|previous|फिर से|पिछली|మళ్ళీ|ఇంతకు ముందు/i;

function detectLanguage(text: string): AssistantLanguage {
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  return 'en';
}

const COPY: Record<'en' | 'hi' | 'te', { found: (s: string) => string; ask: string; safety: string; none: string }> = {
  en: {
    found: (s) => `I've drafted a ${s} booking with a verified pro near you. Review it and pay the visit fee to send the request.`,
    ask: 'Tell me a little more: what needs fixing, and is it urgent?',
    safety: 'Please stay safe first. Then I can send the fastest available electrician.',
    none: "Sorry, we don't have pros for that near you yet.",
  },
  hi: {
    found: (s) => `मैंने आपके पास के एक वेरिफ़ाइड ${s} प्रो के साथ बुकिंग ड्राफ़्ट तैयार की है। देखें और विज़िट फ़ीस देकर रिक्वेस्ट भेजें।`,
    ask: 'थोड़ा और बताइए: क्या ठीक करवाना है, और क्या जल्दी चाहिए?',
    safety: 'पहले अपनी सुरक्षा का ध्यान रखें। फिर मैं सबसे जल्दी उपलब्ध इलेक्ट्रीशियन भेज सकता हूँ।',
    none: 'माफ़ कीजिए, आपके पास अभी इसके लिए प्रो उपलब्ध नहीं हैं।',
  },
  te: {
    found: (s) => `మీ దగ్గరలో ఉన్న వెరిఫైడ్ ${s} ప్రోతో బుకింగ్ డ్రాఫ్ట్ సిద్ధం చేశాను. చూసి, విజిట్ ఫీజు కట్టి రిక్వెస్ట్ పంపండి.`,
    ask: 'ఇంకొంచెం చెప్పండి: ఏం రిపేర్ కావాలి, అర్జెంటా?',
    safety: 'ముందు జాగ్రత్తగా ఉండండి. తర్వాత దగ్గరలో ఉన్న ఎలక్ట్రీషియన్‌ని పంపగలను.',
    none: 'క్షమించండి, మీ దగ్గర దీనికి ఇంకా ప్రోలు లేరు.',
  },
};

function slotFromText(text: string, now: Date): DraftSlot {
  const t = text.toLowerCase();
  const tomorrow = /tomorrow|kal|कल|రేపు/.test(t);
  const hour = /evening|शाम|సాయంత్రం/.test(t) ? 18 : /afternoon|दोपहर|మధ్యాహ్నం/.test(t) ? 14 : /morning|सुबह|ఉదయం/.test(t) ? 10 : null;
  if (!tomorrow && hour == null) return { type: 'asap', label: 'As soon as possible' };
  const day = startOfDay(now);
  if (tomorrow) day.setDate(day.getDate() + 1);
  const h = hour ?? WINDOW_START_HOURS.find((x) => windowAvailable(day, x, now)) ?? 18;
  if (!windowAvailable(day, h, now)) return { type: 'asap', label: 'As soon as possible' };
  const start = windowStart(day, h);
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  return { type: 'window', date, start_hour: h, starts_at: start.toISOString(), label: `${dayLabel(day)} · ${windowLabel(h)}` };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]!;
}

const round10 = (paise: number) => Math.round(paise / 1000) * 1000;

export async function demoAssistant(req: AssistantRequest): Promise<AssistantReply> {
  const text = (req.message ?? '').trim();
  const lang = detectLanguage(text);
  const copy = COPY[lang === 'hi' || lang === 'te' ? lang : 'en'];
  const now = new Date();
  const bookings: Booking[] = await demoApi.listMyBookings().catch(() => []);
  const conversation_id = req.conversationId ?? `demo-${now.getTime()}`;
  const base = { conversation_id, language: lang, transcript: null, limits: null } as const;

  const again = AGAIN.test(text);
  let rule = RULES.find((r) => r.re.test(text));
  const pastSame = bookings.find((b) => b.categories?.slug && (!rule || b.categories.slug === rule.slug));
  if (!rule && again && pastSame) rule = RULES.find((r) => r.slug === pastSame.categories?.slug);
  if (!rule) {
    return { ...base, reply_text: copy.ask, quick_replies: ['AC not cooling', 'Tap leaking', 'Fan not working', 'Deep cleaning'], cards: [] };
  }

  const cards: AssistantCard[] = [];
  const emergency = EMERGENCY.test(text);
  if (emergency) {
    const gas = /gas|गैस|గ్యాస్/i.test(text);
    cards.push({
      type: 'safety',
      hazard: gas ? 'gas' : 'electrical',
      title: gas ? 'Possible gas leak: act now' : 'Sparks: stay away from the switchboard',
      steps: gas
        ? ['Do not switch lights or appliances on or off.', 'Open doors and windows.', 'Turn off the cylinder regulator.', 'Go outside and call for help.']
        : ['Switch off the main MCB only if you can do it safely.', 'Do not touch the switchboard or wires.', 'Keep children and water away.'],
      emergency: gas
        ? [
            { label: 'Emergency', number: '112' },
            { label: 'Fire', number: '101' },
            { label: 'LPG gas leak helpline', number: '1906' },
          ]
        : [
            { label: 'Emergency', number: '112' },
            { label: 'Fire', number: '101' },
          ],
    });
  }

  const chips = rule.chips.filter(([re]) => re.test(text)).map(([, c]) => c);
  cards.push({
    type: 'diagnosis',
    title: `Likely a ${rule.name.toLowerCase()} job`,
    likely_issues: chips.length ? chips : ['Needs an on-site check'],
    pro_checks: ['Inspects the problem on site', 'Sends an itemised quote before any work'],
    safety_tip: emergency ? 'Keep the area switched off until the pro arrives.' : null,
    category_slug: rule.slug,
  });

  const rows: ProviderSearchResult[] = await demoApi
    .searchProviders(rule.slug, { lat: req.location.lat, lng: req.location.lng }, { sort: emergency ? 'distance' : 'recommended', minRating: null, skillLevel: null, maxVisitFee: null, onlineOnly: false })
    .catch(() => []);
  const totals = bookings.filter((b) => b.categories?.slug === rule!.slug && b.total_amount != null && ['completed', 'closed'].includes(b.status)).map((b) => b.total_amount!);
  const fees = rows.map((r) => r.visit_fee);
  cards.push({
    type: 'estimate',
    category_slug: rule.slug,
    category_name: rule.name,
    visit_fee: fees.length ? { min: Math.min(...fees), median: median(fees), max: Math.max(...fees), count: fees.length } : null,
    typical_total:
      totals.length >= 3 ? { low: round10(pct(totals, 0.25)), median: round10(median(totals)), high: round10(pct(totals, 0.75)), count: totals.length } : null,
    note: totals.length >= 3 ? `Based on ${totals.length} past jobs (demo data).` : 'Not enough completed jobs yet to show a typical total (demo data).',
  });

  if (!rows.length) return { ...base, reply_text: copy.none, quick_replies: [], cards };

  const previous = again ? rows.find((r) => r.provider_id === pastSame?.provider_id) : undefined;
  const ordered = [previous, ...[...rows].sort((a, b) => b.score - a.score)].filter((r, i, arr): r is ProviderSearchResult => !!r && arr.indexOf(r) === i);
  const picks: ProviderPick[] = ordered.slice(0, 3).map((r, i) => ({
    provider_id: r.provider_id,
    provider_service_id: r.provider_service_id,
    name: r.full_name,
    skill_level: r.skill_level,
    visit_fee: r.visit_fee,
    rating_avg: r.rating_avg,
    rating_count: r.rating_count,
    jobs_completed: r.jobs_completed,
    distance_km: r.distance_km,
    is_online: r.is_online,
    previously_booked: bookings.some((b) => b.provider_id === r.provider_id),
    reason:
      r === previous
        ? `You booked ${r.full_name.split(' ')[0]} before`
        : i === 0
          ? `Top match · ★${r.rating_avg.toFixed(1)} (${r.rating_count})`
          : r.distance_km != null
            ? `${r.distance_km.toFixed(1)} km away`
            : `${r.jobs_completed} jobs done`,
  }));
  cards.push({ type: 'providers', category_slug: rule.slug, category_name: rule.name, providers: picks });

  const pro = picks[0]!;
  const draft: DraftCard = {
    type: 'draft',
    category_slug: rule.slug,
    category_name: rule.name,
    provider: { provider_id: pro.provider_id, provider_service_id: pro.provider_service_id, name: pro.name, visit_fee: pro.visit_fee, rating_avg: pro.rating_avg, rating_count: pro.rating_count },
    description_en: chips.length ? `${chips.join(', ')}. Customer request via QuickServe AI.` : `${rule.name} needed. Customer request via QuickServe AI.`,
    description_original: text,
    problem_chips: chips,
    slot: emergency ? { type: 'asap', label: 'As soon as possible' } : slotFromText(text, now),
    address: { address_id: req.location.address_id, label: null, area: req.location.area, city: req.location.city, needs_full_address: !req.location.address_id },
  };
  cards.push(draft);

  return {
    ...base,
    reply_text: emergency ? copy.safety : copy.found(rule.name),
    quick_replies: emergency ? [] : ['Change time', 'Show other pros'],
    cards,
  };
}

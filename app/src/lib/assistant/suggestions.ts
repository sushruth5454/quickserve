/** Personalised starter prompts for the assistant greeting, built locally from the customer's bookings (no AI call). */
import type { Booking } from '../types';

export interface StarterPrompt {
  label: string;
  /** Message sent when tapped. */
  message: string;
  icon: 'refresh' | 'time-outline' | 'chatbubble-ellipses-outline' | 'language-outline';
}

const DONE = ['completed', 'closed'];
const SERVICE_DUE_MONTHS: Record<string, number> = { 'ac-repair': 6, 'water-tank-cleaning': 6, 'pest-control': 6, 'house-cleaning': 3 };
const SERVICE_NOUN: Record<string, string> = {
  'ac-repair': 'AC',
  'water-tank-cleaning': 'water tank',
  'pest-control': 'home',
  'house-cleaning': 'home',
};

const DEFAULTS: StarterPrompt[] = [
  { label: 'My AC is not cooling', message: 'My AC is not cooling and making noise', icon: 'chatbubble-ellipses-outline' },
  { label: 'Kitchen tap is leaking', message: 'My kitchen tap is leaking', icon: 'chatbubble-ellipses-outline' },
  { label: 'మా ఇంట్లో ఫ్యాన్ పని చేయడం లేదు', message: 'మా ఇంట్లో ఫ్యాన్ పని చేయడం లేదు', icon: 'language-outline' },
  { label: 'Deep cleaning this weekend', message: 'I need a full home deep cleaning this weekend', icon: 'chatbubble-ellipses-outline' },
];

export function monthsBetween(fromIso: string, now: Date): number {
  const d = new Date(fromIso);
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()) - (now.getDate() < d.getDate() ? 1 : 0);
}

export function starterPrompts(bookings: Booking[], now: Date, max = 4): StarterPrompt[] {
  const out: StarterPrompt[] = [];
  const done = bookings.filter((b) => DONE.includes(b.status)).sort((a, b) => (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at));

  // Service reminders: the latest job in a recurring category is old enough to be due again.
  const seen = new Set<string>();
  for (const b of done) {
    const slug = b.categories?.slug;
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const due = SERVICE_DUE_MONTHS[slug];
    const months = monthsBetween(b.completed_at ?? b.created_at, now);
    if (due != null && months >= due) {
      const noun = SERVICE_NOUN[slug] ?? 'home';
      out.push({
        label: `Your ${noun} was serviced ${months} months ago. Book a service?`,
        message: `My ${b.categories?.name ?? 'service'} was done ${months} months ago. Book a routine service.`,
        icon: 'time-outline',
      });
    }
  }

  // Rebook the most recent pros (one per category).
  const rebooked = new Set<string>();
  for (const b of done) {
    const name = b.providers?.profiles?.full_name;
    const cat = b.categories?.name;
    if (!name || !cat || rebooked.has(b.provider_id)) continue;
    rebooked.add(b.provider_id);
    out.push({ label: `Book ${name.split(' ')[0]} again (${cat})`, message: `Book ${name} again for ${cat}, same as last time`, icon: 'refresh' });
    if (rebooked.size >= 2) break;
  }

  for (const d of DEFAULTS) if (out.length < max) out.push(d);
  return out.slice(0, max);
}

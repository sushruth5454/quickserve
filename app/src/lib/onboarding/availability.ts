/**
 * Pure availability helpers shared by the provider hours editor and the customer slot picker. Mirrors the server
 * check in public._provider_slot_problem (migration 0009): a 2-hour window must lie fully inside one weekly slot in
 * the provider's timezone, must not overlap time off, and the day must not be fully booked.
 * Providers who never set hours (pre-v2 accounts) have no slots and are treated as always available, like the server.
 */
import type { ProviderSchedule, WeeklySlot } from './types';

const OFFSETS: Record<string, number> = { 'Asia/Kolkata': 330, 'Asia/Calcutta': 330 };
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Display order: Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const MAX_SLOTS_PER_DAY = 4;
export const MIN_SLOT_MINUTES = 60;

export function tzOffsetMinutes(tz: string | null | undefined): number {
  return OFFSETS[tz ?? ''] ?? 330;
}

/** Weekday, minutes since midnight and YYYY-MM-DD of an instant in the provider's timezone (independent of device tz). */
export function localParts(d: Date, tz?: string | null): { dow: number; minutes: number; dateKey: string } {
  const x = new Date(d.getTime() + tzOffsetMinutes(tz) * 60_000);
  const dateKey = `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
  return { dow: x.getUTCDay(), minutes: x.getUTCHours() * 60 + x.getUTCMinutes(), dateKey };
}

export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return 1440;
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

export function formatHHMM(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "9 am", "9:30 am", "12 pm", "12 am" (midnight). */
export function label12(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === 0 ? `${h12} ${suffix}` : `${h12}:${String(min).padStart(2, '0')} ${suffix}`;
}

/** "9 am–1 pm", collapsing a shared suffix: "9–11 am". */
export function rangeLabel(start: string, end: string): string {
  const a = label12(parseHHMM(start));
  const b = label12(parseHHMM(end));
  const [an, as] = a.split(' ');
  const [bn, bs] = b.split(' ');
  return as === bs ? `${an}–${bn} ${bs}` : `${a}–${b}`;
}

export function sortSlots(slots: WeeklySlot[]): WeeklySlot[] {
  return [...slots].sort((x, y) => WEEK_ORDER.indexOf(x.weekday) - WEEK_ORDER.indexOf(y.weekday) || parseHHMM(x.start) - parseHHMM(y.start));
}

/** Returns a user-facing error or null. Same rules as set_provider_availability. */
export function validateSlots(slots: WeeklySlot[]): string | null {
  if (slots.length === 0) return 'Add at least one working-hours slot.';
  for (const s of slots) {
    const a = parseHHMM(s.start);
    const b = parseHHMM(s.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a >= 1440 || s.weekday < 0 || s.weekday > 6) return 'Check the slot times.';
    if (b <= a) return `${WEEKDAY_SHORT[s.weekday]}: end time must be after start time.`;
    if (b - a < MIN_SLOT_MINUTES) return `${WEEKDAY_SHORT[s.weekday]}: each slot must be at least 1 hour.`;
  }
  for (let d = 0; d < 7; d++) {
    const day = slots.filter((s) => s.weekday === d).map((s) => [parseHHMM(s.start), parseHHMM(s.end)] as const);
    if (day.length > MAX_SLOTS_PER_DAY) return `${WEEKDAY_SHORT[d]}: at most ${MAX_SLOTS_PER_DAY} slots per day.`;
    for (let i = 0; i < day.length; i++) {
      for (let j = i + 1; j < day.length; j++) {
        if (day[i]![0] < day[j]![1] && day[j]![0] < day[i]![1]) return `${WEEKDAY_SHORT[d]}: slots overlap.`;
      }
    }
  }
  return null;
}

const range = (days: number[], start: string, end: string): WeeklySlot[] => days.map((weekday) => ({ weekday, start, end }));

export const PRESETS: { key: string; label: string; slots: WeeklySlot[] }[] = [
  { key: 'mon-sat-9-7', label: 'Mon–Sat, 9 am–7 pm', slots: range([1, 2, 3, 4, 5, 6], '09:00', '19:00') },
  { key: 'all-8-8', label: 'Every day, 8 am–8 pm', slots: range([0, 1, 2, 3, 4, 5, 6], '08:00', '20:00') },
  { key: 'mon-fri-10-6', label: 'Mon–Fri, 10 am–6 pm', slots: range([1, 2, 3, 4, 5], '10:00', '18:00') },
  {
    key: 'split',
    label: 'Mon–Sat, 9–1 & 3–8 (lunch break)',
    slots: [...range([1, 2, 3, 4, 5, 6], '09:00', '13:00'), ...range([1, 2, 3, 4, 5, 6], '15:00', '20:00')],
  },
];

/** Replaces the slots of `targets` with copies of `from`'s slots. */
export function copyDay(slots: WeeklySlot[], from: number, targets: number[]): WeeklySlot[] {
  const source = slots.filter((s) => s.weekday === from);
  const kept = slots.filter((s) => !targets.includes(s.weekday) || s.weekday === from);
  return sortSlots([...kept, ...targets.filter((t) => t !== from).flatMap((t) => source.map((s) => ({ ...s, weekday: t })))]);
}

function onLeave(schedule: Pick<ProviderSchedule, 'time_off'>, startMs: number, endMs: number): boolean {
  return schedule.time_off.some((t) => new Date(t.from).getTime() < endMs && startMs < new Date(t.to).getTime());
}

/** Can a window [start, start + duration) be booked? (Lead time is checked separately by schedule.ts.) */
export function windowFits(schedule: ProviderSchedule | null, start: Date, durationMin = 120): boolean {
  if (!schedule) return true;
  if (schedule.paused) return false;
  const startMs = start.getTime();
  if (onLeave(schedule, startMs, startMs + durationMin * 60_000)) return false;
  const p = localParts(start, schedule.timezone);
  if (schedule.full_days.includes(p.dateKey)) return false;
  if (schedule.slots.length === 0) return true;
  return schedule.slots.some((s) => s.weekday === p.dow && parseHHMM(s.start) <= p.minutes && p.minutes + durationMin <= parseHHMM(s.end));
}

/** "As soon as possible" is offered only while the provider is inside working hours and not on leave. */
export function asapAvailable(schedule: ProviderSchedule | null, now: Date): boolean {
  if (!schedule) return true;
  if (schedule.paused) return false;
  const ms = now.getTime();
  if (onLeave(schedule, ms, ms + 60_000)) return false;
  const p = localParts(now, schedule.timezone);
  if (schedule.full_days.includes(p.dateKey)) return false;
  if (schedule.slots.length === 0) return true;
  return schedule.slots.some((s) => s.weekday === p.dow && parseHHMM(s.start) <= p.minutes && p.minutes < parseHHMM(s.end));
}

function dayList(days: number[]): string {
  const idx = days.map((d) => WEEK_ORDER.indexOf(d)).sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j]! + 1) j++;
    const a = WEEKDAY_SHORT[WEEK_ORDER[idx[i]!]!]!;
    const b = WEEKDAY_SHORT[WEEK_ORDER[idx[j]!]!]!;
    parts.push(j - i >= 2 ? `${a}–${b}` : j > i ? `${a}, ${b}` : a);
    i = j + 1;
  }
  return parts.join(', ');
}

/** Groups days with identical hours: ["Mon–Sat · 9 am–1 pm, 2–7 pm", "Sun · 10 am–2 pm"]. */
export function summarizeHours(slots: WeeklySlot[]): string[] {
  const byDay = new Map<number, string>();
  for (const d of WEEK_ORDER) {
    const label = sortSlots(slots.filter((s) => s.weekday === d)).map((s) => rangeLabel(s.start, s.end)).join(', ');
    if (label) byDay.set(d, label);
  }
  const groups = new Map<string, number[]>();
  for (const [d, label] of byDay) groups.set(label, [...(groups.get(label) ?? []), d]);
  return [...groups.entries()].map(([label, days]) => `${dayList(days)} · ${label}`);
}

/** Short line for profile headers: "Available today 9 am–7 pm" / "Not working today" / "On leave until 20 Nov". */
export function todayLabel(slots: WeeklySlot[], now: Date, opts: { tz?: string | null; onLeaveUntil?: string | null } = {}): string | null {
  if (opts.onLeaveUntil && new Date(opts.onLeaveUntil).getTime() > now.getTime()) {
    const until = new Date(new Date(opts.onLeaveUntil).getTime() - 1);
    const p = new Date(until.getTime() + tzOffsetMinutes(opts.tz) * 60_000);
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][p.getUTCMonth()];
    return `On leave until ${p.getUTCDate()} ${month}`;
  }
  if (slots.length === 0) return null;
  const { dow } = localParts(now, opts.tz);
  const today = sortSlots(slots.filter((s) => s.weekday === dow));
  if (today.length === 0) return 'Not working today';
  return `Available today ${today.map((s) => rangeLabel(s.start, s.end)).join(', ')}`;
}

/** Pure helpers for the Book screen's day + time-window picker and booking display formatting. */

/** Start hours of the 2-hour service windows (8–10 am … 6–8 pm). */
export const WINDOW_START_HOURS = [8, 10, 12, 14, 16, 18] as const;
export const WINDOW_HOURS = 2;
/** A window can be booked only if it starts at least this long from now (the pro needs travel time). */
export const MIN_LEAD_MINUTES = 60;

export interface DayOption {
  /** Midnight (India time) of the day. */
  date: Date;
  key: string;
  /** "Today", "Tomorrow", then "Mon". */
  label: string;
  /** Day of month, e.g. "16". */
  dayOfMonth: string;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Service windows are wall-clock times in India, whatever timezone the phone is set to. IST is a fixed +5:30
 * offset with no daylight saving, so a plain shift is exact.
 */
export const SERVICE_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

export interface IstParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0 = Sunday */
  weekday: number;
  hour: number;
  minute: number;
}

export function istParts(d: Date): IstParts {
  const x = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: x.getUTCFullYear(),
    month: x.getUTCMonth() + 1,
    day: x.getUTCDate(),
    weekday: x.getUTCDay(),
    hour: x.getUTCHours(),
    minute: x.getUTCMinutes(),
  };
}

/** "2026-11-15" for the India calendar day containing `d`. */
export function istDateKey(d: Date): string {
  const p = istParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Midnight in India of the day containing `d`. */
export function startOfDay(d: Date): Date {
  const p = istParts(d);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - IST_OFFSET_MS);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function nextDays(now: Date, count = 7): DayOption[] {
  const base = startOfDay(now);
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(base, i);
    const p = istParts(date);
    return {
      date,
      key: istDateKey(date),
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : WEEKDAY[p.weekday]!,
      dayOfMonth: String(p.day),
    };
  });
}

/** `hour`:00 India time on the day containing `day`. */
export function windowStart(day: Date, hour: number): Date {
  return new Date(startOfDay(day).getTime() + hour * 3_600_000);
}

export function windowAvailable(day: Date, hour: number, now: Date): boolean {
  return windowStart(day, hour).getTime() - now.getTime() >= MIN_LEAD_MINUTES * 60_000;
}

/** First day (index into nextDays) that still has a bookable window. */
export function firstAvailableDay(days: DayOption[], now: Date): number {
  const i = days.findIndex((d) => WINDOW_START_HOURS.some((h) => windowAvailable(d.date, h, now)));
  return i < 0 ? 0 : i;
}

function hour12(h: number): string {
  const v = h % 12 === 0 ? 12 : h % 12;
  return String(v);
}

/** "8–10 am", "10 am–12 pm", "6–8 pm". */
export function windowLabel(hour: number): string {
  const end = hour + WINDOW_HOURS;
  const a = hour < 12 ? 'am' : 'pm';
  const b = end < 12 ? 'am' : 'pm';
  return a === b ? `${hour12(hour)}–${hour12(end)} ${b}` : `${hour12(hour)} ${a}–${hour12(end)} ${b}`;
}

/** "Mon, 16 Nov" */
export function dayLabel(d: Date): string {
  const p = istParts(d);
  return `${WEEKDAY[p.weekday]}, ${p.day} ${MONTH[p.month - 1]}`;
}

/** Human booking reference: "QS-FC000006" from a UUID. */
export function bookingRef(id: string): string {
  const compact = id.replace(/-/g, '').toUpperCase();
  // Demo-mode ids are already human refs ("QS1042").
  return compact.startsWith('QS') ? `QS-${compact.slice(2, 10)}` : `QS-${compact.slice(0, 8)}`;
}

/** "Mon, 16 Nov · 10 am–12 pm" when the time is a window start, otherwise "Mon, 16 Nov · 10:30 am". */
export function scheduleLabel(iso: string): string {
  const d = new Date(iso);
  const { hour: h, minute } = istParts(d);
  const onWindow = minute === 0 && (WINDOW_START_HOURS as readonly number[]).includes(h);
  const time = onWindow ? windowLabel(h) : `${hour12(h)}:${String(minute).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  return `${dayLabel(d)} · ${time}`;
}

/** Minimum notice for an urgent creator/event request; mirrors the server (0040). */
export const URGENT_MIN_HOURS = 2;

/** Start of an ASAP fixed-price booking: travel lead time from now, rounded up to the next 15 minutes. */
export function asapStart(now: Date): Date {
  const q = 15 * 60_000;
  return new Date(Math.ceil((now.getTime() + MIN_LEAD_MINUTES * 60_000) / q) * q);
}

/**
 * Start times for an urgent request: on the hour, at least URGENT_MIN_HOURS from now, between 7 am and 9 pm India
 * time, within the next 24 hours.
 */
export function urgentStartOptions(now: Date, count = 10): Date[] {
  const earliest = now.getTime() + URGENT_MIN_HOURS * 3_600_000;
  const first = Math.ceil((earliest + IST_OFFSET_MS) / 3_600_000) * 3_600_000 - IST_OFFSET_MS;
  const out: Date[] = [];
  for (let t = first; t < now.getTime() + DAY_MS && out.length < count; t += 3_600_000) {
    const h = istParts(new Date(t)).hour;
    if (h >= 7 && h <= 21) out.push(new Date(t));
  }
  return out;
}

/** "Today 4 pm", "Tomorrow 9 am" (India time). */
export function relativeTimeLabel(d: Date, now: Date): string {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY_MS);
  const day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : dayLabel(d);
  const { hour: h, minute } = istParts(d);
  return `${day} ${hour12(h)}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

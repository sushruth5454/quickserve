/** Pure helpers for the Book screen's day + time-window picker and booking display formatting. */

/** Start hours of the 2-hour service windows (8–10 am … 6–8 pm). */
export const WINDOW_START_HOURS = [8, 10, 12, 14, 16, 18] as const;
export const WINDOW_HOURS = 2;
/** A window can be booked only if it starts at least this long from now (the pro needs travel time). */
export const MIN_LEAD_MINUTES = 60;

export interface DayOption {
  /** Local midnight of the day. */
  date: Date;
  key: string;
  /** "Today", "Tomorrow", then "Mon". */
  label: string;
  /** Day of month, e.g. "16". */
  dayOfMonth: string;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function nextDays(now: Date, count = 7): DayOption[] {
  const base = startOfDay(now);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(base);
    date.setDate(base.getDate() + i);
    return {
      date,
      key: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : WEEKDAY[date.getDay()]!,
      dayOfMonth: String(date.getDate()),
    };
  });
}

export function windowStart(day: Date, hour: number): Date {
  const d = startOfDay(day);
  d.setHours(hour, 0, 0, 0);
  return d;
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
  return `${WEEKDAY[d.getDay()]}, ${d.getDate()} ${MONTH[d.getMonth()]}`;
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
  const h = d.getHours();
  const onWindow = d.getMinutes() === 0 && (WINDOW_START_HOURS as readonly number[]).includes(h);
  const time = onWindow
    ? windowLabel(h)
    : d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `${dayLabel(d)} · ${time}`;
}

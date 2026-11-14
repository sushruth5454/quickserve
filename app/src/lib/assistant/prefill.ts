/**
 * Hand-off from an assistant booking draft to the existing Book screen (app/book/[providerServiceId].tsx).
 * The draft becomes plain route params; the Book screen turns them back into its initial form state. The customer still
 * reviews everything and pays in the normal checkout: nothing here creates a booking.
 */
import { WINDOW_START_HOURS, windowAvailable, type DayOption } from '../schedule';
import type { DraftCard, DraftSlot } from './types';

export const DESCRIPTION_MAX = 500;

export interface BookPrefillParams {
  providerServiceId: string;
  from: 'assistant';
  description: string;
  /** "asap" or "YYYY-MM-DD@HH" (day and window start hour, wall-clock). */
  slot: string;
  addressId?: string;
  [key: string]: string | undefined;
}

export interface BookPrefill {
  fromAssistant: boolean;
  description: string | null;
  mode: 'asap' | 'schedule' | null;
  dayIndex: number | null;
  hour: number | null;
  addressId: string | null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Problem chips first (comma-separated, so the Book screen pre-selects them), then the English description; the
 * customer's own words are kept when they differ (e.g. Hindi/Telugu), so the pro sees both.
 */
export function composeDescription(d: Pick<DraftCard, 'problem_chips' | 'description_en' | 'description_original'>, max = DESCRIPTION_MAX): string {
  const chips = d.problem_chips.filter((c) => !same(c, d.description_en));
  const base = [...chips, d.description_en.trim()].filter(Boolean).join(', ');
  const original = d.description_original.trim();
  if (!original || same(original, d.description_en)) return base.slice(0, max);
  const prefix = `${base}\nCustomer's words: "`;
  const room = max - prefix.length - 1;
  if (room < 12) return base.slice(0, max);
  const quoted = original.length > room ? `${original.slice(0, room - 1)}…` : original;
  return `${prefix}${quoted}"`;
}

export function slotParam(s: DraftSlot): string {
  return s.type === 'asap' ? 'asap' : `${s.date}@${s.start_hour}`;
}

export function draftToBookParams(d: DraftCard): BookPrefillParams {
  return {
    providerServiceId: d.provider.provider_service_id,
    from: 'assistant',
    description: composeDescription(d),
    slot: slotParam(d.slot),
    ...(d.address.address_id ? { addressId: d.address.address_id } : {}),
  };
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Initial Book screen state from route params. A window maps by wall-clock day + start hour onto the screen's own
 * 7-day picker; one that is no longer bookable keeps the day but leaves the window for the customer to pick.
 */
export function readBookPrefill(params: Record<string, string | string[] | undefined>, days: DayOption[], now: Date): BookPrefill {
  const fromAssistant = first(params.from) === 'assistant';
  const description = first(params.description)?.slice(0, DESCRIPTION_MAX) || null;
  const addressId = first(params.addressId) || null;
  const slot = first(params.slot);
  const out: BookPrefill = { fromAssistant, description, mode: null, dayIndex: null, hour: null, addressId };
  if (slot === 'asap') return { ...out, mode: 'asap' };
  const m = slot ? /^(\d{4})-(\d{2})-(\d{2})@(\d{1,2})$/.exec(slot) : null;
  if (!m) return out;
  const [y, mo, d, h] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const dayIndex = days.findIndex((x) => x.date.getFullYear() === y && x.date.getMonth() + 1 === mo && x.date.getDate() === d);
  if (dayIndex < 0) return out;
  const hourOk = (WINDOW_START_HOURS as readonly number[]).includes(h) && windowAvailable(days[dayIndex]!.date, h, now);
  return { ...out, mode: 'schedule', dayIndex, hour: hourOk ? h : null };
}

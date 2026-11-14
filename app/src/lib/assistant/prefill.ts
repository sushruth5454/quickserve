/**
 * Hand-off from an assistant booking draft to the existing Book screen (app/book/[providerServiceId].tsx).
 * The draft becomes plain route params; the Book screen turns them back into its initial form state. The customer still
 * reviews everything and pays in the normal checkout: nothing here creates a booking.
 */
import { WINDOW_START_HOURS, windowAvailable, type DayOption } from '../schedule';
import type { DraftCard, DraftSlot } from './types';

/** Book screen description limit (the job brief is ≤ ~600 chars plus the problem-chip line). */
export const DESCRIPTION_MAX = 800;

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

/**
 * Book screen description from a draft: the problem chips on the first line (the Book screen pre-selects them), then
 * the server-rendered job brief (Issue / Customer reported / Details / AI assessment). Never the last chat message.
 */
export function composeDescription(d: Pick<DraftCard, 'problem_chips' | 'description'>, max = DESCRIPTION_MAX): string {
  const chips = d.problem_chips.map((c) => c.trim()).filter(Boolean).join(', ');
  const body = d.description.trim();
  const text = chips && body ? `${chips}\n${body}` : chips || body;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const BRIEF_LINE = /^(Issue|Customer reported|In English|Details|AI assessment|- )/;

/** The first line holds the comma-separated problem chips unless it is already part of a job brief. */
function chipLine(description: string): { chips: string[]; rest: string[] } {
  const lines = description.split('\n');
  const head = lines[0] ?? '';
  if (BRIEF_LINE.test(head)) return { chips: [], rest: lines };
  return {
    chips: head
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
    rest: lines.slice(1),
  };
}

export function selectedChips(description: string): Set<string> {
  return new Set(chipLine(description).chips.map((c) => c.toLowerCase()));
}

/** Toggles a problem chip on the first line only, so a multi-line job brief is never rewritten or mangled. */
export function toggleChip(description: string, chip: string, max = DESCRIPTION_MAX): string {
  const { chips, rest } = chipLine(description);
  const on = chips.some((c) => c.toLowerCase() === chip.toLowerCase());
  const next = on ? chips.filter((c) => c.toLowerCase() !== chip.toLowerCase()) : [...chips, chip];
  const lines = [next.join(', '), ...rest].filter((l, i) => i > 0 || l);
  return lines.join('\n').slice(0, max);
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

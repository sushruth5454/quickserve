/**
 * Hand-off from an assistant booking draft to the existing Book screen (app/book/[providerServiceId].tsx).
 * The draft becomes plain route params; the Book screen turns them back into its initial form state. The customer still
 * reviews everything and pays in the normal checkout: nothing here creates a booking.
 */
import { istDateKey, WINDOW_START_HOURS, windowAvailable, type DayOption } from '../schedule';
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
  slot: string | null;
  slotInvalid: boolean;
}

type BookingEntryDraft =
  | DraftCard
  | {
      from?: string;
      fromAssistant?: boolean;
      description?: string | null;
      slot?: string | null;
      addressId?: string | null;
      archetype?: unknown;
    }
  | null;

type BookingService = {
  id: string;
  provider_id: string;
  category_id: string;
  categories?: {
    name?: string | null;
    slug?: string | null;
    archetype?: string | null;
  } | null;
  providers?: { profiles?: { full_name?: string | null } | null } | null;
};

type BookingEntryParams = {
  providerServiceId?: string;
  archetype?: 'fixed' | 'time_based';
  from?: 'assistant';
  description?: string;
  slot?: string;
  addressId?: string;
  categoryId?: string;
  categorySlug?: string;
  name?: string;
  providerId?: string;
  providerName?: string;
};

export type ServiceBookingEntry =
  | { kind: 'inspect'; archetype: 'inspect_quote'; pathname: '/book/[providerServiceId]'; params: BookingEntryParams }
  | { kind: 'fixed-package'; archetype: 'fixed'; pathname: '/book/[providerServiceId]'; params: BookingEntryParams }
  | { kind: 'time-package'; archetype: 'time_based'; pathname: '/book/[providerServiceId]'; params: BookingEntryParams }
  | { kind: 'proposal-request'; archetype: 'proposal'; pathname: '/request/new'; params: BookingEntryParams }
  | { kind: 'unavailable'; archetype: string | null; reason: 'service-unavailable' | 'unsupported-family' };

type ServiceBookingArchetype = 'inspect_quote' | 'fixed' | 'time_based' | 'proposal';

export function isServiceBookingEnabled(
  entry: ServiceBookingEntry | null,
  switches?: Partial<Record<ServiceBookingArchetype, boolean>>,
): boolean {
  return entry !== null && entry.kind !== 'unavailable' && switches?.[entry.archetype] === true;
}

function draftPrefill(draft: BookingEntryDraft): Omit<BookingEntryParams, 'providerServiceId' | 'archetype' | 'categoryId' | 'name' | 'providerId' | 'providerName'> {
  if (!draft) return {};
  if ('type' in draft && draft.type === 'draft') {
    return {
      from: 'assistant',
      description: composeDescription(draft),
      slot: slotParam(draft.slot),
      ...(draft.address.address_id ? { addressId: draft.address.address_id } : {}),
    };
  }
  return {
    ...(draft.from === 'assistant' || draft.fromAssistant ? { from: 'assistant' } : {}),
    ...(typeof draft.description === 'string' && draft.description ? { description: draft.description.slice(0, DESCRIPTION_MAX) } : {}),
    ...(typeof draft.slot === 'string' && draft.slot ? { slot: draft.slot } : {}),
    ...(typeof draft.addressId === 'string' && draft.addressId ? { addressId: draft.addressId } : {}),
  };
}

/** Resolve the checkout from the loaded service category; route archetype hints are intentionally ignored. */
export function resolveServiceBookingEntry(service: BookingService | null, draft: BookingEntryDraft): ServiceBookingEntry {
  if (!service?.id || !service.category_id || !service.categories?.archetype) {
    return { kind: 'unavailable', archetype: null, reason: 'service-unavailable' };
  }
  const archetype = service.categories.archetype;
  const prefill = draftPrefill(draft);
  if (archetype === 'inspect_quote') {
    return {
      kind: 'inspect',
      archetype,
      pathname: '/book/[providerServiceId]',
      params: { providerServiceId: service.id, ...prefill },
    };
  }
  const packageParams = {
    providerServiceId: service.id,
    categoryId: service.category_id,
    categorySlug: service.categories.slug ?? '',
    name: service.categories.name ?? service.categories.slug ?? 'service',
    providerId: service.provider_id,
    providerName: service.providers?.profiles?.full_name ?? 'this provider',
  };
  if (archetype === 'fixed') {
    return {
      kind: 'fixed-package',
      archetype,
      pathname: '/book/[providerServiceId]',
      params: { ...packageParams, archetype, ...prefill },
    };
  }
  if (archetype === 'time_based') {
    return {
      kind: 'time-package',
      archetype,
      pathname: '/book/[providerServiceId]',
      params: { ...packageParams, archetype, ...prefill },
    };
  }
  if (archetype === 'proposal') {
    return {
      kind: 'proposal-request',
      archetype,
      pathname: '/request/new',
      params: {
        categoryId: service.category_id,
        name: service.categories.name ?? service.categories.slug ?? 'service',
        providerId: service.provider_id,
        providerName: service.providers?.profiles?.full_name ?? 'this provider',
        ...prefill,
      },
    };
  }
  return { kind: 'unavailable', archetype, reason: 'unsupported-family' };
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
  const out: BookPrefill = {
    fromAssistant,
    description,
    mode: null,
    dayIndex: null,
    hour: null,
    addressId,
    slot: slot ?? null,
    slotInvalid: false,
  };
  if (slot === 'asap') return { ...out, mode: 'asap' };
  const m = slot ? /^(\d{4})-(\d{2})-(\d{2})@(\d{1,2})$/.exec(slot) : null;
  if (!slot) return out;
  if (!m) return { ...out, mode: 'schedule', slotInvalid: true };
  const [h] = [Number(m[4])];
  const dayIndex = days.findIndex((x) => istDateKey(x.date) === `${m[1]}-${m[2]}-${m[3]}`);
  if (dayIndex < 0) return { ...out, mode: 'schedule', slotInvalid: true };
  const hourOk = (WINDOW_START_HOURS as readonly number[]).includes(h) && windowAvailable(days[dayIndex]!.date, h, now);
  return { ...out, mode: 'schedule', dayIndex, hour: hourOk ? h : null, slotInvalid: !hourOk };
}

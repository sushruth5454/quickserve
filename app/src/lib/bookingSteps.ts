/** Pure model for the compact booking stepper (Booked → Accepted → En route → Quote → Work → Done for visits). */
import type { BookingArchetype, BookingStatus } from './types';

export const STEP_LABELS = ['Booked', 'Accepted', 'En route', 'Quote', 'Work', 'Done'] as const;

/** Steps and the step each happy-path status maps to, per booking type. Inspect & quote is the default. */
const FLOWS: Partial<Record<BookingArchetype, { labels: readonly string[]; current: Partial<Record<BookingStatus, number>> }>> = {
  fixed: {
    labels: ['Booked', 'Accepted', 'En route', 'Work', 'Done'],
    current: { pending_payment: 0, requested: 0, confirmed: 1, accepted: 1, en_route: 2, in_progress: 3, completion_requested: 3 },
  },
  time_based: {
    labels: ['Booked', 'Accepted', 'Session', 'Done'],
    current: { pending_payment: 0, requested: 0, confirmed: 1, accepted: 1, en_route: 1, in_progress: 2, completion_requested: 2 },
  },
  proposal: {
    labels: ['Booked', 'Confirmed', 'Event', 'Delivery', 'Done'],
    current: { pending_payment: 0, confirmed: 1, accepted: 1, en_route: 2, in_progress: 2, delivery_pending: 3, completion_requested: 3 },
  },
};

export type StepState = 'done' | 'current' | 'todo' | 'end';
export type EndTone = 'danger' | 'neutral';

export interface StepperModel {
  steps: { label: string; state: StepState }[];
  /** Set for side/terminal states (cancelled, declined…): the last node is the end marker. */
  endTone: EndTone | null;
}

/** Step that is in play for each happy-path status. */
const CURRENT: Partial<Record<BookingStatus, number>> = {
  pending_payment: 0,
  requested: 0,
  accepted: 1,
  en_route: 2,
  inspecting: 3,
  quote_sent: 3,
  awaiting_payment: 3,
  in_progress: 4,
  completion_requested: 4,
};

const END: Partial<Record<BookingStatus, { label: string; tone: EndTone }>> = {
  declined: { label: 'Declined', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  closed_no_work: { label: 'No work', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  disputed: { label: 'Disputed', tone: 'danger' },
};

/** Furthest happy-path step a booking reached, from its event history. */
export function reachedStep(history: BookingStatus[], archetype?: BookingArchetype | null): number {
  const flow = flowFor(archetype);
  const last = flow.labels.length - 1;
  return history.reduce((max, s) => Math.max(max, flow.current[s] ?? (s === 'completed' || s === 'closed' ? last : -1)), 0);
}

function flowFor(archetype?: BookingArchetype | null) {
  return (archetype ? FLOWS[archetype] : undefined) ?? { labels: STEP_LABELS as readonly string[], current: CURRENT };
}

/**
 * - Happy path: steps before the current one are done, the current one is the filled ring, the rest are grey.
 *   'accepted' → Accepted is current (En route is still to come).
 * - Completed/closed: every step is done.
 * - Side states: steps up to the furthest one reached are done, followed by a coloured end marker
 *   ("Cancelled", "Declined"…); the remaining happy-path steps are dropped.
 */
export function stepperModel(status: BookingStatus, history: BookingStatus[] = [], archetype?: BookingArchetype | null): StepperModel {
  const { labels, current: currentFor } = flowFor(archetype);
  if (status === 'completed' || status === 'closed') {
    return { steps: labels.map((label) => ({ label, state: 'done' })), endTone: null };
  }
  const end = END[status];
  if (end) {
    // Declined/expired can only happen before acceptance; otherwise use the furthest step from the history.
    const reached = status === 'declined' || status === 'expired' ? 0 : reachedStep(history, archetype);
    const done = labels.slice(0, Math.min(reached, labels.length - 2) + 1).map((label) => ({ label, state: 'done' as const }));
    return { steps: [...done, { label: end.label, state: 'end' }], endTone: end.tone };
  }
  const current = currentFor[status] ?? 0;
  return {
    steps: labels.map((label, i) => ({ label, state: i < current ? 'done' : i === current ? 'current' : 'todo' })),
    endTone: null,
  };
}

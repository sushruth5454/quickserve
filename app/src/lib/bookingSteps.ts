/** Pure model for the compact booking stepper (Booked → Accepted → On the way → Quote → Work → Done). */
import type { BookingStatus } from './types';

export const STEP_LABELS = ['Booked', 'Accepted', 'On the way', 'Quote', 'Work', 'Done'] as const;

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
export function reachedStep(history: BookingStatus[]): number {
  return history.reduce((max, s) => Math.max(max, CURRENT[s] ?? (s === 'completed' || s === 'closed' ? 5 : -1)), 0);
}

/**
 * - Happy path: steps before the current one are done, the current one is the filled ring, the rest are grey.
 *   'accepted' → Accepted is current (On the way is still to come).
 * - Completed/closed: every step is done.
 * - Side states: steps up to the furthest one reached are done, followed by a coloured end marker
 *   ("Cancelled", "Declined"…); the remaining happy-path steps are dropped.
 */
export function stepperModel(status: BookingStatus, history: BookingStatus[] = []): StepperModel {
  if (status === 'completed' || status === 'closed') {
    return { steps: STEP_LABELS.map((label) => ({ label, state: 'done' })), endTone: null };
  }
  const end = END[status];
  if (end) {
    // Declined/expired can only happen before acceptance; otherwise use the furthest step from the history.
    const reached = status === 'declined' || status === 'expired' ? 0 : reachedStep(history);
    const done = STEP_LABELS.slice(0, Math.min(reached, 4) + 1).map((label) => ({ label, state: 'done' as const }));
    return { steps: [...done, { label: end.label, state: 'end' }], endTone: end.tone };
  }
  const current = CURRENT[status] ?? 0;
  return {
    steps: STEP_LABELS.map((label, i) => ({ label, state: i < current ? 'done' : i === current ? 'current' : 'todo' })),
    endTone: null,
  };
}

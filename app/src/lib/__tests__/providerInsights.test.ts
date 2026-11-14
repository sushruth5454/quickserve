import { stepperModel } from '../bookingSteps';
import { providerStats, tierProgress } from '../providerInsights';

const states = (s: ReturnType<typeof stepperModel>) => s.steps.map((x) => `${x.label}:${x.state}`);

describe('stepperModel', () => {
  it('marks Accepted as current (not On the way) for an accepted booking', () => {
    expect(states(stepperModel('accepted'))).toEqual([
      'Booked:done',
      'Accepted:current',
      'On the way:todo',
      'Quote:todo',
      'Work:todo',
      'Done:todo',
    ]);
  });

  it.each([
    ['requested', 'Booked'],
    ['en_route', 'On the way'],
    ['awaiting_payment', 'Quote'],
    ['completion_requested', 'Work'],
  ] as const)('%s → current step %s', (status, label) => {
    expect(stepperModel(status).steps.find((s) => s.state === 'current')?.label).toBe(label);
  });

  it('completes every step for closed bookings', () => {
    expect(stepperModel('closed').steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('ends side states with a marker after the furthest step reached', () => {
    const m = stepperModel('cancelled', ['requested', 'accepted', 'en_route', 'cancelled']);
    expect(states(m)).toEqual(['Booked:done', 'Accepted:done', 'On the way:done', 'Cancelled:end']);
    expect(m.endTone).toBe('neutral');
    expect(states(stepperModel('declined', ['requested', 'declined']))).toEqual(['Booked:done', 'Declined:end']);
    expect(stepperModel('disputed', ['in_progress', 'completed', 'disputed']).steps).toHaveLength(6);
  });
});

describe('provider insights', () => {
  const at = new Date('2026-11-14T00:00:00Z');

  it('shows the free period, then the next tier', () => {
    expect(tierProgress({ jobsCompleted: 3, createdAt: new Date('2026-11-01T00:00:00Z'), at }).rateBp).toBe(0);
    const p = tierProgress({ jobsCompleted: 6, createdAt: new Date('2026-01-01T00:00:00Z'), at });
    expect(p).toMatchObject({ rateBp: 1200, nextRateBp: 1000, jobsToNext: 44 });
    expect(p.progress).toBeCloseTo(6 / 50);
    expect(tierProgress({ jobsCompleted: 250, createdAt: new Date('2025-01-01T00:00:00Z'), at })).toMatchObject({ rateBp: 800, nextRateBp: null });
  });

  it('derives acceptance and completion rates only from decided jobs', () => {
    const s = providerStats(['requested', 'declined', 'expired', 'accepted', 'completed', 'closed', 'disputed', 'cancelled']);
    expect(s.acceptance).toBeCloseTo(4 / 6);
    expect(s.completion).toBeCloseTo(2 / 3);
    expect(providerStats(['requested', 'cancelled'])).toEqual({ acceptance: null, completion: null });
  });
});

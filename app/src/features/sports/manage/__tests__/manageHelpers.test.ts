import { slotLabel, toInstant } from '../model';

describe('sports management helpers', () => {
  it('formats booking times in India local time', () => {
    const label = slotLabel('2026-03-04T04:00:00.000Z');
    expect(label).toContain('4 Mar');
    expect(label).toContain('9:30');
  });

  it('converts venue date and time to an instant', () => {
    expect(toInstant('2026-03-04', '09:30')).toBe('2026-03-04T04:00:00.000Z');
    expect(toInstant('not-a-date', '09:30')).toBeNull();
  });
});

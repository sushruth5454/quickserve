import { firstName } from '../model';

describe('firstName', () => {
  it('returns the first part of a full name', () => {
    expect(firstName('Asha Rao')).toBe('Asha');
  });

  it('uses the existing fallback for an empty name', () => {
    expect(firstName('')).toBe('Customer');
  });
});

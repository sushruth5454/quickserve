import { hasCompletedOnboarding, returningUserRole } from '../returningUser';
import type { Profile } from '../types';

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  id: 'user-1',
  full_name: 'Priya',
  avatar_url: null,
  role_customer: true,
  role_provider: false,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('returning-user routing', () => {
  it('requires a name and a saved role before skipping role selection', () => {
    expect(hasCompletedOnboarding(null)).toBe(false);
    expect(hasCompletedOnboarding(profile({ full_name: '  ' }))).toBe(false);
    expect(hasCompletedOnboarding(profile({ role_customer: false }))).toBe(false);
    expect(hasCompletedOnboarding(profile())).toBe(true);
  });

  it('resumes provider mode only when both the profile role and provider record exist', () => {
    expect(returningUserRole(profile({ role_provider: true }), true)).toBe('provider');
    expect(returningUserRole(profile({ role_provider: true }), false)).toBe('customer');
    expect(returningUserRole(profile(), true)).toBe('customer');
  });
});

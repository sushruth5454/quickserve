import { shouldRenderPrivate } from '../GuestGate';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../ui', () => ({ Button: () => null, Text: () => null }));
jest.mock('../../lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('../../lib/authGate', () => ({
  safeReturnTo: (path: unknown) => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//'),
}));
jest.mock('../../i18n', () => ({ useT: jest.fn() }));
jest.mock('../../theme', () => ({ useTheme: jest.fn() }));

describe('GuestGate private content guard', () => {
  it('does not render private children without a session', () => {
    expect(shouldRenderPrivate(null)).toBe(false);
    expect(shouldRenderPrivate(undefined)).toBe(false);
  });

  it('renders private children when a session exists', () => {
    expect(shouldRenderPrivate({ userId: 'customer-1' })).toBe(true);
  });
});

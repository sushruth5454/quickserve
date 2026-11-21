import React from 'react';
import type { Profile } from '../types';
import { isSafeAuthReturnTo, resolveAuthDestination, returningUserRole } from '../returningUser';

const mockRouter = { replace: jest.fn(), back: jest.fn() };
let mockSearchParams: Record<string, unknown> = {};
const mockSetChoosingRole = jest.fn();
const mockSetActiveRole = jest.fn();
const mockVerifyOtp = jest.fn();
const mockGetMyProfile = jest.fn();
const mockGetMyProvider = jest.fn();
const mockUpdateMyProfile = jest.fn();
const mockGetCommissionTerms = jest.fn();

jest.mock('expo-router', () => ({
  router: mockRouter,
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-native', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Pressable: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) =>
      ReactModule.createElement('button', { type: 'button', onClick: onPress }, children),
    View: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('div', null, children),
  };
});

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../components/ui', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Button: ({ title, onPress, disabled }: { title: string; onPress?: () => void; disabled?: boolean }) =>
      ReactModule.createElement('button', { type: 'button', onClick: onPress, disabled }, title),
    Header: () => null,
    InlineAlert: ({ message }: { message?: string | null }) =>
      message ? ReactModule.createElement('div', { role: 'alert' }, message) : null,
    Input: ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) =>
      ReactModule.createElement('input', {
        'aria-label': label,
        value,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChangeText(event.target.value),
      }),
    OTPInput: ({ onChange, onComplete }: { onChange: (value: string) => void; onComplete: (value: string) => void }) =>
      ReactModule.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'complete-otp',
          onClick: () => {
            onChange('123456');
            onComplete('123456');
          },
        },
        'Complete OTP',
      ),
    Screen: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) =>
      ReactModule.createElement('main', null, children, footer),
    Text: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('span', null, children),
    useToast: () => jest.fn(),
  };
});

jest.mock('../api', () => ({
  getMyProfile: (...args: unknown[]) => mockGetMyProfile(...args),
  getMyProvider: (...args: unknown[]) => mockGetMyProvider(...args),
  getCommissionTerms: (...args: unknown[]) => mockGetCommissionTerms(...args),
  isDemoMode: false,
  sendOtp: jest.fn(),
  updateMyProfile: (...args: unknown[]) => mockUpdateMyProfile(...args),
  verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
}));

jest.mock('../auth', () => ({
  useAuth: () => ({
    setActiveRole: mockSetActiveRole,
    setChoosingRole: mockSetChoosingRole,
  }),
}));

jest.mock('../authErrors', () => ({
  authErrorMessage: (error: Error) => error.message,
  formatOtpCountdown: (seconds: number) => `${seconds}s`,
}));

jest.mock('../haptics', () => ({
  haptics: { error: jest.fn(), select: jest.fn(), success: jest.fn() },
}));

jest.mock('../phone', () => ({
  formatPhone: (phone: string) => phone,
}));

jest.mock('../../theme', () => ({
  useTheme: () => ({
    colors: {
      borderStrong: '#000',
      muted: '#000',
      outline: '#000',
      primary: '#000',
      primarySoft: '#000',
      primaryText: '#000',
      surface: '#fff',
      surfaceAlt: '#eee',
      textSecondary: '#000',
    },
    fontFamily: { semibold: 'semibold' },
    radii: { lg: 8, md: 4 },
    spacing: { lg: 16, md: 12, sm: 8, xxl: 24 },
  }),
}));

const dom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => { render: (element: React.ReactElement) => void; unmount: () => void };
};
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;
const AuthVerifyScreen = require('../../features/platformScreens/AuthVerifyScreen').default as React.ComponentType;
const AuthRoleScreen = require('../../features/platformScreens/AuthRoleScreen').default as React.ComponentType;

const completeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: 'user-1',
  full_name: 'Priya',
  avatar_url: null,
  role_customer: true,
  role_provider: false,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function render(Screen: React.ComponentType) {
  await testAct(async () => {
    container = document.createElement('div');
    root = createRoot(container);
    root.render(React.createElement(Screen));
    await flush();
  });
}

async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`Button not found: ${text}; rendered=${container.textContent}`);
  await testAct(async () => {
    button.click();
    await flush();
  });
}

beforeEach(() => {
  mockRouter.replace.mockReset();
  mockRouter.back.mockReset();
  mockSearchParams = { phone: '+919876543210' };
  mockSetChoosingRole.mockReset();
  mockSetActiveRole.mockReset();
  mockVerifyOtp.mockReset().mockResolvedValue(undefined);
  mockGetMyProfile.mockReset().mockResolvedValue(completeProfile());
  mockGetMyProvider.mockReset().mockResolvedValue({ id: 'provider-1' });
  mockUpdateMyProfile.mockReset().mockResolvedValue(undefined);
  mockGetCommissionTerms.mockReset().mockResolvedValue({ founding_days: 30 });
});

afterEach(async () => {
  if (root) {
    await testAct(async () => {
      root?.unmount();
    });
  }
  root = undefined;
});

describe('auth continuation', () => {
  it('uses valid provider booking intent ahead of the provider dashboard default', () => {
    const role = returningUserRole(completeProfile({ role_customer: false, role_provider: true }), true);
    expect(
      resolveAuthDestination({
        returnTo: '/venue/venue-1?bookingId=booking-1',
        roleDefault: role === 'provider' ? '/dashboard' : '/',
      }),
    ).toBe('/venue/venue-1?bookingId=booking-1');
  });

  it('uses customer return intent and gives a valid invite precedence', () => {
    expect(resolveAuthDestination({ returnTo: '/bookings/new?venueId=venue-1', roleDefault: '/' })).toBe(
      '/bookings/new?venueId=venue-1',
    );
    expect(
      resolveAuthDestination({
        inviteToken: 'invite-1',
        returnTo: '/venue/venue-1',
        roleDefault: '/dashboard',
      }),
    ).toEqual({ pathname: '/byo/[token]', params: { token: 'invite-1' } });
  });

  it('rejects external and malformed return destinations', () => {
    for (const path of ['https://outside.example', '//outside.example', '/venue/%ZZ', '/../admin', '/\\outside.example']) {
      expect(isSafeAuthReturnTo(path)).toBe(false);
      expect(resolveAuthDestination({ returnTo: path, roleDefault: '/dashboard' })).toBe('/dashboard');
    }
  });

  it('retries a failed profile read without verifying the OTP again', async () => {
    mockGetMyProfile.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
    await render(AuthVerifyScreen);

    await click('Complete OTP');
    expect(container.textContent).toContain('Unable to load your profile. Retry to continue.');
    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await click('Retry');
    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/role');
  });

  it('keeps provider lookup errors distinct from missing providers and retries post-OTP only', async () => {
    mockSearchParams = { phone: '+919876543210', returnTo: '/venue/venue-1?bookingId=booking-1' };
    mockGetMyProfile.mockResolvedValue(completeProfile({ role_customer: false, role_provider: true }));
    mockGetMyProvider.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'provider-1' });
    await render(AuthVerifyScreen);

    await click('Complete OTP');
    expect(container.textContent).toContain('Unable to load your provider profile. Retry to continue.');
    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockSetActiveRole).not.toHaveBeenCalled();

    await click('Retry');
    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);
    expect(mockSetActiveRole).toHaveBeenCalledWith('provider');
    expect(mockRouter.replace).toHaveBeenCalledWith('/venue/venue-1?bookingId=booking-1');
  });

  it('keeps a known-missing provider on the returning customer fallback', async () => {
    mockSearchParams = { phone: '+919876543210' };
    mockGetMyProfile.mockResolvedValue(completeProfile({ role_customer: false, role_provider: true }));
    mockGetMyProvider.mockResolvedValue(null);
    await render(AuthVerifyScreen);

    await click('Complete OTP');
    expect(mockSetActiveRole).toHaveBeenCalledWith('customer');
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('keeps invite continuation customer-oriented', async () => {
    mockSearchParams = { phone: '+919876543210', inviteToken: 'invite-1', returnTo: '/venue/venue-1' };
    mockGetMyProfile.mockResolvedValue(completeProfile({ role_customer: false, role_provider: true }));
    await render(AuthVerifyScreen);

    await click('Complete OTP');
    expect(mockSetActiveRole).toHaveBeenCalledWith('customer');
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/byo/[token]', params: { token: 'invite-1' } });
  });

  it('does not write a profile when the role screen provider lookup fails', async () => {
    mockSearchParams = { returnTo: '/venue/venue-1?bookingId=booking-1' };
    mockGetMyProfile.mockResolvedValue(completeProfile({ role_customer: false, role_provider: true }));
    mockGetMyProvider.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
    await render(AuthRoleScreen);

    await click('Continue');
    expect(container.textContent).toContain('Unable to load your provider profile. Retry to continue.');
    expect(mockUpdateMyProfile).not.toHaveBeenCalled();
    expect(mockSetActiveRole).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await click('Retry');
    expect(mockUpdateMyProfile).toHaveBeenCalledWith({ full_name: 'Priya' });
    expect(mockSetActiveRole).toHaveBeenCalledWith('provider');
    expect(mockRouter.replace).toHaveBeenCalledWith('/venue/venue-1?bookingId=booking-1');
  });

  it('offers profile retry rather than writing after a failed role-screen profile read', async () => {
    mockGetMyProfile.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
    await render(AuthRoleScreen);

    expect(container.textContent).toContain('Unable to load your profile. Retry before continuing.');
    await click('Retry');
    expect(mockUpdateMyProfile).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

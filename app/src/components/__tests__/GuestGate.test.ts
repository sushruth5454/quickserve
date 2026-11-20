import React, { useEffect } from 'react';
import { GuestGate, shouldRenderPrivate } from '../GuestGate';
import { useAuth } from '../../lib/auth';
import { useT } from '../../i18n';
import { useTheme } from '../../theme';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('../ui', () => ({ Button: 'Button', Text: 'Text' }));
jest.mock('../../lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('../../lib/authGate', () => ({
  safeReturnTo: (path: unknown) => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//'),
}));
jest.mock('../../i18n', () => ({ useT: jest.fn() }));
jest.mock('../../theme', () => ({ useTheme: jest.fn() }));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseT = useT as jest.MockedFunction<typeof useT>;
const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;

const loadPrivateData = jest.fn();

function PrivateScreen() {
  useEffect(() => {
    loadPrivateData();
  }, []);
  return React.createElement('PrivateScreen', null, 'Private data');
}

function findElements(node: any, type: unknown): any[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, type));
  if (!node || typeof node !== 'object') return [];
  return [
    ...(node.type === type ? [node] : []),
    ...findElements(node.props?.children, type),
  ];
}

describe('GuestGate private content guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ session: null } as never);
    mockUseT.mockReturnValue(((key: string) => (
      key === 'guest.signInToContinue' ? 'Sign in to continue' : key
    )) as never);
    mockUseTheme.mockReturnValue({
      spacing: { md: 12, xl: 32 },
      colors: { bg: 'background' },
    } as never);
  });

  it('does not render private children without a session', () => {
    expect(shouldRenderPrivate(null)).toBe(false);
    expect(shouldRenderPrivate(undefined)).toBe(false);
  });

  it('renders private children when a session exists', () => {
    expect(shouldRenderPrivate({ userId: 'customer-1' })).toBe(true);
  });

  it('shows the sign-in prompt and excludes private data loaders from a guest render tree', () => {
    const element = GuestGate({
      children: React.createElement(PrivateScreen),
      returnTo: '/bookings',
    });

    expect(findElements(element, 'Text')[0]?.props.children).toBe('Sign in to continue');
    expect(loadPrivateData).not.toHaveBeenCalled();
    expect(findElements(element, PrivateScreen)).toHaveLength(0);
  });

  it('includes private children in the render tree when a session exists', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'customer-1' } } } as never);
    const element = GuestGate({
      children: React.createElement(PrivateScreen),
      returnTo: '/account',
    });

    expect(findElements(element, PrivateScreen)).toHaveLength(1);
  });
});

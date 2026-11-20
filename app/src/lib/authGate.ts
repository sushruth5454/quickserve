import { router } from 'expo-router';
import { getSession } from './api';

export const BROWSE_SEGMENTS = [
  '(customer)',
  'category',
  'provider',
  'sports',
  'venue',
  'shop',
  'products',
  'product',
  'creators',
  'top-rated',
  'location',
  'info',
  'byo',
] as const;

export function isBrowseRoute(segments: readonly string[]): boolean {
  const [first, second] = segments;
  if (first === '(customer)') return second === undefined || second === 'index' || second === 'search';
  return BROWSE_SEGMENTS.includes(first as (typeof BROWSE_SEGMENTS)[number]);
}

export function isGuestGatedCustomerTab(segments: readonly string[]): boolean {
  const [first, second] = segments;
  return first === '(customer)' && (second === 'bookings' || second === 'account');
}

export function canGuestBrowse(guestBrowseEnabled: boolean, segments: readonly string[]): boolean {
  return guestBrowseEnabled && (isBrowseRoute(segments) || isGuestGatedCustomerTab(segments));
}

export function safeReturnTo(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');
}

export async function requireSignIn(returnTo: unknown): Promise<boolean> {
  try {
    if (await getSession()) return true;
  } catch {
    // Fail closed if session state cannot be confirmed.
  }

  router.replace(
    safeReturnTo(returnTo)
      ? { pathname: '/login', params: { returnTo } }
      : '/login',
  );
  return false;
}

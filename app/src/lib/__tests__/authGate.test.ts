import { router } from 'expo-router';
import { getSession } from '../api';
import { BROWSE_SEGMENTS, canGuestBrowse, isBrowseRoute, requireSignIn, safeReturnTo } from '../authGate';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../api', () => ({ getSession: jest.fn() }));

const mockGetSession = getSession as jest.MockedFunction<typeof getSession>;

describe('guest browse route helpers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps the approved browse segments fixed', () => {
    expect(BROWSE_SEGMENTS).toEqual([
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
    ]);
  });

  it.each([
    ['category', '[slug]'],
    ['provider', '[id]'],
    ['sports', '[activity]'],
    ['venue', '[id]'],
    ['shop', '[id]'],
    ['products'],
    ['product', '[id]'],
    ['creators'],
    ['top-rated'],
    ['location'],
    ['info', '[topic]'],
    ['byo', '[token]'],
  ])('allows approved route segments %s', (...segments) => {
    expect(isBrowseRoute(segments)).toBe(true);
  });

  it.each([['(customer)'], ['(customer)', 'index'], ['(customer)', 'search']])(
    'allows only the customer browse tabs for %s',
    (...segments) => {
      expect(isBrowseRoute(segments)).toBe(true);
    },
  );

  it.each([
    ['(customer)', 'bookings'],
    ['(customer)', 'account'],
    ['book'],
    ['booking', '[id]'],
    ['chat', '[bookingId]'],
    ['quote', '[bookingId]'],
    ['onboarding'],
    ['jobs'],
    ['assistant'],
    ['(provider)'],
  ])('rejects protected route segments %s', (...segments) => {
    expect(isBrowseRoute(segments)).toBe(false);
  });

  it('keeps browse routes protected when guest_browse is off', () => {
    expect(canGuestBrowse(false, ['category', 'plumbing'])).toBe(false);
  });

  it('allows only approved routes when guest_browse is on', () => {
    expect(canGuestBrowse(true, ['category', 'plumbing'])).toBe(true);
    expect(canGuestBrowse(true, ['(customer)', 'bookings'])).toBe(false);
  });

  it('accepts only safe internal return paths', () => {
    expect(safeReturnTo('/')).toBe(true);
    expect(safeReturnTo('/provider/123')).toBe(true);
    expect(safeReturnTo('//example.com')).toBe(false);
    expect(safeReturnTo('https://example.com')).toBe(false);
    expect(safeReturnTo('provider/123')).toBe(false);
    expect(safeReturnTo(undefined)).toBe(false);
  });

  it('lets signed-in users continue without navigating', async () => {
    mockGetSession.mockResolvedValueOnce({ userId: 'customer-1' } as Awaited<ReturnType<typeof getSession>>);

    await expect(requireSignIn('/product/123')).resolves.toBe(true);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('routes signed-out users to login with a safe return path', async () => {
    mockGetSession.mockResolvedValueOnce(null);

    await expect(requireSignIn('/product/123')).resolves.toBe(false);
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/login', params: { returnTo: '/product/123' } });
  });
});

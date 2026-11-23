import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveBrandIdentity, type BrandIdentityState } from '../../branding/identity';
import { safeReturnTo } from '../authGate';
import { badgeLabel, notificationRoute, toUnreadMap, totalUnread } from '../unread';

const publishedIdentity: NonNullable<BrandIdentityState['published']> = {
  schemaVersion: 1,
  displayName: 'Oorva',
  tagline: '',
  logoLight: null,
  logoDark: null,
  compactLight: null,
  compactDark: null,
};

const readLayout = (path: string) => readFileSync(resolve(__dirname, '../../../app', path), 'utf8');
const navigationSource = readFileSync(resolve(__dirname, '../../components/tabOptions.tsx'), 'utf8');

describe('O11 navigation matrix', () => {
  it('keeps contextual legacy identity and navigation when oorva_brand is off or assets are unavailable', () => {
    const disabled: BrandIdentityState = {
      brandOn: false,
      runtimeOn: false,
      bundledIdentityReady: false,
      published: publishedIdentity,
    };
    const unavailable: BrandIdentityState = {
      brandOn: true,
      runtimeOn: false,
      bundledIdentityReady: false,
      published: null,
    };
    const parentOffChildOn: BrandIdentityState = {
      brandOn: false,
      runtimeOn: true,
      bundledIdentityReady: true,
      published: publishedIdentity,
    };

    expect(resolveBrandIdentity('home', disabled)).toMatchObject({ displayName: 'QuickServe', source: 'legacy' });
    expect(resolveBrandIdentity('recurring', disabled)).toMatchObject({ displayName: 'Nearo', source: 'legacy' });
    expect(navigationSource).toContain("identity.source !== 'legacy'");
    expect(navigationSource).toContain('headerShown: visible');
    expect(resolveBrandIdentity('home', parentOffChildOn)).toMatchObject({ displayName: 'QuickServe', source: 'legacy' });
    expect(resolveBrandIdentity('home', unavailable)).toMatchObject({ displayName: 'QuickServe', source: 'legacy' });
  });

  it('shows only the shared contextual identity when an approved runtime identity is available', () => {
    const enabled: BrandIdentityState = {
      brandOn: true,
      runtimeOn: true,
      bundledIdentityReady: false,
      published: publishedIdentity,
    };

    const identity = resolveBrandIdentity('home', enabled);
    expect(identity).toMatchObject({ displayName: 'Oorva', source: 'published' });
    expect(navigationSource).toContain('identity.displayName');
  });

  it('uses the source unread counts and semantic count labels for each actor', () => {
    const unread = toUnreadMap([
      { booking_id: 'customer-booking', role: 'customer', unread: 2, last_message_at: null },
      { booking_id: 'provider-booking', role: 'provider', unread: 3, last_message_at: null },
    ]);

    expect(totalUnread(unread, 'customer')).toBe(2);
    expect(totalUnread(unread, 'provider')).toBe(3);
    expect(badgeLabel(0)).toBeUndefined();
    expect(badgeLabel(2)).toBe('2');
    expect(badgeLabel(120)).toBe('99+');
  });

  it('preserves guest return targets while rejecting external and protocol-relative targets', () => {
    expect(safeReturnTo('/bookings')).toBe(true);
    expect(safeReturnTo('/account')).toBe(true);
    expect(safeReturnTo('//example.test/bookings')).toBe(false);
    expect(safeReturnTo('https://example.test/bookings')).toBe(false);
  });

  it('preserves owner-only destinations for owners and hides them for members', () => {
    const provider = readLayout('(provider)/_layout.tsx');
    expect(provider).toContain("const isOwner = businessRole === 'owner'");
    expect(provider).toContain('href: isOwner ? undefined : null');
  });

  it('keeps existing route names, actor destinations, and safe deep-link/back return paths', () => {
    const auth = readLayout('(auth)/_layout.tsx');
    const customer = readLayout('(customer)/_layout.tsx');
    const provider = readLayout('(provider)/_layout.tsx');
    const admin = readLayout('admin/_layout.tsx');

    for (const route of ['login', 'verify', 'role']) expect(auth).toContain(`name="${route}"`);
    for (const route of ['index', 'search', 'bookings', 'account']) expect(customer).toContain(`name="${route}"`);
    for (const route of ['dashboard', 'earnings', 'pro-account', 'business-tools']) expect(provider).toContain(`name="${route}"`);
    expect(auth).toContain('options={{ gestureEnabled: false }}');
    expect(customer).toContain("flags.isOn('unified_search') ? undefined : null");
    expect(customer).toContain("safeReturnTo(path) ? path : '/'");
    expect(customer).toContain("activeRole === 'provider'");
    expect(provider).toContain("activeRole === 'customer' && !businessRole");
    expect(provider).toContain('href: isOwner ? undefined : null');
    expect(admin).toContain("currentAccess.status === 'denied'");
    expect(notificationRoute({ url: '/booking/booking-1' })).toBe('/booking/booking-1');
    expect(notificationRoute({ url: '/provider/dashboard' })).toBe('/dashboard');
    expect(notificationRoute({ url: 'https://example.test/booking/booking-1' })).toBeNull();
    expect(safeReturnTo(notificationRoute({ url: '/chat/booking-1' }))).toBe(true);
  });
});

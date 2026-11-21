import type { Profile } from './types';

export type AuthContinuationDestination =
  | string
  | { pathname: '/byo/[token]'; params: { token: string } };

export function hasCompletedOnboarding(profile: Profile | null): profile is Profile {
  return !!profile?.full_name?.trim() && (profile.role_customer || profile.role_provider);
}

export function returningUserRole(profile: Profile, providerExists: boolean): 'customer' | 'provider' {
  return profile.role_provider && providerExists ? 'provider' : 'customer';
}

export function isSafeAuthReturnTo(path: unknown): path is string {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > 2048 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path !== path.trim() ||
    /[\u0000-\u0020\u007f\\#]/.test(path)
  ) {
    return false;
  }

  const pathname = path.split('?', 1)[0];
  if (!pathname || pathname.includes('//') || /%(2f|5c)/i.test(pathname)) return false;

  try {
    const decoded = decodeURIComponent(path);
    const decodedPath = decoded.split('?', 1)[0];
    if (decodedPath.startsWith('//') || decodedPath.includes('\\')) return false;
    if (decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) return false;
    return new URL(path, 'https://quickserve.invalid').origin === 'https://quickserve.invalid';
  } catch {
    return false;
  }
}

export function resolveAuthDestination({
  inviteToken,
  returnTo,
  roleDefault,
}: {
  inviteToken?: unknown;
  returnTo?: unknown;
  roleDefault: string;
}): AuthContinuationDestination {
  if (typeof inviteToken === 'string' && inviteToken.length > 0 && inviteToken === inviteToken.trim()) {
    return { pathname: '/byo/[token]', params: { token: inviteToken } };
  }
  if (isSafeAuthReturnTo(returnTo)) return returnTo;
  return roleDefault;
}

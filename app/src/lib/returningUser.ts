import type { Profile } from './types';

export function hasCompletedOnboarding(profile: Profile | null): profile is Profile {
  return !!profile?.full_name?.trim() && (profile.role_customer || profile.role_provider);
}

export function returningUserRole(profile: Profile, providerExists: boolean): 'customer' | 'provider' {
  return profile.role_provider && providerExists ? 'provider' : 'customer';
}

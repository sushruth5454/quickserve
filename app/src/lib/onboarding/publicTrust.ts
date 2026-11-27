import type { PublicProfile } from './types';

export interface PublicTrustBadge {
  label: string;
  description: string;
}

export type ProviderPublicTrust =
  | {
      state: 'loaded';
      badges: { payout: PublicTrustBadge | null; police: PublicTrustBadge | null };
      credentialLabels: string[];
    }
  | {
      state: 'unavailable';
      badges: { payout: null; police: null };
      credentialLabels: string[];
    };

export function providerPublicTrust(
  profile: Pick<PublicProfile, 'badges' | 'credentials'> | null,
): ProviderPublicTrust {
  if (!profile) {
    return {
      state: 'unavailable',
      badges: { payout: null, police: null },
      credentialLabels: [],
    };
  }

  return {
    state: 'loaded',
    badges: {
      payout: profile.badges.payout_verified
        ? {
            label: 'Payout account verified',
            description:
              'This confirms payout verification only; it is not an independent ID-document or overall provider approval.',
          }
        : null,
      police: profile.badges.police_verified
        ? {
            label: 'Police certificate approved',
            description:
              'This confirms police certificate approval only; it does not indicate payout or overall provider approval.',
          }
        : null,
    },
    credentialLabels: profile.credentials,
  };
}

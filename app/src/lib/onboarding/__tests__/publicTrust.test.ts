import { providerPublicTrust } from '../publicTrust';
import type { PublicProfile } from '../types';

function profile(
  idVerified: boolean,
  payoutVerified: boolean,
  policeVerified: boolean,
  credentials: string[] = [],
): Pick<PublicProfile, 'badges' | 'credentials'> {
  return {
    badges: {
      id_verified: idVerified,
      payout_verified: payoutVerified,
      police_verified: policeVerified,
    },
    credentials,
  };
}

describe('providerPublicTrust', () => {
  it('ID-PUBLIC-TRUST-PAYOUT-RAIL-PARITY keeps payout wording independent of legacy id_verified', () => {
    const fundAccount = providerPublicTrust(profile(false, true, false));
    const accountShape = providerPublicTrust(profile(true, true, false));

    expect(fundAccount.state).toBe('loaded');
    expect(accountShape.state).toBe('loaded');
    expect(fundAccount.badges.payout).toEqual(accountShape.badges.payout);
    expect(fundAccount.badges.payout?.label).toBe('Payout account verified');
    expect(Object.keys(fundAccount.badges)).toEqual(['payout', 'police']);
  });

  it('ID-PUBLIC-TRUST-CREDENTIAL-INDEPENDENT retains only the server-projected credential labels', () => {
    const credentials = ['Police verification certificate', 'Electrical safety'];
    const trust = providerPublicTrust(profile(false, false, true, credentials));

    expect(trust.badges.payout).toBeNull();
    expect(trust.badges.police?.label).toBe('Police certificate approved');
    expect(trust.credentialLabels).toBe(credentials);
  });

  it('ID-PUBLIC-TRUST-UNAVAILABLE returns no invented public verification when the profile is missing', () => {
    const trust = providerPublicTrust(null);

    expect(trust).toEqual({
      state: 'unavailable',
      badges: { payout: null, police: null },
      credentialLabels: [],
    });
  });
});

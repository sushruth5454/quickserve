import React from 'react';
import type { PublicProfile } from '../../../lib/onboarding/types';
import { providerPublicTrust } from '../../../lib/onboarding/publicTrust';
import { ProviderProfileCallouts } from '../ProviderProfileCallouts';
import { ProviderProfileHero } from '../ProviderProfileHero';

jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('../../../components/ui', () => ({
  Avatar: 'Avatar',
  IconButton: 'IconButton',
  InlineAlert: 'InlineAlert',
  Text: 'Text',
}));
jest.mock('../ProfileParts', () => ({ MetaChip: 'MetaChip', TrustBadge: 'TrustBadge' }));
jest.mock('../../../theme', () => ({
  useTheme: () => ({ colors: {}, radii: { pill: 20 }, spacing: { md: 12 } }),
}));

const theme = { spacing: { md: 12, sm: 8 } } as never;

function publicProfile(
  idVerified = false,
  payoutVerified = true,
  policeVerified = false,
  credentials: string[] = [],
): PublicProfile {
  return {
    badges: {
      id_verified: idVerified,
      payout_verified: payoutVerified,
      police_verified: policeVerified,
    },
    credentials,
    live: true,
  } as unknown as PublicProfile;
}

function elements(node: unknown, type: string): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!React.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  return [
    ...(element.type === type ? [element] : []),
    ...elements(element.props.children, type),
  ];
}

function renderCallouts(
  profile: PublicProfile | null,
  profileFailed = false,
) {
  return ProviderProfileCallouts({
    pub: profile,
    trust: providerPublicTrust(profile),
    profileFailed,
    isPreview: false,
    unavailable: profileFailed,
    today: null,
    first: 'Asha',
    theme,
    gutter: { paddingHorizontal: 16 },
  });
}

describe('Provider public trust wording', () => {
  it('ID-PUBLIC-TRUST-PAYOUT-RAIL-PARITY keeps visible and accessible payout wording identical for both legacy id flags', () => {
    const fromFundAccount = renderCallouts(publicProfile(false, true, false));
    const fromAccountShape = renderCallouts(publicProfile(true, true, false));
    const labels = (tree: unknown) => elements(tree, 'TrustBadge').map((badge) => badge.props.label);
    const accessibilityLabels = (tree: unknown) =>
      elements(tree, 'View')
        .map((view) => view.props.accessibilityLabel)
        .filter((label): label is string => typeof label === 'string');

    expect(labels(fromFundAccount)).toEqual(['Payout account verified']);
    expect(labels(fromAccountShape)).toEqual(labels(fromFundAccount));
    expect(accessibilityLabels(fromAccountShape)).toEqual([
      'Payout account verified. This confirms payout verification only; it is not an independent ID-document or overall provider approval.',
    ]);
    expect(labels(fromAccountShape)).not.toContain('ID verified');
  });

  it('ID-PUBLIC-TRUST-NO-INDEPENDENT-ID-CLAIM keeps police approval independent of payout and ID claims', () => {
    const tree = renderCallouts(publicProfile(false, false, true, ['Electrical safety']));
    const labels = elements(tree, 'TrustBadge').map((badge) => badge.props.label);

    expect(labels).toEqual(['Police certificate approved', 'Electrical safety']);
    expect(labels).not.toContain('Payout account verified');
    expect(labels).not.toContain('ID verified');
    expect(elements(tree, 'View').map((view) => view.props.accessibilityLabel)).toContain(
      'Police certificate approved. This confirms police certificate approval only; it does not indicate payout or overall provider approval.',
    );
  });

  it('ID-PUBLIC-TRUST-LEGACY-OFF keeps truthful public wording independent of cosmetic switches', () => {
    const tree = renderCallouts(publicProfile(true, true, false));

    expect(elements(tree, 'TrustBadge').map((badge) => badge.props.label)).toContain(
      'Payout account verified',
    );
    expect(elements(tree, 'View').map((view) => view.props.accessibilityLabel)).toContain(
      'Payout account verified. This confirms payout verification only; it is not an independent ID-document or overall provider approval.',
    );
  });

  it('ID-PUBLIC-TRUST-UNAVAILABLE shows no invented public verification after a failed profile read', () => {
    const tree = renderCallouts(null, true);

    expect(elements(tree, 'TrustBadge')).toHaveLength(0);
    expect(elements(tree, 'InlineAlert').map((alert) => alert.props.title)).toContain(
      'Verification details unavailable',
    );
  });

  it('ID-PUBLIC-TRUST-NO-PRIVATE-READ exposes only the safe trust DTO and badge props', () => {
    const profile = publicProfile(false, true, false);
    const trust = providerPublicTrust(profile);
    const tree = renderCallouts(profile);

    expect(Object.keys(trust)).toEqual(['state', 'badges', 'credentialLabels']);
    expect(JSON.stringify(trust)).not.toMatch(/provider_documents|account_number|ifsc|admin_note/i);
    expect(elements(tree, 'TrustBadge').map((badge) => Object.keys(badge.props))).toEqual([
      ['icon', 'label'],
    ]);
  });

  it('gives the payout checkmark a payout-specific accessibility label', () => {
    const payoutBadge = providerPublicTrust(publicProfile(false, true, false)).badges.payout;
    const tree = ProviderProfileHero({
      provider: { city: 'Hyderabad', is_online: false, profiles: { avatar_url: null } } as never,
      name: 'Asha',
      payoutBadge,
      theme: {
        colors: { heroFrom: '#000', heroTo: '#111', bg: '#fff', primary: '#222', success: '#333', outline: '#444' },
        spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
      } as never,
      topInset: 0,
      onBack: jest.fn(),
      onShare: jest.fn(),
    });
    const mark = elements(tree, 'Ionicons').find((icon) => icon.props.name === 'checkmark-circle');

    expect(mark?.props.accessibilityLabel).toBe('Payout account verified');
    expect(mark?.props.accessibilityHint).toBe(
      'This confirms payout verification only; it is not an independent ID-document or overall provider approval.',
    );
  });
});

import { View } from 'react-native';
import { InlineAlert } from '../../components/ui';
import type { PublicProfile } from '../../lib/onboarding';
import type { ProviderPublicTrust } from '../../lib/onboarding/publicTrust';
import { type useTheme } from '../../theme';
import { TrustBadge } from './ProfileParts';

export function ProviderProfileCallouts({
  pub,
  trust,
  profileFailed,
  isPreview,
  unavailable,
  today,
  first,
  theme: t,
  gutter,
}: {
  pub: PublicProfile | null;
  trust: ProviderPublicTrust;
  profileFailed: boolean;
  isPreview: boolean;
  unavailable: boolean;
  today: string | null;
  first: string;
  theme: ReturnType<typeof useTheme>;
  gutter: { paddingHorizontal: number };
}) {
  return isPreview || unavailable || pub?.badges || profileFailed ? (
    <View style={[gutter, { gap: t.spacing.md }]}>
      {isPreview ? (
        <InlineAlert
          tone="info"
          title="Preview"
          message={pub?.live ? 'This is how customers see your profile.' : 'This is how customers will see your profile once you are live.'}
        />
      ) : null}
      {unavailable ? (
        <InlineAlert tone="warning" title="Not taking bookings right now" message={today?.startsWith('On leave') ? today : `${first} has paused new bookings for now.`} />
      ) : null}
      {profileFailed ? (
        <InlineAlert
          tone="neutral"
          title="Verification details unavailable"
          message="Public payout and credential details could not be loaded."
        />
      ) : null}
      {pub ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: t.spacing.sm }}>
          {trust.badges.payout ? (
            <View
              accessible
              accessibilityLabel={`${trust.badges.payout.label}. ${trust.badges.payout.description}`}
            >
              <TrustBadge icon="shield-checkmark-outline" label={trust.badges.payout.label} />
            </View>
          ) : null}
          {trust.badges.police ? (
            <View
              accessible
              accessibilityLabel={`${trust.badges.police.label}. ${trust.badges.police.description}`}
            >
              <TrustBadge icon="ribbon-outline" label={trust.badges.police.label} />
            </View>
          ) : null}
          {trust.credentialLabels
            .filter((cr) => cr !== 'Police verification certificate')
            .map((cr) => (
              <TrustBadge key={cr} icon="document-text-outline" label={cr} />
            ))}
        </View>
      ) : null}
    </View>
  ) : null;
}

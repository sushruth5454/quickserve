import { View } from 'react-native';
import { InlineAlert } from '../../components/ui';
import type { PublicProfile } from '../../lib/onboarding';
import { type useTheme } from '../../theme';
import { TrustBadge } from './ProfileParts';

export function ProviderProfileCallouts({
  pub,
  isPreview,
  unavailable,
  today,
  first,
  idVerified,
  theme: t,
  gutter,
}: {
  pub: PublicProfile | null;
  isPreview: boolean;
  unavailable: boolean;
  today: string | null;
  first: string;
  idVerified: boolean;
  theme: ReturnType<typeof useTheme>;
  gutter: { paddingHorizontal: number };
}) {
  return isPreview || unavailable || pub?.badges ? (
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
      {pub ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: t.spacing.sm }}>
          {idVerified ? <TrustBadge icon="id-card-outline" label="ID verified" /> : null}
          {pub.badges.payout_verified ? <TrustBadge icon="shield-checkmark-outline" label="Bank verified" /> : null}
          {pub.badges.police_verified ? <TrustBadge icon="ribbon-outline" label="Police verified" /> : null}
          {pub.credentials
            .filter((cr) => cr !== 'Police verification certificate')
            .map((cr) => (
              <TrustBadge key={cr} icon="document-text-outline" label={cr} />
            ))}
        </View>
      ) : null}
    </View>
  ) : null;
}

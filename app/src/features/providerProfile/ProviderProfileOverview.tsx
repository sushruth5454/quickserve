import { Ionicons } from '@expo/vector-icons';
import { Fragment } from 'react';
import { View } from 'react-native';
import { Card, Text } from '../../components/ui';
import type { ProviderDetail } from '../../lib/api';
import type { PublicProfile } from '../../lib/onboarding';
import { type useTheme } from '../../theme';
import { StatCell, VDivider } from './ProfileParts';

export function ProviderProfileOverview({
  provider,
  pub,
  rating,
  first,
  today,
  hours,
  theme: t,
  gutter,
}: {
  provider: ProviderDetail['provider'];
  pub: PublicProfile | null;
  rating: number;
  first: string;
  today: string | null;
  hours: string[];
  theme: ReturnType<typeof useTheme>;
  gutter: { paddingHorizontal: number };
}) {
  return (
    <Fragment>
      <View style={gutter}>
        <Card padding={t.spacing.md} style={{ flexDirection: 'row' }}>
          <StatCell value={rating.toFixed(1)} label={`${provider.rating_count} ratings`} icon="star" />
          <VDivider />
          <StatCell value={String(provider.jobs_completed)} label="Jobs done" />
          <VDivider />
          <StatCell value={`${provider.years_experience} yrs`} label="Experience" />
        </Card>
      </View>

      <View style={[gutter, { gap: t.spacing.sm }]}>
        <Text variant="title3" accessibilityRole="header">
          About
        </Text>
        <Text variant="body" color="textSecondary">
          {provider.bio || `${first} hasn't added a bio yet.`}
        </Text>
        {provider.languages.length > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Ionicons name="language-outline" size={16} color={t.colors.muted} />
            <Text variant="footnote" color="muted">
              Speaks {provider.languages.join(', ')}
            </Text>
          </View>
        ) : null}
      </View>

      {pub && (hours.length > 0 || pub.base_area || pub.service_radius_km) ? (
        <View style={[gutter, { gap: t.spacing.sm }]}>
          <Text variant="title3" accessibilityRole="header">
            Area & hours
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Ionicons name="navigate-circle-outline" size={16} color={t.colors.muted} />
            <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
              Serves within {pub.service_radius_km} km of {[pub.base_area, pub.city].filter(Boolean).join(', ')}
            </Text>
          </View>
          {today ? (
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Ionicons name="time-outline" size={16} color={t.colors.muted} />
              <Text variant="footnoteStrong" color={today.startsWith('Available') ? 'successText' : 'textSecondary'}>
                {today}
              </Text>
            </View>
          ) : null}
          {hours.map((h) => (
            <Text key={h} variant="footnote" color="muted" style={{ paddingLeft: 22 }}>
              {h}
            </Text>
          ))}
        </View>
      ) : null}
    </Fragment>
  );
}

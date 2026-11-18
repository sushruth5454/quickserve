import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { ScrollView, View } from 'react-native';
import { Chip, Section, Text } from '../../components/ui';
import { onboardingApi, type PublicProfile } from '../../lib/onboarding';
import { type useTheme } from '../../theme';

export function ProviderPortfolioSection({
  pub,
  theme: t,
  gutter,
}: {
  pub: PublicProfile | null;
  theme: ReturnType<typeof useTheme>;
  gutter: { paddingHorizontal: number };
}) {
  return (
    <>
      {pub && pub.portfolio.length > 0 ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="title3" accessibilityRole="header" style={gutter}>
            Work photos
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm, paddingHorizontal: t.spacing.lg }}>
            {pub.portfolio.map((ph) => (
              <View key={ph.file_path} style={{ width: 160, gap: 4 }}>
                <Image
                  source={{ uri: onboardingApi.publicUrl('portfolio', ph.file_path) }}
                  style={{ width: 160, height: 160, borderRadius: t.radii.md, backgroundColor: t.colors.surfaceAlt }}
                  contentFit="cover"
                  accessibilityLabel={ph.caption || 'Work photo'}
                />
                {ph.caption ? (
                  <Text variant="caption" color="muted" numberOfLines={2}>
                    {ph.caption}
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {pub && pub.links.length > 0 ? (
        <View style={gutter}>
          <Section title="Portfolio links" subtitle="External portfolio links submitted by the provider; not OAuth-verified">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
              {pub.links.map((link) => (
                <Chip
                  key={link.id}
                  label={`${link.handle || link.kind} · Provider-submitted / not verified`}
                  icon="link-outline"
                  onPress={() => void Linking.openURL(link.url)}
                />
              ))}
            </View>
          </Section>
        </View>
      ) : null}
    </>
  );
}

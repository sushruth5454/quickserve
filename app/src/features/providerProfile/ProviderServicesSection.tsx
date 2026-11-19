import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { CategoryIcon, iconForSlug } from '../../components/CategoryIcon';
import { SkillBadge } from '../../components/ProviderCard';
import { ProviderProfileAttributes } from '../../components/ProviderProfileAttributes';
import { ProviderServicePackages } from '../../components/ProviderServicePackages';
import { Section, Text } from '../../components/ui';
import { formatINR } from '../../lib/money';
import type { PublicProfile } from '../../lib/onboarding';
import { haptics } from '../../lib/haptics';
import type { ProviderDetail } from '../../lib/api';
import { type useTheme } from '../../theme';
import { Pill, Radio } from './ProfileParts';

export function ProviderServicesSection({
  services,
  service,
  pub,
  hasInspectQuoteService,
  onSelect,
  theme: t,
  gutter,
}: {
  services: ProviderDetail['services'];
  service: ProviderDetail['services'][number] | undefined;
  pub: PublicProfile | null;
  hasInspectQuoteService: boolean;
  onSelect: (serviceId: string) => void;
  theme: ReturnType<typeof useTheme>;
  gutter: { paddingHorizontal: number };
}) {
  return (
    <View style={gutter}>
      <Section title="Services & rates" subtitle={services.length > 1 ? 'Choose the service you want to book' : undefined}>
        {services.map((s) => {
          const active = s.id === service?.id;
          return (
            <Pressable
              key={s.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${s.categories?.name}, ${
                s.categories?.archetype === 'fixed'
                  ? 'fixed-price packages'
                  : s.categories?.archetype === 'time_based'
                    ? 'session packages'
                    : s.categories?.archetype === 'proposal'
                      ? 'proposals'
                      : `visit fee ${formatINR(s.visit_fee)}`
              }`}
              onPress={() => {
                haptics.select();
                onSelect(s.id);
              }}
              style={{
                borderRadius: t.radii.lg,
                borderWidth: active && services.length > 1 ? 2 : 1,
                borderColor: active && services.length > 1 ? t.colors.primary : t.colors.border,
                backgroundColor: t.colors.surface,
                padding: active && services.length > 1 ? t.spacing.lg - 1 : t.spacing.lg,
                gap: t.spacing.md,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                <CategoryIcon icon={iconForSlug(s.categories?.slug)} size={44} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="title3">{s.categories?.name ?? 'Service'}</Text>
                  <SkillBadge level={s.skill_level} />
                </View>
                {services.length > 1 ? <Radio selected={active} /> : null}
              </View>
              {s.categories?.archetype === 'proposal' ? (
                <Text variant="footnote" color="textSecondary">
                  Sends a fixed, itemised proposal for your brief. You pay an advance only after accepting it.
                </Text>
              ) : s.categories?.archetype === 'fixed' || s.categories?.archetype === 'time_based' ? null : (
                <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                  <Pill label="Visit fee" value={formatINR(s.visit_fee)} />
                  <Pill label={`Labour per ${s.rate_unit}`} value={formatINR(s.labour_rate)} />
                </View>
              )}
              {(() => {
                const sp = pub?.specialisations.find((x) => x.category_id === s.category_id);
                const tags = [...(sp?.labels ?? []), ...(sp?.brands ?? [])];
                return tags.length ? (
                  <Text variant="footnote" color="textSecondary">
                    {tags.join(' · ')}
                  </Text>
                ) : null;
              })()}
              {(() => {
                const sp = pub?.specialisations.find((x) => x.category_id === s.category_id);
                return sp ? <ProviderProfileAttributes schema={sp.schema} attributes={sp.attributes} /> : null;
              })()}
              {(s.rate_card_items ?? []).length > 0 ? (
                <View style={{ gap: t.spacing.sm }}>
                  <Text variant="footnoteStrong" color="muted">
                    Rate card
                  </Text>
                  {(s.rate_card_items ?? []).map((r) => (
                    <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                      <Text variant="callout" color="textSecondary" style={{ flexShrink: 1 }}>
                        {r.title}
                      </Text>
                      <View style={{ flex: 1, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: t.colors.borderStrong, marginTop: 8 }} />
                      <Text variant="calloutStrong" tabular>
                        {formatINR(r.price)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <ProviderServicePackages packages={s.service_packages ?? []} />
            </Pressable>
          );
        })}
        {hasInspectQuoteService ? (
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }}>
            <Ionicons name="information-circle-outline" size={16} color={t.colors.muted} style={{ marginTop: 1 }} />
            <Text variant="footnote" color="muted" style={{ flex: 1 }}>
              The visit fee is adjusted in the final bill. You approve an itemised quote before any work starts.
            </Text>
          </View>
        ) : null}
      </Section>
    </View>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryIcon, iconForSlug } from '../../src/components/CategoryIcon';
import { SkillBadge, VerifiedMark } from '../../src/components/ProviderCard';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  IconButton,
  RatingStars,
  Screen,
  Section,
  Skeleton,
  Text,
} from '../../src/components/ui';
import { getProviderDetail, type ProviderDetail } from '../../src/lib/api';
import { haptics } from '../../src/lib/haptics';
import { formatINR } from '../../src/lib/money';
import type { Review } from '../../src/lib/types';
import { useTheme } from '../../src/theme';

function avg(reviews: Review[], key: 'punctuality' | 'quality' | 'behaviour' | 'pricing') {
  const vals = reviews.map((r) => r[key]).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export default function ProviderDetailScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await getProviderDetail(id);
      setDetail(d);
      setSelected((s) => s ?? d.services[0]?.id ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const breakdown = useMemo(() => {
    const reviews = detail?.reviews ?? [];
    const counts = [5, 4, 3, 2, 1].map((s) => reviews.filter((r) => Math.round(r.rating) === s).length);
    return { counts, total: reviews.length };
  }, [detail]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!detail) {
    return (
      <Screen safeTop>
        <IconButton icon="chevron-back" accessibilityLabel="Go back" onPress={back} />
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <View style={{ alignItems: 'center', gap: t.spacing.md }}>
            <Skeleton width={96} height={96} radius={48} />
            <Skeleton width={180} height={22} />
            <Skeleton width={240} height={14} />
            <Skeleton height={80} radius={t.radii.lg} />
            <Skeleton height={180} radius={t.radii.lg} />
          </View>
        )}
      </Screen>
    );
  }

  const { provider, services, reviews } = detail;
  const name = provider.profiles?.full_name || 'Provider';
  const first = name.split(' ')[0];
  const rating = Number(provider.rating_avg);
  const service = services.find((s) => s.id === selected) ?? services[0];
  const subs = [
    ['Punctuality', avg(reviews, 'punctuality')],
    ['Quality', avg(reviews, 'quality')],
    ['Behaviour', avg(reviews, 'behaviour')],
    ['Fair price', avg(reviews, 'pricing')],
  ] as const;
  const visibleReviews = showAll ? reviews : reviews.slice(0, 4);

  return (
    <Screen
      padded={false}
      gap={t.spacing.xl}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
      footer={
        service ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
            <View>
              <Text variant="caption" color="muted">
                {service.categories?.name} · visit fee
              </Text>
              <Text variant="title2" tabular>
                {formatINR(service.visit_fee)}
              </Text>
            </View>
            <Button
              title={`Book ${first}`}
              rightIcon="arrow-forward"
              size="lg"
              style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/book/[providerServiceId]', params: { providerServiceId: service.id } })}
            />
          </View>
        ) : undefined
      }
    >
      {/* Hero */}
      <View>
        <LinearGradient
          colors={[t.colors.heroFrom, t.colors.heroTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ height: insets.top + 120, paddingTop: insets.top, paddingHorizontal: t.spacing.xs }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <IconButton icon="chevron-back" accessibilityLabel="Go back" onPress={back} variant="glass" />
            <IconButton icon="share-outline" accessibilityLabel="Share profile" onPress={() => haptics.tap()} variant="glass" />
          </View>
        </LinearGradient>
        <View style={{ alignItems: 'center', marginTop: -52, paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}>
          <View style={{ borderRadius: 56, borderWidth: 4, borderColor: t.colors.bg }}>
            <Avatar name={name} uri={provider.profiles?.avatar_url} size={96} online={provider.is_online} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="title1" accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1 }}>
              {name}
            </Text>
            <VerifiedMark size={22} />
          </View>
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Badge label="KYC verified" tone="success" icon="shield-checkmark" />
            <Badge label={provider.is_online ? 'Online now' : 'Offline'} tone={provider.is_online ? 'success' : 'neutral'} dot />
            <Badge label={provider.city} tone="neutral" icon="location" />
          </View>
        </View>
      </View>

      {/* Stats */}
      <View style={{ paddingHorizontal: t.spacing.lg }}>
        <Card padding={t.spacing.md} style={{ flexDirection: 'row' }}>
          <StatCell value={rating.toFixed(1)} label={`${provider.rating_count} reviews`} icon="star" iconColor={t.colors.star} />
          <VDivider />
          <StatCell value={String(provider.jobs_completed)} label="Jobs done" icon="briefcase" iconColor={t.colors.primary} />
          <VDivider />
          <StatCell value={`${provider.years_experience} yrs`} label="Experience" icon="ribbon" iconColor={t.colors.success} />
        </Card>
      </View>

      {/* About */}
      <View style={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}>
        <Text variant="title3">About</Text>
        <Text variant="body" color="textSecondary">
          {provider.bio || `${first} hasn't added a bio yet.`}
        </Text>
        {provider.languages.length > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Ionicons name="language-outline" size={16} color={t.colors.muted} />
            <Text variant="callout" color="muted">
              Speaks {provider.languages.join(', ')}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Services */}
      <View style={{ paddingHorizontal: t.spacing.lg }}>
        <Section title="Services & rates" subtitle={services.length > 1 ? 'Choose the service you want to book' : undefined}>
          {services.map((s) => {
            const active = s.id === service?.id;
            return (
              <Pressable
                key={s.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                accessibilityLabel={`${s.categories?.name}, visit fee ${formatINR(s.visit_fee)}`}
                onPress={() => {
                  haptics.select();
                  setSelected(s.id);
                }}
                style={[
                  {
                    borderRadius: t.radii.lg,
                    borderWidth: active ? 2 : 1,
                    borderColor: active ? t.colors.primary : t.colors.border,
                    backgroundColor: t.colors.surface,
                    padding: t.spacing.lg,
                    gap: t.spacing.md,
                  },
                  t.shadows.sm,
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                  <CategoryIcon icon={iconForSlug(s.categories?.slug)} size={44} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text variant="title3">{s.categories?.name ?? 'Service'}</Text>
                    <SkillBadge level={s.skill_level} />
                  </View>
                  {services.length > 1 ? (
                    <Ionicons
                      name={active ? 'radio-button-on' : 'radio-button-off'}
                      size={22}
                      color={active ? t.colors.primary : t.colors.borderStrong}
                    />
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                  <Pill label="Visit fee" value={formatINR(s.visit_fee)} />
                  <Pill label={`Labour / ${s.rate_unit}`} value={formatINR(s.labour_rate)} />
                </View>
                {(s.rate_card_items ?? []).length > 0 ? (
                  <View style={{ gap: t.spacing.sm }}>
                    <Text variant="micro" color="muted" uppercase>
                      Rate card
                    </Text>
                    {(s.rate_card_items ?? []).map((r) => (
                      <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                        <Text variant="callout" color="textSecondary" style={{ flexShrink: 1 }}>
                          {r.title}
                        </Text>
                        <View style={{ flex: 1, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: t.colors.borderStrong, marginTop: 8 }} />
                        <Text variant="subhead" tabular>
                          {formatINR(r.price)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <Text variant="caption" color="muted">
                  The visit fee is adjusted in the final bill. You approve an itemised quote before any work starts.
                </Text>
              </Pressable>
            );
          })}
        </Section>
      </View>

      {/* Ratings */}
      <View style={{ paddingHorizontal: t.spacing.lg }}>
        <Section title="Ratings & reviews">
          <Card gap={t.spacing.lg}>
            <View style={{ flexDirection: 'row', gap: t.spacing.xl, alignItems: 'center' }}>
              <View style={{ alignItems: 'center', gap: 4, minWidth: 92 }}>
                <Text variant="display" style={{ fontSize: 40, lineHeight: 46 }}>
                  {rating.toFixed(1)}
                </Text>
                <RatingStars value={rating} size={14} count={provider.rating_count} />
                <Text variant="caption" color="muted">
                  {provider.rating_count} ratings
                </Text>
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                {breakdown.counts.map((c, i) => {
                  const star = 5 - i;
                  const pct = breakdown.total ? c / breakdown.total : 0;
                  return (
                    <View
                      key={star}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                      accessible
                      accessibilityLabel={`${star} stars: ${Math.round(pct * 100)} percent`}
                    >
                      <Text variant="caption" color="muted" style={{ width: 10 }}>
                        {star}
                      </Text>
                      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
                        <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: t.colors.star }} />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
            {subs.some(([, v]) => v != null) ? (
              <>
                <Divider />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: t.spacing.md }}>
                  {subs.map(([label, v]) =>
                    v != null ? (
                      <View key={label} style={{ width: '50%', gap: 2 }}>
                        <Text variant="caption" color="muted">
                          {label}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Ionicons name="star" size={13} color={t.colors.star} />
                          <Text variant="subhead">{v.toFixed(1)}</Text>
                        </View>
                      </View>
                    ) : null,
                  )}
                </View>
              </>
            ) : null}
          </Card>
          {reviews.length === 0 ? (
            <Text variant="callout" color="muted">
              No reviews yet.
            </Text>
          ) : null}
          {visibleReviews.map((r) => (
            <Card key={r.id} variant="outlined" gap={t.spacing.sm}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: t.colors.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="person" size={18} color={t.colors.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="subhead">Verified customer</Text>
                  <Text variant="caption" color="muted">
                    {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                </View>
                <RatingStars value={r.rating} size={13} />
              </View>
              {r.comment ? (
                <Text variant="callout" color="textSecondary">
                  {r.comment}
                </Text>
              ) : null}
              {r.provider_reply ? (
                <View style={{ backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.sm, padding: t.spacing.md, gap: 2 }}>
                  <Text variant="captionStrong">Reply from {first}</Text>
                  <Text variant="caption" color="textSecondary">
                    {r.provider_reply}
                  </Text>
                </View>
              ) : null}
            </Card>
          ))}
          {reviews.length > 4 ? (
            <Button
              title={showAll ? 'Show fewer reviews' : `Show all ${reviews.length} reviews`}
              variant="ghost"
              onPress={() => setShowAll((s) => !s)}
            />
          ) : null}
        </Section>
      </View>
    </Screen>
  );
}

function StatCell({ value, label, icon, iconColor }: { value: string; label: string; icon: keyof typeof Ionicons.glyphMap; iconColor: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name={icon} size={15} color={iconColor} />
        <Text variant="title3">{value}</Text>
      </View>
      <Text variant="caption" color="muted">
        {label}
      </Text>
    </View>
  );
}

function VDivider() {
  const t = useTheme();
  return <View style={{ width: 1, backgroundColor: t.colors.border, marginVertical: 6 }} />;
}

function Pill({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.md, paddingVertical: 10, paddingHorizontal: 12, gap: 2 }}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text variant="bodyStrong" tabular>
        {value}
      </Text>
    </View>
  );
}

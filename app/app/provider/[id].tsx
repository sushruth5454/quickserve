import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryIcon, iconForSlug } from '../../src/components/CategoryIcon';
import { SkillBadge, VerifiedMark } from '../../src/components/ProviderCard';
import { Avatar, Button, Card, Divider, ErrorState, IconButton, RatingStars, Screen, Section, Skeleton, Text } from '../../src/components/ui';
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
        <IconButton icon="chevron-back" accessibilityLabel="Go back" onPress={back} variant="neutral" />
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
  const gutter = { paddingHorizontal: t.spacing.lg };

  return (
    <Screen
      padded={false}
      gap={t.spacing.section}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
      footer={
        service ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
            <View style={{ flexShrink: 1 }}>
              <Text variant="caption" color="muted" numberOfLines={1}>
                {service.categories?.name} · visit fee
              </Text>
              <Text variant="title2" tabular>
                {formatINR(service.visit_fee)}
              </Text>
            </View>
            <Button
              title={`Book ${first}`}
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
          style={{ height: insets.top + 112, paddingTop: insets.top + t.spacing.xs, paddingHorizontal: t.spacing.md }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <IconButton icon="chevron-back" accessibilityLabel="Go back" onPress={back} variant="glass" visualSize={40} />
            <IconButton icon="share-outline" accessibilityLabel="Share profile" onPress={() => haptics.tap()} variant="glass" visualSize={40} size={20} />
          </View>
        </LinearGradient>
        <View style={{ alignItems: 'center', marginTop: -48, paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}>
          <View style={{ borderRadius: 52, borderWidth: 4, borderColor: t.colors.bg }}>
            <Avatar name={name} uri={provider.profiles?.avatar_url} size={88} online={provider.is_online} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <Text variant="title1" accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1 }}>
              {name}
            </Text>
            <VerifiedMark size={20} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', columnGap: 10, rowGap: 4 }}>
            <MetaChip icon="shield-checkmark-outline" label="KYC verified" />
            <Text variant="footnote" color="muted">·</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: provider.is_online ? t.colors.success : t.colors.outline }} />
              <Text variant="footnote" color="textSecondary">
                {provider.is_online ? 'Online' : 'Offline'}
              </Text>
            </View>
            <Text variant="footnote" color="muted">·</Text>
            <MetaChip icon="location-outline" label={provider.city} />
          </View>
        </View>
      </View>

      {/* Stats */}
      <View style={gutter}>
        <Card padding={t.spacing.md} style={{ flexDirection: 'row' }}>
          <StatCell value={rating.toFixed(1)} label={`${provider.rating_count} ratings`} icon="star" />
          <VDivider />
          <StatCell value={String(provider.jobs_completed)} label="Jobs done" />
          <VDivider />
          <StatCell value={`${provider.years_experience} yrs`} label="Experience" />
        </Card>
      </View>

      {/* About */}
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

      {/* Services */}
      <View style={gutter}>
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
                <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                  <Pill label="Visit fee" value={formatINR(s.visit_fee)} />
                  <Pill label={`Labour per ${s.rate_unit}`} value={formatINR(s.labour_rate)} />
                </View>
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
              </Pressable>
            );
          })}
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }}>
            <Ionicons name="information-circle-outline" size={16} color={t.colors.muted} style={{ marginTop: 1 }} />
            <Text variant="footnote" color="muted" style={{ flex: 1 }}>
              The visit fee is adjusted in the final bill. You approve an itemised quote before any work starts.
            </Text>
          </View>
        </Section>
      </View>

      {/* Ratings */}
      <View style={gutter}>
        <Section title="Ratings & reviews">
          <Card gap={t.spacing.lg}>
            <View style={{ flexDirection: 'row', gap: t.spacing.xl, alignItems: 'center' }}>
              <View style={{ alignItems: 'center', gap: 4, minWidth: 92 }}>
                <Text variant="display" tabular>
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
                      <Bar pct={pct} color={t.colors.star} />
                    </View>
                  );
                })}
              </View>
            </View>
            {subs.some(([, v]) => v != null) ? (
              <>
                <Divider />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: t.spacing.md, columnGap: t.spacing.lg }}>
                  {subs.map(([label, v]) =>
                    v != null ? (
                      <View key={label} style={{ width: '46%', flexGrow: 1, gap: 6 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text variant="footnote" color="textSecondary">
                            {label}
                          </Text>
                          <Text variant="footnoteStrong" tabular>
                            {v.toFixed(1)}
                          </Text>
                        </View>
                        <Bar pct={v / 5} color={t.colors.primary} />
                      </View>
                    ) : null,
                  )}
                </View>
              </>
            ) : null}
          </Card>
          {reviews.length === 0 ? (
            <Text variant="callout" color="muted">
              No written reviews yet.
            </Text>
          ) : (
            <Card padding={0} gap={0}>
              {visibleReviews.map((r, i) => (
                <Fragment key={r.id}>
                  {i > 0 ? <Divider inset={t.spacing.lg} /> : null}
                  <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                      <View
                        style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Ionicons name="person" size={16} color={t.colors.muted} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text variant="calloutStrong">Verified customer</Text>
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
                        <Text variant="captionStrong" color="textSecondary">
                          Reply from {first}
                        </Text>
                        <Text variant="footnote" color="textSecondary">
                          {r.provider_reply}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Fragment>
              ))}
            </Card>
          )}
          {reviews.length > 4 ? (
            <Button
              title={showAll ? 'Show fewer reviews' : `Show all ${reviews.length} written reviews`}
              variant="ghost"
              onPress={() => setShowAll((s) => !s)}
            />
          ) : null}
        </Section>
      </View>
    </Screen>
  );
}

function MetaChip({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name={icon} size={14} color={t.colors.muted} />
      <Text variant="footnote" color="textSecondary">
        {label}
      </Text>
    </View>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%`, height: 4, borderRadius: 2, backgroundColor: color }} />
    </View>
  );
}

function Radio({ selected }: { selected: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: selected ? 6 : 1.5,
        borderColor: selected ? t.colors.primary : t.colors.outline,
        backgroundColor: t.colors.surface,
      }}
    />
  );
}

function StatCell({ value, label, icon }: { value: string; label: string; icon?: keyof typeof Ionicons.glyphMap }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {icon ? <Ionicons name={icon} size={15} color={t.colors.star} /> : null}
        <Text variant="title3" tabular>
          {value}
        </Text>
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
    <View style={{ flex: 1, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.sm, paddingVertical: 10, paddingHorizontal: 12, gap: 2 }}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text variant="calloutStrong" tabular>
        {value}
      </Text>
    </View>
  );
}

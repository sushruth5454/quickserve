import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryIcon, iconForSlug } from '../../src/components/CategoryIcon';
import { SkillBadge, VerifiedMark } from '../../src/components/ProviderCard';
import { ProviderProfileAttributes } from '../../src/components/ProviderProfileAttributes';
import { ProviderServicePackages } from '../../src/components/ProviderServicePackages';
import { Avatar, Button, Card, Chip, Divider, ErrorState, IconButton, InlineAlert, RatingStars, Screen, Section, Skeleton, Text } from '../../src/components/ui';
import { getProviderDetail, type ProviderDetail } from '../../src/lib/api';
import { haptics } from '../../src/lib/haptics';
import { formatINR } from '../../src/lib/money';
import { onboardingApi, type PublicProfile } from '../../src/lib/onboarding';
import { summarizeHours, todayLabel } from '../../src/lib/onboarding/availability';
import type { Review } from '../../src/lib/types';
import { useTheme } from '../../src/theme';

function avg(reviews: Review[], key: 'punctuality' | 'quality' | 'behaviour' | 'pricing') {
  const vals = reviews.map((r) => r[key]).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export default function ProviderDetailScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { id, preview } = useLocalSearchParams<{ id: string; preview?: string }>();
  const isPreview = preview === '1';
  const [pub, setPub] = useState<PublicProfile | null>(null);
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [d, pp] = await Promise.all([getProviderDetail(id), onboardingApi.getPublicProfile(id).catch(() => null)]);
      setPub(pp);
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
  const now = new Date();
  const today = pub ? todayLabel(pub.hours, now, { onLeaveUntil: pub.on_leave_until }) : null;
  const hours = pub ? summarizeHours(pub.hours) : [];
  const unavailable = !!pub && (pub.paused || !!pub.on_leave_until);
  const idVerified = pub ? pub.badges.id_verified : false;
  const payoutVerified = pub ? pub.badges.payout_verified : provider.kyc_status === 'verified';
  const share = async () => {
    haptics.tap();
    const url = Linking.createURL(`/provider/${provider.id}`);
    await Share.share({ message: `Book ${name} on QuickServe: ${url}`, url }).catch(() => undefined);
  };
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
        service && !isPreview ? (
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
              disabled={unavailable}
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
            <IconButton icon="share-outline" accessibilityLabel="Share profile" onPress={() => void share()} variant="glass" visualSize={40} size={20} />
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
            {payoutVerified ? <VerifiedMark size={20} /> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', columnGap: 10, rowGap: 4 }}>
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

      {isPreview || unavailable || pub?.badges ? (
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
      ) : null}

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
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }}>
            <Ionicons name="information-circle-outline" size={16} color={t.colors.muted} style={{ marginTop: 1 }} />
            <Text variant="footnote" color="muted" style={{ flex: 1 }}>
              The visit fee is adjusted in the final bill. You approve an itemised quote before any work starts.
            </Text>
          </View>
        </Section>
      </View>

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

      {/* Ratings */}
      <View style={gutter}>
        <Section title="Ratings & reviews">
          {pub && pub.review_themes.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs, marginBottom: t.spacing.md }}>
              {pub.review_themes.map((theme) => (
                <Chip key={theme.tag} label={`${theme.tag.replaceAll('_', ' ')} · ${theme.count}`} selected={false} check={false} />
              ))}
            </View>
          ) : null}
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

function TrustBadge({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const t = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.colors.successSoft, borderRadius: t.radii.pill, paddingHorizontal: 10, paddingVertical: 4 }}
    >
      <Ionicons name={icon} size={13} color={t.colors.successText} />
      <Text variant="captionStrong" color="successText">
        {label}
      </Text>
    </View>
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

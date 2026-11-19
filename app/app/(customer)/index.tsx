import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryIcon, iconForCategory } from '../../src/components/CategoryIcon';
import { NotServedCard } from '../../src/components/NotServedCard';
import { TopRatedCard, TopRatedCardSkeleton } from '../../src/components/TopRatedCard';
import { StatusPill, activeStatuses, nextStepCopy } from '../../src/components/status';
import { ProgressBar } from '../../src/components/StatusTimeline';
import { Card, EmptyState, ErrorState, IconButton, InlineAlert, Screen, Section, Skeleton, Text } from '../../src/components/ui';
import { getMyProfile, listMyBookings, listTopRated, type TopRatedProvider } from '../../src/lib/api';
import { aiAssistantEnabled } from '../../src/lib/config';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { needsLocationPrompt } from '../../src/lib/locationModel';
import { useUnread } from '../../src/lib/unreadContext';
import type { Booking, Category } from '../../src/lib/types';
import { useTheme } from '../../src/theme';
import { getCatalogue } from '../../src/features/catalogue/api';
import { CatalogueSections } from '../../src/features/catalogue/CatalogueSections';
import { groupCatalogueFamilies, type Catalogue } from '../../src/features/catalogue/model';

export default function CustomerHome() {
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const aiEnabled = aiAssistantEnabled && flags.isOn('ai_assistant');
  const unread = useUnread();
  const bellCount = unread.total('customer') + unread.notifications;
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { location } = useSelectedLocation();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [topRated, setTopRated] = useState<TopRatedProvider[]>([]);
  const [active, setActive] = useState<Booking | null>(null);
  const [firstName, setFirstName] = useState('');
  const [query, setQuery] = useState('');
  const [selectedFamilySlug, setSelectedFamilySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, tr, bookings, profile] = await Promise.all([
        getCatalogue(location.city),
        listTopRated(10, location.city),
        listMyBookings().catch(() => [] as Booking[]),
        getMyProfile().catch(() => null),
      ]);
      setCategories(c.categories);
      setCatalogue(c);
      setTopRated(tr);
      setActive(bookings.find((b) => activeStatuses.includes(b.status) && b.status !== 'pending_payment') ?? null);
      setFirstName(profile?.full_name?.split(' ')[0] ?? '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [location.city]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedFamilySlug(null);
    setQuery('');
  }, [location.city]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const families = useMemo(() => groupCatalogueFamilies(catalogue?.verticals ?? []), [catalogue?.verticals]);
  const selectedFamily = families.find((family) => family.slug === selectedFamilySlug) ?? null;
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return (catalogue?.categories ?? []).filter((category) => {
      const familyMatches = !selectedFamily || selectedFamily.verticalSlugs.includes(category.vertical ?? 'other');
      return familyMatches && category.name.toLowerCase().includes(text);
    });
  }, [catalogue?.categories, query, selectedFamily]);
  // Keep the marketplace usable if services are not live but Sports or Shops are.
  const noServiceCategories = categories !== null && categories.length === 0;
  const unserved = noServiceCategories && !flags.isOn('sports') && !flags.isOn('products');
  const activeCity = active?.providers?.city ?? null;
  const activeCard = active ? (
    <Card
      variant="elevated"
      onPress={() => router.push({ pathname: '/booking/[id]', params: { id: active.id } })}
      accessibilityLabel={`Active booking ${active.categories?.name ?? ''}${noServiceCategories && activeCity ? ` in ${activeCity}` : ''}. ${nextStepCopy[active.status] ?? ''}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <CategoryIcon icon={iconForCategory(categories?.find((c) => c.slug === active.categories?.slug) ?? active.categories)} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" color="muted">
            {noServiceCategories ? 'Your active booking' : 'Active booking'}
          </Text>
          <Text variant="bodyStrong" numberOfLines={1}>
            {active.categories?.name ?? 'Booking'}
            {noServiceCategories && activeCity ? ` in ${activeCity}` : ''}
          </Text>
        </View>
        <StatusPill status={active.status} />
      </View>
      <ProgressBar status={active.status} showLabel={false} archetype={active.archetype} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
        <Text variant="footnote" color="textSecondary" style={{ flex: 1 }} numberOfLines={2}>
          {nextStepCopy[active.status] ?? 'View booking details'}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={t.colors.subtle} />
      </View>
    </Card>
  ) : null;
  const gutter = { paddingHorizontal: t.spacing.lg };
  // ~72% of the screen so the next card peeks; capped for tablets/web.
  const cardWidth = Math.min(300, Math.round(windowWidth * 0.72));

  return (
    <Screen inTabs padded={false} refreshing={refreshing} onRefresh={refresh} gap={t.spacing.section}>
      {/* Header */}
      <View style={[gutter, { paddingTop: insets.top + t.spacing.sm, gap: t.spacing.xl }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Service location: ${[location.label, location.area, location.city].filter(Boolean).join(', ')}. Tap to change.`}
            onPress={() => router.push('/location')}
            style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, minHeight: 48, opacity: pressed ? 0.7 : 1 })}
          >
            <View
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name={location.source === 'gps' ? 'navigate' : 'location'} size={20} color={t.colors.primaryText} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="caption" color="muted" numberOfLines={1}>
                {location.label ?? (location.source === 'gps' ? 'Current location' : 'Service location')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text variant="calloutStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {location.area}
                  {location.city && location.city !== location.area ? `, ${location.city}` : ''}
                </Text>
                <Ionicons name="chevron-down" size={16} color={t.colors.muted} />
              </View>
            </View>
          </Pressable>
          <IconButton
            icon="notifications-outline"
            accessibilityLabel={bellCount ? `Notifications, ${bellCount} unread` : 'Notifications'}
            onPress={() => router.push('/notifications')}
            variant="neutral"
            badge={bellCount}
          />
        </View>

        {needsLocationPrompt(location) ? (
          <InlineAlert
            message="Set your location to see pros near you"
            actionLabel="Set location"
            onAction={() => router.push('/location')}
          />
        ) : null}

        <View style={{ gap: 4 }}>
          <Text variant="title1" accessibilityRole="header">
            {firstName ? `Hi ${firstName}` : 'Hi there'}
          </Text>
          <Text variant="body" color="muted">
            What do you need help with today?
          </Text>
        </View>

        {noServiceCategories ? null : (
        <View
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.spacing.sm,
              minHeight: 48,
              borderRadius: t.radii.md,
              backgroundColor: t.colors.surface,
              borderWidth: 1,
              borderColor: t.colors.borderStrong,
              paddingLeft: t.spacing.md,
              paddingRight: t.spacing.xs,
            },
            t.shadows.sm,
          ]}
        >
          <Ionicons name="search" size={20} color={t.colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder='Search "AC repair", "plumber"…'
            placeholderTextColor={t.colors.muted}
            accessibilityLabel="Search services"
            returnKeyType="search"
            style={{ flex: 1, minHeight: 44, color: t.colors.text, fontFamily: t.fontFamily.regular, fontSize: 16, outlineStyle: 'none' } as never}
          />
          {query ? (
            <IconButton icon="close-circle" accessibilityLabel="Clear search" onPress={() => setQuery('')} color="muted" size={20} visualSize={40} />
          ) : null}
        </View>
        )}

      </View>

      {error && !categories ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {unserved ? (
        <View style={gutter}>
          <NotServedCard />
        </View>
      ) : (
        <View style={[gutter, { gap: t.spacing.lg }]}>
          {selectedFamily ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
              <IconButton
                icon="arrow-back"
                accessibilityLabel="Back to categories"
                onPress={() => {
                  setSelectedFamilySlug(null);
                  setQuery('');
                }}
                variant="neutral"
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="title3" accessibilityRole="header">{selectedFamily.label}</Text>
                <Text variant="footnote" color="muted">Choose a service to see available pros</Text>
              </View>
            </View>
          ) : null}

          {selectedFamily || query.trim() ? (
            <Section title={selectedFamily ? 'Choose a service' : 'Matching services'}>
              {!categories ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <View key={i} style={{ width: '47%', alignItems: 'center', gap: 8 }}>
                      <Skeleton width={64} height={64} radius={t.radii.lg} />
                      <Skeleton width={90} height={12} />
                    </View>
                  ))}
                </View>
              ) : filtered.length === 0 ? (
                <EmptyState
                  compact
                  icon="search"
                  title="No matching service"
                  message={aiEnabled ? `We don't have "${query}" yet. Try another word, or describe the problem to QuickServe AI.` : `We don't have "${query}" yet. Try another word.`}
                  actionLabel={aiEnabled ? 'Ask QuickServe AI' : undefined}
                  onAction={aiEnabled ? () => router.push({ pathname: '/assistant', params: { q: query.trim() } }) : undefined}
                />
              ) : (
                <CatalogueSections verticals={catalogue?.verticals ?? []} filter={query} verticalSlugs={selectedFamily?.verticalSlugs} />
              )}
            </Section>
          ) : (
            <Section title="Choose a category">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
                {!categories
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <Card key={i} style={{ width: '47%' }}>
                        <View style={{ gap: t.spacing.sm }}>
                          <Skeleton width={36} height={36} radius={18} />
                          <Skeleton width={120} height={14} />
                          <Skeleton width={150} height={10} />
                        </View>
                      </Card>
                    ))
                  : families.map((family) => (
                      <BrowseFamilyCard
                        key={family.slug}
                        label={family.label}
                        description={descriptionForFamily(family.slug)}
                        icon={iconForFamily(family.slug)}
                        onPress={() => {
                          setQuery('');
                          setSelectedFamilySlug(family.slug);
                        }}
                      />
                    ))}
                {flags.isOn('sports') ? (
                  <BrowseFamilyCard
                    label="Sports & venues"
                    description="Find a court or request a slot"
                    icon="football-outline"
                    onPress={() => router.push('/sports')}
                  />
                ) : null}
                {flags.isOn('products') ? (
                  <BrowseFamilyCard
                    label="Shop local"
                    description="Browse products from nearby shops"
                    icon="storefront-outline"
                    onPress={() => router.push('/shop')}
                  />
                ) : null}
              </View>
            </Section>
          )}
        </View>
      )}

      {active ? <View style={gutter}>{activeCard}</View> : null}

      {aiEnabled && !noServiceCategories ? (
        <View style={gutter}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask QuickServe AI"
            accessibilityHint="Describe the problem by text or voice and get a pre-filled booking"
            onPress={() => router.push('/assistant')}
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.md,
                padding: t.spacing.md,
                borderRadius: t.radii.lg,
                backgroundColor: t.colors.primarySoft,
                borderWidth: 1,
                borderColor: t.dark ? t.colors.border : 'transparent',
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.colors.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="sparkles" size={22} color={t.colors.onPrimary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="calloutStrong" color="primaryText">
                Ask QuickServe AI
              </Text>
              <Text variant="footnote" color="textSecondary" numberOfLines={2}>
                Describe the problem, or speak in English, हिंदी or తెలుగు
              </Text>
            </View>
            <Ionicons name="mic-outline" size={20} color={t.colors.primaryText} />
          </Pressable>
        </View>
      ) : null}

      {/* Guarantee banner */}
      <View style={gutter}>
        <LinearGradient
          colors={[t.colors.heroFrom, t.colors.heroTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: t.radii.lg, padding: t.spacing.xl, flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="title3" style={{ color: '#FFFFFF' }}>
              Know what happens next
            </Text>
            <Text variant="footnote" style={{ color: 'rgba(255,255,255,0.9)' }}>
              Review service quotes, venue details, or shop offers before deciding. Payment steps depend on what you choose.
            </Text>
          </View>
          <View
            style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="shield-checkmark-outline" size={24} color="#FFFFFF" />
          </View>
        </LinearGradient>
      </View>

      {/* Top rated */}
      {unserved || noServiceCategories || selectedFamily || query.trim() || (categories && topRated.length === 0) ? null : (
        <View style={{ gap: t.spacing.md }}>
          <View style={gutter}>
            <Section
              title="Top rated near you"
              subtitle="Verified pros with the best reviews"
              actionLabel="See all"
              onAction={() => router.push('/top-rated')}
            >
              {null}
            </Section>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.md, paddingTop: 2, paddingBottom: t.spacing.sm }}
            decelerationRate="fast"
            snapToInterval={cardWidth + t.spacing.md}
            snapToAlignment="start"
            disableIntervalMomentum
          >
            {!categories
              ? [0, 1].map((i) => <TopRatedCardSkeleton key={i} width={cardWidth} />)
              : topRated.map((p) => (
                  <TopRatedCard
                    key={p.id}
                    provider={p}
                    width={cardWidth}
                    onPress={() => router.push({ pathname: '/provider/[id]', params: { id: p.id } })}
                  />
                ))}
          </ScrollView>
        </View>
      )}
    </Screen>
  );
}

function iconForFamily(slug: string): ComponentProps<typeof Ionicons>['name'] {
  switch (slug) {
    case 'home': return 'home-outline';
    case 'creative-events': return 'camera-outline';
    case 'beauty-wellness': return 'heart-outline';
    case 'learning': return 'school-outline';
    default: return 'grid-outline';
  }
}

function descriptionForFamily(slug: string): string {
  switch (slug) {
    case 'home': return 'Repairs, cleaning, and vehicle care';
    case 'creative-events': return 'Creators, photos, videos, and events';
    case 'beauty-wellness': return 'Beauty and personal care';
    case 'learning': return 'Tutors and learning sessions';
    default: return 'Explore more local services';
  }
}

function BrowseFamilyCard({
  label,
  description,
  icon,
  onPress,
}: {
  label: string;
  description: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Card onPress={onPress} style={{ width: '47%' }} accessibilityLabel={label}>
      <View style={{ minHeight: 116, gap: t.spacing.sm }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: t.colors.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={22} color={t.colors.primaryText} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="calloutStrong" numberOfLines={2}>{label}</Text>
          <Text variant="caption" color="muted" numberOfLines={2}>{description}</Text>
        </View>
      </View>
    </Card>
  );
}

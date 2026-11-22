import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, TextInput, useWindowDimensions, View, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryIcon, iconForCategory } from '../../components/CategoryIcon';
import { ChipRow } from '../../components/market/ChipRow';
import { PillarCard } from '../../components/market/PillarCard';
import { SearchField } from '../../components/market/SearchField';
import { TrustStrip } from '../../components/market/TrustStrip';
import { visiblePillars, type Pillar } from '../../components/market/pillars';
import { NotServedCard } from '../../components/NotServedCard';
import { TopRatedCard } from '../../components/TopRatedCard';
import { StatusPill, activeStatuses, nextStepCopy } from '../../components/status';
import { ProgressBar } from '../../components/StatusTimeline';
import { Card, EmptyState, ErrorState, IconButton, InlineAlert, Screen, Section, Skeleton, Text } from '../../components/ui';
import { useT } from '../../i18n';
import { listMyBookings, listTopRated, type TopRatedProvider } from '../../lib/api';
import { aiAssistantEnabled } from '../../lib/config';
import { useSelectedLocation } from '../../lib/locationContext';
import { needsLocationPrompt } from '../../lib/locationModel';
import { useUnread } from '../../lib/unreadContext';
import { useEntityRefresh } from '../../lib/useEntityRefresh';
import type { Booking, Category } from '../../lib/types';
import { useTheme } from '../../theme';
import { getCatalogue } from '../catalogue/api';
import { CatalogueSections } from '../catalogue/CatalogueSections';
import { groupCatalogueFamilies, type Catalogue } from '../catalogue/model';
import { homeFeatureState, pillarInputs, popularCategories, type HomeFlagReader } from './homeModel';

const PILLAR_COPY = {
  home: { title: 'pillar.home', subtitle: 'pillar.home.sub' },
  shops: { title: 'pillar.shops', subtitle: 'pillar.shops.sub' },
  sports: { title: 'pillar.sports', subtitle: 'pillar.sports.sub' },
  creators: { title: 'pillar.creators', subtitle: 'pillar.creators.sub' },
} as const;

export function HomeV2({ flags }: { flags: HomeFlagReader }) {
  const t = useTheme();
  const translate = useT();
  const { unifiedSearch } = homeFeatureState(flags);
  const aiEnabled = aiAssistantEnabled && flags.isOn('ai_assistant');
  const unread = useUnread();
  const bellCount = unread.total('customer') + unread.notifications;
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { location } = useSelectedLocation();
  const cityScope = JSON.stringify([location.city]);
  const [catalogueResult, setCatalogueResult] = useState<{ scope: string; value: Catalogue } | null>(null);
  const [topRatedResult, setTopRatedResult] = useState<{ scope: string; value: TopRatedProvider[] } | null>(null);
  const [activeResult, setActiveResult] = useState<{ scope: string; value: Booking | null } | null>(null);
  const [catalogueFailure, setCatalogueFailure] = useState<{ scope: string; message: string } | null>(null);
  const [topRatedFailure, setTopRatedFailure] = useState<{ scope: string; message: string } | null>(null);
  const [activeFailure, setActiveFailure] = useState<{ scope: string; message: string } | null>(null);
  const [query, setQuery] = useState('');
  const [selectedFamilySlug, setSelectedFamilySlug] = useState<string | null>(null);
  const catalogue = catalogueResult?.scope === cityScope ? catalogueResult.value : null;
  const categories: Category[] | null = catalogue?.categories ?? null;
  const topRated = topRatedResult?.scope === cityScope ? topRatedResult.value : [];
  const active = activeResult?.scope === 'active-work' ? activeResult.value : null;
  const catalogueError = catalogueFailure?.scope === cityScope ? catalogueFailure.message : null;
  const topRatedError = topRatedFailure?.scope === cityScope ? topRatedFailure.message : null;
  const activeError = activeFailure?.scope === 'active-work' ? activeFailure.message : null;

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    const scope = cityScope;
    const city = location.city;
    setCatalogueFailure((current) => current?.scope === scope ? null : current);
    setTopRatedFailure((current) => current?.scope === scope ? null : current);
    setActiveFailure((current) => current?.scope === 'active-work' ? null : current);
    await Promise.all([
      getCatalogue(city)
        .then((value) => {
          if (guard.isCurrent()) setCatalogueResult({ scope, value });
        })
        .catch((error: Error) => {
          if (guard.isCurrent()) setCatalogueFailure({ scope, message: error.message });
        }),
      listTopRated(10, city)
        .then((value) => {
          if (guard.isCurrent()) setTopRatedResult({ scope, value });
        })
        .catch((error: Error) => {
          if (guard.isCurrent()) setTopRatedFailure({ scope, message: error.message });
        }),
      listMyBookings()
        .then((bookings) => {
          if (guard.isCurrent()) {
            setActiveResult({
              scope: 'active-work',
              value: bookings.find((booking) => activeStatuses.includes(booking.status) && booking.status !== 'pending_payment') ?? null,
            });
          }
        })
        .catch((error: Error) => {
          if (guard.isCurrent()) setActiveFailure({ scope: 'active-work', message: error.message });
        }),
    ]);
  }, [cityScope, location.city]);

  const { refresh, refreshing } = useEntityRefresh(load, {
    contextKey: cityScope,
    enabled: true,
    intervalMs: null,
  });

  useEffect(() => {
    setSelectedFamilySlug(null);
    setQuery('');
  }, [location.city]);

  const families = useMemo(() => groupCatalogueFamilies(catalogue?.verticals ?? []), [catalogue?.verticals]);
  const selectedFamily = useMemo(() => {
    if (selectedFamilySlug !== 'home') {
      return families.find((family) => family.slug === selectedFamilySlug) ?? null;
    }
    const homeFamily = families.find((family) => family.slug === 'home');
    const creatorVerticals = families.find((family) => family.slug === 'creative-events')?.verticalSlugs ?? [];
    return {
      slug: 'home',
      label: homeFamily?.label ?? translate('pillar.home'),
      verticalSlugs: (catalogue?.verticals ?? [])
        .map((vertical) => vertical.slug)
        .filter((slug) => !creatorVerticals.includes(slug)),
    };
  }, [catalogue?.verticals, families, selectedFamilySlug, translate]);
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return (catalogue?.categories ?? []).filter((category) => {
      const familyMatches = !selectedFamily || selectedFamily.verticalSlugs.includes(category.vertical ?? 'other');
      return familyMatches && category.name.toLowerCase().includes(text);
    });
  }, [catalogue?.categories, query, selectedFamily]);
  const homePillars = visiblePillars(pillarInputs(catalogue, flags));
  const popular = popularCategories(catalogue);
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
        <CategoryIcon icon={iconForCategory(categories?.find((category) => category.slug === active.categories?.slug) ?? active.categories)} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" color="muted">
            {noServiceCategories ? 'Your active booking' : translate('home.activeBooking')}
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
  const cardWidth = Math.min(300, Math.round(windowWidth * 0.72));
  const singleColumnPillars = windowWidth < 360;
  const pillarCardWidth = singleColumnPillars ? '100%' : '48%';
  const searchInputTypography: TextStyle = { ...t.typography.body, lineHeight: undefined };
  const city = location.city || location.area;

  const onPillarPress = (pillar: Pillar) => {
    if (pillar === 'home') {
      setQuery('');
      setSelectedFamilySlug('home');
      return;
    }
    if (pillar === 'creators') {
      if (flags.isOn('creators_landing')) {
        router.push('/creators');
      } else {
        setQuery('');
        setSelectedFamilySlug('creative-events');
      }
      return;
    }
    if (pillar === 'shops') router.push('/shop');
    if (pillar === 'sports') router.push('/sports');
  };

  const renderInlineSearch = !unifiedSearch && !noServiceCategories ? (
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
        style={[
          searchInputTypography,
          { flex: 1, minHeight: 44, color: t.colors.text },
          Platform.OS === 'web' ? { outlineWidth: 0 } : undefined,
        ]}
      />
      {query ? (
        <IconButton icon="close-circle" accessibilityLabel="Clear search" onPress={() => setQuery('')} color="muted" size={20} visualSize={40} />
      ) : null}
    </View>
  ) : null;

  return (
    <Screen inTabs padded={false} refreshing={refreshing} onRefresh={() => void refresh()} gap={t.spacing.section}>
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

        {unifiedSearch ? (
          <SearchField
            mode="entry"
            placeholder={translate('home.searchPlaceholder')}
            onPress={() => router.push('/search')}
          />
        ) : renderInlineSearch}
      </View>

      {catalogueError && !categories ? <ErrorState message={catalogueError} onRetry={() => void refresh()} /> : null}

      {active ? <View style={gutter}>{activeCard}</View> : null}
      {activeError ? (
        <View style={gutter}>
          <InlineAlert
            title="Active booking status unavailable"
            message={activeError}
            actionLabel="Retry"
            onAction={() => void refresh()}
          />
        </View>
      ) : null}

      {unserved ? (
        <View style={gutter}>
          <NotServedCard />
        </View>
      ) : selectedFamily || query.trim() ? (
        <View style={[gutter, { gap: t.spacing.lg }]}>
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
              <Text variant="title3" accessibilityRole="header">{selectedFamily?.label ?? 'Matching services'}</Text>
              <Text variant="footnote" color="muted">Choose a service to see available pros</Text>
            </View>
          </View>
          <Section title={selectedFamily ? 'Choose a service' : 'Matching services'}>
            {!categories ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <View key={index} style={{ width: '47%', alignItems: 'center', gap: 8 }}>
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
        </View>
      ) : (
        <View style={[gutter, { gap: t.spacing.section }]}>
          <View
            style={{
              flexDirection: singleColumnPillars ? 'column' : 'row',
              flexWrap: 'wrap',
              gap: t.spacing.md,
            }}
          >
            {!catalogue
              ? Array.from({ length: 4 }).map((_, index) => (
                  <Card key={index} variant="outlined" style={{ width: pillarCardWidth, minHeight: 132 }}>
                    <View style={{ gap: t.spacing.sm }}>
                      <Skeleton width={44} height={44} radius={t.radii.pill} />
                      <Skeleton width={120} height={14} />
                      <Skeleton width={150} height={12} />
                    </View>
                  </Card>
                ))
              : homePillars.map((pillar) => (
                  <PillarCard
                    key={pillar}
                    pillar={pillar}
                    title={translate(PILLAR_COPY[pillar].title)}
                    subtitle={translate(PILLAR_COPY[pillar].subtitle)}
                    onPress={() => onPillarPress(pillar)}
                    fullWidth={singleColumnPillars}
                  />
                ))}
          </View>

          {popular.length > 0 ? (
            <Section title={translate('home.popularIn', { city })}>
              <ChipRow
                options={popular.map((category) => ({ value: category.slug, label: category.name }))}
                value=""
                onChange={(slug) => router.push({ pathname: '/category/[slug]', params: { slug } })}
                accessibilityLabel={translate('home.popularIn', { city })}
              />
            </Section>
          ) : null}
        </View>
      )}

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
                {translate('ai.cardSubtitle')}
              </Text>
            </View>
            <Ionicons name="mic-outline" size={20} color={t.colors.primaryText} />
          </Pressable>
        </View>
      ) : null}

      {!unserved && !noServiceCategories && !selectedFamily && !query.trim() && (!categories || topRated.length > 0 || !!topRatedError) ? (
        <View style={{ gap: t.spacing.md }}>
          <View style={gutter}>
            <Section
              title={location.city ? `Top rated in ${location.city}` : 'Top rated professionals'}
              subtitle="Ranked by average rating, then review count"
              actionLabel="See all"
              onAction={() => router.push('/top-rated')}
            >
              {null}
            </Section>
          </View>
          {topRatedError ? (
            <View style={gutter}>
              <InlineAlert
                title="Top-rated professionals unavailable"
                message={topRatedError}
                actionLabel="Retry"
                onAction={() => void refresh()}
              />
            </View>
          ) : null}
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
              ? [0, 1].map((index) => (
                  <View key={index} style={{ width: cardWidth }}>
                    <Card variant="outlined">
                      <View style={{ gap: t.spacing.md }}>
                        <Skeleton width={48} height={48} radius={t.radii.pill} />
                        <Skeleton width="70%" height={14} />
                        <Skeleton width="50%" height={12} />
                      </View>
                    </Card>
                  </View>
                ))
              : topRated.map((provider) => (
                  <TopRatedCard
                    key={provider.id}
                    provider={provider}
                    width={cardWidth}
                    onPress={() => router.push({ pathname: '/provider/[id]', params: { id: provider.id } })}
                  />
                ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={gutter}>
        <TrustStrip
          items={[
            { icon: 'shield-checkmark-outline', label: translate('trust.verified') },
            { icon: 'pricetag-outline', label: translate('trust.price') },
            { icon: 'lock-closed-outline', label: translate('trust.payments') },
          ]}
        />
      </View>
    </Screen>
  );
}

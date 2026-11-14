import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryIcon } from '../../src/components/CategoryIcon';
import { TopRatedCard, TopRatedCardSkeleton } from '../../src/components/TopRatedCard';
import { StatusPill, activeStatuses, nextStepCopy } from '../../src/components/status';
import { ProgressBar } from '../../src/components/StatusTimeline';
import { Card, EmptyState, ErrorState, IconButton, Screen, Section, Skeleton, Text } from '../../src/components/ui';
import { getMyProfile, listCategories, listMyBookings, listTopRated, type TopRatedProvider } from '../../src/lib/api';
import { aiAssistantEnabled } from '../../src/lib/config';
import { useSelectedLocation } from '../../src/lib/locationContext';
import type { Booking, Category } from '../../src/lib/types';
import { useTheme } from '../../src/theme';

export default function CustomerHome() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { location } = useSelectedLocation();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [topRated, setTopRated] = useState<TopRatedProvider[]>([]);
  const [active, setActive] = useState<Booking | null>(null);
  const [firstName, setFirstName] = useState('');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, tr, bookings, profile] = await Promise.all([
        listCategories(),
        listTopRated(),
        listMyBookings().catch(() => [] as Booking[]),
        getMyProfile().catch(() => null),
      ]);
      setCategories(c);
      setTopRated(tr);
      setActive(bookings.find((b) => activeStatuses.includes(b.status) && b.status !== 'pending_payment') ?? null);
      setFirstName(profile?.full_name?.split(' ')[0] ?? '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = useMemo(
    () => (categories ?? []).filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase())),
    [categories, query],
  );

  const openCategory = (c: Category) => router.push({ pathname: '/category/[slug]', params: { slug: c.slug, name: c.name } });
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
            accessibilityLabel="Notifications"
            onPress={() => router.push('/bookings')}
            variant="neutral"
            badge={!!active}
          />
        </View>

        <View style={{ gap: 4 }}>
          <Text variant="title1" accessibilityRole="header">
            {firstName ? `Hi ${firstName}` : 'Hi there'}
          </Text>
          <Text variant="body" color="muted">
            What do you need help with today?
          </Text>
        </View>

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

        {aiAssistantEnabled ? (
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
        ) : null}
      </View>

      {error && !categories ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {/* Active booking */}
      {active ? (
        <View style={gutter}>
          <Card
            variant="elevated"
            onPress={() => router.push({ pathname: '/booking/[id]', params: { id: active.id } })}
            accessibilityLabel={`Active booking ${active.categories?.name ?? ''}. ${nextStepCopy[active.status] ?? ''}`}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
              <CategoryIcon icon={categories?.find((c) => c.slug === active.categories?.slug)?.icon} size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="caption" color="muted">
                  Active booking
                </Text>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {active.categories?.name ?? 'Booking'}
                </Text>
              </View>
              <StatusPill status={active.status} />
            </View>
            <ProgressBar status={active.status} showLabel={false} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Text variant="footnote" color="textSecondary" style={{ flex: 1 }} numberOfLines={2}>
                {nextStepCopy[active.status] ?? 'View booking details'}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={t.colors.subtle} />
            </View>
          </Card>
        </View>
      ) : null}

      {/* Categories */}
      <View style={gutter}>
        <Section title="Services">
          {!categories ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: t.spacing.lg }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <View key={i} style={{ width: '25%', alignItems: 'center', gap: 8 }}>
                  <Skeleton width={64} height={64} radius={t.radii.lg} />
                  <Skeleton width={52} height={10} />
                </View>
              ))}
            </View>
          ) : filtered.length === 0 ? (
            <EmptyState
              compact
              icon="search"
              title="No matching service"
              message={aiAssistantEnabled ? `We don't have "${query}" yet. Try another word, or describe the problem to QuickServe AI.` : `We don't have "${query}" yet. Try another word.`}
              actionLabel={aiAssistantEnabled ? 'Ask QuickServe AI' : undefined}
              onAction={aiAssistantEnabled ? () => router.push({ pathname: '/assistant', params: { q: query.trim() } }) : undefined}
            />
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: t.spacing.lg, marginHorizontal: -t.spacing.xs }}>
              {filtered.map((c, i) => (
                <Animated.View key={c.id} entering={FadeInDown.delay(i * 20).duration(240)} style={{ width: '25%', paddingHorizontal: t.spacing.xs }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={c.name}
                    onPress={() => openCategory(c)}
                    style={({ pressed }) => ({ alignItems: 'center', gap: 8, opacity: pressed ? 0.6 : 1 })}
                  >
                    <CategoryIcon icon={c.icon} size={64} />
                    <Text variant="caption" color="textSecondary" align="center" numberOfLines={2} style={{ height: 32 }}>
                      {c.name}
                    </Text>
                  </Pressable>
                </Animated.View>
              ))}
            </View>
          )}
        </Section>
      </View>

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
              No surprise bills
            </Text>
            <Text variant="footnote" style={{ color: 'rgba(255,255,255,0.9)' }}>
              Approve an itemised quote before work starts. Your money is held until the job is done.
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
      {categories && topRated.length === 0 ? null : (
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

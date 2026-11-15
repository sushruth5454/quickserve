import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ProviderCard, skillLabel } from '../../src/components/ProviderCard';
import {
  BottomSheet,
  Button,
  Card,
  Chip,
  Dot,
  EmptyState,
  ErrorState,
  Header,
  IconButton,
  Screen,
  SkeletonProviderCard,
  Text,
} from '../../src/components/ui';
import { listCategories, searchProviders } from '../../src/lib/api';
import { aiAssistantEnabled } from '../../src/lib/config';
import { getCatalogueCategory } from '../../src/features/catalogue/api';
import { ArchetypeCategory } from '../../src/features/catalogue/ArchetypeCategory';
import { haptics } from '../../src/lib/haptics';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { rupeesToPaise } from '../../src/lib/money';
import type { Category, ProviderSearchResult, SearchFilters, SkillLevel, SortOption } from '../../src/lib/types';
import { useTheme } from '../../src/theme';

const SORTS: { value: SortOption; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'recommended', label: 'Recommended', icon: 'sparkles-outline' },
  { value: 'rating', label: 'Top rated', icon: 'star-outline' },
  { value: 'price', label: 'Lowest visit fee', icon: 'pricetag-outline' },
  { value: 'distance', label: 'Nearest', icon: 'navigate-outline' },
  { value: 'experience', label: 'Most experienced', icon: 'ribbon-outline' },
];
const LEVELS: SkillLevel[] = ['skilled', 'expert', 'certified'];
const FEES = [99, 199, 299];
const RATINGS = [3.5, 4, 4.5];

const DEFAULT_FILTERS: SearchFilters = { sort: 'recommended', minRating: null, skillLevel: null, maxVisitFee: null, onlineOnly: false };

export default function CategoryRoute() {
  const { slug, name } = useLocalSearchParams<{ slug: string; name?: string }>();
  const { location } = useSelectedLocation();
  const [category, setCategory] = useState<Category | null | undefined>(undefined);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  useEffect(() => {
    if (!slug) return;
    getCatalogueCategory(slug, location.city).then(setCategory).catch((e: Error) => setCategoryError(e.message));
  }, [slug, location.city]);
  if (categoryError) return <Screen header={<Header title={name ?? 'Service'} />}><ErrorState message={categoryError} onRetry={() => router.replace({ pathname: '/category/[slug]', params: { slug, name: name ?? '' } })} /></Screen>;
  if (category === undefined) return <Screen header={<Header title={name ?? 'Service'} />}><SkeletonProviderCard /></Screen>;
  if (category === null) return <Screen header={<Header title={name ?? 'Service'} />}><EmptyState icon="storefront-outline" title="This service is not available here" message="Categories are enabled city by city. Try another service location." /></Screen>;
  if (category.archetype !== 'inspect_quote' && category.archetype != null) return <ArchetypeCategory category={category} />;
  return <InspectQuoteCategory />;
}

function InspectQuoteCategory() {
  const t = useTheme();
  const { slug, name } = useLocalSearchParams<{ slug: string; name?: string }>();
  const { location: place, coords } = useSelectedLocation();
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [draft, setDraft] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [results, setResults] = useState<ProviderSearchResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [sheet, setSheet] = useState<'sort' | 'filter' | null>(null);
  const chipsRef = useRef<ComponentRef<typeof ScrollView>>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const [rows, catalog] = await Promise.all([searchProviders(slug, coords, filters), listCategories()]);
      setCategory(catalog.find((c) => c.slug === slug) ?? null);
      setResults(rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug, coords, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    chipsRef.current?.scrollTo({ x: 0, animated: true });
  }, [filters]);

  // Live result count for the filter sheet CTA ("Show 3 pros").
  useEffect(() => {
    if (sheet !== 'filter' || !slug) return;
    let alive = true;
    setDraftCount(null);
    const id = setTimeout(() => {
      searchProviders(slug, coords, draft)
        .then((r) => alive && setDraftCount(r.length))
        .catch(() => alive && setDraftCount(null));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [sheet, draft, slug, coords]);

  const activeCount =
    (filters.minRating != null ? 1 : 0) +
    (filters.skillLevel ? 1 : 0) +
    (filters.maxVisitFee != null ? 1 : 0) +
    (filters.onlineOnly ? 1 : 0);

  const toggle = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: f[key] === value ? (key === 'onlineOnly' ? false : null) : value }));

  const sortLabel = SORTS.find((s) => s.value === filters.sort)?.label ?? 'Sort';
  const count = results?.length ?? 0;
  const where = place.area;
  const subtitle =
    loading && !results ? 'Finding verified pros…' : count > 0 ? `${count} verified pro${count === 1 ? '' : 's'} near ${where}` : `Near ${where}`;

  return (
    <>
      <Screen
        header={
          <Header
            title={name ?? 'Providers'}
            subtitle={subtitle}
            right={
              aiAssistantEnabled ? (
              <IconButton
                icon="sparkles"
                variant="tonal"
                color="primaryText"
                size={20}
                accessibilityLabel="Ask QuickServe AI"
                accessibilityHint="Describe your problem and get a recommended pro and a pre-filled booking"
                onPress={() => router.push({ pathname: '/assistant', params: { category: slug, name: name ?? '' } })}
              />
              ) : undefined
            }
          />
        }
        padded={false}
        gap={0}
        stickyHeaderIndices={[0]}
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }}
      >
        <View
          style={{
            backgroundColor: t.colors.bg,
            paddingVertical: t.spacing.sm,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: t.colors.borderStrong,
          }}
        >
          <ScrollView
            ref={chipsRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm, paddingVertical: 4 }}
          >
            <Chip
              label={sortLabel}
              icon="swap-vertical"
              trailingIcon="chevron-down"
              selected={filters.sort !== 'recommended'}
              check={false}
              onPress={() => setSheet('sort')}
              accessibilityLabel={`Sort: ${sortLabel}`}
            />
            <Chip
              label="Filters"
              icon="options-outline"
              count={activeCount}
              selected={activeCount > 0}
              check={false}
              onPress={() => {
                setDraft(filters);
                setSheet('filter');
              }}
            />
            <Chip label="4.0+" icon="star" selected={filters.minRating === 4} onPress={() => toggle('minRating', 4)} accessibilityLabel="Rated 4.0 and up" />
            <Chip
              label="Online now"
              leading={<Dot color={t.colors.success} />}
              selected={filters.onlineOnly}
              onPress={() => toggle('onlineOnly', true)}
            />
            <Chip label="Expert" selected={filters.skillLevel === 'expert'} onPress={() => toggle('skillLevel', 'expert')} />
            <Chip
              label="Visit up to ₹199"
              selected={filters.maxVisitFee === rupeesToPaise(199)}
              onPress={() => toggle('maxVisitFee', rupeesToPaise(199))}
            />
          </ScrollView>
        </View>

        <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
          {category?.archetype === 'proposal' ? (
            <Card>
              <Text variant="title3">Describe once. Compare fixed proposals.</Text>
              <Text color="textSecondary">No money moves until you accept one proposal and pay its protected advance.</Text>
              <Button
                title="Get proposals"
                onPress={() => router.push({ pathname: '/request/new', params: { categoryId: category.id, name: category.name } })}
              />
            </Card>
          ) : null}
          {error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : loading && !results ? (
            Array.from({ length: 3 }).map((_, i) => <SkeletonProviderCard key={i} />)
          ) : count === 0 ? (
            <EmptyState
              icon="people-outline"
              title={activeCount > 0 ? 'No pros match these filters' : `No ${(name ?? 'service').toLowerCase()} pros nearby yet`}
              message={
                activeCount > 0
                  ? 'Try removing a filter to see more verified pros.'
                  : 'New pros join every week. Try another service or check back soon.'
              }
              actionLabel={activeCount > 0 ? 'Clear filters' : 'Browse services'}
              onAction={() => (activeCount > 0 ? setFilters((f) => ({ ...DEFAULT_FILTERS, sort: f.sort })) : router.navigate('/'))}
            />
          ) : (
            results!.map((p, i) => (
              <Animated.View key={p.provider_service_id} entering={FadeInDown.delay(Math.min(i, 6) * 40).duration(240)}>
                <ProviderCard
                  provider={p}
                  onPress={() => router.push({ pathname: '/provider/[id]', params: { id: p.provider_id } })}
                  onBook={() => router.push({ pathname: '/book/[providerServiceId]', params: { providerServiceId: p.provider_service_id } })}
                />
              </Animated.View>
            ))
          )}
        </View>
      </Screen>

      <BottomSheet visible={sheet === 'sort'} onClose={() => setSheet(null)} title="Sort by">
        <View accessibilityRole="radiogroup" style={{ marginHorizontal: -t.spacing.sm }}>
          {SORTS.map((s) => {
            const selected = filters.sort === s.value;
            return (
              <Pressable
                key={s.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => {
                  haptics.select();
                  setFilters((f) => ({ ...f, sort: s.value }));
                  setSheet(null);
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t.spacing.md,
                  minHeight: 52,
                  paddingHorizontal: t.spacing.sm,
                  borderRadius: t.radii.md,
                  backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
                })}
              >
                <Ionicons name={s.icon} size={20} color={t.colors.textSecondary} />
                <Text variant={selected ? 'bodyStrong' : 'body'} style={{ flex: 1 }}>
                  {s.label}
                </Text>
                {selected ? <Ionicons name="checkmark" size={22} color={t.colors.primaryText} /> : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>

      <BottomSheet
        visible={sheet === 'filter'}
        onClose={() => setSheet(null)}
        title="Filters"
        footer={
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <Button title="Reset" variant="outline" onPress={() => setDraft({ ...DEFAULT_FILTERS, sort: draft.sort })} style={{ flex: 1 }} />
            <Button
              title={draftCount == null ? 'Show results' : draftCount === 0 ? 'No matches' : `Show ${draftCount} pro${draftCount === 1 ? '' : 's'}`}
              onPress={() => {
                setFilters(draft);
                setSheet(null);
              }}
              style={{ flex: 2 }}
            />
          </View>
        }
      >
        <FilterGroup title="Minimum rating">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            <Chip label="Any" selected={draft.minRating == null} onPress={() => setDraft((d) => ({ ...d, minRating: null }))} />
            {RATINGS.map((r) => (
              <Chip
                key={r}
                label={`${r.toFixed(1)}+`}
                icon="star"
                selected={draft.minRating === r}
                onPress={() => setDraft((d) => ({ ...d, minRating: r }))}
              />
            ))}
          </View>
        </FilterGroup>
        <FilterGroup title="Skill level">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            <Chip label="Any" selected={draft.skillLevel == null} onPress={() => setDraft((d) => ({ ...d, skillLevel: null }))} />
            {LEVELS.map((l) => (
              <Chip key={l} label={skillLabel[l]} selected={draft.skillLevel === l} onPress={() => setDraft((d) => ({ ...d, skillLevel: l }))} />
            ))}
          </View>
        </FilterGroup>
        <FilterGroup title="Visit fee">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            <Chip label="Any" selected={draft.maxVisitFee == null} onPress={() => setDraft((d) => ({ ...d, maxVisitFee: null }))} />
            {FEES.map((f) => (
              <Chip
                key={f}
                label={`Up to ₹${f}`}
                selected={draft.maxVisitFee === rupeesToPaise(f)}
                onPress={() => setDraft((d) => ({ ...d, maxVisitFee: rupeesToPaise(f) }))}
              />
            ))}
          </View>
        </FilterGroup>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, minHeight: 56 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">Online now</Text>
            <Text variant="footnote" color="muted">
              Pros who can respond in minutes
            </Text>
          </View>
          <Switch
            value={draft.onlineOnly}
            onValueChange={(v) => setDraft((d) => ({ ...d, onlineOnly: v }))}
            trackColor={{ true: t.colors.primary, false: t.colors.outline }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={t.colors.outline}
            {...({ activeThumbColor: '#FFFFFF' } as object)}
            accessibilityLabel="Online now only"
          />
        </View>
      </BottomSheet>
    </>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.md }}>
      <Text variant="subheadStrong" color="textSecondary">
        {title}
      </Text>
      {children}
    </View>
  );
}

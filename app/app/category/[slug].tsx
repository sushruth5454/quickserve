import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ProviderCard, skillLabel } from '../../src/components/ProviderCard';
import {
  BottomSheet,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  InlineAlert,
  Screen,
  SegmentedControl,
  SkeletonCard,
  Text,
} from '../../src/components/ui';
import { searchProviders } from '../../src/lib/api';
import { haptics } from '../../src/lib/haptics';
import { useCurrentLocation } from '../../src/lib/location';
import { rupeesToPaise } from '../../src/lib/money';
import type { ProviderSearchResult, SearchFilters, SkillLevel, SortOption } from '../../src/lib/types';
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
type RatingKey = 'any' | '3.5' | '4' | '4.5';

const DEFAULT_FILTERS: SearchFilters = { sort: 'recommended', minRating: null, skillLevel: null, maxVisitFee: null, onlineOnly: false };

export default function CategoryProviders() {
  const t = useTheme();
  const { slug, name } = useLocalSearchParams<{ slug: string; name?: string }>();
  const location = useCurrentLocation();
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [draft, setDraft] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [results, setResults] = useState<ProviderSearchResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'sort' | 'filter' | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await searchProviders(slug, location.coords, filters));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug, location.coords, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount =
    (filters.minRating != null ? 1 : 0) +
    (filters.skillLevel ? 1 : 0) +
    (filters.maxVisitFee != null ? 1 : 0) +
    (filters.onlineOnly ? 1 : 0);

  const toggle = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: f[key] === value ? (key === 'onlineOnly' ? false : null) : value }));

  const sortLabel = SORTS.find((s) => s.value === filters.sort)?.label ?? 'Sort';
  const count = results?.length ?? 0;

  return (
    <>
      <Screen
        header={
          <Header
            title={name ?? 'Providers'}
            subtitle={loading && !results ? 'Finding verified pros…' : `${count} verified pro${count === 1 ? '' : 's'} near ${location.area ?? 'you'}`}
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
        <View style={{ backgroundColor: t.colors.bg, paddingBottom: t.spacing.md, borderBottomWidth: 1, borderBottomColor: t.colors.border }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm, paddingTop: t.spacing.xs }}
          >
            <Chip
              label={sortLabel}
              icon="swap-vertical"
              trailingIcon="chevron-down"
              selected={filters.sort !== 'recommended'}
              onPress={() => setSheet('sort')}
              accessibilityLabel={`Sort: ${sortLabel}`}
            />
            <Chip
              label="Filters"
              icon="options-outline"
              count={activeCount}
              selected={activeCount > 0}
              onPress={() => {
                setDraft(filters);
                setSheet('filter');
              }}
            />
            <Chip label="4★ & up" selected={filters.minRating === 4} onPress={() => toggle('minRating', 4)} />
            <Chip label="Online now" icon="radio-button-on" selected={filters.onlineOnly} onPress={() => toggle('onlineOnly', true)} />
            <Chip label="Expert" selected={filters.skillLevel === 'expert'} onPress={() => toggle('skillLevel', 'expert')} />
            <Chip label="Visit ≤ ₹199" selected={filters.maxVisitFee === rupeesToPaise(199)} onPress={() => toggle('maxVisitFee', rupeesToPaise(199))} />
          </ScrollView>
        </View>

        <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
          {location.error ? <InlineAlert tone="warning" message={location.error} /> : null}
          {error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : loading && !results ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : count === 0 ? (
            <EmptyState
              icon="people-outline"
              title="No pros match these filters"
              message="Try removing a filter or widening your search. New pros join every week."
              actionLabel={activeCount > 0 ? 'Clear filters' : undefined}
              onAction={() => setFilters((f) => ({ ...DEFAULT_FILTERS, sort: f.sort }))}
            />
          ) : (
            results!.map((p, i) => (
              <Animated.View key={p.provider_service_id} entering={FadeInDown.delay(Math.min(i, 6) * 50).duration(280)}>
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
        <View accessibilityRole="radiogroup" style={{ gap: 4 }}>
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
                  minHeight: 56,
                  paddingHorizontal: t.spacing.md,
                  borderRadius: t.radii.md,
                  backgroundColor: selected ? t.colors.primarySoft : pressed ? t.colors.surfaceAlt : 'transparent',
                })}
              >
                <Ionicons name={s.icon} size={20} color={selected ? t.colors.primary : t.colors.muted} />
                <Text variant={selected ? 'bodyStrong' : 'body'} color={selected ? 'primary' : 'text'} style={{ flex: 1 }}>
                  {s.label}
                </Text>
                {selected ? <Ionicons name="checkmark" size={20} color={t.colors.primary} /> : null}
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
              title="Show results"
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
          <SegmentedControl<RatingKey>
            options={[
              { value: 'any', label: 'Any' },
              { value: '3.5', label: '3.5+' },
              { value: '4', label: '4.0+' },
              { value: '4.5', label: '4.5+' },
            ]}
            value={draft.minRating == null ? 'any' : (String(draft.minRating) as RatingKey)}
            onChange={(v) => setDraft((d) => ({ ...d, minRating: v === 'any' ? null : Number(v) }))}
            accessibilityLabel="Minimum rating"
          />
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
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">Online now</Text>
            <Text variant="caption" color="muted">
              Pros who can respond in minutes
            </Text>
          </View>
          <Switch
            value={draft.onlineOnly}
            onValueChange={(v) => setDraft((d) => ({ ...d, onlineOnly: v }))}
            trackColor={{ true: t.colors.success, false: t.colors.borderStrong }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Online now only"
          />
        </View>
      </BottomSheet>
    </>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="subhead" color="textSecondary">
        {title}
      </Text>
      {children}
    </View>
  );
}

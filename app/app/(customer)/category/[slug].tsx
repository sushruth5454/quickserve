import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ProviderCard, skillLabel } from '../../../src/components/ProviderCard';
import { Chip, ErrorText, Screen } from '../../../src/components/Screen';
import { searchProviders } from '../../../src/lib/api';
import { useCurrentLocation } from '../../../src/lib/location';
import { rupeesToPaise } from '../../../src/lib/money';
import { font, spacing } from '../../../src/lib/theme';
import type { ProviderSearchResult, SearchFilters, SkillLevel, SortOption } from '../../../src/lib/types';

const SORTS: { value: SortOption; label: string }[] = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'rating', label: 'Rating' },
  { value: 'price', label: 'Price' },
  { value: 'distance', label: 'Distance' },
  { value: 'experience', label: 'Experience' },
];
const RATINGS = [4.5, 4, 3.5];
const FEES = [99, 199, 299];
const LEVELS: SkillLevel[] = ['skilled', 'expert', 'certified'];

export default function CategoryProviders() {
  const { slug, name } = useLocalSearchParams<{ slug: string; name?: string }>();
  const location = useCurrentLocation();
  const [filters, setFilters] = useState<SearchFilters>({
    sort: 'recommended',
    minRating: null,
    skillLevel: null,
    maxVisitFee: null,
    onlineOnly: false,
  });
  const [results, setResults] = useState<ProviderSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const toggle = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: f[key] === value ? (key === 'onlineOnly' ? false : null) : value }));

  return (
    <Screen refreshing={loading} onRefresh={load}>
      <Stack.Screen options={{ title: name ?? 'Providers' }} />
      <FilterRow label="Sort">
        {SORTS.map((s) => (
          <Chip key={s.value} label={s.label} selected={filters.sort === s.value} onPress={() => setFilters((f) => ({ ...f, sort: s.value }))} />
        ))}
      </FilterRow>
      <FilterRow label="Rating">
        {RATINGS.map((r) => (
          <Chip key={r} label={`${r}★+`} selected={filters.minRating === r} onPress={() => toggle('minRating', r)} />
        ))}
        <Chip label="Online now" selected={filters.onlineOnly} onPress={() => toggle('onlineOnly', true)} />
      </FilterRow>
      <FilterRow label="Skill">
        {LEVELS.map((l) => (
          <Chip key={l} label={skillLabel[l]} selected={filters.skillLevel === l} onPress={() => toggle('skillLevel', l)} />
        ))}
      </FilterRow>
      <FilterRow label="Visit fee">
        {FEES.map((f) => (
          <Chip
            key={f}
            label={`≤ ₹${f}`}
            selected={filters.maxVisitFee === rupeesToPaise(f)}
            onPress={() => toggle('maxVisitFee', rupeesToPaise(f))}
          />
        ))}
      </FilterRow>
      {location.error && <Text style={font.caption}>{location.error}</Text>}
      <ErrorText message={error} />
      {!loading && results.length === 0 && !error && (
        <Text style={font.caption}>No verified providers match these filters yet.</Text>
      )}
      {results.map((p) => (
        <ProviderCard
          key={p.provider_service_id}
          provider={p}
          onPress={() => router.push({ pathname: '/provider/[id]', params: { id: p.provider_id } })}
        />
      ))}
    </Screen>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.filterRow}>
      <Text style={[font.caption, styles.filterLabel]}>{label}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  filterRow: { gap: spacing.xs },
  filterLabel: { fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

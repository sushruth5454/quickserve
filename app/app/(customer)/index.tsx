import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { RatingStars } from '../../src/components/RatingStars';
import { ErrorText, Screen, Section } from '../../src/components/Screen';
import { listCategories, listTopRated, signOut, type TopRatedProvider } from '../../src/lib/api';
import { colors, font, minTouch, radius, spacing } from '../../src/lib/theme';
import type { Category } from '../../src/lib/types';

const ICONS: Record<string, string> = {
  snowflake: '❄️',
  zap: '⚡',
  droplet: '🚰',
  home: '🧹',
  database: '🛢️',
  truck: '🚗',
  bike: '🏍️',
  tv: '📺',
  bug: '🐜',
  hammer: '🔨',
  brush: '🖌️',
};

export default function CustomerHome() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [topRated, setTopRated] = useState<TopRatedProvider[]>([]);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [c, t] = await Promise.all([listCategories(), listTopRated()]);
      setCategories(c);
      setTopRated(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => categories.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase())),
    [categories, query],
  );

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              <HeaderLink label="Bookings" onPress={() => router.push('/bookings')} />
              <HeaderLink label="Pro" onPress={() => router.push('/dashboard')} />
              <HeaderLink label="Sign out" onPress={() => void signOut()} />
            </View>
          ),
        }}
      />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="What do you need fixed?"
        placeholderTextColor={colors.muted}
        style={styles.search}
        accessibilityLabel="Search services"
      />
      <ErrorText message={error} />
      <Section title="Services">
        <View style={styles.grid}>
          {filtered.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={c.name}
              onPress={() => router.push({ pathname: '/category/[slug]', params: { slug: c.slug, name: c.name } })}
              style={({ pressed }) => [styles.tile, pressed && { borderColor: colors.primary }]}
            >
              <Text style={styles.icon}>{ICONS[c.icon] ?? '🛠️'}</Text>
              <Text style={styles.tileLabel} numberOfLines={2}>
                {c.name}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Section title="Top rated near you">
        {topRated.length === 0 && <Text style={font.caption}>No rated providers yet.</Text>}
        {topRated.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/provider/[id]', params: { id: p.id } })}
            style={styles.topRow}
          >
            <View style={{ flex: 1 }}>
              <Text style={font.heading}>{p.profiles?.full_name || 'Provider'}</Text>
              <Text style={font.caption}>
                {p.city} • {p.years_experience} yrs • {p.jobs_completed} jobs
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <RatingStars value={Number(p.rating_avg)} size={14} />
              <Text style={font.caption}>
                {Number(p.rating_avg).toFixed(1)} ({p.rating_count})
              </Text>
            </View>
          </Pressable>
        ))}
      </Section>
    </Screen>
  );
}

function HeaderLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.headerLink} hitSlop={8}>
      <Text style={{ color: colors.primary, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: spacing.md },
  headerLink: { minHeight: minTouch, justifyContent: 'center' },
  search: {
    minHeight: minTouch,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    fontSize: 16,
    color: colors.text,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    width: '30%',
    flexGrow: 1,
    minHeight: 96,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    gap: spacing.xs,
  },
  icon: { fontSize: 28 },
  tileLabel: { ...font.caption, color: colors.text, textAlign: 'center', fontWeight: '600' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: minTouch,
  },
});

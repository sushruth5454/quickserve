import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../../src/components/Button';
import { skillLabel } from '../../../src/components/ProviderCard';
import { RatingStars } from '../../../src/components/RatingStars';
import { Card, ErrorText, Loading, Screen, Section } from '../../../src/components/Screen';
import { getProviderDetail, type ProviderDetail } from '../../../src/lib/api';
import { formatINR } from '../../../src/lib/money';
import { colors, font, spacing } from '../../../src/lib/theme';

export default function ProviderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      setDetail(await getProviderDetail(id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!detail) return error ? <Screen><ErrorText message={error} /></Screen> : <Loading />;
  const { provider, services, reviews } = detail;
  const name = provider.profiles?.full_name || 'Provider';

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <Stack.Screen options={{ title: name }} />
      <View style={styles.header}>
        {provider.profiles?.avatar_url ? (
          <Image source={{ uri: provider.profiles.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.initial}>{name.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={font.title}>{name}</Text>
          <View style={styles.row}>
            <RatingStars value={Number(provider.rating_avg)} />
            <Text style={font.caption}>
              {' '}
              {Number(provider.rating_avg).toFixed(1)} ({provider.rating_count} reviews)
            </Text>
          </View>
          <Text style={styles.verified}>✓ KYC verified via payment partner</Text>
        </View>
      </View>
      <Card>
        <Text style={font.body}>{provider.bio || 'No bio yet.'}</Text>
        <Text style={font.caption}>
          {provider.city} • {provider.years_experience} yrs experience • {provider.jobs_completed} jobs on QuickServe
        </Text>
        {provider.languages.length > 0 && <Text style={font.caption}>Speaks: {provider.languages.join(', ')}</Text>}
        <Text style={[font.caption, { color: provider.is_online ? colors.success : colors.muted }]}>
          {provider.is_online ? '● Online now' : '○ Offline'}
        </Text>
      </Card>

      <Section title="Services">
        {services.map((s) => (
          <Card key={s.id}>
            <View style={styles.between}>
              <Text style={font.heading}>{s.categories?.name ?? 'Service'}</Text>
              <Text style={styles.badge}>{skillLabel[s.skill_level]}</Text>
            </View>
            <Text style={font.body}>Visit / inspection fee: {formatINR(s.visit_fee)}</Text>
            <Text style={font.caption}>
              Labour from {formatINR(s.labour_rate)} per {s.rate_unit}. Visit fee is adjusted in the final bill.
            </Text>
            {(s.rate_card_items ?? []).length > 0 && (
              <View style={styles.rateCard}>
                <Text style={[font.caption, { fontWeight: '700' }]}>Rate card</Text>
                {(s.rate_card_items ?? []).map((r) => (
                  <View key={r.id} style={styles.between}>
                    <Text style={font.body}>{r.title}</Text>
                    <Text style={font.body}>{formatINR(r.price)}</Text>
                  </View>
                ))}
              </View>
            )}
            <Button
              title={`Book ${s.categories?.name ?? ''}`.trim()}
              onPress={() => router.push({ pathname: '/book/[providerServiceId]', params: { providerServiceId: s.id } })}
            />
          </Card>
        ))}
      </Section>

      <Section title={`Reviews (${reviews.length})`}>
        {reviews.length === 0 && <Text style={font.caption}>No reviews yet.</Text>}
        {reviews.map((r) => (
          <Card key={r.id}>
            <View style={styles.between}>
              <RatingStars value={r.rating} />
              <Text style={font.caption}>{new Date(r.created_at).toLocaleDateString()}</Text>
            </View>
            {r.comment ? <Text style={font.body}>{r.comment}</Text> : null}
            {r.provider_reply ? <Text style={font.caption}>Reply: {r.provider_reply}</Text> : null}
          </Card>
        ))}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  avatarFallback: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 28, fontWeight: '700', color: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center' },
  verified: { color: colors.success, fontWeight: '600', fontSize: 13 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  badge: {
    backgroundColor: colors.primarySoft,
    color: colors.primary,
    fontWeight: '600',
    fontSize: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  rateCard: { gap: spacing.xs, paddingVertical: spacing.sm },
});

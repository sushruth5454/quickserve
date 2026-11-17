import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../src/components/ui';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { formatINR } from '../../src/lib/money';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme';

interface SportsVenueSummary {
  id: string;
  name: string;
  description: string;
  address_line: string;
  city: string;
  area: string;
  photos: string[];
  distance_km: number;
  min_price_paise: number | null;
}

export default function SportsActivityScreen() {
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const enabled = flags.isOn('sports');
  const { activity } = useLocalSearchParams<{ activity: string }>();
  const { location, coords } = useSelectedLocation();
  const [venues, setVenues] = useState<SportsVenueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !activity) return;
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('search_sports_venues', {
      p_activity_slug: activity,
      p_lat: coords.lat,
      p_lng: coords.lng,
      p_radius_km: 15,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setVenues((data ?? []) as SportsVenueSummary[]);
  }, [activity, coords.lat, coords.lng, enabled]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen header={<Header title={activity?.replaceAll('-', ' ') ?? 'Sports venues'} subtitle={`Near ${location.area}, ${location.city}`} onBack={() => router.back()} />}>
      {!enabled ? (
        <InlineAlert message="Sports & venues are turned off right now." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !venues ? (
        [0, 1, 2].map((i) => <Skeleton key={i} height={116} radius={t.radii.lg} />)
      ) : venues.length === 0 ? (
        <EmptyState icon="location-outline" title="No verified venues nearby" message="Try another area or check again later." />
      ) : (
        <View style={{ gap: t.spacing.md }}>
          {venues.map((venue) => (
            <Pressable key={venue.id} accessibilityRole="button" onPress={() => router.push(`/venue/${venue.id}` as Href)}>
              <Card gap={t.spacing.sm}>
                {venue.photos?.[0] ? (
                  <Image source={{ uri: venue.photos[0] }} contentFit="cover" style={{ height: 150, borderRadius: t.radii.md }} />
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.sm }}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text variant="bodyStrong">{venue.name}</Text>
                    <Text variant="footnote" color="muted">{venue.area}, {venue.city} · {venue.distance_km.toFixed(1)} km away</Text>
                  </View>
                  <Text variant="captionStrong" color="successText">VERIFIED</Text>
                </View>
                {venue.description ? <Text variant="footnote" color="textSecondary" numberOfLines={2}>{venue.description}</Text> : null}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="footnote" color="muted" numberOfLines={1}>{venue.address_line}</Text>
                  <Text variant="calloutStrong">{venue.min_price_paise == null ? 'View slots' : `From ${formatINR(venue.min_price_paise)}`}</Text>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

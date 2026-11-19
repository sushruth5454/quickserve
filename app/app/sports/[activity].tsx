import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { ChipRow } from '../../src/components/market/ChipRow';
import { ListingCard } from '../../src/components/market/ListingCard';
import { EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton } from '../../src/components/ui';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { formatINR } from '../../src/lib/money';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme';
import { titleFromSlug } from '../../src/features/sports/activityPresentation';

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
  const { activity, name } = useLocalSearchParams<{ activity: string; name?: string }>();
  const [radiusKm, setRadiusKm] = useState<'5' | '10' | '15'>('15');
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
      p_radius_km: Number(radiusKm),
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setVenues((data ?? []) as SportsVenueSummary[]);
  }, [activity, coords.lat, coords.lng, enabled, radiusKm]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen header={<Header title={name || (activity ? titleFromSlug(activity) : 'Sports venues')} subtitle={`Near ${location.area}, ${location.city}`} onBack={() => router.back()} />}>
      {!enabled ? (
        <InlineAlert message="Sports & venues are turned off right now." />
      ) : (
        <>
          <ChipRow
            options={[
              { value: '5', label: '5 km' },
              { value: '10', label: '10 km' },
              { value: '15', label: '15 km' },
            ]}
            value={radiusKm}
            onChange={setRadiusKm}
            accessibilityLabel="Search radius"
          />
          {error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : !venues ? (
            [0, 1, 2].map((i) => <Skeleton key={i} height={116} radius={t.radii.lg} />)
          ) : venues.length === 0 ? (
            <EmptyState icon="location-outline" title="No verified venues nearby" message="Try another area or check again later." />
          ) : (
            <View style={{ gap: t.spacing.md }}>
              {venues.map((venue) => (
                <ListingCard
                  key={venue.id}
                  variant="venue"
                  title={venue.name}
                  subtitle={`${venue.area}, ${venue.city} · ${venue.distance_km.toFixed(1)} km away`}
                  imageUrl={venue.photos?.[0] ?? null}
                  verified
                  priceLabel={venue.min_price_paise == null ? 'View slots' : `From ${formatINR(venue.min_price_paise)}`}
                  onPress={() => router.push(`/venue/${venue.id}` as Href)}
                />
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

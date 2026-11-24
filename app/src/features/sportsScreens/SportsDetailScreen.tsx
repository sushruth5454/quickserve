import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { ChipRow } from '../../components/market/ChipRow';
import { ListingCard } from '../../components/market/ListingCard';
import { EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton } from '../../components/ui';
import { useSelectedLocation } from '../../lib/locationContext';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { formatINR } from '../../lib/money';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme';
import { titleFromSlug } from '../sports/activityPresentation';
import { useSportsReadRefresh } from '../sports/useSportsReadRefresh';

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

export function getSportsVenueCardPresentation(
  venue: SportsVenueSummary,
  familyUxEnabled: boolean,
) {
  return {
    title: venue.name,
    subtitle: `${venue.area}, ${venue.city} · ${venue.distance_km.toFixed(1)} km away`,
    imageUrl: venue.photos?.[0] ?? null,
    verified: true,
    priceLabel: venue.min_price_paise == null
      ? 'View slots'
      : `From ${formatINR(venue.min_price_paise)} / slot`,
    presentation: familyUxEnabled ? 'oorva' as const : 'legacy' as const,
  };
}

export default function SportsDetailScreen() {
  const { activity, name, enabled, familyUxEnabled, radiusKm, setRadiusKm, location, venues, error, refresh } = useSportsDetailController();
  const t = useTheme();
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
            <ErrorState message={error} onRetry={() => void refresh()} />
          ) : !venues ? (
            [0, 1, 2].map((i) => <Skeleton key={i} height={116} radius={t.radii.lg} />)
          ) : venues.length === 0 ? (
            <EmptyState icon="location-outline" title="No verified venues nearby" message="Try another area or check again later." />
          ) : (
            <View style={{ gap: t.spacing.md }}>
              {venues.map((venue) => {
                const card = getSportsVenueCardPresentation(venue, familyUxEnabled);
                return (
                  <ListingCard
                    key={venue.id}
                    variant="venue"
                    title={card.title}
                    subtitle={card.subtitle}
                    imageUrl={card.imageUrl}
                    verified={card.verified}
                    priceLabel={card.priceLabel}
                    presentation={card.presentation}
                    onPress={() => router.push(`/venue/${venue.id}` as Href)}
                  />
                );
              })}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

function useSportsDetailController() {
  const flags = useAppFeatureFlags();
  const enabled = flags.isOn('sports');
  const familyUxEnabled = flags.isOn('oorva_sports_ux') && flags.isOn('oorva_brand');
  const { activity, name } = useLocalSearchParams<{ activity: string; name?: string }>();
  const [radiusKm, setRadiusKm] = useState<'5' | '10' | '15'>('15');
  const { location, coords } = useSelectedLocation();
  const [venues, setVenues] = useState<SportsVenueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    if (!enabled || !activity) return;
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('search_sports_venues', {
        p_activity_slug: activity,
        p_lat: coords.lat,
        p_lng: coords.lng,
        p_radius_km: Number(radiusKm),
      });
      if (!guard.isCurrent()) return;
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setVenues((data ?? []) as SportsVenueSummary[]);
    } catch (caught) {
      if (guard.isCurrent()) setError((caught as Error).message);
    }
  }, [activity, coords.lat, coords.lng, enabled, radiusKm]);
  const { refresh } = useSportsReadRefresh(load, {
    contextKey: `sports-search:${activity ?? ''}:${coords.lat}:${coords.lng}:${radiusKm}`,
    enabled: enabled && !!activity,
    intervalMs: 60_000,
  });
  return { activity, name, enabled, familyUxEnabled, radiusKm, setRadiusKm, location, venues, error, refresh };
}

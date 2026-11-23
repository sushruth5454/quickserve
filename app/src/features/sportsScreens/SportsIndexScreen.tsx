import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { ListingCard } from '../../components/market/ListingCard';
import { Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../components/ui';
import {
  getSportsHomePresentation,
  listMyBusinessSportsVenues,
  shouldLoadSportsBusinessVenues,
  type SportsHomeBusinessVenue,
} from '../sports/api';
import { getSportsHomePaymentNotice } from '../sports/model';
import { useAuth } from '../../lib/auth';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../theme';

export { getSportsHomePaymentNotice } from '../sports/model';

interface Activity {
  id: string;
  slug: string;
  name: string;
  icon: string;
  sort_order: number;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

function useSportsIndexController() {
  const flags = useAppFeatureFlags();
  const sportsEnabled = flags.isOn('sports');
  const familyUxEnabled = flags.isOn('oorva_sports_ux');
  const merchantStaffEnabled = flags.isOn('merchant_staff');
  const onlinePaymentsEnabled = flags.isOn('sports_online_payments');
  const { userId } = useAuth();
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [businessVenues, setBusinessVenues] = useState<SportsHomeBusinessVenue[]>([]);
  const [businessVenuesLoaded, setBusinessVenuesLoaded] = useState(false);
  const [businessError, setBusinessError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setBusinessError(null);
    if (!sportsEnabled) {
      setActivities(null);
      setBusinessVenues([]);
      setBusinessVenuesLoaded(false);
      return;
    }

    const shouldLoadBusinessVenues = shouldLoadSportsBusinessVenues(userId, sportsEnabled);
    setBusinessVenues([]);
    setBusinessVenuesLoaded(false);
    const [activityResult, businessResult] = await Promise.allSettled([
      supabase.rpc('list_sports_activities'),
      shouldLoadBusinessVenues ? listMyBusinessSportsVenues() : Promise.resolve([]),
    ]);

    if (activityResult.status === 'rejected') {
      setError(getErrorMessage(activityResult.reason, 'Sports discovery could not be loaded.'));
    } else if (activityResult.value.error) {
      setError(getErrorMessage(activityResult.value.error, 'Sports discovery could not be loaded.'));
    } else {
      setActivities((activityResult.value.data ?? []) as Activity[]);
    }

    if (!shouldLoadBusinessVenues) return;
    if (businessResult.status === 'rejected') {
      setBusinessError(getErrorMessage(businessResult.reason, 'Business sports work could not be loaded.'));
      return;
    }
    setBusinessVenues(businessResult.value);
    setBusinessVenuesLoaded(true);
  }, [sportsEnabled, userId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return {
    activities,
    businessError,
    businessVenues,
    businessVenuesLoaded,
    error,
    familyUxEnabled,
    load,
    merchantStaffEnabled,
    onlinePaymentsEnabled,
    sportsEnabled,
    userId,
  };
}

export default function SportsIndexScreen() {
  const t = useTheme();
  const state = useSportsIndexController();
  const presentation = getSportsHomePresentation({
    userId: state.userId,
    sportsEnabled: state.sportsEnabled,
    familyUxEnabled: state.familyUxEnabled,
    merchantStaffEnabled: state.merchantStaffEnabled,
    discoveryState: state.error
      ? 'error'
      : !state.activities
        ? 'loading'
        : state.activities.length === 0
          ? 'empty'
          : 'ready',
    businessVenuesLoaded: state.businessVenuesLoaded,
    businessVenues: state.businessVenues,
  });

  return (
    <Screen header={<Header title="Sports & venues" subtitle="Find a court and request a slot" />}>
      <View testID={`sports-home-${presentation.composition}`} style={{ gap: t.spacing.sm }}>
        {presentation.showHistoryNavigation ? (
          <ListingCard
            variant="venue"
            title="My sports requests"
            subtitle="View your sports bookings and requests"
            onPress={() => router.push('/sports/bookings' as Href)}
          />
        ) : null}
        {presentation.businessActions.map((action) => (
          <ListingCard
            key={action.kind}
            variant="venue"
            title={action.title}
            subtitle={action.subtitle}
            onPress={() => router.push(action.href as Href)}
          />
        ))}
        {state.businessError ? <InlineAlert message={state.businessError} /> : null}
        {!presentation.showDiscovery ? (
          <InlineAlert message="Sports & venues are turned off right now." />
        ) : presentation.discoveryState === 'error' ? (
          <ErrorState message={state.error ?? 'Sports discovery could not be loaded.'} onRetry={() => void state.load()} />
        ) : presentation.discoveryState === 'loading' ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} height={72} radius={t.radii.lg} />)
        ) : presentation.discoveryState === 'empty' ? (
          <EmptyState icon="football-outline" title="No activities available" message="Please check again later." />
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: t.spacing.sm }}>
              {state.activities?.map((activity) => (
                <Card
                  key={activity.id}
                  variant="outlined"
                  style={{ width: '48%', minHeight: 132, justifyContent: 'center' }}
                  onPress={() => router.push({
                    pathname: '/sports/[activity]',
                    params: { activity: activity.slug, name: activity.name },
                  } as Href)}
                  accessibilityLabel={`${activity.name} sports venues`}
                >
                  <View style={{ alignItems: 'flex-start', gap: t.spacing.md }}>
                    <View style={{
                      width: 44,
                      height: 44,
                      borderRadius: t.radii.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: t.colors.catSportsSoft,
                    }}>
                      <Ionicons name={activity.icon as never} size={t.iconSize.lg} color={t.colors.catSports} />
                    </View>
                    <Text variant="calloutStrong" numberOfLines={2}>{activity.name}</Text>
                  </View>
                </Card>
              ))}
            </View>
            <Text variant="caption" color="muted" style={{ textAlign: 'center' }}>
              {getSportsHomePaymentNotice(state.onlinePaymentsEnabled)}
            </Text>
          </>
        )}
      </View>
    </Screen>
  );
}

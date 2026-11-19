import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { ListingCard } from '../../src/components/market/ListingCard';
import { Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../src/components/ui';
import { getSportsHomePaymentNotice } from '../../src/features/sports/model';
import { useAuth } from '../../src/lib/auth';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme';

export { getSportsHomePaymentNotice } from '../../src/features/sports/model';

interface Activity {
  id: string;
  slug: string;
  name: string;
  icon: string;
  sort_order: number;
}

export default function SportsHomeScreen() {
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const enabled = flags.isOn('sports');
  const onlinePaymentsEnabled = flags.isOn('sports_online_payments');
  const { activeRole } = useAuth();
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('list_sports_activities');
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setActivities((data ?? []) as Activity[]);
  }, [enabled]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen header={<Header title="Sports & venues" subtitle="Find a court and request a slot" />}>
      {!enabled ? (
        <InlineAlert message="Sports & venues are turned off right now." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !activities ? (
        [0, 1, 2, 3].map((i) => <Skeleton key={i} height={72} radius={t.radii.lg} />)
      ) : activities.length === 0 ? (
        <EmptyState icon="football-outline" title="No activities available" message="Please check again later." />
      ) : (
        <>
          <View style={{ gap: t.spacing.sm }}>
            <ListingCard
              variant="venue"
              title="My sports requests"
              subtitle="View your sports bookings and requests"
              onPress={() => router.push('/sports/bookings' as Href)}
            />
            {activeRole === 'provider' ? (
              <ListingCard
                variant="venue"
                title="My venues"
                subtitle="Manage your sports venues"
                onPress={() => router.push('/sports/manage' as Href)}
              />
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: t.spacing.sm }}>
            {activities.map((activity) => (
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
            {getSportsHomePaymentNotice(onlinePaymentsEnabled)}
          </Text>
        </>
      )}
    </Screen>
  );
}

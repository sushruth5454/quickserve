import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
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
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <Card onPress={() => router.push('/sports/bookings' as Href)} style={{ flex: 1 }}>
              <Text variant="calloutStrong">My sports requests</Text>
            </Card>
            {activeRole === 'provider' ? (
              <Card onPress={() => router.push('/sports/manage' as Href)} style={{ flex: 1 }}>
                <Text variant="calloutStrong">My venues</Text>
              </Card>
            ) : null}
          </View>
          <View style={{ gap: t.spacing.sm }}>
            {activities.map((activity) => (
              <Pressable
                key={activity.id}
                accessibilityRole="button"
                onPress={() => router.push(`/sports/${activity.slug}` as Href)}
                style={({ pressed }) => ({
                  minHeight: 68,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t.spacing.md,
                  padding: t.spacing.md,
                  borderRadius: t.radii.lg,
                  borderWidth: 1,
                  borderColor: t.colors.border,
                  backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
                })}
              >
                <View style={{
                  width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: t.colors.primarySoft,
                }}>
                  <Ionicons name={activity.icon as never} size={22} color={t.colors.primaryText} />
                </View>
                <Text variant="bodyStrong" style={{ flex: 1 }}>{activity.name}</Text>
                <Ionicons name="chevron-forward" size={18} color={t.colors.muted} />
              </Pressable>
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

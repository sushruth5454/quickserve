import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme';

interface VenueReview {
  id: string;
  name: string;
  city: string;
  area: string;
  owner_name: string;
  status: string;
  status_reason: string;
}

interface Activity {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

export default function AdminSportsScreen() {
  const t = useTheme();
  const toast = useToast();
  const flags = useAppFeatureFlags();
  const enabled = flags.isOn('sports');
  const [venues, setVenues] = useState<VenueReview[] | null>(null);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    const [venueResult, activityResult] = await Promise.all([
      supabase.rpc('admin_list_sports_venues'),
      supabase.rpc('admin_list_sports_activities'),
    ]);
    if (venueResult.error || activityResult.error) {
      setError(venueResult.error?.message ?? activityResult.error?.message ?? 'Could not load sports management.');
      return;
    }
    setVenues((venueResult.data ?? []) as VenueReview[]);
    setActivities((activityResult.data ?? []) as Activity[]);
  }, [enabled]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const setVenueStatus = async (venue: VenueReview, status: 'verified' | 'rejected' | 'suspended') => {
    setBusyId(venue.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_set_venue_status', {
      p_id: venue.id,
      p_status: status,
      p_reason: status === 'verified' ? '' : reason.trim(),
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setReason('');
    toast({ message: `Venue ${status}`, tone: 'success' });
    await load();
  };

  const toggleActivity = async (activity: Activity, active: boolean) => {
    setBusyId(activity.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_set_sports_activity', { p_id: activity.id, p_active: active });
    setBusyId(null);
    if (rpcError) setError(rpcError.message);
    else {
      toast({ message: `${activity.name} ${active ? 'enabled' : 'disabled'}`, tone: 'success' });
      await load();
    }
  };

  return (
    <Screen header={<Header title="Sports venues" subtitle="Review submitted venues and activities" onBack={() => router.back()} />}>
      {!enabled ? (
        <InlineAlert
          title="Sports is turned off"
          message="Enable Sports & venues from Admin → Features before managing venues or activities."
        />
      ) : error && !venues ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !venues || !activities ? (
        <Skeleton height={280} radius={t.radii.lg} />
      ) : (
        <>
          {error ? <InlineAlert message={error} /> : null}
          <Text variant="title3">Venue review</Text>
          {venues.length === 0 ? (
            <EmptyState icon="business-outline" title="No venues submitted" message="Submitted venues will appear here for review." compact />
          ) : venues.map((venue) => (
            <Card key={venue.id} gap={t.spacing.sm}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.sm }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text variant="bodyStrong">{venue.name}</Text>
                  <Text variant="footnote" color="muted">{venue.area}, {venue.city} · Owner: {venue.owner_name || 'QuickServe user'}</Text>
                </View>
                <Text variant="captionStrong" color={venue.status === 'verified' ? 'successText' : 'muted'}>{venue.status.toUpperCase()}</Text>
              </View>
              {venue.status_reason ? <Text variant="footnote" color="textSecondary">{venue.status_reason}</Text> : null}
              {venue.status === 'submitted' || venue.status === 'verified' ? (
                <Button
                  title="Verify venue"
                  onPress={() => void setVenueStatus(venue, 'verified')}
                  loading={busyId === venue.id}
                  disabled={busyId === venue.id}
                />
              ) : null}
              {venue.status !== 'draft' ? (
                <>
                  <Input
                    label="Reason required to reject or suspend"
                    value={reason}
                    onChangeText={setReason}
                    maxLength={500}
                  />
                  <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                    <Button
                      title="Reject"
                      variant="outline"
                      onPress={() => void setVenueStatus(venue, 'rejected')}
                      disabled={busyId === venue.id || reason.trim().length < 3}
                      style={{ flex: 1 }}
                    />
                    <Button
                      title="Suspend"
                      variant="destructiveGhost"
                      onPress={() => void setVenueStatus(venue, 'suspended')}
                      disabled={busyId === venue.id || reason.trim().length < 3}
                      style={{ flex: 1 }}
                    />
                  </View>
                </>
              ) : null}
            </Card>
          ))}
          <Text variant="title3">Sports activities</Text>
          {activities.map((activity) => (
            <Card key={activity.id} gap={0}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text variant="calloutStrong">{activity.name}</Text>
                  <Text variant="caption" color="muted">{activity.slug}</Text>
                </View>
                <Switch
                  value={activity.active}
                  disabled={busyId === activity.id}
                  onValueChange={(active) => void toggleActivity(activity, active)}
                />
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

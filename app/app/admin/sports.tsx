import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useConfirm, useToast } from '../../src/components/ui';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme';
import { getVenueReviewPresentation, type VenueReviewAction } from '../../src/features/sports/venueReviewPresentation';

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
  const confirm = useConfirm();
  const toast = useToast();
  const flags = useAppFeatureFlags();
  const enabled = flags.isOn('sports');
  const [venues, setVenues] = useState<VenueReview[] | null>(null);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
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

  const setVenueStatus = async (venue: VenueReview, action: VenueReviewAction) => {
    if (action.kind !== 'admin' || !action.target) return;
    const currentAction = getVenueReviewPresentation(venue.status, 'admin').actions
      .find((candidate) => candidate.kind === 'admin' && candidate.target === action.target);
    if (!currentAction?.target) return;
    const venueReason = (reason[venue.id] ?? '').trim();
    if (currentAction.reasonRequired && venueReason.length < 3) return;
    if (!await confirm(currentAction.confirmation)) return;

    setBusyId(venue.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_set_venue_status', {
      p_id: venue.id,
      p_status: currentAction.target,
      p_reason: currentAction.target === 'verified' ? '' : venueReason,
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setReason((current) => {
      const next = { ...current };
      delete next[venue.id];
      return next;
    });
    toast({ message: 'Venue status updated', tone: 'success' });
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
          ) : venues.map((venue) => {
            const venueReason = reason[venue.id] ?? '';
            const review = getVenueReviewPresentation(venue.status, 'admin');
            const reviewActions = review.actions.filter((action) => action.kind === 'admin');
            const verifiedAction = reviewActions.find((action) => action.target === 'verified');
            const restrictionActions = reviewActions.filter((action) => action.target !== 'verified');
            return (
            <Card key={venue.id} gap={t.spacing.sm}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.sm }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text variant="bodyStrong">{venue.name}</Text>
                  <Text variant="footnote" color="muted">{venue.area}, {venue.city} · Owner: {venue.owner_name || 'QuickServe user'}</Text>
                </View>
                <Text variant="captionStrong" color={venue.status === 'verified' ? 'successText' : 'muted'}>{review.statusLabel}</Text>
              </View>
              {venue.status_reason ? <Text variant="footnote" color="textSecondary">{venue.status_reason}</Text> : null}
              {verifiedAction ? (
                <Button
                  title={verifiedAction.label}
                  onPress={() => void setVenueStatus(venue, verifiedAction)}
                  loading={busyId === venue.id}
                  disabled={busyId === venue.id}
                />
              ) : null}
              {restrictionActions.length > 0 ? (
                <>
                  <Input
                    label="Reason required to reject or suspend"
                    value={venueReason}
                    onChangeText={(value) => setReason((current) => ({ ...current, [venue.id]: value }))}
                    maxLength={500}
                  />
                  <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                    {restrictionActions.map((action) => (
                      <Button
                        key={action.target}
                        title={action.label}
                        variant={action.target === 'suspended' ? 'destructiveGhost' : 'outline'}
                        onPress={() => void setVenueStatus(venue, action)}
                        disabled={busyId === venue.id || (action.reasonRequired === true && venueReason.trim().length < 3)}
                        style={{ flex: 1 }}
                      />
                    ))}
                  </View>
                </>
              ) : null}
            </Card>
          );
          })}
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

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { joinCityWaitlist, listLiveCities, onCityWaitlist, type LiveCity } from '../lib/api';
import { useSelectedLocation } from '../lib/locationContext';
import { useTheme } from '../theme';
import { Button, Card, Chip, Text } from './ui';

/** Shown on home when no live provider serves the selected location: change area, jump to a live city, or join the waitlist. */
export function NotServedCard() {
  const t = useTheme();
  const { location, setLocation } = useSelectedLocation();
  const place = location.area && location.area !== location.city ? `${location.area}, ${location.city}` : location.city;
  const [cities, setCities] = useState<LiveCity[]>([]);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setJoined(false);
    setJoinError(null);
    listLiveCities()
      .then((c) => alive && setCities(c.filter((x) => x.lat != null && x.lng != null)))
      .catch(() => undefined);
    onCityWaitlist(location.city)
      .then((w) => alive && setJoined(w))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [location.city]);

  const join = async () => {
    setJoining(true);
    setJoinError(null);
    try {
      await joinCityWaitlist(location.city, location.lat, location.lng);
      setJoined(true);
    } catch (e) {
      setJoinError((e as Error).message || 'Could not join the list. Try again.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <Card variant="outlined" accessibilityLabel={`QuickServe is not available in ${place} yet`}>
      <View style={{ alignItems: 'center', gap: t.spacing.sm, paddingVertical: t.spacing.sm }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="map-outline" size={26} color={t.colors.primaryText} />
        </View>
        <Text variant="title3" style={{ textAlign: 'center' }} accessibilityRole="header">
          Not in {location.city} yet
        </Text>
        <Text variant="footnote" color="textSecondary" style={{ textAlign: 'center' }}>
          No verified pros serve {place} right now. Pick another area, or tell us you want QuickServe here and we will
          notify you when it launches.
        </Text>
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <Button title="Change location" leftIcon="location-outline" onPress={() => router.push('/location')} fullWidth />
        <Button
          title={joined ? "You're on the list" : `Notify me when ${location.city} launches`}
          leftIcon={joined ? 'checkmark-circle-outline' : 'notifications-outline'}
          variant="outline"
          onPress={() => void join()}
          disabled={joined}
          loading={joining}
          fullWidth
        />
        {joinError ? (
          <Text variant="footnote" color="danger" accessibilityLiveRegion="polite">
            {joinError}
          </Text>
        ) : null}
      </View>

      {cities.length ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="caption" color="muted">
            Available now in
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {cities.map((c) => (
              <Chip
                key={c.city}
                label={`${c.city} · ${c.providers} pros`}
                icon="location-outline"
                accessibilityLabel={`Switch to ${c.city}, ${c.providers} verified pros`}
                onPress={() =>
                  setLocation({ source: 'area', area: c.city, city: c.city, lat: c.lat as number, lng: c.lng as number, line1: null, addressId: null, label: null })
                }
              />
            ))}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

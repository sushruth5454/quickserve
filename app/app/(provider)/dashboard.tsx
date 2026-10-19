import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Card, ErrorText, Screen, Section } from '../../src/components/Screen';
import { statusLabel } from '../../src/components/StatusTimeline';
import { acceptBooking, declineBooking, getMyProvider, getProviderJobs, setOnline } from '../../src/lib/api';
import { formatINR } from '../../src/lib/money';
import { colors, font, minTouch, spacing } from '../../src/lib/theme';
import type { BookingStatus, Provider, ProviderJob } from '../../src/lib/types';

const ACTIVE: BookingStatus[] = [
  'accepted',
  'en_route',
  'inspecting',
  'quote_sent',
  'awaiting_payment',
  'in_progress',
  'completion_requested',
  'disputed',
];

export default function ProviderDashboard() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [jobs, setJobs] = useState<ProviderJob[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const p = await getMyProvider();
      if (!p) {
        router.replace('/onboarding');
        return;
      }
      setProvider(p);
      setJobs(await getProviderJobs());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const toggleOnline = async (value: boolean) => {
    setProvider((p) => (p ? { ...p, is_online: value } : p));
    try {
      await setOnline(value);
    } catch (e) {
      setError((e as Error).message);
      setProvider((p) => (p ? { ...p, is_online: !value } : p));
    }
  };

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const incoming = jobs.filter((j) => j.status === 'requested');
  const active = jobs.filter((j) => ACTIVE.includes(j.status));

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.headerLink}>
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Customer mode</Text>
            </Pressable>
          ),
        }}
      />
      {provider && provider.kyc_status !== 'verified' && (
        <Card style={{ backgroundColor: colors.warningSoft }}>
          <Text style={font.heading}>Not visible in search yet</Text>
          <Text style={font.body}>
            Verification is done via our payment partner during payout setup. Status: {provider.kyc_status}.
          </Text>
        </Card>
      )}
      {provider?.suspended && <ErrorText message="Your account is suspended. Contact support." />}
      <Card>
        <View style={styles.between}>
          <View>
            <Text style={font.heading}>{provider?.is_online ? 'You are online' : 'You are offline'}</Text>
            <Text style={font.caption}>Online providers rank higher for “available now”.</Text>
          </View>
          <Switch
            value={!!provider?.is_online}
            onValueChange={toggleOnline}
            accessibilityLabel="Online status"
            trackColor={{ true: colors.success, false: colors.border }}
          />
        </View>
      </Card>
      <View style={styles.links}>
        <Button title="Earnings" variant="secondary" onPress={() => router.push('/earnings')} style={styles.flex} />
        <Button title="All jobs" variant="secondary" onPress={() => router.push('/jobs')} style={styles.flex} />
        <Button title="Profile" variant="secondary" onPress={() => router.push('/onboarding')} style={styles.flex} />
      </View>
      <ErrorText message={error} />

      <Section title={`Incoming requests (${incoming.length})`}>
        {incoming.length === 0 && <Text style={font.caption}>No new requests. Respond within 15 minutes when they arrive.</Text>}
        {incoming.map((j) => (
          <Card key={j.booking_id}>
            <Text style={font.heading}>{j.category_name}</Text>
            <Text style={font.body}>{j.description || 'No description'}</Text>
            <Text style={font.caption}>
              {j.area}
              {j.distance_km != null ? ` • ${j.distance_km} km away` : ''} •{' '}
              {j.scheduled_at ? new Date(j.scheduled_at).toLocaleString() : 'ASAP'}
            </Text>
            <Text style={font.caption}>Visit fee {formatINR(j.visit_fee)} (already paid by customer)</Text>
            <View style={styles.links}>
              <Button
                title="Decline"
                variant="secondary"
                style={styles.flex}
                disabled={busyId === j.booking_id}
                onPress={() => act(j.booking_id, () => declineBooking(j.booking_id))}
              />
              <Button
                title="Accept"
                style={styles.flex}
                loading={busyId === j.booking_id}
                onPress={() => act(j.booking_id, () => acceptBooking(j.booking_id))}
              />
            </View>
          </Card>
        ))}
      </Section>

      <Section title={`Active jobs (${active.length})`}>
        {active.length === 0 && <Text style={font.caption}>No active jobs.</Text>}
        {active.map((j) => (
          <Pressable
            key={j.booking_id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/booking/[id]', params: { id: j.booking_id } })}
          >
            <Card>
              <View style={styles.between}>
                <Text style={font.heading}>{j.category_name}</Text>
                <Text style={styles.status}>{statusLabel[j.status]}</Text>
              </View>
              <Text style={font.caption}>
                {j.customer_name || 'Customer'} • {j.address_line ?? j.area}
              </Text>
            </Card>
          </Pressable>
        ))}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  links: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  status: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  headerLink: { minHeight: minTouch, justifyContent: 'center' },
});

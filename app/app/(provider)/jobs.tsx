import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card, ErrorText, Screen } from '../../src/components/Screen';
import { statusLabel } from '../../src/components/StatusTimeline';
import { getProviderJobs } from '../../src/lib/api';
import { formatINR } from '../../src/lib/money';
import { font } from '../../src/lib/theme';
import type { ProviderJob } from '../../src/lib/types';

export default function ProviderJobs() {
  const [jobs, setJobs] = useState<ProviderJob[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
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

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <ErrorText message={error} />
      {!refreshing && jobs.length === 0 && <Text style={font.caption}>No jobs yet.</Text>}
      {jobs.map((j) => (
        <Pressable
          key={j.booking_id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/booking/[id]', params: { id: j.booking_id } })}
        >
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={font.heading}>{j.category_name}</Text>
              <Text style={font.caption}>{statusLabel[j.status]}</Text>
            </View>
            <Text style={font.caption}>
              {new Date(j.created_at).toLocaleDateString()} • {j.area} • visit {formatINR(j.visit_fee)}
            </Text>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

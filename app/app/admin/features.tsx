import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';
import { Card, ErrorState, Header, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import { getAppFeatures, setFeature, type AdminFeatures } from '../../src/lib/adminApi';
import { useTheme } from '../../src/theme';

const FEATURES = [
  { key: 'ai_assistant', title: 'AI assistant', description: 'Voice/text matching and AI booking draft.' },
  { key: 'urgent_requests', title: 'Urgent creator requests', description: 'Creator and event requests from 2 hours away.' },
  { key: 'fixed_asap', title: 'ASAP for fixed-price services', description: 'Immediate cleaning and similar package bookings.' },
] as const;

const ARCHETYPES = [
  ['inspect_quote', 'Repair & inspection'],
  ['fixed', 'Fixed-price packages'],
  ['time_based', 'Time-based sessions'],
  ['proposal', 'Creators & events'],
] as const;

export default function AdminFeaturesScreen() {
  const t = useTheme();
  const toast = useToast();
  const [features, setFeatures] = useState<AdminFeatures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const load = useCallback(() => {
    void getAppFeatures().then(setFeatures).catch((e: Error) => setError(e.message));
  }, []);
  useFocusEffect(load);

  const change = async (key: string, enabled: boolean) => {
    setSaving(key);
    try {
      setFeatures(await setFeature(key, enabled));
      toast({ message: `${enabled ? 'Enabled' : 'Disabled'}. The app will update shortly.`, tone: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Screen header={<Header title="Features" subtitle="Live switches · changes apply immediately" />}>
      {error ? <ErrorState message={error} onRetry={load} /> : !features ? <Skeleton height={300} radius={t.radii.lg} /> : (
        <>
          <Text variant="title3">App features</Text>
          {FEATURES.map((f) => (
            <Card key={f.key}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="calloutStrong">{f.title}</Text>
                  <Text variant="footnote" color="muted">{f.description}</Text>
                </View>
                <Switch value={!!features[f.key]} disabled={saving === f.key} onValueChange={(v) => void change(f.key, v)} />
              </View>
            </Card>
          ))}
          <Text variant="title3">Service types</Text>
          {ARCHETYPES.map(([key, title]) => (
            <Card key={key}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                <Text variant="calloutStrong" style={{ flex: 1 }}>{title}</Text>
                <Switch value={!!features.archetypes?.[key]} disabled={saving === `archetype:${key}`} onValueChange={(v) => void change(`archetype:${key}`, v)} />
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

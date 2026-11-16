import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Switch, View } from 'react-native';
import { Badge, Card, ErrorState, Header, Input, Screen, SegmentedControl, Skeleton, Text, useToast } from '../../src/components/ui';
import { listCategories, setCategoryActive, setCategoryCity, type AdminCategory } from '../../src/lib/adminApi';
import { useTheme } from '../../src/theme';

export default function AdminServicesScreen() {
  const t = useTheme();
  const toast = useToast();
  const [rows, setRows] = useState<AdminCategory[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    void listCategories().then(setRows).catch((e: Error) => setError(e.message));
  }, []);
  useFocusEffect(load);
  const visible = useMemo(() => (rows ?? []).filter((r) =>
    (filter === 'all' || r.archetype === filter) && (!q || `${r.name} ${r.slug}`.toLowerCase().includes(q.toLowerCase()))), [rows, filter, q]);

  const categoryToggle = async (r: AdminCategory, active: boolean) => {
    setSaving(r.id);
    try {
      await setCategoryActive(r.id, active);
      setRows((old) => old?.map((x) => x.id === r.id ? { ...x, active } : x) ?? null);
      toast({ message: `${r.name} ${active ? 'enabled' : 'disabled'}`, tone: 'success' });
    } catch (e) { toast({ message: (e as Error).message, tone: 'error' }); }
    finally { setSaving(null); }
  };
  const cityToggle = async (r: AdminCategory, city: string, live: boolean) => {
    setSaving(`${r.id}:${city}`);
    try {
      await setCategoryCity(r.id, city, live);
      setRows((old) => old?.map((x) => x.id === r.id
        ? { ...x, cities: x.cities.map((cc) => cc.city === city ? { ...cc, live } : cc) }
        : x) ?? null);
    } catch (e) { toast({ message: (e as Error).message, tone: 'error' }); }
    finally { setSaving(null); }
  };

  return (
    <Screen header={<Header title="Services" subtitle={`${rows?.length ?? 0} categories`} />}>
      <Input label="Search" placeholder="Service name" value={q} onChangeText={setQ} />
      <SegmentedControl
        options={[{ value: 'all', label: 'All' }, { value: 'inspect_quote', label: 'Repairs' }, { value: 'fixed', label: 'Fixed' }, { value: 'proposal', label: 'Creators' }]}
        value={filter}
        onChange={setFilter}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : !rows ? <Skeleton height={400} radius={t.radii.lg} /> : visible.map((r) => (
        <Card key={r.id} gap={t.spacing.md}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text variant="calloutStrong">{r.name}</Text>
              <Text variant="caption" color="muted">{r.archetype.replace('_', ' ')} · {r.providers} providers · {r.bookings_30d} bookings / 30d</Text>
            </View>
            <Badge label={r.active ? 'On' : 'Off'} tone={r.active ? 'success' : 'neutral'} />
            <Switch value={r.active} disabled={saving === r.id} onValueChange={(v) => void categoryToggle(r, v)} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {r.cities.map((c) => (
              <View key={c.city} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text variant="footnote">{c.city}</Text>
                <Switch
                  style={{ transform: [{ scale: 0.8 }] }}
                  value={c.live}
                  disabled={saving === `${r.id}:${c.city}`}
                  onValueChange={(v) => void cityToggle(r, c.city, v)}
                />
              </View>
            ))}
          </View>
        </Card>
      ))}
    </Screen>
  );
}

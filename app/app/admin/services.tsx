import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Switch, View } from 'react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Header, Input, Screen, SegmentedControl, Skeleton, Text, useToast } from '../../src/components/ui';
import { adminReorderCategories, listCategories, setCategoryActive, setCategoryCity, type AdminCategory } from '../../src/lib/adminApi';
import { useFeature } from '../../src/lib/featureFlags';
import { useTheme } from '../../src/theme';

export default function AdminServicesScreen() {
  const t = useTheme();
  const router = useRouter();
  const toast = useToast();
  const canEditCategories = useFeature('admin_category_editor');
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
    (filter === 'all' || r.archetype === filter) && (!q || `${r.name} ${r.slug}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.parent_id ?? '').localeCompare(b.parent_id ?? '') || a.sort_order - b.sort_order || a.name.localeCompare(b.name)), [rows, filter, q]);

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
      toast({ message: `${city} availability updated`, tone: 'success' });
    } catch (e) { toast({ message: (e as Error).message, tone: 'error' }); }
    finally { setSaving(null); }
  };

  const moveCategory = async (category: AdminCategory, offset: -1 | 1) => {
    const siblings = (rows ?? [])
      .filter((row) => row.parent_id === category.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const currentIndex = siblings.findIndex((row) => row.id === category.id);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= siblings.length) return;
    const [moved] = siblings.splice(currentIndex, 1);
    siblings.splice(nextIndex, 0, moved!);

    const saveKey = `order:${category.parent_id ?? 'root'}`;
    setSaving(saveKey);
    try {
      await adminReorderCategories(siblings.map((row) => row.id));
      const positions = new Map<string, number>();
      siblings.forEach((row, index) => positions.set(row.id, index * 10));
      setRows((old) => old?.map((row) => positions.has(row.id)
        ? { ...row, sort_order: positions.get(row.id)! }
        : row) ?? null);
      toast({ message: 'Category order saved', tone: 'success' });
    } catch (e) { toast({ message: (e as Error).message, tone: 'error' }); }
    finally { setSaving(null); }
  };

  const parentNames = useMemo(
    () => new Map<string, string>((rows ?? []).map((row) => [row.id, row.name])),
    [rows],
  );

  return (
    <Screen header={<Header title="Services" subtitle={`${rows?.length ?? 0} categories`} />}>
      {canEditCategories && rows && rows.length > 0 ? (
        <Button
          title="New service"
          leftIcon="add"
          onPress={() => router.push('/admin/category/new')}
        />
      ) : null}
      <Input label="Search" placeholder="Service name" value={q} onChangeText={setQ} />
      <SegmentedControl
        options={[{ value: 'all', label: 'All' }, { value: 'inspect_quote', label: 'Repairs' }, { value: 'fixed', label: 'Fixed' }, { value: 'proposal', label: 'Creators' }]}
        value={filter}
        onChange={setFilter}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : !rows ? <Skeleton height={400} radius={t.radii.lg} /> : visible.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? 'No services yet' : 'No matching services'}
          message={rows.length === 0 ? 'Add a service category to start building the catalogue.' : 'Try a different search or category filter.'}
          actionLabel={rows.length === 0 && canEditCategories ? 'New service' : undefined}
          onAction={rows.length === 0 && canEditCategories ? () => router.push('/admin/category/new') : undefined}
          icon="grid-outline"
        />
      ) : visible.map((r) => {
        const siblings = (rows ?? [])
          .filter((row) => row.parent_id === r.parent_id)
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
        const siblingIndex = siblings.findIndex((row) => row.id === r.id);
        const orderKey = `order:${r.parent_id ?? 'root'}`;
        const parentName = r.parent_id ? parentNames.get(r.parent_id) : null;
        const kind = r.archetype ? r.archetype.replace('_', ' ') : 'Group';
        return (
        <Card key={r.id} gap={t.spacing.md}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text variant="calloutStrong">{r.name}</Text>
              <Text variant="caption" color="muted">
                {parentName ? `${parentName} · ` : ''}{kind} · {r.providers} providers · {r.bookings_30d} bookings / 30d
              </Text>
            </View>
            <Badge label={r.active ? 'On' : 'Off'} tone={r.active ? 'success' : 'neutral'} />
            <Switch
              accessibilityLabel={`${r.name} active`}
              value={r.active}
              disabled={saving === r.id}
              onValueChange={(v) => void categoryToggle(r, v)}
            />
          </View>
          {canEditCategories ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                <Button
                  title="Edit"
                  size="sm"
                  variant="outline"
                  onPress={() => router.push(`/admin/category/${r.id}`)}
                />
                <Button
                  title="Move up"
                  size="sm"
                  variant="ghost"
                  disabled={siblingIndex <= 0 || saving === orderKey}
                  onPress={() => void moveCategory(r, -1)}
                />
                <Button
                  title="Move down"
                  size="sm"
                  variant="ghost"
                  disabled={siblingIndex < 0 || siblingIndex >= siblings.length - 1 || saving === orderKey}
                  onPress={() => void moveCategory(r, 1)}
                />
              </View>
          ) : null}
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
        );
      })}
    </Screen>
  );
}

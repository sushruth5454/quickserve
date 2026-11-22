import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../components/ui';
import {
  adminListProductCategories,
  adminListShops,
  adminSetProductCategoryActive,
  adminSetShopStatus,
  adminShopDashboard,
  type AdminShop,
  type ShopStatus,
} from '../shops/api';
import { ShopStatusLabel } from '../shops/components';
import { useTheme } from '../../theme';

type CategoryRow = { id: string; slug: string; name: string; active: boolean; sort_order: number };
type Dashboard = { shops: number; verified_shops: number; products: number; open_enquiries: number };

const FILTERS = ['all', 'draft', 'submitted', 'under_review', 'verified', 'rejected', 'suspended'] as const;

export default function AdminShopsScreen() {
  const t = useTheme();
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('submitted');
  const [shops, setShops] = useState<AdminShop[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [readsCurrent, setReadsCurrent] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setReadsCurrent(false);
    setError(null);
    setActionError(null);
    try {
      const [nextShops, nextCategories, nextDashboard] = await Promise.all([
        adminListShops(filter),
        adminListProductCategories(),
        adminShopDashboard(),
      ]);
      setShops(nextShops);
      setCategories(nextCategories);
      setDashboard(nextDashboard);
      setError(null);
      setReadsCurrent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const setStatus = async (shop: AdminShop, status: ShopStatus) => {
    if (!readsCurrent) return;
    const reason = reasons[shop.id] ?? '';
    if ((status === 'rejected' || status === 'suspended') && !reason.trim()) {
      toast({ message: 'A reason is required to reject or suspend a shop.', tone: 'error' });
      return;
    }
    setBusy(shop.id);
    setActionError(null);
    try {
      await adminSetShopStatus(shop.id, status, reasons[shop.id] ?? '');
      setReasons((current) => ({ ...current, [shop.id]: '' }));
      await load();
      toast({ message: `${shop.name}: ${status.replaceAll('_', ' ')}`, tone: 'success' });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggleCategory = async (category: CategoryRow) => {
    if (!readsCurrent) return;
    setBusy(category.id);
    setActionError(null);
    try {
      await adminSetProductCategoryActive(category.id, !category.active);
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen header={<Header title="Shop management" subtitle="Review shops and catalogue categories" />} gap={t.spacing.md} refreshing={loading} onRefresh={() => void load()}>
      {error && !readsCurrent && !shops.length && !categories.length && !dashboard
        ? <ErrorState message={error} onRetry={() => void load()} />
        : <InlineAlert message={error ? `Refresh failed. Showing saved results; actions are disabled until a successful refresh. ${error}` : null} actionLabel={error ? 'Retry' : undefined} onAction={error ? () => void load() : undefined} />}
      <InlineAlert message={actionError} />
      {dashboard ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          <Card style={{ flexGrow: 1 }}><Text variant="caption" color="muted">Shops</Text><Text variant="title3">{dashboard.shops}</Text></Card>
          <Card style={{ flexGrow: 1 }}><Text variant="caption" color="muted">Verified</Text><Text variant="title3">{dashboard.verified_shops}</Text></Card>
          <Card style={{ flexGrow: 1 }}><Text variant="caption" color="muted">Active products</Text><Text variant="title3">{dashboard.products}</Text></Card>
          <Card style={{ flexGrow: 1 }}><Text variant="caption" color="muted">Open enquiries</Text><Text variant="title3">{dashboard.open_enquiries}</Text></Card>
        </View>
      ) : null}

      <Card>
        <Text variant="title3">Shop verification</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {FILTERS.map((status) => <Chip key={status} label={status.replaceAll('_', ' ')} selected={filter === status} onPress={() => setFilter(status)} />)}
        </View>
      </Card>
      {loading && !shops.length && !readsCurrent ? <Skeleton height={150} radius={t.radii.lg} /> : shops.length ? shops.map((shop) => (
        <Card key={shop.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm }}>
            <Text variant="calloutStrong" style={{ flex: 1 }}>{shop.name}</Text>
            <ShopStatusLabel status={shop.status} />
          </View>
          <Text variant="footnote" color="muted">{shop.owner_name} · {[shop.address_line, shop.area, shop.city].filter(Boolean).join(', ')}</Text>
          {shop.description ? <Text>{shop.description}</Text> : null}
          {shop.gstin ? <Text variant="caption" color="muted">GSTIN: {shop.gstin}</Text> : null}
          {shop.lat != null && shop.lng != null ? <Text variant="caption" color="muted">{shop.lat.toFixed(5)}, {shop.lng.toFixed(5)}</Text> : null}
          <Text variant="caption" color="muted">Categories: {shop.category_slugs.join(' · ') || 'None'}</Text>
          {shop.status_reason ? <Text color="dangerText">Reason: {shop.status_reason}</Text> : null}
          <Input
            label="Reason (required to reject or suspend)"
            value={reasons[shop.id] ?? ''}
            onChangeText={(value) => setReasons((current) => ({ ...current, [shop.id]: value }))}
            maxLength={500}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
            <Button title="Under review" size="sm" variant="outline" loading={busy === shop.id} disabled={!readsCurrent} onPress={() => void setStatus(shop, 'under_review')} />
            <Button title="Verify" size="sm" loading={busy === shop.id} disabled={!readsCurrent} onPress={() => void setStatus(shop, 'verified')} />
            <Button title="Reject" size="sm" variant="outline" loading={busy === shop.id} disabled={!readsCurrent} onPress={() => void setStatus(shop, 'rejected')} />
            <Button title="Suspend" size="sm" variant="ghost" loading={busy === shop.id} disabled={!readsCurrent} onPress={() => void setStatus(shop, 'suspended')} />
          </View>
        </Card>
      )) : readsCurrent ? <EmptyState title="No shops match this filter" /> : null}

      <Card>
        <Text variant="title3">Product categories</Text>
        {categories.map((category) => (
          <View key={category.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text variant="calloutStrong">{category.name}</Text>
              <Text variant="caption" color="muted">{category.slug}</Text>
            </View>
            <Button title={category.active ? 'Disable' : 'Enable'} size="sm" variant="outline" loading={busy === category.id} disabled={!readsCurrent} onPress={() => void toggleCategory(category)} />
          </View>
        ))}
        {readsCurrent && !categories.length ? <EmptyState title="No product categories" /> : null}
      </Card>
    </Screen>
  );
}

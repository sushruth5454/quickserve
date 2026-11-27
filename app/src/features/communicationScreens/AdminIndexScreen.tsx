import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Badge, Card, EmptyState, Header, ListItem, Screen, Skeleton, Text } from '../../components/ui';
import { getDashboard, type AdminDashboard } from '../../lib/adminApi';
import { isAdminRulesEditorEnabled } from '../../lib/adminFeaturePresentation';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';

const compact = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export default function AdminIndexScreen() {
  const t = useTheme();
  const features = useAppFeatureFlags();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { data, error, load } = useAdminIndexController();
  const backToProfile = () => router.dismissTo(returnTo === 'pro-account' ? '/pro-account' : '/account');

  return (
    <Screen header={<Header title="Admin" subtitle="QuickServe operations · last 30 days" onBack={backToProfile} />}>
      {error ? <EmptyState icon="alert-circle-outline" title="Dashboard unavailable" message={error} actionLabel="Retry" onAction={load} /> : !data ? (
        <Skeleton height={360} radius={t.radii.lg} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            <Metric label="Gross payments collected" value={formatINR(data.totals.gmv_period_paise)} wide />
            <Metric label="Bookings" value={compact(data.totals.bookings_active)} note={`${data.totals.bookings} total`} />
            <Metric label="Users" value={compact(data.totals.users)} note={`${data.totals.customers} customers`} />
            <Metric label="KYC verified" value={String(data.totals.providers_verified)} note={`${data.totals.providers_pending} admin reviews pending`} />
            <Metric label="Creators" value={String(data.totals.creators)} note={`${data.totals.providers_online} online now`} />
            <Metric label="Open support" value={String(data.totals.support_open)} note={`${data.totals.support_unread} unread`} />
            <Metric label="Open disputes" value={String(data.totals.disputes_open)} />
          </View>

          <Card gap={t.spacing.md}>
            <Text variant="title3">Bookings trend</Text>
            <DailyBars data={data.daily} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption" color="muted">{data.daily[0]?.day}</Text>
              <Text variant="caption" color="muted">{data.daily.at(-1)?.day}</Text>
            </View>
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            <Action label="Features" icon="toggle-outline" onPress={() => router.push('/admin/features')} />
            {isAdminRulesEditorEnabled(features.isOn) ? <Action label="Rules" icon="options-outline" onPress={() => router.push('/admin/rules')} /> : null}
            <Action label="AI usage" icon="sparkles-outline" onPress={() => router.push('/admin/ai')} />
            <Action label="Commission" icon="cash-outline" onPress={() => router.push('/admin/commission')} />
            <Action label="Refunds" icon="card-outline" onPress={() => router.push('/admin/refunds')} />
            {features.isOn('platform_fee_settings') ? <Action label="Platform fees" icon="pricetag-outline" onPress={() => router.push('/admin/fees')} /> : null}
            <Action label="Coins" icon="sparkles-outline" onPress={() => router.push('/admin/coins')} />
            <Action label="Geography" icon="map-outline" onPress={() => router.push('/admin/geography')} />
            <Action label="Sports" icon="football-outline" onPress={() => router.push('/admin/sports')} />
            <Action label="Shops" icon="storefront-outline" onPress={() => router.push('/admin/shops')} />
            <Action label="Documents" icon="document-text-outline" onPress={() => router.push('/admin/documents')} />
            <Action label="Product RFQs" icon="document-text-outline" onPress={() => router.push('/admin/rfqs')} />
            <Action label="Services" icon="grid-outline" onPress={() => router.push('/admin/services')} />
            <Action label="People" icon="people-outline" badge={data.totals.providers_pending} onPress={() => router.push('/admin/people')} />
            <Action label="Bookings" icon="calendar-outline" badge={data.totals.disputes_open} onPress={() => router.push('/admin/bookings')} />
            <Action label="Support" icon="chatbubbles-outline" badge={data.totals.support_unread} onPress={() => router.push('/admin/support')} />
          </View>

          <Card padding={0} gap={0}>
            <ListItem title="Top service categories" subtitle="Bookings in this period" icon="analytics-outline" chevron={false} />
            {data.top_categories.map((c, i) => (
              <ListItem key={`${c.name}-${i}`} title={`${i + 1}. ${c.name}`} subtitle={c.archetype.replace('_', ' ')} value={`${c.bookings}`} />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

function useAdminIndexController() {
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    void getDashboard(30).then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useFocusEffect(load);
  return { data, error, load };
}

function Metric({ label, value, note, wide = false }: { label: string; value: string; note?: string; wide?: boolean }) {
  return (
    <Card style={{ width: wide ? '100%' : '48%', minWidth: 150 }} gap={4}>
      <Text variant="overline" color="muted">{label}</Text>
      <Text variant={wide ? 'title1' : 'title2'}>{value}</Text>
      {note ? <Text variant="caption" color="muted">{note}</Text> : null}
    </Card>
  );
}

function Action({ label, icon, badge, onPress }: { label: string; icon: any; badge?: number; onPress: () => void }) {
  return (
    <Card onPress={onPress} style={{ width: '48%', minWidth: 150 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="title3" style={{ flex: 1 }}>{label}</Text>
        {badge ? <Badge label={String(badge)} tone="danger" /> : null}
      </View>
      <Text variant="caption" color="muted">{icon.replace('-outline', '')}</Text>
    </Card>
  );
}

function DailyBars({ data }: { data: AdminDashboard['daily'] }) {
  const t = useTheme();
  const max = Math.max(1, ...data.map((d) => d.bookings));
  return (
    <View style={{ height: 100, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
      {data.map((d) => (
        <View key={d.day} style={{ flex: 1, height: 100, justifyContent: 'flex-end' }}>
          <View style={{ height: Math.max(3, (d.bookings / max) * 94), borderRadius: 2, backgroundColor: t.colors.primary }} />
        </View>
      ))}
    </View>
  );
}

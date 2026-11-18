import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Card, EmptyState, Header, Screen, Skeleton, Text } from '../../src/components/ui';
import { getAdminAiUsageDashboard, type AdminAiUsageDashboard } from '../../src/features/ai/adminApi';
import { useTheme } from '../../src/theme';

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;
const labels: Record<string, string> = {
  ai_assistant: 'AI chat',
  ai_product_search: 'AI product search',
  ai_quote_extract: 'AI quote reading',
};

export default function AdminAiScreen() {
  const t = useTheme();
  const [data, setData] = useState<AdminAiUsageDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    void getAdminAiUsageDashboard().then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Screen header={<Header title="AI usage" subtitle="Product-assistance calls, cost and error rate" onBack={() => router.back()} />}>
      {error ? (
        <EmptyState icon="alert-circle-outline" title="AI usage unavailable" message={error} actionLabel="Retry" onAction={load} />
      ) : !data ? (
        <Skeleton height={280} radius={t.radii.lg} />
      ) : (
        <>
          <Card gap={t.spacing.sm}>
            <Text variant="title3">Global monthly AI budget</Text>
            <Text variant="title2">{usd(data.monthly_cost_micros_usd)} / ${data.monthly_budget_usd.toFixed(2)}</Text>
            <Text variant="caption" color="muted">Includes metered product-assistance and existing chat model calls.</Text>
          </Card>
          <View style={{ gap: t.spacing.sm }}>
            {data.features.map((feature) => (
              <Card key={feature.feature} gap={t.spacing.xs}>
                <Text variant="title3">{labels[feature.feature] ?? feature.feature}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.md }}>
                  <Text variant="body">Requests today: {feature.calls_today}</Text>
                  <Text variant="body">Error rate: {feature.error_rate_percent.toFixed(2)}%</Text>
                </View>
                {feature.feature === 'ai_assistant' ? (
                  <Text variant="caption" color="muted">Model calls today, including fallback calls: {feature.usage_events_today}</Text>
                ) : null}
                <Text variant="caption" color="muted">
                  This month: {feature.input_tokens_month} input / {feature.output_tokens_month} output tokens · {usd(feature.cost_month_micros_usd)}
                </Text>
              </Card>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

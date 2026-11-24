import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Card, EmptyState, Header, Screen, Skeleton, Text } from '../../components/ui';
import { getAdminAiUsageDashboard, type AdminAiFeatureUsage, type AdminAiUsageDashboard } from '../../features/ai/adminApi';
import { useFeature } from '../../lib/featureFlags';
import { useTheme } from '../../theme';

export const ADMIN_AI_PERIOD_CONTEXT = 'Today and this month are reported in Indian Standard Time (IST).';

export const formatAdminAiUsd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;

export function getAdminAiFeatureMeasures(feature: AdminAiFeatureUsage) {
  return {
    requests: `Requests today: ${feature.calls_today}`,
    errorRate: `Error rate: ${feature.error_rate_percent.toFixed(2)}%`,
    modelCalls: feature.feature === 'ai_assistant'
      ? `Model calls today, including fallback calls: ${feature.usage_events_today}`
      : null,
    monthlyUsage: `This month: ${feature.input_tokens_month} input / ${feature.output_tokens_month} output tokens · ${formatAdminAiUsd(feature.cost_month_micros_usd)}`,
  };
}

const labels: Record<string, string> = {
  ai_assistant: 'AI chat',
  ai_product_search: 'AI product search',
  ai_quote_extract: 'AI quote reading',
};

export default function AdminAiScreen() {
  const t = useTheme();
  const configUx = useFeature('oorva_admin_config_ux');
  const [data, setData] = useState<AdminAiUsageDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    void getAdminAiUsageDashboard().then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Screen header={<Header
      title="AI usage"
      subtitle={configUx
        ? 'Product-assistance calls, cost and error rate · Today/month in IST'
        : 'Product-assistance calls, cost and error rate'}
      onBack={() => router.back()}
    />}>
      {error ? (
        <EmptyState icon="alert-circle-outline" title="AI usage unavailable" message={error} actionLabel="Retry" onAction={load} />
      ) : !data ? (
        <Skeleton height={280} radius={t.radii.lg} />
      ) : (
        <>
          {configUx ? (
            <Card gap={t.spacing.xs}>
              <Text variant="title3">Usage periods</Text>
              <Text variant="caption" color="muted">{ADMIN_AI_PERIOD_CONTEXT}</Text>
            </Card>
          ) : null}
          <Card gap={t.spacing.sm}>
            <Text variant="title3">Global monthly AI budget</Text>
            <Text variant="title2">{formatAdminAiUsd(data.monthly_cost_micros_usd)} / ${data.monthly_budget_usd.toFixed(2)}</Text>
            <Text variant="caption" color="muted">Includes metered product-assistance and existing chat model calls.</Text>
          </Card>
          {configUx ? <Text variant="title3">Usage by feature</Text> : null}
          <View style={{ gap: t.spacing.sm }}>
            {data.features.map((feature) => {
              const measures = getAdminAiFeatureMeasures(feature);
              return (
                <Card key={feature.feature} gap={t.spacing.xs}>
                  <Text variant="title3">{labels[feature.feature] ?? feature.feature}</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.md, flexWrap: 'wrap' }}>
                    <Text variant="body">{measures.requests}</Text>
                    <Text variant="body">{measures.errorRate}</Text>
                  </View>
                  {measures.modelCalls ? <Text variant="caption" color="muted">{measures.modelCalls}</Text> : null}
                  <Text variant="caption" color="muted">{measures.monthlyUsage}</Text>
                </Card>
              );
            })}
          </View>
        </>
      )}
    </Screen>
  );
}

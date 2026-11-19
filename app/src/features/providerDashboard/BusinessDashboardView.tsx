import { router } from 'expo-router';
import type { Dispatch, SetStateAction } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, EmptyState, InlineAlert, Screen, Section, SkeletonCard, Text } from '../../components/ui';
import { statusShort, statusTone } from '../../components/status';
import type { BusinessProviderContext } from '../merchantStaff/api';
import type { ProviderJob } from '../../lib/types';
import type { Theme } from '../../theme/ThemeProvider';
import { ProviderProposalInbox } from '../proposals/ProviderProposalInbox';
import { ProviderRecurringOverview } from '../recurring/ProviderRecurringOverview';

type BusinessDashboardViewProps = {
  provider: BusinessProviderContext;
  t: Theme;
  refreshing: boolean;
  setRefreshing: Dispatch<SetStateAction<boolean>>;
  load: () => Promise<void>;
  error: string | null;
  jobs: ProviderJob[] | null;
};

export function BusinessDashboardView({ provider, t, refreshing, setRefreshing, load, error, jobs }: BusinessDashboardViewProps) {
    return (
      <Screen inTabs gap={t.spacing.md} refreshing={refreshing} onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}>
        <Card>
          <Text variant="title3">Business work</Text>
          <Text variant="footnote" color="muted">
            Access: {provider.business_role}. Only the business owner can change payouts, prices, verification, or staff access.
          </Text>
          <Button title="All assigned business work" variant="outline" onPress={() => router.push('/merchant-work')} />
        </Card>
        {error ? <InlineAlert message={error} /> : null}
        {provider.business_role === 'manager' ? <ProviderProposalInbox providerId={provider.id} /> : null}
        <ProviderRecurringOverview providerId={provider.id} role={provider.business_role} />
        <Section title="Assigned jobs">
          {!jobs ? <SkeletonCard lines={3} /> : jobs.length === 0 ? (
            <EmptyState compact icon="briefcase-outline" title="No jobs are assigned to this business." />
          ) : jobs.map((job) => (
            <Card key={job.booking_id} gap={t.spacing.sm}>
              <Text variant="calloutStrong">{job.customer_name} · {job.category_name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                <Badge label={statusShort[job.status]} tone={statusTone[job.status]} />
                <Text variant="caption" color="muted">{job.area || 'Location shared after acceptance'}</Text>
              </View>
              <Text variant="footnote">{job.description}</Text>
              <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                <Button
                  title="Open chat"
                  variant="outline"
                  onPress={() => router.push({ pathname: '/merchant-job/[id]', params: { id: job.booking_id } })}
                  style={{ flex: 1 }}
                />
                {provider.business_role === 'manager' && ['inspecting', 'quote_sent', 'in_progress'].includes(job.status) ? (
                  <Button
                    title="Send quote"
                    onPress={() => router.push({ pathname: '/quote/[bookingId]', params: { bookingId: job.booking_id, changeOrder: '0' } })}
                    style={{ flex: 1 }}
                  />
                ) : null}
              </View>
            </Card>
          ))}
        </Section>
      </Screen>
    );

}

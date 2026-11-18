import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, Card, EmptyState, Header, InlineAlert, Screen, Skeleton, Text } from '../src/components/ui';
import { useAppFeatureFlags } from '../src/lib/featureFlags';
import { listMyBusinessMemberships, type BusinessMembership } from '../src/features/merchantStaff/api';
import { useTheme } from '../src/theme';

export default function MerchantWorkScreen() {
  const t = useTheme();
  const enabled = useAppFeatureFlags().isOn('merchant_staff');
  const [memberships, setMemberships] = useState<BusinessMembership[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setMemberships(await listMyBusinessMemberships());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [enabled]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!enabled) {
    return <Screen header={<Header title="Business work" />}><InlineAlert message="Staff accounts are turned off right now." /></Screen>;
  }

  return (
    <Screen header={<Header title="Business work" subtitle="Jobs and requests assigned to you" />} gap={t.spacing.md}>
      <InlineAlert message={error} />
      {memberships == null ? <Skeleton height={100} radius={t.radii.lg} /> : memberships.length === 0 ? (
        <EmptyState title="No active business access" message="Ask a business owner to add your existing QuickServe user ID." />
      ) : memberships.map((membership) => (
        <Card key={`${membership.owner_id}:${membership.business_type}`} gap={t.spacing.sm}>
          <Text variant="title3">{membership.business_name}</Text>
          <Text variant="caption" color="muted">{membership.business_type} · {membership.role}</Text>
          {membership.business_type === 'provider' ? (
            <Button
              title="Open assigned jobs"
              onPress={() => router.push({ pathname: '/dashboard', params: { providerId: membership.owner_id } })}
            />
          ) : null}
          {membership.business_type === 'shop' ? (
            <>
              <Button title="Open shop enquiries" onPress={() => router.push('/merchant-enquiries')} />
              <Button title="Open supplier RFQs" variant="outline" onPress={() => router.push('/merchant-rfqs')} />
            </>
          ) : null}
          {membership.business_type === 'sports' ? (
            <Button title="Open sports bookings" onPress={() => router.push('/sports/manage')} />
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

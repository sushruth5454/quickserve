import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../components/ui';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { listMyBusinessMemberships, type BusinessMembership } from '../merchantStaff/api';
import { useTheme } from '../../theme';

export interface BusinessWorkFeatures {
  merchantStaff: boolean;
  products: boolean;
  productEnquiries: boolean;
  productRfq: boolean;
  sports: boolean;
}

export type BusinessWorkAction = 'provider-jobs' | 'shop-enquiries' | 'shop-rfqs' | 'sports-bookings';

export function getBusinessWorkKey(membership: BusinessMembership): string {
  return `${membership.business_type}:${membership.business_id}`;
}

export function getBusinessWorkPresentation(
  membership: BusinessMembership,
  features: BusinessWorkFeatures,
): { actions: BusinessWorkAction[]; message: string | null } {
  const isOwner = membership.role === 'owner';
  if (!isOwner && !features.merchantStaff) {
    return {
      actions: [],
      message: 'Staff access is turned off, so assigned work is unavailable. Your account and personal history remain separate.',
    };
  }

  if (membership.business_type === 'provider') {
    return { actions: ['provider-jobs'], message: null };
  }

  if (membership.business_type === 'sports') {
    return features.sports
      ? { actions: ['sports-bookings'], message: null }
      : { actions: [], message: 'Sports is turned off, so sports work is unavailable. Your account and personal history remain separate.' };
  }

  if (!features.products) {
    return {
      actions: [],
      message: 'Products is turned off, so shop enquiries and supplier RFQs are unavailable. Your account and personal history remain separate.',
    };
  }

  const actions: BusinessWorkAction[] = [];
  const unavailable: string[] = [];
  if (features.productEnquiries) actions.push('shop-enquiries');
  else unavailable.push('product enquiries');
  if (features.productRfq) actions.push('shop-rfqs');
  else unavailable.push('supplier RFQs');

  return {
    actions,
    message: unavailable.length
      ? `${unavailable.join(' and ')} are turned off. Your account and personal history remain separate.`
      : null,
  };
}

interface ReadState {
  value: BusinessMembership[] | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Business access could not be loaded.';
}

function useMerchantWorkController() {
  const flags = useAppFeatureFlags();
  const features: BusinessWorkFeatures = {
    merchantStaff: flags.isOn('merchant_staff'),
    products: flags.isOn('products'),
    productEnquiries: flags.isOn('product_enquiries'),
    productRfq: flags.isOn('product_rfq'),
    sports: flags.isOn('sports'),
  };
  const [read, setRead] = useState<ReadState>({
    value: null,
    error: null,
    loading: false,
    refreshing: false,
  });
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    if (!features.merchantStaff) return;
    const request = ++requestSequence.current;
    setRead((current) => ({
      ...current,
      loading: current.value === null,
      refreshing: current.value !== null,
    }));
    try {
      const value = await listMyBusinessMemberships();
      if (request !== requestSequence.current) return;
      setRead({ value, error: null, loading: false, refreshing: false });
    } catch (error) {
      if (request !== requestSequence.current) return;
      setRead((current) => ({
        ...current,
        error: errorMessage(error),
        loading: false,
        refreshing: false,
      }));
    }
  }, [features.merchantStaff]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return { features, load, read };
}

export default function MerchantWorkScreen() {
  const t = useTheme();
  const state = useMerchantWorkController();

  if (!state.features.merchantStaff) {
    return <Screen header={<Header title="Business work" />}><InlineAlert message="Staff accounts are turned off right now." /></Screen>;
  }

  return (
    <Screen header={<Header title="Business work" subtitle="Jobs and requests assigned to you" />} gap={t.spacing.md}>
      {state.read.value === null && state.read.error ? (
        <ErrorState message={state.read.error} onRetry={() => void state.load()} />
      ) : state.read.value === null ? (
        <Skeleton height={100} radius={t.radii.lg} />
      ) : (
        <>
          {state.read.refreshing ? <Text variant="caption" color="muted">Refreshing business access…</Text> : null}
          {state.read.error ? (
            <InlineAlert
              tone="warning"
              title="Showing the last successful membership list"
              message={state.read.error}
              actionLabel="Retry"
              onAction={() => void state.load()}
            />
          ) : null}
          {state.read.value.length === 0 && !state.read.error ? (
            <EmptyState title="No active business access" message="Ask a business owner to add your existing QuickServe user ID." />
          ) : state.read.value.map((membership) => {
            const presentation = getBusinessWorkPresentation(membership, state.features);
            return (
              <Card key={getBusinessWorkKey(membership)} gap={t.spacing.sm}>
                <Text variant="title3">{membership.business_name}</Text>
                <Text variant="caption" color="muted">{membership.business_type} · {membership.role}</Text>
                {presentation.actions.includes('provider-jobs') ? (
                  <Button
                    title="Open assigned jobs"
                    disabled={!!state.read.error}
                    onPress={() => router.push({ pathname: '/dashboard', params: { providerId: membership.owner_id } })}
                  />
                ) : null}
                {presentation.actions.includes('shop-enquiries') ? (
                  <Button title="Open shop enquiries" disabled={!!state.read.error} onPress={() => router.push('/merchant-enquiries')} />
                ) : null}
                {presentation.actions.includes('shop-rfqs') ? (
                  <Button title="Open supplier RFQs" variant="outline" disabled={!!state.read.error} onPress={() => router.push('/merchant-rfqs')} />
                ) : null}
                {presentation.actions.includes('sports-bookings') ? (
                  <Button title="Open sports bookings" disabled={!!state.read.error} onPress={() => router.push('/sports/manage')} />
                ) : null}
                {presentation.message ? <Text variant="footnote" color="muted">{presentation.message}</Text> : null}
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}

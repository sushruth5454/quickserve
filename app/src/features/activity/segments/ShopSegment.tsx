import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Card, EmptyState, InlineAlert, Skeleton, Text } from '../../../components/ui';
import { listMyProductEnquiries, type EnquirySummary } from '../../shops/api';
import { listMyCustomerRfqs, type CustomerRfqSummary } from '../../rfq/api';
import { RfqStatusLabel } from '../../rfq/components';
import { useTheme } from '../../../theme';
import { fmtDate } from '../model';
import type { MarkRead, RegisterRefresh } from './types';

export function ShopSegment({
  enquiriesEnabled,
  rfqEnabled,
  registerRefresh,
  markRead,
}: {
  enquiriesEnabled: boolean;
  rfqEnabled: boolean;
  registerRefresh: RegisterRefresh;
  markRead: MarkRead;
}) {
  const t = useTheme();
  const [enquiries, setEnquiries] = useState<EnquirySummary[] | null>(null);
  const [rfqs, setRfqs] = useState<CustomerRfqSummary[] | null>(null);
  const [enquiryError, setEnquiryError] = useState<string | null>(null);
  const [rfqError, setRfqError] = useState<string | null>(null);

  const loadEnquiries = useCallback(async () => {
    try {
      setEnquiries(await listMyProductEnquiries());
      setEnquiryError(null);
    } catch (e) {
      setEnquiryError((e as Error).message);
    }
  }, []);

  const loadRfqs = useCallback(async () => {
    try {
      setRfqs(await listMyCustomerRfqs());
      setRfqError(null);
    } catch (e) {
      setRfqError((e as Error).message);
    }
  }, []);

  const load = useCallback(async () => {
    await Promise.all([loadEnquiries(), loadRfqs()]);
  }, [loadEnquiries, loadRfqs]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => registerRefresh(load), [load, registerRefresh]);

  return (
    <View style={{ gap: t.spacing.lg }}>
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="title3">Product enquiries</Text>
        {!enquiriesEnabled ? <Text variant="caption" color="muted">Existing history is read-only while new enquiries are turned off.</Text> : null}
        {enquiryError ? <InlineAlert message={enquiryError} /> : null}
        {enquiries == null ? (
          <Skeleton height={86} radius={t.radii.lg} />
        ) : !enquiries.length ? (
          <EmptyState icon="chatbubble-ellipses-outline" title="No product enquiries yet" message="Your shop conversations will appear here." compact />
        ) : enquiries.map((enquiry) => (
            <Card
              key={enquiry.id}
              onPress={() => router.push({ pathname: '/enquiry/[id]', params: { id: enquiry.id } })}
              gap={t.spacing.xs}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{enquiry.product_name ?? 'Shop enquiry'}</Text>
                {enquiry.customer_unread ? <Text variant="captionStrong" color="primaryText">{enquiry.customer_unread} unread</Text> : null}
              </View>
              <Text variant="footnote" color="muted">{enquiry.shop_name} · {enquiry.status}</Text>
              <Text variant="caption" color="muted">{fmtDate(enquiry.last_message_at)}</Text>
            </Card>
        ))}
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="title3">Product RFQs</Text>
        {!rfqEnabled ? <Text variant="caption" color="muted">Existing history is read-only while new RFQs are turned off.</Text> : null}
        {rfqError ? <InlineAlert message={rfqError} /> : null}
        {rfqs == null ? (
          <Skeleton height={86} radius={t.radii.lg} />
        ) : !rfqs.length ? (
          <EmptyState icon="document-text-outline" title="No RFQs yet" message="Your product quote requests will appear here." compact />
        ) : rfqs.map((rfq) => (
            <Card
              key={rfq.id}
              onPress={() => {
                void markRead('rfq', rfq.id).catch(() => undefined);
                router.push({ pathname: '/rfq/[id]', params: { id: rfq.id } });
              }}
              gap={t.spacing.xs}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{rfq.title}</Text>
                <RfqStatusLabel status={rfq.status} />
              </View>
              <Text variant="footnote" color="muted">{rfq.category_name} · {rfq.area}, {rfq.city}</Text>
              <Text variant="caption" color="muted">
                {rfq.recipient_count} shops contacted · Needed by {new Date(`${rfq.needed_by}T00:00:00`).toLocaleDateString('en-IN')}
              </Text>
            </Card>
        ))}
      </View>
    </View>
  );
}

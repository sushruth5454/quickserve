import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Card, Button, Divider, InlineAlert, LIST_INSET, ListItem, Section, Text, TextArea, useConfirm, useToast } from '../../components/ui';
import * as api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Booking } from '../../lib/types';

export interface HelpItem {
  key: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  subtitle?: string;
  onPress: () => void;
}

type CreatorDeadlineBooking = Booking & {
  delivery_due_at?: string | null;
  delivery_status?: string;
  revisions_allowed?: number;
  revisions_used?: number;
};

const DELIVERY_GRACE_MS = 48 * 60 * 60 * 1000;

export function CancelSection({ items, busy }: { items: HelpItem[]; busy: boolean }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [booking, setBooking] = useState<CreatorDeadlineBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setBooking(await api.getBooking(id) as CreatorDeadlineBooking);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load, items]);

  const customerOwnsBooking = !!booking && booking.customer_id === userId;
  const deliveryDueAt = booking?.archetype === 'proposal' ? booking.delivery_due_at ?? null : null;
  const canCancelOverdueDelivery = customerOwnsBooking
    && booking?.status === 'delivery_pending'
    && !!deliveryDueAt
    && Date.now() > new Date(deliveryDueAt).getTime() + DELIVERY_GRACE_MS;
  const canDisputeDelivery = customerOwnsBooking
    && booking?.archetype === 'proposal'
    && booking?.status === 'delivery_pending';

  const cancelOverdueDelivery = async () => {
    if (!booking || !canCancelOverdueDelivery) return;
    const confirmed = await confirm({
      title: 'Cancel this booking?',
      message: 'The agreed delivery date plus 48 hours has passed. Cancel now for a full refund of the amounts paid.',
      confirmLabel: 'Cancel booking',
      cancelLabel: 'Keep booking',
      destructive: true,
    });
    if (!confirmed) return;
    setActionBusy(true);
    setError(null);
    try {
      await api.cancelBooking(booking.id, 'delivery deadline missed');
      toast({ message: 'Booking cancelled and refund requested', tone: 'success' });
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const submitDeliveryDispute = async () => {
    if (!booking || !reason.trim() || !canDisputeDelivery) return;
    setActionBusy(true);
    setError(null);
    try {
      await api.disputeBooking(booking.id, reason.trim());
      toast({ message: 'Dispute raised', tone: 'success' });
      setDisputeOpen(false);
      setReason('');
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const c2Items = [...items];
  if (canDisputeDelivery && !disputeOpen) {
    c2Items.push({
      key: 'creator-delivery-dispute',
      title: 'Report a delivery problem',
      subtitle: 'Pauses payment to the creator while support reviews',
      icon: 'flag-outline',
      onPress: () => setDisputeOpen(true),
    });
  }
  if (canCancelOverdueDelivery) {
    c2Items.push({
      key: 'creator-delivery-overdue-cancel',
      title: 'Delivery is overdue — cancel for a full refund',
      icon: 'close-circle-outline',
      destructive: true,
      onPress: () => void cancelOverdueDelivery(),
    });
  }

  return (
    <>
      {error ? <InlineAlert message={error} /> : null}
      {deliveryDueAt ? (
        <Card>
          <Text variant="bodyStrong">Delivery by {new Date(deliveryDueAt).toLocaleDateString('en-IN')}</Text>
        </Card>
      ) : null}
      {booking?.archetype === 'proposal' ? (
        <Card>
          <Text variant="bodyStrong">Revisions included: {booking.revisions_allowed ?? 1}</Text>
          <Text variant="footnote" color="muted">Revisions used: {booking.revisions_used ?? 0}</Text>
        </Card>
      ) : null}
      {canDisputeDelivery && disputeOpen ? (
        <Card>
          <Text variant="subheadStrong">Report a delivery problem</Text>
          <Text variant="footnote" color="muted">Payment to the creator is paused while support reviews it.</Text>
          <TextArea label="What went wrong?" value={reason} onChangeText={setReason} maxLength={500} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Back" variant="outline" onPress={() => setDisputeOpen(false)} style={{ flex: 1 }} />
            <Button
              title="Raise dispute"
              variant="destructive"
              disabled={!reason.trim()}
              loading={actionBusy}
              onPress={() => void submitDeliveryDispute()}
              style={{ flex: 2 }}
            />
          </View>
        </Card>
      ) : null}
      <Section title="Help">
        <Card padding={0} gap={0}>
          {c2Items.map((h, i) => (
            <Fragment key={h.key}>
              {i > 0 ? <Divider inset={LIST_INSET} /> : null}
              <ListItem
                title={h.title}
                subtitle={h.subtitle}
                icon={h.icon}
                destructive={h.destructive}
                chevron={!h.destructive}
                onPress={busy || actionBusy ? undefined : h.onPress}
              />
            </Fragment>
          ))}
        </Card>
      </Section>
    </>
  );
}

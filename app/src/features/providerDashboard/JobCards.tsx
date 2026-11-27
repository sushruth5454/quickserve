import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { Badge, BottomSheet, Button, Card, IconButton, Text, TextArea } from '../../components/ui';
import { CategoryIcon } from '../../components/CategoryIcon';
import { statusShort, statusTone } from '../../components/status';
import { ChatButton, UnreadMessagesRow } from '../../components/UnreadChat';
import { formatINR } from '../../lib/money';
import { bookingRef, scheduleLabel } from '../../lib/schedule';
import type { ProviderJob } from '../../lib/types';
import { firstName } from './model';
import { openBooking } from './navigation';
import { CountdownRing, getNextStep, getRequestActionState, type IconName } from './DashboardWidgets';

const DECLINE_REASONS = ['Too far', 'Busy right now', 'Not my skill', 'Other'] as const;

export function RequestCard(props: {
  job: ProviderJob;
  icon: string | undefined;
  photos: string[];
  now: number;
  minEarning: number | null;
  busy: boolean;
  unread: number;
  onAccept: () => void;
  onDecline: () => void;
  onViewDetails: () => void;
}) {
  const t = useTheme();
  const j = props.job;
  const actions = getRequestActionState(j, props.now);
  return (
    <Animated.View entering={FadeInDown.duration(240)} layout={LinearTransition}>
      <Card variant="elevated" gap={t.spacing.md}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <CategoryIcon icon={props.icon} size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title3" numberOfLines={1}>
              {j.category_name}
            </Text>
            <Text variant="footnote" color="muted" numberOfLines={1}>
              {firstName(j.customer_name)} · {j.area}
              {j.distance_km != null ? ` · ${j.distance_km} km` : ''}
            </Text>
          </View>
          {actions.leftMs !== null ? <CountdownRing leftMs={actions.leftMs} /> : null}
        </View>
        <Text variant="callout" color="textSecondary" numberOfLines={2}>
          {j.description || 'No description'}
        </Text>
        <UnreadMessagesRow bookingId={j.booking_id} count={props.unread} />
        {props.photos.length ? (
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            {props.photos.slice(0, 4).map((u) => (
              <Image key={u} source={{ uri: u }} style={{ width: 56, height: 56, borderRadius: t.radii.sm }} contentFit="cover" accessibilityLabel="Problem photo" />
            ))}
          </View>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: t.spacing.sm,
            paddingVertical: t.spacing.sm,
            paddingHorizontal: t.spacing.md,
            borderRadius: t.radii.sm,
            backgroundColor: t.colors.surfaceAlt,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <Ionicons name="time-outline" size={14} color={t.colors.muted} />
            <Text variant="footnote" color="textSecondary" numberOfLines={1}>
              {j.scheduled_at ? scheduleLabel(j.scheduled_at) : 'As soon as possible'}
            </Text>
          </View>
          {props.minEarning == null || props.minEarning <= 0 || j.visit_fee <= 0 || j.booking_origin === 'byo' ? (
            <Text variant="footnote" color="muted" numberOfLines={1}>Earning estimate unavailable</Text>
          ) : (
            <Text variant="footnote" color="muted" numberOfLines={1}>
              You earn{' '}
              <Text variant="footnoteStrong" color="successText" tabular>
                {formatINR(props.minEarning)}+
              </Text>
            </Text>
          )}
        </View>
        <Text variant="caption" color="muted">
          Exact address is shared after you accept · {bookingRef(j.booking_id)}
        </Text>
        <Button title="View details" variant="outline" size="md" fullWidth onPress={props.onViewDetails} />
        <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
          <Button title="Decline" variant="outline" size="lg" style={{ flex: 1 }} disabled={props.busy || !actions.canDecline} onPress={props.onDecline} />
          <Button title="Accept" size="lg" style={{ flex: 1.4 }} loading={props.busy} disabled={props.busy || !actions.canAccept} onPress={props.onAccept} />
        </View>
      </Card>
    </Animated.View>
  );
}

export function NextJobCard(props: {
  job: ProviderJob;
  icon: string | undefined;
  busy: boolean;
  onPrimary: () => void;
  unread: number;
  onNavigate: (() => void) | null;
}) {
  const t = useTheme();
  const j = props.job;
  const step = getNextStep(j);
  return (
    <Card variant="elevated" gap={t.spacing.lg} onPress={() => openBooking(j.booking_id)} accessibilityLabel={`Next job: ${j.category_name} for ${j.customer_name}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <CategoryIcon icon={props.icon} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title3" numberOfLines={1}>
            {firstName(j.customer_name)}
          </Text>
          <Text variant="footnote" color="muted" numberOfLines={1}>
            {j.category_name} · {bookingRef(j.booking_id)}
          </Text>
        </View>
        {props.onNavigate ? <IconButton icon="navigate-outline" variant="neutral" accessibilityLabel="Navigate" onPress={props.onNavigate} /> : null}
        <ChatButton bookingId={j.booking_id} count={props.unread} accessibilityLabel="Chat with customer" />
      </View>
      <View style={{ gap: t.spacing.sm }}>
        <Badge label={statusShort[j.status]} tone={statusTone[j.status]} dot />
        <Meta icon="time-outline" text={j.scheduled_at ? scheduleLabel(j.scheduled_at) : 'As soon as possible'} />
        <Meta
          icon="location-outline"
          text={`${j.address_line ? `${j.address_line}, ` : ''}${j.area}${j.distance_km != null ? ` · ${j.distance_km} km away` : ''}`}
        />
      </View>
      <Button
        title={step?.label ?? 'View job'}
        leftIcon={step?.icon}
        variant={step?.primary ? 'primary' : 'outline'}
        size="lg"
        fullWidth
        loading={props.busy}
        onPress={props.onPrimary}
      />
    </Card>
  );
}
function Meta({ icon, text }: { icon: IconName; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.sm }}>
      <Ionicons name={icon} size={16} color={t.colors.muted} style={{ marginTop: 2 }} />
      <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

export function DeclineSheet({ job, busy, onClose, onConfirm }: { job: ProviderJob | null; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const t = useTheme();
  const [reason, setReason] = useState<(typeof DECLINE_REASONS)[number]>('Busy right now');
  const [other, setOther] = useState('');
  useEffect(() => {
    if (job) {
      setReason('Busy right now');
      setOther('');
    }
  }, [job]);
  const final = reason === 'Other' ? other.trim() : reason;
  return (
    <BottomSheet
      visible={!!job}
      onClose={onClose}
      title="Decline this request?"
      subtitle="The customer gets a full refund. Frequent declines lower your ranking."
      footer={<Button title="Decline request" variant="destructive" size="lg" fullWidth loading={busy} disabled={!final} onPress={() => onConfirm(final)} />}
    >
      <View style={{ marginHorizontal: -t.spacing.sm }}>
        {DECLINE_REASONS.map((r) => {
          const sel = r === reason;
          return (
            <Pressable
              key={r}
              accessibilityRole="radio"
              accessibilityState={{ checked: sel }}
              onPress={() => setReason(r)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.md,
                minHeight: 52,
                paddingHorizontal: t.spacing.sm,
                borderRadius: t.radii.md,
                backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
              })}
            >
              <Ionicons name={sel ? 'radio-button-on' : 'radio-button-off'} size={22} color={sel ? t.colors.primary : t.colors.outline} />
              <Text variant="body">{r}</Text>
            </Pressable>
          );
        })}
      </View>
      {reason === 'Other' ? <TextArea placeholder="Add a short reason" value={other} onChangeText={setOther} maxLength={200} /> : null}
    </BottomSheet>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { notificationTimePresentation } from '../lib/notificationPresentation';
import type { NotificationItem } from '../lib/unread';
import { useTheme } from '../theme';
import { Text, type IconName } from './ui';

const ICON: Record<string, IconName> = {
  chat_message: 'chatbubble-ellipses',
  request_message: 'chatbubble-ellipses',
  booking_requested: 'briefcase',
  booking_accepted: 'checkmark-circle',
  booking_declined: 'close-circle',
  booking_expired: 'time',
  booking_cancelled: 'close-circle',
  provider_en_route: 'navigate',
  quote_sent: 'document-text',
  change_order_sent: 'document-text',
  completion_requested: 'checkmark-done-circle',
  proposal_request_received: 'mail',
  proposal_received: 'mail-open',
  proposal_booked: 'calendar',
  milestone_due: 'wallet',
  delivery_submitted: 'cloud-done',
};

export function NotificationCard({
  item,
  pending,
  onOpen,
  now = Date.now(),
  timeZone = 'Asia/Kolkata',
}: {
  item: NotificationItem;
  pending: boolean;
  onOpen: (item: NotificationItem) => void;
  now?: number;
  timeZone?: string;
}) {
  const t = useTheme();
  const time = notificationTimePresentation(item, now, timeZone);
  const action = item.route ? 'Open' : item.unread ? 'Mark as read' : 'Unavailable';
  const accessibleLabel = [
    item.unread ? 'Unread' : 'Read',
    item.title,
    item.context,
    item.body,
    time.accessibilityLabel,
    action,
  ].filter(Boolean).join('. ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibleLabel}
      accessibilityHint={item.route ? 'Opens the related conversation or event.' : item.unread ? 'Marks this notification as read.' : undefined}
      accessibilityState={{ busy: pending, disabled: !item.route && !item.unread }}
      disabled={!item.route && !item.unread}
      onPress={() => onOpen(item)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: t.spacing.md,
        padding: t.spacing.md,
        borderRadius: t.radii.lg,
        borderWidth: 1,
        borderColor: item.unread ? t.colors.primary : t.colors.border,
        backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.colors.surfaceAlt,
        }}
      >
        <Ionicons name={ICON[item.kind] ?? 'notifications'} size={20} color={t.colors.primaryText} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.sm }}>
          <Text variant={item.unread ? 'subheadStrong' : 'subhead'} style={{ flex: 1 }}>
            {item.title}
          </Text>
          <Text variant="caption" color="muted" accessibilityLabel={time.accessibilityLabel}>
            {time.label}
          </Text>
        </View>
        {item.context ? (
          <Text variant="caption" color="primaryText">{item.context}</Text>
        ) : null}
        {item.body ? (
          <Text variant="footnote" color="textSecondary">{item.body}</Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
          <Text variant="captionStrong" color={item.unread ? 'primaryText' : 'muted'}>
            {item.unread ? 'Unread' : 'Read'}
          </Text>
          <Text variant="captionStrong" color={item.route ? 'primaryText' : 'muted'}>
            {action}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

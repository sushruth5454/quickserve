import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { EmptyState, ErrorState, Header, Screen, Skeleton, Text, type IconName } from '../src/components/ui';
import { listNotifications, markNotificationsRead } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { buildNotificationItems, shortAgo, type AppNotification, type NotificationItem } from '../src/lib/unread';
import { useUnread } from '../src/lib/unreadContext';
import { useTheme } from '../src/theme';

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

/** Instagram-style activity: "New message from Ravi · AC Repair booking", booking updates and proposals; tap opens it. */
export default function NotificationsScreen() {
  const t = useTheme();
  const { userId } = useAuth();
  const unread = useUnread();
  const [rows, setRows] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const unreadRef = useRef(unread);
  unreadRef.current = unread;

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await listNotifications(60);
      setRows(list);
      // Shown highlighted from this snapshot; on the server they are read now, so the bell badge clears.
      if (list.some((n) => !n.read_at && n.kind !== 'chat_message')) {
        await markNotificationsRead(null).catch(() => undefined);
      }
      unreadRef.current.clearNotifications();
      void unreadRef.current.refresh();
    } catch (e) {
      setError((e as Error).message || 'Could not load notifications.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const items = rows ? buildNotificationItems(rows, unread.map, userId) : null;

  return (
    <Screen
      header={<Header title="Notifications" />}
      gap={t.spacing.sm}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : items == null ? (
        [0, 1, 2, 3].map((i) => <Skeleton key={i} height={72} />)
      ) : !items.length ? (
        <EmptyState icon="notifications-outline" title="No notifications yet" message="Messages from your pros and booking updates will show up here." />
      ) : (
        items.map((n) => <Row key={n.key} item={n} />)
      )}
    </Screen>
  );
}

function Row({ item }: { item: NotificationItem }) {
  const t = useTheme();
  const label = [item.title, item.context, item.body, shortAgo(item.at)].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.unread ? 'Unread. ' : ''}${label}`}
      disabled={!item.route}
      onPress={() => item.route && router.push(item.route as Href)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: t.spacing.md,
        paddingHorizontal: t.spacing.md,
        paddingVertical: t.spacing.md,
        borderRadius: t.radii.md,
        borderWidth: 1,
        borderColor: item.unread ? t.colors.primary : t.colors.border,
        backgroundColor: pressed ? t.colors.surfaceAlt : item.unread ? t.colors.primarySoft : t.colors.surface,
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
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
          <Text variant={item.unread ? 'subheadStrong' : 'subhead'} numberOfLines={2} style={{ flex: 1 }}>
            {item.title}
          </Text>
          <Text variant="caption" color="muted">
            {shortAgo(item.at)}
          </Text>
        </View>
        {item.context ? (
          <Text variant="caption" color="primaryText" numberOfLines={1}>
            {item.context}
          </Text>
        ) : null}
        {item.body ? (
          <Text variant="footnote" color="textSecondary" numberOfLines={2}>
            {item.body}
          </Text>
        ) : null}
      </View>
      {item.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: t.colors.primary }} /> : null}
    </Pressable>
  );
}

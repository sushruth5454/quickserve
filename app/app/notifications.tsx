import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, EmptyState, ErrorState, Header, Screen, Skeleton, Text, type IconName } from '../src/components/ui';
import { listNotifications, markNotificationsRead } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { buildNotificationItems, shortAgo, type AppNotification, type NotificationItem } from '../src/lib/unread';
import { useUnread } from '../src/lib/unreadContext';
import { useTheme } from '../src/theme';
import { RouteErrorBoundary } from '../src/components/RouteErrorBoundary';

export { RouteErrorBoundary as ErrorBoundary };

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
      // Opening the screen doesn't mark anything read: each notification is marked read when it is tapped.
      setRows(await listNotifications(60));
      void unreadRef.current.refresh();
    } catch (e) {
      setError((e as Error).message || 'Could not load notifications.');
    }
  }, []);

  const markRead = useCallback(async (ids: string[] | null) => {
    const now = new Date().toISOString();
    setRows((prev) => prev?.map((n) => (!n.read_at && (ids === null ? n.kind !== 'chat_message' : ids.includes(n.id)) ? { ...n, read_at: now } : n)) ?? prev);
    await markNotificationsRead(ids).catch(() => undefined);
    void unreadRef.current.refresh();
  }, []);

  const open = useCallback((item: NotificationItem) => {
    // Chat rows are read when the chat opens; other rows are single notifications keyed by id.
    if (item.unread && !item.key.startsWith('chat:')) void markRead([item.key]);
    if (item.route) router.push(item.route as Href);
  }, [markRead]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const items = rows ? buildNotificationItems(rows, unread.map, userId) : null;
  const unreadOthers = items?.filter((i) => i.unread && !i.key.startsWith('chat:')).length ?? 0;

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
        <>
          {unreadOthers > 0 ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Button title="Mark all as read" variant="ghost" size="sm" onPress={() => void markRead(null)} />
            </View>
          ) : null}
          {items.map((n) => <Row key={n.key} item={n} onOpen={open} />)}
          <Text variant="caption" color="muted" style={{ textAlign: 'center' }}>
            {`Loaded ${rows?.length ?? 0} notifications`}
          </Text>
        </>
      )}
    </Screen>
  );
}

function Row({ item, onOpen }: { item: NotificationItem; onOpen: (item: NotificationItem) => void }) {
  const t = useTheme();
  const label = [item.title, item.context, item.body, shortAgo(item.at)].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.unread ? 'Unread. ' : ''}${label}`}
      disabled={!item.route && !item.unread}
      onPress={() => onOpen(item)}
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

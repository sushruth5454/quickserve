import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import {
  Button,
  EmptyState,
  ErrorState,
  Header,
  InlineAlert,
  Screen,
  Skeleton,
  Text,
  type IconName,
} from '../../components/ui';
import { getChatHeading, listNotifications, markNotificationsRead } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  buildNotificationItems,
  type AppNotification,
  type ChatHeading,
  type NotificationItem,
} from '../../lib/unread';
import { groupNotificationItems, notificationTimePresentation } from '../../lib/notificationPresentation';
import { useUnread } from '../../lib/unreadContext';
import { useTheme } from '../../theme';
import { NotificationCard } from '../../components/NotificationCard';

const useRuntimeFeature: (key: string) => boolean = (() => {
  try {
    return (require('../../lib/featureFlags') as typeof import('../../lib/featureFlags')).useFeature;
  } catch {
    return () => false;
  }
})();

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

const LIST_LIMIT = 60;
const NOTIFICATION_TIME_ZONE = 'Asia/Kolkata';

interface RowsState {
  actorId: string | null;
  rows: AppNotification[];
}

interface ErrorStateForActor {
  actorId: string | null;
  message: string;
}

function useNotificationsController() {
  const { userId } = useAuth();
  const unread = useUnread();
  const unreadRef = useRef(unread);
  unreadRef.current = unread;
  const actorRef = useRef(userId);
  actorRef.current = userId;

  const [rowsState, setRowsState] = useState<RowsState | null>(null);
  const [loadErrorState, setLoadErrorState] = useState<ErrorStateForActor | null>(null);
  const [acknowledgementError, setAcknowledgementError] = useState<string | null>(null);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingReadIds, setPendingReadIds] = useState<Set<string>>(() => new Set());
  const [readAllPending, setReadAllPending] = useState(false);
  const [headings, setHeadings] = useState<Record<string, ChatHeading | null>>({});
  const pendingReadIdsRef = useRef(new Set<string>());
  const readAllPendingRef = useRef(false);
  const actorGeneration = useRef(0);
  const listRequest = useRef(0);
  const headingGeneration = useRef(0);
  const headingRequests = useRef(new Set<string>());
  const rows = rowsState?.actorId === userId ? rowsState.rows : null;
  const loadError = loadErrorState?.actorId === userId ? loadErrorState.message : null;

  useEffect(() => {
    actorGeneration.current += 1;
    listRequest.current += 1;
    headingGeneration.current += 1;
    headingRequests.current.clear();
    setRowsState(null);
    setLoadErrorState(null);
    setAcknowledgementError(null);
    setReconciliationError(null);
    setNavigationError(null);
    setHeadings({});
    setRefreshing(false);
    pendingReadIdsRef.current.clear();
    readAllPendingRef.current = false;
    setPendingReadIds(new Set());
    setReadAllPending(false);
  }, [userId]);

  const load = useCallback(async () => {
    const actorId = userId;
    const request = ++listRequest.current;
    setLoadErrorState(null);
    if (!actorId) {
      if (actorRef.current === actorId && listRequest.current === request) {
        setRowsState({ actorId, rows: [] });
      }
      return;
    }
    try {
      const nextRows = await listNotifications(LIST_LIMIT);
      if (actorRef.current !== actorId || listRequest.current !== request) return;
      setRowsState({ actorId, rows: nextRows });
      void unreadRef.current.refresh();
    } catch (error) {
      if (actorRef.current === actorId && listRequest.current === request) {
        setLoadErrorState({
          actorId,
          message: (error as Error).message || 'Could not load notifications.',
        });
      }
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        listRequest.current += 1;
      };
    }, [load]),
  );

  const outboxChats = new Set(
    (rows ?? [])
      .filter((row) => row.kind === 'chat_message' && row.booking_id)
      .map((row) => row.booking_id as string),
  );
  const missingHeadingIds = rows
    ? Object.keys(unread.map).filter((bookingId) => !outboxChats.has(bookingId))
    : [];

  useEffect(() => {
    if (!rows || !userId) return;
    const actorId = userId;
    const generation = headingGeneration.current;
    for (const bookingId of missingHeadingIds) {
      const requestKey = `${actorId}:${bookingId}`;
      if (headingRequests.current.has(requestKey)) continue;
      headingRequests.current.add(requestKey);
      void getChatHeading(bookingId)
        .catch(() => null)
        .then((heading) => {
          if (actorRef.current !== actorId || headingGeneration.current !== generation) return;
          setHeadings((previous) => ({ ...previous, [bookingId]: heading }));
        });
    }
  }, [rows, unread.map, userId, missingHeadingIds.join(',')]);

  const markRead = useCallback(async (ids: string[] | null) => {
    if (ids === null) {
      if (readAllPendingRef.current || pendingReadIdsRef.current.size > 0) return;
      readAllPendingRef.current = true;
      setReadAllPending(true);
    } else {
      if (
        ids.length === 0
        || readAllPendingRef.current
        || ids.some((id) => pendingReadIdsRef.current.has(id))
      ) return;
      ids.forEach((id) => pendingReadIdsRef.current.add(id));
      setPendingReadIds(new Set(pendingReadIdsRef.current));
    }

    const actorId = userId;
    const operationGeneration = actorGeneration.current;
    setAcknowledgementError(null);
    setReconciliationError(null);
    try {
      try {
        await markNotificationsRead(ids);
      } catch (error) {
        if (actorRef.current === actorId && actorGeneration.current === operationGeneration) {
          setAcknowledgementError((error as Error).message || 'Could not mark notifications as read.');
          const request = ++listRequest.current;
          try {
            const canonicalRows = await listNotifications(LIST_LIMIT);
            if (
              actorRef.current === actorId
              && actorGeneration.current === operationGeneration
              && listRequest.current === request
            ) {
              setRowsState({ actorId, rows: canonicalRows });
            }
          } catch (reconciliationError) {
            if (actorRef.current === actorId && actorGeneration.current === operationGeneration) {
              setReconciliationError(
                (reconciliationError as Error).message || 'Could not refresh notification state.',
              );
            }
          }
          if (actorRef.current === actorId && actorGeneration.current === operationGeneration) {
            try {
              await unreadRef.current.refresh();
            } catch (reconciliationError) {
              if (actorRef.current === actorId && actorGeneration.current === operationGeneration) {
                setReconciliationError(
                  (current) => current || (reconciliationError as Error).message || 'Could not refresh unread counts.',
                );
              }
            }
          }
        }
        return;
      }

      if (actorRef.current !== actorId || actorGeneration.current !== operationGeneration) return;

      try {
        const request = ++listRequest.current;
        const canonicalRows = await listNotifications(LIST_LIMIT);
        if (
          actorRef.current === actorId
          && actorGeneration.current === operationGeneration
          && listRequest.current === request
        ) {
          setRowsState({ actorId, rows: canonicalRows });
        }
        await unreadRef.current.refresh();
      } catch (error) {
        if (actorRef.current === actorId && actorGeneration.current === operationGeneration) {
          setReconciliationError((error as Error).message || 'Read status was saved, but the list could not be refreshed.');
        }
      }
    } finally {
      if (actorRef.current === actorId && actorGeneration.current === operationGeneration) {
        if (ids === null) {
          readAllPendingRef.current = false;
          setReadAllPending(false);
        } else {
          ids.forEach((id) => pendingReadIdsRef.current.delete(id));
          setPendingReadIds(new Set(pendingReadIdsRef.current));
        }
      }
    }
  }, [userId]);

  const open = useCallback((item: NotificationItem) => {
    const actorId = userId;
    const operationGeneration = actorGeneration.current;
    setNavigationError(null);
    if (item.unread && !item.key.startsWith('chat:')) void markRead([item.key]);
    if (!item.route) return;
    try {
      router.push(item.route as Href);
    } catch (error) {
      if (actorRef.current === actorId && actorGeneration.current === operationGeneration) {
        setNavigationError((error as Error).message || 'Could not open this notification.');
      }
    }
  }, [markRead, userId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const items = rows ? buildNotificationItems(rows, unread.map, userId, headings) : null;
  const groups = items
    ? groupNotificationItems(items, Date.now(), NOTIFICATION_TIME_ZONE)
    : null;

  return {
    rows,
    loadError,
    acknowledgementError,
    reconciliationError,
    navigationError,
    refreshing,
    pendingReadIds,
    readAllPending,
    items,
    groups,
    unreadOthers: items?.filter((item) => item.unread && !item.key.startsWith('chat:')).length ?? 0,
    load,
    refresh,
    markRead,
    open,
  };
}

export default function NotificationsScreen() {
  const t = useTheme();
  const controller = useNotificationsController();

  return (
    <Screen
      header={<Header title="Notifications" />}
      gap={t.spacing.sm}
      refreshing={controller.refreshing}
      onRefresh={controller.refresh}
    >
      <InlineAlert message={controller.acknowledgementError} tone="danger" />
      <InlineAlert message={controller.reconciliationError} tone="warning" />
      <InlineAlert message={controller.navigationError} tone="danger" />
      {controller.loadError ? (
        <ErrorState message={controller.loadError} onRetry={() => void controller.load()} />
      ) : controller.items == null || controller.groups == null ? (
        [0, 1, 2, 3].map((index) => <Skeleton key={index} height={72} />)
      ) : !controller.items.length ? (
        <EmptyState
          icon="notifications-outline"
          title="No notifications yet"
          message="Messages from your pros and booking updates will show up here."
        />
      ) : (
        <>
          {controller.unreadOthers > 0 ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Button
                title="Mark all as read"
                variant="ghost"
                size="sm"
                loading={controller.readAllPending}
                disabled={controller.readAllPending || controller.pendingReadIds.size > 0}
                onPress={() => void controller.markRead(null)}
              />
            </View>
          ) : null}
          {controller.groups.map((group) => (
            <View key={group.key} style={{ gap: t.spacing.sm }}>
              <Text variant="captionStrong" color="muted" accessibilityRole="header">
                {group.label}
              </Text>
              {group.items.map((item) => (
                <NotificationPresentation
                  key={item.key}
                  item={item}
                  pending={controller.readAllPending || controller.pendingReadIds.has(item.key)}
                  onOpen={controller.open}
                />
              ))}
            </View>
          ))}
          <Text variant="caption" color="muted" style={{ textAlign: 'center' }}>
            {`Showing ${controller.rows?.length ?? 0} recent notification records (up to ${LIST_LIMIT}; chats are grouped)`}
          </Text>
        </>
      )}
    </Screen>
  );
}

interface NotificationPresentationProps {
  item: NotificationItem;
  pending: boolean;
  onOpen: (item: NotificationItem) => void;
}

class MissingFeatureProviderBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { unavailable: boolean }
> {
  state = { unavailable: false };

  static getDerivedStateFromError() {
    return { unavailable: true };
  }

  render() {
    return this.state.unavailable ? this.props.fallback : this.props.children;
  }
}

function NotificationPresentation(props: NotificationPresentationProps) {
  return (
    <MissingFeatureProviderBoundary fallback={<Row {...props} />}>
      <FeatureAwareNotificationPresentation {...props} />
    </MissingFeatureProviderBoundary>
  );
}

function FeatureAwareNotificationPresentation(props: NotificationPresentationProps) {
  const enabled = useRuntimeFeature('oorva_comms_ux');
  return enabled ? <NotificationCard {...props} /> : <Row {...props} />;
}

function Row({
  item,
  pending,
  onOpen,
}: {
  item: NotificationItem;
  pending: boolean;
  onOpen: (item: NotificationItem) => void;
}) {
  const t = useTheme();
  const time = notificationTimePresentation(item, Date.now(), NOTIFICATION_TIME_ZONE);
  const label = [item.title, item.context, item.body, time.accessibilityLabel].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.unread ? 'Unread. ' : ''}${label}`}
      accessibilityHint={item.route ? 'Opens the related conversation or event.' : item.unread ? 'Marks this notification as read.' : undefined}
      accessibilityState={{ busy: pending, disabled: !item.route && !item.unread }}
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
          <Text variant="caption" color="muted" accessibilityLabel={time.accessibilityLabel}>
            {time.label}
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

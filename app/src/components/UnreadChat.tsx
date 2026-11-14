import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { CountBadge, IconButton, Text } from './ui';

const openChat = (bookingId: string) => router.push({ pathname: '/chat/[bookingId]', params: { bookingId } });

/** "2 new messages" row on booking/job cards; tapping it opens the chat directly. Renders nothing at 0. */
export function UnreadMessagesRow({ bookingId, count }: { bookingId: string; count: number }) {
  const t = useTheme();
  if (count <= 0) return null;
  const label = count === 1 ? '1 new message' : `${count > 99 ? '99+' : count} new messages`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open chat`}
      hitSlop={6}
      onPress={() => openChat(bookingId)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.sm,
        alignSelf: 'flex-start',
        paddingVertical: 6,
        paddingHorizontal: t.spacing.md,
        borderRadius: t.radii.pill,
        backgroundColor: pressed ? t.colors.primarySoft : t.colors.surfaceAlt,
      })}
    >
      <Ionicons name="chatbubble-ellipses" size={16} color={t.colors.primaryText} />
      <Text variant="footnoteStrong" style={{ color: t.colors.primaryText }}>
        {label}
      </Text>
      <CountBadge count={count} />
    </Pressable>
  );
}

/** Chat icon button with an unread count overlay. */
export function ChatButton({ bookingId, count, accessibilityLabel }: { bookingId: string; count: number; accessibilityLabel: string }) {
  return (
    <View>
      <IconButton
        icon="chatbubble-ellipses-outline"
        variant="tonal"
        accessibilityLabel={count > 0 ? `${accessibilityLabel}, ${count} unread` : accessibilityLabel}
        onPress={() => openChat(bookingId)}
      />
      <CountBadge count={count} overlay />
    </View>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { EmptyState, ErrorState, Header, Screen, Skeleton, Text } from '../src/components/ui';
import { HISTORY_LIMIT, listConversations, type ConversationSummary } from '../src/lib/assistant/history';
import { useTheme } from '../src/theme';

function when(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The customer's last 20 QuickServe AI conversations (owner-only via RLS). */
export default function AssistantHistoryScreen() {
  const t = useTheme();
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    listConversations()
      .then(setItems)
      .catch((e: Error) => setError(e.message || 'Could not load your conversations.'));
  };
  useEffect(load, []);

  return (
    <Screen header={<Header title="Past conversations" subtitle={`Your last ${HISTORY_LIMIT} chats with QuickServe AI`} />} gap={t.spacing.sm}>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items == null ? (
        [0, 1, 2].map((i) => <Skeleton key={i} height={64} />)
      ) : !items.length ? (
        <EmptyState icon="chatbubbles-outline" title="No conversations yet" message="Ask QuickServe AI about any problem at home." actionLabel="Start a chat" onAction={() => router.replace('/assistant')} />
      ) : (
        items.map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            accessibilityLabel={`${c.title}, ${when(c.updatedAt)}. Open conversation`}
            onPress={() => router.replace({ pathname: '/assistant', params: { conversation: c.id } })}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.spacing.md,
              minHeight: 56,
              paddingHorizontal: t.spacing.md,
              paddingVertical: t.spacing.md,
              borderRadius: t.radii.md,
              borderWidth: 1,
              borderColor: t.colors.border,
              backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
            })}
          >
            <Ionicons name="sparkles-outline" size={18} color={t.colors.primaryText} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="subhead" numberOfLines={1}>
                {c.title}
              </Text>
              <Text variant="caption" color="muted">
                {when(c.updatedAt)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={t.colors.subtle} />
          </Pressable>
        ))
      )}
    </Screen>
  );
}
